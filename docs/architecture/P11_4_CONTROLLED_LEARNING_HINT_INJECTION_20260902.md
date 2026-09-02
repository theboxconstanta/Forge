# P11.4 — Controlled AI Analyze learning-hint injection + measurement

**Priority:** P11 / AI Learning Activation
**Date:** 2026-09-02
**Status:** **CLOSED / GREEN.** Owner-approved D1 = A, D2 = A, D3 = A, D4 = A. Migration `20260902120000` applied; `analyze-workout` redeployed; smoke OFF / SHADOW / ACTIVE(zero-hint) / SAVE all pass. **Final production mode: `shadow`** (ACTIVE not proven with real evidence — no ≥3-run exact-consistent pattern exists in production yet).
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

---

## 7. Implementation (D1=A · D2=A · D3=A · D4=A) — CLOSED/GREEN 2026-09-02

### 7.1 Audit correction re STRUCTURE (§1)

`Structure: Sequence` / `Structure: Repeated Rounds` is the **only** deterministic pre-model source (`detectStructure` — a single literal regex). Structure is **never** inferred from layout / rep pattern / "max reps" / line count / format. When it is not literally declared, STRUCTURE patterns are **SHADOW-diagnostic only** and excluded from the ACTIVE selected-hint set (`selectAndSerialize({ allowStructure: false })`).

### 7.2 ACTIVE taxonomy allowlist (§2)

`["LOAD", "VARIANT_COMPLETION", "STRUCTURE"]` — and `STRUCTURE` only when `structureExplicit`. Everything else (`REPS`, `ROUNDS`, `REST_TIME`, `PRESCRIPTION_COMPLETION`, movement-level) is **not** ACTIVE-eligible in v1: REPS/ROUNDS/REST need `structure` or `movement_position` precision that cannot be built pre-model; PRESCRIPTION_COMPLETION needs a pre-model `field` + an omission prediction. They still run in SHADOW retrieval for diagnostics.

### 7.3 Deterministic pre-model context extractor (§3-§6)

`supabase/functions/analyze-workout/learningContext.ts` (`LEARNING_CONTEXT_VERSION = 'p11.4-context-v1'`, pure, Deno-tested):
- **movement**: exact canonical / alias / naive-plural match of `CANONICAL_MOVEMENTS` + `MOVEMENT_ALIASES` + the gym's own `movements.name` (longest-key-first; overlapping equal-length different-canonical spans → dropped + `ambiguous_movement:` diagnostic). No fuzzy, no embeddings.
- **variant**: line-leading label only — `RX:` / `Intermediate:` / `Beginner:` / `Scaled:` (→ `beginner`) / `On-Ramp:` (→ `onramp`) / `Masters:` (ignored — not a P11 variant).
- **unit / gender**: `\d+(/\d+)?\s*(kg|lb)` on the movement's **own line only** (never spills onto an adjacent line); slash → `sex_specific`.
- **format**: explicit leading canonical token only (`AMRAP` / `For Time` / `EMOM` / `Tabata` / `RFT` / `Chipper` / `Ladder` / `Death By` / `Intervals` / …). Never from layout.
- **structure**: §7.1.
- **absentScalingTiers**: of `intermediate/beginner/onramp`, those with no label → VARIANT_COMPLETION query candidates.

### 7.4 Retrieval (server-side, fail-open, §7-§8-§33)

In `index.ts` `gatherLearning(admin, mode, gymId, workout, gymMovementNames)`:
- `mode = off` → skip everything, `retrieval_status = 'disabled'`.
- else derive context → build queries (LOAD per `{movement, variant, unit}`; VARIANT_COMPLETION per absent tier when format explicit; STRUCTURE when structure+format explicit).
- `admin.rpc('p11_3_retrieve_impl', q)` for each, wrapped in `Promise.race` with a **2500 ms deadline**. Any failure (RPC error / timeout / deadline / malformed) → `retrieval_status = 'retrieval_failed'`, `error_class` slug, **0 hints, Analyze continues unchanged**.
- `service_role` gained `EXECUTE` on `p11_3_retrieve_impl` via the migration (still `REVOKE`d from anon/authenticated). The EF passes the **server-resolved** `provGymId`; the client can supply workout text only.
- `selectAndSerialize({ readModels, allowStructure })` → whitelisted machine hints + prompt fragment.
- `mode = shadow` → hints recorded, **fragment discarded**, prompt unchanged.
- `mode = active` → fragment injected, `prompt_fragment_sha256` recorded.

### 7.5 Selector + serializer (§15-§32)

