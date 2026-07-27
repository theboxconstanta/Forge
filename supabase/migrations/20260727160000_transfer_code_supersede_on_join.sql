-- M7.3 Step 7 - Gym Transfer: supersede outstanding Transfer Code on
-- Primary Journey completion.
--
-- Per M7.2 Technical Architecture Section 9 (canonical, post-freeze-
-- corrections text): "Superseded has exactly two triggers... 2. The
-- transfer completes through the Primary Journey while this code is
-- still active. The gym-change synchronization trigger extension
-- (Section 5) performs this transition automatically, in the same
-- transaction as the new Membership's creation, as a system-initiated
-- consequence - it carries no authorization check, since it decides
-- nothing; it records that a decision already made elsewhere (the
-- Transfer's completion) has occurred." And Section 5: "supersede any
-- Transfer Code still Active for that Member's most recently ended
-- Transferred Membership."
--
-- Second edit to member_domain_sync_on_profile_gym_change() (first:
-- 20260727110000, the gym -> null reason-aware ending branch). This
-- migration touches only the null -> gym (join/rejoin) branch, adding
-- one UPDATE after the existing Membership-creation INSERT, in the same
-- transaction. The INSERT's own logic (including its not-exists guard)
-- is byte-for-byte unchanged; the elsif (ending) branch and the
-- exception-isolation wrapper are byte-for-byte unchanged.
--
-- The added UPDATE targets exactly the Member's most recently ended
-- Transferred Membership (order by created_at desc limit 1, status =
-- 'transferred') - not every historical Transfer Code the Member may
-- ever have had, matching Section 5's literal scope. Where no such
-- Membership exists, the subquery is null and the UPDATE affects zero
-- rows - a Member with no outstanding code is unaffected, exactly as
-- required. No authorization check is added, per Section 9's own
-- statement that this transition decides nothing.
--
-- This does not change the Transfer Code state machine (still Active ->
-- Used | Revoked | Superseded, all terminal, per Section 9) or the
-- exactly-one-active-per-Membership invariant (Step 6's partial unique
-- index) - moving a row from Active to Superseded can only reduce the
-- count of Active rows, never create a second one.
--
-- Rollback: re-apply member_domain_sync_on_profile_gym_change() exactly
-- as defined in 20260727110000_member_domain_transfer_reason_branch.sql
-- (the Step-1-only version, without this migration's addition).

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

    -- M7.3 Step 7: supersede any Transfer Code still Active for this
    -- Member's most recently ended Transferred Membership - the Primary
    -- Journey just completed the transfer this code was standing in
    -- for, per M7.2 Section 9's second supersession trigger.
    update transfer_codes
    set status = 'superseded', resolved_at = now()
    where status = 'active'
      and membership_id = (
        select id from memberships
        where member_id = new.id and status = 'transferred'
        order by created_at desc
        limit 1
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
