-- M10.5 Platform Purchase Flow - schema.
--
-- platform_subscriptions / platform_orders / platform_payments
-- (OWNER_DOMAIN_IMPLEMENTATION_ARCHITECTURE.md Section 5.3/5.4): the same
-- ledger *architecture* as the Financial Domain's own orders/payments
-- (append-only Payments, derived Order status, refund-never-exceeds-charge)
-- reused deliberately (Principle 3.7), but a separate schema and separate
-- mechanism, non-negotiably (Principle 3.2) - never the same tables.
--
-- Money columns use `integer` minor units (matching M10.4's own
-- platform_plan_versions.price_amount convention, already live), not the
-- Financial Domain's own `numeric` major-units convention. "Structurally
-- identical to Financial Domain's own Order/Payment" (Section 5.4) is read
-- as the ledger's *shape and invariants*, not its literal money column
-- type - M10.4 already made a different, deliberate, already-shipped
-- choice for this specific ledger's own money representation, and Stripe's
-- own API is minor-units-native, so this avoids a unit conversion at the
-- one boundary that actually talks to Stripe.
--
-- platform_subscriptions.status starts at 'pending_payment', not 'active' -
-- this is the one place this migration extends beyond a literal reading of
-- Section 5.3's field list, reasoned from a real correctness requirement:
-- if a Subscription were created as 'active' at purchase-initiation time
-- (before Stripe ever confirms payment), an Owner who abandons Checkout
-- would be left with a permanently-blocking 'active' row and could never
-- purchase again - the exact "money taken, nothing recorded" class of bug
-- M10_IMPLEMENTATION_PLAN.md's own Section 6 grouping decision exists to
-- prevent, mirrored here for the Subscription side of the same problem.
-- 'pending_payment' -> 'active' is the webhook's own job (register_
-- platform_payment, companion migration), mirroring activate_queued_
-- subscription's exact role in the proven Financial Domain flow. The
-- partial unique index below therefore blocks at most one *active*
-- Subscription per Gym - exactly Section 5.3's literal invariant - not
-- "at most one pending", so an abandoned pending_payment row is harmless
-- and never blocks a later, genuine retry (the Edge Function's own
-- reuse-window is what dedupes retries, not a DB-level block).

create table platform_subscriptions (
  id uuid primary key default gen_random_uuid(),
  gym_id uuid not null references gyms(id),
  platform_plan_version_id uuid not null references platform_plan_versions(id),
  status text not null default 'pending_payment'
    check (status in ('pending_payment', 'active', 'superseded', 'cancelled')),
  price_amount integer not null check (price_amount >= 0),
  currency text not null check (char_length(currency) = 3),
  started_at timestamptz,
  renews_at timestamptz,
  predecessor_id uuid references platform_subscriptions(id),
  created_at timestamptz not null default now()
);

comment on table platform_subscriptions is
  'M10.5 Platform Subscription (OWNER_DOMAIN_IMPLEMENTATION_ARCHITECTURE.md Section 5.3). started_at/renews_at are set once status becomes active (register_platform_payment). Lineage is predecessor_id only - a successor is found by querying predecessor_id = this row''s id, never a synced bidirectional pointer.';
comment on column platform_subscriptions.price_amount is
  'The actual agreed price at purchase time (minor units) - copied from the referenced Platform Plan Version, never re-derived from it later, so a future price change never reprices an existing Subscription (docs/architecture/PLATFORM_BILLING_MODEL.md).';

-- Section 5.3's literal invariant: at most one *currently active* Platform
-- Subscription per Gym at a time (not "at most one ever" - upgrade/
-- downgrade/renewal legitimately produce a new one, future milestones).
create unique index platform_subscriptions_one_active_idx on platform_subscriptions (gym_id)
  where status = 'active';

create index platform_subscriptions_gym_id_idx on platform_subscriptions (gym_id, created_at desc);

