# Forge — Per-Movement Prescription Engine

**Phase 1 (Forensic Audit) + Phase 2 (UX Design) + Phase 3 (Target Data Model)**
Date: 2026-08-29
Status: **IMPLEMENTATION IN PROGRESS. Decisions locked in §0. Original STOP conditions maintained: no production backfill, no destructive schema change, no historical guessing, no unrelated refactor.**

**Progress:**
| Phase | State |
|---|---|
| P3a — foundation schema | ✅ SHIPPED live (`20260829090000`), trigger 10/10, no data change |
| P3b — capability seed | ✅ SHIPPED live (`20260829090500`), 465 platform movements classified, 59 explicit-unknown |
| P4 — shared contract module | ✅ SHIPPED both repos (WOD-SIMPLE `src/prescriptionContract.js`, forge-admin-web `.ts` port); shared `prescriptionFixtures.json`; parity 51/51; WOD-SIMPLE 1004 tests, admin 1142 |
| P5 — forge-admin-web structured builder | ✅ SHIPPED. MovementRow/MovementRowList; capability-driven; universal/M-F; replace/metric safety; publish gate; canonical `instances` + regenerated legacy artifacts. |
| P5′ — WOD-SIMPLE editor parity | ✅ SHIPPED. wodSections.js data-layer parity (shared contract + fixtures); MovementRowPWA/MovementRowListPWA in App.jsx (VariantEditorBody). Member render + logger UNCHANGED. |
| P6 — Generate Variants on structured prescriptions | ✅ SHIPPED both repos. `generateVariantInstancesFromRx` — deep-independent structured generation; Regenerate-with-AI parses AI text back to instances. |
| P7 — Quick Paste UI + confidence/review | ✅ SHIPPED both repos. Paste into the row list; low-confidence rows flagged "Review"; no invented values. |
| P8 — `wods` → V2 structured mirror | ✅ SHIPPED both repos. `movementObjectsForV2` in the mapper; one-way; `legacy_wod_id` untouched. |
| **P5–P8 review** | ✅ APPROVED 2026-08-29. |
| **P9 pre-guard** | ✅ SHIPPED. `buildLegacyArtifactsForVariant({ inlineLoad:false })` — regenerated legacy lines stay plain; structured workout's legacy render = status quo, no confusing inline. |
| **P9 — member render + frozen logger prescription + snapshot write** | ✅ SHIPPED (report `..._P9_REPORT.md`). Structured-first member display via `resolveVariantDisplayLines` + `members.gender`; `freezeLoggingContext` captures `prescriptionDoc` by ref + `frozenAt`; `wod_logs.prescription_snapshot` written from the frozen doc only. `app_version` = `prescription-engine-p9-20260829`. **Owner manual browser acceptance OUTSTANDING** (§L). |
| **P9 review checkpoint** | ⏳ **AWAITING OWNER REVIEW.** HARD STOP before P10. |
| P10 — Journal / `isNotRxd` / results snapshot-first | ⏳ BLOCKED on P9 review |
| P11 — server validation (done P3a) re-verify + tenant test | ⏳ |
| P12–P14 — test matrix / manual acceptance / prod verify + report | ⏳ |

**Deployed but DORMANT (2026-08-29):** the engine activates only when a coach
edits a workout with the new builder. Live: 51 wods / **0 structured**, 0
prescription snapshots, 406 movements seeded, 0 V2 sections with `prescription`.
`app_version` bumped to `prescription-engine-p3-p8-20260829`.

---

## 0. Decisions Locked (Phase 1–3 review, 2026-08-29)

### D-1 / D-2 recap (explicitly surfaced per review point 12)

- **D-1 — Data model: OPTION B, APPROVED.** New structured authoring
  representation is an **additive `wods.movement_prescriptions jsonb`** column.
  `wods` remains the authoring source of truth. Legacy `movements_{variant}
  text[]`, the 8 global `{variant}_weight_{male,female}` columns, and all existing
  historical readers **remain available as a controlled compatibility fallback** —
  **no destructive removal in this initiative**.
- **D-2 — Workout Engine V2: NOT promoted.** V2 (`workouts`/`workout_sections`)
  is **not** made the canonical authoring source. Its structured movement fields
  (currently 100% null) are **corrected/populated as a downstream mirror** from
  the authoritative `wods` prescription, with the **mirror direction defined and
  tested explicitly** (`wods` → V2, one-way). No second competing authoring model
  is created.

### Review adjustments folded into this document

| # | Adjustment | Where applied |
|---|---|---|
| 1 | Option B; `wods` authority preserved; legacy fallback retained; no destructive removal | §0 D-1, §C.3, §H |
| 2 | No automatic historical backfill; future separately-reviewed classification only; no guessing | §E, §G, §H |
| 3 | `prescription_snapshot` **must** originate from the frozen prescription the member saw in the logger — never re-read from mutable `wods` at submit. Full identity+prescription invariant. Explicit P1→P2 race test. Reuse INC-04 frozen logging-target architecture. | §C.6, §F, §H P9, §L |
| 4 | Capability model must have **one canonical representation** — no self-contradiction. Adopted: `movements.allowed_prescription_metrics text[]` + `movements.default_prescription_metric text` (nullable, CHECK-constrained ⊆ allowed). Metadata-driven, **no movement-name conditionals**. | §C.4, §C.5 |
| 5 | Prescription identity = **movement INSTANCE**, not canonical name. Same canonical movement may appear N times in one variant with different prescriptions (`10 Power Cleans @ 60/40` … `@ 70/47.5` … `@ 80/55`). Stable `instanceId` survives edit / reorder / duplicate / repeat / Generate Variants / logger snapshot / V2 mirror. | §C.5, §C.6 |
| 6 | Units: store `value` + `unit` as separate fields. **No automatic kg↔lb conversion in this initiative.** Display in the coach-authored unit. Architecture stays capable of future unit preferences. | §C.5, §D.5, §C.4-units |
| 7 | `movement_prescriptions` is a **strict typed contract**, not loose JSON. One canonical schema (`§C.5`), validated at every write boundary (client validator + DB trigger). Universal vs missing-sex-specific are **distinct semantic states**. No authoritative meaning encoded only in formatted strings. | §C.5, §H P3a/P4 |
| 8 | Leaderboard/Journal immutability: new snapshotted logs use the immutable snapshot for historical interpretation; old logs keep controlled legacy fallback; no invented snapshots. Audit + update **all** readers: `isNotRxd`, Journal, leaderboard, history, performance/PR. Editing today's workout must not reclassify a snapshotted historical result. | §B.8, §F, §H P10 |
| 9 | Cross-client parity: one canonical typed contract + identical resolver semantics + shared fixtures/contract cases + parity tests across both clients. Editors must never serialize different shapes. Physical code-sharing preferred where feasible without broad restructuring. | §C.7, §H P4 |
| 10 | UX: progressive disclosure as specified; keyboard-speed / minimum-interaction priority; Wall Ball load-only (no target height); bodyweight = no controls. | §D |
| 11 | V2 mirror: null structured fields ≠ V2 canonical. Mirror populated from authoritative `wods` prescription. Mirror direction defined + tested. | §0 D-2, §H P8 |
| 12 | D-1/D-2 surfaced above before P3a. Proceed P3a→P14 only if no conflict (none found). | §0 |

**Quality bar (owner, verbatim):** a coach can naturally program multiple
instances of multiple movements with different prescriptions; a member receives
exactly the prescription appropriate to the selected workout/variant; that exact
prescription is frozen through score logging and historical interpretation.

---

## A. Executive Result

**Status: DIRECTION APPROVED — implementing P3a→P14 (see §0, §H).**

The forensic audit is complete and confirms the mission's premise **exactly**, with
live production evidence. The current model stores **one `{male, female}` weight
text pair per variant** (`wods.rx_weight_male` … `wods.onramp_weight_female` — 8
`text` columns). Coaches are **already** working around it by hand-typing
`@ 61/43kg` into individual movement lines, which the global pair cannot represent
and which no reader reliably parses.

The Per-Movement Prescription Engine is **not** a bug fix and **not** a
localized feature — it changes the authoring source of truth for load/metric
data and touches the builder (forge-admin-web), the member renderer + logger
(WOD-SIMPLE), the quick-paste parser, Generate Variants, the leaderboard's
`isNotRxd` classifier, and historical immutability. Two of the mission's own STOP
conditions are in play (below). It therefore stops here for an explicit
data-model decision before Phase 3+ (migration / code).

This document delivers: the complete audit (§B), the recommended architecture with
Option A/B/C/D evaluation (§C), the full coach + member UX design (§D), the
production backfill classification with exact counts (§E), the historical
immutability analysis (§F), the triggered STOP conditions (§G), the phased
implementation plan (§H), and the **six decisions the owner must make** (§I).

---

## B. Forensic Audit

Production project `sdfkvfbvgpuspnnnwqwk`, read-only queries only. Repos at
current `main`: WOD-SIMPLE `ee9583e`, forge-admin-web `da42cde`.

### B.0 Domain diagram (as-built, today)

