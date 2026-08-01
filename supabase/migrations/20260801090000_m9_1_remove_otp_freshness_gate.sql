-- M9.1 Remove Email OTP (Architecture Report, 2026-08-01).
--
-- Removes Final Commit's email_verified_at freshness gate from all three
-- identity paths. The invitation token itself (256-bit random, HMAC-hashed
-- at rest, single-use via accepted_at, time-limited, revocable, tenant-
-- scoped) already satisfies every property the OTP step was layered on top
-- of - see the architecture report for the full analysis. Nothing else in
-- these functions changes: invitation validity, waiver-currency, and
-- identity-branch logic are untouched.
--
-- The parameter list changes (p_verification_freshness_seconds removed),
-- so each function is dropped and recreated rather than CREATE OR REPLACE
-- (which would leave the old 5-arg overload behind instead of replacing it).
--
-- gym_invitations' challenge columns (email_verified_at, email_challenge_*,
-- resend_count, last_resend_at) are deliberately left in place - see the
-- architecture report's Phase 3 (Cleanup), not bundled into this migration.

drop function if exists public.m9_final_commit_new_prospect(uuid, uuid, uuid, uuid, integer);

create function public.m9_final_commit_new_prospect(p_invitation_id uuid, p_gym_id uuid, p_new_member_id uuid, p_waiver_id uuid)
 returns text
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare
  v_inv gym_invitations%rowtype;
  v_current_waiver_id uuid;
  v_membership_id uuid;
begin
  select * into v_inv from gym_invitations where id = p_invitation_id and gym_id = p_gym_id for update;
  if not found or v_inv.accepted_at is not null or v_inv.revoked_at is not null or v_inv.expires_at <= now() then
    return 'invalid_invitation';
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

  perform m9_write_audit_entry(p_gym_id, p_new_member_id, p_new_member_id, 'member_onboarding_completed');

  return 'ok';
end;
$function$;

drop function if exists public.m9_final_commit_dormant_member(uuid, uuid, uuid, uuid, integer);

create function public.m9_final_commit_dormant_member(p_invitation_id uuid, p_gym_id uuid, p_member_id uuid, p_waiver_id uuid)
 returns text
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare
  v_inv gym_invitations%rowtype;
  v_current_waiver_id uuid;
  v_membership_id uuid;
begin
  select * into v_inv from gym_invitations where id = p_invitation_id and gym_id = p_gym_id for update;
  if not found or v_inv.accepted_at is not null or v_inv.revoked_at is not null or v_inv.expires_at <= now() then
    return 'invalid_invitation';
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

  perform m9_write_audit_entry(p_gym_id, p_member_id, p_member_id, 'member_onboarding_completed');

  return 'ok';
end;
$function$;

drop function if exists public.m9_final_commit_existing_member(uuid, uuid, uuid, uuid, integer);

create function public.m9_final_commit_existing_member(p_invitation_id uuid, p_gym_id uuid, p_member_id uuid, p_waiver_id uuid)
 returns text
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
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
$function$;
