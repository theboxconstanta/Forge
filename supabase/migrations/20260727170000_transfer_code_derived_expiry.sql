-- M7.3 Step 8 - Gym Transfer: Transfer Code Derived Expiry.
--
-- Per M7.2 Technical Architecture Section 9 ("Derived Expiry") and
-- Section 21 (Technical Decision: 72-hour default validity window, an
-- implementation parameter, not a Product Decision): Expired is never a
-- stored transition. Validity is computed at the moment a Transfer Code
-- is checked, by comparing issuance time plus the validity window
-- against the current time - a code past its window is treated as
-- invalid the instant it is examined, without ever being written as
-- such. Per M7.3 Task 3.4, this check is a single shared helper, reused
-- everywhere a Transfer Code's current validity is examined, rather than
-- duplicated per caller.
--
-- transfer_code_expired(): a pure, stateless derivation - takes the
-- code's own issued_at, touches no table, needs no authorization check
-- of its own. 72 hours matches M7.2 Section 21's stated default exactly.
create or replace function transfer_code_expired(p_issued_at timestamptz)
returns boolean
language sql
stable
as $$
  select p_issued_at + interval '72 hours' < now();
$$;

-- revoke_transfer_code (Step 6): revocation is a validity check ("is
-- this code currently active") before an action, so it now incorporates
-- Derived Expiry - a code past its window is treated the same as one
-- that is not active, uniformly rejected ("transfer code not found"),
-- exactly as an already-revoked or nonexistent code already was. Its
-- stored status is never touched by this - an expired-but-unrevoked
-- code simply remains 'active' in storage, per Section 9's own
-- guarantee that Expired is never written.
create or replace function revoke_transfer_code(p_transfer_code_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  update transfer_codes
  set status = 'revoked', resolved_at = now()
  where id = p_transfer_code_id
    and status = 'active'
    and not transfer_code_expired(issued_at)
    and is_admin(gym_id);

  if not found then
    raise exception 'transfer code not found';
  end if;
end;
$$;

-- issue_transfer_code (Step 6) is deliberately NOT modified by this
-- migration. Its supersession step (superseding any existing 'active'
-- code before inserting a new one) is already correct regardless of the
-- old code's expiry state: replacing a code supersedes it whether or
-- not it had already expired, per Section 9's first supersession
-- trigger ("a replacement code is issued") - the outcome is identical
-- either way, so no expiry check changes issuance's behavior.

-- Rollback: re-apply revoke_transfer_code() exactly as defined in
-- 20260727150000_transfer_code_issue_revoke.sql; drop function
-- transfer_code_expired(timestamptz).
