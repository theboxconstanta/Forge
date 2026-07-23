-- Forge Admin Web M13.1 (Safe Plan Deletion): subscription_plans had no
-- DELETE RLS policy at all, so an admin could not attempt to delete a
-- plan (a client-side delete silently affects 0 rows under RLS, with no
-- error). This adds the missing policy, mirroring the exact shape already
-- used for insert/update (is_admin(gym_id)).
--
-- This is deliberately the ONLY schema change for this milestone. The
-- actual safety rule ("a plan that has ever been used anywhere in Forge
-- Core can never be permanently deleted") is not enforced by this policy
-- - it is already enforced, unconditionally and unbypassably, by the
-- pre-existing subscriptions_plan_id_fkey foreign key, whose ON DELETE
-- action is NO ACTION (Postgres's default, confirmed live via
-- pg_constraint - never explicitly set otherwise). That FK fires at the
-- database engine level regardless of caller, role, or RLS state: if any
-- row in `subscriptions` references a plan (active, expired, ended,
-- queued - any status), Postgres itself rejects the DELETE with a
-- foreign_key_violation (23503), full stop. No trigger or additional
-- check constraint is needed to enforce the rule itself.
--
-- Reference topology, confirmed exhaustively before writing this
-- migration (grepped every column in every public table for anything
-- plan-shaped, not just the known FK): subscription_plans has exactly
-- one inbound reference in the entire schema - subscriptions.plan_id.
-- orders references subscriptions (orders.subscription_id), and payments
-- references orders (payments.order_id) - neither references
-- subscription_plans directly. Because an order can only ever exist for
-- a subscription, and a subscription can only ever exist by referencing
-- a plan_id, "zero subscriptions reference this plan" already implies
-- "zero orders and zero payments relate to this plan" - checking
-- subscriptions alone is authoritative for "has this plan ever been used
-- anywhere," not an assumption.

create policy subscription_plans_admin_delete on subscription_plans
  for delete
  using (is_admin(gym_id));
