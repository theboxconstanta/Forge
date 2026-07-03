-- Rol de coach, separat de admin: acces DOAR la wods/classes/bookings/class_reminders
-- (tab-urile WOD + Clase din Admin), nu la subscriptions/subscription_plans/app_settings.
-- Tabelul `coaches` are aceeasi forma si acelasi tipar de provizionare ca `admins`
-- (nicio politica de INSERT - randuri adaugate manual prin SQL/dashboard).

CREATE TABLE IF NOT EXISTS coaches (
  id uuid PRIMARY KEY REFERENCES auth.users(id),
  email text,
  created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE coaches ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "coaches_select_own" ON coaches;
CREATE POLICY "coaches_select_own" ON coaches FOR SELECT TO authenticated USING (id = auth.uid());

CREATE OR REPLACE FUNCTION is_coach_or_admin()
RETURNS boolean LANGUAGE sql STABLE AS $$
  SELECT is_admin() OR EXISTS (SELECT 1 FROM coaches WHERE id = auth.uid());
$$;

-- wods (tab WOD)
DROP POLICY IF EXISTS "wods_admin_insert" ON wods;
DROP POLICY IF EXISTS "wods_admin_update" ON wods;
DROP POLICY IF EXISTS "wods_admin_delete" ON wods;
CREATE POLICY "wods_admin_insert" ON wods FOR INSERT TO authenticated WITH CHECK (is_coach_or_admin());
CREATE POLICY "wods_admin_update" ON wods FOR UPDATE TO authenticated USING (is_coach_or_admin()) WITH CHECK (is_coach_or_admin());
CREATE POLICY "wods_admin_delete" ON wods FOR DELETE TO authenticated USING (is_coach_or_admin());

-- classes (tab Clase)
DROP POLICY IF EXISTS "classes_admin_insert" ON classes;
DROP POLICY IF EXISTS "classes_admin_delete" ON classes;
CREATE POLICY "classes_admin_insert" ON classes FOR INSERT TO authenticated WITH CHECK (is_coach_or_admin());
CREATE POLICY "classes_admin_delete" ON classes FOR DELETE TO authenticated USING (is_coach_or_admin());

-- bookings (checkin + adauga/scoate manual din lista) - pastreaza clauza "member_id = auth.uid()" verbatim
DROP POLICY IF EXISTS "bookings_insert_own_or_admin" ON bookings;
DROP POLICY IF EXISTS "bookings_delete_own_or_admin" ON bookings;
DROP POLICY IF EXISTS "bookings_admin_update" ON bookings;
CREATE POLICY "bookings_insert_own_or_admin" ON bookings FOR INSERT TO authenticated WITH CHECK (member_id = auth.uid() OR is_coach_or_admin());
CREATE POLICY "bookings_delete_own_or_admin" ON bookings FOR DELETE TO authenticated USING (member_id = auth.uid() OR is_coach_or_admin());
CREATE POLICY "bookings_admin_update" ON bookings FOR UPDATE TO authenticated USING (is_coach_or_admin()) WITH CHECK (is_coach_or_admin());

-- class_reminders (efect secundar la adauga/scoate din lista)
DROP POLICY IF EXISTS "class_reminders_select_own_or_admin_or_recent_booking" ON class_reminders;
DROP POLICY IF EXISTS "class_reminders_insert_own_or_admin_or_recent_booking" ON class_reminders;
DROP POLICY IF EXISTS "class_reminders_update_own_or_admin_or_recent_booking" ON class_reminders;
DROP POLICY IF EXISTS "class_reminders_delete_own_or_admin" ON class_reminders;
CREATE POLICY "class_reminders_select_own_or_admin_or_recent_booking" ON class_reminders FOR SELECT TO authenticated
  USING (is_coach_or_admin() OR lower(member_email) = lower(auth.jwt() ->> 'email')
    OR EXISTS (SELECT 1 FROM bookings b JOIN profiles p ON p.id = b.member_id
               WHERE lower(p.email) = lower(class_reminders.member_email) AND b.created_at > now() - interval '30 seconds'));
CREATE POLICY "class_reminders_insert_own_or_admin_or_recent_booking" ON class_reminders FOR INSERT TO authenticated
  WITH CHECK (is_coach_or_admin() OR lower(member_email) = lower(auth.jwt() ->> 'email')
    OR EXISTS (SELECT 1 FROM bookings b JOIN profiles p ON p.id = b.member_id
               WHERE lower(p.email) = lower(class_reminders.member_email) AND b.created_at > now() - interval '30 seconds'));
CREATE POLICY "class_reminders_update_own_or_admin_or_recent_booking" ON class_reminders FOR UPDATE TO authenticated
  USING (is_coach_or_admin() OR lower(member_email) = lower(auth.jwt() ->> 'email')
    OR EXISTS (SELECT 1 FROM bookings b JOIN profiles p ON p.id = b.member_id
               WHERE lower(p.email) = lower(class_reminders.member_email) AND b.created_at > now() - interval '30 seconds'))
  WITH CHECK (is_coach_or_admin() OR lower(member_email) = lower(auth.jwt() ->> 'email')
    OR EXISTS (SELECT 1 FROM bookings b JOIN profiles p ON p.id = b.member_id
               WHERE lower(p.email) = lower(class_reminders.member_email) AND b.created_at > now() - interval '30 seconds'));
CREATE POLICY "class_reminders_delete_own_or_admin" ON class_reminders FOR DELETE TO authenticated
  USING (is_coach_or_admin() OR lower(member_email) = lower(auth.jwt() ->> 'email'));
