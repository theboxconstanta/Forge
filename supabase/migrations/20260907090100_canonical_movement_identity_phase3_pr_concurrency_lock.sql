-- CANONICAL STRENGTH RESULT INTELLIGENCE, Phase D (section 19) - PR-write
-- concurrency hardening.
--
-- INVESTIGATED (forensic, not assumed): evaluate_movement_prs runs inside
-- the SAME transaction as the triggering wod_logs/skill_logs INSERT/UPDATE
-- (a plain AFTER trigger, not a separate job), on Postgres' default READ
-- COMMITTED isolation. Under READ COMMITTED, each of the trigger's own
-- SELECTs sees only rows already COMMITTED by other transactions at the
-- moment that SELECT runs - it does NOT wait for or see a concurrent,
-- still-in-flight transaction's about-to-be-inserted row. Two genuinely
-- simultaneous saves for the SAME (member, movement identity, rep_target)
-- - a double-tap before the client's own `wodSaving` loading-state guard
-- disables the button, a flaky-network retry of the same insert, or two
-- devices/tabs logged into the same account - can therefore both read the
-- SAME stale "prior best" before either commits, both independently
-- conclude "this beats the prior best", and both INSERT a competing
-- pr_events row. No existing unique constraint or lock prevents this: the
-- table has no UNIQUE(member_id, movement_id/movement, rep_scheme)
-- constraint (deliberately, since a member can and should have MANY
-- historical pr_events rows for the same key over time), and nothing
-- today serializes two concurrent trigger executions for the same key. A
-- real, live race - not a theoretical one already closed by transaction
-- isolation - confirmed by re-reading the function's own logic above
-- rather than assumed.
--
-- FIX (smallest safe hardening, per the mission's own suggested options):
-- a single `pg_advisory_xact_lock` call, keyed by
-- (member_id, canonical movement_id OR normalized legacy movement text,
-- rep_target), acquired immediately before the prior-best lookup for each
-- candidate. Advisory XACT locks auto-release at COMMIT/ROLLBACK - exactly
-- the trigger's own transactional scope, nothing to explicitly unlock. A
-- second concurrent transaction attempting the SAME key blocks until the
-- first commits, at which point its own prior-best SELECT (still within
-- its own transaction, READ COMMITTED) correctly observes the
-- newly-committed row and evaluates against the TRUE current best -
-- closing the race without any schema/constraint change, without
-- touching eligibility, movement identity, candidate selection, or
-- reconciliation logic (byte-identical below the marked block). A save
-- for a DIFFERENT member/movement/rep-target never blocks on this lock
-- (a different hash key) - only genuinely competing writes serialize.
--
-- hashtext(...)::bigint (not hashtextextended) - a plain int4->bigint
-- widen is enough here: advisory locks are a serialization aid, not a
-- security boundary, and a hash collision only ever costs one extra
-- (harmless) transaction-scoped wait between two UNRELATED keys, never a
-- correctness bug (the SELECT itself is still scoped by the real
-- member_id/movement_id/rep_scheme columns, never by the hash).

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
    v_movement_id uuid;
    v_lock_key text;
    v_candidate record;
    v_score_kg numeric;
    v_prior_best_kg numeric;
    v_is_first boolean;
    v_improvement numeric;
    v_improvement_pct numeric;
BEGIN
    BEGIN
        -- ELIGIBILITY GATE - unchanged.
        IF NEW.format_snapshot IS DISTINCT FROM 'Build to Heavy/1RM' THEN
            RETURN NEW;
        END IF;
        v_rep_target := "public"."slice3_parse_rep_max_target"(NEW.format_config_snapshot ->> 'targetLabel');
        IF v_rep_target IS NULL THEN
            RETURN NEW;
        END IF;

        -- UPDATE reconciliation guard - unchanged.
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

        -- Movement identity - unchanged.
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

            v_movement_id := NULLIF(NEW.sets_movement_ids ->> v_key, '')::uuid;

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

                -- CONCURRENCY HARDENING (section 19, this migration) - the
                -- ONE new block. Serializes concurrent evaluators for this
                -- exact PR key so the prior-best read below is never
                -- racing another in-flight transaction's write to the
                -- same key; a lock on a DIFFERENT key never blocks.
                v_lock_key := NEW.member_id::text || '|' ||
                    COALESCE(v_movement_id::text, "public"."legacy_normalize_movement_text"(v_movement)) || '|' ||
                    v_rep_target::text;
                PERFORM pg_advisory_xact_lock(hashtext(v_lock_key)::bigint);

                IF v_movement_id IS NOT NULL THEN
                    -- Canonical stream - UNCHANGED.
                    SELECT MAX("score_value") INTO v_prior_best_kg
                    FROM "public"."pr_events"
                    WHERE "member_id" = NEW.member_id
                      AND "pr_type" = 'movement'
                      AND "movement_id" = v_movement_id
                      AND "rep_scheme" = v_rep_target
                      AND "voided_at" IS NULL;
                ELSE
                    -- Legacy stream - UNCHANGED (legacy_normalize_movement_text
                    -- comparison from the prior migration).
                    SELECT MAX("val") INTO v_prior_best_kg
                    FROM (
                        SELECT "score_value" AS "val"
                        FROM "public"."pr_events"
                        WHERE "member_id" = NEW.member_id
                          AND "pr_type" = 'movement'
                          AND "public"."legacy_normalize_movement_text"("movement") = "public"."legacy_normalize_movement_text"(v_movement)
                          AND "rep_scheme" = v_rep_target
                          AND "movement_id" IS NULL
                          AND "voided_at" IS NULL

                        UNION ALL

                        SELECT "public"."slice3_convert_weight"("pr"."value", "pr"."unit", 'kg') AS "val"
                        FROM "public"."personal_records" "pr"
                        WHERE "pr"."member_id" = NEW.member_id
                          AND "public"."legacy_normalize_movement_text"("pr"."movement") = "public"."legacy_normalize_movement_text"(v_movement)
                          AND "pr"."unit" IN ('kg', 'lbs')
                          AND COALESCE("pr"."reps", 1) = v_rep_target
                          AND "pr"."value" IS NOT NULL
                    ) "prior"
                    WHERE "val" IS NOT NULL;
                END IF;

                IF v_prior_best_kg IS NULL THEN
                    v_is_first := true;
                ELSIF v_score_kg > v_prior_best_kg THEN
                    v_improvement := v_score_kg - v_prior_best_kg;
                    v_improvement_pct := CASE WHEN v_prior_best_kg <> 0 THEN round(v_improvement / v_prior_best_kg * 100, 2) ELSE NULL END;
                ELSE
                    CONTINUE;
                END IF;

                INSERT INTO "public"."pr_events" (
                    "gym_id", "member_id", "pr_type", "movement", "movement_id", "rep_scheme",
                    "score_value", "score_unit", "previous_best_value", "previous_best_unit",
                    "improvement_value", "improvement_percentage", "is_first_recorded",
                    "source_wod_log_id", "source_skill_log_id", "occurred_at"
                ) VALUES (
                    NEW.gym_id, NEW.member_id, 'movement', v_movement, v_movement_id, v_rep_target,
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

COMMENT ON FUNCTION "public"."evaluate_movement_prs"() IS 'Member Performance Phase 5, extended by Canonical Movement Identity Phase 3 + the legacy-text-normalization parity fix (20260825090000) + PR-write concurrency hardening (section 19, 20260907090100): a pg_advisory_xact_lock keyed by (member_id, movement identity, rep_target) serializes concurrent evaluators for the same PR key, closing a real read-then-insert race under READ COMMITTED (two simultaneous saves could otherwise both read the same stale prior-best and both insert a competing pr_events row). AFTER INSERT OR UPDATE OF sets trigger on wod_logs and skill_logs. Never blocks the underlying insert/update (EXCEPTION WHEN OTHERS).';