```
                         ┌──────────────────────────────┐
   AUTHORING             │  wods   (SOURCE OF TRUTH)     │
   forge-admin-web       │  one row per (gym_id, date)   │
   Programming Module ──▶│                              │
   writes ONLY here      │  type, format_config         │
                         │  movements_rx      text[]  ◀── raw lines, e.g.
                         │  movements_intermediate     "21 Power Clean @ 61/43kg"
                         │  movements_beginner         "15 wallballs 9kg/6kg"
                         │  movements_onramp           "15/12 Cal Row"
                         │  notes_{variant}   text      │
                         │  rx_weight_male    text ◀────┐  ONE {male,female}
                         │  rx_weight_female  text      │  pair PER VARIANT
                         │  intermediate_weight_male…   │  ("45","43kg","22,5")
                         │  …onramp_weight_female  (×8) ┘  — the limitation
                         │  warmup/skill/skill2 text[]   │
                         └──────────────┬───────────────┘
                                        │  sync_workout_engine_v2()  (RPC, dual-write,
                                        │  best-effort, INC-03-hardened)
                                        ▼
                         ┌──────────────────────────────┐
   MIRROR (downstream)   │  workouts / workout_sections │
   "Workout Engine V2"   │  workout_sections.movements  │  jsonb: [{ name, reps,
                         │    jsonb  ◀──────────────────── weight, distance,
                         │  every structured field is    │  calories, equipment[],
                         │  NULL; whole prescription is   │  canonicalName }]
                         │  in `name` as free text        │  ← SHAPE EXISTS, UNUSED
                         │  scaling_versions jsonb  ([] ) │
                         │  metadata.legacyWeights ◀────── {rx:{male,female},…}
                         └──────────────┬───────────────┘   copied from wods
                                        │
   READ (member + logger)               │  loadWorkout(gym,date): V2 if present, else wods
   WOD-SIMPLE App.jsx  ◀────────────────┘
     workoutForDisplay = wodZiWorkoutV2 || mapLegacyWodToWorkout(wodZiData)   ← movement NAMES only
     prescribed weight = wodZiData[ weightKeyForVariant(variant, members.gender) ]  ← from wods 8 cols
                                        │
                                        ▼
                         ┌──────────────────────────────┐
   LOGGING               │  wod_logs / skill_logs        │
                         │  weight_logged        text ◀── what the athlete used
                         │  variant_level        text    │
                         │  movements_snapshot   jsonb ◀── frozen at log time
                         │  wod_name_snapshot / format_snapshot / format_config_snapshot
                         │  wod_id → wods.id  (NOT workouts.id)
                         │  workout_section_id → workout_sections.id
                         │  ⚠ NO prescription snapshot — prescribed weight is
                         │    RE-RESOLVED live from wods at every read
                         └──────────────────────────────┘
```

**Ownership answers (mission Audit A):**

| Question | Answer |
|---|---|
| What owns a movement? | A **variant column on `wods`** (`movements_{rx\|intermediate\|beginner\|onramp}`), as a `text[]` of raw lines. In the V2 mirror, an element of `workout_sections.movements` jsonb. |
| Movement belongs to variant / section / workout? | **Variant**, in `wods` (4 parallel arrays). In V2, **section** (one `movements` array per section) with scaling stored separately in `scaling_versions` (empty in practice). |
| Relational / JSON / text / hybrid? | **Hybrid, text-dominant.** `wods` = `text[]`. V2 = `jsonb` array-of-objects whose object fields are all null. |
| Where is ordering stored? | **Array index** (both `wods.movements_*` and `workout_sections.movements`). No explicit order column at movement level. |
| Where are movement IDs stored? | **Nowhere at the instance level.** `workout_sections.movements[].canonicalName` is always `null`. The `movements` catalog table (465 rows) has **zero** structural references from any workout/section/log row. Result-side canonical identity (`wod_logs.sets_movement_ids`) exists but is derived at log time, not from programming. |
| Canonical movement library? | `public.movements` — 465 platform rows (`gym_id NULL`), `+` gym rows. Columns: `name, aliases[], equipment, category, movement_pattern, default_substitutions jsonb`. **Used for autocomplete + scaling-substitution overrides + AI prompt injection only.** ~246/465 have `category`; **no capability, no unit, no load/distance/calorie flags.** Contains benchmark names ("Amanda", "Angie", "Annie") mixed with movements. |
| Movement rows first-class entities? | **No.** They are array elements / text lines. |

### B.1 Audit B — Global Weight M/F lifecycle

**Storage:** `wods.{rx,intermediate,beginner,onramp}_weight_{male,female}` — 8
`text` columns, nullable, no constraint, no unit convention.

**Write path (the only one):**
`forge-admin-web/src/features/programming/sectionEditing.ts` →
`legacyPayloadFromSections()` →
`variantFields['${k}_weight_male'] = sv.weight?.male?.trim() || null` — one
`{male, female}` object per `SCALING_KEY`, edited in `SectionEditor.tsx` /
`VariantTabs.tsx` as two free-text inputs per variant. Persisted by
`mutations.ts` (upsert into `wods`), then mirrored by `sync_workout_engine_v2`.
WOD-SIMPLE's own in-app Admin WOD editor (`src/wodSections.js`) has the identical
shape.

**Read paths:**

| Reader | File | Uses global weight for |
|---|---|---|
| Member workout screen | `App.jsx` (`weightKeyForVariant`, `VARIANTE_CONFIG`, `metconScalingVariantsForDisplay`) | the "@ 45 kg" shown under the chosen variant |
| Log Score screen | `App.jsx` `saveWodLog` (`prescribedWeight = logWodZiData[weightKeyForVariant(...)]`) | pre-filling `weight_logged`, share-popup text |
| Journal / history | `App.jsx` (`log.wods?.[weightKeyForVariant(log.variant_level, gender)]`) | per-log "prescribed" display and the RX badge |
| Leaderboard | `workoutFormats.js` `isNotRxd` → `greutateEsteSubStandard` → `classifyRxStatus` | **classifying a score as RX vs scaled**, live, at read time |
| Rx Engine | `rxEngine.js` `parseWeightStandardFromText` | parsing `61/43kg` out of a movement line when there is one |
| forge-admin-web preview | `workoutEngine`-ported mapping | mirrors the member display |

**Resolution semantics — `weightKeyForVariant(nivel, gender)` (`workoutFormats.js:602`):**
- variant not in `VARIANTE_WEIGHT_BASE` → `null`
- `resolveAthleteGenderKey(gender)` → `'male'` / `'female'` / **`null`** when
  gender is missing/unresolved (P0-02 hardening — **no male default**, already
  correct).
- returns `` `${key}_weight_${genderKey}` `` or `null`.
- A `null` key means **no prescribed weight is shown at all** for an
  unknown-gender member — it does **not** fall back to male. (Mission Invariant 1
  & 2 already satisfied for the *global* field; must be preserved by the new one.)

**Why the global weights are currently necessary:** they are the **only**
structured load data in the system. Everything else is a string. Removing them
without a replacement breaks: the member "@ x kg" line, the logger pre-fill, the
Journal prescribed column, and — most importantly — **`isNotRxd` leaderboard
classification** (a score with no resolvable standard falls back to
`weightMatches` text equality).

**What breaks if removed with no replacement:** RX/scaled classification on the
leaderboard for every weighted workout; prescribed-weight display in 3 surfaces.

**Which readers can move to per-movement prescription:** all of them — every
reader above resolves *one* number for *one* variant+gender; a per-movement
resolver returns that same shape per movement instance.

**Which readers still need the legacy field:** all historical `wod_logs` rows
(412 today) whose `wods` row has global weights but no per-movement prescription
— they must keep resolving the old way (see §F).

### B.2 Audit C — Movement Library

`public.movements`: `id, gym_id, name, aliases text[], equipment text, category
text, movement_pattern text, default_substitutions jsonb, created_by, timestamps`.

- 465 platform rows + gym rows. `category` populated ~53%; values seen:
  `bodyweight, dumbbell, kettlebell, barbell, gymnastic, …` (7 distinct).
  `movement_pattern`: `squat, hinge, olympic, press, pull, …` (partial).
- **No** `supports_load`, `supports_distance`, `supports_calories`, `unit`,
  `default_metric`, or any capability field.
- Static fallback lists (`src/movements.js`) carry the only functional grouping
  that exists: `CARDIO_MISCARI` (Row, Run, Bike Erg, Assault Bike, Air Bike, Ski
  Erg, Echo Bike, Assault Runner, Shuttle Run, Swim) and `CARDIO_CU_CALORII`
  (cardio **minus Run** — i.e. the machines that support calories). This is a
  usable **seed** for distance/calorie capability.
- `default_substitutions jsonb` — the one existing extensible per-movement
  metadata slot, currently `{intermediate/beginner/onramp: {...}}` shaped, read
  by `buildScalingOverrides`.

**Best location for capability metadata:** the `movements` table already exists,
already has RLS (`movements` SELECT for `authenticated`, gym-or-null scoped),
already has a platform/gym two-tier model (per `PROGRAMMING_DOMAIN_ARCHITECTURE.md`
§Movement Library). Adding capability columns there is the minimum clean
architecture. A **normalized capability child table is not warranted** at this
scale (465 rows, 4 capability dimensions). See §C.

### B.3 Audit D — Coach / Admin Builder

