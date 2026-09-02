# P9.5.2A — Global Performed Movement Composition (Add / Change / Delete / Not Performed)

**Date:** 2026-09-02
**Status:** **IMPLEMENTATION HALTED AT STOP CONDITION §71-#7 — OWNER DECISION REQUIRED**
on structured-family (Sequential AMRAP / Intervals) performed-rep scoring.
**Priority:** P1 — member logging / result truth / leaderboard classification.

Owner decisions received and authoritative: **D1 = A** (flat ordered list +
`sourceInstanceId`), **D2 = B** (explicit *Mark Not Performed*), **D3 = A**
(inherit structural reps only where deterministically valid), **D4 = REVISED**
(*performed composition is NOT display-only — for rep-derived scoring, performed
reps must drive the performed score*), **D5 = DEFERRED** (`N → 1` out of scope),
**D6 = APPROVED** (meaningfully Modified → Mixed Categories, programmed variant
preserved).

---

## 1. Pre-implementation trace (§70 A1–A15) — confirmed against current repo

| # | Question | Answer |
|---|----------|--------|
| A1 | Current `performed_prescription` shape | `{version:1, variantKey, sectionId, source:'performed', movements:[{instanceId, name, canonicalMovementId, reps?, load?, distance?, calories?, substitutedFrom?}]}` — `wod_logs.performed_prescription jsonb NULL`, migration `20260831090000`, contract in `prescriptionContract.js` ⇄ `.ts`. |
| A2 | Version | `PERFORMED_PRESCRIPTION_VERSION = 1`. |
| A3 | Source instance identity | `instanceId` (`mi_`+21 urlsafe), stable in the frozen `logCtx.prescriptionDoc` and re-frozen into `prescription_snapshot.movements[].instanceId` (`buildPrescriptionSnapshot`). The performed doc does **not** record which programmed source an entry derives from — association is **positional** (`performedComparableInstances` compares index-by-index). |
| A4 | Repeated-movement distinction | By `instanceId` only (never name). Available at edit time (`activePrescriptionDoc`) and at read time when a snapshot exists. |
| A5 | Save serialization | `saveWodLog` (`App.jsx` ~9227): `performedToSave = performedCommitted` iff `performedIsModified(...)` **and** `validatePerformedPrescription(...).valid`; single `.insert` with `...(performedToSave ? {performed_prescription: performedToSave} : {})`. Edit-existing `.update` never names the column (overlay preserved). |
| A6 | Reopen deserialization | `onEditWod` → `setPerformedCommitted(log.performed_prescription \|\| null)`; `openPerformedEdit` → `snapshotPrescriptionDoc(performedCommitted)` (deep clone) or `buildPerformedPrescriptionDraft`. `PerformedEditPanel` `.map`s `draft.movements` — renders an arbitrary-length list already. |
| A7 | Modified classification | `resultCompositionModified(log, prescribedWeight, loggedMovements, prescribedMovements)` (`workoutFormats.js`, P9.5.4/P9.5.6) = `weight-sub-standard \|\| movements-changed \|\| performed_prescription != null`. `isNotRxd` = that `\|\| neterminatInTimp`. |
| A8 | Mixed Categories routing | `App.jsx splitRxSiMixed` → `isMixedCategory(weight_logged, prescribedWeight, miscariAfisate, prescribedMovements, log.performed_prescription)` → delegates to `resultCompositionModified`. **`performed_prescription != null` already routes to Mixed today**, with `_nivelOriginal` preserving the programmed tier. D6 is essentially already wired. |
| A9 | Rep aggregation | **No non-structured scored family aggregates reps from the movement list.** `sortSectionLogs` ranks `scored`/amrap by `parseRoundsScore(log.result)` then `partialRepsOfLog` — **parsed from the member-typed result string**. `repsPerRound` / `totalRepsAmrapStage` exist only for Ascending AMRAP and Chained-AMRAP stage internals. The only score families whose numeric result is a *computed rep total* are **INC-11 Sequential AMRAP** (`sequentialAmrapTotalReps` = Σ per-station) and **INC-07/08 Intervals `Total Reps`** (`computeSetsScore` over `resolveStructuredIntervalResult`). |
| A10 | Score-family dispatch | `scoreDefinitionFor(formatId, config, opts)` → `TIME` / `TIME_CAPPED` / `ROUNDS_REPS` / `SEQUENTIAL_AMRAP` / `REPS` / `LOAD` / `DISTANCE` / `CALORIES` / `SETS` / `STAGES` / `NONE` / `FREE`. `family:'sets'` (EMOM/Tabata/Intervals/Death By/Weightlifting/Strength/Complex/Superset/Build-to-Heavy) → `SETS` → `<FormatLogger>`. `family:'chained'` → `STAGES`. `family:'nft'` → `NONE`. |
| A11 | Journal projection | `resolveResultMovementLines(w)` (`resultWorkoutLines.js`), 5-tier frozen precedence; tier 1 `composePerformedResultLines` → `composeStructuredWorkoutDisplay({instances: doc.movements})` renders an arbitrary ordered list. |
| A12 | Leaderboard projection | expanded row → same `resolveResultMovementLines(log)`. Ranking / dedup / INC-09 selection / score computed upstream, not from `performed_prescription`. |
| A13 | Result-card projection | leaderboard-expanded + Journal + share all route through `resolveResultMovementLines` / `composePerformedResultLines` (P9.5.7). forge-admin-web `ScoreDisplay` has parity. |
| A14 | Movement capability source | `resolveMovementCapability` / `movementCatalog.capabilityFor` over the 2 catalog columns (`allowed_prescription_metrics`, `default_prescription_metric`), lazily fetched (`memberMovementIndex`). |
| A15 | Movement Library selector | `PerformedEditRow` sub-search = `movementIndex.rows` filter (name substring, ≥2 chars, slice 6) → `applyPerformedSubstitution`. The coach builder's `MovementRowListPWA` has its own `+ Add movement` (`newMovementInstance()`) — **different context, not reused**. |

