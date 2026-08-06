-- Forge Dashboard 2.0, Phase 0: MembershipSummary.
--
-- Verified live before writing any of this (not assumed): `subscriptions`
-- has no "paused" or "trial" concept anywhere in its own schema, and
-- neither does `subscription_plans` (no category/type column at all -
-- confirmed via information_schema). DASHBOARD_2_0_ARCHITECTURE.md
-- already named "trial" as an undesigned concept requiring its own
-- Membership Domain research pass; this migration does NOT invent one
-- (per this phase's own "do not redesign these domains" instruction) -
-- `paused_memberships`/`trial_memberships` are returned as 0, always,
-- with this comment as the disclosed reason, not a silent fake zero.
--
-- A real discrepancy was found and resolved before shipping, not after:
-- the first draft computed "active" by reconstructing a date range
-- (start_date <= now < end_date) instead of reading `is_active`
-- directly - live testing against real data showed this disagreed with
-- the authoritative `is_active` flag on 50 of 182 real rows (82 vs the
-- real 52). Cross-checking confirmed `is_active` is NOT simply date-
-- derived (subscriptions have `sessions_total`/`sessions_used`, so a
-- session-based plan can exhaust before its own end_date, and the
-- reverse can happen too) - it is its own, independently-set,
-- authoritative flag, already used everywhere else in the Membership
-- Domain (`subscriptions/api.ts`, `subscriptionStatus.ts`). Reinventing
-- an "active" definition here would have been exactly the "calculate
-- metrics independently" failure this phase's own mission forbids -
-- `active_memberships` now reads `is_active` directly, unchanged.
--
-- Because `is_active` only ever reflects CURRENT state (no history/
-- audit column exists), it cannot answer "how many were active as of
-- last month" - there is no reliable way to reconstruct that. Rather
-- than fake a historical comparison for `active_memberships` specifically,
-- this function's own `delta`/`trend` describe `net_membership_change`
-- instead (new minus ended, both computed from `start_date`/`end_date` -
-- genuinely immutable, historically-accurate facts, unlike `is_active`).
-- `active_memberships` itself is exposed as a plain current snapshot,
-- honestly carrying no period-over-period delta of its own.
--
-- "cancelled_memberships" counts subscriptions whose `end_date` fell
-- inside the period - the data model has no distinct cancellation
-- reason/event separate from a subscription simply reaching its own
-- `end_date`, so this cannot distinguish a true early cancellation from
-- a subscription running its natural course. Disclosed here and in the
-- client-side type's own doc comment, not presented as more precise
-- than it is.

CREATE OR REPLACE FUNCTION "public"."get_membership_summary"(
    "p_gym_id" uuid,
    "p_window" text,
    "p_custom_start" date DEFAULT NULL,
    "p_custom_end" date DEFAULT NULL
)
RETURNS TABLE (
    "gym_id" uuid,
    "window_label" text,
    "period_start" timestamptz,
    "period_end" timestamptz,
    "comparison_period_start" timestamptz,
    "comparison_period_end" timestamptz,
    "active_memberships" bigint,
    "paused_memberships" bigint,
    "trial_memberships" bigint,
    "memberships_expiring_7d" bigint,
    "memberships_expiring_30d" bigint,
    "new_memberships" bigint,
    "cancelled_memberships" bigint,
    "net_membership_change" bigint,
    "retention_indicator" numeric,
    "delta" numeric,
    "trend" text
)
LANGUAGE plpgsql
STABLE
AS $$
DECLARE
    v_bounds "public"."dashboard_window_bounds";
    v_new bigint;
    v_cancelled bigint;
    v_prior_new bigint;
    v_prior_cancelled bigint;
    v_net bigint;
    v_prior_net bigint;
    v_active bigint;
BEGIN
    v_bounds := "public"."dashboard_resolve_window"(p_window, p_custom_start, p_custom_end);

    SELECT count(*) INTO v_active FROM "public"."subscriptions" s WHERE s."gym_id" = p_gym_id AND s."is_active";

    SELECT count(*) INTO v_new FROM "public"."subscriptions" s
    WHERE s."gym_id" = p_gym_id AND s."start_date" >= v_bounds.period_start::date AND s."start_date" < v_bounds.period_end::date;

    SELECT count(*) INTO v_cancelled FROM "public"."subscriptions" s
    WHERE s."gym_id" = p_gym_id AND s."end_date" IS NOT NULL
      AND s."end_date" >= v_bounds.period_start::date AND s."end_date" < v_bounds.period_end::date;

    SELECT count(*) INTO v_prior_new FROM "public"."subscriptions" s
    WHERE s."gym_id" = p_gym_id AND s."start_date" >= v_bounds.prior_period_start::date AND s."start_date" < v_bounds.prior_period_end::date;

    SELECT count(*) INTO v_prior_cancelled FROM "public"."subscriptions" s
    WHERE s."gym_id" = p_gym_id AND s."end_date" IS NOT NULL
      AND s."end_date" >= v_bounds.prior_period_start::date AND s."end_date" < v_bounds.prior_period_end::date;

    v_net := v_new - v_cancelled;
    v_prior_net := v_prior_new - v_prior_cancelled;

    RETURN QUERY
    SELECT
        p_gym_id,
        p_window,
        v_bounds.period_start, v_bounds.period_end,
        v_bounds.prior_period_start, v_bounds.prior_period_end,
        v_active,
        0::bigint AS "paused_memberships",
        0::bigint AS "trial_memberships",
        (SELECT count(*) FROM "public"."subscriptions" s WHERE s."gym_id" = p_gym_id AND s."is_active"
            AND s."end_date" IS NOT NULL AND s."end_date" >= CURRENT_DATE AND s."end_date" < CURRENT_DATE + 7) AS "memberships_expiring_7d",
        (SELECT count(*) FROM "public"."subscriptions" s WHERE s."gym_id" = p_gym_id AND s."is_active"
            AND s."end_date" IS NOT NULL AND s."end_date" >= CURRENT_DATE AND s."end_date" < CURRENT_DATE + 30) AS "memberships_expiring_30d",
        v_new,
        v_cancelled,
        v_net,
        (CASE WHEN v_active > 0 THEN 1 - (v_cancelled::numeric / v_active) END) AS "retention_indicator",
        (v_net - v_prior_net)::numeric AS "delta",
        "public"."dashboard_classify_trend"(v_net::numeric, v_prior_net::numeric);
END;
$$;

COMMENT ON FUNCTION "public"."get_membership_summary"(uuid, text, date, date) IS 'Dashboard 2.0 Phase 0 - MembershipSummary. paused_memberships/trial_memberships always 0 (no such concept exists in this platform''s schema, confirmed live, not invented here). active_memberships reads the authoritative is_active flag directly (a live snapshot, no period delta of its own - see this function''s own header comment for why). delta/trend describe net_membership_change (new minus ended, both from immutable start_date/end_date) instead. retention_indicator = 1 - (cancelled-in-period / current active) - a coarse proxy, not cohort-based retention.';

GRANT EXECUTE ON FUNCTION "public"."get_membership_summary"(uuid, text, date, date) TO "authenticated";
