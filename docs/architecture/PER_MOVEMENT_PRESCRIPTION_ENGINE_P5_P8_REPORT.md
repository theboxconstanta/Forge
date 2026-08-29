# Per-Movement Prescription Engine — P5–P8 Report

Date: 2026-08-29
Status: **P5–P8 SHIPPED. HARD STOP before P9. Awaiting owner review.**
Companion to `PER_MOVEMENT_PRESCRIPTION_ENGINE_AUDIT_AND_ARCHITECTURE.md`.

---

## A. PRE-P5 CLARIFICATIONS (resolved, doc §C.9)

### reps semantics — STRUCTURE, not a prescription characteristic

- The contract keeps **two distinct concepts distinct**:
  - **Movement quantity / target** = exactly one of `reps` \| `distance` \|
    `calories` per movement (or a `reps` `text` scheme). "How much of this
    movement." `reps` is almost always universal; `distance`/`calories` are
    commonly sex-specific for cardio (`15/12 Cal Row`).
  - **Intensity** = `load` (optional, orthogonal). "How heavy." The only true
    "prescription characteristic" in the load sense.
- The **workout scheme** (21-15-9, rounds, AMRAP/EMOM timing) stays **exclusively**
  in `wods.type` + `wods.format_config` — the engine does not touch it.
  `21-15-9 Thrusters` is authored as `reps:{mode:'text',text:'21-15-9'}` **or**
  with `reps` blank and the scheme in `format_config` — coach's choice.
- **The live schema is semantically correct — no correction, no migration.**
  `reps`/`load`/`distance`/`calories` are separate, unambiguous JSON keys.
- **Contract adjustment applied** (both repos, P4 follow-up commit):
  `validatePrescriptionsForPublish` now treats `reps` as structure — a **blank
  `reps` never blocks publish**; only a genuine sex_specific half-entry (one side
  typed, the other blank) is flagged. `load`/`distance`/`calories` keep full
  completeness checks. 3 new fixtures.

### Canonical vs legacy text authoring — "replace the textarea" ≠ remove fast text

| Question | Answer |
|---|---|
| Canonical for new/edited structured workouts | **`wods.movement_prescriptions` (JSON).** The only independently-editable semantic representation. |
| What Quick Paste produces | The `movement_prescriptions` structure (via `parseWorkoutPaste`). An input method into the canonical structure, never a parallel editable blob. |
| Legacy text retention | `wods.movements_{variant} text[]` + the 8 `{variant}_weight_{male,female}` columns are **DERIVED artifacts, regenerated from `instances` on every save** (`buildLegacyArtifactsForVariant`). Legacy readers keep working. |
| Display-text regeneration | Member/logger/Journal will render via `resolveMovementInstance` (P9). The `movements_{variant}` text[] is the gender-neutral rendered form for legacy readers only. |
| Two editable canonicals? | **No.** Once `movement_prescriptions.variants[v]` has content, `movements_{v}` is always regenerated on save and is never an edit target. Before it has content, `movements_{v}` is the only representation. No window where both are independently editable → no silent divergence. |
| Incomplete parse | Row created with raw text preserved in `name` + a **"Review"** flag; **no invented values**; coach fixes it before save. |
| Opening an OLD legacy-only workout | Builder **hydrates** editable rows from `movements_{variant}` via the shared parser. **Nothing persists until the coach saves.** Open-and-close ⇒ byte-untouched. Save ⇒ `movement_prescriptions` populated, legacy columns regenerated. Non-destructive forward migration, per workout, on explicit save only. |
| Scope | Primary **metcon** section's 4 variants only. `warmup`/`skill`/`skill2` keep current free-text editing. |

UX intent, delivered: **paste OR build → structured rows → edit visually → save.**

---

## B. P5 — ADMIN BUILDER (forge-admin-web)

### Components changed / added

