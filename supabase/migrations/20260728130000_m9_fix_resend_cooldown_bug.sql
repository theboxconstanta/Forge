-- M9 Invite Member - real defect found during production-completion live
-- testing, not before: the resend cooldown never actually triggered on
-- the FIRST resend. last_resend_at was only ever written on a call where
-- email_challenge_hash was already non-null (i.e. an actual resend) - so
-- the cooldown check (`last_resend_at is not null and ...`) had nothing
-- to compare against on exactly the one call it most needed to gate,
-- since the initial send never set it. Verified live: a 9999-second
-- cooldown parameter was silently ignored on the first resend attempt.
--
-- Fix: last_resend_at is now set on every send, including the first -
-- the cooldown *check* still only applies when this is a resend
-- (email_challenge_hash already set going in), unchanged from before, but
-- now has a real timestamp to compare against starting from the second
-- call onward, closing the gap.
create or replace function m9_send_email_challenge(
  p_invitation_id uuid,
  p_challenge_hash text,
  p_challenge_expires_at timestamptz,
  p_resend_cooldown_seconds int,
  p_max_resends int
)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_inv gym_invitations%rowtype;
begin
  select * into v_inv from gym_invitations where id = p_invitation_id for update;

  if not found or v_inv.accepted_at is not null or v_inv.revoked_at is not null or v_inv.expires_at <= now() then
    return 'invalid_invitation';
  end if;

  if v_inv.email_challenge_hash is not null then
    if v_inv.last_resend_at is not null and v_inv.last_resend_at + make_interval(secs => p_resend_cooldown_seconds) > now() then
      return 'cooldown';
    end if;
    if v_inv.resend_count >= p_max_resends then
      return 'resend_cap';
    end if;
  end if;

  update gym_invitations
  set email_challenge_hash = p_challenge_hash,
      email_challenge_expires_at = p_challenge_expires_at,
      email_challenge_attempts = 0,
      resend_count = case when v_inv.email_challenge_hash is not null then resend_count + 1 else resend_count end,
      last_resend_at = now()
  where id = p_invitation_id;

  return 'ok';
end;
$$;

revoke execute on function m9_send_email_challenge(uuid, text, timestamptz, int, int) from public, anon, authenticated;
grant execute on function m9_send_email_challenge(uuid, text, timestamptz, int, int) to service_role;
