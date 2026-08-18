-- Member Performance, Phase 5 (PR Engine Hardening) - reconciliation for
-- Benchmark PRs. Eligibility rule itself is UNCHANGED (still exactly
-- 'For Time'/'AMRAP', still the same disclosed, named scope from Slice 3 -
-- Phase 3 already found Benchmark Identity strong, nothing to harden
-- there). What changes here is purely the same edit/delete reconciliation
-- pattern applied to evaluate_movement_prs in the previous migration -
-- one shared model (public.void_stale_pr_events), not two.
--
-- Before this migration: `evaluate_benchmark_pr` was AFTER INSERT only.
-- Editing an already-PR'd wod_logs row's time_result/result downward (or
-- deleting it) left the stale event as "current best" in
-- benchmark_pr_events_current forever - the exact same class of gap as
-- the movement side, just for the benchmark path.

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
    v_unchanged boolean;
BEGIN
    BEGIN
        IF TG_OP = 'UPDATE' THEN
            v_unchanged := (NEW.time_result IS NOT DISTINCT FROM OLD.time_result)
                AND (NEW.result IS NOT DISTINCT FROM OLD.result)
                AND (NEW.benchmark_id IS NOT DISTINCT FROM OLD.benchmark_id);
            IF v_unchanged THEN
                RETURN NEW;
            END IF;
            PERFORM "public"."void_stale_pr_events"(NEW.id, NULL);
        END IF;

        IF NEW.benchmark_id IS NULL THEN
            RETURN NEW;
        END IF;

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
              AND "voided_at" IS NULL

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

COMMENT ON FUNCTION "public"."evaluate_benchmark_pr"() IS 'Member Performance Phase 5 - AFTER INSERT OR UPDATE OF time_result/result/benchmark_id trigger on wod_logs. Automatic Benchmark PR detection, still scoped to For Time/AMRAP (unchanged from Slice 3). Reconciles on UPDATE (voids any stale event this row previously sourced, then re-evaluates). SECURITY DEFINER - the only writer to pr_events. Never blocks the underlying insert/update (EXCEPTION WHEN OTHERS).';

CREATE OR REPLACE TRIGGER "evaluate_benchmark_pr_trg"
    AFTER INSERT ON "public"."wod_logs"
    FOR EACH ROW
    WHEN (NEW.benchmark_id IS NOT NULL)
    EXECUTE FUNCTION "public"."evaluate_benchmark_pr"();

-- Deliberately without the "benchmark_id IS NOT NULL" WHEN guard the
-- INSERT trigger has - an edit that changes benchmark_id (Workout
-- retargeted) or clears it must still fire this function so it can void
-- a now-stale event (handled inside the function body).
CREATE OR REPLACE TRIGGER "evaluate_benchmark_pr_update_trg"
    AFTER UPDATE OF "time_result", "result", "benchmark_id" ON "public"."wod_logs"
    FOR EACH ROW
    EXECUTE FUNCTION "public"."evaluate_benchmark_pr"();
