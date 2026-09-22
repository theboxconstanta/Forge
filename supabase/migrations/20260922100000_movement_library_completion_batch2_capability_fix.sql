-- MOVEMENT LIBRARY COMPLETION V1 - BATCH 2: assign biomechanically
-- appropriate prescription capability to 8 real movements the audit found
-- seeded with allowed_prescription_metrics = '{}' (Composer currently
-- shows a manual "None" chooser for these). Metrics-only - category/
-- equipment/movement_pattern/aliases/id all untouched, per the ticket's
-- own "preserve existing default behavior where possible" instruction.
-- Idempotent (WHERE clause re-checks the current empty state, so a
-- re-run is a no-op). No isometric hold in this batch (Plank/Wall Sit/
-- L-Sit/etc. deliberately untouched - no duration metric exists, out of
-- scope per the ticket).
--
-- Reasoning per movement (only reps/load/distance/calories - the four
-- FORGE actually supports):
--  Man Makers          - a loaded dumbbell complex (burpee+row+clean+
--                         thruster); the DB weight is the prescribed
--                         variable, matching the sibling "Dumbbell Squat
--                         Clean Thruster" complex's own reps+load/load shape.
--  Face Pull            - band/cable resistance is not a tracked "load" unit
--                         in this catalog's own convention; matches the
--                         existing "Band Pull-Apart" sibling (reps-only).
--  Lateral Raise        - a standard dumbbell isolation movement, reps+load.
--  Cuban Rotation        - a dumbbell rotator-cuff accessory movement, reps+load.
--  Pull-to-Stand         - bodyweight gymnastics skill, reps-only.
--  Skin the Cat           - bodyweight rings skill, reps-only.
--  Handstand Pirouette    - bodyweight gymnastics skill, reps-only.
--  Around the World        - typically performed with a plate/KB circled
--                         around the body; load is the prescribed variable.

update movements
set allowed_prescription_metrics = v.allowed_prescription_metrics,
    default_prescription_metric = v.default_prescription_metric
from (values
  ('Man Makers',           ARRAY['reps','load']::text[], 'load'),
  ('Face Pull',            ARRAY['reps']::text[],        'reps'),
  ('Lateral Raise',        ARRAY['reps','load']::text[], 'load'),
  ('Cuban Rotation',       ARRAY['reps','load']::text[], 'load'),
  ('Pull-to-Stand',        ARRAY['reps']::text[],        'reps'),
  ('Skin the Cat',         ARRAY['reps']::text[],        'reps'),
  ('Handstand Pirouette',  ARRAY['reps']::text[],        'reps'),
  ('Around the World',     ARRAY['reps','load']::text[], 'load')
) as v(name, allowed_prescription_metrics, default_prescription_metric)
where lower(movements.name) = lower(v.name)
  and movements.allowed_prescription_metrics = '{}';
