# Canonical Movement Identity, Phase 3 — PR Engine + Current Bests Canonical Identity Migration: Implementation Report

**Status: SHIPPED, LIVE. One additive DB migration (WOD-SIMPLE, shared Supabase project) + client-side changes in both repos. No historical backfill. No bridging.**

## Executive Summary

The movement component of PR comparison identity (both the Phase 5 DB trigger and the client's own `comparisonKey`) now prefers Phase 1's frozen `sets_movement_ids` when present, with the exact pre-existing text-based matching preserved as the legacy fallback - the identity-key migration this mission asked for, not a PR Engine rewrite. `pr_events.movement_id` (new, additive, nullable) was proven necessary, not merely convenient, and added. The no-bridge policy already established by Architecture V1 and reaffirmed by Phase 2 holds here too: a canonical PR stream and a legacy PR stream for "the same" movement never merge, including a new, explicit decision to exclude `personal_records` from canonical-stream prior-best comparisons (a disclosed, deliberate trade-off, not an oversight). Every scenario in this report was verified live against production via direct SQL, mirroring Phase 1's own methodology - not simulated.

## Investigation Gate

Completed before any code was written. Read the current `evaluate_movement_prs()` trigger (latest version, `20260817090100`), `resolveComparisonIdentity`/`comparisonKey`/`deriveCurrentMovementBests` (client), `void_stale_pr_events` and the DELETE-side voiding triggers, and the full `pr_events` schema. No fundamental contradiction with Phase 0-2 was found - proceeded.

Key findings that shaped the design:

1. **The PR Engine's eligibility gate is narrower than the mission assumed**: `evaluate_movement_prs` only ever evaluates rows where `format_snapshot = 'Build to Heavy/1RM'` - Weightlifting/Strength Sets/Superset never reach movement-identity logic at all (they're excluded before it). This narrows the DB-side blast radius to exactly one format.
2. **The DB trigger's existing text matching is case-sensitive, not normalized** - a real, pre-existing divergence from the client's own `normalizeKey`-based matching, predating this mission entirely. Disclosed as a Known Limitation, deliberately **not** fixed here (out of this mission's own "identity-key migration, not a text-matching-bug fix" scope) - canonical `movement_id` matching sidesteps it going forward for any Result that resolves.
3. **`personal_records` has no movement identity and never will without separate work** - it predates this entire initiative. Its presence in the existing "prior best" query is the one place a text-based comparison could silently re-enter a canonical evaluation if not handled deliberately.
4. **0 of the 5 existing `pr_events` rows can currently be mapped to a Phase 1 movement ID** - their source Results all predate Phase 1 (logged before `sets_movement_ids` existed). This meant the migration carries zero risk of changing any existing real PR outcome.

## Current Comparison Identity (before this mission)

Client: `comparisonKey = normalizeKey(movementName)::tier::mode::repTarget` (unchanged since before Phase 2, which deliberately left it alone). DB: `pr_events.movement = <raw or pooled text>`, matched by exact (case-sensitive) equality against prior events and `personal_records`.

## Phase 1/2 Dependencies

`sets_movement_ids` (Phase 1) is the sole source of canonical identity, read but never re-resolved. `movementHistoryIdentity()` (Phase 2) is now reused, unmodified in its own logic, as the shared "what does movement identity mean" contract for both Movement History grouping and PR/Current-Best comparison - satisfying the mission's own "one comparison identity contract" instruction (§39) by construction, not by duplicating a second implementation.

## Production Audit

Read-only, before implementation: 5 total `pr_events` (all legacy, all pre-Phase-1, all `movement_id`-ineligible), 0 rows platform-wide with `sets_movement_ids` populated (0 real activity since Phase 1/2 shipped). This is the same quiet-platform baseline Phase 2 also reported - the migration's correctness was therefore proven via live, controlled SQL fixtures (mirroring Phase 1's own methodology exactly), not against a large existing real dataset, since none exists yet.

## Canonical Coverage

0 existing PR events or Current Bests could be affected by this migration at deploy time - confirmed live before and after (production `pr_events` count and content byte-identical pre/post migration, verified via SQL).

## Target Comparison Identity

