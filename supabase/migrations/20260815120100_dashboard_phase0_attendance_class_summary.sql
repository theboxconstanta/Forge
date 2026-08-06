-- Forge Dashboard 2.0, Phase 0: AttendanceSummary and ClassSummary.
--
-- SECURITY INVOKER (the default) - both read bookings/classes/
-- class_waitlist, tables the calling coach/admin already has RLS-
-- permitted gym-wide read access to (the same tables AttendanceList.tsx
-- already reads directly), so no elevated privilege is needed, matching
-- Slice 1/2's own INVOKER reasoning for read-only aggregation.
--
-- bookings.class_id is `text`, classes.id is `uuid` - confirmed live via
-- information_schema (not assumed) - every join below casts explicitly
-- (`b.class_id = c.id::text`), matching how attendance/api.ts's own
-- `.in('class_id', classIds)` already relies on this exact text
-- comparison working today.

CREATE OR REPLACE FUNCTION "public"."dashboard_classify_trend"("p_current" numeric, "p_prior" numeric)
RETURNS text
LANGUAGE plpgsql
IMMUTABLE
AS $$
BEGIN
    IF p_prior IS NULL OR p_prior = 0 THEN
        RETURN (CASE WHEN COALESCE(p_current, 0) > 0 THEN 'up' ELSE 'flat' END);
    END IF;
    DECLARE
        v_delta_pct numeric := (p_current - p_prior) / p_prior * 100;
    BEGIN
        IF v_delta_pct > 5 THEN RETURN 'up';
        ELSIF v_delta_pct < -5 THEN RETURN 'down';
        ELSE RETURN 'flat';
        END IF;
    END;
END;
$$;

COMMENT ON FUNCTION "public"."dashboard_classify_trend"(numeric, numeric) IS 'Dashboard 2.0 Phase 0 - the single shared trend classifier (up/down/flat, >5%/<-5% thresholds) every domain summary function uses for its own single headline delta. Deliberately a simpler 3-way vocabulary than Results'' own 6-way athlete/workout trend taxonomy (rapidly_improving/.../insufficient_data) - a different, coarser instrument for a different, operational purpose, not a replacement.';

CREATE OR REPLACE FUNCTION "public"."get_attendance_summary"(
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
    "total_check_ins" bigint,
    "completed_check_ins" bigint,
    "expected_attendees" bigint,
    "attendance_rate" numeric,
    "average_attendance" numeric,
    "peak_attendance_day" date,
    "peak_attendance_day_count" bigint,
    "live_attendance_today" bigint,
    "delta" numeric,
    "trend" text
)
LANGUAGE plpgsql
STABLE
AS $$
DECLARE
    v_bounds "public"."dashboard_window_bounds";
    v_current bigint;
    v_prior bigint;
BEGIN
    v_bounds := "public"."dashboard_resolve_window"(p_window, p_custom_start, p_custom_end);

    SELECT count(*) INTO v_current
    FROM "public"."bookings" b
    JOIN "public"."classes" c ON b."class_id" = c."id"::text
    WHERE b."gym_id" = p_gym_id AND c."date" >= v_bounds.period_start::date AND c."date" < v_bounds.period_end::date;

    SELECT count(*) INTO v_prior
    FROM "public"."bookings" b
    JOIN "public"."classes" c ON b."class_id" = c."id"::text
    WHERE b."gym_id" = p_gym_id AND c."date" >= v_bounds.prior_period_start::date AND c."date" < v_bounds.prior_period_end::date;

    RETURN QUERY
    WITH "period_bookings" AS (
        SELECT b.*, c."date" AS "class_date"
        FROM "public"."bookings" b
        JOIN "public"."classes" c ON b."class_id" = c."id"::text
        WHERE b."gym_id" = p_gym_id AND c."date" >= v_bounds.period_start::date AND c."date" < v_bounds.period_end::date
    ),
    "daily_checkins" AS (
        SELECT "class_date", count(*) FILTER (WHERE "checked_in") AS "n"
        FROM "period_bookings"
        GROUP BY "class_date"
        ORDER BY "n" DESC
        LIMIT 1
    ),
    "distinct_classes" AS (
        SELECT count(DISTINCT "class_id") AS "n" FROM "period_bookings"
    )
    SELECT
        p_gym_id,
        p_window,
        v_bounds.period_start, v_bounds.period_end,
        v_bounds.prior_period_start, v_bounds.prior_period_end,
        v_current,
        (SELECT count(*) FROM "period_bookings" WHERE "checked_in") AS "completed_check_ins",
        (SELECT count(*) FROM "period_bookings" WHERE "class_date" >= CURRENT_DATE) AS "expected_attendees",
        (CASE WHEN v_current > 0 THEN (SELECT count(*) FROM "period_bookings" WHERE "checked_in")::numeric / v_current ELSE NULL END) AS "attendance_rate",
        (CASE WHEN (SELECT "n" FROM "distinct_classes") > 0 THEN v_current::numeric / (SELECT "n" FROM "distinct_classes") ELSE NULL END) AS "average_attendance",
        (SELECT "class_date" FROM "daily_checkins"),
        (SELECT "n" FROM "daily_checkins"),
        (SELECT count(*) FROM "public"."bookings" b2 JOIN "public"."classes" c2 ON b2."class_id" = c2."id"::text
            WHERE b2."gym_id" = p_gym_id AND c2."date" = CURRENT_DATE AND b2."checked_in") AS "live_attendance_today",
        (v_current - v_prior)::numeric AS "delta",
        "public"."dashboard_classify_trend"(v_current::numeric, v_prior::numeric);
