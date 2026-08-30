# Per-Movement Prescription Engine — P9.4 One Shared Structured-Workout Presentation

Date: 2026-08-30
Status: **Shipped. Pre-P10. Coach Preview, Member workout display and the logger
now share ONE structured-prescription projection. HARD STOP — P10 not started.**

---

## A. OBJECTIVE

Stop maintaining "Coach formatter A / Member formatter B". One projection owns
the structured workout's line composition; the only difference between surfaces
is the **prescription resolution context** (coach = gender-neutral, member =
resolved to the athlete). The prescription snapshot already resolved through the
same engine — now the display surfaces provably do too.

---

## B. BEFORE

| Surface | Line source | Problem |
|---|---|---|
| **Coach Preview** | `composeSection(section,'rx')` → read `section.variants.rx.movements` (legacy **text** array) | The editor only writes `instances`, never `movements`, so the preview showed stale / plain lines with **no loads** for a workout being built structurally |
| **Member workout screen** | `resolveVariantDisplayLines(doc, vk, gender)` (correct) — **then re-piped** through `resolveMovementDisplayText` + `cleanMovementDisplayText` (rxEngine legacy text munging) | duplicated semantic logic on top of an already-resolved, already-clean line |
| **Logger** | `resolveVariantDisplayLines(doc, frozenVariantKey, gender)` | already correct, rendered verbatim |
| **Prescription snapshot** | `resolveVariantForMember` → `renderInstanceLine` | already correct |

Three of the four already went through `renderInstanceLine`; the Coach Preview
was the outlier (legacy text), and the Member screen added a redundant
post-process.

---

## C. AFTER — the one projection

### `prescriptionContract` (shared, byte-for-byte both repos)

```js
composeStructuredWorkoutDisplay({ doc, variantKey, instances, mode, gender }) -> { lines, movements } | null
```

- `mode: 'coach'`             → gender-neutral: `"20 Power Snatch @ 45/30 kg"`
- `mode: 'member'` + `gender` → that athlete: `"@ 45 kg"` / `"@ 30 kg"`
- `mode: 'member'`, no gender → gender-neutral (identical to coach)
- Accepts **either** `{ doc, variantKey }` (member / logger — reads
  `wods.movement_prescriptions`) **or** `{ instances }` (the builder — holds the
  instance array directly).
- Returns `null` when there is no structured prescription → caller keeps its
  legacy text rendering.
- Owns: movement **order**, per-movement **reps**, **load / distance / calorie**
  formatting, **universal vs sex-specific** display, **repeated instances**,
  **decimals**, **units**. Internally: `resolveInstancesForDisplay` →
  `resolveMovementInstance` → `renderInstanceLine` (the existing engine;
  `resolveVariantForMember` now delegates to `resolveInstancesForDisplay` too, so
  there is exactly one code path).

### `workoutComposer.js` — `composeSection(section, variantKey, structuredLines = null)`

New optional 3rd arg. When present, those lines are the block movement source
(instead of the legacy `variants[k].movements` text). **TITLE / SCHEME / block
layout / buy-in-cash-out / transitions — all unchanged.** `hoistScheme` still
applies (a common leading rep count still hoists to a block scheme).
`null` → byte-identical legacy behaviour.

### Wiring (`App.jsx`)

| Surface | Now calls |
|---|---|
| **Coach Preview** (`ComposedWorkoutPreview`) | `composeStructuredWorkoutDisplay({ instances: section.variants.rx.instances, mode: 'coach' })` → feeds `composeSection(section,'rx', lines)` |
| **Member screen** (`metconVariantsForDisplay`) | `composeStructuredWorkoutDisplay({ doc, variantKey: vk, mode: 'member', gender: memberGenderKey })` |
| **Member movement line** (`memberMovementLine` helper) | a **structured** line is rendered **verbatim** — the rxEngine `resolveMovementDisplayText` / `cleanMovementDisplayText` munging runs **only** on the legacy free-text path now |
| **Logger** (`structuredLogLines`) | `composeStructuredWorkoutDisplay({ doc: activePrescriptionDoc, variantKey: frozenVariantKey, mode: 'member', gender: memberGenderKey })` |

`activePrescriptionDoc` is `logCtx.prescriptionDoc` (frozen at "Log Score" click)
during a frozen flow — unchanged. `resolveVariantDisplayLines` import dropped
from `App.jsx` (superseded).

---

## D. RESULT (structured "3 RFT: 20 Power Snatch 45/30, 200m Row, 20 DB Snatch 22.5/15, 20 Wallball 9/6")

| Context | Lines |
|---|---|
| **Coach Preview** | `20 Power Snatch @ 45/30 kg` · `200 m Run` · `20 DB Snatch @ 22.5/15 kg` · `20 Wallball @ 9/6 kg` |
| **Member male** | `@ 45 kg` · `200 m Run` · `@ 22.5 kg` · `@ 9 kg` |
| **Member female** | `@ 30 kg` · `200 m Run` · `@ 15 kg` · `@ 6 kg` |
| **Member unknown gender** | identical to Coach Preview (`45/30`, `22.5/15`, `9/6`) |
| **Logger (that athlete)** | identical to the Member screen |
| **`prescription_snapshot.movements[].displayLine`** | identical to the Member screen (asserted by test) |

