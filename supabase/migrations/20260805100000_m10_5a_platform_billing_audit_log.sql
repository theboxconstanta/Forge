-- M10.5a Live Payment Verification - close a real gap found during
-- production verification: OWNER_DOMAIN_IMPLEMENTATION_ARCHITECTURE.md
-- Section 13 requires "every Platform Subscription state change" and
-- "every Platform Payment event" to be audited, no exceptions - but
-- purchase_platform_plan/register_platform_payment/refund_platform_payment
-- never actually wrote to admin_audit_log. Verified directly, not assumed:
-- a full grep across every migration and Edge Function in this repo found
-- exactly one real `insert into admin_audit_log` statement anywhere
-- (m9_add_member_functions.sql) - the action_type vocabulary was extended
-- for owner_gym_bootstrapped/admin_invited/admin_invitation_accepted/
-- admin_invitation_revoked across M10.1 and M10.3, but none of those
-- functions ever actually insert a row either. That is a pre-existing,
-- project-wide gap, not unique to M10.5 - named here because it was found
-- here, but deliberately NOT fixed for M10.1/M10.3's own functions in this
-- migration, since this verification's own scope is M10.5 only (no
-- unrelated-system changes).
--
-- outcome only ever accepts 'success' (admin_audit_log_outcome_check) -
-- an audit entry is written only for a genuinely successful Payment,
-- never a pending/failed attempt.
--
-- actor_admin_id is NOT NULL with no Owner-Domain-appropriate default.
-- purchase_platform_plan has a real human actor (the calling Owner,
-- auth.uid()). register_platform_payment/refund_platform_payment run as
-- service_role with no human caller at all (Stripe's own async webhook
-- delivery) - the Gym's own owner_admin_id is used as the recorded actor
-- in that case, the party the money concerns, not a literal click.

alter table admin_audit_log drop constraint admin_audit_log_action_type_check;
alter table admin_audit_log add constraint admin_audit_log_action_type_check
  check (action_type in (
    'member_added_new', 'member_added_existing',
    'member_invited', 'member_invitation_revoked', 'member_invitation_resent',
    'member_onboarding_completed', 'member_app_activated',
    'gym_waiver_published',
    'owner_gym_bootstrapped',
    'admin_invited', 'admin_invitation_accepted', 'admin_invitation_revoked',
    'platform_subscription_purchased', 'platform_payment_succeeded', 'platform_payment_refunded'
  ));

create or replace function purchase_platform_plan(
  p_gym_id uuid,
  p_platform_plan_version_id uuid
)
returns table (
  platform_subscription_id uuid,
  platform_order_id uuid,
  total_amount integer,
  currency text
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_version_id uuid;
  v_version_price_amount integer;
  v_version_currency text;
  v_version_retired_at timestamptz;
  v_subscription_id uuid;
  v_order_id uuid;
begin
  if not is_platform_billing_owner(p_gym_id) then
    raise exception 'not authorized';
  end if;

  select platform_plan_versions.id, platform_plan_versions.price_amount,
         platform_plan_versions.currency, platform_plan_versions.retired_at
  into v_version_id, v_version_price_amount, v_version_currency, v_version_retired_at
  from platform_plan_versions
  where platform_plan_versions.id = p_platform_plan_version_id;

  if v_version_id is null then
    raise exception 'platform plan version not found';
  end if;

  if v_version_retired_at is not null then
    raise exception 'this platform plan version is no longer available for new subscriptions';
  end if;

  if exists (select 1 from platform_subscriptions where gym_id = p_gym_id and status = 'active') then
    raise exception 'this gym already has an active platform subscription';
  end if;

  insert into platform_subscriptions (gym_id, platform_plan_version_id, price_amount, currency)
  values (p_gym_id, v_version_id, v_version_price_amount, v_version_currency)
  returning id into v_subscription_id;

  insert into platform_orders (platform_subscription_id, total_amount, currency)
  values (v_subscription_id, v_version_price_amount, v_version_currency)
  returning id into v_order_id;

  insert into admin_audit_log (gym_id, actor_admin_id, action_type, outcome)
  values (p_gym_id, auth.uid(), 'platform_subscription_purchased', 'success');

  return query select v_subscription_id, v_order_id, v_version_price_amount, v_version_currency;
end;
$$;

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
  end if;

  return v_payment_id;
end;
$$;

create or replace function refund_platform_payment(
  p_platform_order_id uuid,
  p_amount integer,
  p_original_payment_id uuid,
  p_provider text default 'stripe',
  p_provider_reference text default null
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_currency text;
  v_subscription_id uuid;
  v_gym_id uuid;
  v_owner_admin_id uuid;
  v_payment_id uuid;
begin
  if (auth.jwt() ->> 'role') <> 'service_role' then
    raise exception 'not authorized';
  end if;

  if p_amount < 0 then
    raise exception 'amount must be >= 0';
  end if;

  select platform_orders.currency, platform_orders.platform_subscription_id
  into v_currency, v_subscription_id
  from platform_orders where platform_orders.id = p_platform_order_id;

  if v_currency is null then
    raise exception 'order not found';
  end if;

  insert into platform_payments (platform_order_id, amount, currency, direction, status, provider, provider_reference, original_payment_id)
  values (p_platform_order_id, p_amount, v_currency, 'refund', 'succeeded', p_provider, p_provider_reference, p_original_payment_id)
  returning id into v_payment_id;

  select platform_subscriptions.gym_id into v_gym_id
  from platform_subscriptions where platform_subscriptions.id = v_subscription_id;

  select owner_admin_id into v_owner_admin_id
  from gym_activation_state where gym_activation_state.gym_id = v_gym_id;

  insert into admin_audit_log (gym_id, actor_admin_id, action_type, outcome)
  values (v_gym_id, v_owner_admin_id, 'platform_payment_refunded', 'success');

  return v_payment_id;
end;
$$;
