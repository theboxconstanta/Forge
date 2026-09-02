# P11.3 — Tenant-scoped relational retrieval + learning-hint selection

**Priority:** P11 / AI Learning Foundation
**Date:** 2026-09-02
**Status:** **CLOSED / GREEN**. No owner blocker. Migration `20260902110000` applied to production; retrieval function live; integration T1–T16 + security + determinism all pass.
**Mode:** deterministic · relational · tenant-scoped · evidence-first · **read-only learning** · no prompt injection · no RAG · no embeddings · no fine-tuning

P11.3 is **retrieval selection**, not AI-learning activation. AI Analyze behaves exactly as before. Nothing here is sent to OpenAI.

---

## 1. Audit (§7) — evidence-tagged

**PROVEN (verified against production `ai_correction_evidence`, 24 columns, 4 live rows):**

| Query dimension | Source column | Notes |
|---|---|---|
| tenant | `gym_id` | hard filter on every query |
| taxonomy | `taxonomy_kind` (18-value CHECK) | required param |
| variant | `variant` (`rx/intermediate/beginner/onramp`) | |
| movement identity | `movement_id` (canonical, often NULL today) → `movement_name` (`p11_norm_movement_name`) | id-first, exact-name fallback |
| gender dimension | `gender_dimension` (`universal/male/female/sex_specific`) | |
| unit | `unit` (`kg/lb/m/…`) | |
| field | `field` (`load/reps/…`) | |
| movement position | `movement_position` | |
| section type | `section_type` | |
| format / structure | `context_fingerprint->>'format'` / `->>'structure'` | structure normalised (AMRAP null ≡ Repeated Rounds) |
| reliability / eligibility | `reliability` / `eligibility` | learning filter |
| extractor / prompt / model version | `extractor_version` (evidence) · `prompt_version` / `model` (joined `ai_analysis_runs`) | provenance / filter |
| run identity + recency | `ai_run_id` + joined `ai_analysis_runs.created_at` | distinct-run strength, recency |

**PROVEN — positive acceptance context is derivable READ-TIME** from the frozen `ai_analysis_runs.saved_output` (EditableSection[]): count `accepted_*` runs whose primary section's `variants[<variant>].instances[]` carries a comparable movement + field. No new table, no unstable reconstruction.

**LIKELY:** `movement_id` will be populated more often as the movement catalog matures; retrieval already prefers it. Today most evidence has `movement_id = NULL` and matches by normalised name.

**UNKNOWN / out of scope:** `workSec` / `restPlacement` / interval params — P11.2 never captured them (D3=B). P11.3 does **not** reconstruct them.

**Conclusion — NO owner blocker (§88):** every §88 stop-condition is answerable from code/data. Positive opportunity needs no new persistence; context compatibility is deterministic (matrix below); the schema has every dimension; pattern summaries are aggregated at query time (volume is tiny); no evidence-semantic change is needed.

---

## 2. Objects (migration `20260902110000`, additive, read-only, no table/index/trigger/RLS)

| Object | Notes |
|---|---|
| `p11_3_format_family(text) → text` | pure. `metcon` / `interval` / `strength` / own-name. Same format = exact context; same family = "strong"; different = "broad". |
| `p11_3_norm_struct(fmt, struct) → text` | byte-for-byte the JS `normStruct` (AMRAP absent / 'Repeated Rounds' equivalent). |
| `p11_3_retrieve_impl(…)` `SECURITY DEFINER` | the deterministic engine. **REVOKEd from PUBLIC, anon AND authenticated** — only the wrapper may call it. No auth check inside (delegated). 20 params. |
| `p11_retrieve_learning_hints(…)` `SECURITY DEFINER` | public wrapper. `IF NOT is_coach_or_admin(p_gym_id) THEN RAISE`. REVOKEd from anon; GRANTed to authenticated. Same 20-param signature; returns `p11_3_retrieve_impl(...)`. |

