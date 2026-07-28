-- M9 Invite Member - second, precise security fix.
--
-- Root cause found by inspecting pg_proc.proacl directly (not just
-- has_function_privilege): these six functions' ACL is
-- {=X/postgres, postgres=X/postgres, service_role=X/postgres} - the bare
-- `=X/postgres` entry is a grant to PUBLIC, not to anon/authenticated by
-- name. This is a DIFFERENT grant source than Increment 1's functions hit
-- (those had explicit anon=X/.. and authenticated=X/.. entries from a
-- defaclrole=postgres default-ACL rule; these six have neither of those
-- named entries at all - they picked up Postgres's own standard, built-in
-- implicit "every new function grants EXECUTE to PUBLIC" default instead,
-- suggesting this migration batch was executed under a different creating
-- context than Increment 1's). REVOKE ... FROM anon, authenticated cannot
-- remove a PUBLIC grant - PUBLIC and per-role grants are independent,
-- additive sources, and has_function_privilege returns true for any role
-- if PUBLIC alone grants it, regardless of that role's own ACL entry.
--
-- Confirmed empirically that Increment 1's own functions were NOT
-- similarly affected (re-checked live, unchanged) - this is not a
-- systemic reversion, it is specific to how these six functions were
-- created.

revoke execute on function m9_write_invitation(uuid, uuid, text, uuid, text, timestamptz) from public;
revoke execute on function m9_revoke_invitation(uuid, uuid, uuid) from public;
revoke execute on function m9_send_email_challenge(uuid, text, timestamptz, int, int) from public;
revoke execute on function m9_verify_email_challenge(uuid, text, int) from public;
revoke execute on function m9_final_commit_new_prospect(uuid, uuid, uuid, uuid, int) from public;
revoke execute on function m9_final_commit_existing_member(uuid, uuid, uuid, uuid, int) from public;

grant execute on function m9_write_invitation(uuid, uuid, text, uuid, text, timestamptz) to service_role;
grant execute on function m9_revoke_invitation(uuid, uuid, uuid) to service_role;
grant execute on function m9_send_email_challenge(uuid, text, timestamptz, int, int) to service_role;
grant execute on function m9_verify_email_challenge(uuid, text, int) to service_role;
grant execute on function m9_final_commit_new_prospect(uuid, uuid, uuid, uuid, int) to service_role;
grant execute on function m9_final_commit_existing_member(uuid, uuid, uuid, uuid, int) to service_role;
