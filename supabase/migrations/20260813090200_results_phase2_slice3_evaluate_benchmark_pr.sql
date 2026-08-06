-- Results Phase 2, Slice 3: automatic Benchmark PR detection.
--
-- Fires once, automatically, at logging time (RESULTS_DOMAIN_ARCHITECTURE.md
-- v1.0 Section 8.1) - never client-determined, identically for PWA and Admin
-- since both write to the same `wod_logs` table.
--
-- Deliberately scoped to exactly two format_snapshot values: 'For Time'
-- (time-based, lower is better) and 'AMRAP' (rounds+reps-based, higher is
-- better). These two cover the overwhelming majority of real Girls/Heroes
-- benchmarks. The other 20 formats in workoutFormats.js's own catalog
-- (sets-family, chained-family, EMOM, etc.) are a named, disclosed gap for
-- a future slice, not silently ignored - porting the full 22-format
-- scoring catalog into SQL is real, separate work this slice does not
-- attempt (matching the same "narrow, disclosed scope over speculative
-- completeness" judgment already applied throughout this initiative).
--
-- Prior-best lookup is a UNION of the new `pr_events` ledger and the
-- existing `personal_records` table (Architecture Section 8.5 - both are
-- valid sources, the higher/better value governs). `personal_records.value`
-- is already numeric for both 'timp' (seconds, via `timeToSec` at save
-- time, App.jsx:7000) and 'runde' (a plain rounds integer, App.jsx:6996) -
-- confirmed live via information_schema, not assumed - so no parsing is
-- needed on that side, only on `wod_logs.time_result`/`result`, which are
-- free text.
--
-- `personal_records` has no structured scaling/variant column - the
-- variant is embedded as a deterministic `"RX | "`/`"Intermediate | "`/
-- `"Beginner | "`/`"OnRamp | "` prefix inside `notes` (App.jsx:7000,
-- `prVarianta + ' | ' + prNote`). Parsed via regexp rather than assumed;
-- a `personal_records` row whose `notes` does not start with one of the
-- four known variant_level values is deliberately EXCLUDED from the
-- scaling-matched comparison (comparing an RX benchmark result against an
-- unscoped-scaling manual entry would be a real, silent correctness bug,
-- e.g. treating a much easier Scaled time as the "prior best" for a new RX
-- result) - a disclosed, narrow gap for legacy rows only, since the PR
-- screen already defaults `prVarianta` to 'RX' (App.jsx `setPrVarianta`
-- reset), so in practice nearly every row already carries a parseable
-- prefix.
--
-- SECURITY DEFINER (a deliberate departure from Slice 1/2's SECURITY
-- INVOKER): this function's entire purpose is to write to `pr_events`, a
-- table with NO insert grant to `authenticated` at all - elevated
-- privilege is required precisely because no client should ever be able
-- to write a PR event directly. `search_path` pinned to `public` per
-- Postgres's own SECURITY DEFINER hardening guidance (prevents a
-- search_path-hijacking attack from an object created earlier in the
-- session).
--
-- Wrapped in its own EXCEPTION WHEN OTHERS - a PR-detection bug must
-- never block the underlying `wod_logs` insert, which is the athlete's
-- actual, primary action. This is a deliberate, new divergence from
-- Slice 2's own snapshot triggers (which intentionally do NOT swallow
-- errors, because a broken snapshot IS a data-integrity failure worth
-- blocking on) - PR detection is comparatively low-stakes secondary
-- enrichment, not the write itself.

CREATE OR REPLACE FUNCTION "public"."evaluate_benchmark_pr"()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_score numeric;
    v_unit text;
    v_prior_best numeric;
    v_is_first boolean := false;
    v_improvement numeric;
    v_improvement_pct numeric;
    v_benchmark_name text;
BEGIN
    BEGIN
        IF NEW.format_snapshot = 'For Time' THEN
            v_score := "public"."slice3_parse_time_to_seconds"(NEW.time_result);
            v_unit := 'seconds';
        ELSIF NEW.format_snapshot = 'AMRAP' THEN
            v_score := "public"."slice3_parse_leading_number"(NEW.result);
            v_unit := 'rounds';
        ELSE
            RETURN NEW;
        END IF;

        IF v_score IS NULL THEN
            RETURN NEW;
        END IF;

        SELECT "canonical_name" INTO v_benchmark_name
        FROM "public"."benchmarks" WHERE "id" = NEW.benchmark_id;

        SELECT CASE WHEN v_unit = 'seconds' THEN MIN("val") ELSE MAX("val") END
        INTO v_prior_best
        FROM (
            SELECT "score_value" AS "val"
            FROM "public"."pr_events"
            WHERE "member_id" = NEW.member_id
              AND "pr_type" = 'benchmark'
              AND "benchmark_id" = NEW.benchmark_id
              AND "scaling_context" = NEW.variant_level
              AND "score_unit" = v_unit

            UNION ALL

            SELECT "pr"."value" AS "val"
            FROM "public"."personal_records" "pr"
            WHERE "pr"."member_id" = NEW.member_id
              AND "pr"."movement" = v_benchmark_name
              AND "pr"."unit" = (CASE WHEN v_unit = 'seconds' THEN 'timp' ELSE 'runde' END)
              AND "pr"."value" IS NOT NULL
              AND (regexp_match("pr"."notes", '^(RX|Intermediate|Beginner|OnRamp) \|'))[1] = NEW.variant_level
        ) "prior"
        WHERE "val" IS NOT NULL;

        IF v_prior_best IS NULL THEN
            v_is_first := true;
        ELSIF (v_unit = 'seconds' AND v_score < v_prior_best) OR (v_unit = 'rounds' AND v_score > v_prior_best) THEN
            v_improvement := abs(v_score - v_prior_best);
            v_improvement_pct := CASE WHEN v_prior_best <> 0 THEN round(v_improvement / v_prior_best * 100, 2) ELSE NULL END;
        ELSE
            RETURN NEW;
        END IF;

        INSERT INTO "public"."pr_events" (
            "gym_id", "member_id", "pr_type", "benchmark_id", "scaling_context",
            "score_value", "score_unit", "previous_best_value", "previous_best_unit",
            "improvement_value", "improvement_percentage", "is_first_recorded",
            "source_wod_log_id", "occurred_at"
        ) VALUES (
            NEW.gym_id, NEW.member_id, 'benchmark', NEW.benchmark_id, NEW.variant_level,
            v_score, v_unit,
            (CASE WHEN v_is_first THEN NULL ELSE v_prior_best END),
            (CASE WHEN v_is_first THEN NULL ELSE v_unit END),
            v_improvement, v_improvement_pct, v_is_first,
            NEW.id, NEW.logged_at
        );
    EXCEPTION WHEN OTHERS THEN
        RAISE WARNING 'evaluate_benchmark_pr failed for wod_logs.id=%: %', NEW.id, SQLERRM;
    END;

    RETURN NEW;
END;
$$;

COMMENT ON FUNCTION "public"."evaluate_benchmark_pr"() IS 'AFTER INSERT trigger on wod_logs. Automatic Benchmark PR detection (RESULTS_DOMAIN_ARCHITECTURE.md Section 8), scoped to For Time and AMRAP formats only. SECURITY DEFINER - the only writer to pr_events. Never blocks the underlying insert (EXCEPTION WHEN OTHERS).';

CREATE OR REPLACE TRIGGER "evaluate_benchmark_pr_trg"
    AFTER INSERT ON "public"."wod_logs"
    FOR EACH ROW
    WHEN (NEW.benchmark_id IS NOT NULL)
    EXECUTE FUNCTION "public"."evaluate_benchmark_pr"();
