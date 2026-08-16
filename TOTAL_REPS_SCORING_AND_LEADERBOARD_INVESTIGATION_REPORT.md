# Total Reps Scoring + Leaderboard Investigation Report

**Status: COMPLETE.** The real production symptom (a 6-round Intervals result showing "6 seturi" with no athletic score) was root-caused to a config-resolution bug affecting any `family:'sets'` format with a schema-declared `scoringMode` default (Tabata, Intervals) — not a "For Reps" or "Total Reps" special case. Fixed at the domain layer in both repos, verified live against the exact real production row: **Valentin Viorel Oita Bucur now correctly ranks at 606 reps**, with the round-by-round breakdown followed by a TOTAL block, exactly as specified.

## Executive Summary

The mission's own framing warned against a shortcut fix (`if format === 'For Reps': sum(rounds)`) and asked for the true canonical-scoring-semantics answer. Investigation found that Forge already has exactly this semantic layer, live for years: `family:'sets'` formats declare a `scoringMode` config field (`'Total Reps' | 'Lowest Reps'` for Tabata/Intervals, `'Total Weight' | 'Max Weight'` for Complex), resolved by a pure function (`computeSetsScore`) already used for ranking. The bug was never in the scoring taxonomy — it was that `computeSetsScore` read `config.scoringMode` literally, and a real, independently-found UI bug (`FormatConfigEditor`'s `SelectField` showing the array's first option instead of the schema's declared `default`, and never persisting the field unless explicitly touched) meant a coach who left an already-correct-looking dropdown alone got a `format_config` with the key silently absent. The fix resolves `scoringMode` against the format's own already-declared schema default when absent — reusing existing vocabulary, adding no new scoring type, requiring no migration, and precisely respecting the difference between "sum the rounds" (Total Reps), "worst round" (Lowest Reps), and "no scoring mode configured at all" (Complex/Weightlifight/EMOM, unaffected).

## Original Production Symptom

WOD-SIMPLE Clasament, member Valentin Viorel Oita Bucur, Intervals workout, 2026-08-14: card showed "6 seturi" with a round-by-round breakdown but no athletic score, and the member did not appear correctly ranked.

## Real Workout Investigation

Found the exact row directly, read-only: `wod_logs.id = 63013f14-be32-4b42-8b1a-c4a2a36cecb0`, `wod_id = fc41be2f-bea3-4a34-9f0a-81308ac916a0` (`wods.type = 'Intervals'`, `format_config = {"rounds": 6}` — **no `scoringMode` key**), `workout_section_id = 061c329c-...` (`workout_sections.format = 'Intervals'`, same `format_config`). `sets` field: `{"Rundă 1": [{reps:"115"}], "Rundă 2": [{reps:"14"}], ..., "Rundă 6": [{reps:"33"}]}`, every row `completed: false` (a pre-existing, unrelated field — not consulted by scoring), no `weight` on any row.

## Actual Persisted Data Shape

Structured, not free text: `sets` is a `jsonb` object keyed by round label, each value an array of `{reps, weight, completed}` rows — one row per round for `simpleReps:true` formats (Tabata/Intervals). This is the same shape every other `family:'sets'` format uses (Weightlifting, Strength Sets, Complex); nothing format-specific about the storage.

## Existing Scoring Semantics

Already live, not invented this mission: `WORKOUT_FORMATS['Intervals'].config.scoringMode = { type: 'select', options: ['Lowest Reps', 'Total Reps'], required: true, default: 'Total Reps' }` (`WORKOUT_FORMATS['Tabata']` — same shape, `default: 'Lowest Reps'`; `WORKOUT_FORMATS['Complex'].config.scoringMode = { options: ['Max Weight', 'Total Weight'], required: false }` — no default, by design, since a Complex commonly has no scoringMode configured at all and correctly falls back to weight). This IS Forge's canonical scoring-semantics layer for multi-component `sets`-family results — a pure function, `computeSetsScore(formatId, config, rowsByKey)`, already consumed by the same ranking code used across the whole platform (`sortSectionLogs`/`rankResultsForWorkout`). No new scoring type was introduced; the fix operates entirely within this existing vocabulary.

## Meaning of "6 sets"

