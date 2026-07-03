-- Adminul are nevoie sa listeze/adauge/scoata coach-i din UI (tab Setari) -
-- pana acum `coaches` avea doar o politica de SELECT pe randul propriu
-- (coaches_select_own, adaugata la crearea tabelului), nicio politica nu
-- permitea listarea tuturor sau scriere. Doar is_admin() - un coach nu
-- poate promova/scoate alti coach-i.

DROP POLICY IF EXISTS "coaches_admin_select_all" ON coaches;
CREATE POLICY "coaches_admin_select_all" ON coaches FOR SELECT TO authenticated USING (is_admin());

DROP POLICY IF EXISTS "coaches_admin_insert" ON coaches;
CREATE POLICY "coaches_admin_insert" ON coaches FOR INSERT TO authenticated WITH CHECK (is_admin());

DROP POLICY IF EXISTS "coaches_admin_delete" ON coaches;
CREATE POLICY "coaches_admin_delete" ON coaches FOR DELETE TO authenticated USING (is_admin());
