# P9.5.2A — Global Performed Movement Composition (Add / Change / Delete)

**Date:** 2026-09-02
**Status:** **AUDIT COMPLETE / OWNER DECISION REQUIRED** — implementation NOT started.
**Priority:** P1 — member logging semantics.

---

## 0. Problem

Member logging already supports a **performed prescription** overlay (P9.5.2):
inside *"What you actually did"* a member can, per programmed movement, **Change
movement** and edit relevant characteristics (load / distance / calories).

The overlay is strictly **1 programmed movement → 1 performed movement**. Real
training is not: a member may perform **more than one movement** in place of a
single programmed movement (global `1 → N`, e.g. `Burpee Pull-up` performed as
`Burpee` + `Ring Row`). P9.5.2A is the request to make performed composition
global `1 → N` for **any** movement / variant / workout / supported score family
— with no movement-specific and no format-specific hacks.

---

## 1. Audit — current contract (live-verified, project `sdfkvfbvgpuspnnnwqwk`)

### A1 — Exact current shape of `performed_prescription`

`wod_logs.performed_prescription jsonb NULL` (migration
`20260831090000_wod_logs_performed_prescription.sql`). Contract v1
(`PERFORMED_PRESCRIPTION_VERSION = 1`, `src/prescriptionContract.js` ⇄ `.ts`):

```jsonc
{
  "version": 1,
  "variantKey": "rx" | "intermediate" | "beginner" | "onramp" | null,
  "sectionId": "<workout_section uuid>" | null,
  "source": "performed",
  "movements": [
    { "instanceId": "mi_…",              // stable, unique within the doc
      "name": "Dumbbell Clean",
      "canonicalMovementId": "<uuid>" | null,
      "reps": {…}?, "load": {…}?, "distance": {…}?, "calories": {…}?,
      "substitutedFrom": { "canonicalMovementId": "<uuid>|null", "name": "Power Clean" }? }
  ]
}
```

`movements[]` is the **same per-instance shape** as one `wods.movement_prescriptions`
variant. Metric specs: `{mode:'universal', value}` (athlete edits always) or
`{mode:'sex_specific', male, female}` (untouched inherited specs) or
`{mode:'text', text}` for `reps`.

### A2 / A3 — How a performed movement is associated with a programmed movement today

**By array position, reinforced by a reused `instanceId`.** The initial draft
(`buildPerformedPrescriptionDraft`) is a deep VALUE clone of the frozen
programmed variant's `movements[]` — same order, same `instanceId`s.
`performedMatchesProgrammed` / `performedComparableInstances` compare the two
lists **index-by-index** (`JSON.stringify(a) === JSON.stringify(b)`).
There is **no explicit "source anchor" field.** Association is implicit:
*performed `movements[i]` corresponds to programmed `movements[i]`.*

### A4 — Can repeated programmed movements be distinguished?

**Yes, at edit/save time.** Each programmed instance has a distinct
`instanceId` (`mi_` + 21 urlsafe chars), stable in the frozen logging context
(`logCtx.prescriptionDoc`, P9.1) and frozen again into
`prescription_snapshot.movements[].instanceId` (`buildPrescriptionSnapshot`).
Two `Walking Lunges` positions are therefore distinguishable **by `instanceId`,
never by name.** The performed doc does not currently *record* which source an
entry belongs to — it relies on position — so once positions shift (insert /
delete) the anchor is lost.

### A5 — Can the current contract store multiple performed movements for one source?

**Structurally YES; semantically NO.**
- The DB trigger `validate_wod_log_performed_prescription()` imposes **no array
  length constraint**, **no position/1:1 check against the programmed doc**, and
  **does not reject unknown keys**. Extra `movements[]` entries with fresh
  `instanceId`s pass validation. A nullable additive per-movement field (e.g.
  `sourceInstanceId`) would also pass untouched.
- `validatePerformedPrescription` (JS mirror) likewise has no length/position
  check.