Confirmed by direct code trace, not guessed: `parseWodLogDetails`'s `rezultatBucati` array included `t.jurnalSetsCountLabel(wSetsParti.length)` — a purely descriptive count of how many round/movement keys exist in `sets`, unconditionally appended whenever `wHasSets`. It is metadata (mission's possibility **C**: "six result components exist"), never the athletic score. It only became user-visible as the primary "REZULTAT" content because the real score (`result`) was `'—'` (unavailable) for this specific row, so the override that would normally replace it with the real score (`family==='sets' && result!=='—' → [result]`) never fired.

## Existing Ranking Behavior

`sortSectionLogs` (WOD-SIMPLE) / `rankResultsForWorkout` (forge-admin-web) already correctly branch on `family==='sets'`, compute `_setsScore`/`rankScore` via `setsDisplayScore`, and rank by it — architecturally correct, before and after this fix. Before the fix, `computeSetsScore` returned `null` for this row (no `scoringMode`, no weight to fall back to), so `_setsScore` was `null` and the member ranked last/unscored by the ranking comparator's own `null`-handling branch (`a._setsRankScore == null → return 1`) — **the member was never using "6" as a score; he was silently falling to the bottom of the ranking as "unscored," with "6 seturi" merely a leftover descriptive label in the UI, not what determined his rank.**

## Canonical Score Decision

**606 reps is the correct athletic score** — the sum of all 6 logged rounds (115+14+185+26+233+33=606), matching `Intervals`' own declared default `scoringMode: 'Total Reps'`. Verified this is genuinely the format's intended default (not an assumption): the schema declares it explicitly, `required: true`, and no other row in production for this format was ever configured differently.

## TOTAL_REPS Rule

Implemented as a **resolution fix, not a new rule**: `resolveSetsScoringMode(formatId, config)` (new, both repos) = `config?.scoringMode || getFormat(formatId).config.scoringMode?.default || null`. `computeSetsScore` and `isWeightScoredSetsFormat` both now call this single function, so score computation and unit-display resolution can never disagree (a real second bug this audit also found — see below). No `if (format === 'Intervals')` branch anywhere; the rule reads the format's own declared schema, generalizing automatically to any current or future `family:'sets'` format that declares a `scoringMode` default.

## Format/Scoring Matrix

