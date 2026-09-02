# P11.4 — Controlled AI Analyze learning-hint injection + measurement

**Priority:** P11 / AI Learning Activation
**Date:** 2026-09-02
**Status:** **AUDIT COMPLETE — implementation BLOCKED on owner decisions D1 + D2** (§ "Owner decisions required"). D3 + D4 have recommended defaults and proceed once D1/D2 are set.
**Mode:** controlled · tenant-scoped · deterministic · auditable · fail-open · kill-switched · minimal prompt augmentation · **no embeddings / no vector / no fine-tuning / no member-performance / no global cross-tenant**

P11.4 is the first phase permitted to change AI Analyze behaviour. A learning hint is **historical tenant-specific evidence**, never a rule.

---

## 1. Audit (§6) — the live Analyze path, evidence-tagged

`supabase/functions/analyze-workout/index.ts` + `prompt.ts` (read this session):

| Step | Detail | Tag |
|---|---|---|
| Request body | `{ workout: string, gymId?: string }` — raw text + optional gym id. **No structured fields.** | **PROVEN** |
| Tenant resolution | server-side: `Authorization: Bearer` → `anonClient.auth.getUser` → `caller.id` → `admins`/`coaches` rows → `callerGym`. `provGymId = (gymId && gymId === callerGym) ? gymId : callerGym`. A client-supplied `gymId` is **only** honoured when it equals the caller's own gym. `canRecord = !!provGymId`. | **PROVEN** (§7 / §56 satisfied by existing code) |
| Pre-model context available | `workout` (raw text), `provGymId`, `gymMovementNames` (from `movements` where `gym_id = provGymId OR gym_id IS NULL`). `matchBenchmark(workout)` = exact benchmark-name lookup only. | **PROVEN** |
| Deterministic pre-analysis parser | **None.** All structure comes from the model (`toWorkoutAnalysis(flat, workout)` runs **after** the OpenAI call). | **PROVEN** |
| Model call | **single** `callOpenAiWithRetry({ systemPrompt: buildSystemPrompt(gymMovementNames), userContent: workout, jsonSchema: WORKOUT_ANALYSIS_JSON_SCHEMA })`. `gpt-5-mini` (`OPENAI_MODEL` env), `MODEL_CONFIG = {api:'responses', reasoning_effort:'low', store:false, timeout_ms:45000, retry:1}`. | **PROVEN** |
| Prompt shape | one system string; hard rules ("Reguli:") are the **last** block; ends with "Raspunde DOAR cu date derivate din textul dat - nu copia exemple din acest prompt." | **PROVEN** |
| Provenance | `recordRun(admin, {...provCommon, status, ...})` inserts one `ai_analysis_runs` row **after** the model call; returns `aiRunId`. `provCommon` = `{model, model_config, prompt_version, schema_version, transform_version, gym_id, coach_id, input_text, input_hash}`. Best-effort / fail-open. | **PROVEN** |
| Run id timing | the `ai_run_id` does **not** exist until after the model call. | **PROVEN** |
| P11.1 table status | closed; immutability trigger enumerates a fixed write-once column set. | **PROVEN** |
| P11.3 retrieval | `p11_retrieve_learning_hints(p_gym_id, p_taxonomy, …)` — tenant-guarded, needs structured dims (`variant, movement, gender_dimension, unit, format, structure`). | **PROVEN** (P11.3 shipped) |

**The core finding:** retrieval must happen **before** the model call (to influence generation), but **no structured workout representation exists at that point** — only raw text. This is exactly the §11 / §95.A tension.

### 1.1 What IS deterministically derivable from raw text pre-model

