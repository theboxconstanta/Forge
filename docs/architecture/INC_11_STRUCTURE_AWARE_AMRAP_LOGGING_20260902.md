# INC-11 — Structure-Aware AMRAP / Sequential Workout Logging

**Status:** SHIPPED (code) — 2026-09-02
**Scope:** the entire CLASS of workouts where `FORMAT LABEL = AMRAP` but `ACTUAL STRUCTURE ≠ repeated rounds`. No workout-specific code.

---

## 1. Root cause

> Forge selected the AMRAP logger from `format.scoreMode === 'amrap'` alone — a
> catalog constant keyed only on the format label — **rather than from any
> programmed progression structure**. Every workout typed `AMRAP` therefore
> rendered the repeated-round logger (Rounds Completed + Additional Reps),
> whether its body was repeated rounds or a finite ordered sequence.

`AMRAP` had **no structural discriminator**, unlike `For Time` which carries
`config.structure ∈ {'Sequence','Repeated Rounds'}` resolved through
`isSequentialFormat()`.

**Old classifier (exact):**

| Concern | Location |
|---|---|
| Logger shape | `src/FormatLogger.jsx` `ScoredFields` — `if (scoreMode === 'amrap') return <RoundsPartialFields …>` (unconditional early return) |
| `scoreMode` source | `effectiveScoreMode()` / `WORKOUT_FORMATS.AMRAP.scoreMode = 'amrap'` (`src/workoutFormats.js`) |
| Score-definition adapter | `src/scoreDefinition.js` — `mode === 'amrap' → { kind: 'ROUNDS_REPS' }` unconditionally |
| Save composition | `src/App.jsx` `composeWodLogFieldsInner` — `useReps` branch → `composeAmrapResult()` → `"N runde + M"` |
| AI transform | `supabase/functions/analyze-workout/transform.ts` `toFormatConfig` — no `structure` |

Not based on: movement count, movement name, `family`, `rowMode`, `rounds`,
workout id, legacy fallback.

---

## 2. Discovered AMRAP structural taxonomy

| # | Structure | Before INC-11 | After INC-11 |
|---|---|---|---|
| 1 | Repeated-round AMRAP (`5/10/15, repeat`) | Rounds + Additional Reps ✅ | **unchanged** ✅ |
| 2 | Single-movement / max-reps AMRAP | Rounds + Additional Reps (often unrankable) ❌ | Sequence + 1 open station → Total Reps ✅ |
| 3 | Finite sequential / chipper AMRAP (one pass) | Rounds + Additional Reps ❌ | ordered station progress → Total Reps ✅ |
| 4 | **Buy-in + max-reps tail** (THE INCIDENT) | Rounds + Additional Reps ❌ | fixed / fixed / open stations → Total Reps ✅ |
| 5 | Buy-in + repeating tail | `AMRAP with Buy-In` / `Chained AMRAP` — tail rounds only | **unchanged** — see §7 limitations |
| 6 | Multi-stage / chained AMRAP | `Chained AMRAP` family ✅ | **unchanged** ✅ |
| 7 | Ascending/descending ladder AMRAP | `Ascending AMRAP` (`repsForAscendingRound`) ✅ | **unchanged** — `Ascending AMRAP` never gets `structure` ✅ |
| 8 | Mixed-unit sequential (`cal + m + reps`) | Rounds + Additional Reps | **NOT SUPPORTED** — blocked at authoring, classic input as fallback (§7) |

---

## 3. Canonical contract (the fix)

### 3.1 Workout level — `format_config.structure`

New optional field on `WORKOUT_FORMATS.AMRAP.config` (mirrored in
`forge-admin-web/src/features/programming/formatCatalog.ts`):

```
structure: { type:'select', options:['Sequence','Repeated Rounds'],
             required:false, default:'Repeated Rounds', labelKey:'fmtAmrapStructure' }
```

