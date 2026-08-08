# Forge — Unified Workout Builder: Extraction & Web Integration Plan

**Status:** Draft, for senior engineering review
**Prepared:** 2026-08-08
**Method:** Both the WOD-SIMPLE (PWA) workout builder and forge-admin-web's Programming module were audited directly, file-by-file, line-by-line — not assumed. Findings below cite exact files and line ranges.

---

## Premise correction (read before anything else)

The mission that produced this document states: *"a mature Workout Builder in the PWA; a different / less capable workout editing experience in the web app... the web app should adopt the PWA builder, not recreate it."* Direct audit of both codebases does not support this framing, and proceeding as if it were true would produce a plan that discards real, working capability the web app already has. The corrected picture:

**Both builders are siblings of the same original design, not a mature original and a weak copy.** They target the *same* underlying table (`wods`, legacy free-text columns), enforce the *literal same validation rule* (exactly one primary section, at most three non-primary), model Scaling tiers in the *same flat shape* (an ordered movement list + a male/female weight-text pair + one note, no per-movement override in either), and — most tellingly — declare the *same 22-format catalog*. This is not a coincidence: forge-admin-web's `formatCatalog.ts` and `sectionEditing.ts` are themselves already a disciplined **port** of the PWA's `workoutFormats.js` and `wodSections.js`, performed during Programming Phase 2 of this platform's own build history. The two codebases have since diverged, but from a shared starting point, and each diverged in a genuinely different direction:

