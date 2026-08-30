# Per-Movement Prescription Engine — P9.1 Closure Report

Date: 2026-08-30
Status: **P9.1 code + tests complete. STOP — owner manual browser acceptance
required before P10.** Companion to `..._P9_REPORT.md`.

---

## A. STATUS

**PASS at the code + automated-test level. BLOCKED on owner manual browser
acceptance** (§G checklist). No logged-in session this mission.

---

## B. IMMUTABILITY FIX (Issue 1 — CRITICAL)

### Implementation

- New `snapshotPrescriptionDoc(doc)` (shared contract, both repos): returns a
  **deep, structurally-independent value clone** —
  `structuredClone(doc)` where available (browsers, Node ≥17, the vitest env),
  `JSON.parse(JSON.stringify(doc))` universal fallback. The contract holds
  **only** plain objects / arrays / finite numbers / strings / `null` (verified
  against §C.5 — no `Date`, `Map`, `Set`, functions, `undefined`, `NaN`,
  `Infinity`), so a deep clone is lossless.
- `freezeLoggingContext(displayedWorkout, wodZiData, wodZiWorkoutV2, businessDate,
  snapshotDoc)` — a **5th parameter**. `logCtx.prescriptionDoc = snapshotDoc ??
  null`. A plain reference is **not accepted** — `captureLogCtx()` calls
  `snapshotPrescriptionDoc(wodZiData?.movement_prescriptions ?? null)`.
- `saveWodLog` builds the snapshot from **`logCtx.prescriptionDoc` only** — the
  live `wodZiData` fallback was **removed** (fail closed: no `logCtx` ⇒ no
  snapshot, never snapshot from mutable current state).

### Proof

After `freezeLoggingContext` returns, `logCtx.prescriptionDoc` is a fresh object
graph. Mutating the source — top-level replace, nested `load.female = 999`,
`calories.female = 999`, `movements.push/splice/reverse` — leaves
`logCtx.prescriptionDoc` byte-for-byte unchanged (direct regression tests,
`utils.test.js` "P9.1: deep-clone freeze / nested mutation / array mutation").
`buildPrescriptionSnapshot` is a pure read over its input — a `JSON.stringify`
before/after equality test confirms it does not mutate the frozen doc.

---

## C. SAVE-PATH COVERAGE (Issue 2 — CRITICAL)

| Save path | Structured workout reachable? | Snapshot required? | Snapshot written? | Reason |
|---|---|---|---|---|
| `saveWodLog` — primary metcon variant `wod_logs` INSERT (`variantaAleasa !== null`, not `logTargetSectionId`, not `editLogId`) | **YES** | **YES** (when `variantHasStructuredPrescription(frozenDoc, frozenVariantKey)`) | **YES** — from `logCtx.prescriptionDoc` + frozen variant + `members.gender` | this IS the structured prescription being scored |
| `saveWodLog` — additional scored **section** `wod_logs` INSERT (`logTargetSectionId`) | **NO** | no | no | `logAdditionalScoredSectionsV` = `supportingSectionsV.filter(loggingMode==='required')` — a **non-primary** section only; never the metcon variant. The engine is metcon-only (arch doc §C.9.1); a supporting section has no `movement_prescriptions`. |
| `saveWodLog` — Journal edit `wod_logs` UPDATE (`editLogId`) | n/a (edits an existing row) | preserve | **not touched** — the `.update({...})` omits `prescription_snapshot` | correcting a score's value never rewrites the prescription the athlete performed against |
| `saveWodLog` — free official-variant log with no structured prescription | YES (reachable) | no | no (`variantHasStructuredPrescription` false) | P10 keeps the legacy fallback for a `null`-snapshot log |
| `saveFreeTextLog` — `wod_logs`, `wod_id: null`, no variant | no | no | no | free text, not a prescribed workout |
| `saveSkillLog` — `skill_logs` | no | no | no | skills carry a format/target (`skill_type`, `skill_format_config`), not a `movement_prescriptions` document. Populating the column would be an invented prescription. |

**Section-scoped snapshot:** the snapshot is already **variant-scoped** — it
takes `variantKey` and serialises only that variant's movements, not the whole
workout. For the primary section that variant *is* the thing being scored.

---

## D. LOGGER SINGLE-WEIGHT AUDIT (Issue 3 — HIGH)

