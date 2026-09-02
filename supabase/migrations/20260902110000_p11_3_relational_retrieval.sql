-- P11.3 — Tenant-scoped relational retrieval + learning-hint selection
--
-- Owner status: authorised to audit + implement if no owner blocker.
-- Audit result: NO owner blocker. P11.2 `ai_correction_evidence` already
-- carries every structured dimension P11.3 needs (variant, movement id/name,
-- gender_dimension, unit, field, taxonomy_kind, context_fingerprint
-- format/structure, movement_position, section_type, reliability, eligibility,
-- extractor_version) — verified against production. Positive-opportunity
-- context is derived READ-TIME from the frozen P11.1 `saved_output` snapshot,
-- so no new table and no new persistence.
--
-- WHAT THIS DOES
--   ONE additive `SECURITY DEFINER` read-only function
--   `p11_retrieve_learning_hints(...)` + 2 pure helpers. Deterministic,
--   relational, tenant-scoped. Returns a machine-readable READ MODEL of
--   matched observations + aggregated patterns + (where derivable) positive
--   acceptance context + exclusion diagnostics.
--
-- WHAT THIS DOES NOT DO
--   No embeddings / pgvector / vector search. No RAG. No prompt injection.
--   No OpenAI call. No few-shot. AI Analyze is UNCHANGED. No fine-tuning.
--   No write to ANY table (wods / workouts / workout_sections /
--   movement_prescriptions / ai_analysis_runs / ai_correction_evidence).
--   No current-WOD reconstruction. No member-log read. No cross-gym pooling.
--   No new table, no new index (existing P11.1/P11.2 indexes suffice).
--
-- CANONICAL PRECEDENCE (§6) — retrieval sits BENEATH every hard invariant and
-- never reinterprets one: REST is timing not a movement; reps are structure;
-- programmed variant != performed modification; Sequence != Repeated Rounds;
-- P10 snapshot-first; unknown gender never male.

BEGIN;

-- ============================================================================
-- 0. Pure helpers
-- ============================================================================

-- Deterministic format family (§14). Same format = exact context; same family
-- = "strong" broader context; different family = "broad".
CREATE OR REPLACE FUNCTION public.p11_3_format_family(fmt text)
RETURNS text
LANGUAGE sql IMMUTABLE PARALLEL SAFE
AS $$
  SELECT CASE
    WHEN fmt IN ('AMRAP','For Time','RFT','Chipper','Ladder','Partner WOD',
                 'AMRAP with Buy-In','Chained AMRAP','Buy-In/Cash-Out',
                 'Ascending AMRAP','Complex','Not For Time','Max Effort')       THEN 'metcon'
    WHEN fmt IN ('EMOM','Tabata','Intervals','Death By','Death By Weight')      THEN 'interval'
    WHEN fmt IN ('Weightlifting','Strength Sets','Build to Heavy/1RM','Superset') THEN 'strength'
    ELSE coalesce(fmt, '(unknown)')
  END
$$;

-- Structure normalisation — byte-for-byte the JS `normStruct` in
-- src/aiProvenanceDiff.js (AMRAP: absent / 'Repeated Rounds' are equivalent).
CREATE OR REPLACE FUNCTION public.p11_3_norm_struct(fmt text, struct text)
RETURNS text
LANGUAGE sql IMMUTABLE PARALLEL SAFE
AS $$
  SELECT CASE
    WHEN fmt = 'AMRAP' AND (struct IS NULL OR struct = 'Repeated Rounds') THEN 'Repeated Rounds'
    ELSE struct
  END
$$;