| File | Change |
|---|---|
| `MovementRow.tsx` **(new)** | One movement instance. Capability-driven progressive disclosure. Header: ↑↓, movement-name input + autocomplete, duplicate, remove. Metric strip: quantity field (reps/distance/calories) with `Different M/F` / `Scheme` links; `Distance \| Calories` segmented chooser when the movement allows both; `Load ♂ [ ] ♀ [ ] [kg▾]` with `Same for all` / `remove` links, or a `+ Load` chip when load is allowed-but-not-default; `+ Add prescription` menu for unknown-capability movements. Amber "Review" banner for low-confidence pasted rows. |
| `MovementRowList.tsx` **(new)** | The row list for one variant. `+ Add movement`; `Paste workout` (parses into structured rows); reorder / duplicate / remove; tracks low-confidence review ids (cleared on name edit). |
| `ScalingVariantEditor.tsx` | Replaced the `MovementListField` + weight grid with `MovementRowList`. Note field unchanged. |
| `sectionEditing.ts` | `ScalingVariantEditState` gains canonical `instances: MovementInstance[]`. `hydrateInstancesFromLegacy()` (best-effort from legacy text + global weight; a line with an inline `@x/y` load makes the redundant global pair a no-op). `sectionsFromWodRow` hydrates instances (structured first, else legacy). `legacyPayloadFromSections` emits `movement_prescriptions` **and** regenerates `movements_{k}` + lossy `{k}_weight_{male,female}` from the structure. `validateSectionsForLegacy` gains `validatePrescriptionCompleteness`. |
| `types.ts` | `WodRow.movement_prescriptions?: MovementPrescriptions \| null` (optional at type level for pre-engine fixtures; DB is `NOT NULL DEFAULT`). |
| `movements/types.ts`, `movements/api.ts` | `MovementRow` + fetch columns gain `allowed_prescription_metrics` / `default_prescription_metric`. |
| `movementCatalogContext.ts`, `MovementCatalogProvider.tsx` | Catalog exposes `capabilityFor(name)` + `lookupForParse(name)` (case-insensitive, alias-aware, DB↔Dumbbell / KB↔Kettlebell expansions). |
| `scalingEngine.ts` | `generateVariantInstancesFromRx()` — structured variant generation (render → `scaleMovementLine` → re-parse; fresh `instanceId`s; deep-independent). |
| `VariantTabs.tsx` | Generate Variants + Regenerate-with-AI operate on `instances`. |
| `workoutIntelligence.ts`, `QuickCreateDialog.tsx` | Hydrate `instances` when building variant state from AI / template. |

### Coach interaction (reference workout: 20 Snatch / 20 Wall Ball / 20 DB Snatch / 15 Cal Row)

| Step | Interaction |
|---|---|
| Add Snatch | `+ Add movement` → type "Snatch" (autocomplete) → capability seeds a `Reps` field + `Load ♂/♀ kg`. Type `20`, `45`, `30`. |
| Wall Ball | `+ Add movement` → "Wall Ball" → **load only, no target-height field** → `20`, `9`, `6`. |
| DB Snatch | "DB Snatch" → resolves to "Dumbbell Snatch" capability → `20`, `22.5`, `15` (decimals accepted, `inputMode="decimal"`). |
| Row (calories) | "Row" → `Distance \| Calories` segmented control (no default — coach picks) → **Calories** → `♂/♀` (sex-specific default for calories) → `15`, `12`. |
| Universal Row (`500 m`) | pick **Distance** → one field `[500] m` (universal default) → `Different M/F` link reveals `♂/♀` only if the coach wants it. |
| Bodyweight (Burpee) | "Burpee" → `Reps` field only, no load/distance/calorie controls. |

**Keyboard flow:** Tab advances reps → movement → load ♂ → load ♀ → next control.
Enter in a name input selects the top suggestion. No modal for routine validation.

### Progressive disclosure

Driven entirely by `movements.allowed_prescription_metrics` /
`default_prescription_metric` — **no movement-name conditionals anywhere**.
Unknown-capability movements (59 catalog rows: benchmark-WOD names + time-only
holds) show `+ Add prescription` (Reps \| Load \| Distance \| Calories), default
nothing. DB terminology is never surfaced.

### Safety

- **Movement replacement** (Snatch 45/30 → Burpee): metrics the new movement
  can't carry are deleted from state → payload → persisted JSON. Tested.
- **Metric change** (Row Calories → Distance): the old `calories` key is removed,
  a fresh empty `distance` key created. No contamination. Tested.

### Validation

- **Draft/save gate** (`wods` has no draft state — every save is live):
  `load`/`distance`/`calories` a coach started must be complete (universal value,
  or **both** M/F). A blank `reps` never blocks (scheme may carry the count).
  Errors name the movement + the missing side: *"Snatch (rx): women's load is
  missing."*

---

## C. P5′ — WOD-SIMPLE EDITOR PARITY

**Semantic parity, not a component copy** (different UI architecture — App.jsx
inline, PWA-native styles).

