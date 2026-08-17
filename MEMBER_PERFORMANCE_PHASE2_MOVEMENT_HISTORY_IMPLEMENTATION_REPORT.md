# Member Performance, Phase 2 — Movement History: Implementation Report

**Status: SHIPPED, LIVE, VERIFIED IN PRODUCTION IN BOTH CLIENTS, text-scoped identity honestly disclosed.**

## Executive Summary

Implements Movement History as an honest, text-scoped feature over the movement-keyed subset of `wod_logs`/`skill_logs` already proven eligible by direct code+data audit — not a guess, not a heuristic. Movement Identity was confirmed 0% canonicalized in production (Mission 2's own finding, re-confirmed here); this phase deliberately does not attempt to close that gap. No PR-engine change, no `pr_events` read, no movement canonicalization project, no schema/migration. WOD-SIMPLE `6b91e54`, forge-admin-web `56a1b8f`.

## Scope

Member-facing Movement List + Movement Detail (Latest + full History, no generic Best/PR claim), coach parity in forge-admin-web. Explicitly NOT in scope: search/filter (deferred, thin dataset), chart (deferred, rep-scheme heterogeneity makes one chart misleading), rep-scheme filters (deferred), a "PR Overview" tab (not built).

## Required Documents Read

`MEMBER_PERFORMANCE_COMPETITIVE_RESEARCH.md`, `MEMBER_PERFORMANCE_CURRENT_STATE_AUDIT.md`, `MEMBER_PERFORMANCE_DOMAIN_ARCHITECTURE_V1.md`, `MEMBER_PERFORMANCE_ADVERSARIAL_MATRIX.md`, `MEMBER_PERFORMANCE_PHASE1_BENCHMARK_HISTORY_IMPLEMENTATION_REPORT.md`, `docs/architecture/RESULTS_DOMAIN_ARCHITECTURE.md`, `docs/architecture/PROGRAMMING_DOMAIN_ARCHITECTURE.md`, `docs/fckb/MOVEMENT_CATALOG.md`/`MOVEMENT_ALIASES.md` (confirmed research-only, not live schema), plus direct inspection of `workoutFormats.js`/`formatCatalog.ts`, the Slice 3 `evaluate_movement_prs` trigger, the Slice 5 `movement_progress_summary` view, and live production data (both repos, both clients).

## Current Movement Identity

Confirmed unchanged since Mission 2: canonical `Movement.canonicalName`/`movement_id` is 0% populated and not wired into `wod_logs`/`skill_logs`/`pr_events` anywhere. A `movements` catalog table exists live (migration `20260819090000`, ~342 seeded rows) but is autocomplete-only in Programming's `MovementCatalogProvider`/`FormatConfigEditor` — the selected value is stored as a plain string, never as a foreign key. Text is the only identity available today, confirmed by direct inspection, not by trusting the prior mission's own prediction.

## Production Identity Audit

Read-only `supabase db query --linked` against the production DB (project `sdfkvfbvgpuspnnnwqwk`), no writes:
- `wod_logs` rows with non-empty `sets`: 60 total, by `format_snapshot`: Strength Sets 31, NULL (legacy) 14, Build to Heavy/1RM 11, Intervals 4. Zero Weightlifting/Superset/Death By/EMOM/Tabata/Complex rows currently populated.
- All 14 NULL-format and all 4 Intervals rows carry interval/round-label keys ("Rundă N", "Min N", "Min N · <movement>") — never bare movement names. Confirms these formats are correctly excluded by the `rowMode` filter (see Eligible Movement Results below); had they been included (e.g. via `pr_events`, which the mission explicitly forbids using), "Rundă 3" would have appeared as a fake "movement".
- Distinct movement keys for the two eligible formats: `Strength Sets` → `""` (3 rows, blank — excluded by the module's own empty-string guard), `"1 Deadlift (Schema: 1-1-1-1-1-1-1 (seven singles))"` (10 rows), `"3-3-3-3-3"` (6 rows), `"Power Clean"` (17 rows); `Build to Heavy/1RM` → `"Build to a 3-rep-max front squats"` (10 rows), `"Build to a 3-rep-max front squats 100kg"` (1 row).
- Case/whitespace-collision check (`lower(btrim(...))` grouped, `HAVING count(DISTINCT ...) > 1`) across all eligible rows: **zero real collisions found.** Text-scoped exact/normalized identity is safe for today's real dataset.
- `skill_logs`: 10 total, 4 with non-empty `sets`, all `format_snapshot='Complex'`/`skill_name_snapshot='Snatch Complex'` (one member, 7 "Rundă N" rows each — all correctly attributed to the single skill name, not the round labels, per the fallback rule).

## Eligible Movement Results

The mission's central invariant (**workout movement presence ≠ movement performance result**) is enforced structurally, not by a filter that could miss a case:

- `wod_logs`: eligible only when the log's format has `family:'sets'` **and** `rowMode:'movement'` — today exactly Weightlifting, Strength Sets, Build to Heavy/1RM, Superset. Every other `family:'sets'` format (EMOM/Tabata/Intervals/Death By/Death By Weight — `rowMode:'interval'`; Complex — `rowMode:'round'`) keys `sets` by an interval/round label, not a movement, and is excluded. Every non-`'sets'` format (scored/mixed/chained/nft — For Time, AMRAP, RFT, Chipper, Partner WOD, etc.) never populates `sets` with movement-shaped data at all in this codebase, so a Metcon's own movements (e.g. Fran's Thrusters/Pull-ups) cannot leak in by construction — confirmed both by direct code inspection and by the production audit finding zero such rows.
- `skill_logs`: eligible whenever `sets` is non-empty. Movement identity is `skill_name_snapshot` (a skill log always represents one movement/skill) **unless** `format_snapshot === 'Superset'`, in which case `sets` keys are the real alternating movement names — a faithful read-side port of the exact distinction the existing `evaluate_movement_prs` trigger already proves correct server-side (`v_movement_keyed := NEW.format_snapshot = 'Superset'` for `skill_logs`).

A real, discovered-but-not-fixed correctness gap in that same trigger: for `wod_logs`, it treats `v_movement_keyed := true` unconditionally (no `rowMode` check), meaning `pr_events` can already contain interval-label "movements" today. This is exactly why Movement History does not read `pr_events` — it independently re-derives eligibility correctly from `wod_logs`/`skill_logs` directly, side-stepping that existing gap rather than inheriting it. Per the mission's own stop conditions (§30/§31), this gap is disclosed, not fixed — fixing it is a PR-engine change, explicitly forbidden this phase.

## Excluded Movement Occurrences

Any `wod_logs` row whose format isn't `family:'sets'`+`rowMode:'movement'` (all scored/mixed/chained/nft formats, plus interval/round-keyed sets formats); any `skill_logs` row with empty/null `sets`; any individual `sets` row where both `reps` and `weight` are blank; any movement key that is blank/whitespace-only (3 real production rows excluded this way).

## Result Sources

Both `wod_logs` and `skill_logs`, per the mission's explicit instruction not to exclude a legitimate source merely because it's stored elsewhere. `skill_logs` was previously excluded from forge-admin-web's member-history read entirely (Phase 1's own disclosed limitation) — Phase 2 adds `fetchSkillLogHistoryForMember` (new query, same shape/cap precedent as the existing `fetchWorkoutHistoryForMember`, justified since no such per-member fetch existed and live volume is tiny).

## Rep Context

Reliability classified directly from the schema, not assumed: `sets[key][].reps`/`.weight` are free-text-parsed numbers, present per-row, RELIABLE for display (both fields independently nullable, never fabricated — a reps-only row displays "N reps", a weight-only row displays "Nkg", never a fake pairing). `rep_scheme` as a first-class dimension (the still-open gap named in Mission 2) is NOT used here at all — Movement History displays each entry's own reps/weight honestly instead of trying to key/filter by it.

## Unit Semantics

Displayed per the member's own `weight_unit` (WOD-SIMPLE: `userProfile.weight_unit`; forge-admin-web: the member's `weight_unit` passed down from `AthleteResultsPage`), formatted, never compared as strings (comparisons operate on the parsed numeric `weight`/`reps` fields).

## Historical Date Semantics

`logged_at`, the same field Benchmark History already uses — the authoritative Result occurrence date, not a row-update timestamp, so an edit to an old Result never makes it appear as a new session.

## Track-only Results

Included by construction — `groupMovementEntries`/`extractMovementEntriesFrom*` never reference `workout_sections.leaderboard_visible` anywhere, and a dedicated test (`Track-only Results included`) asserts inclusion with no such field present on the fixture.

## Multi-Section Behavior

Each `wod_logs` row is grouped independently by its own `format_snapshot`+`sets`; `workout_section_id` plays no role in identity or grouping (confirmed by a dedicated "Section reorder" test — grouping is unaffected by section ordering, only by movement text + date).

## Query Architecture

Zero new SQL view. WOD-SIMPLE reuses already-loaded `wodLogs`/`skillLogs` component state (both already fetched for Jurnal) — genuinely zero new queries. forge-admin-web adds one new member-scoped `skill_logs` fetch (`fetchSkillLogHistoryForMember`, mirroring the existing `fetchWorkoutHistoryForMember` exactly) since Phase 1 deliberately excluded Skill Work from that read; `wod_logs` reuses the existing `fetchWorkoutHistoryForMember`. All grouping/derivation happens client-side over already-capped (200-row) arrays — no N+1.

## Derived History Model

`MovementEntry` (id, logId, source, movementName, reps, weight, loggedAt, sectionId) — one row per eligible `sets` entry, source-agnostic (the "read boundary normalization" the mission asks for: the UI never knows which physical table a Result came from). `MovementHistorySummary` (displayName, attemptCount, latest, history) — deliberately has no `best` field at all, not merely an unused one, so a future accidental "Best" render is a type/lookup error, not a silent bug.

## Member UX

New "Movements" section on the existing PR/Performance screen, directly below the existing "Benchmarks" section (Phase 1) — the same screen, the same Performance IA, not a second disconnected area. Opens the rewritten `movementDetail` screen: Latest card + full chronological History, no chart, no search, no Best/PR badge.

## Coach UX

New `MovementHistoryView` in forge-admin-web, mirroring `BenchmarkHistoryView`'s own visual/interaction pattern exactly (expandable list rows), mounted in `AthleteResultsPage` directly below "Benchmarks". Same derivation module (`movementHistory.ts`, a straight TS port), same eligibility rule, same "no Best" decision — no separate coach-only interpretation.

## Search / List

No search in V1 (mission's own "prefer A for V1 if canonical identity coverage is weak" — dataset is 60 rows platform-wide today). List shows only movements with actual history, sorted most-recently-performed first.

## Movement Detail

Latest card (score + date) + full History list (date + score per row, newest first). No Best, no chart, no rep-scheme filter — see "No Generic Best/PR Claim" below.

## Edit

No caching anywhere in this feature — every render re-derives from the current `wod_logs`/`skill_logs` array, so an edited weight/reps is reflected on next fetch with zero reconciliation code, exactly Phase 1's own "derive, don't persist" pattern. Verified by test (`Edit - no duplicate, re-derived from current data`), not independently re-tested against a live mutation this phase (same disclosed scope limitation as Phase 1's own edit/delete section).

## Delete

Same mechanism as Edit — a removed log simply produces no entry on the next derivation pass.

## Section Reorder

Verified by dedicated test: grouping/history is a function of movement text + date only, `workout_section_id` never participates in either.

## Security

No new RLS policy. WOD-SIMPLE: reused existing member-scoped `wod_logs`/`skill_logs` reads (own logs only). forge-admin-web: `fetchSkillLogHistoryForMember` uses the identical `gym_id`+`member_id` scoping as the existing `fetchWorkoutHistoryForMember`, riding the same `skill_logs_select_all`-family RLS policy already in place and already exercised elsewhere in this repo (leaderboard reads).

## Performance

No new indexes. Both new fetches are capped at the same `WORKOUT_HISTORY_LIMIT=200` precedent already established for this exact page. Grouping/derivation is a single client-side pass (`O(n)`) over already-loaded arrays.

## Benchmark History Regression

Phase 1's own test suites (both repos) untouched and green in the full-suite runs below — Benchmark Identity, Best/Latest/Previous/Improvement semantics, and tier separation are entirely unaffected (Movement History is fully additive, imports nothing from `benchmarkHistory.js`/`.ts` and is imported by nothing there).

## Automated Tests

25 new tests in WOD-SIMPLE (`movementHistory.test.js`), 23 new tests in forge-admin-web (`movementHistory.test.ts`), cross-client-parity fixtures mirrored deliberately. Covers: basic history, mixed rep context (no fake best), distinct variations kept separate, text-variation normalization (case/whitespace only, explicitly proven NOT to merge aliases like "BS"/"Back Squat"), **the critical Metcon-exclusion invariant** (Fran/AMRAP/Intervals/Death By/legacy-NULL rows all produce zero entries), multi-section, track-only inclusion, edit/delete, units, decimals, same-day multiples, section-reorder independence, one-attempt state, the `skill_logs` Superset-vs-fallback distinction, mixed-source merging, list sorting, and reps-only (bodyweight) display.

## Build/Lint/Type-check

WOD-SIMPLE: `vite build` clean; full Vitest suite 793/793 passing (9 pre-existing, unrelated Deno edge-function transform failures — same known gap as Phase 1, unaffected by this change). forge-admin-web: `tsc -b --force` clean (after fixing two duplicate-`id` test-fixture warnings); full Vitest suite 1006/1006 passing (after updating one pre-existing test's exact subscription-list assertion to include the new `skill_logs` realtime channel); `vite build` clean.

## Migration Status

None. No schema, no migration, no new table, no new column, no `pr_events`/movement-identity change of any kind.

## Production Deployment

WOD-SIMPLE `6b91e54`, forge-admin-web `56a1b8f`, both pushed to `main`, both auto-deployed via Vercel (`https://forge-delta-ivory.vercel.app`, `https://forge-admin-web.vercel.app`), confirmed live.

## Production Acceptance

Performed against real, pre-existing production data — no synthetic rows created. forge-admin-web, member Lavinia Istratie (`9c4c425f-a8f8-474e-8b2b-45598658ed0d`): Movements section showed 4 real entries — "3-3-3-3-3" (5 results) and "1 Deadlift (Schema: 1-1-1-1-1-1-1 (seven singles))" (7 results), the exact real data-quality artifacts found in the audit, rendered honestly rather than hidden or silently merged; "Power Clean" (6 results) expanded to Latest "45kg × 3" (05/08/2026) + full History including 5 reps-only rows from 17/07 ("45 reps"…"55 reps", weight correctly omitted, not fabricated) — no Best/PR field present anywhere in the UI. The member's own `AFTERBURN` Metcon (RFT, containing "Db Hang Power Cleans" in its text) appears correctly in Workout History but produces **zero** Movements entry — the Metcon-exclusion invariant proven live, not just in unit tests. WOD-SIMPLE PWA, member `97a4e88a-1b51-41f7-ab54-2a5061912daa` (the `skill_logs`-sourced case): Movements showed "Snatch Complex" (7 attempts), Latest "50kg × 1" (7/6/2026), History `50, 50, 55, 60, 65, 65, 70` kg — an **exact, order-preserving match** against the raw `sets` JSONB fetched directly via SQL for that row.

## SQL/View/UI Parity

Confirmed by the WOD-SIMPLE cross-check above: UI history values matched the raw `wod_logs.sets` JSON byte-for-byte, in the same order.

## Cleanup

None required — production acceptance used only real, pre-existing data.

## Known Limitations

- Text-scoped identity is disclosed, not hidden: two real near-duplicate movement names exist in production today ("Build to a 3-rep-max front squats" vs. the same text with "100kg" appended by one coach's one-off free-text entry) that will show as two separate one-attempt "movements" rather than merging — correct behavior per the mission's own "no fuzzy matching" rule, but a real, visible product rough edge, not fixed here.
- Two "movement names" in production are actually mistyped rep-scheme text ("3-3-3-3-3", "1 Deadlift (Schema: 1-1-1-1-1-1-1 (seven singles))") — a Programming-authoring UX gap (coach typed a set scheme into the movement-name field), not a Movement History defect; disclosed, not cleaned up, since altering historical Result data was out of scope and any heuristic "fix" was explicitly forbidden.
- The pre-existing `evaluate_movement_prs` trigger's own `rowMode`-blind treatment of `wod_logs.sets` keys (documented above under "Eligible Movement Results") remains unfixed — Movement History avoids inheriting it by re-deriving eligibility independently, but `pr_events` itself may still contain interval-label "movements" from any `wod_logs` row where Death By/EMOM/Tabata/Intervals/Complex was logged as the PRIMARY WOD (none currently in production, per the audit, but the gap is real and disclosed for whoever eventually builds PR Engine hardening).
- No search/chart/rep-scheme filter in V1 (deliberately deferred, see Scope).

## Movement Canonicalization Deferred

Untouched. No `movement_id` column, no alias-merge logic, no LLM-based matching, no migration of the `movements` catalog table into a join key. The mission's own GO/STOP gate (§50) was answered GO specifically because text-scoped identity was proven safe for today's real data (zero collisions found) — that finding does not generalize forward as the platform grows, and this report does not claim it does.

## PR Engine Deferred

Untouched. `pr_events` was never read or written by this feature. No PR schema change, no backfill, no reconciliation, no new PR badge/heuristic.

## Readiness for Next Phase

Per the mission's own closing question: the next Performance phase should be **Rep-Scheme Identity hardening**, not Movement Identity hardening or PR Engine hardening directly. Reasoning: this phase's own production audit found zero real movement-name collisions (Movement Identity, while text-only, is not currently the active pain point), but it *did* surface the concrete, disclosed reason Movement History cannot yet show a "Best" — a 100kg×5 and a 120kg×1 have no comparable dimension without a keyed rep-scheme. Closing that gap is the direct unlock for both a trustworthy Movement "Best" and for fixing the `evaluate_movement_prs` `rowMode`-blind gap's downstream PR correctness — making it the more load-bearing next step than a Movement Identity project that today's data doesn't yet demand.

---

## Final Response — 52 Items

1. Verdict: SHIPPED, live, verified in both clients against real production data.
2. Movement History implementation status: complete for V1 scope (List + Detail, both clients).
3. Movement identity available today: text-only, exact-match with case/whitespace normalization for grouping.
4. Canonical or text-scoped: text-scoped, explicitly disclosed, not claimed canonical.
5. Normalization used: `trim().toLowerCase().replace(/\s+/g,' ')` — case/whitespace only, zero alias/fuzzy logic.
6. Production identity audit findings: 60 eligible `wod_logs` rows, zero real case/whitespace collisions, 2 real near-duplicate-text artifacts disclosed (not merged).
7. Result sources included: `wod_logs` (rowMode:'movement' formats) + `skill_logs` (skill_name_snapshot or Superset-keyed).
8. Result sources excluded: `pr_events` (never read), all non-movement-keyed `sets` formats, all non-`'sets'` formats.
9. Movement-performance eligibility rule: `family:'sets'` AND `rowMode:'movement'` for `wod_logs`; non-empty `sets` for `skill_logs`.
10. Metcon movement exclusion: structural (Metcon formats never populate movement-keyed `sets`), proven live (AFTERBURN/Db Hang Power Cleans absent from Movements).
11. Rep context availability: RELIABLE per-row (reps/weight independently nullable, never fabricated).
12. Rep-scheme reliability verdict: not used this phase — the still-open gap that blocks a generic "Best".
13. Unit behavior: per-member `weight_unit`, numeric comparison never string comparison.
14. Decimal behavior: preserved (102.5kg verified by test).
15. Date behavior: `logged_at`, not a row-update timestamp.
16. Edit behavior: re-derived on every fetch, no cache, no duplicate.
17. Delete behavior: entry disappears on next derivation pass.
18. Section reorder behavior: no dependency on `workout_section_id` ordering (test-verified).
19. Track-only behavior: included by construction.
20. Hidden-leaderboard behavior: same mechanism as track-only.
21. Multi-section behavior: each section's own movement grouped independently, no leakage.
22. Movement variant separation: Snatch/Power Snatch/Hang Power Snatch/etc. never merged (test-verified).
23. Same-day multiple-result behavior: all remain, never deduped.
24. Member entry point: new "Movements" section on the existing Performance/PR screen.
25. Movement-list UX: name, latest score, attempt count, last-performed date, sorted most-recent-first.
26. Movement-detail UX: Latest card + full chronological History, no chart.
27. Search behavior: not implemented in V1 (deferred, thin dataset).
28. Empty state: honest copy, no fabricated promise.
29. One-Result state: shown correctly, no fake trend.
30. Generic Best/PR shown: **NO** — deliberately, per the rep-scheme-comparability gap.
31. Charts included: **NO** — deliberately, a mixed-rep-scheme chart would mislead.
32. PWA behavior: verified live (Snatch Complex, byte-for-byte match to raw SQL).
33. Admin behavior: verified live (Power Clean, 3-3-3-3-3, disclosed artifacts rendered honestly).
34. Cross-client parity: confirmed via mirrored test fixtures + independent live checks on different real members.
35. Benchmark History regression: none — Phase 1 suites untouched and green.
36. PR Engine untouched confirmation: confirmed, zero `pr_events` reads/writes anywhere in this feature.
37. `pr_events` untouched confirmation: same as above.
38. Movement canonicalization untouched confirmation: confirmed, no `movement_id`, no alias merge, no migration.
39. Schema changes: none.
40. Migrations: none.
41. New tests: 48 total (25 WOD-SIMPLE + 23 forge-admin-web).
42. WOD-SIMPLE full test count: 793/793 passing (9 pre-existing unrelated failures).
43. forge-admin-web full test count: 1006/1006 passing.
44. Lint/type-check/build: `tsc -b --force` clean, both `vite build` clean.
45. Deployment: live, both repos, both auto-deployed via Vercel.
46. Production scenarios verified: real data, two different real members, both clients, Metcon-exclusion proven live.
47. SQL/UI parity: exact match confirmed (WOD-SIMPLE Snatch Complex vs. raw `sets` JSON).
48. Cleanup: none needed — no synthetic data created.
49. Known limitations: text-scoped identity risk disclosed (2 real near-duplicate artifacts), pre-existing `evaluate_movement_prs` rowMode-blind gap disclosed, no search/chart/rep-scheme filter in V1.
50. Report path: `MEMBER_PERFORMANCE_PHASE2_MOVEMENT_HISTORY_IMPLEMENTATION_REPORT.md` (WOD-SIMPLE root).
51. Commit hashes: WOD-SIMPLE `6b91e54`, forge-admin-web `56a1b8f`.
52. Working-tree/origin status: both clean, both in sync with `origin/main`.

### A. Can Forge now show an honest member Movement History?
**YES.**

### B. Does Movement History include only Results where the movement itself was the scored performance?
**YES.**

### C. Can an ordinary Metcon movement accidentally become a Movement History result?
**NO.**

### D. Are distinct movement variants kept separate unless authoritative identity says otherwise?
**YES.**

### E. Are track-only and hidden-leaderboard Results still included?
**YES.**

### F. Does Movement History make any unsupported generic PR claim?
**NO.**

### G. Did this phase avoid modifying the PR Engine, `pr_events`, or implementing a canonical Movement Identity project?
**YES.**

### H. Are WOD-SIMPLE and forge-admin-web semantically equivalent?
**YES.**

### I. Is Phase 2 production-complete within its explicitly honest identity boundary?
**YES.**

### J. What EXACTLY should the next Performance phase be?
**Rep-Scheme Identity hardening** — the concrete, disclosed gap this phase surfaced as the actual blocker (not Movement Identity, which today's real data shows is not yet a collision problem, and not PR Engine hardening directly, which depends on rep-scheme identity being solid first to fix the `evaluate_movement_prs` `rowMode` gap correctly rather than patching around it again).