- **But** there is nothing tying an added entry to its programmed source, so
  provenance (§23), repeated-movement isolation (§24), rep inheritance (§11) and
  delete-last semantics (§10) are undefined.

### A6 — Can `prescription_snapshot` provide stable source anchors?

**Yes when present** — `prescription_snapshot.movements[]` freezes
`instanceId` + `name` + `canonicalMovementId` + `displayLine` + resolved metric
specs for the selected variant (P9.1). **But** P9.5.7 forensics: **0 / 128
non-RX logs currently carry a `prescription_snapshot`** (only structured-variant
primary metcon INSERTs write it). At *edit* time the anchor always exists
(`logCtx.prescriptionDoc`); at *historical read* time it exists only for
snapshotted logs.

### A7 — What does `resolveResultMovementLines` expect?

`src/resultWorkoutLines.js`, 5-tier frozen precedence (P9.5.7):
1. `performed_prescription` → `composePerformedResultLines(doc, frozenGender)` →
   `composeStructuredWorkoutDisplay({ instances: doc.movements, mode:'member' })`
   — renders **whatever instance list it is given, in order.** A longer list
   just renders more lines. **No 1:1 assumption.**
2. `prescription_snapshot` displayLines · 3. notes movement lines ·
   4. `movements_snapshot` names · 5. `[]`.

### A8 — What does Journal expect?

Journal result card (`App.jsx` ~6181) renders
`cardMovementLines = resolveResultMovementLines(w)` — same shared projection.
Classification (`isNotRxd` / `resolveResultProvenance`) reads the **programmed**
side (frozen snapshots), never the performed list. A longer performed list is
display-only there.

### A9 — What does Leaderboard expect?

Expanded row (`App.jsx` ~2363) renders
`cardMovementLines = resolveResultMovementLines(log)`. Ranking / dedup /
latest-log selection / score are computed upstream from
`weight_logged` / result text / `completion_state` — **not** from
`performed_prescription`. INC-09 selection + `resolveResultProvenance`
classification are untouched by a longer performed list **except** for score
families whose score derives from movement structure (see §18 / D4 below).

### A10 — What happens when `performed_prescription.movements` becomes empty / a source loses its last movement?

Undefined / incoherent today:
- `composePerformedResultLines` returns `null` for an empty array → result card
  **falls back to the programmed rendering** (tier 2–4) → shows the movement as
  if performed as programmed. Wrong for "not performed".
- `performedMatchesProgrammed([], programmed)` → `false` → classified
  **Modified**, but with no visible reason.
- There is **no "not performed" semantic state** anywhere in the contract.

### A11 — Can delete-last be represented without semantic ambiguity?

