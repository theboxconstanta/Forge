-- PER-MOVEMENT PRESCRIPTION ENGINE — P3a FOUNDATION (additive only)
--
-- Approved: PER_MOVEMENT_PRESCRIPTION_ENGINE_AUDIT_AND_ARCHITECTURE.md §0
-- (Phase 1–3 review, 2026-08-29). Option B: `wods` stays the authoring source
-- of truth; this migration adds ONE structured authoring column plus the
-- historical-immutability snapshot columns plus a single-canonical movement
-- capability model. Nothing is removed, nothing is backfilled, no historical
-- meaning changes.
--
-- WHAT THIS ADDS
--
--   1. wods.movement_prescriptions  jsonb NOT NULL DEFAULT the empty v1 shape
--      — the structured per-movement-INSTANCE prescription, keyed by variant.
--      Canonical typed contract v1 = architecture doc §C.5. Legacy
--      wods.movements_{variant} text[] and the 8 {variant}_weight_{male,female}
--      columns are UNTOUCHED and remain the compatibility fallback tier.
--
--   2. wod_logs.prescription_snapshot   jsonb NULL
--      skill_logs.prescription_snapshot jsonb NULL
--      — the immutable, member-resolved prescription frozen at "Log Score"
--      click (from the INC-04 logCtx, never re-read from wods at submit).
--      NULL on every existing row and on any future log whose workout has no
--      structured prescription — downstream readers fall back to live
--      resolution exactly as today (architecture doc §F). No invented history.
--
--   3. movements.allowed_prescription_metrics  text[] NOT NULL DEFAULT '{}'
--      movements.default_prescription_metric   text NULL
--      — ONE canonical capability representation (review point 4). The default,
--      when set, MUST be a member of the allowed set (CHECK). A metric that is
--      allowed but not the default is an "optional" capability. Empty allowed =
--      bodyweight-only. Seeded separately in P3b (20260829090500).
--
--   4. validate_movement_prescriptions()  + BEFORE INSERT OR UPDATE trigger on
--      wods — structure / enum / type validation only (NOT completeness, which
--      is a client publish-gate). Defence-in-depth behind the shared client
--      validator.
--
-- SCOPE — NOT changed anywhere: existing columns, existing triggers
-- (prevent_gym_id_change_trg on wods/movements is untouched and runs
-- independently), RLS policies (the new columns inherit each table's existing
-- gym-scoped policies unchanged — no new policy, no GRANT, no SECURITY DEFINER
-- surface beyond the trigger function below which is plain SECURITY INVOKER),
-- sync_workout_engine_v2 (reads wods, does not write it — unaffected), the
-- INC-03 workouts_enforce_legacy_date_sync trigger (different table), any
-- historical data. No backfill. Fully reversible (see DOWN notes at end).

BEGIN;

-- ============================================================================
-- 1. wods.movement_prescriptions
-- ============================================================================
ALTER TABLE public.wods
  ADD COLUMN IF NOT EXISTS movement_prescriptions jsonb NOT NULL
  DEFAULT '{"version": 1, "variants": {}}'::jsonb;

COMMENT ON COLUMN public.wods.movement_prescriptions IS
  'Per-movement-instance structured prescription, keyed by variant. Canonical '
  'typed contract v1 — see PER_MOVEMENT_PRESCRIPTION_ENGINE_AUDIT_AND_ARCHITECTURE.md '
  'section C.5. Authoring source of truth for load/distance/calorie/rep metrics. '
  'wods.movements_{variant} text[] and {variant}_weight_{male,female} remain the '
  'legacy fallback tier (never removed). Validated by '
  'validate_movement_prescriptions() trigger + the shared client validator.';

-- ============================================================================
-- 2. Log-time prescription snapshots (immutable historical interpretation)
-- ============================================================================
ALTER TABLE public.wod_logs
  ADD COLUMN IF NOT EXISTS prescription_snapshot jsonb;

ALTER TABLE public.skill_logs
  ADD COLUMN IF NOT EXISTS prescription_snapshot jsonb;

COMMENT ON COLUMN public.wod_logs.prescription_snapshot IS
  'Immutable prescription the member actually saw in the logger, resolved to '
  'their gender at "Log Score" freeze time (INC-04 logCtx) — NEVER reconstructed '
  'from wods at submit. NULL = pre-engine log or workout without structured '
  'prescription; downstream readers fall back to live resolution. Shape: '
  'architecture doc section C.6.';
COMMENT ON COLUMN public.skill_logs.prescription_snapshot IS
  'As wod_logs.prescription_snapshot, for the Skill Work logging path.';

