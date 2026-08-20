-- Legacy PR Identity — DB/Client Parity Fix. Narrow, disclosed-gap
-- correction following Canonical Movement Identity Phase 3's own report:
-- the PR Engine's LEGACY movement-text comparison path (used only when
-- `movement_id IS NULL` - a canonical Result's own `movement_id = X`
-- match is completely untouched by this migration) was case-sensitive
-- exact-text equality, while the client's own legacy comparison identity
-- (`movementHistoryIdentity()`'s `text:<normalizeKey(movementName)>` tag,
-- Canonical Movement Identity Phase 2/3) is trim + whitespace-collapsed +
-- lower-cased. Proven, not assumed: `evaluate_movement_prs()`'s legacy
-- branch used plain `"movement" = v_movement` against both `pr_events`
-- and `personal_records`, with zero normalization applied to either side
-- - not merely a case gap, a trim/whitespace gap too.
--
-- Fix: one new, small, deterministic, IMMUTABLE function
-- (`legacy_normalize_movement_text`) applying EXACTLY the client's own
-- three-step contract - trim, collapse internal whitespace, lowercase -
-- nothing more (no punctuation stripping, no Unicode normalization, no
-- alias/catalog lookup) - applied to BOTH sides of the legacy
-- `pr_events`/`personal_records` comparisons. `pr_events.movement` itself
-- is NEVER rewritten - the raw, as-typed text remains the permanent
-- audit trail (the same "snapshot is display truth, only the comparison
-- key is normalized" principle every prior phase of this initiative has
-- already used) - only the WHERE-clause predicate changes.
--
-- Canonical path (`movement_id IS NOT NULL`) is completely untouched -
-- not one character of that branch is modified by this migration.

CREATE OR REPLACE FUNCTION "public"."legacy_normalize_movement_text"("p_text" text)
RETURNS text
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT lower(btrim(regexp_replace(coalesce($1, ''), '\s+', ' ', 'g')));
$$;

COMMENT ON FUNCTION "public"."legacy_normalize_movement_text"(text) IS 'Legacy PR Identity DB/Client Parity Fix - the exact SQL equivalent of the client''s own normalizeKey() (movementHistory.js/.ts): trim, collapse internal whitespace, lowercase. Nothing else - no punctuation stripping, no Unicode normalization, no alias/catalog resolution. Used ONLY for legacy (movement_id IS NULL) PR-stream comparison predicates - never applied to a stored movement column, never used for canonical (movement_id-based) matching.';

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

        -- Movement identity - unchanged from Phase 5/Phase 3.
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

                IF v_movement_id IS NOT NULL THEN
                    -- Canonical stream - UNCHANGED from Phase 3, not one
                    -- character modified by this migration.
                    SELECT MAX("score_value") INTO v_prior_best_kg
                    FROM "public"."pr_events"
                    WHERE "member_id" = NEW.member_id
                      AND "pr_type" = 'movement'
                      AND "movement_id" = v_movement_id
                      AND "rep_scheme" = v_rep_target
                      AND "voided_at" IS NULL;
                ELSE
                    -- Legacy stream - THE FIX: both sides of the movement
                    -- comparison (pr_events.movement AND personal_records.movement,
                    -- against v_movement) now go through
                    -- legacy_normalize_movement_text(), matching the
                    -- client's own normalizeKey() contract exactly
                    -- (trim + collapse whitespace + lowercase, nothing
                    -- more). The stored `movement` column itself is still
                    -- never rewritten - only this comparison predicate
                    -- changed.
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

COMMENT ON FUNCTION "public"."evaluate_movement_prs"() IS 'Member Performance Phase 5, extended by Canonical Movement Identity Phase 3, extended by Legacy PR Identity DB/Client Parity Fix - AFTER INSERT OR UPDATE OF sets trigger on wod_logs and skill_logs. Canonical stream matching (movement_id) unchanged since Phase 3. Legacy stream matching (movement_id IS NULL) now normalizes both sides via legacy_normalize_movement_text(), matching the client''s own normalizeKey() contract exactly - trim/whitespace/case only, no punctuation or alias handling. SECURITY DEFINER - the only writer to pr_events. Never blocks the underlying insert/update (EXCEPTION WHEN OTHERS).';
