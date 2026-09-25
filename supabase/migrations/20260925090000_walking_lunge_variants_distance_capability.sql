-- WALKING LUNGE VARIANTS - REPS OR METERS (+ OPTIONAL LOAD).
--
-- Follow-up to 20260921110000_walking_lunge_distance_capability.sql, which
-- added 'distance' to the plain "Walking Lunge" row only. This extends the
-- same data-only change to the two remaining Walking Lunge catalog rows so a
-- coach can prescribe either "20 Dumbbell Walking Lunge @ 15/10 kg" or
-- "100 m Dumbbell Walking Lunge @ 15/10 kg" on the SAME movement.
--
-- No code change is needed: both Composers already offer a Reps|Distance
-- toggle whenever a movement allows more than one quantity metric, the
-- toggle drops the inactive quantity and keeps load, and the renderer /
-- legacy lines / V2 mirror / scaling / AI-provenance diff are all
-- metric-driven (distance is proven by Row/Run/Walking Lunge).
--
-- Scope (audited against the live catalog 2026-09-25):
--   c0b998ec-dca3-4f30-a5b4-d4cbdd4328d9  Dumbbell Walking Lunge
--       ['reps','load']      default 'load'  -> ['reps','load','distance']
--   aee1320c-13a5-4bae-b520-30de914c00ae  Overhead Walking Lunge
--       ['reps']             default 'reps'  -> ['reps','distance']
--   c9248ce3-65d6-4262-95c3-70aaa69d77fe  Walking Lunge
--       already ['distance','reps'] - listed for completeness, no-op
--
-- 'distance' is APPENDED (existing order kept), default_prescription_metric
-- is NOT touched, load is neither added nor removed. Every other lunge row
-- (Lunge, Reverse/Jumping/Overhead/Front Rack/Barbell/DB/KB... Lunge) is
-- untouched. Rows are matched by UUID AND exact name, and only when distance
-- is absent, so re-running this is a no-op. No workout, log or snapshot data
-- is touched - historical prescriptions resolve from their own frozen data.

UPDATE public.movements
SET allowed_prescription_metrics = allowed_prescription_metrics || ARRAY['distance']::text[]
WHERE (id, name) IN (
    ('c0b998ec-dca3-4f30-a5b4-d4cbdd4328d9'::uuid, 'Dumbbell Walking Lunge'),
    ('aee1320c-13a5-4bae-b520-30de914c00ae'::uuid, 'Overhead Walking Lunge'),
    ('c9248ce3-65d6-4262-95c3-70aaa69d77fe'::uuid, 'Walking Lunge')
  )
  AND NOT ('distance' = ANY (allowed_prescription_metrics));
