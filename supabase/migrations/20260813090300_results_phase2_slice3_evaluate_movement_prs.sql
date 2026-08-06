-- Results Phase 2, Slice 3: automatic Movement PR detection.
--
-- A faithful SQL port of workoutFormats.js:905 `computeSetsPrCandidates`,
-- the exact, already-proven client-side algorithm - not new logic:
-- within THIS log's own `sets` rows, take the best (max) weight per
-- distinct rep count; compare, per exact rep count, against the
-- athlete's existing best; flag a PR only on a STRICT `>` (equal is
-- explicitly not a PR, matching this slice's own required test case).
--
-- Shared by two triggers (`wod_logs` and `skill_logs` - both already
-- share the identical SetsByKey jsonb shape, confirmed live via
-- information_schema). This is the first time logging the day's main WOD
-- can ever produce a PR - closing RESULTS_DOMAIN_ASSESSMENT.md's own
-- single biggest-named gap ("logging the day's main WOD never creates a
-- Personal Record"), not just extending the pre-existing skill_logs path.
--
-- `movementKeyed` (the client's own distinguishing flag): `wod_logs.sets`
-- has no fallback-name column, so every key is unconditionally a movement
-- name (TG_TABLE_NAME = 'wod_logs' branch, matching the client's own
-- unconditional Superset-like treatment there). `skill_logs.sets` keys
-- are movement names only when `format_snapshot = 'Superset'`
-- (client: `skillType === 'Superset'`) - otherwise every key falls back
-- to the log's own `skill_name_snapshot` (client: `skillNameCurent`),
-- exactly matching computeSetsPrCandidates's own fallbackMovement param.
--
-- Ledger values are stored kg-canonical (`score_unit = 'kg'` always),
-- not in whatever unit the athlete happened to have selected at logging
-- time - a permanent ledger must not depend on a mutable `members.
-- weight_unit` setting that can change later. `sets.weight` numbers
-- themselves have no per-row unit column (confirmed live) - the client's
-- own `computeSetsPrCandidates` already assumes they are in the athlete's
-- CURRENT `weight_unit` (read live at the moment of computing candidates,
-- App.jsx:6325); this trigger reads `members.weight_unit` for NEW.
-- member_id in the same transaction as the insert it is reacting to, so
-- it observes the exact same value the client itself just used to enter
-- the numbers - no time-gap risk for a freshly-inserted row.
--
-- SECURITY DEFINER, search_path pinned, and wrapped in EXCEPTION WHEN
-- OTHERS - identical reasoning to evaluate_benchmark_pr (see that
-- migration's own comments): the only writer to `pr_events`, and a
-- PR-detection bug must never block the athlete's actual log insert.

CREATE OR REPLACE FUNCTION "public"."slice3_convert_weight"("p_value" numeric, "p_from_unit" text, "p_to_unit" text)
RETURNS numeric
LANGUAGE plpgsql
IMMUTABLE
AS $$
BEGIN
    IF p_value IS NULL OR p_from_unit = p_to_unit THEN
        RETURN p_value;
    END IF;
    IF p_from_unit = 'kg' AND p_to_unit = 'lbs' THEN
        RETURN round(p_value * 2.20462 * 2) / 2;
    END IF;
    IF p_from_unit = 'lbs' AND p_to_unit = 'kg' THEN
        RETURN round(p_value / 2.20462 * 2) / 2;
    END IF;
    RETURN p_value;
END;
$$;

COMMENT ON FUNCTION "public"."slice3_convert_weight"(numeric, text, text) IS 'Faithful SQL port of src/utils.js convertWeight (kg<->lbs, rounded to nearest 0.5). Used by evaluate_movement_prs to normalize every Movement PR into a canonical kg value before storing/comparing.';

CREATE OR REPLACE FUNCTION "public"."evaluate_movement_prs"()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_weight_unit text;
    v_movement_keyed boolean;
    v_fallback_movement text;
    v_key text;
    v_movement text;
    v_candidate record;
    v_score_kg numeric;
    v_prior_best_kg numeric;
    v_is_first boolean;
    v_improvement numeric;
    v_improvement_pct numeric;
BEGIN
    BEGIN
        SELECT "weight_unit" INTO v_weight_unit FROM "public"."members" WHERE "id" = NEW.member_id;
        v_weight_unit := COALESCE(v_weight_unit, 'kg');

        IF TG_TABLE_NAME = 'wod_logs' THEN
            v_movement_keyed := true;
            v_fallback_movement := NULL;
        ELSE
            v_movement_keyed := (NEW.format_snapshot = 'Superset');
            v_fallback_movement := NEW.skill_name_snapshot;
        END IF;

        FOR v_key IN SELECT jsonb_object_keys(NEW.sets) LOOP
            v_movement := CASE
                WHEN v_movement_keyed AND v_key IS NOT NULL AND btrim(v_key) <> '' THEN v_key
                ELSE v_fallback_movement
            END;
            IF v_movement IS NULL OR btrim(v_movement) = '' THEN
                CONTINUE;
            END IF;

            FOR v_candidate IN
                SELECT
                    trunc(("elem"->>'reps')::numeric)::int AS "reps",
                    MAX(("elem"->>'weight')::numeric) AS "weight"
                FROM jsonb_array_elements(NEW.sets -> v_key) AS "elem"
                WHERE ("elem"->>'reps') ~ '^\d+(\.\d+)?$' AND ("elem"->>'reps')::numeric > 0
                  AND ("elem"->>'weight') ~ '^\d+(\.\d+)?$' AND ("elem"->>'weight')::numeric > 0
                GROUP BY trunc(("elem"->>'reps')::numeric)::int
            LOOP
                v_score_kg := "public"."slice3_convert_weight"(v_candidate.weight, v_weight_unit, 'kg');
                v_is_first := false;
                v_improvement := NULL;
                v_improvement_pct := NULL;

                SELECT MAX("val") INTO v_prior_best_kg
                FROM (
                    SELECT "score_value" AS "val"
                    FROM "public"."pr_events"
                    WHERE "member_id" = NEW.member_id
                      AND "pr_type" = 'movement'
                      AND "movement" = v_movement
                      AND "rep_scheme" = v_candidate.reps

                    UNION ALL

                    SELECT "public"."slice3_convert_weight"("pr"."value", "pr"."unit", 'kg') AS "val"
                    FROM "public"."personal_records" "pr"
                    WHERE "pr"."member_id" = NEW.member_id
                      AND "pr"."movement" = v_movement
                      AND "pr"."unit" IN ('kg', 'lbs')
                      AND COALESCE("pr"."reps", 1) = v_candidate.reps
                      AND "pr"."value" IS NOT NULL
                ) "prior"
                WHERE "val" IS NOT NULL;

                IF v_prior_best_kg IS NULL THEN
                    v_is_first := true;
                ELSIF v_score_kg > v_prior_best_kg THEN
                    v_improvement := v_score_kg - v_prior_best_kg;
                    v_improvement_pct := CASE WHEN v_prior_best_kg <> 0 THEN round(v_improvement / v_prior_best_kg * 100, 2) ELSE NULL END;
                ELSE
                    CONTINUE;
                END IF;

                INSERT INTO "public"."pr_events" (
                    "gym_id", "member_id", "pr_type", "movement", "rep_scheme",
                    "score_value", "score_unit", "previous_best_value", "previous_best_unit",
                    "improvement_value", "improvement_percentage", "is_first_recorded",
                    "source_wod_log_id", "source_skill_log_id", "occurred_at"
                ) VALUES (
                    NEW.gym_id, NEW.member_id, 'movement', v_movement, v_candidate.reps,
                    v_score_kg, 'kg',
                    (CASE WHEN v_is_first THEN NULL ELSE v_prior_best_kg END),
                    (CASE WHEN v_is_first THEN NULL ELSE 'kg' END),
                    v_improvement, v_improvement_pct, v_is_first,
                    (CASE WHEN TG_TABLE_NAME = 'wod_logs' THEN NEW.id ELSE NULL END),
                    (CASE WHEN TG_TABLE_NAME = 'skill_logs' THEN NEW.id ELSE NULL END),
                    NEW.logged_at
                );
            END LOOP;
        END LOOP;
    EXCEPTION WHEN OTHERS THEN
        RAISE WARNING 'evaluate_movement_prs failed for %.id=%: %', TG_TABLE_NAME, NEW.id, SQLERRM;
    END;

    RETURN NEW;
END;
$$;

COMMENT ON FUNCTION "public"."evaluate_movement_prs"() IS 'AFTER INSERT trigger on wod_logs and skill_logs. Automatic Movement PR detection, faithful port of computeSetsPrCandidates (workoutFormats.js). SECURITY DEFINER - the only writer to pr_events for movement PRs. Never blocks the underlying insert (EXCEPTION WHEN OTHERS).';

CREATE OR REPLACE TRIGGER "evaluate_movement_prs_trg"
    AFTER INSERT ON "public"."wod_logs"
    FOR EACH ROW
    WHEN (NEW.sets IS NOT NULL AND NEW.sets <> '{}'::jsonb)
    EXECUTE FUNCTION "public"."evaluate_movement_prs"();

CREATE OR REPLACE TRIGGER "evaluate_movement_prs_trg"
    AFTER INSERT ON "public"."skill_logs"
    FOR EACH ROW
    WHEN (NEW.sets IS NOT NULL AND NEW.sets <> '{}'::jsonb)
    EXECUTE FUNCTION "public"."evaluate_movement_prs"();
