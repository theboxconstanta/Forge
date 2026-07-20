-- Phase 1 Extension, follow-up fix: create_subscription()'s
-- RETURNS TABLE(..., is_active boolean, queued boolean) implicitly
-- declares is_active/queued as PL/pgSQL variables, which shadowed the
-- identically-named subscriptions columns in two WHERE clauses - Postgres
-- correctly rejected the query as ambiguous ("42702") the first time this
-- function was actually exercised, in test design, before any real usage.
-- Fixed by explicitly qualifying every reference to the table's own
-- is_active/queued columns with `subscriptions.` wherever they could be
-- confused with the output parameter names. No behavioural change intended
-- beyond making the function actually executable.

create or replace function create_subscription(
  p_member_email text,
  p_plan_id uuid,
  p_start_date date,
  p_end_date date,
  p_amount_paid numeric default null,
  p_currency text default 'RON'
)
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
  v_has_profile boolean;
  v_new_id uuid;
  v_result_active boolean;
  v_result_queued boolean;
  v_order_id uuid;
begin
  if not is_admin(v_gym_id) then
    raise exception 'not authorized';
  end if;

  select * into v_plan from subscription_plans where id = p_plan_id and gym_id = v_gym_id;
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

  if v_has_valid_active then
    insert into subscriptions (
      gym_id, member_email, plan_id, sessions_total, sessions_used,
      start_date, end_date, is_active, queued, notes
    ) values (
      v_gym_id, v_email, p_plan_id, v_plan.sessions, 0,
      v_today, v_today, false, true, null
    ) returning id into v_new_id;
    v_result_active := false;
    v_result_queued := true;
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

    select exists(
      select 1 from profiles where lower(email) = v_email and gym_id = v_gym_id
    ) into v_has_profile;

    if v_has_profile then
      select create_order_for_subscription(v_new_id, coalesce(v_plan.price, 0), p_currency) into v_order_id;

      if p_amount_paid is not null and p_amount_paid > 0 then
        perform register_payment(v_order_id, p_amount_paid, 'succeeded', null, null, null);
      end if;
    end if;
  end if;

  return query select v_new_id, v_result_active, v_result_queued;
end;
$$;

-- Rollback: re-apply 20260720110500's CREATE OR REPLACE body.
