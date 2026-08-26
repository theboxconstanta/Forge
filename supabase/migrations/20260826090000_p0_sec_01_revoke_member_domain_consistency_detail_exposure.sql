-- P0-SEC-01 - Supabase Security Advisor CRITICAL finding: auth_users_exposed
--
-- Root cause: member_domain_consistency_detail (20260726150000) was
-- documented, at creation, as "Not granted to anon/authenticated directly -
-- reached only through member_domain_consistency_report()/_summary()/
-- reconcile_member_domain(), which enforce is_platform_admin()". That intent
-- was never actually enforced with a REVOKE - this project's public-schema
-- default ACL (`ALTER DEFAULT PRIVILEGES ... GRANT ALL ON TABLES TO anon,
-- authenticated, service_role`, confirmed live via pg_default_acl) applies
-- to every new relation in `public`, tables AND views alike, so the view
-- silently inherited full anon/authenticated SELECT the moment it was
-- created. Live-reproduced (SET LOCAL ROLE anon, rolled back, count-only):
-- 30 rows visible to a fully anonymous caller, spanning cross-gym/
-- cross-tenant profile_id/member_id/membership_id UUIDs and free-text
-- `detail` messages (the member_duplicate_email branch embeds a real email
-- address when triggered - no such row exists live right now, but the path
-- is real). The view's one auth.users reference (an existence-only check
-- for orphaned members) is what the Security Advisor is flagging - it is a
-- legitimate check for a SECURITY DEFINER, admin-gated view, but must never
-- have been directly queryable by anon/authenticated.
--
-- Fix (Option C - restrict grants, per the view's own original intent):
-- revoke anon/authenticated access to the view entirely. This has zero
-- effect on the three intended consumers - member_domain_consistency_report/
-- _summary/reconcile_member_domain are all SECURITY DEFINER, owned by
-- postgres, so they read the view under postgres's own privileges
-- regardless of what's granted to the calling role. Also sets
-- security_invoker = true as defense in depth: postgres/service_role both
-- bypass RLS already (BYPASSRLS), so this changes nothing for the view's
-- only legitimate access path today, but ensures that if this view is ever
-- re-granted to a non-bypassing role in the future, the underlying tables'
-- RLS is respected rather than silently bypassed a second time.

revoke all on member_domain_consistency_detail from anon, authenticated;

alter view member_domain_consistency_detail set (security_invoker = true);
