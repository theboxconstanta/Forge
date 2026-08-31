# P10 — HISTORICAL RESULT TRUTH / SNAPSHOT-FIRST READ MODEL — PHASE 0 AUDIT

Date: 2026-09-01
Type: **READ-ONLY AUDIT. No implementation, no migration, no backfill, no
production row mutation, no deployment.**
Status of P10 implementation: **NOT STARTED.**

---

## A. EXECUTIVE SUMMARY

**Verdict: P10 is NOT effectively complete. Real gaps remain, but they are
narrower than the original P10 plan and concentrated in one layer.**

P9.1 → P9.5.5b incrementally solved the **display** layer and the
**performed-prescription** classification signal:

- Result-card movement rows are now performed-first, else frozen text
  (`notes` / `movements_snapshot`) — a coach edit to the current workout, or a
  movement-catalog change, does **not** change the displayed movements of a
  historical result. **(P9.5.5 / P9.5.5b — verified live.)**
- A non-null `performed_prescription` deterministically routes a historical
  result into *Mixed Categories* on the leaderboard bucket and the "Not RX'd"
  badge everywhere. **(P9.5.4.)**
- The score value itself (`result` / `time_result` / `completion_state` /
  `sets` / `log_meta`), the `variant_level` bucket, benchmark-history scoring,
  movement-history, recent-PR events, and the progression note are all read
  from **frozen** columns and are already snapshot-stable.
- Frozen logging identity during a logging session (D+N, coach edit while the
  logger is open) is preserved by `logCtx` / `freezeLoggingContext`
  (P9.1 + INC-04) and the `wod_id` written at save time (INC-03).

**What remains (the actual P10 work):** the leaderboard and Journal
**RX / Not-RX / Mixed classification** for a *primary-section* result still
resolves the *prescribed* side (prescribed weight, prescribed movements,
format, format-config) from the **current `wods` row** and the **current member
gender** — not from the per-log frozen snapshot. A coach editing that workout's
RX load / movements / format, or a member's gender changing, can move a
historical result between the RX and Mixed Categories buckets and flip its
"Not RX'd" badge — even though the score and the displayed movements do not
change.

**Counts:** 5 audited areas **COVERED**, 3 **PARTIAL**, 4 **GAP**, 1
**LEGACY-ONLY schema limitation**, plus several **NOT APPLICABLE**. No **P0**
(a historical result can never become numerically false — score columns are
immutable). **4 P1** (classification / score-interpretation drift after a coach
edit; edit-reopen re-resolution). **1 P2** (gender-dependent weight-column
selection).

**DB mutations during this audit: 0. Production row mutations: 0.**

---

## B. CURRENT ARCHITECTURE

### Result data flow

| path | fetch | snapshot columns present? |
|---|---|---|
| Leaderboard (`fetchClasament`) | `wod_logs.select('*')` filtered by `wod_id` (or `logged_at` range if the workout is gone) + a **separate `wods` fetch by date** into `clasamentWodData` | yes on the log; **`clasamentWodData` is the live current workout** |
| Journal (`fetchWodLogs`) | `wod_logs.select('*, wods(name,type,duration,format_config,movements_*,<weights>))` — a **live FK join** to `wods` | yes on the log; **`w.wods` is the live current workout** (null once deleted) |
| Benchmark history (`groupLogsByBenchmark`) | reuses `wodLogs` (the Journal fetch) | yes; readers use `format_snapshot` |
| Movement history (`groupMovementEntries`) | reuses `wodLogs` / `skillLogs` | yes; readers use `format_snapshot` |
| Progression note (`fetchProgressionForMember`) | `performance_progression_summary` **DB view** keyed by `performance_identity_id` | frozen columns only |
| Share card | built once at save time from the frozen `logCtx` — **no historical re-share path** | n/a |

### Frozen provenance available on a `wod_logs` row

| column | meaning | prod coverage |
|---|---|---|
| `result` / `time_result` / `completion_state` / `sets` / `log_meta` | the score, exactly as saved | all |
| `weight_logged` | the athlete's own logged load (text) | frozen where set |
| `variant_level` | RX / Intermediate / Beginner / OnRamp target chosen at log time | all scalable |
| `notes` | header line + movement text lines, frozen at save (rebuilt from itself on edit, never from the current WOD) | all |
| `movements_snapshot` (`text[]`) | the same movement text as `notes`, as an array | **119 / 422** |
| `format_snapshot` / `format_config_snapshot` | the format identity at log time | **344 / 422** |
| `wod_name_snapshot` | workout name at log time | 344 |
| `prescription_snapshot` (`jsonb`, P9.1) | the **structured** per-movement prescription (with loads), variant + **frozen gender** + `displayLine` per movement | **10 / 422** |
| `performed_prescription` (`jsonb`, P9.5.2) | the athlete's performed overlay when it materially differed | **6 / 422** |
| `performance_identity_id` / `performance_signature` | immutable identity for repeat-comparison | where resolved |

**There is no frozen "prescribed weight for this variant" column.** For a
non-structured (legacy) log, the prescribed-weight side of `isNotRxd` can only
come from the current `wods.<variant>_weight_<sex>` columns. This is a schema
limitation (§M / §Q GAP 5).

---

## C. SNAPSHOT SEMANTICS (as intended)

