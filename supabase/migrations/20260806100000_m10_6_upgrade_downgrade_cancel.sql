-- M10.6 Plan Upgrade / Downgrade / Cancel.
--
-- No new table, no new lineage model, no new lifecycle state, no new
-- payment model (M10_IMPLEMENTATION_PLAN.md Section 7's own explicit
-- exclusions) - platform_subscriptions.status already carries 'superseded'
-- and 'cancelled' as live values since the M10.5 schema migration, built
-- forward-looking specifically so this milestone would need no ALTER here.
--
-- upgrade_platform_plan / downgrade_platform_plan are "mechanically one
-- operation" (OWNER_DOMAIN_IMPLEMENTATION_ARCHITECTURE.md Section 6.4,
-- quoting MEMBER_DOMAIN_ARCHITECTURE.md Section 6.3's identical pattern):
-- "'Upgrade' vs 'downgrade' is a UI label from comparing prices, not a
-- different code path." Implemented here as two thin public RPCs (matching
-- M10_IMPLEMENTATION_PLAN.md Section 7's own explicit two-name RPC list)
-- both delegating to one shared, unexported internal function - no
-- duplicated business logic between them, and neither validates price
-- direction server-side, since the frozen text is explicit that the
-- distinction is a caller-side label, not a rule to enforce.
--
-- No Order/Payment is created by a plan change (Edge Function impact:
-- "None - amount is always server-derived... no external call needed").
-- The new Subscription is created directly as 'active' (never
-- 'pending_payment') because, unlike purchase_platform_plan, there is no
-- Stripe Checkout step to wait for here at all - reasoned, not merely
-- assumed: docs/architecture/PLATFORM_BILLING_MODEL.md's own "Future
-- Price Change Policy" explicitly defers renewal/proration billing
-- mechanics to a future milestone, so a plan change today can only ever
-- be a pure lineage swap with no synchronous charge adjustment - the one
-- coherent, buildable-today behavior, not a product decision invented here.

