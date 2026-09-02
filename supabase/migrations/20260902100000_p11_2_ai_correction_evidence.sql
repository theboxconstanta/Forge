-- P11.2 — Coach Correction Capture + Learning Evidence
--
-- Owner decisions (2026-09-02): D1 = A (materialized append-only table +
-- replayable SECURITY DEFINER extractor), D2 = A (distinct
-- evidence_type = 'coach_completion' for AI omissions), D3 = B (consume
-- P11.1 semantic_diff coverage as-is; workSec / restPlacement / interval
-- params are a separate backlog item — "P11.x INTERVAL / FORMAT-PARAM
-- LEARNING EVIDENCE COVERAGE" — NOT implemented here).
--
-- WHAT THIS DOES
--   * ONE append-only table `ai_correction_evidence` — one row per
--     independently useful semantic evidence unit.
--   * A deterministic, versioned, idempotent, replayable extractor
--     `p11_extract_correction_evidence(run_id)` whose ONLY source is the
--     FROZEN P11.1 evidence (`ai_analysis_runs.normalized_output` /
--     `.saved_output` / `.semantic_diff`). No current-WOD read. No
--     `wod_logs` read. Tenant `gym_id` inherited from the run.
--   * An AFTER UPDATE trigger on `ai_analysis_runs` that fires the extractor
--     exactly once, on `saved_at` NULL -> NOT NULL, wrapped so a failure
--     NEVER blocks the coach's Save-linkage (fail-open).
--   * A tenant-guarded read-only stats function. Accepted-run denominator
--     is reported SEPARATELY from correction-row counts (no manufactured
--     field-level AI-error percentages).
--
-- WHAT THIS DOES NOT DO
--   No retrieval / RAG / embeddings / pgvector / fine-tuning. No prompt
--   change. No AI Analyze change. No canonical workout mutation. No
--   historical backfill (the trigger only fires on NEW transitions; the
--   extractor is invocable manually but must be owner-authorised for bulk
--   runs). No change to any existing table / trigger / RLS / Edge Function.
--   Fully reversible (DOWN notes at end).
--
-- INVARIANTS HONOURED
--   REST is timing, never a movement (CHECK forbids movement id/name on a
--   REST_TIME row). reps = structure (its own taxonomy_kind, never LOAD).
--   Canonical variants are exactly rx / intermediate / beginner / onramp —
--   "scaled" is never persisted as identity. Gender is a prescription
--   DIMENSION (universal / male / female), never a variant; unknown is
--   never coerced to male. P10 snapshot-first: the extractor reads only the
--   frozen P11.1 snapshots. Sequence != Repeated Rounds (its own
--   STRUCTURE row).

BEGIN;

-- ============================================================================
-- 0. Small deterministic helpers (pure)
-- ============================================================================

-- Movement-name fold — byte-for-byte the JS `normMovementName`
-- (src/aiProvenanceDiff.js): lowercase, non [a-z0-9&\s] -> space, collapse
-- whitespace, trim, drop ONE trailing 's'.
CREATE OR REPLACE FUNCTION public.p11_norm_movement_name(s text)
RETURNS text
LANGUAGE sql IMMUTABLE PARALLEL SAFE
AS $$
  SELECT regexp_replace(
           btrim(
             regexp_replace(
               regexp_replace(lower(coalesce(s, '')), '[^a-z0-9&\s]', ' ', 'g'),
               '\s+', ' ', 'g'
             )
           ),
           's$', ''
         )
$$;

-- Parse ONE `semantic_diff` metric tuple (the shape `specTuple` emits):
--   [v, null, unit]            -> universal
--   [null, [male, female], u]  -> sex_specific
--   ['text:...', null, u]      -> text  (reps only)
--   null / non-array           -> all NULL
CREATE OR REPLACE FUNCTION public.p11_2_spec_parts(
  t jsonb,
  OUT mode text, OUT val text, OUT male text, OUT female text, OUT unit text
)
LANGUAGE plpgsql IMMUTABLE PARALLEL SAFE
AS $$
BEGIN
  mode := NULL; val := NULL; male := NULL; female := NULL; unit := NULL;
  IF t IS NULL OR jsonb_typeof(t) <> 'array' THEN
    RETURN;
  END IF;
  unit := t->>2;
  IF jsonb_typeof(t->0) = 'string' AND (t->>0) LIKE 'text:%' THEN
    mode := 'text'; val := substr(t->>0, 6);
    RETURN;
  END IF;
  IF jsonb_typeof(t->1) = 'array' THEN
    mode := 'sex_specific'; male := t->1->>0; female := t->1->>1;
    RETURN;
  END IF;
  mode := 'universal'; val := t->>0;
END;
$$;

-- Compact human descriptor for a whole spec side (mode-change rows).
CREATE OR REPLACE FUNCTION public.p11_2_describe(mode text, val text, male text, female text)
RETURNS text
LANGUAGE sql IMMUTABLE PARALLEL SAFE
AS $$
  SELECT CASE
    WHEN mode = 'sex_specific' THEN coalesce(male, '') || '/' || coalesce(female, '')
    ELSE coalesce(val, '')
  END
$$;

-- Deterministic context fingerprint for a saved section (relational retrieval,
-- a LATER phase — no embeddings here). Never a full workout blob.
CREATE OR REPLACE FUNCTION public.p11_2_section_fingerprint(sec jsonb)
RETURNS jsonb
LANGUAGE sql IMMUTABLE PARALLEL SAFE
AS $$
  SELECT coalesce(jsonb_strip_nulls(jsonb_build_object(
    'format',      sec->>'format',
    'structure',   sec->'formatConfig'->>'structure',
    'scoreType',   coalesce(sec->>'scoreType', sec->>'score_type'),
    'durationSec', sec->'formatConfig'->>'durationSec',
    'roundCount',  coalesce(sec->'formatConfig'->>'roundCount', sec->'formatConfig'->>'rounds'),
    'sectionType', sec->>'typeKey',
    'movementIds', (
      SELECT coalesce(jsonb_agg(coalesce(i->>'canonicalMovementId', public.p11_norm_movement_name(i->>'name'))), '[]'::jsonb)
      FROM jsonb_array_elements(
             CASE WHEN jsonb_typeof(sec->'variants'->'rx'->'instances') = 'array'
                  THEN sec->'variants'->'rx'->'instances' ELSE '[]'::jsonb END
           ) i
    )
  )), '{}'::jsonb)
$$;

-- ============================================================================
-- 1. ai_correction_evidence
-- ============================================================================
CREATE TABLE public.ai_correction_evidence (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  ai_run_id           uuid NOT NULL REFERENCES public.ai_analysis_runs(id) ON DELETE CASCADE,
  gym_id              uuid NOT NULL REFERENCES public.gyms(id) ON DELETE CASCADE,
  coach_id            uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at          timestamptz NOT NULL DEFAULT now(),
  extractor_version   text NOT NULL,

  -- D2: 'correction' = coach changed a value the AI produced; 'coach_completion'
  -- = coach supplied something the AI omitted (a whole variant tier, or a
  -- prescription field). NEVER mixed.
  evidence_type       text NOT NULL CHECK (evidence_type IN ('correction', 'coach_completion')),

  taxonomy_kind       text NOT NULL CHECK (taxonomy_kind IN (
                        'FORMAT','STRUCTURE','SCORE_FAMILY','DURATION','ROUNDS','REST_TIME',
                        'MOVEMENT_IDENTITY','MOVEMENT_ORDER','MOVEMENT_ADD','MOVEMENT_REMOVE',
                        'REPS','LOAD','DISTANCE','CALORIES','SECTION_ADD','SECTION_REMOVE',
                        'VARIANT_COMPLETION','PRESCRIPTION_COMPLETION')),

  -- Evidence confidence (NOT model confidence, NOT a fabricated number).
  reliability         text NOT NULL CHECK (reliability IN ('DETERMINISTIC','AMBIGUOUS','UNSUPPORTED')),
  eligibility         text NOT NULL CHECK (eligibility IN ('eligible','ineligible','ambiguous')),

  section_index       integer,
  section_type        text,
  variant             text CHECK (variant IN ('rx','intermediate','beginner','onramp')),
  movement_position   integer,
  movement_id         text,     -- canonicalMovementId when resolvable
  movement_name       text,     -- p11_norm_movement_name fallback
  field               text,     -- 'load' | 'reps' | 'distance' | 'calories' | 'format' | 'structure' | ...
  gender_dimension    text CHECK (gender_dimension IN ('universal','male','female','sex_specific')),

  before_value        text,
  after_value         text,
  unit                text,

  context_fingerprint jsonb NOT NULL DEFAULT '{}'::jsonb,
  correction_path     text NOT NULL,   -- deterministic, run-relative
  source_delta        jsonb,           -- the raw semantic_diff delta / synthesized completion descriptor

  -- REST is timing structure, NEVER a movement.
  CONSTRAINT ai_correction_evidence_rest_not_a_movement
    CHECK (taxonomy_kind <> 'REST_TIME' OR (movement_id IS NULL AND movement_name IS NULL)),

  -- Idempotency / replay key (D1). Re-running the SAME extractor_version is a
  -- no-op; a NEW extractor_version writes NEW rows and never touches old ones.
  CONSTRAINT ai_correction_evidence_unique_unit
    UNIQUE (ai_run_id, correction_path, extractor_version)
);

COMMENT ON TABLE public.ai_correction_evidence IS
  'P11.2 — append-only coach-correction learning evidence. One row per semantic '
  'evidence unit, extracted deterministically from the FROZEN P11.1 evidence '
  '(ai_analysis_runs.normalized_output / saved_output / semantic_diff). '
  'evidence_type: correction | coach_completion (D2). NEVER feeds AI Analyze '
  '(no retrieval / RAG / embeddings / fine-tuning). One correction = one '
  'observation, never a rule.';
COMMENT ON COLUMN public.ai_correction_evidence.gender_dimension IS
  'Prescription DIMENSION the change lands on. universal | male | female | '
  'sex_specific (mode change). Gender is never a variant; unknown never male.';
COMMENT ON COLUMN public.ai_correction_evidence.correction_path IS
  'Deterministic run-relative address of this evidence unit. Same input -> same '
  'path -> idempotent extraction.';

CREATE INDEX ai_correction_evidence_gym_created_idx  ON public.ai_correction_evidence (gym_id, created_at DESC);
CREATE INDEX ai_correction_evidence_run_idx          ON public.ai_correction_evidence (ai_run_id);
CREATE INDEX ai_correction_evidence_kind_idx         ON public.ai_correction_evidence (gym_id, taxonomy_kind);
CREATE INDEX ai_correction_evidence_variant_idx      ON public.ai_correction_evidence (gym_id, variant) WHERE variant IS NOT NULL;
CREATE INDEX ai_correction_evidence_movement_idx     ON public.ai_correction_evidence (gym_id, movement_id) WHERE movement_id IS NOT NULL;
CREATE INDEX ai_correction_evidence_movename_idx     ON public.ai_correction_evidence (gym_id, movement_name) WHERE movement_name IS NOT NULL;
CREATE INDEX ai_correction_evidence_type_idx         ON public.ai_correction_evidence (gym_id, evidence_type);
CREATE INDEX ai_correction_evidence_extractor_idx    ON public.ai_correction_evidence (extractor_version);

-- ============================================================================
-- 2. RLS — mirrors ai_analysis_runs exactly
-- ============================================================================
ALTER TABLE public.ai_correction_evidence ENABLE ROW LEVEL SECURITY;

-- SELECT: coach/admin of the evidence's gym only. Members: no policy => denied.
-- Anonymous: no policy => denied. Cross-tenant impossible.
CREATE POLICY ai_correction_evidence_select ON public.ai_correction_evidence
  FOR SELECT TO authenticated
  USING (public.is_coach_or_admin(gym_id));

-- INSERT / UPDATE: never from a client. Only the SECURITY DEFINER extractor
-- (function owner, RLS-exempt) writes. Restrictive policies make a forged
-- client write impossible even if a future code path tried.
CREATE POLICY ai_correction_evidence_no_client_insert ON public.ai_correction_evidence
  FOR INSERT TO authenticated
  WITH CHECK (false);
CREATE POLICY ai_correction_evidence_no_client_update ON public.ai_correction_evidence
  FOR UPDATE TO authenticated
  USING (false) WITH CHECK (false);

-- DELETE: no policy => denied for every client. Rows disappear only by
-- ON DELETE CASCADE when the parent run or gym is deleted.

-- ============================================================================
-- 3. Append-only immutability (UPDATE only — never block a cascade DELETE)
-- ============================================================================
CREATE OR REPLACE FUNCTION public.enforce_ai_correction_evidence_immutability()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION 'ai_correction_evidence is append-only (row %; re-extract under a new extractor_version instead)', OLD.id;
END;
$$;

CREATE TRIGGER ai_correction_evidence_immutability
  BEFORE UPDATE ON public.ai_correction_evidence
  FOR EACH ROW EXECUTE FUNCTION public.enforce_ai_correction_evidence_immutability();

-- ============================================================================
-- 4. Internal emit helper (SECURITY DEFINER; not callable by clients)
-- ============================================================================
CREATE OR REPLACE FUNCTION public.p11_2_emit_evidence(
  p_run              public.ai_analysis_runs,
  p_extractor        text,
  p_evidence_type    text,
  p_taxonomy_kind    text,
  p_reliability      text,
  p_eligibility      text,
  p_section_index    integer,
  p_section_type     text,
  p_variant          text,
  p_movement_pos     integer,
  p_movement_id      text,
  p_movement_name    text,
  p_field            text,
  p_gender_dimension text,
  p_before           text,
  p_after            text,
  p_unit             text,
  p_context          jsonb,
  p_correction_path  text,
  p_source_delta     jsonb
)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE v_n integer;
BEGIN
  INSERT INTO public.ai_correction_evidence (
    ai_run_id, gym_id, coach_id, extractor_version,
    evidence_type, taxonomy_kind, reliability, eligibility,
    section_index, section_type, variant, movement_position, movement_id, movement_name,
    field, gender_dimension, before_value, after_value, unit,
    context_fingerprint, correction_path, source_delta
  ) VALUES (
    p_run.id, p_run.gym_id, p_run.coach_id, p_extractor,
    p_evidence_type, p_taxonomy_kind, p_reliability, p_eligibility,
    p_section_index, p_section_type, p_variant, p_movement_pos, p_movement_id, p_movement_name,
    p_field, p_gender_dimension, p_before, p_after, p_unit,
    coalesce(p_context, '{}'::jsonb), p_correction_path, p_source_delta
  )
  ON CONFLICT (ai_run_id, correction_path, extractor_version) DO NOTHING;
  GET DIAGNOSTICS v_n = ROW_COUNT;
  RETURN v_n;
END;
$$;

REVOKE ALL ON FUNCTION public.p11_2_emit_evidence(public.ai_analysis_runs, text, text, text, text, text, integer, text, text, integer, text, text, text, text, text, text, text, jsonb, text, jsonb) FROM PUBLIC, anon, authenticated;

-- ============================================================================
-- 5. The extractor — deterministic, versioned, idempotent, replayable
-- ============================================================================
CREATE OR REPLACE FUNCTION public.p11_extract_correction_evidence(p_run_id uuid)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  -- Bump this string to re-interpret; old rows are NEVER rewritten (D1 / §48).
  c_extractor        constant text := 'p11.2-correction-extractor-v1';

  v_run              public.ai_analysis_runs%ROWTYPE;
  v_delta            jsonb;
  v_kind             text;
  v_section          integer;
  v_variant          text;
  v_at               integer;
  v_sec_saved        jsonb;
  v_sec_type         text;
  v_ctx              jsonb;
  v_inst             jsonb;
  v_mv_id            text;
  v_mv_name          text;
  v_tax              text;
  v_field            text;
  v_path             text;
  v_reliab           text;
  v_elig             text;
  v_inserted         integer := 0;

  fp_mode text; fp_val text; fp_male text; fp_female text; fp_unit text;
  tp_mode text; tp_val text; tp_male text; tp_female text; tp_unit text;

  v_primary_idx      integer;
  v_vk               text;
  v_ai_levels        text[];
  v_saved_inst       jsonb;
BEGIN
  SELECT * INTO v_run FROM public.ai_analysis_runs WHERE id = p_run_id;
  IF NOT FOUND THEN
    RETURN 0;
  END IF;

  -- Eligibility gate (§37): completed OK, both frozen snapshots present, linked
  -- to a saved workout, a real accepted outcome. NO reconstruction from a
  -- mutable current WOD, NO wod_logs read.
  --
  -- SHAPES (verified against production P11.1 rows):
  --   normalized_output = the flat WorkoutAnalysis the Edge Function produced
  --     (transform.ts toWorkoutAnalysis) — a JSON OBJECT with `.sections[]`
  --     (each `.scalingVersions[]` = {level, movements, notes}), `.scaling{}`,
  --     `.movements[]`. It is NOT the EditableSection[] the diff ran against.
  --   saved_output = the EditableSection[] the coach saved — a JSON ARRAY,
  --     `[i].variants.{rx|intermediate|beginner|onramp}.instances[]`.
  --   semantic_diff.deltas already carry `name` for every movement/metric
  --     delta, so movement identity does not need the AI-side baseline.
  IF v_run.saved_at IS NULL
     OR v_run.status <> 'ok'
     OR v_run.wod_id IS NULL
     OR v_run.normalized_output IS NULL
     OR v_run.saved_output IS NULL
     OR jsonb_typeof(v_run.saved_output) <> 'array'
     OR v_run.outcome NOT IN ('accepted_unchanged','accepted_cosmetic','accepted_semantic')
  THEN
    RETURN 0;
  END IF;

  -- ------------------------------------------------------------------
  -- (A) Corrections from the FROZEN semantic_diff.deltas
  -- ------------------------------------------------------------------
  FOR v_delta IN
    SELECT value FROM jsonb_array_elements(coalesce(v_run.semantic_diff->'deltas', '[]'::jsonb))
  LOOP
    v_kind    := v_delta->>'kind';
    v_section := NULLIF(v_delta->>'section','')::integer;
    v_variant := v_delta->>'variant';
    v_at      := NULLIF(v_delta->>'at','')::integer;

    -- Cosmetic deltas are NEVER programming learning evidence (§31 / mission #8).
    IF v_kind IN ('title_changed','note_changed','movement_renamed') THEN
      CONTINUE;
    END IF;

    -- Section-shape reads come ONLY from saved_output (EditableSection[]).
    v_sec_saved := CASE WHEN v_section IS NOT NULL THEN v_run.saved_output->v_section END;
    v_sec_type  := v_sec_saved->>'typeKey';
    v_ctx       := public.p11_2_section_fingerprint(coalesce(v_sec_saved, '{}'::jsonb));

    -- ---- section-level -------------------------------------------------
    IF v_kind IN ('format_changed','structure_changed','score_family_changed',
                  'duration_changed','rest_changed','rounds_changed',
                  'section_added','section_removed') THEN
      v_tax := CASE v_kind
        WHEN 'format_changed'        THEN 'FORMAT'
        WHEN 'structure_changed'     THEN 'STRUCTURE'
        WHEN 'score_family_changed'  THEN 'SCORE_FAMILY'
        WHEN 'duration_changed'      THEN 'DURATION'
        WHEN 'rest_changed'          THEN 'REST_TIME'
        WHEN 'rounds_changed'        THEN 'ROUNDS'
        WHEN 'section_added'         THEN 'SECTION_ADD'
        WHEN 'section_removed'       THEN 'SECTION_REMOVE'
      END;
      v_field := CASE v_kind
        WHEN 'format_changed'       THEN 'format'
        WHEN 'structure_changed'    THEN 'structure'
        WHEN 'score_family_changed' THEN 'scoreType'
        WHEN 'duration_changed'     THEN 'durationSec'
        WHEN 'rest_changed'         THEN 'restSec'
        WHEN 'rounds_changed'       THEN 'roundCount'
        ELSE NULL
      END;
      v_path := format('s%s|f%s|%s', v_section, coalesce(v_field,'-'), v_kind);
      v_inserted := v_inserted + public.p11_2_emit_evidence(
        v_run, c_extractor, 'correction', v_tax, 'DETERMINISTIC', 'eligible',
        v_section, v_sec_type, NULL, NULL, NULL, NULL,
        v_field, NULL,
        CASE WHEN v_kind = 'section_added'   THEN NULL ELSE coalesce(v_delta->>'from', v_delta->>'type') END,
        CASE WHEN v_kind = 'section_removed' THEN NULL ELSE coalesce(v_delta->>'to',   v_delta->>'type') END,
        NULL, v_ctx, v_path, v_delta
      );
      CONTINUE;
    END IF;

    -- ---- movement structural -----------------------------------------
    IF v_kind IN ('movement_added','movement_removed','movement_substituted','movement_reordered') THEN
      IF v_kind = 'movement_reordered' THEN
        -- AMBIGUOUS when a movement repeats (multiset key collision, §25/§26).
        IF EXISTS (
          SELECT 1 FROM (
            SELECT k, count(*) c
            FROM jsonb_array_elements_text(coalesce(v_delta->'from','[]'::jsonb)) k
            GROUP BY k
          ) q WHERE q.c > 1
        ) THEN
          v_reliab := 'AMBIGUOUS'; v_elig := 'ambiguous';
        ELSE
          v_reliab := 'DETERMINISTIC'; v_elig := 'eligible';
        END IF;
        v_path := format('s%s|v%s|movement_reordered', v_section, v_variant);
        v_inserted := v_inserted + public.p11_2_emit_evidence(
          v_run, c_extractor, 'correction', 'MOVEMENT_ORDER', v_reliab, v_elig,
          v_section, v_sec_type, v_variant, NULL, NULL, NULL,
          NULL, NULL,
          (SELECT string_agg(value, '>') FROM jsonb_array_elements_text(coalesce(v_delta->'from','[]'::jsonb))),
          (SELECT string_agg(value, '>') FROM jsonb_array_elements_text(coalesce(v_delta->'to','[]'::jsonb))),
          NULL, v_ctx, v_path, v_delta
        );
        CONTINUE;
      END IF;

      -- Identity: a movement still in saved_output resolves to a canonical id;
      -- a removed movement is identified by the name the diff recorded.
      v_inst := v_run.saved_output->v_section->'variants'->v_variant->'instances'->v_at;
      v_mv_id   := v_inst->>'canonicalMovementId';
      v_mv_name := public.p11_norm_movement_name(coalesce(v_delta->>'name', v_inst->>'name', v_delta->>'to', v_delta->>'from'));
      v_elig := CASE WHEN v_mv_id IS NULL AND coalesce(v_mv_name,'') = '' THEN 'ineligible' ELSE 'eligible' END;

      v_tax := CASE v_kind
        WHEN 'movement_added'       THEN 'MOVEMENT_ADD'
        WHEN 'movement_removed'     THEN 'MOVEMENT_REMOVE'
        WHEN 'movement_substituted' THEN 'MOVEMENT_IDENTITY'
      END;
      v_path := format('s%s|v%s|p%s|%s', v_section, v_variant, coalesce(v_at::text,'-'), v_kind);
      v_inserted := v_inserted + public.p11_2_emit_evidence(
        v_run, c_extractor, 'correction', v_tax, 'DETERMINISTIC', v_elig,
        v_section, v_sec_type, v_variant, v_at, v_mv_id, NULLIF(v_mv_name,''),
        NULL, NULL,
        coalesce(v_delta->>'from', v_delta->>'name'),
        coalesce(v_delta->>'to',   v_delta->>'name'),
        NULL, v_ctx, v_path, v_delta
      );
      CONTINUE;
    END IF;

    -- ---- per-movement metric (reps / load / distance / calories) -----
    IF v_kind IN ('reps_changed','load_changed','distance_changed','calories_changed') THEN
      v_field := CASE v_kind
        WHEN 'reps_changed'     THEN 'reps'
        WHEN 'load_changed'     THEN 'load'
        WHEN 'distance_changed' THEN 'distance'
        WHEN 'calories_changed' THEN 'calories'
      END;
      v_tax := CASE v_kind
        WHEN 'reps_changed'     THEN 'REPS'
        WHEN 'load_changed'     THEN 'LOAD'
        WHEN 'distance_changed' THEN 'DISTANCE'
        WHEN 'calories_changed' THEN 'CALORIES'
      END;

      v_inst := v_run.saved_output->v_section->'variants'->v_variant->'instances'->v_at;
      v_mv_id   := v_inst->>'canonicalMovementId';
      v_mv_name := public.p11_norm_movement_name(coalesce(v_inst->>'name', v_delta->>'name'));

      SELECT mode, val, male, female, unit INTO fp_mode, fp_val, fp_male, fp_female, fp_unit
        FROM public.p11_2_spec_parts(v_delta->'from');
      SELECT mode, val, male, female, unit INTO tp_mode, tp_val, tp_male, tp_female, tp_unit
        FROM public.p11_2_spec_parts(v_delta->'to');

      -- D2 field-level: the AI produced NO value for this metric; the coach
      -- supplied one. Pure coach_completion, one row per target dimension.
      IF fp_mode IS NULL AND tp_mode IS NOT NULL THEN
        IF tp_mode = 'sex_specific' THEN
          IF tp_male IS NOT NULL THEN
            v_path := format('s%s|v%s|p%s|m%s|f%s|dmale|completion', v_section, v_variant, coalesce(v_at::text,'-'), coalesce(v_mv_id, v_mv_name, '-'), v_field);
            v_inserted := v_inserted + public.p11_2_emit_evidence(
              v_run, c_extractor, 'coach_completion', 'PRESCRIPTION_COMPLETION', 'DETERMINISTIC',
              CASE WHEN v_mv_id IS NULL AND coalesce(v_mv_name,'') = '' THEN 'ineligible' ELSE 'eligible' END,
              v_section, v_sec_type, v_variant, v_at, v_mv_id, NULLIF(v_mv_name,''),
              v_field, 'male', NULL, tp_male, coalesce(tp_unit, fp_unit), v_ctx, v_path, v_delta);
          END IF;
          IF tp_female IS NOT NULL THEN
            v_path := format('s%s|v%s|p%s|m%s|f%s|dfemale|completion', v_section, v_variant, coalesce(v_at::text,'-'), coalesce(v_mv_id, v_mv_name, '-'), v_field);
            v_inserted := v_inserted + public.p11_2_emit_evidence(
              v_run, c_extractor, 'coach_completion', 'PRESCRIPTION_COMPLETION', 'DETERMINISTIC',
              CASE WHEN v_mv_id IS NULL AND coalesce(v_mv_name,'') = '' THEN 'ineligible' ELSE 'eligible' END,
              v_section, v_sec_type, v_variant, v_at, v_mv_id, NULLIF(v_mv_name,''),
              v_field, 'female', NULL, tp_female, coalesce(tp_unit, fp_unit), v_ctx, v_path, v_delta);
          END IF;
        ELSE
          v_path := format('s%s|v%s|p%s|m%s|f%s|duniversal|completion', v_section, v_variant, coalesce(v_at::text,'-'), coalesce(v_mv_id, v_mv_name, '-'), v_field);
          v_inserted := v_inserted + public.p11_2_emit_evidence(
            v_run, c_extractor, 'coach_completion', 'PRESCRIPTION_COMPLETION', 'DETERMINISTIC',
            CASE WHEN v_mv_id IS NULL AND coalesce(v_mv_name,'') = '' THEN 'ineligible' ELSE 'eligible' END,
            v_section, v_sec_type, v_variant, v_at, v_mv_id, NULLIF(v_mv_name,''),
            v_field, 'universal', NULL, tp_val, coalesce(tp_unit, fp_unit), v_ctx, v_path, v_delta);
        END IF;
        CONTINUE;
      END IF;

      IF fp_mode = 'sex_specific' AND tp_mode = 'sex_specific' THEN
        -- male half
        IF fp_male IS DISTINCT FROM tp_male THEN
          v_path := format('s%s|v%s|p%s|m%s|f%s|dmale|%s', v_section, v_variant, coalesce(v_at::text,'-'),
                           coalesce(v_mv_id, v_mv_name, '-'), v_field, v_kind);
          v_inserted := v_inserted + public.p11_2_emit_evidence(
            v_run, c_extractor,
            CASE WHEN fp_male IS NULL THEN 'coach_completion' ELSE 'correction' END,
            CASE WHEN fp_male IS NULL THEN 'PRESCRIPTION_COMPLETION' ELSE v_tax END,
            'DETERMINISTIC',
            CASE WHEN v_mv_id IS NULL AND coalesce(v_mv_name,'') = '' THEN 'ineligible' ELSE 'eligible' END,
            v_section, v_sec_type, v_variant, v_at, v_mv_id, NULLIF(v_mv_name,''),
            v_field, 'male', fp_male, tp_male, coalesce(tp_unit, fp_unit), v_ctx, v_path, v_delta
          );
        END IF;
        -- female half
        IF fp_female IS DISTINCT FROM tp_female THEN
          v_path := format('s%s|v%s|p%s|m%s|f%s|dfemale|%s', v_section, v_variant, coalesce(v_at::text,'-'),
                           coalesce(v_mv_id, v_mv_name, '-'), v_field, v_kind);
          v_inserted := v_inserted + public.p11_2_emit_evidence(
            v_run, c_extractor,
            CASE WHEN fp_female IS NULL THEN 'coach_completion' ELSE 'correction' END,
            CASE WHEN fp_female IS NULL THEN 'PRESCRIPTION_COMPLETION' ELSE v_tax END,
            'DETERMINISTIC',
            CASE WHEN v_mv_id IS NULL AND coalesce(v_mv_name,'') = '' THEN 'ineligible' ELSE 'eligible' END,
            v_section, v_sec_type, v_variant, v_at, v_mv_id, NULLIF(v_mv_name,''),
            v_field, 'female', fp_female, tp_female, coalesce(tp_unit, fp_unit), v_ctx, v_path, v_delta
          );
        END IF;
      ELSIF fp_mode IS NOT DISTINCT FROM tp_mode
            AND coalesce(fp_mode,'universal') IN ('universal','text') THEN
        -- both universal / text
        IF fp_val IS DISTINCT FROM tp_val THEN
          v_path := format('s%s|v%s|p%s|m%s|f%s|duniversal|%s', v_section, v_variant, coalesce(v_at::text,'-'),
                           coalesce(v_mv_id, v_mv_name, '-'), v_field, v_kind);
          v_inserted := v_inserted + public.p11_2_emit_evidence(
            v_run, c_extractor,
            CASE WHEN fp_val IS NULL THEN 'coach_completion' ELSE 'correction' END,
            CASE WHEN fp_val IS NULL THEN 'PRESCRIPTION_COMPLETION' ELSE v_tax END,
            'DETERMINISTIC',
            CASE WHEN v_mv_id IS NULL AND coalesce(v_mv_name,'') = '' THEN 'ineligible' ELSE 'eligible' END,
            v_section, v_sec_type, v_variant, v_at, v_mv_id, NULLIF(v_mv_name,''),
            v_field, 'universal', fp_val, tp_val, coalesce(tp_unit, fp_unit), v_ctx, v_path, v_delta
          );
        END IF;
      ELSE
        -- mode change (universal <-> sex_specific, or NULL <-> present)
        v_path := format('s%s|v%s|p%s|m%s|f%s|dmode|%s', v_section, v_variant, coalesce(v_at::text,'-'),
                         coalesce(v_mv_id, v_mv_name, '-'), v_field, v_kind);
        v_inserted := v_inserted + public.p11_2_emit_evidence(
          v_run, c_extractor,
          CASE WHEN fp_mode IS NULL THEN 'coach_completion' ELSE 'correction' END,
          CASE WHEN fp_mode IS NULL THEN 'PRESCRIPTION_COMPLETION' ELSE v_tax END,
          'DETERMINISTIC',
          CASE WHEN v_mv_id IS NULL AND coalesce(v_mv_name,'') = '' THEN 'ineligible' ELSE 'eligible' END,
          v_section, v_sec_type, v_variant, v_at, v_mv_id, NULLIF(v_mv_name,''),
          v_field, 'sex_specific',
          public.p11_2_describe(fp_mode, fp_val, fp_male, fp_female),
          public.p11_2_describe(tp_mode, tp_val, tp_male, tp_female),
          coalesce(tp_unit, fp_unit), v_ctx, v_path, v_delta
        );
      END IF;
      CONTINUE;
    END IF;
  END LOOP;

  -- ------------------------------------------------------------------
  -- (B) D2 — coach_completion for a WHOLE variant tier the AI omitted.
  --     (Field-level completion inside a tier the AI DID produce is handled
  --      above: a metric delta whose `from` side is NULL.)
  -- ------------------------------------------------------------------
  SELECT (idx - 1) INTO v_primary_idx
  FROM jsonb_array_elements(v_run.saved_output) WITH ORDINALITY AS t(sec, idx)
  WHERE sec->>'isPrimary' = 'true'
  LIMIT 1;

  -- D2 needs a trustworthy AI-side tier signal. If normalized_output carries
  -- neither `.sections[]` nor `.scaling{}` we cannot tell what the AI omitted,
  -- so we emit NOTHING rather than guess (§38 — no fabricated certainty).
  IF v_primary_idx IS NOT NULL
     AND (jsonb_typeof(v_run.normalized_output->'sections') = 'array'
          OR jsonb_typeof(v_run.normalized_output->'scaling') = 'object')
  THEN
    v_sec_saved := v_run.saved_output->v_primary_idx;
    v_ctx := public.p11_2_section_fingerprint(v_sec_saved);

    -- Scaling tiers the AI actually produced, from the FLAT normalized_output:
    -- every sections[].scalingVersions[].level (on_ramp -> onramp) plus any
    -- non-null .scaling{} key. rx is always produced.
    v_ai_levels := ARRAY(
      SELECT DISTINCT lower(replace(lvl, '_', ''))
      FROM (
        SELECT sv->>'level' AS lvl
        FROM jsonb_array_elements(coalesce(v_run.normalized_output->'sections', '[]'::jsonb)) s,
             jsonb_array_elements(coalesce(s->'scalingVersions', '[]'::jsonb)) sv
        UNION ALL
        SELECT k FROM jsonb_object_keys(coalesce(v_run.normalized_output->'scaling', '{}'::jsonb)) k
        WHERE jsonb_typeof(coalesce(v_run.normalized_output->'scaling'->k, 'null'::jsonb)) = 'object'
      ) q
      WHERE lvl IS NOT NULL
    );

    FOREACH v_vk IN ARRAY ARRAY['intermediate','beginner','onramp'] LOOP
      v_saved_inst := v_sec_saved->'variants'->v_vk->'instances';
      IF NOT (v_vk = ANY (v_ai_levels))
         AND (v_saved_inst IS NOT NULL AND jsonb_typeof(v_saved_inst) = 'array' AND jsonb_array_length(v_saved_inst) > 0)
      THEN
        v_path := format('s%s|v%s|variant_completion', v_primary_idx, v_vk);
        v_inserted := v_inserted + public.p11_2_emit_evidence(
          v_run, c_extractor, 'coach_completion', 'VARIANT_COMPLETION', 'DETERMINISTIC', 'eligible',
          v_primary_idx, v_sec_saved->>'typeKey', v_vk, NULL, NULL, NULL,
          NULL, NULL,
          NULL,
          (jsonb_array_length(v_saved_inst))::text || ' movement(s)',
          NULL, v_ctx, v_path,
          jsonb_build_object('kind','variant_completion','variant',v_vk,
                             'movements', jsonb_array_length(v_saved_inst))
        );
      END IF;
    END LOOP;
  END IF;

  RETURN v_inserted;
END;
$$;

COMMENT ON FUNCTION public.p11_extract_correction_evidence(uuid) IS
  'P11.2 extractor (v1). Deterministic, idempotent, replayable. Source: the '
  'FROZEN ai_analysis_runs.normalized_output / saved_output / semantic_diff for '
  'ONE run. Emits ai_correction_evidence rows. Skips cosmetic deltas. Splits '
  'metric changes by gender dimension. D2 coach_completion for omitted tiers + '
  'null-baseline prescription fields. Bump c_extractor to re-interpret (old '
  'rows are never rewritten). Invocable manually — but bulk historical '
  'extraction requires owner authorisation (mission #10).';

REVOKE ALL ON FUNCTION public.p11_extract_correction_evidence(uuid) FROM PUBLIC, anon;
-- authenticated may replay for their own accepted run if a future coach tool
-- needs it; the function only reads a row already SELECT-visible to them and
-- writes tenant-scoped evidence. Bulk use stays owner-gated by convention.
GRANT EXECUTE ON FUNCTION public.p11_extract_correction_evidence(uuid) TO authenticated;

-- ============================================================================
-- 6. AFTER UPDATE trigger on ai_analysis_runs — fires once, fail-open
-- ============================================================================
CREATE OR REPLACE FUNCTION public.p11_ai_analysis_run_extract_trg()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF OLD.saved_at IS NULL AND NEW.saved_at IS NOT NULL THEN
    BEGIN
      PERFORM public.p11_extract_correction_evidence(NEW.id);
    EXCEPTION WHEN OTHERS THEN
      -- Learning extraction must NEVER block the coach's Save-linkage.
      RAISE WARNING 'p11_extract_correction_evidence failed for run %: %', NEW.id, SQLERRM;
    END;
  END IF;
  RETURN NULL;  -- AFTER trigger
END;
$$;

COMMENT ON FUNCTION public.p11_ai_analysis_run_extract_trg() IS
  'P11.2 — AFTER UPDATE on ai_analysis_runs. On saved_at NULL -> NOT NULL, runs '
  'the correction-evidence extractor in a fail-open sub-block. No automatic '
  'historical backfill (only NEW transitions).';

CREATE TRIGGER ai_analysis_runs_extract_evidence
  AFTER UPDATE ON public.ai_analysis_runs
  FOR EACH ROW EXECUTE FUNCTION public.p11_ai_analysis_run_extract_trg();

-- ============================================================================
-- 7. Read-only stats — tenant-guarded, no dashboard.
--    Accepted-run denominator is reported SEPARATELY from correction rows
--    (§53 — no manufactured field-level AI-error percentages).
-- ============================================================================
CREATE OR REPLACE FUNCTION public.p11_correction_evidence_stats(
  p_gym_id         uuid,
  p_from           timestamptz DEFAULT '-infinity',
  p_to             timestamptz DEFAULT 'infinity',
  p_prompt_version text DEFAULT NULL,
  p_model          text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE v_out jsonb;
BEGIN
  IF NOT public.is_coach_or_admin(p_gym_id) THEN
    RAISE EXCEPTION 'not authorized for gym %', p_gym_id;
  END IF;

  WITH runs AS (
    SELECT *
      FROM public.ai_analysis_runs
     WHERE gym_id = p_gym_id
       AND created_at >= p_from AND created_at < p_to
       AND (p_prompt_version IS NULL OR prompt_version = p_prompt_version)
       AND (p_model IS NULL OR model = p_model)
  ),
  ev AS (
    SELECT e.*
      FROM public.ai_correction_evidence e
      JOIN runs r ON r.id = e.ai_run_id
  )
  SELECT jsonb_build_object(
    -- denominator block (run-level; NEVER divided into the row counts)
    'runs_total',              (SELECT count(*) FROM runs),
    'eligible_saved_runs',     (SELECT count(*) FROM runs WHERE saved_at IS NOT NULL AND status = 'ok'),
    'accepted_unchanged_runs', (SELECT count(*) FROM runs WHERE outcome = 'accepted_unchanged'),
    'accepted_cosmetic_runs',  (SELECT count(*) FROM runs WHERE outcome = 'accepted_cosmetic'),
    'accepted_semantic_runs',  (SELECT count(*) FROM runs WHERE outcome = 'accepted_semantic'),
    'runs_with_evidence',      (SELECT count(DISTINCT ai_run_id) FROM ev),
    -- evidence-row block
    'evidence_rows_total',     (SELECT count(*) FROM ev),
    'correction_rows',         (SELECT count(*) FROM ev WHERE evidence_type = 'correction'),
    'coach_completion_rows',   (SELECT count(*) FROM ev WHERE evidence_type = 'coach_completion'),
    'deterministic_rows',      (SELECT count(*) FROM ev WHERE reliability = 'DETERMINISTIC'),
    'ambiguous_rows',          (SELECT count(*) FROM ev WHERE reliability = 'AMBIGUOUS'),
    'ineligible_rows',         (SELECT count(*) FROM ev WHERE eligibility = 'ineligible'),
    'by_taxonomy_kind',        (SELECT coalesce(jsonb_object_agg(taxonomy_kind, c), '{}'::jsonb) FROM (SELECT taxonomy_kind, count(*) c FROM ev GROUP BY 1) q),
    'by_variant',              (SELECT coalesce(jsonb_object_agg(coalesce(variant,'(none)'), c), '{}'::jsonb) FROM (SELECT variant, count(*) c FROM ev GROUP BY 1) q),
    'by_gender_dimension',     (SELECT coalesce(jsonb_object_agg(coalesce(gender_dimension,'(none)'), c), '{}'::jsonb) FROM (SELECT gender_dimension, count(*) c FROM ev GROUP BY 1) q),
    'by_movement',             (SELECT coalesce(jsonb_object_agg(m, c), '{}'::jsonb) FROM (SELECT coalesce(movement_id, movement_name) AS m, count(*) c FROM ev WHERE movement_id IS NOT NULL OR movement_name IS NOT NULL GROUP BY 1) q),
    'by_format',               (SELECT coalesce(jsonb_object_agg(f, c), '{}'::jsonb) FROM (SELECT coalesce(context_fingerprint->>'format','(none)') f, count(*) c FROM ev GROUP BY 1) q),
    'by_structure',            (SELECT coalesce(jsonb_object_agg(s, c), '{}'::jsonb) FROM (SELECT coalesce(context_fingerprint->>'structure','(none)') s, count(*) c FROM ev GROUP BY 1) q),
    'by_extractor_version',    (SELECT coalesce(jsonb_object_agg(extractor_version, c), '{}'::jsonb) FROM (SELECT extractor_version, count(*) c FROM ev GROUP BY 1) q)
  )
  INTO v_out;

  RETURN v_out;
END;
$$;

COMMENT ON FUNCTION public.p11_correction_evidence_stats(uuid, timestamptz, timestamptz, text, text) IS
  'P11.2 read-only evidence stats. Tenant-guarded. The run-level denominator '
  '(eligible_saved_runs / accepted_* / runs_with_evidence) is reported '
  'SEPARATELY from evidence-row counts — callers must NOT compute a field-level '
  'AI-error rate as rows/rows. One correction = one observation.';

REVOKE ALL ON FUNCTION public.p11_correction_evidence_stats(uuid, timestamptz, timestamptz, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.p11_correction_evidence_stats(uuid, timestamptz, timestamptz, text, text) TO authenticated;

COMMIT;

-- ============================================================================
-- REVERSIBILITY (manual DOWN, not auto-run):
--   DROP TRIGGER IF EXISTS ai_analysis_runs_extract_evidence ON public.ai_analysis_runs;
--   DROP FUNCTION IF EXISTS public.p11_ai_analysis_run_extract_trg();
--   DROP FUNCTION IF EXISTS public.p11_correction_evidence_stats(uuid, timestamptz, timestamptz, text, text);
--   DROP FUNCTION IF EXISTS public.p11_extract_correction_evidence(uuid);
--   DROP FUNCTION IF EXISTS public.p11_2_emit_evidence(public.ai_analysis_runs, text, text, text, text, text, integer, text, text, integer, text, text, text, text, text, text, text, jsonb, text, jsonb);
--   DROP TRIGGER IF EXISTS ai_correction_evidence_immutability ON public.ai_correction_evidence;
--   DROP FUNCTION IF EXISTS public.enforce_ai_correction_evidence_immutability();
--   DROP TABLE IF EXISTS public.ai_correction_evidence;
--   DROP FUNCTION IF EXISTS public.p11_2_section_fingerprint(jsonb);
--   DROP FUNCTION IF EXISTS public.p11_2_describe(text, text, text, text);
--   DROP FUNCTION IF EXISTS public.p11_2_spec_parts(jsonb);
--   DROP FUNCTION IF EXISTS public.p11_norm_movement_name(text);
-- All additive. Nothing else references these objects. No canonical table,
-- trigger, RLS policy, or Edge Function config is touched by this migration.
-- Kill switch: DROP TABLE public.ai_correction_evidence CASCADE; the trigger
-- then no-ops (the extractor's INSERT target is gone -> caught by the fail-open
-- sub-block) and coach authoring is completely unaffected.
-- ============================================================================
