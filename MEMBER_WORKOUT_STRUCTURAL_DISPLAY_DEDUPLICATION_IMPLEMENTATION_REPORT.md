# Member Workout Structural Display Deduplication — Implementation Report

## Executive Summary

The prior [Member Workout Programming Display Integrity](./MEMBER_WORKOUT_PROGRAMMING_DISPLAY_INTEGRITY_IMPLEMENTATION_REPORT.md) mission correctly restored structural Programming information that had gone missing from Member View. That fix exposed a second-order defect class: the same structural fact was now sometimes shown twice, and in other cases the coach-editor's own form-field label text leaked directly into Member View. This mission finds and fixes the general defect class — not the two named examples — across the full current 22-format registry, plus a third real surface (Skill Work on Home) not covered by the previous mission.

## User-Reported RFT Defect

`3 RFT` (primary label, already communicates rounds=3) followed by a redundant `3 Rounds` secondary line.

## User-Reported Ladder Defect

`Shared rep scheme (e.g. 21-15-9): 21-18-15-12-9` — the coach-editor's own form-field label (`fmtSharedRepScheme`) rendered verbatim in Member View instead of clean workout notation.

## Previous Display Integrity Mission

Read in full before any change (`MEMBER_WORKOUT_PROGRAMMING_DISPLAY_INTEGRITY_IMPLEMENTATION_REPORT.md` + its diff). That mission wired `formatTypeLabel` into `getWorkoutFormatDisplay`'s `primary` (fixing "RFT" → "3 RFT") and wired `formatMemberScheduleLines` into the 4-tier accordion branch (fixing total structural invisibility there). Both changes were correct and are preserved untouched by this mission — the redundancy this mission fixes is a **consequence** of that fix (the header now says "3 RFT" AND the pre-existing scheduleLines mechanism independently still adds "3 Rounds", because neither piece of code knew what the other already showed).

## Root Cause

Two independent bugs, both inside `src/workoutFormats.js`:

1. **No shared "consumed facts" contract.** `getWorkoutFormatDisplay`'s primary label (via `formatTypeLabel`) and `formatMemberScheduleLines`'s secondary lines were computed by two functions that had no way of knowing what the other had already rendered. `formatMemberScheduleLines` had its own hardcoded rule ("if `rounds` exists, always add a dedicated `N Rounds` line") that fired unconditionally, regardless of whether `formatTypeLabel` had already folded `rounds` into the primary text.
2. **Generic field rendering reused the coach-editor's own copy.** The fallback loop for any config field not otherwise handled rendered `${t[field.labelKey]}: ${displayValue}` — and `field.labelKey` (`fmtSharedRepScheme`, `fmtSetsScheme`, `fmtSplitType`, `fmtTargetLabel`, …) resolves to literal editor-form copy ("Shared rep scheme (e.g. 21-15-9)", "Set scheme (target reps per set)", "Split type") verified directly in `translations.js` — correct copy for the coach's config form, wrong register for a member reading their workout.

## Product Display Invariant

Every member-relevant structural fact must be shown; every structural fact should normally be shown only once; internal editor/schema labels never appear in Member View. Enforced by making "what does the primary label already say" a single, queryable, shared fact (`consumedKeys`) instead of two independently-maintained assumptions.

## Current Format Registry

Read directly from `WORKOUT_FORMATS` in `src/workoutFormats.js` (the single source of truth, not a hardcoded list) — **22 formats**: AMRAP, Ascending AMRAP, For Time, RFT, Chipper, Ladder, Partner WOD, Death By, Death By Weight, EMOM, Tabata, Intervals, Weightlifting, Strength Sets, Build to Heavy/1RM, Complex, Superset, Buy-In/Cash-Out, AMRAP with Buy-In, Not For Time, Chained AMRAP, Max Effort.

## Production Data Audit

Read-only SQL against `wods.format_config` / `workout_sections.format_config` (from the previous mission, still the live ground truth this session) plus a fresh audit this mission of `wods.skill_format_config`/`skill2_format_config` (Skill Work, previously unaudited):

