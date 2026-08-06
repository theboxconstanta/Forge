-- Forge Dashboard 2.0, Phase 0: the one shared window-resolution
-- primitive every domain summary function (Attendance/Classes/
-- Membership) calls - per this phase's own explicit "do not duplicate
-- queries across services" instruction, the today/thisWeek/thisMonth/
-- last30Days/custom date-math logic lives exactly once.
--
-- Returns BOTH the requested period and its own "prior comparable
-- period" (shifted back by the period's own duration, except thisMonth
-- which shifts back a true calendar month) - every summary function's
-- own required "comparison period / delta / trend" fields are computed
-- against this same, single definition of "prior," never a second one
-- invented per domain.
--
-- 'thisWeek'/'thisMonth' are true CALENDAR periods (ISO week starting
-- Monday, calendar month from the 1st) - deliberately distinct from
-- 'last30Days' (a rolling window) since the mission names both as
-- separate options, not synonyms. This is a new distinction from every
-- prior Results Phase 2 slice's own "recent_N_days" rolling-only
-- convention, used here because the mission explicitly asked for both
-- shapes side by side.

CREATE TYPE "public"."dashboard_window_bounds" AS (
    "period_start" timestamptz,
    "period_end" timestamptz,
    "prior_period_start" timestamptz,
    "prior_period_end" timestamptz
);

CREATE OR REPLACE FUNCTION "public"."dashboard_resolve_window"(
    "p_window" text,
    "p_custom_start" date DEFAULT NULL,
    "p_custom_end" date DEFAULT NULL
)
RETURNS "public"."dashboard_window_bounds"
LANGUAGE plpgsql
STABLE
AS $$
DECLARE
    v_result "public"."dashboard_window_bounds";
BEGIN
    IF p_window = 'today' THEN
        v_result.period_start := date_trunc('day', now());
        v_result.period_end := v_result.period_start + interval '1 day';
    ELSIF p_window = 'thisWeek' THEN
        v_result.period_start := date_trunc('week', now());
        v_result.period_end := now();
    ELSIF p_window = 'thisMonth' THEN
        v_result.period_start := date_trunc('month', now());
        v_result.period_end := now();
    ELSIF p_window = 'last30Days' THEN
        v_result.period_start := now() - interval '30 days';
        v_result.period_end := now();
    ELSIF p_window = 'custom' THEN
        IF p_custom_start IS NULL OR p_custom_end IS NULL THEN
            RAISE EXCEPTION 'custom window requires both p_custom_start and p_custom_end';
        END IF;
        v_result.period_start := p_custom_start::timestamptz;
        v_result.period_end := (p_custom_end + 1)::timestamptz;
    ELSE
        RAISE EXCEPTION 'unknown window: %', p_window;
    END IF;

    IF p_window = 'thisMonth' THEN
        v_result.prior_period_start := v_result.period_start - interval '1 month';
        v_result.prior_period_end := v_result.period_start;
    ELSE
        v_result.prior_period_start := v_result.period_start - (v_result.period_end - v_result.period_start);
        v_result.prior_period_end := v_result.period_start;
    END IF;

    RETURN v_result;
END;
$$;

COMMENT ON FUNCTION "public"."dashboard_resolve_window"(text, date, date) IS 'Dashboard 2.0 Phase 0 - the single window/comparison-period resolver every domain summary function (get_attendance_summary/get_class_summary/get_membership_summary) calls. today/thisWeek/thisMonth are calendar periods; last30Days is rolling; custom requires both bounds.';
