-- app_settings avea o singura politica "ALL USING(true)" - fara verificare
-- de admin, orice membru autentificat putea scrie direct (INSERT/UPDATE/
-- DELETE) prin API-ul Supabase, ocolind complet interfata Admin care e
-- singurul loc din UI ce expune scrierea. Tabelul stocheaza in prezent
-- doar cancel_window_hours (fereastra de anulare a claselor, App.jsx),
-- deci impactul practic e limitat, dar accesul de scriere tot trebuie
-- restrictionat la admin - citirea ramane deschisa (toti membrii trebuie
-- sa vada regula de anulare).

DROP POLICY IF EXISTS "app_settings_all" ON app_settings;
DROP POLICY IF EXISTS "app_settings_select" ON app_settings;

CREATE POLICY "app_settings_select_all" ON app_settings FOR SELECT TO authenticated USING (true);
CREATE POLICY "app_settings_admin_insert" ON app_settings FOR INSERT TO authenticated WITH CHECK (is_admin());
CREATE POLICY "app_settings_admin_update" ON app_settings FOR UPDATE TO authenticated USING (is_admin()) WITH CHECK (is_admin());
CREATE POLICY "app_settings_admin_delete" ON app_settings FOR DELETE TO authenticated USING (is_admin());
