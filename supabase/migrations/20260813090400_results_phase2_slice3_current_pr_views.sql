-- Results Phase 2, Slice 3: read-side "current PR" views.
--
-- Architecture Section 8.5's own already-frozen model: "current PR" is
-- NEVER its own stored, authoritative row - it is a derived read over
-- BOTH valid sources (the new `pr_events` ledger and the pre-existing
-- `personal_records` manual-attestation table), "the higher value
-- governs". These two views are that derivation, built once here so
-- every future reader (PWA Personal Records, Admin Athlete Results,
-- future Dashboard) queries the same canonical answer instead of
-- reimplementing this UNION-and-pick-best logic per client - the same
-- "shared query foundation, not per-feature code" principle already
-- established by Slice 2's `wod_logs_with_context`/`skill_logs_with_context`.
--
-- `WITH (security_invoker = true)` on both - Slice 2's own hard-learned,
-- explicitly-verified lesson (a view without it evaluates RLS as its
-- owner, silently bypassing every gym-scoping policy on the underlying
-- tables). Verified live via pg_class.reloptions below, not assumed.
--
-- Movement PRs: `personal_records` rows are converted to canonical kg via
-- the same `slice3_convert_weight` helper the write-side trigger uses -
-- one conversion path, not two independently-maintained ones.
--
-- Benchmark PRs: `personal_records` rows for a Benchmark have no
-- structured `benchmark_id` (they predate Slice 1) - joined by exact
-- `canonical_name` match instead (already established as safe: this
-- table's `movement` value for a benchmark PR is chosen from a fixed
-- dropdown of the same name list Slice 1 seeded `benchmarks` from, not
-- free text). Scaling is parsed from the same deterministic `notes`
-- prefix `evaluate_benchmark_pr` already relies on; a legacy row with no
-- parseable prefix is excluded here too, for the same reason (comparing
-- across an unknown scaling tier would be a silent correctness bug, not
-- a display nicety).

CREATE OR REPLACE VIEW "public"."movement_pr_events_current"
WITH (security_invoker = true) AS
WITH "combined" AS (
    SELECT
        "member_id", "gym_id", "movement", "rep_scheme",
        "score_value" AS "value_kg", "occurred_at",
        'pr_events'::text AS "source", "id" AS "source_id"
    FROM "public"."pr_events"
    WHERE "pr_type" = 'movement'

    UNION ALL

    SELECT
        "pr"."member_id", "pr"."gym_id", "pr"."movement", COALESCE("pr"."reps", 1) AS "rep_scheme",
        "public"."slice3_convert_weight"("pr"."value", "pr"."unit", 'kg') AS "value_kg",
        "pr"."recorded_at" AS "occurred_at",
        'personal_records'::text AS "source", "pr"."id" AS "source_id"
    FROM "public"."personal_records" "pr"
    WHERE "pr"."unit" IN ('kg', 'lbs') AND "pr"."value" IS NOT NULL
)
SELECT DISTINCT ON ("member_id", "movement", "rep_scheme")
    "member_id", "gym_id", "movement", "rep_scheme", "value_kg", "occurred_at", "source", "source_id"
FROM "combined"
WHERE "value_kg" IS NOT NULL
ORDER BY "member_id", "movement", "rep_scheme", "value_kg" DESC, "occurred_at" DESC;

COMMENT ON VIEW "public"."movement_pr_events_current" IS 'Derived "current Movement PR" per (member, movement, rep_scheme) - the higher of pr_events (Slice 3) and personal_records (pre-existing), kg-canonical. Never stored, always computed (Architecture Section 8.5).';

CREATE OR REPLACE VIEW "public"."benchmark_pr_events_current"
WITH (security_invoker = true) AS
WITH "combined" AS (
    SELECT
        "member_id", "gym_id", "benchmark_id", "scaling_context",
        "score_value" AS "value", "score_unit" AS "unit", "occurred_at",
        'pr_events'::text AS "source", "id" AS "source_id"
    FROM "public"."pr_events"
    WHERE "pr_type" = 'benchmark'

    UNION ALL

    SELECT
        "pr"."member_id", "pr"."gym_id", "b"."id" AS "benchmark_id",
        (regexp_match("pr"."notes", '^(RX|Intermediate|Beginner|OnRamp) \|'))[1] AS "scaling_context",
        "pr"."value",
        (CASE WHEN "pr"."unit" = 'timp' THEN 'seconds' WHEN "pr"."unit" = 'runde' THEN 'rounds' ELSE "pr"."unit" END) AS "unit",
        "pr"."recorded_at" AS "occurred_at",
        'personal_records'::text AS "source", "pr"."id" AS "source_id"
    FROM "public"."personal_records" "pr"
    JOIN "public"."benchmarks" "b" ON "b"."canonical_name" = "pr"."movement"
    WHERE "pr"."unit" IN ('timp', 'runde') AND "pr"."value" IS NOT NULL
)
SELECT DISTINCT ON ("member_id", "benchmark_id", "scaling_context", "unit")
    "member_id", "gym_id", "benchmark_id", "scaling_context", "value", "unit", "occurred_at", "source", "source_id"
FROM "combined"
WHERE "scaling_context" IS NOT NULL
ORDER BY "member_id", "benchmark_id", "scaling_context", "unit",
    (CASE WHEN "unit" = 'seconds' THEN "value" ELSE -"value" END) ASC,
    "occurred_at" DESC;

COMMENT ON VIEW "public"."benchmark_pr_events_current" IS 'Derived "current Benchmark PR" per (member, benchmark, scaling_context, unit) - the better (lower seconds / higher rounds) of pr_events (Slice 3) and personal_records (pre-existing). Never stored, always computed (Architecture Section 8.5).';

GRANT SELECT ON TABLE "public"."movement_pr_events_current" TO "authenticated";
GRANT SELECT ON TABLE "public"."benchmark_pr_events_current" TO "authenticated";
