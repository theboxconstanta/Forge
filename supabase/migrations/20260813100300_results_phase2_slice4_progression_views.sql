-- Results Phase 2, Slice 4: Universal Workout Progression - the shared
-- Performance Progression service, as three layered, security_invoker
-- views (Slice 2's own established read-side pattern, not a new one).
--
-- Scope, disclosed exactly like Slice 3's own Benchmark PR detection:
-- quantitative progression (a single comparable scalar score) is
-- computed only for 'For Time' (seconds, lower better) and 'AMRAP'
-- (rounds, higher better) - reusing Slice 3's own slice3_parse_time_to_seconds/
-- slice3_parse_leading_number verbatim, not re-implementing parsing.
-- Every other repeated format still gets a real Performance Identity and
-- appears in a member's attempt history structurally, just without a
-- single improvement percentage (the same honest boundary Slice 3 drew,
-- not a new gap invented here).
--
-- Internal sign convention: `normalized_score` = -seconds for time,
-- +rounds for AMRAP, so "higher normalized_score is always better"
-- regardless of unit - this lets one set of window functions (MAX,
-- ORDER BY) work for both scoring directions without a CASE branch at
-- every use site. NEVER displayed raw to a caller - always paired with
-- score_value/score_unit for the real, human-meaningful number.
--
-- performance_timeline: one row per scored attempt (For Time/AMRAP wod_logs
-- or skill_logs) that resolved to a Performance Identity. All the
-- mission's own named per-attempt facts (attempt_number, is_pr,
-- improvement since previous, etc.) as window functions over
-- (member_id, performance_identity_id) ordered by occurred_at.
--
-- performance_progression_summary: one row per (member, identity) -
-- current/previous/first result, current/previous PR, total attempts,
-- improvement since previous/first, trend classification. This is the
-- literal "Today / Last time / Improvement / Status" the mission's own
-- athlete-experience mockup describes - one row is everything that
-- screen needs.
--
-- performance_identity_gym_summary: the coach-facing, cross-member
-- rollup per (gym, identity) - members improved/plateaued/declined,
-- avg/best improvement. "Completion rate" (mission's coach-experience
-- bullet) is deliberately NOT included here - it requires joining
-- Attendance's own booking data (who was AT the class vs who logged a
-- result), which is outside Results' domain boundary per this project's
-- own established Member/Financial/Results domain-separation discipline;
-- named here as a disclosed gap for a future cross-domain slice, not
-- silently faked or reached-into.

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
            WHERE (ra."source_type" = 'wod_log' AND pe."source_wod_log_id" = ra."source_id")
               OR (ra."source_type" = 'skill_log' AND pe."source_skill_log_id" = ra."source_id")
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

COMMENT ON VIEW "public"."performance_timeline" IS 'Universal Workout Progression, per-attempt (Slice 4). One row per scored (For Time/AMRAP) attempt of a repeated workout, with attempt_number/improvement/PR-flag already computed via window functions - the shared foundation performance_progression_summary aggregates over.';

