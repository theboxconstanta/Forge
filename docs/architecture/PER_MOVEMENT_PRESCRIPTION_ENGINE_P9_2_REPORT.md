# Per-Movement Prescription Engine — P9.2 Decimal Numeric Input Closure

Date: 2026-08-30
Status: **Code + automated verification complete. Deployed. HARD STOP — owner
manual iPhone acceptance required before P10.** Companion to `..._P9_REPORT.md`
and `..._P9_1_REPORT.md`.

---

## A. STATUS

**PASS at the code + automated-test level. BLOCKED on owner manual browser
acceptance** (§R). The fix is purely input-layer; the canonical contract, the DB
trigger, and every downstream reader were already decimal-correct.

---

## B. ROOT CAUSE

**Where:** `MetricEditor` in `forge-admin-web/src/features/programming/MovementRow.tsx`
and `PmpeMetricEditor` in `WOD-SIMPLE/src/App.jsx` — the numeric `<input>` fields
for load / distance / calories / reps.

**Current lifecycle (before P9.2):**

| Property | Value |
|---|---|
| `type` | *(none)* → `type="text"` (so the browser never rejected a comma — good) |
| `inputMode` | `"decimal"` on every numeric field |
| `value` | the **canonical number** round-tripped through `String(n)` every render |
| `onChange` | `toNum(e.target.value)` / `pmpeToNum(...)` on **every keystroke**, result written straight to canonical spec |
| `onBlur` | none |
| normalization | `s.trim().replace(',', '.')` then **`parseFloat`** |
| validation | none — `parseFloat` is lenient |
| canonical state type | `number \| null` |
| save payload | `number \| null` (instances passed through verbatim) |

**Why comma-decimal entry failed on iPhone.** `inputMode="decimal"` on a
comma-locale keyboard exposes a `,` key, so the coach *can* type it. But:

1. **Eager parse.** Typing `2` → `2`, `2` → `22`, then `,` produces the string
   `"22,"`. `onChange` immediately runs `parseFloat("22.".)` → `22`, which is
   written back as the canonical value and re-rendered as `"22"` — **the comma
   is deleted mid-keystroke.** The next `5` yields `"225"` → `225`. Decimal entry
   is impossible without pause-and-retry tricks.
2. **Lenient `parseFloat`.** `"22.5.5"` → `22.5`, `"22abc"` → `22`,
   `"2.2.5"` → `2.2`. Malformed input is silently *partially* parsed.
3. **No draft state.** The canonical number *is* the input value, so there is no
   room for a legitimate intermediate editing string.
4. **First-comma-only.** `String.replace(',', '.')` replaces one comma; a
   fat-fingered `"22,,5"` became `parseFloat("22.,5")` → `22`.

Nothing was wrong with the storage tier — `wods.movement_prescriptions` numeric
fields accept any finite `number` (migration `20260829090000`, trigger check
`jsonb_typeof IN ('number','null')`), and every resolver / snapshot / mirror
already carries numbers. **The defect was 100% in how the input string became a
number.**

---

## C. NUMERIC INPUT ARCHITECTURE — before → after

| | Before | After (P9.2) |
|---|---|---|
| Editing representation | none — canonical number shown directly | a **draft string** in the field component, seeded from canonical on focus |
| Commit boundary | every keystroke | valid value: every keystroke · partial (`"22,"`): held, no commit · empty: commit `null` · invalid: **revert on blur** to last good (never `0`) |
| Parser | inline `parseFloat` after `replace(',', '.')` | shared **`parsePrescriptionNumber`** — strict grammar `^\d+(?:[.,]\d+)?$`, `Number()` after a deliberate single separator swap |
| Validation | none | strict syntax in the parser + field-level `integer` rule for reps / calories |
| Canonical state | `number \| null` | `number \| null` — **unchanged** |
| Not-focused display | `String(value)` | `String(value)` — so mode toggle / replace / reload always reflect |

The field component (`NumField` in admin, `PmpeNumField` in the PWA) owns only a
`focused` boolean and a `draft` string. **Every decision about what to commit
routes through the shared contract's `resolveNumericInput`** — identical rules in
both repos.

---

## D. SHARED NORMALIZATION

`src/prescriptionContract.js` ⇄ `src/features/programming/prescriptionContract.ts`
(byte-for-byte port, parity-tested):

