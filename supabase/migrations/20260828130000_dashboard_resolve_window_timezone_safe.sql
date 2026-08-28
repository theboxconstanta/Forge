-- DASHBOARD_RESOLVE_WINDOW TIMEZONE FOLLOW-UP (disclosed in
-- FORGE_MASTER_HANDOFF_2026-08-28 §16 / §23, P0-03 report §10 / §20, and
-- FORGE_DATE_TIME_POLICY.md §7). Narrow, single-function fix. Does NOT reopen
-- P0-01, P0-02, P0-03, or any security item. Does NOT touch m9_publish_waiver
-- or any Financial RPC.
--
-- DEFECT
-- ------
-- `dashboard_resolve_window(p_window, p_custom_start, p_custom_end)` returns the
-- analytics window bounds (period_start/end + prior_period_start/end) consumed by
-- get_attendance_summary / get_class_summary / get_membership_summary. Those
-- three callers use the bounds ONLY as `.period_start::date` etc. to range-filter
-- `date`-typed columns (classes.date, subscriptions.start_date/end_date):
--     WHERE col >= v_bounds.period_start::date AND col < v_bounds.period_end::date
--
-- The old body computed the boundaries from `now()` / `date_trunc('day'|'week'|
-- 'month', now())` / `now() - interval '30 days'`. `now()` is timestamptz and
-- `date_trunc(unit, timestamptz)` truncates in the DB SESSION timezone, which is
-- UTC in production (confirmed live: current_setting('TimeZone') = 'UTC'). The
-- caller's subsequent `::date` also extracts in the session timezone. Romania is
-- UTC+2/UTC+3, so for the ~2-3 hours after gym-local midnight every window
-- ('today', 'thisWeek', 'thisMonth', 'last30Days') resolved to the WRONG local
-- calendar range - e.g. at 00:30 Europe/Bucharest the 'today' window resolved to
-- the whole of *yesterday*. The result also changed with the caller's session
-- timezone, which a window resolver must never do.
-- (Reproduced deterministically live across day/week/month/year boundaries and
-- both DST regimes - see FORGE_DASHBOARD_RESOLVE_WINDOW_TIMEZONE_REPORT.md.)
--
-- FIX
-- ---
-- Resolve every calendar boundary in the gym's business timezone. Compute
--     v_local_now := now() AT TIME ZONE 'Europe/Bucharest'   -- naive local wall-clock
-- do all date_trunc / interval math on that naive local value, then re-stamp
-- each boundary with `::timestamptz`. The composite fields stay `timestamptz`,
-- but because they are only ever consumed as `::date`, and
--     (naive)::timestamptz::date  ==  date(naive)   for ANY session timezone,
-- every caller now extracts the intended gym-local calendar date regardless of
-- the session timezone. The sub-day time component carried by 'thisWeek'/
-- 'thisMonth'/'last30Days' period_end (previously `now()`) is preserved exactly
-- (as `v_local_now::timestamptz`), so the prior-period arithmetic
-- (`period_start - (period_end - period_start)`) yields byte-identical `::date`
-- results to the pre-fix function evaluated under a Europe/Bucharest session.
-- Verified: OLD @ Europe/Bucharest  ===  NEW @ UTC (and @ America/New_York) for
-- all four windows x all four bound fields, at normal times and at every
-- day/week/month/year/DST boundary tested.
--
-- 'custom' is unchanged: `p_custom_start::timestamptz` round-trips through
-- `::date` session-independently already (date -> timestamptz -> date is
-- identity), so custom windows were never affected.
--
-- 'Europe/Bucharest' is hard-coded deliberately: Forge runs a single gym
-- physically in Romania and has no gyms.timezone column. This is an explicit
-- current-product constraint, NOT a claim of generic multi-timezone support.
--
-- NOTE for future callers: `period_*` values are a gym-local-DATE contract
-- (consume via `::date`). They are NOT true absolute instants - do not use them
-- directly as `timestamptz` range bounds against a `timestamptz` column without
-- revisiting this function.
--
-- SCOPE: exactly one function changes (CREATE OR REPLACE, same signature).
-- LANGUAGE plpgsql, STABLE, SECURITY INVOKER (no SECURITY DEFINER), no
-- SET search_path, owner postgres - all preserved. No schema/type change, no
-- trigger, no data change, no caller change, no RLS/grant change. The window
-- preset definitions, the inclusive/exclusive edges, the prior-period formula,
-- and the two RAISE branches are all unchanged - only the timezone in which the
-- boundaries are resolved.

CREATE OR REPLACE FUNCTION "public"."dashboard_resolve_window"(
    p_window text,
    p_custom_start date DEFAULT NULL::date,
    p_custom_end date DEFAULT NULL::date
)
RETURNS "public"."dashboard_window_bounds"
LANGUAGE plpgsql
STABLE
AS $function$
DECLARE
    v_result "public"."dashboard_window_bounds";
    -- Gym-local wall-clock "now" (Europe/Bucharest, naive). All calendar-boundary
    -- math below runs on this local value, not on session-timezone now(); each
    -- boundary is then re-stamped ::timestamptz so callers' `.period_start::date`
    -- yields the intended gym-local calendar date under ANY session timezone.
    v_local_now timestamp without time zone := now() AT TIME ZONE 'Europe/Bucharest';
BEGIN
    IF p_window = 'today' THEN
        v_result.period_start := date_trunc('day', v_local_now)::timestamptz;
        v_result.period_end := (date_trunc('day', v_local_now) + interval '1 day')::timestamptz;
    ELSIF p_window = 'thisWeek' THEN
        v_result.period_start := date_trunc('week', v_local_now)::timestamptz;
        v_result.period_end := v_local_now::timestamptz;
    ELSIF p_window = 'thisMonth' THEN
        v_result.period_start := date_trunc('month', v_local_now)::timestamptz;
        v_result.period_end := v_local_now::timestamptz;
    ELSIF p_window = 'last30Days' THEN
        v_result.period_start := (v_local_now - interval '30 days')::timestamptz;
        v_result.period_end := v_local_now::timestamptz;
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
$function$;

COMMENT ON FUNCTION "public"."dashboard_resolve_window"(text, date, date) IS 'Dashboard 2.0 analytics window resolver. Boundaries are resolved in the gym business timezone (Europe/Bucharest, single-gym Romania deployment constant - no gyms.timezone column exists) and returned as timestamptz whose ::date is the intended gym-local calendar date under any DB session timezone. Consumed as ::date by get_attendance_summary / get_class_summary / get_membership_summary. Timezone-safety fix 20260828130000 - window presets, edges, and prior-period formula unchanged.';
