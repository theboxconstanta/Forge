-- P11.4 — Controlled AI Analyze learning-hint injection: provenance + measurement
--
-- Owner decisions (2026-09-02): D1 = A (single-pass + deterministic pre-model
-- retrieval, ONE OpenAI call, no two-pass), D2 = A (separate append-only
-- companion ledger keyed 1:1 to ai_analysis_runs.id — P11.1 stays frozen),
-- D3 = A (env `P11_LEARNING_HINTS_MODE` ∈ off/shadow/active, default off),
-- D4 = A (inject only exact + supported (≥3 distinct runs) + CONSISTENT
-- patterns; max 5; no observation_only/weak/mixed/conflicting/strong/broad).
--
-- WHAT THIS DOES
--   1. `public.ai_analysis_run_learning` — one append-only row per Analyze run
--      recording WHAT learning context was used (mode, retrieval outcome,
--      selected hint facts, versions, latency/error). PK = ai_run_id (1:1).
--   2. immutability trigger (BEFORE UPDATE — never blocks a cascade DELETE).
--   3. `p11_learning_effect_stats(...)` — tenant-guarded read-only measurement
--      by learning_mode / prompt_version / model / date / gym. NOT a causal
--      "AI improvement rate".
--   4. GRANT EXECUTE on the P11.3 engine `p11_3_retrieve_impl` to `service_role`
--      so the analyze-workout Edge Function (which server-resolves the tenant
--      canonically) can retrieve hints. The engine still has NO client grant.
--
-- WHAT THIS DOES NOT DO
--   No change to `ai_analysis_runs` / `ai_correction_evidence` / any canonical
--   workout table. No embeddings / vector / RAG-store / fine-tuning. No member
--   data. Fully reversible (DOWN in footer).

BEGIN;

-- ============================================================================
-- 1. ai_analysis_run_learning
-- ============================================================================
CREATE TABLE public.ai_analysis_run_learning (
  ai_run_id             uuid PRIMARY KEY REFERENCES public.ai_analysis_runs(id) ON DELETE CASCADE,
  gym_id                uuid NOT NULL REFERENCES public.gyms(id) ON DELETE CASCADE,
  coach_id              uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at            timestamptz NOT NULL DEFAULT now(),

  learning_mode         text NOT NULL CHECK (learning_mode IN ('off','shadow','active')),
  read_model_version    text,                          -- e.g. p11.3-read-model-v1
  selector_version      text NOT NULL,                 -- e.g. p11.4-selector-v1
  serializer_version    text,                          -- e.g. p11.4-hint-serializer-v1
  prompt_version        text,                          -- the analyze-workout PROMPT_VERSION for this run

  -- minimal transparent taxonomy (§19)
  retrieval_status      text NOT NULL CHECK (retrieval_status IN (
                          'disabled','no_context','no_matches','no_eligible_hints',
                          'shadow_selected','active_selected','retrieval_failed')),
  retrieval_latency_ms  integer,
  error_class           text,                          -- short slug, never prose / secrets

  -- derived facts + the queries issued (whitelisted structured values only)
  query_context         jsonb NOT NULL DEFAULT '{}'::jsonb,
  candidate_hint_count  integer NOT NULL DEFAULT 0,
  selected_hint_count   integer NOT NULL DEFAULT 0,
  -- whitelisted per-hint facts ONLY: {taxonomy, variant, movement, unit, format,
  -- structureNorm, evidenceType, distinctRunCount, beforeValue, afterValue}.
  -- NEVER input_text / notes / titles / UUIDs / raw saved_output / raw diff.
  selected_hints        jsonb NOT NULL DEFAULT '[]'::jsonb,
  prompt_fragment_chars integer NOT NULL DEFAULT 0,
  prompt_fragment_sha256 text                          -- audit fingerprint of the exact injected text
);

COMMENT ON TABLE public.ai_analysis_run_learning IS
  'P11.4 — append-only companion ledger, 1:1 to ai_analysis_runs. Records what '
  'tenant-specific learning context was used for one AI Analyze run: mode '
  '(off/shadow/active), deterministic pre-model query context, P11.3 retrieval '
  'outcome, the whitelisted facts of every SELECTED hint, and the version '
  'triple. active runs are distinguishable from shadow/off for later '
  'version-aware measurement. Immutable once written; never client-written.';

CREATE INDEX ai_analysis_run_learning_gym_created_idx ON public.ai_analysis_run_learning (gym_id, created_at DESC);
CREATE INDEX ai_analysis_run_learning_mode_idx        ON public.ai_analysis_run_learning (gym_id, learning_mode);
CREATE INDEX ai_analysis_run_learning_status_idx      ON public.ai_analysis_run_learning (gym_id, retrieval_status);

-- ============================================================================
-- 2. RLS — mirrors ai_analysis_runs
-- ============================================================================
ALTER TABLE public.ai_analysis_run_learning ENABLE ROW LEVEL SECURITY;

CREATE POLICY ai_analysis_run_learning_select ON public.ai_analysis_run_learning
  FOR SELECT TO authenticated
  USING (public.is_coach_or_admin(gym_id));

-- Clients never write. The analyze-workout Edge Function uses the service-role
-- key (RLS-exempt); these restrictive policies make a forged client write
-- impossible even if a future code path tried.
CREATE POLICY ai_analysis_run_learning_no_client_insert ON public.ai_analysis_run_learning
  FOR INSERT TO authenticated WITH CHECK (false);
CREATE POLICY ai_analysis_run_learning_no_client_update ON public.ai_analysis_run_learning
  FOR UPDATE TO authenticated USING (false) WITH CHECK (false);
-- no DELETE policy => denied for every client (cascade only).