create table platform_orders (
  id uuid primary key default gen_random_uuid(),
  platform_subscription_id uuid not null references platform_subscriptions(id),
  total_amount integer not null check (total_amount >= 0),
  currency text not null check (char_length(currency) = 3),
  status text not null default 'pending'
    check (status in ('pending', 'partial', 'paid', 'refunded', 'cancelled')),
  created_at timestamptz not null default now()
);

comment on table platform_orders is
  'M10.5 Platform Order (Section 5.4). status is derived by trigger from this Order''s own Payments (recompute_platform_order_status, companion migration) - never written directly by any RPC or client.';

create index platform_orders_subscription_id_idx on platform_orders (platform_subscription_id);

create table platform_payments (
  id uuid primary key default gen_random_uuid(),
  platform_order_id uuid not null references platform_orders(id),
  amount integer not null check (amount >= 0),
  currency text not null check (char_length(currency) = 3),
  direction text not null check (direction in ('charge', 'refund')),
  status text not null check (status in ('pending', 'succeeded', 'failed')),
  provider text,
  provider_reference text,
  original_payment_id uuid references platform_payments(id),
  created_at timestamptz not null default now()
);

comment on table platform_payments is
  'M10.5 Platform Payment (Section 5.4/11.3). Append-only - no UPDATE/DELETE grant or policy for any role, at any privilege level, ever. Written exclusively by register_platform_payment/refund_platform_payment (companion migration), verified-internal-caller only.';
comment on column platform_payments.amount is
  'Always >= 0; sign/polarity carried by direction, not by a negative amount - identical convention to the Financial Domain''s own payments.amount.';
comment on column platform_payments.original_payment_id is
  'Set only when direction=refund; must reference a direction=charge row on the same order - enforced by validate_platform_payment_refund (companion migration), mirroring the Financial Domain''s own validate_payment_refund exactly.';

