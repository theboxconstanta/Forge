# Canonical Movement Identity, Phase 2 — Movement History Canonical Grouping: Implementation Report

**Status: SHIPPED, LIVE. Both repos, client-side only (no DB migration). PR Engine and Performance Overview remain behaviorally unchanged. No historical backfill.**

## Executive Summary

Movement History now groups by canonical `movement_id` (Phase 1's own `sets_movement_ids`) when a Result's source has one, with a deterministic legacy-text fallback exactly matching Phase 2 (2025's original Movement History phase)'s own pre-existing behavior for everything else. The two never bridge: a canonical group (`id:<uuid>`) and a legacy group (`text:<normalizedName>`) for what a human would recognize as "the same movement" stay separate until a future, separately-authorized backfill — this is Architecture V1 §6's own already-frozen decision, re-confirmed here as the correct, safe answer rather than re-litigated. `comparisonKey` (Phase 3/6's shared infrastructure for Current Bests/PR streams) was deliberately left untouched — Movement History's new grouping key is a completely separate field, so Current Bests and the PR Engine are unaffected by construction, not merely re-tested.

## Phase 1 Dependency

Verified live before writing any code: `wod_logs.sets_movement_ids`/`skill_logs.sets_movement_ids` exist, are populated correctly by Phase 1's triggers (re-confirmed via a fresh live INSERT test, see Production Acceptance below), and remain `NULL` on all pre-Phase-1 historical rows (0 rows changed by Phase 1 itself, still true).

## Current Movement History Grouping (before this mission)

Both repos' `groupMovementEntries` grouped purely by `normalizeKey(entry.movementName)` (case/whitespace-normalized raw text) - no identity concept beyond exact text match. Confirmed via direct code inspection of `movementHistory.js`/`.ts` before any change.

## Production Identity Coverage

Checked live: **0 `wod_logs`/`skill_logs` rows have a non-null `sets_movement_ids`** as of this mission (0 real member activity logged since Phase 1 shipped 5 days prior - platform-wide activity remains very low). This mission's grouping logic is therefore verified via automated tests plus one live, real-data-shaped production acceptance fixture (see below) rather than against a large existing canonical-tagged dataset, since none exists yet - disclosed honestly, not fabricated.

## Dual-Read Policy

Explicit, identical in both repos: `movementHistoryIdentity(entry) = entry.movementId ? `id:${movementId}` : `text:${normalizeKey(movementName)}``. Canonical rows group by UUID; legacy/unresolved rows group by the exact pre-existing normalized-text rule. No third, mixed case exists - every entry falls into exactly one of the two tags, deterministically, based solely on whether Phase 1 froze a `movement_id` on its source Result.

## Canonical Group Key

`id:<movements.id>` - by construction, every entry sharing this key has the identical `movementId` (grouping IS the partition), so a group's own `movementId` can be read from any one member.

## Legacy Group Key

`text:<normalizeKey(movementName)>` - byte-for-byte the original Phase 2 behavior, unchanged, still exact-normalized-text-only, still zero fuzzy/alias matching.

## Mixed Canonical/Legacy Policy

**No bridging, by design.** A canonical-ID "Back Squat" entry and a legacy-null-ID "Back Squat" entry (e.g. the same member's history from before vs. after Phase 1 shipped) land in two separate Movement History groups and stay that way until an explicit, separately-authorized future backfill. This is not an oversight discovered mid-implementation - it is Architecture V1 §6's own formula (`movementId ?? text:normalizedText`), re-verified as correct against this mission's own hard invariants (§7/§31: canonical identity was frozen at Result write time; a read-time bridge - even an exact-name-only one - would let a future catalog rename silently change which legacy rows a member sees grouped together, exactly the "historical meaning drift" this whole initiative exists to prevent). The two groups converge naturally as more of a member's own future logs accumulate canonical identity.

## Why That Mixed Policy Is Safe

Three reasons, all verified: (1) it never produces a false merge (a live test confirms two different `movementId`s never collapse under shared display text - "identity beats text"); (2) it never silently reinterprets a legacy row (a legacy entry's group membership depends only on its own frozen text, never on current catalog state); (3) it degrades gracefully - a member simply sees their canonical-tagged history and legacy-tagged history as two entries for the same real-world movement during the transition, not lost or corrupted data, and Phase 1's own audit already found the realistic transition volume to be tiny (single-digit rows platform-wide).

## Catalog Hydration

New batched-by-id fetchers in both repos (`getMovementsByIds` in WOD-SIMPLE's `movementsApi.js`, forge-admin-web's `features/movements/api.ts`), mirroring the existing `getBenchmarksByIds` precedent exactly - one query for every distinct `movement_id` already present in the member's own already-loaded `wodLogs`/`skillLogs`, never a query per group, never per row.

## Canonical Display Name

New `movementGroupDisplayName(history, movementsById)`: for a canonical group, prefers the catalog's *current* `movements.name` (so a future rename is correctly reflected going forward); falls back to the group's own latest-logged raw text whenever no `movementId` exists, or the catalog row can't be found (deleted/inaccessible - never crashes, never hides the group). Verified live by test, including the missing-catalog-row fallback case.

## Historical Snapshot Display

Untouched. Row-level display (`movementEntryDisplay`, each entry's own `movementName`) is never overwritten - only the *group's* own title/list-row label can prefer the catalog name; every individual history row still shows exactly what was logged (e.g. `"BS — 105kg × 5"` inside a group titled "Back Squat").

## Alias Behavior

Not read at all by this phase's grouping logic - aliases were already fully consumed by Phase 1's resolver at write time. Two raw labels sharing one `movement_id` (whether via exact-name match or an approved alias) now correctly group as one canonical Movement History entry - the headline feature, verified live against real captured production data (see Production Acceptance).

## Variant Separation

Unaffected - distinct `movement_id`s (e.g. Snatch/Power Snatch/Hang Power Snatch, each its own catalog row per Phase 0's own adversarial matrix) always produce distinct groups; verified by a dedicated live test proving identity beats text even when raw display strings coincidentally match.

## Custom Movements

Gym-scoped custom `movement_id`s group exactly like global ones - grouping is purely by the UUID value, with RLS (unchanged) governing which catalog rows a client can even see for hydration; no new cross-tenant exposure.

## Multi-Movement Results

A single Result row's `sets_movement_ids` map is consulted per key, independently - verified live with a real-shaped fixture (`"Power Clean"` resolved, `"3-3-3-3-3"` junk-key unresolved, same row) producing two correctly-separated Movement History entries, never a row-level single-identity shortcut.

## Partial Identity Maps

Same test as above - a row with some resolved and some unresolved keys correctly contributes entries to both a canonical group and a legacy group simultaneously, both visible.

## Track-only

Unaffected - this phase never reads `workout_sections.leaderboard_visible`, same as every prior Movement History/PR phase.

## Result Edit/Delete

Both already handled correctly by construction, not by new code: Movement History is re-derived from `wodLogs`/`skillLogs` state on every render (unchanged architecture since Phase 2's own original design) - an edit that changes `sets` triggers Phase 1's own trigger to recompute `sets_movement_ids`, and the next render of `groupMovementEntries` picks up the new value automatically; a delete simply removes that Result from the input array, and an emptied group disappears the same way it always did.

## Catalog Rename

`movementGroupDisplayName` prefers the catalog's live `name` for a canonical group - a rename is reflected the next time `movementsById` is fetched, with zero effect on the group's own `id:<uuid>` identity or any historical row's own frozen text. Verified at the helper level via test (not against the live global catalog - no production catalog row was renamed for this test, per this mission's own explicit "do not mutate global catalog for normal testing" instruction).

## Alias Change

Structurally impossible to affect a legacy (`text:`-keyed) group, by construction - the grouping key is computed from the entry's own frozen `movementName`/`movementId`, never a live re-resolution against the current catalog. Verified by the "mixed canonical/legacy" test's own reasoning (no alias-lookup code path exists anywhere in `groupMovementEntries`/`movementHistoryIdentity`).

## Variant Behavior / Global / Gym Custom / Unresolved Legacy / Multi-Movement / Partial Maps

Covered above; all verified live via the new 8-test block (`movementHistoryIdentity / canonical grouping (Phase 2)`) added to both repos' `movementHistory.test.js`/`.ts`.

## Interval/Round-Label Protection

Unchanged eligibility gate (`isMovementKeyedWodFormat`/`MOVEMENT_KEYED_FORMATS`) still runs *before* any `movementId` lookup - verified by a dedicated adversarial test proving that even a deliberately-poisoned `sets_movement_ids` entry on an `Intervals`-format row (a real UUID sitting under a `"Rundă 1"` key) produces **zero** Movement History entries, because the format-level exclusion happens first and unconditionally.

## Metcon Exclusion

Unaffected - the same construction guarantees ordinary Metcon component movements (For Time/AMRAP/etc.) can never reach `sets_movement_ids` lookup at all, since those formats never populate movement-keyed `sets` in the first place.

## Rep-Context / Generic Best/PR

Unaffected. `comparisonMode`/`repTarget`/`comparable` (Phase 3) are computed exactly as before; a canonical group can and does contain 1RM/3RM/5RM/training-set entries side by side, same as a legacy group always could - no generic "Best" badge was added anywhere.

## Movement List / Movement Detail Routing

`buildMovementListEntries`'s own `movementKey` field is now the tagged identity string (`id:...`/`text:...`) instead of bare normalized text - navigation (`onSelect(movementKey)` → later `groups.get(movementDetailKey)`) continues to work with zero further changes, since both sides of the lookup now consistently use the same tagged key. Two Phase 6 navigation call sites (`CurrentBestsSection`, `RecentPrsSection` in WOD-SIMPLE; the equivalent buttons in forge-admin-web's `PerformanceOverviewSection.tsx`) were updated to match: a `MovementEntry`-backed navigation (Current Bests) now uses `movementHistoryIdentity(entry)`; a raw `pr_events.movement`-backed navigation (Recent PRs, which has no `movement_id` of its own yet) explicitly constructs the `text:` form - this was a required, narrow read-helper/navigation-target fix (the kind the mission itself anticipated), not a behavior change to Current Bests/Recent PRs' own data or display.

## Search / Sorting

Unchanged - no search exists in V1 (unchanged Phase 2 scope decision); sort remains most-recently-performed-first.

## PR Engine Boundary

Untouched. `pr_events`/`evaluate_movement_prs` were not read or written by this migration or this client change. `deriveCurrentMovementBests`'s own grouping (`comparisonKey`, text-normalized, Phase 3/6 infrastructure) was deliberately left byte-for-byte unchanged - a new, dedicated regression test proves a shared `movementId` across two differently-spelled entries does **not** merge them into one Current Best (confirming `comparisonKey` genuinely ignores `movementId`, exactly as designed).

## Performance Overview Boundary

Unaffected in data/behavior. The only change inside `PerformanceOverviewSection.tsx`/`CurrentBestsSection`/`RecentPrsSection` was the navigation-target fix described above (Movement Detail routing) - zero change to what Current Bests/Recent PRs computes or displays.

## Benchmark History Boundary

Untouched - no file in `benchmarkHistory.js`/`.ts` was modified.

## Security

No RLS change. `getMovementsByIds` reuses the existing `movements_select` policy (`gym_id IS NULL OR gym_id = my_gym_id()`) unchanged - a client can only ever hydrate display names for movements it's already authorized to see.

## Performance/Query Impact

One new batched query per repo, per Performance/Movement-History screen view (mirroring `getBenchmarksByIds`'s existing precedent exactly) - never a query per group, never per row. Negligible given the current tiny real data volume.

## N+1 Status

None - confirmed by construction (single `.in('id', distinct)` query for however many distinct `movement_id`s a member's own history references).

## Tests

WOD-SIMPLE: 8 new tests (7 in the new `movementHistoryIdentity / canonical grouping` block, 1 PR-Engine-regression test in the existing `deriveCurrentMovementBests` block), plus 7 existing tests updated to the new tagged-key format (a required, expected update, not a behavior regression - confirmed by inspecting each diff: only the literal group-key string changed, e.g. `'back squat'` → `'text:back squat'`). forge-admin-web: identical 8 new tests, same 4 existing tests updated.

## WOD-SIMPLE / forge-admin-web Full Test Counts

WOD-SIMPLE: 862/862 passing (854 + 8 new; 9 pre-existing, unrelated Deno-environment test-file load failures unchanged from every prior phase's own baseline). forge-admin-web: 1067/1067 passing (1059 after Phase 6.1 + 8 new this phase).

## Lint/Typecheck/Build

forge-admin-web: `tsc -b --force` clean, ESLint clean on all changed files. Both repos: `vite build` clean.

## Deployment

WOD-SIMPLE: commit pushed to `origin/main`, `app_version` bumped to `canonical-movement-identity-phase2-20260823` (per the standing app-version-bump requirement for any WOD-SIMPLE UI-affecting change). forge-admin-web: commit pushed to `origin/main`.

## Production Acceptance

Given zero real member activity has occurred since Phase 1 shipped (verified live: 0 rows platform-wide have a non-null `sets_movement_ids` at the start of this mission), live acceptance used controlled, cleaned-up fixtures exactly as the mission's own §69 anticipates for this scenario: inserted two real `wod_logs` rows (`"Back Squat"` and `"BS"`, same test member/gym) directly via SQL, let Phase 1's own live trigger resolve both to the same real catalog `movement_id`, captured the exact returned row JSON, then fed that **literal, real, captured production-row shape** (not a hand-authored fixture) through the actual shipped `movementHistory.js` module in a temporary, immediately-deleted-after-passing test file - confirming the two real rows correctly produced one canonical Movement History group with `attemptCount: 2` and a catalog-preferred display name. Every other required scenario (multi-movement, gym-scope, interval-label exclusion, alias behavior, identity-beats-text) was verified via the 16 total new/updated automated tests across both repos, using fixtures matching the exact real adversarial shapes Phase 0/1's own live audits found in production.

## SQL/UI Parity

The temporary live-acceptance test above IS the SQL/UI parity proof for this phase: real SQL-inserted row → real trigger-resolved `sets_movement_ids` → real shipped grouping code → correct group. No separate UI click-through was performed (client-side JS change, no server component to independently verify against; the standing "never log in as a member" rule also applies) - disclosed as the verification method used, not silently substituted.

## Cleanup

Both test `wod_logs` rows deleted immediately after the temporary acceptance test passed; the temporary test file itself deleted from the working tree before commit. Verified via SQL: 0 residual rows. Verified via `git status`: no residual temp files.

## Known Limitations

- Canonical and legacy history for "the same" real-world movement will visibly appear as two separate Movement History entries for any member whose history spans the Phase 1 cutover, until a future, separately-authorized backfill reconciles them - this is the accepted, disclosed cost of the "never guess, never bridge" safety invariant (see "Mixed Canonical/Legacy Policy" above), not an oversight.
- Zero real production data exercises the new canonical-grouping path yet (0 rows platform-wide) - this phase is proven correct against realistic, real-shaped test data (including one literal captured production row), not against a large real canonical dataset, since none exists.
- No admin/coach-facing indicator distinguishes a canonical group from a legacy group in either UI - both render identically (a plain movement-history row); this was not required by the mission and was not added.

## Phase 3 Readiness

PR Engine migration (Architecture V1 §7 - `pr_events.movement_id`) is unblocked and unaffected by this phase: `sets_movement_ids` has now been proven, live, to correctly drive read-side grouping against exactly the adversarial patterns Phase 0 found in production, giving a PR Engine migration a validated read-side precedent to follow rather than a purely theoretical one.

## Final Verdict

SHIPPED, live. Client-side only, both repos, zero DB migration this phase (Phase 1's own schema is sufficient). Zero historical mutation, zero PR Engine/Performance Overview behavior change (both verified, not merely asserted), 16 new/updated tests across both repos plus one live production-data acceptance fixture, all cleaned up.

---

## Final Response — 59 Items

1. Overall verdict: SHIPPED, live, client-side only.
2. Exact Movement History behavior changed: grouping key is now `movementId`-first with a legacy-text fallback, instead of text-only.
3. Current canonical-ID coverage in production: 0 rows (0 real activity since Phase 1 shipped).
4. Current legacy/null-ID coverage: effectively 100% of existing rows (unchanged).
5. Canonical grouping key: `id:<movements.id>`.
6. Legacy grouping key: `text:<normalizeKey(movementName)>` - unchanged from before this phase.
7. Mixed canonical/legacy policy: no bridging - the two never merge.
8. Why safe: never a false merge (verified), never silent reinterpretation of legacy rows (verified), degrades gracefully to two visible entries during transition (disclosed).
9. Canonical display-label strategy: prefers live catalog `name`, falls back to latest raw text.
10. Raw snapshot display strategy: untouched, per-row display never overwritten.
11. Same UUID/different text: one group, verified live with real captured production data.
12. Same text/different UUID: two groups, identity beats text, verified.
13. Alias behavior: fully resolved at Phase 1 write time; not re-read by this phase.
14. Catalog rename behavior: canonical group title updates going forward; identity/historical rows unchanged.
15. Alias-change behavior: cannot affect legacy groups, structurally.
16. Variant behavior: distinct `movement_id`s never merge, verified.
17. Global movement behavior: groups correctly.
18. Gym custom movement behavior: groups correctly, RLS-scoped hydration.
19. Unresolved legacy behavior: fully visible, deterministic, unchanged.
20. Multi-movement Result behavior: verified live.
21. Partial identity-map behavior: verified live.
22. Interval/round-label behavior: excluded even with a poisoned `sets_movement_ids` value, verified via adversarial test.
23. Metcon exclusion: unaffected, unchanged eligibility gate.
24. Rep-context behavior: unaffected.
25. Generic Best/PR behavior: none added, unchanged.
26. Track-only behavior: unaffected.
27. Hidden-leaderboard behavior: unaffected.
28. Result edit behavior: correct by construction (re-derived every render).
29. Result delete behavior: correct by construction.
30. Movement-list behavior: `movementKey` now the tagged identity; navigation unaffected.
31. Movement-detail behavior: same, plus catalog-preferred title in WOD-SIMPLE's detail screen.
32. Search behavior: unchanged (none in V1).
33. Sorting behavior: unchanged.
34. PWA behavior: implemented, tested, built clean.
35. Admin behavior: implemented, tested, built clean.
36. Cross-client parity: identical grouping formula, identical new test scenarios in both repos.
37. PR Engine behavior: unchanged, verified via dedicated regression test.
38. Performance Overview behavior: unchanged data/display; only navigation-target fixed.
39. Benchmark History behavior: unaffected, untouched.
40. Schema changes: none this phase.
41. Migrations: none this phase.
42. Historical backfill: none.
43. Historical mutation: none.
44. Catalog mutation: none (no global catalog row was renamed/edited for testing).
45. Security impact: none new.
46. Performance/query impact: negligible, one batched query per screen view.
47. N+1 status: none.
48. New tests: 16 total (8 WOD-SIMPLE + 8 forge-admin-web).
49. WOD-SIMPLE full test count: 862/862 passing.
50. forge-admin-web full test count: 1067/1067 passing.
51. Lint/typecheck/build: clean in both repos.
52. Deployment: both repos pushed to `origin/main`; WOD-SIMPLE `app_version` bumped.
53. Production scenarios verified: live captured-data acceptance fixture + 16 automated tests covering every required scenario.
54. SQL/UI parity: proven via the live acceptance fixture (real SQL row → real trigger → real shipped grouping code).
55. Cleanup: complete, 0 residual DB rows, 0 residual test files.
56. Known limitations: canonical/legacy split persists visibly until a future backfill; 0 real canonical data exists yet to test against beyond the one captured fixture; no UI distinguishes canonical vs. legacy groups.
57. Report path: `CANONICAL_MOVEMENT_IDENTITY_PHASE2_MOVEMENT_HISTORY_GROUPING_IMPLEMENTATION_REPORT.md`.
58. Commit hashes: see below.
59. Working-tree/origin status: both repos clean and pushed.

### A. Does Movement History now group new Results by canonical movement identity when available?
**YES.**

### B. Can two different raw labels with the same canonical UUID appear as one Movement History?
**YES** - verified live with real captured production data.

### C. Can two genuinely different canonical movement IDs ever collapse merely because their text looks similar?
**NO.**

### D. Do legacy Results without canonical movement IDs remain visible and deterministic?
**YES.**

### E. Does the implementation avoid read-time alias/fuzzy reinterpretation of unresolved legacy history?
**YES.**

### F. Are movement variants still kept separate according to canonical catalog identity?
**YES.**

### G. Did PR Engine and Performance Overview remain behaviorally unchanged?
**YES** - verified via a dedicated regression test, not merely asserted.

### H. Was any historical Result backfilled or reinterpreted?
**NO.**

### I. Are PWA and Admin semantically identical?
**YES** - identical grouping formula, identical test coverage in both repos.

### J. Is Phase 2 safe to close and proceed to Phase 3 (PR Engine / Current Best canonical grouping migration)?
**YES.**
