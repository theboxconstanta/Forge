-- MOVEMENT LIBRARY COMPLETION V1 - BATCH 1: 10 genuinely missing movements,
-- identified by the comprehensive 465-movement catalog audit this session
-- and owner-approved. Idempotent (INSERT ... WHERE NOT EXISTS), additive
-- only - no existing row touched, no id changed, no historical workout
-- affected (movements are referenced by id in frozen prescriptions/
-- snapshots, never by live catalog state).
--
-- Movements 1-6: exact category/equipment/pattern/metrics/default from the
-- approved forensic, unchanged.
-- Movements 7-10: metadata verified against the closest existing sibling
-- row's own convention immediately before this migration (Dumbbell
-- Overhead Squat -> Single Arm Overhead Squat; Deadlift/Sumo Deadlift ->
-- Trap Bar Deadlift; Back Extension -> Nordic Curl; Box Jump/Tuck Jump's
-- own "bodyweight, no equipment, no pattern, reps-only" shape -> Skater
-- Jump). No unsupported metric invented; no isometric-hold/duration work.
--
-- Every name re-checked live, immediately before writing this file, for
-- an exact case-insensitive match AND for a normalized-key collision
-- (db/dumbbell, kb/kettlebell, &/and, depluralization) against the full
-- catalog - zero collisions found for any of the 10.

insert into movements (gym_id, name, aliases, equipment, category, movement_pattern, allowed_prescription_metrics, default_prescription_metric, created_by)
select null, v.name, v.aliases, v.equipment, v.category, v.movement_pattern, v.allowed_prescription_metrics, v.default_prescription_metric, null
from (values
  ('Dumbbell Hang Power Clean And Jerk', ARRAY[]::text[], 'dumbbell', 'dumbbell', 'olympic', ARRAY['reps','load']::text[], 'load'),
  ('Dumbbell Hang Squat Clean And Jerk', ARRAY[]::text[], 'dumbbell', 'dumbbell', 'olympic', ARRAY['reps','load']::text[], 'load'),
  ('Squat Jump',                        ARRAY[]::text[], null,       'bodyweight', 'squat',  ARRAY['reps']::text[],        'reps'),
  ('Box Jump Down',                     ARRAY[]::text[], 'box',      'bodyweight', 'squat',  ARRAY['reps']::text[],        'reps'),
  ('Weighted Dip',                      ARRAY[]::text[], null,       'gymnastics', 'push',   ARRAY['reps','load']::text[], 'load'),
  ('Strict Ring Dip',                   ARRAY[]::text[], 'rings',    'gymnastics', 'push',   ARRAY['reps','load']::text[], 'load'),
  ('Single Arm Overhead Squat',         ARRAY[]::text[], 'dumbbell', 'dumbbell',   'squat',  ARRAY['reps','load']::text[], 'load'),
  ('Trap Bar Deadlift',                 ARRAY[]::text[], 'trap bar', 'barbell',    'hinge',  ARRAY['reps','load']::text[], 'load'),
  ('Nordic Curl',                       ARRAY[]::text[], null,       'gymnastics', 'hinge',  ARRAY['reps']::text[],        'reps'),
  ('Skater Jump',                       ARRAY[]::text[], null,       'bodyweight', null,     ARRAY['reps']::text[],        'reps')
) as v(name, aliases, equipment, category, movement_pattern, allowed_prescription_metrics, default_prescription_metric)
where not exists (select 1 from movements m where lower(m.name) = lower(v.name));