create or replace function _change_platform_plan(
  p_gym_id uuid,
  p_new_platform_plan_version_id uuid
)
returns table (
  platform_subscription_id uuid,
  predecessor_id uuid
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_old_subscription_id uuid;
  v_new_version_id uuid;
  v_new_price_amount integer;
  v_new_currency text;
  v_new_version_retired_at timestamptz;
  v_new_subscription_id uuid;
begin
  if not is_platform_billing_owner(p_gym_id) then
    raise exception 'not authorized';
  end if;

  select platform_subscriptions.id into v_old_subscription_id
  from platform_subscriptions
  where platform_subscriptions.gym_id = p_gym_id and platform_subscriptions.status = 'active';

  if v_old_subscription_id is null then
    raise exception 'this gym has no active platform subscription to change';
  end if;

  select platform_plan_versions.id, platform_plan_versions.price_amount,
         platform_plan_versions.currency, platform_plan_versions.retired_at
  into v_new_version_id, v_new_price_amount, v_new_currency, v_new_version_retired_at
  from platform_plan_versions
  where platform_plan_versions.id = p_new_platform_plan_version_id;

  if v_new_version_id is null then
    raise exception 'platform plan version not found';
  end if;

  if v_new_version_retired_at is not null then
    raise exception 'this platform plan version is no longer available';
  end if;

  if v_new_version_id = (select platform_subscriptions.platform_plan_version_id from platform_subscriptions where platform_subscriptions.id = v_old_subscription_id) then
    raise exception 'this gym is already subscribed to this plan';
  end if;

  -- Lock the current Subscription row for the remainder of this
  -- transaction so two concurrent plan-change attempts serialize instead
  -- of both independently observing the same "active" predecessor and
  -- each creating their own successor - mirrors the Financial Domain's
  -- own refund-race lock (validate_payment_refund's `for update`).
  perform 1 from platform_subscriptions where id = v_old_subscription_id for update;

  -- Re-check status after acquiring the lock - a concurrent change may
  -- have already superseded this row while this call was waiting.
  if (select status from platform_subscriptions where id = v_old_subscription_id) <> 'active' then
    raise exception 'this gym has no active platform subscription to change';
  end if;

  -- Supersede the old row BEFORE inserting the new 'active' one, not
  -- after - reversing this order would momentarily leave two 'active'
  -- rows for the same gym_id and hit platform_subscriptions_one_active_idx
  -- (caught live during verification, not theorized: the partial unique
  -- index has no way to know the second row is about to be corrected a
  -- statement later, so ordering here is load-bearing, not cosmetic).
  update platform_subscriptions set status = 'superseded' where id = v_old_subscription_id;

  insert into platform_subscriptions (gym_id, platform_plan_version_id, price_amount, currency, status, started_at, renews_at, predecessor_id)
  values (p_gym_id, v_new_version_id, v_new_price_amount, v_new_currency, 'active', now(), now() + interval '1 month', v_old_subscription_id)
  returning id into v_new_subscription_id;

  update gym_commercial_state
  set platform_subscription_id = v_new_subscription_id
  where gym_id = p_gym_id;

  return query select v_new_subscription_id, v_old_subscription_id;
end;
$$;

create or replace function upgrade_platform_plan(
  p_gym_id uuid,
  p_new_platform_plan_version_id uuid
)
returns table (
  platform_subscription_id uuid,
  predecessor_id uuid
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_result record;
begin
  select * into v_result from _change_platform_plan(p_gym_id, p_new_platform_plan_version_id);

  insert into admin_audit_log (gym_id, actor_admin_id, action_type, outcome)
  values (p_gym_id, auth.uid(), 'platform_plan_upgraded', 'success');

  return query select v_result.platform_subscription_id, v_result.predecessor_id;
end;
$$;

create or replace function downgrade_platform_plan(
  p_gym_id uuid,
  p_new_platform_plan_version_id uuid
)
returns table (
  platform_subscription_id uuid,
  predecessor_id uuid
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_result record;
begin
  select * into v_result from _change_platform_plan(p_gym_id, p_new_platform_plan_version_id);

  insert into admin_audit_log (gym_id, actor_admin_id, action_type, outcome)
  values (p_gym_id, auth.uid(), 'platform_plan_downgraded', 'success');

  return query select v_result.platform_subscription_id, v_result.predecessor_id;
end;
$$;

create or replace function cancel_platform_subscription(
  p_gym_id uuid
)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_subscription_id uuid;
begin
  if not is_platform_billing_owner(p_gym_id) then
    raise exception 'not authorized';
  end if;

  select platform_subscriptions.id into v_subscription_id
  from platform_subscriptions
  where platform_subscriptions.gym_id = p_gym_id and platform_subscriptions.status = 'active';

  if v_subscription_id is null then
    raise exception 'this gym has no active platform subscription to cancel';
  end if;

  update platform_subscriptions set status = 'cancelled' where id = v_subscription_id;

  -- gym_commercial_state.platform_subscription_id is deliberately left
  -- pointing at the now-cancelled Subscription, not nulled - a historical
  -- "last known" reference, consistent with "never deletes Gym data"
  -- (Section 7's own acceptance criterion) - there is no product
  -- requirement anywhere in this milestone's frozen text to clear it.
  update gym_commercial_state
  set commercial_state = 'cancelled'
  where gym_id = p_gym_id;

  insert into admin_audit_log (gym_id, actor_admin_id, action_type, outcome)
  values (p_gym_id, auth.uid(), 'platform_subscription_cancelled', 'success');

  return true;
end;
$$;

alter table admin_audit_log drop constraint admin_audit_log_action_type_check;
alter table admin_audit_log add constraint admin_audit_log_action_type_check
  check (action_type in (
    'member_added_new', 'member_added_existing',
    'member_invited', 'member_invitation_revoked', 'member_invitation_resent',
    'member_onboarding_completed', 'member_app_activated',
    'gym_waiver_published',
    'owner_gym_bootstrapped',
    'admin_invited', 'admin_invitation_accepted', 'admin_invitation_revoked',
    'platform_subscription_purchased', 'platform_payment_succeeded', 'platform_payment_refunded',
    'platform_plan_upgraded', 'platform_plan_downgraded', 'platform_subscription_cancelled'
  ));

-- Grants: Owner-only, mirroring purchase_platform_plan exactly (authenticated
-- + service_role, explicit revoke from anon/public - the M10.3/M10.5
-- default-privilege and PUBLIC-execute-grant hazards, closed inline this
-- time rather than found after the fact).
grant execute on function upgrade_platform_plan(uuid, uuid) to authenticated;
grant execute on function upgrade_platform_plan(uuid, uuid) to service_role;
grant execute on function downgrade_platform_plan(uuid, uuid) to authenticated;
grant execute on function downgrade_platform_plan(uuid, uuid) to service_role;
grant execute on function cancel_platform_subscription(uuid) to authenticated;
grant execute on function cancel_platform_subscription(uuid) to service_role;

revoke execute on function upgrade_platform_plan(uuid, uuid) from anon, public;
revoke execute on function downgrade_platform_plan(uuid, uuid) from anon, public;
revoke execute on function cancel_platform_subscription(uuid) from anon, public;

-- _change_platform_plan is an internal helper only, never a public write
-- path (M10.6's own instruction: "Do NOT introduce additional public write
-- paths unless strictly required") - no grant to authenticated/anon/public
-- at all; only the two wrapping RPCs (already service_role/definer-owned)
-- ever call it, and Postgres function privilege checks apply to the direct
-- caller, so leaving this ungranted to any client role is what actually
-- keeps it non-public, not merely a naming convention.
revoke execute on function _change_platform_plan(uuid, uuid) from public, anon, authenticated;
