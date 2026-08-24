-- P0-01 (Forge Platform Audit, FORGE_PLATFORM_AUDIT_PHASE28_44.md, Phase 35) -
-- class deletion could silently orphan `bookings` rows, with ZERO database-
-- level protection: `bookings.class_id` is `text` (confirmed live via
-- information_schema), `classes.id` is `uuid` - a genuine type mismatch that
-- meant a native FOREIGN KEY was never even possible without a bigger,
-- riskier column-type migration (Postgres cannot create a FK across
-- incompatible types). All three existing class-delete code paths
-- (stergeClasa/stergeSeria/stergeClaseleTrecute, App.jsx) hard-delete
-- `classes` rows without ever touching the `bookings` rows that reference
-- them - confirmed via direct code trace, not assumed.
--
-- Read-only production audit (before writing this migration, per the
-- mission's own explicit instruction) found 480 PRE-EXISTING orphaned
-- bookings today, spanning 104 distinct already-deleted classes and 51
-- members, dating back to 2026-06-24 - including 38 rows with
-- checked_in=true (real attendance history, currently invisible to
-- get_class_summary/get_attendance_summary and any other report that joins
-- bookings->classes, since the join silently drops them). This migration
-- does NOT touch those 480 existing rows - deciding their remediation
-- (re-associate/archive/delete) requires explicit user sign-off per this
-- project's own standing rule on destructive treatment of real production
-- data; it is reported, not resolved, here. This migration is purely
-- forward-looking: it makes it structurally impossible to create ANY new
-- orphaned booking going forward.
--
-- Business policy chosen (HYBRID, not a blanket CASCADE or RESTRICT):
-- confirmed via schema/code trace that `bookings` rows ARE real historical
-- business data (get_attendance_summary/get_class_summary join them against
-- `classes.date`/`classes.name` for gym-wide attendance-rate/trend
-- reporting; `checked_in`/`no_show` only carry real meaning for a class
-- that has already happened) - so a PAST class with existing bookings must
-- never be silently destroyed. A FUTURE (or today's, matching the exact
-- `date >= current_date` boundary the existing app-level refund logic in
-- stergeClasa/stergeSeria already uses) class's bookings carry no
-- attendance history yet (nothing has happened), so cascading their
-- deletion alongside the class is safe and correct - the alternative
-- (RESTRICT for future classes too) would make the existing "delete a class
-- with future bookings" admin action (which already correctly refunds
-- session credits first, unchanged by this migration) impossible to
-- complete at all, a real regression this migration must not introduce.
--
-- SECURITY DEFINER matches enforce_class_capacity()/
-- enforce_subscription_sessions()'s own established precedent in this exact
-- table - the trigger's own internal DELETE FROM bookings must succeed
-- regardless of RLS visibility subtleties for the calling coach/admin,
-- without granting them any NEW capability beyond what they're already
-- authorized to do: RLS (`classes_admin_delete`, `is_coach_or_admin(gym_id)`)
-- still gates whether the DELETE ON classes is even reachable in the first
-- place - this trigger only decides what happens to bookings AS PART OF an
-- already-authorized class deletion, it does not itself grant delete access
-- to anyone.

CREATE OR REPLACE FUNCTION "public"."enforce_class_deletion_policy"()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_booking_count int;
BEGIN
  SELECT count(*) INTO v_booking_count FROM bookings WHERE class_id = OLD.id::text;

  IF v_booking_count = 0 THEN
    RETURN OLD;
  END IF;

  IF OLD.date < current_date THEN
    RAISE EXCEPTION 'cannot delete a past class with % existing booking(s) - this would destroy historical attendance data', v_booking_count;
  END IF;

  -- Future (or today's) class with bookings - nothing has happened yet for
  -- these bookings (checked_in/no_show are not yet meaningful), so it is
  -- safe to remove them atomically with the class itself. This runs in the
  -- SAME transaction as the outer DELETE FROM classes (a BEFORE DELETE row
  -- trigger), so either both succeed or neither does - no partial state.
  DELETE FROM bookings WHERE class_id = OLD.id::text;

  RETURN OLD;
END;
$$;

COMMENT ON FUNCTION "public"."enforce_class_deletion_policy"() IS 'P0-01 (Forge Platform Audit) - BEFORE DELETE ON classes. Blocks deletion of a past class that still has bookings (real attendance history), and atomically removes bookings for a future/today class being deleted (no attendance history exists yet for those). Prevents ANY new orphaned bookings.class_id row from being created via class deletion, regardless of which of the three existing delete code paths (single class/series/bulk-past) triggers it.';

DROP TRIGGER IF EXISTS "classes_enforce_deletion_policy_trg" ON "public"."classes";
CREATE TRIGGER "classes_enforce_deletion_policy_trg"
  BEFORE DELETE ON "public"."classes"
  FOR EACH ROW EXECUTE FUNCTION "public"."enforce_class_deletion_policy"();
