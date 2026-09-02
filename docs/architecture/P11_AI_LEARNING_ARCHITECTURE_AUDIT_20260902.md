# P11 — Forge AI Learning & Intelligence Layer · Phase 0 Architecture & Data Audit

**Date:** 2026-09-02 · **Mode:** READ-ONLY / forensic / design-only.
**Zero** application code, prompt, schema, Edge Function, migration, production row, embedding, model or deploy change was made producing this document.

Evidence tags: **PROVEN** (file/line/migration/test), **LIKELY** (strong inference from code), **UNKNOWN** (needs production access or a measurement not available in-session).

Production DB read access in-session: **NONE** — the anon key is RLS-gated (`select` on `wods` returns `[]` with no session; `wod_logs.wod_logs_select_all USING (gym_id = my_gym_id())`). Every "how many rows" question is therefore a **query definition**, not a number.

This audit builds on and does not restate `FORGE_ANALYZE_SCALING_PHASE0_CURRENT_STATE_AUDIT.md` (2026-08-29) — read that first for the scaling-engine detail; this document extends it toward a *learning* system.

---

## 1. Executive summary

**What Forge has today (PROVEN):**
- A **stateless** AI Analyze pipeline: coach pastes text → `analyze-workout` Edge Function (OpenAI Responses API, `gpt-5-mini`, strict Structured Outputs) → deterministic `transform.ts` → client mapper → Builder → coach edits → `wods` upsert → `sync_workout_engine_v2` mirror. `store: false`; **nothing about the AI run is persisted anywhere.**
- **A deliberate architectural decision to *erase* AI provenance at save** (`20260716090000_workout_engine_v2_schema.sql:104-111`: *"NU contine ... provenienta AI ... odata ce coach-ul salveaza, WOD-ul devine 'al lui', nu mai poarta semne ca a trecut prin AI"*).
- **Strong canonical enforcement in *persistence and logging*** — 12+ frozen snapshot columns on `wod_logs`/`skill_logs`, DB validation triggers, P10 historical-truth discipline, INC-04/07/08/09/11 invariants — but **weak canonical enforcement on *AI output*** (a shallow shape check only; semantic rules are prompt-prose + soft client "review flags").
- **No coach-correction capture, no AI-run record, no evaluation harness, no golden dataset, no versioning of prompt/schema/transform, no observability beyond `console.error`, no vector/embedding infrastructure of any kind.**
- **Movement knowledge** the model is grounded on = a **flat static name list** (~342 names + ~40 aliases, `movementCatalog.ts`), *not* the richer `movements` DB table (465 rows w/ category, equipment, pattern, `allowed_prescription_metrics`, `default_substitutions`). Only that gym's own custom movement *names* are appended live.
- **The model receives ZERO member PII today** — the Edge Function body is `{ workout: string, gymId?: string }`. This is a clean privacy baseline to protect.

**The single most important Phase-0 conclusion:** Forge cannot currently answer *"did AI Analyze v2 improve over v1?"* or even *"what did the coach change after Analyze?"* — because **no run is recorded and no correction is captured**. Therefore **provenance + evaluation must come before retrieval/learning** (§56). Retrieval without measurement is unfalsifiable.

**Recommended FIRST phase:** **P11.1 — AI Analyze run + outcome capture** (one append-only table, service-role write from the Edge Function, records input/model/prompt-version/schema-version/raw+normalized output; the client posts the final saved structured workout back against the run id). No schema change to `wods`/`wod_logs`, no migration risk to canonical data, fully reversible, unblocks everything else. Details §57.

**Fine-tuning readiness: NOT READY** (§38). Prerequisites listed.

**Do we need embeddings now? NO — LATER, possibly never** (§25/§27). A relational + structured-filter retrieval over `format / structure / score-family / movement-id overlap / rep-pattern` covers every retrieval need Phase 1 has; vector search is a Phase 5+ optimisation and only if example volume and free-text similarity demand it.

---

## 2. Current AI Analyze architecture

**PROVEN.** Three independent AI mechanisms exist; only the first is the "Analyze" action:

| Mechanism | Trigger | Function | Model | Default path? |
|---|---|---|---|---|
| **Generate Workout** | `QuickCreateDialog` "Generate" (forge-admin) / `analyzeWorkout()` (PWA, currently console-only) | `analyze-workout` | `gpt-5-mini` | **yes** |
| **Generate Variants** | `VariantTabs` "Generate Variants" (RX tab) | `scalingEngine.ts` `generateVariantsFromRx()` | **none — deterministic** | yes (for scaling) |
| **Regenerate with AI** | `VariantTabs` "Regenerate with AI" (per tab) | `regenerate-variant` | `gpt-5-mini` | no — opt-in |

`analyze-workout` **never** generates Intermediate/Beginner/OnRamp — the prompt forbids inventing `scalingVersions` (`prompt.ts:121`). Scaling is a separate, later, mostly-deterministic step. P11 learning scope is primarily **`analyze-workout`** (representation learning) + **`wod_logs`** (performance intelligence); `regenerate-variant` and `scalingEngine` are secondary.

**Re-analyze is unreachable once a workout exists for a day** (`WorkoutDayPage.tsx:311`) — so there is no "re-analyze clobbers manual edits" risk, but also **no in-place iteration signal**.

---

## 3. Exact end-to-end pipeline

**PROVEN**, stage by stage:

| # | Stage | Repo / file / function | Input | Output | Source of truth | Mutable? | Semantic validation? | Survives Save? |
|---|---|---|---|---|---|---|---|---|
| 1 | Coach paste UI | forge-admin `QuickCreateDialog.tsx` `generate()` | free text + `gymId` | `supabase.functions.invoke('analyze-workout')` | coach input | — | none | **input text: NO** |
| 2 | Auth gate | `analyze-workout/index.ts:32-57` | Bearer token | 401/403 or continue | `admins`/`coaches` tables | — | — | — |
| 3 | Benchmark short-circuit | `benchmarks.ts` `matchBenchmark()` | text | canonical WOD struct or null | static `BENCHMARKS` table | immutable (code) | strict name match | n/a |
| 4 | Gym movement fetch | `index.ts:81-88` | `gymId` | `string[]` of gym movement names | `movements` table (live) | — | — | — |
| 5 | Prompt build | `prompt.ts` `buildSystemPrompt(extraNames)` | gym names | one RO system prompt (~5–7k tok) | 5 static prose blocks + `CANONICAL_MOVEMENTS` + aliases | immutable (code) | — | — |
| 6 | Model call | `_shared/openai.ts` `callOpenAiWithRetry` | prompt + user text + JSON schema | raw Responses API JSON | OpenAI `gpt-5-mini`, `reasoning.effort:"low"`, `store:false`, `strict:true` | — | strict schema (shape only) | **NO** |
| 7 | Response parse | `index.ts:109-133` | raw JSON | `flat` object or 502/422 | — | — | truncation / refusal / JSON.parse | — |
| 8 | Transform | `transform.ts` `toWorkoutAnalysis(flat, sourceText)` → `toWorkoutSections` + `deriveLegacyFields` | `flat` | `{ title, sections[], ...legacyFields, sourceText }` | deterministic code | — | `resolveCanonicalMovement` fallback only | **NO** |
| 9 | Post-transform validation | `transform.ts` `validateWorkoutAnalysis()` | analysis | `string[]` errors → 502 | code | — | **shape only** (enum membership, arrayness, non-empty name/type). **No cross-field / canonical checks.** | — |
| 10 | Return to client | `index.ts:142` | analysis | HTTP 200 JSON | — | — | — | — |
| 11 | Client mapper | forge-admin `workoutIntelligence.ts` `sectionsFromAiAnalysis()` (+ `applyBuyInCashOutMerge` heuristic) | `WorkoutAnalysis` | `EditableSection[]` | code (manual port of PWA `.js`) | — | defensive fallbacks (unknown format → `AMRAP`) | **NO** |
| 12 | Builder hydration | `sectionEditing.ts` `hydrateInstancesFromLegacy` etc. | `EditableSection[]` | React state | — | mutable (this is the point) | client `deriveReviewFlags` = **soft warnings, non-blocking** | — |
| 13 | Coach edits | `EditWorkoutDialog` / `SectionEditor` / `VariantTabs` / `ScalingVariantEditor` / `FormatConfigEditor` | — | mutated React state | coach | fully mutable | — | — |
| 14 | Save validation | `sectionEditing.ts` `validateSectionsForLegacy()` | `EditableSection[]` | `ValidationError` or ok | code | — | **structural only** (1 primary, ≤3 supporting, format-required-fields, prescription completeness). **No "REST is not a movement", no structure↔movement consistency.** | — |
| 15 | Legacy payload build | `mutations.ts` `legacyPayloadFromSections()` | sections | `wods` row payload | code | — | — | — |
| 16 | Persist | `mutations.ts` `saveWorkoutSections()` — `wods.update` (by id) or `wods.upsert(onConflict gym_id,date)` | payload | `WodRow` | **`wods` = authoring source of truth** | mutable | DB trigger `validate_movement_prescriptions()` (structure/enum/type of `movement_prescriptions` only) | **YES — but AI lineage already gone** |
| 17 | Engine V2 mirror | `syncWorkoutEngineV2()` → DB fn `sync_workout_engine_v2` | `wods` row | `workouts` + `workout_sections` rows | derived from `wods` | mirror | trigger `enforce_workout_section_gym_id`, INC-03 date-identity | YES |
| 18 | Log-time freeze | DB triggers `snapshot_wod_log_context()` / `snapshot_wod_log_movement_ids()` / section-scoped variants | `wod_logs` insert | `format_snapshot`, `format_config_snapshot`, `wod_name_snapshot`, `movements_snapshot`, `sets_movement_ids`, `benchmark_id` | frozen at log time | **immutable** | strong | YES (this is the P10 tier) |

**Diagram:**
```
coach text ─▶ [QuickCreateDialog] ─▶ analyze-workout EF ─┬─ benchmark match? ─▶ canonical struct
                                                          │
                                        buildSystemPrompt │  (RO prose + static movement names + gym names)
                                                          ▼
                                        OpenAI gpt-5-mini (strict JSON schema, store:false)
                                                          │  raw JSON  ⟵ NOT KEPT
                                                          ▼
                                        transform.ts: flat ─▶ sections[] + deriveLegacyFields  ⟵ NOT KEPT
                                                          │
                                        validateWorkoutAnalysis()  (shape only)
                                                          ▼  HTTP 200
                       [sectionsFromAiAnalysis] ─▶ EditableSection[]  ⟵ NOT KEPT
                                                          ▼
                       [EditWorkoutDialog] coach edits ────────────┐   ⟵ DELTA NOT CAPTURED
                                                          ▼         │
                       validateSectionsForLegacy (structural) ◀────┘
                                                          ▼
                       wods.upsert ─▶ sync_workout_engine_v2 ─▶ workouts + workout_sections
                                                          ▼
                       (later) member logs ─▶ wod_logs + FROZEN SNAPSHOTS  ← the only durable evidence
```

**Everything left of `wods.upsert` is discarded.** The AI run, the raw model output, the pre-edit Builder state, and the coach's edits leave **no trace**.

---

## 4. Model / provider / configuration

**PROVEN** (`index.ts`, `_shared/openai.ts`):

| Aspect | Value | Evidence |
|---|---|---|
| Provider | OpenAI, Responses API `https://api.openai.com/v1/responses` | `_shared/openai.ts:44` |
| Model | `gpt-5-mini` default | `index.ts:26` |
| Model selection | **env-configured**, `Deno.env.get("OPENAI_MODEL") \|\| "gpt-5-mini"` — changeable via `supabase secrets set OPENAI_MODEL=…` **without redeploy** | `index.ts:20-26` |
| API key | `OPENAI_API_KEY` secret, never hardcoded | `index.ts:25` |
| Reasoning | `reasoning: { effort: "low" }` | `_shared/openai.ts:53` |
| Temperature | **not set** (reasoning model + Responses defaults) | `_shared/openai.ts:51-67` |
| Structured output | `text.format.type: "json_schema"`, `strict: true`, per-function hand-flattened schema | `_shared/openai.ts:59-66`, `openaiSchema.ts` |
| `store` | `false` — no OpenAI-side retention | `_shared/openai.ts:54` |
| Timeout | 45 000 ms | `_shared/openai.ts:77` |
| Retry | **1 retry** for 429/5xx/network only, 800 ms delay, never 4xx | `_shared/openai.ts:76-102` |
| Token limits | none configured (no `max_output_tokens`); truncation caught as `status:"incomplete"` → 502 | `index.ts:109-112` |
| Versioning | **NONE** — no prompt version, schema version, transform version, or model-config version recorded anywhere | grep: no version constants in `analyze-workout/*` beyond `PRESCRIPTION_CONTRACT_VERSION` (a different concern) |
| Error handling | distinct HTTP codes: 401/403 auth, 400 empty input, 502 OpenAI-unreachable / truncated / invalid JSON / failed shape-validation, 422 refusal; RO/EN user messages; **no model fallback, no non-AI parser fallback** | `index.ts:100-140` |
| Observability | `console.error` only (ephemeral Supabase EF logs). **No Sentry, no metrics, no cost/latency capture.** | grep: no `Sentry` in `supabase/functions/` |

---

## 5. Prompt architecture

**PROVEN** (`prompt.ts`). One RO system prompt (`developer` role), five concatenated static blocks + appended movement data:

