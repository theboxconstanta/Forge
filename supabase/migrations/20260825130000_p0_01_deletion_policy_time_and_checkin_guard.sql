-- P0-01 follow-up correction (two edge cases requested after initial
-- verification of 20260825120000):
--
-- 1. The original policy classified "past vs future" using
--    `OLD.date < current_date` - a DATE-ONLY comparison. A class scheduled
--    for TODAY that already ended hours ago (e.g. a 07:00 class, checked at
--    20:00) still has `date = current_date`, so it incorrectly fell into
--    the "future, safe to cascade" branch. Fixed: the boundary is now the
--    class's actual scheduled end (`OLD.date + OLD.end_time`), compared
--    against `now()` - a full datetime comparison, not a date-only one.
--    (Session/DB timezone is UTC, confirmed live - the naive
--    `date + time` value is compared against `now()` in that timezone,
--    same convention every other date/time comparison on this table
--    already uses, e.g. enforce_subscription_sessions comparing
--    classes.date directly - not a new timezone assumption introduced
--    here, see the Phase 33 audit finding for the platform-wide context.)
--
-- 2. There was no check at all for `bookings.checked_in = true` - a
--    same-day-or-future class (by the old date-only boundary) with a
--    booking that already has REAL recorded attendance could still have
--    that booking cascade-deleted. Fixed: a booking with `checked_in =
--    true` now blocks deletion UNCONDITIONALLY, checked first, before and
--    independent of the date/time comparison above - this record must
--    never be destroyed by a class deletion under any circumstance,
--    matching the explicit requirement verbatim ("regardless of
--    date/time"). A future class should never actually have a
--    checked_in=true row today, but this guard is defensive: if one
--    somehow exists (e.g. the class's own date/time was edited after
--    check-in), it is still protected.
--
-- Only this one function changes (CREATE OR REPLACE, same name - the
-- trigger itself, `classes_enforce_deletion_policy_trg`, already points at
-- it and needs no change). No new trigger, no schema change, no column
-- added. The two policy branches from 20260825120000 (RESTRICT past+
-- bookings / CASCADE future+bookings / allow zero-bookings) are otherwise
-- unchanged in spirit - only their boundary conditions are corrected.

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
  v_class_ended := (OLD.date + OLD.end_time) < now();

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

COMMENT ON FUNCTION "public"."enforce_class_deletion_policy"() IS 'P0-01 (Forge Platform Audit), corrected per follow-up verification - BEFORE DELETE ON classes. A booking with checked_in=true is NEVER deletable via class deletion, unconditionally. A class is classified past/future by its actual scheduled end (date + end_time) compared to now(), not by calendar date alone. Past class + any bookings -> blocked. Future/not-yet-ended class + bookings (none checked in) -> bookings atomically removed alongside the class. Prevents any new orphaned bookings.class_id row via any of the existing class-delete code paths.';