```
prescription_snapshot   = frozen PROGRAMMED structured prescription at log time  (provenance)
performed_prescription  = frozen PERFORMED prescription when materially modified; NULL = as programmed
format_snapshot / _config_snapshot / movements_snapshot / wod_name_snapshot
                        = frozen scoring/identity context (Scoring Phase 0 trigger `snapshot_wod_log_context`)
```

For an athlete result:

- **PROGRAMMED provenance** → `prescription_snapshot` (structured) / `movements_snapshot` + `format_snapshot` (text) / `notes`.
- **PERFORMED presentation** → `performed_prescription` if non-null, else the programmed provenance.
- **Legacy fallback** → only when the log predates the relevant snapshot.
- **Current live `wods`** → should be *last resort* (workout deleted and no snapshot).

## D. PERFORMED SEMANTICS

`performed_prescription` is only written by `saveWodLog` when
`performedIsModified(...)` is true and `validatePerformedPrescription(...)`
passes (P9.5.2). Therefore `performed_prescription != null` ⇔ the athlete
performed a materially different composition. It is:

- the source for the result-card movement rows (P9.5.5 `resultPerformedLines` →
  `composePerformedResultLines` → `composeStructuredWorkoutDisplay`), resolved
  against `prescription_snapshot.gender` (frozen);
- one input to `resultCompositionModified` / `isMixedCategory` /
  `isNotRxd` (P9.5.4) — its mere presence forces *Mixed / Not RX'd*.

Both are **frozen and self-contained** (each movement carries `name` +
`canonicalMovementId` + specs). A movement-catalog rename/alias/capability
change does **not** alter the performed display (§J).

---

## E. COMPLETE READER INVENTORY

### E.1 SNAPSHOT-FIRST (correct)

| reader | file:fn | source |
|---|---|---|
| Benchmark score display | `benchmarkHistory.js` `benchmarkScoreDisplay` (l.62/74) | `log.format_snapshot` / `format_config_snapshot` |
| Benchmark Best/Latest/Previous + change | `benchmarkHistory.js` `deriveBenchmarkTierSummary` (l.111), `deriveChange` (l.143/146) | `latest.format_snapshot` / `format_config_snapshot` |
| Movement history extraction + comparison identity | `movementHistory.js` (l.215/247/272), `resolveComparisonIdentity` | `format_snapshot` + `log.sets` (frozen) — **explicitly test-proven snapshot-stable**, `movementHistory.test.js:528` |
| Recent PR events | `recentPrEvents.js` (l.49) | `format_snapshot` / `format_config_snapshot` |
| Progression note | `performanceProgression.js` → `performance_progression_summary` view | frozen columns + frozen `performance_identity_id` |
| Result-card **movement rows** | `App.jsx` `resultPerformedLines` / `parseWodLogDetails().miscariAfisate` | `performed_prescription` (frozen) → `notes` (frozen) |
| Journal subtitle when section-linked or workout deleted | `App.jsx` `wodSubtitlu` (l.6024/6027) | `w.format_snapshot` |
| onEditWod format when **section-linked** | `App.jsx` (l.10828/10829) | `log.format_snapshot` / `format_config_snapshot` |

### E.2 PERFORMED-FIRST (correct for result presentation)

| reader | file:fn |
|---|---|
| Leaderboard expanded card movement rows | `App.jsx` `cardMovementLines = resultPerformedLines(log) ?? miscariAfisate` (l.2313) |
| Journal card movement rows | `App.jsx` `cardMovementLines` (l.6058) |
| Share card movement rows | `App.jsx` `composePerformedResultLines(performedToSave, memberGenderKey)` (l.8978) |
| Mixed-Categories bucket signal | `App.jsx` `isMixedCategory(..., log.performed_prescription)` (l.2107) — P9.5.4 |
| Benchmark-history modified badge | `App.jsx` `resultIsCompositionModified` → `resultCompositionModified(..., log.performed_prescription)` (l.5726) — P9.5.5b |

### E.3 CURRENT-WORKOUT DEPENDENT (potential P10 bug)

| reader | file:fn | reads | drift vector |
|---|---|---|---|
| **Leaderboard primary — sort** | `App.jsx` `buildBlocksForPrimary` (l.2089) | `sortSectionLogs(logs, wodZiData.type, wodZiData.format_config)` | coach changes format/config → ranking + capped-vs-finished interpretation of the frozen score changes |
| **Leaderboard primary — prescribed weight** | `App.jsx` `prescribedWeightFor` (l.2094) | `wodZiData[weightKeyForVariant(nivelId, log.profile.gender)]` — **current `wods` weight + current `members.gender`** | coach edits `wods.<v>_weight_<sex>` **or** member gender changes → `greutateEsteSubStandard` flips → RX↔Mixed + badge |
| **Leaderboard primary — prescribed movements** | `App.jsx` `prescribedMovementsFor` (l.2095) | `wodZiData[movements_<v>]` — **current `wods` movements** | coach edits `movements_<v>` → `movementsChanged(notes-lines, current)` flips |
| **Leaderboard card — format/config for `isNotRxd`/`scoreDefinitionFor`/score display** | `App.jsx` `renderGroups` (l.2173-2185) | `wodZiData.type` / `wodZiData.format_config` | as above |
| **Journal card — `isNotRxd` inputs (primary)** | `App.jsx` (l.5999/6005/6053/6054) | `w.wods.<v>_weight_<sex>` + `gender` prop (`userProfile.gender`); `w.wods?.type`/`format_config` **before** `format_type`; **no `format_config` snapshot fallback** | coach edit / gender change → Journal "Not RX'd" badge flips |
| **onEditWod — format/config/prescribed weight (primary)** | `App.jsx` (l.10828/10829/10883) | `log.wods?.type`/`format_config` first; `log.wods?.[weightKeyForVariant(log.variant_level, userProfile.gender)]` | reopening an old log after a coach edit reshapes the score input; `composeWodLogFields` composes against the new format on save |