`prescribedWeightPentruLog` and `activeRxStandardKg` were the only single-weight
concepts in the logger. Every use, and what P9.1 did:

| Use | Reader | Pre-P9.1 (structured multi-load) | P9.1 |
|---|---|---|---|
| **Weight-logging field visibility** | `FormatLogger` `prescribedWeight ? <WeightField/> : null` — a pure GATE, **never rendered as text** | shown iff the legacy global column was non-empty | shown iff **`structuredVariantHasLoad(frozen doc, variant, gender)`** — `prescribedWeightPentruLog` is set to the sentinel string `'structured'` (a gate, not a value) or `''` |
| **Live RX badge** | `liveRxStatus = classifyRxStatus({ standardKg: activeRxStandardKg })` → `RxBadge` | `resolveSectionStandardKg` fell back to the legacy first-load `'45'` ⇒ could show a **FALSE RX** (athlete ≥ 45 but the workout also has 9 kg / 22.5 kg movements) | `activeRxStandardKg = structuredVariantLoadStandard(frozen doc, variant, gender)` → `null` (bodyweight) \| `'multi'` (>1 distinct load) \| `number` (one load). `classifyRxStatus` returns `null` for `null`/`'multi'` ⇒ **no badge**. Single-load ⇒ badge works. |
| **Rx standard input to `resolveSectionStandardKg`** | via `legacyWeightText: prescribedWeightPentruLog` | first-load global | **not called for a structured variant** — `activeRxStandardKg` is the structured value directly |
| **`weight_logged` pre-fill on variant select (Home)** | `setWodWeightLogged(wodZiData?.[weightKeyForVariant(...)] || '')` | first-load global | **unchanged** — a convenience pre-fill the athlete overwrites; not authority, not displayed as "Prescribed" |
| **Share-popup Not-Rx flag** | `isNotRxd(logFields, prescribedWeight, …)` after save | first-load global | `prescribedWeight` = the **structured standard** (a number for single-load, `''` for multi-load/bodyweight ⇒ `isNotRxd` does not force a weight-based Not-Rx) |
| **`prescription_snapshot`** | `buildPrescriptionSnapshot` | n/a | full per-movement structure — the authority |

**Nothing displays "Prescribed Weight: 45 kg" as a whole-workout value.** For a
structured multi-load workout there is **no single prescribed weight anywhere**;
the per-movement `@` values in each resolved line are the prescription. **No
false RX classification** — `'multi'`/`null` ⇒ no badge. No new aggregate-weight
concept was created.

---

## E. SNAPSHOT CONTRACT (not load-centric)

Per resolved movement in `wod_logs.prescription_snapshot.movements[]`:

```jsonc
// Snatch (sex_specific load), female member
{ "instanceId": "a", "name": "Snatch", "canonicalMovementId": "sn",
  "displayLine": "20 Snatch @ 30 kg",
  "reps": { "value": 20 },
  "load": { "value": 30, "unit": "kg", "mode": "sex_specific", "bothValues": [45, 30] } }

// Row (sex_specific calories), female member  — 15/12 Cal Row
{ "instanceId": "c", "name": "Row",
  "displayLine": "12 Cal Row",
  "calories": { "value": 12, "mode": "sex_specific", "bothValues": [15, 12] } }

// Run (universal distance)  — 500 m Run
{ "instanceId": "d", "name": "Run",
  "displayLine": "500 m Run",
  "distance": { "value": 500, "unit": "m", "mode": "universal", "bothValues": null } }
```

- **`load` / `distance` / `calories`** all carry `mode` + `value` +
  `bothValues` (tested).
- **"What the coach programmed":** `bothValues` + `mode`. **"What applied to this
  athlete":** `value` (resolved to `gender`).
- **Universal ≠ sex-specific:** a universal `distance` is `{mode:"universal",
  value:500, bothValues:null}` — never `{male:500, female:null}` (tested).
- **`displayLine` is projection only** — every semantic fact is a structured
  field; no future reader needs to parse it.

---

## F. TESTS

| Repo | Before P9.1 | After |
|---|---|---|
| WOD-SIMPLE | 1024 | **1032** (+8; 9 pre-existing Deno-only failures unchanged) |
| forge-admin-web | 1166 | **1168** (+2 parity) |

