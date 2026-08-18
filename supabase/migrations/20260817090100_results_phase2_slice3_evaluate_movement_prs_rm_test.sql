-- Member Performance, Phase 5 (PR Engine Hardening) - rewrites
-- evaluate_movement_prs to be comparison-identity aware, closing the
-- CONFIRMED real gap Phase 2/3 disclosed and this phase's own production
-- audit proved twice over: the original function treated every
-- wod_logs.sets key as a movement unconditionally (no rowMode check) and
-- had zero concept of RM_TEST vs SETS_ACROSS vs UNKNOWN (Phase 3's own
-- movementHistory.js contract) - so ANY sets-family Result, of ANY test
-- intent or lack thereof, could create a movement PR event.
--
-- Live proof (audited this phase, both events real, both created the SAME
-- day this migration was written): the only two pr_events rows that exist
-- in production are BOTH sourced from `format_snapshot='Weightlifting'`
-- Results - a format with ZERO config fields, ergo always UNKNOWN under
-- Phase 3's contract, never RM_TEST, never legitimately PR-comparable.
-- Both are left untouched by this migration (no historical guessing/
-- backfill-correction - see the implementation report's own "Known
-- Limitations"), but neither could be created by this new version.
--
-- NEW ELIGIBILITY (ported faithfully from src/movementHistory.js's
-- `resolveComparisonIdentity` - the SAME contract, not a second
-- implementation of the rules): a wod_logs/skill_logs row's `sets` can
-- only ever create a movement PR candidate when `format_snapshot =
-- 'Build to Heavy/1RM'` AND `format_config_snapshot->>'targetLabel'`
-- matches the exact `NRM` shape that field's own UI (RepMaxStepperField)
-- has always guaranteed. This is the ONLY movement format Phase 3 found
-- to carry an explicit, structurally-declared test-intent signal -
-- Weightlifting/Strength Sets/Superset never do (confirmed by Phase 3's
-- own production audit), and Complex's scoringMode='Max Weight' case is
-- explicitly DEFERRED here (see report - zero live rows, a genuinely
-- different round-based re-derivation this migration does not attempt to
-- get right without real data to verify against).
--
-- Within an eligible row, only set-rows whose ACTUAL logged reps equal
-- the declared target are candidates - a Build to Heavy log may contain
-- lighter warm-up rows building up to the final declared-rep-count
-- attempt; only the attempt(s) actually AT the declared target are the
-- real test, matching mission's own "conservative, never guess" framing.
--
-- Reconciliation (new): this trigger now also fires on UPDATE OF sets
-- (both tables), guarded by an explicit NEW/OLD value-equality check (a
-- resend of the same unchanged sets - e.g. a notes-only edit that always
-- recomposes the full payload client-side - must never create a
-- duplicate/phantom event). When sets genuinely changed on an eligible
-- row, this first voids (public.void_stale_pr_events, previous migration)
-- any still-valid event this row previously sourced, THEN re-runs the
-- exact same candidate-detection/prior-best logic as a fresh insert -
-- one code path for both "first ever save" and "corrected later", not
-- two. A DELETE-triggered void is handled entirely by the previous
-- migration's own BEFORE DELETE triggers - nothing to add here.

CREATE OR REPLACE FUNCTION "public"."slice3_parse_rep_max_target"("p_target_label" text)
RETURNS integer
LANGUAGE plpgsql
IMMUTABLE
AS $$
DECLARE
    v_match text;
BEGIN
    IF p_target_label IS NULL THEN
        RETURN NULL;
    END IF;
    v_match := substring(btrim(p_target_label) FROM '^(\d{1,2})RM$');
    IF v_match IS NULL THEN
        RETURN NULL;
    END IF;
    RETURN v_match::integer;
END;
$$;

COMMENT ON FUNCTION "public"."slice3_parse_rep_max_target"(text) IS 'Faithful SQL port of movementHistory.js''s parseRepMaxTarget (Phase 3) - Build to Heavy/1RM''s own targetLabel stepper can only ever produce this exact NRM shape. NULL for anything else (defensive - no real production row has ever failed this).';

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
    v_rep_target integer;
    v_sets_unchanged boolean;
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
        -- ELIGIBILITY GATE - see module header. format_snapshot/
        -- format_config_snapshot are frozen at INSERT time (Slice 2's own
        -- snapshot triggers, BEFORE INSERT OR UPDATE OF wod_id only) so
        -- this never changes across an UPDATE of the same row - safe to
        -- gate once, unconditionally, before any INSERT-vs-UPDATE branching.
        IF NEW.format_snapshot IS DISTINCT FROM 'Build to Heavy/1RM' THEN
            RETURN NEW;
        END IF;
        v_rep_target := "public"."slice3_parse_rep_max_target"(NEW.format_config_snapshot ->> 'targetLabel');
        IF v_rep_target IS NULL THEN
            RETURN NEW;
        END IF;

        -- UPDATE reconciliation guard - a resend of byte-identical sets
        -- (e.g. a notes-only edit) must never create a duplicate event or
        -- void a still-accurate one.
        IF TG_OP = 'UPDATE' THEN
            v_sets_unchanged := (NEW.sets IS NOT DISTINCT FROM OLD.sets);
            IF v_sets_unchanged THEN
                RETURN NEW;
            END IF;
            PERFORM "public"."void_stale_pr_events"(
                (CASE WHEN TG_TABLE_NAME = 'wod_logs' THEN NEW.id ELSE NULL END),
                (CASE WHEN TG_TABLE_NAME = 'skill_logs' THEN NEW.id ELSE NULL END)
            );
        END IF;

        IF NEW.sets IS NULL OR NEW.sets = '{}'::jsonb THEN
            RETURN NEW;
        END IF;

        SELECT "weight_unit" INTO v_weight_unit FROM "public"."members" WHERE "id" = NEW.member_id;
        v_weight_unit := COALESCE(v_weight_unit, 'kg');

        -- Movement identity - unchanged from the original trigger's own
        -- proven distinction (wod_logs: every key IS a movement, since
        -- eligibility above already guarantees rowMode:'movement' -
        -- Build to Heavy/1RM has no other rowMode; skill_logs: Superset-
        -- keyed vs skill_name_snapshot fallback - Build to Heavy/1RM is
        -- never Superset, so this is always the fallback branch here).
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

            -- Only the row(s) actually AT the declared rep target are
            -- candidates - see module header ("warm-up exclusion").
            FOR v_candidate IN
                SELECT MAX(("elem"->>'weight')::numeric) AS "weight"
                FROM jsonb_array_elements(NEW.sets -> v_key) AS "elem"
                WHERE ("elem"->>'reps') ~ '^\d+(\.\d+)?$' AND trunc(("elem"->>'reps')::numeric) = v_rep_target
                  AND ("elem"->>'weight') ~ '^\d+(\.\d+)?$' AND ("elem"->>'weight')::numeric > 0
            LOOP
                IF v_candidate.weight IS NULL THEN
                    CONTINUE;
                END IF;

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
                      AND "rep_scheme" = v_rep_target
                      -- Any event this SAME row previously sourced was
                      -- already voided above (UPDATE path) before this
                      -- query runs, so it's already excluded by this
                      -- filter alone - no separate self-exclusion needed.
                      AND "voided_at" IS NULL

                    UNION ALL

                    SELECT "public"."slice3_convert_weight"("pr"."value", "pr"."unit", 'kg') AS "val"
                    FROM "public"."personal_records" "pr"
                    WHERE "pr"."member_id" = NEW.member_id
                      AND "pr"."movement" = v_movement
                      AND "pr"."unit" IN ('kg', 'lbs')
                      AND COALESCE("pr"."reps", 1) = v_rep_target
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
                    NEW.gym_id, NEW.member_id, 'movement', v_movement, v_rep_target,
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

COMMENT ON FUNCTION "public"."evaluate_movement_prs"() IS 'Member Performance Phase 5 - AFTER INSERT OR UPDATE OF sets trigger on wod_logs and skill_logs. Movement PR detection scoped to RM_TEST-eligible Results only (Build to Heavy/1RM with a valid targetLabel - Phase 3''s own comparison-identity contract, ported faithfully, not reimplemented). Reconciles on UPDATE (voids any stale event this row previously sourced, then re-evaluates). SECURITY DEFINER - the only writer to pr_events. Never blocks the underlying insert/update (EXCEPTION WHEN OTHERS).';

CREATE OR REPLACE TRIGGER "evaluate_movement_prs_trg"
    AFTER INSERT ON "public"."wod_logs"
    FOR EACH ROW
    WHEN (NEW.sets IS NOT NULL AND NEW.sets <> '{}'::jsonb)
    EXECUTE FUNCTION "public"."evaluate_movement_prs"();

-- Separate UPDATE trigger, deliberately WITHOUT the "sets non-empty" WHEN
-- guard the INSERT trigger has - an edit that CLEARS a previously-eligible
-- row's sets entirely must still fire this function so it gets the chance
-- to void the now-stale event (handled inside the function body, not the
-- WHEN clause, for exactly this reason).
CREATE OR REPLACE TRIGGER "evaluate_movement_prs_update_trg"
    AFTER UPDATE OF "sets" ON "public"."wod_logs"
    FOR EACH ROW
    EXECUTE FUNCTION "public"."evaluate_movement_prs"();

CREATE OR REPLACE TRIGGER "evaluate_movement_prs_trg"
    AFTER INSERT ON "public"."skill_logs"
    FOR EACH ROW
    WHEN (NEW.sets IS NOT NULL AND NEW.sets <> '{}'::jsonb)
    EXECUTE FUNCTION "public"."evaluate_movement_prs"();

-- Also closes a separately-disclosed, pre-existing Slice 3 limitation
-- (Current State Audit): skill_logs' own upsert(...onConflict:'member_id,
-- wod_id,slot') means an edit to an existing slot was previously an
-- UPDATE, which the old AFTER-INSERT-only trigger never fired on at all.
-- This UPDATE trigger closes that gap as a direct, mechanical consequence
-- of the same fix, not separate new scope.
CREATE OR REPLACE TRIGGER "evaluate_movement_prs_update_trg"
    AFTER UPDATE OF "sets" ON "public"."skill_logs"
    FOR EACH ROW
    EXECUTE FUNCTION "public"."evaluate_movement_prs"();
