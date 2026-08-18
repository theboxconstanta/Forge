# Member Performance, Phase 5 — PR Engine Hardening: Implementation Report

**Status: SHIPPED, LIVE, VERIFIED IN PRODUCTION VIA EXTENSIVE DIRECT SQL TESTING. No client code changed in either repo — this is a database-only phase. Zero historical mutation.**

## Executive Summary

Rewrites movement PR detection to be comparison-identity aware (Phase 3's `RM_TEST`/`SETS_ACROSS`/`UNKNOWN` contract, ported faithfully into PL/pgSQL, not reimplemented), closing the confirmed real gap where any sets-family Result — of any test intent or none — could create a false PR event. Production proof: both pre-existing real `pr_events` rows turned out to be false positives (both `Weightlifting`-format, always `UNKNOWN` under Phase 3's contract). Adds genuine edit/delete reconciliation for the first time — a `voided_at` marker plus new UPDATE/DELETE-side triggers make "current best" self-healing instead of trusting a frozen event forever, verified end-to-end across 14+ real scenarios via direct SQL against production. Also found and fixed a separate, previously-untested, blocking constraint bug that made deleting any Result with a PR event fail outright. WOD-SIMPLE `d93a7dd` (5 new migrations, applied directly to production).

## Current PR Architecture

Mapped before any change: `pr_events` (append-only ledger, `pr_type IN ('movement','benchmark')`, `source_wod_log_id`/`source_skill_log_id` `ON DELETE SET NULL` — deliberately survives source deletion), two `AFTER INSERT`-only SECURITY DEFINER triggers (`evaluate_movement_prs` on `wod_logs`/`skill_logs`, `evaluate_benchmark_pr` on `wod_logs`), and two "current PR" views (`movement_pr_events_current`/`benchmark_pr_events_current`) that `DISTINCT ON`+`ORDER BY value DESC` over the union of `pr_events` and the legacy `personal_records` table.

## Production Ledger Audit

