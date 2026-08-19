# Canonical Movement Identity, Phase 1 — Result-Side Movement Identity Resolution: Implementation Report

**Status: SHIPPED, LIVE. DB-only migration, zero application code changes in either repo. Zero historical mutation. No Movement History/PR Engine/Performance Overview behavior change.**

## Executive Summary

Extends the already-live `movements` catalog (Phase 0's own central finding: global+gym-scoped, 465 seeded rows, aliases, RLS) to reach Results for the first time, exactly as `CANONICAL_MOVEMENT_IDENTITY_ARCHITECTURE_V1.md` specified: an additive, nullable `sets_movement_ids jsonb` map on `wod_logs`/`skill_logs`, keyed identically to each row's own `sets` column, computed server-side by a new deterministic resolver (`resolve_movement_id`) wired into the existing Results Phase 2 Slice 2 snapshot-trigger family. No client in either repo was changed — resolution happens exclusively in Postgres, so the same input resolves identically regardless of which client (today, only WOD-SIMPLE) writes the Result. No Movement History, PR Engine, or Performance Overview code was touched; nothing reads this new column yet.

## Phase 0 Architecture Followed

Verified against current code before writing any migration (mission §2): the `movements` table, its RLS, `aliases[]`/GIN index, and both clients' autocomplete integration all still exist exactly as Phase 0 documented. No contradiction found — proceeded per the approved contract.

## Existing Catalog Reused

No new catalog, no new taxonomy. `resolve_movement_id` reads `public.movements` directly (`gym_id IS NULL OR gym_id = p_gym_id`), the same table Phase 0 audited.

## Existing Resolver Reused

**Honest correction to this mission's own framing**: there was no existing resolver to reuse for this job. The pre-existing `resolveCanonicalMovement()` (edge function `analyze-workout/movementCatalog.ts`) operates on a separate, hardcoded, non-DB-backed list, for a different purpose (AI-output display-text cleanup, string → string), confirmed in Phase 0's own audit and re-confirmed here before writing code. `resolve_movement_id` is the **first** resolver in this codebase that queries `movements` by ID — not a second, competing implementation of an existing one. This is documented explicitly in the migration's own header comment so no future reader assumes duplication where none exists.

## Result Source Audit

Confirmed via code inspection: **only WOD-SIMPLE writes `wod_logs`/`skill_logs`** — `forge-admin-web` has zero `insert`/`update`/`upsert` call sites against either table (grepped, zero matches). All WOD-SIMPLE writes are client-direct Supabase calls (`supabase.from('wod_logs').insert/update(...)`, `supabase.from('skill_logs').upsert(...)`) with no backend/edge-function intermediary — confirming DB-trigger-side resolution is not just safest but the only mechanism that guarantees consistent resolution regardless of write path, present or future.

## wod_logs Decision

`sets` can carry multiple movement-keyed entries (verified live: real production rows with 2+ keys exist, e.g. a real row containing both `"Power Clean"` and a junk `"3-3-3-3-3"` key side by side). `sets_movement_ids jsonb` map confirmed correct, not a single column.

## skill_logs Decision

**Verified, not assumed** (mission §20's own explicit instruction): `skill_logs.sets` is the exact same JSONB-object shape as `wod_logs.sets` and can also carry multiple keys (confirmed in `saveSkillLog`'s own `setsCurate` composition). The map, not a single column, is correct here too — but the *meaning* of each key differs by format: only `format_snapshot='Superset'` treats each key as its own movement (matching `extractMovementEntriesFromSkillLogs`'s exact rule); every other skill format pools all of a row's `sets` keys under the row's own `skill_name_snapshot`. The trigger reproduces this pooling exactly (same resolved `movement_id` repeated under every key) rather than inventing a new per-key rule — verified live against the real Phase 5-disclosed case (one Weightlifting-format `skill_logs` row with 3 distinct chained movements — `"1 Clean pull"`, `"1 Clean-grip deadlift"`, `"1 Squat clean"` — all correctly resolving to the same `Deadlift` movement ID, matching what Movement History already groups them as today).

## Identity Map Contract

`sets_movement_ids` keys are always derived directly from `jsonb_object_keys(sets)` — by construction, never a dangling key, never positional. Values are `movements.id` (uuid) or JSON `null` for an unresolved key. Verified live: a 2-key row with one resolvable and one junk key produced exactly `{"Power Clean": "<uuid>", "3-3-3-3-3": null}`.

## Explicit ID Propagation

Investigated per mission §36-37: does authoring already deliver a `movement_id` to the member-logging step? **No** — `workout_sections.movements[].canonicalName` (the only structured field that could theoretically carry a resolved identity) is confirmed **0/358 populated** in production (Phase 0's own finding, re-confirmed unchanged this phase), and even if populated it's a display-name string, not a `movements.id`. There is no live pipeline that could deliver an explicit ID to a Result today. `resolve_movement_id` therefore only ever reaches its text-resolution tiers (2-4) in practice — Tier 1 ("explicit ID already known") is structurally impossible to exercise this phase, documented honestly rather than faked.

## Deterministic Resolution

Order exactly as approved: exact canonical name → exact alias → one safe normalization (strip a leading `"N "` numeral prefix) → unresolved, each tier re-tried only after the previous tier finds zero or the previous tier's zero-match falls through (more-than-one match at any tier returns `NULL`, never guesses). Verified live via 13 direct SQL test cases (exact name, case-insensitivity, whitespace, alias, alias case-insensitivity, safe-prefix-strip, typo, unresolved custom text, empty string, null input, and three distinct Snatch-family variants proving no accidental family collapse) — all 13 passed exactly as expected.

## Alias Resolution

Verified live: `"t2b"`/`"T2B"` both resolve to `Toes to Bar`'s real catalog ID, case-insensitively.

## Safe Normalization

Verified live: `"1 Squat clean"` resolves to the real `Squat Clean` catalog row — the exact real production string found in Phase 0's own audit.

## Ambiguous/Unresolved

`"Back Sqaut"` (typo) and `"C15 Sandbag Bear Hug Carry"` (plausible real custom text) both correctly resolve to `NULL` — no fuzzy fallback exists anywhere in the resolver; verified by direct test and by code inspection (no `levenshtein`, `similarity`, `pg_trgm`, or LLM call anywhere in `resolve_movement_id`).

## Gym Scoping

Verified live with a real, cleaned-up test fixture: a gym-scoped custom movement created under one gym resolved correctly for that gym's own `gym_id`, returned `NULL` when resolved against a *different* real gym's `gym_id`, and a global movement continued resolving correctly for the test gym at the same time — proving the WHERE-clause-level scoping (`gym_id IS NULL OR gym_id = p_gym_id`) enforces tenant isolation structurally, not via a separate check that could be forgotten.

## Custom Movements

No automatic custom-movement creation was added anywhere. An unresolved raw string simply stays unresolved (`sets_movement_ids` entry `null`) — logging never creates, suggests creating, or blocks on catalog membership.

## Raw Snapshot Preservation

`sets` itself is never touched by either trigger — confirmed by code inspection (neither trigger function assigns to `NEW.sets`) and live test (the raw `sets` object was byte-identical before and after `sets_movement_ids` resolution in every fixture).

## Historical Stability

Confirmed live: **0 of 367 existing `wod_logs` rows and 0 of 13 existing `skill_logs` rows** have a non-null `sets_movement_ids` after this migration — every historical row is untouched, exactly as this phase's own explicit "no backfill" requirement demands. Resolution only ever happens going forward, on `INSERT` or an `UPDATE` that touches `sets`.

## Result Edit

Two live tests: (1) editing a Strength Sets log's `sets` payload (movement subject changed from `Power Clean`/junk to `Front Squat`) correctly produced a completely fresh `sets_movement_ids` map, while `format_snapshot` stayed frozen at `"Strength Sets"` — proving the snapshot-immutability guarantee (Slice 2's own invariant) was not broken by this addition. (2) an update that touches only `notes` (never `sets`) left `sets_movement_ids` completely unchanged — proving non-movement edits never trigger unnecessary re-resolution.

## Stale Client Safety

Because the trigger recomputes `sets_movement_ids` unconditionally from whatever `sets` currently is (never merges with a client-sent value — the client never sends this field at all, it isn't in any `.insert()`/`.update()`/`.upsert()` payload in the codebase), a stale client that has never heard of this column simply continues writing exactly as before; the server independently and correctly enriches every write, old client or new, without any client-side coordination.

## Legacy Compatibility

No reader anywhere in either repo consumes `sets_movement_ids` yet (confirmed: zero references outside this migration's own SQL). Every existing Movement History, PR Engine, and Performance Overview code path is byte-identical to before this migration — this is true by construction (no application file was modified), not merely re-tested.

## Movement History Boundary

Not migrated, not touched. `movementHistory.js`/`.ts` still compute `comparisonKey` from raw `normalizeKey(movementName)` text exactly as before.

## PR Engine Boundary

Not migrated, not touched. `evaluate_movement_prs` (Phase 5's own trigger) is untouched by this migration — confirmed via `pr_events` row count before/after (5 → 5, unchanged) and via the fact that this migration's own SQL never references `evaluate_movement_prs`, `pr_events`, or any Phase 5 object at all.

## Performance Overview Boundary

Not migrated, not touched. `PerformanceOverviewSection.tsx`/`CurrentBestsSection`/`RecentPrsSection` (Phase 6/6.1) are unmodified.

## Security

`resolve_movement_id` is `SECURITY DEFINER` (consistent with the existing snapshot-trigger family's own precedent, needed since it must read `movements` rows across the `gym_id IS NULL` platform tier regardless of the invoking session's own RLS visibility, exactly as `snapshot_wod_log_context`/`snapshot_skill_log_context` already do for `wods`). No new client-facing grant of any kind — the function is only ever invoked from within the two trigger functions, never called directly by either client. `sets_movement_ids` has no client write path at all: neither trigger ever reads a client-supplied value for this column, so there is no forged-UUID attack surface to defend against (mission §13/§54) — the column is 100% server-authoritative by construction.

## Performance

No N+1: one resolver call per `sets` key, computed via a single `jsonb_object_agg(...) ... FROM jsonb_object_keys(sets)` aggregate query per row, inside a trigger that already fires once per write (no additional round trip, no per-row loop in application code, no catalog re-fetch — the resolver queries `movements` directly per call, `STABLE` so the planner can cache results within one statement).

## Migration

One new file, `20260823090000_canonical_movement_identity_phase1_result_resolution.sql`: 2 `ALTER TABLE ... ADD COLUMN` (nullable, additive), 1 new function (`resolve_movement_id`), 1 new function + 1 new trigger for `wod_logs` (`snapshot_wod_log_movement_ids`/`_trg`, deliberately a *separate* trigger from `snapshot_wod_log_context_trg` — see the migration's own header comment for the exact alphabetical-trigger-ordering reasoning that makes this both correct and safe), and one `CREATE OR REPLACE` of the existing `snapshot_skill_log_context()` (extended in place, since skill_logs' own upsert-based write pattern already re-fires that trigger on every save, unlike wod_logs). Applied directly to production via `supabase db query --linked` (matching this project's own established migration-application precedent — the `supabase migration list` tracking table has been out of sync with actually-applied schema state since well before this phase, confirmed by comparing it against live `information_schema` queries).

## Historical Backfill

None. Explicitly out of scope per this mission's own instruction, and per Phase 0's own finding that only ~4 real rows would even be safely backfillable today — not worth a dedicated pass yet.

## Historical Row Mutation

None. Verified live (see "Historical Stability" above): 0 of 380 total existing Result rows show any change.

## DB Integrity Protection

Discussed in "Security" above — the simplest and strongest protection available: the column has no client write path, period. No separate FK-validation trigger was added on top, since one isn't needed (`resolve_movement_id` itself is the only writer, and it only ever returns a real `movements.id` or `NULL`).

## RLS/Security Impact

None beyond what's discussed above — no RLS policy was added, changed, or removed on any table this phase touches.

## Performance/Query Impact

Negligible — additive nullable columns add no storage cost to existing rows (Postgres stores `NULL` for unset columns cheaply), and the new trigger logic only executes its (indexed-lookup-backed) queries for movement-keyed formats, never for the majority of Result rows (scored/mixed/nft families, round/interval-labeled sets formats).

## New Tests

No new WOD-SIMPLE/forge-admin-web unit tests were added — this phase is exclusively database logic with no client-side surface to unit-test yet (nothing in either client calls or reads the new column). Verification was instead performed via 20+ live, direct SQL test scenarios against production (resolver unit tests, gym-scoping test, and full end-to-end trigger tests on both `wod_logs` and `skill_logs` covering multi-movement, edit, stale-update, and format-exclusion cases) — all created fixtures cleaned up, confirmed zero residual rows.

## WOD-SIMPLE / forge-admin-web Test Counts

WOD-SIMPLE: 854/854 passing (full suite re-run after the migration; 9 pre-existing, unrelated Deno-environment test-file load failures unchanged from every prior phase's own baseline — not a regression). forge-admin-web: not re-run — zero files in that repo were touched this phase, so there is nothing that could have regressed; re-running would have had zero informational value.

## Lint/Typecheck/Build

Not applicable — no application code was changed in either repo.

## Deployment

Migration applied directly to the linked production Supabase project. No client deploy needed or performed (no client code changed).

## Production Scenarios Verified

All performed via direct, live SQL against production, cleaned up after: (A) global exact canonical movement resolution, (B) catalog alias resolution (case-insensitive), (C) unresolved typo and unresolved custom text (both correctly `NULL`, both correctly still-saveable), (D) a real multi-movement Result (resolved + unresolved keys coexisting correctly), (E) a gym-scoped custom movement (resolves for its own gym, not for another), (F) an interval/round-label format (`Intervals`) containing a real movement-looking key (`"Back Squat"`) alongside a round label (`"Rundă 1"`) — confirmed `sets_movement_ids` stays entirely `NULL`, never partially resolves, (G) a stale-client-style update (notes-only, `sets` untouched) — confirmed the existing map is left completely unchanged, not recomputed or erased.

## SQL/UI Parity

Not applicable this phase in the usual sense (no UI reads this data yet) — the "parity" claim this phase makes instead is that resolution is identical regardless of write path, which is true by construction since exactly one function (`resolve_movement_id`), called from exactly two trigger functions, is the only code that ever computes this value.

## Cleanup

All mission-created fixtures removed: 2 test `wod_logs` rows, 2 test `skill_logs` rows, 1 test gym-scoped `movements` row. Verified via SQL: 0 residual rows of any kind remain.

## Known Limitations

- Tier 1 (explicit-ID propagation) is unreachable in practice this phase — no live pipeline delivers an authoring-time `movement_id` to a Result yet (disclosed honestly above, not silently glossed over).
- `resolve_movement_id`'s Tier 3 normalization (leading numeral-prefix strip) is the only safe transformation implemented; the real ambiguous cases found in Phase 0's own audit (`"Build to a 3-rep-max front squats"`, `"1 Deadlift (Schema: ...)"`) remain, correctly, unresolved — no sentence-parsing or partial-substring extraction was added, matching MI-6/mission's explicit "never guess" instruction.
- The two real, live catalog near-duplicate rows found in Phase 0 (`Sots Press`/`Sotts Press`, `Stiff Leg Deadlift`/`Stiff Legged Deadlift`) remain two separate rows — a coach typing either spelling will get two different, valid (non-null) but distinct movement IDs, not a false merge, but also not yet unified. Fixing this requires the merge/redirect mechanism Architecture V1 §10 proposed but explicitly did not build this phase.
- No admin/coach-facing UI surfaces this new data anywhere (by design — this phase is Result-side only, per the mission's own explicit "no Movement History migration yet" scope).

## Readiness for Phase 2

The engine that would consume this data (Movement History grouping preference, per Architecture V1 §6) can now be built with confidence: `sets_movement_ids` has been proven, live, against the exact real adversarial patterns Phase 0's audit found in production (junk keys, pooled skill_logs, gym-scoped custom movements, round-label formats) — not merely against synthetic happy-path data.

## Final Verdict

SHIPPED, live. Zero application code changed. Zero historical data touched. 20+ live production test scenarios passed, including the exact real adversarial patterns discovered in Phase 0's own audit. Movement History, PR Engine, and Performance Overview are provably unchanged (byte-identical code, unchanged `pr_events` count).

---

## Final Response — 51 Items

1. Overall verdict: SHIPPED, live, DB-only.
2. Phase 0 assumptions still held: YES, verified before writing any code.
3. Existing catalog reused: YES, `movements` table, unchanged.
4. Existing resolver reused/extracted: NO existing resolver did this job (the edge-function one operates on a different, hardcoded list for a different purpose) — `resolve_movement_id` is the first DB-backed identity resolver, documented as such, not framed as a false "reuse."
5. Exact Result tables changed: `wod_logs`, `skill_logs`.
6. Exact fields added: `sets_movement_ids jsonb` on both tables.
7. Map vs single column: map — a Result can carry multiple movement-keyed entries, verified live on both tables.
8. wod_logs behavior: resolved per-key, only for `MOVEMENT_KEYED_FORMATS`, via a new dedicated trigger firing on `INSERT OR UPDATE OF "sets"`.
9. skill_logs behavior: Superset = per-key; every other format = pooled under `skill_name_snapshot`, folded into the existing trigger.
10. Explicit-ID behavior: structurally supported (Tier 1) but unreachable in practice — no source delivers one yet.
11. Exact-name behavior: verified live, case-insensitive.
12. Alias behavior: verified live, case-insensitive.
13. Safe-normalization behavior: verified live (leading numeral-prefix strip).
14. Fuzzy matching status: none exists anywhere in the resolver.
15. Typo behavior: unresolved (`NULL`), verified live.
16. Ambiguous behavior: more-than-one match at any tier returns `NULL`, never guesses (implemented, not yet exercised by a real ambiguous case since none exists in current data).
17. Partial-map behavior: verified live (resolved + unresolved keys coexisting in one map).
18. Multi-movement behavior: verified live on both `wod_logs` and `skill_logs`.
19. Interval/round-label behavior: verified live — `sets_movement_ids` stays fully `NULL` even with a real movement-looking key present alongside a round label.
20. Global movement behavior: verified live.
21. Gym custom movement behavior: verified live, with cleanup.
22. Cross-gym protection: verified live — a different gym's custom movement does not resolve.
23. Raw snapshot behavior: untouched, confirmed by code inspection and live test.
24. Catalog rename behavior: unaffected — `movement_id` is a stable UUID, unrelated to this phase's own testing scope but structurally guaranteed by the catalog's own existing design.
25. Alias-change behavior: not applicable this phase (no historical resolution exists yet to freeze/not-freeze against).
26. Non-movement Result behavior: `sets_movement_ids` stays `NULL` for every non-movement-keyed format, verified live.
27. Result edit behavior: verified live — sets-changing edits re-resolve, non-sets edits leave the map untouched.
28. Stale-client behavior: verified live via a notes-only update.
29. Legacy Result behavior: 0/380 existing rows touched, verified live.
30. Movement History behavior: unchanged — zero files modified.
31. PR Engine behavior: unchanged — zero files modified, `pr_events` count unchanged (5 → 5).
32. Performance Overview behavior: unchanged — zero files modified.
33. Schema changes: 2 additive nullable columns.
34. Migration details: 1 new file, applied directly to production.
35. Historical backfill: none.
36. Historical row mutation: none, verified live.
37. DB integrity protection: column has no client write path at all — the strongest available protection.
38. RLS/security impact: none new.
39. Performance/query impact: negligible, no N+1.
40. New tests: 0 unit tests (nothing to unit-test yet); 20+ live production SQL scenarios instead.
41. WOD-SIMPLE full test count: 854/854 passing, unchanged baseline.
42. forge-admin-web full test count: not re-run — zero files touched.
43. Lint/typecheck/build: not applicable, no application code changed.
44. Deployment: DB migration applied directly to production; no client deploy needed.
45. Production scenarios verified: 7 categories (A-G above), all live, all passed.
46. SQL/UI parity: not applicable yet (no UI reads this data); resolution-path identity guaranteed structurally instead.
47. Cleanup: complete, 0 residual rows of any kind.
48. Known limitations: Tier 1 unreachable in practice; 2 real catalog near-duplicates remain unmerged; no UI surfaces this data yet.
49. Report path: `CANONICAL_MOVEMENT_IDENTITY_PHASE1_RESULT_SIDE_RESOLUTION_IMPLEMENTATION_REPORT.md` (WOD-SIMPLE root).
50. Commit hash: see below.
51. Working-tree/origin status: WOD-SIMPLE clean and pushed; forge-admin-web untouched, unchanged from Phase 6.1.

### A. Do new movement-performance Results now carry canonical movement identity when resolvable?
**YES.**

### B. Is raw movement text still preserved as historical display truth?
**YES.**

### C. Can unresolved or ambiguous movement text still save without being guessed?
**YES.**

### D. Can one Result safely carry multiple canonical movement identities?
**YES.**

### E. Are interval/round labels protected from being mistaken for movements?
**YES.**

### F. Are gym-scoped custom movement IDs protected from cross-tenant use?
**YES.**

### G. Can stale clients still save/update Results without erasing existing canonical identity?
**YES.**

### H. Did Movement History, PR Engine, and Performance Overview remain behaviorally unchanged?
**YES.**

### I. Was any historical Result backfilled or reinterpreted?
**NO.**

### J. Is Phase 1 complete and safe to proceed to canonical Movement History grouping?
**YES.**