**Result: `1 → N` array + `sourceInstanceId` + `notPerformed` need ZERO DB
migration** (the trigger `validate_wod_log_performed_prescription()` imposes no
length / 1:1 / position check and tolerates additive keys; JS mirror same).

---

## 2. Clean scope — no conflict, ready to build (contingent on §3 resolution)

| Area | Plan |
|------|------|
| Contract v2 | `PERFORMED_PRESCRIPTION_VERSION → 2`; optional per-movement `sourceInstanceId` (→ programmed `instanceId`); optional per-source `notPerformed:true`; `movements[]` stays flat + ordered (§8/§29). v1 docs remain valid (missing anchor ⇒ positional fallback, read-only). No migration. |
| Add / Change / Delete | `PerformedEditRow`: *Change movement* + *Delete movement* in the action area; `+ Add movement` below the metric fields; appends a sibling `instanceId` directly after the last entry sharing that `sourceInstanceId` (§13/§14). Reuse the existing catalog search in `append` mode. Change on an added row uses the same `applyPerformedSubstitution` semantics (§17). |
| Mark Not Performed / Restore | D2=B — explicit action sets `notPerformed:true` on the group; never `0 reps`, never `[]` (§21). Restore action before Save clears it (§23). |
| Rep inheritance (D3=A) | An added movement inherits the source instance's resolved `reps` for round-structured families where the target is unambiguous (For Time / RFT / Chipper / Ladder, AMRAP Repeated Rounds, EMOM, Strength). Left explicit elsewhere. |
| Source anchoring / repeated movements | `sourceInstanceId` → distinct programmed positions stay distinct (T9/T10). Duplicates allowed, no dedupe (T11). |
| Modified → Mixed (D6) | Already wired via `isMixedCategory(... performed_prescription)` — a v2 composition change keeps `performed_prescription != null` ⇒ Mixed, programmed variant preserved. Extend `performedMatchesProgrammed` to be **source-anchored** so add-then-delete-restore normalizes to NULL (§24, T7) and `notPerformed` **never** normalizes (§25). |
| Display everywhere | `resolveResultMovementLines` / `composePerformedResultLines` already render an arbitrary ordered instance list — extend only to render a `notPerformed` line. Journal / Leaderboard detail / share / forge-admin `ScoreDisplay` inherit it. |
| For Time elapsed score (§29) | Untouched. Primary score stays the member's time; result becomes Modified + Mixed; performed detail shown. |
| Performed load / distance / calories (§36) | Already stored per instance (`setPerformedMetricValue`), rendered by the projection. Extends to added instances via capability-gated seeding (§37). |
| REST (§16) | Excluded from the selector (catalog rows only; REST is not a movement). |
| Movement-library / workout immutability | Selection only; no `wods` / `movement_prescriptions` / `workouts` / catalog writes (§61/§62). |
| Security / tenant | Unchanged — member edits own log only; no new SECURITY DEFINER (§64). |

---

## 3. The blocking conflict — D4 REVISED × structured score families (§26 / §30 / §32 / §33 / §71-#7)

**§26/§30/§31/§88 and tests T28–T30 require that performed reps drive the
performed score and that `EDITOR REPS = SAVED SCORE INPUT = JOURNAL TOTAL =
LEADERBOARD TOTAL`.** From the A9 trace, the score is a *computed rep total*
in exactly two places:

### 3a. INC-11 Sequential AMRAP — extendable, but reworks a frozen incident contract

