-- Section Leaderboard Visibility - implements the architecture approved by
-- SECTION_LEADERBOARD_VISIBILITY_ARCHITECTURE_READINESS.md (GO verdict,
-- commit 02b28f2). Separates trackability/rankability (unchanged -
-- workout_sections.logging_mode, Programming-declared, Results/Aggregation-
-- consumed) from individual-leaderboard-presentation (this column, new).
--
-- Deliberately NOT added to sync_workout_engine_v2's own explicit
-- INSERT/ON CONFLICT DO UPDATE SET column lists (verified live via
-- `select prosrc from pg_proc` before writing this migration, not assumed)
-- - the exact same stale-client-safety mechanism already proven in
-- production for workouts.aggregate_definition (Phase A/Phase 3): a column
-- left off that RPC's explicit lists is never touched by it, on INSERT
-- (falls to this column's own DEFAULT) or on UPDATE (Postgres's own
-- `UPDATE ... SET` semantics leave unlisted columns completely untouched,
-- regardless of which client - stale or current - triggers the RPC). The
-- coach-authoring write path for this column must therefore be a separate,
-- targeted `.update()` call, never routed through sync_workout_engine_v2 -
-- see the application-layer implementation for that write path.
--
-- DEFAULT TRUE backfills every existing row in this same statement
-- (standard Postgres ADD COLUMN semantics) - every one of today's scored
-- Sections retains its exact current leaderboard behavior automatically,
-- with no resolver logic needed to reproduce legacy behavior for any
-- existing row.

alter table workout_sections
  add column if not exists leaderboard_visible boolean not null default true;

comment on column workout_sections.leaderboard_visible is
  'Section Leaderboard Visibility - whether this Section''s individual leaderboard block renders (Clasament/LeaderboardView). Orthogonal to logging_mode (trackability/rankability, unchanged) - a Section with logging_mode=''required'' and leaderboard_visible=false is still fully trackable, rankable, PR/Rx/completion_state-eligible, and a valid Workout Aggregation participant (including rank-combine); only its own individual leaderboard block stops rendering. Effective visibility is always resolved as (logging_mode=''required'' AND leaderboard_visible) - a Section that is not required is never individually rendered regardless of this column''s stored value (see effectiveLeaderboardVisible, both repos). Default true preserves 100% of current production behavior with zero resolver logic. Deliberately excluded from sync_workout_engine_v2''s own column lists - see this migration''s own header comment for the stale-client-safety reasoning.';
