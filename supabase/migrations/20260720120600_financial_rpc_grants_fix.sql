-- Phase 4, follow-up fix: the CREATE OR REPLACE statements in migrations
-- 20260720120200-120400 omitted the revoke/grant block every prior RPC
-- migration in this domain included. Because a changed parameter list
-- creates a new catalog object (see 20260720120500's fix), these three
-- functions received Postgres's default privilege set for a newly created
-- function - EXECUTE granted to PUBLIC (which includes anon) - rather than
-- the established admin-RPC posture of authenticated-only. Found
-- immediately after applying, before any testing, by checking live grants
-- rather than assuming the migrations were complete. Same category of gap
-- as Phase 0's migration 8 (financial_function_grants), same fix.

revoke all on function refund_payment(uuid, numeric, text, text, text, text) from public, anon;
grant execute on function refund_payment(uuid, numeric, text, text, text, text) to authenticated;

revoke all on function create_subscription(text, uuid, date, date, numeric, text, text) from public, anon;
grant execute on function create_subscription(text, uuid, date, date, numeric, text, text) to authenticated;

revoke all on function activate_queued_subscription(uuid, date, text) from public, anon;
grant execute on function activate_queued_subscription(uuid, date, text) to authenticated;

-- Rollback:
-- grant execute on function refund_payment(uuid, numeric, text, text, text, text) to public;
-- grant execute on function create_subscription(text, uuid, date, date, numeric, text, text) to public;
-- grant execute on function activate_queued_subscription(uuid, date, text) to public;