Today `resolveSequentialAmrapStations({instances})` builds a **fixed station
list where station index ↔ programmed movement instance is 1:1**. The logger
renders one reps field per station; `sequentialAmrapTotalReps` sums them;
`composeSequentialAmrapResult` / `parseSequentialAmrapResult` / auto-complete
all key on that list.

A `1 → N` split makes one station a **variable-length flat list**. The smallest
deterministic mapping (§32): **resolve the station list from the performed
composition instead of the programmed list** — then every downstream helper
operates on the longer flat list unchanged, and a split station's performed
movements each contribute their own reps (Σ = actual work, §4). Feasible, but it
reworks the INC-11 logger input, result grammar, and reopen for a frozen
incident contract, and must be re-regression-tested against INC-11 / INC-11.1.

### 3b. INC-07/08 Intervals `Total Reps` — NOT representable in the frozen result contract

`resolveStructuredIntervalResult(log)` (INC-08 / INC-08A) projects a frozen
result that is **`roundCount` × `stationCount` entries keyed by a station-key
regex**, with `roundCount` + `stationMode` + `sets` frozen. Leaderboard score =
`computeSetsScore` over that structure. `resolveIntervalStructure` gates
structured mode on the stored `stationMode:'per-interval'`.

A `1 → N` split turns one **(round, station) cell** into a variable-length list
of performed movements. Satisfying §33 — *"5 rounds × 3 stations remains 5×3",
round-major grouping preserved, not-reached ≠ explicit zero, no double-count* —
**and** aggregating performed reps requires a **new per-cell
performed-composition dimension on the persisted interval result** and a new
result grammar + reopen. That is a **new owner-level structured-result model**,
i.e. **§71 stop condition #7** and the §32/§33 "STOP and report the exact
conflict" case. It cannot be done deterministically inside the current
INC-07/08 contract without an owner decision.

---

## 4. Minimal options

### Option 1 (recommended) — ship composition for every format; structured per-station *numeric input* stays 1:1 this phase

- Full v2 composition capability (Add / Change / Delete / Mark Not Performed,
  `sourceInstanceId`, flat ordered list, duplicates, capability-gated fields,
  REST-excluded) for **all** formats including Sequential AMRAP and Intervals.
- Modified → Mixed Categories, programmed variant preserved, for all formats.
- Performed **movement identity, load, distance, calories, and `notPerformed`**
  are live truth everywhere (editor, DB, reopen, Journal, Leaderboard detail,
  share).
- For Time / RFT / AMRAP / Ladder / Chipper / Partner / Max Effort / Strength:
  primary score unchanged (member-entered = performed truth); composition adds
  detail + Modified/Mixed.
- **Sequential AMRAP:** station list resolved from the performed composition —
  `sequentialAmrapTotalReps` then reflects the actual split (3a). Rep
  aggregation is live here.
- **Intervals:** composition recorded + shown + classified Modified→Mixed;
  the per-station reps field stays one-per-programmed-station (that entry already
  *is* the member's performed reps for that station); a split station's
  performed movements render under that station and share its entered total for
  display. **Documented limitation:** an Intervals split does not sub-divide the
  per-station rep count this phase (INC-08 `resolveStructuredIntervalResult`
  contract unchanged).
- **Not "display-only"** (D4 honoured for every format except the Intervals
  per-station numeric granularity). Smallest safe change, zero migration, no
  frozen-contract rewrite beyond the INC-11 station-source swap.

### Option 2 — full structured rework (separate spec)

Owner ratifies a **new versioned persisted-result contract** for INC-07/08
Intervals (per-(round, station) performed-composition sub-entries; new result
grammar; reopen; `computeSetsScore` over the expanded structure) plus the INC-11
Sequential AMRAP logger/grammar rework. Migration-free but contract-versioned;
touches two frozen incident contracts; needs its own spec + full INC-07/08/11
regression. Do **not** start without owner approval (§71-#7).

### Option 3 — defer structured formats from composition entirely

Performed editor hidden for `SEQUENTIAL_AMRAP` and every `family:'sets'`
interval format this phase; composition ships fully for `scored`
(For Time / RFT / AMRAP / Ladder / Chipper / Partner / Max Effort) and Strength.
Smallest and cleanest, but no composition editing on intervals at all.

---

## 5. Deferred / out of scope

`N → 1` composition (D5). Performed **rep editing of existing (non-added)
movements** for non-structured families (still locked). Historical backfill
(none — §60). Logs without a `prescription_snapshot` have no frozen per-instance
anchor for historical re-projection; the new provenance applies only to logs
saved after this ships.

---

## 6. Verdict

`1 → N` composition, `notPerformed`, Modified → Mixed, and full performed
movement/load detail are ready to build with **zero DB migration**. **D4 REVISED
applied to INC-07/08 Intervals is a §71-#7 stop** — a new owner-level structured
result model. Awaiting the owner's choice of Option 1 / 2 / 3. No code, contract,
or schema changed.
