# Per-Movement Prescription Engine — P9.5 Universal Log WOD + Scoring UX + Movement Icons

Date: 2026-08-30
Status: **PHASE A–K complete. Owner-approved 2026-08-30. Universal Log WOD +
adaptive score input + movement-icon system SHIPPED. NO migration, zero
production data. Owner manual acceptance pending.** **P10 NOT STARTED.**

> §A–T below = the pre-implementation audit/architecture (PHASE A–C).
> The **P9.5 IMPLEMENTATION REPORT (PHASE D–K)** is appended at the end.

---

## A. EXECUTIVE SUMMARY

The audit's central finding: **Forge's scoring architecture is already complete
and correct for everything P9.5 needs. P9.5 is a presentation problem, not a
scoring problem.**

| P9.5 requirement | Already exists in Forge? |
|---|---|
| Explicit finished-vs-capped state | ✅ `wod_logs.completion_state` (`completed` / `capped` / null) — migration `20260820100000`, Scoring Phase 0 |
| Structured-enough capped result (rounds + partial reps) | ✅ `result` text `"N runde + 43 Wallball, …"` via `composeAmrapResult`, round-trip-parsed by `parseAmrapResult` / `partialRepsOfLog` |
| "Do not store a fake finishing time" for capped | ✅ capped rows have `time_result = null`; leaderboard never fabricates a time |
| Adaptive score input per workout type | ✅ `FormatLogger.jsx` branches on `format.family` (`scored` / `sets` / `mixed` / `nft` / `chained`) × `scoreMode` (`amrap` / `fortime_or_amrap` / `single_value`) |
| Time-cap config | ✅ `format_config.timeCapSec` (`For Time` / `Chipper` / `Ladder` / `RFT` / `Partner WOD`) |
| Leaderboard: finishers before capped, capped ranked by work, no artificial times | ✅ `sortSectionLogs` (`workoutFormats.js:1314`) — `completion_state`-aware, legacy `!!time_result` fallback |
| Section / skill / multi-section scoring | ✅ `skill_logs`, `_scored` flags, `sortSectionLogs` serves both tables (identical score columns) |
| Frozen logging identity (D+N historical) | ✅ INC-04 `logCtx` / `freezeLoggingContext` / `captureLogCtx` |
| Shared structured workout display | ✅ P9.4 `composeStructuredWorkoutDisplay` |
| Prescription snapshot from frozen doc | ✅ P9.1 `buildPrescriptionSnapshot` |

**What is genuinely missing / the real P9.5 work:**
1. The **Log WOD UI** is visually dated — nested cards, `"TODAY'S WORKOUT"` /
   `"Chosen variant"` labels, colored variant card duplicating `RFT 20:00`,
   `SortableList` drag handles in a read-only context, `"Number of rounds: 3"`
   redundancy, Quick Add time buttons, salmon `#791F1F` section headers.
2. **No explicit `[Finished] [Time Capped]` toggle** — today it is inferred
   from *which field the athlete fills* (`shouldLogRoundsInsteadOfTime`).
3. **No movement icons.**

**Schema determination: NO MIGRATION REQUIRED** (see §C). Scoring reuses
`completion_state` + existing fields. Icons use a client-side
`canonicalMovementId → iconKey` map (the alternative §19 of the brief explicitly
sanctions for V1).

**No production data is mutated. No historical rewrite. Frozen logging identity
and every P9–P9.4 invariant are untouched by a presentation-only redesign.**

---

## B. CURRENT SCORING AUDIT — format → score → storage → save-path → readers

Source of truth: `src/workoutFormats.js` (the format catalog + scoring helpers),
`src/FormatLogger.jsx` (the logger UI), `App.jsx` `saveWodLog` / `saveSkillLog`
/ `composeWodLogFields`, `src/rxEngine.js` + `workoutFormats.js` `sortSectionLogs`
(leaderboard), `workoutAggregation*.js`, `benchmarkHistory.js`.

### B.1 Format families & score modes (`FORMATS` in `workoutFormats.js`)

| `family` | Formats | `scoreMode` | Logger branch | Score semantic |
|---|---|---|---|---|
| `scored` | AMRAP, Ascending AMRAP | `amrap` | `RoundsPartialFields` | rounds completed + partial reps per movement |
| `scored` | For Time, RFT, Chipper, Ladder, Partner WOD | `fortime_or_amrap` | `TimeResultFields` + (mutually exclusive) `RoundsPartialFields` / `SequentialPartialFields` | **finished** → `mm:ss`; **capped** → rounds + partial reps |
| `scored` | Max Effort / "Build to Heavy" style | `single_value` | free text `result` | a single max value (reps / load / cal / distance — free text today) |
| `sets` | Strength Sets, Weightlifting, EMOM, Tabata, Intervals, Complex, Superset, Death By | — | `SetsFields` / `SimpleRepsRow` | per-set `{reps, weight}` in `sets` jsonb; `computeSetsScore` → Total Reps / Lowest Round |
| `mixed` | Buy-In/Cash-Out, AMRAP with Buy-In | main = `effectiveScoreMode` | `SimpleRepsRow` (buy-in/cash-out) + `ScoredFields` (main) | buy-in/cash-out reps in `sets.__buyIn`/`__cashOut`; main per its scoreMode |
| `nft` | Not For Time | — | completion checkbox | `completed` boolean → `result` text |
| `chained` | Chained AMRAP | per-stage | per-stage `RoundsPartialFields`/`SetsRows` | `stages` jsonb; `log_meta.totalReps` for ranking |