```js
const PRESCRIPTION_NUMBER_RE = /^\d+(?:[.,]\d+)?$/

parsePrescriptionNumber(raw) -> { value, ok }
  45 / "45"          -> { value: 45,    ok: true }
  "22,5" / "22.5"    -> { value: 22.5,  ok: true }
  "0,5" / "0.5"      -> { value: 0.5,   ok: true }
  "22,25" / "22.25"  -> { value: 22.25, ok: true }
  "7,125"            -> { value: 7.125, ok: true }
  "" / null / "   "  -> { value: null,  ok: true }   // "no value", never 0
  "22," "22." ".5" "5."          -> { value: null, ok: false }
  "22,5,5" "22..5" "22,,5" "2.2.5" -> { value: null, ok: false }
  "22abc" "abc" "--5" "5-" ",," ".." -> { value: null, ok: false }
  "NaN" "Infinity" "1e3" "1 000" -> { value: null, ok: false }
  NaN / Infinity (number)        -> { value: null, ok: false }

resolveNumericInput(raw, { integer, previous, final }) -> { value, commit }
  // the draft->commit decision, shared by both builders

formatPrescriptionNumber(v) -> canonical dot string ("22.5", "" for null)
```

- **No sign** in the grammar → negative prescriptions are rejected at entry
  (mission: "Do NOT introduce negative prescription values").
- The paste parser's internal `num()` now delegates to
  `parsePrescriptionNumber` → **one** decimal-normalization path for builders +
  paste.
- Deliberate: the grammar requires digits on **both** sides of the separator.
  Partial editing states (`"22,"`, `"22."`) are the UI draft layer's job, never
  a committed value.

---

## E. FIELD POLICY

| Field | Decimals? | Comma in? | Dot in? | Canonical type | Validation |
|---|---|---|---|---|---|
| **reps** | **No** — whole count (workout structure) | n/a (rejected) | n/a (rejected) | `number \| null` (or `{mode:'text'}` scheme) | `integer` at input; a non-integer reverts. `inputMode="numeric"`. Blank never blocks publish (unchanged). |
| **load** | **Yes**, arbitrary precision | ✅ | ✅ | `number \| null` | strict syntax; `inputMode="decimal"`. Publish gate unchanged (both M/F present). |
| **distance** | **Yes**, arbitrary precision | ✅ | ✅ | `number \| null` | strict syntax; `inputMode="decimal"`. Units unchanged (m/km/ft/mi). |
| **calories** | **No** — whole count | n/a (rejected) | n/a (rejected) | `number \| null` | `integer` at input; `inputMode="numeric"`. |

Notes:
- **reps / calories `integer`** is enforced at the *input* only — no new
  publish-validator error, no new DB constraint. A value that is *already*
  fractional in stored data (legacy / earlier paste) is **preserved**, not
  rewritten; only a *new* edit that would introduce a non-integer is rejected.
- The DB trigger (`number \| null`) and the client structural validator are
  **untouched**. Generic numeric syntax and field-specific domain rules are
  separate layers, as the mission requires.

---

## F. ADMIN — files changed

`forge-admin-web/src/features/programming/`

- **`prescriptionContract.ts`** — added `parsePrescriptionNumber`,
  `formatPrescriptionNumber`, `resolveNumericInput`, `ParsedNumber`; `num()`
  (paste) now delegates.
- **`MovementRow.tsx`** — new `NumField` component (draft→commit, `inputMode`
  `numeric`/`decimal`); `MetricEditor` uses it for all three numeric inputs;
  `toNum` deleted; `isInt = metric === 'reps' || metric === 'calories'`; new
  `asNum` guard.
- **`MovementRow.test.tsx`** — +10 tests (comma commits, dot commits, partial
  `"22,"` survives, `22,25` precision, malformed reverts, empty→null,
  decimal through M/F toggle, integer reps rejects decimal, distance comma,
  `inputMode` attribute).
- **`prescriptionContract.parity.test.ts`** — +P9.2 table (valid/invalid parse,
  lifecycle, comma/dot Quick-Paste equivalence).

## G. WOD-SIMPLE — files changed

`WOD-SIMPLE/src/`

- **`prescriptionContract.js`** — same three exports + `num()` delegation
  (byte-for-byte with the `.ts`).
- **`App.jsx`** — new `PmpeNumField` component (inline-styled twin of
  `NumField`); `PmpeMetricEditor` uses it; `pmpeToNum` deleted; `pmpeAsNum`
  added; import of `resolveNumericInput`.
- **`prescriptionContract.test.js`** — +~55 assertions: `parsePrescriptionNumber`
  table (valid comma/dot incl. `22,25` `7,125` `100,125`; invalid;
  empty/number/non-finite), `resolveNumericInput` lifecycle, Quick-Paste
  comma/dot equivalence + `22,25/17,75kg`, structured round-trip
  (member display / snapshot / V2 mirror / legacy mirror all keep the decimal
  as a number).

---

## H. QUICK PASTE — comma / dot

The paste grammar already tokenized `\d+(?:[.,]\d+)?`; `num()` now routes the
token through `parsePrescriptionNumber`. Tested (both repos):

