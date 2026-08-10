-- Coach Quick Create Phase 1 - "Usual Level" member preference, per the
-- explicit product decision made this session: a SOFT DEFAULT, never a
-- hard lock. This column only pre-selects a member's home-screen variant
-- (WOD-SIMPLE App.jsx's fetchWodZi); the member can still switch to any
-- variant before logging (variantaAleasa's own reset-to-null-per-visit
-- lifecycle is untouched), and wod_logs.variant_level still records
-- whichever variant was actually used - so the existing Mixed Categories
-- leaderboard mechanism (rxEngine.js / isMixedCategory in
-- workoutFormats.js, shipped in Results Phase 3) keeps working completely
-- unmodified.
--
-- Deliberately placed on `profiles`, NOT `members`. As of
-- 20260726200000_member_domain_members_update_rls.sql, identity fields
-- (name/gender/birth_date/etc.) already moved to `members`, but `members`
-- is intentionally gym-independent (no gym_id column at all - see
-- ARCHITECTURE.md Section 3.8c). `usual_level` is a gym-scoped WORKOUT
-- preference, consumed entirely within one gym's Programming/Results
-- system alongside every other `profiles.gym_id`-scoped read already in
-- that domain - it is neither cross-gym identity (Track A) nor a bare
-- gym-relationship fact (Track C), so it does not belong on `members`.
--
-- No RLS migration needed: profiles_update_own
-- (20260714130000_multitenant_rls_rewrite.sql) already covers a member
-- updating their own row (`USING (id = auth.uid()) WITH CHECK (id =
-- auth.uid())`), and this column is written through that existing,
-- unmodified policy.

alter table profiles add column usual_level text
  check (usual_level in ('rx', 'intermediate', 'beginner', 'onramp'));
