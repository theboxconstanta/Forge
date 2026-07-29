-- Drops the temporary grant-verification function introduced in the
-- immediately preceding migration, confirmed live: anon=false,
-- authenticated=false, service_role=true on m9_resend_invitation.
drop function if exists __p0_check_grants();
