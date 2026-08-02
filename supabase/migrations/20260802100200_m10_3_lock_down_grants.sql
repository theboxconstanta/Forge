-- M10.3 Admin Invitation - lock down default-privilege auto-grants.
--
-- Same project-wide ALTER DEFAULT PRIVILEGES hazard already found and
-- fixed for gym_activation_state/gym_commercial_state in M10.1
-- (20260801110100_m10_1_lock_down_grants.sql), and explicitly predicted
-- there to "likely affect other recently-created tables." Confirmed here,
-- not assumed: admin_invitations inherited the identical over-grant
-- (INSERT/UPDATE/DELETE/TRUNCATE to anon, and the same set minus SELECT
-- issues to authenticated) despite this table's own migration granting
-- only `select` explicitly. RLS (enabled, with only a SELECT policy)
-- already blocked any actual exploitation - the underlying grants are
-- locked down explicitly anyway, for the identical reason M10.1's own
-- migration already stated: never rely on RLS alone.
--
-- The root cause itself remains project-wide and out of scope to fix here
-- (same note as M10.1's own migration) - every future new table must have
-- its grants independently verified, not assumed correct from the
-- `grant select ... to authenticated` line in its own creating migration.

revoke insert, update, delete, truncate on table admin_invitations from anon, authenticated;
revoke select, references, trigger on table admin_invitations from anon;

-- authenticated keeps exactly select (RLS-scoped by
-- admin_invitations_select_admin) - nothing else.
