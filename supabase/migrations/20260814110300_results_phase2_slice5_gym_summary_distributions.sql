-- Results Phase 2, Slice 5: Analytics Foundation - GymPerformanceSummary
-- and Progress Distribution.
--
-- GymPerformanceSummary reuses athlete_performance_summary/
-- workout_progress_summary/movement_progress_gym_summary/pr_events
-- entirely - zero new per-attempt aggregation.
--
-- "PRs this week/month" use the same rolling 7d/30d convention already
-- established everywhere else in this domain (recent_pr_count_7d/30d),
-- not calendar week/month boundaries - simpler, deterministic, and
-- consistent with every other "recent" field in this slice.
--
-- "conditioning trend"/"strength trend" use a pragmatic format_snapshot
-- -> category mapping (AMRAP/For Time/EMOM/RFT/Intervals -> conditioning;
-- Strength Sets/Weightlifting/Build to Heavy/1RM -> strength) - disclosed
-- explicitly as a practical heuristic for this analytics view only, NOT
-- a new formal Programming taxonomy (Programming owns its own format
-- catalog and this migration does not touch or extend it).
--
-- "engagement-performance indicators" and "performance participation
-- rate" expose what Results can honestly compute (active-member counts,
-- PR-rate among active members) - a true engagement model spanning
-- class bookings/attendance stays out of Results' domain boundary, same
-- disclosed gap as "completion rate" throughout this slice and Slice 4.

CREATE OR REPLACE VIEW "public"."gym_performance_summary"
WITH (security_invoker = true) AS
WITH "pr_rollup" AS (
    SELECT
        "gym_id",
        COUNT(*) FILTER (WHERE "occurred_at" >= now() - interval '7 days') AS "prs_this_week",
        COUNT(*) FILTER (WHERE "occurred_at" >= now() - interval '30 days') AS "prs_this_month"
    FROM "public"."pr_events"
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
-- profiles, never members - the same correction the Attendance module's
-- own domain assessment already established (members' own gym_id is not
-- reliably authoritative; profiles.gym_id is).
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

COMMENT ON VIEW "public"."gym_performance_summary" IS 'Analytics Foundation (Slice 5) - the canonical owner-level analytics object (GymPerformanceSummary), the primary Dashboard 2.0 summary source. "performance_participation_rate"/"active_member_improving_rate" are the honest engagement-performance indicators Results can compute alone - a full engagement model needs Attendance''s own data, outside this domain''s boundary.';

GRANT SELECT ON TABLE "public"."gym_performance_summary" TO "authenticated";

-- Progress Distribution - one canonical view, `scope` distinguishing
-- workouts/benchmarks/athletes/movements, each bucketed into the same 4
-- coarse categories (improved/unchanged/declined/insufficient_data) via
-- one shared mapping applied consistently across all 4 sources.

CREATE OR REPLACE VIEW "public"."performance_progress_distribution"
WITH (security_invoker = true) AS
WITH "workout_bucketed" AS (
    SELECT "gym_id", 'workout'::text AS "scope",
        (CASE "trend" WHEN 'rapidly_improving' THEN 'improved' WHEN 'improving' THEN 'improved'
             WHEN 'stable' THEN 'unchanged' WHEN 'plateau' THEN 'unchanged'
             WHEN 'declining' THEN 'declined' ELSE 'insufficient_data' END) AS "bucket"
    FROM "public"."performance_progression_summary"
),
"benchmark_bucketed" AS (
    SELECT "pps"."gym_id", 'benchmark'::text AS "scope",
        (CASE "pps"."trend" WHEN 'rapidly_improving' THEN 'improved' WHEN 'improving' THEN 'improved'
             WHEN 'stable' THEN 'unchanged' WHEN 'plateau' THEN 'unchanged'
             WHEN 'declining' THEN 'declined' ELSE 'insufficient_data' END) AS "bucket"
    FROM "public"."performance_progression_summary" "pps"
    JOIN "public"."performance_identities" "pi" ON "pi"."id" = "pps"."performance_identity_id"
    WHERE "pi"."benchmark_id" IS NOT NULL
),
"athlete_bucketed" AS (
    SELECT "gym_id", 'athlete'::text AS "scope",
        (CASE "current_performance_trend" WHEN 'rapidly_improving' THEN 'improved' WHEN 'improving' THEN 'improved'
             WHEN 'stable' THEN 'unchanged' WHEN 'plateau' THEN 'unchanged'
             WHEN 'declining' THEN 'declined' ELSE 'insufficient_data' END) AS "bucket"
    FROM "public"."athlete_performance_summary"
),
-- Movement PR-frequency trend structurally never produces 'declining'
-- (see movement_progress_summary's own header comment) - its "declined"
-- bucket count is always 0 here, disclosed, not a bug.
"movement_bucketed" AS (
    SELECT "gym_id", 'movement'::text AS "scope",
        (CASE "trend" WHEN 'rapidly_improving' THEN 'improved' WHEN 'improving' THEN 'improved'
             WHEN 'stable' THEN 'unchanged' WHEN 'plateau' THEN 'unchanged'
             ELSE 'insufficient_data' END) AS "bucket"
    FROM "public"."movement_progress_summary"
),
"all_bucketed" AS (
    SELECT * FROM "workout_bucketed"
    UNION ALL SELECT * FROM "benchmark_bucketed"
    UNION ALL SELECT * FROM "athlete_bucketed"
    UNION ALL SELECT * FROM "movement_bucketed"
)
SELECT "gym_id", "scope", "bucket", COUNT(*) AS "n"
FROM "all_bucketed"
GROUP BY "gym_id", "scope", "bucket";

COMMENT ON VIEW "public"."performance_progress_distribution" IS 'Analytics Foundation (Slice 5) - Progress Distribution, one row per (gym, scope, bucket). scope in (workout, benchmark, athlete, movement); bucket in (improved, unchanged, declined, insufficient_data), one shared mapping applied consistently across all 4 scopes.';

GRANT SELECT ON TABLE "public"."performance_progress_distribution" TO "authenticated";