### E.4 LEGACY FALLBACK (acceptable)

| reader | fallback chain |
|---|---|
| Journal subtitle / name | `w.wods?.name` → `wod_name_snapshot` |
| `formatTipResolvat` (Journal) | `w.wods?.type` → `w.format_type` → `headerFormatId` (parsed from `notes`) |
| onEditWod format (primary) | `log.wods?.type` → `log.format_type` → header → `'For Time'` |

### E.5 NOT APPLICABLE

| reader | why |
|---|---|
| Aggregate / multi-section leaderboard (`aggregateLeaderboard.js`) | renders name + score only; `classifiedTier = log.variant_level` (frozen). No movement presentation. Sorts each section via `sortSectionLogs(logsBySectionId[id], sec.format, sec.format_config)` — **current section config** (same class as E.3 but this feature is unused in prod: 0 `aggregateDefinition` rows). |
| Feed | renders `post.text` (free text) + `post.variant_level` badge; no result reconstruction |
| Movement catalog readers | performed doc + `notes` are self-contained; catalog changes have no effect (§J) |

---

## F. SURFACE AUDIT (per §8)

| surface | movement rows | classification (RX/Mixed/Not-RX) | score / sort | status |
|---|---|---|---|---|
| Leaderboard expanded card | performed-first / frozen text — **COVERED** | current `wods` + current gender — **GAP (P1)** | current `wods` format/config — **GAP (P1)** | **PARTIAL** |
| Leaderboard collapsed card | n/a | same "Not RX'd" badge as expanded — **GAP (P1)** | current format/config sort — **GAP (P1)** | **PARTIAL** |
| Mixed Categories / RX category | performed-first — COVERED | bucket = `isMixedCategory` (current `wods`) except `performed_prescription != null` rows (P9.5.4 stable) — **PARTIAL** | — | **PARTIAL** |
| Male / Female filters | orthogonal — COVERED | filter uses **current** `members.gender` (P0-02) — see §I | — | COVERED (filter) / see §I (weight-column) |
| Journal card | performed-first / frozen text — COVERED | current `w.wods` + `userProfile.gender` — **GAP (P1)** | — | **PARTIAL** |
| Journal edit / reopen (`onEditWod`) | movements from frozen `notes` + `performed_prescription` — COVERED | prescribed weight from current `w.wods` + current gender — **GAP (P1)** | format/config current-first (primary) — **GAP (P1)** | **PARTIAL** |
| Share result card | `composePerformedResultLines` — COVERED; built once at save (no re-share) | frozen `isNotRxd` snapshot at save — COVERED | — | COVERED |
| Benchmark history / detail | no rows; "Not RX'd" badge (P9.5.5b) | `resultCompositionModified` — reads current `w.wods` weight/movements for the non-performed part (see below) | `format_snapshot` — **COVERED** | **PARTIAL** (badge composition-side) |
| PR history / movement history | `format_snapshot` + `log.sets` — COVERED | comparison identity snapshot-stable (test-proven) | `format_snapshot` — COVERED | **COVERED** |
| Athlete profile / workout history | (renders Journal cards) | inherits Journal — **PARTIAL** | — | **PARTIAL** |
| Additional-section leaderboards | `buildBlocksForAdditionalSection` — flat list, no RX/Mixed split; movement rows via `cardMovementLines` (frozen) | `_supportsRx:false` → no classification | `sortSectionLogs(sectionLogs, section.format, section.format_config)` — **current section config (GAP P1)** | **PARTIAL** |
| Aggregate leaderboard | n/a | n/a | current section config; **feature unused in prod** | NOT APPLICABLE |
| Score comparison / "previous score" / progression | DB view, frozen columns | n/a | frozen | **COVERED** |
| PR detection | `evaluate_*_pr` triggers at write time (server) + `recentPrEvents.js` (`format_snapshot`) | — | frozen | **COVERED** |
| Performance analytics (`athlete_performance_summary` etc.) | DB views over frozen `wod_logs` columns | — | — | **COVERED** |

---

## G. CURRENT-WORKOUT DEPENDENCIES (consolidated)