-- ============================================================================
-- 3. Movement capability model — ONE canonical representation
-- ============================================================================
ALTER TABLE public.movements
  ADD COLUMN IF NOT EXISTS allowed_prescription_metrics text[] NOT NULL DEFAULT '{}'::text[],
  ADD COLUMN IF NOT EXISTS default_prescription_metric text;

-- Every element of allowed_prescription_metrics must be a known metric.
ALTER TABLE public.movements
  DROP CONSTRAINT IF EXISTS movements_allowed_prescription_metrics_domain;
ALTER TABLE public.movements
  ADD CONSTRAINT movements_allowed_prescription_metrics_domain CHECK (
    allowed_prescription_metrics <@ ARRAY['reps','load','distance','calories']::text[]
  );

-- The default, when set, may never contradict the allowed set (no dual authority).
ALTER TABLE public.movements
  DROP CONSTRAINT IF EXISTS movements_default_prescription_metric_subset;
ALTER TABLE public.movements
  ADD CONSTRAINT movements_default_prescription_metric_subset CHECK (
    default_prescription_metric IS NULL
    OR default_prescription_metric = ANY (allowed_prescription_metrics)
  );

COMMENT ON COLUMN public.movements.allowed_prescription_metrics IS
  'Closed set of prescription metrics valid for this movement '
  '(subset of reps|load|distance|calories). Empty = bodyweight-only, no '
  'prescription controls. Single source of truth for capability — no '
  'movement-name conditionals anywhere.';
COMMENT ON COLUMN public.movements.default_prescription_metric IS
  'The one metric the builder shows immediately for this movement. NULL with a '
  'non-empty allowed set = coach must pick (e.g. Row: distance|calories). '
  'CHECK-guaranteed to be a member of allowed_prescription_metrics.';

-- ============================================================================
-- 4. Structural validation trigger for wods.movement_prescriptions
--    (structure / enum / type only — completeness is a client publish-gate)
-- ============================================================================
CREATE OR REPLACE FUNCTION public.validate_movement_prescriptions()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  doc            jsonb := NEW.movement_prescriptions;
  variant_key    text;
  variant_obj    jsonb;
  mv             jsonb;
  spec_key       text;
  spec           jsonb;
  spec_mode      text;
  seen_ids       text[];
  inst_id        text;
  num_field      text;
