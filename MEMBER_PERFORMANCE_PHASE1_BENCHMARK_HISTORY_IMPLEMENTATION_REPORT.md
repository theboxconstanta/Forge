# Member Performance, Phase 1 — Benchmark History: Implementation Report

**Status: SHIPPED, LIVE, VERIFIED IN PRODUCTION IN BOTH CLIENTS.**

## Executive Summary

Implements the first UI phase of Member Performance per `MEMBER_PERFORMANCE_DOMAIN_ARCHITECTURE_V1.md`'s own recommendation: Benchmark History, built entirely as read-only UI over the existing Results Phase 2 backend (`wod_logs.benchmark_id`, `benchmarks`/`benchmark_aliases`). No PR-engine changes, no movement-identity changes, no new performance backend, no new tables, no migration — matching every one of the mission's stop conditions. The existing `benchmarkDetail` screen (WOD-SIMPLE), previously a name-matching approximation explicitly labeled as such in its own code comments, is now genuinely `benchmark_id`-driven — one query model, not two, per the mission's own explicit instruction not to build a second one where an identity already exists.

## Architecture Followed

`MEMBER_PERFORMANCE_DOMAIN_ARCHITECTURE_V1.md`'s "Benchmark History" section (V1 scope, no caveats) and "Comparison Identity" section (Benchmark comparability = `benchmark_id` + Scaling Context). Followed exactly, with one refinement discovered during investigation (see "Query Path" below): the architecture doc's own "Data Model" section correctly said no new tables were needed, but did not anticipate that the existing `performance_timeline`/`performance_progression_summary`/`benchmark_progress_summary` SQL views are scoped to `format_snapshot IN ('For Time','AMRAP')` only and use a separate, narrower SQL-side score parser — not the canonical client-side comparator. Using those views directly would have silently limited Benchmark History to 2 of 22 formats. This was resolved by querying `wod_logs` directly (already fully general, confirmed via the `snapshot_wod_log_context` trigger source) and applying the real canonical comparator client-side instead.

## Existing Backend Reused

`wod_logs.benchmark_id` (resolved server-side at logging time, format-agnostic), `benchmarks`/`benchmark_aliases` + `resolve_benchmark_names`, `sortSectionLogs`/`rankResultsForWorkout` (the canonical Results comparator, already proven correct across all 22 formats), `setsDisplayScore`/`isWeightScoredSetsFormat`/`parseTimeResult`/`parseTime` (canonical score extraction), the already-fetched `wodLogs` member state (WOD-SIMPLE) and `fetchWorkoutHistoryForMember` (forge-admin-web) — zero new queries beyond one small `benchmarks` metadata lookup per repo.

## Benchmark Identity

Confirmed live: `snapshot_wod_log_context`'s trigger resolves `benchmark_id` via `resolve_benchmark_names([workout_name])` for every PRIMARY-Section log, regardless of format — the same identity used by Slice 1, unrestricted. Non-primary Section logs always have `benchmark_id: null` (same trigger, explicit), so no Section-family filtering was needed in the new derivation module — it's already implicit in which rows carry a non-null `benchmark_id`.

## Performance Identity

Not used for this phase — Benchmark History is scoped to logs with a resolved `benchmark_id` specifically (the narrower, more precise identity), not the broader Performance Identity signature (which also covers non-benchmark repeated workouts, deliberately out of this phase's "Benchmark History" scope per the mission's own §7 instruction to preserve the distinction in product copy, not conflate them).

## Official vs Custom Repeats

This phase shows every benchmark the member has a resolved `benchmark_id` for — Platform-tier (Girls/Hero/community, 224 seeded) and Gym-tier custom benchmarks alike, since `resolve_benchmark_names` doesn't distinguish them at the resolution level and the mission's own §7 said not to assume "Benchmark History" means official CrossFit benchmarks only.

## Query Path

WOD-SIMPLE: `wodLogs` (already fetched for Jurnal, `select('*', ...)`, includes `benchmark_id`) grouped client-side by `benchmark_id`, one new small `getBenchmarksByIds` lookup for display metadata. forge-admin-web: `fetchWorkoutHistoryForMember` (already existing, capped at `WORKOUT_HISTORY_LIMIT=200`, same production-safe-cap precedent already established for this exact screen), same `getBenchmarksByIds` port. No new indexes required — grouping happens client-side over an already-fetched, already-capped array.

## Result Sources