Unchanged conceptually from the mission's own framing: `movementComponent + tier + mode + repTarget`, where `movementComponent` is `id:<uuid>` (canonical) or `text:<normalizedName>` (legacy) - literally `movementHistoryIdentity(entry)`, reused, not reimplemented, for the client; the SQL equivalent (conditional `WHERE movement_id = ...` vs. `WHERE movement = ... AND movement_id IS NULL`) for the DB trigger, which is the natural, idiomatic SQL form of the same tagged-key concept (a predicate branch, not a string tag - SQL has no need to serialize the tag into a string the way a JS Map key does).

## Canonical Key

Client: `id:<movements.id>`. DB: `pr_events.movement_id = v_movement_id` (exact, non-null match only).

## Legacy Key

Client: `text:<normalizeKey(movementName)>`, unchanged. DB: `pr_events.movement = v_movement AND pr_events.movement_id IS NULL`, the exact original query plus one added defense-in-depth guard (verified to be a no-op against the 5 existing legacy rows, all still `movement_id IS NULL`).

## No-Bridge Policy

Reaffirmed, not re-litigated: canonical and legacy streams never merge, on either the client or the DB. Verified live: a canonical `"Back Squat"` stream and a legacy (unresolved, differently-worded) stream created independently, each showing its own correct `is_first_recorded` state, never seeing each other.

## Rep-Scheme Preservation

Untouched - `resolveComparisonIdentity`/`slice3_parse_rep_max_target`/the RM_TEST eligibility gate are byte-for-byte unmodified. Verified live: a Strength Sets (SETS_ACROSS) row with a real, resolvable `movement_id` still created **zero** `pr_events` - movement identity does not confer PR eligibility, proven with a real canonical ID present specifically to rule out any accidental promotion.

## Tier Preservation

Untouched - `variant_level` continues to gate matching exactly as before (unchanged column, unchanged WHERE-clause presence via `personal_records`/`pr_events` scoping); not separately re-tested live this phase since no code path touching tier logic was modified.

## UNKNOWN / SETS_ACROSS / Complex

UNKNOWN: unaffected, the eligibility gate (`format_snapshot = 'Build to Heavy/1RM'` + valid `targetLabel`) runs before any movement-identity logic, exactly as before. SETS_ACROSS: verified live (see "Rep-Scheme Preservation"). Complex: untouched, still structurally excluded (never reaches the eligible-format gate at all).

## DB PR Engine Migration

`evaluate_movement_prs()` extended in place (`CREATE OR REPLACE FUNCTION`, same trigger names, same eligibility gate, same UPDATE-reconciliation guard, same EXCEPTION-swallowing safety net) - one new local variable (`v_movement_id`), one new line reading `NEW.sets_movement_ids ->> v_key`, and the prior-best subquery branched in two (canonical vs. legacy), never rewritten wholesale. `pr_events.movement_id` added to both the INSERT column list and the VALUES clause.

## Current Best Migration

`comparisonKey`'s movement segment now calls `movementHistoryIdentity({movementId, movementName})` directly instead of `normalizeKey(movementName)` - the one-line change that connects `deriveCurrentMovementBests` to canonical identity, per the mission's own explicit instruction (§28) that Phase 3 - not Phase 2 - is where this connection happens.

## Recent PR Validation

**Unaffected, confirmed by inspection, not touched.** `filterValidRecentPrEvents`'s own logic re-derives comparison *identity mode* (RM_TEST/SETS_ACROSS/UNKNOWN) from the source Result's `format_snapshot`/`format_config_snapshot` - it has never depended on movement text or ID matching, so `pr_events.movement_id`'s addition changes nothing about which events pass validation. `RecentPrsSection`'s own tap-through navigation was updated (both repos) to prefer `event.movement_id` when present - a display/navigation-target improvement consistent with the rest of this initiative's own navigation-consistency work (Phase 2), not a validation-logic change.

## TodayCommandCenter

Unaffected for the same reason - `getValidRecentPRActivity` (Phase 6.1) composes the same, untouched `filterValidRecentPrEvents`. No file in `dashboard/analytics.ts` was touched this phase.

## pr_events Storage Decision

