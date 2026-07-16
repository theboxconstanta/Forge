-- Lets a member define their own named "Hero WOD" benchmarks (name + movement
-- list) from the PR-uri screen, alongside the built-in HERO_WODS_INFO list in
-- src/App.jsx. A member only ever reads/inserts/deletes their own custom WODs.

CREATE TABLE IF NOT EXISTS custom_hero_wods (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  member_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  name text NOT NULL,
  description text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS custom_hero_wods_member_name_idx
  ON custom_hero_wods (member_id, lower(name));

ALTER TABLE custom_hero_wods ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "custom_hero_wods_select_own" ON custom_hero_wods;
DROP POLICY IF EXISTS "custom_hero_wods_insert_own" ON custom_hero_wods;
DROP POLICY IF EXISTS "custom_hero_wods_delete_own" ON custom_hero_wods;
CREATE POLICY "custom_hero_wods_select_own" ON custom_hero_wods FOR SELECT TO authenticated USING (member_id = auth.uid());
CREATE POLICY "custom_hero_wods_insert_own" ON custom_hero_wods FOR INSERT TO authenticated WITH CHECK (member_id = auth.uid());
CREATE POLICY "custom_hero_wods_delete_own" ON custom_hero_wods FOR DELETE TO authenticated USING (member_id = auth.uid());