**Single builder, one write target.** `forge-admin-web` Programming Module
(`WorkoutDayPage.tsx` → `EditWorkoutDialog.tsx` → `SectionEditor.tsx` /
`VariantTabs.tsx` → `sectionEditing.ts` → `mutations.ts`). Editable state:

```ts
EditableSection.variants: Record<'rx'|'intermediate'|'beginner'|'onramp', {
  movements: string[]                       // raw text lines
  weight: { male: string; female: string }  // ONE pair for the whole variant
  note: string
}>
```

- Movements are added / removed / reordered / replaced **as free-text lines** in
  a textarea (`parseLiniiWod` = split on `\n`, trim, drop empty).
- `movementName` autocomplete exists only for non-primary "skill" sections
  (single movement) — **the primary metcon section has no per-movement UI at
  all**, it's a textarea.
- Save gate: `validateSectionsForLegacy` — exactly 1 primary section, ≤3
  supporting; `Strength Sets`/`Superset` required-field check. **No prescription
  validation** (a variant with weighted movements and blank weights saves fine).
- `duplicateWorkout.ts` — copies the `wods` row wholesale (all 8 weight columns,
  all 4 arrays) → independent row. **No shared reference** (it's a DB insert of
  copied scalar/array values). Safe.
- WOD-SIMPLE also has an in-app Admin editor (`src/wodSections.js`, same shape)
  — **cross-client parity requirement**: any builder change must land in both.

**Shallow-copy / reference-sharing check:** `sectionsFromWodRow` builds a fresh
`variants` object with `Object.fromEntries` per load; `emptySectionVariants()`
builds fresh objects per key. `legacyPayloadFromSections` reads
`primary.variants?.[k]` per key and writes scalars. **No aliasing found** in the
mapping layer. React-state-level aliasing (a `setState` that spreads a nested
`variants[k]` object without cloning `weight`) is a **live risk to test for** in
`VariantTabs.tsx`/`SectionEditor.tsx` when the new nested prescription arrays are
added (mission TEST 10, TEST 33).

### B.4 Audit E — Generate Variants

`forge-admin-web/src/features/programming/scalingEngine.ts` (ported identically
to `WOD-SIMPLE/src/scalingEngine.js`). Coach-triggered, **synchronous,
deterministic, pure**. Input: the coach-finalized RX section. Process:

- `parseMovementLine` (`scalingEngine.js:157`): regex
  `/^(.*?)\s*@\s*(\d+(?:\.\d+)?)(?:\s*\/\s*(\d+(?:\.\d+)?))?\s*(kg|lbs)\s*$/i`
  — **already parses `Name @ 45/30 kg` into `{name, male, female, unit}`**, then
  applies `TIER_RULES[tier].defaultLoadRatio` (or a per-movement
  `SCALING_SUBSTITUTIONS` / `movements.default_substitutions` override) and
  **re-emits a text line** `Name @ 34/23 kg`.
- Copies structure + order + score scheme; scales load + volume + time cap.
- Output variants are written to `movements_{tier}` / `{tier}_weight_*` as
  **plain copied text** — after creation they are **fully independent**
  (`wods` columns, no live coupling). Mission Invariant 7 already satisfied.
- No AI. AI ("Regenerate with AI" / "Analyze") is a **separate** path
  (`workoutIntelligence.js`) that extracts `{reps, distance, weight,
  canonicalName}` structure but **does not persist it** and does not generate
  scaling (per `FORGE_ANALYZE_SCALING_PHASE0` audit).

**Key finding:** the scaling engine **already has** a movement-line parser that
produces exactly the `{name, loadMale, loadFemale, unit}` structure this mission
needs. It is thrown away (re-serialized to text). Promoting it to the persistence
layer is a large part of the work.

### B.5 Audit F/G — Quick Paste / Parser

**No single parser.** Weight-from-text regexes exist in **five** places, each
re-parsing independently at its own call site, none persisting structure:

| File | Function | What it does |
|---|---|---|
| `src/movements.js:153` | `parseMiscareLinePasta` | WOD-SIMPLE coach paste: cosmetic normalizer. Extracts reps + `@ x/y kg` + cardio `Nm`/`N cal`, title-cases the name, **re-concatenates to a string** `"20 Snatch @ 45/30kg"`. Structure discarded. |
| `src/movements.js:179` | (inline regex) | `@ 45/30 kg` tail match |
| `src/scalingEngine.js:157` | `parseMovementLine` | `Name @ x/y (kg\|lbs)` → structured, used only to re-scale |
| `src/wodSections.js:27` | (inline regex) | `@ x/y kg` extraction for the editor |
| `src/rxEngine.js:76` | `parseWeightStandardFromText` | pulls a standard out of a movement line for RX classification |
| `src/workoutIntelligence.js` | AI response mapper | `{reps, distance, weight}` structured + raw text, not persisted |

- Cardio metric parsing: `parseMiscareLinePasta` recognises `500m`, `20 cal`,
  distinguishes Run (distance-only) from calorie machines via `CARDIO_CU_CALORII`.
- `15/12 Cal Row` — the `x/y` there is **reps male/female**, not weight; only
  `parseMiscareLinePasta`'s cardio branch handles `N cal` and it takes the
  **first** number only (`calM[1]`), silently dropping the `/12`.
- **Ambiguity today is resolved by "keep as text"** — nothing invents values,
  but nothing captures the M/F split for calories/distance either.

**Round-trip (Audit G):** paste → `parseMiscareLinePasta` (normalize to text) →
save to `wods.movements_rx` (text[]) → reload (raw text) → edit (raw text) →
member render (raw text, names only) + global weight appended. **No structured
prescription survives because none is ever created.** The `@ 45/30kg` inside a
line is preserved *as characters*, not as data — the member sees the literal
string `"20 Snatch @ 45/30kg"` regardless of their gender (the per-line inline
load is **not** gender-resolved; only the *global* variant weight is).

### B.6 Audit H — Member App

`WOD-SIMPLE/src/App.jsx`. Flow (post-INC-04):

- `dataAcasa` (selected date) → `fetchWodZi` (→ `wods` row → `wodZiData`) +
  `fetchWodZiWorkoutV2` (→ `loadFromWorkoutEngineV2` → `wodZiWorkoutV2`), both
  guarded by `isWorkoutFetchCurrent` (INC-04 Layer 1).
- `workoutForDisplay = wodZiWorkoutV2 || mapLegacyWodToWorkout(wodZiData)` —
  **movement NAMES only** (`.map(m => m.name)`); the structured V2 fields are
  null so nothing else is available.
- Variant selection: `VARIANTE_CONFIG` (RX/Intermediate/Beginner/OnRamp) →
  `metconScalingVariantsForDisplay(section)` returns `{level, movements: string[],
  notes, weightMale, weightFemale}` from `section.metadata.legacyWeights`.
- **Prescribed weight shown to the member:**
  `wodZiData[weightKeyForVariant(variant.nivel, userProfile.gender)]` — the
  global column, gender-resolved. Unknown gender → key `null` → **no weight
  line** (correct).
- Historical dates: same path, keyed by `dataAcasa`; INC-04 frozen `logCtx` on
  the logger side.
- **Member personalization happens at render**, by picking one of the two global
  columns. There is no per-movement personalization anywhere.

**Where per-movement personalization SHOULD occur:** a single pure resolver
`resolveMovementPrescription(movementInstance, gender, unitPref)` → `{ display,
male, female, mode }`, called once per movement instance in the member renderer,
the logger, the Journal, and `isNotRxd`. This is the I-14 "single shared engine"
requirement.

### B.7 Audit I — Logger

Covered in depth by INC-04 (`FORGE_INC_04_HISTORICAL_LOG_SCORE_CONTEXT_REPORT.md`).
Current invariant (post-`8501356`):

```
DISPLAYED WORKOUT = frozen logCtx = logger content = variant = section = legacy WOD = save target
```

- `logCtx` freezes `{businessDate, wodZiData, wodZiWorkoutV2, workout,
  primarySection, supportingSections, additionalScoredSections}` at click.
- Save identity: `resolveWodIdForLog(logWodZiWorkoutV2, logWodZiData)` →
  `wods.id`; `workout_section_id` from the frozen primary/supporting section.
- **Prescription is NOT in `logCtx` and NOT snapshotted to `wod_logs`.**
  `wod_logs.movements_snapshot` freezes the movement **lines** (jsonb) and
  `weight_logged` is what the athlete entered, but the **prescribed** standard is
  re-resolved live from `wods` at every Journal/leaderboard read.
- **This mission must extend the frozen invariant to:**
  `DISPLAYED PRESCRIPTION = logCtx PRESCRIPTION = SAVE`. Concretely: add the
  resolved-at-click per-movement prescription to `logCtx`, and snapshot it onto
  the log row (new `prescription_snapshot jsonb`), so a later builder edit cannot
  silently reinterpret a historical score (mission Phase 5, TEST 24, TEST 26).

### B.8 Audit J — History / Leaderboard / Performance