| Format | scoringMode field | Options | Schema default | Canonical semantic | Show Total? |
|---|---|---|---|---|---|
| Intervals | required | Lowest Reps / Total Reps | **Total Reps** | B (sum rounds, this mission's case) | Yes, when resolved mode is Total Reps |
| Tabata | required | Lowest Reps / Total Reps | Lowest Reps | Depends on config/default — default is worst-round, not a total | Only if explicitly configured to Total Reps |
| EMOM | optional | Total Reps / Lowest Reps | *(none)* | C — depends on explicit coach configuration; unconfigured falls back to weight (`maxWeightFromSets`) | Only if explicitly configured |
| Complex | optional | Max Weight / Total Weight | *(none)* | B — weight-only, no reps option at all; unconfigured falls back to weight (max) | Total Weight only if explicitly configured |
| Weightlifting, Strength Sets, Build to Heavy/1RM, Superset, Death By Weight | no scoringMode field | — | — | B — always weight-scored (`maxWeightFromSets`), reps-total never applies | No |
| Death By | no scoringMode field | — | — | D — scored by its own escalating-reps/interval mechanic, not scoringMode at all; out of this audit's scope, no production symptom implicated it | N/A |
| "Score each round" (independent per-round scores) | *not a supported scoringMode value* | — | — | Confirmed: Forge's `family:'sets'` model always resolves to exactly ONE canonical score per log via `scoringMode` — there is no "N independent scores from one log" concept. A coach wanting genuinely independent per-round rankings would need N separate Sections, which is out of this mission's scope (Workout Aggregation territory, explicitly not used here — see below) | N/A |
| "Best round" / "Average reps" | *not supported scoringMode values* | — | — | Not part of the current taxonomy for reps (Lowest Reps is the closest existing "worst round" primitive); not invented this mission, per the mission's own "reuse, don't invent" instruction — no production symptom asked for these | N/A |

## Counterexamples

Verified by direct test that the fix does **not** turn into "sum every numeric field found":
- **Lowest Reps** (Tabata default): `computeSetsScore('Tabata', {}, rows)` resolves the schema default `'Lowest Reps'` and returns `Math.min(...)`, never a sum — proven by test (`10, 8, 12 → 8`, not `30`).
- **Load components without a configured scoringMode** (Complex/Weightlifting): resolve to `null` (no schema default declared) and correctly fall back to `maxWeightFromSets` — never summed into a fake "Total Weight." Proven by test (unchanged from before this mission).
- **"Score each round"/"Best"/"Average"**: not representable scoringMode values in the current taxonomy at all — confirmed by direct schema inspection, not assumed; no test needed since the code has no path that could produce this behavior (`computeSetsScore` only ever returns one of `{sum, min, max}` over the declared options, never per-round outputs).

## Persisted vs Derived Decision

**Derived, unchanged from the existing architecture** — `computeSetsScore` was already a pure, read-time function before this mission; the fix stays entirely within that existing derivation, adding a schema-lookup fallback, never a new persisted field. Considered and rejected: persisting a `total_reps` column on `wod_logs`/`skill_logs` — rejected per the mission's own "prefer no migration" instruction and because the derivation is already correct and cheap (operates on already-fetched `sets` JSON, no extra query).

## Domain-Layer Implementation

`resolveSetsScoringMode` (new, exported, both repos) is the single source of truth, in the same file as `computeSetsScore`/`isWeightScoredSetsFormat` (`workoutFormats.js` / `ranking.ts`) — never duplicated at the display layer. `App.jsx`'s Clasament and forge-admin-web's `ScoreDisplay.tsx` both call the already-existing `setsDisplayScore`/`isWeightScoredSetsFormat` (now correctly parameterized), never re-deriving scoring semantics themselves.

## PWA Implementation

`src/workoutFormats.js`: `resolveSetsScoringMode` (new), `computeSetsScore` and `isWeightScoredSetsFormat` updated to use it (`isWeightScoredSetsFormat` gained an optional `formatId` second parameter, backward-compatible — omitted, behaves exactly as before). `src/FormatConfigEditor.jsx`: `SelectField`'s caller now passes `field.default`, matching every sibling field type's existing pattern. `src/App.jsx` (Clasament): collapsed-card headline now checks `isWeightScoredSetsFormat` before appending a weight unit (previously always appended kg/lbs); expanded card restructured so the sets-family score renders in a dedicated TOTAL/MINIM/MAXIM block **after** the round-by-round breakdown (previously merged into the REZULTAT block, shown *before* the breakdown); "Set N:" prefix removed for `simpleReps` formats with exactly one set per round (Tabata/Intervals).

## Admin Implementation

`src/features/results/ranking.ts`: `resolveSetsScoringMode` (new, exported), `computeSetsScore`/`setsDisplayScore` gained a `formatId` first parameter, `isWeightScoredSetsFormat` gained an optional `formatId` second parameter — all four call sites updated (`ranking.ts` itself, `api.ts`, `aggregateLeaderboard.ts`, `ScoreDisplay.tsx`) so score computation and unit-display resolution can never disagree. `src/features/programming/FormatConfigEditor.tsx`: identical `SelectField` caller fix. `src/features/results/workoutAggregation.ts`'s `classifySectionMetric` (Workout Aggregation's own LOAD/REPS classifier) now also passes `formatId` through — this keeps Workout Aggregation's own Total computation consistent with the leaderboard's, a real correctness dependency this audit surfaced, not scope creep (no Aggregation *behavior* changed, only its own pre-existing dependency on `isWeightScoredSetsFormat` was made correct).

## Expanded Leaderboard UX

**Verified live in production, exact match to the required layout** (WOD-SIMPLE Clasament, the real member/row):
```
Rundă 1        115 reps
Rundă 2        14 reps
Rundă 3        185 reps
Rundă 4        26 reps
Rundă 5        233 reps
Rundă 6        33 reps
─────────────────────────
TOTAL          606 reps
```
TOTAL confirmed at the END, not beside RESULT, not in a side column, not above the rounds — breakdown-then-conclusion reading order, matching the mission's own required visual spec exactly.

## Collapsed Leaderboard UX