**No.** It requires a new semantic state ("this programmed movement was not
performed") that affects result meaning, classification, and historical truth.
`0 reps` is **not** currently canonical for "not performed". → **owner decision**
(§10, stop condition #3).

### A12 — Does `NULL = as-programmed` survive the extension?

**Yes.** `performedMatchesProgrammed` already normalizes an overlay that
resolves equal to programmed back to `NULL` on Done
(`setPerformedCommitted(matches ? null : draft)`). Extended to composition:
add-then-delete-added (T7) that restores the original list must still normalize
to `NULL` — this needs the matcher to become **source-anchored** rather than
positional (resolver change, not schema).

### A13 — Can all of this be done with 0 DB schema changes?

**The `1 → N` array itself: YES** — the column and trigger already permit extra
`movements[]` entries and tolerate an additive nullable field. **Provenance,
ordering, repeated-movement isolation, and normalization require a small
backward-compatible *client-contract* extension** (a per-movement
`sourceInstanceId` anchor + `PERFORMED_PRESCRIPTION_VERSION` bump to 2 +
matcher/normalizer rework). **No migration is required**; the existing trigger
stays valid for v2 docs. `1 → 0` ("not performed") requires an owner semantic
decision before any representation is chosen.

---

## 2. Stop-condition determination (spec §65)

| # | Condition | Verdict |
|---|-----------|---------|
| 1 | Current JSON cannot represent `1 → N` without a *fundamental* new contract | **PARTIAL** — array holds N today; provenance needs a small **additive** field (`sourceInstanceId`) + version bump. Not fundamental, but a contract change → owner should ratify. |
| 2 | Stable source identity for repeated movements does not exist / needs new persistence identity | **NO new identity** — `instanceId` exists and is frozen. But the performed doc must start **recording** the anchor (new field). |
| 3 | Delete-last requires choosing between materially different result semantics | **YES** — "empty composition = not performed" vs "explicit Not-performed state" vs "disallow". Affects result meaning, classification, historical truth. |
| 4 | Reps for added movements need an owner decision (cannot be derived from current contracts) | **YES** — deterministic for For Time / AMRAP-Repeated-Rounds / EMOM / Intervals / Strength (inherit the source instance's resolved reps); **NOT** deterministic for **Sequential AMRAP**, whose Total-Reps leaderboard derives from the ordered station structure (INC-11) and collides with §18 "score stays independent". |
| 5 | Would require rewriting historical logs | **NO.** |
| 6 | Would change canonical workout definitions | **NO** (member drafts only; `wods` / `movement_prescriptions` / Engine V2 untouched). |
| 7 | Would change score semantics | **ONLY** for Sequential AMRAP (see #4). All other families: score stays independent. Owner must confirm the carve-out. |
| 8 | Would require `N → 1` to make `1 → N` work | **NO.** `N → 1` stays deferred (spec §2). |

**Conditions 3, 4, and 7 are met → HARD STOP before implementation.**

---

## 3. Owner decisions required

### D1 — Contract-extension shape for provenance

- **Option A (recommended).** Add a nullable per-movement field
  `sourceInstanceId` (string, → the programmed instance's frozen `instanceId`),
  bump `PERFORMED_PRESCRIPTION_VERSION` → 2, keep `movements[]` a **flat ordered
  list** (spec §29). v1 docs stay valid (missing field ⇒ positional fallback,
  read-only). No migration. Matcher + normalizer become source-anchored.
  Smallest backward-compatible change; every existing reader
  (`composePerformedResultLines`, `resolveResultMovementLines`, Journal,
  Leaderboard, share) keeps working unchanged.
- **Option B.** Restructure `movements[]` into
  `[{ source:{instanceId,name,…}, performed:[instance,…] }]` groups. Cleaner
  provenance model, but breaks P9.5.5 / P9.5.7 / share readers and the DB
  trigger's flat-array assumptions — larger blast radius, still no migration but
  much more code.

### D2 — Delete-last / "not performed" semantics (§10)

- **Option A.** Allow an empty performed group for a source ⇒ render an explicit
  *"Not performed"* line; classify Modified. New render tier + classification
  branch + historical-truth handling.
- **Option B (recommended).** Require ≥1 performed movement; the way to express
  "not performed" is an explicit **"Mark not performed"** action that sets
  `notPerformed: true` on the group (never faked as `0 reps`). One well-defined
  state, easy to render and classify.
- **Option C.** Disallow deleting the final performed movement of a source
  (Delete disabled when it is the only one). No "not performed" concept this
  phase. Smallest scope; defers the real need.

### D3 — Rep inheritance for added movements (§11)

- **Option A (recommended).** Added movement **inherits the source instance's
  resolved `reps` spec** for round-structured families where the rep target is
  unambiguous: For Time / RFT / Chipper / Ladder, AMRAP Repeated Rounds, EMOM
  (per-station), Intervals (per-station), Strength (sets × reps). For
  **Sequential AMRAP** the added movement's reps are **left explicit / blank**
  (member enters, or it is display-only) — see D4.
- **Option B.** Never inherit — always require an explicit performed rep value
  for every added movement, all families.
- **Option C.** Always copy the source `reps` verbatim, all families (rejected —
  wrong for Sequential AMRAP and mixed-unit).

### D4 — Sequential AMRAP score interaction (§18 vs INC-11)

Sequential AMRAP "Total Reps" leaderboard derives from the ordered station
structure (`src/sequentialAmrap.js`). Splitting one station into two performed
movements must not silently change the score.

- **Option A (recommended).** Performed composition is **display-only** for
  Sequential AMRAP; the score stays anchored to the **programmed** station
  structure and the member's entered Total Reps is untouched (§18 preserved).
- **Option B.** Exclude Sequential AMRAP from Add-movement entirely this phase
  (documented unsupported, per spec §45 "document unsupported cases rather than
  faking support").

### D5 — `N → 1` (§2)

Confirm **deferred** — not implemented unless independently owner-approved.

---

## 4. If the owner approves (proposed implementation outline — NOT started)

Contingent on D1=A, D2=B or C, D3=A, D4=A, D5=deferred:

- **Contract (`prescriptionContract.js` ⇄ `.ts`, byte-parallel):**
  `PERFORMED_PRESCRIPTION_VERSION = 2`; per-movement optional `sourceInstanceId`;
  `addPerformedMovement(doc, sourceInstanceId, targetRow, capability)` (appends a
  fresh-`instanceId` instance directly after the last entry sharing that
  `sourceInstanceId`, inherits source `reps` per D3, seeds only
  capability-allowed metrics); `deletePerformedMovement(doc, instanceId)`;
  source-anchored `performedMatchesProgrammed` / normalization (restore ⇒ NULL);
  `notPerformed` group flag if D2=B.
- **DB:** none. The existing trigger already accepts v2 docs. (Optional
  hardening: extend the trigger to validate `sourceInstanceId` type — additive,
  fail-closed — decided at implementation.)
- **UI (`PerformedEditPanel` / `PerformedEditRow`, `logWodPrimaryPath` only):**
  per row — *Change movement* + *Delete movement* in the action area, editable
  prescription fields, then a single **`+ Add movement`** below the fields that
  appends a sibling under the same source. Reuse the existing Change-movement
  catalog search (`memberMovementIndex`) in `append` mode. Flat list per source
  (spec §29), no nested `+ Add` per child. Mobile-first vertical hierarchy;
  existing Forge typography / spacing / borders; no redesign; REST never
  selectable.
- **Readers:** `resolveResultMovementLines` / `composePerformedResultLines`
  already render an arbitrary ordered instance list — no change beyond honoring
  `notPerformed`. Journal / Leaderboard detail / share inherit it.
- **Tests:** T1–T27 (basics / position / duplicates / characteristics /
  variants / formats / historical / score / delete / cancel / done+save /
  edit-again) + full P9.5.x / P10 / INC-04/06/07/08/09/11 regression +
  gender / capability / variant-availability / hook-order / eslint / build.
- **Production smoke:** `A → A+B` then `A → B+C` (add B, add C, delete A) with
  DB / snapshot-unchanged / Journal / Leaderboard / reopen verification.

---

## 5. Limitations / deferred

- `N → 1` composition — deferred (spec §2 / §65-#8).
- Performed **rep** editing for existing movements — still locked (P9.5.2 scope;
  capped-leaderboard rep-structure policy remains deferred).
- Logs without a `prescription_snapshot` (all current non-RX) have no frozen
  per-instance source anchor for *historical re-projection*; the added
  provenance only applies to logs saved **after** this ships. No backfill.
- Interval / station param corrections in AI learning (P11.2 D3) — unrelated,
  unchanged.

---

## 6. Verdict

**P9.5.2A — AUDIT COMPLETE / OWNER DECISION REQUIRED.**
`1 → N` is representable with **zero DB migration** and a **small additive
client-contract extension**, but three owner decisions gate implementation:
delete-last semantics (D2), rep inheritance (D3), and the Sequential AMRAP score
carve-out (D4). No code, contract, schema, or doc-beyond-this-audit has been
changed. HARD STOP pending owner review.