| Reader | Depends on global weight? | Retroactive-edit risk today |
|---|---|---|
| Journal (`App.jsx`) | Yes — `log.wods?.[weightKeyForVariant(...)]` for the prescribed column + RX badge | **Yes** — editing `wods.rx_weight_male` changes every historical log's displayed "prescribed" and can flip its RX badge |
| Leaderboard `isNotRxd` | Yes — `greutateEsteSubStandard(weight_logged, prescribed)` where `prescribed` is resolved live | **Yes** — the mission's Phase 5 scenario (45→60 edit) silently re-classifies 30 athletes' scores |
| `sortLogs` / ranking | Indirectly (RX vs scaled grouping) | Yes, via `isNotRxd` |
| PR detection (`recentPrEvents`, `pr_events`) | Movement identity (`sets_movement_ids`), **not** prescription | Low — PR is by performance signature, not prescribed load |
| Performance analytics (`performanceAnalytics.js`) | Movement identity + `weight_logged` | Low |
| Benchmark history | Benchmark identity | None |
| forge-admin-web results views | Ported `isNotRxd` equivalent (`rxEngine.ts`) | Same as leaderboard — **must stay in lockstep** |
| Exports | None found | — |

**Downstream conclusion:** a per-movement prescription with a **log-time
snapshot** (§F) *removes* the retroactive-classification risk that exists **today**
— this mission is a net integrity improvement for the leaderboard, not just a
feature.

### B.9 Audit K — Security / Tenancy

Touched surfaces only (no broad audit):

- `wods` — RLS: SELECT `gym_id = my_gym_id()`; INSERT/UPDATE/DELETE
  `is_coach_or_admin(gym_id)`. Adding columns inherits this unchanged.
- `workout_sections` — RLS: SELECT `gym_id = my_gym_id() AND (coach/admin OR
  workout.is_published)`; writes `is_coach_or_admin`. Adding columns / enriching
  the `movements` jsonb inherits this unchanged.
- `movements` — RLS: SELECT for `authenticated` (platform + own-gym);
  writes gym-scoped. Adding capability columns inherits this. Platform-row
  capability seed is a `gym_id IS NULL` update — **coach-write RLS does not apply
  to a migration** (runs as `postgres`), fine for a one-shot seed.
- `wod_logs` — RLS unchanged; a new `prescription_snapshot jsonb` column
  inherits the existing member-write / gym-read model.
- **No new table needed if Option B is chosen** → **zero new RLS policies**,
  zero `SECURITY DEFINER`, zero grant changes. This is a deliberate argument for
  Option B (§C).
- Cross-gym: prescriptions are physically inside gym-scoped rows → Gym A cannot
  read/mutate Gym B prescriptions by construction. To be re-verified with a test
  (mission TEST 27) but **no design risk**.

---

## C. Architecture

### C.1 The core constraint the audit surfaced

`wods` is the **authoring source of truth**; `workouts`/`workout_sections` is a
**best-effort downstream mirror** whose structured movement fields have **never
been populated**. The mission's per-movement prescription must be **authored**,
so it must live where authoring happens.

Fully adopting Workout Engine V2 as the authoring source of truth (populating
`workout_sections.movements` structurally, moving the builder + member + logger
onto it) **is** the "replace the entire Workout Engine V2 [adoption]" path the
STOP condition warns against — it is a multi-month migration with its own risk
surface, and the frozen `PROGRAMMING_DOMAIN_ARCHITECTURE.md` v1.1 +
`VARIANT_GENERATION_ENGINE.md` describe a *different*, larger target
(`WorkoutVersion` immutable + `RenderRuleSet` + `LoadProfile` with
`prescriptionType: literal|formula`) that is **also unbuilt** and **also does not
model male/female**. This mission should **not** try to land that.

### C.2 Options evaluated (mission Phase 3)

Conceptual model in all options:
`WORKOUT → SECTION → VARIANT → MOVEMENT INSTANCE → PRESCRIPTION`, where a
**Prescription** is:

```
prescription := {
  reps?:      { mode: 'universal', value } | { mode: 'sex_specific', male, female } | { mode: 'scheme', text }
  load?:      { mode: 'universal', value, unit } | { mode: 'sex_specific', male, female, unit }
  distance?:  { mode: 'universal', value, unit } | { mode: 'sex_specific', male, female, unit }
  calories?:  { mode: 'universal', value } | { mode: 'sex_specific', male, female }
}
```

`mode` is **explicit** — `universal` and "female value absent" are different
states (mission Invariant 8, TEST 13). A movement with no relevant dimension
carries no key (progressive disclosure at the data layer).

| | **A. Columns on movement instance** | **B. Structured JSON prescription (RECOMMENDED)** | **C. Child prescription table** | **D. Existing-structure extension only** |
|---|---|---|---|---|
| Shape | Promote `wods.movements_{v}` from `text[]` to `jsonb[]` of `{name, prescription}`; OR add parallel `wods.prescriptions_{v} jsonb` | Store the movement-instance array (incl. `prescription`) as **`jsonb`** — reuse `workout_sections.movements` shape (already `{name, reps, weight, distance, calories}`), extend `weight→load{mode,male,female,unit}`, promote it to authoritative for the prescription slice; keep `wods.movements_{v} text[]` as the human/legacy line + keep the 8 global cols as fallback | New `movement_prescriptions` table: `(id, gym_id, wod_id, variant, order_index, movement_name, canonical_movement_id, reps_json, load_json, distance_json, calories_json)` | Keep everything as text; only add a render-time parser that extracts `@ x/y` per line and resolves by gender |
| Per-movement M/F | ✅ | ✅ | ✅ | ⚠️ only for lines the coach hand-types `@x/y`; no universal/sex-specific distinction; no calorie/distance M/F |
| Backward compat | ⚠️ `text[]`→`jsonb[]` is a type change on a live column w/ readers | ✅ additive; legacy text + global cols untouched | ✅ additive; nothing changed on `wods` | ✅ nothing changes |
| Authoring fit | ✅ | ✅ (builder already edits an array per variant) | ✅ but the builder now writes 2 places transactionally | ❌ coach still hand-types load into text |
| Query/analytics future | ✅ columns | ✅ jsonb is queryable (`->>`, GIN); enough at this scale | ✅✅ best for heavy analytics | ❌ |
| New RLS / SECURITY DEFINER | none | **none** | **new table + 4 policies + FK cascade design** | none |
| N+1 / perf | fine | fine (one row load, already fetched) | ⚠️ extra join per workout load | fine |
| Lines of change | high (type migration + every reader) | **medium** (builder + resolver + snapshot; readers get a new resolver) | high (table + policies + dual-write RPC + every reader + backfill target) | low but **does not satisfy the mission** |
| Matches frozen `VARIANT_GENERATION_ENGINE.md` direction | partial | **partial — same "MovementOverride slot carries a LoadProfile" idea, minus the unbuilt WorkoutVersion/RuleSet machinery**; a clean forward step, not a divergence | closest to a future normalized model, but premature | no |
| Historical immutability | needs snapshot regardless | needs snapshot regardless (§F) — **same** | needs snapshot regardless | can't snapshot what isn't structured |

### C.3 Recommendation: **Option B**

**Store the per-variant movement array — including each instance's structured
`prescription` — as `jsonb`, authored in the builder, with the legacy `wods` text
lines and the 8 global weight columns retained untouched as the
backward-compatible fallback tier.**

Concretely:

1. **Authoring (`wods`):** add **one additive column**
   `movement_prescriptions jsonb` on `wods` (default `'{}'::jsonb`), keyed by
   variant:
   ```jsonc
   {
     "rx": [
       { "name": "Snatch", "canonicalMovementId": "…", "reps": {"mode":"universal","value":20},
         "load": {"mode":"sex_specific","male":45,"female":30,"unit":"kg"} },
       { "name": "Wall Ball", "reps": {"mode":"universal","value":20},
         "load": {"mode":"sex_specific","male":9,"female":6,"unit":"kg"} },
       { "name": "Row", "calories": {"mode":"sex_specific","male":15,"female":12} }
     ],
     "intermediate": [ … ], "beginner": [ … ], "onramp": [ … ]
   }
   ```
   `wods.movements_{variant} text[]` stays as the **rendered human line** (kept in
   sync from the structure: `"20 Snatch @ 45/30 kg"`), so **every existing
   legacy reader keeps working with zero changes**. The 8 global weight columns
   stay, written as a convenience mirror of the first weighted movement's load
   (or left as-is on legacy rows).

2. **Capability layer (`movements`) — ONE canonical representation (review point 4):**
   add exactly two columns:
   - `allowed_prescription_metrics text[] NOT NULL DEFAULT '{}'` — the closed set
     of metrics valid for this movement. Element domain: `reps | load | distance |
     calories` (CHECK-enforced).
   - `default_prescription_metric text` (nullable) — the one metric whose control
     the builder shows immediately. **CHECK: `default_prescription_metric IS NULL
     OR default_prescription_metric = ANY(allowed_prescription_metrics)`** — the
     default can never contradict the allowed set (no dual authority).
   Semantics: a metric in `allowed` but ≠ `default` is an **optional** capability
   (Weighted Pull-up: `allowed = {reps,load}`, `default = reps`). Empty `allowed`
   = bodyweight-only, no prescription controls (Burpee). `default = NULL` with
   `allowed = {distance,calories}` = coach must pick (Row). A movement with no
   catalog row, or a gym movement with `allowed = {}` **and never seeded**, is
   treated by the resolver as *unknown* → builder shows a `None | Reps | Load |
   Distance | Calories` chooser (default None). Seeded deterministically (§C.4).
   **No movement-name conditionals anywhere in resolution or UI** — everything
   reads these two columns.

