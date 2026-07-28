-- M9 Invite Member & Onboarding - SQL functions.
--
-- All SECURITY DEFINER, callable only by service_role - EXECUTE explicitly
-- revoked from anon/authenticated BY NAME below, not left to "revoke from
-- public" alone, per the Increment 1 default-privileges finding (this
-- project auto-grants EXECUTE to anon/authenticated/service_role on every
-- new function; only an explicit, named revoke closes it - already proven
-- necessary once, not assumed fixed by precedent this time).
--
-- Every function here is called by an Edge Function that has already
-- performed its own authorization (caller-is-admin, or invitation-token/
-- challenge-code possession) - these functions trust their caller's
-- context, exactly like m9_resolve_dormant_member_enrollment and
-- m9_verify_and_record_new_member from Increment 1, reused as the direct
-- template for this entire file.

-- Reused, unmodified from Increment 1: m9_write_audit_entry,
-- m9_delete_membership_for_compensation. Not redefined here.

create or replace function m9_write_invitation(
  p_gym_id uuid,
  p_actor_admin_id uuid,
  p_invited_email text,
  p_member_id uuid,
  p_token_hash text,
  p_expires_at timestamptz
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_id uuid;
begin
  -- Supersede any prior outstanding invitation for this (gym, email) -
  -- Product Specification Section 4.2 Rule 2 ("at most one Invitation may
  -- be outstanding... superseded by a new Invitation"). The partial unique
  -- index on gym_invitations is the concurrency safety net for two admins
  -- racing this same supersession, not the primary mechanism.
  update gym_invitations
  set revoked_at = now()
  where gym_id = p_gym_id and lower(invited_email) = lower(p_invited_email)
    and accepted_at is null and revoked_at is null;

  insert into gym_invitations (gym_id, invited_email, invited_by, member_id, token_hash, expires_at)
  values (p_gym_id, lower(p_invited_email), p_actor_admin_id, p_member_id, p_token_hash, p_expires_at)
  returning id into v_id;

  perform m9_write_audit_entry(p_gym_id, p_actor_admin_id, p_member_id, 'member_invited');

  return v_id;
end;
$$;

revoke execute on function m9_write_invitation(uuid, uuid, text, uuid, text, timestamptz) from anon, authenticated;
grant execute on function m9_write_invitation(uuid, uuid, text, uuid, text, timestamptz) to service_role;

create or replace function m9_revoke_invitation(
  p_invitation_id uuid,
  p_gym_id uuid,
  p_actor_admin_id uuid
)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_member_id uuid;
begin
  select member_id into v_member_id from gym_invitations where id = p_invitation_id and gym_id = p_gym_id;

  update gym_invitations
  set revoked_at = now()
  where id = p_invitation_id and gym_id = p_gym_id
    and accepted_at is null and revoked_at is null;

  if not found then
    return false;
  end if;

  perform m9_write_audit_entry(p_gym_id, p_actor_admin_id, v_member_id, 'member_invitation_revoked');
  return true;
end;
$$;

revoke execute on function m9_revoke_invitation(uuid, uuid, uuid) from anon, authenticated;
grant execute on function m9_revoke_invitation(uuid, uuid, uuid) to service_role;

-- Sends the FIRST email challenge, or resends one. Cooldown/attempt-reset/
-- resend-cap only apply once a prior challenge already exists (the first
-- send is always free) - Auth-Handoff Security Report Section 6/9.
-- Returns a short status code, not a boolean, since the caller needs to
-- distinguish "cooldown" from "cap exceeded" from "invitation no longer
-- valid" to give the invitee an accurate message.
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
      last_resend_at = case when v_inv.email_challenge_hash is not null then now() else last_resend_at end
  where id = p_invitation_id;

  return 'ok';
end;
$$;

revoke execute on function m9_send_email_challenge(uuid, text, timestamptz, int, int) from anon, authenticated;
grant execute on function m9_send_email_challenge(uuid, text, timestamptz, int, int) to service_role;

-- Race-safe by construction (Auth-Handoff Security Report Section 8): the
-- conditional UPDATE's WHERE clause requires the submitted hash to match
-- the CURRENT stored hash - a concurrent resend, which replaces the
-- stored hash, automatically invalidates a stale verify attempt with no
-- separate version/nonce column needed.
create or replace function m9_verify_email_challenge(
  p_invitation_id uuid,
  p_submitted_hash text,
  p_max_attempts int
)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_matched boolean := false;
begin
  update gym_invitations
  set email_verified_at = now()
  where id = p_invitation_id
    and accepted_at is null and revoked_at is null and expires_at > now()
    and email_challenge_hash = p_submitted_hash
    and email_challenge_expires_at > now()
    and email_challenge_attempts < p_max_attempts
  returning true into v_matched;

  if v_matched then
    return true;
  end if;

  update gym_invitations
  set email_challenge_attempts = email_challenge_attempts + 1
  where id = p_invitation_id
    and accepted_at is null and revoked_at is null
    and email_challenge_hash is not null
    and email_challenge_attempts < p_max_attempts;

  return false;
end;
$$;

revoke execute on function m9_verify_email_challenge(uuid, text, int) from anon, authenticated;
grant execute on function m9_verify_email_challenge(uuid, text, int) to service_role;

-- Final Commit, new-prospect path. Called AFTER auth.admin.createUser() has
-- already succeeded (p_new_member_id is that call's own resulting id) and
-- the existing, unmodified Member Domain trigger chain has already created
-- profiles/members/memberships. This function only ever writes what it
-- alone is responsible for: waiver acceptance, invitation consumption, and
-- the Audit Log fact - never Member/Membership, which the frozen trigger
-- chain already produced. Returns a status code so the Edge Function can
-- distinguish exactly why a commit failed and choose new-prospect
-- compensation (delete membership, then delete auth.users) accordingly.
create or replace function m9_final_commit_new_prospect(
  p_invitation_id uuid,
  p_gym_id uuid,
  p_new_member_id uuid,
  p_waiver_id uuid,
  p_verification_freshness_seconds int
)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_inv gym_invitations%rowtype;
  v_current_waiver_id uuid;
  v_membership_id uuid;
begin
  select * into v_inv from gym_invitations where id = p_invitation_id and gym_id = p_gym_id for update;
  if not found or v_inv.accepted_at is not null or v_inv.revoked_at is not null or v_inv.expires_at <= now() then
    return 'invalid_invitation';
  end if;

  if v_inv.email_verified_at is null or v_inv.email_verified_at + make_interval(secs => p_verification_freshness_seconds) < now() then
    return 'email_not_verified';
  end if;

  select id into v_current_waiver_id from gym_waivers
    where gym_id = p_gym_id and effective_date <= now()
    order by effective_date desc limit 1;
  if v_current_waiver_id is distinct from p_waiver_id then
    return 'stale_waiver';
  end if;

  select id into v_membership_id from memberships
    where member_id = p_new_member_id and gym_id = p_gym_id and status = 'active';
  if v_membership_id is null then
    return 'membership_missing';
  end if;

  insert into member_waiver_acceptances (membership_id, waiver_id) values (v_membership_id, p_waiver_id);
  update gym_invitations set accepted_at = now() where id = p_invitation_id;

  -- Actor is the invitee themselves, not an administrator - the first M9
  -- action type where actor and subject are the same person. No schema
  -- change needed: actor_admin_id is a plain FK to auth.users(id), never
  -- constrained to admin rows.
  perform m9_write_audit_entry(p_gym_id, p_new_member_id, p_new_member_id, 'member_onboarding_completed');

  return 'ok';
end;
$$;

revoke execute on function m9_final_commit_new_prospect(uuid, uuid, uuid, uuid, int) from anon, authenticated;
grant execute on function m9_final_commit_new_prospect(uuid, uuid, uuid, uuid, int) to service_role;

-- Final Commit, existing manual Member path. No Member/Membership creation
-- at all - the identity, Member, and Membership already exist from
-- Increment 1. Per the Auth Spike gate's binding correction: this path
-- needs no delete-based compensation, because it never creates anything
-- new - only this function's own transaction boundary matters.
create or replace function m9_final_commit_existing_member(
  p_invitation_id uuid,
  p_gym_id uuid,
  p_member_id uuid,
  p_waiver_id uuid,
  p_verification_freshness_seconds int
)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_inv gym_invitations%rowtype;
  v_current_waiver_id uuid;
  v_membership_id uuid;
begin
  select * into v_inv from gym_invitations
    where id = p_invitation_id and gym_id = p_gym_id and member_id = p_member_id
    for update;
  if not found or v_inv.accepted_at is not null or v_inv.revoked_at is not null or v_inv.expires_at <= now() then
    return 'invalid_invitation';
  end if;

  if v_inv.email_verified_at is null or v_inv.email_verified_at + make_interval(secs => p_verification_freshness_seconds) < now() then
    return 'email_not_verified';
  end if;

  select id into v_current_waiver_id from gym_waivers
    where gym_id = p_gym_id and effective_date <= now()
    order by effective_date desc limit 1;
  if v_current_waiver_id is distinct from p_waiver_id then
    return 'stale_waiver';
  end if;

  select id into v_membership_id from memberships
    where member_id = p_member_id and gym_id = p_gym_id and status = 'active';
  if v_membership_id is null then
    return 'membership_missing';
  end if;

  insert into member_waiver_acceptances (membership_id, waiver_id) values (v_membership_id, p_waiver_id);
  update gym_invitations set accepted_at = now() where id = p_invitation_id;

  perform m9_write_audit_entry(p_gym_id, p_member_id, p_member_id, 'member_app_activated');

  return 'ok';
end;
$$;

revoke execute on function m9_final_commit_existing_member(uuid, uuid, uuid, uuid, int) from anon, authenticated;
grant execute on function m9_final_commit_existing_member(uuid, uuid, uuid, uuid, int) to service_role;