1. `App.jsx:2089` `sortSectionLogs(..., wodZiData.type, wodZiData.format_config)` — leaderboard primary sort.
2. `App.jsx:2094` `prescribedWeightFor` — leaderboard primary, `wodZiData[<v>_weight_<sex>]` + `log.profile.gender`.
3. `App.jsx:2095` `prescribedMovementsFor` — leaderboard primary, `wodZiData[movements_<v>]`.
4. `App.jsx:2173-2185` `renderGroups.sectionFormatId / sectionFormatConfig / sectionData` = `wodZiData.type / format_config` — feeds `isNotRxd` (2303), `scoreDefinitionFor`, `benchmarkScoreDisplay`-style score render, `ascendingTotalReps`.
5. `App.jsx:2138` `sortSectionLogs(sectionLogs, section.format, section.format_config)` — additional-section leaderboard.
6. `App.jsx:5999` Journal `prescribedWeightLog = w.wods?.[weightKeyForVariant(w.variant_level, gender)]` (`gender` = current `userProfile.gender`).
7. `App.jsx:6005` Journal `prescribedMovementsLog = w.wods?.[movements_<v>]`.
8. `App.jsx:6053` Journal `formatTipResolvat = w.wods?.type || w.format_type || headerFormatId` (current-first).
9. `App.jsx:6054` Journal `formatConfigResolvat = w.wods?.format_config` (current-only, **no snapshot fallback**).
10. `App.jsx:10828/10829` `onEditWod` primary format/config current-first.
11. `App.jsx:10883` `onEditWod` `setEditLogPrescribedWeight(log.wods?.[weightKeyForVariant(log.variant_level, userProfile.gender)])`.
12. `App.jsx:5726` `resultIsCompositionModified` → `resultCompositionModified(log, prescribedWeight, loggedMovements, prescribedMovements)` where `prescribedWeight` / `prescribedMovements` come from `log.wods` (current) — benchmark-history badge composition side.

Items 4, 5, 12 also flow through `benchmarkScoreDisplay` indirectly? — no: `benchmarkScoreDisplay` takes `format_snapshot` directly, unaffected.

---

## H. HISTORICAL MUTATION ANALYSIS (per §10 / §17)

**Test T1→T2 (programmed edit):**
- T1: `3 RFT · 15 Power Snatch @ 45 · 200m Run`; athlete logs `12:00`. `notes` freezes the 3 movement lines; `format_snapshot='RFT'`, `format_config_snapshot={rounds:3}`; `prescription_snapshot` written **only if the workout was structured** (10/422 in prod); no weight snapshot.
- T2: coach changes current `wods` to `@ 50` / `400m Run` / adds `timeCapSec`.

| aspect of the historical result | changes at T2? | why |
|---|---|---|
| displayed movements | **no** | `notes` frozen (`parseWodLogDetails`); `performed_prescription` frozen |
| displayed load per movement (structured) | **no** | `performed_prescription` frozen, else no load shown (legacy `notes` has none) |
| score `12:00` | **no** | `time_result` immutable |
| leaderboard rank | **yes, possible** | `sortSectionLogs(..., wodZiData.type='RFT', wodZiData.format_config={rounds:3, timeCapSec:X})` — a new `timeCapSec` changes finished-vs-capped interpretation & tie handling |
| "Not RX'd" badge (leg had `weight_logged='45'`) | **yes** | `greutateEsteSubStandard('45', wodZiData.rx_weight_male='50')` → `45 < 50` → Not RX'd where it was RX |
| Mixed Categories bucket | **yes** | follows the badge (`isMixedCategory` — unless `performed_prescription != null`) |
| variant label (`RX`) | **no** | `variant_level` immutable |

**Test performed T1→T2:** identical, except the movement rows and the
performed loads are additionally frozen by `performed_prescription`, and the
bucket is pinned to *Mixed* by P9.5.4 regardless of the weight comparison — so
a `performed_prescription` result is **classification-stable** already.

**Conclusion:** a historical result can never become *numerically* false
(score columns immutable) → **no P0**. It **can** change *classification* and
*ranking* after a coach edit → **P1**.

---

## I. GENDER MUTATION ANALYSIS (per §13)

- **Leaderboard weight-column selection:** `prescribedWeightFor(nivelId, log)` →
  `weightKeyForVariant(nivelId, log.profile.gender)` with `log.profile.gender`
  from **current `members.gender`**. If a member's gender is corrected, the RX
  weight column read flips (`rx_weight_male` ↔ `rx_weight_female`) →
  `greutateEsteSubStandard` can flip. **GAP (P2)** — gender edits are rare and
  it only affects classification, not the frozen score or the performed display.
- **Journal:** `gender` prop = `userProfile.gender` (current) — same.
- **Performed display:** `resultPerformedLines` uses `prescription_snapshot.gender`
  (frozen) FIRST, `resolveAthleteGenderKey(log.profile.gender)` only as fallback.
  So the performed movement rows are **gender-stable** (P9.5.5). **COVERED.**
- **Gender filter (All / Male / Female):** uses current `members.gender`
  deliberately (P0-02 canonical). A member re-gendered moves between filter
  tabs — this is **intended** (the filter is "who is this now"), and it is
  orthogonal to classification. **COVERED as designed.**
- `prescription_snapshot.gender` exists for **10/422** logs. For the other
  412 there is no frozen gender → legacy gender-column selection stays current
  (unavoidable without schema; §Q).

---

## J. MOVEMENT CATALOG MUTATION ANALYSIS (per §12)

**No gap.** Historical result presentation never touches the live `movements`
catalog:

- `performed_prescription` movements carry their own `name`, `canonicalMovementId`,
  and metric specs. `composeStructuredWorkoutDisplay` → `renderInstanceLine`
  uses `instance.name` verbatim and resolves the embedded specs — it does not
  look up the catalog.
- `parseWodLogDetails().miscariAfisate` is frozen `notes` text.
- `prescription_snapshot.movements[].displayLine` (if it were read) is baked at
  save.

A catalog rename / alias / `allowed_prescription_metrics` / default-metric
change has **zero effect** on any historical result card. `movementHistory.js`
`resolveComparisonIdentity` is likewise a pure function of the frozen snapshot
(`movementHistory.test.js:499/528`).