3. **V2 mirror:** `sync_workout_engine_v2` already writes
   `workout_sections.movements` — extend the mapper so it emits the **structured**
   `prescription` per element instead of an all-null object. This makes the V2
   mirror correct for the first time; it does not make it authoritative.

4. **Single shared resolver** (ported identically to both repos, like every other
   Forge engine):
   `resolveMovementPrescription(instance, gender, unitPref, ruleSetVersion?) →
   { line, load: {display, male, female, mode}, distance, calories, reps }`.
   Member renderer, logger, Journal, `isNotRxd`, forge-admin-web preview all call
   this — never re-parse text, never re-resolve gender locally (I-14).

5. **Log-time snapshot:** add `wod_logs.prescription_snapshot jsonb` (and
   `skill_logs`), written from the frozen `logCtx` at save. Journal + `isNotRxd`
   read the snapshot when present, fall back to live resolution for pre-migration
   rows (§F). **This closes the retroactive-reclassification hole that exists
   today.**

**Why B over C:** C is architecturally "cleaner" for a future where prescriptions
are queried in bulk analytics — but at 51 workouts / 465 movements it is
premature, it adds a table + 4 RLS policies + a transactional dual-write + a
cascade-delete design + a backfill *target*, and the builder already edits a
per-variant array so JSON is the natural fit. B is reversible into C later (a
`jsonb` column is a trivial source for a normalizer migration); C is not
trivially reversible.

**Why B over A:** A's `text[]`→`jsonb[]` is a breaking type change on a column
with ~7 live readers across two repos and the sync RPC. B is purely additive.