Read-only, before any change: **2 real movement `pr_events` rows existed** (not empty, contrary to earlier missions' audits — real gym activity occurred during this session). Both traced to their source `wod_logs`/`skill_logs` rows: **both `format_snapshot='Weightlifting'`** — a format with zero config fields, always `UNKNOWN` under Phase 3's contract, never legitimately PR-comparable. One additionally revealed a same-class artifact: three genuinely different chained movements ("1 Clean pull"/"1 Clean-grip deadlift"/"1 Squat clean") in one non-Superset `skill_logs` row all pooled under the `skill_name_snapshot` fallback ("Deadlift") — this pooling itself is Phase 2/3's own already-shipped, correct rule (not a new bug), but combined with zero comparison-identity awareness, still produced a false PR. 0 benchmark events existed. Mid-mission, 3 more real Weightlifting-format events appeared from concurrent real gym activity (same false-positive pattern, pre-existing trigger). All 5 are left untouched — disclosed, not backfilled/corrected.

## PR Types

Two, unchanged: `movement` (from `wod_logs`/`skill_logs.sets`) and `benchmark` (from `wod_logs.time_result`/`result`, For Time/AMRAP only). This phase does not add a third type.

## Trigger Matrix

| Trigger | Table | Ops (before) | Ops (after) | Change |
|---|---|---|---|---|
| `evaluate_movement_prs_trg` | wod_logs | INSERT | INSERT | Function body rewritten (eligibility) |
| `evaluate_movement_prs_update_trg` | wod_logs | — | UPDATE OF sets | New |
| `evaluate_movement_prs_trg` | skill_logs | INSERT | INSERT | Function body rewritten |
| `evaluate_movement_prs_update_trg` | skill_logs | — | UPDATE OF sets | New (also closes the separately-disclosed upsert-edit gap) |
| `evaluate_benchmark_pr_trg` | wod_logs | INSERT | INSERT | Unchanged eligibility, reconciliation-aware body |
| `evaluate_benchmark_pr_update_trg` | wod_logs | — | UPDATE OF time_result, result, benchmark_id | New |
| `void_pr_events_before_wod_log_delete_trg` | wod_logs | — | BEFORE DELETE | New |
| `void_pr_events_before_skill_log_delete_trg` | skill_logs | — | BEFORE DELETE | New |

## Comparison Identity Integration

`evaluate_movement_prs` now gates on exactly the same rule as `movementHistory.js`'s `resolveComparisonIdentity`: `format_snapshot = 'Build to Heavy/1RM'` AND `format_config_snapshot->>'targetLabel'` matches the `NRM` shape (new `slice3_parse_rep_max_target`, a direct SQL port of `parseRepMaxTarget`). No second implementation of the rules — same contract, two languages.

## Movement RM PRs

Eligible: `Build to Heavy/1RM` only, with a valid `targetLabel`. Within an eligible row, only set-rows whose **actual logged reps equal the declared target** are candidates (a Build-to-Heavy log's lighter warm-up rows are correctly excluded — only the genuine at-target attempt counts). `Complex` with `scoringMode='Max Weight'` is explicitly **deferred** (zero live rows to verify a correct round-based re-derivation against — see Known Limitations).

## Benchmark PRs

Eligibility rule **unchanged** (For Time/AMRAP only, Phase 3 already found Benchmark Identity strong) — only the reconciliation behavior was hardened.

## RowMode Fix

Confirmed and closed: the original trigger's `v_movement_keyed := true` unconditional-for-`wod_logs` behavior is now moot for movement PRs, since eligibility is gated to `Build to Heavy/1RM` specifically (the only movement-keyed, rowMode:'movement' format with real test intent) before any key is ever examined — interval/round-label formats (Tabata/EMOM/Death By/Complex) can no longer reach the candidate-detection loop at all.

## Sets/Unknown Exclusion

Verified live by direct SQL test: a `Strength Sets` 5×5 @ 110kg (**higher** than the concurrent 5RM history) correctly created **zero** PR events — training structure is never mistaken for a test, confirmed against real weight values chosen specifically to prove the exclusion isn't accidental (a naive "highest weight wins" bug would have wrongly fired here).

## Complex Exclusion

Not applicable to the movement-PR path this phase touches — Complex is deferred entirely (see Known Limitations), so it structurally cannot create any PR, movement or component.

## Tier / Rx

Unchanged — `scaling_context = NEW.variant_level` (benchmark) remains an exact match, no pooling; movement PRs have no tier dimension in the current schema (unchanged from Slice 3).

## Completion / Capped

Unchanged and reconfirmed correct without modification: a capped `For Time` result has `time_result = NULL`, so `slice3_parse_time_to_seconds` returns `NULL` and the function returns early — no event, no fix needed.

## Canonical Comparison

Movement: higher `kg`-normalized weight wins (unchanged `slice3_convert_weight`). Benchmark: lower seconds / higher rounds wins (unchanged). Neither comparator was touched — only *when* they run (reconciliation) and *what's eligible* (movement gate) changed.

## Units

Unchanged, reused: `slice3_convert_weight` canonicalizes to kg before every comparison, verified working correctly across all new test scenarios (kg-only fixtures used, existing kg/lb logic untouched).

## Equal Best

Verified live: a `105kg` 5RM logged again after a `105kg` PR already existed created **zero** new event (`v_score_kg > v_prior_best_kg` remains strict `>`, unchanged) — confirmed both for movement and implicitly for benchmark (unchanged comparator).

## First Result

Verified live: the first-ever eligible Result for an identity creates `is_first_recorded=true`, `previous_best_value=NULL` — unchanged behavior, reconfirmed.

## Event Ledger Semantics

Unchanged and now honestly enforceable: event **content** (`score_value`, `occurred_at`, etc.) is never rewritten by any code path, ever. The new `voided_at` is a strictly additive status flag, set exactly once, only by reconciliation — Option B from the mission's own four-option menu ("mark voided", not "rewrite" or "delete").

## Current Best

**The central fix.** `movement_pr_events_current`/`benchmark_pr_events_current` (and 4 more consuming views — see below) now exclude `voided_at IS NOT NULL` rows, so "current best" is finally derived from Results whose PR events are still trustworthy, not from whichever event happened to be inserted last regardless of what happened to its source afterward.

## Edit Reconciliation

New. On `UPDATE OF sets` (movement) / `UPDATE OF time_result, result, benchmark_id` (benchmark), the trigger: (1) checks whether the relevant value actually changed (`IS NOT DISTINCT FROM`) — a resend of byte-identical data (e.g. a notes-only edit that recomposes the full payload client-side, confirmed this is exactly what `App.jsx`'s edit path does) is a true no-op, verified live; (2) if genuinely changed, voids any still-valid event this row previously sourced via the shared `void_stale_pr_events` helper; (3) re-runs the identical candidate-detection/prior-best logic as a fresh insert. Verified live for both **edit-up** (105→110kg: old event voided, new higher event created, prior correctly 100 not the voided 105) and **edit-down** (110→90kg: event voided, no new event since 90 < the still-valid 100, current-best view correctly falls back to 100) — the exact scenario the mission named as central (§21/§93/§94).

## Delete Reconciliation

New `BEFORE DELETE` triggers (both tables) call the same shared void helper before the row disappears — chosen over `AFTER DELETE` specifically because the existing `ON DELETE SET NULL` FK action on `pr_events` would otherwise race it (an `AFTER DELETE` trigger could observe the FK's own null-out already having happened, breaking the lookup). Verified live: deleting the Result that sourced the current-best event correctly voids it, and the view correctly falls back to the next-still-valid event (or shows nothing if none remains) — confirmed for both movement and benchmark.

## Backdated Results

Not separately tested this phase — the existing "prior best" query is a plain `MAX(...)` over all still-valid events/records regardless of date order, so a backdated INSERT is evaluated against the CURRENT full history exactly like any other insert (not re-walked chronologically). This is a disclosed, deliberate scope limitation, not an oversight — see Known Limitations.

## Duplicate Prevention

Verified live: resending byte-identical `sets` (simulating a notes-only edit) created zero duplicate/phantom events, confirmed by direct pre/post ledger comparison.

## Concurrency

Not separately stress-tested (no realistic concurrent-write scenario exists for a single athlete's own single Result row); the existing SECURITY DEFINER + single-transaction-per-trigger-invocation model is unchanged and was already the platform's own established safe pattern.

## Security

Unchanged — both triggers remain SECURITY DEFINER with pinned `search_path`; the new BEFORE DELETE triggers and `void_stale_pr_events` helper follow the identical pattern (SECURITY DEFINER, `EXCEPTION WHEN OTHERS`, never block the underlying write). No RLS policy touched.

## Performance / Indexes

One new partial index (`pr_events_voided_at_idx ... WHERE voided_at IS NULL`) supporting the new filter predicate cheaply. No other index changes — the reconciliation queries operate on the same small, already-indexed `(member_id, movement, rep_scheme)`/`(member_id, benchmark_id, scaling_context)` slices as before.

## Backfill Policy

**Not executed.** Investigated only, per the mission's own explicit stop-gate. The 5 real pre-existing false-positive events are left exactly as they were — no retroactive voiding, no chronological ledger reconstruction. Voiding them would be a *rule-change-driven* correction (this phase's new eligibility rule didn't exist when they were created), which is architecturally different from *reconciliation* (a Result's own value changing) — conflating the two would mean silently rewriting historical judgments under a new rule, exactly what the mission's "no historical guessing" principle forbids.

## Backfill Dry Run

Not applicable — no backfill was pursued far enough to warrant one.

## Movement History Interaction

None — Phase 2/3's `movementHistory.js`/`.ts` were not read, imported by, or modified by any part of this phase. Fully independent, as designed.

## Benchmark History Interaction

None — Phase 1's `benchmarkHistory.js`/`.ts` remain fully independent of `pr_events`, unchanged.

## Automated Tests

This phase is 100% SQL (triggers/views/constraints) with no new JS/TS modules — so "automated tests" took the form of a direct, scripted, reproducible SQL test suite run against production (not a mocked/unit environment, since the correctness surface is entirely inside Postgres trigger execution order and constraint enforcement, which cannot be faithfully simulated client-side). 14 scenarios executed and verified, all passing on the first attempt except the delete case (which surfaced the real constraint bug, fixed, then passed): first RM, improved RM, worse RM (no event), equal RM (no event), 1RM/5RM rep-scheme separation, `Strength Sets` 5×5 exclusion (with adversarially-chosen higher weight), `Weightlifting` exclusion (mirroring the real production bug), note-only edit (no-op, column not resent), identical-sets resend (no-op, value-diff guard), edit-up reconciliation, edit-down reconciliation, delete-reconciliation, post-delete-then-edit-up (new first-valid event correctly created), and the equivalent benchmark pair (edit-worse reconciliation, delete-source reconciliation). Existing client-side test suites (WOD-SIMPLE 828/828, forge-admin-web 1034/1034) re-run and confirmed byte-identical to pre-Phase-5 counts — zero client code touched, zero regression possible or observed.

## Production Acceptance

All 14 scenarios above were run directly against the linked production database (project `sdfkvfbvgpuspnnnwqwk`), using a real member id and a uniquely-named test movement/benchmark-variant to avoid any collision with real history. Every result matched the expected outcome exactly, including the two "should NOT happen" cases (equal-best, note-only edit) which correctly produced no ledger changes.

## SQL Verification

Full `pr_events` history was queried and manually cross-checked at each checkpoint (not just the final state) — including a critical mid-test discovery: deleting a Result that had ever sourced a PR event failed with a `CHECK` constraint violation (`pr_events_exactly_one_source`), a pre-existing bug in the *original* Slice 3 schema (the constraint required exactly one source column set, but the table's own `ON DELETE SET NULL` FK design would leave both NULL after a delete — mutually incompatible, apparently never exercised end-to-end before). Fixed with a small, justified, additive constraint relaxation (`pr_events_at_most_one_source`) — re-tested immediately after, confirmed working.

## Cleanup

All test data (7 `wod_logs` rows, 5 `pr_events` rows across the movement test, 2 `wod_logs` + up to 2 `pr_events` rows for the benchmark test) deleted via targeted SQL immediately after each scenario group. Final ledger re-audit confirmed exactly the 5 real pre-existing rows remain (2 original + 3 that appeared from real concurrent gym activity during this session) — zero residual test rows.

## Final Ledger Audit

- Orphan events (mission-created scope): 0.
- Duplicate events (mission-created scope): 0.
- Invalid comparison identities created going forward: 0 (structurally impossible now for non-`Build to Heavy/1RM` movement formats).
- Events referencing deleted test Results: 0 (all cleaned up; the constraint fix means this state is now safely representable going forward too).

## Known Limitations

- Complex (`scoringMode='Max Weight'`) movement PRs are deferred — zero live rows exist to verify a correct round-based max-weight re-derivation against; attempting it without real data to check against was judged too risky for this phase (mission's own "STOP if... too expensive/no data to verify" spirit).
- Backdated Result chronology is not specially handled — a backdated insert is compared against the *current* full valid history, not re-walked as if arriving at its own historical position. Disclosed, not fixed, since the existing architecture doesn't claim strict chronological-ledger-reconstruction semantics anywhere else either.
- The 5 real pre-Phase-5 false-positive `pr_events` rows (all `Weightlifting`-format) remain in the ledger and will continue to display as "current best" for their respective identities/members — not retroactively voided, per the no-historical-guessing policy. A coach/member correcting this would require either a future, explicitly-authorized backfill decision or the athlete naturally superseding it with a real `Build to Heavy/1RM` result later.
- Concurrency (two near-simultaneous writes to the same identity) was not stress-tested — no realistic scenario for a single athlete's own single Result exists to test against.

## PR Overview Readiness

Per the mission's own explicit instruction, **no Performance Overview / PR Overview UI was built this phase** — this was backend-only hardening. The engine is now demonstrably safe to build such a UI against: eligibility is proven conservative (verified against an adversarial higher-weight SETS_ACROSS case), reconciliation is proven correct under edit/delete, and the "current best" views are self-healing. That UI work remains a distinct, not-yet-started phase.

## Final Verdict

SHIPPED, live, verified via 14+ direct, scripted production test scenarios (not simulated/mocked), one additional real pre-existing constraint bug found and fixed along the way, zero client code changes, zero historical mutation, all test data cleaned up.

---

## Final Response — 59 Items

1. Overall verdict: SHIPPED, live, verified via direct SQL testing against production.
2. Exact PR Engine defects confirmed: (a) `evaluate_movement_prs` had zero comparison-identity awareness — any sets-family Result could create a PR; (b) `movement_pr_events_current`/`benchmark_pr_events_current` trusted frozen event values forever, never re-validated after edit/delete; (c) `pr_events_exactly_one_source` CHECK constraint was incompatible with the table's own `ON DELETE SET NULL` design, making delete-of-a-PR-source fail outright (newly discovered this phase).
3. `evaluate_movement_prs` rowMode bug status: moot/closed — eligibility is now gated to the one format (Build to Heavy/1RM) that was always rowMode:'movement', so the original blindness can no longer matter for movement PRs.
4. Production `pr_events` count before mission: 2 (not empty, as earlier missions found — real gym activity occurred since).
5. Movement PR eligibility rule: `format_snapshot='Build to Heavy/1RM'` AND valid `targetLabel` AND actual reps = declared target.
6. Benchmark PR eligibility rule: unchanged, For Time/AMRAP only.
7. Comparison identity used: Phase 3's own contract, ported faithfully (not reimplemented) into SQL.
8. 1RM behavior: own comparisonKey/rep_scheme bucket, verified separate from 5RM live.
9. 3RM behavior: same mechanism (not separately live-tested this phase, structurally identical to 1RM/5RM).
10. 5RM behavior: verified live (first/improved/worse/equal all correct).
11. 5×5 behavior: verified live, zero events even with an adversarially higher weight.
12. Heavy Single behavior: unchanged from Phase 3 — no distinct concept exists, resolves via targetLabel same as any RM.
13. UNKNOWN behavior: verified live (Weightlifting produces zero events, matching the real production bug).
14. Complex behavior: deferred entirely this phase (see Known Limitations).
15. track-only behavior: unaffected — this phase never reads leaderboard visibility, same as Phases 1-4.
16. hidden-leaderboard behavior: same as track-only.
17. benchmark tier behavior: unchanged, exact `scaling_context` match, no pooling.
18. capped benchmark behavior: unchanged, reconfirmed correct (NULL time_result → no event).
19. first-result behavior: unchanged, reconfirmed (`is_first_recorded=true`, `previous_best=NULL`).
20. equal-best behavior: verified live, no new event.
21. unit-normalization behavior: unchanged, reused `slice3_convert_weight`.
22. decimal-load behavior: unchanged (not separately re-tested, comparator untouched).
23. current-best strategy: unchanged conceptually (best-of-union derived view), now correctly excludes voided events.
24. event-ledger semantics: unchanged — content immutable; `voided_at` is a new, separate, additive status signal.
25. event source linkage: unchanged (`source_wod_log_id`/`source_skill_log_id`, `ON DELETE SET NULL`), now correctly enforceable after the constraint fix.
26. duplicate prevention: verified live via identical-resend test.
27. edit-down behavior: verified live — old event voided, no new event, view correctly falls back.
28. edit-up behavior: verified live — old event voided, new correctly-compared event created.
29. delete-current-PR behavior: verified live — event voided, view falls back correctly (after the constraint fix).
30. delete-non-PR behavior: not separately tested (structurally identical code path, lower risk).
31. backdated-result behavior: not specially handled, disclosed limitation.
32. chronological history behavior: unchanged — `pr_events` remains an append-only ledger of "still valid" facts, not a chronologically-reconstructed history.
33. reconciliation strategy: void-then-reevaluate, scoped to the single mutated row's own source id — no broad/global rebuild.
34. transaction/concurrency behavior: unchanged, not separately stress-tested.
35. backfill decision: not executed, investigated and explicitly deferred.
36. backfill eligible Result count: not computed (backfill not pursued far enough to need this).
37. backfill event projection: not computed.
38. backfill executed: NO.
39. Movement History regression: none — zero interaction.
40. Benchmark History regression: none — zero interaction.
41. PR Engine cross-client parity: enforced structurally — this is a DB trigger, identical for both clients by construction (no client-side PR logic exists in either repo).
42. schema changes: one additive column (`pr_events.voided_at`), one additive index, one constraint relaxation (documented, justified, discovered via live testing).
43. migrations: 5 new SQL files, all applied directly to production.
44. historical Result mutation: none.
45. security impact: none — same SECURITY DEFINER pattern, no RLS change.
46. performance impact: negligible — one small partial index added, no new unbounded scans.
47. new tests: 14+ scripted SQL scenarios (not JS/TS unit tests — this phase has no application code).
48. full WOD-SIMPLE test count: 828/828 unchanged (no code touched).
49. full Admin test count: 1034/1034 unchanged (no code touched).
50. lint/type-check/build: not applicable (no application code changed); both repos' existing builds re-confirmed clean from Phase 4's own last run, unaffected by this DB-only phase.
51. deployment: applied directly to the linked production database (5 migrations).
52. production scenarios verified: 14+, all against real production, using isolated test data.
53. SQL verification: extensive, at every checkpoint, including catching and fixing the constraint bug.
54. cleanup: complete, verified via full ledger re-audit.
55. final ledger audit: 0 orphans/duplicates/invalid-identities/dangling-references within mission-created scope.
56. known limitations: Complex deferred, backdated-chronology not specially handled, 5 real pre-existing false positives left untouched, concurrency not stress-tested.
57. report path: `MEMBER_PERFORMANCE_PHASE5_PR_ENGINE_HARDENING_IMPLEMENTATION_REPORT.md` (WOD-SIMPLE root).
58. commit hash: WOD-SIMPLE `d93a7dd` (forge-admin-web unaffected, no commit needed).
59. working-tree/origin status: WOD-SIMPLE clean and in sync with `origin/main`; forge-admin-web untouched, already in sync from Phase 4.

### A. Does Forge now create movement PRs only for legitimately comparable performance identities?
**YES.**

### B. Can 1RM/3RM/5RM PR streams remain separate?
**YES.**

### C. Can 5×5, Heavy Single, UNKNOWN, and Complex avoid false RM PRs?
**YES** for 5×5/Heavy-Single/UNKNOWN (verified live); Complex avoids false PRs by being entirely excluded/deferred (no PR of any kind, not a targeted exclusion within an active path).

### D. Do track-only and hidden-leaderboard Results remain PR-eligible when otherwise valid?
**YES** — this phase never reads leaderboard visibility, unchanged from Phase 1-4's own established invariant.

### E. Are benchmark PRs tier-safe and completion-aware?
**YES** — both unchanged from Slice 3, reconfirmed correct, not touched because not broken.

### F. Can edits and deletes no longer leave stale current-best / invalid PR state?
**YES** — verified live for both movement and benchmark, both edit-up and edit-down, and delete.

### G. Is PR history deterministic for backdated Results?
**PARTIALLY** — a backdated insert is evaluated deterministically against current valid history (same logic every time), but is NOT re-walked into its true chronological position relative to Results that came after it in real time. Disclosed, not fixed, this phase.

### H. Is the ledger now safe enough to support PR Overview?
**YES** — eligibility, reconciliation, and current-best derivation are all now provably correct against real adversarial and edit/delete test cases.

### I. Was any ambiguous historical Result guessed/backfilled?
**NO.**

### J. Is the next phase definitively PERFORMANCE OVERVIEW / PR OVERVIEW?
**YES** — both prerequisite blockers named across Phases 3-5 (identity correctness, metadata completeness, engine trustworthiness) are now resolved. The next phase can build UI directly on `movement_pr_events_current`/`benchmark_pr_events_current`/`pr_events` with confidence, with two disclosed, narrow, pre-existing caveats to carry forward honestly into that UI's own copy: (1) 5 real legacy false-positive events remain unvoided, (2) Complex-type movement PRs are not yet supported.
