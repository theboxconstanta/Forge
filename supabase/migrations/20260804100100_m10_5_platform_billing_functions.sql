-- M10.5 Platform Purchase Flow - RPCs.
--
-- purchase_platform_plan: Owner-only (Section 11.2 - "billing intent is
-- the Owner's to attest, per Section 4", not every Admin). Creates a
-- Platform Subscription (status='pending_payment') and a Platform Order
-- together, atomically, through the one named command Section 6.4
-- describes as a single RPC (unlike the Financial Domain's own two
-- separate RPCs for the equivalent step) - deliberately safer, since one
-- atomic transaction has no partial-failure window between the two
-- creates that a two-call sequence would.
--
-- register_platform_payment / refund_platform_payment: verified-internal-
-- caller only - not even the Owner (Section 11.2, restated: "these are
-- claims that real money moved; opening them to the party they concern
-- would let a Gym assert its own payment history by declaration"). Strictly
-- service_role - no is_admin/is_platform_billing_owner bypass exists here
-- at all, unlike the Financial Domain's own register_payment (which does
-- allow an administrator, since Member-billing amounts can be recorded by
-- an Admin taking cash/card in person). Platform Billing has no equivalent
-- in-person-payment case, so this stays strictly narrower.

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

  -- Table-qualified selects throughout this function, deliberately - the
  -- `returns table(...)` clause above implicitly declares OUT parameters
  -- named total_amount/currency, which are in scope for the entire
  -- function body and collide with the identically-named columns on
  -- platform_plan_versions/platform_orders if referenced unqualified
  -- (caught live during verification: "column reference currency is
  -- ambiguous" - a real bug, not a hypothetical one).
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

  -- Section 5.3's invariant, enforced explicitly here as defense-in-depth
  -- (docs/architecture/M10.5_PRODUCT_DECISIONS.md Decision 3) - the
  -- primary experience is the purchase CTA never rendering for an
  -- already-paying Owner (frontend), this is the backstop for a stale tab
  -- or a raced double-call. The partial unique index on (gym_id) where
  -- status='active' would also catch a raced concurrent insert reaching
  -- this same conclusion independently, at the data layer.
  if exists (select 1 from platform_subscriptions where gym_id = p_gym_id and status = 'active') then
    raise exception 'this gym already has an active platform subscription';
  end if;

  insert into platform_subscriptions (gym_id, platform_plan_version_id, price_amount, currency)
  values (p_gym_id, v_version_id, v_version_price_amount, v_version_currency)
  returning id into v_subscription_id;

  insert into platform_orders (platform_subscription_id, total_amount, currency)
  values (v_subscription_id, v_version_price_amount, v_version_currency)
  returning id into v_order_id;

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
    -- currency is always derived from the Order being settled, never
    -- passed in by the caller - a Payment's currency matching its Order's
    -- is an invariant, not a value worth trusting an external caller (even
    -- a verified-internal one) to supply correctly (caught live: this
    -- column has no default and was originally left unpopulated entirely,
    -- a real NOT NULL violation, not a hypothetical gap).
    insert into platform_payments (platform_order_id, amount, currency, direction, status, provider, provider_reference)
    values (p_platform_order_id, p_amount, v_currency, 'charge', p_status, p_provider, p_provider_reference)
    returning id into v_payment_id;
  exception when unique_violation then
    v_newly_inserted := false;
    select id into v_payment_id
    from platform_payments
    where provider = p_provider and provider_reference = p_provider_reference;
  end;

  -- Subscription activation + Gym Commercial State transition, atomically
  -- with the Payment write - reasoned, not explicitly spelled out at this
  -- level of detail by Section 6.5's own bullet list, applying the same
  -- discipline already used for M10.3's accept_admin_invitation: every
  -- write this domain makes goes through one dedicated SECURITY DEFINER
  -- function, never a two-call sequence with a partial-failure window
  -- between "payment recorded" and "subscription/commercial state
  -- updated". Guarded by `v_newly_inserted` and the current status check
  -- so a duplicate webhook delivery (already caught by the unique_violation
  -- catch above) never re-runs this block or clobbers a later, legitimate
  -- state change from an upgrade/downgrade milestone not yet built.
  if v_newly_inserted and p_status = 'succeeded' then
    update platform_subscriptions
    set status = 'active', started_at = now(), renews_at = now() + interval '1 month'
    where id = v_subscription_id and status = 'pending_payment';

    update gym_commercial_state
    set commercial_state = 'paying', platform_subscription_id = v_subscription_id
    where gym_id = (select gym_id from platform_subscriptions where id = v_subscription_id);
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
  v_payment_id uuid;
begin
  if (auth.jwt() ->> 'role') <> 'service_role' then
    raise exception 'not authorized';
  end if;

  if p_amount < 0 then
    raise exception 'amount must be >= 0';
  end if;

  select platform_orders.currency into v_currency
  from platform_orders where platform_orders.id = p_platform_order_id;

  if v_currency is null then
    raise exception 'order not found';
  end if;

  insert into platform_payments (platform_order_id, amount, currency, direction, status, provider, provider_reference, original_payment_id)
  values (p_platform_order_id, p_amount, v_currency, 'refund', 'succeeded', p_provider, p_provider_reference, p_original_payment_id)
  returning id into v_payment_id;

  return v_payment_id;
end;
$$;

grant execute on function purchase_platform_plan(uuid, uuid) to authenticated;
grant execute on function purchase_platform_plan(uuid, uuid) to service_role;
grant execute on function register_platform_payment(uuid, integer, text, text, text) to service_role;
grant execute on function refund_platform_payment(uuid, integer, uuid, text, text) to service_role;

revoke execute on function register_platform_payment(uuid, integer, text, text, text) from anon, authenticated;
revoke execute on function refund_platform_payment(uuid, integer, uuid, text, text) from anon, authenticated;

-- Close the PUBLIC-execute-grant hazard proactively this time (found live,
-- after the fact, in M10.3 - the same class of gap, now applied inline
-- before it can ever be exploitable). Independently re-verified after this
-- migration runs, not assumed safe from the statement alone.
revoke execute on function purchase_platform_plan(uuid, uuid) from public;
revoke execute on function register_platform_payment(uuid, integer, text, text, text) from public;
revoke execute on function refund_platform_payment(uuid, integer, uuid, text, text) from public;
