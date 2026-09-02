-- P11.5 — Learning calibration + controlled ACTIVE rollout: read-only tooling
--
-- Owner status: implement ONLY the minimum missing read-only tooling to
-- EVALUATE learning. NO new learning architecture, NO new learning source, NO
-- relaxed safety thresholds, NO two-pass, NO embeddings, NO member data.
--
-- WHAT THIS DOES
--   ONE additive `SECURITY DEFINER` read-only function
--   `p11_learning_calibration_status(...)`. It computes — from the EXISTING
--   `ai_analysis_runs` + `ai_correction_evidence` + `ai_analysis_run_learning`
--   only — the learning funnel, pattern maturity, ACTIVE eligibility (parity
--   with the P11.4 selector `p11.4-selector-v1`), zero-hint reasons, retrieval
--   health, mode cohorts, semantic correction burden, and taxonomy / variant /
--   gender coverage.
--
-- WHAT THIS DOES NOT DO
--   No table, no index, no trigger, no RLS change, no schema change to any
--   P11.1-P11.4 object. No write to any table. No mode change (that is an env
--   secret + an explicit owner gate). No divergent eligibility algorithm — it
--   reuses `p11_3_retrieve_impl` for pattern strength/conflict and applies the
--   identical final boolean the P11.4 serializer applies. Fully reversible.

BEGIN;

