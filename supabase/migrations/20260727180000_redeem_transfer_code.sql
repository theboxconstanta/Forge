-- M7.3 Step 10 - Gym Transfer: redeem_transfer_code() RPC.
--
-- Per M7.2 Technical Architecture Section 5 (Fallback destination-side
-- redemption action): validates a presented Transfer Code, performs the
-- same tenancy-signal write the ordinary join already performs, marks
-- the code used - all inside one transaction, for the same reason
-- end_membership_as_transfer (Step 2) needed one: two separate
-- PostgREST calls (mark used, then update profiles) would be two
-- separate transactions, breaking the "commit or fail together, never
-- partially" requirement (M7.3 Task 4.1).
--
-- Validation is a single lookup: status = 'active' and not
-- transfer_code_expired(issued_at) (Step 8's shared helper, reused
-- unmodified) - a nonexistent code, an already-used/revoked/superseded
-- one, and an expired one all fail this same lookup identically, so
-- every failure raises the exact same 'invalid transfer code' message
-- (M7.2 Section 9/15's uniform-rejection principle - no detail
-- distinguishing why).
--
-- Membership creation is NOT duplicated here: writing profiles.gym_id
-- fires the existing, unmodified member_domain_sync_on_profile_gym_change()
-- trigger (Steps 1 and 7), which creates the Membership exactly as
-- join_gym_with_code's own write already does. The existing
-- prevent_profiles_gym_id_change() guard (unmodified) independently
-- guarantees this write cannot succeed unless the resolved Member is
-- genuinely gym-less at the moment of the attempt - not duplicated here
-- either. An unhandled exception at any point (invalid code, or the
-- profiles write rejected by that guard) rolls back the entire
-- function's effects, including the code's own 'used' write - the code
-- remains 'active' and redeemable again if the attempt did not
-- genuinely succeed.
--
-- Concurrency: two simultaneous calls with the same code both resolve
-- the same transfer_codes.id via the initial lookup, but the subsequent
-- `update ... where status = 'active'` is a targeted single-row update -
-- ordinary Postgres row-level locking serializes the two, the second
-- transaction's UPDATE re-evaluates against the now-committed row and
-- finds zero rows, raising the same uniform exception. No partial
-- unique index is needed here (unlike Step 6's exclusivity index),
-- because this targets one already-identified row rather than
-- inserting a new one.
--
-- Authorization: gated to service_role only, mirroring
-- end_membership_as_transfer. The calling Edge Function
-- (redeem-transfer-code) is the sole authorization boundary - it
-- verifies the caller is a genuine administrator and resolves their own
-- gym_id (p_gym_id) before this RPC is ever invoked; the RPC does not
-- re-verify this, mirroring end_membership_as_transfer's own precedent.
--
-- Rollback: drop function redeem_transfer_code(text, uuid).

create or replace function redeem_transfer_code(p_code text, p_gym_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_transfer_code_id uuid;
  v_member_id uuid;
begin
  if (auth.jwt() ->> 'role') is distinct from 'service_role' then
    raise exception 'not authorized';
  end if;

  select id, member_id into v_transfer_code_id, v_member_id
  from transfer_codes
  where upper(code) = upper(p_code)
    and status = 'active'
    and not transfer_code_expired(issued_at);

  if v_transfer_code_id is null then
    raise exception 'invalid transfer code';
  end if;

  update transfer_codes
  set status = 'used', resolved_at = now()
  where id = v_transfer_code_id and status = 'active';

  if not found then
    raise exception 'invalid transfer code';
  end if;

  update profiles set gym_id = p_gym_id where id = v_member_id;
end;
$$;

revoke all on function redeem_transfer_code(text, uuid) from public, anon, authenticated;
