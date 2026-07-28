-- M9 Invite Member - third Final Commit path, found necessary during
-- implementation, not anticipated in the approved design: a dormant
-- existing Member (profiles row exists, gym_id is null - a Member whose
-- last Gym Membership ended, e.g. via Remove Member) invited to join a
-- Gym again. Not "new prospect" (auth.users already exists - createUser()
-- would fail on the unique email constraint) and not "existing manual
-- Member" (m9_final_commit_existing_member requires an ALREADY-active
-- Membership, which a dormant Member does not have). Combines
-- m9_resolve_dormant_member_enrollment's own conditional-update pattern
-- (Increment 1) with the waiver/invitation/audit write, since both are
-- pure SQL - no Auth Admin API call is needed for this path either,
-- identity already exists.
create or replace function m9_final_commit_dormant_member(
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

  -- Conditional on gym_id still being null - same race guard class as
  -- Increment 1's m9_resolve_dormant_member_enrollment. Firing this update
  -- triggers member_domain_sync_on_profile_gym_change() (unmodified,
  -- frozen), which creates the active Membership and evaluates Gym
  -- Transfer Recognition automatically.
  update profiles set gym_id = p_gym_id where id = p_member_id and gym_id is null;
  if not found then
    return 'membership_race_lost';
  end if;

  select id into v_membership_id from memberships
    where member_id = p_member_id and gym_id = p_gym_id and status = 'active';
  if v_membership_id is null then
    return 'membership_missing';
  end if;

  insert into member_waiver_acceptances (membership_id, waiver_id) values (v_membership_id, p_waiver_id);
  update gym_invitations set accepted_at = now() where id = p_invitation_id;

  -- Same action type as the new-prospect path - conceptually the same
  -- fact ("a person completed identity-verified onboarding"), regardless
  -- of whether their auth.users row was brand new or pre-existing-but-
  -- dormant. member_app_activated remains reserved for the Increment 1
  -- manually-added-Member case specifically.
  perform m9_write_audit_entry(p_gym_id, p_member_id, p_member_id, 'member_onboarding_completed');

  return 'ok';
end;
$$;

revoke execute on function m9_final_commit_dormant_member(uuid, uuid, uuid, uuid, int) from public, anon, authenticated;
grant execute on function m9_final_commit_dormant_member(uuid, uuid, uuid, uuid, int) to service_role;