-- ============================================================================
-- 3. Append-only immutability (UPDATE only — never block ON DELETE CASCADE)
-- ============================================================================
CREATE OR REPLACE FUNCTION public.enforce_ai_analysis_run_learning_immutability()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION 'ai_analysis_run_learning is append-only (run %)', OLD.ai_run_id;
END;
$$;

CREATE TRIGGER ai_analysis_run_learning_immutability
  BEFORE UPDATE ON public.ai_analysis_run_learning
  FOR EACH ROW EXECUTE FUNCTION public.enforce_ai_analysis_run_learning_immutability();

-- ============================================================================
-- 4. p11_learning_effect_stats — tenant-guarded, read-only, by learning_mode
-- ============================================================================
CREATE OR REPLACE FUNCTION public.p11_learning_effect_stats(
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

  WITH r AS (
    SELECT run.id, run.outcome, run.saved_at, run.status,
           coalesce(l.learning_mode, 'off')       AS learning_mode,
           coalesce(l.selected_hint_count, 0)     AS selected_hint_count,
           coalesce(l.retrieval_status, 'disabled') AS retrieval_status
      FROM public.ai_analysis_runs run
      LEFT JOIN public.ai_analysis_run_learning l ON l.ai_run_id = run.id
     WHERE run.gym_id = p_gym_id
       AND run.created_at >= p_from AND run.created_at < p_to
       AND (p_prompt_version IS NULL OR run.prompt_version = p_prompt_version)
       AND (p_model IS NULL OR run.model = p_model)
  ),
  by_mode AS (
    SELECT learning_mode,
           count(*)                                                       AS runs_total,
           count(*) FILTER (WHERE status NOT IN ('ok','benchmark'))       AS runs_failed,
           count(*) FILTER (WHERE saved_at IS NOT NULL)                   AS saved_total,
           count(*) FILTER (WHERE outcome = 'accepted_unchanged')        AS accepted_unchanged,
           count(*) FILTER (WHERE outcome = 'accepted_cosmetic')         AS accepted_cosmetic,
           count(*) FILTER (WHERE outcome = 'accepted_semantic')         AS accepted_semantic,
           count(*) FILTER (WHERE retrieval_status = 'retrieval_failed') AS retrieval_failed_count,
           round(avg(selected_hint_count)::numeric, 3)                    AS avg_selected_hint_count,
           CASE WHEN count(*) FILTER (WHERE saved_at IS NOT NULL) = 0 THEN NULL
                ELSE round(
                  count(*) FILTER (WHERE outcome IN ('accepted_unchanged','accepted_cosmetic'))::numeric
                  / count(*) FILTER (WHERE saved_at IS NOT NULL)::numeric, 4)
           END                                                           AS semantic_acceptance_rate
      FROM r GROUP BY learning_mode
  )
  SELECT jsonb_build_object(
    'note', 'DESCRIPTIVE counts by learning_mode. NOT a causal AI-improvement '
          || 'rate. Compare only within one prompt_version + model. Treat small '
          || 'samples as observations, not evidence of improvement.',
    'gymId', p_gym_id,
    'window', jsonb_build_object('from', p_from, 'to', p_to),
    'filters', jsonb_build_object('promptVersion', p_prompt_version, 'model', p_model),
    'byMode', (SELECT coalesce(jsonb_object_agg(learning_mode, to_jsonb(by_mode) - 'learning_mode'), '{}'::jsonb) FROM by_mode)
  ) INTO v_out;

  RETURN v_out;
END;
$$;

COMMENT ON FUNCTION public.p11_learning_effect_stats(uuid, timestamptz, timestamptz, text, text) IS
  'P11.4 measurement. Semantic acceptance + hint counts by learning_mode '
  '(off/shadow/active), version-aware. Tenant-guarded. Descriptive only — no '
  'causal claim; small samples are observations, not proof of improvement.';

REVOKE ALL ON FUNCTION public.p11_learning_effect_stats(uuid, timestamptz, timestamptz, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.p11_learning_effect_stats(uuid, timestamptz, timestamptz, text, text) TO authenticated;

-- ============================================================================
-- 5. Let the analyze-workout Edge Function (service_role) call the P11.3 engine.
--    The engine has NO auth check by design; the EF server-resolves the tenant
--    canonically before passing p_gym_id. Still REVOKEd from PUBLIC/anon/authenticated.
-- ============================================================================
GRANT EXECUTE ON FUNCTION public.p11_3_retrieve_impl(uuid, text, text, text, text, text, text, text, text, text, text, integer, timestamptz, timestamptz, text, text, text, text, integer, integer) TO service_role;

COMMIT;

-- ============================================================================
-- REVERSIBILITY (manual DOWN, not auto-run):
--   REVOKE EXECUTE ON FUNCTION public.p11_3_retrieve_impl(uuid, text, text, text, text, text, text, text, text, text, text, integer, timestamptz, timestamptz, text, text, text, text, integer, integer) FROM service_role;
--   DROP FUNCTION IF EXISTS public.p11_learning_effect_stats(uuid, timestamptz, timestamptz, text, text);
--   DROP TRIGGER IF EXISTS ai_analysis_run_learning_immutability ON public.ai_analysis_run_learning;
--   DROP FUNCTION IF EXISTS public.enforce_ai_analysis_run_learning_immutability();
--   DROP TABLE IF EXISTS public.ai_analysis_run_learning;
-- All additive. No canonical / P11.1 / P11.2 object is altered. Kill switch:
-- `P11_LEARNING_HINTS_MODE=off` (env) disables all P11.4 behaviour with no
-- schema change; dropping this table then makes the EF's best-effort learning
-- insert a silent no-op (fail-open).
-- ============================================================================
