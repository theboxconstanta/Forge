# Forge Analyze + Scaling — Phase 0 Current State Audit

Investigation only. Zero production code, schema, prompt, or data changes were made while producing this document. Every claim below is traced to an actual file and line, or to a directly-executed test (Deno/vitest/vite-node) run during this audit — never inferred from filenames or prior reports.

## Pipeline

The real pipeline is **wider and more layered** than a single "paste → ANALYZE → RX+3 tiers" action. There are three independent mechanisms, only the first of which is triggered automatically:

```
COACH PASTES/TYPES TEXT
        │
        ▼
QuickCreateDialog.tsx "Generate Workout"  ──▶  analyze-workout Edge Function (OpenAI, gpt-5-mini)
        │                                          │
        │                                          ├─ benchmark short-circuit (benchmarks.ts) if text is (almost) only a known WOD name
        │                                          ├─ buildSystemPrompt() (prompt.ts) + Structured Outputs schema (openaiSchema.ts)
        │                                          └─ transform.ts: flat AI JSON → { sections[], legacy fields }
        ▼
workoutIntelligence.ts: sectionsFromAiAnalysis()  →  EditableSection[]
        │        (buildVariants() populates variants.rx from aiSection.movements;
        │         variants.intermediate/beginner/onramp ONLY from aiSection.scalingVersions —
        │         which the prompt explicitly forbids inventing. If the coach didn't paste
        │         explicit scaled versions, these three tiers come back EMPTY.)
        ▼
EditWorkoutDialog opens, pre-populated — coach reviews/edits RX (and any sections)
        │
        ▼  (separate, manual, per-section action — NOT part of Analyze)
VariantTabs.tsx "Generate Variants" button (RX tab only)
        │
        ├─▶ generateVariantsFromRx() (scalingEngine.ts) — 100% DETERMINISTIC, no LLM,
        │    synchronous. Default path. Curated ~19-movement substitution table +
        │    fixed per-tier percentage rules (load ratio / volume reduction / time-cap increase).
        │
        ▼  (further separate, optional, per-tab action)
VariantTabs.tsx "Regenerate with AI" button (one tier at a time)
        │
        └─▶ regenerate-variant Edge Function (OpenAI, gpt-5-mini, second/different prompt,
             explicit stimulus-preservation coaching instructions) — one LLM call, one tier,
             overwrites only that tab.
        ▼
Coach reviews/edits everything manually → Save (unchanged existing Save path)
```

**The most important architectural fact this audit surfaces**: `analyze-workout` (the literal "Analyze"/"Generate Workout" action) never generates Intermediate/Beginner/OnRamp content itself. Its prompt explicitly instructs the model to populate `scalingVersions` **only from variants the coach's own pasted text already contains**, never to invent them (`prompt.ts` line 121: *"'scalingVersions' ... contine DOAR variantele care apar explicit in text ... nu genera variante care nu sunt mentionate"*). For the overwhelmingly common real-world input — a coach pastes only the RX workout — Intermediate/Beginner/OnRamp come back as empty arrays after Analyze. Scaling generation is a **separate, later, manual step** the coach must trigger themselves in the section editor, and by default that step is not AI at all — it's a deterministic rules engine. AI-generated scaling exists only as a third, fully opt-in, per-tier "second opinion" action.

## LLM Provider / Model

