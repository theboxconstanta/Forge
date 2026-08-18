-- Member Performance, Phase 5 (PR Engine Hardening) - every existing view
-- that reads `pr_events` directly must now exclude voided rows, or the
-- new `voided_at` marker (previous migrations) would be written but never
-- actually observed by any reader - a silent no-op fix. Six views total,
-- each `CREATE OR REPLACE` with its ONLY change being an added
-- `voided_at IS NULL` predicate; every other line is byte-identical to
-- its prior migration (diff the file history if verifying).

CREATE OR REPLACE VIEW "public"."movement_pr_events_current"
WITH (security_invoker = true) AS
WITH "combined" AS (
    SELECT
        "member_id", "gym_id", "movement", "rep_scheme",
        "score_value" AS "value_kg", "occurred_at",
        'pr_events'::text AS "source", "id" AS "source_id"
    FROM "public"."pr_events"
    WHERE "pr_type" = 'movement' AND "voided_at" IS NULL

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

COMMENT ON VIEW "public"."movement_pr_events_current" IS 'Derived "current Movement PR" per (member, movement, rep_scheme) - the higher of pr_events (Slice 3, excluding voided - Phase 5) and personal_records (pre-existing), kg-canonical. Never stored, always computed (Architecture Section 8.5).';

CREATE OR REPLACE VIEW "public"."benchmark_pr_events_current"
WITH (security_invoker = true) AS
WITH "combined" AS (
    SELECT
        "member_id", "gym_id", "benchmark_id", "scaling_context",
        "score_value" AS "value", "score_unit" AS "unit", "occurred_at",
        'pr_events'::text AS "source", "id" AS "source_id"
    FROM "public"."pr_events"
    WHERE "pr_type" = 'benchmark' AND "voided_at" IS NULL

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

COMMENT ON VIEW "public"."benchmark_pr_events_current" IS 'Derived "current Benchmark PR" per (member, benchmark, scaling_context, unit) - the better (lower seconds / higher rounds) of pr_events (Slice 3, excluding voided - Phase 5) and personal_records (pre-existing). Never stored, always computed (Architecture Section 8.5).';

CREATE OR REPLACE VIEW "public"."performance_timeline"
WITH (security_invoker = true) AS
WITH "raw_attempts" AS (
    SELECT
        'wod_log'::text AS "source_type", "id" AS "source_id",
        "member_id", "gym_id", "performance_identity_id", "logged_at" AS "occurred_at",
        "variant_level" AS "scaling_context", "format_snapshot",
        (CASE
            WHEN "format_snapshot" = 'For Time' THEN "public"."slice3_parse_time_to_seconds"("time_result")
            WHEN "format_snapshot" = 'AMRAP' THEN "public"."slice3_parse_leading_number"("result")
        END) AS "score_value",
        (CASE WHEN "format_snapshot" = 'For Time' THEN 'seconds' WHEN "format_snapshot" = 'AMRAP' THEN 'rounds' END) AS "score_unit"
    FROM "public"."wod_logs"
    WHERE "performance_identity_id" IS NOT NULL AND "format_snapshot" IN ('For Time', 'AMRAP')

    UNION ALL

    SELECT
        'skill_log'::text, "id",
        "member_id", "gym_id", "performance_identity_id", "logged_at",
        NULL, "format_snapshot",
        (CASE
            WHEN "format_snapshot" = 'For Time' THEN "public"."slice3_parse_time_to_seconds"("result")
            WHEN "format_snapshot" = 'AMRAP' THEN "public"."slice3_parse_leading_number"("result")
        END),
        (CASE WHEN "format_snapshot" = 'For Time' THEN 'seconds' WHEN "format_snapshot" = 'AMRAP' THEN 'rounds' END)
    FROM "public"."skill_logs"
    WHERE "performance_identity_id" IS NOT NULL AND "format_snapshot" IN ('For Time', 'AMRAP')
),
"scored" AS (
    SELECT
        ra.*,
        (CASE WHEN ra."score_unit" = 'seconds' THEN -ra."score_value" WHEN ra."score_unit" = 'rounds' THEN ra."score_value" END) AS "normalized_score",
        EXISTS (
            SELECT 1 FROM "public"."pr_events" pe
            WHERE pe."voided_at" IS NULL
              AND ((ra."source_type" = 'wod_log' AND pe."source_wod_log_id" = ra."source_id")
               OR (ra."source_type" = 'skill_log' AND pe."source_skill_log_id" = ra."source_id"))
        ) AS "is_pr"
    FROM "raw_attempts" ra
    WHERE ra."score_value" IS NOT NULL
)
SELECT
    "source_type", "source_id", "member_id", "gym_id", "performance_identity_id", "occurred_at",
    "scaling_context", "format_snapshot", "score_value", "score_unit", "normalized_score", "is_pr",
    ROW_NUMBER() OVER "w" AS "attempt_number",
    COUNT(*) OVER "p" AS "total_attempts",
    ("normalized_score" - LAG("normalized_score") OVER "w") AS "improvement_since_previous",
    (CASE
        WHEN LAG("score_value") OVER "w" IS NOT NULL AND LAG("score_value") OVER "w" <> 0
        THEN ("normalized_score" - LAG("normalized_score") OVER "w") / LAG("score_value") OVER "w" * 100
    END) AS "pct_change_since_previous",
    MAX("normalized_score") OVER ("w" ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW) AS "running_best_normalized"
FROM "scored"
WINDOW
    "p" AS (PARTITION BY "member_id", "performance_identity_id"),
    "w" AS (PARTITION BY "member_id", "performance_identity_id" ORDER BY "occurred_at");

COMMENT ON VIEW "public"."performance_timeline" IS 'Universal Workout Progression, per-attempt (Slice 4). One row per scored (For Time/AMRAP) attempt of a repeated workout, with attempt_number/improvement/PR-flag already computed via window functions (PR-flag excludes voided events - Phase 5) - the shared foundation performance_progression_summary aggregates over.';

CREATE OR REPLACE VIEW "public"."movement_progress_summary"
WITH (security_invoker = true) AS
WITH "agg" AS (
    SELECT
        "member_id", "gym_id", "movement", "rep_scheme",
        COUNT(*) AS "total_pr_count",
        COUNT(*) FILTER (WHERE "occurred_at" >= now() - interval '7 days') AS "recent_pr_count_7d",
        COUNT(*) FILTER (WHERE "occurred_at" >= now() - interval '30 days') AS "recent_pr_count_30d",
        COUNT(*) FILTER (WHERE "occurred_at" >= now() - interval '90 days') AS "recent_pr_count_90d",
        COUNT(*) FILTER (WHERE "occurred_at" >= now() - interval '180 days' AND "occurred_at" < now() - interval '90 days') AS "prior_period_pr_count",
        MAX("occurred_at") AS "last_pr_at",
        MAX("score_value") AS "best_ever_kg"
    FROM "public"."pr_events"
    WHERE "pr_type" = 'movement' AND "voided_at" IS NULL
    GROUP BY "member_id", "gym_id", "movement", "rep_scheme"
)
SELECT
    "member_id", "gym_id", "movement", "rep_scheme",
    "total_pr_count", "recent_pr_count_7d", "recent_pr_count_30d", "recent_pr_count_90d",
    "last_pr_at", "best_ever_kg",
    (CASE
        WHEN "total_pr_count" < 2 THEN 'insufficient_data'
        WHEN "recent_pr_count_90d" >= 2 THEN 'rapidly_improving'
        WHEN "recent_pr_count_90d" = 1 THEN 'improving'
        WHEN "recent_pr_count_90d" = 0 AND "prior_period_pr_count" > 0 THEN 'plateau'
        ELSE 'stable'
    END) AS "trend"
FROM "agg";

COMMENT ON VIEW "public"."movement_progress_summary" IS 'Analytics Foundation (Slice 5) - per (member, movement, rep_scheme) PR-frequency-based trend, built only from pr_events excluding voided rows (Phase 5) (never "declining" - see the view''s own header comment for why). Reused by athlete_performance_summary/gym_performance_summary, not duplicated.';

GRANT SELECT ON TABLE "public"."movement_pr_events_current" TO "authenticated";
GRANT SELECT ON TABLE "public"."benchmark_pr_events_current" TO "authenticated";
GRANT SELECT ON TABLE "public"."performance_timeline" TO "authenticated";
GRANT SELECT ON TABLE "public"."movement_progress_summary" TO "authenticated";

-- athlete_performance_summary's own pr_counts CTE - same fix, same file
-- shape as the original Slice 5 migration, every other line unchanged.
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
    WHERE "voided_at" IS NULL
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

COMMENT ON VIEW "public"."athlete_performance_summary" IS 'Analytics Foundation (Slice 5) - the canonical per-member analytics object (AthletePerformanceSummary), the primary analytics source for the PWA. Built entirely from pr_events (excluding voided - Phase 5)/performance_timeline/performance_progression_summary/performance_identities/benchmark_pr_events_current - zero new per-attempt aggregation logic.';

GRANT SELECT ON TABLE "public"."athlete_performance_summary" TO "authenticated";

-- gym_performance_summary's own pr_rollup CTE - same fix, every other
-- line unchanged from the original Slice 5 migration.
CREATE OR REPLACE VIEW "public"."gym_performance_summary"
WITH (security_invoker = true) AS
WITH "pr_rollup" AS (
    SELECT
        "gym_id",
        COUNT(*) FILTER (WHERE "occurred_at" >= now() - interval '7 days') AS "prs_this_week",
        COUNT(*) FILTER (WHERE "occurred_at" >= now() - interval '30 days') AS "prs_this_month"
    FROM "public"."pr_events"
    WHERE "voided_at" IS NULL
    GROUP BY "gym_id"
),
"benchmark_rollup" AS (
    SELECT "gym_id", COUNT(DISTINCT "benchmark_id") AS "benchmarks_completed"
    FROM "public"."wod_logs" WHERE "benchmark_id" IS NOT NULL
    GROUP BY "gym_id"
),
"repeated_rollup" AS (
    SELECT "gym_id", COUNT(*) AS "repeated_workouts_completed"
    FROM "public"."workout_progress_summary" WHERE "total_attempts" > 1
    GROUP BY "gym_id"
),
"athlete_rollup" AS (
    SELECT
        "gym_id",
        AVG("average_improvement_percentage") AS "average_athlete_improvement",
        COUNT(*) FILTER (WHERE "current_performance_trend" IN ('rapidly_improving', 'improving')) AS "athletes_improving",
        COUNT(*) FILTER (WHERE "current_performance_trend" = 'plateau') AS "athletes_plateauing",
        COUNT(*) FILTER (WHERE "current_performance_trend" = 'declining') AS "athletes_declining"
    FROM "public"."athlete_performance_summary"
    GROUP BY "gym_id"
),
"most_effective" AS (
    SELECT DISTINCT ON ("gym_id") "gym_id", "performance_identity_id" AS "most_effective_workout_identity_id"
    FROM "public"."workout_progress_summary"
    WHERE "total_attempts" >= 3
    ORDER BY "gym_id", "avg_improvement_pct" DESC NULLS LAST
),
"most_repeated" AS (
    SELECT DISTINCT ON ("gym_id") "gym_id", "performance_identity_id" AS "most_repeated_workout_identity_id"
    FROM "public"."workout_progress_summary"
    ORDER BY "gym_id", "total_attempts" DESC
),
"strongest_movement" AS (
    SELECT DISTINCT ON ("gym_id") "gym_id", "movement" AS "strongest_movement_trend", "rep_scheme" AS "strongest_movement_rep_scheme"
    FROM "public"."movement_progress_gym_summary"
    ORDER BY "gym_id", "recent_pr_count_30d_all_members" DESC
),
"format_category_trend" AS (
    SELECT
        "pi"."gym_id",
        (CASE
            WHEN "pi"."format_snapshot" IN ('Strength Sets', 'Weightlifting', 'Build to Heavy', '1RM', 'Death By Weight') THEN 'strength'
            WHEN "pi"."format_snapshot" IN ('AMRAP', 'For Time', 'RFT', 'EMOM', 'Intervals', 'Tabata', 'Chained AMRAP', 'Ascending AMRAP') THEN 'conditioning'
            ELSE NULL
        END) AS "category",
        "wps"."avg_improvement_pct"
    FROM "public"."performance_identities" "pi"
    JOIN "public"."workout_progress_summary" "wps" ON "wps"."performance_identity_id" = "pi"."id"
),
"category_trends" AS (
    SELECT "gym_id",
        AVG("avg_improvement_pct") FILTER (WHERE "category" = 'strength') AS "strength_trend_pct",
        AVG("avg_improvement_pct") FILTER (WHERE "category" = 'conditioning') AS "conditioning_trend_pct"
    FROM "format_category_trend"
    GROUP BY "gym_id"
),
"member_totals" AS (
    SELECT "gym_id", COUNT(*) AS "total_members" FROM "public"."profiles" GROUP BY "gym_id"
),
"active_members" AS (
    SELECT "gym_id", COUNT(DISTINCT "member_id") AS "active_members_30d"
    FROM "public"."athlete_performance_summary"
    WHERE "attendance_performance_correlation_input" > 0
    GROUP BY "gym_id"
),
"gyms_base" AS (
    SELECT "gym_id" FROM "member_totals"
)
SELECT
    gb."gym_id",
    COALESCE(pr."prs_this_week", 0) AS "prs_this_week",
    COALESCE(pr."prs_this_month", 0) AS "prs_this_month",
    COALESCE(br."benchmarks_completed", 0) AS "benchmarks_completed",
    COALESCE(rr."repeated_workouts_completed", 0) AS "repeated_workouts_completed",
    ar."average_athlete_improvement",
    COALESCE(ar."athletes_improving", 0) AS "athletes_improving",
    COALESCE(ar."athletes_plateauing", 0) AS "athletes_plateauing",
    COALESCE(ar."athletes_declining", 0) AS "athletes_declining",
    me."most_effective_workout_identity_id",
    mrp."most_repeated_workout_identity_id",
    sm."strongest_movement_trend", sm."strongest_movement_rep_scheme",
    ct."conditioning_trend_pct", ct."strength_trend_pct",
    mt."total_members",
    COALESCE(am."active_members_30d", 0) AS "active_members_30d",
    (COALESCE(am."active_members_30d", 0)::numeric / NULLIF(mt."total_members", 0)) AS "performance_participation_rate",
    (COALESCE(ar."athletes_improving", 0)::numeric / NULLIF(am."active_members_30d", 0)) AS "active_member_improving_rate"
FROM "gyms_base" gb
LEFT JOIN "pr_rollup" pr ON pr."gym_id" = gb."gym_id"
LEFT JOIN "benchmark_rollup" br ON br."gym_id" = gb."gym_id"
LEFT JOIN "repeated_rollup" rr ON rr."gym_id" = gb."gym_id"
LEFT JOIN "athlete_rollup" ar ON ar."gym_id" = gb."gym_id"
LEFT JOIN "most_effective" me ON me."gym_id" = gb."gym_id"
LEFT JOIN "most_repeated" mrp ON mrp."gym_id" = gb."gym_id"
LEFT JOIN "strongest_movement" sm ON sm."gym_id" = gb."gym_id"
LEFT JOIN "category_trends" ct ON ct."gym_id" = gb."gym_id"
LEFT JOIN "member_totals" mt ON mt."gym_id" = gb."gym_id"
LEFT JOIN "active_members" am ON am."gym_id" = gb."gym_id";

COMMENT ON VIEW "public"."gym_performance_summary" IS 'Analytics Foundation (Slice 5) - the canonical owner-level analytics object (GymPerformanceSummary), the primary Dashboard 2.0 summary source. PR rollup excludes voided events (Phase 5). "performance_participation_rate"/"active_member_improving_rate" are the honest engagement-performance indicators Results can compute alone - a full engagement model needs Attendance''s own data, outside this domain''s boundary.';

GRANT SELECT ON TABLE "public"."gym_performance_summary" TO "authenticated";