| Capability | PWA | forge-admin-web | Which is ahead |
|---|---|---|---|
| Movement autocomplete (search-as-you-type) | Yes — `MISCARI` catalog + `miscareSugestii()` + shared `MovementSuggestions` dropdown (`src/movements.js`, `src/components.jsx`) | **No** — explicitly, deliberately dropped (`FormatConfigEditor.tsx:13-21`, comment discloses the omission) | **PWA** |
| AI paste-to-draft | Yes — `analyzeWorkout()` → Edge Function `analyze-workout` → `workoutIntelligence.js` review flags | **No** — explicitly not ported (`mutations.ts:77-82`) | **PWA** |
| Duplicate/clone to another date | **No** — no such entry point exists anywhere in `Admin` | Yes — `DuplicateWorkoutDialog.tsx`, single-date multi-select *and* whole-week copy, with overwrite protection | **forge-admin-web** |
| Accessible modal (focus-trap, Escape, `aria-modal`, focus restoration) | Ad hoc per-dialog, less consistent | Yes — centralized in `Dialog.tsx:24-56`, reused by every editor dialog | **forge-admin-web** |
| Unsaved-changes guard | Not found in the audited builder | Yes — dirty-tracking + `beforeunload` + in-app discard confirmation (`EditWorkoutDialog.tsx`) | **forge-admin-web** |
| Type safety | No (plain JSX) | Yes (TypeScript throughout) | **forge-admin-web** |
| Movement-list reordering within a tier | Touch-only (`SortableList`, raw `touchstart`/`touchmove`/`touchend`, App.jsx L4445–4490) — **does not work with a mouse on desktop**, a real, undisclosed bug | Up/down buttons only (works on any device, no true drag-and-drop) | Neither — PWA's is broken on desktop; forge-admin-web's is merely less fluid |
| Section-level reordering | Up/down buttons | Up/down buttons | Tied — **neither app has real drag-and-drop; no drag library is installed in either repo** |
| Draft vs. Published state | None — direct-to-live save | None — direct-to-live save | Tied (both lack this) |
| Coach Notes / Athlete Notes split | None — one note per scaling tier | None — one note per scaling tier | Tied (both lack this) |
| Media attachment | None | None | Tied (both lack this) |
| Per-movement Load/Rep/Substitution override within a tier | None (flat tier: shared weight pair, movement list, note) | None (identical flat shape) | Tied (both lack this — **neither builder implements what `PROGRAMMING_DOMAIN_V1_2.md`'s LoadProfile/ScalingProfile model requires**) |
| Movement canonical identity (`canonicalName`) | Always `null` | Always `null` | Tied (both lack this) |
| Data model written | `wods` (legacy) + best-effort fire-and-forget RPC sync to Workout Engine V2 | Identical: `wods` (legacy) + the same fire-and-forget RPC sync | Tied — **literally the same mechanism** |
| Test coverage | Good — six pure modules each with their own test file | Good — twelve files, ~118 test cases total | Roughly comparable, forge-admin-web's is more granularly counted |

**What this means for the rest of this document:** "extract the PWA builder and make the web app adopt it" is not the correct instruction to execute literally — it would mean shipping web app regressions (losing Duplicate, losing the accessible dialog, losing the unsaved-changes guard) in exchange for gains (autocomplete, AI-paste) that are real but narrower than "the whole builder." The architecturally correct action, which still satisfies the mission's actual governing principle — **one builder, no duplicated workout logic, Programming Domain remains authoritative** — is to extract the *shared, already-converged domain core* (which is larger and more mature than either individual UI layer) into one disciplined, ported source of truth, and to port the two genuinely PWA-superior UX capabilities (autocomplete, AI-paste) into that shared core so both platforms gain them, rather than discarding forge-admin-web's own, real advantages to force a literal PWA-to-web copy. This is stated here, prominently, rather than silently substituted for the mission's literal instruction, because a plan built on the stated premise would be reviewed and rejected the moment a reviewer opened forge-admin-web's `DuplicateWorkoutDialog.tsx`.

---

## 1. Current PWA Builder Audit

Scope audited: `src/App.jsx` (`Admin` L2194–4437; `SectionCard` L1003–1089; `PrimarySectionBody` L867–964; `AddSectionControl` L1094–1111; `SortableList` L4438–4559; `CautareMiscare`/`MiscareQuickAdd` L704–843), `src/wodSections.js`, `src/workoutComposer.js`, `src/workoutFormats.js`, `src/FormatConfigEditor.jsx`, `src/workoutIntelligence.js`, `src/movements.js`, `src/ComposedWorkoutView.jsx`.

### 1.1 Workout creation
`dataWod` (a date input) drives everything. On mount/date-change, an existing WOD for that date silently loads (`syncWodFormFromRow`); otherwise the form starts from `DEFAULT_NEW_WOD_SECTIONS()` (warmup + skill + metcon, `wodSections.js` L81–85). Two entry points: blank/default, or **AI paste-to-draft** — a "Paste your workout" textarea calls `analyzeWorkout()` (App.jsx L3037–3070), which POSTs to Edge Function `analyze-workout` and maps the response via `sectionsFromAiAnalysis`/`deriveReviewFlags` (`workoutIntelligence.js`). **No duplicate/clone-from-prior-day exists.**

### 1.2 Section editing
Add/remove via `addSection`/`removeSection` (App.jsx L2984, L2994). Reordering is **up/down buttons only** (`moveSection`, L2985–2992) — no drag-and-drop at the section level.

### 1.3 Movement editing
`MISCARI` (`movements.js`) is a static, hardcoded movement-name array. `miscareSugestii(text)` (movements.js L91–95) does substring filtering on the last typed word, rendered by the shared `MovementSuggestions` dropdown (`components.jsx` L31–41), reused across three call sites (`CautareMiscare`, `MiscareQuickAdd`, `FormatConfigEditor`'s list fields). Free text is always accepted; `looksLikeMovementLine()` softly blocks obviously-structural text from being committed as a movement line. Bulk paste is supported (`parseMiscareLinePasta`).

### 1.4 Sets/reps
Movement lines are free-text strings (`"21 Thrusters @ 43kg"`), composed via `MiscareQuickAdd` (name + reps + weight/distance/cal inputs) or typed/pasted directly. Format-level structure (rounds, rep schemes, sets targets) is genuinely structured — see 1.6.

### 1.5 Time caps
Explicit. `timeCapSec` is a `duration`-type config field on For Time, RFT, Chipper, and Ladder in `WORKOUT_FORMATS`. AMRAP/EMOM/Tabata use their own `durationSec`/interval fields instead of a separate cap concept.

### 1.6 AMRAP / EMOM / For Time / Rounds and the full format catalog
22 formats total, all rendered by one generic, data-driven `FormatConfigEditor` (no per-format hardcoded branches — it iterates each format's declared `config` map and dispatches by field type): AMRAP, Ascending AMRAP, For Time, RFT, Chipper, Ladder, Partner WOD, Death By, Death By Weight, EMOM, Tabata, Intervals, Weightlifting, Strength Sets, Build to Heavy/1RM, Complex, Superset, Buy-In/Cash-Out, AMRAP with Buy-In, Not For Time, Chained AMRAP, Max Effort.

### 1.7 Notes
One note field per scaling variant (`sv.note`), labeled generically "Notes." No Coach Note / Athlete Note split anywhere in `wodSections.js` or `App.jsx`.

### 1.8 Media
None. No image/video/attachment field exists in the section/variant data model.

### 1.9 Save Draft / Publish
Does not exist. `saveWod()` (App.jsx L3079–3115) performs a direct Supabase `upsert`/`update` on `wods` — every save is immediately live. The only save gate is structural validation (1.11), not a draft state.

### 1.10 Duplicate
Not present. The WOD list offers only edit and delete.

### 1.11 Validation
`validateSectionsForLegacy` (`wodSections.js` L211–218): exactly one primary section, at most three non-primary sections — a hard, save-blocking gate. No format-specific required-field enforcement blocks manual save (a separate, non-blocking `missingRequiredConfigFields` exists only to drive AI review-flag hints).

### 1.12 Keyboard behavior
Several inputs (`MiscareQuickAdd`, `MovementListField`, `RepsSchemeListField`, `SortableList`'s inline edit) commit on Enter. No other shortcuts, no explicit tab-order management, no global keyboard handling.

### 1.13 Mobile-specific behavior
`SortableList` (movement reordering **within** a scaling tier, not section reordering) uses raw `touchstart`/`touchmove`/`touchend` only, with no mouse-event fallback — **this does not work by drag on a mouse-only desktop**, a real, currently-undisclosed limitation this audit surfaces for the first time. Section-level reordering uses ordinary click handlers and works on any device.

### 1.14 Reusable components already extracted
`workoutFormats.js`, `wodSections.js`, `workoutComposer.js`, `FormatConfigEditor.jsx`, `workoutIntelligence.js`, and `ComposedWorkoutView.jsx` are **already** independent, pure(ish), individually-tested modules — not entangled in `App.jsx`. `MovementSuggestions` (`components.jsx`) is already a shared, deduplicated component. `movements.js` is a standalone catalog + parsing-helper module. Still inline inside `App.jsx`, and would require real extraction work: `Admin` itself (2,243 lines, mixing the WOD editor with unrelated Members/Classes/Plans/Settings/Platform tabs in one component), plus `SectionCard`, `PrimarySectionBody`, `AddSectionControl`, `CautareMiscare`, `MiscareQuickAdd`, `SortableList`, `ReviewFlagsList`, `ComposedWorkoutPreview` — module-scope functions coupled to `Admin`'s local state via closures rather than isolated props contracts.

### 1.15 Explicit status in the code
Not marked "frozen" or "closed" anywhere. It is instead documented as **actively mid-migration**: `wodSections.js` (L93–111) discloses a known, deliberately-unfixed data-loss risk around non-primary section types on re-edit; `wodSections.js` (L206–210) documents the "no partial publish" validation gate as provisional, pending a new Member View; `workoutComposer.js`'s own header states its React renderer is "not built yet," citing `WORKOUT_COMPOSER_SPEC_v1.md §8` — its output today only feeds an admin-side preview (`ComposedWorkoutPreview`), not the real Member/Logging render path.

---

## 2. Shared Builder Architecture

Given §Premise Correction, "shared" is defined as: the domain logic both platforms already substantially agree on, converged into one disciplined source, plus the two genuinely-missing capabilities (autocomplete, AI-paste) added to that shared source so both platforms gain them.

### 2.1 What becomes shared (platform-agnostic, framework-adjacent-only)

| Shared unit | PWA origin | forge-admin-web origin | Nature |
|---|---|---|---|
| **Format catalog** | `workoutFormats.js` | `formatCatalog.ts` | Pure data — already near-identical; reconcile to one canonical list |
| **Section editing / validation** | `wodSections.js` | `sectionEditing.ts` | Pure functions — `createSection`, `sectionsFromWodRow`/`syncWodFormFromRow`, `legacyPayloadFromSections`, `validateSectionsForLegacy` |
| **Duplicate/clone logic** | *(does not exist)* | `duplicateWorkout.ts` | Pure functions — `buildDuplicateRows`, `planWeekCopyRows`, `resolveTargetDateOptions` — ported **into** the PWA, not out of it |
| **Movement catalog + resolution** | `movements.js` | *(does not exist)* | Static catalog + `miscareSugestii`/`parseMiscareLinePasta`/`looksLikeMovementLine` — ported **into** forge-admin-web |
| **AI-draft mapping** | `workoutIntelligence.js` | *(does not exist)* | Pure mapping/review-flag functions — ported **into** forge-admin-web, Edge Function call stays platform-specific |
| **Movement selector (autocomplete UI)** | `MovementSuggestions` (`components.jsx`) | *(does not exist)* | Presentational, props-only — portable as-is in shape, reimplemented in TSX for forge-admin-web |
| **Section/format config editor (presentation)** | `FormatConfigEditor.jsx` | `FormatConfigEditor.tsx` | Already provably shared in *shape* (same field-type dispatch model) — reconcile field-type list, keep two files (one per language), test-mirrored |
| **Load/Weight editor** | Inline in `PrimarySectionBody`/`MiscareQuickAdd` | Inline in `ScalingVariantEditor.tsx` | Not currently isolated in either app — new extraction target (§3), scoped narrowly since today's model is flat (male/female text pair) |
| **Scaling editor (data shape)** | 4-tier `VARIANT_LEVELS` shape (`wodSections.js`) | `ScalingVariantEditState` (`sectionEditing.ts`) | Already structurally identical — reconcile field names only |
| **Preview renderer** | `ComposedWorkoutView.jsx` | *(does not exist as a distinct concept)* | Ported **into** forge-admin-web if a preview surface is wanted there |

### 2.2 What remains platform-specific

- **Dialog/modal chrome.** forge-admin-web's `Dialog.tsx` (focus-trap, Escape, `aria-modal`, focus restoration) is strictly better than the PWA's ad hoc per-dialog pattern. Recommendation: port `Dialog.tsx`'s *behavior* into the PWA's own `BottomSheet`/`Modal` (already established shared components in `components.jsx`, per this session's own prior work) rather than the reverse — the PWA already has a real focus-trap pattern in `Modal`/`BottomSheet` (confirmed elsewhere in this codebase this session); this needs a targeted comparison, not a blind port, and is scoped as its own milestone item (§7).
- **Routing and screen composition.** The PWA's `screen === 'admin'` single-page-state model vs. forge-admin-web's React Router `WorkoutDayPage.tsx` (`useParams`, `Link`) are fundamentally different navigation architectures and are not unified by this plan — each platform keeps its own routing shell around the shared editor components.
- **Data fetching / realtime.** The PWA's `useEffect`-driven fetches vs. forge-admin-web's `useRealtimeSync` + `reloadToken` pattern both ultimately call the same Supabase tables; the fetch/mutation *call sites* stay platform-specific, while the *payload-building* logic (`legacyPayloadFromSections`) is shared.
- **Styling.** The PWA uses inline `style={{}}` objects with the `TYPO` token module (this session's own recent typography work); forge-admin-web uses Tailwind + `editorStyles.ts` shared class strings. No unification of styling approach is proposed — component *behavior* and *data contracts* are shared; visual presentation is not, and should not be forced to match pixel-for-pixel across a native-feeling PWA and a desktop-oriented admin web app.
- **State management primitives.** Both already use plain `useState`/`useEffect` with no external state library — this is a genuine point of alignment requiring no change, not a divergence to reconcile.

### 2.3 Validation, serialization

Both already converge on one validation function (`validateSectionsForLegacy`, ported once, mirrored twice, per this platform's own established pattern — see §3.1) and one serialization function (`legacyPayloadFromSections`, same discipline). This is the least risky part of the entire unification, since the two implementations are already provably behaviorally identical (same rule, same limits) — the work here is de-duplicating text, not reconciling logic.

---

## 3. Extraction Strategy

### 3.1 The governing constraint this strategy must respect: there is no shared package today

WOD-SIMPLE and forge-admin-web are two separate repositories on disk (`C:\Users\Luci\Desktop\WOD-SIMPLE`, `C:\Users\Luci\Desktop\forge-admin-web`), not a monorepo, with no npm workspace, no private package registry, and no git-submodule relationship between them. Every prior instance of "shared logic" between these two codebases on this platform — `rxEngine.js`/`rxEngine.ts`, `benchmarkResolution.ts`, `workoutMapping.ts`/`workoutEngine.js`, and `sectionEditing.ts`/`formatCatalog.ts`/`wodSections.js`/`workoutFormats.js` themselves — was achieved by **disciplined, reviewed porting with a diff-comparison step**, never by a real cross-repo import. This document adopts that same, already-proven pattern rather than introducing new cross-repo package infrastructure (npm link, a private registry, or a monorepo migration) as a prerequisite — introducing that infrastructure is a legitimate future option (named, not designed, at the end of this section) but is a materially larger, separately-scoped decision this extraction does not require and should not be blocked on.

### 3.2 Step-by-step

1. **Freeze the target format catalog.** Diff `workoutFormats.js`'s `WORKOUT_FORMATS` against `formatCatalog.ts`'s equivalent field-by-field. Resolve any drift (expected to be minor, given the shared origin) into one canonical 22-format definition, expressed once per language. Regression risk: low — this is comparison, not new logic.
2. **Isolate and reconcile section-editing/validation logic.** Diff `wodSections.js` against `sectionEditing.ts` the same way. `validateSectionsForLegacy` should become byte-for-byte identical in rule (already is) and near-identical in implementation shape across both languages.
3. **Port `duplicateWorkout.ts` into the PWA.** New capability for the PWA — this is pure, already-tested logic (11 tests in forge-admin-web) with no Supabase dependency in its core functions; port the pure functions first, wire PWA-specific UI (a new dialog, reusing `BottomSheet`) second.
4. **Port `movements.js` + `MovementSuggestions` into forge-admin-web.** New capability for forge-admin-web — port the static catalog and the substring-matching function as TypeScript, and build a TSX equivalent of `MovementSuggestions` (a small, presentational dropdown — low risk to reimplement rather than force literal-copy given the JSX→TSX boundary).
5. **Port `workoutIntelligence.js` (AI-draft mapping) into forge-admin-web**, if and when the AI-paste feature is prioritized for web — this can be deferred independently of the rest of this plan (§7 milestones), since it depends on an Edge Function call the web app does not currently make and is the single highest-effort, most optional item in this list.
6. **Extract `Admin`'s WOD-editing responsibility out of its current 2,243-line, multi-tab component in `App.jsx`** into its own file/module boundary (`AdminWodBuilder.jsx` or similar), separable from the Members/Classes/Plans/Settings/Platform tabs it currently shares a component with. This is **pure internal refactor, zero behavior change**, and should land *before* any cross-repo porting work touches this code, so the porting diffs are clean.
7. **Fix the `SortableList` desktop-mouse bug** (§1.13) as an isolated PWA-only patch — add `onMouseDown`/`onMouseMove`/`onMouseUp` handlers alongside the existing touch handlers, or adopt forge-admin-web's simpler up/down-button pattern for this specific list if a full drag implementation is not prioritized. This is unrelated to cross-repo unification and should not block it, but is named here because it was discovered during this same audit and should not be lost.
8. **Reconcile the Scaling tier data shape** (`VARIANT_LEVELS` vs. `ScalingVariantEditState`) into one canonical shape, field names aligned, ported both directions where needed.
9. **Only after 1–8 are stable**, evaluate whether recurring drift between the two ported copies justifies real package infrastructure (a private npm package, or a monorepo consolidation) — named as a future decision point (§6, §7), not a precondition.

This ordering minimizes regression risk by doing the **lowest-risk, purely-comparative work first** (catalog/validation diffing), the **purely additive work second** (porting a capability one platform already lacks, with no existing behavior to break), and the **higher-risk internal refactor** (extracting `Admin` from `App.jsx`) as a separately-landable, behavior-preserving step before any cross-repo diffing has to account for a moved-but-unchanged file.

---

## 4. Web Integration Plan

Given §Premise Correction, "web integration" is reframed from "replace forge-admin-web's builder with the PWA's" to "land the two ported PWA-origin capabilities into forge-admin-web's existing, working builder, without disturbing what forge-admin-web already does correctly."

### 4.1 Routing changes
None required. `WorkoutDayPage.tsx`'s existing route and its `EditWorkoutDialog`/`DuplicateWorkoutDialog` entry points are unchanged in shape — new capability (movement autocomplete, AI-paste) is added *inside* the existing dialogs, not via new routes or new top-level screens.

### 4.2 Screen replacements
None. `EditWorkoutDialog.tsx` and `SectionEditor.tsx` are extended in place — the movement-entry `<textarea>`/`MovementListField` gains autocomplete behavior (consuming the ported `movements.js` + a new `MovementSuggestions.tsx`), it is not replaced with a different component.

### 4.3 Component replacement strategy
Additive, not destructive: `FormatConfigEditor.tsx`'s existing 10 field-type dispatch is extended with the reconciled catalog from §3.2 step 1; no existing field type is removed or restructured. `Dialog.tsx` is retained unmodified — it is not being replaced by anything PWA-originated, since it is already the stronger of the two implementations (§Premise Correction table).

### 4.4 Migration order
1. Movement catalog + autocomplete (§3.2 step 4) — highest user-visible value, lowest regression risk (purely additive UI, no existing behavior changed).
2. Format catalog / section-editing reconciliation (§3.2 steps 1–2) — invisible to users, removes future-drift risk.
3. AI-paste-to-draft (§3.2 step 5) — deferred, optional, largest effort, requires an Edge Function integration decision forge-admin-web has not made before.

### 4.5 Compatibility layer
Not needed in the traditional sense (no old-format-to-new-format data migration) — both apps already read/write the identical `wods` schema. The only "compatibility" concern is making sure the reconciled format catalog (§3.2 step 1) does not silently rename a `formatId` either app already has persisted in `wods.format_config` JSON for existing rows; the diff step must treat existing persisted `formatId` values as a hard compatibility constraint, not merely a naming preference.

### 4.6 Feature parity verification
A single, shared parity checklist (derived directly from §Premise Correction's comparison table) run against both apps after each migration-order step: every format renders identically, `validateSectionsForLegacy` rejects the same inputs identically, Duplicate (once ported) produces identical target-date behavior in both apps, autocomplete (once ported) suggests identically from the same catalog. This checklist is the acceptance criterion for each milestone in §7, not a separate, later QA pass.

---

## 5. Programming Domain Alignment

### 5.1 Current state: neither builder is the Programming Domain's UI yet

`PROGRAMMING_DOMAIN_V1_2.md` defines Workout, WorkoutVersion, Movement (with canonical identity), Load Profile, and Scaling Profile as the domain's entities. Today, **both** audited builders write to the legacy `wods` table's free-text columns, with only a best-effort, non-authoritative, fire-and-forget sync into the structured Workout Engine V2 tables (`workouts`/`workout_sections`) via the same RPC (`sync_workout_engine_v2`) in both apps. Neither builder edits `WorkoutVersion`, `LoadProfile`, or `ScalingProfile` as such — those entities do not exist in the live schema yet; they are proposed, not built (`PROGRAMMING_DOMAIN_V1_2.md` is itself a draft, not frozen). `canonicalName` is `null` in every Movement reference in both apps today.

### 5.2 What this means for "the builder must become the UI for the Programming Domain"

This is a **future-state goal**, not a current-state fact this document can verify, and stating it as already true would misrepresent the codebase. What this plan can honestly commit to: the unification work in §2–§4 does not move the builder *away* from Programming Domain alignment — it consolidates two independently-diverging implementations of the *same* legacy-schema-targeting builder into one, which is a strict precondition for the eventual cut-over to WorkoutVersion/LoadProfile/ScalingProfile (§6), since cutting over *two* independently-diverged builders would double that future migration's cost and risk.

### 5.3 Alignment table

| Programming Domain entity | Current builder behavior | Alignment status |
|---|---|---|
| **Workout** | Both write `(gym_id, date)`-keyed `wods` rows | Aligned in spirit (identity concept matches); not literally the same table `PROGRAMMING_DOMAIN_V1_2.md` describes |
| **Section** | Both model ordered sections with a format | Aligned in shape |
| **Movement** | Both store free-text movement lines; `canonicalName` always `null` in both | **Not aligned** — resolution mechanism (`PROGRAMMING_DOMAIN_V1_2.md` §5) does not exist in either builder today |
| **Metadata** | Neither builder has an explicit Metadata concept distinct from format/notes | **Not aligned** — no gap-closing work proposed by this document; named as future scope |
| **Scaling** | Both model 4 tiers, flat (no per-movement override) | Partially aligned — the *tier concept* matches; the *structured Scaling Profile* (`PROGRAMMING_DOMAIN_V1_2.md` §7, per-movement overrides) does not exist in either builder |
| **LoadProfile (future)** | Neither builder has anything beyond a shared male/female weight-text pair per tier | **Not aligned** — this is real, not-yet-started work in either codebase |
| **ScalingProfile (future)** | See Scaling row | **Not aligned**, same gap |

---

## 6. Future Compatibility

This section demonstrates that the unified builder does not architecturally block the six named future capabilities — not that it already implements them.

- **WorkoutVersion.** The unified builder's serialization boundary (`legacyPayloadFromSections`, shared per §2.3) is already a single, well-defined function per language producing one payload shape. Introducing WorkoutVersion later means that function's *caller* (the save/mutation layer, `mutations.ts`/`saveWod()`) starts creating an immutable version row alongside the `wods` write, rather than the payload-building logic itself needing to change — the unification specifically keeps this boundary clean enough to absorb that change once, in one place per platform, instead of twice with independent drift risk.
- **Variant Generation Engine.** A future generation engine's output (a proposed Scaling Profile) needs a coach-review-and-accept UI. The unified builder's existing Scaling tier editor (§2.1, already structurally shared) is the natural host for that review UI — this document does not build it, but confirms the extraction leaves a single, shared editor component to extend rather than two.
- **Load Profiles.** Requires the currently-flat weight-text-pair field to become a structured `{dimension, prescriptionType, maleValue, femaleValue, unit, formulaReference?}` object. Because this field is *not yet* isolated as its own component in either app (§2.1, "Load/Weight editor" row, marked "new extraction target"), this plan explicitly recommends extracting it into its own shared component **as part of** this unification (§7 milestone), specifically so the eventual Load Profile migration has one component to upgrade, not two independently-shaped inline fields.
- **Scaling Profiles.** Same reasoning as Load Profiles, applied to the tier-movement-list shape.
- **Deterministic rendering.** Out of this document's scope (a Results/Programming rendering-pipeline concern, `VARIANT_GENERATION_ENGINE.md`), and unaffected either way by builder unification — the builder produces authored content; it does not render it for athletes.
- **AI Workout Parser / AI scaling suggestions.** The AI-paste-to-draft capability (§3.2 step 5) is the direct, existing precedent for this — porting it to forge-admin-web now means both platforms already have one working AI-assisted-authoring pattern to extend toward AI scaling suggestions later, rather than the web app needing to build its first AI-authoring integration from zero when that future work begins.
- **Benchmark workflows.** Both builders already support asserting Benchmark-adjacent identity today (confirmed elsewhere in this platform's own shipped work — Results Phase 2 Slice 1's Benchmark resolution); this unification does not touch that mechanism and does not need to.
- **Competition workouts.** Blocked on format composition/nesting (`PROGRAMMING_DOMAIN_V1_2.md` §13, open question 2), which is out of this document's scope entirely — named here only to confirm the unified builder does not make that future work harder, since the format catalog (§2.1) is already the correct extension point for it regardless of which builder consumes it.
- **Future structural workout model.** The single biggest risk this plan actively manages *for* future compatibility is §3.1's own governing constraint: keeping two independently-drifting copies of the same domain logic is what makes a future structural change expensive (two places to migrate, possibly inconsistently). Unification directly reduces that cost before any structural change is attempted.

---

## 7. Implementation Milestones

Ordered for minimum regression risk; each is independently landable and shippable.

### M1 — Extract `Admin`'s WOD editor out of `App.jsx`
**Scope:** Pure internal PWA refactor. Move WOD-editing state/handlers/render (`SectionCard`, `PrimarySectionBody`, `AddSectionControl`, `CautareMiscare`, `MiscareQuickAdd`, `SortableList`, `ReviewFlagsList`, `ComposedWorkoutPreview`, and the WOD-editing slice of `Admin`) into a new, dedicated module, with zero behavior change.
**Files/modules affected:** `src/App.jsx` (large diff, extraction only), new file(s) for the extracted component(s).
**Regression risk:** Medium — large mechanical diff in a 9,800-line file; mitigated by zero-intended-behavior-change scope and full reliance on existing test coverage (`wodSections.test.js`, `workoutFormats.test.js`, `workoutComposer.test.js`, `FormatConfigEditor.test.jsx`, `workoutIntelligence.test.js`, `ComposedWorkoutView.test.jsx`) to catch accidental behavior drift.
**Estimated complexity:** Medium.
**Test strategy:** Full existing suite must pass unchanged; add a smoke test exercising the extracted module's public surface if one does not already exist at that boundary.

### M2 — Reconcile format catalog and section-editing/validation logic across repos
**Scope:** Diff `workoutFormats.js` ↔ `formatCatalog.ts` and `wodSections.js` ↔ `sectionEditing.ts`; resolve drift into one canonical definition per language, preserving every existing persisted `formatId`/field name.
**Files/modules affected:** `workoutFormats.js`, `formatCatalog.ts`, `wodSections.js`, `sectionEditing.ts`, plus their respective test files.
**Regression risk:** Low — comparative work, not new logic; risk is limited to accidentally renaming a persisted field.
**Estimated complexity:** Small–Medium.
**Test strategy:** Existing test suites in both repos must continue passing; add a cross-repo parity test list (manually run, since no CI currently spans both repos) confirming both catalogs produce identical `formatId` sets and identical field shapes per format.

### M3 — Port `duplicateWorkout.ts` (Duplicate/clone) into the PWA
**Scope:** Port the pure functions (`buildDuplicateRows`, `planWeekCopyRows`, `resolveTargetDateOptions`, `toggleRowSelected`, `removeRow`) as JS; build a new PWA dialog (reusing `BottomSheet`) exposing single-date and week-copy modes, matching forge-admin-web's existing overwrite-protection behavior.
**Files/modules affected:** New `src/duplicateWorkout.js` (ported), new dialog component in the PWA, `Admin`'s WOD list UI (add a Duplicate action).
**Regression risk:** Low — purely additive new capability; no existing PWA behavior is touched.
**Estimated complexity:** Medium (new UI surface, though logic is already proven and tested in forge-admin-web).
**Test strategy:** Port forge-admin-web's `duplicateWorkout.test.ts` (11 tests) to the PWA's test setup; add PWA-specific UI-level tests for the new dialog.

### M4 — Port movement catalog + autocomplete into forge-admin-web
**Scope:** Port `movements.js` (catalog + `miscareSugestii`/`parseMiscareLinePasta`/`looksLikeMovementLine`) as TypeScript; build a `MovementSuggestions.tsx` presentational dropdown; wire into `FormatConfigEditor.tsx`'s `MovementListField` and `SectionEditor.tsx`'s free-text movement entry.
**Files/modules affected:** New `movements.ts` (ported), new `MovementSuggestions.tsx`, `FormatConfigEditor.tsx`, `SectionEditor.tsx`.
**Regression risk:** Low–Medium — additive UI, but touches two already-well-tested existing components; must not change what gets saved (autocomplete only affects entry UX, not the stored free-text value).
**Estimated complexity:** Medium.
**Test strategy:** New tests mirroring `movements.test.js`'s coverage in TypeScript; extend `FormatConfigEditor.test.tsx`/`SectionEditor.test.tsx` to cover the new autocomplete interaction without breaking existing free-text-entry test cases.

### M5 — Fix `SortableList`'s desktop-mouse bug (PWA-only)
**Scope:** Add mouse-event handlers alongside the existing touch-only handlers in `SortableList` (App.jsx L4445–4490), or replace it with an up/down-button pattern for this specific list if full drag support is not prioritized.
**Files/modules affected:** `src/App.jsx` (`SortableList`).
**Regression risk:** Low — isolated component, existing touch behavior preserved either way.
**Estimated complexity:** Small (button-pattern fallback) to Medium (full mouse-drag support).
**Test strategy:** Manual verification on a real desktop browser (no touch simulation available in this session's testing setup, per this platform's own standing policy against automated device-behavior assumptions); existing touch-path tests, if any, must remain passing.

### M6 — Extract a shared Load/Weight editor component (preparatory, not yet Load-Profile-complete)
**Scope:** Isolate the currently-inline weight-pair field (PWA: `MiscareQuickAdd`/`PrimarySectionBody`; forge-admin-web: `ScalingVariantEditor.tsx`) into its own named component per platform, with an identical prop/data contract, without changing its current flat (male/female text) behavior.
**Files/modules affected:** New extraction in both repos; `ScalingVariantEditor.tsx`, `PrimarySectionBody`/`MiscareQuickAdd`.
**Regression risk:** Low — behavior-preserving extraction, prerequisite work for §6's Load Profile future item, not the Load Profile migration itself.
**Estimated complexity:** Small.
**Test strategy:** Existing scaling-tier tests must pass unchanged against the newly-extracted component.

### M7 — Port AI-paste-to-draft into forge-admin-web (optional, deferred)
**Scope:** Port `workoutIntelligence.js`'s pure mapping/review-flag functions as TypeScript; wire a paste-textarea entry point into `EditWorkoutDialog.tsx` calling the existing `analyze-workout` Edge Function (already platform-agnostic, callable from either app).
**Files/modules affected:** New `workoutIntelligence.ts` (ported), `EditWorkoutDialog.tsx`.
**Regression risk:** Medium — new, more complex UI surface (review-flag presentation) in an already-tested dialog.
**Estimated complexity:** Large — the single largest item in this plan.
**Test strategy:** Port `workoutIntelligence.test.js`'s coverage to TypeScript; new integration-level tests for the review-flag UI in forge-admin-web.

### M8 — (Named, not scheduled) Evaluate real cross-repo package infrastructure
**Scope:** Only after M1–M7 are stable and shipped, assess whether recurring drift between the now-reconciled-but-still-duplicated files justifies introducing a real shared package (npm workspace, private registry, or monorepo consolidation) instead of continuing the disciplined-port pattern.
**Files/modules affected:** Unknown — this is a scoping exercise, not an implementation milestone.
**Regression risk:** N/A — not yet scheduled.
**Estimated complexity:** Large, if pursued — genuine infrastructure work (build tooling, CI, versioning) affecting both repos simultaneously.
**Test strategy:** N/A — named here so it is visible as a future option, not silently assumed either necessary or unnecessary by the rest of this plan.
