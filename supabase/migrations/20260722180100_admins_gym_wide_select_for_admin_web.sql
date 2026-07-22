-- Forge Admin Web M11 (Members module): an admin viewing the Members list
-- needs to know which OTHER members in their gym are also admins, to show
-- an accurate Role column and support an "Admins" filter.
--
-- Discovered live while building the module: `admins` has no gym-wide SELECT
-- policy at all - only `admins_select_own` (id = auth.uid()). Compare to
-- `coaches`, which already has `coaches_admin_select_all` (is_admin(gym_id))
-- alongside its own "select own" policy. This looks like an oversight (the
-- coaches table got the admin-visibility policy, admins never did), not an
-- intentional boundary - nothing in any approved document says admins should
-- be invisible to each other within a gym.
--
-- This mirrors the coaches policy's exact shape: same predicate, same
-- SELECT-only scope, admin-only visibility (a coach still cannot see the
-- admin or full coach roster - that asymmetry is pre-existing and unchanged
-- here, not something this migration is trying to fix).

create policy admins_admin_select_all on admins
  for select
  using (is_admin(gym_id));
