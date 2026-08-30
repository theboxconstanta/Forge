-- PER-MOVEMENT PRESCRIPTION ENGINE — P9.3 movement capability integrity
--
-- A full read-only audit of all 465 platform `movements` rows (P9.3 report §B/§C)
-- found the catalog capability data to be in good shape. The corrections below
-- are the only DETERMINISTIC discrepancies — each aligns a row with an existing
-- sibling / duplicate row that Forge already treats as the same class of
-- movement. No fuzzy-name blanket updates. Every id + before/after value is
-- listed. Additive/reversible (DOWN at end). No workout, log, or snapshot row
-- is touched.
--
-- The Wall Ball acceptance failure ("Wallballs" showed no Load control) was a
-- RESOLVER bug, not a data bug — fixed in the shared prescriptionContract
-- (normalizeMovementName / buildMovementIndex). No data change was needed for it.

BEGIN;

-- ============================================================================
-- 1. Isometric time-holds carrying a spurious `reps` capability.
--    Forge convention (7 existing sibling rows: Arch Hold, Back Lever, Front
--    Lever, L-sit Hold, Ring Support Hold, Side Plank, Copenhagen Plank) is
--    allowed = {} for a hold — its duration lives in the section/format, not in
--    a prescription metric. These 5 were seeded inconsistently.
--    before: allowed_prescription_metrics = {reps}, default_prescription_metric = 'reps'
--    after:  allowed_prescription_metrics = {},     default_prescription_metric = NULL
-- ============================================================================
UPDATE public.movements
   SET allowed_prescription_metrics = '{}'::text[], default_prescription_metric = NULL
 WHERE id IN (
   '73d372fe-cfc8-4c67-b1bf-1c269046aa02',  -- Handstand Hold
   '2f8ba2ef-637f-4a1e-91ac-a95948f9275a',  -- Hollow Hold
   'bc1596e0-795a-40c2-824e-656214902628',  -- L Sit          (matches "L-sit Hold")
   'ccbec918-fb6d-410b-8e78-3d269d323069',  -- Plank
   'd35f4ee9-26a8-4982-b7bd-eb41246a7aa5'   -- Wall Sit
 )
   AND allowed_prescription_metrics = '{reps}'::text[];   -- no-op if already corrected / re-run

-- ============================================================================
-- 2. "Sledgehammer Strikes" (id 689e89de…) is the plural duplicate of
--    "Sledgehammer Strike" (id 37265061…, allowed = {reps,load}, default 'load')
--    but was seeded with no capability at all — the ONE capability-disagreeing
--    duplicate pair in the whole catalog. Align the plural to the singular.
--    before: allowed = {},           default = NULL
--    after:  allowed = {reps,load},   default = 'load'
-- ============================================================================
UPDATE public.movements
   SET allowed_prescription_metrics = ARRAY['reps','load']::text[], default_prescription_metric = 'load'
 WHERE id = '689e89de-91cb-479c-8437-f0e64b7f538e'
   AND allowed_prescription_metrics = '{}'::text[];

-- ============================================================================
-- 3. "Air Bike" (id 6fa1e269…) is the same fan bike as "Assault Bike",
--    "Echo Bike", "Bike Erg", "Bike" — all seeded allowed = {distance,calories},
--    default 'calories'. Air Bike alone got {calories} only. Align it.
--    before: allowed = {calories},            default = 'calories'
--    after:  allowed = {distance,calories},   default = 'calories'
-- ============================================================================
UPDATE public.movements
   SET allowed_prescription_metrics = ARRAY['distance','calories']::text[], default_prescription_metric = 'calories'
 WHERE id = '6fa1e269-3db4-4d52-b39d-242ffdcbf24c'
   AND allowed_prescription_metrics = '{calories}'::text[];

-- ============================================================================
-- 4. Targeted aliases for cardio rows the normalized resolver cannot derive
--    (a coach types "Rower" / "Ski" / "Running"). Additive — appended only if
--    not already present.
-- ============================================================================
UPDATE public.movements
   SET aliases = (SELECT array_agg(DISTINCT a) FROM unnest(coalesce(aliases,'{}') || ARRAY['rower','c2 row','concept2 row']) a)
 WHERE id = '2cfd0278-21a4-47c3-8ece-3a40b6a742b8';  -- Row

UPDATE public.movements
   SET aliases = (SELECT array_agg(DISTINCT a) FROM unnest(coalesce(aliases,'{}') || ARRAY['ski','skierg']) a)
 WHERE id = '110ed61d-5047-4ba6-ae82-735d9473527c';  -- Ski Erg

UPDATE public.movements
   SET aliases = (SELECT array_agg(DISTINCT a) FROM unnest(coalesce(aliases,'{}') || ARRAY['bikeerg']) a)
 WHERE id = '5e1d8887-6ddb-4074-b463-8aea02b3a2c4';  -- Bike Erg

UPDATE public.movements
   SET aliases = (SELECT array_agg(DISTINCT a) FROM unnest(coalesce(aliases,'{}') || ARRAY['running','jog']) a)
 WHERE id = '4dce3065-4375-4782-ae25-991e27aec52f';  -- Run

COMMIT;

-- ============================================================================
-- REVERSIBILITY (manual DOWN — not auto-run):
--   UPDATE public.movements SET allowed_prescription_metrics = '{reps}'::text[], default_prescription_metric = 'reps'
--     WHERE id IN ('73d372fe-cfc8-4c67-b1bf-1c269046aa02','2f8ba2ef-637f-4a1e-91ac-a95948f9275a',
--                  'bc1596e0-795a-40c2-824e-656214902628','ccbec918-fb6d-410b-8e78-3d269d323069',
--                  'd35f4ee9-26a8-4982-b7bd-eb41246a7aa5');
--   UPDATE public.movements SET allowed_prescription_metrics = '{}'::text[], default_prescription_metric = NULL
--     WHERE id = '689e89de-91cb-479c-8437-f0e64b7f538e';
--   UPDATE public.movements SET allowed_prescription_metrics = '{calories}'::text[], default_prescription_metric = 'calories'
--     WHERE id = '6fa1e269-3db4-4d52-b39d-242ffdcbf24c';
--   -- aliases: remove the added strings from the 4 rows above.
-- The movements_default_prescription_metric_subset CHECK (default ∈ allowed OR
-- default IS NULL) holds for every row above, before and after.
-- ============================================================================
