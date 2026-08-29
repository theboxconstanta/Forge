-- PER-MOVEMENT PRESCRIPTION ENGINE — P3b CAPABILITY SEED
--
-- Approved: PER_MOVEMENT_PRESCRIPTION_ENGINE_AUDIT_AND_ARCHITECTURE.md §C.4.
-- Deterministic seed of movements.allowed_prescription_metrics /
-- default_prescription_metric for PLATFORM movements only (gym_id IS NULL).
-- Gym-created movements are left untouched (allowed = '{}' → the resolver
-- treats them as "unknown, coach picks"). No workout / log data touched.
--
-- Priority, first match wins (each UPDATE only touches rows still at the
-- default empty '{}' so earlier = higher priority):
--   1. Explicit name overrides (machines the category data misses; movements
--      the category/pattern rule would classify wrong).
--   2. Carries → {load, distance}, default load.
--   3. Monostructural machines → run-family {distance}; erg-family
--      {distance, calories} default calories.
--   4. category / movement_pattern rules for loaded implements → {reps, load}.
--   5. category / movement_pattern rules for bodyweight / gymnastic → {reps}.
--   6. Name heuristics for the ~219 uncategorised rows.
--   7. Anything left = '{}' / NULL = explicit "unknown" (NOT a guess). Includes
--      benchmark-WOD names polluting the catalog (Amanda, Cindy, …) and
--      time-only holds (Plank, L-sit Hold, …) — correct to leave unknown.
--
-- Fully reversible:
--   UPDATE public.movements
--     SET allowed_prescription_metrics = '{}'::text[],
--         default_prescription_metric  = NULL
--   WHERE gym_id IS NULL;

BEGIN;

-- ---------------------------------------------------------------------------
-- 1. Explicit name overrides
-- ---------------------------------------------------------------------------
UPDATE public.movements SET allowed_prescription_metrics = ARRAY['calories']::text[],
                            default_prescription_metric  = 'calories'
 WHERE gym_id IS NULL AND allowed_prescription_metrics = '{}'::text[]
   AND lower(name) IN ('air bike');

UPDATE public.movements SET allowed_prescription_metrics = ARRAY['distance']::text[],
                            default_prescription_metric  = 'distance'
 WHERE gym_id IS NULL AND allowed_prescription_metrics = '{}'::text[]
   AND lower(name) IN ('assault runner', 'air runner', 'handstand walk',
                       'handstand walk over obstacle', 'bear crawl', 'sled drag',
                       'crab walk', 'broad jump');

UPDATE public.movements SET allowed_prescription_metrics = ARRAY['reps','load']::text[],
                            default_prescription_metric  = 'load'
 WHERE gym_id IS NULL AND allowed_prescription_metrics = '{}'::text[]
   AND lower(name) IN ('wall ball', 'wall ball shot', 'weighted pull-up',
                       'weighted pull up', 'weighted pullup', 'weighted dip',
                       'weighted push-up', 'odd object ground to overhead');

-- ---------------------------------------------------------------------------
-- 2. Carries — load + distance
-- ---------------------------------------------------------------------------
UPDATE public.movements SET allowed_prescription_metrics = ARRAY['load','distance']::text[],
                            default_prescription_metric  = 'load'
 WHERE gym_id IS NULL AND allowed_prescription_metrics = '{}'::text[]
   AND (movement_pattern = 'carry'
        OR name ~* '\y(carry|carries|yoke|farmer''?s?|suitcase|sled (push|pull|drag))\y');

-- ---------------------------------------------------------------------------
-- 3. Monostructural machines
-- ---------------------------------------------------------------------------
UPDATE public.movements SET allowed_prescription_metrics = ARRAY['distance']::text[],
                            default_prescription_metric  = 'distance'
 WHERE gym_id IS NULL AND allowed_prescription_metrics = '{}'::text[]
   AND category = 'monostructural'
   AND name ~* '\y(run|running|sprint|swim|shuttle|stair|kayak|paddle|runner)\y';

UPDATE public.movements SET allowed_prescription_metrics = ARRAY['distance','calories']::text[],
                            default_prescription_metric  = 'calories'
 WHERE gym_id IS NULL AND allowed_prescription_metrics = '{}'::text[]
   AND (category = 'monostructural'
        OR name ~* '\y(row erg|rower|ski ?erg|bike ?erg|echo bike|assault bike|c2 bike)\y');

