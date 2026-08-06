-- Results Phase 1: minimal, additive gym-wide SELECT on personal_records.
--
-- Discovered during the Results Phase 1 implementation: personal_records
-- has only an own-rows SELECT policy (personal_records_select_own),
-- unlike wod_logs/skill_logs which both already have a gym-wide SELECT
-- policy (wod_logs_select_all / skill_logs_select_all). Admin Web,
-- authenticated as a coach/admin (not the member), got zero rows back
-- reading another member's Personal Records - Athlete Results in Admin
-- could not work at all for this table.
--
-- This adds a second, permissive SELECT policy, gym-scoped exactly like
-- wod_logs_select_all - it does not touch or replace
-- personal_records_select_own, and does not change INSERT/UPDATE/DELETE,
-- which remain own-rows-only. Postgres RLS policies of the same command
-- are OR'd together, so this only expands read access; it narrows nothing.

CREATE POLICY "personal_records_select_gym" ON "public"."personal_records"
  FOR SELECT TO "authenticated"
  USING (("gym_id" = "public"."my_gym_id"()));
