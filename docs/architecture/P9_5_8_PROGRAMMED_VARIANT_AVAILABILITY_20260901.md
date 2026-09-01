# P9.5.8 — Programmed Variant Availability Contract

**Date:** 2026-09-01
**Status:** SHIPPED (pending production acceptance)
**Repos touched:** `WOD-SIMPLE` only (member PWA). `forge-admin-web` unaffected — see §AF.
**DB / schema / migration / historical rows:** ZERO change.
**Scoring / ranking / classification / P9.5.6 / P9.5.7 / P10 / INC-06:** untouched.

---

## §A. Product invariant

> **The variant levels a member may select == the variant levels the coach explicitly
> programmed for that workout.**

If the coach programmed only RX, the member sees only RX. If the coach programmed RX +
Intermediate, the member sees exactly those two. The app never fills the gap
(RX + OnRamp does **not** imply Intermediate or Beginner), and never assumes RX exists.

Member modification, completion status, and score remain fully independent axes and never
change which variant was selected (P9.5.6 model, unchanged).

## §B. Owner-visible symptom

On the Home card, a member could open and select **any** of the four scaling accordions
(RX / Intermediate / Beginner / OnRamp) regardless of what the coach actually built, and
then log a result under that variant. A member with `usual_level = 'intermediate'` was even
**auto-selected** into Intermediate on an RX-only workout. The resulting `wod_logs` row
carried `variant_level = 'Intermediate'` for a workout that had no Intermediate
prescription — a variant the coach never wrote.

## §C. Root cause

Three layers, all in `WOD-SIMPLE`, none in the persisted model:

1. **`workoutEngine.js › metconScalingVariantsForDisplay(section)`** always emits **all four**
   entries (`LEGACY_LEVEL_ORDER = ['rx','intermediate','beginner','on_ramp']`), with
   `movements: []` for a level the coach never programmed. It is a *display reconstruction*,
   not an availability statement.
2. **`App.jsx` Home render (`metconVariantsForDisplay(primarySectionV).map(...)`)** turned
   every one of those four entries into a tappable accordion, calling
   `setVariantaAleasa(i)` for any `i`.
3. **`App.jsx` auto-select effect** (`usual_level` soft default) did
   `VARIANTE_WEIGHT_BASE.findIndex(v => v.key === userProfile.usual_level)` and selected that
   index **without checking whether the level was programmed**.
4. **`App.jsx › saveWodLog`** trusted `variantaAleasa` and wrote
   `VARIANTE_CONFIG[variantaAleasa].nivel` into `variant_level` with **no defensive
   validation** against the programmed set.

The *data* to do this correctly was already present — see §E.

## §D. Audit — persisted model (production, gym CrossFit C15)

| Fact | Finding |
|---|---|
| `wods` rows | 54; all 54 have a `movement_prescriptions` object |
| `movement_prescriptions.variants` keys, across all 54 | **only `rx`** ever appears (6 rows populate it; the rest are `{}`); **zero** rows carry `variants.intermediate/beginner/onramp` |
| `wods.movements_intermediate` non-empty | 25 rows |
| `wods.movements_beginner` non-empty | 25 rows |
| `wods.movements_onramp` non-empty | 13 rows |
| `wods.notes_intermediate` non-empty | 4 rows |
| `wods.intermediate_weight_{male,female}` non-null | 9 rows |
| weight-only variant (weight set, no movements, no notes) | **0 rows** (supported anyway — §6) |
| Engine V2 `workouts` | 54 (dual-written mirror) |
| `workout_sections` with non-empty `scaling_versions` | 26 |
| `scaling_versions[].level` values seen | `intermediate`, `beginner`, `on_ramp` — **only levels the coach built** |
| Example (2026-08-27): `scaling_versions` = `[intermediate, beginner]`, `legacyWeights.on_ramp = {null,null}` | on_ramp genuinely **absent**, not an empty placeholder |
| `wods` with empty `movements_rx` | **2** ("ANCHOR DOWN" 2026-07-14 — has 13 Intermediate movements, no RX; "J.T." 2026-07-02 — benchmark) → **RX is NOT universal (§3 confirmed)** |
| `profiles.usual_level` distinct values | `rx`, `intermediate`, `onramp` |
| `wod_logs.variant_level` official-variant counts | RX 228 · Intermediate 110 · Beginner 14 · OnRamp 4 (+ free-log format strings) |

