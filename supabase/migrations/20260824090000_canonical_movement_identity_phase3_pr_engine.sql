-- Canonical Movement Identity, Phase 3 (PR Engine + Current Bests
-- Canonical Identity Migration). Extends `evaluate_movement_prs`
-- (Member Performance Phase 5) to prefer Phase 1's own frozen
-- `sets_movement_ids` for movement-stream matching, with the exact
-- existing text-based behavior preserved as the legacy fallback - an
-- identity-key migration, not a PR Engine rewrite. Every existing
-- eligibility/reconciliation/voiding mechanism (RM_TEST gate, UPDATE
-- guard, void-then-reevaluate, BEFORE DELETE voiding) is untouched.
--
-- `pr_events.movement_id` (new, additive, nullable): proven necessary,
-- not merely convenient - reconstructing canonical identity by joining
-- every prior pr_events row back to its own source Result on every
-- INSERT (to check that source's own sets_movement_ids) would be both
-- slower and no more correct than freezing the same value the new event
-- itself is about to use, at the moment it's created - the same "frozen
-- at write time" philosophy Phase 1 already established for Results
-- themselves. `movement` (raw text) is still always stored too, for
-- BOTH canonical and legacy events - the honest audit trail, never
-- replaced.
--
-- NO-BRIDGE POLICY (CANONICAL_MOVEMENT_IDENTITY_ARCHITECTURE_V1.md §6,
-- reaffirmed unchanged by Phase 2, reaffirmed unchanged here): a
-- canonical candidate (`v_movement_id IS NOT NULL`) is matched against
-- prior `pr_events` ONLY by `movement_id = v_movement_id` - never by
-- text, never unioned with `personal_records` (which has no movement_id
-- and predates this entire initiative; unioning it in would itself BE a
-- text-based bridge into canonical identity, exactly what this policy
-- forbids). A legacy candidate (`v_movement_id IS NULL`) is matched
-- EXACTLY as before (`movement` = raw text, unioned with
-- `personal_records`), with one added guard (`movement_id IS NULL` on
-- the pr_events side) so a legacy candidate can never match a row that
-- has since gained a movement_id - a defense-in-depth guard, not a
-- behavior change against the 5 known legacy rows (all still NULL,
-- never backfilled).
--
-- Known, disclosed limitation of the no-bridge policy: a member's FIRST
-- canonical-stream PR event for a movement will show
-- `is_first_recorded=true` even if they have older, pre-canonical
-- `personal_records`-only history for the "same" movement by name - the
-- same accepted trade-off Phase 2 already made for Movement History
-- (visible fragmentation during the transition, safer than guessing).

ALTER TABLE "public"."pr_events"
  ADD COLUMN IF NOT EXISTS "movement_id" uuid REFERENCES "public"."movements"("id") ON DELETE SET NULL;

COMMENT ON COLUMN "public"."pr_events"."movement_id" IS 'Canonical Movement Identity Phase 3 - frozen from the source Result''s own sets_movement_ids at event-creation time (never re-resolved later, never backfilled onto pre-existing rows). NULL for a legacy event or one whose source movement was unresolved. ON DELETE SET NULL, matching source_wod_log_id/source_skill_log_id''s own survives-upstream-deletion guarantee - deleting a movements catalog row (should never happen per the catalog''s own no-hard-delete convention) does not delete PR history.';

CREATE INDEX IF NOT EXISTS "pr_events_movement_id_idx" ON "public"."pr_events" ("movement_id") WHERE "movement_id" IS NOT NULL;

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
    v_candidate record;
    v_score_kg numeric;
    v_prior_best_kg numeric;
    v_is_first boolean;
    v_improvement numeric;
    v_improvement_pct numeric;
BEGIN
    BEGIN
        -- ELIGIBILITY GATE - unchanged from Phase 5.
        IF NEW.format_snapshot IS DISTINCT FROM 'Build to Heavy/1RM' THEN
            RETURN NEW;
        END IF;
        v_rep_target := "public"."slice3_parse_rep_max_target"(NEW.format_config_snapshot ->> 'targetLabel');
        IF v_rep_target IS NULL THEN
            RETURN NEW;
        END IF;

        -- UPDATE reconciliation guard - unchanged from Phase 5.
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

        -- Movement identity - unchanged from Phase 5's own proven
        -- distinction. Build to Heavy/1RM is never Superset, so
        -- skill_logs always takes the pooled skill_name_snapshot
        -- fallback branch here - exactly as Phase 1's own resolver
        -- already assumed when it froze sets_movement_ids (every key in
        -- a pooled row maps to the SAME resolved movement_id), so
        -- `sets_movement_ids ->> v_key` below is correct in both
        -- branches without any special-casing.
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

            -- Canonical Movement Identity Phase 3 - the ONE new line in
            -- this loop. Reads Phase 1's own already-frozen resolution
            -- for this exact sets key; never re-resolves, never guesses.
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

                IF v_movement_id IS NOT NULL THEN
                    -- Canonical stream: matched ONLY by movement_id, never
                    -- unioned with personal_records (no-bridge policy,
                    -- see migration header).
                    SELECT MAX("score_value") INTO v_prior_best_kg
                    FROM "public"."pr_events"
                    WHERE "member_id" = NEW.member_id
                      AND "pr_type" = 'movement'
                      AND "movement_id" = v_movement_id
                      AND "rep_scheme" = v_rep_target
                      AND "voided_at" IS NULL;
                ELSE
                    -- Legacy stream: byte-for-byte the original Phase 5
                    -- query, plus one defense-in-depth guard
                    -- ("movement_id" IS NULL) so a legacy candidate can
                    -- never match a row that has since gained one.
                    SELECT MAX("val") INTO v_prior_best_kg
                    FROM (
                        SELECT "score_value" AS "val"
                        FROM "public"."pr_events"
                        WHERE "member_id" = NEW.member_id
                          AND "pr_type" = 'movement'
                          AND "movement" = v_movement
                          AND "rep_scheme" = v_rep_target
                          AND "movement_id" IS NULL
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

COMMENT ON FUNCTION "public"."evaluate_movement_prs"() IS 'Member Performance Phase 5, extended by Canonical Movement Identity Phase 3 - AFTER INSERT OR UPDATE OF sets trigger on wod_logs and skill_logs. Movement PR detection scoped to RM_TEST-eligible Results only (unchanged). Prefers Phase 1''s frozen sets_movement_ids for stream matching when present (canonical, never bridged with legacy/personal_records by text); falls back to the exact original text-based matching otherwise. SECURITY DEFINER - the only writer to pr_events. Never blocks the underlying insert/update (EXCEPTION WHEN OTHERS).';
