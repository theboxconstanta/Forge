-- M7.3 Step 1 - Gym Transfer: reason-aware ending branch.
--
-- Extends member_domain_sync_on_profile_gym_change()'s existing
-- gym -> null branch (previously: unconditional `status = 'removed'`) so
-- it writes 'transferred' instead, when the calling action has signaled
-- that reason for this transaction. Per M7.2 Technical Architecture
-- Section 5 / Section 9 and M7.3 Implementation Plan Task 1.1 / Execution
-- Plan Step 1: the signal is read via current_setting(..., true) -
-- missing-is-null, never raises - and can only ever be set via
-- set_config(..., true), which is transaction-local and cleared
-- automatically at transaction end. No session-level or persisted
-- setting is introduced or read. Absent, null, or any value other than
-- exactly 'transferred' defaults to today's existing behavior, 'removed'
-- - this branch must never fail the underlying profiles write over a
-- malformed signal.
--
-- Unchanged, byte-for-byte, from the live definition
-- (20260726140000_member_domain_live_sync.sql): the join/rejoin
-- (null -> gym) branch, the sync_member_from_profile(new) call, the
-- function's own exception-isolation wrapper. The trigger definition
-- itself (member_domain_sync_gym_change_trg, same firing condition) is
-- not touched by this migration - only the function it calls is
-- replaced.
--
-- Rollback: re-apply member_domain_sync_on_profile_gym_change() exactly
-- as defined in 20260726140000_member_domain_live_sync.sql.

create or replace function member_domain_sync_on_profile_gym_change()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_ending_reason text;
begin
  perform sync_member_from_profile(new);

  if old.gym_id is null and new.gym_id is not null then
    -- Join or rejoin. A rejoin is a new Membership, never a
    -- reactivation of an old one (Member Domain Architecture Section
    -- 7.1) - no guard against a prior membership existing for this
    -- member, only against re-firing this exact transition twice.
    insert into memberships (id, member_id, gym_id, status, created_at, waiver_accepted, waiver_accepted_at)
    select gen_random_uuid(), new.id, new.gym_id, 'active', now(), new.waiver_accepted, new.waiver_accepted_at
    where not exists (
      select 1 from memberships m where m.member_id = new.id and m.gym_id = new.gym_id and m.status = 'active'
    );
  elsif old.gym_id is not null and new.gym_id is null then
    -- Ending. Reason-aware as of M7.3 Step 1: defaults to 'removed'
    -- unless the calling action signaled 'transferred' for this exact
    -- transaction (M7.2 Section 5, Section 9). Never deleted, never
    -- reused, per Member Domain Architecture Section 7.1, regardless of
    -- which reason is recorded.
    v_ending_reason := current_setting('forge.member_domain_ending_reason', true);
    if v_ending_reason is distinct from 'transferred' then
      v_ending_reason := 'removed';
    end if;

    update memberships
    set status = v_ending_reason
    where member_id = new.id and gym_id = old.gym_id and status = 'active';
  end if;

  return new;
exception when others then
  raise warning 'member_domain_sync_on_profile_gym_change failed for profile %: %', new.id, sqlerrm;
  return new;
end;
$$;