CREATE OR REPLACE FUNCTION public.p11_learning_calibration_status(
  p_gym_id        uuid,
  p_from          timestamptz DEFAULT '-infinity',
  p_to            timestamptz DEFAULT 'infinity',
  p_taxonomy      text DEFAULT NULL,
  p_variant       text DEFAULT NULL,
  p_movement      text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  c_selector_version constant text := 'p11.4-selector-v1';
  c_active_allowlist constant text[] := ARRAY['LOAD','VARIANT_COMPLETION','STRUCTURE'];
  v_out       jsonb;
  v_ctx       record;
  v_patterns  jsonb := '[]'::jsonb;   -- flattened p11_3 patterns across evidence contexts
  v_pat       jsonb;
BEGIN
  IF NOT public.is_coach_or_admin(p_gym_id) THEN
    RAISE EXCEPTION 'not authorized for gym %', p_gym_id;
  END IF;

  -- ---- gather P11.3 patterns for every distinct ELIGIBLE evidence context --
  -- (bounded: one call per distinct (taxonomy, variant, movement, gender, unit)
  --  the gym has evidence for). Reuses the P11.3 engine -> no fourth truth.
  FOR v_ctx IN
    SELECT DISTINCT taxonomy_kind, variant,
           coalesce(movement_id, movement_name) AS mv,
           gender_dimension, unit
      FROM public.ai_correction_evidence
     WHERE gym_id = p_gym_id
       AND eligibility = 'eligible'
       AND (p_taxonomy IS NULL OR taxonomy_kind = p_taxonomy)
       AND (p_variant  IS NULL OR variant = p_variant)
       AND (p_movement IS NULL OR coalesce(movement_id, movement_name) = public.p11_norm_movement_name(p_movement))
  LOOP
    v_pat := coalesce(
      (public.p11_3_retrieve_impl(
        p_gym_id, v_ctx.taxonomy_kind, v_ctx.variant, NULL, v_ctx.mv,
        v_ctx.gender_dimension, v_ctx.unit, NULL, NULL, NULL, NULL, NULL,
        p_from, p_to, NULL, NULL, NULL, NULL, 50, 1
      ))->'patterns', '[]'::jsonb);
    v_patterns := v_patterns || v_pat;
  END LOOP;

  WITH
  runs AS (
    SELECT r.*, coalesce(l.learning_mode, 'off') AS mode,
           coalesce(l.selected_hint_count, 0)    AS sel_hints,
           coalesce(l.candidate_hint_count, 0)   AS cand_hints,
           coalesce(l.retrieval_status, 'disabled') AS retr_status,
           l.retrieval_latency_ms
      FROM public.ai_analysis_runs r
      LEFT JOIN public.ai_analysis_run_learning l ON l.ai_run_id = r.id
     WHERE r.gym_id = p_gym_id
       AND r.created_at >= p_from AND r.created_at < p_to
  ),
  ev AS (
    SELECT * FROM public.ai_correction_evidence
     WHERE gym_id = p_gym_id
       AND created_at >= p_from AND created_at < p_to
  ),
  -- per-saved-run semantic delta burden (severity semantic|critical), from the
  -- FROZEN P11.1 semantic_diff. Cosmetic deltas never count.
  burden AS (
    SELECT r.id, r.mode,
           (SELECT count(*) FROM jsonb_array_elements(coalesce(r.semantic_diff->'deltas','[]'::jsonb)) d
             WHERE d->>'severity' IN ('semantic','critical')) AS sem_deltas
      FROM runs r WHERE r.saved_at IS NOT NULL
  ),
  -- flatten the gathered p11_3 patterns
  pat AS (
    SELECT value AS p FROM jsonb_array_elements(v_patterns)
  ),
  pat_typed AS (
    SELECT
      p->>'patternKey'                          AS pattern_key,
      p->>'taxonomyKind'                        AS taxonomy,
      p->>'evidenceType'                        AS evidence_type,
      p->>'variant'                             AS variant,
      coalesce(p->>'movementId', p->>'movementName') AS movement,
      p->>'genderDimension'                     AS gender_dimension,
      p->>'unit'                                AS unit,
      p->>'formatFamily'                        AS format_family,
      p->>'structureNorm'                       AS structure_norm,
      (p->>'distinctRunCount')::int             AS distinct_run_count,
      (p->>'observationCount')::int             AS observation_count,
      (p->>'exactContextCount')::int            AS exact_ctx,
      (p->>'strongContextCount')::int           AS strong_ctx,
      (p->>'broaderContextCount')::int          AS broad_ctx,
      p->>'strength'                            AS strength,
      p->>'conflictState'                       AS conflict_state,
      p->>'earliestObservedAt'                  AS earliest_observed_at,
      p->>'latestObservedAt'                    AS latest_observed_at,
      p->'afterDistribution'                    AS after_distribution,
      p->'beforeDistribution'                   AS before_distribution
    FROM pat p
  ),
  pat_dedup AS (  -- one row per distinct pattern_key
    SELECT DISTINCT ON (pattern_key) * FROM pat_typed ORDER BY pattern_key, distinct_run_count DESC
  ),
  pat_calibrated AS (
    SELECT pd.*,
      (conflict_state = 'CONFLICTING')                                AS blocked_by_conflict,
      greatest(0, 3 - distinct_run_count)                             AS distance_to_supported,
      -- ACTIVE eligibility -- BYTE-IDENTICAL to learningHints.ts selectAndSerialize
      -- (p11.4-selector-v1): strength=supported AND conflictState=CONSISTENT
      -- AND distinctRunCount>=3 AND strongContextCount=0 AND broaderContextCount=0
      -- AND exactContextCount>=1 AND taxonomy in the ACTIVE allowlist.
      (strength = 'supported'
       AND conflict_state = 'CONSISTENT'
       AND distinct_run_count >= 3
       AND strong_ctx = 0
       AND broad_ctx = 0
       AND exact_ctx >= 1
       AND taxonomy = ANY (c_active_allowlist))                       AS active_eligible,
      -- STRUCTURE additionally needs the raw input to literally declare the
      -- structure at query time (the deterministic pre-model parser cannot
      -- infer it) -- calibration cannot know this, so flag it.
      (taxonomy = 'STRUCTURE')                                        AS requires_explicit_structure_pre_model
    FROM pat_dedup pd
  )
  SELECT jsonb_build_object(
    'calibrationVersion', 'p11.5-calibration-v1',
    'selectorParityWith', c_selector_version,
    'generatedAt', now(),
    'gymId', p_gym_id,
    'window', jsonb_build_object('from', p_from, 'to', p_to),
    'filters', jsonb_build_object('taxonomy', p_taxonomy, 'variant', p_variant, 'movement', p_movement),

    -- §7 learning funnel
    'funnel', jsonb_build_object(
      'aiRuns',                        (SELECT count(*) FROM runs),
      'savedRuns',                     (SELECT count(*) FROM runs WHERE saved_at IS NOT NULL),
      'runsWithSemanticCorrection',    (SELECT count(*) FROM runs WHERE outcome = 'accepted_semantic'),
      'p11_2_eligibleEvidence',        (SELECT count(*) FROM ev WHERE eligibility = 'eligible' AND reliability = 'DETERMINISTIC'),
      'p11_2_ambiguousEvidence',       (SELECT count(*) FROM ev WHERE eligibility <> 'eligible' OR reliability = 'AMBIGUOUS'),
      'p11_3_distinctPatterns',        (SELECT count(*) FROM pat_dedup),
      'observationOnlyPatterns',       (SELECT count(*) FROM pat_calibrated WHERE strength = 'observation_only'),
      'weakPatterns',                  (SELECT count(*) FROM pat_calibrated WHERE strength = 'weak'),
      'supportedPatterns',             (SELECT count(*) FROM pat_calibrated WHERE strength = 'supported'),
      'consistentExactSupported',      (SELECT count(*) FROM pat_calibrated WHERE strength = 'supported' AND conflict_state = 'CONSISTENT' AND strong_ctx = 0 AND broad_ctx = 0 AND exact_ctx >= 1),
      'activeEligibleHints',           (SELECT count(*) FROM pat_calibrated WHERE active_eligible),
      'activeInjectedHints',           (SELECT coalesce(sum(sel_hints), 0) FROM runs WHERE mode = 'active'),
      'coachAcceptance', jsonb_build_object(
        'accepted_unchanged', (SELECT count(*) FROM runs WHERE outcome = 'accepted_unchanged'),
        'accepted_cosmetic',  (SELECT count(*) FROM runs WHERE outcome = 'accepted_cosmetic'),
        'accepted_semantic',  (SELECT count(*) FROM runs WHERE outcome = 'accepted_semantic'))
    ),

    -- §9/§10/§11 pattern maturity
    'patternMaturity', (SELECT coalesce(jsonb_agg(jsonb_build_object(
        'patternKey', pattern_key, 'taxonomy', taxonomy, 'evidenceType', evidence_type,
        'variant', variant, 'movement', movement, 'genderDimension', gender_dimension,
        'unit', unit, 'formatFamily', format_family, 'structureNorm', structure_norm,
        'distinctRunCount', distinct_run_count, 'observationCount', observation_count,
        'strength', strength, 'conflictState', conflict_state,
        'exactContextCount', exact_ctx, 'strongContextCount', strong_ctx, 'broaderContextCount', broad_ctx,
        'earliestObservedAt', earliest_observed_at, 'latestObservedAt', latest_observed_at,
        'beforeDistribution', before_distribution, 'afterDistribution', after_distribution,
        'distanceToSupported', distance_to_supported, 'blockedByConflict', blocked_by_conflict,
        'activeEligible', active_eligible,
        'requiresExplicitStructurePreModel', requires_explicit_structure_pre_model
      ) ORDER BY active_eligible DESC, distinct_run_count DESC, latest_observed_at DESC, pattern_key), '[]'::jsonb)
      FROM pat_calibrated),

    -- §13/§23/§24 mode cohorts
    'modeCohorts', jsonb_build_object(
      'off',    (SELECT count(*) FROM runs WHERE mode = 'off'),
      'shadow', (SELECT count(*) FROM runs WHERE mode = 'shadow'),
      'active', (SELECT count(*) FROM runs WHERE mode = 'active'),
      'shadowEligible',  (SELECT count(*) FROM runs WHERE mode = 'shadow' AND sel_hints > 0),
      'hintExposed',     (SELECT count(*) FROM runs WHERE mode = 'active' AND sel_hints > 0 AND retr_status = 'active_selected'),
      'activeZeroHint',  (SELECT count(*) FROM runs WHERE mode = 'active' AND sel_hints = 0),
      'shadowHintCoverage', (
        SELECT CASE WHEN count(*) FILTER (WHERE mode = 'shadow') = 0 THEN NULL
               ELSE round(count(*) FILTER (WHERE mode = 'shadow' AND sel_hints > 0)::numeric
                          / count(*) FILTER (WHERE mode = 'shadow')::numeric, 4) END FROM runs)
    ),

    -- §14 zero-hint reasons (shadow + active, selected_hint_count = 0)
    'zeroHintReasons', (SELECT coalesce(jsonb_object_agg(reason, c), '{}'::jsonb) FROM (
      SELECT CASE retr_status
               WHEN 'disabled'         THEN 'mode_off'
               WHEN 'no_context'       THEN 'no_pre_model_context'
               WHEN 'no_matches'       THEN 'no_matching_evidence'
               WHEN 'no_eligible_hints' THEN 'candidates_but_not_supported_exact_consistent'
               WHEN 'retrieval_failed' THEN 'retrieval_failure'
               ELSE retr_status
             END AS reason, count(*) c
        FROM runs WHERE mode IN ('shadow','active') AND sel_hints = 0 GROUP BY 1) q),

    -- §15 retrieval health
    'retrievalHealth', jsonb_build_object(
      'retrievalRuns',   (SELECT count(*) FROM runs WHERE mode IN ('shadow','active')),
      'failures',        (SELECT count(*) FROM runs WHERE retr_status = 'retrieval_failed'),
      'successRate', (
        SELECT CASE WHEN count(*) FILTER (WHERE mode IN ('shadow','active')) = 0 THEN NULL
               ELSE round(count(*) FILTER (WHERE mode IN ('shadow','active') AND retr_status <> 'retrieval_failed')::numeric
                          / count(*) FILTER (WHERE mode IN ('shadow','active'))::numeric, 4) END FROM runs),
      'avgLatencyMs',    (SELECT round(avg(retrieval_latency_ms)::numeric, 1) FROM runs WHERE retrieval_latency_ms IS NOT NULL),
      'p95LatencyMs',    (SELECT round(percentile_cont(0.95) WITHIN GROUP (ORDER BY retrieval_latency_ms)::numeric, 1) FROM runs WHERE retrieval_latency_ms IS NOT NULL),
      'maxLatencyMs',    (SELECT max(retrieval_latency_ms) FROM runs)
    ),

    -- §16/§19 learning effect by mode (P11.1 denominator semantics)
    'learningEffectByMode', (SELECT coalesce(jsonb_object_agg(mode, m), '{}'::jsonb) FROM (
      SELECT mode, jsonb_build_object(
        'runsTotal', count(*),
        'savedTotal', count(*) FILTER (WHERE saved_at IS NOT NULL),
        'accepted_unchanged', count(*) FILTER (WHERE outcome = 'accepted_unchanged'),
        'accepted_cosmetic',  count(*) FILTER (WHERE outcome = 'accepted_cosmetic'),
        'accepted_semantic',  count(*) FILTER (WHERE outcome = 'accepted_semantic'),
        'semanticAcceptanceRate', CASE WHEN count(*) FILTER (WHERE saved_at IS NOT NULL) = 0 THEN NULL
          ELSE round(count(*) FILTER (WHERE outcome IN ('accepted_unchanged','accepted_cosmetic'))::numeric
                     / count(*) FILTER (WHERE saved_at IS NOT NULL)::numeric, 4) END,
        'promptVersions', (SELECT jsonb_agg(DISTINCT prompt_version) FROM runs r2 WHERE r2.mode = runs.mode)
      ) m FROM runs GROUP BY mode) q),

    -- §17/§18 correction burden by mode (semantic deltas per saved run)
    'correctionBurdenByMode', (SELECT coalesce(jsonb_object_agg(mode, b), '{}'::jsonb) FROM (
      SELECT mode, jsonb_build_object(
        'savedRuns', count(*),
        'avgSemanticDeltas', round(avg(sem_deltas)::numeric, 3),
        'medianSemanticDeltas', percentile_cont(0.5) WITHIN GROUP (ORDER BY sem_deltas),
        'p90SemanticDeltas', percentile_cont(0.9) WITHIN GROUP (ORDER BY sem_deltas),
        'zeroBurdenRuns', count(*) FILTER (WHERE sem_deltas = 0)
      ) b FROM burden GROUP BY mode) q),

    -- §51/§55/§56 coverage
    'coverage', jsonb_build_object(
      'byTaxonomy', (SELECT coalesce(jsonb_object_agg(taxonomy_kind, c), '{}'::jsonb) FROM (SELECT taxonomy_kind, count(*) c FROM ev WHERE eligibility='eligible' GROUP BY 1) q),
      'byVariant',  (SELECT coalesce(jsonb_object_agg(coalesce(variant,'(section)'), c), '{}'::jsonb) FROM (SELECT variant, count(*) c FROM ev WHERE eligibility='eligible' GROUP BY 1) q),
      'byGenderDimension', (SELECT coalesce(jsonb_object_agg(coalesce(gender_dimension,'(none)'), c), '{}'::jsonb) FROM (SELECT gender_dimension, count(*) c FROM ev WHERE eligibility='eligible' GROUP BY 1) q),
      'byEvidenceType', (SELECT coalesce(jsonb_object_agg(evidence_type, c), '{}'::jsonb) FROM (SELECT evidence_type, count(*) c FROM ev WHERE eligibility='eligible' GROUP BY 1) q),
      'topMovements', (SELECT coalesce(jsonb_object_agg(m, c), '{}'::jsonb) FROM (SELECT coalesce(movement_id, movement_name) m, count(*) c FROM ev WHERE eligibility='eligible' AND (movement_id IS NOT NULL OR movement_name IS NOT NULL) GROUP BY 1 ORDER BY 2 DESC LIMIT 10) q)
    ),

    -- §53 two-pass decision input: eligible semantic corrections whose taxonomy
    -- CAN be retrieved pre-model (single-pass) vs BLOCKED by missing structured
    -- context. LOAD / VARIANT_COMPLETION are single-pass-retrievable; STRUCTURE
    -- only when explicitly declared; REPS / ROUNDS / REST_TIME / etc. are blocked.
    'preModelRetrievability', jsonb_build_object(
      'singlePassRetrievable', (SELECT count(*) FROM ev WHERE eligibility='eligible' AND taxonomy_kind IN ('LOAD','VARIANT_COMPLETION')),
      'structureExplicitOnly', (SELECT count(*) FROM ev WHERE eligibility='eligible' AND taxonomy_kind = 'STRUCTURE'),
      'blockedNeedsStructureOrPosition', (SELECT count(*) FROM ev WHERE eligibility='eligible' AND taxonomy_kind IN ('REPS','ROUNDS','REST_TIME','MOVEMENT_ORDER')),
      'other', (SELECT count(*) FROM ev WHERE eligibility='eligible' AND taxonomy_kind NOT IN ('LOAD','VARIANT_COMPLETION','STRUCTURE','REPS','ROUNDS','REST_TIME','MOVEMENT_ORDER')),
      'note', 'Determines whether a future two-pass Analyze (P11.6) is worth its cost: if `blockedNeedsStructureOrPosition` dominates useful corrections, single-pass recall is insufficient.'
    ),

    -- §31 rollout-gate summary (read-only assessment; does NOT change mode)
    'rolloutGate', jsonb_build_object(
      'retrievalHealthGreen', (SELECT count(*) FROM runs WHERE retr_status = 'retrieval_failed') = 0,
      'naturalActiveEligiblePatternExists', (SELECT count(*) FROM pat_calibrated WHERE active_eligible) > 0,
      'thresholdUnchanged', true,
      'verdict', CASE WHEN (SELECT count(*) FROM pat_calibrated WHERE active_eligible) > 0
                      THEN 'ACTIVE_CANDIDATE_READY_OWNER_APPROVAL_REQUIRED'
                      ELSE 'REMAIN_SHADOW_WAITING_FOR_NATURAL_EVIDENCE' END
    )
  ) INTO v_out;

  RETURN v_out;
END;
$$;

COMMENT ON FUNCTION public.p11_learning_calibration_status(uuid, timestamptz, timestamptz, text, text, text) IS
  'P11.5 read-only calibration. Learning funnel, pattern maturity, ACTIVE '
  'eligibility (byte-identical parity with p11.4-selector-v1), zero-hint '
  'reasons, retrieval health, mode cohorts, semantic correction burden, '
  'coverage, and the pre-model-retrievable-vs-blocked split that decides '
  'whether two-pass Analyze is warranted. Tenant-guarded. Writes nothing; '
  'changes no mode. Reuses p11_3_retrieve_impl for pattern strength/conflict '
  '(no fourth truth).';

REVOKE ALL ON FUNCTION public.p11_learning_calibration_status(uuid, timestamptz, timestamptz, text, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.p11_learning_calibration_status(uuid, timestamptz, timestamptz, text, text, text) TO authenticated;

COMMIT;

-- ============================================================================
-- REVERSIBILITY (manual DOWN, not auto-run):
--   DROP FUNCTION IF EXISTS public.p11_learning_calibration_status(uuid, timestamptz, timestamptz, text, text, text);
-- Additive, read-only. No table / index / trigger / RLS / P11.1-P11.4 object is
-- created or altered. Nothing references this function.
-- ============================================================================
