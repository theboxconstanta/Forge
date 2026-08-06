-- Results Phase 2, Slice 1: canonical Benchmark identity.
--
-- Implements RESULTS_DOMAIN_ARCHITECTURE.md v1.0 Section 7 and
-- RESULTS_PHASE2_IMPLEMENTATION_PLAN.md Section 4/Slice 1: a real,
-- gym-extensible Benchmark entity, replacing Phase 1's disclosed
-- name-matching approximation (KNOWN_BENCHMARK_NAMES / HERO_WODS_INFO).
--
-- Two-tier ownership, mirroring Programming's own Movement Library
-- pattern exactly (Platform tier: gym_id IS NULL, visible to every gym;
-- Gym tier: gym_id set, private to that gym, never auto-merged into
-- Platform). No write path for gym-tier authoring exists yet in this
-- slice (benchmark management UI is explicitly out of Slice 1's scope,
-- RESULTS_PHASE2_IMPLEMENTATION_PLAN.md Section 2) - only SELECT
-- policies are added; INSERT/UPDATE/DELETE wait for that future slice,
-- so this migration does not need to design write authorization it
-- cannot yet test against a real UI.
--
-- Retirement, not deletion, per Architecture Section 7.4 - `retired`
-- exists from day one even though nothing sets it to true yet.

CREATE TABLE IF NOT EXISTS "public"."benchmarks" (
    "id" uuid DEFAULT gen_random_uuid() NOT NULL PRIMARY KEY,
    "gym_id" uuid REFERENCES "public"."gyms"("id"),
    "canonical_name" text NOT NULL,
    "category" text NOT NULL CHECK (category IN ('girl', 'hero', 'community', 'gym_custom')),
    "retired" boolean NOT NULL DEFAULT false,
    "created_at" timestamptz NOT NULL DEFAULT now(),
    "created_by" uuid REFERENCES "auth"."users"("id")
);

COMMENT ON TABLE "public"."benchmarks" IS 'Canonical Benchmark identity (RESULTS_DOMAIN_ARCHITECTURE.md Section 7). gym_id NULL = Platform tier (visible to every gym); gym_id set = Gym tier (private to that gym). Never deleted - retired instead.';

-- Platform-tier names must be unique among themselves; a gym's own
-- custom benchmark names must be unique within that gym - two different
-- gyms may reuse the same name for two genuinely different workouts,
-- exactly as two gyms' own Movement Library extensions may already.
CREATE UNIQUE INDEX "benchmarks_platform_name_unique"
    ON "public"."benchmarks" (lower("canonical_name"))
    WHERE "gym_id" IS NULL;

CREATE UNIQUE INDEX "benchmarks_gym_name_unique"
    ON "public"."benchmarks" ("gym_id", lower("canonical_name"))
    WHERE "gym_id" IS NOT NULL;

CREATE INDEX "benchmarks_gym_id_idx" ON "public"."benchmarks" ("gym_id");

ALTER TABLE "public"."benchmarks" ENABLE ROW LEVEL SECURITY;

CREATE POLICY "benchmarks_select_visible" ON "public"."benchmarks"
    FOR SELECT TO "authenticated"
    USING ("gym_id" IS NULL OR "gym_id" = "public"."my_gym_id"());

CREATE OR REPLACE TRIGGER "prevent_gym_id_change_trg"
    BEFORE UPDATE ON "public"."benchmarks"
    FOR EACH ROW EXECUTE FUNCTION "public"."prevent_gym_id_change"();

-- Aliases carry their own gym_id, denormalized from the parent benchmark
-- at write time (mirrors every other tenant-scoped table on this
-- platform - wod_logs/skill_logs/personal_records/custom_hero_wods all
-- carry gym_id directly rather than requiring RLS to join through a
-- parent table). Seed data (next migration) sets this correctly by
-- construction; no ongoing write path exists yet to need a sync trigger.
CREATE TABLE IF NOT EXISTS "public"."benchmark_aliases" (
    "id" uuid DEFAULT gen_random_uuid() NOT NULL PRIMARY KEY,
    "benchmark_id" uuid NOT NULL REFERENCES "public"."benchmarks"("id") ON DELETE CASCADE,
    "gym_id" uuid REFERENCES "public"."gyms"("id"),
    "alias" text NOT NULL,
    "created_at" timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE "public"."benchmark_aliases" IS 'Alternate names resolving to one Benchmark (case/whitespace-normalized at lookup time by resolve_benchmark_names, not at write time). A Benchmark''s own canonical_name always matches too, without needing a redundant alias row for itself.';

CREATE UNIQUE INDEX "benchmark_aliases_benchmark_alias_unique"
    ON "public"."benchmark_aliases" ("benchmark_id", lower("alias"));

CREATE INDEX "benchmark_aliases_gym_id_idx" ON "public"."benchmark_aliases" ("gym_id");
CREATE INDEX "benchmark_aliases_alias_lower_idx" ON "public"."benchmark_aliases" (lower("alias"));

ALTER TABLE "public"."benchmark_aliases" ENABLE ROW LEVEL SECURITY;

CREATE POLICY "benchmark_aliases_select_visible" ON "public"."benchmark_aliases"
    FOR SELECT TO "authenticated"
    USING ("gym_id" IS NULL OR "gym_id" = "public"."my_gym_id"());

GRANT SELECT ON TABLE "public"."benchmarks" TO "authenticated";
GRANT SELECT ON TABLE "public"."benchmark_aliases" TO "authenticated";