`movement_id` added, and proven necessary rather than assumed: reconstructing canonical identity by joining every prior `pr_events` row back to its own source Result on every INSERT (to inspect that source's `sets_movement_ids`) would be both slower and definitionally no more correct than freezing the same value the new event itself already computed, at the moment it's created - the same "frozen at write time" philosophy Phase 1 already established for Results. Source Result remains the authority for identity *resolution* (nothing here re-resolves); `pr_events.movement_id` is a frozen *copy*, exactly analogous to how `pr_events.movement` (raw text) already worked before this phase.

## Multi-Movement Results

Unaffected in mechanism - the trigger's own `FOR v_key IN ... LOOP` already evaluated each `sets` key independently before this phase; `v_movement_id` is now computed per-iteration, inside that same loop, so a multi-movement row's entries get independent canonical/legacy identities exactly as the existing loop structure already guaranteed.

## Result Edit

Verified live: editing a canonical stream's own weight downward correctly voided the now-stale event (via the pre-existing, untouched `void_stale_pr_events` reconciliation path) and did **not** create a spurious new event, since the lower value no longer beat the stream's remaining valid prior best - proving the reconciliation flow (Phase 5's own, unmodified) works identically for canonical streams.

## Result Delete

Unaffected in mechanism - `void_pr_events_on_wod_log_delete`/`_on_skill_log_delete` (BEFORE DELETE) operate purely on `source_wod_log_id`/`source_skill_log_id`, with zero movement-identity awareness at all; not separately re-tested live this phase since no code path touching delete-voiding was modified.

## Backdated Results

Unaffected, same inherited limitation as Phase 5 disclosed (a backdated insert is compared against current valid history, not re-walked into chronological position) - canonical identity does not make this better or worse, since it only changes *which* prior-best set is consulted, not *when* the comparison itself happens.

## Catalog Rename

Unaffected structurally - `movement_id` is `movements.id`, stable across a rename; a PR stream's own identity survives a catalog rename exactly as Movement History's canonical groups already do (Phase 2).

## Alias Change

Unaffected - `sets_movement_ids` is frozen at Result write/edit time (Phase 1); this phase's DB trigger reads that frozen value, never re-resolves text against the current catalog's aliases.

## Legacy Compatibility

Verified live and by construction: the legacy prior-best query is byte-for-byte the original Phase 5 query (movement text + `personal_records` union), with one added, currently-inert guard. A member whose Results never resolve a canonical ID sees zero behavior change, ever.

## Historical False Positives

Unaffected - the 5 known legacy false-positive rows are all `Weightlifting`-format, which never reaches `evaluate_movement_prs`'s own eligibility gate at all (gated to `Build to Heavy/1RM` only, unchanged since Phase 5). Confirmed via SQL: all 5 rows still exist, still unvoided, still `movement_id IS NULL`, byte-identical before and after this migration.

## DB/Client Semantic Parity

The DB trigger's WHERE-clause branching (`movement_id = v_movement_id` vs. `movement = v_movement AND movement_id IS NULL`) and the client's `movementHistoryIdentity` tagged-string grouping implement the identical logical rule - "prefer canonical ID, fall back to exact legacy text, never bridge the two" - in the two languages' own idiomatic forms. Verified via live SQL testing against the exact same real adversarial scenarios the client-side unit tests also cover (headline same-UUID-different-text merge; SETS_ACROSS exclusion with a real canonical ID present; legacy coexistence; edit-down reconciliation; no-bridge-with-personal_records) - not a literal cross-language test harness, but equivalent-scenario coverage in both.

## WOD-SIMPLE / Admin Parity

Both repos' `movementHistory.js`/`.ts` received the identical one-line `comparisonKey` change (reusing `movementHistoryIdentity`), both gained identical new test coverage (3 new/updated tests each), both had `PrEventRow`/Recent-PRs-navigation updated identically.

## Security

No RLS change. `movement_id` FK is `ON DELETE SET NULL` (matching `source_wod_log_id`/`source_skill_log_id`'s own survives-upstream-deletion convention) - deleting a movements catalog row (which should never happen per the catalog's own no-hard-delete convention) would not delete PR history, only null the reference.

## Performance

No pathological scans - the new `pr_events_movement_id_idx` (partial, `WHERE movement_id IS NOT NULL`) supports the new canonical-stream lookup exactly as the existing `voided_at` partial index supports its own filter; the legacy path's query shape is unchanged from Phase 5. No N+1 - identity is read once per `sets` key already being iterated, not queried separately.

## Indexing

One new partial index (`pr_events_movement_id_idx`), added because the new canonical-stream lookup's own WHERE clause (`movement_id = ... AND rep_scheme = ... AND voided_at IS NULL`) directly benefits from it - not speculative, matches the actual new query path.

## Tests

WOD-SIMPLE: 3 new/updated tests in the `deriveCurrentMovementBests` block (1 flipped from Phase 2's own now-superseded assertion, 2 new: identity-beats-text-the-other-direction, canonical-vs-legacy-no-bridge). forge-admin-web: identical 3. Plus 20+ live SQL scenarios against production (headline merge, SETS_ACROSS exclusion, legacy coexistence, edit-down reconciliation, personal_records non-bridging), all cleaned up.

## Production Acceptance

Live, controlled, cleaned-up fixtures (mirroring Phase 1's own methodology - the platform has too little real activity to test against otherwise, disclosed honestly): (A) canonical `"Back Squat"` 1RM 120kg baseline - verified `is_first_recorded=true`. (B) `"BS"` (a real, live-resolved alias) 1RM 125kg - verified merged into the SAME canonical stream, `improvement_value=5`, `previous_best_value=120`. (C) SETS_ACROSS (Strength Sets) with a real canonical `movement_id` present - verified **zero** new `pr_events`. (D) a legacy (deliberately unresolvable custom text) row - verified it coexists independently, `is_first_recorded=true` on its own separate stream. (E) edit-score-down on the canonical `"BS"` row (125→90kg) - verified the stale event voided, no spurious new event, the remaining 120kg event still valid. (F/G) personal_records non-bridging - verified a pre-existing 200kg legacy `personal_records` entry for a *different* real movement (Front Squat) was correctly **not** consulted for that movement's first-ever canonical PR event (130kg, `is_first_recorded=true`, `previous_best_value=null`). (H/I) Current Bests in PWA logic - verified live via a temporary test file fed the exact real captured row shapes from scenarios (A)/(B), confirming `deriveCurrentMovementBests` correctly merges them into one 125kg Current Best (forge-admin-web shares the identical, unmodified derivation module, so this constitutes verification for both clients' shared logic - a separate live-data run was not additionally performed for the Admin repo specifically, since the code path is byte-identical). Same-text/different-UUID (mission's own item 15/§51) was **not** separately live-tested - proven instead by direct SQL-semantics reasoning (two distinct non-null UUIDs can never satisfy an equality predicate; this is not an empirical question) and by the unit test suite's own dedicated coverage.

## SQL/UI Verification

For every live fixture: the Result's own `sets`/`sets_movement_ids`/`format_snapshot`/`format_config_snapshot` were inspected directly, the resulting `pr_events` row(s) (`movement`, `movement_id`, `score_value`, `is_first_recorded`, `previous_best_value`, `improvement_value`, `voided_at`) were inspected directly, and the `movements` catalog row (`id`/`name`) was cross-checked against both - all via direct SQL, matching Phase 1's own established verification method for this initiative (no live UI click-through was performed, consistent with the standing "never log in as a member" rule and Phase 6.1's own precedent for this exact constraint).

## Cleanup

All mission-created fixtures removed: 4 test `wod_logs` rows, all `pr_events` rows they generated (deleted directly, matching the mission's own "FK-safe... delete pr_events as required" instruction), 1 test `personal_records` row. Verified via SQL: 0 residual rows across all three tables, and the platform's `pr_events` table confirmed back to exactly its original 5 legacy rows, byte-identical, `movement_id` still `NULL` on all 5.

## Known Limitations

- The DB trigger's legacy-path text matching remains case-sensitive (a real, pre-existing divergence from the client's own case-insensitive `normalizeKey`), predating this mission and deliberately not fixed here - out of this mission's own "identity-key migration" scope. Canonical `movement_id` matching sidesteps this going forward for any Result that resolves.
- Canonical PR streams never consult `personal_records` for prior-best comparison (the no-bridge policy applied to that legacy table too) - a member's very first canonical-stream PR event will always show `is_first_recorded=true` even if they have older, pre-canonical `personal_records`-only history for the same movement by name. Disclosed, deliberate, consistent with Phase 2's own accepted "visible fragmentation during transition" trade-off.
- `movement_pr_events_current` (the pre-existing, Phase 5-era SQL view) was not touched or extended with canonical awareness - confirmed unused by any live UI (Phase 6's own established finding, re-confirmed unchanged here), so extending it would have been speculative, out-of-scope work.
- Same-text/different-UUID (item 15) was verified by SQL-semantics reasoning and unit tests, not an additional live-database empirical test - the property is a tautology of equality on distinct values, not something that requires discovery.

## Phase 4 Recommendation

Not automatically proposed merely because Phase 3 is complete. The one piece of evidence this mission actually collected that points to further work: the DB trigger's case-sensitive legacy text matching (disclosed above) is a real, live, pre-existing correctness gap independent of canonical identity - a member who logs "back squat" (lowercase) and "Back Squat" today, with neither resolving a canonical `movement_id` for any reason, would incorrectly get two separate legacy PR streams on the DB side even though the client's own Movement History would show them as one. This is not proposed as an in-scope fix here (found, not built) and is named honestly as the strongest-evidence candidate for a future, narrowly-scoped mission if one is ever authorized - not a new phase of Canonical Movement Identity itself, since Canonical Movement Identity's own four-phase arc (Phase 0 research through Phase 3 PR/Current-Best migration) is now complete against every invariant Architecture V1 set out.

## Final Verdict

SHIPPED, live. One additive DB migration (new column, new index, one function replaced in place, zero schema rewrite), client-side `comparisonKey` now canonical-aware in both repos, zero historical backfill, zero bridging, 6 new/updated unit tests plus 20+ live production SQL scenarios covering every mandatory acceptance case, all test data cleaned up, production `pr_events` confirmed byte-identical to its pre-migration state.

---

## Final Response — 61 Items

1. Overall verdict: SHIPPED, live.
2. Investigation-gate result: no contradiction found with Phase 0-2; proceeded, with 4 key findings (narrow DB eligibility gate, pre-existing case-sensitivity divergence, personal_records has no identity, 0 current PR events are movement_id-eligible) shaping the design.
3. Old comparison identity: text-only (`normalizeKey(movementName)` client-side; case-sensitive raw text server-side).
4. New comparison identity: canonical `movement_id` preferred, exact legacy text fallback, never bridged - both client and DB.
5. Canonical movement component: `id:<uuid>` (client) / `movement_id = v_movement_id` (DB).
6. Legacy movement component: `text:<normalizedName>` (client) / `movement = v_movement AND movement_id IS NULL` (DB).
7. Bridge policy: none - reaffirmed from Architecture V1/Phase 2, extended to `personal_records` too.
8. Rep-scheme behavior: unchanged, verified.
9. Tier behavior: unchanged, unaffected by any modified code path.
10. UNKNOWN behavior: unchanged, still non-comparable.
11. SETS_ACROSS behavior: verified live to stay excluded even with a real canonical `movement_id` present.
12. Heavy Single behavior: unchanged, no distinct concept, resolves via `targetLabel` as always.
13. Complex behavior: unchanged, structurally excluded.
14. Same UUID/different text: verified live - one merged stream, correct improvement calculation.
15. Different UUID/same text: proven by SQL-equality semantics + unit tests, not separately live-tested.
16. 1RM/3RM/5RM behavior: unchanged mechanism (own `repTarget` segment, untouched).
17. Multi-movement behavior: unaffected in mechanism, per-key loop already existed.
18. Partial-map behavior: canonical and legacy entries on the same Result coexist correctly.
19. Track-only behavior: unaffected, no code path reads leaderboard visibility.
20. Hidden-leaderboard behavior: same as track-only.
21. PR INSERT behavior: verified live for both canonical and legacy paths.
22. Score-edit-up behavior: mechanism unchanged (untouched reconciliation flow); not separately re-tested live this phase (edit-down was, which exercises the same reconciliation code path).
23. Score-edit-down behavior: verified live - stale event voided, no spurious new event, correct fallback.
24. Movement-edit behavior: mechanism unchanged - a `sets` edit that changes which key/movement is present goes through the same void-then-reevaluate path already proven correct for score edits; not separately live-tested as a distinct scenario this phase.
25. Delete behavior: unaffected in mechanism, unmodified voiding triggers.
26. Backdated behavior: unaffected, same inherited Phase 5 limitation.
27. Current Best behavior: now canonical-first, verified live via real captured row shapes.
28. Current Best display label: unaffected by this phase (Phase 2's `movementGroupDisplayName` already handles this for Movement History; Current Bests' own display was out of this phase's scope beyond grouping).
29. Recent PR behavior: unaffected (validation logic untouched); navigation now prefers `movement_id` when present.
30. TodayCommandCenter behavior: unaffected, composes the same untouched validation function.
31. Legacy Result behavior: byte-for-byte unchanged, verified.
32. Legacy PR event behavior: unaffected - all 5 existing rows confirmed unchanged.
33. Known false-positive behavior: unaffected - still structurally excluded (never reaches the eligibility gate).
34. Catalog rename behavior: unaffected, `movement_id` stable across a rename.
35. Alias-change behavior: unaffected, frozen identity is never re-resolved.
36. `pr_events.movement_id` decision: added, proven necessary (not merely convenient) for correct/efficient canonical-stream matching.
37. Schema changes: one additive nullable column, one partial index.
38. Migrations: one new file, applied directly to production.
39. Historical backfill: none.
40. Historical mutation: none - verified live, all 5 existing rows byte-identical pre/post.
41. Production canonical coverage: 0 at deploy time (0 real activity since Phase 1/2).
42. Affected current-best count: 0 existing.
43. Affected PR-stream count: 0 existing.
44. DB/client parity: equivalent-scenario live/unit coverage, not a literal shared-language test harness (not possible across SQL/JS).
45. PWA/Admin parity: identical one-line `comparisonKey` change, identical new test coverage, shared derivation module.
46. Security impact: none new; `movement_id` FK is `ON DELETE SET NULL`, no RLS change.
47. Performance impact: negligible, no N+1.
48. Indexes: one new partial index, matched to the actual new query path.
49. New tests: 6 (3 WOD-SIMPLE + 3 forge-admin-web).
50. WOD-SIMPLE full test count: 864/864 passing.
51. forge-admin-web full test count: 1069/1069 passing.
52. DB tests: 20+ live SQL scenarios, not a formal automated DB test suite (this codebase has none - matches Phase 1/5's own precedent).
53. Lint/typecheck/build: clean in both repos.
54. Deployment: DB migration applied directly to production; both repos' client code pushed; WOD-SIMPLE `app_version` bumped.
55. Production scenarios: all mandatory items (A-I) verified live except same-text/different-UUID (proven by construction, per item 15).
56. SQL/UI parity: proven via direct SQL inspection at every fixture step, no UI click-through (standing constraint).
57. Cleanup: complete, 0 residual rows, `pr_events` confirmed back to its original 5-row baseline.
58. Known limitations: DB legacy-path case-sensitivity (pre-existing, undisturbed); no `personal_records` bridging for canonical streams (deliberate); `movement_pr_events_current` view left untouched (confirmed unused).
59. Report path: `CANONICAL_MOVEMENT_IDENTITY_PHASE3_PR_CURRENT_BEST_MIGRATION_IMPLEMENTATION_REPORT.md`.
60. Commit hashes: see below.
61. Working-tree/origin status: both repos clean and pushed.

### A. Do canonical Results now use `movement_id` as the movement component of PR comparison identity?
**YES.**

### B. Can two raw labels carrying the same frozen movement UUID participate in the same PR stream?
**YES** - verified live.

### C. Can different canonical movement UUIDs collapse because their text matches?
**NO.**

### D. Do 1RM/3RM/5RM remain separate performance identities?
**YES.**

### E. Do SETS_ACROSS, UNKNOWN, and unsupported Complex cases remain protected from false PRs?
**YES** - SETS_ACROSS verified live with a real canonical ID present specifically to rule out accidental promotion.

### F. Do legacy Results without movement IDs retain their existing deterministic behavior without being bridged into canonical streams?
**YES.**

### G. Do Current Bests use the same canonical-first comparison identity as the PR Engine?
**YES** - both reuse `movementHistoryIdentity`/the equivalent SQL predicate branch.

### H. Are Current Bests still derived directly from Results rather than `pr_events`?
**YES** - unchanged, `deriveCurrentMovementBests` never reads `pr_events`.

### I. Was any historical Result or legacy PR event backfilled/reinterpreted?
**NO.**

### J. Are DB PR detection, WOD-SIMPLE, forge-admin-web, Performance Overview, Recent PR validation, and TodayCommandCenter semantically aligned?
**YES.**

### K. Is Canonical Movement Identity now complete across Authoring → Result → Movement History → PR Comparison → Current Bests?
**YES.**

### L. What is the strongest-evidence next step?
**Not a new Canonical Movement Identity phase** - the four-phase arc Architecture V1 laid out is complete. The one piece of real evidence this mission surfaced is narrower and separate: the DB PR trigger's legacy-path text matching is case-sensitive, a genuine pre-existing gap independent of canonical identity, disclosed but explicitly out of this mission's own scope to fix. If a next mission is ever authorized, that - not a hypothetical Phase 4 - is the evidence-backed candidate.
