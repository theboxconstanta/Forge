-- Financial Domain Phase 0, migration 6/7: RLS.
-- Enable row level security and add SELECT-only policies. No INSERT/
-- UPDATE/DELETE policy is added for any role on either table - by design
-- (ADR-002: "No direct client INSERT policy on orders/payments at all -
-- every write goes through RPCs"; ADR-007: "No UPDATE policy on payments
-- for any role - makes append-only a database-enforced guarantee, not just
-- convention"). RPCs (Phase 1) are SECURITY DEFINER and bypass RLS
-- entirely, which is how writes happen at all despite this.
--
-- Unlike subscriptions (which has no real identity FK and must join
-- through bookings/profiles on member_email - see
-- subscriptions_select_own_or_admin in
-- 20260714130000_multitenant_rls_rewrite.sql), orders.client_id is a
-- direct FK to profiles.id, so the member-visibility policy here does not
-- need that join workaround.
--
-- Reviewed against the currently open, unfixed subscriptions cross-tenant
-- RLS gap (docs/PROJECT_STATE.md) before writing this - these policies do
-- not reuse the join pattern implicated there.

alter table orders enable row level security;
alter table payments enable row level security;

create policy orders_select_own_or_admin on orders
  for select
  using (
    is_admin(gym_id)
    or (client_id = auth.uid() and gym_id = my_gym_id())
  );

create policy payments_select_own_or_admin on payments
  for select
  using (
    is_admin(gym_id)
    or (
      gym_id = my_gym_id()
      and exists (
        select 1 from orders o
        where o.id = payments.order_id and o.client_id = auth.uid()
      )
    )
  );

-- Rollback:
-- drop policy if exists orders_select_own_or_admin on orders;
-- drop policy if exists payments_select_own_or_admin on payments;
-- alter table orders disable row level security;
-- alter table payments disable row level security;
