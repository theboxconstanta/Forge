-- M9.1 Remove Email OTP - security fix, not a behaviour change.
--
-- Same class of bug documented in 20260728120300_m9_invite_member_lock_down_grants.sql:
-- dropping and recreating these SECURITY DEFINER functions with a new
-- parameter list (previous migration) picked up ALTER DEFAULT PRIVILEGES'
-- auto-grant again - live-verified immediately after that migration that
-- anon and authenticated both had EXECUTE on all three functions. A
-- standalone, later migration is what worked the first time this happened;
-- applying the identical shape again rather than trusting a bundled revoke.

revoke execute on function m9_final_commit_new_prospect(uuid, uuid, uuid, uuid) from anon, authenticated, public;
revoke execute on function m9_final_commit_dormant_member(uuid, uuid, uuid, uuid) from anon, authenticated, public;
revoke execute on function m9_final_commit_existing_member(uuid, uuid, uuid, uuid) from anon, authenticated, public;
