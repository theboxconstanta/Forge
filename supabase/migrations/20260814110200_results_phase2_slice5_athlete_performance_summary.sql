-- Results Phase 2, Slice 5: Analytics Foundation - AthletePerformanceSummary.
--
-- The canonical per-member analytics object, built entirely from tables/
-- views already frozen by Slices 1-4 - zero new per-attempt aggregation
-- logic. "attendance_performance_correlation_input" is deliberately named
-- exactly as the mission itself worded it ("input", not "correlation") -
-- Results can only ever contribute its own half (how much a member
-- logged); a real correlation needs Attendance's own booking data,
-- outside this domain's boundary (same disclosed gap as "completion
-- rate" in workout_progress_summary/Slice 4's own gym summary).
--
-- "current_performance_trend" is a majority vote across a member's own
-- performance_progression_summary rows (their repeated workouts only -
-- total_attempts >= 2, since insufficient_data rows carry no trend
-- signal), tie-broken toward the more optimistic bucket - a disclosed,
-- simple, defensible choice, not a statistically elaborate one.

CREATE OR REPLACE VIEW "public"."athlete_performance_summary"
WITH (security_invoker = true) AS
WITH "workout_counts" AS (
    SELECT "member_id", "gym_id", COUNT(*) AS "total_workouts_completed"
    FROM "public"."wod_logs"
    GROUP BY "member_id", "gym_id"
),
"benchmark_counts" AS (
    SELECT "member_id", "gym_id", COUNT(DISTINCT "benchmark_id") AS "benchmarks_completed"
    FROM "public"."wod_logs"
    WHERE "benchmark_id" IS NOT NULL
    GROUP BY "member_id", "gym_id"
),
"pr_counts" AS (
    SELECT
        "member_id", "gym_id",
        COUNT(*) FILTER (WHERE "pr_type" = 'benchmark') AS "benchmark_pr_count",
        COUNT(*) FILTER (WHERE "pr_type" = 'movement') AS "movement_pr_count",
        COUNT(*) AS "total_pr_count",
        COUNT(*) FILTER (WHERE "occurred_at" >= now() - interval '7 days') AS "recent_pr_count_7d",
        COUNT(*) FILTER (WHERE "occurred_at" >= now() - interval '30 days') AS "recent_pr_count_30d",
        COUNT(*) FILTER (WHERE "occurred_at" >= now() - interval '90 days') AS "recent_pr_count_90d",
        MAX("occurred_at") AS "last_pr_date"
    FROM "public"."pr_events"
    GROUP BY "member_id", "gym_id"
),
"timeline_rollup" AS (
    SELECT
        "member_id", "gym_id",
        (COUNT(*) FILTER (WHERE "is_pr"))::numeric / NULLIF(COUNT(*), 0) AS "improvement_rate",
        AVG("pct_change_since_previous") AS "average_improvement_percentage"
    FROM "public"."performance_timeline"
    GROUP BY "member_id", "gym_id"
),
"repeated_rollup" AS (
    SELECT "member_id", "gym_id", COUNT(*) AS "repeated_workouts_completed"
    FROM "public"."performance_progression_summary"
    WHERE "total_attempts" > 1
    GROUP BY "member_id", "gym_id"
),
"plateau_rollup" AS (
    SELECT "member_id", "gym_id", COUNT(*) AS "plateau_indicators"
    FROM "public"."performance_progression_summary"
    WHERE "trend" = 'plateau'
    GROUP BY "member_id", "gym_id"
),
"trend_votes" AS (
    SELECT "member_id", "gym_id", "trend", COUNT(*) AS "n",
        (CASE "trend" WHEN 'rapidly_improving' THEN 5 WHEN 'improving' THEN 4 WHEN 'stable' THEN 3 WHEN 'plateau' THEN 2 WHEN 'declining' THEN 1 ELSE 0 END) AS "priority"
    FROM "public"."performance_progression_summary"
    WHERE "total_attempts" > 1
    GROUP BY "member_id", "gym_id", "trend"
),
"current_trend" AS (
    SELECT DISTINCT ON ("member_id", "gym_id") "member_id", "gym_id", "trend" AS "current_performance_trend"
    FROM "trend_votes"
    ORDER BY "member_id", "gym_id", "n" DESC, "priority" DESC
),
"most_repeated" AS (
    SELECT DISTINCT ON ("member_id", "gym_id") "member_id", "gym_id", "performance_identity_id" AS "most_repeated_workout_identity_id"
    FROM "public"."performance_progression_summary"
    ORDER BY "member_id", "gym_id", "total_attempts" DESC
),
"fastest_improving_benchmark" AS (
    SELECT DISTINCT ON ("pps"."member_id", "pps"."gym_id") "pps"."member_id", "pps"."gym_id", "pi"."benchmark_id" AS "fastest_improving_benchmark_id"
    FROM "public"."performance_progression_summary" "pps"
    JOIN "public"."performance_identities" "pi" ON "pi"."id" = "pps"."performance_identity_id"
    WHERE "pi"."benchmark_id" IS NOT NULL AND "pps"."pct_change_since_previous" IS NOT NULL
    ORDER BY "pps"."member_id", "pps"."gym_id", "pps"."pct_change_since_previous" DESC
),
-- "strongest benchmark" = the Benchmark where this member ranks best
-- (lowest percentile, i.e. closest to the gym's #1) among everyone who
-- currently has a value for that Benchmark+scaling+unit combination -
-- reuses Slice 3's own benchmark_pr_events_current directly.
"benchmark_ranks" AS (
    SELECT
        "member_id", "gym_id", "benchmark_id",
        PERCENT_RANK() OVER (
            PARTITION BY "gym_id", "benchmark_id", "scaling_context", "unit"
            ORDER BY (CASE WHEN "unit" = 'seconds' THEN "value" ELSE -"value" END)
        ) AS "pct_rank"
    FROM "public"."benchmark_pr_events_current"
),
"strongest_benchmark" AS (
    SELECT DISTINCT ON ("member_id", "gym_id") "member_id", "gym_id", "benchmark_id" AS "strongest_benchmark_id"
    FROM "benchmark_ranks"
    ORDER BY "member_id", "gym_id", "pct_rank" ASC
),
"activity_days" AS (
    SELECT "member_id", "gym_id", COUNT(DISTINCT DATE("logged_at")) AS "active_days_90d"
    FROM (
        SELECT "member_id", "gym_id", "logged_at" FROM "public"."wod_logs" WHERE "logged_at" >= now() - interval '90 days'
        UNION ALL
        SELECT "member_id", "gym_id", "logged_at" FROM "public"."skill_logs" WHERE "logged_at" >= now() - interval '90 days'
    ) x
    GROUP BY "member_id", "gym_id"
),
"correlation_input" AS (
    SELECT "member_id", "gym_id", COUNT(*) AS "results_logged_last_30d"
    FROM (
        SELECT "member_id", "gym_id", "logged_at" FROM "public"."wod_logs" WHERE "logged_at" >= now() - interval '30 days'
        UNION ALL
        SELECT "member_id", "gym_id", "logged_at" FROM "public"."skill_logs" WHERE "logged_at" >= now() - interval '30 days'
    ) x
    GROUP BY "member_id", "gym_id"
),
"members_base" AS (
    SELECT "member_id", "gym_id" FROM "workout_counts"
    UNION SELECT "member_id", "gym_id" FROM "pr_counts"
    UNION SELECT "member_id", "gym_id" FROM "repeated_rollup"
)
SELECT
    mb."member_id", mb."gym_id",
    COALESCE(wc."total_workouts_completed", 0) AS "total_workouts_completed",
    COALESCE(rr."repeated_workouts_completed", 0) AS "repeated_workouts_completed",
    COALESCE(bc."benchmarks_completed", 0) AS "benchmarks_completed",
    COALESCE(prc."benchmark_pr_count", 0) AS "benchmark_pr_count",
    COALESCE(prc."movement_pr_count", 0) AS "movement_pr_count",
    COALESCE(prc."total_pr_count", 0) AS "total_pr_count",
    COALESCE(prc."recent_pr_count_7d", 0) AS "recent_pr_count_7d",
    COALESCE(prc."recent_pr_count_30d", 0) AS "recent_pr_count_30d",
    COALESCE(prc."recent_pr_count_90d", 0) AS "recent_pr_count_90d",
    tr."improvement_rate", tr."average_improvement_percentage",
    sb."strongest_benchmark_id",
    fib."fastest_improving_benchmark_id",
    mr."most_repeated_workout_identity_id",
    (COALESCE(ad."active_days_90d", 0)::numeric / 90.0) AS "consistency_score",
    COALESCE(ci."results_logged_last_30d", 0) AS "attendance_performance_correlation_input",
    ct."current_performance_trend",
    COALESCE(pr."plateau_indicators", 0) AS "plateau_indicators",
    prc."last_pr_date"
FROM "members_base" mb
LEFT JOIN "workout_counts" wc ON wc."member_id" = mb."member_id" AND wc."gym_id" = mb."gym_id"
LEFT JOIN "benchmark_counts" bc ON bc."member_id" = mb."member_id" AND bc."gym_id" = mb."gym_id"
LEFT JOIN "pr_counts" prc ON prc."member_id" = mb."member_id" AND prc."gym_id" = mb."gym_id"
LEFT JOIN "timeline_rollup" tr ON tr."member_id" = mb."member_id" AND tr."gym_id" = mb."gym_id"
LEFT JOIN "repeated_rollup" rr ON rr."member_id" = mb."member_id" AND rr."gym_id" = mb."gym_id"
LEFT JOIN "plateau_rollup" pr ON pr."member_id" = mb."member_id" AND pr."gym_id" = mb."gym_id"
LEFT JOIN "current_trend" ct ON ct."member_id" = mb."member_id" AND ct."gym_id" = mb."gym_id"
LEFT JOIN "most_repeated" mr ON mr."member_id" = mb."member_id" AND mr."gym_id" = mb."gym_id"
LEFT JOIN "fastest_improving_benchmark" fib ON fib."member_id" = mb."member_id" AND fib."gym_id" = mb."gym_id"
LEFT JOIN "strongest_benchmark" sb ON sb."member_id" = mb."member_id" AND sb."gym_id" = mb."gym_id"
LEFT JOIN "activity_days" ad ON ad."member_id" = mb."member_id" AND ad."gym_id" = mb."gym_id"
LEFT JOIN "correlation_input" ci ON ci."member_id" = mb."member_id" AND ci."gym_id" = mb."gym_id";

COMMENT ON VIEW "public"."athlete_performance_summary" IS 'Analytics Foundation (Slice 5) - the canonical per-member analytics object (AthletePerformanceSummary), the primary analytics source for the PWA. Built entirely from pr_events/performance_timeline/performance_progression_summary/performance_identities/benchmark_pr_events_current - zero new per-attempt aggregation logic.';

GRANT SELECT ON TABLE "public"."athlete_performance_summary" TO "authenticated";
