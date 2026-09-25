-- SECONDS PRESCRIPTION METRIC — widens the per-movement prescription engine's
-- domain to support duration (e.g. "Bar Hang - 30 sec"). Additive only: the
-- existing reps/load/distance/calories domain is unchanged, no existing row's
-- value changes as a side effect of widening the CHECK constraint (confirmed
-- - a domain widen never touches existing array values).
--
-- Scope: enable 'seconds' for exactly Bar Hang and Static Bar Hang (the
-- owner's reported movements), not the other seven existing holds (Plank,
-- Side Plank, Copenhagen Plank, Ring Support Hold, Handstand Hold, L-sit
-- Hold, Arch Hold) - narrow pilot first, per this session's established
-- "smallest safe batch" pattern; those stay allowed_prescription_metrics=[]
-- exactly as before, untouched.

ALTER TABLE public.movements
  DROP CONSTRAINT IF EXISTS movements_allowed_prescription_metrics_domain;
ALTER TABLE public.movements
  ADD CONSTRAINT movements_allowed_prescription_metrics_domain CHECK (
    allowed_prescription_metrics <@ ARRAY['reps','load','distance','calories','seconds']::text[]
  );

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

      FOREACH spec_key IN ARRAY ARRAY['reps','load','distance','calories','seconds'] LOOP
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

        -- unit requirement for load / distance (seconds has no unit - always sec)
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
  'enum values and field types per canonical contract v1 (reps/load/distance/'
  'calories/seconds). Does NOT enforce completeness (both M/F values present) '
  '— that is a client publish-gate. SECURITY INVOKER, no elevated privilege.';

COMMENT ON COLUMN public.movements.allowed_prescription_metrics IS
  'Closed set of prescription metrics valid for this movement '
  '(subset of reps|load|distance|calories|seconds). Empty = bodyweight-only, no '
  'prescription controls. Single source of truth for capability — no '
  'movement-name conditionals anywhere. Seconds added 2026-09-24 for the hold '
  'family (Bar Hang / Static Bar Hang first; the other holds stay opt-out '
  'until explicitly enabled).';

-- Enable seconds for exactly the two movements the owner reported. The other
-- seven holds are untouched, staying allowed_prescription_metrics=[] exactly
-- as before - this is a per-row opt-in, never a global capability grant.
UPDATE public.movements
SET allowed_prescription_metrics = ARRAY['seconds']::text[],
    default_prescription_metric = 'seconds'
WHERE name IN ('Bar Hang', 'Static Bar Hang');
