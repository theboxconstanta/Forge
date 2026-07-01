-- Lets a member fix a personal_records entry they logged wrong, and edit the
-- definition (name/format/movements) of a custom Hero WOD they created via
-- the PR-uri screen (src/App.jsx). Built-in Hero WODs (Murph, Fran, etc.)
-- stay fixed JS constants and are never editable.

DROP POLICY IF EXISTS "personal_records_update_own" ON personal_records;
CREATE POLICY "personal_records_update_own" ON personal_records FOR UPDATE TO authenticated USING (member_id = auth.uid()) WITH CHECK (member_id = auth.uid());

-- Split the single `description` blob into `format` (first line, rendered as
-- the bold header in the UI) and `movements` (remaining lines) so the edit
-- screen can prefill the two inputs unambiguously instead of re-parsing text.
ALTER TABLE custom_hero_wods ADD COLUMN IF NOT EXISTS format text;
ALTER TABLE custom_hero_wods ADD COLUMN IF NOT EXISTS movements text;
UPDATE custom_hero_wods
SET format = split_part(description, E'\n', 1),
    movements = NULLIF(substring(description from length(split_part(description, E'\n', 1)) + 2), '')
WHERE description IS NOT NULL;
ALTER TABLE custom_hero_wods DROP COLUMN IF EXISTS description;

DROP POLICY IF EXISTS "custom_hero_wods_update_own" ON custom_hero_wods;
CREATE POLICY "custom_hero_wods_update_own" ON custom_hero_wods FOR UPDATE TO authenticated USING (member_id = auth.uid()) WITH CHECK (member_id = auth.uid());
