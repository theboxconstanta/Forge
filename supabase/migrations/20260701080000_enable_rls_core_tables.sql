-- Enables RLS on tables that currently have none (wod_logs, bookings, classes,
-- wods, profiles, personal_records, subscription_plans, subscriptions, members,
-- admins), so the public anon key can no longer read/write every member's data.
-- Policies mirror the actual query patterns in src/App.jsx (see PROJECT_STATE.md).

CREATE OR REPLACE FUNCTION is_admin()
RETURNS boolean
LANGUAGE sql
STABLE
AS $$
  SELECT EXISTS (SELECT 1 FROM admins WHERE id = auth.uid());
$$;

-- admins: a member only ever checks their own row (isAdmin flag). Never listed
-- or written from the frontend.
ALTER TABLE admins ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "admins_select_own" ON admins;
CREATE POLICY "admins_select_own" ON admins FOR SELECT TO authenticated USING (id = auth.uid());

-- members: legacy/unused table (PROJECT_STATE.md), no frontend query touches it.
-- Lock it down completely; add policies later if it's revived.
ALTER TABLE members ENABLE ROW LEVEL SECURITY;

-- profiles: everyone reads everyone's profile (leaderboard, class roster, feed
-- author names); a member only ever writes their own row.
ALTER TABLE profiles ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "profiles_select_all" ON profiles;
DROP POLICY IF EXISTS "profiles_insert_own" ON profiles;
DROP POLICY IF EXISTS "profiles_update_own" ON profiles;
CREATE POLICY "profiles_select_all" ON profiles FOR SELECT TO authenticated USING (true);
CREATE POLICY "profiles_insert_own" ON profiles FOR INSERT TO authenticated WITH CHECK (id = auth.uid());
CREATE POLICY "profiles_update_own" ON profiles FOR UPDATE TO authenticated USING (id = auth.uid()) WITH CHECK (id = auth.uid());

-- classes: schedule is a shared read; only admins create/delete classes.
ALTER TABLE classes ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "classes_select_all" ON classes;
DROP POLICY IF EXISTS "classes_admin_insert" ON classes;
DROP POLICY IF EXISTS "classes_admin_delete" ON classes;
CREATE POLICY "classes_select_all" ON classes FOR SELECT TO authenticated USING (true);
CREATE POLICY "classes_admin_insert" ON classes FOR INSERT TO authenticated WITH CHECK (is_admin());
CREATE POLICY "classes_admin_delete" ON classes FOR DELETE TO authenticated USING (is_admin());

-- wods: WOD-of-the-day / leaderboard is a shared read; only admins publish/delete.
ALTER TABLE wods ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "wods_select_all" ON wods;
DROP POLICY IF EXISTS "wods_admin_insert" ON wods;
DROP POLICY IF EXISTS "wods_admin_delete" ON wods;
CREATE POLICY "wods_select_all" ON wods FOR SELECT TO authenticated USING (true);
CREATE POLICY "wods_admin_insert" ON wods FOR INSERT TO authenticated WITH CHECK (is_admin());
CREATE POLICY "wods_admin_delete" ON wods FOR DELETE TO authenticated USING (is_admin());

-- bookings: class rosters are a shared read; members manage their own booking,
-- admins can book/cancel for anyone and toggle check-in. The pre-existing
-- "Waitlist auto-book" INSERT policy is kept as-is (any authenticated member's
-- browser can promote someone else from the waitlist - see project memory on
-- waitlist auto-booking) and combines with the new policy below via OR.
ALTER TABLE bookings ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Admin can delete any booking" ON bookings;
DROP POLICY IF EXISTS "bookings_select_all" ON bookings;
DROP POLICY IF EXISTS "bookings_insert_own_or_admin" ON bookings;
DROP POLICY IF EXISTS "bookings_delete_own_or_admin" ON bookings;
DROP POLICY IF EXISTS "bookings_admin_update" ON bookings;
CREATE POLICY "bookings_select_all" ON bookings FOR SELECT TO authenticated USING (true);
CREATE POLICY "bookings_insert_own_or_admin" ON bookings FOR INSERT TO authenticated WITH CHECK (member_id = auth.uid() OR is_admin());
CREATE POLICY "bookings_delete_own_or_admin" ON bookings FOR DELETE TO authenticated USING (member_id = auth.uid() OR is_admin());
CREATE POLICY "bookings_admin_update" ON bookings FOR UPDATE TO authenticated USING (is_admin()) WITH CHECK (is_admin());

-- wod_logs: leaderboard needs to read everyone's logs; a member only
-- inserts/edits/deletes their own. (The UPDATE policy already existed but was
-- inert because RLS was off on this table.)
ALTER TABLE wod_logs ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Members can update own wod logs" ON wod_logs;
DROP POLICY IF EXISTS "wod_logs_select_all" ON wod_logs;
DROP POLICY IF EXISTS "wod_logs_insert_own" ON wod_logs;
DROP POLICY IF EXISTS "wod_logs_update_own" ON wod_logs;
DROP POLICY IF EXISTS "wod_logs_delete_own" ON wod_logs;
CREATE POLICY "wod_logs_select_all" ON wod_logs FOR SELECT TO authenticated USING (true);
CREATE POLICY "wod_logs_insert_own" ON wod_logs FOR INSERT TO authenticated WITH CHECK (member_id = auth.uid());
CREATE POLICY "wod_logs_update_own" ON wod_logs FOR UPDATE TO authenticated USING (member_id = auth.uid()) WITH CHECK (member_id = auth.uid());
CREATE POLICY "wod_logs_delete_own" ON wod_logs FOR DELETE TO authenticated USING (member_id = auth.uid());

