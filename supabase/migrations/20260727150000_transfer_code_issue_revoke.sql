-- M7.3 Step 6 - Gym Transfer: Transfer Code issuance and revocation RPCs.
--
-- Per M7.2 Technical Architecture Section 5 (Transfer Code
-- responsibilities: "enforce exclusivity - exactly one Transfer Code
-- SHALL be Active per Transfer at any time... support explicit
-- revocation") and Section 12 (authorization: an administrator of the
-- Transferred Membership's own (origin) gym).
--
-- Exclusivity under concurrency: two simultaneous issuance calls for the
-- same Membership would each observe "no active code yet" under normal
-- MVCC visibility and both attempt to insert one - application logic
-- alone (supersede-then-insert, even inside one transaction each) cannot
-- prevent this, since the two transactions never see each other's
-- uncommitted work. A partial unique index is the standard mechanism for
-- this exact invariant: it is the implementation of Section 5's
-- exclusivity responsibility (also Step 6's own stated objective,
-- "Exclusivity-enforcing issuance"), not a new business rule, entity, or
-- state machine change - Section 9's state machine (Active -> Used |
-- Revoked | Superseded) is unchanged, this only guarantees at most one
-- row is ever in the Active state for a given Membership at once. Under
-- a genuine concurrent conflict, the second transaction's INSERT waits
-- on the first's uncommitted row and then fails with unique_violation
-- once the first commits - an acceptable, correct failure mode: the
-- second caller's request did not succeed, but the invariant (exactly
-- one Active code) holds regardless.
create unique index transfer_codes_one_active_per_membership_idx
  on transfer_codes (membership_id)
  where status = 'active';

-- Issuance. Precondition, per M7.3 Task 3.2: only a Membership already
-- 'transferred' may have a code issued for it - enforced as an explicit
-- precondition check that raises, never a silent no-op. The membership
-- lookup itself is scoped by is_admin(gym_id) directly in the WHERE
-- clause (not a separate authorization check after an unscoped lookup),
-- so a non-existent membership_id and one belonging to another gym
-- produce the exact same "not found" response - preserving tenant
-- isolation the same way authorizeMemberRemoval already does for Remove
-- Member (same response for "doesn't exist" and "exists at another
-- gym"). Supersession of any existing Active code (replacement, per
-- Business Rule 8/9) happens via a plain UPDATE ahead of the INSERT,
-- inside this same function's single transaction.
create or replace function issue_transfer_code(p_membership_id uuid)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_gym_id uuid;
  v_member_id uuid;
  v_status text;
  v_code text;
begin
  select gym_id, member_id, status into v_gym_id, v_member_id, v_status
  from memberships
  where id = p_membership_id and is_admin(gym_id);

  if v_gym_id is null then
    raise exception 'membership not found';
  end if;

  if v_status <> 'transferred' then
    raise exception 'membership is not transferred';
  end if;

  update transfer_codes
  set status = 'superseded', resolved_at = now()
  where membership_id = p_membership_id and status = 'active';

  v_code := upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 8));

  insert into transfer_codes (gym_id, membership_id, member_id, code, issued_by)
  values (v_gym_id, p_membership_id, v_member_id, v_code, auth.uid());

  return v_code;
end;
$$;

-- Revocation. Scoped and gated in a single UPDATE - the same is_admin(gym_id)
-- OR "not active" OR "does not exist" all collapse to the same generic
-- rejection ("transfer code not found"), so an admin cannot distinguish
-- why a revocation failed, matching the uniform-rejection principle
-- already established for Transfer Code actions (M7.2 Section 9, Section 15).
create or replace function revoke_transfer_code(p_transfer_code_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  update transfer_codes
  set status = 'revoked', resolved_at = now()
  where id = p_transfer_code_id and status = 'active' and is_admin(gym_id);

  if not found then
    raise exception 'transfer code not found';
  end if;
end;
$$;

-- Rollback: drop function revoke_transfer_code(uuid); drop function
-- issue_transfer_code(uuid); drop index transfer_codes_one_active_per_membership_idx.