-- ============================================================================
-- 1. p11_3_retrieve_impl — the deterministic read-model engine (NO auth check;
--    REVOKEd from every client; only the guarded wrapper below may call it).
-- ============================================================================
CREATE OR REPLACE FUNCTION public.p11_3_retrieve_impl(
  p_gym_id            uuid,
  p_taxonomy          text,                       -- REQUIRED: LOAD | REPS | STRUCTURE | ...
  p_variant           text        DEFAULT NULL,   -- rx | intermediate | beginner | onramp
  p_movement_id       text        DEFAULT NULL,   -- canonicalMovementId (id-first)
  p_movement_name     text        DEFAULT NULL,   -- fallback display name (normalised inside)
  p_gender_dimension  text        DEFAULT NULL,   -- universal | male | female
  p_unit              text        DEFAULT NULL,   -- kg | lb | m | km | ...
  p_format            text        DEFAULT NULL,
  p_structure         text        DEFAULT NULL,
  p_field             text        DEFAULT NULL,   -- for PRESCRIPTION_COMPLETION
  p_section_type      text        DEFAULT NULL,
  p_movement_position integer     DEFAULT NULL,
  p_from              timestamptz DEFAULT '-infinity',
  p_to                timestamptz DEFAULT 'infinity',
  p_evidence_type     text        DEFAULT NULL,   -- correction | coach_completion
  p_prompt_version    text        DEFAULT NULL,
  p_model             text        DEFAULT NULL,
  p_extractor_version text        DEFAULT NULL,
  p_max_patterns      integer     DEFAULT 20,
  p_max_observations  integer     DEFAULT 50
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  c_read_model_version constant text := 'p11.3-read-model-v1';
  v_out            jsonb;
  v_norm_name      text;
  v_q_struct_norm  text;
  v_q_family       text;
  v_warnings       text[] := ARRAY[]::text[];
  v_max_p          integer := least(greatest(coalesce(p_max_patterns, 20), 1), 100);
  v_max_o          integer := least(greatest(coalesce(p_max_observations, 50), 1), 500);
  -- taxonomy rule flags
  v_need_variant   boolean;
  v_need_movement  boolean;
  v_need_gender    boolean;
  v_need_unit      boolean;
  v_format_hard    boolean;
  v_struct_hard    boolean;
  v_pos_matters    boolean;   -- movement_position is semantically hard (Sequence / Chipper / Ladder)
  v_field_key      text;      -- saved_output instance key for the positive scan
BEGIN
  -- Tenant authorisation is enforced by the public wrapper
  -- p11_retrieve_learning_hints; this engine is REVOKEd from every client.
  IF p_taxonomy IS NULL OR btrim(p_taxonomy) = '' THEN
    RAISE EXCEPTION 'p_taxonomy is required (LOAD | REPS | STRUCTURE | ROUNDS | REST_TIME | ...)';
  END IF;

  v_norm_name     := public.p11_norm_movement_name(coalesce(p_movement_name, p_movement_id));
  v_q_struct_norm := public.p11_3_norm_struct(p_format, p_structure);
  v_q_family      := public.p11_3_format_family(p_format);

  -- ---- taxonomy compatibility matrix (§16 / §51) ----------------------
  v_need_variant  := p_taxonomy IN ('LOAD','DISTANCE','CALORIES','REPS','MOVEMENT_IDENTITY',
                                    'MOVEMENT_ADD','MOVEMENT_REMOVE','MOVEMENT_ORDER',
                                    'VARIANT_COMPLETION','PRESCRIPTION_COMPLETION');
  v_need_movement := p_taxonomy IN ('LOAD','DISTANCE','CALORIES','REPS','MOVEMENT_IDENTITY',
                                    'MOVEMENT_ADD','MOVEMENT_REMOVE','PRESCRIPTION_COMPLETION');
  v_need_gender   := p_taxonomy IN ('LOAD','DISTANCE','CALORIES','REPS');
  v_need_unit     := p_taxonomy IN ('LOAD','DISTANCE');
  v_format_hard   := p_taxonomy IN ('STRUCTURE','SCORE_FAMILY','ROUNDS','DURATION','REST_TIME');
  v_struct_hard   := p_taxonomy IN ('REST_TIME','REPS');
  v_pos_matters   := (p_taxonomy = 'REPS'
                      AND (v_q_struct_norm = 'Sequence' OR p_format IN ('Chipper','Ladder')));
  v_field_key     := CASE p_taxonomy
                       WHEN 'LOAD' THEN 'load' WHEN 'DISTANCE' THEN 'distance'
                       WHEN 'CALORIES' THEN 'calories' WHEN 'REPS' THEN 'reps'
                       WHEN 'PRESCRIPTION_COMPLETION' THEN nullif(p_field,'') END;

  IF v_need_movement AND p_movement_id IS NULL AND coalesce(v_norm_name,'') = '' THEN
    v_warnings := array_append(v_warnings, 'no movement supplied — patterns span every movement for this variant/taxonomy');
  END IF;
  IF v_need_unit AND p_unit IS NULL THEN
    v_warnings := array_append(v_warnings, 'no unit supplied — numeric before/after distributions may mix kg and lb; pass p_unit');
  END IF;
  IF v_need_gender AND p_gender_dimension IS NULL THEN
    v_warnings := array_append(v_warnings, 'no gender_dimension supplied — universal / male / female evidence not separated');
  END IF;
  IF v_need_variant AND p_variant IS NULL THEN
    v_warnings := array_append(v_warnings, 'no variant supplied — evidence not isolated by programmed variant');
  END IF;

  -- ---- candidate classification -------------------------------------
  WITH e AS (
    SELECT ev.*,
           r.created_at                          AS run_created_at,
           r.prompt_version, r.model, r.outcome,
           (ev.context_fingerprint->>'format')   AS e_format,
           public.p11_3_norm_struct(ev.context_fingerprint->>'format',
                                    ev.context_fingerprint->>'structure') AS e_struct_norm,
           public.p11_3_format_family(ev.context_fingerprint->>'format')  AS e_family
      FROM public.ai_correction_evidence ev
      JOIN public.ai_analysis_runs r ON r.id = ev.ai_run_id
     WHERE ev.gym_id = p_gym_id
       AND ev.taxonomy_kind = p_taxonomy
       AND r.created_at >= p_from AND r.created_at < p_to
  ),
  classified AS (
    SELECT e.*,
      CASE
        -- §18/§19 — only DETERMINISTIC + eligible evidence is a learning candidate
        WHEN e.reliability = 'AMBIGUOUS'        THEN 'ambiguous_reliability'
        WHEN e.reliability = 'UNSUPPORTED'      THEN 'unsupported_reliability'
        WHEN e.eligibility = 'ambiguous'        THEN 'ambiguous_eligibility'
        WHEN e.eligibility <> 'eligible'        THEN 'ineligible'
        WHEN p_evidence_type IS NOT NULL AND e.evidence_type <> p_evidence_type
                                               THEN 'other_evidence_type'
        WHEN p_extractor_version IS NOT NULL AND e.extractor_version <> p_extractor_version
                                               THEN 'other_extractor_version'
        WHEN p_prompt_version IS NOT NULL AND e.prompt_version IS DISTINCT FROM p_prompt_version
                                               THEN 'other_prompt_version'
        WHEN p_model IS NOT NULL AND e.model IS DISTINCT FROM p_model
                                               THEN 'other_model'
        -- §10 — no cross-variant leakage
        WHEN v_need_variant AND p_variant IS NOT NULL AND e.variant IS DISTINCT FROM p_variant
                                               THEN 'incompatible_variant'
        -- §12 — deterministic movement identity, id-first, no fuzzy match
        WHEN v_need_movement AND (p_movement_id IS NOT NULL OR coalesce(v_norm_name,'') <> '')
             AND NOT (
               (p_movement_id IS NOT NULL AND e.movement_id IS NOT NULL AND e.movement_id = p_movement_id)
               OR (coalesce(v_norm_name,'') <> '' AND e.movement_name = v_norm_name)
             )                                 THEN 'incompatible_movement'
        -- §11 — no cross-gender-dimension leakage
        WHEN v_need_gender AND p_gender_dimension IS NOT NULL
             AND e.gender_dimension IS DISTINCT FROM p_gender_dimension
                                               THEN 'incompatible_gender'
        -- §61 — never aggregate across incompatible units
        WHEN v_need_unit AND p_unit IS NOT NULL AND e.unit IS DISTINCT FROM p_unit
                                               THEN 'incompatible_unit'
        -- §13 — station position is hard only where semantically important
        WHEN v_pos_matters AND p_movement_position IS NOT NULL
             AND e.movement_position IS DISTINCT FROM p_movement_position
                                               THEN 'incompatible_position'
        -- §14/§15 — format / structure hard for structural taxonomies
        WHEN v_format_hard AND p_format IS NOT NULL AND e.e_format IS DISTINCT FROM p_format
                                               THEN 'incompatible_format'
        WHEN v_struct_hard AND p_structure IS NOT NULL
             AND e.e_struct_norm IS NOT NULL
             AND e.e_struct_norm IS DISTINCT FROM v_q_struct_norm
                                               THEN 'incompatible_structure'
        WHEN p_section_type IS NOT NULL AND e.section_type IS DISTINCT FROM p_section_type
                                               THEN 'incompatible_section_type'
        ELSE NULL
      END AS exclude_reason
    FROM e
  ),
  scored AS (
    SELECT c.*,
      CASE
        WHEN (p_format IS NULL OR c.e_format = p_format)
         AND (p_structure IS NULL OR c.e_struct_norm IS NULL OR c.e_struct_norm = v_q_struct_norm)
                                                             THEN 'exact'
        WHEN p_format IS NOT NULL AND c.e_family = v_q_family THEN 'strong'
        ELSE 'broad'
      END AS match_level
    FROM classified c
    WHERE c.exclude_reason IS NULL
  ),
  matched AS (
    SELECT s.*,
           (coalesce(s.evidence_type,'-') ||'|'|| coalesce(s.variant,'-') ||'|'||
            coalesce(s.movement_id, s.movement_name, '-') ||'|'||
            coalesce(s.gender_dimension,'-') ||'|'|| coalesce(s.unit,'-') ||'|'||
            coalesce(s.e_family,'-') ||'|'|| coalesce(s.e_struct_norm,'-')) AS pattern_key
    FROM scored s
  ),
  -- ---- pre-aggregated distributions (§22-§28) --------------------
  bdist AS (
    SELECT pattern_key, before_value v, count(*) c
      FROM matched GROUP BY pattern_key, before_value
  ),
  adist AS (
    SELECT pattern_key, after_value v, count(*) c
      FROM matched GROUP BY pattern_key, after_value
  ),
  arun AS (  -- per (pattern, after_value): how many DISTINCT runs land there (§23)
    SELECT pattern_key, after_value v, count(DISTINCT ai_run_id) rc
      FROM matched GROUP BY pattern_key, after_value
  ),
  pat AS (
    SELECT
      m.pattern_key,
      min(m.evidence_type)    AS evidence_type,
      min(m.variant)          AS variant,
      min(m.movement_id)      AS movement_id,
      min(m.movement_name)    AS movement_name,
      min(m.gender_dimension) AS gender_dimension,
      min(m.unit)             AS unit,
      min(m.e_family)         AS format_family,
      min(m.e_struct_norm)    AS structure_norm,
      count(*)                                          AS observation_count,
      count(DISTINCT m.ai_run_id)                       AS distinct_run_count,
      count(*) FILTER (WHERE m.match_level = 'exact')   AS exact_count,
      count(*) FILTER (WHERE m.match_level = 'strong')  AS strong_count,
      count(*) FILTER (WHERE m.match_level = 'broad')   AS broad_count,
      min(m.run_created_at)                             AS earliest_observed_at,
      max(m.run_created_at)                             AS latest_observed_at,
      count(DISTINCT m.after_value)                     AS distinct_after,
      jsonb_agg(DISTINCT m.extractor_version)           AS extractor_versions,
      jsonb_agg(DISTINCT m.prompt_version) FILTER (WHERE m.prompt_version IS NOT NULL) AS prompt_versions,
      jsonb_agg(DISTINCT m.model)          FILTER (WHERE m.model IS NOT NULL)          AS models
    FROM matched m
    GROUP BY m.pattern_key
  ),
  pat3 AS (
    SELECT p.*,
      (SELECT max(rc) FROM arun a WHERE a.pattern_key = p.pattern_key)               AS modal_after_run_count,
      (SELECT jsonb_agg(jsonb_build_object('value', v, 'count', c) ORDER BY c DESC, v)
         FROM bdist b WHERE b.pattern_key = p.pattern_key)                           AS before_distribution,
      (SELECT jsonb_agg(jsonb_build_object('value', v, 'count', c) ORDER BY c DESC, v)
         FROM adist d WHERE d.pattern_key = p.pattern_key)                           AS after_distribution,
      (SELECT jsonb_agg(x ORDER BY x) FROM (
         SELECT DISTINCT m.ai_run_id x FROM matched m
          WHERE m.pattern_key = p.pattern_key ORDER BY x LIMIT 25) s)                AS source_run_ids,
      CASE
        WHEN p.distinct_after <= 1 THEN 'CONSISTENT'
        WHEN (SELECT max(rc) FROM arun a WHERE a.pattern_key = p.pattern_key)::numeric
             > p.distinct_run_count::numeric / 2.0                                   THEN 'MIXED'
        ELSE 'CONFLICTING'
      END AS conflict_state
    FROM pat p
  ),
  pat4 AS (
    SELECT p.*,
      CASE
        WHEN conflict_state = 'CONFLICTING' THEN 'conflicting'
        WHEN distinct_run_count >= 3        THEN 'supported'
        WHEN distinct_run_count = 2         THEN 'weak'
        ELSE 'observation_only'
      END AS strength
    FROM pat3 p
  )
  SELECT jsonb_build_object(
    'readModelVersion', c_read_model_version,
    'generatedAt', now(),
    'queryContext', jsonb_build_object(
      'gymId', p_gym_id, 'taxonomy', p_taxonomy, 'variant', p_variant,
      'movementId', p_movement_id, 'movementName', p_movement_name,
      'movementNameNormalized', nullif(v_norm_name,''),
      'genderDimension', p_gender_dimension, 'unit', p_unit,
      'format', p_format, 'structure', p_structure, 'structureNormalized', v_q_struct_norm,
      'field', p_field, 'sectionType', p_section_type, 'movementPosition', p_movement_position,
      'evidenceType', p_evidence_type, 'promptVersion', p_prompt_version, 'model', p_model,
      'extractorVersion', p_extractor_version,
      'window', jsonb_build_object('from', p_from, 'to', p_to),
      'limits', jsonb_build_object('maxPatterns', v_max_p, 'maxObservations', v_max_o),
      'positionIsHard', v_pos_matters,
      'warnings', to_jsonb(v_warnings)
    ),
    'patterns', coalesce((
      SELECT jsonb_agg(jsonb_build_object(
        'patternKey', pattern_key,
        'evidenceType', evidence_type, 'taxonomyKind', p_taxonomy, 'variant', variant,
        'movementId', movement_id, 'movementName', movement_name,
        'genderDimension', gender_dimension, 'unit', unit,
        'formatFamily', format_family, 'structureNorm', structure_norm,
        'distinctRunCount', distinct_run_count, 'observationCount', observation_count,
        'exactContextCount', exact_count, 'strongContextCount', strong_count, 'broaderContextCount', broad_count,
        'beforeDistribution', coalesce(before_distribution, '[]'::jsonb),
        'afterDistribution', coalesce(after_distribution, '[]'::jsonb),
        'earliestObservedAt', earliest_observed_at, 'latestObservedAt', latest_observed_at,
        'daysSinceLatest', floor(extract(epoch FROM (now() - latest_observed_at)) / 86400)::int,
        'conflictState', conflict_state, 'strength', strength,
        'sourceRunIds', coalesce(source_run_ids, '[]'::jsonb),
        'extractorVersions', coalesce(extractor_versions, '[]'::jsonb),
        'promptVersions', coalesce(prompt_versions, '[]'::jsonb),
        'models', coalesce(models, '[]'::jsonb)
      ) ORDER BY
        (exact_count > 0) DESC,
        CASE strength WHEN 'supported' THEN 0 WHEN 'weak' THEN 1 WHEN 'observation_only' THEN 2 ELSE 3 END,
        distinct_run_count DESC, latest_observed_at DESC, pattern_key)
      FROM (SELECT * FROM pat4 ORDER BY
              (exact_count > 0) DESC,
              CASE strength WHEN 'supported' THEN 0 WHEN 'weak' THEN 1 WHEN 'observation_only' THEN 2 ELSE 3 END,
              distinct_run_count DESC, latest_observed_at DESC, pattern_key
            LIMIT v_max_p) lim
    ), '[]'::jsonb),
    'exactMatches', coalesce((
      SELECT jsonb_agg(o ORDER BY (o->>'runCreatedAt') DESC, o->>'evidenceId')
      FROM (
        SELECT jsonb_build_object(
          'evidenceId', id, 'runId', ai_run_id, 'runCreatedAt', run_created_at,
          'evidenceType', evidence_type, 'variant', variant,
          'movementId', movement_id, 'movementName', movement_name, 'movementPosition', movement_position,
          'genderDimension', gender_dimension, 'unit', unit, 'field', field,
          'before', before_value, 'after', after_value,
          'format', e_format, 'structureNorm', e_struct_norm,
          'matchLevel', match_level, 'extractorVersion', extractor_version,
          'promptVersion', prompt_version, 'model', model
        ) o
        FROM matched WHERE match_level = 'exact'
        ORDER BY run_created_at DESC, id LIMIT v_max_o
      ) s
    ), '[]'::jsonb),
    'broaderMatches', coalesce((
      SELECT jsonb_agg(o ORDER BY (o->>'runCreatedAt') DESC, o->>'evidenceId')
      FROM (
        SELECT jsonb_build_object(
          'evidenceId', id, 'runId', ai_run_id, 'runCreatedAt', run_created_at,
          'evidenceType', evidence_type, 'variant', variant,
          'movementId', movement_id, 'movementName', movement_name, 'movementPosition', movement_position,
          'genderDimension', gender_dimension, 'unit', unit, 'field', field,
          'before', before_value, 'after', after_value,
          'format', e_format, 'structureNorm', e_struct_norm,
          'matchLevel', match_level, 'extractorVersion', extractor_version,
          'promptVersion', prompt_version, 'model', model
        ) o
        FROM matched WHERE match_level IN ('strong','broad')
        ORDER BY run_created_at DESC, id LIMIT v_max_o
      ) s
    ), '[]'::jsonb),
    'excluded', (
      SELECT coalesce(jsonb_object_agg(exclude_reason, c), '{}'::jsonb)
      FROM (SELECT exclude_reason, count(*) c FROM classified
             WHERE exclude_reason IS NOT NULL GROUP BY 1) q
    ),
    'candidateTotals', jsonb_build_object(
      'taxonomyRowsInGymWindow', (SELECT count(*) FROM classified),
      'matchedRows', (SELECT count(*) FROM matched),
      'matchedDistinctRuns', (SELECT count(DISTINCT ai_run_id) FROM matched),
      'patternCount', (SELECT count(*) FROM pat)
    )
  )
  INTO v_out;

  -- ---- positive acceptance context (§20 / §52 / §53) ---------------
  -- Derived READ-TIME from the FROZEN P11.1 saved_output. Only where a
  -- field-level opportunity is deterministically identifiable (a comparable
  -- movement + variant + field instance in a semantically-accepted saved
  -- workout). NULL for taxonomies where no such denominator exists (§21 — no
  -- fabricated precision).
  IF p_taxonomy IN ('LOAD','REPS','DISTANCE','CALORIES','PRESCRIPTION_COMPLETION')
     AND p_variant IS NOT NULL
     AND (p_movement_id IS NOT NULL OR coalesce(v_norm_name,'') <> '')
     AND v_field_key IS NOT NULL
  THEN
    WITH comp AS (
      SELECT r.id, r.outcome
        FROM public.ai_analysis_runs r
       WHERE r.gym_id = p_gym_id
         AND r.created_at >= p_from AND r.created_at < p_to
         AND r.saved_at IS NOT NULL AND r.status = 'ok'
         AND r.outcome IN ('accepted_unchanged','accepted_cosmetic','accepted_semantic')
         AND jsonb_typeof(r.saved_output) = 'array'
         AND EXISTS (
           SELECT 1
             FROM jsonb_array_elements(r.saved_output) sec,
                  jsonb_array_elements(
                    CASE WHEN jsonb_typeof(sec->'variants'->p_variant->'instances') = 'array'
                         THEN sec->'variants'->p_variant->'instances' ELSE '[]'::jsonb END) inst
            WHERE sec->>'isPrimary' = 'true'
              AND (
                (p_movement_id IS NOT NULL AND inst->>'canonicalMovementId' = p_movement_id)
                OR (coalesce(v_norm_name,'') <> '' AND public.p11_norm_movement_name(inst->>'name') = v_norm_name)
              )
              AND jsonb_typeof(inst->v_field_key) = 'object'
              AND (NOT v_need_unit OR p_unit IS NULL OR inst->v_field_key->>'unit' = p_unit)
              AND (p_gender_dimension IS NULL
                   OR (p_gender_dimension = 'universal' AND inst->v_field_key->>'mode' = 'universal')
                   OR (p_gender_dimension IN ('male','female') AND inst->v_field_key->>'mode' = 'sex_specific'))
         )
    ),
    corr AS (
      SELECT DISTINCT ai_run_id FROM public.ai_correction_evidence
       WHERE gym_id = p_gym_id AND taxonomy_kind = p_taxonomy AND eligibility = 'eligible'
         AND (p_variant IS NULL OR variant = p_variant)
         AND (p_gender_dimension IS NULL OR gender_dimension = p_gender_dimension)
         AND (
           (p_movement_id IS NOT NULL AND movement_id = p_movement_id)
           OR (coalesce(v_norm_name,'') <> '' AND movement_name = v_norm_name)
         )
    )
    SELECT jsonb_set(v_out, '{positiveContext}', jsonb_build_object(
      'basis', 'runs whose FROZEN saved_output primary section carries a comparable '
             || p_variant || ' ' || coalesce(nullif(v_norm_name,''), p_movement_id)
             || ' ' || v_field_key || ' instance, and whose outcome is accepted_*',
      'comparableRunCount', (SELECT count(*) FROM comp),
      'correctionBearingRunCount', (SELECT count(*) FROM comp WHERE id IN (SELECT ai_run_id FROM corr)),
      'acceptedAsProposedRunCount', (SELECT count(*) FROM comp WHERE id NOT IN (SELECT ai_run_id FROM corr)),
      'byOutcome', (SELECT coalesce(jsonb_object_agg(outcome, c), '{}'::jsonb)
                      FROM (SELECT outcome, count(*) c FROM comp GROUP BY 1) q),
      'fieldLevelCorrectionRate', (
        SELECT CASE WHEN count(*) >= 3
               THEN round((SELECT count(*) FROM comp WHERE id IN (SELECT ai_run_id FROM corr))::numeric
                          / count(*)::numeric, 4)
               ELSE NULL END FROM comp),
      'note', 'rate is NULL unless comparableRunCount >= 3 (§21 — no fabricated precision)'
    )) INTO v_out;
  ELSE
    SELECT jsonb_set(v_out, '{positiveContext}', 'null'::jsonb) INTO v_out;
  END IF;

  RETURN v_out;
END;
$$;

-- engine signature (20 args)
REVOKE ALL ON FUNCTION public.p11_3_retrieve_impl(uuid, text, text, text, text, text, text, text, text, text, text, integer, timestamptz, timestamptz, text, text, text, text, integer, integer) FROM PUBLIC, anon, authenticated;

-- ============================================================================
-- 2. p11_retrieve_learning_hints — public tenant-guarded wrapper (§45)
-- ============================================================================
CREATE OR REPLACE FUNCTION public.p11_retrieve_learning_hints(
  p_gym_id            uuid,
  p_taxonomy          text,
  p_variant           text        DEFAULT NULL,
  p_movement_id       text        DEFAULT NULL,
  p_movement_name     text        DEFAULT NULL,
  p_gender_dimension  text        DEFAULT NULL,
  p_unit              text        DEFAULT NULL,
  p_format            text        DEFAULT NULL,
  p_structure         text        DEFAULT NULL,
  p_field             text        DEFAULT NULL,
  p_section_type      text        DEFAULT NULL,
  p_movement_position integer     DEFAULT NULL,
  p_from              timestamptz DEFAULT '-infinity',
  p_to                timestamptz DEFAULT 'infinity',
  p_evidence_type     text        DEFAULT NULL,
  p_prompt_version    text        DEFAULT NULL,
  p_model             text        DEFAULT NULL,
  p_extractor_version text        DEFAULT NULL,
  p_max_patterns      integer     DEFAULT 20,
  p_max_observations  integer     DEFAULT 50
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT public.is_coach_or_admin(p_gym_id) THEN
    RAISE EXCEPTION 'not authorized for gym %', p_gym_id;
  END IF;
  RETURN public.p11_3_retrieve_impl(
    p_gym_id, p_taxonomy, p_variant, p_movement_id, p_movement_name, p_gender_dimension,
    p_unit, p_format, p_structure, p_field, p_section_type, p_movement_position,
    p_from, p_to, p_evidence_type, p_prompt_version, p_model, p_extractor_version,
    p_max_patterns, p_max_observations);
END;
$$;

COMMENT ON FUNCTION public.p11_retrieve_learning_hints(uuid, text, text, text, text, text, text, text, text, text, text, integer, timestamptz, timestamptz, text, text, text, text, integer, integer) IS
  'P11.3 read model (v1). Deterministic, relational, tenant-scoped retrieval of '
  'eligible DETERMINISTIC P11.2 correction / coach_completion evidence for a '
  'candidate authoring context. Taxonomy-specific compatibility; no cross-variant '
  '/ cross-gender / cross-unit / cross-gym leakage; no fuzzy movement match. '
  'Returns matched observations + aggregated patterns (distinct-run strength, '
  'conflict state, before/after distributions) + read-time positive acceptance '
  'context + exclusion diagnostics. NEVER calls OpenAI, injects a prompt, uses '
  'embeddings, or writes any table. Tenant-guarded; delegates to '
  'p11_3_retrieve_impl.';

REVOKE ALL ON FUNCTION public.p11_retrieve_learning_hints(uuid, text, text, text, text, text, text, text, text, text, text, integer, timestamptz, timestamptz, text, text, text, text, integer, integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.p11_retrieve_learning_hints(uuid, text, text, text, text, text, text, text, text, text, text, integer, timestamptz, timestamptz, text, text, text, text, integer, integer) TO authenticated;

COMMIT;

-- ============================================================================
-- REVERSIBILITY (manual DOWN, not auto-run):
--   DROP FUNCTION IF EXISTS public.p11_retrieve_learning_hints(uuid, text, text, text, text, text, text, text, text, text, text, integer, timestamptz, timestamptz, text, text, text, text, integer, integer);
--   DROP FUNCTION IF EXISTS public.p11_3_retrieve_impl(uuid, text, text, text, text, text, text, text, text, text, text, integer, timestamptz, timestamptz, text, text, text, text, integer, integer);
--   DROP FUNCTION IF EXISTS public.p11_3_norm_struct(text, text);
--   DROP FUNCTION IF EXISTS public.p11_3_format_family(text);
-- All additive, read-only. No table / index / trigger / RLS policy / Edge
-- Function is created or altered. Nothing references these objects.
-- ============================================================================
