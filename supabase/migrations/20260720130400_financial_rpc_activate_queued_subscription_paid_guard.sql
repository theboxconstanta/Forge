-- Phase 5a, migration 4/4: activate_queued_subscription() gains
-- service_role as a valid caller, and a new activation guard: any
-- non-admin caller (member-owner and service_role alike - both already
-- fail is_admin(), so this is the same "not admin" branch, no separate
-- check needed) is blocked from activating a subscription whose Order
-- exists and is not yet 'paid'. If no Order exists at all, behaviour is
-- completely unchanged - this is what keeps the existing member
-- auto-activation flow (fetchAbonamentMeu -> activateQueuedSubscription,
-- admin-scheduled renewals, which correctly have no Order by Phase 1
-- Extension's own design) unaffected.
--
-- This closes the vulnerability identified during the Stripe architecture
-- review: without this guard, a member could self-activate their own
-- unpaid Stripe-pending subscription by calling this RPC directly,
-- bypassing payment entirely. Applying the check to service_role too
-- (not just the member path) is deliberate defense-in-depth - even if a
-- future webhook implementation ever called this before register_payment
-- by mistake, the database rejects the premature activation rather than
-- trusting the caller's own sequencing.

create or replace function activate_queued_subscription(
  p_subscription_id uuid,
  p_end_date date,
  p_method text default null
)
returns table(subscription_id uuid, start_date date, end_date date)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_target record;
  v_gym_id uuid;
  v_is_owner boolean;
  v_is_admin boolean;
  v_is_service_role boolean;
  v_has_profile boolean;
  v_start_date date := current_date;
  v_order_id uuid;
  v_order_status text;
  v_match text[];
  v_notes_amount numeric;
begin
  select id, gym_id, member_email, notes, plan_id, is_active, queued
    into v_target
  from subscriptions
  where id = p_subscription_id;

  if v_target.id is null then
    raise exception 'subscription not found';
  end if;

  v_gym_id := v_target.gym_id;
  v_is_admin := is_admin(v_gym_id);
  v_is_service_role := (auth.jwt() ->> 'role') = 'service_role';

  select exists(
    select 1 from profiles
    where id = auth.uid() and lower(email) = lower(v_target.member_email) and gym_id = v_gym_id
  ) into v_is_owner;

  if not (v_is_admin or v_is_owner or v_is_service_role) then
    raise exception 'not authorized';
  end if;

  if v_target.queued is not true or v_target.is_active is true then
    raise exception 'subscription not found';
  end if;

  if not v_is_admin then
    select o.status into v_order_status from orders o where o.subscription_id = p_subscription_id;
    if v_order_status is not null and v_order_status <> 'paid' then
      raise exception 'order not paid';
    end if;
  end if;

  update subscriptions set is_active = false
  where lower(member_email) = lower(v_target.member_email) and gym_id = v_gym_id
    and is_active = true and id <> p_subscription_id;

  update subscriptions
  set is_active = true, queued = false, start_date = v_start_date, end_date = p_end_date, sessions_used = 0
  where id = p_subscription_id;

  select exists(
    select 1 from profiles where lower(email) = lower(v_target.member_email) and gym_id = v_gym_id
  ) into v_has_profile;

  if v_has_profile then
    select create_order_for_subscription(
      p_subscription_id,
      coalesce((select price from subscription_plans where id = v_target.plan_id), 0),
      'RON'
    ) into v_order_id;

    if v_is_admin then
      if v_target.notes is not null then
        v_match := regexp_match(v_target.notes, 'Plătit:\s*([\d.,]+)\s*RON');
        if v_match is not null then
          v_notes_amount := replace(v_match[1], ',', '.')::numeric;
        end if;
      end if;

      if v_notes_amount is not null and v_notes_amount > 0 then
        perform register_payment(v_order_id, v_notes_amount, 'succeeded', p_method, null, null);
      end if;
    end if;
  end if;

  return query select p_subscription_id, v_start_date, p_end_date;
end;
$$;

-- Rollback: re-apply 20260720111000's CREATE OR REPLACE body.