Rollback: `DROP FUNCTION` the four objects (DOWN in footer). Nothing references them; no schema object is altered.

---

## 3. Query context contract (§8)

`p11_retrieve_learning_hints(p_gym_id, p_taxonomy [REQUIRED], p_variant, p_movement_id, p_movement_name, p_gender_dimension, p_unit, p_format, p_structure, p_field, p_section_type, p_movement_position, p_from, p_to, p_evidence_type, p_prompt_version, p_model, p_extractor_version, p_max_patterns, p_max_observations)`

Not every dimension is required for every taxonomy. Missing-but-recommended dimensions produce a `queryContext.warnings[]` entry rather than an error.

---

## 4. Taxonomy compatibility matrix (§16 / §51)

`H` = hard (mismatch → excluded); `C` = context (ranks exact vs strong vs broad); `–` = not used.

| taxonomy | variant | movement | gender_dim | unit | format | structure | position |
|---|---|---|---|---|---|---|---|
| **LOAD** | H | H | H | H | C | C | – |
| **DISTANCE** | H | H | H | H | C | C | – |
| **CALORIES** | H | H | H | – | C | C | – |
| **REPS** | H | H | H | – | C | **H** | **H** iff structure = Sequence *or* format ∈ {Chipper, Ladder}; else – |
| **STRUCTURE** | – | – | – | – | **H** | C (own key) | – |
| **SCORE_FAMILY** | – | – | – | – | **H** | – | – |
| **ROUNDS** | – | – | – | – | **H** | C | – |
| **DURATION** | – | – | – | – | **H** | C | – |
| **REST_TIME** | – | – (P11.2 CHECK forbids) | – | – | **H** | **H** | – |
| **MOVEMENT_IDENTITY** | H | H | – | – | C | C | – |
| **MOVEMENT_ADD / MOVEMENT_REMOVE** | H | H | – | – | C | C | – |
| **MOVEMENT_ORDER** | H | – | – | – | C | C | – |
| **SECTION_ADD / SECTION_REMOVE** | – | – | – | – | C | – | – |
| **VARIANT_COMPLETION** | H | – | – | – | C | C | – |
| **PRESCRIPTION_COMPLETION** | H | H | (via metric) | (via metric) | C | C | – |

Any dimension is only enforced when the caller supplied it (`p_x IS NOT NULL`). `section_type`, `evidence_type`, `extractor_version`, `prompt_version`, `model` are hard when supplied for every taxonomy.

---

## 5. Match levels (§9) + ordering (§48)

- **exact**: `(p_format IS NULL OR e.format = p_format)` **AND** `(p_structure IS NULL OR e.structNorm IS NULL OR e.structNorm = queryStructNorm)`.
- **strong**: not exact, but `p11_3_format_family(e.format) = p11_3_format_family(p_format)` (same family, different exact format/structure).
- **broad**: hard dims passed, context differs beyond family.

Excluded rows never enter; they are tallied in `excluded{reason: count}`.

**Pattern ordering:** `(exactContextCount > 0) DESC`, then `strength` (`supported` 0 → `weak` 1 → `observation_only` 2 → `conflicting` 3), then `distinctRunCount DESC`, then `latestObservedAt DESC`, then `patternKey` lexical. Fully deterministic — proven (T14).

---

## 6. Behaviour by dimension

