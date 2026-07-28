-- M9 Increment 1 - Manual Member Enrollment: narrow write functions
--
-- Three SECURITY DEFINER functions, callable only by service_role (never
-- directly by an authenticated client - the caller-is-admin-of-this-gym
-- check happens exactly once, in the admin-add-member Edge Function, before
-- any of these run; duplicating that check here would be a second,
-- divergence-prone authorization point, not a safety improvement).
--
-- Together they implement M9_PRODUCT_SPECIFICATION.md Section 4.1 Rules 1-5
-- for the two branches that touch the database directly:
--   - m9_resolve_dormant_member_enrollment: an existing Member with no
--     active Gym Membership anywhere (Rule 4) is resolved onto the calling
--     admin's Gym. Reuses the Member Domain's own existing
--     member_domain_sync_on_profile_gym_change() trigger (unmodified) by
--     doing nothing more than the same profiles.gym_id write every other
--     join path already performs - Gym Transfer's Recognition is evaluated
--     by that trigger automatically, not reimplemented here.
--   - m9_write_audit_entry: the one, single INSERT path onto
--     admin_audit_log for this capability.
--   - m9_delete_membership_for_compensation: used only when the
--     new-identity branch's identity creation (auth.users, via the Auth
--     Admin API - necessarily a separate call the Edge Function makes
--     itself, not representable as a SQL function) succeeds but the
--     paired audit write fails. Per the approved atomicity rule, that
--     combination is not a valid resting state and must be undone.
--
--     Verified live against the linked project before writing this
--     migration: memberships.member_id -> members.id has NO ON DELETE
--     cascade (memberships_member_id_fkey, added in
--     20260726100000_member_domain_foundation_reuse_members.sql, no ON
--     DELETE clause specified). auth.users deletion cascades to profiles
--     and members directly and independently (profiles_id_fkey,
--     members_id_fkey, both ON DELETE CASCADE) - but that cascade will
--     itself fail with a foreign-key violation if a memberships row still
--     references the members row being cascaded into, because
--     memberships_member_id_fkey has no ON DELETE behaviour of its own.
--     This function exists solely to remove that one non-cascading edge
--     before the Edge Function calls auth.admin.deleteUser() - the Auth
--     Admin API is used for the identity deletion itself (not a raw SQL
--     DELETE on auth.users) so GoTrue's own internal bookkeeping (sessions,
--     refresh tokens, identities) is cleaned up the same way it would be
--     for any other account deletion, not reasoned about manually here.

create or replace function m9_write_audit_entry(
  p_gym_id uuid,
  p_actor_admin_id uuid,
  p_member_id uuid,
  p_action_type text
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_id uuid;
begin
  insert into admin_audit_log (gym_id, actor_admin_id, member_id, action_type, outcome)
  values (p_gym_id, p_actor_admin_id, p_member_id, p_action_type, 'success')
  returning id into v_id;
  return v_id;
end;
$$;

revoke execute on function m9_write_audit_entry(uuid, uuid, uuid, text) from public;
grant execute on function m9_write_audit_entry(uuid, uuid, uuid, text) to service_role;

create or replace function m9_resolve_dormant_member_enrollment(
  p_member_id uuid,
  p_gym_id uuid,
  p_actor_admin_id uuid
)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
begin
  -- Conditional on gym_id still being null - the same guard class as
  -- Member Domain's own membership_duplicate_active reconciliation issue
  -- type already anticipates. Zero rows affected means another admin (or
  -- the member's own self-service join) won the race first; the caller is
  -- responsible for re-checking current state and responding accordingly,
  -- not this function's concern.
  update profiles set gym_id = p_gym_id where id = p_member_id and gym_id is null;
  if not found then
    return false;
  end if;

  -- member_domain_sync_on_profile_gym_change() has already fired as part of
  -- this same statement (AFTER UPDATE trigger, same transaction) - it
  -- creates the memberships row and evaluates Gym Transfer Recognition
  -- unmodified. The audit entry below is written in the same transaction as
  -- the profiles update itself, making this branch's Member-added-and-
  -- audited outcome genuinely atomic (unlike the new-identity branch, which
  -- cannot be, per the Edge Function's own compensating-delete path).
  perform m9_write_audit_entry(p_gym_id, p_actor_admin_id, p_member_id, 'member_added_existing');
  return true;
end;
$$;

revoke execute on function m9_resolve_dormant_member_enrollment(uuid, uuid, uuid) from public;
grant execute on function m9_resolve_dormant_member_enrollment(uuid, uuid, uuid) to service_role;

create or replace function m9_delete_membership_for_compensation(
  p_member_id uuid,
  p_gym_id uuid
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  delete from memberships where member_id = p_member_id and gym_id = p_gym_id;
end;
$$;

revoke execute on function m9_delete_membership_for_compensation(uuid, uuid) from public;
grant execute on function m9_delete_membership_for_compensation(uuid, uuid) to service_role;
