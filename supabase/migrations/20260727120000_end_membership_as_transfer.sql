-- M7.3 Step 2 - Gym Transfer: end_membership_as_transfer() RPC.
--
-- admin-transfer-member (the new sibling to admin-remove-member, M7.3
-- Task 1.2) needs to signal 'transferred' to
-- member_domain_sync_on_profile_gym_change() (M7.2 Section 5, Section 9;
-- implemented in 20260727110000_member_domain_transfer_reason_branch.sql)
-- via a transaction-local setting read with current_setting(..., true).
-- That setting is only visible within the same Postgres transaction it
-- was set in with set_config(..., true) - and two separate PostgREST
-- requests (e.g. a supabase-js .rpc() call followed by a separate
-- .from('profiles').update(...) call, the shape admin-remove-member
-- itself uses for its own direct write) are two separate transactions,
-- so the signal would not survive from one to the other. This RPC sets
-- the signal and performs the profiles.gym_id = null write inside one
-- function body - one transaction - so the AFTER UPDATE trigger it fires
-- sees the same signal that was just set. M7.2 Section 11 leaves the
-- exact RPC/Edge Function shape to implementation, provided the
-- authorization and reason-signaling responsibilities are met - this is
-- that implementation choice, not a new architectural decision.
--
-- Authorization: none re-checked here beyond the service_role gate
-- below. The caller/target/admin-target authorization condition
-- (identical to Remove Member's own, per M7.2 Section 12) is already
-- enforced by admin-transfer-member's own authorizeMemberRemoval check
-- before this RPC is ever called - exactly mirroring admin-remove-member's
-- own final direct profiles update, which also carries no further
-- authorization check at that point. Restricted to service_role only, so
-- it cannot be called directly by an authenticated client bypassing that
-- check.
--
-- Rollback: drop function end_membership_as_transfer(uuid).

create or replace function end_membership_as_transfer(p_client_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if (auth.jwt() ->> 'role') is distinct from 'service_role' then
    raise exception 'not authorized';
  end if;

  perform set_config('forge.member_domain_ending_reason', 'transferred', true);

  update profiles set gym_id = null where id = p_client_id;
end;
$$;

revoke all on function end_membership_as_transfer(uuid) from public, anon, authenticated;
