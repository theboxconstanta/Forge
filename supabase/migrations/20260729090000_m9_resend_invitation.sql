-- M9 Invite Member - Resend Invitation (administrator-facing).
--
-- Distinct from the invitee-side verification-code resend
-- (email_challenge_hash / resend_count / last_resend_at, unchanged here) -
-- this is a genuinely separate concept: an admin re-sending the ORIGINAL
-- invitation link email, found missing during Product Owner acceptance
-- (the only paths that existed were create and revoke).
--
-- Token reuse is not possible by design: only token_hash (a one-way HMAC)
-- is ever persisted - the raw bearer token exists only transiently in the
-- Edge Function that generated it, then inside the sent email. "Resend"
-- therefore means: same invitation row, same id, same recipient, same
-- created_at/expires_at - but a freshly generated raw token/hash, exactly
-- mirroring the established pattern m9_send_email_challenge already uses
-- for the verification code (rotate the secret, keep everything else).
alter table gym_invitations
  add column admin_resend_count int not null default 0,
  add column last_admin_resent_at timestamptz;

comment on column gym_invitations.admin_resend_count is 'Administrator-initiated invitation-email resends. Separate from resend_count (invitee-side verification-code resends) - do not conflate.';
comment on column gym_invitations.last_admin_resent_at is 'Separate from last_resend_at (invitee-side verification-code resend) - do not conflate.';

alter table admin_audit_log drop constraint admin_audit_log_action_type_check;
alter table admin_audit_log add constraint admin_audit_log_action_type_check
  check (action_type in (
    'member_added_new', 'member_added_existing',
    'member_invited', 'member_invitation_revoked', 'member_invitation_resent',
    'member_onboarding_completed', 'member_app_activated'
  ));

-- Returns a status string rather than boolean so the Edge Function caller
-- can map each rejection to a precise, honest message instead of one
-- generic failure - mirrors the uniform-failure philosophy used elsewhere
-- in this feature (no information disclosure across gyms), while still
-- giving the CALLER'S OWN admin (already authorized for their own gym) an
-- accurate reason. gym_id is matched in the same WHERE as id, so a
-- cross-gym invitation id resolves to 'not_found', not a distinguishable
-- "exists but not yours" - no cross-gym existence disclosure.
create or replace function m9_resend_invitation(
  p_invitation_id uuid,
  p_gym_id uuid,
  p_actor_admin_id uuid,
  p_new_token_hash text
)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_inv gym_invitations%rowtype;
begin
  select * into v_inv from gym_invitations
    where id = p_invitation_id and gym_id = p_gym_id
    for update;

  if not found then return 'not_found'; end if;
  if v_inv.accepted_at is not null then return 'already_accepted'; end if;
  if v_inv.revoked_at is not null then return 'revoked'; end if;
  if v_inv.expires_at <= now() then return 'expired'; end if;

  update gym_invitations
  set token_hash = p_new_token_hash,
      admin_resend_count = admin_resend_count + 1,
      last_admin_resent_at = now()
  where id = p_invitation_id;

  perform m9_write_audit_entry(p_gym_id, p_actor_admin_id, v_inv.member_id, 'member_invitation_resent');

  return 'ok';
end;
$$;

-- Explicit named revoke, not "revoke from public" alone - this project's
-- own auto-grant-on-create default privileges finding (Increment 1,
-- rediscovered for the original six Invite Member functions) means only
-- an explicit PUBLIC revoke in the SAME migration as creation has been
-- proven to close it on the first attempt (m9_final_commit_dormant_member
-- confirmed this pattern works; the standalone-migration-after-the-fact
-- pattern did not, twice).
revoke execute on function m9_resend_invitation(uuid, uuid, uuid, text) from public, anon, authenticated;
grant execute on function m9_resend_invitation(uuid, uuid, uuid, text) to service_role;
