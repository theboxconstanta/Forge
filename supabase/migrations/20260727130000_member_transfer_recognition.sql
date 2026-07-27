-- M7.3 Step 4 - Gym Transfer: Recognition derivation.
--
-- Per M7.2 Technical Architecture Section 10 and M7.3 Implementation Plan
-- Task 2.1: Recognition is a derivation over existing Membership history,
-- never a stored authoritative fact - directly applying the Member
-- Domain Architecture's own principle (Section 2.2) that status is
-- derived rather than trusted as a stored fact wherever a derivation is
-- possible. No write path exists anywhere in this migration.
--
-- For the calling Member, this returns whether their most recent
-- previous Membership (the row immediately preceding their current one,
-- by created_at - excluding the current one) carries status =
-- 'transferred'. A Member with no prior Membership, or whose lookup
-- fails for any reason, resolves to false - Recognition is informational
-- only (M7.1 Section 11, Rule 13) and must never gate anything, so this
-- must never raise.
--
-- security invoker (the default - no clause needed): this function runs
-- as the calling role, under the existing memberships RLS policy
-- (memberships_select_own_or_admin: member_id = auth.uid() OR
-- is_admin(gym_id)) - no new access capability is introduced. A Member
-- can already read their own Membership history directly; this only
-- encapsulates the "second-most-recent row" derivation so it does not
-- need to be duplicated client-side.
--
-- Rollback: drop function member_transfer_recognition().

create or replace function member_transfer_recognition()
returns boolean
language sql
stable
set search_path = public
as $$
  select coalesce(
    (
      select status = 'transferred'
      from memberships
      where member_id = auth.uid()
      order by created_at desc
      offset 1 limit 1
    ),
    false
  );
$$;

revoke all on function member_transfer_recognition() from public, anon;
grant execute on function member_transfer_recognition() to authenticated;
