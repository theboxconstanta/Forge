-- M10.3 Admin Invitation - close a real, live PUBLIC EXECUTE exposure.
--
-- Found during production verification, not assumed safe: send_admin_
-- invitation/revoke_admin_invitation/accept_admin_invitation each still
-- had EXECUTE granted to PUBLIC (the implicit "every role" pseudo-role,
-- which anon and authenticated both inherit from) despite the prior
-- migration's own `revoke execute ... from anon, authenticated` -
-- revoking from those two roles specifically does nothing to a grant that
-- actually lives on PUBLIC; anon/authenticated still had EXECUTE via that
-- inherited path regardless. Checked directly against
-- information_schema.role_routine_grants, not assumed correct from the
-- migration's own revoke statement having run.
--
-- Verified narrower in scope than first feared: m9_write_invitation,
-- m9_revoke_invitation, and bootstrap_owner_gym (M10.1) were checked
-- immediately after finding this and confirmed clean - no PUBLIC grant on
-- any of them. This is specific to the three functions created in this
-- migration, not a project-wide, already-live exposure on every
-- SECURITY DEFINER function - the exact mechanism for why these three
-- specifically picked up a PUBLIC grant while bootstrap_owner_gym (an
-- otherwise identical create-then-revoke pattern, one migration earlier)
-- did not is not fully understood and is named as a remaining risk, not
-- glossed over.

revoke execute on function send_admin_invitation(uuid, uuid, text, text, timestamptz) from public;
revoke execute on function revoke_admin_invitation(uuid, uuid, uuid) from public;
revoke execute on function accept_admin_invitation(uuid, uuid, text) from public;