| Block | Classification (§6 taxonomy) | Notes |
|---|---|---|
| Preamble ("Esti un antrenor CrossFit expert…") | **A system-level** | role framing |
| `FORMAT_HINTS` (1 line × 23 formats) | **F workout-format knowledge** + **I heuristic** | e.g. Ladder-vs-For-Time tiebreak (real rule); **no RFT-vs-For-Time(Repeated Rounds) tiebreak** (gap, prior audit §65) |
| `SCORE_TYPE_BY_FORMAT` | **F** | now includes INC-11 `AMRAP structure Sequence → "Reps"` |
| `SECTION_GUIDANCE` | **B task instruction** | how to split/type/order sections |
| `PARAMETER_RULES` | **G schema requirement** + **I heuristic** + **C canonical rule (as prose only)** | box-jump height→notes; % 1RM→notes; hold duration→notes; **INC-07 roundCount/stationMode**; **INC-11 `structure`**; the explicit non-guessing instruction (line ~119) |
| `BENCHMARK_GUIDANCE` | **D example / F** | known-WOD handling |
| `CANONICAL_MOVEMENTS.join(', ')` (~342 names) | **E movement knowledge** | flat list, no capabilities |
| `MOVEMENT_ALIASES` (`ABBR -> Full`) | **E** | ~40 pairs |
| gym movement names (per request) | **E + H current context** | live from `movements` table when `gymId` sent |

**Duplication / drift:** format vocabulary exists in **3+ hand-synced copies** (`workoutFormats.js` → `openaiSchema.ts` enum + `prompt.ts` prose → forge-admin `formatCatalog.ts`) with **no sync test** (prior audit §144). Movement list is a **4th copy** (`movements.js` / `movementCatalog.ts` / forge-admin `movements.ts` / DB `movements`).

**Semantics that exist ONLY as prompt prose (PROVEN — not enforced anywhere downstream):**
- "REST is timing structure, never a movement" — *not* in the prompt at all today, and *not* checked by `validateWorkoutAnalysis`; only `isRestLine()` (`workoutFormats.js`) as a client render/logger safety net.
- INC-11 fixed-vs-open station role: prompt says "derived on the client from `reps`" — correct, but no validator asserts a Sequence AMRAP has a coherent movement list.
- INC-07 `roundCount` ≠ `roundCount × stations`: prose only; `transform.ts` passes through; no validator.
- Ladder vs For Time; RFT vs For Time — prose only, one has a tiebreak, one doesn't.

---

## 6. Structured-output / schema architecture

**PROVEN** (`openaiSchema.ts`). `WORKOUT_ANALYSIS_JSON_SCHEMA` — deliberately **flattened** (strict-mode nesting limits), *not* generated from the canonical `workout-analysis-schema.ts` TS types (manual sync, documented risk). Shape: `{ title, sections[] }`; each section: `type` (free string), `title`, `description`, `format` (enum: 22 + `Unrecognized` + null), `formatConfig` ($ref), `movements[]` ($ref), `equipment[]`, `scalingVersions[]`, `loggingMode` (enum), `scoreType` (enum: 9 + null), `durationMinutes`, `benchmarkMetadata`, `metadata` (coaching enums).

`formatConfig`: `timeCapMinutes, rounds, roundCount, stationMode, structure, intervalSeconds, workSeconds, restSeconds, startReps, incrementReps, stages[]` — all `required` (strict), `null` = "no value". `structure` and `stationMode` are **free strings** validated in `transform.ts` (nullable enums avoided — a real deployed `invalid_json_schema` error, documented).

