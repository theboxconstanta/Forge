-- P0-01 SQL TIMEZONE FOLLOW-UP (disclosed in FORGE_MASTER_HANDOFF_2026-08-28,
-- §16 / §23, and FORGE_DATE_TIME_POLICY.md §7). This is NOT a reopening of
-- P0-01: its functional deletion-integrity policy (checked-in protection,
-- past-class protection, future cascade) is CLOSED and is preserved here
-- byte-for-byte. The ONLY change is the timezone interpretation of the
-- "has this class already ended?" boundary.
--
-- DEFECT
-- ------
-- `enforce_class_deletion_policy()` computed:
--
--     v_class_ended := (OLD.date + OLD.end_time) < now();
--
-- `classes.date` is `date` and `classes.end_time` is `time without time
-- zone`; `date + time` yields `timestamp without time zone` (a naive
-- gym-local wall-clock value, per FORGE_DATE_TIME_POLICY.md §3/§5). Comparing
-- it against `now()` (a `timestamptz`) forces Postgres to coerce the naive
-- value to `timestamptz` using the DB SESSION timezone. In production that
-- session timezone is UTC (confirmed live: current_setting('TimeZone') =
-- 'UTC'). Romania is UTC+2 (EET, winter) / UTC+3 (EEST, summer), so a class
-- whose local end time was e.g. 19:00 was treated as "ended" only once
-- 19:00 UTC passed - i.e. 21:00-22:00 gym-local. For that 2-3 hour window
-- after a class genuinely ended, it was still classified "not yet ended",
-- so a past class with non-checked-in bookings could still be hard-deleted
-- (its bookings cascade-removed), violating the P0-01 past-class invariant.
-- The result also varied with the caller's session timezone, which a
-- correctness-critical trigger must never do.
--
-- FIX
-- ---
-- Anchor the naive class end value to the gym's business timezone BEFORE the
-- comparison:
--
--     v_class_ended := ((OLD.date + OLD.end_time)
--                        AT TIME ZONE 'Europe/Bucharest') < now();
--
-- `(timestamp without time zone) AT TIME ZONE 'Europe/Bucharest'` returns a
-- `timestamptz`: it interprets the naive value AS Europe/Bucharest local
-- wall-clock and produces the corresponding absolute instant (the
-- local-wall-clock -> instant direction, NOT the inverse). Postgres applies
-- the correct historical/seasonal offset for the class's own date via the
-- IANA zone (EET vs EEST) - no fixed offset is hard-coded. The comparison is
-- then `timestamptz < timestamptz`, which is identical under any session
-- timezone.
--
-- 'Europe/Bucharest' is hard-coded deliberately. Forge today runs a single
-- gym physically in Romania and has no `gyms.timezone` column. This constant
-- is an explicit current-product constraint for that single-gym deployment -
-- it is NOT a claim that the platform is generically multi-timezone-safe.
-- Introducing a stored per-gym timezone / broader timezone architecture is
-- intentionally out of scope for this migration.
--
-- SCOPE
-- -----
-- Exactly one function changes (CREATE OR REPLACE, same name). The trigger
-- `classes_enforce_deletion_policy_trg` already points at it and is
-- unchanged. No schema change, no new trigger, no data change. SECURITY
-- DEFINER, search_path, language, and every policy branch are identical to
-- 20260825130000 - only the one boundary expression and its comment differ.
-- The `< now()` operator is deliberately NOT changed (this migration fixes
-- timezone interpretation only, it does not redefine when a class is "past").

CREATE OR REPLACE FUNCTION "public"."enforce_class_deletion_policy"()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_booking_count int;
  v_checked_in_count int;
  v_class_ended boolean;
BEGIN
  SELECT count(*), count(*) FILTER (WHERE checked_in)
    INTO v_booking_count, v_checked_in_count
    FROM bookings WHERE class_id = OLD.id::text;

  IF v_booking_count = 0 THEN
    RETURN OLD;
  END IF;

  -- Invariant: real recorded attendance can NEVER be destroyed by a class
  -- deletion, unconditionally, regardless of the class's date/time.
  IF v_checked_in_count > 0 THEN
    RAISE EXCEPTION 'cannot delete this class: % booking(s) have recorded attendance (checked_in) - this would destroy attendance history', v_checked_in_count;
  END IF;

  -- Invariant: "past" is the class's actual scheduled end (date + end_time),
  -- not merely its calendar date - a class earlier today that has already
  -- ended is historical even though `date` still equals today.
  --
  -- `date + end_time` is a naive gym-local wall-clock timestamp. It MUST be
  -- anchored to the gym's business timezone before being compared with now()
  -- (a timestamptz); otherwise Postgres coerces it using the DB session
  -- timezone (UTC in production), classifying a class as "past" 2-3h too
  -- late. 'Europe/Bucharest' is an explicit single-gym-deployment constant
  -- (Forge has one gym, in Romania; there is no gyms.timezone column) - it
  -- is NOT a generic multi-timezone guarantee. The IANA zone applies the
  -- correct EET/EEST offset for the class's own date automatically.
  v_class_ended := ((OLD.date + OLD.end_time) AT TIME ZONE 'Europe/Bucharest') < now();

  IF v_class_ended THEN
    RAISE EXCEPTION 'cannot delete a past class with % existing booking(s) - this would destroy historical attendance data', v_booking_count;
  END IF;

  -- Not yet ended, no recorded attendance - safe to remove these bookings
  -- atomically with the class itself (same transaction, BEFORE DELETE row
  -- trigger - either both succeed or neither does).
  DELETE FROM bookings WHERE class_id = OLD.id::text;

  RETURN OLD;
END;
$$;

COMMENT ON FUNCTION "public"."enforce_class_deletion_policy"() IS 'P0-01 (Forge Platform Audit), corrected per follow-up verification - BEFORE DELETE ON classes. A booking with checked_in=true is NEVER deletable via class deletion, unconditionally. A class is classified past/future by its actual scheduled end (date + end_time) compared to now(); the naive local date+time is anchored to Europe/Bucharest (single-gym Romania deployment constant, no gyms.timezone column exists) before comparison so the result does not depend on the DB session timezone - P0-01 SQL timezone follow-up, 20260828120000. Past class + any bookings -> blocked. Future/not-yet-ended class + bookings (none checked in) -> bookings atomically removed alongside the class. Prevents any new orphaned bookings.class_id row via any of the existing class-delete code paths.';