`learningHints.ts` (`LEARNING_SELECTOR_VERSION = 'p11.4-selector-v1'`, `LEARNING_HINT_SERIALIZER_VERSION = 'p11.4-hint-serializer-v1'`):
- A pattern is eligible **iff** `strength = 'supported'` AND `conflictState = 'CONSISTENT'` AND `distinctRunCount >= 3` AND `strongContextCount = 0` AND `broaderContextCount = 0` AND `exactContextCount >= 1` AND taxonomy in the ACTIVE allowlist. observation_only / weak / MIXED / CONFLICTING / strong / broad → never.
- Order: `distinctRunCount` desc → `latestObservedAt` desc → `patternKey`. Max **5**.
- Templates (fixed sentences, numeric/enum/catalog-name slots only):
  - LOAD → `In N prior comparable {Variant} {Movement} load corrections, AI proposals were changed to {after} {unit}.`
  - VARIANT_COMPLETION → `In N prior comparable analyses, the coach added the {Variant} variant after AI analysis omitted it.`
  - STRUCTURE → `In N comparable {format} analyses, the coach changed the structure from {before} to {after}.`
- **Sanitisation**: movement name → strip `\r\n\t` + `[^A-Za-z0-9 &/'’.\-]`; **reject** if `> 34` chars or `> 5` words (a non-movement / injection string cannot enter the prompt). `afterValue` is the sole value of a CONSISTENT `afterDistribution`. No `always/must/should/correct/required`.
- Prompt fragment hard cap **1000 chars**, truncated by whole hints.

### 7.6 Prompt (§22-§24, §55)

`prompt.ts` `buildSystemPrompt(extraMovementNames, learningFragment = '')` — the fragment is inserted **after** the movement/alias blocks and **before** the hard `Reguli:` block, under the header `FORGE TENANT-SPECIFIC HISTORICAL COACH EVIDENCE (advisory, not rules)` with an explicit "the Forge rules below remain authoritative" clause. `PROMPT_VERSION` → **`analyze-prompt-2026-09-02-p11-4`** (bumped). `SCHEMA_VERSION` / `TRANSFORM_VERSION` **unchanged**. Model / `MODEL_CONFIG` / Structured Outputs schema **unchanged**.

### 7.7 Companion ledger (D2, §13-§16)

`public.ai_analysis_run_learning` — PK `ai_run_id` (1:1) FK → `ai_analysis_runs` `ON DELETE CASCADE`; 18 cols (`learning_mode`, `read_model_version`, `selector_version`, `serializer_version`, `prompt_version`, `retrieval_status` (7-value CHECK), `retrieval_latency_ms`, `error_class`, `query_context` jsonb, `candidate_hint_count`, `selected_hint_count`, `selected_hints` jsonb (whitelisted facts only), `prompt_fragment_chars`, `prompt_fragment_sha256`). RLS: `SELECT` `is_coach_or_admin(gym_id)`; `INSERT`/`UPDATE` restrictive `false` for `authenticated`; no `DELETE` policy. `BEFORE UPDATE` immutability trigger (UPDATE-only, never blocks cascade). Written best-effort by `recordLearning(admin, aiRunId, gymId, coachId, rec)` **after** `recordRun` returns the id — on every terminal path (ok / truncated / refused / invalid). `recordRun` failure ⇒ no orphan learning row.

### 7.8 Measurement (§35, §55-§56)

`p11_learning_effect_stats(p_gym_id, p_from, p_to, p_prompt_version, p_model)` — tenant-guarded, read-only, returns `byMode` → per `learning_mode`: `runs_total, runs_failed, saved_total, accepted_unchanged, accepted_cosmetic, accepted_semantic, semantic_acceptance_rate, retrieval_failed_count, avg_selected_hint_count`. Version-aware. Ships with a `note` disclaiming any causal AI-improvement claim (§56). **Self-reinforcement (§38/§54):** an `active` accepted-as-proposed run creates **no** P11.2 correction row (P11.2 only stores corrections/completions); `learning_mode` provenance keeps `active` runs separable from organic acceptance forever.

### 7.9 Tests