### B.2 `wod_logs` / `skill_logs` score columns (live schema, verified)

| Column | Type | Meaning |
|---|---|---|
| `result` | text | primary score text — `"17 runde complete"`, `"2 runde + 43 Wallball"`, `"142"`, free max value |
| `time_result` | text | `"mm:ss"` — **finished** duration score; `null` when capped |
| `completion_state` | text | `completed` / `capped` / null (null = legacy or a non-duration format) — CHECK-constrained (`completed`/`capped`/`dnf`/`dns`) |
| `sets` | jsonb | `{ rowKey: [{reps, weight, targetReps?}] }` for `sets`/`mixed`; per-stage for `chained` |
| `log_meta` | jsonb | ranking aids — `chained.totalReps`; currently **unused for capped rounds/reps** |
| `weight_logged` | text | athlete's loaded weight (drives `isNotRxd`) |
| `format_type` / `format_snapshot` / `format_config_snapshot` | text/text/jsonb | frozen format identity |
| `movements_snapshot` | jsonb | frozen legacy movement text |
| `prescription_snapshot` | jsonb | **P9.1** frozen structured prescription |
| `completion_state` live distribution | | `null` 369 · `completed` 38 · `capped` 5 |

### B.3 Save path

`App.jsx` `saveWodLog` → `composeWodLogFields` → for `fortime_or_amrap`:
`composeFortimeOrAmrapFields({ wodTime, wodRoundsCompleted, wodPartialReps, movements, rounds, wodResult })`:
- `shouldLogRoundsInsteadOfTime(time, rounds)` true (time blank, rounds filled) →
  `{ result: composeAmrapResult(...), time_result: null, completionState: 'capped' }`
- else → `{ result: composeFinishedRoundsText(rounds) ?? wodResult, time_result: time, completionState: 'completed' }`
- `normalizeCompletionState(fields)` — non-blocking write-boundary guard: forces
  `completion_state` consistent with `time_result`.
- **P9.1**: `prescription_snapshot` written only when the primary metcon variant
  has a structured prescription, from the **frozen** `logCtx.prescriptionDoc`.

`saveSkillLog` — `sets`-shaped; `prescription_snapshot` deliberately **not**
written (skills carry no per-movement prescription).

Historical / edit paths: `editLogId` branch `.update({...})` — omits
`prescription_snapshot` (preserved). Section-scored path
(`logTargetSectionId`) — supporting sections only, `skill_logs`.

### B.4 Readers

| Reader | File | Uses |
|---|---|---|
| Leaderboard | `workoutFormats.js` `sortSectionLogs` | `finished()` = `completion_state ?? !!time_result`; finishers by `parseTimeResult(time_result)`; capped by `parseRoundsScore(result)` then `partialRepsOfLog(result)`. **Never fabricates a time.** |
| `isNotRxd` | `workoutFormats.js` | `weight_logged` vs prescribed; `effectiveScoreMode`; unaffected by the redesign |
| Journal / history | `App.jsx` journal render, `benchmarkHistory.js` | `time_result \|\| result`; `describeFormatConfig` |
| Workout aggregation | `workoutAggregation.js:138` | `completion_state != null ? === 'completed' : !!time_result` — same dual-path |
| Movement/PR history | `movementHistory.js`, `computeSetsPrCandidates` | `sets` jsonb |

### B.5 The current Log WOD screen (`App.jsx` `screen === 'logWOD'`, ~10660–10920)

Two steps: `compose` then `score`.

`compose`:
- **"Chosen variant" card** — `VARIANTE_CONFIG[i].bg` colored, `"Varianta aleasă"` + level dot + `" — RFT 20:00"` (duplicates the workout header below).
- **workout card** — `"TODAY'S WORKOUT"` / date label, `logWodZiData.type formatWodDurata`, `describeFormatConfig` (`"Number of rounds: 3"`, `"Time cap: 20:00"`), then `<SortableList>` of movement strings **with drag handles** (`onReorder={setWodMiscariCustom}` — the athlete can reorder).
- "Continue to score" button.

`score`:
- back link, `<FormatLogger>` (the adaptive input, styled with `#fafafa` inputs, salmon section headers in `mixed`/`chained`), Save button.

---

## C. SCHEMA DETERMINATION — **NO MIGRATION REQUIRED**

### C.1 Time-cap (finished vs capped) — reuse, no schema change

`completion_state` already distinguishes `completed` / `capped`. `time_result`
holds the finish time; `result` holds `"N rounds + partial reps"`. This is a
deterministic, round-trippable representation that the leaderboard, Journal and
aggregation **already** consume correctly.