- **variant (§10):** hard for movement/prescription taxonomies. `intermediate` query never returns `rx`/`beginner`/`onramp` rows — they land in `excluded.incompatible_variant`. Proven T1.
- **gender (§11):** exact dimension only. `female` query never uses `male` or `universal` evidence → `excluded.incompatible_gender`. Universal↔sex_specific are genuinely different prescription decisions and are not bridged. Proven T3.
- **movement identity (§12):** `canonicalMovementId` when both sides have one, else exact normalised-name (`p11_norm_movement_name`). **No fuzzy / Levenshtein / trigram.** `Deadlift` never matches a `Thruster` query. Proven T2.
- **movement position (§13):** ignored for LOAD/DISTANCE/CALORIES (a Thruster load is useful at any station). Hard for REPS only when `structure = Sequence` or `format ∈ {Chipper, Ladder}` (`queryContext.positionIsHard`).
- **unit (§61):** hard for LOAD/DISTANCE. `kg` and `lb` numeric distributions are never mixed → `excluded.incompatible_unit`. Proven T4.
- **format (§14):** `C` for value taxonomies — exact-format evidence ranks above same-family evidence above cross-family. Proven T5 (AMRAP exact listed before For Time strong).
- **structure (§15):** `H` for REPS and REST_TIME; `C` (own pattern-key segment) for STRUCTURE, ROUNDS, DURATION and for value taxonomies. Repeated Rounds and Sequence are never collapsed. Proven T6.
- **correction (§17):** ordinary before→after evidence.
- **coach_completion (§34):** `evidence_type` is part of the pattern key, so a `VARIANT_COMPLETION` `coach_completion` pattern is never merged with a `LOAD` `correction` pattern. Proven T11.

---

## 7. Eligibility + reliability (§18 / §19)

Candidate pool = `eligibility = 'eligible'` **AND** `reliability = 'DETERMINISTIC'`. Everything else is excluded with a labelled reason: `ambiguous_reliability`, `ambiguous_eligibility`, `unsupported_reliability`, `ineligible`. `AMBIGUOUS` reorder evidence appears in `excluded` diagnostics only — never as an active hint. Proven T12. Cosmetic edits were never stored by P11.2, so there is no cosmetic pool to filter.

---

## 8. Pattern aggregation (§22–§28)

**Pattern key** = `evidence_type | variant | (movement_id ?? movement_name) | gender_dimension | unit | format_family | structureNorm`.

Per pattern:
- `observationCount` (rows) vs **`distinctRunCount`** (distinct `ai_run_id`) — strength always uses distinct runs (§23). One run with several related deltas is not repeated experience. Proven T7 (3 runs → `distinctRunCount 3`).
- `beforeDistribution` / `afterDistribution` — `[{value, count}]`, count DESC. Exposed as **distributions**, never a normative target (§25). Proven T8 (`after` = `[{45:3}]`, `before` = `[{50:2},{52.5:1}]`, no "rule = 45").
- `exactContextCount` / `strongContextCount` / `broaderContextCount`.
- `earliestObservedAt` / `latestObservedAt` / `daysSinceLatest` — recency exposed as facts; used only as an ordering tie-break, no decay (§27).
- `sourceRunIds` (distinct, ≤ 25), `extractorVersions`, `promptVersions`, `models` (§32 / §33).

**conflictState (§49):**
- `CONSISTENT` — exactly one distinct `after_value`.
- `MIXED` — ≥ 2 distinct afters **and** the modal after appears in > 50 % of distinct runs. Proven T16.
- `CONFLICTING` — ≥ 2 distinct afters **and** no after has > 50 %. Proven T9. The conflict is surfaced, never resolved to one arbitrary value.

**strength (§28 / §50):** `conflicting` (if `conflictState = CONFLICTING`, regardless of count) · `supported` (≥ 3 distinct runs) · `weak` (2) · `observation_only` (1). Proven T7/T9/T10/T11. No numeric probability.

**Owner authority (§29):** even a `supported` pattern is advisory machine-readable context. No rule creation, no global promotion.

---

## 9. Positive acceptance context (§20 / §52 / §53)

`positiveContext` is derived **read-time** from the frozen `saved_output`, only for `LOAD / REPS / DISTANCE / CALORIES / PRESCRIPTION_COMPLETION` with a supplied `variant` + movement + field. `null` for every other taxonomy (§21 — no fabricated denominator).

