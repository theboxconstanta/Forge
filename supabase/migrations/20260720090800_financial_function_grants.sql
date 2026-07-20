-- Financial Domain Phase 0, migration 8/8: close a gap found by the
-- required security-advisor scan (Phase 0's own acceptance criterion), not
-- a new architectural change.
--
-- validate_payment_refund() and recompute_order_status() (migration 5/7)
-- are SECURITY DEFINER trigger functions, callable only as triggers, never
-- meant to be invoked directly. `create or replace function` grants
-- EXECUTE to PUBLIC by default, which PostgREST exposes as
-- /rest/v1/rpc/<name> to anon and authenticated. Postgres itself refuses to
-- call a `returns trigger` function outside trigger context ("trigger
-- functions can only be called as triggers"), so this was not actually
-- exploitable - but it's needless RPC surface, inconsistent with the "no
-- direct client writes" posture already established for orders/payments
-- (migrations 6/7 and 7/7), and free to close.
--
-- Revoking EXECUTE does not affect the trigger mechanism itself - trigger
-- firing does not require the invoking session to hold EXECUTE on the
-- trigger function.

revoke execute on function validate_payment_refund() from public, anon, authenticated;
revoke execute on function recompute_order_status() from public, anon, authenticated;

-- Rollback:
-- grant execute on function validate_payment_refund() to public;
-- grant execute on function recompute_order_status() to public;
