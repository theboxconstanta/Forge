# P11.5 — Learning calibration + controlled ACTIVE rollout

**Priority:** P11 / AI Learning Validation
**Date:** 2026-09-02
**Status:** **CALIBRATION GREEN — WAITING FOR NATURAL EVIDENCE.** Calibration tooling shipped + tested; production has **zero** naturally ACTIVE-eligible patterns, so production **remains SHADOW**. No owner decision required to stay SHADOW. **Not** CLOSED/GREEN (closure needs a real ACTIVE pattern + first ACTIVE smoke — §90.15/§90.16).
**Mode:** measure first · no new AI architecture · no new learning source · no relaxed thresholds · no two-pass · no embeddings · no member data

---

## 1. What shipped (minimal, read-only)

`supabase/migrations/20260902130000_p11_5_learning_calibration.sql` — **one** additive `SECURITY DEFINER` read-only function, **no table / index / trigger / RLS / schema change**, writes nothing, changes no mode.

`p11_learning_calibration_status(p_gym_id, p_from, p_to, p_taxonomy?, p_variant?, p_movement?) → jsonb`:

| Block | Content |
|---|---|
| `funnel` | AI runs → saved → runs-with-semantic-correction → P11.2 eligible evidence → distinct P11.3 patterns → observation_only / weak / supported → consistent-exact-supported → **active-eligible hints** → active-injected → coach acceptance (§7) |
| `patternMaturity[]` | per pattern: taxonomy, variant, movement, dimension, unit, format-family, structure-norm, `distinctRunCount`, `strength`, `conflictState`, exact/strong/broad counts, earliest/latest, before/after distributions, **`distanceToSupported = max(0, 3 − distinctRunCount)`**, **`blockedByConflict`**, **`activeEligible`**, `requiresExplicitStructurePreModel` (§9/§10/§11) |
| `modeCohorts` | off / shadow / active counts, **`shadowEligible`** (shadow + `selected_hint_count > 0`), **`hintExposed`** (active + `selected_hint_count > 0` + `retrieval_status = 'active_selected'`), `activeZeroHint`, **`shadowHintCoverage`** (§13/§23/§24) |
| `zeroHintReasons` | deterministic reason for every shadow/active zero-hint run: `mode_off` / `no_pre_model_context` / `no_matching_evidence` / `candidates_but_not_supported_exact_consistent` / `retrieval_failure` (§14) |
| `retrievalHealth` | retrieval runs, failures, `successRate`, avg / p95 / max latency (§15) |
| `learningEffectByMode` | per mode: runs, saved, accepted_*, `semanticAcceptanceRate`, **`promptVersions`** (version-aware, §16/§19/§20) |
| `correctionBurdenByMode` | per mode: avg / median / p90 **semantic** deltas per saved run (from the frozen `semantic_diff`; `severity ∈ {semantic, critical}` only — cosmetic never counts), zero-burden runs (§17/§18) |
| `coverage` | eligible evidence by taxonomy / variant / gender dimension / evidence type / top movements (§51/§55/§56/§57) |
| `preModelRetrievability` | eligible semantic corrections split into `singlePassRetrievable` (LOAD, VARIANT_COMPLETION), `structureExplicitOnly` (STRUCTURE), **`blockedNeedsStructureOrPosition`** (REPS, ROUNDS, REST_TIME, MOVEMENT_ORDER), `other` — the input to the two-pass decision (§53) |
| `rolloutGate` | `retrievalHealthGreen`, `naturalActiveEligiblePatternExists`, `thresholdUnchanged: true`, and a **`verdict`** that can only be `REMAIN_SHADOW_WAITING_FOR_NATURAL_EVIDENCE` or `ACTIVE_CANDIDATE_READY_OWNER_APPROVAL_REQUIRED` — **it never auto-activates** (§31/§85) |

### 1.1 No fourth truth (§11/§12/§71)

`active_eligible` is **not** a new algorithm. The function calls `p11_3_retrieve_impl` per distinct eligible-evidence context (bounded) for the strength/conflict/exactness computation, then applies the predicate **byte-identical to `learningHints.ts` `selectAndSerialize` (`p11.4-selector-v1`)**:

```
strength = 'supported' AND conflictState = 'CONSISTENT' AND distinctRunCount >= 3
AND strongContextCount = 0 AND broaderContextCount = 0 AND exactContextCount >= 1
AND taxonomy ∈ {LOAD, VARIANT_COMPLETION, STRUCTURE}
```

STRUCTURE additionally needs the raw input to literally declare the structure at query time — the calibration flags this (`requiresExplicitStructurePreModel`) since it cannot know it.

---

## 2. Production calibration (read-only, gym `c5ecbe2c…`, all time)