**Why B over D:** D does not satisfy the mission (no authored per-movement M/F, no
universal/sex-specific distinction, no calorie/distance M/F, can't snapshot).

### C.4 Capability seed (deterministic, `gym_id IS NULL` platform rows only)

Priority order per movement, first match wins:

1. **Curated override map** (~55 entries) for every movement the mission
   enumerates + the obvious high-frequency ones. Verbatim from the mission where
   it is explicit:
   - `load`-default: Snatch, Clean, Clean & Jerk, Deadlift, Front Squat, Back
     Squat, Thruster, Dumbbell Snatch, Dumbbell Clean, Dumbbell Thruster,
     Kettlebell Swing, Wall Ball (+ Power/Hang/Squat variants, Push Press, Push
     Jerk, Overhead Squat, SDHP, …) → `allowed = {reps,load}`, `default = load`.
   - `reps`-only: Pull-up, Chest-to-Bar, Toes-to-Bar, Burpee, Box Jump, Double
     Under (+ Push-up, HSPU, Sit-up, Air Squat, Lunge (unloaded), Muscle-up, …)
     → `allowed = {reps}`, `default = reps`. **Wall Ball is NOT here — load only,
     no target height (review point 10).**
   - `distance`-only: Run → `allowed = {distance}`, `default = distance`.
   - `distance`+`calories`: Row, SkiErg, BikeErg → `allowed = {distance,calories}`,
     `default = NULL` (coach picks).
   - `calories`-only: Air Bike (Assault/Echo/Air) → `allowed = {calories}`,
     `default = calories` (mission: "AIR BIKE default: calories").
   - optional-load: Pull-up variants that are commonly weighted, Lunge, Sit-up,
     Step-up → `allowed = {reps,load}`, `default = reps`.
2. **`CARDIO_MISCARI` / `CARDIO_CU_CALORII`** (from `src/movements.js`) — any
   cardio machine not covered above → `{distance,calories}`; Run → `{distance}`.
3. **`category` / `movement_pattern`** — `barbell`/`dumbbell`/`kettlebell` or
   pattern `olympic`/`hinge`/`press` (not already covered) → `{reps,load}`,
   `default = reps` (conservative: load is *available* but coach opts in);
   `bodyweight`/`gymnastic` → `{reps}`, `default = reps`.
4. **No match** → leave `allowed = {}`, `default = NULL` → resolver treats as
   *unknown* (chooser in the builder). **Not a guess, an explicit "unknown".**

Seed migration reports exact counts per bucket. Gym-created movements are **not**
seeded (coach can set their capability, or leave it unknown).

### C.5 Canonical Typed Contract v1 (`wods.movement_prescriptions`)

**Strict.** One schema, validated at every write boundary — the shared client
validator (`validateMovementPrescriptions`, §C.7) **and** a DB
`BEFORE INSERT OR UPDATE` trigger on `wods` (structure/enum/type only; completeness
is a client publish-gate, §D.1). Loose/arbitrary JSON is rejected.

```jsonc
// wods.movement_prescriptions  —  jsonb NOT NULL DEFAULT '{"version":1,"variants":{}}'
{
  "version": 1,                         // integer, currently exactly 1
  "variants": {                         // keys ⊆ {"rx","intermediate","beginner","onramp"}; absent key = variant has no structured prescription (legacy fallback applies)
    "rx": {
      "movements": [                    // ORDERED array; array index = display order
        {
          "instanceId": "mi_8vК2p…",    // REQUIRED, string, stable, unique within this variant array (§C.6)
          "name": "Power Clean",         // REQUIRED, non-empty string (display + legacy-line source + resolver fallback)
          "canonicalMovementId": "…",    // string (movements.id) or null — identity of the CANONICAL movement, NOT the instance
          "reps":     { "mode": "universal",    "value": 10 },
          "load":     { "mode": "sex_specific", "male": 60, "female": 40, "unit": "kg" }
          // "distance", "calories" — same shape, omitted here
        },
        { "instanceId": "mi_j3Lq…", "name": "Power Clean", "canonicalMovementId": "…",
          "reps": { "mode": "universal", "value": 10 },
          "load": { "mode": "sex_specific", "male": 70, "female": 47.5, "unit": "kg" } },
        { "instanceId": "mi_Za91…", "name": "Power Clean", "canonicalMovementId": "…",
          "reps": { "mode": "universal", "value": 10 },
          "load": { "mode": "sex_specific", "male": 80, "female": 55, "unit": "kg" } }
      ]
    }
    // "intermediate", "beginner", "onramp" — same shape, independent arrays, independent instanceIds
  }
}
```

**Spec value types (each is a discriminated union on `mode`):**

| Metric | `universal` | `sex_specific` | notes |
|---|---|---|---|
| `reps` | `{mode:"universal", value:number\|null}` | `{mode:"sex_specific", male:number\|null, female:number\|null}` | also `{mode:"text", text:string}` for `"Max"`, `"21-15-9"`, `"AMRAP"` — preserves anything non-numeric, **flattens nothing**; workout-level scheme stays in `wods.type`/`format_config`, untouched |
| `load` | `{mode:"universal", value:number\|null, unit:"kg"\|"lb"}` | `{mode:"sex_specific", male:number\|null, female:number\|null, unit:"kg"\|"lb"}` | `unit` REQUIRED; **no conversion** (review point 6) |
| `distance` | `{mode:"universal", value:number\|null, unit:"m"\|"km"\|"ft"\|"mi"}` | `{mode:"sex_specific", male, female, unit}` | `m` is the only seeded unit; others reserved |
| `calories` | `{mode:"universal", value:number\|null}` | `{mode:"sex_specific", male:number\|null, female:number\|null}` | no unit (calories is the unit) |

**Hard rules (trigger + validator):**
- `version === 1`; `variants` is an object; every key ∈ the 4 allowed; every
  `variant.movements` is an array.
- every movement: `instanceId` non-empty string, unique within its array; `name`
  non-empty string; `canonicalMovementId` string-or-null.
- every present spec: `mode ∈ {universal, sex_specific}` (reps also `text`);
  numeric fields are `number` or `null`; `load`/`distance` carry a `unit` in the
  allowed set.
- a movement may carry **only** metrics in its canonical movement's
  `allowed_prescription_metrics` **at author time** — the builder enforces this;
  the trigger does **not** (a movement's capability could be edited later; the
  stored prescription stays valid and the resolver simply renders what's there).
- **`universal` vs missing-`sex_specific`-value are distinct:**
  `{mode:"universal", value:500}` ≠ `{mode:"sex_specific", male:500, female:null}`.
  The second is an **incomplete draft** (blocked at publish, §D.1) and is
  **never** rendered as "female uses male".
- **`null` numeric = "not yet entered"** (draft). A metric with all-`null` values
  is dropped on save (equivalent to the key being absent).

**Derived artifacts written alongside (never read as truth):**
- `wods.movements_{variant} text[]` — regenerated from the structure on every
  save as human lines (`"10 Power Clean @ 60/40 kg"`, gender-neutral `x/y` form).
  Legacy readers unaffected.
- `wods.{variant}_weight_{male,female}` — for a prescription-authored variant,
  set to the **first `load`-bearing movement's** male/female value as a *lossy
  legacy mirror* (so old readers still show *a* weight); left as-authored on
  legacy rows. Documented as lossy.

### C.6 Movement Instance Identity + prescription freeze (review points 3, 5)

- **`instanceId`** is generated client-side when a movement row is created in the
  builder (`mi_` + a 21-char url-safe random id — same discipline as the existing
  `newSectionId()`). It is **stable** across: editing any field, reordering,
  Duplicate Movement (the copy gets a **new** `instanceId`), repeating the same
  canonical movement (each occurrence has its own `instanceId`), save/reload.
- **Generate Variants** produces target-variant movements with **fresh**
  `instanceId`s — generated variants are independent copies with no back-pointer
  (Invariant 7). No cross-variant instance correspondence is modeled (that is the
  unbuilt `MovementOverride`-slot concept; out of scope).
- **V2 mirror** carries `instanceId` through into
  `workout_sections.movements[].instanceId` so the mirror is addressable and
  diff-able (`wods` → V2, one-way).
- **Logger snapshot** (`wod_logs.prescription_snapshot`): at the moment the member
  taps "Log Score", the **already-frozen INC-04 `logCtx`** is extended to carry
  the **resolved-for-this-member** prescription for the frozen variant+section —
  computed once, from `logCtx` state, **never re-read from `wods` at submit**.
  On save, that frozen object is written verbatim to `prescription_snapshot`.
  Shape:
  ```jsonc
  {
    "version": 1,
    "variant": "rx",
    "gender": "female" | "male" | null,        // members.gender at log time
    "resolvedAt": "<logCtx freeze time>",
    "movements": [
      { "instanceId": "mi_…", "name": "Power Clean", "canonicalMovementId": "…",
        "reps": { "value": 10 },
        "load": { "value": 40, "unit": "kg", "mode": "sex_specific" },   // RESOLVED to this member
        "displayLine": "10 Power Clean @ 40 kg" }
    ],
    "source": "structured" | "legacy_global" | "legacy_text"  // which tier produced it
  }
  ```
  `source` records the fallback tier so downstream readers know the fidelity.
- **Invariant (review point 3), tested end-to-end:**
  ```
  DISPLAYED WORKOUT = DISPLAYED VARIANT = DISPLAYED SECTION = DISPLAYED PRESCRIPTION
    = LOGGER WORKOUT = LOGGER VARIANT = LOGGER SECTION = LOGGER PRESCRIPTION
    = SAVED PRESCRIPTION SNAPSHOT = SAVE TARGET
  ```
  Race test: member opens W (P1) → opens logger → admin edits W to P2 → member
  submits ⇒ `prescription_snapshot` is **P1** (resolved from the frozen `logCtx`,
  not the now-P2 `wods` row). Identity is never reconstructed from `wods.date`, a
  fresh current-workout lookup, or mutable global state.

### C.7 Cross-client parity (review point 9)

- **One canonical typed contract** = §C.5, authored once, lived in a shared
  location. Physical sharing preference, in order: (a) a tiny published contract
  module if the repos can consume one without restructuring; (b) if not — a
  **single source file** (`prescriptionContract.*`) with the types + pure
  functions, **ported byte-for-byte** to both repos (the established Forge
  pattern: `scalingEngine.ts`↔`.js`, `workoutEngine.js`↔`workoutMapping.ts`), plus
  a **shared fixture set** (`prescriptionFixtures.json`) checked into both and a
  **parity test** in each repo asserting identical resolver output over every
  fixture.
- **Identical resolver semantics:** `resolveMovementPrescription(instance,
  gender, unitPref)` and `validateMovementPrescriptions(json)` and
  `renderPrescriptionLine(spec)` produce byte-identical output in both repos —
  enforced by the shared fixtures, run in both CI suites.
- Neither builder may serialize a shape the other cannot parse — the parity test
  round-trips builder-state → `movement_prescriptions` JSON → builder-state in
  both.

### C.9 Pre-P5 clarifications (owner-required, 2026-08-29)

#### C.9.1 — Canonical vs legacy text authoring. "Replace the textarea" ≠ remove fast text entry.

The metcon **free-text textarea** is replaced by a **structured movement-row
list** as the *editing surface*. The fast text / Quick-Paste **authoring path is
kept and is first-class** — it is an *input method into* the structured rows, not
a competing representation.

| Question | Answer |
|---|---|
| Canonical representation for a new/edited structured workout | **`wods.movement_prescriptions` (JSON, §C.5).** The only independently-editable semantic representation. |
| What Quick Paste produces | The **`movement_prescriptions` structure** (via `parseWorkoutPaste`, P4). Paste → structured rows → the coach lands in the row builder → edit → save. Never a parallel editable text blob. |
| How legacy text is retained | `wods.movements_{variant} text[]` + the 8 `{variant}_weight_{male,female}` columns are **DERIVED artifacts**, regenerated from `movement_prescriptions` on **every save** (`buildLegacyArtifactsForVariant`, P4). Read-only outputs. Legacy readers (pre-P9 member app, any other consumer) keep working unchanged. |
| How display text is regenerated | Member/logger/Journal render via `resolveMovementInstance` (P4). The `movements_{variant}` text[] is the gender-neutral rendered form for legacy readers only — never the source of truth. |
| Two independently-editable canonicals? | **No.** Once `movement_prescriptions.variants[v]` has content, `movements_{v}` for that variant is *always* regenerated on save and is *never* an edit target. Before it has content (pure legacy row) `movements_{v}` is the only representation. There is never a window where both are independently editable → **no silent divergence**. |
| Incomplete parse | The row is created with the raw text preserved in `name` + a **"Review"** flag; **no invented values**; the coach resolves it in the row builder before save. Worst case a row is name-only and renders back as that text — no data loss. |
| Opening an OLD legacy-only workout to edit | The builder **hydrates** the row list from `movements_{variant} text[]` using the *same* `parsePastedMovementLine`. The coach sees editable rows. **Nothing is persisted until the coach saves.** Open-and-close ⇒ the legacy row is byte-untouched. Save ⇒ `movement_prescriptions` is now populated, `movements_{v}` + global cols are regenerated from it (global cols become the documented *lossy* first-load mirror). Non-destructive forward migration, per workout, only on an explicit save. |
| Scope | The engine covers the **primary metcon section's four variants** only. `warmup` / `skill` / `skill2` sections keep their current free-text editing untouched. |

UX intent: **paste OR build → structured rows → edit visually → save.** Not
"textarea removed, rebuild everything by hand."

#### C.9.2 — `reps` semantics: STRUCTURE, not a prescription characteristic.

Two distinct concepts, kept **explicitly distinct** in the contract:

| Concept | Contract field(s) | Meaning | Sex-specific? | Completeness-gated at publish? |
|---|---|---|---|---|
| **Movement quantity / target** ("how much of this movement") | exactly ONE of `reps` \| `distance` \| `calories` per movement (or a `reps` `text` scheme) | the count/target the coach composed into the workout | `reps` almost always universal; `distance`/`calories` commonly sex-specific for cardio (`15/12 Cal Row`) | `distance`/`calories`: **yes**. `reps`: **no** (blank never blocks — see below). |
| **Intensity / resistance** ("how heavy") | `load` (optional, orthogonal) | the weight each rep is performed at | often sex-specific (`45/30 kg`) | **yes** |

- `reps` is **workout structure**: the per-movement count *within* a scheme. The
  **scheme itself** (21-15-9, rounds, AMRAP/EMOM timing) stays **exclusively** in
  `wods.type` + `wods.format_config` — the prescription engine **does not touch
  it**. `21-15-9 Thrusters` is authored either as `reps: {mode:'text', text:'21-15-9'}`
  **or** with `reps` blank and the scheme in `format_config` — coach's choice,
  both valid.
- A **blank `reps` never blocks publish** (the scheme may carry the count). The
  only `reps` case the publish gate flags is a genuine **sex_specific half-entry**
  (one side typed, the other blank) — an obvious mistake. `load` / `distance` /
  `calories` keep full completeness checks. *(Contract adjustment applied to
  `validatePrescriptionsForPublish` in both repos, 3 new fixtures — P4 follow-up
  commit; no schema change.)*
- **`allowed_prescription_metrics`** (the live capability column) lists *which
  metric fields a movement can carry* — an **authoring/UI hint**, not a claim
  that `reps` and `load` are the same kind of concept. Including `reps` in it is
  correct (a Plank carries neither `reps` nor `load`; a Snatch carries both; a
  Row carries neither `reps` nor `load` — it carries `distance`/`calories`). The
  builder renders `reps` under a **"Quantity"** affordance and `load` under a
  distinct **"Load"** affordance so the coach sees the distinction.
- **Live schema is semantically correct — no correction, no migration.** The JSON
  keys `reps` / `load` / `distance` / `calories` are separate and unambiguous;
  workout schemes are untouched; `wod_logs` performed-result capture
  (`sets`/`result`/`weight_logged`) is untouched; P9's `prescription_snapshot`
  will carry the prescribed quantity as *reference* data, adding nothing that
  weakens logging.

### C.8 What this deliberately does NOT build

- No `WorkoutVersion` immutable-lineage table, no `RenderRuleSet` versioning, no
  `LoadProfile.prescriptionType: 'formula'` (bodyweight-relative) — from the
  unbuilt `VARIANT_GENERATION_ENGINE.md`; out of scope, architecture stays
  compatible with adding them later.
- **No unit-conversion engine, no automatic kg↔lb member-profile conversion**
  (review point 6). `unit` is stored and displayed **exactly as the coach
  authored it**. Future unit-preference work is explicitly separate so it never
  drags rounding / leaderboard / snapshot semantics into this change.
- No Wall Ball target height, watts, pace, RPM, cadence, tempo, HR.
- No EAV, no rules engine, no expression evaluator, no movement-name switch
  statements.

---

## D. UX Design (Phase 2)

**Principle:** the coach never sees a data model. Add a movement → Forge shows
only the controls that movement supports → coach types values → done.

### D.1 Builder — primary metcon section, per variant

Replace the **free-text movements textarea** with a **movement row list** (the
non-primary "skill" section already has single-movement autocomplete — extend
that interaction to a list). Each row:

```
┌─────────────────────────────────────────────────────────────┐
│ ⠿  [ 20 ]  [ Snatch                         ⌄ ]        🗑    │   ← reps + movement (autocomplete)
│           Load    ♂ [ 45 ]   ♀ [ 30 ]   kg                   │   ← shown because Snatch supports load
├─────────────────────────────────────────────────────────────┤
│ ⠿  [ 20 ]  [ Wall Ball                      ⌄ ]        🗑    │
│           Load    ♂ [ 9  ]   ♀ [ 6  ]   kg                   │
├─────────────────────────────────────────────────────────────┤
│ ⠿  [ 20 ]  [ Dumbbell Snatch                ⌄ ]        🗑    │
│           Load    ♂ [ 22.5 ] ♀ [ 15 ]  kg                    │
├─────────────────────────────────────────────────────────────┤
│ ⠿  [    ]  [ Row                            ⌄ ]        🗑    │
│           Metric  ( Distance | ●Calories )                   │   ← Row supports both → chooser
│           Calories ♂ [ 15 ]  ♀ [ 12 ]                        │
├─────────────────────────────────────────────────────────────┤
│ ⠿  [ 20 ]  [ Burpee                         ⌄ ]        🗑    │   ← bodyweight → NO prescription controls
├─────────────────────────────────────────────────────────────┤
│ + Add movement          [ Paste workout ▾ ]                  │
└─────────────────────────────────────────────────────────────┘
```

**Progressive disclosure rules (driven by movement capability, not a name switch):**

| Movement capability | Controls shown |
|---|---|
| load (Snatch, Clean, Deadlift, Thruster, DB/KB variants, Wall Ball, …) | `Load ♂ [ ] ♀ [ ] <unit>` |
| distance-only (Run) | `Distance [ ] m` + `⌵ Different M/F` toggle |
| distance+calories (Row, Ski, Bike Ergs) | `Metric ( Distance \| Calories )` → then the chosen one |
| calories-only (Air Bike) | `Calories ♂ [ ] ♀ [ ]` |
| bodyweight (Burpee, Pull-up, T2B, Box Jump, DU) | **none** |
| optional-load (Pull-up → Weighted Pull-up) | none by default; a small `+ add load` affordance |
| unknown movement (no catalog match) | `Metric ( None \| Load \| Distance \| Calories )` chooser, default None |

**Universal vs M/F (mission's critical distinction):**
- **Load** defaults to `♂ / ♀` two fields (sex-specific is the CrossFit norm).
- **Distance** defaults to **one** `[ ] m` field (universal). A `Different M/F`
  toggle reveals `♂ / ♀`. Entering only one value in universal mode stores
  `{mode:'universal', value}` — **never** `{male:X, female:null}`.
- **Calories** default to `♂ / ♀` two fields (sex-specific calories are common).
  A `Same for everyone` toggle collapses to one field → `{mode:'universal'}`.
- **Reps** default to one field (universal). `15/12`-style is entered by toggling
  `Different M/F` OR is auto-detected on paste (§D.4).

**Keyboard flow:** `reps → movement → (load ♂) → (load ♀) → next row`. `Tab`
advances; `Enter` in the last field of the last row = `+ Add movement`. Decimal
allowed (`inputmode="decimal"`, not `type="number"` integer). No modal for
routine validation.

**Inline validation (no modals):**
- Sex-specific load with `♂` filled and `♀` blank → inline hint under the field:
  *"Enter the women's load"* — on blur, not on save.
- Draft may save incomplete. **Publish** runs
  `validatePrescriptionsForPublish(sections)` → blocks with an actionable list:
  *"Snatch (RX): women's load is missing."*

### D.2 Movement replacement / metric change safety

- **Replace movement** (Snatch → Burpee): on change, if the new movement's
  capabilities don't include the old ones, the incompatible prescription keys are
  **cleared from state, from the payload, and from persistence** — a one-line
  confirmation toast *"Load removed — Burpee has no load."* (mission TEST 12,
  Scenario H). No hidden retention.
- **Metric change** (Row Calories → Distance): the `calories` key is cleared, a
  fresh `distance` key created empty. *"Switched to distance — calorie values
  cleared."* (mission TEST 11, Scenario I). No contamination.

### D.3 Variant navigation + Generate Variants

- Variant tabs (`VariantTabs.tsx`) stay. The **currently edited variant is
  visually obvious** (filled tab + a colored left border on the row list, using
  the existing `VARIANTE_CONFIG` colors).
- Editing RX load `♂ 45` never touches Intermediate — each variant's
  `movement_prescriptions[variant]` is an independent array (mission TEST 10,
  Invariant 7). React state: each variant key holds its own cloned array; row
  edits clone the row and its `prescription` (`structuredClone` on write) —
  **explicit test for reference sharing** (TEST 33).
- **Generate Variants**: `scalingEngine` already parses `Name @ x/y` and applies
  ratios. Feed it the **structured** RX prescriptions instead of text; it emits
  structured Intermediate/Beginner/OnRamp prescriptions as a **copy** (start
  values), coach edits freely, **no live coupling** after generation.

### D.4 Quick Paste target behavior

Paste box accepts the same syntax coaches use now; the parser (one shared
`parseWorkoutPaste`, replacing the 5 scattered regexes for the paste path)
produces **structured** rows:

| Input line | Parsed to |
|---|---|
| `20 Snatches @ 45/30kg` | `{reps:{universal:20}, name:'Snatch', load:{sex_specific, 45, 30, kg}}` |
| `20 Snatches 45/30 kg` | same (‌`@` optional) |
| `20 Wall Balls @ 9/6kg` | `{reps:{universal:20}, name:'Wall Ball', load:{sex_specific,9,6,kg}}` |
| `20 DB Snatches @ 22.5/15kg` | `{reps:{universal:20}, name:'Dumbbell Snatch', load:{sex_specific,22.5,15,kg}}` |
| `15/12 Cal Row` | `{name:'Row', calories:{sex_specific, male:15, female:12}}` |
| `500m Row` / `500 m Row` | `{name:'Row', distance:{universal, 500, m}}` |
| `20 Cal Row` | `{name:'Row', calories:{universal, 20}}` |
| `400m Run` | `{name:'Run', distance:{universal, 400, m}}` |

**Confidence policy (mission Phase 7):**
- Confident parse (`N Movement @ x/y unit`, `x/y Cal <machine>`, `Nm <movement>`)
  → structured, shown in the row list for review.
- Uncertain (no recognised movement, weird token order, ambiguous `/`) → the row
  is created with the **raw text preserved** in the name and a **"Review
  prescription"** chip; **no invented values**.
- Never promotes a per-line load to the global variant weight; never guesses a
  second (female) value.

### D.5 Member rendering

`resolveMovementPrescription(instance, members.gender, unitPref)` per row.

| Member | Output |
|---|---|
| **Male** (`members.gender='male'`) | `20 Snatches @ 45 kg` / `20 Wall Balls @ 9 kg` / `20 DB Snatches @ 22.5 kg` / `15 Cal Row` |
| **Female** | `20 Snatches @ 30 kg` / `20 Wall Balls @ 6 kg` / `20 DB Snatches @ 15 kg` / `12 Cal Row` |
| **Unknown gender** (`null`) | `20 Snatches @ 45/30 kg` / `20 Wall Balls @ 9/6 kg` / … / `15/12 Cal Row` — **explicit both-values, never the male value alone** |
| Universal dimension (any gender) | `500 m Row` — one value for everyone |

Unknown-gender: a **subtle, non-blocking** "Add your gender in your profile to see
your exact weights" line under the workout (only when the workout actually has
sex-specific prescriptions). Workout access is **never** blocked.

Display text is **derived** from structured data, not stored as the source of
truth. The `wods.movements_{variant} text[]` line is a *rendered artifact* kept
for legacy readers; the member renderer uses the resolver.

---

## E. Backfill Classification (exact production counts)

Live, read-only, 2026-08-29. Single gym.

| Metric | Count |
|---|---|
| Total `wods` | 51 |
| `wods` with ≥1 non-empty global weight column | **23** |
| `wods` with ≥1 athlete log | 43 |
| Total `wod_logs` | 412 |
| `wod_logs` with `weight_logged` | 122 |
| `workouts` (V2 mirror) | 51 |
| `workout_sections` | 68 |

**Global-weight text values seen (RX column):** `"47kg"`, `"5kg"`, `"70kg"`,
`"61"`, `"43"`, `"29"`, `"22,5"` (comma decimal), `"102kg"`, `"22.5kg"`,
`"56kg"`, `"84kg"` — **no unit convention, mixed decimal separators.**

**Deterministic vs ambiguous (heuristic classification of the 23):**

| Class | Approx. count | Rule | Backfill action |
|---|---|---|---|
| **DETERMINISTIC** | ~8–10 | exactly one weighted movement line in `movements_rx` AND no inline `@` load already present AND a parseable global pair | *candidate* for `load` on that one movement — **still requires per-row human confirmation** |
| **ALREADY INLINE** | ~4 | movement lines already contain `@ x/y kg` (e.g. `"21 Power Clean @ 61/43kg"`, 3 different loads in one workout) — the global pair is redundant/first-only | parse the inline loads per line; **ignore** the global pair |
| **AMBIGUOUS** | ~9–11 | ≥2 weighted movement lines, one global pair (e.g. one row: 7 weighted lines / 1 pair); OR `null` movements with a stray global pair ("ANCHOR DOWN": 70/102, no lines); OR unclear which movement the pair belongs to | **NO backfill.** Legacy global pair stays as the fallback. Reported per-row. |

**Recommendation: NO automated backfill.** The deterministic set is small
(~8–10 rows), the ambiguous set is larger, and the mission forbids guessing.
Legacy `wods` rows keep rendering exactly as today via the fallback tier. If the
owner wants the ~8–10 deterministic rows migrated, that is a **separate,
explicitly-approved, per-row-reviewed** step after the engine ships — not part of
the engine migration.

---

## F. Historical Immutability (Phase 5)

**The risk exists TODAY and the engine fixes it.** Currently, editing
`wods.rx_weight_male` retroactively changes the "prescribed" value shown for
every historical `wod_logs` row against that WOD **and** can flip its
leaderboard RX/scaled classification (`isNotRxd` re-resolves live).

**Chosen policy (minimum safe): C — snapshot the prescription onto the result.**

- Add `wod_logs.prescription_snapshot jsonb` + `skill_logs.prescription_snapshot
  jsonb` (additive, nullable).
- At log save, write the **resolved-at-click** per-movement prescription (from
  the frozen INC-04 `logCtx`) into the snapshot.
- Journal + `isNotRxd` + forge-admin-web results: **read the snapshot when
  present**; fall back to live `wods` resolution for pre-migration rows (exactly
  as today — no regression for old logs).
- Result: a later builder edit changes future logs only; historical scores keep
  the standard they were actually judged against.

**Not chosen:** edit-lock after logs exist (too rigid for a single-coach gym
fixing a typo), mandatory clone/new-version (that is the unbuilt `WorkoutVersion`
architecture — out of scope), full version-control (explicitly forbidden by the
mission).

**Prescription snapshot / race condition (member views P1, admin edits to P2, member
submits):** the INC-04 frozen `logCtx` **already** solves the identity half.
Extending `logCtx` to carry the resolved prescription (D.5 resolver output,
frozen at click) and snapshotting it (above) closes the prescription half — the
member's score is judged against the prescription **they saw**, even if the
builder changed it during the logger session.

---

## G. STOP Conditions — status

| Mission STOP condition | Triggered? | Detail |
|---|---|---|
| "requires replacing the entire Workout Engine V2" | **PARTIALLY — mitigated by Option B** | Full V2 authoring adoption *would* trip this. Option B avoids it: `wods` stays authoritative, one additive `jsonb` column, V2 mirror is *corrected* not *promoted*. **Owner should confirm they accept Option B rather than a V2-authoring migration.** |
| "backfill cannot be proven deterministic" | **YES** | ~9–11 of 23 rows are ambiguous. Recommendation: **no automated backfill** (§E). Owner decision D-5. |
| "migration would silently change meaning of historical logged workouts" | **YES if done wrong** | Adding the engine without the §F snapshot would make every historical score's prescribed standard editable. The snapshot (D-3) prevents it. This is why §F is non-optional. |

**Checkpoint cleared (2026-08-29):** direction approved (§0). All three STOP
conditions remain **honored** by the locked design — no backfill, no destructive
change, snapshot-from-`logCtx` mandatory, Option B avoids the V2-authoring
migration.

---

## H. Phased Implementation Plan (post-approval)

Additive, backward-compatible, reversible, per mission "Migration Rules". Each
phase ships + is verified before the next.

| Phase | Scope | Repo(s) | Risk |
|---|---|---|---|
| **P3a** | Migration `20260829…_movement_prescription_engine_foundation.sql`: `wods.movement_prescriptions jsonb NOT NULL DEFAULT '{"version":1,"variants":{}}'`; `wod_logs.prescription_snapshot jsonb`; `skill_logs.prescription_snapshot jsonb`; `movements.allowed_prescription_metrics text[] NOT NULL DEFAULT '{}'` + `movements.default_prescription_metric text` (+ CHECKs, §C.4); `validate_movement_prescriptions()` trigger fn + `BEFORE INSERT OR UPDATE` trigger on `wods` (structure/enum/type only, §C.5). Additive only. No backfill. | supabase | low |
| **P3b** | `movements` capability seed (deterministic, `gym_id IS NULL` only, priority: curated map → cardio lists → category/pattern → unknown; §C.4). Reports exact per-bucket counts. | supabase | low |
| **P4** | Shared contract module (`prescriptionContract`, §C.7): typed schema + `validateMovementPrescriptions` + `resolveMovementPrescription` + `renderPrescriptionLine` + `resolveMovementCapability` + `parseWorkoutPaste`. Ported byte-for-byte to both repos + shared `prescriptionFixtures.json` + parity test in each. Pure, unit-tested first. | both | low |
| **P5** | forge-admin-web builder: movement row list + progressive disclosure + universal/M-F toggles + replacement/metric-change safety + publish validation. Dual-write `movement_prescriptions` **and** the legacy `movements_{v} text[]` + global cols (rendered from structure). | forge-admin-web | med |
| **P5′** | WOD-SIMPLE in-app Admin editor — same builder changes (cross-client parity). | WOD-SIMPLE | med |
| **P6** | Generate Variants on structured prescriptions. | both | low |
| **P7** | Quick Paste → structured rows + confidence/review UI. | both | med |
| **P8** | `sync_workout_engine_v2` mapper emits structured `prescription` into `workout_sections.movements`. | supabase | low |
| **P9** | WOD-SIMPLE member render + logger: `resolveMovementPrescription` per row; extend INC-04 `logCtx` with resolved prescription; write `prescription_snapshot` on save. | WOD-SIMPLE | **high** (logging identity — INC-04 territory) |
| **P10** | Journal + `isNotRxd` + forge-admin-web results read snapshot-first, live-fallback. | both | med |
| **P11** | Server validation (CHECK / trigger where safe on new column only) + RLS re-verify (no new policy expected) + tenant isolation test. | supabase | low |
| **P12** | Full automated matrix (mission TEST 1–33). | both | — |
| **P13** | Manual UX acceptance (mission Scenario A–L). | — | — |
| **P14** | Production verification + `app_version` bump + memory + report. | — | — |

---

## I. Owner Decision Points — RESOLVED (Phase 1–3 review, 2026-08-29)

| Decision | Resolution |
|---|---|
| **D-1 — Data model** | **Option B, APPROVED.** Additive `wods.movement_prescriptions jsonb`; `wods` stays authoring source of truth; legacy text + global cols + historical readers kept as controlled fallback; no destructive removal. |
| **D-2 — V2 relationship** | **NOT promoted.** V2 corrected as a one-way downstream mirror from authoritative `wods` prescription; mirror direction defined + tested; no second authoring model. |
| **D-3 — Historical immutability** | **APPROVED with stronger invariant.** `wod_logs.prescription_snapshot` + `skill_logs.prescription_snapshot`, written **from the frozen INC-04 `logCtx`** (never re-read from `wods` at submit); full identity+prescription invariant (§C.6); live-fallback for pre-migration logs; no invented snapshots. |
| **D-4 — Capability storage** | **Revised to one canonical representation:** `movements.allowed_prescription_metrics text[]` + `movements.default_prescription_metric text` (nullable, CHECK ⊆ allowed). No discrete booleans, no separate `optional_metrics[]`, no dual authority, no name conditionals (§C.4). |
| **D-5 — Backfill** | **NONE.** Confirmed. Legacy fallback stays. Future separately-reviewed classification (deterministic / ambiguous / manual) may follow; no guessing. |
| **D-6 — Units** | Store `value` + `unit` separately; **no automatic kg↔lb conversion in this initiative**; display as coach-authored; architecture stays future-capable. |

---

## Appendix — mission Final Report sections deferred to post-implementation

Sections C (final domain model as-built), D (migrations/rows modified), E
(backfill executed counts), F/G (Admin/Member UX before/after), H (quick paste
as-shipped), I (logging), J (immutability as-shipped), K (security tests), L
(test results), M (manual acceptance), N (UX friction / interaction count for the
mission's reference workout), O (deferred items), P (commits) will be completed
against the shipped implementation once §I is approved.