---

## K. VARIANT MUTATION ANALYSIS (per §14)

- The variant **bucket** (`variant_level`) is frozen — a result logged against
  RX stays grouped under RX. **COVERED.**
- The variant **prescription** (its weight / movements / format) is re-resolved
  from the current `wods` row on both the leaderboard and Journal (§G items
  2, 3, 6, 7). Editing the RX prescription of a past workout changes the
  *comparison basis* for every historical RX result of that workout. **GAP (P1)**
  — same code paths as §H.
- No reader re-derives `variant_level` itself from the current WOD. ✅

---

## L. CLASSIFICATION STABILITY (per §17-20)

| score family | classification input | snapshot-stable? |
|---|---|---|
| TIME / TIME_CAPPED | `weight_logged` (frozen) vs current `wods` weight; `notes` movements (frozen) vs current `wods` movements; `effectiveScoreMode(wodZiData.type, wodZiData.format_config)` | **NO** — weight + movements + format from current |
| AMRAP | `weight_logged` vs current weight; movements as above; AMRAP has no "unfinished" term | **NO** (weight/movements) |
| REPS / LOAD / DISTANCE / CALORIES | `weight_logged` vs current weight; movements as above. **Score magnitude never enters classification** (verified P9.5.4 `p954LeaderboardClassification.test.js` §25) | **NO** (weight/movements) |
| SETS / STAGES | `_supportsRx:false` on additional sections → no RX/Mixed split; primary sets-family uses the same current-`wods` weight/movements | partial |
| `performed_prescription != null` (any family) | forced Mixed / Not-RX by P9.5.4 regardless of the weight comparison | **YES** — stable |
| `neterminatInTimp` (capped) | `effectiveScoreMode(current format)` + `!time_result` (frozen) | format side **NO** |
| completion_state | frozen column | **YES** |

`p954LeaderboardClassification.test.js` proves the *rule* is correct and
family-independent; it does **not** exercise a coach edit between log and read
(the inputs are passed literally).

---

## M. LEGACY FALLBACK (per §24-25)

Current effective hierarchy for a historical result's **movement rows**:
`performed_prescription` → `notes` (`parseWodLogDetails`) — **`prescription_snapshot`
is not consulted for movement content** (only `.gender`). No fabrication.

Current effective hierarchy for **classification prescribed side**:
`current wods.<v>_weight_<sex>` / `current wods.movements_<v>` / `current wods.type` —
with **no snapshot tier**, and legacy fallback (`format_type`, `notes` header)
only for format when `wods` is gone.

**Legacy-only limitation (GAP 5):** there is **no `prescribed_weight_snapshot`
column**. For the 412 non-structured logs, the prescribed-weight comparison
basis cannot be frozen without a schema addition. `movements_snapshot` (119)
and `format_snapshot` (344) *do* exist and *could* be used for the movement /
format sides. `prescription_snapshot` (10) carries per-movement loads and a
frozen gender.

**No backfill is possible or acceptable** — writing today's `wods` weights into
old logs as "history" is explicitly forbidden and would fabricate provenance.

---

## N. DATABASE READ-ONLY INVENTORY (per §26)

Query run 2026-09-01, `wod_logs`:

| metric | value |
|---|---|
| total `wod_logs` | **422** |
| `prescription_snapshot IS NOT NULL` | **10** |
| `performed_prescription IS NOT NULL` | **6** |
| both NULL | **412** |
| `performed_prescription` non-null but `prescription_snapshot` NULL | **0** |
| `format_snapshot IS NOT NULL` | **344** |
| `movements_snapshot IS NOT NULL` | **119** |
| `wod_id IS NULL` | **78** |
| `wod_id IS NOT NULL` | **344** |
| scalable `variant_level` (RX/Int/Beg/OnRamp) | **348** |
| date range | 2026-06-24 → 2026-09-01 |

`movements_snapshot` shape = `text[]`, identical to the `notes` movement lines
(no loads). `format_config_snapshot` = `jsonb` (`{rounds}`, `{workSec,restSec,rounds}`, …).
No contract-invalid `performed_prescription` rows (the P9.5.2 BEFORE trigger
`validate_wod_log_performed_prescription` enforces the contract; all 6 rows pass
`validatePerformedPrescription` client-side). **0 rows updated. 0 mutations.**

---

## O. EXISTING TEST COVERAGE (per §36)

| proven behavior | test |
|---|---|
| `buildPrescriptionSnapshot` deep-clones + is unaffected by a later doc mutation (P1→P2 race) | `prescriptionContract.test.js:235/353/376/418/425` |
| snapshot recoverable: programmed-vs-resolved, universal/sex-specific | `prescriptionContract.test.js:336` |
| snapshot keeps decimals numeric | `prescriptionContract.test.js:585` |
| performed doc = frozen clone of the programmed variant | `performedPrescription.test.js:32` + deep-clone isolation test |
| performed result lines use the **frozen** gender (male/female/null) | `p955ResultPerformedProjection.test.js:55/61` |
| performed projection: load / distance / calorie / substitution / multiple / repeated / order / fail-closed / LOAD-scored | `p955ResultPerformedProjection.test.js` (20) |
| leaderboard bucket = composition rule, family-independent; score magnitude never sets RX; no over-correction; performance dimension orthogonal | `p954LeaderboardClassification.test.js` (50) |
| `isNotRxd` / `isMixedCategory` + `performed_prescription` | `workoutFormats.test.js` |
| movement-history comparison identity is a pure fn of the frozen snapshot and **never reaches for live data** | `movementHistory.test.js:499/528` |
| movement-history excludes legacy NULL-`format_snapshot` rows safely | `movementHistory.test.js:127/488` |
| App() boots with `performed_prescription` absent/null; hook-order integrity | `appHookOrderIntegrity.test.js` |
| `scoreDefinitionFor` legacy-duration cap; toggle payloads | `scoreDefinition.test.js`, `p953LogWodScoreUx.test.js`, `universalScoreInput.test.jsx` |