`movement`: `name, canonicalName (nullable), reps, weightMale, weightFemale, weightUnit, distanceValue, distanceUnit, calories, equipment[], notes`. **The model does NOT tag structural role (fixed/open) — derived client-side from `reps`** (owner decision #4b, INC-11).

`STAGE_DEF.movements` = **flat text strings**, not structured objects (forced by a real strict-mode nesting-depth deploy error).

---

## 7. Transform / normalization architecture

**PROVEN** (`transform.ts`). `toWorkoutAnalysis(flat, sourceText)`:
- `toWorkoutSections(flat)` — maps each raw section: `toSection` → `toFormatConfig` (camelCase passthrough + INC-07 `stationMode` gate + INC-11 `structure` gate), `toMovement` (+ `resolveCanonicalMovement()` **only when `canonicalName===null`**, never overrides model), `toStage`, `toSectionScalingVersion`, `toSectionMetadata`. `section.order` = **array index** (app-provided, "one source of truth").
- `deriveLegacyFields(sections)` — **fully deterministic** derivation of the pre-Engine-V2 API shape (`format`, `workoutType`, `timeCapMinutes`, `warmup`/`skill`/`skill2`/`cooldown`, `scaling`, `classification`, `guidance`). This function **replaced** the removed "Faza 3" slot-fitting prompt instruction — a deliberate move from fuzzy LLM reasoning to code.
- `sourceText` echoed back (app-provided).

Then in each **client**: `sectionsFromAiAnalysis()` (PWA `.js` ↔ forge-admin `.ts`, manual port) + `FORMAT_CONFIG_TRANSLATORS` (camelCase AI config → format-specific keys, e.g. `AMRAP: c => ({ durationSec: min2sec(c.timeCapMinutes), ...(c.structure === 'Sequence' ? {structure:'Sequence'} : {}) })`), + `applyBuyInCashOutMerge` heuristic (regex title/description match to merge a 3-section Buy-In/Main/Cash-Out into one — a disclosed workaround for a model limitation), + `deriveReviewFlags` (soft warnings, currently **not even rendered** in forge-admin's `SectionEditor`).

---

## 8. Validation architecture

**PROVEN.** Four tiers, in order — **none of which is a semantic canonical gate on AI output**:

| Tier | Location | Kind | Blocks? |
|---|---|---|---|
| Strict Structured Outputs | OpenAI | JSON shape | yes (upstream) |
| `validateWorkoutAnalysis()` | `transform.ts:294` | **shape only** — enum membership, arrayness, non-empty `name`/`type` | yes → 502 |
| `deriveReviewFlags()` | `workoutIntelligence.js/.ts` | **soft warnings** — unknown movement, missing distance, ambiguous format, missing required config, INC-11 mixed-unit sequential | **NO — advisory, not even rendered in forge-admin** |
| `validateSectionsForLegacy()` | forge-admin `sectionEditing.ts:478` | **structural** — exactly 1 primary, ≤3 supporting, format-required-fields present, prescription completeness | yes → `ValidationError` |
| `validate_movement_prescriptions()` | DB trigger, `wods` | structure/enum/type of `movement_prescriptions` jsonb | yes → exception |

**GAP (PROVEN):** an AI result that says "REST" is a movement, or emits `structure:'Repeated Rounds'` for an obvious chipper, or `roundCount:15` where it means `roundCount:5 × 3 stations`, **enters the Builder unchallenged**. The coach is the only semantic check. This is exactly what a **post-AI deterministic canonical validator** (§29) would close.

---

## 9. Current machine-readable Forge knowledge

**Answer to §8's critical question: PARTIAL.**

| Candidate | Location | Structure | AI Analyze uses? | Builder uses? | Logger uses? | Duplication |
|---|---|---|---|---|---|---|
| **Format registry** | `src/workoutFormats.js` `WORKOUT_FORMATS` (22 formats: family, scoreMode, config field schema) | JS object | **indirectly** — hand-copied into `openaiSchema.ts` enum + `prompt.ts` prose | yes (`FormatConfigEditor` renders from `.config`) | yes | **3 copies, no sync test** (PROVEN, prior audit §144) |
| **Score definition** | `src/scoreDefinition.js` `scoreDefinitionFor()` (11 kinds) | pure fn over `workoutFormats` | no | no (drives Logger only) | yes | 1 (PWA only) |
| **Movement name list** | `src/movements.js` `MISCARI` (~250) + `CARDIO_MISCARI` | string arrays | **no** — a *4th* static copy (`movementCatalog.ts`, ~342) is what the model sees | yes (autocomplete) | — | **4 copies** |
| **Movement DB catalog** | `movements` table (465 rows: name, aliases, equipment, category, movement_pattern, `default_substitutions`, `allowed_prescription_metrics`, `default_prescription_metric`) | Postgres | **names only, per-gym, appended live** (`index.ts:81-88`) — capabilities/pattern/substitutions **NOT sent** | yes (`MovementCatalogProvider`, capability resolution) | — | overlaps the static lists |
| **Prescription contract** | `src/prescriptionContract.js` (v1, ported byte-for-byte to `.ts`; `prescriptionFixtures.json` shared, parity test) | pure module + DB trigger mirror | no | yes | yes (log snapshot) | 2 repos, **parity-tested** ✅ |
| **Movement capability model** | `movements.allowed_prescription_metrics` / `default_prescription_metric` (+ CHECK constraints, `resolveMovementCapability`) | Postgres + pure fn | **no** | yes | — | single canonical (P9.3) ✅ |
| **Canonical rule registry** | **DOES NOT EXIST** — rules live as: prompt prose, code invariants, `MEMORY.md` §1 index, `docs/architecture/*` | — | — | — | — | — |
| **Structured workout grammar** | `openaiSchema.ts` (AI) + `workoutFormats.js` config schemas + `prescriptionContract` — 3 partial grammars | — | AI: yes | — | — | not unified |
| **AI knowledge registry** | **DOES NOT EXIST** | — | — | — | — | — |
| **Benchmark registry** | `benchmarks` table + `analyze-workout/benchmarks.ts` static `BENCHMARKS` | Postgres + code | code copy (short-circuit) | — | leaderboard `benchmark_id` | 2 copies |

**Verdict:** Forge has **several strong, single-purpose canonical modules** (format registry, prescription contract, capability model, score definition) but **no unified machine-readable "Forge knowledge" surface an AI request can consume**, and the pieces it does have are **hand-copied into the Edge Function, not imported** (Deno/Vite boundary). The AI is grounded on the *weakest* copy (flat names, prose rules).

---

## 10. Canonical enforcement matrix

**PROVEN** where cited. `P` = prompt prose, `S` = Structured-Output schema, `T` = transform.ts, `CV` = client validator/review-flag, `SV` = server (DB) validator/trigger, `DB` = DB constraint, `TEST` = test coverage, `DOC` = doc/`MEMORY.md` only.

| Rule | P | S | T | CV | SV | DB | TEST | DOC | Weakest link |
|---|---|---|---|---|---|---|---|---|---|
| REST is timing, never a movement | ✗ | ✗ | ✗ | `isRestLine` (render/logger only) | ✗ | ✗ | INC-07 tests | ✓ | **AI can emit REST as a movement** |
| REPS = workout structure, not prescription | ✓ (`PARAMETER_RULES`) | reps is its own field | ✓ | ✓ (`prescriptionContract`) | `validate_movement_prescriptions` (reps-text allowed) | ✓ | ✓ | ✓ | prompt-only for AI |
| Workout identity (`wod_id` / `legacy_wod_id` 1:1, `date` linked-pair) | — | — | — | — | `workouts_enforce_legacy_date_sync` (INC-03) | trigger | ✓ | ✓ | strong (DB) |
| Section identity (`workout_section_id`, section-scoped snapshot) | — | — | — | — | `snapshot_wod_log_context` section-aware | trigger | ✓ (INC-08A) | ✓ | strong |
| Variant identity (rx/intermediate/beginner/onramp) | free string (schema) | free string | ✓ | `variantKeyFromLevel` | `validate_movement_prescriptions` (key CHECK) | ✓ | ✓ | ✓ | strong |
| Variant availability (member sees only programmed) | — | — | — | `getProgrammedVariantLevels` / `homeVariantSelectable` (P9.5.8) + **save guard** `isProgrammedVariant` | — | — | ✓ (P9.5.8/8.1) | ✓ | client-only (acceptable — publish surface) |
| RX vs Modified (`resultCompositionModified`) | — | — | — | ✓ (one rule, P9.5.6) | — | — | ✓ | ✓ | strong (client, frozen inputs) |
| Prescription vs completion (4 independent axes) | — | — | — | ✓ | `completion_state` CHECK | ✓ | ✓ (P9.5.6) | ✓ | strong |
| Historical snapshot truth (P10) | — | — | — | `resolveResultProvenance` reads frozen first | `snapshot_*` triggers freeze at log time | ✓ | ✓ (`p10HistoricalResultTruth`) | ✓ | strong |
| Movement capabilities | ✗ (not sent to AI) | ✗ | ✗ | `resolveMovementCapability` | — | `movements_*_domain` / `_subset` CHECK | ✓ (`movementCapabilityIntegrity`) | ✓ | **AI blind to capabilities** |
| Gender / load resolution (`members.gender`, unknown≠male) | ✗ | weightMale/weightFemale split | ✓ (`toWeightSpec`) | `resolveAthleteGenderKey` / `weightKeyForVariant` | — | — | ✓ (P0-02) | ✓ | strong (client) |
| Score-family semantics | — | `scoreType` enum | `deriveLegacyFields` | `scoreDefinitionFor` / `effectiveScoreMode` | — | — | ✓ | ✓ | AI: enum only, no consistency check |
| Intervals `roundCount`/`stationMode`/`restPlacement` | ✓ prose | free strings | ✓ (`stationMode` gate) | `resolveIntervalStructure` / `isStructuredInterval` | — | — | ✓ (INC-07) | ✓ | **prompt-only for AI; no validator** |
| AMRAP `structure` Sequence/Repeated Rounds | ✓ prose (INC-11) | free string | ✓ (gate) | `isSequentialAmrap` / `isSequentialFormat` | — | frozen in `format_config_snapshot` | ✓ (INC-11) | ✓ | **prompt-only for AI; no validator** |
| Sequential fixed/open station | ✓ ("derived from reps") | — | — | `resolveSequentialAmrapStations` (reps → role) | — | — | ✓ (INC-11) | ✓ | strong (client, structural) |
| Mixed-unit sequential restriction | ✓ (INC-11 note) | — | — | `sequentialAmrapMixedUnitConflict` + `deriveReviewFlags` (soft) | — | — | ✓ | ✓ (backlog) | **soft only** |
| Leaderboard latest-log selection (INC-09) | — | — | — | `logIsMoreRecent` / `sortSectionLogs` | `dateWithCurrentTime` caps `logged_at` | — | ✓ (INC-09) | ✓ | strong (client + write cap) |

**Pattern:** *logging/persistence/historical* rules are enforced at 2–3 layers incl. DB. *AI-facing* structural rules are enforced at **0–1 layers, usually prompt prose only**. This asymmetry is the P11 opportunity: a **post-AI canonical validator** (§29) would raise every "prompt-only for AI" row to a hard gate without touching the canonical modules.

---

## 11. Movement knowledge findings

**PROVEN.**

| Attribute | Canonical? | Where | Sent to AI? |
|---|---|---|---|
| canonical identity (name) | canonical | `movements.id` + name; static lists | **names only** |
| aliases | canonical | `movements.aliases` (gin idx) + `MOVEMENT_ALIASES` (~40) | ~40 static aliases |
| category | **partial** — seeded from open-wod-db where matched, else null | `movements.category` | **no** |
| equipment | **partial** — same | `movements.equipment` (single text) + `equipment[]` on AI movement (model-inferred) | model infers, catalog not sent |
| movement_pattern | **partial** — seeded, loosely matches `MOVEMENT_PATTERN_VALUES` | `movements.movement_pattern` | **no** (AI infers `metadata.dominantMovementPatterns` at section level, enum-constrained) |
| unilateral / bilateral | **missing** | — | no |
| load-bearing / distance-bearing / calorie-bearing / rep-based | **canonical (P9.3)** | `movements.allowed_prescription_metrics` (`⊆ {reps,load,distance,calories}`) + `default_prescription_metric`; `CARDIO_CU_CALORII` for cardio | **no** — AI infers per-movement `reps`/`weight`/`distance`/`calories` from text unaided |
| gender load | canonical | `weightMale`/`weightFemale` (AI) → `toWeightSpec` → prescription `sex_specific` spec | split fields in schema |
| prescribed characteristics | canonical | `movement_prescriptions` (per-instance, per-variant) | derived post-AI |
| scaling relationships / substitutions | **partial** — 19 hand-authored in `scalingEngine` + `movements.default_substitutions` (19 platform-seeded) | code + DB | **no** |
| score relevance | derived | `scoreDefinitionFor`, `CARDIO_*` | no |

**Answer to §9's question:** AI Analyze **mostly infers movement identity from text** — grounded only on a flat name+alias list, with a deterministic `resolveCanonicalMovement()` net (exact / alias / simple-plural) applied *only* when the model returns `canonicalName:null`. It receives **no capability, pattern, equipment, unilateral or substitution knowledge**. The rich `movements` table exists but is not surfaced to the model beyond that gym's own custom names.

---

## 12. Format / structure findings

**PROVEN** (`workoutFormats.js` = 22 formats). Selected rows (full table in `workoutFormats.js`):

| Format | Structure options | Score family | Logger | Persistence | Historical projection | AI support |
|---|---|---|---|---|---|---|
| AMRAP | **`structure`: Sequence \| Repeated Rounds** (INC-11; absent=Repeated) | `amrap` / `SEQUENTIAL_AMRAP` | `RoundsPartialFields` or `SequentialAmrapFields` | `result` text; `format_config.structure` frozen | frozen `format_config_snapshot` | schema `structure` field, prompt prose, transform gate |
| Ascending AMRAP | fixed-increment ladder (`startReps`/`incrementReps`) | `amrap` | rounds+partial (reps recomputed per round) | `result` text | `parseAscendingAmrapResult` | schema fields, prompt |
| For Time | **`structure`: Sequence \| Repeated Rounds** | `fortime_or_amrap` | `SequentialPartialFields` or rounds | `result`/`time_result` | frozen | schema, prompt (has Ladder tiebreak, lacks RFT tiebreak) |
| RFT | `rounds` (required) | `fortime_or_amrap` | time + finished-rounds | `time_result` | frozen | **no RFT-vs-ForTime(Repeated) tiebreak in prompt** |
| Intervals | **`roundCount` + `stationMode:'per-interval'` + `restPlacement`** (INC-07) or legacy `rounds` (flat) | `sets` | structured round×station grid or flat `Rundă i` | `sets` jsonb + `sets_movement_ids` | `resolveIntervalStructure` gates on stored `stationMode`; legacy flat unchanged | schema `roundCount`/`stationMode`, prompt prose |
| EMOM / Tabata | interval | `sets` | per-interval reps | `sets` | `resolveSetsScoringMode` schema-default | schema |
| Chained AMRAP | `stages[]` (`kind: amrap\|interval`) | `chained` | per-stage loop | `log_meta.stages[]` + `totalReps` | `composeStageResult` from `log_meta` (not re-parsed) | schema `stages` (flat text movements) |
| Strength / Build to Heavy / Weightlifting | sets schemes | `sets` (weight-scored) | set rows | `sets` | `maxWeightFromSets` | schema |
| Max Effort | single movement | `single_value` | one input | `result` | frozen | schema |

**Vocabulary mismatches (PROVEN / LIKELY):**
- **AI `scoreType` enum** (`Time, Rounds + Reps, Reps, Weight, Calories, Distance, Sets, Completion, Unknown`, 9) ≠ **client `SCORE_KINDS`** (`TIME, TIME_CAPPED, ROUNDS_REPS, SEQUENTIAL_AMRAP, REPS, LOAD, DISTANCE, CALORIES, SETS, STAGES, NONE, FREE`, 12) ≠ **DB `workout_sections.score_type`** (free text). Bridged by `deriveLegacyFields` / `scoreDefinitionFor` but not 1:1.
- **Section `type`**: AI free string (hint list of 12) vs DB `workout_section_types` lookup table (per-gym extensible) vs client `wodSections.js`.
- **Variant level**: free string everywhere; canonicalised by `variantKeyFromLevel` and a DB CHECK on `movement_prescriptions` keys.

---

## 13. Coach-correction evidence today

**Answer: essentially NONE. (PROVEN.)**

Can Forge answer *"AI predicted Repeated Rounds, coach saved Sequence"*? **No.**

| Artefact | Survives? | Evidence |
|---|---|---|
| Original coach input text | **NO** | `sourceText` is returned to the client and used transiently; never written to `wods`/`workouts`. `QuickCreateDialog` holds it in React state only. |
| Raw model response | **NO** | `store: false` (OpenAI); `index.ts` returns transformed analysis, never persists `flat`. |
| Transformed `WorkoutAnalysis` | **NO** | returned over HTTP, consumed by mapper, discarded. |
| Builder **initial** state (post-Analyze, pre-edit) | **NO** | `EditableSection[]` in React state; `onDraftReady` hands it to the editor; no snapshot taken. |
| Builder **final** state (saved) | **partial** | `wods` row (legacy shape) + `workouts`/`workout_sections` mirror — but as the *saved workout*, not tagged as "was AI, was edited". |
| Field-level edits (AI→final delta) | **NO** | never computed; no before/after pair exists to diff. |
| Save timestamp | yes | `wods.updated_at`, `workouts.updated_at` |
| Coach identity | **partial** | `workouts.created_by` (auth.users) exists on the V2 mirror; **`wods` has no `created_by`/`updated_by`** (PROVEN — not in schema; `wods` predates the migration window and the Engine-V2 `created_by` was added only to `workouts`). |
| Model / prompt / schema / transform version | **NO** | not recorded anywhere |

**Explicit architectural cause (PROVEN):** `20260716090000_workout_engine_v2_schema.sql:104-111` deliberately excludes AI provenance from `workout_sections`, on the stated principle *"once the coach saves, the WOD becomes theirs."* P11 must reconcile a learning system with that principle — the resolution is to store provenance **in a separate append-only ledger keyed by run id**, not on the workout row (§54).

---

## 14. Missing correction evidence — summary

Everything in §13 marked NO. In one line: **Forge records the *destination* (the saved workout) but never the *journey* (input → model → transform → draft → edits → save).** There is no run id, no versioning, no before/after. This makes representation learning (System A) **impossible to bootstrap today** and is the reason §56 concludes *measure first*.

---

## 15. Workout provenance findings

**PROVEN.** Saved workouts **cannot** be distinguished as:
- AI-generated / AI-accepted-unchanged / AI-corrected / manually authored / legacy-imported / system-generated.

The only lineage signals: `workouts.created_by` (who), `created_at`/`updated_at` (when), `is_published` (draft vs live), `benchmark_metadata`/`metadata` jsonb (coaching data, not provenance), `tags[]` (free). Legacy `wods` rows (pre-Engine-V2) and the seed script's demo data are indistinguishable from coach-authored rows except by absence of a V2 mirror or by `created_by IS NULL`.

**Minimum provenance needed later (design, do NOT implement):** a nullable `source` enum on the workout (`ai_generated | ai_edited | manual | template | imported | system`) **plus** a nullable `ai_analysis_run_id` FK to the run ledger (§16). The enum alone (no run id) would already answer "how much programming is AI-assisted"; the FK unlocks correction deltas.

---

## 16. Proposed AI-analysis provenance model (design only)

Smallest correct model: **one append-only table** — the run ledger. It does **not** duplicate the domain model (§54): it stores the transient artefacts + pointers.

**`ai_analysis_runs`** (proposed — NOT a migration):

| field | type | purpose |
|---|---|---|
| `id` | uuid pk | run id |
| `gym_id` | uuid not null → `gyms` | **tenant key** |
| `coach_id` | uuid → auth.users | who ran it |
| `function` | text (`analyze-workout` \| `regenerate-variant`) | which mechanism |
| `input_text` | text | the paste (see PII §21 / retention §47) |
| `input_hash` | text | sha256 of normalised input — dedupe / example keying without re-storing text |
| `model` | text | resolved `OPENAI_MODEL` |
| `model_params` | jsonb | `{reasoning_effort, store, timeout_ms}` snapshot |
| `prompt_version` | text | **NEW constant** to add to `prompt.ts` (e.g. `analyze-v3`) |
| `schema_version` | text | **NEW constant** in `openaiSchema.ts` |
| `transform_version` | text | **NEW constant** in `transform.ts` |
| `raw_output` | jsonb | the model's `flat` JSON (pre-transform) |
| `normalized_output` | jsonb | `toWorkoutAnalysis` result (`sections[]`) |
| `benchmark_short_circuit` | boolean | true = no model call |
| `token_usage` | jsonb | `{input, output, reasoning}` from Responses API `usage` |
| `latency_ms` | integer | measured in the EF |
| `status` | text (`ok \| refused \| truncated \| invalid \| error`) | outcome |
| `created_at` | timestamptz | run time |

**`ai_analysis_outcomes`** (proposed — the correction half; written by the *client* after Save, referencing the run):

| field | type | purpose |
|---|---|---|
| `id` | uuid pk | |
| `run_id` | uuid not null → `ai_analysis_runs` | |
| `gym_id` | uuid not null | tenant key (denormalised, RLS) |
| `wod_id` | uuid → `wods` (on delete set null) | what was saved |
| `saved_output` | jsonb | the final structured workout at Save (the coach's canonical result) |
| `outcome` | text (`saved_unchanged \| saved_edited \| discarded \| abandoned`) | |
| `edit_severity` | text (`none \| cosmetic \| minor \| semantic \| critical`) | **derived** (§31) |
| `field_deltas` | jsonb | derived diff (§14/§17) — or NULL and recompute on demand |
| `saved_at` | timestamptz | |

Write path: EF (service role) inserts `ai_analysis_runs`; client inserts `ai_analysis_outcomes` on Save (or a "discarded" marker on cancel). Read path: analytics/eval jobs (service role); a future coach dashboard (gym-scoped). **PII:** `input_text` is coach free text — may contain a member name if a coach writes "partner WOD for John & Maria". Mitigation: store `input_text` with a short retention (§47) and derive `input_hash` + `normalized_output` (structural, no names) for the durable record. Never send `input_text` to any downstream AI context.

---

## 17. Proposed correction model (design + recommendation)

**Recommendation: DERIVE deltas from two versioned structured objects, do NOT store hand-authored diffs. (Store the raw `normalized_output` and `saved_output`; compute `field_deltas` on demand / in a nightly job.)**

Why:
- **Reproducibility** — if the diff algorithm improves (e.g. we later decide movement-order changes below N don't count), we re-run over history; stored diffs would be frozen at the old algorithm.
- **No dual authority** — the two objects are the truth; a stored diff is a cache.
- **Schema evolution** — `normalized_output`/`saved_output` are self-describing jsonb; a diff schema would need migration every time a workout field is added.
- Cost of deriving is trivial (both objects are small).

Delta categories to compute (per section, matched by `order` then by best movement overlap):
`format_changed`, `structure_changed`, `score_family_changed`, `duration_changed`, `rest_changed`, `rounds_changed`, `movement_added/removed/substituted`, `movement_order_changed`, `reps_changed`, `load_changed`, `distance_changed`, `calories_changed`, `variant_added` (coach filled a tier AI left empty — **very common, see §2 — should NOT count as a "correction"**), `station_role_changed`.

`edit_severity` mapping (§31): capitalisation / whitespace / synonym-canonicalisation of a movement name = **cosmetic**; a `notes` tweak = **minor**; `reps`/`load`/`duration`/`rest`/`rounds` numeric change = **semantic**; `format` / `structure` / `score_family` / movement substitution = **critical**.

---

## 18. Trusted-example design (design only)

A validated workout becomes an AI example **only** if it clears an eligibility gate — **not every historical workout is trusted** (§16/§33/§38).

**`ai_approved_examples`** (proposed): `{ id, scope (global|gym), gym_id (null for global), input_text_or_hash, canonical_output jsonb, format, structure, score_family, movement_ids uuid[], rep_pattern text, schema_version, approval (coach_saved_unchanged | coach_reviewed | owner_approved), approved_by, source_run_id, created_at }`.

**Qualification criteria (design):**
1. Saved through the current or a compatible `schema_version`.
2. `outcome = saved_unchanged` **OR** `edit_severity ≤ minor` **OR** explicit `owner_approved`.
3. Passes the post-AI canonical validator (§29) — i.e. it's a *valid* Forge workout.
4. Not a duplicate `input_hash` of an existing example (keep the most-approved).
5. For a **global** example: `owner_approved` only (a single gym's convention is never global — §15/§22/§44).

**Never auto-promote:** a workout the coach saved without looking (no way to tell), a legacy/imported workout, a workout whose input text is missing.

---

## 19. Member-log evidence inventory

**PROVEN** from migrations. `wod_logs` columns and trust class (P10: **never** reinterpret a frozen field from the current mutable `wods`):

| Field | Trust class | Evidence |
|---|---|---|
| `member_id` | CANONICAL/FROZEN | core col |
| `wod_id` (nullable since Slice 2) | CANONICAL (permanent identity ref) | `20260812090300` |
| `workout_section_id` (nullable) | CANONICAL | `20260716120000` |
| `logged_at` | **LEGACY/AMBIGUOUS** — dual-duty: business-date attribution **and** recency; capped at `now()` (INC-09); no separate `created_at` | `MEMORY.md` §5, INC-09 |
| business date | SAFE DERIVATION — from linked `workouts.date` / `wods.date` (identity ref, not reinterpretation) | INC-03 linked-pair |
| `variant_level` | CANONICAL/FROZEN (on the row) | Slice 2 comment |
| `format_snapshot` | CANONICAL/FROZEN | `20260812090000` |
| `format_config_snapshot` | CANONICAL/FROZEN (includes INC-07 `stationMode`, INC-11 `structure`) | `20260812090000` + trigger |
| `wod_name_snapshot` | CANONICAL/FROZEN | `20260812090000` |
| `movements_snapshot` | CANONICAL/FROZEN (trigger-maintained programmed text, section-scoped since `20260822090000`) | `20260813100200` / `20260822090000` |
| `prescription_snapshot` | CANONICAL/FROZEN when non-null; **NULL on all pre-P9 rows and any workout without structured prescription** → readers fall back to live | `20260829090000` |
| `performed_prescription` | CANONICAL/FROZEN when non-null; **NULL = "as programmed" by construction** (only written when materially different, P9.5.2) | `20260831090000` |
| `sets_movement_ids` | CANONICAL/FROZEN when non-null; NULL for legacy + non-movement-keyed formats | `20260823090000` |
| `benchmark_id` | CANONICAL/FROZEN (resolved once) | `20260812090000` |
| `result` (text) | **LEGACY/AMBIGUOUS** — free-ish grammar (`"N runde + M"`, `"50/50 A, 63/75 B"`, `"12:34"`); parsed by `parseRoundsScore`/`partialRepsOfLog`/`parseTimeResult` | `workoutFormats.js` |
| `time_result` | SAFE DERIVATION | `parseTimeResult` |
| `weight_logged` (text) | **LEGACY/AMBIGUOUS** — free text ("61kg", "61", "bodyweight"); `greutateNumerica` extracts leading number | `workoutFormats.js` |
| `sets` (jsonb) | SAFE DERIVATION when present (keyed rows `{reps,weight,completed,targetReps}`); structured-interval keys are round-major (`Rundă r · s. name`) | INC-07 |
| `log_meta` (jsonb) | SAFE DERIVATION — `{completed}` (NFT), `{stages:[…], totalReps}` (chained) | `composeWodLogFields` |
| `completion_state` (text) | SAFE DERIVATION — `completed`/`capped`/null (`null` on pre-Phase-0 rows → inferred `!!time_result`) | `20260820100000` |
| `notes` (text) | **UNSAFE** — free text, includes the frozen movement-line prefix + `---` + member note; **may contain member-typed PII / free prose** | `saveWodLog` |
| station progression | SAFE DERIVATION **only for INC-11 Sequence AMRAP** (`result` per-station text) and **INC-07 structured intervals** (`sets` round-major keys) — **not derivable for anything else** | INC-07/INC-11 |

`skill_logs` mirrors this (slot-aware).

---

## 20. Historical data-quality findings

**UNKNOWN quantities — no production read access.** The eligibility of the historical corpus for learning depends entirely on numbers Forge can measure but this audit cannot. **Queries to run later** (service role, per gym and global):

```sql
-- total logs
select count(*) from wod_logs;
-- modern structured tier (P10-safe for prescription-level analysis)
select
  count(*)                                                          as total,
  count(*) filter (where format_snapshot is not null)               as has_format_snapshot,
  count(*) filter (where format_config_snapshot is not null)        as has_format_config_snapshot,
  count(*) filter (where movements_snapshot is not null)            as has_movements_snapshot,
  count(*) filter (where prescription_snapshot is not null)         as has_prescription_snapshot,
  count(*) filter (where performed_prescription is not null)        as has_performed_prescription,
  count(*) filter (where sets_movement_ids is not null)             as has_sets_movement_ids,
  count(*) filter (where sets is not null)                          as has_structured_sets,
  count(*) filter (where completion_state is not null)              as has_completion_state,
  count(*) filter (where result is not null and time_result is null and sets is null) as result_text_only,
  count(*) filter (where wod_id is null)                            as orphaned_workout
from wod_logs;
-- structure-aware AMRAP eligible for station-reach analysis
select count(*) from wod_logs
 where format_snapshot = 'AMRAP'
   and format_config_snapshot ->> 'structure' = 'Sequence';
-- INC-07 structured intervals
select count(*) from wod_logs
 where format_config_snapshot ->> 'stationMode' = 'per-interval';
-- per-workout participation (Total Reps eligibility needs a frozen structure)
select wod_id, count(*) from wod_logs group by wod_id order by 2 desc limit 50;
-- workout provenance (there is none — expect all NULL / manual)
select count(*) filter (where created_by is null) from workouts;
```

**LIKELY qualitative shape** (from `MEMORY.md` history — many incidents about legacy rows): a **majority** of `wod_logs` predate the Slice-2 snapshot columns (2026-08-12) and P9 prescription snapshots (2026-08-29), i.e. are **`format`/`result`-text-only** and P10-eligible for *time/reps totals* but **not** for *per-movement performed-load* or *station-reach* analysis. Snapshot coverage grows monotonically from mid-August 2026 forward.

---

## 21. Learning eligibility rules (design)

A frozen rule set (design — enforce in the aggregation layer, §22):

| Feature family | Eligible only if… |
|---|---|
| Total-reps / rounds statistics | `format_snapshot` present **and** the score is derivable from `result`/`sets`/`log_meta` under the frozen `format_config_snapshot` (e.g. INC-11 sequential → `partialRepsOfLog(result,true)`; classic AMRAP → `parseRoundsScore` + partial). Exclude `result_text_only` rows whose format can't be resolved. |
| Time statistics | `time_result` present and parseable; `completion_state = 'completed'` (or null-inferred `!!time_result`). |
| Performed-load statistics (per movement) | `performed_prescription` non-null with a load spec for that instance **OR** `prescription_snapshot` non-null (as-programmed) — never `weight_logged` free text alone, never the current `wods` load. |
| As-prescribed rate | `prescription_snapshot` non-null (else "unknown", not "as prescribed"). |
| Station-reach statistics | INC-11 Sequence AMRAP (`result` per-station) or INC-07 structured intervals (`sets` round-major keys) with a frozen `format_config_snapshot`. **Not derivable otherwise.** |
| Variant distribution | `variant_level` present (always) — but exclude free `format_type` "new log" rows. |
| Modification rate | `resultCompositionModified` computable from **frozen** inputs (`prescription_snapshot` or `movements_snapshot` + `weight_logged`). |

**Contamination guard:** a log with a malformed/unparseable `result`, a NULL required snapshot, or `wod_id IS NULL` with no section link → **excluded from every aggregate**, counted only as "ineligible / N excluded" for honesty (§41).

---

## 22. Safe deterministic performance features

**Design — compute in a deterministic aggregation layer (SQL views / materialised views / a nightly job), NEVER by AI, NEVER sent raw.** All gym-scoped.

**Per movement (canonical `movement_id`):** exposure count (# workouts programming it); as-prescribed rate; modification rate; programmed-load distribution (from `wods`/snapshots); performed-load distribution + median (from `performed_prescription`/`prescription_snapshot`, eligible rows only); rep distribution; completion exposure; variant distribution.

**Per workout (`wod_id`):** participation `n`; score distribution + median + P25/P50/P75; completion rate; RX rate; Modified rate; variant distribution; time-cap rate; station-reach vector (Sequence AMRAP / structured intervals only).

**Per structure (`format` × `structure`):** median progression; % reaching station N; total-reps distribution; rounds distribution; time distribution.

**Per cohort:** **only cohorts Forge can canonically define** — `variant_level` (rx/intermediate/beginner/onramp — these ARE the data model), `members.gender` (male/female/unknown), and gym. **Do NOT invent "Beginner/Intermediate/Advanced athlete" cohorts** — there is no training-age or skill field; the only "beginner" concept is the *variant the coach programmed*, not the athlete. (Prior audit §148: no product-documented tier semantics.)

---

## 23. Unsafe / ambiguous performance features

Do **not** derive without an owner decision and a schema fix:
- **Athlete skill/experience cohorts** — no field exists.
- **"Reached the final station" for non-Sequence, non-structured workouts** — `result` text can't distinguish "did 40 of a 50-rep chipper station" from "did 40 extra reps in a partial round" unless the frozen structure says which.
- **Performed load from `weight_logged` free text** when `performed_prescription` is null — "70" could be kg, lb, or "70%".
- **`notes` mining** — free prose, PII risk, low signal.
- **Trend over time weighted by recency** — needs a recency-weighting decision (§43) and awareness that gym population and programming both drift.
- **Cross-workout "difficulty"** — comparing medians across different movements/structures is apples-to-oranges without a normalisation model Forge doesn't have.
- **Any per-member recommendation** (§45) — foundation only; not a Phase-1 feature.

---

## 24. Privacy / data-minimization findings

**PROVEN — strong baseline:**
- The Edge Functions receive **`{ workout: string, gymId?: string }`** only. **Zero member PII reaches OpenAI today.**
- `store: false` — OpenAI retains nothing.
- Member PII columns (`profiles.full_name`, `member_identities.email`, phone, DOB, etc.) are never in any AI path.

**Design principle for P11: the AI must receive AGGREGATES, never rows.** Target context:
> `"Comparable historical workouts (this gym): n=84, median total reps 137, P25 112, P75 161, 42% reached station 3, RX rate 61%, modification rate for KB Swing @24kg = 70%."`

Never: names, per-member scores, per-member loads, `notes`, profile metadata.

**Fields that must NEVER enter AI context** (unless a separate, explicit, owner-approved product feature): `full_name`, `email`, `phone`, DOB / `birth_date`, `wod_logs.notes`, `profiles.*` metadata, `member_identities.*`, any `auth.users` field, raw `wod_logs`/`skill_logs` rows.

**Pseudonymization vs pure aggregation:** **pure aggregation is preferable.** Pseudonymised per-row data still risks re-identification in a small gym (n≈74 members, C15) and offers no benefit over `count/median/percentile` for the "how do members perform on workouts like this" question. Reserve pseudonymised rows for a *future, opt-in, per-member* feature only.

---

## 25. Tenant-isolation findings

**PROVEN.**
- `wod_logs` RLS: `SELECT USING (gym_id = my_gym_id())` — any authenticated gym member sees all of *their* gym's logs; INSERT/UPDATE/DELETE = own rows (`member_id = auth.uid()`). Cross-gym read is blocked at the DB.
- `movements`: platform rows (`gym_id IS NULL`) readable by all; gym rows scoped; only `is_platform_admin()` writes platform rows; `prevent_gym_id_change` blocks null↔non-null transitions (the "future platform promotion" path is deliberately locked).
- `workouts`/`workout_sections`: `gym_id = my_gym_id()` + published-or-coach.
- Helper fns: `my_gym_id()`, `is_coach_or_admin(gym)`, `is_platform_admin()`, `SECURITY DEFINER` + fixed `search_path` throughout (07-14 RLS rewrite, 64 policies).

**Design scopes for learning data:**
| Scope | Contents | Cross-tenant? |
|---|---|---|
| **GLOBAL FORGE KNOWLEDGE** | canonical rules, format grammar, movement ontology, **owner-approved** examples, eval fixtures | intentionally shared (it's product knowledge, not gym data) |
| **TENANT / GYM KNOWLEDGE** | that gym's performance aggregates, that gym's approved examples, that gym's correction patterns | **never leaves the gym** |
| **COACH-SPECIFIC EVIDENCE** | one coach's corrections / preferences | gym-scoped, coach-tagged |
| **MEMBER-LEVEL SOURCE DATA** | raw `wod_logs` | never leaves the gym; never sent to AI; feeds only the deterministic aggregation layer |

**No cross-tenant learning is authorised.** A gym's corrections/aggregates may only inform *that gym's* AI context. Global knowledge is promoted by **owner approval only**.

---

## 26. Retrieval / RAG recommendation

**Recommendation: relational + structured-filter retrieval. NO vector store for Phase 1 (probably not Phases 1–4).**

| Knowledge category | Retrieval mechanism | Why |
|---|---|---|
| A. Hard canonical rules | **STATIC CODE** — a `forgeCanon` module compiled into the prompt builder | rules are small, stable, must be exhaustive not "top-k" |
| B. Format / structure rules | **STATIC CODE** — single source imported (or generated) into `openaiSchema` + prompt + `formatCatalog` | fixes the 3-copy drift; deterministic |
| C. Movement knowledge | **RELATIONAL QUERY** — `movements` rows for the movements in the paste (after `resolveCanonicalMovement`), joined with capability/pattern/substitution | already a table; scoped by gym+global |
| D. Approved workout examples | **STRUCTURED FILTER** — `where format = ? and structure = ? and score_family = ? and movement_ids && ?` ranked deterministically (§26 ranking) | examples are few; exact structural match beats semantic similarity for parsing |
| E. Coach correction examples | **RELATIONAL QUERY** — `ai_analysis_outcomes` where `edit_severity ≥ semantic` and format/structure matches, gym-scoped | "last time AI predicted X for this shape, coach fixed it to Y" |
| F. Tenant performance aggregates | **RELATIONAL QUERY** — materialised aggregate views keyed by `wod_id` / structure | pre-computed, deterministic |
| G. Evaluation fixtures | **STATIC FILES** — a committed golden set (§33) | must not drift with production |

**Vector search would only help** if: (a) example volume grows into the thousands, AND (b) we want "find workouts *similar in prose/intent*" beyond structural filters (e.g. "leg-heavy sprint metcon"). That is a Phase 5+ question. Adding pgvector now is premature infrastructure (§48 failure surface, §36 cost, extra moving part) with no measured need.

---

## 27. Vector / embedding findings

**PROVEN: NONE.**
- No `pgvector` / `vector` extension enabled (grep of all migrations + `supabase/config.toml` — the only hits are a **commented-out** `[storage.vector]` scaffold block and `<->` in ASCII-art comments).
- No embedding columns, no embedding indexes (ivfflat/hnsw), no OpenAI embeddings call anywhere, no external vector DB, no semantic retrieval code.

**Would embeddings materially improve Phase 1? → NO / LATER.**
Reasoning: Phase 1 is provenance + evaluation (§57). Even the eventual retrieval layer (§26) is served by exact structural filters over a small example set. Free-text semantic similarity is a *nice-to-have* for example ranking that becomes worthwhile only at scale (thousands of examples) and after the deterministic ranking is proven insufficient — which we can't know until §30's harness exists. **Do not enable pgvector until an eval shows deterministic retrieval is the bottleneck.**

---

## 28. Retrieval-ranking design (deterministic-first)

For a future `analyze-workout` request, rank candidate approved-examples / correction-memories by a **deterministic score** (higher = more relevant), tie-break stable:

```
score =  100 * (format == candidate.format)
       +  60 * (structure == candidate.structure)      // Sequence/Repeated/etc
       +  40 * (score_family == candidate.score_family)
       +  30 * jaccard(movement_ids, candidate.movement_ids)
       +  15 * (rep_pattern == candidate.rep_pattern)   // "50-40-30", "21-15-9", "buy-in+max"
       +  10 * movement_order_similarity                 // Kendall tau on shared movements
       +   8 * duration_bucket_match
       +   N * correction_type_match                     // if this is a correction memory
       +  tenant_bonus: +25 same gym, +0 global, -∞ other gym
       +  approval_bonus: owner_approved +20, coach_reviewed +10, saved_unchanged +5
       +  recency: + small decay term (§43), never dominant
```
Return top-K (K≈3–5) of each category, hard-cap total tokens. **Semantic similarity is added only as a low-weight tie-breaker later, if measured to help.**

---

## 29. Knowledge-precedence hierarchy

The §2 candidate hierarchy **fits Forge and is confirmed by the codebase** (P10, INC-11 owner decisions, the "coach remains programming authority" principle). Final conflict-resolution order (highest wins; hard constraints **fail closed**):

```
1. HARD FORGE INVARIANT        (e.g. wods.date == workouts.date; REST is not a movement;
                                REPS = structure; member gender never defaults to male)
   ── fail closed: reject the AI output, surface the violation, never auto-"fix" into a guess
2. OWNER-APPROVED CANONICAL RULE (ADR-level; e.g. AMRAP structure vocabulary; mixed-unit STOP)
3. VALIDATED STRUCTURED DATA    (schema/enum/type; movement capability CHECKs; prescription contract)
4. COACH-APPROVED EXAMPLE       (owner_approved global > gym coach_reviewed > saved_unchanged)
5. REPEATED CORRECTION PATTERN  (n corrections of the same type for the same shape, same gym)
6. AGGREGATED MEMBER PERFORMANCE (advisory only — NEVER rewrites a prescription, §23/§40)
7. AI INFERENCE                 (the model's raw guess — lowest authority)
```

Answers to §28's questions:
- **AI inference vs hard rule** → hard rule wins; AI output rejected (502) or the offending field is dropped and flagged, never silently coerced.
- **Retrieved example vs schema** → schema wins; a stale example that violates the current `schema_version` is excluded from retrieval.
- **Coach correction vs owner-approved canonical rule** → canonical rule wins **globally**; the correction may still stand *for that gym* as a gym-scoped pattern (unless it violates a hard invariant).
- **Historical workout vs current architecture** → current architecture wins for *interpretation of new work*; the historical workout keeps its frozen meaning (P10) and is simply not used as an example.
- **Member-performance pattern vs programmed prescription** → prescription wins; the pattern becomes an **advisory note** to the coach, never a rewrite (§23/§40 — the "24kg → 16kg" prohibition).

---

## 30. Post-AI validation design

Insert a **deterministic canonical validator** between the model and the Builder:

```
RETRIEVAL ─▶ MODEL ─▶ STRUCTURED OUTPUT ─▶ ┌─────────────────────────────┐ ─▶ BUILDER
                                          │ canonicalValidate(analysis) │
                                          │  - hard invariants (fail)   │
                                          │  - structural consistency   │
                                          │  - capability coherence     │
                                          └─────────────────────────────┘
```
Checks it should run (all currently **absent** — §8/§10):
- REST is never in a `movements[]` (use `isRestLine`).
- A `format` with required config has that config (RFT⇒`rounds`; Intervals structured⇒`roundCount`+`stationMode`+movements; Chained AMRAP⇒`stages`).
- `structure:'Sequence'` ⇒ movement list is coherent (≥1 movement; last movement rep-less ⇒ open station is plausible; not mixed-unit unless flagged).
- `roundCount` is a plausible repeated-round count, not `roundCount × stations`.
- `score_family` matches `format` (an AMRAP isn't `Weight`-scored).
- Every non-bodyweight movement's metric matches `movements.allowed_prescription_metrics` (if the movement resolves to a catalog row).
- `loggingMode:'required'` ⇒ `format` non-null.

**Phase-0 identifies the gaps; it does NOT fix them.** Build this as its own phase (candidate P11.4) — it's valuable **with or without** learning, and it's the mechanism by which every "prompt-only" row in §10 becomes a hard gate.

---

## 31. Evaluation metrics

Precise definitions (design). All computed over a **golden dataset** (§33) unless marked "production".

| Metric | Definition |
|---|---|
| **FORMAT ACCURACY** | `# runs where normalized_output.format == gold.format / # gold cases` |
| **STRUCTURE ACCURACY** | same for `format_config.structure` (Sequence/Repeated/null-equiv) |
| **SCORE-FAMILY ACCURACY** | same for resolved score kind (map both to `SCORE_KINDS`) |
| **MOVEMENT IDENTITY ACCURACY** | mean over cases of `|correct canonicalName matches| / |gold movements|` (after `resolveCanonicalMovement`) |
| **MOVEMENT ORDER ACCURACY** | Kendall-tau ≥ 0.99 between predicted and gold order of the shared movement set |
| **REP ACCURACY** | `# movements with reps == gold.reps (both null counts as match) / # gold movements` |
| **LOAD ACCURACY** | same for `(weightMale, weightFemale, weightUnit)` triple |
| **DURATION ACCURACY** | `timeCapMinutes` / `durationMinutes` exact match |
| **REST ACCURACY** | `restSeconds` exact match (structured intervals) |
| **VARIANT ACCURACY** | scaling tiers only populated when gold has them; never penalise empty tiers when gold is empty (§2) |
| **SCHEMA-VALID RATE** (production) | `# runs status=ok / # runs` (strict-mode should be ~100%; a dip = schema drift) |
| **CANONICAL-VALID RATE** (production) | `# normalized_output passing §30 validator / # runs` |
| **COACH-EDIT RATE** (production) | `# outcomes with edit_severity ≥ minor / # outcomes saved` |
| **ACCEPTED-WITHOUT-EDIT RATE** (production) | `# outcomes edit_severity == none / # outcomes saved` |

---

## 32. Semantic acceptance-rate definition (the primary product metric)

The §31 candidate (`saved without semantic correction / ultimately saved`) is **close but needs two refinements**:

**AI ANALYZE SEMANTIC ACCEPTANCE RATE =**
```
  # outcomes where (outcome = saved) AND (edit_severity ∈ {none, cosmetic, minor})
                   AND (variant-fill edits excluded)
---------------------------------------------------------------------------------
  # outcomes where (outcome = saved)          [discarded/abandoned excluded]
```
Refinements:
1. **Exclude cosmetic/minor** (capitalisation, a `notes` tweak, canonicalising a movement synonym) — those are not AI failures. `Sequence → Repeated Rounds` (**critical**) is the thing this metric must catch.
2. **Exclude "coach filled an empty scaling tier"** from the numerator's edit count entirely — AI deliberately doesn't produce those (§2); counting them as corrections would make the metric meaningless.
3. Track **discarded** runs separately (`# discarded / # runs`) — a high discard rate is a different, also-important failure signal ("AI output was so wrong the coach started over").

**Edit severity taxonomy** (used everywhere): `COSMETIC` (whitespace, case, movement-name canonicalisation) · `MINOR` (notes, a single non-structural field) · `SEMANTIC` (reps/load/duration/rest/rounds numeric change) · `CRITICAL` (format / structure / score-family / movement substitution / movement add-remove).

---

## 33. Golden-dataset design

**`ai_eval_cases`** — a **committed, version-controlled file set** (JSON), NOT a production query. Each case: `{ id, input_text, gold_output (canonical structured workout), gold_notes, tags[], schema_version, source, added_by, added_at }`.

**Sources & qualification:**
1. **Incident fixtures** — every INC-* that involved AI/parsing (INC-07 Fight-Gone-Bad, INC-11 buy-in+max-reps, the Ladder-vs-For-Time and RFT-vs-For-Time ambiguities from the prior audit) → these are *known hard cases*, must-pass.
2. **Architecture regression fixtures** — `prescriptionFixtures.json`, `workoutIntelligence.test` fixtures (already hand-authored, already trusted).
3. **Owner-reviewed historical workouts** — a curated set the owner explicitly blesses (NOT "all production workouts" — §16/§38).
4. **Adversarial cases** — deliberately ambiguous inputs (a chipper written as "AMRAP", a benchmark with a modified movement, mixed units).

**Qualification criteria:** every case's `gold_output` must (a) pass the §30 canonical validator, (b) be reviewed by ≥1 human, (c) carry a rationale for any non-obvious field. **The set changes only via PR** — it does **not** re-derive from production data, so an eval score is comparable across weeks. Target initial size: 40–80 cases (enough to cover 22 formats × key structures + the ~10 known ambiguities).

---

## 34. Model / prompt / schema versioning

**PROVEN: none exists.** Minimum to add (design — these are just constants + a ledger column, no migration to canonical tables):

| Version constant | Where | Bumped when |
|---|---|---|
| `PROMPT_VERSION` | `prompt.ts` | any prose/block/movement-list change |
| `SCHEMA_VERSION` | `openaiSchema.ts` | any schema field/enum change |
| `TRANSFORM_VERSION` | `transform.ts` | any mapping/derivation change |
| `MODEL` (already resolvable) | `OPENAI_MODEL` secret | recorded per run |
| `CANON_VALIDATOR_VERSION` | future §30 module | any rule change |
| app version | already exists (`app_version` DB row) | per deploy |

Without these, *"did v2 beat v1"* is **unanswerable** — you can't attribute a metric change to prompt vs schema vs model vs a coach-population shift. Every `ai_analysis_run` must stamp all of them.

---

## 35. (moved — see §16/§34)

---

## 36. Observability design

**PROVEN: `console.error` only.** Target answerable questions (from the run + outcome ledgers — no dashboards to build in Phase 0):

- analyses/day, /week, /gym → `count ai_analysis_runs`
- accepted-unchanged / corrected / discarded → join `ai_analysis_outcomes`
- most-corrected fields → aggregate `field_deltas` by category
- formats with most failures → `group by normalized_output.format, edit_severity`
- best model/prompt version → `group by (model, prompt_version)` over acceptance rate **on the golden set** (production acceptance is confounded by input mix)
- schema-validation failures → `count runs status='invalid'`
- canonical-validation failures → `count outcomes canonical_valid=false`
- cost per request → `token_usage` × price table (add to run ledger)
- latency → `latency_ms` (add measurement in the EF)

---

## 37. Cost / latency analysis

**UNKNOWN precise numbers** (no live invocation possible in-session; prior audit §127–133 same). Order-of-magnitude + comparison:

| Option | Token cost | Latency | Eng. complexity | Debuggability | Determinism | Maintenance | Tenant isolation |
|---|---|---|---|---|---|---|---|
| **A. Giant static prompt** (today + more prose) | ~5–8k in, ~1–3k out; grows with every rule | ~2–6s (`gpt-5-mini` low reasoning, LIKELY) | low | **poor** — prose rules don't fail loudly | low | **poor** — prose accumulates, contradicts | n/a (no data) |
| **B. Compact canonical prompt + relational retrieval** | ~2–4k in (canon module is terser than prose) + ~0.5–1k retrieved context | +1 DB round-trip (~10–50ms) | **medium** — build `forgeCanon` + retrieval + §30 validator | **good** — validator gives structured errors; retrieval is inspectable | **high** — deterministic retrieval + validator | **strong** — retrieval is gym-scoped by construction |
| C. Vector RAG | + embedding call per request + vector index | + embedding latency (~100–300ms) + ANN query | **high** — pgvector, backfill, index tuning, drift | medium | low (ANN is fuzzy) | high | needs per-tenant filtering discipline |
| D. Hybrid (B + vector tiebreak) | B + occasional embedding | B + conditional | high | medium | medium | high | strong if built on B |
| **E. Fine-tuning** | cheapest per-call *inference*; huge upfront | fast inference | **very high** — data pipeline, labelling, eval, retrain cadence, privacy review | **poor** — a fine-tune is a black box; can't inspect *why* | opaque | **very high** — retrain on every schema change | **hard** — one model for all tenants unless per-tenant fine-tunes (impractical) |

**Recommendation: B.** It's the simplest option that is *measurable, deterministic, debuggable, tenant-safe, and reversible*. A + more prose is where Forge is now and it doesn't scale (prior audit's disclosed contradictions). C/D are premature. E is disqualified for Phase 1 (§38).

---

## 38. Fine-tuning readiness

**NOT READY.** (Answer to §37.)

| Prerequisite | Status | Gap |
|---|---|---|
| Stable canonical schema | **PARTIAL** — `openaiSchema` is stable-ish but hand-synced to 2 other copies, no version | unify + version (§34) |
| Trusted labels | **NO** | no coach-correction capture → no (input, correct-output) pairs (§13) |
| Sufficient examples | **UNKNOWN / LIKELY NO** | need ≥ several hundred *clean, reviewed* pairs; today = 0 captured |
| Versioned examples | **NO** | §33/§34 |
| Clean provenance | **NO** | §15 — deliberately erased |
| Evaluation harness | **NO** | §30/§31 |
| Low ambiguity | **NO** | RFT-vs-ForTime, Ladder-vs-ForTime, "AMRAP" chippers — the model has no deterministic tiebreak |
| Privacy | **OK** (baseline) — but a fine-tune would bake training data into weights; `input_text` PII risk (§21) becomes permanent | must scrub PII from any training corpus |
| Tenant scope | **PROBLEM** — one fine-tuned model would blend all gyms' conventions | contradicts §22/§44 |

**Exact prerequisites before even *considering* fine-tuning:** P11.1 (provenance) + P11.2 (correction capture) + P11.3 (eval harness + golden set) shipped and running for **≥ several months**; ≥ ~500 clean reviewed correction pairs; schema+prompt frozen for a full eval cycle; a demonstrated plateau where retrieval (Option B) can't improve acceptance further; an owner decision on per-tenant vs global weights; a privacy/legal review of the training corpus.

---

## 39. Feedback-contamination safeguards

Design gates (enforce in the example-promotion and aggregation layers):

| Contamination vector | Safeguard |
|---|---|
| AI wrong → coach saves without noticing | **Never** treat `saved_unchanged` as *automatically* high-confidence. Weight it below `coach_reviewed`/`owner_approved`. A random-sample human review of `saved_unchanged` runs (eval process, not code) calibrates whether "unchanged" means "correct" for a given format. |
| Legacy/ambiguous historical workout → "canonical truth" | Examples require `schema_version` compatibility + §30 validator pass + explicit approval. Legacy `wods` (no run id, no input text) **cannot** become examples. |
| Malformed member log → skews aggregates | §21 eligibility gate: unparseable `result`, NULL required snapshot, orphaned `wod_id` → excluded, counted as "N ineligible". |
| One coach's local convention → global rule | Global promotion = **owner only** (§18/§22). A gym pattern needs `n ≥ threshold` *same-type* corrections *and* stays gym-scoped. |
| A/B or shadow experiment output leaks into training | Shadow/experimental runs tagged; **never** eligible for example promotion until the variant is activated *and* re-evaluated. |
| Model trained on its own past output (echo) | Examples come from **coach-saved** canonical workouts, not from `normalized_output`. The `raw_output` is stored for debugging, never used as a label. |

---

## 40. Learning lifecycle

```
RAW EVIDENCE                         │ approval boundary
  ├─ ai_analysis_runs (every run)    │ none — append-only, service role
  ├─ ai_analysis_outcomes (saves)    │ none — client writes on Save
  └─ wod_logs (frozen snapshots)     │ none — existing
        ▼
VALIDATED EVIDENCE                   │ deterministic gate (§21 eligibility, §30 canonical)
  ├─ eligible logs → aggregation     │ automatic
  └─ outcomes with derived deltas    │ automatic
        ▼
APPROVED EXAMPLE                     │ HUMAN gate
  ├─ gym example: coach_reviewed     │ a coach clicks "use as example" OR saved_unchanged auto-candidate (low weight)
  └─ global example: owner_approved  │ OWNER only
        ▼
RETRIEVABLE KNOWLEDGE                │ automatic (indexed by structural keys)
  ├─ canonical rules (static code)
  ├─ approved examples (filtered)
  ├─ correction memories (gym-scoped)
  └─ performance aggregates (gym-scoped, advisory)
        ▼
EVALUATED AI OUTPUT                  │ golden-set gate (§33) before any activation
  └─ shadow run → compare → eval → (owner) activate
        ▼
COACH FEEDBACK → new ai_analysis_outcomes → loop
```
**Approval boundaries:** evidence capture is automatic and safe (append-only, no canonical mutation). *Promotion to influence* is gated: aggregates are advisory-automatic; examples need human approval; global knowledge needs owner approval; pipeline activation needs an eval-gate + owner.

---

## 41. Performance Intelligence architecture

Separate subsystem (System B), **never** touching canonical parsing (System A):

```
wod_logs / skill_logs (frozen snapshots)
        ▼
[eligibility filter]  (§21 — per feature family)
        ▼
[deterministic aggregation]  (SQL views / materialised views / nightly job — NO AI)
        ▼
performance_aggregates  (keyed by wod_id / movement_id / (format,structure) / (gym,variant,gender))
        │
        ├──▶ PROGRAMMING INSIGHTS  (coach-facing cards, deterministic text: "n=84, median 137, 42% reached station 3")
        │
        └──▶ OPTIONAL AI CONTEXT  (aggregates only, gym-scoped, behind a flag, advisory framing enforced)
```
Guarantees: aggregates are **read-only** to the AI; the AI's use of them is **advisory-only** (validator rejects any AI output that changes a prescription "because members modified it"); every insight carries `n` and eligibility notes (§42); recency handled per §43.

---

## 42. Future Programming Insights (advisory examples)

All **advisory**, all carry `n` and an eligibility footnote, none rewrite programming:
- "Comparable workouts (this gym, n=37) produce a median ~140 total reps."
- "24 kg Russian KB Swing has a 70% modification rate here (n=112 exposures)."
- "Only 22% of comparable athletes reached the final station (n=41 Sequence-AMRAP results)."
- "Reducing station 2 from 75→60 reps would likely raise final-station exposure" — **flagged as a model suggestion, requires the aggregate to support it, never auto-applied.**
- "This workout is denser than your last 4 metcons (est. work:rest 4:1 vs typical 2:1)."

---

## 43. Explainability / sample-size design

**Explainability:** every AI recommendation must cite its evidence honestly:
> "Based on 37 comparable C15 workouts and 412 eligible historical results (2026-06 → 2026-09)."
Required to support such a statement: the aggregation layer must expose, per insight, `n_workouts`, `n_eligible_results`, `n_excluded_ineligible`, `date_range`, and the filter predicate. **No fabricated precision** — if `n < threshold`, the UI says "not enough data yet", not a number.

**Sample-size semantics (design — thresholds to CALIBRATE, not hardcode now):**
| Band | Meaning |
|---|---|
| `n = 0` eligible | "no data" — insight suppressed |
| `n < T_low` (candidate 5–10) | "insufficient evidence" — show count only, no median/percentile |
| `T_low ≤ n < T_mid` (candidate 30) | "low confidence" — show median, wide interval, caveat |
| `n ≥ T_mid` | "sufficient" — show distribution |

**Calibration method (later):** pick thresholds by back-testing — for a given `n`, how stable is the median vs the full-data median across bootstrap resamples? Set `T_mid` where the median stabilises within an acceptable band for the busiest gyms; document per-metric (station-reach needs more `n` than total-reps).

---

## 44. Tenant-specific intelligence

**Design.** The aggregation layer is **gym-partitioned by construction** (`gym_id` on every aggregate row; RLS `gym_id = my_gym_id()`).
- **GLOBAL PRODUCT KNOWLEDGE** = canonical rules, format grammar, movement ontology, owner-approved examples, eval fixtures. Shared. Promoted by owner only.
- **C15 PERFORMANCE KNOWLEDGE** = every aggregate, correction pattern, and gym example computed from C15's data. **Never** promoted to global without owner review, **never** visible to another tenant.
- A future multi-gym Forge: each gym gets its own aggregates; the *product* improves for everyone only through owner-curated global examples and prompt/canon changes — not by pooling raw performance.

Architecture required: `performance_aggregates` and `ai_approved_examples` both carry `gym_id` (nullable = global for examples; never null for aggregates); all reads are RLS-scoped; the AI context builder takes `gymId` and selects `where gym_id = :gymId OR (scope = 'global')`.

---

## 45. Personalization — future only

**Design assessment only.** Do current snapshots/logs provide a viable foundation for eventual per-member recommendations ("suggested working load", "likely scaling", "movement substitution", "target score range")?

**PARTIAL foundation:**
- **YES for**: per-member performed-load history (from `performed_prescription`/`prescription_snapshot` on eligible rows), per-member variant history (`variant_level`), per-member movement PR history (the PR Engine / `pr_events` / `personal_records`), per-member benchmark history (`benchmark_id` + `MEMBER_PERFORMANCE` domain).
- **NO for**: skill/experience level (no field), readiness/fatigue (no field), goals (no field), attendance-adjusted trends (would need joining `bookings`).
- **Blocker**: coverage — personalization needs *enough eligible rows per member*; §20 suggests most members' history predates the snapshot columns.

**Do NOT design a personalization engine now.** The P11.8 aggregation layer, if built per-member-aware from the start (aggregates keyed optionally by `member_id`, gym-scoped, never AI-fed raw), is a sufficient foundation for a *future* P12.

---

## 46. Target architecture diagram

Justified by this audit (not a copy of §52's template — Forge-specific):

```
                 ┌──────────────────────────────────────────────┐
                 │  forgeCanon (STATIC CODE, versioned)          │
                 │  - hard invariants   - format grammar        │
                 │  - movement ontology (from movements table)  │
                 └───────────────────────┬──────────────────────┘
                                         │ compiled into
 coach text ─▶ QuickCreateDialog ─▶ analyze-workout EF ──────────┐
                                         │                       │
              ┌──────────────────────────┴───────────┐           │
              │ RETRIEVAL (relational + struct filter)│           │
              │  - approved examples (fmt/struct/mv)  │           │
              │  - correction memories (gym-scoped)   │           │
              │  - perf aggregates (gym, advisory)    │           │
              └──────────────────────────┬───────────┘           │
                                         ▼                       │
                                    OpenAI gpt-5-mini            │
                                    (strict schema, store:false) │
                                         │ raw + normalized      │
                                         ▼                       │
                            ┌────────────────────────┐           │
                            │ canonicalValidate(§30) │──fail─────┼──▶ 502 + structured error
                            └────────────┬───────────┘           │
                                         ▼                       │
                                     BUILDER  ◀───── coach edits  │
                                         │                       │
                                         ▼                       │
                              validateSectionsForLegacy          │
                                         ▼                       │
                                   wods.upsert ─▶ sync_v2        │
                                         │                       │
        ┌────────────────────────────────┼───────────────────────┘
        ▼ (client, on Save)              ▼ (EF, service role, per run)
 ai_analysis_outcomes  ◀──run_id──  ai_analysis_runs   ◀── APPEND-ONLY LEDGERS
        │  (saved_output, delta)         │  (input, model, versions, raw, tokens, latency)
        ▼                                ▼
 ┌──────────────────────────────────────────────────┐
 │ EVAL: golden set (§33) → baseline vs enhanced     │
 │        → semantic acceptance rate, field metrics  │
 └────────────────────────┬─────────────────────────┘
                          ▼ (owner gate)
              activate retrieval / promote examples


 wod_logs (frozen snapshots) ─▶ [eligibility filter §21] ─▶ [deterministic aggregation]
                                                              ▼
                                                   performance_aggregates
                                                      ├─▶ Programming Insights (coach cards)
                                                      └─▶ optional AI context (aggregates only, flagged)
```

---

## 47. Proposed database model

**Smallest correct set — 4 tables, all append-only or aggregate, NONE mutating canonical data.** (Design; NO migration.)

### 47.1 `ai_analysis_runs`
- **PURPOSE**: immutable record of one AI Analyze / Regenerate call.
- **FIELDS**: see §16.
- **PK**: `id uuid`.
- **FK**: `gym_id → gyms`, `coach_id → auth.users` (nullable).
- **TENANT KEY**: `gym_id`.
- **INDEXES**: `(gym_id, created_at)`, `(input_hash)`, `(model, prompt_version)`.
- **RLS**: SELECT `is_coach_or_admin(gym_id)`; INSERT service-role only (EF); no UPDATE/DELETE (append-only; retention job is the only deleter, §47).
- **WRITE PATH**: `analyze-workout` / `regenerate-variant` EF, service role, after the model call.
- **READ PATH**: eval jobs (service role); future coach analytics (gym-scoped).
- **RETENTION**: `input_text` → 90 days then null (keep `input_hash` + `normalized_output`); rest → 2 years then archive/aggregate.
- **PII**: `input_text` (coach free text, may name members) — short retention, never re-sent to AI.
- **MUTABILITY**: immutable.
- **SOURCE OF TRUTH**: itself (for "what the AI did").

### 47.2 `ai_analysis_outcomes`
- **PURPOSE**: what the coach ultimately did with a run.
- **FIELDS**: see §16.
- **PK**: `id uuid`.
- **FK**: `run_id → ai_analysis_runs`, `gym_id → gyms`, `wod_id → wods (on delete set null)`.
- **TENANT KEY**: `gym_id`.
- **INDEXES**: `(run_id)`, `(gym_id, saved_at)`, `(outcome, edit_severity)`.
- **RLS**: SELECT `is_coach_or_admin(gym_id)`; INSERT authenticated where `is_coach_or_admin(gym_id)` (the client writes it) — or service-role via a small EF for integrity; no UPDATE/DELETE except retention.
- **WRITE PATH**: forge-admin (and PWA if it gains a save-from-AI path) on Save / Cancel.
- **READ PATH**: eval + analytics.
- **RETENTION**: 2 years then aggregate-then-drop.
- **PII**: `saved_output` is structural (no names) — low risk; `field_deltas` derived.
- **MUTABILITY**: immutable (one row per run; if a workout is edited later that's a *new* signal, not an update here — or add `post_save_edits` as a separate concern).
- **SOURCE OF TRUTH**: `wods` for the workout; this table for "was it AI, was it edited".

### 47.3 `ai_approved_examples`
- **PURPOSE**: curated (input → canonical output) pairs for retrieval.
- **FIELDS**: see §18.
- **PK**: `id uuid`.
- **FK**: `gym_id → gyms (nullable = global)`, `source_run_id → ai_analysis_runs (nullable)`, `approved_by → auth.users`.
- **TENANT KEY**: `gym_id` (null = global product knowledge).
- **INDEXES**: `(format, structure, score_family)`, GIN `(movement_ids)`, `(scope, approval)`.
- **RLS**: SELECT `gym_id IS NULL OR gym_id = my_gym_id()` (same shape as `movements`); INSERT/UPDATE global rows = `is_platform_admin()`; gym rows = `is_coach_or_admin(gym_id)`; DELETE gated the same.
- **WRITE PATH**: a coach "use as example" action (gym) / an owner curation tool (global).
- **READ PATH**: the retrieval layer in `analyze-workout` EF (service role, filtered by `gymId`).
- **RETENTION**: indefinite (curated knowledge) — but pruned when `schema_version` becomes incompatible.
- **PII**: `input_text` — for global examples, must be scrubbed/synthetic before approval.
- **MUTABILITY**: `approval` and `canonical_output` editable by the approver; otherwise stable.
- **SOURCE OF TRUTH**: itself.

### 47.4 `performance_aggregates`
- **PURPOSE**: pre-computed deterministic member-performance features (System B).
- **FIELDS**: `{ id, gym_id NOT NULL, key_type (wod | movement | structure | cohort), key_ref (uuid or text), variant_level (nullable), gender (nullable), metric (text), n integer, n_ineligible integer, value_json jsonb (median/p25/p75/rate/vector), date_range daterange, computed_at, computed_from_version }`.
- **PK**: `id uuid`; **UNIQUE** `(gym_id, key_type, key_ref, variant_level, gender, metric)`.
- **FK**: `gym_id → gyms`.
- **TENANT KEY**: `gym_id` (**never null**).
- **INDEXES**: the unique tuple; `(gym_id, key_type, key_ref)`.
- **RLS**: SELECT `gym_id = my_gym_id()`; INSERT/UPDATE/DELETE service-role only (the aggregation job).
- **WRITE PATH**: a scheduled job / materialised-view refresh (deterministic SQL over eligible `wod_logs`).
- **READ PATH**: Programming Insights cards (gym-scoped); optional AI context builder (aggregates only).
- **RETENTION**: overwrite on recompute; keep a small history table only if trend charts need it.
- **PII**: none (counts/medians only).
- **MUTABILITY**: fully recomputable — it's a cache, `wod_logs` is the truth.
- **SOURCE OF TRUTH**: `wod_logs` + `wods`.

**Deliberately NOT proposed:** `ai_analysis_versions` (versions are constants + a run column, not a table), `ai_corrections` (deltas are derived, not stored — §17), `ai_eval_runs`/`ai_eval_cases` as DB tables (golden set is a committed file; eval runs are CI artefacts / a lightweight `ai_eval_results` only if a UI needs history), `knowledge_rules` (rules are static code — §26 A/B).

---

## 48. Security / RLS proposal

Summarised in §47 per table. Principles:
- **Append-only ledgers**: no UPDATE/DELETE grant except a retention job (service role).
- **Service-role writes** for anything the Edge Function produces (`ai_analysis_runs`, `performance_aggregates`) — the EF already uses `SUPABASE_SERVICE_ROLE_KEY`.
- **Coach/admin reads** gym-scoped via existing `is_coach_or_admin(gym_id)` / `my_gym_id()`.
- **Global example writes** = `is_platform_admin()` only (matches `movements` platform-tier discipline).
- **Members**: no access to any P11 table (these are coach/analytics surfaces). Member-facing personalization (P12) is out of scope.
- **No changes to existing RLS.** New tables inherit the established helper functions.
- OpenAI: keep `store: false`; the run ledger is Forge-controlled and RLS-protected.

---

## 49. Data-retention proposal

| Data | Retention | Rationale |
|---|---|---|
| `ai_analysis_runs.input_text` | **90 days**, then NULL | coach free text may contain member names; the `input_hash` + `normalized_output` preserve the learning value |
| `ai_analysis_runs.raw_output` | **1 year**, then NULL | debugging value decays; `normalized_output` is the durable artefact |
| `ai_analysis_runs` (row) | **2 years**, then roll into monthly aggregates | trend analysis |
| `ai_analysis_outcomes` | **2 years**, then aggregate | correction-pattern analysis |
| derived `field_deltas` | not stored (recomputed) | §17 |
| `ai_approved_examples` | **indefinite**, pruned on schema incompatibility | curated knowledge |
| `performance_aggregates` | overwrite on recompute; optional 1-year monthly history | it's a cache |
| golden `ai_eval_cases` | **indefinite** (version-controlled files) | reproducible eval |

Add a single scheduled retention function; document the DOWN.

---

## 50. Implementation phase plan

Evaluated against the §55 candidate; **reordered** — provenance+eval before retrieval (§56):

| Phase | Name | Depends on | Ship gate |
|---|---|---|---|
| **P11.1** | **AI Analyze run + outcome capture** (`ai_analysis_runs` + `ai_analysis_outcomes`; version constants; EF + client writes; token/latency capture) | — | ledger populating; zero canonical-table change; reversible |
| **P11.2** | **Correction delta derivation + severity taxonomy** (`field_deltas` job; semantic acceptance rate metric; a read-only coach/owner report) | P11.1 (needs weeks of data) | metric computed; matches spot-checks |
| **P11.3** | **Evaluation harness + golden dataset** (committed `ai_eval_cases`; a CI/script runner that calls the EF over the golden set and reports §31 metrics; **baseline captured**) | P11.1 (version constants) | baseline numbers recorded per (model, prompt_version, schema_version) |
| **P11.4** | **Post-AI canonical validator** (`canonicalValidate` module; the §30 checks; wire into the EF between model and return; also runnable in the golden runner) | P11.3 (measure impact) | canonical-valid rate ≥ baseline; no regression on golden set |
| **P11.5** | **Canonical knowledge adapter** (`forgeCanon` — one versioned module that generates the schema enums + prompt blocks + `formatCatalog`; kills the 3-copy drift; adds movement capability/pattern to the prompt from the `movements` table) | P11.3 | drift test green; golden-set acceptance ≥ baseline |
| **P11.6** | **Approved-example capture + retrieval (SHADOW)** (`ai_approved_examples`; coach "use as example"; retrieval layer; **shadow mode** — enhanced pipeline runs alongside, results compared, not shown) | P11.3, P11.5 | shadow eval shows Δ acceptance ≥ agreed bar |
| **P11.7** | **Activate retrieval** (behind a per-gym flag; monitor acceptance) | P11.6 + owner gate | live acceptance ≥ shadow projection; rollback flag ready |
| **P11.8** | **Member-log eligibility filter + deterministic aggregates** (`performance_aggregates`; the §22 features; Programming Insights cards) | — (parallelisable with P11.1–4) | aggregates match hand-checked samples; `n`/eligibility shown |
| **P11.9** | **Programming Intelligence** (advisory insights in the builder; optional aggregate context to AI, flagged) | P11.7, P11.8 | insights carry `n`; validator blocks any prescription rewrite from stats |
| **P11.10** | **Fine-tuning readiness review** (re-assess §38 against accumulated data; owner decision) | P11.2, P11.3, P11.6 + months of data | a written go/no-go |

Every phase is independently reversible (feature flag or additive table) — §49.

---

## 51. Recommended FIRST implementation phase

### **P11.1 — AI Analyze run + outcome capture**

- **Goal:** make every AI Analyze run and its coach outcome durable, so that (a) we can measure acceptance, (b) we can later derive corrections, (c) we can build a golden set from real hard cases. **Measurement infrastructure, zero behaviour change.**
- **Scope:**
  - New migration: `ai_analysis_runs` + `ai_analysis_outcomes` (§47.1/47.2) — **additive, no change to `wods`/`wod_logs`/`workouts`/`workout_sections`**.
  - `prompt.ts` / `openaiSchema.ts` / `transform.ts`: add `PROMPT_VERSION` / `SCHEMA_VERSION` / `TRANSFORM_VERSION` **constants** (no logic change).
  - `analyze-workout/index.ts` + `regenerate-variant/index.ts`: after a successful (or failed) model call, `admin.from('ai_analysis_runs').insert({...})` (service role, best-effort — a ledger write failure must **never** block the coach's analysis; wrap in try/catch, log only). Measure `latency_ms`; capture Responses API `usage`.
  - forge-admin `QuickCreateDialog` → thread the returned `run_id` into `onDraftReady`; `EditWorkoutDialog`/save path → on Save, `insert ai_analysis_outcomes({ run_id, wod_id, saved_output, outcome, saved_at })`; on Cancel/discard → `outcome:'discarded'`. Best-effort, non-blocking.
  - `saved_output` = the same structured object the Builder holds (reuse `EditableSection[]` → a stable serialisation; or the `wods` payload).
- **Files likely touched:** `supabase/migrations/<new>.sql`; `supabase/functions/analyze-workout/{index,prompt,openaiSchema,transform}.ts`; `supabase/functions/regenerate-variant/index.ts`; `supabase/functions/_shared/openai.ts` (return `usage`+`latency`); `forge-admin-web/src/features/programming/{QuickCreateDialog,EditWorkoutDialog,mutations,workoutIntelligence}.tsx/.ts`; possibly `WOD-SIMPLE/src/App.jsx` `analyzeWorkout()` (currently console-only — may just log the run id).
- **DB impact:** 2 new tables, RLS policies, 3 indexes each, 1 FK to `wods` (`on delete set null`). **No trigger on any existing table. No column on any existing table.**
- **Migration requirement:** yes — 1 additive migration. Reversible: `DROP TABLE ai_analysis_outcomes; DROP TABLE ai_analysis_runs;` (nothing references them).
- **Risk:** **LOW.**
  - Ledger write failure blocking analysis → mitigated by best-effort try/catch (the coach flow must be untouched if the insert fails).
  - `input_text` PII → mitigated by 90-day retention + never re-sending to AI (documented, enforced by not building any consumer that reads `input_text` into a prompt).
  - Service-role insert from EF → the EF already holds the service-role key; scope the grant to INSERT on the one table.
  - Storage growth → runs are small jsonb; retention job in the same migration.
- **Tests:**
  - EF: a `analyze-workout` unit test (the **first ever** for that function) asserting the ledger insert payload shape and that a simulated insert failure does **not** change the HTTP response.
  - forge-admin: `QuickCreateDialog`/save tests asserting `run_id` is threaded and an outcome row is written with the right `outcome`/`edit_severity=none` on unchanged save.
  - Migration: RLS test — a coach of gym A cannot read gym B's runs; a member cannot read any.
  - Reversibility test: DROP + re-apply.
- **Rollback:** feature-flag the ledger writes (`P11_CAPTURE_ENABLED` secret / env) so they can be disabled instantly without a deploy; the migration itself is `DROP TABLE`-reversible.
- **Acceptance criteria:**
  1. Every `analyze-workout` / `regenerate-variant` call produces exactly one `ai_analysis_runs` row (or zero on benchmark short-circuit, with `benchmark_short_circuit=true`).
  2. Every Save from an AI draft produces exactly one `ai_analysis_outcomes` row linked to the run.
  3. A forced ledger-write failure produces **byte-identical** coach-facing behaviour (verified: same HTTP response, same Builder state).
  4. `PROMPT_VERSION`/`SCHEMA_VERSION`/`TRANSFORM_VERSION` are stamped on every run.
  5. RLS: cross-gym read blocked; member read blocked.
  6. `token_usage` and `latency_ms` populated for real model calls.
  7. Full reversibility demonstrated in CI.
  8. Zero change to `wods`/`wod_logs`/`workouts`/`workout_sections` schema, triggers, or RLS.

---

## 52. Owner decisions required

### Decision D1 — Reverse the "workout becomes theirs, no AI marks" principle (for provenance capture)?
The Engine-V2 schema **deliberately** does not persist AI provenance (`20260716090000:104-111`). P11 needs a run/outcome ledger.
- **Option A — Separate append-only ledger, nothing on the workout row (recommended).** Provenance lives in `ai_analysis_runs`/`ai_analysis_outcomes`, keyed by run id; `wods`/`workout_sections` stay exactly as they are; the "workout is the coach's" principle holds for the *domain model*, and learning data is a *separate operational concern*.
  - *Pros:* honours the original decision's intent; zero canonical-table change; cleanly deletable; no migration risk to programming.
  - *Cons:* joining "this saved workout ↔ its AI run" needs the client to write the outcome row (a best-effort link, not a FK on `wods`).
- **Option B — Add `source` + `ai_run_id` to `workouts`/`wods`.** Provenance on the row.
  - *Pros:* one-hop join; "show me all AI-assisted workouts" is trivial.
  - *Cons:* directly contradicts the documented decision; a column on the canonical authoring table; needs an ADR; migration touches the most-important table.
- **Recommendation: A.** It gets 95% of the value with none of the canonical-schema risk, and the owner can still choose B later (add the nullable FK) once the ledger proves useful.

### Decision D2 — May the deterministic aggregation layer read `wod_logs` across all members of a gym for Programming Insights?
RLS already permits any gym member to `SELECT` all gym logs; the aggregation job would run service-role.
- **Option A — Yes, gym-scoped aggregates, counts/medians only, never per-member, never to another tenant (recommended).**
  - *Pros:* this is the entire point of System B; RLS already allows the read; output is non-identifying aggregate.
  - *Cons:* in a 74-member gym, some aggregates on rare movements could have `n` low enough to be quasi-identifying — mitigated by the `n < T_low` suppression (§43).
- **Option B — Require explicit member opt-in before a member's logs enter any aggregate.**
  - *Pros:* maximal privacy posture.
  - *Cons:* aggregates become biased/sparse; a huge product/UX cost for a gym-internal analytics feature the coach arguably already has via the leaderboard.
- **Recommendation: A**, with the low-`n` suppression rule as a hard gate and a documented "aggregates only, never rows, never cross-tenant" invariant.

### Decision D3 — Global example promotion authority.
Who can turn a gym's saved workout into a **global** (all-Forge) AI example?
- **Option A — Owner only (recommended).** A coach can mark a gym-local example; only the platform owner promotes to global.
- **Option B — Any coach/admin can contribute global examples, owner curates/removes.**
  - *Cons:* one gym's convention (e.g. a house rule about how they write EMOMs) leaks into the product for everyone; contradicts §22/§44.
- **Recommendation: A.**

### Decision D4 — `input_text` retention.
Coach paste text may contain member names ("partner WOD for John & Maria").
- **Option A — 90-day retention then NULL, keep `input_hash` + `normalized_output` (recommended).**
- **Option B — Never store `input_text`; store only `input_hash` + `normalized_output` from day one.**
  - *Pros:* zero PII exposure window.
  - *Cons:* debugging a bad parse without the original text is much harder; the golden-set curation loses its richest source.
- **Option C — Store indefinitely.**
  - *Cons:* growing PII liability for marginal benefit.
- **Recommendation: A** — a short window is enough for debugging and golden-set curation, then it's gone.

### Decision D5 — First phase confirmation.
- **Question:** proceed with **P11.1 (run + outcome capture)** as the first implementation phase, or a different starting point?
- **Recommendation: P11.1**, per §56 (measure first). The alternative (start with the canonical validator P11.4 or the aggregation layer P11.8) is *also* safe and additive — but without P11.1 we can never quantify whether P11.4/P11.5/retrieval actually improved anything.

*(No decision is asked where the code/data already answers it — e.g. "do we need pgvector" is answered NO by §27, not put to the owner.)*

---

## 53. Risks

1. **Provenance principle conflict (D1)** — needs an ADR either way.
2. **Ledger write coupled to the coach flow** — must be strictly best-effort; a naive implementation could make a Supabase hiccup break "Generate Workout". Mitigation: try/catch + feature flag, tested (§51).
3. **`input_text` PII** — mitigated by retention + no-consumer discipline; residual risk if a future dev reads `input_text` into a prompt. Mitigation: a lint/review rule + doc.
4. **Low-`n` quasi-identification in a small gym** — mitigated by `n` suppression (§43).
5. **Format/movement 3–4-copy drift** — pre-existing (prior audit §144/145); P11.5 fixes it but until then a schema change must touch all copies.
6. **Golden set staleness** — mitigated by version-controlled files + PR-only changes + `schema_version` stamping.
7. **Measuring on production acceptance rate** confounds prompt quality with input mix and coach population — mitigated by making the **golden set** the primary comparison and production the secondary signal.
8. **Scope creep into personalization / fine-tuning** — explicitly deferred to P12 / P11.10 with written gates.
9. **Edge Function has zero test coverage today** — P11.1 adds the first tests; until then any prompt/schema change is unverified.

---

## 54. Unknowns / unavailable evidence

| # | Unknown | Why | How to resolve |
|---|---|---|---|
| U1 | `wod_logs` row counts by snapshot-coverage tier | no production read access (RLS) | run §20 queries (service role) |
| U2 | Actual `gpt-5-mini` p50/p95 latency + token usage + $/call for Analyze | no coach credentials to invoke live; `store:false` so nothing captured | P11.1 captures it going forward; or one instrumented owner-run |
| U3 | How many production workouts are AI-assisted vs manual | no provenance exists | can't be answered retroactively; P11.1 answers it forward |
| U4 | Whether `wods` truly has **no** `created_by`/`updated_by` | inferred from migration history (predates the window; V2 `workouts` got `created_by`, `wods` migrations don't add it) — **LIKELY**, not fully PROVEN | `\d wods` on production |
| U5 | Real coach-correction patterns (which fields, how often) | not captured | P11.1 + P11.2 |
| U6 | Whether the PWA `analyzeWorkout()` path is used at all (comment says "console only") | code says console-only; unclear if a UI wires it | grep + product confirmation |
| U7 | Exact `movements` table row count and capability-seed coverage | seed migration exists (342 base + open-wod-db enrichment + 123 extra); actual applied count needs DB | `select count(*), count(*) filter (where allowed_prescription_metrics <> '{}') from movements where gym_id is null` |
| U8 | Whether any gym other than C15 exists in production | multi-tenant schema exists; only C15 referenced in `MEMORY.md` | `select count(*) from gyms` |

**No numbers were fabricated for any of the above.**

---

## 55. Final recommendation

1. **Adopt the §29 knowledge-precedence hierarchy** as the P11 north star: hard invariants fail closed; the coach remains programming authority; member performance is advisory-only and never rewrites a prescription.
2. **Measure before you learn (§56).** Ship **P11.1 (run + outcome capture)** first — one additive, reversible migration, best-effort ledger writes, zero change to canonical tables or coach behaviour. It is the prerequisite for *every* subsequent claim of improvement.
3. **Then P11.3 (eval harness + golden set)** to establish a baseline, and **P11.4 (post-AI canonical validator)** — the latter is worth doing *regardless of learning* because it converts a dozen "prompt-prose-only" rules (§10) into hard gates.
4. **Retrieval (P11.5–P11.7) uses relational + structured filters, not vectors.** Do not enable pgvector until an eval proves deterministic retrieval is the bottleneck (§27). Run any new pipeline in **shadow mode** first (§50).
5. **Performance Intelligence (P11.8–P11.9) is a separate subsystem** (System B): deterministic aggregation over eligible frozen snapshots, gym-scoped, aggregates-only to AI, never cross-tenant, always with `n` and eligibility disclosed.
6. **Fine-tuning: not now, not soon.** Re-review at P11.10 against real accumulated data.
7. **Resolve owner decisions D1–D5** before P11.1 implementation.

**Success-criteria answers (§62):**
1. *What does AI Analyze know today?* — 22 formats (as enum + prose), ~342 movement names + ~40 aliases (flat, no capabilities), that gym's custom movement names (live), coaching-metadata enums, a benchmark short-circuit, and a strong non-guessing instruction. (§5/§11)
2. *What does it NOT know?* — movement capabilities/patterns/substitutions, the real `movements` table, canonical structural rules as anything but prose, any prior correction, any performance data, any provenance. (§9/§11/§13)
3. *What does Forge enforce independently of AI?* — persistence/logging invariants at 2–3 layers incl. DB triggers and frozen snapshots (P10); structural save validation. **Not** semantic AI-output validation. (§8/§10)
4. *Can we reconstruct AI → correction today?* — **No.** (§13)
5. *What provenance is missing?* — all of it: run record, raw output, pre-edit draft, edit deltas, versions. (§14/§15)
6. *Which historical logs are trustworthy for learning?* — the post-2026-08 snapshot-covered tier for the feature families in §21; quantities UNKNOWN (§20/U1).
7. *What member-performance features are safe?* — the deterministic aggregates in §22 over eligible rows.
8. *What must never go raw to AI?* — names, emails, phones, DOB, `notes`, per-member scores/loads, any `profiles`/`auth` field, raw log rows. (§24)
9. *Do we need embeddings now?* — **No.** (§25/§27)
10. *Relational vs vector vs static?* — canonical rules & grammar = static code; movement knowledge & examples & aggregates = relational/structured-filter; vector = later, only if measured. (§26)
11. *How will corrections improve future analyses?* — captured as `ai_analysis_outcomes` → derived deltas → correction memories retrieved (gym-scoped) for structurally-matching future inputs, and hard patterns feed the golden set / prompt. (§17/§28/§40)
12. *How will member logs improve recommendations without redefining truth?* — deterministic gym-scoped aggregates → advisory Programming Insights + optional advisory AI context; the §30 validator blocks any AI output that changes a prescription from statistics. (§23/§40/§41)
13. *How will we measure improvement?* — golden-set metrics (§31) + the semantic acceptance rate (§32) + field-correction rates, compared across stamped (model, prompt, schema, transform) versions. (§30–§34)
14. *How to prevent contamination?* — the §39 gates: no auto-trust of `saved_unchanged`, schema-version + validator gates on examples, eligibility filter on aggregates, owner-only global promotion, shadow tagging.
15. *Fine-tuning ready?* — **NOT READY** (§38).
16. *Smallest correct architecture?* — 4 append-only/aggregate tables + version constants + a `forgeCanon` module + a canonical validator; no vectors, no fine-tune, no canonical-schema change. (§47)
17. *Implement first?* — **P11.1** (§51).

---

## 56. Phase-order answer: RETRIEVAL or PROVENANCE+EVALUATION first?

**PROVENANCE + EVALUATION first. PROVEN from Forge, not just bias.**

- Forge today has **no run record and no correction capture** (§13). You cannot rank or select retrieval examples you have never recorded, and you cannot know whether retrieval helped because there is **no baseline and no acceptance metric** (§30–§32).
- The codebase's own strongest pattern is *measure/freeze then act*: P10 frozen snapshots, INC-11's "audit → prove root cause → then fix", the deliberate move of slot-fitting from prompt to deterministic code with tests. A learning layer without measurement would be the one un-Forge-like thing in the repo.
- P11.1 (capture) + P11.3 (eval) are **additive and reversible**; retrieval (P11.5–7) changes the model's input and must be measured against a baseline that only P11.1/P11.3 can produce.
- The one nuance: **P11.4 (canonical validator)** and **P11.8 (aggregation)** can proceed *in parallel* with P11.1–3 because they don't depend on retrieval and are valuable standalone — but retrieval itself waits for measurement.

**Order: P11.1 → P11.3 → (P11.4 ‖ P11.5 ‖ P11.8) → P11.6 shadow → P11.7 activate → P11.9 → P11.10.**

---

*End of P11 Phase 0 audit. No implementation performed. Owner review required (§52).*