**Funnel** — 10 AI runs → 8 saved → 5 with a semantic correction → **4 eligible P11.2 evidence** → **4 distinct P11.3 patterns** → **4 observation_only, 0 weak, 0 supported, 0 consistent-exact-supported, 0 ACTIVE-eligible, 0 ACTIVE-injected**.

**Pattern maturity** — all 4 patterns: `strength observation_only`, `distinctRunCount 1`, `conflictState CONSISTENT`, `distanceToSupported 2`, `activeEligible false`:

| taxonomy | variant | movement | after | notes |
|---|---|---|---|---|
| REPS | intermediate | ring row | 10→9 | blocked pre-model (needs structure/position) |
| REPS | onramp | ring row | 6→5 | blocked pre-model |
| REPS | intermediate | thruster 30kg | 10→8 | blocked pre-model (name carries the weight — a known P11.2 edge) |
| STRUCTURE | — | — | →Sequence | `requiresExplicitStructurePreModel: true` |

**modeCohorts** — off 8, shadow 1, active 1; `hintExposed 0`, `activeZeroHint 1`, `shadowEligible 0`, `shadowHintCoverage 0.0`.

**zeroHintReasons** — `no_matching_evidence: 2` (both the SHADOW and ACTIVE-zero runs had usable pre-model context but no matching supported evidence). **Healthy conservatism, not a broken retrieval path.**

**retrievalHealth** — failures 0, `successRate 1.0`, avg 112.5 ms, p95 135.5 ms, max 138 ms. **GREEN.**

**learningEffectByMode** — off (7 saved, `semanticAcceptanceRate 0.2857`, mixed prompt versions `inc11` + `p11-4`), active (1 saved, 1.0), shadow (0 saved). **Samples far too small for any conclusion — descriptive only, and prompt versions differ.**

**correctionBurdenByMode** — off avg **0.857** semantic deltas / saved run (median 1, p90 1); active avg 0 (n=1). Descriptive only.

**preModelRetrievability** — `singlePassRetrievable 0` · `structureExplicitOnly 1` · **`blockedNeedsStructureOrPosition 3`** · other 0. → Of the 4 natural eligible corrections, **3 are REPS** (which single-pass cannot retrieve) and 1 is STRUCTURE. **Zero LOAD evidence.** Early signal that single-pass recall may be thin for this gym's correction mix (caveat: n=4, and these rows were created by P11.1–P11.4 smoke usage, not organic coaching).

**rolloutGate verdict — `REMAIN_SHADOW_WAITING_FOR_NATURAL_EVIDENCE`** (`naturalActiveEligiblePatternExists: false`, `retrievalHealthGreen: true`, `thresholdUnchanged: true`).

---

## 3. Tests

- `src/p11_5LearningCalibrationMigration.test.js` — **20 structural** (read-only, no new persistence, ACTIVE-parity with `p11.4-selector-v1`, no threshold drift, verdict never auto-activates, tenant-guarded, no member data, no embeddings).
- **Production integration** (synthetic runs + evidence layered on the 4 real rows, `ROLLBACK`): a fabricated LOAD/intermediate/Thruster pattern with **3 distinct runs, all `after = 45`** → `strength supported`, `conflictState CONSISTENT`, `distanceToSupported 0`, **`activeEligible true`** (parity with P11.4). A LOAD/onramp/Snatch pattern with 3 distinct runs but afters `45/40/47.5` → `CONFLICTING`, `blockedByConflict true`, `distanceToSupported 0` but **`activeEligible false`** (§66/§70). A gym-B Thruster evidence row → **never merged** into gym A's pattern (`distinctRunCount` stays 3 — tenant isolation §80). `rolloutGate.verdict` correctly flips to `ACTIVE_CANDIDATE_READY_OWNER_APPROVAL_REQUIRED` when an eligible pattern is present. Correction-burden delta counting excludes cosmetic. `shadowEligible 1`, `shadowHintCoverage 0.5`.
- Full regression: **1898** vitest pass (11 failing *files* = pre-existing Deno-EF-under-vitest `@std/assert` loader errors — unrelated). `deno test analyze-workout/` 21/21. `vite build` clean.

Migration safety: single additive migration; pre-check version/objects absent; registered only `20260902130000` (total 205→206). No `--include-all`, no `migration repair`, no historical reconciliation.

---

## 4. Self-reinforcement + exposure vs evidence (§54/§60/§61/§62)

An ACTIVE hint-aligned run the coach accepts unchanged creates **no** P11.2 correction row (P11.2 only stores corrections/completions — verified again in the P11.4 SAVE smoke: 0 evidence rows). The calibration therefore counts **hint exposure** (`hintExposed`, from the P11.4 companion ledger) entirely separately from **correction evidence** (`p11_2_eligibleEvidence`, from `ai_correction_evidence`). A supported pattern injected into many future runs does not inflate its own `distinctRunCount`.