---

## P. MISSING TESTS

(a missing test ≠ broken production behavior; it means the behavior is
unverified)

1. **No test** mounts the leaderboard / Journal classification against a
   *coach edit between log and read* — i.e. "log RX @45, coach changes RX to
   @50, historical result must stay RX/at-its-bucket". (Would currently **fail**
   — behavior is current-dependent.)
2. **No test** for `onEditWod` snapshot-first (reopening an old log resolves
   format/config/prescribed-weight from the frozen snapshot, not current
   `wods`). (Would currently **fail** for primary logs.)
3. **No test** for gender-mutation stability of classification.
4. **No test** that `sortSectionLogs` ordering for a historical leaderboard
   uses `format_snapshot` rather than the current workout format.
5. **No test** for the workout-deleted path (`wod_id` null, `wods` join null) —
   what the leaderboard/Journal classification does with no prescribed side at
   all.
6. **No test** for `benchmarkDetail` history rows rendering (the P9.5.5b badge
   is only statically asserted, not render-tested — no live data).

---

## Q. P10 GAP MATRIX

| # | AREA | CURRENT SOURCE | EXPECTED SOURCE | STATUS | RISK | ACTION |
|---|---|---|---|---|---|---|
| 1 | Leaderboard result **movement rows** | `performed_prescription` → `notes` | same | **COVERED** | none | none (P9.5.5) |
| 2 | Leaderboard **bucket** for `performed_prescription != null` | `isMixedCategory(..., performed_prescription)` | same | **COVERED** | none | none (P9.5.4) |
| 3 | Leaderboard **bucket / "Not RX'd"** for a non-performed scalable result — **prescribed weight** | current `wods.<v>_weight_<sex>` + current `members.gender` | frozen: `prescription_snapshot` load standard (structured) / **legacy-only** where absent | **GAP** (structured) / **LEGACY-ONLY** (412 rows) | **P1** | P10.1 + P10.2 |
| 4 | Leaderboard **bucket / "Not RX'd"** — **prescribed movements** | current `wods.movements_<v>` | frozen `movements_snapshot` (else `notes`) | **GAP** | **P1** | P10.1 + P10.2 |
| 5 | Leaderboard **sort + score interpretation** (`sortSectionLogs`, `scoreDefinitionFor`, `effectiveScoreMode`) | `wodZiData.type` / `format_config` | frozen `format_snapshot` / `format_config_snapshot` (344 rows) | **GAP** | **P1** | P10.2 |
| 6 | Additional-section leaderboard **sort** | current `section.format` / `format_config` | frozen per-log `format_snapshot` | **GAP** | **P1** | P10.2 |
| 7 | Journal card **"Not RX'd"** (primary) — weight / movements / format / config | current `w.wods` + current gender; `format_config` has no snapshot fallback | frozen snapshot | **GAP** | **P1** | P10.3 |
| 8 | Journal **reopen / edit** (`onEditWod`, primary) — format / config / prescribed weight | current `log.wods` + current gender | frozen `format_snapshot` / `format_config_snapshot` / snapshot weight | **GAP** | **P1** | P10.4 |
| 9 | Gender-dependent weight-**column** selection (classification) | current `members.gender` / `userProfile.gender` | `prescription_snapshot.gender` (frozen) where present, else current | **GAP** (structured) / **LEGACY-ONLY** | **P2** | P10.5 |
| 10 | Result-card **movement display** vs catalog changes | frozen (self-contained) | same | **COVERED** | none | none |
| 11 | Result-card **movement display** vs gender changes | `prescription_snapshot.gender` frozen | same | **COVERED** | none | none (P9.5.5) |
| 12 | Benchmark **scoring** history | `format_snapshot` / `format_config_snapshot` | same | **COVERED** | none | none |
| 13 | Benchmark-history **modified badge** composition side | current `w.wods` weight/movements (+ frozen `performed_prescription`) | frozen snapshot | **PARTIAL** | **P2** | P10.3 (shared) |
| 14 | Movement history / comparison identity | `format_snapshot` + `log.sets` | same | **COVERED** | none | none |
| 15 | Progression note / PR detection / analytics | frozen columns / DB views / frozen `performance_identity_id` | same | **COVERED** | none | none |
| 16 | Score **value** (`result` / `time_result` / `completion_state` / `sets`) | frozen columns | same | **COVERED** | none | none |
| 17 | `variant_level` bucket | frozen column | same | **COVERED** | none | none |
| 18 | Frozen logging identity during logging (D+N, live coach edit) | `logCtx` / `freezeLoggingContext` / `snapshotPrescriptionDoc` | same | **COVERED** | none | none (P9.1 + INC-04) |
| 19 | Log ↔ workout attachment (D+N) | `wod_id` frozen at save; `resolveWodIdForLog`; dual-write trigger invariant | same | **COVERED** | none | none (INC-03) |
| 20 | Share card | built once at save from frozen `logCtx`; no re-share | same | **COVERED** | none | none |
| 21 | Aggregate / multi-section leaderboard | `variant_level` + score; section config current (feature unused in prod) | frozen | **NOT APPLICABLE** | none | (fold into P10.2 if ever used) |
| 22 | **Schema:** frozen prescribed-weight for legacy logs | none | (would need a column) | **LEGACY-ONLY** | **P1 residual** | **report only — do not add a column; accept current-dependence for the 412 legacy rows OR decide in P10 review** |

