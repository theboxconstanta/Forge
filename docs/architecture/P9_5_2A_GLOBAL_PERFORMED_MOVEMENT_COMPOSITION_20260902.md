# P9.5.2A — Global Performed Movement Composition (Add / Change / Delete / Not Performed)

**Date:** 2026-09-02 → **CLOSED/GREEN 2026-09-03**
**Status:** **CLOSED / GREEN.** Option 2 shipped. Production smoke PASSED
(latest canonical submission wins regardless of score; Modified → Mixed
Categories; edited reps/composition reflected; Journal ↔ Leaderboard consistent;
refresh preserved). `app_version` = `perf-movement-composition-p9-5-2a-20260903`;
prod bundle `assets/index-CIODaqJd.js`.
**Priority:** P1 — member logging / result truth / leaderboard classification.

Commits on `main`: `bdba1a9` contract v2 · `497b9d6` validator migration +
INC-08 projection · `4c3b3bf` Sequential AMRAP station swap · `f3c8258` grouped
editor · `6f8db37` Intervals per-cell inputs + save · `7128280` S/T tests ·
`3241e7c` as-built doc · `dbc41c2` editable performed reps · `d76e56e` doc ·
`b02a3c2` INC-09 latest-log LB fix · `6d20305` doc. forge-admin-web `fcbb7a1` +
`f9cbef7` (contract parity). Migration `20260902140000` (applied + registered).

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

## 6a. Production smoke — PASSED (2026-09-03)

Owner ran the smoke on live (member `97a4e88a` "Test", wod `1858f4da` Sequence
AMRAP chipper + a structured Intervals workout). Confirmed:

- **latest canonical submission wins regardless of score** — a newer
  edited/re-logged result replaces an older better-scoring one in the
  leaderboard (INC-09 LB fix `b02a3c2`);
- a **Modified** result routes to **Mixed Categories**, programmed variant
  preserved;
- **edited performed reps / composition** are reflected in the score, Journal
  and Leaderboard detail;
- **Journal ↔ Leaderboard consistent** (same canonical latest row);
- **refresh preserves** the correct result.

Then: `app_version` bumped to `perf-movement-composition-p9-5-2a-20260903`; prod
bundle `assets/index-CIODaqJd.js` verified to carry the P9.5.2A markers
(`sourceInstanceId`, Mark-Not-Performed RO+EN, `performedEditMetric_reps`).

## 6. Decision

**Owner approved OPTION 2 (2026-09-02).** Build the smallest versioned,
backward-compatible structured-result extension that makes P9.5.2A semantically
correct for BOTH INC-11 Sequential AMRAP and INC-07/08 structured Intervals. No
Option 1 approximation.

---

## 7. Versioned structured-result contract (Option 2)

### 7.1 `performed_prescription` v2 — the composition (all formats)

`PERFORMED_PRESCRIPTION_VERSION: 1 → 2`. Additive; v1 docs stay v1 (read with v1
semantics, never rewritten — §backward-compat). Two new optional fields per
movement:

```jsonc
{
  "version": 2,
  "variantKey": "rx|intermediate|beginner|onramp|null",
  "sectionId": "…|null",
  "source": "performed",
  "movements": [
    {
      "instanceId": "mi_…",            // stable, unique within the doc (as v1)
      "sourceInstanceId": "mi_…",      // NEW — the PROGRAMMED instance this entry
                                       //   derives from. An unchanged/replaced
                                       //   original carries its own id; an added
                                       //   sibling carries the source's id.
      "name": "Burpee",
      "canonicalMovementId": "uuid|null",
      "reps": {…}?, "load": {…}?, "distance": {…}?, "calories": {…}?,
      "substitutedFrom": {…}?,          // as v1
      "notPerformed": true?            // NEW — sentinel: this source was NOT
                                       //   performed. The ONLY entry for that
                                       //   sourceInstanceId; carries the
                                       //   programmed name for display; no metrics.
    }
  ]
}
```

- **Flat + ordered** (§8/§29). Groups are *derived* by partitioning on
  `sourceInstanceId`, preserving array order. Entries of one group are
  contiguous. Group order follows programmed source order.