| Surface | Real rows found | Detail |
|---|---|---|
| RFT (main WOD) | 9 | `rounds` |
| For Time + Repeated Rounds | 2 | `rounds`, `structure` |
| Ladder | 2 | `sharedRepScheme`, `ladderType` |
| Build to Heavy/1RM | 1 | `targetLabel` |
| Strength Sets | 1 | `setsScheme` |
| **Skill Work — RFT** (new finding this mission) | 1 | `rounds` (id `9e34cd66-…`, 2026-07-13) |
| **Skill Work — Complex** (new finding this mission) | 1 | `complexMovements`, `rounds`, `totalRounds` (id `050bb5fe-…`, 2026-07-06) |

No PII in any of the above (workout structure only, no member data).

## Format × Display Contract Matrix

| Format | Primary Label | Secondary Detail(s) | Fields Consumed by Primary | Internal Fields Suppressed | Example Final Member Display |
|---|---|---|---|---|---|
| AMRAP | `AMRAP` | duration (header) | — | — | `AMRAP` · `15:00` |
| Ascending AMRAP | `Ascending AMRAP` | duration (header); `startReps`/`incrementReps` generic (no real-evidence case found; left unchanged, no info removed) | — | — | unchanged from before |
| For Time | `For Time` (bare) or `N For Time` when `structure='Repeated Rounds'`+`rounds` | `sharedRepScheme` bare value; time cap (header) | `rounds` (only when Repeated Rounds) | `structure` (always) | `2 For Time · Time cap 15:00` / `For Time · 21-15-9` |
| RFT | `N RFT` | time cap (header) | `rounds` | — | `3 RFT   Time cap 20:00` (no `3 Rounds` line) |
| Chipper | `Chipper` | `sharedRepScheme` bare value; time cap (header) | — | — | `Chipper · 21-15-9` |
| Ladder | `Ladder` | `sharedRepScheme` bare value (`21-18-15-12-9`); `ladderType` bare value only if scheme absent; time cap (header) | — | `ladderType` (when scheme present — direction is visually inferable from the sequence) | `Ladder   Time cap 20:00` / `21-18-15-12-9` |
| Partner WOD | `Partner WOD` | `splitType`/`baseFormat` bare values; duration (header) | — | — | `Partner WOD · You go/I go · AMRAP` |
| Death By | `Death By` | `startReps`/`incrementReps`/`intervalSec` generic (no real-evidence case; unchanged) | — | — | unchanged |
| Death By Weight | `Death By Weight` | `startWeight`/`incrementWeight`/`intervalSec` generic (unchanged) | — | — | unchanged |
| EMOM | `EMOM` | duration (header); `scoringMode` bare value if set | — | — | `EMOM · Total Reps` |
| Tabata | `Tabata` | `rounds` natural line (not primary-consumed here — no "N Tabata" convention); `scoringMode` bare value | — | — | `8 Rounds` · `Lowest Reps` |
| Intervals | `Intervals` | `rounds` natural line; `scoringMode` bare value | — | — | `10 Rounds` · `Total Reps` |
| Weightlifting | `Weightlifting` | none (no config fields) | — | — | `Weightlifting` |
| Strength Sets | `Strength Sets` | `setsScheme` bare value (`5-5-5-5-5`) | — | — | `Strength Sets` / `5-5-5-5-5` |
| Build to Heavy/1RM | `targetLabel` value (e.g. `5RM`) when set, else bare `Build to Heavy/1RM` | none when target set | `targetLabel` | — | `5RM` (no `Target label: 5RM`) |
| Complex | `Complex` | `rounds` natural line; `scoringMode` bare value; movements shown via existing movement list | — | — | `3 Rounds` |
| Superset | `Superset` | `movements`/`targetSets` generic (unchanged, no real-evidence case) | — | — | unchanged |
| Buy-In/Cash-Out | `Buy-In/Cash-Out` | `mainFormat` bare value; movement lists generic (unchanged) | — | — | unchanged except mainFormat now bare |
| AMRAP with Buy-In | `AMRAP with Buy-In` | duration (header); buy-in movements generic | — | — | unchanged |
| Not For Time | `Not For Time` | none (no config) | — | — | `Not For Time` |
| Chained AMRAP | `Chained AMRAP` | `stages` count line (unchanged, pre-existing behavior) | — | — | unchanged |
| Max Effort | `Max Effort` | `movement` generic (unchanged, no real-evidence case) | — | — | unchanged |