-- Idempotency layer 3 (M10.5_PURCHASE_FLOW_READINESS.md's own verified
-- citation of the Financial Domain's proven three-layer defense): the
-- independent backup layer if the webhook's own status-gate were ever
-- bypassed. Mirrors payments_provider_reference_unique exactly.
create unique index platform_payments_provider_reference_unique on platform_payments (provider, provider_reference)
  where provider_reference is not null;

create index platform_payments_order_id_idx on platform_payments (platform_order_id);

-- Now that platform_subscriptions exists, gym_commercial_state's own
-- platform_subscription_id (M10.1, previously an unconstrained uuid column
-- with nothing yet to reference) gets its real FK.
alter table gym_commercial_state
  add constraint gym_commercial_state_platform_subscription_id_fkey
  foreign key (platform_subscription_id) references platform_subscriptions(id);

-- Triggers - reusing the Financial Domain's own proven mechanisms, not
-- redefining them: prevent_gym_id_change() is the same shared function
-- already attached to orders/payments/every other tenant-scoped table.
create trigger prevent_gym_id_change_trg
  before update on platform_subscriptions
  for each row execute function prevent_gym_id_change();

-- Refund validation, mirroring validate_payment_refund exactly, restated
-- for this ledger (own function, since it must reference platform_payments/
-- platform_orders by name, not payments/orders).
create or replace function validate_platform_payment_refund()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_original_direction text;
  v_original_order_id uuid;
  v_charged integer;
  v_refunded integer;
begin
  if new.direction <> 'refund' then
    return new;
  end if;

  if new.original_payment_id is null then
    raise exception 'refund payments must reference original_payment_id';
  end if;

  select direction, platform_order_id into v_original_direction, v_original_order_id
  from platform_payments
  where id = new.original_payment_id;

  if v_original_direction is distinct from 'charge' then
    raise exception 'a refund must reference a charge payment, not another refund or a missing payment';
  end if;

  if v_original_order_id is distinct from new.platform_order_id then
    raise exception 'a refund must be recorded against the same order as the payment it refunds';
  end if;

  perform 1 from platform_orders where id = new.platform_order_id for update;

  select coalesce(sum(amount), 0) into v_charged
  from platform_payments
  where platform_order_id = new.platform_order_id and direction = 'charge' and status = 'succeeded';

  select coalesce(sum(amount), 0) into v_refunded
  from platform_payments
  where platform_order_id = new.platform_order_id and direction = 'refund';

  if v_refunded + new.amount > v_charged then
    raise exception 'refund amount % would exceed the order''s remaining refundable balance (charged %, already refunded %)',
      new.amount, v_charged, v_refunded;
  end if;

  return new;
end;
$$;

create trigger validate_platform_payment_refund_trg
  before insert on platform_payments
  for each row execute function validate_platform_payment_refund();

-- Order status derivation, mirroring recompute_order_status exactly.
create or replace function recompute_platform_order_status()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_charged integer;
  v_refunded integer;
  v_total integer;
  v_new_status text;
begin
  select coalesce(sum(amount), 0) into v_charged
  from platform_payments
  where platform_order_id = new.platform_order_id and direction = 'charge' and status = 'succeeded';

  select coalesce(sum(amount), 0) into v_refunded
  from platform_payments
  where platform_order_id = new.platform_order_id and direction = 'refund';

  select total_amount into v_total from platform_orders where id = new.platform_order_id;

  if v_refunded > 0 and v_refunded >= v_charged then
    v_new_status := 'refunded';
  elsif v_charged >= v_total then
    v_new_status := 'paid';
  elsif v_charged > 0 then
    v_new_status := 'partial';
  else
    v_new_status := 'pending';
  end if;

  update platform_orders set status = v_new_status where id = new.platform_order_id;

  return new;
end;
$$;

create trigger recompute_platform_order_status_trg
  after insert on platform_payments
  for each row execute function recompute_platform_order_status();

-- RLS. Owner-only read (Section 4's tier distinction, Section 10) - not
-- every Admin, unlike every other table this domain owns. owner_admin_id
-- lives on gym_activation_state (Section 4), not on these tables directly,
-- so a small, reused helper avoids repeating the same join three times.
create or replace function is_platform_billing_owner(gid uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from gym_activation_state
    where gym_id = gid and owner_admin_id = auth.uid()
  );
$$;

alter table platform_subscriptions enable row level security;
alter table platform_orders enable row level security;
alter table platform_payments enable row level security;

create policy platform_subscriptions_select_owner on platform_subscriptions
  for select to authenticated
  using (is_platform_billing_owner(gym_id));

create policy platform_orders_select_owner on platform_orders
  for select to authenticated
  using (exists (
    select 1 from platform_subscriptions ps
    where ps.id = platform_orders.platform_subscription_id
      and is_platform_billing_owner(ps.gym_id)
  ));

create policy platform_payments_select_owner on platform_payments
  for select to authenticated
  using (exists (
    select 1 from platform_orders po
    join platform_subscriptions ps on ps.id = po.platform_subscription_id
    where po.id = platform_payments.platform_order_id
      and is_platform_billing_owner(ps.gym_id)
  ));

grant select on table platform_subscriptions to authenticated;
grant select on table platform_orders to authenticated;
grant select on table platform_payments to authenticated;
grant all on table platform_subscriptions to service_role;
grant all on table platform_orders to service_role;
grant all on table platform_payments to service_role;

-- Close the default-privileges auto-grant hazard proactively (the same
-- fix now applied inline for the third time this M10 series - M10.1 and
-- M10.3 found it after the fact, M10.4 applied it inline; independently
-- re-verified live after this migration runs, not assumed safe from the
-- statement alone).
revoke insert, update, delete, truncate on table platform_subscriptions from anon, authenticated;
revoke insert, update, delete, truncate on table platform_orders from anon, authenticated;
revoke insert, update, delete, truncate on table platform_payments from anon, authenticated;
revoke select, references, trigger on table platform_subscriptions from anon;
revoke select, references, trigger on table platform_orders from anon;
revoke select, references, trigger on table platform_payments from anon;
