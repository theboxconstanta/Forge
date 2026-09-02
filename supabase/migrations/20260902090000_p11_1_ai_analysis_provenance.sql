-- P11.1 — AI Analyze Provenance + Versioning Foundation
--
-- Approved: P11_AI_LEARNING_ARCHITECTURE_AUDIT_20260902.md (owner decisions
-- D1–D5) + the P11.1 implementation mission (2026-09-02).
--
-- ONE append-only-in-spirit ledger table (`ai_analysis_runs`) + immutability
-- trigger + deterministic retention functions (pg_cron) + a read-only metric
-- function. NOTHING is added to any canonical workout table (D1 — "the
-- canonical workout belongs to the coach; AI provenance is separate
-- evidence"). NO backfill. NO change to any existing table / trigger / RLS /
-- Edge Function config. NO embeddings / vector / retrieval. Fully reversible
-- (DOWN notes at end).
--
-- WRITE LIFECYCLE
--   1. analyze-workout Edge Function (service role, fail-open) INSERTs one row
--      per attempt: request evidence + model config + versions + raw model
--      output + normalized (transform) output + status. WRITE-ONCE.
--   2. The client (forge-admin / PWA), on a successful Save of a workout
--      seeded by that run, UPDATEs the lifecycle columns: saved_at, wod_id,
--      workout_id, saved_output, semantic_diff, edit_severity, outcome.
--      RLS-scoped (coach/admin of the run's gym); the trigger enforces
--      column-level immutability of the evidence and lifecycle-once linkage.
--   3. Retention (pg_cron): input_text -> NULL after 90 days; raw_output ->
--      NULL after 365 days. Run id, versions, normalized_output, semantic_diff
--      and outcome are kept indefinitely for long-term evaluation.
--
-- FAILURE CONTAINMENT: every write is best-effort at the call site — a
-- provenance failure MUST NOT break workout authoring. The table has no
-- foreign key that would block a workout delete (both `wod_id` /
-- `workout_id` are ON DELETE SET NULL).

BEGIN;

-- ============================================================================
-- 1. ai_analysis_runs
-- ============================================================================
CREATE TABLE public.ai_analysis_runs (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  gym_id             uuid NOT NULL REFERENCES public.gyms(id) ON DELETE CASCADE,
  -- The coach/admin who triggered the run. NULL when the Edge Function cannot
  -- canonically resolve it at write time (it authenticates the caller via the
  -- Bearer token — `caller.id` — and stamps it; NULL only if that lookup is
  -- unavailable). Never invented.
  coach_id           uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  function           text NOT NULL DEFAULT 'analyze-workout'
                       CHECK (function IN ('analyze-workout', 'regenerate-variant')),

  -- ---- request evidence (WRITE-ONCE; input_text expires by retention) ----
  created_at         timestamptz NOT NULL DEFAULT now(),
  input_text         text,                 -- the coach's paste; NULL after 90d
  input_hash         text,                 -- sha256(hex) of the trimmed input; survives retention

  -- ---- model / reproducibility (WRITE-ONCE) ----
  provider           text NOT NULL DEFAULT 'openai',
  model              text NOT NULL,        -- the ACTUAL resolved model for this run
  model_config       jsonb NOT NULL DEFAULT '{}'::jsonb,   -- {reasoning_effort, store, timeout_ms, ...}
  prompt_version     text NOT NULL,
  schema_version     text NOT NULL,
  transform_version  text NOT NULL,
  validator_version  text,                 -- NULL until P11.4 exists

  -- ---- output evidence (WRITE-ONCE; raw_output expires by retention) ----
  status             text NOT NULL
                       CHECK (status IN ('ok','benchmark','refused','truncated','invalid','error')),
  error_detail       text,                 -- short, human-readable; NEVER secrets / auth headers
  raw_output         jsonb,                -- the model's flat structured JSON; NULL after 365d
  normalized_output  jsonb,               -- transform.ts result — the exact Builder baseline
  token_usage        jsonb,               -- {input, output, reasoning, total}
  latency_ms         integer,
  completed_at       timestamptz,         -- model call returned

  -- ---- lifecycle (FILL-ONCE, on the coach's Save) ----
  saved_at           timestamptz,
  wod_id             uuid REFERENCES public.wods(id) ON DELETE SET NULL,
  workout_id         uuid REFERENCES public.workouts(id) ON DELETE SET NULL,
  saved_output       jsonb,               -- the final canonical structured workout the coach saved
  semantic_diff      jsonb,               -- { deltas: [{ section, path, kind, from, to, severity }], counts: {...} }
  edit_severity      text CHECK (edit_severity IN ('none','cosmetic','minor','semantic','critical')),
  outcome            text CHECK (outcome IN (
                       'accepted_unchanged','accepted_cosmetic','accepted_semantic',
                       'abandoned','save_failed'))
);

COMMENT ON TABLE public.ai_analysis_runs IS
  'P11.1 — append-only-in-spirit provenance ledger for AI Analyze. One row per '
  'analyze-workout attempt. Evidence columns are WRITE-ONCE (immutability '
  'trigger); lifecycle columns are FILL-ONCE on the coach Save. No AI-source '
  'column exists on any canonical workout table (owner decision D1). Retention: '
  'input_text NULL after 90d, raw_output NULL after 365d (pg_cron).';
COMMENT ON COLUMN public.ai_analysis_runs.normalized_output IS
  'transform.ts output = the exact structured draft that entered the Builder. '
  'Compared against saved_output to separate MODEL error / TRANSFORM error / '
  'COACH correction (P11 audit section 7).';
COMMENT ON COLUMN public.ai_analysis_runs.outcome IS
  'accepted_unchanged = no semantic diff. accepted_cosmetic = only '
  'cosmetic/whitespace/case. accepted_semantic = >= one semantic/critical '
  'field change. abandoned = run succeeded, coach never saved (best-effort, '
  'set on dialog close). save_failed = coach tried to save and the save '
  'errored. A run with status<>ok and no lifecycle row = analysis_failed '
  '(derived, not stored).';

CREATE INDEX ai_analysis_runs_gym_created_idx     ON public.ai_analysis_runs (gym_id, created_at DESC);
CREATE INDEX ai_analysis_runs_input_hash_idx      ON public.ai_analysis_runs (input_hash) WHERE input_hash IS NOT NULL;
CREATE INDEX ai_analysis_runs_version_idx         ON public.ai_analysis_runs (gym_id, prompt_version, model);
CREATE INDEX ai_analysis_runs_wod_id_idx          ON public.ai_analysis_runs (wod_id) WHERE wod_id IS NOT NULL;
CREATE INDEX ai_analysis_runs_outcome_idx         ON public.ai_analysis_runs (gym_id, outcome) WHERE outcome IS NOT NULL;
CREATE INDEX ai_analysis_runs_expire_input_idx    ON public.ai_analysis_runs (created_at) WHERE input_text IS NOT NULL;
CREATE INDEX ai_analysis_runs_expire_raw_idx      ON public.ai_analysis_runs (created_at) WHERE raw_output IS NOT NULL;

-- ============================================================================
-- 2. RLS
-- ============================================================================
ALTER TABLE public.ai_analysis_runs ENABLE ROW LEVEL SECURITY;

-- SELECT: coach/admin of the run's gym only. Members get nothing (this is a
-- coach/analytics surface). Cross-tenant impossible (is_coach_or_admin already
-- implies membership of that gym). Anonymous: no policy => denied.
CREATE POLICY ai_analysis_runs_select ON public.ai_analysis_runs
  FOR SELECT TO authenticated
  USING (public.is_coach_or_admin(gym_id));

-- INSERT: never from a client. Only the analyze-workout Edge Function, which
-- uses the service-role key (RLS-exempt). A restrictive policy makes a forged
-- client insert impossible even if a future code path tried.
CREATE POLICY ai_analysis_runs_no_client_insert ON public.ai_analysis_runs
  FOR INSERT TO authenticated
  WITH CHECK (false);

-- UPDATE: the coach/admin of the run's gym may fill the lifecycle columns on
-- Save. Column-level immutability + lifecycle-once is enforced by the trigger
-- below (a policy cannot express "only these columns").
CREATE POLICY ai_analysis_runs_lifecycle_update ON public.ai_analysis_runs
  FOR UPDATE TO authenticated
  USING (gym_id = public.my_gym_id() AND public.is_coach_or_admin(gym_id))
  WITH CHECK (gym_id = public.my_gym_id() AND public.is_coach_or_admin(gym_id));

-- DELETE: no policy => denied for every client. Rows are never deleted;
-- retention nulls specific columns.

-- ============================================================================
-- 3. Immutability + lifecycle-once trigger
-- ============================================================================
CREATE OR REPLACE FUNCTION public.enforce_ai_analysis_run_immutability()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  -- gym never moves (mirrors prevent_gym_id_change, applied explicitly here).
  IF NEW.gym_id IS DISTINCT FROM OLD.gym_id THEN
    RAISE EXCEPTION 'ai_analysis_runs.gym_id is immutable';
  END IF;

  -- Write-once evidence columns — reject any change. Two explicit retention
  -- transitions are allowed: input_text -> NULL, raw_output -> NULL.
  IF NEW.input_text IS DISTINCT FROM OLD.input_text
     AND NOT (OLD.input_text IS NOT NULL AND NEW.input_text IS NULL) THEN
    RAISE EXCEPTION 'ai_analysis_runs.input_text is write-once (only retention may NULL it)';
  END IF;
  IF NEW.raw_output IS DISTINCT FROM OLD.raw_output
     AND NOT (OLD.raw_output IS NOT NULL AND NEW.raw_output IS NULL) THEN
    RAISE EXCEPTION 'ai_analysis_runs.raw_output is write-once (only retention may NULL it)';
  END IF;

  IF ROW(NEW.function, NEW.coach_id, NEW.created_at, NEW.input_hash, NEW.provider,
         NEW.model, NEW.model_config, NEW.prompt_version, NEW.schema_version,
         NEW.transform_version, NEW.validator_version, NEW.status, NEW.error_detail,
         NEW.normalized_output, NEW.token_usage, NEW.latency_ms, NEW.completed_at)
     IS DISTINCT FROM
     ROW(OLD.function, OLD.coach_id, OLD.created_at, OLD.input_hash, OLD.provider,
         OLD.model, OLD.model_config, OLD.prompt_version, OLD.schema_version,
         OLD.transform_version, OLD.validator_version, OLD.status, OLD.error_detail,
         OLD.normalized_output, OLD.token_usage, OLD.latency_ms, OLD.completed_at)
  THEN
    RAISE EXCEPTION 'ai_analysis_runs: model/version/output evidence is write-once';
  END IF;

  -- Lifecycle FILL-ONCE: once a run is linked to a saved workout, the linkage
  -- and diff are frozen — a run is never re-pointed at a different workout
  -- (P11.1 mission section 29 / 38). A pre-link 'abandoned' marker MAY later be
  -- superseded by a real save (coach came back), so 'abandoned' with no
  -- saved_at is not yet frozen.
  IF OLD.saved_at IS NOT NULL THEN
    IF ROW(NEW.saved_at, NEW.wod_id, NEW.workout_id, NEW.saved_output,
           NEW.semantic_diff, NEW.edit_severity, NEW.outcome)
       IS DISTINCT FROM
       ROW(OLD.saved_at, OLD.wod_id, OLD.workout_id, OLD.saved_output,
           OLD.semantic_diff, OLD.edit_severity, OLD.outcome)
    THEN
      RAISE EXCEPTION 'ai_analysis_runs: lifecycle is fill-once (run already linked to a saved workout)';
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

COMMENT ON FUNCTION public.enforce_ai_analysis_run_immutability() IS
  'P11.1 — BEFORE UPDATE on ai_analysis_runs. Evidence columns write-once '
  '(retention may NULL input_text / raw_output only); lifecycle columns '
  'fill-once after saved_at is set. SECURITY INVOKER.';

CREATE TRIGGER ai_analysis_runs_immutability
  BEFORE UPDATE ON public.ai_analysis_runs
  FOR EACH ROW EXECUTE FUNCTION public.enforce_ai_analysis_run_immutability();

-- ============================================================================
-- 4. Retention (deterministic, tenant-agnostic, idempotent) + pg_cron
-- ============================================================================
CREATE OR REPLACE FUNCTION public.p11_expire_ai_analysis_input_text()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE v_n integer;
BEGIN
  UPDATE public.ai_analysis_runs
     SET input_text = NULL
   WHERE input_text IS NOT NULL
     AND created_at < now() - interval '90 days';
  GET DIAGNOSTICS v_n = ROW_COUNT;
  RETURN v_n;
END;
$$;

CREATE OR REPLACE FUNCTION public.p11_expire_ai_analysis_raw_output()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE v_n integer;
BEGIN
  UPDATE public.ai_analysis_runs
     SET raw_output = NULL
   WHERE raw_output IS NOT NULL
     AND created_at < now() - interval '365 days';
  GET DIAGNOSTICS v_n = ROW_COUNT;
  RETURN v_n;
END;
$$;

COMMENT ON FUNCTION public.p11_expire_ai_analysis_input_text() IS
  'P11.1 retention (owner decision D4) — NULLs input_text older than 90 days. '
  'Idempotent. Keeps run id / versions / normalized_output / semantic_diff / '
  'outcome for long-term evaluation. Scheduled daily via pg_cron.';

-- Same daily-cron shape as advance_trial_state / gym-billing-block-daily.
SELECT cron.schedule(
  'p11-expire-ai-input-text-daily',
  '17 3 * * *',
  $$ SELECT public.p11_expire_ai_analysis_input_text(); $$
);
SELECT cron.schedule(
  'p11-expire-ai-raw-output-daily',
  '23 3 * * *',
  $$ SELECT public.p11_expire_ai_analysis_raw_output(); $$
);

-- ============================================================================
-- 5. Read-only metric function (no UI, no dashboard)
-- ============================================================================
CREATE OR REPLACE FUNCTION public.p11_ai_acceptance_stats(
  p_gym_id         uuid,
  p_from           timestamptz DEFAULT '-infinity',
  p_to             timestamptz DEFAULT 'infinity',
  p_prompt_version text DEFAULT NULL,
  p_model          text DEFAULT NULL
)
RETURNS TABLE (
  runs_total              bigint,
  runs_failed             bigint,
  saved_total             bigint,
  accepted_unchanged      bigint,
  accepted_cosmetic       bigint,
  accepted_semantic       bigint,
  abandoned               bigint,
  save_failed             bigint,
  semantic_acceptance_rate numeric
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  -- Tenant guard: only a coach/admin of the gym may read its stats.
  IF NOT public.is_coach_or_admin(p_gym_id) THEN
    RAISE EXCEPTION 'not authorized for gym %', p_gym_id;
  END IF;

  RETURN QUERY
  WITH r AS (
    SELECT *
      FROM public.ai_analysis_runs
     WHERE gym_id = p_gym_id
       AND created_at >= p_from
       AND created_at <  p_to
       AND (p_prompt_version IS NULL OR prompt_version = p_prompt_version)
       AND (p_model IS NULL OR model = p_model)
  )
  SELECT
    count(*)                                                             AS runs_total,
    count(*) FILTER (WHERE status <> 'ok' AND status <> 'benchmark')      AS runs_failed,
    count(*) FILTER (WHERE saved_at IS NOT NULL)                          AS saved_total,
    count(*) FILTER (WHERE outcome = 'accepted_unchanged')               AS accepted_unchanged,
    count(*) FILTER (WHERE outcome = 'accepted_cosmetic')                AS accepted_cosmetic,
    count(*) FILTER (WHERE outcome = 'accepted_semantic')                AS accepted_semantic,
    count(*) FILTER (WHERE outcome = 'abandoned' AND saved_at IS NULL)   AS abandoned,
    count(*) FILTER (WHERE outcome = 'save_failed')                      AS save_failed,
    CASE WHEN count(*) FILTER (WHERE saved_at IS NOT NULL) = 0 THEN NULL
         ELSE round(
           count(*) FILTER (WHERE outcome IN ('accepted_unchanged','accepted_cosmetic'))::numeric
           / count(*) FILTER (WHERE saved_at IS NOT NULL)::numeric, 4)
    END                                                                  AS semantic_acceptance_rate
  FROM r;
END;
$$;

COMMENT ON FUNCTION public.p11_ai_acceptance_stats(uuid, timestamptz, timestamptz, text, text) IS
  'P11.1 primary metric. AI ANALYZE SEMANTIC ACCEPTANCE RATE = '
  '(accepted_unchanged + accepted_cosmetic) / saved_total. Abandoned runs are '
  'reported separately, never counted as semantic failures. Tenant-guarded.';

REVOKE ALL ON FUNCTION public.p11_ai_acceptance_stats(uuid, timestamptz, timestamptz, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.p11_ai_acceptance_stats(uuid, timestamptz, timestamptz, text, text) TO authenticated;

COMMIT;

-- ============================================================================
-- REVERSIBILITY (manual DOWN, not auto-run):
--   SELECT cron.unschedule('p11-expire-ai-input-text-daily');
--   SELECT cron.unschedule('p11-expire-ai-raw-output-daily');
--   DROP FUNCTION IF EXISTS public.p11_ai_acceptance_stats(uuid, timestamptz, timestamptz, text, text);
--   DROP FUNCTION IF EXISTS public.p11_expire_ai_analysis_raw_output();
--   DROP FUNCTION IF EXISTS public.p11_expire_ai_analysis_input_text();
--   DROP TRIGGER IF EXISTS ai_analysis_runs_immutability ON public.ai_analysis_runs;
--   DROP FUNCTION IF EXISTS public.enforce_ai_analysis_run_immutability();
--   DROP TABLE IF EXISTS public.ai_analysis_runs;
-- All additive; nothing else references these objects. No canonical table,
-- trigger, RLS policy, or Edge Function config is touched by this migration.
-- ============================================================================