No redundant global weight badge (P9 already dropped `weightMale/Female` for
structured; the load is inline in the line, once). No builder controls, cards,
metric selectors, or M/F toggles on the member screen — it was, and remains,
read-only.

---

## E. LEGACY

Untouched. A section whose RX variant has **no** structured instances →
`composeStructuredWorkoutDisplay` returns `null` → `composeSection` reads the
legacy text array (Coach Preview) and the member screen keeps the
`resolveMovementDisplayText` / `cleanMovementDisplayText` path
(`v.structured` is falsy). No historical conversion.

---

## F. RESPONSIVE

No layout change on any surface — same components, same styles. The Coach Preview
sits at the bottom of the variant editor (previous change, unaffected). Line
composition changed, not the container.

---

## G. FILES

| Repo | File | Change |
|---|---|---|
| shared | `prescriptionContract.js` / `.ts` | `resolveInstancesForDisplay`, `composeStructuredWorkoutDisplay` (+ `StructuredWorkoutDisplay` type); `resolveVariantForMember` delegates to `resolveInstancesForDisplay` |
| WOD-SIMPLE | `workoutComposer.js` | `composeSection` 3rd arg `structuredLines` |
| WOD-SIMPLE | `App.jsx` | `ComposedWorkoutPreview` uses the projection; `metconVariantsForDisplay` uses the projection; new `memberMovementLine` helper (verbatim for structured); `structuredLogLines` uses the projection; dropped `resolveVariantDisplayLines` import |
| WOD-SIMPLE | `prescriptionContract.test.js` | +8 `composeStructuredWorkoutDisplay` tests |
| WOD-SIMPLE | `workoutComposer.test.js` | +5 `composeSection(…, structuredLines)` tests |
| forge-admin-web | `prescriptionContract.parity.test.ts` | +4 P9.4 parity tests |

forge-admin-web has no Coach Preview / member display / logger — it gets
`composeStructuredWorkoutDisplay` in the contract (byte-for-byte, parity-tested)
but no component wiring.

---

## H. BEHAVIOR / INVARIANT

- **Member display semantics = logger display semantics = snapshot semantics** —
  all three now call `composeStructuredWorkoutDisplay` (or, for the snapshot,
  `resolveVariantForMember`) which share `resolveInstancesForDisplay`. Test
  `member display == logger display == snapshot line` asserts this on the same
  fixture.
- Snapshot is still built from the **frozen** `logCtx.prescriptionDoc`, not
  re-read from `wods` — unchanged.
- No male fallback (`gender: null` → both values), decimals not rounded,
  `lb` shown not converted, repeated instances distinct — all covered by tests.

---

## I. TESTS

| Repo | before | after |
|---|---|---|
| WOD-SIMPLE | 1171 | **1183** (+13: 8 projection, 5 composer) |
| forge-admin-web | 1272 | **1276** (+4 parity) |

- WOD-SIMPLE: 1183 pass, 9 pre-existing Deno `supabase/functions/*` failures
  (unrelated). `vite build` clean, `eslint` 0 errors.
- forge-admin-web: 1276 pass, `tsc -b` + `vite build` + `eslint` clean.
- `workoutComposer.test.js`, `ComposedWorkoutView.test.jsx`, `rxEngine.test.js`,
  `wodSections.test.js` — all green (regression).

---

## J. DATABASE

- **No migration.** No schema / trigger / RLS / data change.
- **Zero production data touched.** No historical conversion.

---

## K. SCOPE / HARD STOP

- **P10 NOT STARTED.** `isNotRxd` / Journal / leaderboard / performance readers —
  untouched. They still resolve prescribed weight live from `wods`. The
  P9.1 RX-classification helpers (`structuredVariantLoadStandard` /
  `structuredVariantHasLoad`) and the logger's `liveRxStatus` are unchanged.
- Only the **display line generation** for Coach Preview / Member workout /
  Logger was unified.

---

## L. COMMITS

| Repo | Commit |
|---|---|
| WOD-SIMPLE | `feat(prescription): P9.4 - one shared structured-workout presentation (coach preview + member + logger)` |
| forge-admin-web | `feat(prescription): P9.4 - composeStructuredWorkoutDisplay shared projection (parity)` |

`app_version.current` → `prescription-engine-p9-4-shared-display-20260830`.

---

## M. OWNER MANUAL SPOT-CHECK

1. Build a structured metcon: `3 RFT`, add Power Snatch `45/30`, Run `200 m`,
   DB Snatch `22.5/15`, Wallballs `9/6`.
2. **Coach Preview** (bottom of the editor): shows
   `3 ROUNDS FOR TIME` + `20 Power Snatch @ 45/30 kg` / `200 m Run` /
   `20 DB Snatch @ 22.5/15 kg` / `20 Wallball @ 9/6 kg`. Change a load
   `45/30` → `50/35` → the preview updates.
3. Save. Open the workout as a **male** member → `@ 50 kg` etc.; as **female**
   → `@ 35 kg`; a **no-gender** profile → `@ 50/35`.
4. Member screen is clean: format header, movement lines, note — no weight
   badge, no duplicate prescription, no builder chrome.
5. Tap **Log Score** → the logger movement list is exactly what the member saw.
6. Save a result → the stored `prescription_snapshot` lines match.
7. Open a **legacy** (non-structured) workout → Coach Preview + member render
   unchanged from before.
