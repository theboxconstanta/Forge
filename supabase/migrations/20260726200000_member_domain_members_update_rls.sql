-- M1.5.1 - Member Domain: members write RLS
--
-- Adds the one RLS policy Track A of the approved M1.5 Write Path
-- Migration Assessment requires before any frontend write can be
-- retargeted from profiles to members: an authenticated member updating
-- their own identity fields (full_name, avatar_url, gender, first_name,
-- last_name, birth_date, weight_unit, language, email).
--
-- Scope, explicit: UPDATE only. No INSERT policy is added - per the
-- approved Write Path assessment, every members row is created exclusively
-- through the SECURITY DEFINER bridge trigger chain (member_domain_sync_
-- on_profile_insert -> sync_member_from_profile), which runs as table
-- owner and is unaffected by RLS regardless of what policies exist.
-- Nothing in this repository, today or in the approved M1.5 roadmap,
-- ever needs to INSERT into members as an authenticated client - adding
-- that policy would be new attack surface with no corresponding
-- behavioural need (the same reasoning already applied to the anon
-- EXECUTE revoke in M1.4.2). No DELETE policy is added for the same
-- reason - nothing in the approved architecture ever deletes a members
-- row from the client.
--
-- Pre-existing condition, verified live before writing this migration:
-- members already carries a blanket GRANT ALL to both anon and
-- authenticated (predating this migration stream - members is a reused,
-- pre-existing table per M1.1's own migration comment). This grant is
-- harmless today only because RLS is enabled with zero INSERT/UPDATE/
-- DELETE policies (default-deny). This migration adds the first one -
-- UPDATE only - so anon and authenticated's unused INSERT/DELETE/TRUNCATE
-- grants remain exactly as inert as they are today. Tightening that
-- pre-existing over-broad grant is out of scope here (not part of "add
-- the missing write policy") and is flagged separately, not acted on.
--
-- Row-level only, no column restriction - mirrors profiles_update_own
-- exactly (`using (id = auth.uid()) with check (id = auth.uid())`), the
-- direct precedent for "a user may update only their own identity row."
-- gym_id does not exist on members (confirmed: members has no gym_id
-- column) and memberships is untouched by this migration entirely.
--
-- Rollback: drop policy "members_update_own" on members.

create policy "members_update_own" on members
  for update to authenticated
  using (id = auth.uid())
  with check (id = auth.uid());

comment on policy "members_update_own" on members is
  'M1.5.1. Member Domain write path (Track A only - identity fields). Own row only, no gym-mate write access. Mirrors profiles_update_own exactly.';