**Tally:** COVERED 12 · PARTIAL 3 · GAP 6 · LEGACY-ONLY 2 · NOT APPLICABLE 1.
**P0: 0 · P1: 6 (rows 3,4,5,6,7,8) · P2: 3 (rows 9,13, + residual 22).**

---

## R. MINIMAL P10 IMPLEMENTATION PROPOSAL

*Proposed only. Not implemented. Awaiting owner approval.*

### P10.1 — shared historical-result provenance resolver (pure)

`prescriptionContract.js` (⇄ `.ts`): one pure function

```
resolveResultProvenance(log) -> {
  formatId,            // log.format_snapshot ?? log.wods?.type ?? log.format_type ?? headerFormatId
  formatConfig,        // log.format_config_snapshot ?? log.wods?.format_config
  prescribedMovements, // log.movements_snapshot ?? (parsed notes) ?? log.wods?.[movements_<v>]
  prescribedWeightStandard, // structuredVariantLoadStandard(log.prescription_snapshot, gender)
                            //   ?? null  (legacy: no frozen weight -> classification weight term is skipped, NOT taken from current wods)
  gender,             // log.prescription_snapshot?.gender ?? resolveAthleteGenderKey(current)
  tier: log.variant_level,
  source: 'snapshot' | 'legacy-format-only' | 'legacy-none',
}
```

Key decision to confirm with owner: for the 412 legacy rows with **no frozen
prescribed weight**, P10 should **stop reading the current `wods` weight** and
instead treat the weight term of `isNotRxd`/`isMixedCategory` as *unknown* →
the result stays in its `variant_level` bucket unless `movementsChanged` or
`performed_prescription` says otherwise. (This *removes* a signal for legacy
rows rather than keeping a drifting one. Alternative: keep current behavior for
legacy and only fix structured — smaller change, but legacy rows still drift.)

### P10.2 — leaderboard reads provenance per log

`App.jsx` `buildBlocksForPrimary` / `renderGroups` / `buildBlocksForAdditionalSection`:
replace `wodZiData.*` / `section.*` with `resolveResultProvenance(log)` for
`sortSectionLogs`, `prescribedWeightFor`, `prescribedMovementsFor`,
`sectionFormatId/Config`, `isNotRxd`, `isMixedCategory`, `scoreDefinitionFor`.
`wodZiData` stays only for the header ("RFT 15:00") and the empty-state.

### P10.3 — Journal + benchmark-badge read provenance

`App.jsx` Journal card: `isNotRxd` / `resultIsCompositionModified` inputs from
`resolveResultProvenance(w)` instead of `w.wods` + `userProfile.gender`.

### P10.4 — `onEditWod` snapshot-first for primary logs

Drop the `log.workout_section_id ?` guard on the `format_snapshot` /
`format_config_snapshot` reads — use them for primary logs too.
`editLogPrescribedWeight` from `resolveResultProvenance(log)`.

### P10.5 — gender

`resolveResultProvenance` returns the frozen `prescription_snapshot.gender`
where present; classifiers use it. Legacy rows unavoidably use current gender.

### Tests

- `p10HistoricalResultTruth.test.js` — table matrix: log RX @X, mutate the
  passed "current" workout (weight / movements / format / config / gender),
  assert classification + sort + score-interpretation are **unchanged**;
  legacy-no-snapshot path; workout-deleted path; `performed_prescription` path
  stays Mixed.
- render tests for the leaderboard + Journal card against a stale-current /
  fresh-snapshot pair.

### NON-goals

No schema change, no migration, no backfill, no `prescribed_weight_snapshot`
column, no UI redesign, no `App()` split, no capped-semantics change, no
leaderboard-sort-algorithm change (only its *inputs*), no P9.5.4 classification
rule change.

---

## S. WORK ALREADY COMPLETED BY P9.x (do NOT re-implement)