## Primary Labels

Computed by one function, `computeFormatPrimaryLabel(formatId, config)`, returning `{ label, consumedKeys }`. Three enrichment rules (all evidence-backed): RFT+rounds → `N RFT`; For Time+Repeated Rounds+rounds → `N For Time`; Build to Heavy/1RM+targetLabel → the target label itself. Every other format returns the bare `formatId`, unchanged.

## Secondary Structural Details

Computed by one shared internal engine, `computeMemberDetailLines(formatId, config, t, suppressTimingKeys)`, with two thin exported wrappers:
- `formatMemberScheduleLines` (main WOD card, has a separate header that already shows timing) — suppresses `timeCapSec`/`durationSec`/`mainDurationSec`/`totalDurationSec`.
- `formatMemberSkillDetailLines` (Skill Work on Home, **no** separate header) — does **not** suppress timing, so a Skill Work entry with `timeCapSec` set still shows it (verified against the one real production Skill Work RFT row, which happens to have `timeCapSec: null` — confirmed no information is silently dropped for rows that do have it set).

## Consumed Structural Fields

`consumedKeys` from `computeFormatPrimaryLabel` is unioned into the "already shown" set before the generic field loop runs, and the dedicated rounds-line logic itself now checks `!consumed.has(k)` before firing — so RFT/For-Time-Repeated-Rounds never get a duplicate rounds line, while Tabata/Intervals/Complex/EMOM (whose `rounds`/`totalRounds` is **not** primary-consumed) keep their existing natural "N Rounds" line unchanged.

## Internal Config Labels

