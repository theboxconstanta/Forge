-- P9.5.2A - GLOBAL PERFORMED MOVEMENT COMPOSITION (Option 2, owner-approved).
--
-- The ONLY DDL for P9.5.2A: widen the existing structural validation trigger
-- `validate_wod_log_performed_prescription()` to accept contract v2.
--
--   * NO table / column / index / RLS / policy change.
--   * `wod_logs.performed_prescription` stays the same jsonb column.
--   * `wod_logs.sets` stays the same jsonb column (interval per-cell performed
--     composition rides existing `{ key: [row,...] }` grammar - a row gains an
--     optional `pm` marker; NO trigger guards `sets`, nothing to change there).
--   * SECURITY INVOKER, fail-closed, mirrors the client `validatePerformedPrescription`.
--
-- v1 docs remain valid and are read with v1 (positional) semantics - never
-- rewritten, never backfilled.
--
-- v2 additions, per movement entry:
--   "sourceInstanceId": "mi_..."   the PROGRAMMED instance this entry derives
--                                  from (required for v2, string, non-empty).
--   "notPerformed": true           sentinel: this source was NOT performed. The
--                                  entry carries a name only (no metric specs).

BEGIN;

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
  doc_ver   text;
  is_v2     boolean;
BEGIN
  IF doc IS NULL THEN
    RETURN NEW;
  END IF;
  IF jsonb_typeof(doc) <> 'object' THEN
    RAISE EXCEPTION 'performed_prescription must be a JSON object';
  END IF;
  doc_ver := doc->>'version';
  IF doc_ver IS DISTINCT FROM '1' AND doc_ver IS DISTINCT FROM '2' THEN
    RAISE EXCEPTION 'performed_prescription.version must be 1 or 2 (got %)', doc_ver;
  END IF;
  is_v2 := (doc_ver = '2');
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

    -- P9.5.2A v2 - sourceInstanceId anchor + notPerformed sentinel.
    IF mv ? 'sourceInstanceId'
       AND jsonb_typeof(mv->'sourceInstanceId') NOT IN ('string','null') THEN
      RAISE EXCEPTION 'performed_prescription: movement % sourceInstanceId must be string or null', inst_id;
    END IF;
    IF mv ? 'notPerformed' AND jsonb_typeof(mv->'notPerformed') <> 'boolean' THEN
      RAISE EXCEPTION 'performed_prescription: movement % notPerformed must be a boolean', inst_id;
    END IF;
    IF is_v2 AND ((mv->>'sourceInstanceId') IS NULL OR length(mv->>'sourceInstanceId') = 0) THEN
      RAISE EXCEPTION 'performed_prescription: v2 movement % needs a non-empty sourceInstanceId', inst_id;
    END IF;
    -- A not-performed sentinel carries a name only - skip metric validation.
    CONTINUE WHEN (mv->>'notPerformed') = 'true';

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
  'BEFORE INSERT OR UPDATE OF performed_prescription on wod_logs - structural / '
  'enum / type validation per P9.5.2 contract v1 AND P9.5.2A contract v2 '
  '(sourceInstanceId anchor + notPerformed sentinel for GLOBAL 1->N / 1->0 '
  'performed composition). NULL passes. SECURITY INVOKER.';

COMMENT ON COLUMN public.wod_logs.performed_prescription IS
  'P9.5.2 / P9.5.2A - the athlete-performed prescription overlay. NULL = '
  'performed as programmed. v1 = one variant''s MovementInstance list (per-'
  'movement load/distance/calories + substitution). v2 adds per-entry '
  'sourceInstanceId (the programmed instance an entry derives from) + a '
  'notPerformed sentinel, enabling GLOBAL 1->N / 1->0 performed composition. '
  'v1 docs are read with v1 (positional) semantics, never rewritten. reps stay '
  'structure (an added movement may inherit its source''s reps where '
  'deterministically valid). PROGRAMMED prescription stays in '
  'prescription_snapshot (P9.1). Validated by '
  'validate_wod_log_performed_prescription().';

COMMIT;

-- ============================================================================
-- REVERSIBILITY (manual DOWN, not auto-run) - restore the P9.5.2 v1-only
-- validator body (migration 20260831090000). No data change to reverse; a v2
-- doc already stored would then fail re-validation only on a subsequent UPDATE
-- OF performed_prescription, never on read.
-- ============================================================================