---

## 5. Thresholds — unchanged (§45–§50)

3 distinct runs · `supported` · `CONSISTENT` · `matchLevel = exact` · `max 5` — **not touched.** `weak`, `observation_only`, `MIXED`, `CONFLICTING`, `strong`, `broad` remain excluded from ACTIVE. `rolloutGate.thresholdUnchanged = true` and the structural test asserts no `distinct_run_count >= 1|2` appears in an eligibility context.

---

## 6. Single-pass limitations (§52) + two-pass decision input (§53)

Still explicit and unfixed: STRUCTURE needs an explicit pre-model declaration; REPS needs structure/position; ROUNDS needs structure; REST_TIME needs structured timing; interval params are absent from P11.2 (backlog **P11.x**). The calibration's `preModelRetrievability` block quantifies, per gym, how much of the useful correction evidence is single-pass-retrievable vs blocked — the data that will decide whether **P11.6 (two-pass structured refinement)** is worth its cost/latency. **Current gym reading: 0 single-pass-retrievable, 3 blocked (REPS), 1 structure — but n = 4 and non-organic.**

---

## 7. ACTIVE rollout gate (§31/§85) — NOT passed

| Gate | State |
|---|---|
| A retrieval health GREEN | ✅ (0 failures, ≤138 ms) |
| B tenant / security GREEN | ✅ (P11.3/P11.4 verified; calibration tenant-guarded, gym-scoped, no member data) |
| C ≥1 naturally occurring ACTIVE-eligible pattern | ❌ **none** (all 4 patterns are `observation_only`) |
| D SHADOW proves the expected hint for a real matching Analyze | ❌ (no eligible pattern to match) |
| E–I serializer / no leakage / latency / rollback / smoke context | E rollback proven (P11.4 §7.11: `P11_LEARNING_HINTS_MODE=off`, no redeploy); rest N/A until C |

**→ Production stays SHADOW. No first real ACTIVE hint-exposed Analyze is performed (§86/§94).**

---

## 8. Rollback

`P11_LEARNING_HINTS_MODE` env: `active → shadow → off` — instant, no redeploy, no schema change, no data deletion (proven in P11.4). The calibration function DOWN: `DROP FUNCTION p11_learning_calibration_status` (additive, nothing references it).

---

## 9. Quality checkpoints (defined, not yet reached)

First real ACTIVE exposure → owner-approved, narrow (LOAD taxonomy), one naturally-matching real Analyze, then **return to SHADOW immediately** unless the owner approves continued ACTIVE (§87). Quality checkpoints at **10** and **25** hint-exposed saved runs (§39/§40/§41) — product calibration thresholds, **not** statistical significance. **No causal AI-improvement claim at any checkpoint below a meaningful sample (§56/§94).**

---

## 10. Interim verdict + next steps

**P11.5 — CALIBRATION GREEN / WAITING FOR NATURAL EVIDENCE.**

- Calibration read model, learning funnel, pattern maturity, P11.4 eligibility parity, zero-hint reasons, retrieval health, mode cohorts, correction burden, hint-exposed cohort, self-reinforcement guard, tenant/security, rollback — **all GREEN and measurable.**
- Closest patterns to ACTIVE: the two REPS/intermediate patterns and the REPS/onramp pattern (each `distanceToSupported 2`) — but REPS is **not** ACTIVE-injectable single-pass regardless of distinct-run count. The STRUCTURE pattern (`distanceToSupported 2`) would need explicit `Structure:` declaration in future inputs.
- **What natural coach usage would make an ACTIVE candidate appear:** ≥3 comparable **LOAD** corrections (same variant + movement + unit + gender dimension, same after-value each time) on real workouts — or ≥3 comparable **VARIANT_COMPLETION** omissions the coach fills — or ≥3 comparable explicit-structure changes.
- **Do NOT manufacture corrections (§6/§91).** Re-run `p11_learning_calibration_status` periodically; when `rolloutGate.verdict` becomes `ACTIVE_CANDIDATE_READY_OWNER_APPROVAL_REQUIRED`, return the candidate details to the owner and request approval for the first real ACTIVE exposure.

### Recommended next phase (not started — §92)

Choose after real data: **A** continue single-pass ACTIVE calibration (default); **B** P11.6 two-pass structured refinement *only if `blockedNeedsStructureOrPosition` dominates useful corrections*; **C** P11.x interval/format-param coverage *only if interval corrections become common*; **D** member-performance intelligence *only after coach-programming learning is stable*; **E** fine-tuning *not recommended yet*.

---

**HARD STOP.** Production mode = **SHADOW**. No first real ACTIVE hint exposure without an explicit owner gate. Two-pass Analyze / member-performance intelligence / embeddings / vector search / fine-tuning / global learning / INC-10: not started.
