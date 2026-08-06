-- Results Phase 2, Slice 5: Analytics Foundation - WorkoutProgressSummary
-- and BenchmarkProgressSummary.
--
-- Both built entirely from performance_timeline/performance_progression_summary
-- (Slice 4) - zero new per-attempt aggregation logic, per this slice's own
-- "avoid duplicate aggregation logic" instruction. This view is a strict
-- superset of Slice 4's own performance_identity_gym_summary (which stays
-- untouched/frozen - no client reads it yet, so there is nothing to
-- migrate); a future cleanup could point callers here instead, not done
-- in this slice.
--
-- "completion rate" is again deliberately absent (see performance_identity_gym_summary's
-- own comment, Slice 4) - requires an Attendance-domain join, out of
-- Results' boundary.

CREATE OR REPLACE VIEW "public"."workout_progress_summary"
WITH (security_invoker = true) AS
WITH "scaling_counts" AS (
    SELECT "performance_identity_id", "gym_id",
        jsonb_object_agg(COALESCE("scaling_context", 'unscaled'), "n") AS "scaling_distribution"
    FROM (
        SELECT "performance_identity_id", "gym_id", "scaling_context", COUNT(*) AS "n"
        FROM "public"."performance_timeline"
        GROUP BY "performance_identity_id", "gym_id", "scaling_context"
    ) s
    GROUP BY "performance_identity_id", "gym_id"
),
"trend_counts" AS (
    SELECT "performance_identity_id", "gym_id",
        jsonb_object_agg("trend", "n") AS "trend_distribution"
    FROM (
        SELECT "performance_identity_id", "gym_id", "trend", COUNT(*) AS "n"
        FROM "public"."performance_progression_summary"
        GROUP BY "performance_identity_id", "gym_id", "trend"
    ) t
    GROUP BY "performance_identity_id", "gym_id"
),
"improvement_buckets" AS (
    SELECT "performance_identity_id", "gym_id",
        jsonb_build_object(
            'improved', COUNT(*) FILTER (WHERE "pct_change_since_previous" > 1),
            'unchanged', COUNT(*) FILTER (WHERE "pct_change_since_previous" BETWEEN -1 AND 1),
            'declined', COUNT(*) FILTER (WHERE "pct_change_since_previous" < -1),
            'insufficient_data', COUNT(*) FILTER (WHERE "pct_change_since_previous" IS NULL)
        ) AS "improvement_distribution"
    FROM "public"."performance_timeline"
    GROUP BY "performance_identity_id", "gym_id"
),
"score_by_unit" AS (
    SELECT DISTINCT ON ("performance_identity_id", "gym_id")
        "performance_identity_id", "gym_id", "score_unit", "avg_score"
    FROM (
        SELECT "performance_identity_id", "gym_id", "score_unit",
            AVG("score_value") AS "avg_score", COUNT(*) AS "n"
        FROM "public"."performance_timeline"
        GROUP BY "performance_identity_id", "gym_id", "score_unit"
    ) s
    ORDER BY "performance_identity_id", "gym_id", "n" DESC
),
"timeline_agg" AS (
    SELECT
        "performance_identity_id", "gym_id",
        COUNT(*) AS "total_attempts",
        COUNT(DISTINCT "member_id") AS "unique_athletes",
        AVG("pct_change_since_previous") AS "avg_improvement_pct",
        PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY "pct_change_since_previous") AS "median_improvement_pct",
        MAX("improvement_since_previous") AS "best_improvement",
        (COUNT(*) FILTER (WHERE "is_pr"))::numeric / NULLIF(COUNT(*), 0) AS "pr_rate"
    FROM "public"."performance_timeline"
    GROUP BY "performance_identity_id", "gym_id"
)
SELECT
    ta."performance_identity_id", ta."gym_id",
    ta."total_attempts", ta."unique_athletes",
    (SELECT AVG("avg_days_between_attempts") FROM "public"."performance_progression_summary" pps
        WHERE pps."performance_identity_id" = ta."performance_identity_id" AND pps."avg_days_between_attempts" IS NOT NULL) AS "repeat_frequency_days",
    ta."avg_improvement_pct", ta."median_improvement_pct", ta."best_improvement",
    ib."improvement_distribution",
    ta."pr_rate",
    sc."scaling_distribution",
    tc."trend_distribution",
    sbu."avg_score", sbu."score_unit"
FROM "timeline_agg" ta
LEFT JOIN "scaling_counts" sc ON sc."performance_identity_id" = ta."performance_identity_id"
LEFT JOIN "trend_counts" tc ON tc."performance_identity_id" = ta."performance_identity_id"
LEFT JOIN "improvement_buckets" ib ON ib."performance_identity_id" = ta."performance_identity_id"
LEFT JOIN "score_by_unit" sbu ON sbu."performance_identity_id" = ta."performance_identity_id";

COMMENT ON VIEW "public"."workout_progress_summary" IS 'Analytics Foundation (Slice 5) - gym-wide analytics per Performance Identity, built entirely from performance_timeline/performance_progression_summary (Slice 4). The coach-insights foundation the mission names.';

CREATE OR REPLACE VIEW "public"."benchmark_progress_summary"
WITH (security_invoker = true) AS
WITH "top_improvers" AS (
    SELECT
        "performance_identity_id",
        jsonb_agg(jsonb_build_object('member_id', "member_id", 'pct_change', "pct_change_since_previous") ORDER BY "pct_change_since_previous" DESC)
            FILTER (WHERE "pct_change_since_previous" IS NOT NULL) AS "improvers_ranked"
    FROM "public"."performance_progression_summary"
    GROUP BY "performance_identity_id"
)
SELECT
    "pi"."id" AS "performance_identity_id", "pi"."benchmark_id", "pi"."gym_id",
    "wps"."total_attempts" AS "total_completions", "wps"."unique_athletes",
    "wps"."repeat_frequency_days", "wps"."avg_improvement_pct", "wps"."median_improvement_pct",
    (SELECT MIN("score_value") FROM "public"."performance_timeline" pt WHERE pt."performance_identity_id" = "pi"."id" AND pt."score_unit" = 'seconds') AS "gym_best_seconds",
    (SELECT MAX("score_value") FROM "public"."performance_timeline" pt WHERE pt."performance_identity_id" = "pi"."id" AND pt."score_unit" = 'rounds') AS "gym_best_rounds",
    (SELECT PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY pt."score_value") FROM "public"."performance_timeline" pt WHERE pt."performance_identity_id" = "pi"."id") AS "gym_median_score",
    "wps"."trend_distribution" AS "benchmark_trend_distribution",
    "wps"."unique_athletes" AS "benchmark_popularity",
    (SELECT jsonb_agg(x) FROM (SELECT * FROM jsonb_array_elements(ti."improvers_ranked") LIMIT 5) x) AS "top_improving_athletes"
FROM "public"."performance_identities" "pi"
JOIN "workout_progress_summary" "wps" ON "wps"."performance_identity_id" = "pi"."id"
LEFT JOIN "top_improvers" "ti" ON "ti"."performance_identity_id" = "pi"."id"
WHERE "pi"."benchmark_id" IS NOT NULL;

COMMENT ON VIEW "public"."benchmark_progress_summary" IS 'Analytics Foundation (Slice 5) - benchmark-specific analytics, a filtered/extended view over workout_progress_summary for identities resolved via Benchmark Identity (pi.benchmark_id IS NOT NULL).';

GRANT SELECT ON TABLE "public"."workout_progress_summary" TO "authenticated";
GRANT SELECT ON TABLE "public"."benchmark_progress_summary" TO "authenticated";