```
comparableRunCount        — distinct accepted_* runs whose saved_output primary section
                            carries a comparable <variant> <movement> <field> instance
                            (unit / gender-mode matched where relevant)
correctionBearingRunCount — of those, runs with ≥ 1 matching eligible correction row
acceptedAsProposedRunCount — comparableRunCount − correctionBearingRunCount
byOutcome                 — {accepted_unchanged, accepted_cosmetic, accepted_semantic}
fieldLevelCorrectionRate  — correctionBearing / comparable, ONLY when comparable ≥ 3, else null
```

Production smoke against real evidence (`REPS / intermediate / Ring Row / universal`): `comparableRunCount 2`, `correctionBearingRunCount 1`, `acceptedAsProposedRunCount 1`, `fieldLevelCorrectionRate null` (< 3).

---

## 10. Output contract (§40 / §86)

```
{
  readModelVersion: "p11.3-read-model-v1",
  generatedAt, queryContext {...echo + structureNormalized + positionIsHard + warnings[]},
  patterns: [{ patternKey, evidenceType, taxonomyKind, variant, movementId, movementName,
               genderDimension, unit, formatFamily, structureNorm,
               distinctRunCount, observationCount, exactContextCount, strongContextCount, broaderContextCount,
               beforeDistribution[], afterDistribution[],
               earliestObservedAt, latestObservedAt, daysSinceLatest,
               conflictState, strength, sourceRunIds[], extractorVersions[], promptVersions[], models[] }],
  exactMatches: [{ evidenceId, runId, runCreatedAt, ...raw observation..., matchLevel }],
  broaderMatches: [ ...strong + broad raw observations... ],
  excluded: { <reason>: <count> },
  candidateTotals: { taxonomyRowsInGymWindow, matchedRows, matchedDistinctRuns, patternCount },
  positiveContext: { ... } | null
}
```

Facts, not prose (§86/§87). No personality statements. Both raw observations and aggregated patterns are present (§42); patterns stay traceable via `sourceRunIds` (§41).

**Limits (§47):** `p_max_patterns` clamped to `[1, 100]` (default 20); `p_max_observations` clamped to `[1, 500]` (default 50). Proven T15.

---

## 11. Security (§30 / §45 / §46)

- Public wrapper: `is_coach_or_admin(p_gym_id)` → raises `not authorized for gym …` otherwise (proven).
- anon `rpc/p11_retrieve_learning_hints` → `42501 permission denied` (REVOKEd from anon).
- anon `rpc/p11_3_retrieve_impl` → `42501 permission denied` (REVOKEd from anon **and** authenticated — engine not client-callable).
- Member → same wrapper → `is_coach_or_admin` false → raises.
- Every candidate query is `WHERE gym_id = p_gym_id`. No cross-gym pooling, no "similar gyms" (§30). Proven T13 (gym B evidence never returned for gym A).
- No dynamic SQL — all typed params, fixed statement with `(p_x IS NULL OR col = p_x)` guards (§46).

---

## 12. Invariants + immutability

- **No write** — the migration and both functions touch **no** table (structural test asserts zero INSERT/UPDATE/DELETE/MERGE) (§54).
- **No live-WOD read** — sources are exactly `ai_correction_evidence` + `ai_analysis_runs` (both frozen). Structural test asserts no `wods`/`workouts`/`wod_logs`/`skill_logs` FROM (§73).
- **No evidence mutation** (§42 — provenance preserved).
- **No member-log read** (§50).
- Canonical precedence (§6) documented: retrieval sits beneath every hard invariant (REST is timing, reps are structure, P10 snapshot-first, variant ≠ modification, Sequence ≠ Repeated Rounds, unknown gender never male) and can never reinterpret one.

---

## 13. Tests