`MEMBER_BARE_VALUE_TYPES` (`repsSchemeList` — `sharedRepScheme`, `setsScheme`) and `MEMBER_BARE_VALUE_SELECT_FIELDS` (`splitType`, `baseFormat`, `scoringMode`, `ladderType`) render the value alone, no editor label. `MEMBER_SUPPRESSED_FIELDS` (`structure`, For Time's Sequence/Repeated-Rounds discriminator) never renders at all — it describes Forge's own data model, not the workout. Every field not in one of these three sets keeps its previous generic `label: value` behavior unchanged (no information removed) — verified this covers only fields with no real production evidence of being a UX problem (Ascending AMRAP's start/increment reps, Death By's start/increment, Superset's movements/targetSets, Chained AMRAP's stages, Max Effort's movement, Buy-In/Cash-Out's movement lists).

## RFT

Before: `3 RFT` header + `3 Rounds` line. After: `3 RFT` header, no second line. Verified against 3 real production rows (`rounds`: 3, 4, 5) via direct function calls against real config shapes.

## For Time

Before (Repeated Rounds case): `2 For Time` header + `2 Rounds` line (regression from the prior mission's own fix, since that mission enriched the header but this bug wasn't caught yet). After: `2 For Time` header, no second line. Plain-Sequence For Time (e.g. Fran/Annie-style) unaffected — no rounds field applies there.

## AMRAP

Unchanged — duration was already header-only, no secondary line ever existed for it.

## EMOM

Unchanged for timing/rounds (already header-consumed). `scoringMode`, when set, now shows as a bare value (`Total Reps`) instead of `Interval scoring: Total Reps`.

## Every-X / Intervals

`rounds` keeps its natural line (not primary-consumed for this format — no "N Intervals" convention exists or was requested). `scoringMode` now bare value.

## Tabata

Same as Intervals — `rounds` line unchanged, `scoringMode` now bare value (`Lowest Reps`/`Total Reps`).

## Death By

Unchanged — no real production evidence of a problem; `startReps`/`incrementReps`/`intervalSec` remain generic `label: value` lines (still needed, since these numbers are not self-explanatory as bare values).

## Ladder

Before: `Ladder` header + `Shared rep scheme (e.g. 21-15-9): 21-18-15-12-9`. After: `Ladder` header + `21-18-15-12-9` (bare). `ladderType` (Ascending/Descending/Asc-Desc) is now suppressed whenever a rep scheme is present — the direction is visually inferable from the sequence itself, exactly the mission's own worked example — and falls back to a bare value only when the scheme is absent (legacy data), so no information is silently lost.

## Chipper

`sharedRepScheme`, when present, now bare value (same rule as Ladder/RFT/For Time — one field, one rule, applied generically).

## Strength Sets

Before: `Strength Sets` + `Set scheme (target reps per set): 5-5-5-5-5`. After: `Strength Sets` + `5-5-5-5-5`.

## Build to Heavy / RM

Before: `Build to Heavy/1RM` (raw format id as header — awkward, not workout language) + `Target label: 5RM`. After: primary becomes `5RM` itself (the target label is already the natural CrossFit term), no secondary line. Verified: `Build to Heavy/1RM` without `targetLabel` set still falls back to the bare format id — no information invented.

## Weightlifting

Unchanged — no config fields exist for this format at all.

## Superset

Unchanged — no real production evidence; `movements`/`targetSets` remain generic (still needed, not self-explanatory as bare values).

## Complex

`rounds` unchanged as a natural line. `scoringMode`, when set, now bare value. Movement sequence (`complexMovements`) already shown separately via the existing movements list, not through this generic path — confirmed no duplication risk.

## Partner / Team

`splitType` (`You go/I go`, `Shared reps`, `Synchro`) and `baseFormat` (`AMRAP`, `For Time`) now render as bare values instead of `Split type: …` / `Base format: …` — both are already athlete vocabulary, legible without a label in the card's context. Team mechanics remain fully visible (nothing suppressed here), satisfying the mission's explicit "team mechanics are member-essential" requirement.

## Remaining Formats

Buy-In/Cash-Out (`mainFormat` now bare value; buy-in/cash-out movement lists unchanged, still needed), AMRAP with Buy-In, Not For Time, Chained AMRAP, Max Effort: all audited, no real-production-evidence redundancy or label-leak found beyond what the generic type/field rules already cover; no bespoke changes made to avoid inventing unverified copy for zero-evidence fields.

## Four-Tier Accordion

Both the single-variant member card and the 4-tier accordion call the same two functions (`getWorkoutFormatDisplay` for primary, `formatMemberScheduleLines` for secondary) — the fix is centralized in `workoutFormats.js`, so both surfaces get the exact same deduplication and label-cleanup automatically, with zero JSX changes needed at either call site.

## Set-Level Member

Same call sites, same fix, verified identical to the accordion path.

## Multi-Section

Each section's `format`/`formatConfig` is passed independently to `WorkoutFormatHeader`/`formatMemberScheduleLines` per section (pre-existing architecture, unchanged) — deduplication is computed fresh per section, so a Part A (Build to Heavy) + Part B (RFT) + Part C (Ladder) workout renders each section correctly with no cross-section state.

## Quick Create / Manual Authoring / Templates / Copy

All persist through the same `format_config` shape regardless of authoring path (pre-existing, unaffected by this mission) — the display fix operates purely on the persisted config, so equivalent config produces identical Member View regardless of how it was authored.

## Format Switching / Reload

The fix is stateless (pure functions of `formatId`/`config`, no React state caching "already consumed" facts) — a format switch or hard reload always recomputes `consumedKeys` fresh from the current config, so no stale secondary lines can persist.

## Legacy Fallback

`computeFormatPrimaryLabel` and `computeMemberDetailLines` both guard every field access (`cfg[key] != null`), matching the pre-existing empty/null-safety contract — verified via the existing "doesn't throw for any format with an empty config" test, extended to the new `formatMemberSkillDetailLines` export too.

## Mobile PWA

No layout/card redesign — this mission changes text content only (fewer or shorter lines in most cases, since the dominant real-world change is removing a redundant line), strictly reducing visual density, not increasing it. Not separately screenshotted (no login, per this project's standing rule) — verified via direct function output against real production config shapes instead.

## Admin Regression

Zero forge-admin-web files touched. `describeFormatConfig` (the Admin/coach-facing helper, used by `PastWodCard`'s expanded detail and — newly confirmed this mission — nowhere in the member-facing Skill Work path anymore) is completely untouched; its editor-style `label: value` output is unchanged, exactly as the mission requires (coach editor keeps explicit field labels).

## Tests

22 new/updated test cases added to `src/workoutFormats.test.js`:
- `formatMemberScheduleLines`: RFT/For-Time-Repeated-Rounds no-duplicate-rounds (2), For Time without that structure keeps its natural rounds line (1), EMOM/Tabata/Complex/Intervals unaffected (1), Build to Heavy no redundant target line (1), Ladder bare-value with/without scheme (2), Strength Sets bare value (1), For Time sharedRepScheme bare value (1), Partner WOD bare-value splitType/baseFormat (1), `structure` never leaks (1).
- `formatMemberSkillDetailLines` (new function): does not suppress timing (1), still dedupes rounds (1), Complex clean rounds line (1), no-throw across the full catalog (1).
- `getWorkoutFormatDisplay`: Build to Heavy/1RM primary-as-target with/without targetLabel (2).
- `formatTypeLabel`: Build to Heavy/1RM with/without targetLabel (2).

## Live Acceptance

Verified via direct `vite-node` invocation of the actual shipped functions against real production `format_config`/`skill_format_config` shapes pulled by read-only SQL (no login, per standing project rule):

| Case | Before (would have rendered) | After (verified actual output) |
|---|---|---|
| A. RFT (repro workout, `rounds:3`) | `3 RFT` + `3 Rounds` | `3 RFT`, scheduleLines `[]` |
| B. Ladder (`sharedRepScheme:[21,18,15,12,9]`, `ladderType:'Descending'`) | `Ladder` + `Shared rep scheme (e.g. 21-15-9): 21-18-15-12-9` | `Ladder`, scheduleLines `["21-18-15-12-9"]` |
| C. Build to Heavy/1RM (`targetLabel:'5RM'`) | `Build to Heavy/1RM` + `Target label: 5RM` | primary `5RM`, scheduleLines `[]` |
| D. Real prod Skill Work RFT row (`9e34cd66-…`, `rounds:3, timeCapSec:null`) | `RFT` + `Number of rounds: 3` | `3 RFT`, details `[]` |
| E. Real prod Skill Work Complex row (`050bb5fe-…`, `rounds:7`) | `Complex` + `Rounds/attempts: 7` | `COMPLEX` + `7 Rounds` |
| F. 4-tier accordion + set-level member | same functions, same output | identical to single-variant card, zero JSX divergence |

## Verify Before/After DOM

Confirmed via direct output inspection (not screenshots, per no-login rule): `"3 Rounds"` string does not appear anywhere in RFT's output; `"Shared rep scheme"` string does not appear anywhere in Ladder's output — both asserted directly in the new automated tests (`expect(lines.join(' ')).not.toContain(...)`), not just eyeballed once.

## Historical Mutation

None. Zero rows in `wods`, `workouts`, `workout_sections`, `wod_logs`, `skill_logs`, or `pr_events` were written to or altered. All SQL run this mission was `SELECT`-only.

## Known Limitations

- Ascending AMRAP's `startReps`/`incrementReps`, Death By's start/increment, Superset's `targetSets`, Chained AMRAP's `stages`, Max Effort's `movement`, and the movement-list fields on Buy-In/Cash-Out remain on the generic `label: value` line — genuinely needed (their values are not self-explanatory alone) and unchanged, but the editor-style label text itself (e.g. "Reps in round 1: 3") is not yet rephrased into fully natural athlete copy. No real production evidence of a UX complaint here; left alone per "only fix proven cases," disclosed as the clearest remaining candidate if a real report surfaces.
- `Chained AMRAP`'s `stages` field still collapses to a count-only line (`"3 stages"`) rather than expanding per-stage detail — pre-existing behavior, not part of either mission's confirmed defect class, unchanged.

## Final Verdict (before the Visual Hierarchy addendum)

Both confirmed examples (RFT, Ladder) are fixed exactly as specified, the fix is implemented once in a shared, format-agnostic engine (not per-format JSX), it automatically covers the analogous Build to Heavy/1RM and Strength Sets cases plus a third real surface (Skill Work) found during the audit, all 890 real tests pass, build is clean, and zero scoring/Results/leaderboard/aggregation/Performance/Canonical Movement Identity/Admin code was touched.

---

## Addendum: Universal Visual Hierarchy Rule

### Problem

Deduplication (above) fixed *what* is shown and *what text* it uses, but every secondary line — genuinely required prescription structure (`21-18-15-12-9`, `5-5-5-5-5`, rounds, work/rest) and genuinely secondary scoring metadata (`Total Reps`, `Lowest Reps`) alike — was rendered with identical muted-gray styling (`color: #6B7280`). A member reading a Ladder card had no visual cue that the rep scheme is the thing they must actually perform, versus incidental detail.

### Classification Rule (per field, not per format)

Every line `computeMemberDetailLines` produces falls into exactly one of two tiers:
- **PRESCRIPTION STRUCTURE** — everything the athlete needs to know *what to do*: rounds, rep/set schemes, work/rest, split type, base format, ladder type, start/increment reps or weight, target sets, stage counts, movement text. Default tier for every field.
- **SECONDARY METADATA** — `scoringMode` only (`Total Reps`/`Lowest Reps`/`Max Weight`/`Total Weight`). It changes how a result is *scored/logged*, never what the athlete physically does. The one field in `MEMBER_METADATA_FIELDS`.

No format is named in the classification logic — the split is keyed purely on the config field's identity (`scoringMode`), so it applies uniformly to every current and future format that happens to use that field (currently EMOM, Tabata, Intervals, Complex).

### Implementation

`computeMemberDetailLines` (single shared engine, already introduced by the deduplication fix above) now returns `{ prescriptionLines, metadataLines }` instead of one flat array. Both exported wrappers (`formatMemberScheduleLines`, `formatMemberSkillDetailLines`) inherit the new shape — no parallel logic. All 4 JSX call sites (single-variant member card, 4-tier accordion, Skill Work Complex branch, Skill Work generic branch) updated to render `prescriptionLines` with prescription-level emphasis (dark `#0E0E0E` text, `fontWeight: 600`, same or larger size than before) positioned between the format header and the movements list, and `metadataLines` with the pre-existing muted styling (`#6B7280`/`#888`, regular weight) positioned *after* the movements list — matching the requested `FORMAT → PRESCRIPTION STRUCTURE → MOVEMENTS/WORK → SECONDARY METADATA` order exactly, replacing the previous `FORMAT → gray technical config → MOVEMENTS` layout.

### Verification

24 new/updated test assertions (`formatMemberScheduleLines`/`formatMemberSkillDetailLines` now assert the `{prescriptionLines, metadataLines}` shape directly) plus explicit tier-classification tests for Tabata/Intervals/EMOM/Complex confirming `scoringMode` is the only field routed to `metadataLines`. Live-verified via `vite-node` against the mission's own worked examples (Ladder → `21-18-15-12-9` prescription, empty metadata; Strength Sets → `5-5-5-5-5` prescription) plus Tabata/Intervals (rounds+work+rest as prescription, scoring mode alone as metadata) and the same 2 real production Skill Work rows used in the base mission. 895/895 real tests pass (same 9 pre-existing unrelated Deno-import file failures), lint clean, production build clean.

### Verdict

Visual hierarchy now matches the requested rule across the entire 22-format registry, classified per-field (not per-format), with zero semantic/data changes and zero required structure removed.