Both `analyze-workout` and `regenerate-variant` (`supabase/functions/*/index.ts`):
- **Provider**: OpenAI, Responses API (`https://api.openai.com/v1/responses`).
- **Model**: `gpt-5-mini` by default, overridable via the `OPENAI_MODEL` Supabase secret without a redeploy.
- **Reasoning effort**: `"low"` (explicit, `_shared/openai.ts` line 53).
- **Structured Outputs**: strict JSON Schema mode (`text.format.type: "json_schema", strict: true`), a different, hand-flattened schema per function (`openaiSchema.ts` in each function's own folder) — not generated from the canonical TypeScript types, kept manually in sync (documented risk, see `openaiSchema.ts` line 1-8 comment).
- **`store: false`** — no persistence of the request/response on OpenAI's side.
- **No explicit `temperature`** parameter is set (Responses API + reasoning-model defaults apply).
- **Timeout**: 45 000 ms (`callOpenAiWithRetry` default).
- **Retry**: exactly one retry, only for HTTP 429/5xx or network/timeout errors, 800 ms delay, never for 4xx (`_shared/openai.ts` lines 71-102).
- **Malformed-response handling**: both functions check for `status: "incomplete"` (truncated), a `refusal` content part, missing `output_text`, `JSON.parse` failure, and (for `analyze-workout` only) a lightweight post-parse `validateWorkoutAnalysis()` check — each maps to a distinct HTTP error code (502/422) with a Romanian/English user-facing message. No fallback to a different model or a non-AI parser exists; a failure surfaces as an error to the coach, who can only retry or fall back to Manual/Template.

## Prompt Architecture

`analyze-workout/prompt.ts`'s `buildSystemPrompt()` is a single large Romanian-language system prompt built from five concatenated blocks: `FORMAT_HINTS` (one line of guidance per format, all 22 + `Unrecognized`), `SCORE_TYPE_BY_FORMAT`, `SECTION_GUIDANCE` (how to split/type/order sections — this replaced an older 4-slot-fitting instruction removed in "Faza 3" per the file's own comment, deliberately, because slot-fitting was "fuzzy reasoning an LLM doesn't apply 100% consistently" — moved to deterministic code, `transform.ts`'s `deriveLegacyFields`), `PARAMETER_RULES` (field-by-field mapping instructions, including several very specific disambiguation rules — e.g. box-jump height goes in `notes` not `distanceValue`; a percentage-of-1RM prescription leaves weight fields null and goes in `notes`; hold durations go in `notes`, not `reps`), and `BENCHMARK_GUIDANCE`. The canonical movement list and alias table are then appended verbatim (`CANONICAL_MOVEMENTS.join(', ')` — ~250 names as one long line — plus `MOVEMENT_ALIASES` as `ABBR -> Full Name` pairs). A per-request, additive block of the calling gym's own movement names can be appended (`buildSystemPrompt(extraMovementNames)`), fetched live from the real `movements` DB table when `gymId` is supplied.

**Explicit non-guessing instruction exists** and is reasonably strong: *"Nu inventa informatii care nu reies din text - orice camp necunoscut ramane null ... Cand esti nesigur intre doua variante plauzibile, alege null/valoarea mai conservatoare, NU o presupunere plauzibila"* (prompt.ts line 119). This directly targets hallucination and is consistent with the observed design (e.g., weightFemale is explicitly told never to be derived from a percentage convention).

**Contradiction/gap found**: the prompt tells the model to distinguish `Ladder` from `For Time` by whether the coach explicitly calls it a "ladder" (`FORMAT_HINTS` line 26: *"pt scheme celebre/standard (21-15-9, 50-40-30-20-10) foloseste 'For Time', nu 'Ladder'"*) — a real, coherent rule — but there is **no equivalent explicit rule distinguishing `RFT` from `For Time` with `structure: 'Repeated Rounds'`**, which per the format catalog's own comment (`workoutFormats.js`, referenced in the previous Member Workout Display Integrity mission) are semantically identical. The model is left to pick one of two format IDs for the exact same underlying structure with no tie-breaking instruction — a genuine, evidenced prompt gap (see Adversarial Findings doc).

**`regenerate-variant/prompt.ts`** is a separate, shorter, English-language prompt (the function is admin-web-only, no PWA/Romanian caller) that explicitly encodes CrossFit-methodology-consistent scaling instructions: preserve stimulus/duration/movement pattern, preserve rep-scheme *shape*, substitute only when "genuinely inaccessible," reduce load "roughly 80%/60%/[lighter or fixed light implement]" per tier. This prompt is qualitatively closer to real coaching methodology than the deterministic engine's blanket percentage rules (see Scaling Architecture below) — but it is never in the default path.

No prompt files were modified during this audit.

## Format Registry Integration

Directly counted from `src/workoutFormats.js`'s `WORKOUT_FORMATS` object (the canonical source, confirmed via a script that parses the actual file, not assumed): **22 formats** — AMRAP, Ascending AMRAP, For Time, RFT, Chipper, Ladder, Partner WOD, Death By, Death By Weight, EMOM, Tabata, Intervals, Weightlifting, Strength Sets, Build to Heavy/1RM, Complex, Superset, Buy-In/Cash-Out, AMRAP with Buy-In, Not For Time, Chained AMRAP, Max Effort.

`analyze-workout/openaiSchema.ts`'s `WORKOUT_FORMAT_VALUES` currently lists the same 22 plus an `Unrecognized` escape hatch — **verified in sync today**, but this is three independently-maintained static copies (`workoutFormats.js` canonical → `openaiSchema.ts`'s enum + `prompt.ts`'s `FORMAT_HINTS` text, both explicitly documented as "static copy, not import, so the Edge Function stays self-contained" → `forge-admin-web/src/features/programming/formatCatalog.ts`, also an explicit manual port) with **no automated check that all three stay in sync** — a structural drift risk disclosed by the code's own comments, not yet a live defect.

## Movement Catalog Integration

**A real, load-bearing gap.** `analyze-workout/movementCatalog.ts`'s `CANONICAL_MOVEMENTS` (~250 names) and `MOVEMENT_ALIASES` (~40 abbreviations) are a **static copy of `WOD-SIMPLE/src/movements.js`** — a client-side autocomplete list with zero database dependency — **not** the `movements` database table that Canonical Movement Identity, the PR Engine, and the coach editor's own autocomplete (`forge-admin-web`'s `MovementCatalogProvider.tsx` → `features/movements/api.ts` → real `movements` table, confirmed by direct read) all use as their actual source of truth. The only bridge between the LLM's grounding and the real `movements` table is additive and per-request: `analyze-workout/index.ts` (lines 81-88) fetches that gym's own rows from `movements` and appends their names to the prompt — but the *global* canonical list the LLM is grounded on is a third, independently-maintained catalog, not the same 465-row table Canonical Movement Identity is built on. `resolveCanonicalMovement()` (deterministic fallback, applied in `transform.ts` only when the model leaves `canonicalName: null`) is exact-match/alias/simple-plural only — verified live via Deno (see Evaluation Matrix doc) to correctly resolve common abbreviations (C2B, TTB, HSPU, DU, KBS, PC, HPC) and correctly return `null` for a genuinely unknown/custom movement rather than guessing.

## Output Schema

`openaiSchema.ts`'s `WORKOUT_ANALYSIS_JSON_SCHEMA` is a deliberately **flattened** Structured Outputs schema (comment: not structurally identical to the canonical `workout-analysis-schema.ts` type — flattened specifically to stay under Structured Outputs' strict-mode nesting/property limits). Field classification:

| Field | Classification |
|---|---|
| `title`, `sections[].type/title/description/format/movements/formatConfig/scalingVersions/loggingMode/scoreType/durationMinutes/benchmarkMetadata/metadata` | **AI-PROVIDED** (model fills every one; schema marks all as `required`, nullable where appropriate — Structured Outputs strict mode requires every property present, `null` standing in for "no value") |
| `movement.canonicalName` | **AI-PROVIDED, with a DETERMINISTIC fallback** (`resolveCanonicalMovement`) applied only when the model returns `null` |
| `sections[].order` | **APPLICATION-PROVIDED** (array index, not a model-authored field — deliberate, per `transform.ts` comment, "one source of truth") |
| legacy top-level fields (`format`, `workoutType`, `timeCapMinutes`, `warmup`/`skill`/`skill2`/`cooldown`, `scaling`, `classification`, `guidance`, etc.) | **DERIVED**, entirely deterministic code (`deriveLegacyFields` in `transform.ts`) — the model never sees or produces these; the removed "Faza 3" slot-fitting prompt instruction was replaced by this exact function |
| `sourceText` | **APPLICATION-PROVIDED** (the caller's own original input, echoed back, never generated) |
| `formatConfig.stages[]` on `Chained AMRAP` | **AI-PROVIDED**, one array element per chained stage, deliberately flat text per movement (not nested structured movements — the file's own comment documents this was forced by a real Structured Outputs nesting-depth error hit during development) |

## Validation

`validateWorkoutAnalysis()` (`transform.ts`) is a hand-rolled, non-schema-library check — explicitly documented as a "safety net for the transform, not primary validation" since Structured Outputs strict mode already guarantees the raw shape. It checks format/scoreType enum membership, array-ness of a handful of fields, and that every movement/section has a non-empty `name`/`type`. It does **not** validate cross-field consistency (e.g., that a `RFT` section's `formatConfig.rounds` is actually present, or that a section marked `loggingMode: 'required'` has a non-null `format`) — those gaps are absorbed downstream by `sectionFromAiAnalysis`'s own defensive fallbacks (e.g. `formatKnown` check, falling back to `'AMRAP'` for an unrecognized primary format).

## Mapper

Two independently-maintained mappers exist, matching the two clients: `workoutIntelligence.ts` (forge-admin-web, TypeScript, explicitly a manual port of `workoutIntelligence.js` in WOD-SIMPLE, per its own header comment — "kept manually in sync if either changes"). Both perform the same job: raw `AiSection[]` → `EditableSection[]`, including a real, non-trivial heuristic (`applyBuyInCashOutMerge`) that detects a 3-section Buy-In/Main/Cash-Out pattern by regex-matching section titles/descriptions and merges them into one `Buy-In/Cash-Out` section — compensating for the fact the model still emits 3 separate sections for this pattern rather than one structured section, a real, disclosed, code-level workaround for a known model limitation.

## Scaling Generation

Fully traced (see Pipeline diagram). Two independent, structurally different mechanisms:

1. **`scalingEngine.ts` (default, deterministic)**: `generateVariantsFromRx()` is a pure function — no I/O, no LLM. Per-tier fixed rules (`TIER_RULES`): intermediate = 10% volume reduction / 15% time-cap increase / 80% load ratio; beginner = 20% / 30% / 60%; onramp = 35% / 50% / 50%. Movement handling: an explicit, curated `SCALING_SUBSTITUTIONS` table covers exactly **19 movements** (Deadlift, Pull-up, Chest to Bar Pull-up, Muscle-up, Handstand Push-up, Toes to Bar, Double Under, Box Jump, Rope Climb, Ring Dip, Burpee, Wall Ball, Pistol Squat, GHD Sit-up, Handstand Walk, Snatch, Clean & Jerk, Thruster, Overhead Squat) — any movement not in this table falls through to "keep the name, scale the load by the tier's flat ratio" (or, for a bodyweight movement with no load at all, effectively *no scaling whatsoever* beyond a rep-count reduction). Verified live (Deno/vite-node execution during this audit, not assumed) that this fallback applies to common, non-trivial movements including **Bar Muscle-up** and **Devil Press** — both remain named identically at every tier including OnRamp. A gym can extend the table per-movement via a DB column (`movements.default_substitutions`), merged in at generation time (`buildScalingOverrides`).
2. **`regenerate-variant` (optional, AI, per-tier)**: one LLM call, given the RX section + target tier, following a genuinely stimulus-preservation-literate prompt (see Prompt Architecture). Never runs automatically; the coach must click "Regenerate with AI" on a specific tab.

There is **no explicit, product-documented definition** of what RX/Intermediate/Beginner/OnRamp *mean* beyond the two engines' own numeric rules — no equivalent of CrossFit's own CAP tier criteria (e.g., "Beginner = under 6 months training, cannot sustain 15+ rep sets of bodyweight movements," found in the Competitive Research document). The tier semantics that exist today are implicit in `TIER_RULES`'s numbers, not written down as a coach-facing or architecture-facing contract.

## Editor Integration

Both mechanisms write directly into the same `EditableSection.variants` state the coach's own manual editor reads and writes (`VariantTabs.tsx`, `ScalingVariantEditor` — confirmed reused unmodified, "one instance per active tab," per the file's own comment) — every AI- or engine-generated field remains a normal editable text/movement-list field with no special "locked" or "AI-generated, do not touch" state. No field was found that resists manual override.

## Save Path

Unmodified by any of the above — `VariantTabs.tsx`'s own comment confirms "Publish All Variants" *is* the pre-existing Save button, unchanged; there is no separate save/commit step for AI or engine-generated content versus manually-typed content. Not modified or further audited in this mission (out of scope, no evidence of risk found).

## Re-Analyze Behavior

**Traced precisely, with a clear, reassuring answer.** `WorkoutDayPage.tsx` line 311: `onClick={() => (wod ? setEditOpen(true) : setQuickCreateOpen(true))}` — Quick Create (and therefore Analyze) is reachable **only** when no workout (`wod`) exists yet for that calendar day. The moment any workout is saved for a day, the same button routes straight to `EditWorkoutDialog` (the manual editor); `EditWorkoutDialog.tsx` itself contains **zero reference** to Quick Create, Generate Workout, or re-analysis (confirmed via direct grep, no matches). **There is no UI path to re-run Analyze on top of an existing draft or saved workout, before or after Save.** The mission's feared "coach edits Beginner, then re-Analyzes, and Forge silently destroys the manual edit" scenario cannot currently happen, because re-Analyze is not reachable at all once a workout exists. The flip side, not evaluated as a defect but worth naming: a coach who wants to "try Analyze again with different phrasing" on an existing day has no in-place path and must discard/recreate.

## Error Handling

Covered above (LLM Provider section) — every known OpenAI-side and parse-side failure mode maps to a distinct, user-facing error message; no silent failure path was found. `QuickCreateDialog.tsx`'s `generate()` and `regenerateVariant.ts` both unwrap the Supabase Functions error envelope to surface the edge function's own message when present, falling back to a generic one otherwise.

## Latency

**Not measured in this session.** No coach/admin credentials were available to invoke either edge function live (see Evaluation Matrix document for why, and the standing project rule this respects). The 45-second timeout and single-retry-with-800ms-delay are the only latency-relevant facts directly evidenced from code; actual p50/p95 response time from OpenAI for `gpt-5-mini` at `reasoning.effort: "low"` was not empirically measured here.

## Cost

**Not measured** for the same reason (no live invocation possible). Order-of-magnitude estimate only, clearly marked as such: `gpt-5-mini` is OpenAI's smaller/cheaper structured-output-capable model; a single Analyze call sends a system prompt on the order of several thousand tokens (the movement catalog alone is ~250 comma-separated names) plus a short user paste, and receives a comparably small structured JSON response. This is very likely a low-single-digit-cents-or-less-per-call feature at current OpenAI pricing, but this document does not report a specific number because no actual token usage was captured from a real response in this session — reporting one would violate this mission's own "do not fabricate precision" instruction.

## Current Tests

- `forge-admin-web/src/features/programming/scalingEngine.test.ts` (169 lines) — thorough, direct-execution unit tests of the deterministic engine, including an explicit cross-tier monotonicity assertion (`TIER_RULES` describe block). Confirmed passing as part of this audit's own verification runs.
- `workoutIntelligence.test.ts` (150 lines) and `regenerateVariant.test.ts` (61 lines) — test the **mapping/wrapper code** using **hand-constructed fake AI-response fixtures**, never real model output.
- **Zero test files exist for the `analyze-workout` or `regenerate-variant` Edge Functions themselves** (`prompt.ts`, `transform.ts`, `openaiSchema.ts`, `benchmarks.ts`, `movementCatalog.ts` — confirmed via direct filesystem search, no `.test.ts` files found in either function's folder). This means: (a) there is no regression protection if the prompt or schema drifts and quietly changes model behavior, and (b) there has never been an automated evaluation of what the actual model returns for any input — only of whether hand-written fixture data maps correctly downstream.

## Known Risks

1. Zero automated evaluation of real model output for any input, ever (see Current Tests).
2. Three independently-maintained format-registry copies with no sync check (disclosed drift risk, not yet a live defect).
3. Movement catalog grounding the LLM is a third, static list, distinct from the real `movements` DB table that Canonical Movement Identity/PR Engine/the coach editor's own autocomplete use.
4. The deterministic scaling engine's substitution table covers ~19 movements; any movement outside it that is genuinely inaccessible to a beginner (verified live: Bar Muscle-up, Devil Press) is prescribed **unchanged in name** all the way to OnRamp.
5. The deterministic scaling engine's line-parser only recognizes a leading dash-separated rep count and/or a trailing `@ weight` suffix — verified live that a distance-only line (`"Row 500m"`) or a male/female-calorie-slash line (`"20/15 Cal Assault Bike"`) receives **zero scaling of any kind**, identical across all four tiers, silently.
6. No product-documented tier semantics (what RX/Intermediate/Beginner/OnRamp are *supposed* to mean) beyond the two engines' own hardcoded numbers.
