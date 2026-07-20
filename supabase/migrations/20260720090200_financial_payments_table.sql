-- Financial Domain Phase 0, migration 2/7: `payments` table (ADR-001/002).
-- Append-only ledger - see migration 6/7 (RLS) and migration 7/7 (grants)
-- for how "never UPDATE/DELETE, by any role" (ADR-007) is actually
-- enforced, at two independent layers rather than by convention alone.
--
-- amount is always >= 0; sign/polarity is carried by direction, matching
-- the working session's model (refunds are direction='refund' rows, never
-- negative amounts - Section 1: "Should Refunds be Payments? Yes"). Comps
-- are amount = 0, direction='charge', method='comp' (Section 1: "Should
-- comps generate Payments? Yes - a zero-amount Payment").
--
-- method is left as unconstrained text rather than a CHECK-enumerated
-- list, per explicit direction: formalize only if a real business
-- requirement emerges. Only 'comp' is named by the ADRs as a required
-- value.
--
-- amount uses unconstrained `numeric`, matching the live money type
-- verified on subscription_plans.price (numeric, no fixed precision/scale)
-- - same basis as orders.total_amount.

create table payments (
  id uuid primary key default gen_random_uuid(),
  gym_id uuid not null references gyms(id),
  order_id uuid not null references orders(id),
  amount numeric not null check (amount >= 0),
  currency text not null default 'RON',
  direction text not null check (direction in ('charge', 'refund')),
  status text not null check (status in ('pending', 'succeeded', 'failed')),
  method text,
  provider text,
  provider_reference text,
  original_payment_id uuid references payments(id),
  created_at timestamptz not null default now(),
  created_by uuid references profiles(id)
);

comment on table payments is 'Append-only financial ledger (ADR-006/007). No UPDATE/DELETE policy exists for any role (migration 6/7) and no UPDATE/DELETE grant exists for authenticated (migration 7/7) - immutability is enforced at two independent layers, not by convention.';
comment on column payments.amount is 'Always >= 0; sign/polarity is carried by direction, not by a negative amount.';
comment on column payments.original_payment_id is 'Set only when direction=refund; must reference a direction=charge row on the same order - enforced by the trigger in migration 5/7 (Finding 4), not by a CHECK constraint, since that requires a self-referential subquery.';

-- Rollback: drop table payments;