The redesign adds an **explicit `[Finished] [Time Capped]` toggle** — this is
purely a UI surfacing of the already-existing `shouldLogRoundsInsteadOfTime`
branch. Same `composeFortimeOrAmrapFields`, same columns, same
`completion_state`. **No new persistence.**

*Optional, NOT required:* structured capped rounds/reps could additionally be
mirrored into the existing `log_meta` jsonb (column exists, currently unused for
this). Recommendation: **do NOT** for V1 — the `result` text is the contract the
leaderboard parses; adding a parallel structured field is a data-model change
that belongs with P10's snapshot-first reader work, not a UI task.

### C.2 Movement icons — client-side map, no schema change

`movements` has no `icon_key`. Per §19 of the brief, the sanctioned V1
alternative is a **stable client-side `canonicalMovementId → iconKey` map**,
seeded once (offline) from `category` / `movement_pattern` / `allowed_prescription
_metrics` / name-family analysis, checked into the repo alongside
`movementCapabilitySnapshot.json`.

Why this is clearly safer for V1:
- **Zero production risk** — no UPDATE to 465 live rows.
- **P9.3-aligned** — resolution is `canonicalMovementId` → map lookup (identity-
  first); a movement with no id / not in the map → `OTHER` fallback.
- **Presentation-only** (§20) — icons never touch capability / identity / scoring
  / snapshot / RX / leaderboard.
- Reversible / iterable without a migration each time a mapping is tuned.

A `movements.icon_key` migration remains a clean future option if the owner wants
gym-authored icons, but it is **not** needed for P9.5.

### C.3 Score types map deterministically — no ambiguity

Every current `family` × `scoreMode` maps 1:1 to a UI-facing score family (§D).
No historical score is reinterpreted. Legacy rows (`completion_state = null`)
keep the `!!time_result` inference everywhere.

### **→ No HARD STOP condition from §54 is triggered.** Proceeding is safe.

---

## D. PROPOSED UNIVERSAL SCORE CONTRACT (PHASE B)

A **UI-facing** `ScoreDefinition` derived from the existing format catalog — it
does **not** replace `scoreMode` / `family`, it is a thin adapter over them so
the new adaptive input has one switch instead of scattered branches.

```
scoreDefinitionFor(formatId, formatConfig) -> ScoreDefinition

ScoreDefinition = {
  kind:            'TIME' | 'TIME_CAPPED' | 'ROUNDS_REPS' | 'REPS'
                 | 'LOAD' | 'DISTANCE' | 'CALORIES' | 'SETS'
                 | 'STAGES' | 'NONE' | 'FREE',
  timeCapSec?:     number,          // TIME_CAPPED only
  roundsKnown?:    number,          // for the capped rounds default + "N rounds complete"
  movements?:      string[],        // partial-reps rows (from the P9.4 projection)
  sequential?:     boolean,         // For Time/Ladder — per-movement partials, no "rounds"
  unit?:           'kg'|'lb'|'m'|'km'|'cal',
}
```

| Current | `ScoreDefinition.kind` | Input(s) |
|---|---|---|
| `fortime_or_amrap` + `timeCapSec` | `TIME_CAPPED` | `[Finished][Time Capped]`; Finished → `mm:ss`; Capped → Rounds + Reps(+ per-movement partials), "Time cap: 20:00" shown |
| `fortime_or_amrap`, no cap | `TIME` | `mm:ss` |
| `amrap` | `ROUNDS_REPS` | Rounds + per-movement partial reps |
| `single_value` (context: reps) | `REPS` | integer + "reps" |
| `single_value` (context: load) | `LOAD` | decimal + unit (P9.2 numeric field) |
| `single_value` (context: cal / distance) | `CALORIES` / `DISTANCE` | integer / decimal + unit |
| `sets` family | `SETS` | existing `SetsFields` (restyled only) |
| `chained` | `STAGES` | existing per-stage inputs (restyled only) |
| `nft` | `NONE` | completion confirm |
| Partner WOD / mixed | resolved via `effectiveScoreMode` → one of the above | as above |

`single_value` context (reps vs load vs cal vs distance) is inferred from the
section's structured metrics / movement families when available, else defaults to
`FREE` (a single labelled field) — **no historical `single_value` row changes
meaning**; only the *input affordance* gets smarter for new logs.

Numeric inputs reuse **P9.2** `resolveNumericInput` (comma/dot, `22,5` → `22.5`,
integer-only for rounds/reps/calories). Canonical persistence unchanged.

`MULTI_SCORE` is **not** invented — `SETS` / `STAGES` / multiple scored sections
already cover Forge's real multi-score cases. The `ScoreDefinition.kind` enum is
open for a future explicit multi-score family without a data change.

---

## E. TIME CAP — finished vs capped representation (no change)

| Outcome | `completion_state` | `time_result` | `result` |
|---|---|---|---|
| Finished 17:42 | `completed` | `"17:42"` | `"3 runde complete"` (auto, `composeFinishedRoundsText`) |
| Capped, 2 rounds + 43 reps | `capped` | `null` | `"2 runde + 43 Wallball, …"` (`composeAmrapResult`) |