| File | Change |
|---|---|
| `src/wodSections.js` | Data-layer **full parity** with `sectionEditing.ts`: `instances` in `emptySectionVariants`; `hydrateInstancesFromLegacy` (same rules); `sectionsFromLegacyWod` hydrates; `legacyPayloadFromSections` emits `movement_prescriptions` + regenerates artifacts; `validatePrescriptionCompleteness` save gate. Imports the **shared** `prescriptionContract.js`. |
| `src/App.jsx` | `MovementRowPWA` / `MovementRowListPWA` (new, inline-styled, same behaviour as `MovementRow`/`MovementRowList` incl. Review chips). `VariantEditorBody` now renders `MovementRowListPWA` instead of weight inputs + `SortableList` + `MiscareQuickAdd` + paste textarea (Note kept). `movementCatalog` gains `capabilityFor` + `lookupForParse`. `PrimarySectionBody` Generate Variants + Regenerate-with-AI use `generateVariantInstancesFromRx` / structured. `useTemplateWod` hydrates instances. |
| `src/movementsApi.js` | Fetch columns gain the 2 capability columns. |
| `src/scalingEngine.js` | `generateVariantInstancesFromRx` ported byte-for-byte. |
| `src/workoutIntelligence.js` | `buildVariants` hydrates `instances`. |

### Parity proof

- **Contract is physically shared** — `src/prescriptionContract.js` (WOD-SIMPLE)
  ↔ `src/features/programming/prescriptionContract.ts` (admin) are byte-for-byte
  ports; `prescriptionFixtures.json` is byte-identical in both.
- **Parity tests**: `prescriptionContract.parity.test.ts` (admin, 55 assertions
  over the shared fixtures) + `prescriptionContract.test.js` (WOD-SIMPLE, same
  fixtures) — identical output for resolve / validate / parse / snapshot /
  `movementObjectsForV2`.
- **Persistence-shape parity**: `wodSections.test.js` and `sectionEditing.test.ts`
  both assert `legacyPayloadFromSections` emits the same `movement_prescriptions`
  shape + the same regenerated `movements_{k}` / weight artifacts.

### Parity differences (deliberate)

- The **UI layout** differs (PWA inline styles / mobile-first vs. admin Tailwind).
  Same controls, same labels, same interactions.
- WOD-SIMPLE keeps its extra `duration` handling and its section-slot legacy
  mapping (`assignNonPrimarySlots` etc.) — untouched, pre-existing, out of scope.

---

## D. P6 — GENERATE VARIANTS

- `generateVariantInstancesFromRx(rxInstances, overrides, lookupCanonical)` — for
  each RX instance: render to a gender-neutral line → `scaleMovementLine` (the
  existing tested engine: substitution table + `TIER_RULES` load ratio + volume
  reduction) → re-parse to a **new** instance (fresh `instanceId`, re-resolved
  canonical id). `distance` / `calorie` / `rep-scheme` lines round-trip unchanged
  (scaling those is not standard; the coach adjusts after).
- Gym movements' `default_substitutions` still take precedence over the static
  `SCALING_SUBSTITUTIONS` table (`buildScalingOverrides`, unchanged).
- **Independence proof (tested, both repos):**
  - generated tiers share **no object references** with RX or each other
    (`structuredClone` on the fallback path; fresh instances on the main path);
  - editing `Intermediate` Snatch 35/25 never changes `RX` Snatch 45/30;
  - **repeated same canonical movement** (two Power Cleans at different loads)
    stays independent after generation — each keeps its own scaled load;
  - `new Set(all instanceIds).size === count` (no id collisions).
- Regenerate-with-AI: the AI still returns text lines; they are parsed back into
  independent structured instances via `parseWorkoutPaste`.

---

## E. P7 — QUICK PASTE

### Parse cases (shared fixtures + tests, both repos)

| Input | Result |
|---|---|
| `20 Snatches @ 45/30kg` | reps 20 (universal), load {sex_specific, 45, 30, kg}, name "Snatches" |
| `20 Snatches 45/30 kg` | same (`@` optional) |
| `20 DB Snatches @ 22.5/15kg` | load {22.5, 15, kg} (decimal) |
| `10 Power Clean @ 61,5kg` | load {universal, 61.5, kg} (comma decimal accepted) |
| `15/12 Cal Row` | name "Row", calories {sex_specific, 15, 12} |
| `500m Row` / `500 m Row` | name "Row", distance {universal, 500, m} |
| `20 Cal Row` | calories {universal, 20} |
| `400m Run` | name "Run", distance {universal, 400, m} |
| repeated same movement, different loads | each line → its own independent instance |

### Ambiguity behaviour

- **Confident** = catalog recognises the name OR a load/distance/calorie metric
  was extracted. Unadorned.