### Coach editor serialization (`forge-admin-web/src/features/programming/sectionEditing.ts`)

`legacyPayloadFromSections` writes, per scaled level `k`:
- if the variant tab has **≥1 instance** → structured `variants[k]` + regenerated
  `movements_${k}` + `${k}_weight_*`;
- else → `movements_${k} = []`, `${k}_weight_* = null`, `notes_${k} = null`.

`hydrateInstancesFromLegacy([], {male:'',female:''})` returns `[]`. **An untouched variant
tab round-trips to all-empty.** A programmed variant always carries ≥1 movement, a note, a
per-level weight, or a structured entry.

## §E. Canonical definition of "programmed variant"

Implemented as **`workoutEngine.js › getProgrammedVariantLevels(section, doc)`** — pure,
data-driven, operating on the domain `section` (identical shape from
`mapLegacyWodToWorkout` and `mapV2SectionRow`) + the optional structured
`movement_prescriptions` document.

A level is **programmed** iff:

- **`rx`** — the section has base `movements`, a base `description`, a base per-gender weight
  in `metadata.legacyWeights.rx`, **or** a structured `doc.variants.rx.movements` array with
  ≥1 entry.
- **scaled (`intermediate` / `beginner` / `on_ramp`)** — that level appears in
  `section.scalingVersions` **with** movements or a non-empty note, **or**
  `metadata.legacyWeights[level]` carries a non-null male/female weight (a
  load/distance/calorie-differentiated variant that shares RX's movements — §6), **or** a
  structured `doc.variants[key].movements` array with ≥1 entry.

Returns canonical contract keys (`'rx'|'intermediate'|'beginner'|'onramp'`) in canonical
order — aligned with `variantKeyFromLevel` / `VARIANTE_WEIGHT_BASE`.

**Empty result** = no programming signal the persisted model can classify (e.g. "J.T." if
its structured doc is also empty). The callers then keep the **pre-P9.5.8 behaviour**
(offer all four) rather than render an empty selector. This is the single documented
fallback — conservative, never a silent coercion.

Companions:
- **`isProgrammedVariant(section, doc, levelOrKey)`** — membership test; empty set ⇒ `true`
  for every key.
- **`resolveDefaultProgrammedVariantKey(section, doc, usualLevelKey)`** — the soft default:
  `usual_level` if programmed, else `rx` if programmed, else first programmed level, else
  `null`.

## §F. Mandatory STOP-condition analysis (§102)

| # | Condition | Verdict |
|---|---|---|
| A | Persisted model cannot distinguish explicitly-programmed from placeholder/default | **NOT triggered.** Untouched variant ⇒ all-empty (`movements []`, `notes null`, weights `null`, no structured entry). Verified in prod (2026-08-27 on_ramp genuinely absent while int/beg present). |
| B | Requires a migration / schema change | **NOT triggered.** Read-model + display filter + client-side save guard only. |
| C | Ambiguous multi-section coverage (§72/§73) | **NOT triggered.** Variant selection is **metcon-primary-only**. Scored non-primary sections always log `variant_level:'RX'` with no selector (`saveWodLog` `logTargetSectionId` branch, unchanged). |
| J | Only works for RX / Intermediate | **NOT triggered.** Resolver is data-driven across all four canonical levels + all structured keys; no level is special-cased. |
| §54 | Explicit "identical to RX" variant indistinguishable from placeholder | **NOT triggered.** A coach making Intermediate identical to RX must still enter ≥1 movement / note / weight in that tab — the editor persists nothing for an untouched tab — so it becomes a real, detectable programmed variant. |

**Conclusion: no STOP. Implementation proceeded.**

## §G. The fix (WOD-SIMPLE)

### `src/workoutEngine.js`
- `+ getProgrammedVariantLevels(section, doc)` — canonical resolver (§E).
- `+ isProgrammedVariant(section, doc, levelOrKey)`.
- `+ resolveDefaultProgrammedVariantKey(section, doc, usualLevelKey)`.
- imports `variantKeyFromLevel` from `prescriptionContract.js` (already a dependency).

### `src/App.jsx`
- **import** the three resolvers.
- **`homeProgrammedVariantKeys`** + **`memberVariantAllowed(levelOrKey)`** derived next to
  `activePrescriptionDoc`. `memberVariantAllowed` is `true` for admin/coach and for the
  unclassifiable-workout fallback.
- **Auto-select effect** (`usual_level` soft default): now resolves the metcon section from
  `wodZiWorkoutV2 || mapLegacyWodToWorkout(wodZiData)` and calls
  `resolveDefaultProgrammedVariantKey(...)`. It still pre-selects — but never an
  unprogrammed variant. Falls back RX → first programmed → unmade. Dep array gains
  `wodZiWorkoutV2`.
- **Home accordion render**: `if (!memberVariantAllowed(v.level)) return null` inside the
  `.map` — the entry's true index is preserved (no array filtering), so
  `variantaAleasa` semantics are unchanged.
- **Home single-variant (`usual_level`) render path**: the branch condition gains
  `&& memberVariantAllowed(VARIANTE_CONFIG[variantaAleasa]?.nivel)` — a stale disallowed
  selection falls through to the accordion so the member re-picks.
- **"Log — <variant>" button**: disabled unless the selected variant is allowed for the
  **currently displayed** metcon (guards a cross-day stale selection).
- **`saveWodLog` defensive guard** (fail closed): for a member (`!isAdmin && !isCoach`) on
  the official-variant primary path, if
  `!isProgrammedVariant(logPrimarySectionV, activePrescriptionDoc, VARIANTE_CONFIG[variantaAleasa]?.nivel)`
  → `showToast(t.toastVariantNotProgrammed)`, `setWodSaving(false)`, `return`. **No silent
  coercion** — an Intermediate selection is never rewritten to RX. Validated against the
  **frozen `logCtx`** (`logPrimarySectionV` = `logCtx.primarySection`,
  `activePrescriptionDoc` = `logCtx.prescriptionDoc` in a frozen flow), never a re-fetched
  mutable workout (§26).

### `src/translations.js`
- `+ toastVariantNotProgrammed` (ro + en).

## §H. Entry points audited (§29)

| Entry point | Handling |
|---|---|
| Home card — 4-accordion selector (`App.jsx` ~10559) | filtered to programmed variants for members |
| Home card — `usual_level` single-variant view (~10507) | gated by `memberVariantAllowed` |
| Home card — `usual_level` auto-select effect (~7432) | `resolveDefaultProgrammedVariantKey` |
| Home card — "Log — <variant>" button (~10636) | disabled for a disallowed / stale selection |
| `logWOD` screen (`logWodPrimaryPath`) | **no selector** — consumes the frozen `variantaAleasa`; covered transitively + by the save guard |
| Journal → "Log new" (`setVariantaAleasa(null)` → `logWOD`) | free log, `variantaAleasa === null`, no variant — unaffected |
| Scored non-primary section logging (`logTargetSectionId`) | always `variant_level:'RX'`, no selector — unaffected |
| Edit an existing log (`editLogId`) | edits content, never re-selects a variant — unaffected |
| `saveWodLog` (all member official-variant saves) | **defensive guard, fail closed** |

## §I. Historical safety (§16 / §17 / §79 / §80)

- **Zero** historical `wod_logs` rows are read, rewritten, relabelled, or backfilled.
- The 110 Intermediate / 14 Beginner / 4 OnRamp logs already in production stay exactly as
  they are — including any that predate this contract. Old Ergun `variant_level =
  'Intermediate'` stays `'Intermediate'`.
- P9.5.6 classification, P9.5.7 movement-line projection, and P10 `resolveResultProvenance`
  already accept arbitrary `variant_level` values and are untouched.
- The fix is **forward-only**: it constrains new selections and new saves.

## §J. Test matrix — `src/p9_5_8ProgrammedVariantAvailability.test.js` (24 tests)

- RX-only ⇒ `['rx']`; RX+Int ⇒ `['rx','intermediate']`; RX+OnRamp ⇒ `['rx','onramp']` (no
  gap-fill); all four ⇒ all four.
- **RX not assumed**: Intermediate-only metcon ⇒ `['intermediate']`.
- Empty placeholder (blank movements + whitespace note + null weight) ⇒ does not count.
- Note-only scaled variant ⇒ counts. Load-only scaled variant (§6) ⇒ counts. RX-weight-only
  ⇒ RX counts.
- Structured: rx-only doc ⇒ `['rx']`; structured intermediate w/ movements ⇒ counts;
  structured intermediate w/ **empty** `movements: []` ⇒ does not count.
- `isProgrammedVariant`: accepts every display spelling; rejects non-programmed (no
  coercion); `on_ramp`/`OnRamp`/`onramp` normalise together; unclassifiable ⇒ all allowed;
  `null` section ⇒ allowed (same conservative fallback); unknown string ⇒ `false`.
- `resolveDefaultProgrammedVariantKey`: honours programmed `usual_level`; falls back to RX;
  falls back to first programmed; returns `null` when nothing programmed; normalises
  spelling.
- Resolver never mutates the section (JSON snapshot equality).

## §K. Regression

| Gate | Result |
|---|---|
| `vitest run` (full) | **1610 passed** / 9 pre-existing Deno `@std/assert` file-load failures (unchanged baseline) |
| `src/appHookOrderIntegrity.test.js` | 3 passed |
| `eslint src/App.jsx src/workoutEngine.js src/translations.js` | **0 errors** (only pre-existing "unused eslint-disable" warnings on untouched lines) |
| `vite build` | clean (bundle `index-*.js` ~1219 kB, unchanged magnitude) |
| `vite preview` + Chrome hard reload | App() boots — login screen renders, no error boundary, no console exceptions from app code |

## §AF. Why `forge-admin-web` is not touched

Members select variants; coaches **program** them. The coach app's
`metconScalingVariantsForDisplay` deliberately shows all four for
programming/coaching and has no "member selects a variant to log" surface. No parity
obligation. The shared `prescriptionContract` module is unchanged (only a pre-existing
export, `variantKeyFromLevel`, is newly imported by `workoutEngine.js`).

## §AP. Known limitations (documented, not defects)

1. **Unclassifiable workout fallback.** If a workout carries no programming signal the
   persisted model can read (e.g. "J.T." 2026-07-02 if its structured doc is also empty),
   the member sees all four accordions — pre-P9.5.8 behaviour. Preferred over an empty
   selector. 1–2 rows in current production.
2. **admin / coach are not restricted.** By explicit design (they need every variant visible
   for programming and coaching, and the owner logs test results across variants). The save
   guard also exempts them.
3. **Cross-day stale selection** is handled by disabling the Log button + the save guard,
   not by proactively clearing `variantaAleasa` on day navigation — that pre-existing state
   behaviour is out of scope and now harmless.
4. **No historical reconciliation.** Existing non-RX logs against now-"unprogrammed"
   variants are left as-is (§I) — intentional.

---

## Production acceptance checklist (post-deploy, prod alias, owner account)

- [ ] RX-only workout → member Home shows **only** the RX accordion; Log works.
- [ ] RX + Intermediate workout → member sees **exactly** RX + Intermediate.
- [ ] Member with `usual_level = intermediate` on an RX-only day → auto-selected to **RX**,
      not Intermediate.
- [ ] Modified RX result still classifies as RX + "Modified" (P9.5.6 unaffected).
- [ ] Old Intermediate/Beginner logs unchanged in Journal & leaderboard.
- [ ] Console clean on Home + logWOD.
