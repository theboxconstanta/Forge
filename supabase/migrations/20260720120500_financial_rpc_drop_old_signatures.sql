-- Phase 4, follow-up fix: CREATE OR REPLACE FUNCTION does not replace a
-- function whose parameter signature changed arity - Postgres treats a
-- different parameter list as a new overload, not a replacement. Adding
-- p_method (and, for refund_payment, p_provider/p_provider_reference) via
-- CREATE OR REPLACE in migrations 20260720120200-120400 left the old,
-- pre-Phase-4 signatures of refund_payment, create_subscription, and
-- activate_queued_subscription still live alongside the new ones - found
-- immediately after applying, before any testing, by checking live
-- signatures rather than assuming the push succeeded as intended.
--
-- Both overloads being callable is a real correctness risk, not cosmetic:
-- anything still calling the old arity would silently run the old,
-- method-less behavior this phase exists to close. Dropping the old
-- signatures explicitly so exactly one version of each function exists.

drop function if exists refund_payment(uuid, numeric, text);
drop function if exists create_subscription(text, uuid, date, date, numeric, text);
drop function if exists activate_queued_subscription(uuid, date);

-- Rollback: re-apply the corresponding pre-Phase-4 migration
-- (20260720100300 / 20260720110700 / 20260720111000) to recreate the old
-- signature, then this migration's DROPs would need to target the new
-- 7/6-arg signatures instead.
