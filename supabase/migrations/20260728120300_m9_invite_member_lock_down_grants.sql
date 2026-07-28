-- M9 Invite Member - security fix, not a behaviour change.
--
-- Verified live after 20260728120200: despite an explicit
-- `revoke execute ... from anon, authenticated` immediately following each
-- `create or replace function` in that same migration, all six new
-- functions remained fully executable by anon and authenticated
-- (has_function_privilege confirmed true for both roles on all six).
--
-- This differs from Increment 1's own lockdown, where the same revoke
-- pattern, issued in a SEPARATE, LATER migration against already-existing
-- functions, worked correctly and was independently verified. The revoke
-- statement's own syntax and function signatures were re-checked
-- statement-by-statement against each CREATE FUNCTION's own parameter list
-- and matched exactly - not a typo or signature mismatch.
--
-- Applying the exact same standalone-migration shape that already worked
-- once, to test empirically whether ordering (revoke bundled in the same
-- migration as creation, vs. a separate, later migration) is the actual
-- variable - reported precisely in the implementation report, not silently
-- assumed.

revoke execute on function m9_write_invitation(uuid, uuid, text, uuid, text, timestamptz) from anon, authenticated;
revoke execute on function m9_revoke_invitation(uuid, uuid, uuid) from anon, authenticated;
revoke execute on function m9_send_email_challenge(uuid, text, timestamptz, int, int) from anon, authenticated;
revoke execute on function m9_verify_email_challenge(uuid, text, int) from anon, authenticated;
revoke execute on function m9_final_commit_new_prospect(uuid, uuid, uuid, uuid, int) from anon, authenticated;
revoke execute on function m9_final_commit_existing_member(uuid, uuid, uuid, uuid, int) from anon, authenticated;