WOD-SIMPLE: the collapsed card headline (`TYPO.numericLarge`) now shows `"606 reps"` (was `"—"`, no score at all). forge-admin-web: `ScoreDisplay`'s single-row headline shows `"606"` (Admin has no round-breakdown UI at all to expand — see Known Limitations). Both surface the competitive score without requiring expansion, matching existing leaderboard UX conventions in both clients (no redesign).

## Round/Set Display

`simpleReps:true` formats (Tabata, Intervals — exactly one set per round by construction) no longer show the redundant `"Set 1: "` prefix; `rowMode:'movement'` formats with genuinely repeatable sets (Weightlifting, Strength Sets) are unaffected — confirmed by test that the label is preserved whenever more than one set exists in a round, regardless of format.

## Ranking

Unchanged mechanism (`sortSectionLogs`/`rankResultsForWorkout`, both pure, both untouched in their comparator logic) — now receives a correct, non-null `_setsScore`/`rankScore` for this class of row instead of `null`. Verified by test: three members with Total Reps totals 606/600/660 rank `660, 606, 600` (higher wins, per `Intervals`' own declared direction, unchanged).

## Ties

Not touched — `sortSectionLogs`/`rankResultsForWorkout`'s existing `logged_at` tiebreak for equal scores is pre-existing, platform-wide, unmodified behavior (used identically for every format, not specific to this fix) — out of this mission's scope to change per §48's own "don't touch unrelated systems" discipline.

## Zero vs Missing

Verified by test: a round with `reps: '0'` is summed as a legitimate zero (`100+100+0+100=300`); a round with `reps: ''` (empty, not zero) is excluded from the sum entirely via `computeSetsScore`'s own pre-existing `parseInt`+`filter(!isNaN)` logic, never silently coerced to `0` — this behavior already existed and was re-verified, not newly built.

## Partial Results

Governed by the same pre-existing mechanism as Zero vs Missing: a member with only 4 of 6 rounds logged gets a sum over whatever rows exist (`parseInt`-valid entries only) — Forge's existing "return no answer rather than guess" philosophy already applies per-value (a missing/unparseable reps field is excluded, not zeroed), and the aggregate sum itself is always computed over whatever is present, matching how this format has always worked (unchanged by this mission).

## Rx/Variant Behavior

Untouched — `sortSectionLogs`/`rankResultsForWorkout` already scope ranking per `variant_level` tier (confirmed live: Valentin ranks within "Intermediate," Adrian/Valentina/Ergun rank within their own "Mixed Categories"/RX group, completely separate leaderboards) — no change to tier logic, only to the score each tier's ranking now correctly receives.

## Gender Filters

Untouched — "Toți / Masculin / Feminin" filters operate on the already-ranked list this fix corrected; no gender-specific logic exists in `computeSetsScore`/`resolveSetsScoringMode`.

## Legacy Data

**Exactly one production row affected platform-wide**, confirmed by direct audit query across `workout_sections` (V2), `wods` (legacy, both primary and `skill`/`skill2` slots), and spot-checked `custom_hero_wods` — no other `Tabata`/`Intervals` row anywhere in production has a `format_config` missing `scoringMode`. No historical mutation performed or required — the fix is a pure read-time derivation, so this one row (and any future row in the same state) is corrected automatically on every read, with zero backfill.

## Historical Safety

No production data was modified during this investigation or fix — confirmed via read-only queries throughout, and the fix itself never writes anything (pure functions only). The one real row's own `sets`/`format_config` remain byte-identical to before this mission; only its *derived* score changed, correctly.

## Cross-Client Parity

Verified live, independently, in both clients against the same real data: WOD-SIMPLE Clasament shows `606 reps` (Total, breakdown-then-total layout); forge-admin-web's Programming/Results view shows `606` for the same member, same tier, same format — both derived via the same fix pattern (`resolveSetsScoringMode`), ported line-for-line, never shared code.

## Performance

Zero new queries — `resolveSetsScoringMode` operates on already-in-scope `formatId`/`config` values (a single object-property lookup against the in-memory format catalog); no per-member or per-round network call anywhere in the fix.

## Security

No security-relevant surface touched — pure display/scoring functions, no new write path, no new RLS-relevant table or column.

## Tests

WOD-SIMPLE: 10 new tests (`workoutFormats.test.js`, `resolveSetsScoringMode`/`computeSetsScore` schema-default fallback, the real 606 example, zero/missing-component cases, format-independence) + 4 new tests (`isWeightScoredSetsFormat` with `formatId`) + 1 new test (`FormatConfigEditor.test.jsx`, Intervals select shows the correct default) = **15 new tests**. forge-admin-web: 5 new tests (`ranking.test.ts`, including the real 606 example ranked against a second member) + 1 new test (`FormatConfigEditor.test.tsx`) = **6 new tests**. Total: **21 new tests**, all passing.

## Build/Lint/Type-check

WOD-SIMPLE: full suite 724/724 relevant tests passing (9 pre-existing, unrelated Deno edge-function test files still fail to resolve `@std/assert` under vitest/node — present before this mission, unrelated); `npx eslint` on every modified file: 0 errors (11 pre-existing warnings elsewhere in `App.jsx`, unrelated to this mission's changes). forge-admin-web: full suite 952/952 passing; `npx tsc -b --force` clean (exit 0); `npx eslint` on every modified file: 0 errors, 0 warnings.

## Migration Status

**None.** Confirmed per the mission's own explicit preference — no new column, no new table, no schema change of any kind. The fix is entirely a read-time resolution correction plus a UI default-display correction.

## Production Deployment

WOD-SIMPLE: commit `9ed6593` — "fix(scoring): resolve scoringMode against schema default - Total/Lowest Reps, Total/Max Weight." Deployed to production (`https://forge-delta-ivory.vercel.app`), verified via `vercel ls` showing a fresh Ready deployment matching the push. `app_version.current` bumped (`total-reps-scoring-fix-20260816`) so already-open PWA sessions pick up the fix without waiting for the normal cache window. forge-admin-web: commit `ccde44d` — matching message, same day. Deployed to production (`https://forge-admin-web.vercel.app`), verified via `vercel ls`.

## Production Acceptance

Both required scenarios verified live, against real data, through the actual deployed UI (no synthetic test workout was needed — the real production symptom itself served as the acceptance case):
1. **forge-admin-web**: `/programming/2026-08-14` → Intermediate tier → "Valentin Viorel Oita Bucur — 606," ranked #1 (previously unscored).
2. **WOD-SIMPLE**: Clasament, date 2026-08-14 (service worker unregistered + caches cleared first, per this session's own established verification practice) → Intermediate tier → collapsed card "606 reps" → expanded card confirms the exact required breakdown-then-TOTAL layout, screenshotted.

## Original 606-rep Result Verification

Confirmed both textually (`get_page_text`) and visually (screenshot): `Rundă 1..6` show `115/14/185/26/233/33 reps` respectively, followed by a horizontal separator and `TOTAL 606 reps` — the original real member's real data, untouched, now displaying correctly.

## SQL Verification

Read-only throughout — no writes performed. Confirmed via direct query that exactly one `workout_sections`/`wods` row (this one) had a `Tabata`/`Intervals` format with `format_config` missing `scoringMode`; confirmed the row's `sets` JSON is unchanged from before this mission (byte-identical `id`s, values).

## No-Synthetic-Result Proof

No new row was created anywhere — the fix corrects derivation of an existing, real, already-logged result; `wod_logs.id = 63013f14-...` is the same row before and after, with the same `sets` payload. No second "total" row, no `_shadow` result, nothing.

## Cleanup

Nothing to clean up — no test data was created during this investigation; the real production row used for verification was pre-existing and was never modified (read-only throughout).

## Known Limitations

- forge-admin-web's `ScoreDisplay`/`ResultRow` has **no round-by-round breakdown UI at all** (confirmed by direct code search — `parseWorkoutLogDetails`'s `setsParts` is computed and tested but never rendered anywhere in `results/`). The "breakdown → TOTAL" reordering requirement (§19) therefore only applies structurally to WOD-SIMPLE, which already had a breakdown UI to reorder. Adding a new breakdown section to forge-admin-web was deliberately not done — that would be introducing new UI, not fixing existing UI, and no real symptom (this mission's own production example is PWA-only) asked for it. Disclosed explicitly rather than silently scoped out.
- The pre-existing `logged_at` tiebreak (used platform-wide for equal scores) was left unmodified — out of this mission's scope, disclosed above under Ties.

## Deferred Scope

Not touched, per the mission's own explicit exclusions: Workout Aggregation's own `aggregate_definition`/leaderboard code (only its shared dependency, `isWeightScoredSetsFormat`, received the correctness fix — no Aggregation behavior itself changed), Competition standings, Segment, Attempt, PR system, Rx engine's own classification logic, completion_state, attendance, memberships.

## Final Verdict

Root cause found, fixed at the correct domain layer (not a UI special case), generalized correctly across the existing scoring taxonomy (not invented), verified live against the exact real production symptom in both clients. Workout Aggregation was correctly identified as the wrong tool for this problem and was not used.

## Final Response

1. Root cause: `computeSetsScore` read `config.scoringMode` literally and returned `null` when absent, instead of falling back to the format's own schema-declared default — compounded by a real, independent UI bug (`FormatConfigEditor`'s `SelectField` showing `options[0]` instead of the schema default, and never persisting the field unless explicitly touched).
2. Real workout format: `Intervals`, `format_config: {rounds: 6}`, no `scoringMode` persisted.
3. Canonical scoring semantic: `scoringMode`, resolved default `'Total Reps'` (schema-declared, `required: true`).
4. "6 sets" was: a purely descriptive component count (`t.jurnalSetsCountLabel`), never the athletic score — confirmed possibility C.
5. 606 reps is the correct athletic score: yes, confirmed (sum of all 6 logged rounds, matching the resolved `'Total Reps'` semantic).
6. Ranking previously used: neither 606 nor "6" — the member's `_setsScore`/rank score was `null` (unscored), sorted to the bottom via the comparator's own null-handling.
7. Ranking was previously wrong: yes — an unscored/bottom-ranked member who had, in fact, logged a real, complete, high-value result (606 reps, likely a strong result for this workout).
8. 606 was not previously stored anywhere — it was always fully derivable from the persisted `sets` data, just not being derived correctly.
9. Persisted vs derived: derived, unchanged architecture — no new field, no migration.
10. Universal rule implemented: `resolveSetsScoringMode(formatId, config)` = configured value, or the format's own schema-declared default, or null — single source of truth for both scoring and unit-display.
11. Not format-hardcoded: the function takes `formatId` only to look up that format's own schema entry — it contains no `if (formatId === 'Intervals')` branch anywhere; Tabata, and any future `family:'sets'` format with a declared `scoringMode` default, are covered identically.
12. Cases now using this rule: any `family:'sets'` format with a `scoringMode` config field whose persisted config is missing the key — currently Tabata and Intervals in practice (EMOM/Complex have no declared default, so the fallback resolves to `null` for them too, correctly).
13. Cases explicitly NOT using it: Complex, EMOM (no schema default — absence stays absence, correctly falling back to weight scoring); Weightlifting/Strength Sets/Build to Heavy/Superset/Death By Weight (no `scoringMode` field at all); Death By (different mechanic entirely, out of scope).
14. PWA behavior: collapsed card shows `"606 reps"`; expanded card shows the round breakdown followed by a `TOTAL` block; unit suffix correctly omitted for reps-scored results (was previously always appending kg/lbs, a second real bug this audit found and fixed).
15. Admin behavior: `ScoreDisplay` headline shows `"606"`; no round breakdown UI exists in Admin to reorder (disclosed as a known limitation, not a gap in this fix).
16. Collapsed-card behavior: score is directly visible without expanding, matching each client's own existing convention.
17. Expanded-card behavior: verified live, exact required layout.
18. TOTAL confirmed at the END: yes, screenshotted, live production data.
19. Round/Set display decision: `"Set N:"` prefix removed only for `simpleReps` formats with exactly one set per round; preserved for formats with genuinely repeatable sets.
20. Tie behavior: unchanged, pre-existing platform-wide `logged_at` tiebreak, out of scope.
21. Zero behavior: a legitimate `0` reps counts in the sum; verified by test.
22. Missing-component behavior: an empty/unparseable reps value is excluded from the sum, never coerced to `0`; verified by test.
23. Partial-result behavior: sums over whatever valid rounds are present; unchanged pre-existing mechanism.
24. Rx/variant behavior: unchanged — tiers remain separately ranked, confirmed live (Intermediate vs Mixed Categories/RX).
25. Gender-filter behavior: unchanged, no gender-specific logic in the fix.
26. Legacy-row behavior: exactly one production row affected platform-wide, confirmed by audit query; now corrects automatically on read.
27. Historical-data impact: none — zero rows were mutated; the fix is a pure read-time derivation.
28. Backfill: none performed, none required.
29. Migration status: none.
30. Synthetic-result status: none created — same real row, same real data, before and after.
31. Workout Aggregation impact: not used to solve this problem (would have been architecturally wrong, per the mission's own explicit warning); its own `classifySectionMetric` received the same underlying correctness fix via its existing dependency on `isWeightScoredSetsFormat`, with zero behavior change to Aggregation itself.
32. Performance impact: none — zero new queries, pure in-memory schema lookup.
33. Security impact: none — no new write path, no new table.
34. New test count: 15 (WOD-SIMPLE) + 6 (forge-admin-web) = 21.
35. Full test counts: WOD-SIMPLE 724/724 relevant (9 pre-existing unrelated Deno failures); forge-admin-web 952/952.
36. Type-check/lint/build status: `tsc -b --force` clean; `eslint` clean on every modified file in both repos; both production builds succeed.
37. Deployment status: WOD-SIMPLE `9ed6593` live, `app_version` bumped; forge-admin-web `ccde44d` live.
38. Production scenario verified: yes, both clients, live, real data.
39. Original 606-rep result verified: yes, screenshotted, exact required layout confirmed.
40. Cross-client parity: confirmed, both clients show `606` for the same real member/result.
41. SQL verification: read-only confirmation that exactly one row was affected and remains unmutated.
42. Cleanup: nothing to clean up — no test data was created.
43. Known limitations: disclosed (forge-admin-web has no round-breakdown UI to reorder; pre-existing tiebreak left unmodified).
44. Report path: `TOTAL_REPS_SCORING_AND_LEADERBOARD_INVESTIGATION_REPORT.md` (WOD-SIMPLE root).
45. Commit hashes: WOD-SIMPLE `9ed6593`; forge-admin-web `ccde44d`.
46. Working-tree/origin status: both clean of this mission's changes, both pushed to `main`, both verified deployed.

### A. Is TOTAL_REPS now modeled as a universal scoring semantic rather than a special-case UI calculation?
**YES.** It was always a domain-layer semantic (`scoringMode`); the fix makes its resolution correct and universal (schema-default-aware), never a UI-layer calculation.

### B. For every workout whose canonical scoring contract is TOTAL_REPS, will Forge now derive/rank/display the total correctly regardless of the workout format?
**YES**, for every format that declares `scoringMode` with `'Total Reps'` as an option and either an explicit config value or a schema default (currently Tabata, Intervals). No unsupported case exists within the current taxonomy — formats without a `scoringMode` field at all (Weightlifting, Strength Sets, etc.) correctly never apply Total Reps, by design, not by gap.

### C. Can Forge distinguish TOTAL_REPS from SCORE_EACH_ROUND / BEST / WORST / AVERAGE so that it does not invent totals where they do not belong?
**YES**, for the semantics the current taxonomy actually supports: TOTAL_REPS (`'Total Reps'`) vs WORST (`'Lowest Reps'`, the closest existing "worst round" primitive) vs "no scoring mode" (Complex/Weightlifting, correctly never totaled). `SCORE_EACH_ROUND`, `BEST_REPS`, and `AVERAGE` are not currently representable `scoringMode` values in Forge's taxonomy at all — confirmed by direct schema inspection, not a gap this mission's real symptom required closing (no production case needed them), and not invented per the mission's own "reuse, don't invent" instruction.

### D. Is the original production example now correctly displayed with TOTAL / 606 reps at the END of the breakdown?
**YES.** Verified live, screenshotted, in production: `Rundă 1..6` (115/14/185/26/233/33 reps) followed by `TOTAL 606 reps`, in that exact order, in WOD-SIMPLE's Clasament.
