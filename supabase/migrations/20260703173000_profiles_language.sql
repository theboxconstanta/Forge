-- Suport pentru a doua limba (engleza) - comutata manual din Profil, persistata
-- pe cont. Fara schimbare RLS necesara: profiles_update_own (id = auth.uid())
-- acopera deja orice coloana noua, la fel ca weight_unit.

ALTER TABLE profiles ADD COLUMN IF NOT EXISTS language text DEFAULT 'ro';
