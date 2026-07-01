-- Per-member weight unit preference (kg/lbs) for displaying Personal Records.
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS weight_unit text NOT NULL DEFAULT 'kg';
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'profiles_weight_unit_check'
  ) THEN
    ALTER TABLE profiles ADD CONSTRAINT profiles_weight_unit_check CHECK (weight_unit IN ('kg', 'lbs'));
  END IF;
END $$;
