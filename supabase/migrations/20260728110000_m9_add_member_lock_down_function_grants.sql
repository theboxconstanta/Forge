-- M9 Increment 1 - security fix, not a behaviour change.
--
-- Verified live (pg_default_acl) that this project has ALTER DEFAULT
-- PRIVILEGES configured on the public schema granting EXECUTE on every
-- newly created function to anon, authenticated, AND service_role
-- automatically, from two grantors (postgres, supabase_admin). The
-- `revoke execute ... from public` statements in
-- 20260728090100_m9_add_member_functions.sql and
-- 20260728100000_m9_add_member_verify_and_audit.sql only revoke the
-- PUBLIC pseudo-role's own privilege bit - they do not touch these
-- separate, explicit, named-role grants applied automatically at object
-- creation time. As a result, all four M9 add-member functions have been
-- directly callable via PostgREST .rpc() by any anon or authenticated
-- client since the moment each was created, completely bypassing
-- admin-add-member's own caller-authorization check (the entire reason
-- these are narrow, single-purpose, "callable only from within the
-- already-authorized Edge Function" functions in the first place).
--
-- Fix: revoke EXECUTE from the actual named roles, not just PUBLIC. This
-- changes no behaviour of any legitimate caller - admin-add-member itself
-- authenticates as service_role, which keeps EXECUTE.

revoke execute on function m9_write_audit_entry(uuid, uuid, uuid, text) from anon, authenticated;
revoke execute on function m9_resolve_dormant_member_enrollment(uuid, uuid, uuid) from anon, authenticated;
revoke execute on function m9_delete_membership_for_compensation(uuid, uuid) from anon, authenticated;
revoke execute on function m9_verify_and_record_new_member(uuid, uuid, uuid) from anon, authenticated;