Leaderboard (`sortSectionLogs`): `finished()` groups finishers first, orders them
by `parseTimeResult`; capped ordered by `parseRoundsScore(result)` then
`partialRepsOfLog(result)`. **Already correct — no P10 leaderboard work.**

The toggle switching **Finished → Capped** clears the drafted `time`; **Capped →
Finished** clears drafted `rounds`/`partialReps` — enforced in the new input
component (draft hygiene), mirroring the existing mutual-exclusivity
(`hasTime` hides the rounds field today).

---

## F. UNIVERSAL LOG WOD — proposed component architecture (PHASE D–E, not yet built)

```
screen 'logWOD'
└─ <UniversalLogWod>                     (replaces the inline compose/score markup)
   ├─ <LogWodHeader>                     ← back · "Log WOD"
   ├─ <VariantBadge level="RX" />        ← small pill, NOT a colored card
   ├─ <WorkoutPresentation>              ← READ-ONLY
   │    ├─ heading + timeCap ("3 ROUNDS FOR TIME    20:00 / TIME CAP")
   │    └─ <MovementPresentationRow>×N   ← [icon] name … @ prescription
   │         (lines = composeStructuredWorkoutDisplay — P9.4, unchanged)
   ├─ "YOUR SCORE"
   ├─ <UniversalScoreInput def={scoreDefinitionFor(...)} value onChange />
   │    ├─ TimeScoreInput / CappedTimeScoreInput ([Finished][Time Capped])
   │    ├─ RoundsRepsScoreInput
   │    ├─ RepsScoreInput / LoadScoreInput / CaloriesScoreInput / DistanceScoreInput
   │    ├─ SetsScoreInput      (wraps existing SetsFields, restyled)
   │    └─ StagesScoreInput    (wraps existing chained stages, restyled)
   └─ <SaveScoreButton>                  ← single primary CTA, existing saveWodLog
```

Removed: "Chosen variant" card, "TODAY'S WORKOUT", `describeFormatConfig`
duplication ("Number of rounds: 3"), `SortableList` + drag handles, Quick Add
time buttons, salmon section headers, nested card-in-card.

Kept (semantically necessary): variant badge, workout heading, time-cap label,
movement lines + prescriptions, per-movement partial-reps rows (capped), notes
field, RX badge on the weight field, Save.

`saveWodLog` / `composeWodLogFields` / `logCtx` / `prescription_snapshot` — **not
touched**. The redesign is presentation + a thinner score-input switch.

Design tokens reused from the existing PWA: `#0E0E0E` text, `#ABE73C` lime accent,
`#fff` / `#F7F7F5` surfaces, `#ECECEC` borders, 12–20 px radius, `TYPO.*`,
`paddingBottom: 80px` safe-area, `env(safe-area-inset-bottom)`.

---

## G. MOVEMENT ICON SYSTEM — proposed resolution architecture

```
resolveMovementIconKey(instanceOrCanonicalId, index) -> IconKey            (pure)
  1. canonicalMovementId present + in ICON_MAP  -> ICON_MAP[id]
  2. else                                        -> 'OTHER'

<MovementIcon iconKey={...} size={22} aria-hidden />                        (presentation)
```

- `ICON_MAP` = checked-in JSON `movementIconMap.json` (both repos, like
  `movementCapabilitySnapshot.json`): `{ [canonicalMovementId]: iconKey }`,
  seeded once from `category`/`movement_pattern`/`allowed_prescription_metrics`/
  name families. **Name matching is used ONCE at seed time**, never at runtime
  (§17).
- `<MovementIcon>` = a `switch(iconKey)` over ~20 inline SVG line-icon components
  (24×24, `stroke="currentColor"`, `stroke-width` 1.5 — same family as
  `lucide-react`, which is already a dependency and supplies `Dumbbell`, `Bike`,
  and a couple more; the CrossFit-specific ones — barbell, kettlebell, wall ball,
  rower, ski erg, rig, GHD, sled, sandbag, rope — are small custom SVGs).
- Unknown / custom movement → `OTHER` generic dot/dumbbell glyph. **Never
  `undefined`, never a broken icon.**
- **Presentation only** — `resolveMovementIconKey` is never consulted by
  capability / identity / scoring / snapshot / RX / leaderboard / analytics.

### H. ICON CATALOG — families (deterministic seed classifier over all 465)

`BARBELL · DUMBBELL · KETTLEBELL · WALL_BALL · ROWER · BIKE · SKIERG · RUN ·
CARDIO_OTHER · JUMP_ROPE · ROPE · BOX · CARRY · SLED · SANDBAG · RINGS · GHD ·
BENCH · GYMNASTICS · BODYWEIGHT · OTHER` (21 keys).

