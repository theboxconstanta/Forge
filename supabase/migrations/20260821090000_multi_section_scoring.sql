-- Scoring Phase 1B - multi-section scoring, foundational schema.
--
-- Purely additive: two new nullable-with-default columns on `wods`, marking
-- whether the Skill/Skill2 non-primary sections are independently scored
-- (loggingMode 'required' at the Workout Engine V2 sync boundary) rather
-- than the legacy default (loggingMode 'optional', unchanged behavior).
-- Default false preserves byte-identical behavior for every existing row
-- and for every future single-scored-section workout - see
-- SCORING_PHASE1B_MULTI_SECTION_IMPLEMENTATION_REPORT.md for the full
-- design (mapLegacyWodToWorkout/legacySectionFromArray, workoutEngine.js,
-- is the single place that reads these two columns to derive loggingMode -
-- no parallel mapping path, no drift risk).
--
-- Warm-up intentionally has no equivalent column - it remains permanently
-- non-scoreable content, unchanged from today.

alter table wods add column if not exists skill_scored boolean not null default false;
alter table wods add column if not exists skill2_scored boolean not null default false;