-- ---------------------------------------------------------------------------
-- 4. Loaded implements (barbell / dumbbell / kettlebell / odd-object /
--    olympic / weighted patterns) → reps + load, default load
-- ---------------------------------------------------------------------------
UPDATE public.movements SET allowed_prescription_metrics = ARRAY['reps','load']::text[],
                            default_prescription_metric  = 'load'
 WHERE gym_id IS NULL AND allowed_prescription_metrics = '{}'::text[]
   AND (
     category IN ('barbell','dumbbell','kettlebell','odd-object')
     OR movement_pattern = 'olympic'
     OR (movement_pattern IN ('hinge','squat','press','push','pull','lunge')
         AND category IN ('barbell','dumbbell','kettlebell','odd-object'))
   );

-- ---------------------------------------------------------------------------
-- 5. Bodyweight / gymnastic → reps only, default reps
-- ---------------------------------------------------------------------------
UPDATE public.movements SET allowed_prescription_metrics = ARRAY['reps']::text[],
                            default_prescription_metric  = 'reps'
 WHERE gym_id IS NULL AND allowed_prescription_metrics = '{}'::text[]
   AND (
     category IN ('bodyweight','gymnastics')
     OR movement_pattern IN ('core','squat','lunge','push','pull','hinge','monostructural')
   );

-- ---------------------------------------------------------------------------
-- 6. Name heuristics for uncategorised rows
-- ---------------------------------------------------------------------------
-- 6a. loaded by name
UPDATE public.movements SET allowed_prescription_metrics = ARRAY['reps','load']::text[],
                            default_prescription_metric  = 'load'
 WHERE gym_id IS NULL AND allowed_prescription_metrics = '{}'::text[]
   AND name ~* ('\y(' ||
     'barbell|dumbbell|kettlebell|db|kb|axle|log|sandbag|d-?ball|atlas stone|keg|' ||
     'clean|snatch|jerk|deadlift|thruster|press|squat|swing|complex|shrug|curl|' ||
     'good morning|high pull|overhead walk|clean and jerk|clean & jerk|bear complex' ||
   ')\y')
   AND name !~* '\y(sit-?up|push-?up|pull-?up|air squat|pistol|jump squat|squat jump)\y';

-- 6b. reps by name (gymnastic / bodyweight movements the category data missed)
UPDATE public.movements SET allowed_prescription_metrics = ARRAY['reps']::text[],
                            default_prescription_metric  = 'reps'
 WHERE gym_id IS NULL AND allowed_prescription_metrics = '{}'::text[]
   AND name ~* ('\y(' ||
     'sit-?up|push-?up|pull-?up|pull up|burpee|box jump|jump|lunge|dip|' ||
     'muscle-?up|muscle up|toes to|knees to|handstand push|hspu|air squat|' ||
     'pistol|rope climb|wall walk|wall climb|get-?up|get up|v-?up|' ||
     'mountain climber|inchworm|jumping jack|double under|single under|' ||
     'crossover|skip|step-?up|step up|step-?over|calf raise|leg raise|' ||
     'russian twist|superman|bird dog|hollow rock|candlestick|roll|slam|' ||
     'ab wheel|rollout|band pull|pull-apart|flutter|scorpion|' ||
     'ring row|renegade row|bent-?over row|pendlay row|upright row|' ||
     'medicine ball|med ball|ball throw|wall ball sit' ||
   ')\y');

-- 6c. remaining named loaded movements the category data + 6a missed
UPDATE public.movements SET allowed_prescription_metrics = ARRAY['reps','load']::text[],
                            default_prescription_metric  = 'load'
 WHERE gym_id IS NULL AND allowed_prescription_metrics = '{}'::text[]
   AND name ~* '\y(cluster|hip thrust|rack pull|landmine|gorilla row|man ?maker|single-?leg rdl|romanian deadlift|rdl|bear complex|dt complex)\y';

-- 6d. remaining named rep movements (accessory / gymnastic) the rules missed
UPDATE public.movements SET allowed_prescription_metrics = ARRAY['reps']::text[],
                            default_prescription_metric  = 'reps'
 WHERE gym_id IS NULL AND allowed_prescription_metrics = '{}'::text[]
   AND name ~* '\y(extension|glute ham|ham raise|reverse hyper|peg ?board|windshield|tuck-?up|duck walk|dead bug|shoulder tap|scap|hyperextension|good girl|nordic)\y';

COMMIT;

-- ---------------------------------------------------------------------------
-- Post-seed report (run separately, informational):
--   SELECT
--     default_prescription_metric,
--     array_to_string(allowed_prescription_metrics, '+') AS allowed,
--     count(*)
--   FROM public.movements WHERE gym_id IS NULL
--   GROUP BY 1, 2 ORDER BY 3 DESC;
-- ---------------------------------------------------------------------------