BEGIN
  IF doc IS NULL THEN
    RAISE EXCEPTION 'movement_prescriptions must not be null (use the default empty v1 shape)';
  END IF;
  IF jsonb_typeof(doc) <> 'object' THEN
    RAISE EXCEPTION 'movement_prescriptions must be a JSON object';
  END IF;
  IF (doc->>'version') IS DISTINCT FROM '1' THEN
    RAISE EXCEPTION 'movement_prescriptions.version must be 1 (got %)', doc->>'version';
  END IF;
  IF jsonb_typeof(doc->'variants') <> 'object' THEN
    RAISE EXCEPTION 'movement_prescriptions.variants must be an object';
  END IF;

  FOR variant_key, variant_obj IN SELECT * FROM jsonb_each(doc->'variants') LOOP
    IF variant_key NOT IN ('rx','intermediate','beginner','onramp') THEN
      RAISE EXCEPTION 'movement_prescriptions.variants has unknown key %', variant_key;
    END IF;
    IF jsonb_typeof(variant_obj) <> 'object' OR jsonb_typeof(variant_obj->'movements') <> 'array' THEN
      RAISE EXCEPTION 'movement_prescriptions.variants.% must be { "movements": [...] }', variant_key;
    END IF;

    seen_ids := ARRAY[]::text[];

    FOR mv IN SELECT * FROM jsonb_array_elements(variant_obj->'movements') LOOP
      IF jsonb_typeof(mv) <> 'object' THEN
        RAISE EXCEPTION 'movement_prescriptions.variants.%: each movement must be an object', variant_key;
      END IF;

      inst_id := mv->>'instanceId';
      IF inst_id IS NULL OR length(inst_id) = 0 THEN
        RAISE EXCEPTION 'movement_prescriptions.variants.%: every movement needs a non-empty instanceId', variant_key;
      END IF;
      IF inst_id = ANY (seen_ids) THEN
        RAISE EXCEPTION 'movement_prescriptions.variants.%: duplicate instanceId %', variant_key, inst_id;
      END IF;
      seen_ids := seen_ids || inst_id;

      IF (mv->>'name') IS NULL OR length(mv->>'name') = 0 THEN
        RAISE EXCEPTION 'movement_prescriptions.variants.% movement % needs a non-empty name', variant_key, inst_id;
      END IF;
      IF mv ? 'canonicalMovementId'
         AND jsonb_typeof(mv->'canonicalMovementId') NOT IN ('string','null') THEN
        RAISE EXCEPTION 'movement_prescriptions.variants.% movement %: canonicalMovementId must be a string or null', variant_key, inst_id;
      END IF;

      FOREACH spec_key IN ARRAY ARRAY['reps','load','distance','calories'] LOOP
        IF NOT (mv ? spec_key) THEN CONTINUE; END IF;
        spec := mv->spec_key;
        IF jsonb_typeof(spec) <> 'object' THEN
          RAISE EXCEPTION 'movement_prescriptions.variants.% movement % %: spec must be an object', variant_key, inst_id, spec_key;
        END IF;
        spec_mode := spec->>'mode';

        IF spec_key = 'reps' AND spec_mode = 'text' THEN
          IF jsonb_typeof(spec->'text') <> 'string' THEN
            RAISE EXCEPTION 'movement_prescriptions.variants.% movement % reps(text): text must be a string', variant_key, inst_id;
          END IF;
          CONTINUE;
        END IF;

        IF spec_mode NOT IN ('universal','sex_specific') THEN
          RAISE EXCEPTION 'movement_prescriptions.variants.% movement % %: mode must be universal or sex_specific (got %)', variant_key, inst_id, spec_key, spec_mode;
        END IF;

        -- numeric fields: number or null only
        IF spec_mode = 'universal' THEN
          IF spec ? 'value' AND jsonb_typeof(spec->'value') NOT IN ('number','null') THEN
            RAISE EXCEPTION 'movement_prescriptions.variants.% movement % %.value must be a number or null', variant_key, inst_id, spec_key;
          END IF;
        ELSE
          FOREACH num_field IN ARRAY ARRAY['male','female'] LOOP
            IF spec ? num_field AND jsonb_typeof(spec->num_field) NOT IN ('number','null') THEN
              RAISE EXCEPTION 'movement_prescriptions.variants.% movement % %.% must be a number or null', variant_key, inst_id, spec_key, num_field;
            END IF;
          END LOOP;
        END IF;

        -- unit requirement for load / distance
        IF spec_key IN ('load','distance') THEN
          IF spec_key = 'load' AND (spec->>'unit') NOT IN ('kg','lb') THEN
            RAISE EXCEPTION 'movement_prescriptions.variants.% movement % load.unit must be kg or lb (got %)', variant_key, inst_id, spec->>'unit';
          END IF;
          IF spec_key = 'distance' AND (spec->>'unit') NOT IN ('m','km','ft','mi') THEN
            RAISE EXCEPTION 'movement_prescriptions.variants.% movement % distance.unit must be m/km/ft/mi (got %)', variant_key, inst_id, spec->>'unit';
          END IF;
        END IF;
      END LOOP;
    END LOOP;
  END LOOP;

  RETURN NEW;
END;
$$;

COMMENT ON FUNCTION public.validate_movement_prescriptions() IS
  'BEFORE INSERT OR UPDATE on wods — validates movement_prescriptions structure, '
  'enum values and field types per canonical contract v1. Does NOT enforce '
  'completeness (both M/F values present) — that is a client publish-gate. '
  'SECURITY INVOKER, no elevated privilege.';

DROP TRIGGER IF EXISTS wods_validate_movement_prescriptions ON public.wods;
CREATE TRIGGER wods_validate_movement_prescriptions
  BEFORE INSERT OR UPDATE OF movement_prescriptions ON public.wods
  FOR EACH ROW
  EXECUTE FUNCTION public.validate_movement_prescriptions();

COMMIT;

-- ============================================================================
-- REVERSIBILITY (manual DOWN, not auto-run):
--   DROP TRIGGER wods_validate_movement_prescriptions ON public.wods;
--   DROP FUNCTION public.validate_movement_prescriptions();
--   ALTER TABLE public.movements
--     DROP CONSTRAINT movements_default_prescription_metric_subset,
--     DROP CONSTRAINT movements_allowed_prescription_metrics_domain,
--     DROP COLUMN default_prescription_metric,
--     DROP COLUMN allowed_prescription_metrics;
--   ALTER TABLE public.skill_logs DROP COLUMN prescription_snapshot;
--   ALTER TABLE public.wod_logs  DROP COLUMN prescription_snapshot;
--   ALTER TABLE public.wods      DROP COLUMN movement_prescriptions;
-- All additive; dropping restores the exact prior schema. No data migrated.
-- ============================================================================