A first-pass classifier maps ~325 of 465 to a specific family; the remaining
~140 (benchmark-WOD names like *Amanda*/*Angie*, ambiguous accessory work) fall
to `OTHER` — which is correct, not a defect. The catalog-wide icon integrity
test (§P) asserts **every** movement resolves to a known key or `OTHER`, never
`undefined`.

---

## I. P9.4 INTEGRATION

The Log WOD `WorkoutPresentation` consumes `composeStructuredWorkoutDisplay({
doc: logCtx.prescriptionDoc, variantKey: frozenVariantKey, mode: 'member',
gender: memberGenderKey })` — the **same** call the member Home card already
makes. No `loggerFormatter`. Icons decorate the rows; the line text is still the
shared projection's `lines[]` verbatim (P9.4 `memberMovementLine`).

---

## J. FROZEN IDENTITY (INC-04) — unchanged

The redesign reads `logCtx` (frozen at "Log Score" click) exactly as today:
`activePrescriptionDoc`, `frozenVariantKey`, `logWodZiData`, `logBusinessDate`,
`homeDisplayIsCurrent` gate on the entry button. No re-resolution from today /
current selection / display text / a fresh Engine V2 fetch. `saveWodLog` still
derives `wod_id` and the snapshot from `logCtx`.

---

## K. HISTORICAL LOGGING (D+N) — unchanged

`logBusinessDate` (frozen) drives the date label and the save target;
`legacy_wod_id` / `wod_id` come from `logCtx`, never from `todayLocalStr()`.
A workout from D logged on D+n still saves against D's identity. Covered by the
existing INC-04 tests + a new P9.5 test (§P.M).

---

## L. VARIANTS — unchanged

`variantaAleasa` is frozen into `logCtx` at click; `frozenVariantKey =
variantKeyFromLevel(VARIANTE_CONFIG[variantaAleasa].nivel)`. The badge, the
`WorkoutPresentation` lines, the `ScoreDefinition` and `saveWodLog`'s
`variant_level` all read the same frozen index. Opening the logger for Beginner
cannot show/save RX.

---

## M. GENDER — unchanged

`memberGenderKey = resolveAthleteGenderKey(userProfile.gender)` (canonical
`members.gender`; `masculin`→male, `feminin`→female, else `null`). Passed to
`composeStructuredWorkoutDisplay` as `gender`. `null` → both values
(`61/43 kg`). No male fallback.

---

## N. LEGACY FALLBACK — unchanged

A legacy-only workout (`composeStructuredWorkoutDisplay` → `null`): the
`WorkoutPresentation` renders `logWodZiData[variantKey]` legacy text lines
(styled, not reparsed) with the `OTHER` icon, and `describeFormatConfig`'s
genuinely-necessary lines. No aggressive free-text parsing, no invented
prescriptions or icons.

---

## O. SNAPSHOT — unchanged

`prescription_snapshot` is still built by `buildPrescriptionSnapshot` from the
frozen `logCtx.prescriptionDoc`. New test asserts
`WorkoutPresentation line == prescription_snapshot.movements[i].displayLine`
for a structured log (both come from `resolveMovementInstance` / P9.4).

---

## P. TEST MATRIX (planned, PHASE G)

`scoreDefinition.test.js` (new): A For-Time-finished · B cap-finished · C
cap-capped (2r+43) · D AMRAP (7r+12) · E reps 87 · F load 100 · G decimal load
`102,5`→`102.5` · H calories 142 · I distance · K not-scored · L legacy · M
D+N identity · N RX≠Intermediate · O gender m/f/unknown · P repeated movement ·
Q logger line == snapshot displayLine · R edit preserves identity/snapshot.

`timeCapDraft.test.js` (new): Finished↔Capped switching clears the incompatible
draft; no stale time when capped; no stale rounds when finished; integer-only
rounds/reps; 0-rounds+N-reps; N-rounds+0-reps; negative/blank rejected.

`movementIcon.test.js` (new): Power Clean→BARBELL, Power Snatch→BARBELL, DB
Snatch→DUMBBELL, KB Swing→KETTLEBELL, Wall Ball→WALL_BALL, Row→ROWER,
Ski Erg→SKIERG, Echo Bike→BIKE, Run→RUN, Box Jump→BOX, Pull-up→GYMNASTICS,
Toes-to-Bar→GYMNASTICS, Double Under→JUMP_ROPE, Rope Climb→ROPE,
Farmers Carry→CARRY, Push-up→BODYWEIGHT, unknown→OTHER; alias → same icon
(id-first).

`movementIconIntegrity.test.js` (new): every row in `movementIconMap.json`
resolves to a known `IconKey`; every catalog movement → known key or `OTHER`;
`resolveMovementIconKey(null)` → `OTHER`.

Regression: `prescriptionContract` / P9.2 / P9.3 (`movementCapabilityIntegrity`)
/ P9.4 (`composeStructuredWorkoutDisplay`) / `workoutFormats` / `FormatLogger`
(if present) / `workoutComposer` / logging-identity — all re-run. The 9
pre-existing Deno `supabase/functions/*` `@std/assert` failures remain,
unchanged and unrelated.

---

## Q. PRODUCTION DATA

| | |
|---|---|
| Migrations applied | **NONE** |
| `wods` rows modified | **0** |
| `wod_logs` rows modified | **0** |
| `skill_logs` rows modified | **0** |
| `movements` rows modified | **0** |
| Historical rewrite | **none** |

`movementIconMap.json` is a checked-in repo artifact, not a DB write.

---

## R. DEPLOYMENT

Pending owner confirmation (this report is the PHASE A–C checkpoint). On
approval: PHASE D–F implementation → PHASE G tests → PHASE H build/tsc/lint →
PHASE I deploy (`app_version` → `p9-5-universal-logwod-<date>`) → PHASE J manual
checklist → PHASE K final report update.

---

## S. KNOWN ISSUES (not P9.5 regressions)

- **INC-04 Aug 27 production case** — outside this task; not reproduced by this
  presentation-only work; not touched. Production Readiness is **not** claimed
  GREEN.
- The `single_value` → reps/load/cal/distance context inference is best-effort
  for **new** logs; historical `single_value` rows keep their free-text meaning.
- Structured capped rounds/reps remain in `result` text (not a separate
  structured column) — deliberate, deferred to P10's data-model work.

---

## T. MANUAL ACCEPTANCE (after implementation — SHORT)

1. For Time finished → `17:42`.
2. For Time capped → `[Time Capped]` → 2 rounds + 43 reps; no fake time saved.
3. AMRAP → 7 rounds + 12 reps.
4. Load workout → `100 kg`; decimal `102,5` → saves `102.5`.
5. Same workout as male vs female → prescriptions differ (`61 kg` / `43 kg`);
   no-gender → `61/43 kg`.
6. Workout from a past date, logged today → saves to that date's workout.
7. A legacy (non-structured) workout → clean fallback, no broken icons.
8. A workout with the same movement twice at different loads → both lines +
   icons correct and independent.
9. A custom/unknown movement → generic `OTHER` icon, UI intact.
10. Logger workout lines == the member Home card for the same variant/gender.

---

## HARD STOP

**P10 NOT STARTED.** Journal / leaderboard / `isNotRxd` historical semantics /
performance readers / snapshot-first reads — untouched and out of scope.

**Awaiting owner confirmation of §D (score contract) and §C.2/§G (client-side
icon map, no migration) before PHASE D–F.**

---
---

# P9.5 IMPLEMENTATION REPORT (PHASE D–K) — owner-approved 2026-08-30

## A2. EXECUTIVE SUMMARY (implementation)

Universal Log WOD shipped for the **primary programmed-metcon** flow: one clean
single screen (variant badge -> read-only workout with movement icons -> YOUR
SCORE -> SAVE), the explicit **[Finished] [Time Capped]** toggle, and a
21-family movement-icon system resolved identity-first. **No migration, no
production data touched.** Every P9-P9.4 invariant preserved; the score
*computation* (`composeWodLogFields` and the `workoutFormats.js` helpers) is
byte-unchanged - only the input UI feeding it changed. `FormatLogger` stays the
engine for SETS / STAGES / free-log / section / skill / edit flows.

## D2. UNIVERSAL LOG WOD — what shipped

`App.jsx` `screen === 'logWOD'`, new guard `logWodPrimaryPath` =
`!editLogId && !logTargetSectionId && variantaAleasa !== null && !!logWodZiData`.
When true, one screen renders (the old two-step compose->score is collapsed);
every other logWOD sub-flow (edit / section-scored / free log) is byte-identical.

**Removed** (structured/programmed path only): "Chosen variant" colored card;
"TODAY'S WORKOUT" label; `describeFormatConfig` duplicate line; `<SortableList>`
+ drag handles; "Continue -> Log Score" step; Quick-Add; salmon `#791F1F`
section headers; nested card-in-card.

**Kept**: back arrow "Log WOD"; small `RX` badge pill; `<WorkoutFormatHeader>`
heading (same widget as the member Home card) + `formatMemberScheduleLines`
prescription/metadata lines; read-only movement rows `[icon] name ... @ rx`;
`YOUR SCORE`; adaptive score input; notes; one `SAVE` CTA; RX badge on the
weight field.

Movement rows: `composeStructuredWorkoutDisplay({ doc: activePrescriptionDoc,
variantKey: frozenVariantKey, mode: 'member', gender: memberGenderKey })` — the
**P9.4 projection, unchanged**, `.movements[]` carrying `canonicalMovementId` for
the icon. Legacy-only workout -> `logWodZiData[variantKey]` text lines +
`OTHER` icon. `splitPrescriptionLine()` splits `"12 Wall Ball @ 9 kg"` into
name + `@ 9 kg` for the right-aligned layout; long names wrap (`wordBreak`), no
horizontal overflow.

## E2. UNIVERSAL SCORE INPUT — `src/UniversalScoreInput.jsx`

Driven by `scoreDefinitionFor(formatId, formatConfig)` -> one `kind`:

| kind | UI |
|---|---|
| `TIME` | `mm:ss`, no toggle |
| `TIME_CAPPED` | **[Finished] [Time Capped]** segmented control (state by fill+weight, not colour alone — §35); Finished -> `mm:ss`; Time Capped -> Rounds + per-movement partial-reps rows (`sequential` -> partials only) + "Time cap: 20:00" |
| `ROUNDS_REPS` | Rounds + per-movement partial reps |
| `REPS` / `LOAD` / `DISTANCE` / `CALORIES` | one numeric field (P9.2 `resolveNumericInput` — comma/dot, `102,5`->`102.5`, integer-only for reps/calories) + unit suffix |
| `NONE` | completion checkbox |
| `SETS` / `STAGES` / `FREE` | **delegates to `<FormatLogger>` unchanged** |

`value` / `onChange` contract is byte-identical to `FormatLogger`'s
(`{ result, time, roundsCompleted, partialReps, sets, completed, weightLogged,
stages }`), so `composeWodLogFields` reads it with **zero change**.

**TOGGLE PAYLOAD CORRECTNESS (§3)** — enforced in `TimeScoreBlock.pick()`:
- -> Finished: `onChange({ roundsCompleted: '', partialReps: [] })` — stale capped
  work can never reach the payload.
- -> Time Capped: `onChange({ time: '' })` — a stale finish time can never reach
  the payload. `composeFortimeOrAmrapFields` then produces
  `time_result: null, completion_state: 'capped'`.
Verified by `universalScoreInput.test.jsx` (accumulated-value assertions).

## F2. MOVEMENT ICON SYSTEM

- `src/movementIconMap.json` — `{ [canonicalMovementId]: iconKey }` for all 465
  platform movements. Seeded **offline once** from `category` /
  `movement_pattern` / `allowed_prescription_metrics` / name-family analysis
  (§17 — name matching only at seed time). Checked into the repo.
- `src/movementIcons.js` — `resolveMovementIconKey(instanceOrId)` — **id-first**
  (`instance.canonicalMovementId` -> map -> key), `'OTHER'` for id-less / unknown /
  not-in-map. Always a valid key, never `undefined`.
- `src/movementIcons.jsx` — `<MovementIcon iconKey size>` — `switch` over 21
  inline line-icon SVGs (24x24, `stroke="currentColor"`, one family);
  `lucide-react` supplies `Dumbbell` + `Bike`. `aria-hidden` (the name is the
  label). **Presentation only** — never consulted by capability / identity /
  scoring / snapshot / RX / leaderboard.

### ICON COVERAGE TABLE (465 movements, 21 keys)

| iconKey | count |
|---|---|
| BARBELL | 90 |
| GYMNASTICS | 56 |
| BODYWEIGHT | 55 |
| DUMBBELL | 55 |
| KETTLEBELL | 40 |
| OTHER | 40 |
| SANDBAG | 27 |
| CARRY | 24 |
| BOX | 17 |
| BENCH | 10 |
| RINGS | 8 |
| GHD | 7 |
| BIKE | 6 |
| RUN | 6 |
| JUMP_ROPE | 5 |
| CARDIO_OTHER | 5 |
| SLED | 5 |
| ROPE | 4 |
| WALL_BALL | 3 |
| ROWER | 1 |
| SKIERG | 1 |

`OTHER` = 40 / 465 = **8.6 %** (< 12 %, asserted by the integrity test).

### OTHER MOVEMENTS — all 40, classified (§11)

Every `OTHER` entry is a **named benchmark / hero / girl WOD** living in the
`movements` catalog — a *workout name*, not a movement (a known catalog-pollution
issue noted in the P9.3 audit). A specific icon family would be **misleading**
for these. None is an ordinary classifiable exercise.

| name | type |
|---|---|
| Adam, Danny, Desforges, DT, Forrest, Glen, Griff, J.T., Josh, Kalsu, Michael, Murph, Nate, Nutts, Ryan, Scott, Ship, Badger, Randy | hero WOD (benchmark, non-movement) |
| Amanda, Angie, Annie, Barbara, Chelsea, Cindy, Diane, Elizabeth, Eva, Fran, Grace, Helen, Isabel, Jackie, Karen, Kelly, Linda, Lynne, Mary, Nancy, Nicole | girl benchmark WOD (non-movement) |

`movementIconIntegrity.test.js` asserts every `OTHER` id matches the named-WOD
allow-list — a new ordinary exercise slipping into `OTHER` fails the build.

## G2. ICON RESOLUTION / IDENTITY (§16/§17)

`Power Snatch` and `Power Snatches` resolve (upstream, P9.3) to the **same**
`canonicalMovementId`, so they share the `BARBELL` icon by construction — the
icon layer never sees the display text. Verified by
`movementIconIntegrity.test.js` ("alias -> same icon").

## I2. P9.4 INTEGRATION (§21)

The Log WOD movement lines are `composeStructuredWorkoutDisplay(...).movements`
verbatim — the **same** call the member Home card makes. No `loggerFormatter` /
`iconFormatter`. Icons decorate; the line text is the shared projection.

## J2. FROZEN IDENTITY / K2. HISTORICAL / L2. VARIANTS / M2. GENDER

Unchanged. The new screen reads `logCtx`-derived state only
(`activePrescriptionDoc`, `frozenVariantKey`, `logWodZiData`, `logBusinessDate`,
`memberGenderKey`, `miscariPentruLog`, `prescribedWeightPentruLog`) — exactly
what the old screen read. `saveWodLog` is called unchanged. No re-resolution
from today / current selection / display text / a fresh V2 fetch.
`p95ScoreMatrix.test.js` + existing INC-04 / P9 / P9.4 suites cover D+N,
variant isolation, gender, repeated movement, snapshot alignment.

## N2. LEGACY FALLBACK (§28)

`logWodPrimaryPath` also handles a legacy programmed workout (no structured
prescription): `composeStructuredWorkoutDisplay` returns `null` ->
`logWodZiData[variantKey]` legacy text lines rendered as-is (not reparsed) with
the `OTHER` icon. No aggressive parsing, no invented prescriptions/icons.

## O2. SNAPSHOT (§27)

`prescription_snapshot` write path (`buildPrescriptionSnapshot` from frozen
`logCtx.prescriptionDoc`) is untouched. P9.4's
`member displayLine == snapshot displayLine` test still passes — the Log WOD now
renders that same `displayLine`.

## P2. TEST MATRIX

| file | tests | covers |
|---|---|---|
| `scoreDefinition.test.js` | 17 | every family -> kind, time-cap detection, `single_value` context, edit-flow kind |
| `movementIconIntegrity.test.js` | 49 | catalog-wide: 465 -> valid key or OTHER; OTHER = named-WOD-only; distribution; representative families; alias -> same icon |
| `universalScoreInput.test.jsx` | 13 | TIME; TIME_CAPPED toggle **payload correctness**; ROUNDS_REPS; REPS (integer); LOAD (`102,5`->`102.5`); CALORIES; NONE; SETS delegation; weight field |
| `p95ScoreMatrix.test.js` | 9 | §38 A-H persistence outcomes; §7 leaderboard order (finishers -> capped-by-work, no artificial time); §39 cap edges |
| **new total** | **88** | |

Regression: `prescriptionContract` / P9.2 / P9.3 (`movementCapabilityIntegrity`) /
P9.4 (`composeStructuredWorkoutDisplay`) / `workoutFormats` / `workoutComposer` /
logging-identity — **all green**. WOD-SIMPLE `vitest run`: **1271 passed**, the
**9 pre-existing Deno-only `supabase/functions/*` `@std/assert` failures**
unchanged and unrelated. `vite build` + `eslint` (P9.5 files) clean.

## Q2. PRODUCTION DATA

| | |
|---|---|
| Migrations applied | **NONE** |
| `wods` / `wod_logs` / `skill_logs` / `movements` rows modified | **0** |
| Historical rewrite | **none** |

`movementIconMap.json` is a checked-in repo artifact.

## R2. DEPLOYMENT

See the commit line at the bottom. `app_version` -> `p9-5-universal-logwod-20260830`.
forge-admin-web: **no change** (P9.5 is WOD-SIMPLE only).

## S2. KNOWN ISSUES

- INC-04 Aug 27 production case — untouched, not reproduced, not P9.5.
  Production Readiness **not** claimed GREEN.
- `single_value` unit-context inference is not yet wired to a live per-section
  metric source — `Max Effort` currently opens as `FREE` (one labelled field);
  a structured section could pass `singleValueUnit` later without a data change.
- 40 benchmark-WOD names still pollute the `movements` catalog (P9.3 finding) —
  they render the `OTHER` icon, which is correct. Catalog cleanup is out of scope.

## T2. MANUAL OWNER ACCEPTANCE (short — representative, not 465)

1. **For Time finished** — open a capped RFT, tap `Finished`, enter `17:42`, save.
2. **For Time capped** — same workout, tap `Time Capped`, `2` rounds + `43` reps,
   save. Check the leaderboard: finishers rank above you; you show `CAP - 2+43`,
   no fabricated time.
3. **AMRAP** — `7` rounds + `12` reps.
4. **Load workout** — a decimal `102,5` saves as `102.5`.
5. **Gender** — open the same workout as a male vs a female profile: prescriptions
   differ (`61 kg` / `43 kg`); a no-gender profile shows `61/43 kg`.
6. **Historical D+N** — a workout from a past date, logged today, saves to that
   date's workout.
7. **Legacy workout** — a non-structured programmed workout: clean rows, generic
   `OTHER` icons, no crash.
8. **Repeated movement** — a workout with the same movement twice at different
   loads: both rows + icons correct and independent.
9. **Custom / unknown movement** — renders the generic `OTHER` icon; screen intact.
10. Log WOD movement lines **==** the member Home card for the same variant/gender.

## HARD STOP

**P10 NOT STARTED.** Journal / leaderboard / `isNotRxd` historical semantics /
performance readers / snapshot-first reads — untouched. Owner manual acceptance
required before P9.5 is declared closed.
