-- personal_records a primit SELECT/INSERT (20260701_enable_rls_core_tables.sql)
-- si UPDATE (20260701h_pr_and_hero_wod_editing.sql), dar nicio politica DELETE
-- nu a fost adaugata vreodata. deleteMiscarePR (App.jsx) sterge un PR local in
-- UI si nu primeste nicio eroare de la Supabase, dar RLS blocheaza silentios
-- DELETE-ul real (0 randuri afectate, fara eroare) - la urmatorul fetch (ex.
-- reload aplicatie) PR-ul sters reapare, pentru ca nu a fost sters niciodata
-- din baza de date.

DROP POLICY IF EXISTS "personal_records_delete_own" ON personal_records;
CREATE POLICY "personal_records_delete_own" ON personal_records FOR DELETE TO authenticated USING (member_id = auth.uid());
