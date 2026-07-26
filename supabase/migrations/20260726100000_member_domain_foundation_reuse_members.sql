-- M1.1 (correction) - Member Domain Foundation, reusing `members`
--
-- The prior migration in this same implementation stream
-- (20260726090000) introduced a parallel `member_identities` table
-- instead of reusing the existing, already-compatible `members` table.
-- Per the Architectural Interpretation Rule for this phase, an existing
-- physical object that already satisfies a logical entity the frozen
-- architecture defines must be reused rather than duplicated. `members`
-- (id, email, full_name, avatar_url, created_at - no gym_id) already
-- matches the Member entity's shape (Member Domain Architecture
-- Section 3: platform-scoped identity, independent of any Gym) more
-- directly than a new table would.
--
-- `member_identities` was created one migration ago, in this same
-- stream, before this rule was made explicit. It has never been
-- referenced by any application code, Edge Function, or by anything
-- other than `memberships` - itself introduced in that same migration
-- and, likewise, not yet referenced by anything. Both tables are empty.
-- Retiring `member_identities` now, before M1.2 backfill or any
-- application code depends on it, is the correction this rule calls
-- for. Nothing that predates this implementation stream - `members`
-- itself, `profiles`, `subscriptions`, or any other existing object -
-- is touched, renamed, or removed here.

-- Close the one real structural gap in the existing `members` table:
-- it currently has no link to auth.users, so it does not yet guarantee
-- "one Member <-> one login" (Member Domain Architecture Section 3,
-- base model) the way `profiles.id` already does for Membership. The
-- table is empty, so this is a purely additive constraint - there is no
-- existing row it could invalidate.
alter table members
  add constraint members_id_fkey foreign key (id) references auth.users(id) on delete cascade;

-- Repoint Membership at the reused Member entity.
alter table memberships
  drop constraint memberships_member_id_fkey;

alter table memberships
  add constraint memberships_member_id_fkey foreign key (member_id) references members(id);

-- Retire the superseded parallel table from the immediately prior
-- migration. Empty; unreferenced by any application code, Edge
-- Function, or other schema object now that `memberships` no longer
-- points to it.
drop table member_identities;
