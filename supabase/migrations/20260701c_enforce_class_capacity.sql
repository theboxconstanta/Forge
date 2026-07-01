-- Class capacity (max_spots) was only ever checked client-side (App.jsx:3107-
-- 3110, using a locally cached booking count) before inserting into bookings.
-- With no DB-level guard, a stale cache or two near-simultaneous bookings can
-- both insert, overfilling a class (e.g. showing 2/1). This adds a trigger
-- that locks the class row (serializing concurrent bookings for the same
-- class) and rejects an insert once the class is full. Applies uniformly to
-- self-bookings, admin bookings, and the waitlist auto-book insert - the
-- latter is only ever attempted after a spot has actually freed up, so it
-- still passes.
--
-- SECURITY DEFINER is required here: a plain member has no UPDATE policy on
-- classes, so under the caller's own RLS context "SELECT ... FOR UPDATE"
-- silently returns zero rows (not an error) rather than the class row. This
-- function must bypass RLS to reliably see the real capacity/count
-- regardless of who's making the booking - otherwise "class not found"
-- becomes indistinguishable from "no capacity limit", which fails open.

CREATE OR REPLACE FUNCTION enforce_class_capacity()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_max_spots int;
  v_count int;
BEGIN
  SELECT max_spots INTO v_max_spots FROM classes WHERE id::text = NEW.class_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'class % does not exist', NEW.class_id;
  END IF;
  IF v_max_spots IS NULL THEN
    RETURN NEW;
  END IF;
  SELECT count(*) INTO v_count FROM bookings WHERE class_id = NEW.class_id;
  IF v_count >= v_max_spots THEN
    RAISE EXCEPTION 'class % is full (% / %)', NEW.class_id, v_count, v_max_spots;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS bookings_enforce_capacity_trg ON bookings;
CREATE TRIGGER bookings_enforce_capacity_trg
  BEFORE INSERT ON bookings
  FOR EACH ROW EXECUTE FUNCTION enforce_class_capacity();
