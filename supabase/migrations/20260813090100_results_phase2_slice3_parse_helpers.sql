-- Results Phase 2, Slice 3: pure score-parsing helpers.
--
-- Faithful SQL ports of two already-live, already-proven client-side
-- functions, not new parsing logic invented for this migration:
--
--   - `slice3_parse_time_to_seconds` ports App.jsx:8737 `parseTimeStr` (the
--     PR screen's own "which of these is the best time" comparator) -
--     handles BOTH forms real `unit='timp'` data actually takes in
--     production: numeric seconds (what `savePR` writes today, via
--     `timeToSec` at save time - App.jsx:7000) and legacy "H:MM:SS"/"M:SS"
--     text (older rows predating that convention). Deliberately NOT
--     App.jsx:1343's other `parseTime` (that one's bare-number fallback
--     means "minutes", because it parses free-text *user input* on a
--     specific screen - a different parsing context, not what is actually
--     stored in `personal_records.value`/`wod_logs.time_result`).
--
--   - `slice3_parse_leading_number` ports App.jsx:1351 `parseScore`
--     verbatim (extracts the leading integer/decimal from a rounds-based
--     result string, e.g. "6 rounds + 5 reps" -> 6).
--
-- Both are pure, IMMUTABLE, and directly testable in isolation via
-- `SELECT function(<literal>)` - no table access, no real member data
-- required to verify correctness before the trigger functions (next
-- migrations) depend on them.
--
-- NULL/unparseable input returns NULL, not JS's `Infinity`/`0` sentinels -
-- Postgres `numeric` has no Infinity, and NULL is the correct "unknown,
-- exclude me" signal for the UNION/comparison queries that will call
-- these (NULLS LAST at the call site does the same job the JS sentinels
-- did, without inventing a fake numeric value that could accidentally
-- compare as real data).

CREATE OR REPLACE FUNCTION "public"."slice3_parse_time_to_seconds"("p_value" text)
RETURNS numeric
LANGUAGE plpgsql
IMMUTABLE
AS $$
DECLARE
    v_str text;
    v_parts text[];
BEGIN
    IF p_value IS NULL THEN
        RETURN NULL;
    END IF;

    v_str := btrim(p_value);
    IF v_str = '' THEN
        RETURN NULL;
    END IF;

    IF v_str LIKE '%:%' THEN
        v_parts := string_to_array(v_str, ':');

        IF array_length(v_parts, 1) = 3 THEN
            IF v_parts[1] !~ '^\d+$' OR v_parts[2] !~ '^\d+$' OR v_parts[3] !~ '^\d+(\.\d+)?$' THEN
                RETURN NULL;
            END IF;
            RETURN v_parts[1]::numeric * 3600 + v_parts[2]::numeric * 60 + v_parts[3]::numeric;
        END IF;

        IF array_length(v_parts, 1) = 2 THEN
            IF v_parts[1] !~ '^\d+$' OR v_parts[2] !~ '^\d+(\.\d+)?$' THEN
                RETURN NULL;
            END IF;
            RETURN v_parts[1]::numeric * 60 + v_parts[2]::numeric;
        END IF;

        RETURN NULL;
    END IF;

    IF v_str ~ '^\d+(\.\d+)?$' THEN
        RETURN v_str::numeric;
    END IF;

    RETURN NULL;
END;
$$;

COMMENT ON FUNCTION "public"."slice3_parse_time_to_seconds"(text) IS 'Faithful SQL port of App.jsx parseTimeStr (PR screen). Returns total seconds for "H:MM:SS"/"M:SS" text or a bare numeric-seconds string; NULL if unparseable. Used by evaluate_benchmark_pr (Slice 3) to compare TIME-scored benchmark results against personal_records.value/pr_events prior bests.';

CREATE OR REPLACE FUNCTION "public"."slice3_parse_leading_number"("p_value" text)
RETURNS numeric
LANGUAGE plpgsql
IMMUTABLE
AS $$
DECLARE
    v_match text;
BEGIN
    IF p_value IS NULL THEN
        RETURN NULL;
    END IF;

    -- Postgres substring() with a parenthesized pattern returns the FIRST
    -- capture group's own match, not the whole match - the decimal part
    -- must be a non-capturing group (?:...) so the single capturing group
    -- wraps the entire number, or an integer-only score (no literal '.')
    -- would return NULL every time (the optional decimal group never
    -- participates in the match).
    v_match := substring(p_value FROM '(\d+(?:\.\d+)?)');
    IF v_match IS NULL THEN
        RETURN NULL;
    END IF;

    RETURN v_match::numeric;
END;
$$;

COMMENT ON FUNCTION "public"."slice3_parse_leading_number"(text) IS 'Faithful SQL port of App.jsx parseScore. Extracts the leading integer/decimal from a rounds-based result string (e.g. "6 rounds + 5 reps" -> 6). NULL if no leading number found. Used by evaluate_benchmark_pr (Slice 3) to compare ROUNDS-scored benchmark results.';
