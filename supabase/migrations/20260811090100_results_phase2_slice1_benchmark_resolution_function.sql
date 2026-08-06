-- Results Phase 2, Slice 1: canonical Benchmark resolution.
--
-- RESULTS_PHASE2_IMPLEMENTATION_PLAN.md Section 8: Benchmark resolution is
-- one of the two services this phase moves server-side (the other is PR
-- detection, Slice 3) - a write-time/read-time correctness fact that must
-- return the identical answer regardless of which client asked, rather
-- than three separately-ported client-side approximations (PWA, Admin,
-- and eventually Dashboard) that could silently drift.
--
-- Batch (accepts an array, not one name at a time) specifically to avoid
-- N round-trips rendering a history list of N logged workouts - the
-- concrete performance concern named in the Slice 1 planning discussion.
--
-- SECURITY INVOKER (the default - no DEFINER clause), deliberately: this
-- function needs no privilege the calling client doesn't already have.
-- benchmarks/benchmark_aliases' own RLS SELECT policies (previous
-- migration) already correctly scope every row this function can see to
-- "platform-tier, or this caller's own gym" - re-deriving that scoping
-- inside the function would be a second, riskier place for the same rule
-- to be wrong. Resolution order when a name matches in more than one
-- tier: this gym's own Gym-tier entry wins over a same-named Platform
-- entry (a gym's own naming intent should never be silently shadowed by
-- the platform default).
--
-- Normalization is case- and whitespace-insensitive only (lowercased,
-- internal whitespace collapsed, leading/trailing trimmed) - not
-- punctuation-stripping or fuzzy/typo-tolerant. This is a deliberate,
-- disclosed limit matching Slice 1's own "avoid speculative features"
-- instruction: exact normalized match closes the real gap Phase 1 had
-- (case-sensitive Set equality only) without pretending to solve fuzzy
-- matching, which is a different, harder problem this slice doesn't
-- attempt.

CREATE OR REPLACE FUNCTION "public"."resolve_benchmark_names"("p_names" text[])
RETURNS TABLE (
    "input_name" text,
    "benchmark_id" uuid,
    "canonical_name" text,
    "category" text,
    "is_platform" boolean
)
LANGUAGE sql
STABLE
AS $$
  WITH input AS (
    SELECT DISTINCT raw_name
    FROM unnest(coalesce("p_names", '{}'::text[])) AS raw_name
    WHERE raw_name IS NOT NULL AND btrim(raw_name) <> ''
  ),
  normalized_input AS (
    SELECT raw_name, lower(regexp_replace(btrim(raw_name), '\s+', ' ', 'g')) AS norm
    FROM input
  ),
  candidates AS (
    SELECT
      b.id, b.canonical_name, b.category, (b.gym_id IS NULL) AS is_platform,
      lower(regexp_replace(btrim(b.canonical_name), '\s+', ' ', 'g')) AS norm
    FROM "public"."benchmarks" b
    WHERE b.retired = false
    UNION ALL
    SELECT
      b.id, b.canonical_name, b.category, (b.gym_id IS NULL),
      lower(regexp_replace(btrim(a.alias), '\s+', ' ', 'g'))
    FROM "public"."benchmark_aliases" a
    JOIN "public"."benchmarks" b ON b.id = a.benchmark_id
    WHERE b.retired = false
  )
  SELECT
    ni.raw_name AS input_name,
    best.id AS benchmark_id,
    best.canonical_name,
    best.category,
    best.is_platform
  FROM normalized_input ni
  LEFT JOIN LATERAL (
    SELECT c.id, c.canonical_name, c.category, c.is_platform
    FROM candidates c
    WHERE c.norm = ni.norm
    ORDER BY c.is_platform ASC  -- gym-tier (false) before platform-tier (true)
    LIMIT 1
  ) best ON true;
$$;

COMMENT ON FUNCTION "public"."resolve_benchmark_names"(text[]) IS 'Batch, case/whitespace-normalized Benchmark resolution (RESULTS_DOMAIN_ARCHITECTURE.md Section 7, RESULTS_PHASE2_IMPLEMENTATION_PLAN.md Slice 1). One row per distinct input name, benchmark_id NULL when unresolved - never a wrong guess.';

GRANT EXECUTE ON FUNCTION "public"."resolve_benchmark_names"(text[]) TO "authenticated";
