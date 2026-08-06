-- Results Phase 2, Slice 5: Analytics Foundation - movement-level trend.
--
-- Deliberately built ONLY from `pr_events` (pr_type='movement') - not a
-- new full-attempt-history engine mirroring performance_timeline's own
-- per-log window functions. `pr_events` only ever gets a row when a
-- movement PR actually happens (Slice 3's own design), so unlike
-- performance_timeline (built from every wod_logs/skill_logs row,
-- PR or not), this data source structurally CANNOT show a movement
-- "declining" - there is no attempt-that-wasn't-a-PR row to compare
-- against. This is an honest, disclosed limitation, not an oversight:
-- building a true full-attempt movement trend would require re-deriving
-- per-set history from wod_logs.sets/skill_logs.sets in a read query
-- (duplicating evaluate_movement_prs' own bestByReps logic) - explicitly
-- avoided per this slice's own "avoid duplicate aggregation logic"
-- instruction. Movement trend here is PR-FREQUENCY-based (how often is
-- this member/gym actually PRing this movement recently), which is also
-- the more natural signal for a movement anyway - a Back Squat isn't
-- retried weekly the way a benchmark workout is, so measuring the RATE
-- of new maxes is a better fit than an attempt-by-attempt slope.

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
    WHERE "pr_type" = 'movement'
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

COMMENT ON VIEW "public"."movement_progress_summary" IS 'Analytics Foundation (Slice 5) - per (member, movement, rep_scheme) PR-frequency-based trend, built only from pr_events (never "declining" - see the view''s own header comment for why). Reused by athlete_performance_summary/gym_performance_summary, not duplicated.';

CREATE OR REPLACE VIEW "public"."movement_progress_gym_summary"
WITH (security_invoker = true) AS
SELECT
    "gym_id", "movement", "rep_scheme",
    COUNT(DISTINCT "member_id") AS "unique_athletes",
    SUM("total_pr_count") AS "total_pr_count_all_members",
    SUM("recent_pr_count_30d") AS "recent_pr_count_30d_all_members",
    MAX("last_pr_at") AS "most_recent_pr_at",
    MAX("best_ever_kg") AS "gym_best_kg"
FROM "public"."movement_progress_summary"
GROUP BY "gym_id", "movement", "rep_scheme";

COMMENT ON VIEW "public"."movement_progress_gym_summary" IS 'Analytics Foundation (Slice 5) - gym-wide rollup of movement_progress_summary, per (gym, movement, rep_scheme).';

GRANT SELECT ON TABLE "public"."movement_progress_summary" TO "authenticated";
GRANT SELECT ON TABLE "public"."movement_progress_gym_summary" TO "authenticated";
