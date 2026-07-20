-- Financial Domain Phase 0, migration 7/7: grants.
-- Belt-and-suspenders alongside migration 6/7's RLS: authenticated gets
-- SELECT only, at the grant layer itself, not just via policy. No INSERT/
-- UPDATE/DELETE grant is issued to authenticated or anon on either table -
-- every write happens through the SECURITY DEFINER RPCs planned for Phase
-- 1, which run as the function owner and are unaffected by these grants.

revoke all on orders from public, authenticated, anon;
revoke all on payments from public, authenticated, anon;

grant select on orders to authenticated;
grant select on payments to authenticated;

-- Rollback:
-- revoke select on orders from authenticated;
-- revoke select on payments from authenticated;