- `src/p11_3RelationalRetrievalMigration.test.js` — 32 structural assertions.
- **Production integration (synthetic runs + evidence, real engine, `ROLLBACK`):**
  - T1/T2 exact variant + movement isolation → 1 pattern, `excluded.incompatible_variant = 2`, `incompatible_movement = 14`.
  - T3 gender → `female` pattern only, `incompatible_gender = 1`.
  - T4 unit → `kg` pattern, `incompatible_unit = 1`; distributions not mixed.
  - T5 format → AMRAP `exact` pattern ranked **above** For Time `strong` pattern.
  - T6 structure → Repeated Rounds and Sequence are distinct patterns; real AMRAP row `incompatible_format`.
  - T7/T8 → `distinctRunCount 3`, `CONSISTENT`, `supported`; `after [{45:3}]`, `before [{50:2},{52.5:1}]` — no "canonical target".
  - T9 conflict → 3 distinct afters, `CONFLICTING`, strength `conflicting`.
  - T10 single → `observation_only`, `distinctRunCount 1`.
  - T11 coach_completion → `VARIANT_COMPLETION` `coach_completion` pattern, `distinctRunCount 3`, `supported`; not merged with corrections.
  - T12 ambiguous → `excluded.ambiguous_reliability = 1`; never an active pattern.
  - T13 tenant → gym B evidence never returned for a gym A query.
  - T14 determinism → identical output across repeated calls.
  - T15 limits → `p_max_patterns = 1` returns 1 pattern.
  - T16 mixed → modal after > 50 % of runs → `MIXED`, strength `supported`.
- Full regression: **1860** vitest tests pass (the 10 failing files are the pre-existing Deno-EF-under-vitest `@std/assert` errors — unrelated). `vite build` clean; eslint clean.

---

## 14. Diagnostic examples (§84)

| Query | Matched | Excluded | Strength | Conflict |
|---|---|---|---|---|
| `LOAD int Thruster universal kg AMRAP` | 1 pattern, 3 runs, after `[{45:3}]` | 2 variant, 14 movement | `supported` | `CONSISTENT` |
| `LOAD int WallBall female kg AMRAP` | 1 pattern, `female` dim | 1 gender (`male` row) | `observation_only` | `CONSISTENT` |
| `LOAD int Snatch universal kg AMRAP` | 1 pattern, `kg` | 1 unit (`lb` row) | `observation_only` | `CONSISTENT` |
| `LOAD int Row universal kg AMRAP` | 1 pattern, 3 runs, after `[{40:1},{45:1},{47.5:1}]` | — | `conflicting` | `CONFLICTING` |
| `VARIANT_COMPLETION onramp AMRAP (coach_completion)` | 1 pattern, 3 runs, `evidenceType coach_completion` | — | `supported` | `MIXED` |

---

## 15. What P11.3 does NOT do

Retrieval: **implemented** (this doc). RAG / prompt injection / few-shot / dynamic prompt augmentation: **not started**. Embeddings / pgvector / vector search / external vector DB: **not started, none exist**. Fine-tuning / training files: **not started**. AI Analyze prompt / schema / model / `model_config`: **unchanged**. Member performance intelligence: **not started**. Global example promotion (D3): **not implemented** (owner-only future).

---

## 16. Backlog (unchanged)

**P11.x — Interval / Format-Param Learning Evidence Coverage** — P11.2 (D3=B) still does not capture `workSec` / `restPlacement` / `intervalSec` / `startReps` / `incrementReps` / Tabata / Chained params, so P11.3 cannot retrieve them. Not started; needs a new request.

## 17. Recommended next phase

**P11.4 — explicit prompt-adapter (owner-gated).** Given a `p11.3-read-model-v1` result for a candidate authoring context, decide *whether and how* a `supported`, non-`conflicting` pattern becomes a short factual hint in the `analyze-workout` request — with an audit trail, a kill switch, and an A/B measurement against the P11.1 acceptance metric. Do **not** start without an explicit owner decision.

---

**HARD STOP.** No prompt injection, no AI Analyze prompt change, no learning hints sent to OpenAI, no RAG, no embeddings, no member performance intelligence, no fine-tuning, no INC-10.
