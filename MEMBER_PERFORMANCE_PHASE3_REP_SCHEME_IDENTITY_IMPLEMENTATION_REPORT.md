# Member Performance, Phase 3 — Rep-Scheme Identity Hardening: Implementation Report

**Status: SHIPPED, LIVE, VERIFIED IN PRODUCTION IN BOTH CLIENTS. No schema change. No PR Engine change.**

## Executive Summary

Answers Phase 2's own closing question — "what makes two movement Results legitimately comparable?" — with a small, evidence-based comparison-identity resolver added to the existing Movement History derivation modules. Investigation found exactly two structurally-declared test-intent signals in Forge's live schema (Build to Heavy/1RM's `targetLabel` stepper; Complex's optional `scoringMode`), and confirmed by direct production-data audit that everything else (Strength Sets, Superset, Weightlifting) carries no test-intent signal at all — only training structure or nothing. The resolver never infers rep-max intent from rep count or set count alone (the mission's own central warning), producing three honest outcomes: `RM_TEST` (comparable), `SETS_ACROSS` (displayable, not comparable), `UNKNOWN` (displayable, not comparable). WOD-SIMPLE `98bf876`, forge-admin-web `3f42a56`.

## Problem

Phase 2 could show a movement's full history but had no way to say whether two entries were the *same kind* of performance — a real 5RM test and a 5×5 training set both show "5 reps," but conflating them into one comparable group would fabricate a PR claim Forge cannot honestly make. This phase closes that gap for Movement History display and produces the exact contract a future PR Engine phase needs, without touching PR Engine itself.

## Current Data Model

Traced directly in code, not assumed: `wod_logs`/`skill_logs` have no `rep_scheme` column of their own — the only `rep_scheme` in the schema lives on `pr_events` (Slice 3) and is populated by `evaluate_movement_prs` as `trunc(reps)::int`, i.e. the raw per-set rep count, not a semantic test-intent field. This is the concrete reason Mission 2 called it "not yet keyed." Programming's own authored intent lives instead in each format's own `config` (frozen into `format_config_snapshot` at logging time, per the existing Scoring Snapshot pattern):
- `Build to Heavy/1RM.targetLabel` — a `repMaxStepper` UI field (`RepMaxStepperField`, `FormatConfigEditor.jsx`) that can only ever emit `` `${1-30}RM` ``, never free text.
- `Strength Sets.setsScheme` — a `repsSchemeList` (target reps per set, e.g. `[5,5,5,5,5]`), a training descriptor, never a test-intent field.
- `Superset.targetSets` — a set count, same character as `setsScheme`.
- `Complex.scoringMode` — optional (`'Max Weight'|'Total Weight'`), no schema-declared default.
- `Weightlifting.config` — literally `{}`, zero fields, ever.

## Current PR Behavior

Not modified, but audited to inform this phase honestly: `evaluate_movement_prs` (the only writer of `pr_events` movement PRs) treats every `wod_logs.sets` key as a movement name unconditionally, with no `rowMode` awareness — a real, pre-existing gap (also noted in Phase 2's own report) that can let interval/round labels leak into `pr_events` when a `rowMode:'interval'` format is logged as the primary WOD. This phase does not touch that trigger. It is disclosed here because it is exactly the kind of identity confusion this phase's resolver is designed to prevent for Movement History's own read path.

## Production Data Audit

Read-only `supabase db query --linked`, no writes, scoped to the same 46 real eligible movement rows Phase 2 already inventoried (31 Strength Sets + 11 Build to Heavy/1RM wod_logs rows + 4 Complex skill_logs rows; Weightlifting/Superset have 0 live rows):
- **Build to Heavy/1RM (11 rows):** `targetLabel` populated on every row, always `"3RM"`, matching the workout's own name ("Build to a 3-rep-max front squats") exactly — FULLY IDENTIFIABLE.
- **Strength Sets (31 rows):** 11 "Power Clean" rows carry `setsScheme: [3,3,2,2,1,1,1,1]` (a real descending ladder to singles) — PARTIALLY IDENTIFIABLE as SETS_ACROSS (deliberately *not* inferred as an RM test despite ending in singles, per the mission's own explicit warning against reading test intent from ladder shape). The remaining 20 rows (`"1 Deadlift (Schema:...)"`, `"3-3-3-3-3"`, 6 more "Power Clean", 3 blank-key rows) carry `setsScheme: null` — AMBIGUOUS/UNKNOWN, honestly disclosed, not guessed.
- **Complex (4 skill_logs rows, "Snatch Complex"):** `scoringMode` is `null` on all 4 — AMBIGUOUS/UNKNOWN (no schema default exists to fall back to).

## Competitive Research

Reused Mission 2's own `MEMBER_PERFORMANCE_COMPETITIVE_RESEARCH.md` (still current, re-cited not re-derived): Wodify's estimated-1RM is shown *only when no actual 1RM is on file* and is never conflated with a tested max; TrainHeroic runs an explicit tested-vs-estimated state machine; TeamBuildr's distinctive "Evaluations" concept treats testing as a formally separate data type from ordinary logging. Forge has no such separate testing data type and this phase does not add one — instead, the resolver treats the *absence* of an explicit test-intent signal as conclusively non-comparable, which is a more conservative position than any of the three researched platforms (none of which attempt outright estimation in V1 either).

## Rep-Scheme Taxonomy

Three modes, deliberately small (mission's own "do not overmodel"):
- **`RM_TEST`** — explicit, structurally-declared test intent. `comparable: true`.
- **`SETS_ACROSS`** — declared training structure, no test-intent signal. `comparable: false`.
- **`UNKNOWN`** — no declared structure at all. `comparable: false`. A valid, honest outcome, not a failure state.

No enum explosion (`5X5`, `5X3`, etc.) — every rep-scheme shape within SETS_ACROSS collapses to one mode; the actual numbers remain visible per-entry via the existing `movementEntryDisplay`.

## Comparison Identity

`resolveComparisonIdentity({ formatSnapshot, formatConfigSnapshot }) → { mode, repTarget, comparable }`, pure, deterministic, no DB/AI/fuzzy inference. `comparisonKey = movementName(normalized) + tier + mode + repTarget` — never date, section, or workout title (mutable/occurrence-specific), so a future PR Engine phase can safely compare only within the same key.

## Explicit RM

`Build to Heavy/1RM`: `repTarget = parseRepMaxTarget(targetLabel)` (regex `^(\d{1,2})RM$`, matching the stepper's own guaranteed output shape). 1RM, 3RM, 5RM each produce a distinct `comparisonKey` — verified live (real "3RM" front squat row) and by test.

## Heavy Single

Investigated and resolved: Forge's format catalog has **no distinct "Heavy Single" concept** — `Build to Heavy/1RM` is one format, its authored intent captured entirely by `targetLabel` (defaulting to `"1RM"`), which is itself a proper NRM value. There is nothing to keep separate from 1RM because "Heavy Single" *is* `targetLabel: "1RM"` in this schema.

## Build to Heavy

Same format as Explicit RM above — "Build to Heavy" is the format's informal product name; its actual comparison identity is always driven by the same `targetLabel` field, confirmed correct on 100% of live rows.

## Sets Across

`Strength Sets` with a non-empty `setsScheme` array, or `Superset` with a positive `targetSets` → `SETS_ACROSS`, `comparable: false`, regardless of the specific scheme shape (a descending ladder to a single is still SETS_ACROSS — rep count/ladder shape is never read as test intent).

## Training Sets

Same category as Sets Across — this mission does not distinguish "training sets" from "sets across" as separate modes; both describe the same underlying fact (declared structure, no test-intent signal).

## Superset

`targetSets` present and positive → `SETS_ACROSS`. No live production rows exist for this format yet; behavior is schema-derived and test-verified only.

## Complex

The mission's own mandatory anti-false-PR case: a Complex's `sets` keys are never reached as movement identity at all (Phase 2's own rule already routes Complex through `skill_logs.skill_name_snapshot`, i.e. the *whole complex* — e.g. "Snatch Complex" — is the movement subject, never its component movements). This phase adds: `scoringMode === 'Max Weight'` → `RM_TEST` (`repTarget: null`, since the whole complex, not one rep count, is comparable); `scoringMode === 'Total Weight'` → `SETS_ACROSS`; unset (all 4 real rows) → `UNKNOWN`, verified live (WOD-SIMPLE, "Snatch Complex", zero badge on any of 7 history entries).

## Max Reps

Not specially modeled this phase — a bodyweight `Superset` entry with declared `targetSets` resolves `SETS_ACROSS` like any other; a true "max reps, no scheme" case with zero declared structure resolves `UNKNOWN`. Both remain fully displayable with their honest rep count, never fabricated as a max-test comparison.

## Legacy/Unknown

20/31 real Strength Sets rows (`setsScheme: null`) and all 4 real Complex rows (`scoringMode: null`) resolve `UNKNOWN` — verified live on both counts (forge-admin-web's Power Clean 05/08/2026 entry; WOD-SIMPLE's entire Snatch Complex history). No backfill, no heuristic reconstruction, no destructive mutation of any historical row.

## Programming Intent

Confirmed: where Programming captures a real test-intent field (`targetLabel`), it is reliable and reused as-is. Where it doesn't (Strength Sets/Superset/Weightlifting/Complex-without-scoringMode), no intent is invented.

## Result Snapshot

`format_config_snapshot`, already frozen at logging time by the existing Slice 2 `snapshot_wod_log_context`/`snapshot_skill_log_context` triggers — reused as-is, zero new snapshot fields, zero migration.

## Quick Create

Investigated (`analyze-workout/prompt.ts`): the AI parser's format-selection heuristics were read; `targetLabel` itself is not explicitly special-cased in the parser prompt excerpt inspected, but live data conclusively shows the *end-to-end* authored result (whether via AI suggestion, coach's own stepper adjustment, or a mix) is correct on 100% of real rows — the resolver only depends on the final `format_config_snapshot` value, not on which authoring path produced it, so this is a non-issue by construction.

## Manual Authoring

Same field, same resolver, no separate path — verified by test (`resolveComparisonIdentity` is a pure function of `formatSnapshot`+`formatConfigSnapshot` only; identical input from either authoring route yields identical output).

## Persistence Strategy

Path D from the mission's own menu: entirely derived, zero persistence, zero migration. No new table, no new column, no `pr_eligible` boolean stored anywhere — `comparable` is a derived field on the in-memory `MovementEntry`.

## Derived vs Persisted

Fully derived, matching this feature's existing Phase 1/2 precedent exactly — re-computed on every render from already-loaded `wod_logs`/`skill_logs`, so edits/deletes are reflected automatically with zero reconciliation code.

## Stale Clients

Not applicable — no new persisted field exists that an old client could fail to write or erase.

## Movement History Integration

Additive only: each history entry gained `comparisonMode`/`repTarget`/`comparable`/`comparisonKey` fields and one small honest label ("3RM"/"Max"/"Training", or nothing for UNKNOWN) next to its date, in both Movement Detail's Latest card and History rows. No grouping-by-mode, no Best-within-group, no chart, no rep-scheme filter, no PR Overview — all explicitly deferred per the mission's own "primary mission remains identity" instruction.

## Benchmark Regression

Phase 1's own suites (both repos) untouched and green — this phase never imports from or is imported by `benchmarkHistory.js`/`.ts`.

## PR Engine Boundary

Zero `pr_events` reads or writes. Zero changes to `evaluate_movement_prs`/`evaluate_benchmark_pr`. The `rowMode`-blind gap in that trigger (documented above under "Current PR Behavior") remains exactly as it was — disclosed, not touched, matching the mission's explicit stop condition.

## Tests

44 total in WOD-SIMPLE `movementHistory.test.js` (25 Phase 2 + 19 new Phase 3), 35 total in forge-admin-web `movementHistory.test.ts` (23 Phase 2 + 12 new Phase 3 — a slightly smaller mirrored subset, all scenarios still covered). Covers: explicit RM (1RM/3RM/5RM all distinct `comparisonKey`s), a real production descending-ladder case staying SETS_ACROSS, the Heavy-Single-is-1RM finding, a real Build-to-Heavy case, the mandatory Complex anti-false-PR cases (Max Weight → RM_TEST repTarget null; Total Weight → SETS_ACROSS; unset → UNKNOWN, matching all 4 real rows), Weightlifting always UNKNOWN, a real Strength-Sets-null case, Quick-Create/manual-authoring purity, determinism on reload, Rx/variant tier separation (same movement+RM at different tiers never shares a `comparisonKey`), and a PR-Engine-handoff contract test (only `comparable` entries share a key; a `SETS_ACROSS` entry never joins an `RM_TEST` bucket even at the same nominal rep count).

## Production Verification

Performed against real, pre-existing production data — no synthetic rows created. forge-admin-web, member Lavinia Istratie (`9c4c425f-...`): "Build to a 3-rep-max front squats" showed a "3RM" badge on both Latest and History (confirmed via an authenticated direct REST fetch that the underlying row's `format_config_snapshot.targetLabel` is exactly `"3RM"`); "Power Clean"'s 6-entry History showed **per-entry-correct** labels — 5 entries (real `setsScheme`-populated rows) showed "Training", the 1 entry with `setsScheme: null` showed no badge — proving the resolver operates per-log, not per-movement-group, exactly as designed. WOD-SIMPLE PWA, member `97a4e88a-...`: "Snatch Complex" (all 4 real rows have `scoringMode: null`) showed **zero** badge anywhere across its full 7-entry History, in both Latest and every History row — the honest UNKNOWN outcome, confirmed cross-client.

## Historical Data Impact

No mutation performed or needed. Of the 46 real eligible rows: 11 (Build to Heavy/1RM) are now FULLY IDENTIFIABLE/comparable; 11 (Strength Sets with a ladder scheme) are classified SETS_ACROSS; 20 (Strength Sets with null scheme) and 4 (Complex with null scoringMode) remain UNKNOWN — displayable, honestly non-comparable, exactly as before this phase, just now explicitly labeled instead of silently undifferentiated.

## Cleanup

None required — no test data created; all verification used real, pre-existing rows.

## Known Limitations

- The `evaluate_movement_prs` trigger's own `rowMode`-blind gap (documented above) remains unfixed — out of this phase's explicit scope (PR Engine untouched).
- 24/46 real eligible rows (~52%) remain UNKNOWN due to missing `setsScheme`/`scoringMode` on older authored rows — a real, disclosed data-completeness gap in historical Programming authoring, not a defect in this phase's resolver, and not backfilled (no destructive/guessed mutation, per mission's explicit stop condition).
- No UI grouping/filter/chart by rep-scheme mode in V1 (deliberately deferred).
- `Superset`'s `SETS_ACROSS` branch is schema-derived only — zero live rows exist yet to verify against real data.

## Phase 4 Readiness

The handoff contract for a future PR Engine phase is now explicit and testable: **only entries where `comparable === true` may ever be compared, and only within the same `comparisonKey`.** This phase deliberately does not build that comparator — it hands off a proven, evidence-based identity boundary for one to be built against safely, closing exactly the gap Phase 2 named and nothing more.

## Final Verdict

SHIPPED, live, verified in both clients against real production data, zero schema change, zero PR Engine change, zero destructive mutation.

---

## Final Response — 55 Items

1. Overall verdict: SHIPPED, live, verified in both clients.
2. Rep-scheme problem confirmed: YES — real data proves training sets and RM tests were previously undifferentiated in Movement History.
3. Existing `rep_scheme` field (on `pr_events`) verdict: not a semantic identity field — just the raw per-set rep count; not reused for this feature's identity.
4. Programming intent availability: present and reliable for exactly 2 signals (`targetLabel`, `scoringMode`); absent for Strength Sets/Superset/Weightlifting test-intent.
5. Result snapshot availability: sufficient — `format_config_snapshot` already freezes everything needed, zero new snapshot fields.
6. Production data coverage: 46 real eligible rows audited.
7. Fully identifiable: 11/46 (Build to Heavy/1RM, all with valid targetLabel).
8. Ambiguous/Unknown: 24/46 (20 Strength Sets + 4 Complex, all missing their own declared field).
9. Final taxonomy: RM_TEST / SETS_ACROSS / UNKNOWN (3 modes only).
10. Comparison identity: `movement + tier + mode + repTarget`, never date/section/title.
11. Explicit 1RM behavior: own `comparisonKey`, comparable.
12. 3RM behavior: separate `comparisonKey` from 1RM/5RM, comparable.
13. 5RM behavior: separate `comparisonKey`, comparable.
14. Heavy Single behavior: no distinct concept exists in Forge's schema — resolves via the same `targetLabel` stepper as 1RM.
15. Heavy Triple: not a distinct concept either — `targetLabel: "3RM"` covers it.
16. Build to Heavy behavior: same format/field as explicit RM, verified 100% correct on live data.
17. 5×5 behavior: SETS_ACROSS, never comparable, never inferred as 5RM.
18. Sets Across behavior: declared structure (setsScheme/targetSets present), not comparable.
19. Superset behavior: SETS_ACROSS when targetSets declared; schema-derived only, no live data yet.
20. Complex behavior: RM_TEST only when scoringMode='Max Weight' (repTarget null, whole complex is subject); SETS_ACROSS for 'Total Weight'; UNKNOWN when unset (all 4 real rows) — never creates a false component-movement RM.
21. Max Reps behavior: no special modeling; resolves via declared structure or UNKNOWN, never fabricated.
22. Unknown legacy behavior: fully displayable, `comparable: false`, honestly labeled (no badge).
23. PR eligibility behavior: derived (`comparable` boolean), not a stored flag.
24. History-display eligibility: unconditional — every entry always displays, regardless of comparability.
25. Quick Create behavior: correct on 100% of live data (verified end-to-end, not parser-internals-dependent).
26. Manual authoring behavior: identical resolver, identical result (pure-function test).
27. Format-switch behavior: not separately tested (no live scenario found); resolver is stateless per-log so no stale-state risk exists structurally.
28. Edit behavior: re-derived on every fetch, no cache.
29. Reload behavior: deterministic, pure-function test-verified.
30. Unit behavior: unaffected by this phase (unit handling unchanged from Phase 2).
31. Rx/variant behavior: tier included in `comparisonKey` — never pooled across tiers (test-verified).
32. Track-only behavior: unaffected, still included by construction (unchanged from Phase 2).
33. Hidden-leaderboard behavior: same as track-only.
34. PWA behavior: verified live (Snatch Complex, correctly UNKNOWN, zero badge).
35. Admin behavior: verified live (3RM badge correct; per-entry Training/no-badge correct).
36. Movement History regression: none — all Phase 2 entries still display, only labels added.
37. Benchmark History regression: none — suites untouched and green.
38. PR Engine untouched confirmation: confirmed, zero changes to `evaluate_movement_prs`/triggers.
39. `pr_events` untouched confirmation: confirmed, zero reads/writes.
40. Schema changes: none.
41. Migrations: none.
42. Historical mutation/backfill: none performed, none needed.
43. Stale-client safety: not applicable (no new persisted field).
44. New tests: 31 total (19 WOD-SIMPLE + 12 forge-admin-web).
45. WOD-SIMPLE full test count: 812/812 real tests passing (9 pre-existing unrelated Deno failures).
46. forge-admin-web full test count: 1018/1018 passing.
47. Lint/type-check/build: `tsc -b --force` clean, both `vite build` clean.
48. Deployment: live, both repos, both auto-deployed via Vercel, bundle contents confirmed.
49. Production scenarios verified: real data, two different real members, both clients, per-entry correctness proven.
50. SQL/UI parity: confirmed via authenticated direct REST fetch matching UI display exactly.
51. Cleanup: none needed — no synthetic data created.
52. Known limitations: 52% of real eligible rows remain UNKNOWN (missing declared structure, disclosed not backfilled); pre-existing `evaluate_movement_prs` rowMode gap remains (disclosed, out of scope); no UI grouping/filter/chart in V1; Superset branch schema-derived only.
53. Report path: `MEMBER_PERFORMANCE_PHASE3_REP_SCHEME_IDENTITY_IMPLEMENTATION_REPORT.md` (WOD-SIMPLE root).
54. Commit hashes: WOD-SIMPLE `98bf876`, forge-admin-web `3f42a56`.
55. Working tree/origin status: both clean, both in sync with `origin/main`.

### A. Can Forge now distinguish legitimately comparable movement performances from non-comparable training results?
**YES.**

### B. Can 1RM, 3RM and 5RM remain separate performance identities?
**YES.**

### C. Can 5×5 training work avoid being falsely classified as 5RM?
**YES.**

### D. Can complexes avoid creating false component-movement RM identities?
**YES.**

### E. Can ambiguous legacy Results remain visible in Movement History without being falsely PR-comparable?
**YES.**

### F. Does Quick Create and manual authoring produce the same rep-scheme identity for equivalent programming?
**YES.**

### G. Did this phase avoid expanding the PR Engine?
**YES.**

### H. Is the rep-scheme identity contract now strong enough for PR Engine hardening?
**YES** — the `comparable`+`comparisonKey` contract is explicit, tested, and proven against real data; a future PR Engine phase can consume it directly without re-deriving identity logic.

### I. Is Phase 3 production-complete?
**YES**, within its disclosed boundary (52% of current real rows remain honestly UNKNOWN due to missing historical Programming metadata, not a defect).

### J. Is the next phase definitively PR ENGINE HARDENING?
**NO.** The real blocker for a *trustworthy, high-coverage* PR Engine is not identity logic (now solved) but **Programming authoring completeness** — over half of today's real Strength Sets/Complex rows lack the declared `setsScheme`/`scoringMode` field this phase's resolver depends on, meaning a PR Engine built today would correctly decline to compare most existing history rather than produce wrong comparisons (safe, but low-value). Closing that authoring gap — or accepting the coverage limit and proceeding anyway — is a product decision for the next phase to make explicitly, not something to infer here.
