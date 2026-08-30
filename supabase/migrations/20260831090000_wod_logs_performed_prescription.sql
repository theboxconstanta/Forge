-- PER-MOVEMENT PRESCRIPTION ENGINE — P9.5.2 PERFORMED PRESCRIPTION (additive only)
--
-- Owner-approved (P9.5.1 §G proposal). Adds ONE nullable jsonb column that
-- records WHAT THE ATHLETE ACTUALLY PERFORMED, as an overlay on the frozen
-- PROGRAMMED prescription.
--
--   performed_prescription IS NULL      -> athlete performed the workout as
--                                          programmed  (every existing row,
--                                          and every future unmodified log)
--   performed_prescription IS NOT NULL  -> athlete performed a modified/scaled
--                                          version (per-movement load / distance
--                                          / calories, and/or a movement
--                                          substitution by canonical id)
--
-- Contract v1 (mirrors the client `prescriptionContract.js` — one variant's
-- structured MovementInstance list, plus a per-instance `substitutedFrom`):
--
--   {
--     "version": 1,
--     "variantKey": "rx" | "intermediate" | "beginner" | "onramp" | null,
--     "sectionId": "<workout_section uuid>" | null,
--     "source": "performed",
--     "movements": [
--       { "instanceId": "mi_…", "name": "Dumbbell Clean",
--         "canonicalMovementId": "<uuid>" | null,
--         "reps": {…}?, "load": {…}?, "distance": {…}?, "calories": {…}?,
--         "substitutedFrom": { "canonicalMovementId": "<uuid>|null", "name": "Power Clean" }? },
--       …
--     ]
--   }
--
-- WHAT THIS DOES NOT TOUCH: `prescription_snapshot` (stays PROGRAMMED provenance,
-- P9.1), `movements_snapshot` (trigger-maintained programmed text),
-- `weight_logged` (stays the single-value athlete weight for legacy readers),
-- `wods`, Engine V2 `workouts`, the movements catalog. No RLS change (the
-- existing wod_logs policies are row-scoped: a member can only INSERT/UPDATE
-- their own log — `wod_logs_update_own` WITH CHECK `member_id = auth.uid()`).
-- No view breaks (`wod_logs_with_context` / `performance_timeline` /
-- `athlete_performance_summary` / `gym_performance_summary` all use explicit
-- narrow column lists, never `SELECT *`). No backfill.

BEGIN;

ALTER TABLE public.wod_logs
  ADD COLUMN IF NOT EXISTS performed_prescription jsonb;

COMMENT ON COLUMN public.wod_logs.performed_prescription IS
  'P9.5.2 — the athlete-performed prescription overlay (per-movement load / '
  'distance / calories and/or movement substitution by canonicalMovementId). '
  'NULL = performed as programmed. Contract v1 = one variant''s structured '
  'MovementInstance list (mirrors prescriptionContract.js). The PROGRAMMED '
  'prescription remains in prescription_snapshot (P9.1) — never overwritten. '
  'reps / round structure are NOT editable in P9.5.2 (leaderboard rep-structure '
  'policy is deferred). Presentation + RX/Modified only; validated by '
  'validate_wod_log_performed_prescription().';

-- ============================================================================
-- Defensive structural validation (mirrors validate_movement_prescriptions on
-- wods — structure / enum / type only, fail-closed). SECURITY INVOKER, no
-- elevated privilege. NULL always passes.
-- ============================================================================
CREATE OR REPLACE FUNCTION public.validate_wod_log_performed_prescription()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  doc       jsonb := NEW.performed_prescription;
  mv        jsonb;
  spec_key  text;
  spec      jsonb;
  spec_mode text;
  num_field text;
  inst_id   text;
  seen_ids  text[];