- `supabase/functions/analyze-workout/learning.test.ts` — **15 Deno tests** (context: variant/unit/gender/position, structure-only-when-declared, no-label⇒no-variant, gym-name detection, format-not-from-layout; selector: supported-consistent-exact ⇒ 1 factual hint (no normative words), weak/observation_only/conflicting/MIXED ⇒ 0, strong/broad ⇒ 0, STRUCTURE gated on `allowStructure`, VARIANT_COMPLETION distinct, non-allowlisted taxonomy ⇒ 0, injection string rejected outright, max-5 deterministic order, zero read models; `resolveLearningMode` fail-safe). All pass (with the 6 P11.1 EF tests → 21/21).
- `src/p11_4LearningHintProvenanceMigration.test.js` — **18 structural** (additive/P11.1 frozen, companion shape, append-only, RLS, tenant-guarded measurement, `service_role`-only engine grant, no embeddings). All pass.
- **Production DB integration** (`ROLLBACK`): companion immutability enforced, `service_role` can call `p11_3_retrieve_impl`, cascade delete removes the companion row, stats aggregate by mode.
- Full regression: **1878** vitest pass (11 failing files = pre-existing Deno-EF-under-vitest `@std/assert` loader errors, now incl. `learning.test.ts` — unrelated). `deno check` clean. `vite build` clean.

### 7.10 Production smoke

| Smoke | Run | Result |
|---|---|---|
| **OFF** | `8079c73c` | `learning_mode off`, `retrieval_status disabled`, 0 hints, `prompt_fragment_chars 0`, companion row written, `prompt_version analyze-prompt-2026-09-02-p11-4`. |
| **SHADOW** | `71de4cf8` | context extracted end-to-end (`format AMRAP`, 4 movements w/ variant+unit+position, `absentScalingTiers [beginner,onramp]`), 6 queries, retrieval ran via `service_role` (**138 ms**), `no_matches`, 0 hints, **prompt unchanged**. |
| **ACTIVE / no qualifying hint** | `c17e24fc` (EMOM) | `learning_mode active`, retrieval ran, `no_matches`, **0 hints, no learning section**, normal AI result. |
| **SAVE (learning-active)** | `c17e24fc` | Save → `saved_at`+`wod_id` set, `outcome accepted_unchanged`, `edit_severity none` — **P11.1 lifecycle intact**; **0 P11.2 evidence rows** (self-reinforcement guard); companion row immutable. |
| **ACTIVE / qualifying hint** | — | Production has **no** ≥3-run exact-consistent pattern (4 evidence rows, none forming one). Not fabricated (§64). ACTIVE selection + serialization + injection are proven by the Deno test suite (LOAD golden, VARIANT_COMPLETION, STRUCTURE, sanitisation). **Smoke limitation stated.** |
| **Security** | — | anon `rpc/p11_3_retrieve_impl` → `42501` (P11.3). `p11_learning_effect_stats` tenant guard raises for a non-coach. Companion RLS: coach/admin SELECT only, no client write. Gym is server-resolved; client sends workout text only. |

**Final state:** 4 companion rows (off ×1, shadow ×1, active ×2), all modes distinguishable. `pg_extension` vector = 0. **Production mode = `shadow`** (`P11_LEARNING_HINTS_MODE` secret). Test workouts on 2026-09-24…09-26 (gym `c5ecbe2c…`) left as smoke artifacts.

### 7.11 Rollback

`P11_LEARNING_HINTS_MODE=off` (or unset) — instant, no redeploy, no schema change, evidence untouched. Full DOWN in the migration footer (`DROP TABLE ai_analysis_run_learning` + `DROP FUNCTION p11_learning_effect_stats` + `REVOKE … FROM service_role` + `DELETE` the ledger row). After `DROP TABLE`, the EF's best-effort companion insert silently no-ops (fail-open); `p11_3_retrieve_impl` still exists for P11.3.

### 7.12 Limitations

Recall is thin until (a) coaches paste variant-labelled workouts (they already do) and (b) ≥3 comparable corrections accumulate per context. REPS / ROUNDS / REST_TIME / interval-param learning is not ACTIVE-eligible (pre-model structure/position unknown). ACTIVE end-to-end injection is proven by tests, not a live qualifying production smoke. Format detection is medium-confidence; a mis-detected format only lowers a LOAD pattern's match level to `strong` (⇒ excluded), never mis-injects.

## 8. Recommended next phase (not started)

**P11.5 — controlled ACTIVE rollout + first measurement**, once real evidence accumulates: flip `P11_LEARNING_HINTS_MODE=active` for the owner's gym, run `p11_learning_effect_stats` weekly by `prompt_version`, and only then consider a two-pass design (D1 = B) if SHADOW-measured recall proves insufficient.

---

**HARD STOP.** Member-performance intelligence / embeddings / vector search / fine-tuning / global cross-tenant learning / two-pass Analyze / INC-10: not started. AI Analyze model, Structured Outputs schema, and transform are unchanged; hard Forge invariants remain authoritative above every learning hint.