- **1 → 1**: one entry, `sourceInstanceId === programmed instanceId` (may be
  substituted — `applyPerformedSubstitution`, `sourceInstanceId` unchanged).
- **1 → N**: N contiguous entries sharing one `sourceInstanceId`, insertion
  order preserved (§6/§9), duplicates allowed (§10).
- **1 → 0 / Not Performed** (D2=B): exactly one sentinel
  `{ instanceId, sourceInstanceId, name:<programmed name>, notPerformed:true }`.
  Never `0 reps`, never `[]`, never a missing/deleted source (§21/§22).
- **Rep inheritance** (D3=A): an added entry inherits the source instance's
  resolved `reps` for round-structured families where the target is unambiguous
  (For Time / RFT / Chipper / Ladder, AMRAP Repeated Rounds, EMOM, Intervals,
  Sequential-AMRAP fixed stations, Strength). Left blank otherwise. No invented
  reps.
- **Normalization → NULL** (§24, T7): if every programmed source resolves 1 → 1
  to exactly its programmed instance (identity + athlete-resolved
  reps/load/distance/calories equal) with no `notPerformed`, same count/order →
  store NULL. **`notPerformed` NEVER normalizes** (§25).
- **Capabilities** (§37): added entry seeds only the metric specs its canonical
  movement allows (`resolveMovementCapability`). REST excluded from the selector
  (§16).

**DB validation:** the live trigger `validate_wod_log_performed_prescription()`
hard-codes `version = '1'` → a v2 doc would be rejected. One
`CREATE OR REPLACE FUNCTION` migration widens it to accept `1` **or** `2`,
validates the two new optional fields (`sourceInstanceId` string,
`notPerformed` boolean; a `notPerformed` entry skips metric-completeness), and
stays `SECURITY INVOKER`, fail-closed. **No table / column / index / RLS change.**
`wod_logs.performed_prescription` is the same jsonb column. Owner flagged this as
NOT a "DB schema migration"; documented here for transparency.

### 7.2 Structured Intervals — `wod_logs.sets` v2 rows (INC-07/08)

`sets` stays `{ <intervalStationKey>: [row, …] }`. The key is
`intervalStationKey(round, stationIndex, PROGRAMMED station name)` — **frozen at
save from the programmed station** (round / station identity + round-major order
+ `parseIntervalStationKey` all unchanged — §interval-identity). One programmed
`(round, station)` cell now holds **0 / 1 / N rows**.

Row v2 form (a row **with** a `pm` key = new contract; **without** = legacy
INC-08 row, rendered exactly as today):

```jsonc
{
  "reps": "10", "weight": "", "completed": true,
  "pm": {                              // NEW — performed-movement marker
    "instanceId": "mi_…",
    "sourceInstanceId": "mi_…",        // = the programmed station's instance
    "name": "Burpee",
    "canonicalMovementId": "uuid|null",
    "notPerformed": true?              // a not-performed cell = ONE row, reps ""
  }
}
```

- **Score** (`Total Reps`): `computeSetsScore` already flattens every row of
  every key and sums `reps` — **N rows per cell sum automatically, zero change**.
  A `notPerformed` cell (`reps:""`) → `parseInt("")` = NaN → filtered → **0
  contribution** (§interval-rep-aggregation, S6). **No double-count** — the
  programmed target is provenance only; it is never a row (§39, S4).
- `Lowest Reps` mode: unchanged (`Math.min` over the same flattened rows).
- **Projection**: `resolveStructuredIntervalResult` gains a `performedEntries`
  array per cell (legacy cell → single entry, unchanged output shape otherwise).
  `5 × 3` stays `5 × 3` (§interval-identity, S1); a split cell has 2
  `performedEntries` (S2/S3).
- **Reopen**: `sets` rows carry `pm` → the interval logger rebuilds the per-cell
  composition; `performed_prescription` v2 carries the same identity for the
  editor. No collapse to programmed A (§reopen, S23).

### 7.3 Sequential AMRAP — no new persisted field (INC-11)

Score stays `wod_logs.result` (text) via `composeSequentialAmrapResult`.

