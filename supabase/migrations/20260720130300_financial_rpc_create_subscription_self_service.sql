-- Phase 5a, migration 3/4: create_subscription() gains self-service
-- authorization (the subscription's own prospective owner, same pattern
-- as create_order_for_subscription/activate_queued_subscription), with
-- two non-negotiable rules for any non-admin caller:
--
-- 1. p_amount_paid must be null/zero - a self caller can never attest to
--    a payment having happened, the same fraud-vector line ADR-012 drew
--    for register_payment, now enforced at this entry point too.
-- 2. A non-admin caller always takes the queued/pending insert shape,
--    regardless of the existing hasValidActive check - self-service
--    creation must never go live before payment, unlike the admin
--    immediate-active branch (unchanged, still used for admin's own
--    "activate now" workflow). The self-caller queued branch additionally
--    creates the Order immediately (the admin-triggered queued branch
--    still does not, unchanged - see the Phase 1 Extension's own reasoning
--    for why: a self-triggered queued subscription always represents real
--    purchase intent; an admin-scheduled one is a freely-cancellable
--    placeholder, and delete_queued_subscription's raw DELETE must keep
--    working for that case).

create or replace function create_subscription(
  p_member_email text,
  p_plan_id uuid,
  p_start_date date,
  p_end_date date,
  p_amount_paid numeric default null,
  p_currency text default 'RON',
  p_method text default null
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
      -- v_is_self already proved a matching profile exists for this email
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

-- Rollback: re-apply 20260720120300's CREATE OR REPLACE body.