- **Same canonical vocabulary as `For Time`** (owner decision #4a-ii).
- **ABSENT / `'Repeated Rounds'` → exact current behaviour.** Every legacy AMRAP
  is untouched; the flag is **never inferred from movement text** (owner
  decision #31/#65).
- `MEMBER_SUPPRESSED_FIELDS` already hides it from member display.
- No schema change. Frozen automatically into `wod_logs.format_config_snapshot`
  by the existing Slice-2 trigger (`20260812090200`).

### 3.2 Per-station role — FIXED vs OPEN (owner decision #4b)

Derived from **structured evidence**, never from display text:

1. **structured `reps` value** — a resolved `reps` spec with a number > 0 → FIXED
   with that target; `null` (or `mode:'text'`) → OPEN / max station.
2. **legacy text fallback only** — a movement line with a leading rep count
   (`"50 Burpee Pull-ups"` → FIXED 50) for rows with no structured prescription.

"Max Reps" in the movement name is workout INSTRUCTION language and is never the
source of truth. The AI does **not** tag movements — it emits only
`formatConfig.structure`; the client derives roles from each movement's `reps`
(already present in the AI schema — no new enum).

### 3.3 Structural resolver — `src/sequentialAmrap.js`

`resolveSequentialAmrapStations({ instances?, lines? })` → the ONE canonical
ordered station list `[{ index, name, target|null, role:'fixed'|'open', line }]`.
`.supported === false` (`reason:'mixed-unit' | 'empty'`) → callers keep the
classic Rounds+Additional input. Array order **is** the sequence (§67); never
re-sorted. Repeated movement names stay distinct stations by index (§36/§68).

Consumed by: `scoreDefinition.js`, `UniversalScoreInput.jsx`,
`FormatLogger.jsx`, `App.jsx` `composeWodLogFieldsInner`, the Journal + Leaderboard
score display, and the edit re-parse — no surface re-derives structure.

### 3.4 Scoring & persistence

- **Canonical score** = Total Reps = `Σ` completed work, counted once (§41):
  auto-completed prior FIXED targets (§15) + performed reps on the stopping
  station + performed reps on the open station.
- **Frozen result string** reuses the EXISTING sequential grammar
  (`composePartialText`): `"50/50 Burpee Pull-ups, 63/75 Russian KB Swings, 12 Burpee Pull-ups"`.
  A NOT-REACHED station is **omitted**; an explicit `0` is written (`"0 Max …"`)
  — the two are kept distinct in the text (owner decision #3), though the Total
  is identical (0 contributes 0).
- **`completion_state = null`** — an AMRAP clock always expires; not reaching the
  final station is normal, never DNF / capped / modified (§39/§40/§104).
- **`time_result = null`**.
- `partialRepsOfLog(log, true)` reads the Total back — the **existing** sequential
  leaderboard path. `sortSectionLogs` already skips the rounds diff and ranks by
  that sum when `isSequentialFormat` is true. **INC-09 latest-log selection
  untouched.**

### 3.5 Classic repeated-round AMRAP — UNCHANGED (owner decision #5)

`isSequentialAmrap` returns `false` for absent / `'Repeated Rounds'` / `Ascending
AMRAP`. Result stays `"N runde + M"`, ranked rounds-then-partial. No derived
Total Reps shown for classic AMRAP.

---

## 4. Files changed

**PWA (`WOD-SIMPLE`)**
- `src/workoutFormats.js` — `AMRAP.config.structure` field; `isSequentialAmrap()`; `isSequentialFormat()` extended.
- `src/sequentialAmrap.js` — **new** — structural resolver + score/compose/parse helpers.
- `src/SequentialAmrapFields.jsx` — **new** — the stacked-station logger (mobile-first, shared).
- `src/scoreDefinition.js` — `SEQUENTIAL_AMRAP` kind.
- `src/UniversalScoreInput.jsx` — `SEQUENTIAL_AMRAP` branch.
- `src/FormatLogger.jsx` — `ScoredFields` sequential-AMRAP branch (edit / skill / mixed).
- `src/App.jsx` — resolve `sequentialAmrapStations` once; wire into scoreDef + FormatLogger; `composeWodLogFieldsInner` branch; edit re-parse branch; Journal + Leaderboard Total-Reps display.
- `src/translations.js` — `fmtAmrapStructure`, `logWodSequentialStationsLabel`, `logWodMaxRepsStationPrefix`, `logWodSequentialAutoDone`, `logWodTotalRepsLabel` (RO + EN).
- `src/workoutIntelligence.js` — AI `structure` pass-through (AMRAP translator).
- `supabase/functions/analyze-workout/{openaiSchema,transform,prompt}.ts` — `formatConfig.structure`.

**forge-admin-web**
- `src/features/programming/formatCatalog.ts` — `AMRAP.config.structure` (parity).
- `src/features/programming/workoutIntelligence.ts` — AI `structure` pass-through + `AiFormatConfig` type.

**Tests added**
- `src/inc11SequentialAmrap.test.js` (34) — resolver, mixed-unit STOP, Total Reps §69–§76, compose/parse round-trip, leaderboard ranking, score definition.
- `src/inc11SequentialAmrapLogger.test.jsx` (6) — render through `UniversalScoreInput`; classic-AMRAP no-regression.
- `src/workoutIntelligence.test.js` (+2) — AI/manual parity.

---

## 5. Test / regression results

- PWA: `1783 passed` (was 1741 + 42 INC-11). 9 pre-existing Deno edge-function test-file failures (`@std/assert` resolution) — unrelated, 0 test failures.
- forge-admin-web: `1280 passed`, `tsc --noEmit` clean, build clean.
- `deno check supabase/functions/analyze-workout/*.ts` clean.
- eslint: 0 errors on all touched files (pre-existing errors in untouched test files remain).
- PWA + forge-admin production builds succeed.
- Regression suites verified green: INC-04, INC-06, INC-07, INC-08, INC-09, P10, P9.5.6/7/8/8.1, `appHookOrderIntegrity`, `configIntegrity`.

---

## 6. Backward compatibility / historical truth (P10)

- No migration, no backfill, **0 `wod_logs` / snapshot / score mutations**.
- Old AMRAP logs read back through frozen `result` + `format_config_snapshot`.
  A snapshot without `structure` → classic interpretation (unchanged).
- Editing a historical Sequence-AMRAP log resolves stations from the FROZEN
  `format_config_snapshot` + frozen movement lines via
  `parseSequentialAmrapResult` (index-keyed) — never today's workout.
- A coach editing today's workout after an athlete logged cannot re-interpret
  that past entry.

---

## 7. Unresolved / limitations (backlog)

1. **Mixed-unit sequential scoring** (owner decision #2 = 2A). A Sequence body
   mixing calories / distance / reps has **no canonical progress score** in
   Forge. `resolveSequentialAmrapStations` returns `supported:false`;
   `sequentialAmrapMixedUnitConflict` flags it. The Builder should block the
   Sequence + incompatible-units combination (see §8). The logger falls back to
   the classic Rounds+Additional input rather than inventing
   metre + calorie + rep arithmetic. **Tracked as a separate backlog item:**
   *"Canonical mixed-unit sequential (chipper) scoring model"*.
2. **Buy-in + repeating tail** (structure #5) is still served by `AMRAP with
   Buy-In` / `Chained AMRAP`; the buy-in is not tracked as sequential progress.
   Not regressed; not addressed here.
3. **Two FIXED stations with an identical rep count AND identical name** would
   not be independently editable on re-open (positional collision in the frozen
   result text). No such production workout exists; the open/fixed pair in the
   incident is text-distinct.
4. **forge-admin Builder** does not yet render a friendly localized label for
   `fmtAmrapStructure` (shows the raw key, consistent with `fmtForTimeStructure`
   there) and does **not** yet actively block Sequence + mixed-unit authoring —
   the resolver refuses to score it, but a coach-facing warning is a follow-up.

---

## 8. Production incident workout correction (owner decision #1 — AUTHORISED)

The incident workout carries **no** `format_config.structure`. Per §31/§65 it is
**not** auto-reinterpreted. To make it resolve as Sequence "only as a consequence
of the generic model", its DEFINITION must be corrected:

- **How:** in forge-admin Programming, open the workout, set **AMRAP Structure →
  Sequence**, save. This updates `wods.format_config` and the linked Engine V2
  `workout_sections.format_config` together through the validated write path
  (preserves the linked-pair invariant).
- **Strictly:** workout definition only. 0 `wod_logs`, 0 snapshot rewrites, 0
  score rewrites, 0 historical mutations, 0 heuristic correction of other AMRAPs.
- **Identity to prove during smoke:** the `wods` row for the "AMRAP 10:00 / 50
  Burpee Pull-ups / 75 Russian KB Swings / Max Reps Burpee Pull-ups" workout and
  its `workout_sections` primary section.

---

## 9. Owner decisions applied

| # | Decision | Applied |
|---|---|---|
| 1 | One-off definition correction authorised | pending smoke (§8) |
| 2 | 2A — rep-only now; mixed-unit STOP-listed | §7.1 |
| 3 | 3C — preserve not-reached vs 0 in storage, no extra UI | §3.4 |
| 4 | 4a-ii vocabulary + derive fixed/open from structured `reps` (no `targetType` enum) | §3.1 / §3.2 |
| 5 | 5A — classic AMRAP unchanged; Total Reps sequential-only | §3.5 |