-- personal_records: a member only ever reads/inserts their own PRs. No
-- update/delete path exists in the frontend, so none is granted.
ALTER TABLE personal_records ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "personal_records_select_own" ON personal_records;
DROP POLICY IF EXISTS "personal_records_insert_own" ON personal_records;
CREATE POLICY "personal_records_select_own" ON personal_records FOR SELECT TO authenticated USING (member_id = auth.uid());
CREATE POLICY "personal_records_insert_own" ON personal_records FOR INSERT TO authenticated WITH CHECK (member_id = auth.uid());

-- subscription_plans: active plans are a shared read (pricing); only admins
-- create or soft-delete (is_active = false) plans.
ALTER TABLE subscription_plans ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "subscription_plans_select_all" ON subscription_plans;
DROP POLICY IF EXISTS "subscription_plans_admin_insert" ON subscription_plans;
DROP POLICY IF EXISTS "subscription_plans_admin_update" ON subscription_plans;
CREATE POLICY "subscription_plans_select_all" ON subscription_plans FOR SELECT TO authenticated USING (true);
CREATE POLICY "subscription_plans_admin_insert" ON subscription_plans FOR INSERT TO authenticated WITH CHECK (is_admin());
CREATE POLICY "subscription_plans_admin_update" ON subscription_plans FOR UPDATE TO authenticated USING (is_admin()) WITH CHECK (is_admin());

-- subscriptions: NOT keyed by member_id (that column holds the admin who
-- created the record, per PROJECT_STATE.md) - ownership is via member_email.
-- Members read/update their own row (session count only) when booking or
-- cancelling a class themselves. The waitlist auto-book flow (App.jsx:79-90)
-- runs from a DIFFERENT member's browser and increments the promoted member's
-- session count, so it's allowed when a booking for that member was just
-- created (which itself requires proof of a real waitlist entry via the
-- existing "Waitlist auto-book" policy on bookings). All other writes
-- (activating/cancelling plans, adjusting totals) are admin-only.
ALTER TABLE subscriptions ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "subscriptions_select_own_or_admin" ON subscriptions;
DROP POLICY IF EXISTS "subscriptions_admin_insert" ON subscriptions;
DROP POLICY IF EXISTS "subscriptions_admin_update" ON subscriptions;
DROP POLICY IF EXISTS "subscriptions_update_own_or_waitlist_or_admin" ON subscriptions;
DROP POLICY IF EXISTS "subscriptions_admin_delete" ON subscriptions;
CREATE POLICY "subscriptions_select_own_or_admin" ON subscriptions FOR SELECT TO authenticated USING (lower(member_email) = lower(auth.jwt() ->> 'email') OR is_admin());
CREATE POLICY "subscriptions_admin_insert" ON subscriptions FOR INSERT TO authenticated WITH CHECK (is_admin());
CREATE POLICY "subscriptions_update_own_or_waitlist_or_admin" ON subscriptions FOR UPDATE TO authenticated
  USING (
    is_admin()
    OR lower(member_email) = lower(auth.jwt() ->> 'email')
    OR EXISTS (
      SELECT 1 FROM bookings b JOIN profiles p ON p.id = b.member_id
      WHERE lower(p.email) = lower(subscriptions.member_email)
        AND b.created_at > now() - interval '30 seconds'
    )
  )
  WITH CHECK (
    is_admin()
    OR lower(member_email) = lower(auth.jwt() ->> 'email')
    OR EXISTS (
      SELECT 1 FROM bookings b JOIN profiles p ON p.id = b.member_id
      WHERE lower(p.email) = lower(subscriptions.member_email)
        AND b.created_at > now() - interval '30 seconds'
    )
  );
CREATE POLICY "subscriptions_admin_delete" ON subscriptions FOR DELETE TO authenticated USING (is_admin());

-- Members can freely update their OWN subscription row (activating a queued
-- plan touches is_active/queued/dates/sessions_used all at once - see
-- activateQueuedSubscription in App.jsx). Only the cross-member waitlist path
-- (matched solely via the "just booked for this member" EXISTS clause above)
-- is restricted to a single +1 session bump, matching what that code path
-- actually does (App.jsx:86) - this is what stops a stranger's browser from
-- using that path to also flip is_active, extend end_date, etc.
CREATE OR REPLACE FUNCTION subscriptions_restrict_member_update()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF is_admin() OR lower(OLD.member_email) = lower(auth.jwt() ->> 'email') THEN
    RETURN NEW;
  END IF;
  IF NOT (NEW.sessions_used = OLD.sessions_used + 1) THEN
    RAISE EXCEPTION 'sessions_used may only be incremented by 1 via the waitlist auto-book path';
  END IF;
  IF NEW.member_id IS DISTINCT FROM OLD.member_id
     OR NEW.member_email IS DISTINCT FROM OLD.member_email
     OR NEW.plan_id IS DISTINCT FROM OLD.plan_id
     OR NEW.start_date IS DISTINCT FROM OLD.start_date
     OR NEW.end_date IS DISTINCT FROM OLD.end_date
     OR NEW.sessions_total IS DISTINCT FROM OLD.sessions_total
     OR NEW.is_active IS DISTINCT FROM OLD.is_active
     OR NEW.queued IS DISTINCT FROM OLD.queued
     OR NEW.notes IS DISTINCT FROM OLD.notes THEN
    RAISE EXCEPTION 'the waitlist auto-book path may only change sessions_used';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS subscriptions_restrict_member_update_trg ON subscriptions;
CREATE TRIGGER subscriptions_restrict_member_update_trg
  BEFORE UPDATE ON subscriptions
  FOR EACH ROW EXECUTE FUNCTION subscriptions_restrict_member_update();
