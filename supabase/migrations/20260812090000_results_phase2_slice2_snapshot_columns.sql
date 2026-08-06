-- Results Phase 2, Slice 2: stable Result identity, step 1 of 4 - snapshot
-- columns.
--
-- Implements RESULTS_DOMAIN_ARCHITECTURE.md v1.0 Section 5's "Scoring
-- Snapshot" concept concretely: a Result must remain fully interpretable
-- even after the Workout it was logged against is edited or deleted. Only
-- `wod_id` is a permanent-IDENTITY reference (fixed in migration 4 of this
-- slice); these four columns are what changes once that reference can go
-- null - the specific facts a log currently only has access to via a live
-- JOIN to `wods` (its name, its format, and now its resolved Benchmark
-- identity from Slice 1), frozen once, at logging time, so they survive
-- the Workout being removed.
--
-- Deliberately narrow, per this slice's own "do not build the full PR
-- Event Ledger yet" instruction: `variant_level`/weight/result/time_result
-- already live directly on these tables and are already immune to a
-- `wods` row's lifecycle - nothing to snapshot there. Only the
-- JOIN-dependent facts need a frozen copy.

ALTER TABLE "public"."wod_logs"
    ADD COLUMN IF NOT EXISTS "wod_name_snapshot" text,
    ADD COLUMN IF NOT EXISTS "format_snapshot" text,
    ADD COLUMN IF NOT EXISTS "format_config_snapshot" jsonb,
    ADD COLUMN IF NOT EXISTS "benchmark_id" uuid REFERENCES "public"."benchmarks"("id");

COMMENT ON COLUMN "public"."wod_logs"."wod_name_snapshot" IS 'The linked wods.name at logging time - survives the Workout being deleted (wod_id then goes NULL, see migration 4 of this slice). Never re-derived from a later state of wods.';
COMMENT ON COLUMN "public"."wod_logs"."format_snapshot" IS 'The linked wods.type at logging time - what ScoreDisplay''s sets/chained override (RESULTS_PHASE1_1_PATCH_REPORT.md Finding F1) resolves format family from once wod_id can no longer supply it via JOIN.';
COMMENT ON COLUMN "public"."wod_logs"."format_config_snapshot" IS 'The linked wods.format_config at logging time - paired with format_snapshot for the same reason.';
COMMENT ON COLUMN "public"."wod_logs"."benchmark_id" IS 'Resolved once via resolve_benchmark_names (Slice 1) at logging time - the permanent Benchmark identity this Result counts toward, independent of whether wods.name later changes or the Workout is deleted.';

CREATE INDEX IF NOT EXISTS "wod_logs_benchmark_id_idx" ON "public"."wod_logs" ("benchmark_id") WHERE "benchmark_id" IS NOT NULL;

-- skill_logs has two slots (Skill / Skill 2, see the `slot` column) each
-- with its own name/type/config on `wods` - the snapshot captures
-- whichever slot this specific log belongs to, resolved by the trigger
-- (migration 3 of this slice) reading NEW.slot. benchmark_id is included
-- for shape consistency with wod_logs (a future shared read path,
-- Section 5 of this slice, can treat both tables identically) even though
-- Skill Work sections are not typically Benchmark-named in the current
-- product - expected to stay null for most real rows, not an error when
-- it does.
ALTER TABLE "public"."skill_logs"
    ADD COLUMN IF NOT EXISTS "skill_name_snapshot" text,
    ADD COLUMN IF NOT EXISTS "format_snapshot" text,
    ADD COLUMN IF NOT EXISTS "format_config_snapshot" jsonb,
    ADD COLUMN IF NOT EXISTS "benchmark_id" uuid REFERENCES "public"."benchmarks"("id");

COMMENT ON COLUMN "public"."skill_logs"."skill_name_snapshot" IS 'The linked wods.skill_name or skill2_name (per this row''s own slot) at logging time.';
COMMENT ON COLUMN "public"."skill_logs"."format_snapshot" IS 'The linked wods.skill_type or skill2_type (per slot) at logging time.';
COMMENT ON COLUMN "public"."skill_logs"."format_config_snapshot" IS 'The linked wods.skill_format_config or skill2_format_config (per slot) at logging time.';
COMMENT ON COLUMN "public"."skill_logs"."benchmark_id" IS 'Present for shape consistency with wod_logs - expected null for most Skill Work rows.';

CREATE INDEX IF NOT EXISTS "skill_logs_benchmark_id_idx" ON "public"."skill_logs" ("benchmark_id") WHERE "benchmark_id" IS NOT NULL;
