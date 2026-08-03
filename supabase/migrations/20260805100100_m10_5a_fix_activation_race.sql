-- M10.5a Live Payment Verification - fix a real, reproduced bug found
-- during self-review ("100 simultaneous purchases... duplicate Stripe
-- delivery" per the verification mission's own instruction to attempt to
-- break the system).
--
-- Reproduced directly, not theorized: if two Platform Orders exist as
-- pending_payment for the same Gym (reachable if the Edge Function's own
-- reuse-window is ever bypassed - two browser tabs, or a retry after the
-- window expired while an older Session somehow still completes) and BOTH
-- are paid, the second register_platform_payment call's own subscription-
-- activation UPDATE hits platform_subscriptions_one_active_idx (correct -
-- the invariant itself held, exactly as designed) but the resulting
-- unique_violation was UNHANDLED - it propagated out of the function,
-- rolling back the entire call INCLUDING the Payment insert that had
-- already succeeded moments earlier in the same transaction.
--
-- Consequence, confirmed live: the second, genuinely-charged Payment was
-- never recorded at all. The webhook would see this as an error and
-- return 500; Stripe would retry; the retry would hit the identical
-- unhandled exception forever, since the underlying condition (a
-- different Subscription already won the race) never changes. This is
-- exactly the "money taken, nothing recorded" class of failure
-- M10_IMPLEMENTATION_PLAN.md's own Section 6 grouping decision exists to
-- prevent - found here in a different, narrower shape than that decision
-- anticipated, and closed the same way: never let a real charge go
-- unrecorded.
--
-- Fix: the subscription-activation block (UPDATE platform_subscriptions,
-- UPDATE gym_commercial_state, audit insert) is now its own begin/exception
-- block - in PL/pgSQL this is an implicit savepoint, so catching
-- unique_violation here rolls back only the activation attempt, never the
-- Payment insert that already committed within the same transaction. The
-- Payment record is preserved and returned successfully either way - Stripe
-- sees a clean 200, no retry storm, no lost money record.
--
-- Deliberately NOT solved further than this: what should eventually happen
-- to a legitimately-charged Payment whose Order "lost" the activation race
-- (refund it automatically? flag it for manual review?) is a real product
-- question, out of scope for this fix - named as a remaining risk, not
-- silently resolved by inventing a policy here.

create or replace function register_platform_payment(
  p_platform_order_id uuid,
  p_amount integer,
  p_status text default 'succeeded',
  p_provider text default 'stripe',
  p_provider_reference text default null
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_subscription_id uuid;
  v_currency text;
  v_gym_id uuid;
  v_owner_admin_id uuid;
  v_payment_id uuid;
  v_newly_inserted boolean := true;
begin
  if (auth.jwt() ->> 'role') <> 'service_role' then
    raise exception 'not authorized';
  end if;

  if p_amount < 0 then
    raise exception 'amount must be >= 0';
  end if;

  select platform_orders.platform_subscription_id, platform_orders.currency
  into v_subscription_id, v_currency
  from platform_orders where platform_orders.id = p_platform_order_id;

  if v_subscription_id is null then
    raise exception 'order not found';
  end if;

  perform 1 from platform_orders where id = p_platform_order_id for update;

  begin
    insert into platform_payments (platform_order_id, amount, currency, direction, status, provider, provider_reference)
    values (p_platform_order_id, p_amount, v_currency, 'charge', p_status, p_provider, p_provider_reference)
    returning id into v_payment_id;
  exception when unique_violation then
    v_newly_inserted := false;
    select id into v_payment_id
    from platform_payments
    where provider = p_provider and provider_reference = p_provider_reference;
  end;

  if v_newly_inserted and p_status = 'succeeded' then
    select platform_subscriptions.gym_id into v_gym_id
    from platform_subscriptions where platform_subscriptions.id = v_subscription_id;

    -- Its own begin/exception (an implicit savepoint) - a race lost here
    -- must never roll back the Payment insert above, which already
    -- represents a real, immutable fact about money that moved.
    begin
      update platform_subscriptions
      set status = 'active', started_at = now(), renews_at = now() + interval '1 month'
      where id = v_subscription_id and status = 'pending_payment';

      update gym_commercial_state
      set commercial_state = 'paying', platform_subscription_id = v_subscription_id
      where gym_id = v_gym_id;

      select owner_admin_id into v_owner_admin_id
      from gym_activation_state where gym_activation_state.gym_id = v_gym_id;

      insert into admin_audit_log (gym_id, actor_admin_id, action_type, outcome)
      values (v_gym_id, v_owner_admin_id, 'platform_payment_succeeded', 'success');
    exception when unique_violation then
      -- A different Order for this same Gym already won the one-active-
      -- Subscription-per-Gym race (platform_subscriptions_one_active_idx).
      -- The Payment above is still real and stays recorded - only the
      -- activation side-effects for THIS order are skipped.
      null;
    end;
  end if;

  return v_payment_id;
end;
$$;