- `20 Dumbbell Snatches @ 22,5/15kg` → `{ male: 22.5, female: 15, unit: 'kg' }`
- `20 Dumbbell Snatches @ 22.5/15kg` → **identical**
- `20 Dumbbell Snatches @ 22,25/17,75kg` → `{ male: 22.25, female: 17.75 }`
- `20 Thrusters @ 22,5kg` → universal `22.5`
- `1,5 km Run` → distance `{ value: 1.5, unit: 'km' }`
- `20 Thrusters @ 22,,5kg` → **no load extracted** (token doesn't match the
  grammar) — not coerced to `22`. Review-chip behavior unchanged.

---

## I. GENERATE VARIANTS

`generateVariantInstancesFromRx` (both repos): RX instance → `renderInstanceLine`
(always dot form, `String(n)`) → `scaleMovementLine` → re-parse.

- The **RX** decimal is untouched — the RX variant list is only *read* to build
  the line; `22.5` stays `22.5` in RX after generating.
- `scaleMovementLine`'s weight regex is dot-only; it always receives dot form
  from `renderInstanceLine`, so structured generation never sees a comma. ✅
- **Derived** Intermediate / Beginner / OnRamp loads are `Math.round(rx * ratio)`
  — **pre-existing P6 behavior** (deterministic integer scaling of *suggested*
  scaled loads, applied equally to reps and weights). This is the scaling
  algorithm's intent, not a text-round-trip artifact, and is explicitly out of
  P9.2 scope ("Do NOT redesign P6 … Keep scope controlled"). No locale
  corruption, no stringification bug, no `NaN`.
- Pre-existing / out of scope: a coach's hand-typed **legacy** `@ 22,5kg` text
  line (not structured) still fails `scaleMovementLine`'s dot-only regex and
  passes through unscaled. Untouched — the structured path is the supported one.

Test: `scalingEngine.test.js` / `.ts` green; contract test asserts RX `22.5`
and `1.5 km` survive generation as numbers.

---

## J. V2 MIRROR

`movementObjectsForV2` (shared, one-way `wods` → V2):

- `prescription.load` = the **structured spec verbatim** → `{ mode, male: 22.5,
  female: 15, unit: 'kg' }` (numbers).
- The flat `weight` display string is `"22.5kg"` (dot, via `measureToken` →
  `String(n)`) — a display field, always was; the numeric truth is in
  `prescription`.
- No localized `"22,5"` anywhere. Authority direction unchanged.

Test: contract test asserts `m.prescription.load` numeric equality.

---

## K. MEMBER DISPLAY

`resolveVariantDisplayLines(doc, 'rx', gender)` → `renderInstanceLine` →
`measureToken` → `fmtNum` = `String(n)`:

| Member | `DB Snatch` line |
|---|---|
| male | `20 DB Snatch @ 22.5 kg` |
| female | `20 DB Snatch @ 15 kg` |
| unknown gender | `20 DB Snatch @ 22.5/15 kg` (no male fallback) |

No rounding, no truncation. `1.5 km Run` renders `1.5 km Row`/`Run`. Tested.

---

## L. LOGGER / SNAPSHOT

Unchanged from P9/P9.1 — the decimal is just a number flowing through:

1. **Display** → `metconVariantsForDisplay` uses `resolveVariantDisplayLines`
   (§K) → member sees `22.5` / `15` / `22.5/15`.
2. **Frozen `logCtx`** → `captureLogCtx()` →
   `snapshotPrescriptionDoc(wodZiData.movement_prescriptions)` = deep value
   clone; numbers stay numbers (P9.1 immutability tests still green).
3. **`prescription_snapshot`** → `buildPrescriptionSnapshot` from the frozen doc
   → `load: { value: 15, unit: 'kg', mode: 'sex_specific', bothValues: [22.5,
   15] }` — all numbers, no localized strings.
4. A later coach edit to `20 kg` does **not** change the open logger or the
   saved snapshot (P9.1 P1→P2 test).

Contract test asserts `typeof snapshot.load.value === 'number'` and
`bothValues` numeric.

---

## M. REGRESSION — capability lookup (catalogfix-20260830)

The P9.1 acceptance-blocker fix is untouched. `<SectionCard movementCatalog={…}>`
still threads the catalog; `MovementRow.test.tsx` still asserts:

- `Power Clean` / `Dumbbell Snatch` / `Wall Ball` → **Load M/F** control
- `Burpee` → **no** Load control, reps only
- `Row` → Distance | Calories chooser

All green (admin `MovementRow.test.tsx` 20/20).

---

## N. TESTS