| original P10 concern | solved by | evidence |
|---|---|---|
| Leaderboard result **movement presentation** performed-first | **P9.5.5** | live: Aug-31 card `@ 25 kg` / `@ 24 kg` |
| Journal result **movement presentation** performed-first | **P9.5.5** | `cardMovementLines` (l.6058) |
| Share result **movement presentation** performed-first | **P9.5.5** | `composePerformedResultLines(performedToSave,…)` |
| Result movement rows **frozen against coach edits** (`notes` / `performed_prescription`) | **P9 / P9.5.2 / P9.5.5** | `notes` rebuilt from itself; `performed_prescription` immutable column |
| Result movement rows **frozen against movement-catalog changes** | **P9.4 / P9.5.5** | performed doc self-contained; §J |
| Result movement rows **frozen against gender changes** | **P9.5.5** | `prescription_snapshot.gender` first; `p955…test.js:55/61` |
| `performed_prescription != null` → **Mixed Categories** bucket + "Not RX'd" | **P9.5.4** | `p954LeaderboardClassification.test.js` |
| RX/Modified rule is one canonical function, family-independent, score-magnitude-blind | **P9.5.4** | `resultCompositionModified`; §25/§30 tests |
| Frozen logging identity during a logging session (P9.1 `logCtx` by value) | **P9.1** | `snapshotPrescriptionDoc`, `inFrozenLogFlow`, `freezeLoggingContext`; still in place |
| INC-04 historical Log Score opens the right workout | **INC-04** | `homeDisplayIsCurrent` gate, `logCtx` at click |
| Log ↔ workout attachment survives D+N and editing the workout date | **INC-03 / yesterday-WOD** | `wod_id` frozen; `sync_workout_engine_v2` invariant trigger |
| Benchmark-history **scoring** snapshot-stable | **Scoring Phase 0 + Results Phase 2** (pre-P10, built correctly) | `benchmarkHistory.js` uses `format_snapshot` |
| Movement-history comparison identity never reaches for live data | **Canonical Movement Identity / Results Phase 2** | `movementHistory.test.js:528` |
| Score value / `variant_level` / `completion_state` immutability | inherent — frozen columns | — |
| Recent-PR events snapshot-stable | **Results Phase 2 Slice 5** | `recentPrEvents.js` uses `format_snapshot` |
| Benchmark-history **modified indicator** on a score-only surface | **P9.5.5b** | `resultIsCompositionModified` |

---

## T. RECOMMENDATION

**IMPLEMENT P10 — a minimal, focused implementation (P10.1–P10.5 above).**

P10 has **not** been completed incrementally. P9.1–P9.5.5b delivered the
**display** half of the original P10 vision (result cards show frozen /
performed movement content, stable against coach edits, catalog changes, and
gender changes) and the `performed_prescription` **classification signal**. The
**classification/ranking** half — making `isNotRxd` / `isMixedCategory` /
`sortSectionLogs` / `scoreDefinitionFor` read the per-log frozen snapshot
instead of the current `wods` row — is genuinely outstanding and is a real
**P1**: a coach editing a workout's RX load / movements / format after athletes
have logged silently re-buckets and re-badges their historical results.

The implementation is small and well-scoped because the primitives already
exist: `prescription_snapshot`, `format_snapshot` / `format_config_snapshot` /
`movements_snapshot`, `structuredVariantLoadStandard`, `resolveAthleteGenderKey`,
`resultCompositionModified`. The main work is one shared
`resolveResultProvenance(log)` resolver plus swapping ~12 call sites in
`App.jsx` from `wodZiData` / `w.wods` to that resolver, with a table-driven
"coach edits the workout after the log" regression matrix.

**One product decision to make in P10 review (§R P10.1):** for the 412 legacy
logs with no frozen prescribed weight, either (a) **drop** the weight term of
the classification (result stays in its `variant_level` bucket unless movements
changed / performed overlay present) — cleaner, removes the drift, at the cost
of losing a "scaled the load" signal for pre-P9.1 logs; or (b) **keep** the
current `wods` weight for legacy only — smaller diff, legacy rows still drift.
No schema change either way.

---

## §42 FINAL RESPONSE SUMMARY

1. **Verdict:** IMPLEMENT P10 (minimal). Not already complete.
2. **Counts:** COVERED 12 · PARTIAL 3 · GAP 6 · LEGACY-ONLY 2 · N/A 1.
3. **P0/P1:** 0× P0. 6× P1 (leaderboard + Journal classification, sort, score
   interpretation, edit-reopen all read the current workout instead of the
   per-log snapshot). 3× P2 (gender-column selection; benchmark badge
   composition side; legacy-weight residual).
4. **Can historical results drift after a coach edits the workout?** **YES** —
   classification (RX ↔ Mixed Categories, "Not RX'd" badge) and leaderboard
   ranking / score interpretation can change. The **score value and the
   displayed movement rows cannot** (frozen).
5. **Can a gender change alter historical display?** **Movement display: NO**
   (frozen `prescription_snapshot.gender`, P9.5.5). **Classification: YES** —
   the prescribed-weight *column* (`_male` vs `_female`) is picked from the
   current member gender.
6. **Can a movement-catalog change alter historical display?** **NO** — the
   performed doc and `notes` are self-contained.
7. **Already solved by P9.1–P9.5.5b:** all result-card movement presentation
   (performed-first, frozen against coach/catalog/gender), the
   `performed_prescription` → Mixed bucket, the canonical composition rule,
   frozen logging identity, D+N attachment, score-value/variant/completion
   immutability, benchmark/movement/PR-history scoring stability, share card.
8. **Minimal P10:** P10.1 shared `resolveResultProvenance(log)` resolver;
   P10.2 leaderboard uses it; P10.3 Journal + benchmark badge use it;
   P10.4 `onEditWod` snapshot-first for primary logs; P10.5 frozen gender;
   + a "coach edits after log" regression matrix. No schema change, no backfill.
9. **DB mutations during this audit: 0.**
10. **Production row mutations during this audit: 0.**
11. **P10 IMPLEMENTATION NOT STARTED.**

---

## HARD STOP

Audit complete. **No implementation. No deployment. Awaiting owner approval of
the P10.1–P10.5 proposal (and the §R legacy-weight product decision).**