BEGIN
  IF doc IS NULL THEN
    RETURN NEW;
  END IF;
  IF jsonb_typeof(doc) <> 'object' THEN
    RAISE EXCEPTION 'performed_prescription must be a JSON object';
  END IF;
  IF (doc->>'version') IS DISTINCT FROM '1' THEN
    RAISE EXCEPTION 'performed_prescription.version must be 1 (got %)', doc->>'version';
  END IF;
  IF (doc->>'variantKey') IS NOT NULL
     AND (doc->>'variantKey') NOT IN ('rx','intermediate','beginner','onramp') THEN
    RAISE EXCEPTION 'performed_prescription.variantKey invalid: %', doc->>'variantKey';
  END IF;
  IF jsonb_typeof(doc->'movements') <> 'array' THEN
    RAISE EXCEPTION 'performed_prescription.movements must be an array';
  END IF;

  seen_ids := ARRAY[]::text[];
  FOR mv IN SELECT * FROM jsonb_array_elements(doc->'movements') LOOP
    IF jsonb_typeof(mv) <> 'object' THEN
      RAISE EXCEPTION 'performed_prescription: each movement must be an object';
    END IF;
    inst_id := mv->>'instanceId';
    IF inst_id IS NULL OR length(inst_id) = 0 THEN
      RAISE EXCEPTION 'performed_prescription: every movement needs a non-empty instanceId';
    END IF;
    IF inst_id = ANY (seen_ids) THEN
      RAISE EXCEPTION 'performed_prescription: duplicate instanceId %', inst_id;
    END IF;
    seen_ids := seen_ids || inst_id;
    IF (mv->>'name') IS NULL OR length(mv->>'name') = 0 THEN
      RAISE EXCEPTION 'performed_prescription: movement % needs a non-empty name', inst_id;
    END IF;
    IF mv ? 'canonicalMovementId'
       AND jsonb_typeof(mv->'canonicalMovementId') NOT IN ('string','null') THEN
      RAISE EXCEPTION 'performed_prescription: movement % canonicalMovementId must be string or null', inst_id;
    END IF;

    FOREACH spec_key IN ARRAY ARRAY['reps','load','distance','calories'] LOOP
      IF NOT (mv ? spec_key) THEN CONTINUE; END IF;
      spec := mv->spec_key;
      IF jsonb_typeof(spec) <> 'object' THEN
        RAISE EXCEPTION 'performed_prescription: movement % %: spec must be an object', inst_id, spec_key;
      END IF;
      spec_mode := spec->>'mode';
      IF spec_key = 'reps' AND spec_mode = 'text' THEN
        IF jsonb_typeof(spec->'text') <> 'string' THEN
          RAISE EXCEPTION 'performed_prescription: movement % reps(text) must be a string', inst_id;
        END IF;
        CONTINUE;
      END IF;
      IF spec_mode NOT IN ('universal','sex_specific') THEN
        RAISE EXCEPTION 'performed_prescription: movement % %: mode must be universal or sex_specific (got %)', inst_id, spec_key, spec_mode;
      END IF;
      IF spec_mode = 'universal' THEN
        IF spec ? 'value' AND jsonb_typeof(spec->'value') NOT IN ('number','null') THEN
          RAISE EXCEPTION 'performed_prescription: movement % %.value must be a number or null', inst_id, spec_key;
        END IF;
      ELSE
        FOREACH num_field IN ARRAY ARRAY['male','female'] LOOP
          IF spec ? num_field AND jsonb_typeof(spec->num_field) NOT IN ('number','null') THEN
            RAISE EXCEPTION 'performed_prescription: movement % %.% must be a number or null', inst_id, spec_key, num_field;
          END IF;
        END LOOP;
      END IF;
      IF spec_key = 'load' AND (spec->>'unit') NOT IN ('kg','lb') THEN
        RAISE EXCEPTION 'performed_prescription: movement % load.unit must be kg or lb (got %)', inst_id, spec->>'unit';
      END IF;
      IF spec_key = 'distance' AND (spec->>'unit') NOT IN ('m','km','ft','mi') THEN
        RAISE EXCEPTION 'performed_prescription: movement % distance.unit must be m/km/ft/mi (got %)', inst_id, spec->>'unit';
      END IF;
    END LOOP;
  END LOOP;

  RETURN NEW;
END;
$$;

COMMENT ON FUNCTION public.validate_wod_log_performed_prescription() IS
  'BEFORE INSERT OR UPDATE OF performed_prescription on wod_logs — structural / '
  'enum / type validation per P9.5.2 contract v1. NULL passes. SECURITY INVOKER.';

DROP TRIGGER IF EXISTS wod_logs_validate_performed_prescription ON public.wod_logs;
CREATE TRIGGER wod_logs_validate_performed_prescription
  BEFORE INSERT OR UPDATE OF performed_prescription ON public.wod_logs
  FOR EACH ROW
  EXECUTE FUNCTION public.validate_wod_log_performed_prescription();

COMMIT;

-- ============================================================================
-- REVERSIBILITY (manual DOWN, not auto-run):
--   DROP TRIGGER wod_logs_validate_performed_prescription ON public.wod_logs;
--   DROP FUNCTION public.validate_wod_log_performed_prescription();
--   ALTER TABLE public.wod_logs DROP COLUMN performed_prescription;
-- All additive; dropping restores the exact prior schema. No data migrated,
-- no rows backfilled.
-- ============================================================================