CREATE OR REPLACE VIEW "public"."performance_progression_summary"
WITH (security_invoker = true) AS
WITH "agg" AS (
    SELECT
        "member_id", "gym_id", "performance_identity_id",
        MAX("total_attempts") AS "total_attempts",
        MIN("occurred_at") AS "first_attempt_at",
        MAX("occurred_at") AS "latest_attempt_at",

        MAX("score_value") FILTER (WHERE "attempt_number" = "total_attempts") AS "current_result_value",
        MAX("score_unit") FILTER (WHERE "attempt_number" = "total_attempts") AS "current_result_unit",
        BOOL_OR("is_pr") FILTER (WHERE "attempt_number" = "total_attempts") AS "current_is_pr",

        MAX("score_value") FILTER (WHERE "attempt_number" = "total_attempts" - 1) AS "previous_result_value",
        MAX("score_unit") FILTER (WHERE "attempt_number" = "total_attempts" - 1) AS "previous_result_unit",

        MAX("score_value") FILTER (WHERE "attempt_number" = 1) AS "first_result_value",
        MAX("score_unit") FILTER (WHERE "attempt_number" = 1) AS "first_result_unit",

        MAX("normalized_score") AS "best_normalized_score",
        MAX("normalized_score") FILTER (WHERE "attempt_number" < "total_attempts") AS "best_normalized_score_before_latest",

        MAX("improvement_since_previous") FILTER (WHERE "attempt_number" = "total_attempts") AS "improvement_since_previous",
        MAX("pct_change_since_previous") FILTER (WHERE "attempt_number" = "total_attempts") AS "pct_change_since_previous",

        AVG("pct_change_since_previous") FILTER (WHERE "attempt_number" > GREATEST(1, "total_attempts" - 3)) AS "avg_recent_pct_change",
        COUNT(*) FILTER (WHERE "is_pr" AND "attempt_number" > GREATEST(1, "total_attempts" - 3)) AS "recent_pr_count"
    FROM "public"."performance_timeline"
    GROUP BY "member_id", "gym_id", "performance_identity_id"
)
SELECT
    "member_id", "gym_id", "performance_identity_id",
    "total_attempts", "first_attempt_at", "latest_attempt_at",
    "current_result_value", "current_result_unit", "current_is_pr",
    "previous_result_value", "previous_result_unit",
    "first_result_value", "first_result_unit",
    "improvement_since_previous", "pct_change_since_previous",
    -- improvement_since_first mirrors improvement_since_previous's own sign
    -- convention (positive = better) via the same normalized-score subtraction,
    -- just against attempt 1 instead of attempt_number-1.
    (CASE
        WHEN "current_result_unit" = 'seconds' THEN "first_result_value" - "current_result_value"
        WHEN "current_result_unit" = 'rounds' THEN "current_result_value" - "first_result_value"
    END) AS "improvement_since_first",
    ("best_normalized_score" - "best_normalized_score_before_latest") AS "best_improvement_normalized",
    (CASE
        WHEN "total_attempts" - 1 > 0 THEN EXTRACT(EPOCH FROM ("latest_attempt_at" - "first_attempt_at")) / 86400.0 / ("total_attempts" - 1)
    END) AS "avg_days_between_attempts",
    (CASE
        WHEN "total_attempts" < 2 THEN 'insufficient_data'
        WHEN "avg_recent_pct_change" > 5 THEN 'rapidly_improving'
        WHEN "avg_recent_pct_change" > 1 THEN 'improving'
        WHEN "avg_recent_pct_change" < -1 THEN 'declining'
        WHEN "recent_pr_count" = 0 AND "total_attempts" >= 3 THEN 'plateau'
        ELSE 'stable'
    END) AS "trend"
FROM "agg";

COMMENT ON VIEW "public"."performance_progression_summary" IS 'Universal Workout Progression, summarized (Slice 4) - one row per (member, Performance Identity): current/previous/first result, improvement since previous/first, best improvement, attempt frequency, and trend classification (rapidly_improving/improving/stable/plateau/declining/insufficient_data). This is the "Today / Last time / Improvement / Status" athlete-experience data in one row.';

CREATE OR REPLACE VIEW "public"."performance_identity_gym_summary"
WITH (security_invoker = true) AS
SELECT
    "gym_id", "performance_identity_id",
    COUNT(DISTINCT "member_id") AS "members_attempted",
    COUNT(DISTINCT "member_id") FILTER (WHERE "trend" IN ('improving', 'rapidly_improving')) AS "members_improved",
    COUNT(DISTINCT "member_id") FILTER (WHERE "trend" = 'plateau') AS "members_plateaued",
    COUNT(DISTINCT "member_id") FILTER (WHERE "trend" = 'declining') AS "members_declined",
    AVG("improvement_since_previous") FILTER (WHERE "improvement_since_previous" IS NOT NULL) AS "avg_improvement_since_previous",
    MAX("improvement_since_previous") AS "best_improvement_since_previous",
    MAX("latest_attempt_at") AS "most_recent_attempt_at",
    SUM("total_attempts") AS "total_attempts_all_members"
FROM "public"."performance_progression_summary"
GROUP BY "gym_id", "performance_identity_id";

COMMENT ON VIEW "public"."performance_identity_gym_summary" IS 'Coach-facing rollup (Slice 4) - per (gym, Performance Identity) across every member who has attempted it: improved/plateaued/declined counts, avg/best improvement, most recent attempt. Completion rate is deliberately NOT included - it requires joining Attendance''s own booking data, outside Results'' domain boundary; a disclosed gap for a future cross-domain slice.';

GRANT SELECT ON TABLE "public"."performance_timeline" TO "authenticated";
GRANT SELECT ON TABLE "public"."performance_progression_summary" TO "authenticated";
GRANT SELECT ON TABLE "public"."performance_identity_gym_summary" TO "authenticated";
