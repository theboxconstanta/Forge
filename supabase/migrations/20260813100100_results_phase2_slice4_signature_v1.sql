-- Results Phase 2, Slice 4: Signature V1 - the single, isolated,
-- swappable Workout Signature generator.
--
-- Approved this session (after live verification: 0/320 movement
-- elements anywhere in production have populated canonicalName/reps/
-- weight, despite a real, tested AI-parsing pipeline - workoutIntelligence.js
-- - existing) as a deliberately narrower, HONEST v1: structural/textual
-- matching only, built entirely from data already guaranteed to exist -
-- format, format_config, and the raw movement-line text array `wods`
-- already stores per section (movements_rx/skill/skill2 - the exact
-- columns Slice 2's own snapshot triggers already read, confirmed live
-- to match workout_sections.movements[].name verbatim for the same
-- workout, so no new data source is introduced).
--
-- This function is the ENTIRE V1/V2 boundary - every caller (the
-- snapshot triggers, migration 20260813100200) only ever calls this one
-- function and stores its result; nothing downstream (performance_
-- identities, performance_timeline, performance_progression_summary,
-- either client) inspects a signature's internal shape. A future
-- Signature V2 (canonical-movement-keyed, after a dedicated Programming
-- backfill project resolves canonicalName in production) is a
-- CREATE OR REPLACE of this one function plus a version bump at the call
-- site - not a redesign of anything else in the Results domain.
--
-- Deliberately NOT a hash (md5/sha) - stored as a readable, inspectable
-- normalized string. This project's own established debugging culture
-- (STOP-and-report on any real gap found) benefits far more from being
-- able to `SELECT signature FROM performance_identities` and directly
-- see WHY two workouts did or didn't collapse to the same identity than
-- from a compact-but-opaque hash. Text index cost at this data volume is
-- immaterial.
--
-- Normalization matches the mission's own explicit list ("ignore
-- punctuation, capitalization, whitespace, cosmetic formatting") applied
-- to each raw movement line: lowercase, every run of non-alphanumeric
-- characters collapsed to a single space (not deleted - "38/61kg" must
-- stay "38 61kg", two distinct numbers, not silently merge into "3861kg"),
-- trimmed. Movement ORDER is preserved (never sorted) - the mission's own
-- "movement order" is a structural signal, not noise. A line that
-- normalizes to empty (pure punctuation/divider) is dropped entirely.
--
-- Explicitly, honestly out of scope for V1 (disclosed, not hidden): two
-- differently-WORDED descriptions of the same conceptual workout (a
-- movement alias like "Push Press" vs "Strict Press" written by two
-- different coaches) will NOT collapse to the same signature. Only exact
-- benchmark-name resolution (Slice 1, already alias-aware) closes that
-- gap today; full alias-aware Signature V2 needs real canonical movement
-- data, which does not exist in production yet.

CREATE OR REPLACE FUNCTION "public"."slice4_compute_performance_signature"(
    "p_format" text,
    "p_format_config" jsonb,
    "p_movements" jsonb
)
RETURNS text
LANGUAGE plpgsql
IMMUTABLE
AS $$
DECLARE
    v_format text;
    v_config text;
    v_line text;
    v_norm_line text;
    v_lines text[] := ARRAY[]::text[];
BEGIN
    IF p_format IS NULL AND p_movements IS NULL THEN
        RETURN NULL;
    END IF;

    v_format := lower(btrim(COALESCE(p_format, '')));
    v_config := COALESCE(p_format_config::text, '{}');

    IF p_movements IS NOT NULL AND jsonb_typeof(p_movements) = 'array' THEN
        FOR v_line IN SELECT jsonb_array_elements_text(p_movements) LOOP
            v_norm_line := lower(v_line);
            v_norm_line := regexp_replace(v_norm_line, '[^a-z0-9]+', ' ', 'g');
            v_norm_line := btrim(v_norm_line);
            IF v_norm_line <> '' THEN
                v_lines := array_append(v_lines, v_norm_line);
            END IF;
        END LOOP;
    END IF;

    IF v_format = '' AND array_length(v_lines, 1) IS NULL THEN
        RETURN NULL;
    END IF;

    RETURN v_format || '|' || v_config || '|' || array_to_string(v_lines, '|');
END;
$$;

COMMENT ON FUNCTION "public"."slice4_compute_performance_signature"(text, jsonb, jsonb) IS 'Signature V1 (Slice 4) - the sole Workout Signature generator, structural/textual only (format + format_config + normalized raw movement-line array). The entire V1/V2 boundary: swapping to a canonical-movement V2 later means replacing only this function''s body, not any downstream consumer.';