- `resolveSequentialAmrapStations` is fed the **performed composition** (from
  `performed_prescription` v2) instead of the programmed movement list when an
  overlay exists: each performed entry becomes one station in the flat ordered
  list, carrying its inherited `reps` (→ `fixed`/`open` role via the existing
  `repTargetOf`). A `notPerformed` source → one station, empty (not reached / 0).
- `sequentialAmrapTotalReps` and the leaderboard's `partialRepsOfLog(log, true)`
  operate on the (now longer) result string unchanged — Σ includes every split
  child (§4, S19).
- `autoCompleteSequentialProgress`: prior FIXED stations (incl. split children
  with inherited targets) auto-complete to target → Σ = actual work; the
  programmed parent is not itself a station → **no double-count** (S22).
- not-reached ≠ explicit zero, open-station semantics, deterministic reopen —
  all preserved; the helpers are unchanged, only their `stations` input widens
  (S20/S21/S23).
- **Reopen**: `stations` resolved from `performed_prescription` v2 →
  `parseSequentialAmrapResult(log.result, stations)`.

### 7.4 Backward compatibility (mandatory)

| Old log | Detection | Rendering |
|---|---|---|
| INC-07/08 interval, `sets` rows without `pm` | no `pm` key on any row | INC-08 `resolveStructuredIntervalResult` v1 path (`rows[0]`), unchanged |
| INC-11 sequential, `performed_prescription` NULL or `version 1` | version check | stations from frozen movement lines (current path) |
| Any log, `performed_prescription version 1` | `doc.version === 1` | v1 positional semantics, never rewritten |

**No historical backfill. No reinterpretation. No mutation of old logs.** New
saves use v2; old reads use their own frozen version (§backward-compatibility).

### 7.5 Zero schema migration

`performed_prescription` and `sets` are existing jsonb columns. The only DDL is
one `CREATE OR REPLACE FUNCTION` on the validation trigger (no table/column/
index/RLS) — `supabase/migrations/20260902140000_p9_5_2a_performed_prescription_v2.sql`,
applied + registered on the linked prod DB, verified: a v2 composition +
`notPerformed` doc INSERTs (ROLLBACK); a v2 doc missing `sourceInstanceId` is
rejected. No `ALTER TABLE` needed.

### 7.6 As-built — file map

| Area | File(s) |
|---|---|
| Contract v2 | `src/prescriptionContract.js` ⇄ `forge-admin-web/.../prescriptionContract.ts` — `PERFORMED_PRESCRIPTION_VERSION=2`, `performedCompositionGroups`, `performedEntriesForSource`, `performedStationInstances`, `addPerformedMovement`, `deletePerformedMovement`, `markSourceNotPerformed`, `restoreSourcePerformed`, source-anchored `performedMatchesProgrammed`, group-aware `composePerformedResultLines` |
| DB validator | `supabase/migrations/20260902140000_…` |
| Interval result projection | `src/resultIntervalStructure.js` — per-cell `performedEntries` + `notPerformed` + `hasComposition`; `src/App.jsx` `IntervalResultRounds` renders it |
| Sequential AMRAP | `src/App.jsx` — `sequentialAmrapStations` resolves from `performedStationInstances` when a v2 overlay is modified; reopen from `log.performed_prescription` |
| Interval logger | `src/FormatLogger.jsx` `SetsFields` (structured branch) — N reps inputs / cell, `pm`-marked rows; `src/App.jsx` `intervalCompositionActive` + threading via `src/UniversalScoreInput.jsx` |
| Editor UI | `src/App.jsx` `PerformedMovementSearch` / `PerformedEditRow` / `PerformedEditPanel` (grouped) |
| i18n | `src/translations.js` — `performedEdit{DeleteMovement,AddMovement,MarkNotPerformed,RestoreMovement,…}` RO + EN |
| Modified → Mixed (D6) | unchanged — `isMixedCategory(…, log.performed_prescription)` already routes any non-null overlay to Mixed; `_nivelOriginal` preserves the programmed tier |
| Tests | `src/p9_5_2aPerformedComposition.test.js` (17), `src/p9_5_2aStructuredScoring.test.js` (10) |