- **Not confident** (`3 RFT`, `some freeform text`) — the row is created with the
  **raw text preserved** in `name`, no metrics, and an amber **"Review"** banner
  until the coach edits it. **No invented values. No guessed second (female)
  value. A per-line load is never promoted to a global/variant weight.**
- `titleWord` no longer force-title-cases — the coach's own casing is preserved;
  a catalog match canonicalises the name instead.

### Round-trip

paste → structured rows → save → `movement_prescriptions` + regenerated
`movements_{k}` → reload → `sectionsFromWodRow` reads the structured prescription
first → same rows → edit → save. Covered by `sectionEditing.test.ts` /
`wodSections.test.js` regeneration tests + the parity fixtures.

---

## F. P8 — ENGINE V2 MIRROR

### Exact mapping

`movementObjectsForV2(instances)` (shared contract) maps a variant's structured
instances into the `workout_sections.movements` jsonb shape the V2 tables
**already declare** — `{ name, reps, weight, distance, calories, equipment,
canonicalName }` — enriched with `instanceId` + the full structured
`prescription: { reps, load, distance, calories }` object. **Gender-neutral**
(`weight: "45/30kg"`, `reps: "10"` / `"21-15-9"`) — member resolution stays at
read time (P9).

`workoutEngine.js` `legacyMetconSection` / `workoutMapping.ts`: when
`wod.movement_prescriptions.variants[k]` has movements → emit
`movementObjectsForV2`; **otherwise byte-identical legacy free-text fallback**.
Applied to the RX base (`section.movements`) and each `scalingVersion`.

### Direction is one-way — proof

- The mapper **reads** `wod.movement_prescriptions`; it **never writes** it.
- `sync_workout_engine_v2` (the sole writer of `workout_sections`) takes the
  mapper's output as `p_sections` and upserts V2. Nothing in the V2 read path
  writes back to `wods`.
- No new RPC, no signature change — the mirror rides the existing
  `syncWorkoutEngineV2FromLegacyWod` dual-write already fired after every `wods`
  save.

### Legacy identity preserved

- `workouts.legacy_wod_id` is passed straight through (`p_legacy_wod_id = wod.id`)
  — **unchanged**. No date reconstruction anywhere. The INC-03
  `workouts_enforce_legacy_date_sync` trigger and `workouts_gym_id_date_key` are
  untouched.

### Tests

`workoutMapping.test.ts` (admin) + `workoutEngine.test.js` (WOD-SIMPLE):
one weighted movement; multiple weighted movements; repeated same canonical
movement with different prescriptions; Row calories; Row distance; universal
target; sex-specific target; RX + scaled variants; legacy-only workout (no
structured prescription → exact free-text fallback).

---

## G. TESTS

| Repo | Before P5 | After P5–P8 | Added (net) |
|---|---|---|---|
| forge-admin-web | 1142 | **1164** | +22 |
| WOD-SIMPLE | 942 (P4) / 928 (P0) | **1015** | +73 since P0; +6 since P4 baseline shift* |

*(WOD-SIMPLE count is 1015 passing + 9 pre-existing Deno-only file-load failures,
unchanged.)*

Key new tests: `MovementRow.test.tsx` (7 — progressive disclosure, replacement
safety, metric-change safety, universal↔M/F, unknown-capability, scheme mode);
`ScalingVariantEditor.test.tsx` (rewritten, 4); `VariantTabs.test.tsx` (rewritten,
7 — structured generation, deep independence, repeated-movement independence,
AI-parse-back, error handling); `sectionEditing.test.ts` (+6 — hydration, global-
weight no-op on inline load, regeneration, publish gate); `scalingEngine.test.ts`
(+3 each repo — structured generation + independence); `wodSections.test.js` (+4
parity); `workoutMapping.test.ts` (+2 — structured mirror + fallback);
`prescriptionContract` (both repos — `movementObjectsForV2`, reps-as-structure
publish fixtures).

Build (`vite build` / `vite build`), `tsc -b`, ESLint: **PASS, 0 errors** both
repos (11 pre-existing `Unused eslint-disable` warnings in App.jsx, unrelated).

---

## H. PRODUCTION DATA

**Zero rows modified.** Verified live 2026-08-29:

| Metric | Value |
|---|---|
| `wods` total | 51 |
| `wods` with a non-empty `movement_prescriptions` | **0** |
| `wod_logs` with `prescription_snapshot` | **0** |
| `workout_sections` with a `prescription` object | **0** |
| `movements` (platform) with seeded capability | 406 / 465 (59 explicit-unknown) |

