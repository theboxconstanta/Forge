-- wods a primit SELECT/INSERT/DELETE (20260701_enable_rls_core_tables.sql) dar
-- niciodata o politica UPDATE. saveWod (App.jsx) editeaza un WOD existent cu
-- supabase.from('wods').update(payload).eq('id', editWodId) - fara politica
-- UPDATE, RLS blocheaza silentios orice update (0 randuri afectate, fara
-- eroare), deci numele/durata/tipul editate de admin nu ajungeau niciodata in
-- baza de date, desi UI-ul arata "✓ WOD actualizat!".

DROP POLICY IF EXISTS "wods_admin_update" ON wods;
CREATE POLICY "wods_admin_update" ON wods FOR UPDATE TO authenticated USING (is_admin()) WITH CHECK (is_admin());