END;
$$;

COMMENT ON FUNCTION "public"."get_attendance_summary"(uuid, text, date, date) IS 'Dashboard 2.0 Phase 0 - AttendanceSummary. "live_attendance_today" is always today''s checked-in count regardless of p_window (live is inherently today-scoped).';

CREATE OR REPLACE FUNCTION "public"."get_class_summary"(
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
    "total_classes" bigint,
    "classes_completed" bigint,
    "average_class_size" numeric,
    "average_occupancy" numeric,
    "highest_occupancy_class_id" uuid,
    "highest_occupancy_ratio" numeric,
    "lowest_occupancy_class_id" uuid,
    "lowest_occupancy_ratio" numeric,
    "classes_with_waitlists" bigint,
    "capacity_utilization" numeric,
    "delta" numeric,
    "trend" text
)
LANGUAGE plpgsql
STABLE
AS $$
DECLARE
    v_bounds "public"."dashboard_window_bounds";
    v_current bigint;
    v_prior bigint;
BEGIN
    v_bounds := "public"."dashboard_resolve_window"(p_window, p_custom_start, p_custom_end);

    SELECT count(*) INTO v_current FROM "public"."classes" c
    WHERE c."gym_id" = p_gym_id AND c."date" >= v_bounds.period_start::date AND c."date" < v_bounds.period_end::date;

    SELECT count(*) INTO v_prior FROM "public"."classes" c
    WHERE c."gym_id" = p_gym_id AND c."date" >= v_bounds.prior_period_start::date AND c."date" < v_bounds.prior_period_end::date;

    RETURN QUERY
    WITH "period_classes" AS (
        SELECT c.*, (SELECT count(*) FROM "public"."bookings" b WHERE b."class_id" = c."id"::text) AS "booking_count"
        FROM "public"."classes" c
        WHERE c."gym_id" = p_gym_id AND c."date" >= v_bounds.period_start::date AND c."date" < v_bounds.period_end::date
    ),
    "with_occupancy" AS (
        SELECT *, (CASE WHEN "max_spots" > 0 THEN "booking_count"::numeric / "max_spots" END) AS "occupancy_ratio"
        FROM "period_classes"
    ),
    "highest" AS (SELECT "id", "occupancy_ratio" FROM "with_occupancy" WHERE "occupancy_ratio" IS NOT NULL ORDER BY "occupancy_ratio" DESC LIMIT 1),
    "lowest" AS (SELECT "id", "occupancy_ratio" FROM "with_occupancy" WHERE "occupancy_ratio" IS NOT NULL ORDER BY "occupancy_ratio" ASC LIMIT 1)
    SELECT
        p_gym_id,
        p_window,
        v_bounds.period_start, v_bounds.period_end,
        v_bounds.prior_period_start, v_bounds.prior_period_end,
        v_current,
        (SELECT count(*) FROM "period_classes" WHERE "date" < CURRENT_DATE) AS "classes_completed",
        (SELECT AVG("booking_count") FROM "period_classes") AS "average_class_size",
        (SELECT AVG("occupancy_ratio") FROM "with_occupancy") AS "average_occupancy",
        (SELECT "id" FROM "highest"), (SELECT "occupancy_ratio" FROM "highest"),
        (SELECT "id" FROM "lowest"), (SELECT "occupancy_ratio" FROM "lowest"),
        (SELECT count(DISTINCT c."id") FROM "period_classes" c
            WHERE EXISTS (SELECT 1 FROM "public"."class_waitlist" w WHERE w."class_id" = c."id")) AS "classes_with_waitlists",
        (CASE WHEN (SELECT SUM("max_spots") FROM "period_classes") > 0
            THEN (SELECT SUM("booking_count") FROM "period_classes")::numeric / (SELECT SUM("max_spots") FROM "period_classes")
        END) AS "capacity_utilization",
        (v_current - v_prior)::numeric AS "delta",
        "public"."dashboard_classify_trend"(v_current::numeric, v_prior::numeric);
END;
$$;

COMMENT ON FUNCTION "public"."get_class_summary"(uuid, text, date, date) IS 'Dashboard 2.0 Phase 0 - ClassSummary. capacity_utilization is gym-wide (sum bookings / sum max_spots); average_occupancy averages each class''s own ratio - deliberately two different, both-useful aggregations, not the same number twice.';

GRANT EXECUTE ON FUNCTION "public"."dashboard_resolve_window"(text, date, date) TO "authenticated";
GRANT EXECUTE ON FUNCTION "public"."dashboard_classify_trend"(numeric, numeric) TO "authenticated";
GRANT EXECUTE ON FUNCTION "public"."get_attendance_summary"(uuid, text, date, date) TO "authenticated";
GRANT EXECUTE ON FUNCTION "public"."get_class_summary"(uuid, text, date, date) TO "authenticated";