### 7.6b Performed reps are editable (owner follow-up, commit `dbc41c2`)

D3 inheritance is the **initial default, not a lock**. `PerformedEditRow`
renders an editable `REPS` control (integer `PmpeNumField`, same as
load/distance/calories) wherever:
- the entry carries a **numeric** reps spec (a text scheme `"21-15-9"` stays
  read-only context), **and**
- the score family is **not structured Intervals** (`repsEditable = getFormat(id).rowMode !== 'interval'` —
  the round-by-round interval logger owns per-round reps), **and**
- the entry is not a `notPerformed` sentinel.

Applies to the **original** performed entry and to **added** movements.
`addPerformedMovement` inherits the source reps only when the target movement's
capability counts reps (`allowed` includes `reps`, or is unknown) — a
distance/calorie movement added under a rep source gets no spurious REPS field
(§R13). Edited reps flow to: Modified/Mixed (`performedMatchesProgrammed`
compares resolved reps; restoring exact programmed reps → NULL), Journal /
Leaderboard (`renderInstanceLine` leads with the reps token), and Sequential
AMRAP score (`repTargetOf` reads the edited spec value → station target). Tests
`src/p9_5_2aPerformedReps.test.js` (R1–R16). **Production smoke still owed.**

### 7.6c LB blocker — INC-09 latest-log selection for edits / re-logs (commit `b02a3c2`)

**Smoke failure:** after saving a newer edited/re-logged performed result, the
leaderboard kept an older better-scored row.

**Forensic** (member `97a4e88a`, wod `1858f4da` — Sequence AMRAP chipper,
section `968dc186` = `metcon`/primary, `wod_date 2026-09-02`): 4 RX `wod_logs`,
all `logged_at` business-date `2026-09-02` — `04:58` (ppv2), `04:59` (ppv2,
161), `05:16` (ppv2), `07:54` (no pp, As Prescribed). The reducer picks `07:54`
(max `logged_at`) — correct *for that data*. The bug bites the **next** save.

Two defects break "latest submission wins" for a re-log / edit:

1. **`wod_logs` has no `created_at`** — `logged_at` = business-date (Journal
   day-grouping) + wall-clock. A re-log / edit of a **past** workout done
   earlier in the day than an existing submission gets a **smaller**
   `logged_at` → `logIsMoreRecent` keeps the old row. **Fix (write-time only):**
   `monotonicLoggedAt({ base, siblingLoggedAts, now })` — the row being saved
   gets `clamp(max(base, latestSibling + 1s), [base, now])`; no later sibling →
   `base` unchanged. Wired into `saveWodLog` INSERT **and** edit UPDATE
   (`resolveMonotonicLoggedAt` runs the sibling query). Never rewrites another
   row, never consults score.

2. **`buildBlocksForAdditionalSection` never ran the INC-09 reducer** — it
   passed raw logs to `sortSectionLogs`, whose internal per-member dedup is
   **score-first** (`compara`: finished → time → rounds → partial, `logged_at`
   only a tie-break) → an additional scored section kept the member's **best**
   result, not the latest. **Fix:** `dedupLatestPerMember()` before
   `sortSectionLogs`, exactly like the primary metcon path.

New pure module `src/leaderboardSelection.js` (`dedupLatestPerMember`,
`monotonicLoggedAt`); tests `src/leaderboardSelection.test.js` (LB1–LB3, LB9,
LB10 + monotonic edges). INC-09 `logIsMoreRecent` unchanged.

### 7.7 Known limitations (v1 of Option 2)

- Result-card "not performed" line renders the EN suffix `— not performed`
  regardless of locale (`resolveResultMovementLines` is a pure module with no
  `t`); the logger + editor are localised.
- An Intervals composition change made AFTER reps were already entered resets
  the per-cell score inputs (`commitPerformedEdit` clears `wodSets` on an
  interval station-signature change) — deliberate, prevents orphan rows /
  double count; the athlete re-enters reps for the new composition.
- `N → 1` composition — deferred (D5).
- Rep editing of existing (non-added) movements for non-structured families —
  still locked (P9.5.2 scope).