New:
- `utils.test.js` — deep-clone freeze (top-level mutation); nested
  load/calorie mutation; array push/splice/reverse; `snapshotPrescriptionDoc(null)`.
- `prescriptionContract.test.js` "P9.1" — `snapshotPrescriptionDoc` structural
  independence; `structuredVariantLoadStandard` null / `'multi'` / number /
  repeated-same-load / unknown-gender-null; `structuredVariantHasLoad`;
  `buildPrescriptionSnapshot` does not mutate its input; **retry idempotency**
  (same frozen inputs → deep-equal snapshot); snapshot not load-centric
  (distance + calories with mode/value/bothValues).
- `prescriptionContract.parity.test.ts` (admin) — deep-clone independence +
  `structuredVariantLoadStandard`/`HasLoad` parity.

P9.1 matrix (owner's list 1–15): 1 (deep-clone) ✓, 2 (nested) ✓, 3 (array) ✓,
4 (builder purity) ✓, 5 (section-scored) — §C table + reachability argument
(a supporting section can't be a metcon variant) ✓, 6 (all structured paths) —
§C table ✓, 7 (free-text null) ✓, 8 (multi-load no misleading authority) —
`activeRxStandardKg` = `'multi'` ✓, 9 (single-load convenience) ✓, 10 (Rx badge
no false classify) — `classifyRxStatus('multi'|null) → null` ✓, 11 (Row calories
snapshot) ✓, 12 (Row distance universal) ✓, 13 (repeated movement × 3) ✓ (P9
test retained), 14 (retry) ✓, 15 (P1→P2 after real deep snapshot) ✓.

Build (`vite build` / `vite build`), `tsc -b`, ESLint: **PASS, 0 errors** both
repos.

---

## G. MANUAL OWNER ACCEPTANCE CHECKLIST

On the live PWA after refresh to `app_version prescription-engine-p9-1-20260830`,
using a controlled structured test workout:

```
3 RFT
20 Snatches      RX  45 / 30 kg
20 Wall Balls    RX   9 / 6  kg
20 DB Snatches   RX  22.5 / 15 kg
15/12 Cal Row
```

| # | Step | Expected |
|---|---|---|
| **A** | **Female member** — open the workout on Home | `20 Snatch @ 30 kg` · `20 Wall Ball @ 6 kg` · `20 DB Snatch @ 15 kg` · `12 Cal Row`. **No** whole-workout "Prescribed Weight" field/badge. **No** duplicate variant weight badge. |
| | Tap "Log Score" → open the logger | Same four lines. Weight-logging field present (workout has loads). **No RX/scaled badge** yet (multi-load). |
| | Enter a result + weight, Save → inspect `wod_logs` newest row | `prescription_snapshot.variant = "rx"`, `.gender = "female"`; `movements[0].load = { value: 30, mode: "sex_specific", bothValues: [45,30] }`; `movements` for Wall Ball `.load.value = 6`, DB Snatch `15`; Row `.calories = { value: 12, mode:"sex_specific", bothValues:[15,12] }`. |
| **B** | **Male member** | `@ 45` / `@ 9` / `@ 22.5 kg` · `15 Cal Row`. Snapshot `.load.value` = 45/9/22.5, `.gender = "male"`. |
| **C** | **Unknown gender** (no `members.gender`) | `@ 45/30` · `@ 9/6` · `@ 22.5/15 kg` · `15/12 Cal Row` — **never male-only**. |
| **D** | **Edit race** — female opens (sees 30 kg) → taps Log Score → (coach edits the workout to Snatch 50/35) → return to the still-open logger | Logger still shows `@ 30 kg`. Save → snapshot `movements[0].load.value = 30`, `.bothValues = [45,30]` (**P1, not 35**). |
| **E** | **Historical D+N** — open an old date's structured workout → log today | `wod_id` = that workout's `legacy_wod_id`; `logged_at` = D-based; snapshot = that workout's prescription. |
| **F** | **Repeated movement** — a workout with `Power Clean 60/40`, `Power Clean 70/47.5`, `Power Clean 80/55` | Female sees `40` / `47.5` / `55`. Snapshot has **3** movements with distinct `instanceId`s and `load.value` 40 / 47.5 / 55. |
| **G** | **Row variants** — one workout `500 m Row` (universal), another `15/12 Cal Row` | 500 m: everyone sees `500 m Row`; snapshot `distance.mode = "universal"`. Cal: female `12 Cal Row`; snapshot `calories.mode = "sex_specific"`, `bothValues = [15,12]`. |
| **H** | **Section-scored workout** (a structured metcon + an independently-scored supporting section) — log the **supporting section** | Its `wod_logs` row has `prescription_snapshot = null` (supporting sections have no structured prescription — expected). The **metcon variant** log has a snapshot. |
| **I** | **Single-load structured** — e.g. `21-15-9 Thrusters @ 43/30` only | RX/scaled badge **works** (single standard). Snapshot `load.value` = 43 (male) / 30 (female). |
| **J** | **Legacy-only workout** (never edited with the new builder) | Renders exactly as before P9. Its logs have `prescription_snapshot = null`. |

---

## H. PRODUCTION DATA

**Zero rows created / modified / deleted.** Verified live before and after
deploy: `structured_wods = 0`, `wod_logs` with snapshot `= 0`.
`app_version.current` → `prescription-engine-p9-1-20260830` (refresh signal, not
a data write).

---

## I. COMMITS

| Repo | Message |
|---|---|
| WOD-SIMPLE | `fix(prescription): P9.1 - deep value snapshot + structured RX standard + no misleading single-weight` |
| forge-admin-web | `fix(prescription): P9.1 - snapshotPrescriptionDoc + structuredVariantLoadStandard/HasLoad (shared contract)` |

---

## J. OPEN ISSUES (genuine P9 remaining)

1. **Owner manual browser acceptance is the gate** (§G). Everything below the
   line is automated + code-path evidence; the live save + edit-race verification
   is the owner's.
2. **`weight_logged` pre-fill on Home variant-select** still reads the legacy
   first-load global column (a convenience the athlete overwrites; never
   displayed as "Prescribed", never authority). For a multi-load workout it
   pre-fills the first movement's load. Harmless, disclosed; a per-movement
   weight-logging UI is future work well beyond P9.
3. **Cross-gym automated assertion** and the mission's full P9 matrix items
   27/28 remain **P11/P12** (owner-gated). §J of `..._P9_REPORT.md` is the
   code-path argument; `skill_logs` demonstrably carries no snapshot key.

No P9 defect is deferred as "P10 work."

---

## K. ACCEPTANCE BLOCKER — LIVE CAPABILITY LOOKUP BROKEN (fixed)

Date: 2026-08-30. Owner manual acceptance failed on the first step:

> "In the live builder I cannot enter per-movement load at all. For Dumbbell
> Snatch, Power Clean and Wallballs the UI only exposes REPS / Different M/F /
> Scheme. There is no LOAD Male/Female control."

### End-to-end diagnosis (capability lookup / seed / UI binding)

| Layer | Verified | Result |
|---|---|---|
| DB seed | live `select allowed_prescription_metrics, default_prescription_metric, pg_typeof(...)` for `Power Clean` / `Dumbbell Snatch` / `Wall Ball` | **correct** — `{reps,load}` / `load`, type `text[]`, all platform (`gym_id IS NULL`), no gym-local shadow rows |
| RLS | `movements_select` policy | **correct** — `((gym_id IS NULL) OR (gym_id = my_gym_id()))`, role `authenticated` |
| PostgREST schema cache | anon REST `?select=...,allowed_prescription_metrics,...` | **correct** — returns `[]` (RLS-filtered), **not** a `400` → columns are in the cache |
| Prod bundle (client) | grep deployed JS | **correct** — `MOVEMENT_COLUMNS` includes the capability columns; `resolveMovementCapability` minified logic intact (`Array.isArray(row.allowed_prescription_metrics)`) |
| **App.jsx prop wiring** | `<SectionCard …>` at the metcon render site | **BROKEN** — `movementCatalog` **was never passed** |

**Root cause.** `App()` builds `movementCatalog` (a `useMemo` exposing
`capabilityFor` / `lookupForParse` / `suggestions` / `createMovement`), but the
`<SectionCard>` element for the workout sections did not forward it. The prop is
threaded `SectionCard → PrimarySectionBody → VariantEditorBody →
MovementRowListPWA` — every hop forwards a value that started out `undefined`.
`MovementRowListPWA`'s guard then returned the fallback
`{ allowed: [], default: null, unknown: true }` for **every** movement, so:

- no Load M/F control ever rendered (an "unknown" movement shows only "+ Add
  prescription"),
- a Quick-Paste-seeded `reps` instance rendered the bare reps editor — value +
  the (now-removed) "Different M/F" + "Scheme" — with no "+ Load" affordance.

This was a **pre-existing latent gap**: the old `MiscareQuickAdd` autocomplete
degraded silently to a static movement list when it got no catalog, so nothing
looked broken until P5′ made the capability lookup load-bearing.

### Fixes (commit `4cb2c07` WOD-SIMPLE, `13bab28` forge-admin-web)

1. **Pass the catalog.** `<SectionCard movementCatalog={movementCatalog} …>` —
   one line. This alone restores Load M/F for every capable movement.
2. **`seed()` stale-closure.** `MovementRowPWA.seed(next, metric, capForSeed)`
   now takes the target capability explicitly instead of closing over the
   render-scope `cap` (which is keyed on the *old* `instance.name` mid-rename).
   Renaming a bare row to a load-default movement now seeds **both** `load` and
   `reps`.
3. **Canonical identity on rename.** `changeName` sets
   `canonicalMovementId = catalogRowFor(name)?.id ?? null` (was hard-coded
   `null`), so the frozen log snapshot carries canonical movement identity.
4. **reps has no "Different M/F".** Per the owner ruling that **reps = workout
   structure, not a prescription characteristic**, the M/F toggle is removed
   from the reps editor in both repos (`PmpeMetricEditor` in App.jsx,
   `MetricEditor` in admin `MovementRow.tsx`). reps keeps its single value input
   + "Scheme" (21-15-9 free text); a legacy/paste `sex_specific` reps spec can
   be collapsed with "Single value". `load` / `distance` / `calories` keep the
   full "Different M/F" ↔ "Same for all" pair.

### Verification

- Deployed bundle on `forge-delta-ivory.vercel.app` (`index-U2wwuT2N.js`)
  embeds `VERCEL_GIT_COMMIT_SHA = 4cb2c07…` — **the fix is live in production.**
- `app_version.current` bumped to
  `prescription-engine-p9-1-catalogfix-20260830`.
- Tests: forge-admin-web **1171** (+4 new `MovementRow.test.tsx` — reps has no
  M/F toggle; paste-seeded reps-only row shows "+ Load"; rename seeds load+reps),
  WOD-SIMPLE **1032** (+9 pre-existing unrelated Deno file-load failures).
  `vite build` + `tsc -b` + ESLint clean both repos. No migration, zero
  production data touched.

### Re-confirmed owner manual acceptance checklist

Open the **WOD-SIMPLE PWA builder** (hard-refresh / dismiss the update toast so
you are on `…catalogfix-20260830`), create/edit a WOD, add a metcon section:

1. Add movement **"Power Clean"** → a **Load — Men / Women (kg)** pair appears
   automatically (sex-specific by default). Enter `60` / `42`.
2. Click **"Same for all"** on Load → collapses to one **Load (kg)** field
   keeping `60`; **"Different M/F"** restores `60 / 42`.
3. The **Reps** field shows only a value input + **"Scheme"** — **no**
   "Different M/F" on reps.
4. Add **"Dumbbell Snatch"** and **"Wallballs"** → same Load M/F control on each.
5. Add a bodyweight movement (e.g. **"Burpees"**) → **no** Load control, reps
   only.
6. Quick-Paste a block that contains `Power Clean 60/42kg` → the review chip
   resolves to a movement with Load M/F populated (`60 / 42`), not a reps-only row.
7. Generate Variants → Intermediate / Beginner inherit the structured Load and
   remain independently editable.
8. Save. Open the same WOD in the **member PWA** as a male and as a female
   profile → each sees their own load; a profile with no gender sees `60/42 kg`
   (no male fallback).

If every step passes, P9/P9.1 manual acceptance is clear and P10 may begin.

---

## HARD STOP

**P10 NOT STARTED.** `isNotRxd` / Journal / leaderboard historical
classification / performance readers are **unchanged** — they still resolve
prescribed weight live from `wods` for every log. Switching them snapshot-first
(with legacy fallback for `null`-snapshot logs, and the guarantee that editing
today's workout never reclassifies a snapshotted historical result) is **P10**,
which begins only after **(1)** this P9.1 review passes **and** **(2)** owner
manual browser acceptance passes.