The engine is **deployed but dormant** — it activates only when a coach edits a
workout with the new builder. The only production write in P3–P8 was the P3b
capability seed on `movements` platform rows (`gym_id IS NULL`, reversible,
reported in the P3b commit).

**`app_version.current`** bumped to `prescription-engine-p3-p8-20260829`.

---

## I. MIGRATIONS

| File | Purpose | Reversible |
|---|---|---|
| `20260829090000_movement_prescription_engine_foundation.sql` | `wods.movement_prescriptions`; `wod_logs`/`skill_logs.prescription_snapshot`; `movements` capability columns + CHECKs; `validate_movement_prescriptions()` trigger. Additive. | Yes — DOWN block in the file; drops restore prior schema exactly. |
| `20260829090500_movement_prescription_capability_seed.sql` | Deterministic platform-movement capability seed. No workout/log data. | Yes — single `UPDATE … SET allowed = '{}', default = NULL WHERE gym_id IS NULL`. |

No further migration in P4–P8 (all app-layer).

---

## J. COMMITS

| Repo | Commit | Phase |
|---|---|---|
| WOD-SIMPLE | `5c45385` | audit doc |
| WOD-SIMPLE | *(decisions-lock)* | Phase 1–3 review decisions |
| WOD-SIMPLE | `20260829090000` migration | P3a (applied live) |
| WOD-SIMPLE | `20260829090500` migration | P3b (applied live) |
| WOD-SIMPLE | *(P4)* + admin *(P4 port)* | P4 shared contract |
| WOD-SIMPLE + admin | *(pre-P5 clarifications + reps-publish fix)* | P4 follow-up |
| forge-admin-web | *(P5+P6)* | P5 admin builder + P6 |
| WOD-SIMPLE + admin | *(P8)* | V2 mirror |
| forge-admin-web | *(P7)* | Review chips + hydration fix |
| WOD-SIMPLE | *(P5′+P7)* | editor parity + review chips |

*(Exact hashes are in each repo's `git log`; every commit message ends with the
session link.)*

---

## K. OPEN ISSUES (real defects only)

1. **Interim member experience for prescription-authored workouts (until P9).**
   Once a coach edits a workout with the new builder and saves, the member render
   (unchanged, P9) reads the **regenerated** `movements_{variant}` text (now
   carrying inline `@ x/y kg` per movement — an improvement) **plus** the
   variant-level global weight badge resolved from the lossy first-load
   `{variant}_weight_{male,female}` mirror. Result: a workout with multiple
   different weighted movements shows correct per-movement loads inline but a
   possibly-redundant / first-movement-only variant weight badge, and the inline
   loads are gender-neutral (`45/30`) rather than resolved to the member's sex.
   **This is the exact gap P9 closes** (`resolveMovementInstance` per movement in
   the member renderer). No workout is currently affected (0 structured in prod).
   **Owner decision point:** accept the interim state for coach-edited workouts,
   or hold the coach builder behind a flag until P9 ships.

2. **`generateVariantInstancesFromRx` round-trips through text.** It renders each
   instance to a line, scales via `scaleMovementLine`, and re-parses. A
   structured nuance not expressible in a text line (e.g. an explicitly
   *universal* load on a movement the parser would read as sex-specific `x/y`) is
   flattened on generation. Acceptable for a starting point the coach reviews and
   edits; a fully structured scaler is a possible future refinement, not a
   blocker. Disclosed, not hidden.

3. **Legacy-workout hydration is best-effort.** Non-movement lines in
   `movements_{variant}` (`"7 rounds for time of:"`, `"Rest 2:00"`) hydrate as
   name-only instances and round-trip back as that text. No data loss, but such a
   line now occupies a "movement row" in the editor. The coach can delete it. The
   scheme itself is unaffected (`format_config` untouched).

4. **`flushSectionsForSave` (WOD-SIMPLE) is now a no-op.** The old per-variant
   `paste` textarea it drained no longer exists (the row list has its own
   immediate paste). Left in place (harmless); a small cleanup for a later pass.

No P5–P8 defect is deferred as "future work" — items 2–4 are disclosed design
trade-offs; item 1 is the deliberate P9 boundary requiring an owner decision.

---

## HARD STOP

**P9 NOT STARTED.** P9 touches member prescription resolution, the frozen INC-04
`logCtx`, logger identity, `prescription_snapshot` writes, and historical
semantic immutability. Awaiting explicit owner review of P5–P8.