| Repo | Before | After | Added |
|---|---|---|---|
| forge-admin-web | 1214 | **1231** | +10 `MovementRow.test.tsx`, +7 `prescriptionContract.parity.test.ts` |
| WOD-SIMPLE | 1099 | **1099** *(count reflects file-level dedup)* — `prescriptionContract.test.js` **147** (was ~92), +55 assertions | table-driven parse + lifecycle + round-trip |

- forge-admin-web: **1231 passed**, 0 failing. `tsc -b` clean, `vite build`
  clean, `eslint src/features/programming/` clean.
- WOD-SIMPLE: all suites green **except the 9 pre-existing Deno-only
  `supabase/functions/*` files** (`@std/assert` resolution — unrelated,
  unchanged since before this mission). `vite build` clean, `eslint` clean
  (11 pre-existing unused-directive warnings, unrelated).

Table-driven "prove it's generic" set (not gym-weight whitelist): `0.25 0.5
1.25 2.75 7.5 11.25 17.75 22.25 22.5 37.25 47.5 62.75 100.125` — each in both
comma and dot notation.

---

## O. MIGRATIONS

**NONE.** The storage contract (`wods.movement_prescriptions` numeric fields =
`number | null`, trigger `20260829090000`) already accepts arbitrary decimals.
The bug was entirely in string→number conversion in two React components. No
schema blocker exists.

---

## P. PRODUCTION DATA

**No rows touched.** No backfill, no historical rewrite, no snapshot rewrite.
`app_version.current` bumped to `prescription-engine-p9-2-decimal-input-20260830`
(config row, not workout/log data).

---

## Q. COMMITS

| Repo | Message |
|---|---|
| WOD-SIMPLE | `fix(prescription): P9.2 - generic comma/dot decimal numeric input (draft->commit, shared parser)` |
| forge-admin-web | `fix(prescription): P9.2 - generic comma/dot decimal numeric input (draft->commit, shared parser)` |

---

## R. MANUAL OWNER CHECKLIST — live iPhone PWA

Hard-refresh / dismiss the update toast so you are on
`prescription-engine-p9-2-decimal-input-20260830`.

1. Metcon builder → add **Dumbbell Snatch** → Load **M / F (kg)** appear.
2. Tap **Load M**, type `22,5` using the keyboard's comma → the comma stays,
   the field shows `22,5` while you type.
3. Tap **Load F**, type `15`. Tap elsewhere.
4. **Save.** Reload the workout → Load shows `22.5 / 15` (dot after commit is
   fine), still editable.
5. Add a second movement, Load **M** `17,5` **F** `12,5` → save/reload →
   `17.5 / 12.5`.
6. Arbitrary precision: Load **M** `22,25` **F** `17,75` → save/reload →
   `22.25 / 17.75` (not rounded).
7. Clear a Load field entirely → it stays empty (does **not** become `0`).
8. Type garbage (`45xx`) into a Load field, tap away → it reverts to the last
   good value, not `0`.
9. Reps field: type `20` — fine. Try `20,5` → rejected (reps are whole).
10. Quick-Paste `20 Dumbbell Snatches @ 22,5/15kg` → chip resolves to Load
    `22.5 / 15`.
11. Generate Variants → RX Load still `22.5 / 15`; Intermediate inherits a
    scaled (rounded) load, independently editable.
12. Open the workout as a **male** member → `@ 22.5 kg`; as **female** →
    `@ 15 kg`; a **no-gender** profile → `@ 22.5/15 kg`.
13. Open **Log Score** → same prescription. Save a result → done.
14. Regression: **Power Clean** / **Wall Ball** still expose Load;
    **Burpee** does not; **Row** Distance/Calories still works; a legacy-only
    workout is unchanged.

If every step passes, P9 / P9.1 / P9.2 manual acceptance is clear and P10 may
begin.

---

## S. OPEN ISSUES

1. **Owner manual iPhone acceptance (§R)** — the remaining gate.
2. Pre-existing, out of scope, disclosed:
   - `scaleMovementLine` weight regex is dot-only, so a **hand-typed legacy**
     `@ 22,5kg` text line (not structured) passes through Generate Variants
     unscaled. The structured path is unaffected. A P6 rewrite is explicitly
     out of P9.2 scope.
   - Derived scaled variant loads are `Math.round`ed (existing P6 behavior).
   - `weight_logged` pre-fill on Home still reads the legacy first-load global
     column (P9.1 §J item 2) — unchanged.

No decimal-input defect is deferred to P10.

---

## HARD STOP

**P10 NOT STARTED.** `isNotRxd` / Journal / leaderboard historical
classification / performance readers are **unchanged** — they still resolve
prescribed weight live from `wods`. Switching them snapshot-first is **P10**,
which begins only after **(1)** the P9.1 + P9.2 reviews pass **and** **(2)**
owner manual iPhone acceptance passes.