| Dimension | Method | Confidence |
|---|---|---|
| **movement** | lexical match of `gymMovementNames` + `CANONICAL_MOVEMENTS` + `MOVEMENT_ALIASES` against the text (word-boundary, alias, naive plural) | **HIGH** for exact catalog-name hits (the coach's own vocabulary) |
| **variant** | line-leading label regex: `RX:` / `Rx` / `Intermediate:` / `Beginner:` / `Scaled:` / `On-?Ramp:` / `Masters:` (→ canonical `rx/intermediate/beginner/onramp`) | **HIGH when present**, unknown otherwise |
| **unit** | `kg` / `lb` / `lbs` token adjacent to a number | **HIGH when present** |
| **gender dimension** | slash notation `\d+/\d+\s*(kg|lb)` or `M ?\d+ ?/ ?F ?\d+` → `sex_specific`; else `universal` | **HIGH** |
| **format** | leading token: `AMRAP` / `For ?Time` / `EMOM` / `Tabata` / `RFT` / `Chipper` / `Ladder` / `Death ?By` / `Intervals` | **MEDIUM** (ambiguous cases exist; the model's own format choice is authoritative post-hoc) |
| **structure** (`Sequence` vs `Repeated Rounds`) | — | **NOT derivable** — a subtle model judgment (see `prompt.ts` PARAMETER_RULES `formatConfig.structure`) |
| **movement position** | station order in a labelled list | LOW pre-model; only meaningful for Sequence/Chipper which need structure anyway |

→ **LOAD**, **STRUCTURE** (format-keyed) and **VARIANT_COMPLETION** (scaling-tier-keyed) retrieval are feasible pre-model with deterministic input. **REPS / ROUNDS / REST_TIME / DURATION** are not (they need `structure` — hard in P11.3 — or `movement_position`).

---

## 2. Owner decisions required (§95) — implementation is BLOCKED on D1 + D2

### D1 — Retrieval timing: single-pass deterministic subset vs two-pass model pipeline (§11 / §13 / §95.A + §95.B)

| | **A — single-pass + deterministic pre-model lexical retrieval, restricted taxonomy set** (recommended) | **B — two-pass structured refinement** |
|---|---|---|
| Flow | derive `{movement, variant-label, unit, gender, format}` deterministically from raw text → P11.3 query for **LOAD / STRUCTURE / VARIANT_COMPLETION** only → serialize exact/supported/consistent hints → **one** OpenAI call with the hint section appended | pass 1 = existing Analyze → P11.3 query from the **structured candidate** (full precision incl. `structure`, `movement_position`) → pass 2 = second OpenAI call with candidate + hints → transform pass-2 output |
| Extra model calls | **0** | **+1 per Analyze** (≈ +11 s latency, ≈ 2× cost, ≈ 2× token spend) |
| Retrieval precision | high for LOAD/STRUCTURE/VARIANT_COMPLETION; **REPS/ROUNDS/REST_TIME not covered** (no `structure`) | full — every taxonomy, exact structure/position |
| Recall | reduced for workouts with no variant label / ambiguous format; grows as coaches paste labelled workouts (they already do) | maximal |
| 45 s OpenAI timeout risk | unchanged | pass 2 must fit the remaining budget; tighter |
| Surface / rollback | small — one prompt block + one retrieval call, behind the kill switch | large — a second model pipeline, second transform/validate, cost controls |
| Mission stance | §11/§13 Option C ("activate only context types derivable deterministically") | §13: "Do NOT implement a two-pass model pipeline without owner approval" |

**Recommendation: A.** Precision over recall for v1. The deterministic subset (LOAD load-corrections, STRUCTURE Repeated↔Sequence, VARIANT_COMPLETION tier omissions) covers the owner's stated primary cases (§1 Thruster load, §22 structure, §19 tier completion). B stays available as a later phase if SHADOW-mode measurement shows the covered recall is materially insufficient.

### D2 — Learning provenance storage: companion table vs extend `ai_analysis_runs` (§33 / §95.C)

Must persist per run: `learning_mode` (`off/shadow/active`), `learning_read_model_version` (`p11.3-read-model-v1`), `learning_hint_count`, `selected_learning_hints` (jsonb, whitelisted fields only), `retrieval_status` (`ok/failed/skipped/disabled`), `retrieval_latency_ms`, `learning_query_context` (jsonb — what was derived + queried).

| | **A — new companion table `ai_analysis_run_learning`** (recommended) | **B — add nullable columns to `ai_analysis_runs`** |
|---|---|---|
| P11.1 closed schema | untouched | reopened — the immutability trigger's write-once list must be extended |
| Shape | 1:1 by construction (`ai_run_id` PK/FK → `ai_analysis_runs` ON DELETE CASCADE); append-only; own RLS mirroring `ai_analysis_runs_select`; own immutability trigger | fewer objects; fields sit beside the run |
| Write path | EF writes it best-effort right after `recordRun` returns the id (same fail-open pattern) | fields folded into the existing `recordRun` insert |
| Precedent | matches P11.2's "separate append-only ledger keyed by run id" | — |
| Migration risk | additive, isolated | touches the P11.1 immutability contract |

**Recommendation: A.** Keeps P11.1 genuinely frozen; append-only; forward-compatible; the established Forge pattern.

### D3 — Activation default + kill switch (§9 / §10 / §87) — recommended default, proceeds with D1/D2

`Deno.env.get("P11_LEARNING_HINTS_MODE")` ∈ `{off, shadow, active}` via `supabase secrets set` (no redeploy, no schema change, evidence untouched). **First-deploy default: `off`.** Rollout: `off` (verify baseline) → `shadow` (verify tenant/selection/sanitization/latency/provenance, prompt unchanged) → `active` (owner-controlled smoke).

### D4 — Hint eligibility thresholds (§15-§18 / §95.E) — recommended defaults, proceeds with D1/D2

v1 injects a pattern **only if** all hold: correct tenant · `eligibility='eligible'` · `reliability='DETERMINISTIC'` · `evidence_type ∈ {correction, coach_completion}` · `strength='supported'` (≥3 distinct runs) · `conflictState='CONSISTENT'` (MIXED excluded) · `matchLevel='exact'` (strong/broad excluded) · variant/gender/unit/movement all matched. Max **5** hints, most-specific/strongest first, factual non-normative wording. `observation_only` / `weak` / `conflicting` / MIXED → never injected, diagnostics only.

---

## 3. Proposed design (pending D1 = A, D2 = A)

### 3.1 Architecture

```
analyze-workout EF
  ├─ resolve tenant (existing)  ──────────────────────────────────────────┐
  ├─ mode = env P11_LEARNING_HINTS_MODE  (off → skip everything below)     │
  ├─ deterministic pre-parse(workout, gymMovementNames)                    │
  │     → { format?, detected: [{ movement, movementId?, variant?, unit?, genderDim }], scalingLabelsPresent }
  ├─ for each safe query (LOAD per detected triple; STRUCTURE per format;   │
  │     VARIANT_COMPLETION per absent scaling tier):                       │
  │       p11_retrieve_learning_hints(provGymId, …)   [timeout ~2s, fail-open]
  ├─ selectHints(readModels)  → ≤5 exact/supported/consistent patterns     │
  ├─ serializeHints(selected) → { machineHints[], promptFragment }         │
  ├─ mode = shadow → prompt UNCHANGED; record machineHints                 │
  ├─ mode = active → systemPrompt += "\n\n" + FORGE_HISTORICAL_EVIDENCE_HEADER + promptFragment
  ├─ callOpenAiWithRetry(...)  (unchanged otherwise)                       │
  ├─ recordRun(...)  → aiRunId  (unchanged)                                │
  └─ best-effort INSERT ai_analysis_run_learning { ai_run_id, mode, read_model_version,
        hint_count, selected_learning_hints, retrieval_status, retrieval_latency_ms, query_context }
```

Retrieval is **Edge-Function-side only**; the client never sends hints (§7). Any retrieval error → `retrieval_status='failed'`, 0 hints, Analyze continues unchanged (§8 / §51).

### 3.2 Serializer + sanitization (§27-§29)

Whitelist-only. A hint object carries **exactly**: `taxonomyKind, variant, movementName (canonical/normalised only), unit, format, structureNorm, evidenceType, distinctRunCount, beforeDistribution, afterDistribution, conflictState`. **Never** `input_text`, notes, titles, `source_delta`, UUIDs, or any free text. `movementName` is re-normalised through `p11_norm_movement_name` before serialisation; the prompt fragment is assembled from fixed sentence templates with numeric/enum slots only — no historical string can carry `"ignore previous instructions"` style content because no historical string is interpolated verbatim beyond a catalog movement name.

### 3.3 Prompt fragment (§30 / §55) — factual, non-normative, below the hard rules

```
FORGE TENANT-SPECIFIC HISTORICAL COACH EVIDENCE (advisory, not rules)
These are historical observations from this gym's own prior AI analyses. The
current workout's text and Forge's canonical rules above remain authoritative.
Do not apply an observation when the context does not fit. Do not invent
patterns beyond what is listed.
- Historical coach evidence: in 3 prior comparable Intermediate Thruster load
  corrections, AI proposals were changed to 45 kg.
- Historical coach evidence: in 3 comparable AMRAP analyses, the coach changed
  the structure from Repeated Rounds to Sequence.
- Historical coach evidence: in 4 prior comparable analyses, the coach added the
  OnRamp variant after AI analysis omitted it.
```

Bounded: ≤5 lines, ≤ ~700 chars total (hard cap, recorded as `learning_hint_chars`). No `always/must/should/correct/required`.

### 3.4 Versions (§31)

`PROMPT_VERSION` → `analyze-prompt-2026-09-02-p11-4` (bumped; behaviour changes in `active` mode). `SCHEMA_VERSION` / `TRANSFORM_VERSION` **unchanged** (Structured Outputs + transform untouched, §54). New constant `LEARNING_SELECTOR_VERSION = 'p11.4-selector-v1'` recorded per run.

### 3.5 Measurement (§93)

`p11_learning_effect_stats(p_gym_id, p_from, p_to, p_prompt_version, p_model)` — read-only, tenant-guarded, joins `ai_analysis_runs` ⋈ `ai_analysis_run_learning`. Reports **by `learning_mode`**: `runs_total, saved_total, accepted_unchanged, accepted_cosmetic, accepted_semantic, semantic_acceptance_rate, avg_hint_count, retrieval_failure_count`. Version-aware (never compares across `prompt_version`/`model`). No dashboard. **No causal claim from small samples (§94).**

### 3.6 Self-reinforcement guard (§38)

An `active`-mode Analyze whose hint said "45 kg" and whose output was 45 kg and which the coach accepted → P11.2 stores **no** correction row (it only stores corrections/completions), so it never becomes independent "coach wants 45" evidence. `p11_learning_effect_stats` keeps `learning_mode` provenance so accepted-as-proposed `active` runs are always separable from organic acceptance. Documented.

---

## 4. Test plan (on approval) — §60-§84

Zero-history → 0 hints, request byte-equivalent to baseline · one-observation → 0 · weak (2 runs) → 0 · supported+consistent+exact → 1 factual hint, no normative words · conflicting → 0 · MIXED → 0 · wrong variant/gender/unit/movement → 0 · broad/strong match → 0 (v1 exact-only) · structure → 1 hint · coach_completion → 1 hint · sanitization (malicious movement/title/note fixture) → only whitelisted labels · max-hints (10 qualifying → 5) · OFF / SHADOW / ACTIVE modes · retrieval failure → fail-open · provenance (mode + count + read-model version + selected hints recorded; existing P11.1 fields intact) · save (accepted_unchanged lifecycle, 0 P11.2 rows) · coach corrects a learning output (P11.2 records it normally, `learning_mode` provenance retained) · tenant (gym A hint never in gym B Analyze) · token bound · determinism (same read model + config → same hints + order).

Regression gate: P11.4 + P11.3 + P11.2 + P11.1 + `analyze-workout` Deno + INC-11/11.1/09/08/07/06/04 + P10 + P9.5.x + security + `appHookOrderIntegrity` + eslint + build.

Migration safety (D2 = A): single additive migration for `ai_analysis_run_learning` + `p11_learning_effect_stats`; pre-check version/objects absent; register only the P11.4 version; **no `--include-all`, no `migration repair`**; historical ledger drift untouched.

Rollout: Phase A deploy `off` → Phase B `shadow` → Phase C `active` owner smoke.

---

## 5. Explicitly NOT in P11.4

Two-pass model pipeline (unless D1 = B). Embeddings / pgvector / vector search. Fine-tuning / training files. Member-performance intelligence (`wod_logs` / leaderboards / PRs / Journal / RX rates). Global cross-tenant / "similar gym" learning. Model change. Structured Outputs / transform / validator change. Automatic canonical-workout mutation. Any claim of AI improvement before sample accumulation.

## 6. Backlog (unchanged)

**P11.x — Interval / Format-Param Learning Evidence Coverage** — still not captured by P11.2, so P11.3/P11.4 cannot use it.

---

**HARD STOP — awaiting owner decisions D1 (single-pass subset vs two-pass) and D2 (companion table vs extend P11.1).** D3 (default `off` + kill switch) and D4 (exact / supported / consistent / ≤5 thresholds) proceed on the recommended defaults once D1/D2 are set. No Edge Function, prompt, schema, or migration has been changed by this audit. Member-performance intelligence / embeddings / vector search / fine-tuning / global cross-tenant learning / INC-10: not started.
