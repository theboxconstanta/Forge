-- M9 Increment 1 - reliability refinement, not a behaviour change.
--
-- Folds the new-identity branch's post-createUser() verification
-- (profiles.gym_id actually matches the calling admin's gym - added
-- because the join-code resolution mechanism was only discovered by
-- inspecting the live handle_new_user() definition, not because it is
-- known to be unreliable) and the audit write into one function call
-- instead of two separate round trips (a SELECT, then a call to
-- m9_write_audit_entry). Reduces the number of independent network
-- boundaries between a confirmed-created identity and a confirmed-audited
-- outcome from two to one - fewer opportunities for a transient failure to
-- trigger the compensation path at all. Does not change what is verified,
-- what is written, or in what order compensation itself runs (proven
-- optimal separately - memberships before auth.users is the only order
-- that can succeed, verified live during Increment 1's own validation).
--
-- m9_write_audit_entry itself is unchanged and still used directly by
-- m9_resolve_dormant_member_enrollment (already a single call for that
-- branch - this migration only addresses the new-identity branch, the one
-- place that still had two).

create or replace function m9_verify_and_record_new_member(
  p_member_id uuid,
  p_gym_id uuid,
  p_actor_admin_id uuid
)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actual_gym_id uuid;
begin
  select gym_id into v_actual_gym_id from profiles where id = p_member_id;
  if v_actual_gym_id is distinct from p_gym_id then
    return false;
  end if;

  perform m9_write_audit_entry(p_gym_id, p_actor_admin_id, p_member_id, 'member_added_new');
  return true;
end;
$$;

revoke execute on function m9_verify_and_record_new_member(uuid, uuid, uuid) from public;
grant execute on function m9_verify_and_record_new_member(uuid, uuid, uuid) to service_role;
