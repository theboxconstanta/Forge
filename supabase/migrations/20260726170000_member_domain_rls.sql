-- M1.4.2 (redefined) - Member Domain RLS
--
-- Minimum policy set for members/memberships SELECT, matching exactly
-- the visibility profiles_select_all already grants today - own row,
-- or a row belonging to someone at the caller's own Gym - so the
-- Phase 1 read-path migration blocked by the missing RLS gap can
-- proceed with identical behaviour to what profiles already provides.
--
-- No INSERT/UPDATE/DELETE policy is added for any actor. Every current
-- write to members/memberships goes exclusively through the
-- SECURITY DEFINER bridge functions introduced in M1.4.1/M1.4.1b
-- (sync_member_from_profile, reconcile_member_domain), which run as
-- the table owner and are unaffected by RLS regardless of what
-- policies exist. Nothing today writes to these tables as an
-- authenticated client, so adding a write policy would be new attack
-- surface with no corresponding behavioural need.
--
-- Bridge-period dependency, explicit: these policies resolve "the
-- caller's own Gym" via my_gym_id() - the same, deliberately unchanged
-- function every other table's RLS already depends on, reading
-- profiles.gym_id. This keeps members/memberships visibility
-- consistent with every other table's visibility during the bridge
-- period. It must be reconsidered, not merely carried forward,
-- whenever my_gym_id() itself is ever migrated off profiles.

-- Bypasses RLS on memberships for one narrow, specific check - the
-- same established pattern is_admin(gid)/is_coach_or_admin(gid)
-- already use. Without this, the members policy's own subquery
-- against memberships would itself be filtered by memberships' RLS
-- for the calling role, breaking gym-mate visibility for every
-- non-admin caller (a real RLS recursion pitfall caught during design,
-- not left as a latent bug).
create or replace function member_has_active_membership_at_gym(p_member_id uuid, p_gym_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from memberships
    where member_id = p_member_id and gym_id = p_gym_id and status = 'active'
  );
$$;

create policy "members_select_own_or_gym_mate" on members
  for select to authenticated
  using (
    id = auth.uid()
    or member_has_active_membership_at_gym(id, my_gym_id())
  );

create policy "memberships_select_own_or_admin" on memberships
  for select to authenticated
  using (
    member_id = auth.uid()
    or is_admin(gym_id)
  );

comment on function member_has_active_membership_at_gym(uuid, uuid) is
  'M1.4.2 RLS support function. Bridge-period: resolves visibility the same way every other table''s RLS does today (via my_gym_id(), reading profiles.gym_id). Must be reconsidered when my_gym_id() itself is migrated off profiles.';

comment on policy "members_select_own_or_gym_mate" on members is
  'Bridge-period policy - mirrors profiles_select_all exactly (own row, or same current Gym via my_gym_id()). Reconsider when my_gym_id() no longer reads profiles.';

comment on policy "memberships_select_own_or_admin" on memberships is
  'Bridge-period policy - own membership rows, or all rows at a Gym the caller administers (is_admin(gym_id)), matching the Financial Domain''s own member/admin visibility pattern for orders/payments. Deliberately narrower than members'' gym-mate visibility: Coach role is excluded per the frozen Product Specification (Chapter 4.14, "Coach access is scoped to WOD and Classes, not member management").';
