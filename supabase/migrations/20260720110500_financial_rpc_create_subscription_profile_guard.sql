-- Phase 1 Extension, follow-up fix: create_subscription() must not fail the
-- entire subscription creation when the member has no matching profiles
-- row yet.
--
-- Found during test design, before any real usage: orders.client_id is
-- NOT NULL REFERENCES profiles(id) (Phase 0, frozen) - create_order_for_
-- subscription() cannot succeed for a member with no profile. Legacy
-- saveAbonament has no such requirement (member_email is free text; an
-- admin can create a subscription for someone who hasn't signed up into
-- the app yet - a walk-in who joins later). Making create_subscription()
-- fully atomic would silently turn that into a hard failure for the
-- *entire* subscription creation, not just the Order/Payment part - a real
-- divergence from existing behaviour, "do not change Subscriptions
-- semantics" applies squarely here.
--
-- Empirically verified against live data: 0 of 180 real historical
-- subscriptions lack a matching profile - this has never actually
-- happened in practice, but the legacy code has no guarantee preventing
-- it, so it is not treated as an impossible case.
--
-- Fix: an explicit, deterministic pre-check (not exception-catching, which
-- would risk masking unrelated real errors from create_order_for_
-- subscription/register_payment under the same generic exception message).
-- If no profile exists yet, the subscription row still commits exactly as
-- legacy would, and Order/Payment creation is skipped for this one
-- instance - disclosed as a known residual gap in the completion report,
-- not silently absorbed.

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
  where lower(member_email) = v_email and gym_id = v_gym_id and is_active = true and queued = false
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
    where lower(member_email) = v_email and gym_id = v_gym_id and is_active = true;

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

-- Rollback: re-apply 20260720110100_financial_rpc_create_subscription.sql's
-- CREATE OR REPLACE body (reintroduces the unconditional Order creation).
