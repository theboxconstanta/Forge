-- Financial Domain Phase 0, migration 1/7: `orders` table (ADR-001, ADR-003).
-- Additive only - no existing table is touched, no application code reads
-- or writes this table yet. See
-- docs/2026-07-20_Financial_Domain_Architecture_Working_Session.md.
--
-- subscription_id is a plain FK (ADR-003's revised position, not a
-- purchasable_type/purchasable_id discriminator) because Forge sells
-- exactly one purchasable thing today; generalize only when a second
-- purchasable domain is actually being built (ADR-009).
--
-- status is NOT written directly by application code or RPCs - it is
-- recomputed by a trigger from the sum of this order's payments (migration
-- 5/7, per the Section 9 amendment). Vocabulary here (pending/partial/paid/
-- refunded/cancelled) is an ASSUMPTION, not specified verbatim by any ADR -
-- flagged for confirmation before this migration is applied.
--
-- total_amount uses unconstrained `numeric`, matching the live money type
-- verified on subscription_plans.price (there is no table literally named
-- `plans` - subscription_plans is the live Plan entity), which is also
-- `numeric` with no fixed precision/scale.

create table orders (
  id uuid primary key default gen_random_uuid(),
  gym_id uuid not null references gyms(id),
  client_id uuid not null references profiles(id),
  subscription_id uuid not null references subscriptions(id),
  total_amount numeric not null check (total_amount >= 0),
  currency text not null default 'RON',
  status text not null default 'pending'
    check (status in ('pending', 'partial', 'paid', 'refunded', 'cancelled')),
  created_at timestamptz not null default now(),
  created_by uuid references profiles(id)
);

comment on table orders is 'Ledger entry header for a purchase (ADR-001/002/003). Never hard-deleted (ADR-007) - only transitions via status.';
comment on column orders.total_amount is 'Tax-inclusivity convention undocumented upstream (Finding 6) - treat as tax-inclusive until ADR-010''s deferred tax-engine decision formalizes this.';
comment on column orders.status is 'Derived, not written directly by application code - see the recompute trigger in migration 5/7 and the write-layer posture in migration 7/7 (grants).';

-- Rollback: drop table orders;