`wod_logs` only — confirmed `benchmark_id` is never set on `skill_logs` rows (no equivalent trigger logic exists there for benchmark resolution), matching the Current-State Audit's own finding that Benchmark Identity is a primary-Section-only concept.

## Comparator Reuse

100% reused, zero new ranking logic. `deriveBenchmarkTierSummary`'s "Best" is `sortSectionLogs`/`rankResultsForWorkout` applied to the full tier history (using the most-recently-logged entry's frozen format/config snapshot as the comparator's config — a documented, deterministic choice for the rare case a benchmark's structure changed between occurrences). "Improvement direction" (better/worse/same) is derived by re-applying the same comparator to a 2-element array and checking which ranks first, with a genuine-tie override via display-string equality (since the comparator's own tie-break by `logged_at` would otherwise never report "same").

## Variant / Rx Separation

Enforced structurally: `groupLogsByTier` groups by `variant_level` before any comparison happens — a tier's "best" is computed only within that tier's own logs, never across tiers. Verified live: real production data (member's own account) currently has only one tier (RX) logged for "Michael," and the automated test suite covers the multi-tier case explicitly (Adversarial case 7).

## Completion State

Inherited entirely from the existing comparator (`sortSectionLogs`/`rankResultsForWorkout`'s own finished-beats-capped rule, already audited correct) — no new logic. Capped results remain in `history`, are correctly never selected as `best` when a completed result exists.

## Best / Latest / Previous / Improvement

**Best** = canonical top-ranked attempt across the tier's full history. **Latest** = most recent by `logged_at`. **Previous** = the attempt immediately preceding Latest by date (the one deterministic rule this module commits to, per mission §11/§44 — "how did I do this time vs. last time," matching every competitor researched). **Improvement**: direction always shown (better/worse/same); numeric magnitude shown only for TIME (seconds) and `sets`-family (reps/kg) scores, where a scalar delta is unambiguous — deliberately omitted for AMRAP/ROUNDS_REPS scores per the mission's own explicit caution against a fabricated/misleading delta.

## Member UX

New "Benchmarks" section on the existing PR screen (list, sorted by most-recently-performed) opening into the rewritten `benchmarkDetail` screen (Best/Latest/Previous cards, tier selector when more than one tier exists, full chronological history with a ★ marking the actual best and a "Capped" badge where applicable). The old "approximation" disclaimer copy was removed since the screen is now genuinely identity-driven.

## Benchmark List / Detail

See Member UX above — both implemented per mission §21-24, minimal card content (name, attempt count, last-performed date) on the list, full depth on detail only.

## Search / Sort

Sort implemented (most-recently-performed first, per mission §22's own recommended default). Search not implemented this phase — the mission's own §23 scoped it to "if the dataset can become long," and V1's real production data is currently thin; deferred as a low-risk addition for a later phase, not a defect.

## Empty State

Implemented in both clients: a plain, honest message ("No repeated benchmarks yet — they'll show up here as you log them more than once" / RO equivalent) — no fabricated PR promise, matching mission §40.

## One-Attempt State

Verified by test: `previous`/`change` are `null` (not a fabricated 0%), `best === latest`.

## Track-only Results

Included by construction — confirmed by direct design (the derivation module never reads `workout_sections.leaderboard_visible` at any point) and by a dedicated test asserting inclusion with no such field present on the fixture at all.

## History

Full chronological list, newest first, every attempt shown (not just the best), each row displaying its own canonical score via the same score-extraction path used for Best/Latest/Previous (never the older `parseWodLogDetails` helper's "N sets" placeholder — see Known Limitations).

## Edit/Delete

Not independently re-tested live this phase (would require mutating a real production Result, out of a UI-implementation mission's scope). By construction, both clients re-derive Best/Latest/Previous from the raw `wod_logs` data on every fetch — no cached/stale value exists anywhere in this feature, so an edited or deleted Result is reflected correctly the next time the screen loads, with zero reconciliation code needed (this is a direct benefit of the "derive, don't persist" architecture already established).

## Security

No new RLS policy needed or added — reused the existing member-scoped `wod_logs` read (WOD-SIMPLE: own logs only) and existing gym-scoped Admin read (`fetchWorkoutHistoryForMember`, already gym+member filtered) plus `benchmarks`' existing SELECT-only policy.

## Performance

No new indexes added or found necessary — grouping/deriving happens client-side over already-fetched, already-capped (200 rows, Admin) or already-loaded (PWA Jurnal) data. No N+1 query pattern introduced.

## Tests

27 new tests total (15 WOD-SIMPLE `benchmarkHistory.test.js`, 12 forge-admin-web `benchmarkHistory.test.ts`), covering: Rx/tier separation, Adversarial cases 6 (best≠latest), 7 (tier isolation), 8 (capped vs completed), one-attempt, two-attempt, equal-best/tie, TOTAL_REPS family, load/weight family, AMRAP (no fabricated delta), track-only inclusion, and benchmark-list grouping/sorting/fallback-naming. Cross-client-parity fixtures deliberately mirror each other exactly (same inputs, same expected outputs) in both test suites.

## Build/Lint/Type-check

WOD-SIMPLE: full Vitest suite 768/768 passing (9 pre-existing, unrelated Deno edge-function transform failures, confirmed unrelated by `git status` scope). forge-admin-web: `tsc -b --force` clean, full Vitest suite 983/983 passing.

## Migration Status

None. No schema, no migration, no `pr_events`/movement-identity change of any kind.

## Production Deployment

WOD-SIMPLE `50bdd68`, forge-admin-web `2ce44e2`, both pushed to `main`, both auto-deployed via Vercel, confirmed live.

## Production Acceptance

Performed live against real production data (the logged-in admin's own real member row, no synthetic data created): a genuinely tricky real edge case — two logged "Michael" attempts, both truthfully 23:00, but one row has its score in `time_result` and the other (a data-quality artifact predating this phase) has it in `result` with `time_result: null`. Verified: **Best** correctly resolves to the genuinely `time_result`-bearing entry (finished-beats-capped, inherited from the existing comparator, applied honestly even to messy real data), **Latest**/**Previous** correctly resolve by date, **change direction** correctly reports "same" (tie detection via display-string equality, independent of the comparator's own asymmetric treatment) — and this exact result was **byte-for-byte identical** in both WOD-SIMPLE and forge-admin-web, confirming true cross-client parity live, not just in tests.

## SQL/View/UI Parity

Confirmed via the same production check above: the raw `wod_logs` rows (queried directly via `supabase db query --linked`), the derived summary shown in forge-admin-web, and the derived summary shown in WOD-SIMPLE all agree exactly (Best=23:00/30 Jun, Latest=23:00/30 Jun, Previous=23:00/30 Jun, same).

## Cleanup

None required — production acceptance used real, pre-existing data; no test rows were created in this phase.

## Known Limitations

- **`parseWodLogDetails`'s own "N sets" placeholder bug** (WOD-SIMPLE, a different, older display helper used elsewhere e.g. Jurnal) was identified during investigation but deliberately **not fixed** in this phase — it has a wider blast radius than Benchmark History alone and touching it was out of this mission's scope. Benchmark History avoids it entirely by using its own correct score-extraction path (ported from Clasament's own already-correct rendering), so it is not affected by this pre-existing gap.
- Search/filter on the Benchmark List is not implemented this phase (deferred, low risk given current data volume).
- `WORKOUT_HISTORY_LIMIT=200` (forge-admin-web) means an athlete with over 200 logged Results total could have an older benchmark attempt fall outside the fetched window — the same pre-existing, already-disclosed cap this screen's other sections (Workout History, Personal Records) already live with, not a new limitation introduced here.

## Deferred: Movement History

Explicitly out of this phase's scope per the mission's own stop conditions (§32-33). No movement-identity work, no movement-detail UI was added.

## Deferred: PR Hardening

Explicitly out of this phase's scope per the mission's own stop conditions (§31). `pr_events` was not read, written, or referenced anywhere in this feature — Benchmark History derives Best/Latest/Previous entirely from raw `wod_logs`, exactly per the mission's own §30 instruction.

## Readiness for Phase 2

Movement History is the natural next phase per the Architecture V1 doc's own ranking (Benchmark History > PR Overview extension > Movement History) — but its own real gap (rep-scheme not keyed at the data level, movement identity text-only) means Phase 2 will need to either accept a text-scoped, rep-scheme-unfiltered view (matching this phase's own "prove value, defer the harder identity problem" pattern) or invest in closing that gap first. This report recommends the former, mirroring the exact same disciplined scoping this Benchmark History phase itself used.

## Final Response — 50 Items

1. Verdict: SHIPPED, live, verified in both clients.
2. Scope implemented: Benchmark List + Benchmark Detail (Best/Latest/Previous/History/tier separation), both clients.
3. Existing backend/view reused: `wod_logs.benchmark_id`, `benchmarks`, `sortSectionLogs`/`rankResultsForWorkout`, `setsDisplayScore`, `parseTimeResult`/`parseTime`.
4. New schema needed: NO.
5. Migration needed: NO.
6. Benchmark Identity behavior: format-agnostic, primary-Section-only, confirmed via live trigger source read.
7. Performance Identity behavior: not used this phase (deliberately, Benchmark Identity is the narrower, correct tool here).
8. Official benchmark behavior: included.
9. Custom repeat (gym-tier benchmark) behavior: included, no UI distinction added (not required this phase).
10. Member entry point: new "Benchmarks" section on the existing PR screen.
11. Benchmark-list UX: name, attempt count, last-performed date, sorted most-recent-first.
12. Benchmark-detail UX: Best/Latest/Previous cards, tier selector, full history with ★/Capped badges.
13. Best-result behavior: canonical comparator, verified correct even on messy real data.
14. Latest-result behavior: most recent by date.
15. Previous-result behavior: attempt immediately preceding Latest (one deterministic rule).
16. Improvement behavior: direction always shown; magnitude only for TIME/sets-family.
17. Time-score behavior: verified correct (seconds delta).
18. AMRAP behavior: verified correct (direction only, no fabricated delta).
19. Reps behavior: verified correct (TOTAL_REPS family, via setsDisplayScore).
20. TOTAL_REPS behavior: verified correct, reps delta.
21. Load behavior: verified correct, kg delta.
22. Rx/variant separation: enforced structurally, tested.
23. capped-result behavior: inherited from existing comparator, tested.
24. one-attempt behavior: tested, no fake improvement.
25. equal-best behavior: tested AND verified live on real production data (the "Michael" tie).
26. track-only behavior: included by construction, tested.
27. hidden-leaderboard behavior: same mechanism as track-only.
28. edit behavior: no caching anywhere, correct-by-construction on next fetch.
29. delete behavior: same as edit.
30. journal/history interaction: Benchmark History is additive, does not modify Journal.
31. PWA behavior: verified live.
32. Admin behavior: verified live.
33. cross-client parity: verified live, byte-for-byte identical on real data.
34. query/performance behavior: no new queries beyond one small metadata lookup per client; no N+1.
35. security/RLS behavior: no new policy, reused existing member/gym scoping.
36. new test count: 27 (15 + 12).
37. full WOD-SIMPLE test count: 768/768 passing (9 unrelated pre-existing failures).
38. full Admin test count: 983/983 passing.
39. lint/type-check/build: `tsc -b --force` clean; Vitest clean both repos.
40. deployment status: live, both repos, both auto-deployed.
41. production scenarios verified: real "Michael" benchmark, 2 attempts, tie case, both clients.
42. SQL/view/UI parity: confirmed exact match.
43. cleanup: none needed (no test data created).
44. known limitations: `parseWodLogDetails`'s pre-existing "N sets" bug (not fixed, out of scope, does not affect this feature); no search yet; 200-row Admin fetch cap (pre-existing).
45. Movement Identity untouched: confirmed, zero references.
46. PR Engine untouched: confirmed, zero references to `pr_events` or its triggers.
47. `pr_events` untouched: confirmed, not read or written anywhere in this feature.
48. report path: `MEMBER_PERFORMANCE_PHASE1_BENCHMARK_HISTORY_IMPLEMENTATION_REPORT.md` (WOD-SIMPLE root).
49. commit hashes: WOD-SIMPLE `50bdd68`, forge-admin-web `2ce44e2`.
50. working-tree/origin status: both clean, both in sync with `origin/main`.

### A. Is Benchmark History now production-complete for the member?
**YES.**

### B. Does Benchmark History derive from existing authoritative Results/Performance Identity rather than creating a second source of truth?
**YES.**

### C. Are best/latest/previous comparisons deterministic and score-semantic-aware?
**YES.**

### D. Are Rx/variant histories kept safely separate?
**YES.**

### E. Do track-only and hidden-leaderboard Results remain eligible for Benchmark History?
**YES.**

### F. Were Movement Identity and PR Engine deliberately left untouched?
**YES.**

### G. Is Phase 1 safe to close?
**YES.**

### H. What EXACTLY should Phase 2 be?
**Movement History**, scoped honestly to raw movement text (not rep-scheme-filtered, per the still-open rep-scheme-keying gap named in the Architecture V1 doc and Current-State Audit) — the next item in the Architecture doc's own ranked V1 scope, and the only remaining piece of that scope not yet built.
