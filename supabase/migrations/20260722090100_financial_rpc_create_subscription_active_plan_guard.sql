-- M8, Phase 2 (backend security hardening, approved before any Membership
-- Catalog UI exists): create_subscription()'s plan lookup never checked
-- is_active, so an archived plan's id, if known or replayed, could still be
-- purchased/assigned. Harmless today (the only source of a plan_id is a
-- member's own already-active abonamentReal.plan_id), but M8's catalog is
-- about to make plan_id a member-chosen value from a wider set - this closes
-- the gap before that surface exists, not after. Same reasoning and the
-- identical one-clause fix applied to create-checkout-session's own plan
-- lookup in this same change.
--
-- "plan not found" is deliberately unchanged as the error for an archived
-- plan, same as a nonexistent or wrong-gym plan_id - merging these cases
-- avoids confirming to a caller that an id corresponds to a real, merely
-- archived, plan (same reasoning as P0-003's identical-404 precedent).

create or replace function create_subscription(p_member_email text, p_plan_id uuid, p_start_date date, p_end_date date, p_amount_paid numeric default null, p_currency text default 'RON', p_method text default null)
returns table(subscription_id uuid, is_active boolean, queued boolean)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_gym_id uuid := my_gym_id();
  v_email text := lower(trim(p_member_email));
  v_plan record;
  v_today date := current_date;
  v_existing record;
  v_has_valid_active boolean;
  v_new_id uuid;
  v_result_active boolean;
  v_result_queued boolean;
  v_order_id uuid;
  v_is_admin boolean;
  v_is_self boolean;
begin
  v_is_admin := is_admin(v_gym_id);

  select exists(
    select 1 from profiles where id = auth.uid() and lower(email) = v_email and gym_id = v_gym_id
  ) into v_is_self;

  if not (v_is_admin or v_is_self) then
    raise exception 'not authorized';
  end if;

  if not v_is_admin and p_amount_paid is not null and p_amount_paid <> 0 then
    raise exception 'self-service subscription creation cannot include a payment amount';
  end if;

  -- subscription_plans.is_active calificat explicit - RETURNS TABLE(...,
  -- is_active boolean, ...) mai jos aduce is_active in scope ca variabila de
  -- iesire, la fel ca subscriptions.is_active/queued calificate deja putin
  -- mai jos in aceeasi functie, pentru exact acelasi motiv.
  select * into v_plan from subscription_plans where id = p_plan_id and gym_id = v_gym_id and subscription_plans.is_active = true;
  if v_plan.id is null then
    raise exception 'plan not found';
  end if;

  select id, sessions_used, sessions_total into v_existing
  from subscriptions
  where lower(member_email) = v_email and gym_id = v_gym_id
    and subscriptions.is_active = true and subscriptions.queued = false
    and start_date <= v_today and end_date >= v_today
  order by created_at desc limit 1;

  v_has_valid_active := v_existing.id is not null and (
    v_existing.sessions_total is null or
    greatest(0, v_existing.sessions_total - coalesce(v_existing.sessions_used, 0)) > 0
  );

  if v_has_valid_active or not v_is_admin then
    insert into subscriptions (
      gym_id, member_email, plan_id, sessions_total, sessions_used,
      start_date, end_date, is_active, queued, notes
    ) values (
      v_gym_id, v_email, p_plan_id, v_plan.sessions, 0,
      v_today, v_today, false, true, null
    ) returning id into v_new_id;
    v_result_active := false;
    v_result_queued := true;

    if not v_is_admin then
      select create_order_for_subscription(v_new_id, coalesce(v_plan.price, 0), p_currency) into v_order_id;
    end if;
  else
    update subscriptions set is_active = false
    where lower(member_email) = v_email and gym_id = v_gym_id and subscriptions.is_active = true;

    insert into subscriptions (
      gym_id, member_email, plan_id, sessions_total, sessions_used,
      start_date, end_date, is_active, queued, notes
    ) values (
      v_gym_id, v_email, p_plan_id, v_plan.sessions, 0,
      p_start_date, p_end_date, true, false, null
    ) returning id into v_new_id;
    v_result_active := true;
    v_result_queued := false;

    if exists(select 1 from profiles where lower(email) = v_email and gym_id = v_gym_id) then
      select create_order_for_subscription(v_new_id, coalesce(v_plan.price, 0), p_currency) into v_order_id;

      if p_amount_paid is not null and p_amount_paid > 0 then
        perform register_payment(v_order_id, p_amount_paid, 'succeeded', p_method, null, null);
      end if;
    end if;
  end if;

  return query select v_new_id, v_result_active, v_result_queued;
end;
$$;

-- Rollback: re-apply the pre-M8 body (identical, minus "and is_active = true"
-- in the plan lookup).
