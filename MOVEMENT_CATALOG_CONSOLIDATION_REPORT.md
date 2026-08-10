# Movement Catalog Consolidation — Implementation Report

**Status: LIVE in both repos.** Phase 2 of the workout-authoring initiative (Phase 1 was Coach Quick Create).

## Why this happened

Two contradictory mission briefs arrived in the same message: one asking for a greenfield 300–500 movement catalog sourced from three external sites, the other explicitly saying "do NOT build a new one" and describing an (partly inaccurate) multi-source duplication problem. The user was asked and chose, via `AskUserQuestion`:

1. **Consolidate the existing catalog**, not build a new standalone one.
2. **Exclude WODCAT and GetEvox** as data sources — WODCAT is a direct commercial competitor; GetEvox's ToS prohibits commercial reuse without authorization. **open-wod-db only** (CC BY 4.0, confirmed via its GitHub README), used purely as enrichment.

Ground-truth research also corrected the second brief's own framing: the three "divergent" static movement lists (`WOD-SIMPLE/src/movements.js`, `forge-admin-web/src/features/programming/movements.ts`, `supabase/functions/analyze-workout/movementCatalog.ts`) were never actually divergent — they're the same ~250-name list kept in sync by disciplined manual porting. The real gap was that the `movements` DB table (built in Phase 1) had **zero readers** anywhere in the platform.

## What shipped

### 1. Seed migration (`20260820090000_movements_catalog_seed.sql`)
465 platform-global (`gym_id = NULL`) rows: 342 from Forge's existing canonical list + 123 genuinely new movements merged in from open-wod-db, with `default_substitutions` populated for the 19 movements that already had entries in the static `SCALING_SUBSTITUTIONS` table. Applied live and verified (`465` total rows, `246` with category data, `19` with substitutions).

A punctuation-insensitive dedup pass (`matchKey()`) caught and removed 34 near-duplicate rows (e.g. "Pull-up" vs "Pull Up") that a naive case-insensitive merge would have produced — caught by manual inspection of the generated SQL before it touched the live DB.

### 2. Autocomplete wired to the full catalog (both repos)
- `forge-admin-web`'s `fetchMovementsForGym` was silently missing platform-global rows (`gym_id IS NULL`) even before this seed — fixed as part of this work, so this was a real bug closed, not just new data exposed.
- WOD-SIMPLE PWA gained a "+ Create New Movement" affordance in the coach WOD editor (`movementsApi.js`, `CreateMiscareRow`), closing a cross-client parity gap — forge-admin-web had this since Phase 1, the PWA didn't.

### 3. Deterministic scaling engine reads `default_substitutions`
New `buildScalingOverrides(movements)` (ported identically to both `scalingEngine.ts` and `.js`) folds each movement's DB-stored substitution data into the `overrides` param `generateVariantsFromRx` already accepted but no caller populated. Zero behavior change for movements without a DB entry.

### 4. AI paths see gym-specific movements
- Regenerate-with-AI (both repos) now sends `gymMovementContext` — the edge function already consumed this field since Phase 1, no client sent it until now.
- `analyze-workout` accepts an optional `gymId`; when present, `buildSystemPrompt()` appends gym + platform movement names to the prompt for that request only. Fully backward compatible when omitted.

## Explicit scope decisions

- **Static list files were not deleted** — kept as the zero-latency/offline fallback tier, matching this codebase's established never-delete-a-working-fallback pattern.
- **No new workout-format table** — formats stay the existing static enum, per the user's own brief.
- **WODCAT and GetEvox are excluded entirely** — no code references, no seed data traces to either.
- **`resolveCanonicalMovement()`'s deterministic fallback was NOT extended** with a DB-sourced alias parameter — the primary mechanism (prompt injection) already covers gym movement recognition; extending the secondary code-level fallback was judged disproportionate effort for a safety-net path.

## Verification

- Live DB: seed row counts confirmed post-migration.
- Unit tests: `buildScalingOverrides` (3 new tests each repo, including a DB-override-beats-static-table precedence case), autocomplete platform-global fetch (updated mocks/assertions).
- Quality gates: WOD-SIMPLE 531/531 tests, clean build. forge-admin-web: ESLint clean, 837/837 tests, clean `tsc -b` + `vite build`.
- Live browser verification (both production sites): typed "Ab Wheel" into the movement quick-add in both forge-admin-web's Programming editor and WOD-SIMPLE PWA's Admin WOD editor — **"Ab Wheel Rollout" appeared as a suggestion in both**, confirming the seed data, the `gym_id IS NULL` autocomplete fix, and the PWA's new catalog wiring are all live and correct together.
- `analyze-workout` edge function deployed and curl-verified (401 without auth, matching pre-existing behavior — a genuine syntax error would have failed the deploy itself).

## Deploy

- WOD-SIMPLE: commit `e104007`, pushed to `main`, `app_version` bumped to `movement-catalog-consolidation-20260810`.
- forge-admin-web: commit `a085343`, pushed to `main`.
