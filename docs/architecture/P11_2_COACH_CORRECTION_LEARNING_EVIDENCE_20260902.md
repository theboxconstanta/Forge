# P11.2 — Coach Correction Capture + Learning Evidence

**Priority:** P11 / AI Learning Foundation
**Date:** 2026-09-02
**Status:** AUDIT COMPLETE — **implementation BLOCKED on owner decisions D1–D3 (§ "Owner decisions required")**
**Mode:** evidence-first · deterministic · tenant-safe · minimal · reversible · **no retrieval / no RAG / no embeddings / no fine-tuning**

Retrieval remains **OFF**. Nothing in P11.2 feeds evidence into a prompt, a few-shot block, a training file, or the model. P11.2 produces *queryable evidence only*.

---

## 0. What P11.1 already gives us (frozen)

`ai_analysis_runs` (migration `20260902090000`, CLOSED/GREEN):

| Column | Meaning | Retention |
|---|---|---|
| `normalized_output` jsonb | `sectionsFromAiAnalysis(json)` — the **exact `EditableSection[]` draft** that entered the Builder | kept indefinitely |
| `saved_output` jsonb | the **`EditableSection[]` the coach finally saved** (`legacyPayloadFromSections` source) | kept indefinitely |
| `semantic_diff` jsonb | `diffAiVsSaved(normalized_output, saved_output)` → `{ deltas[], counts{}, severity, outcome }` | kept indefinitely |
| `edit_severity`, `outcome` | `none/cosmetic/minor/semantic/critical` · `accepted_unchanged/accepted_cosmetic/accepted_semantic/abandoned/save_failed` | kept indefinitely |
| `gym_id` (NN), `coach_id`, `wod_id`, `workout_id` | trusted tenant + actor + canonical linkage | kept indefinitely |
| `prompt_version`, `schema_version`, `transform_version`, `model`, `model_config` | reproducibility | kept indefinitely |
| `input_text` | coach paste | **NULL after 90 d** |
| `raw_output` | model flat JSON | **NULL after 365 d** |

Once `saved_at` is set, the immutability trigger **freezes** `saved_at / wod_id / workout_id / saved_output / semantic_diff / edit_severity / outcome`. `normalized_output` is write-once from the start. → **the entire P11.2 source is immutable and survives retention.** (§71 ✓)

`semantic_diff` is computed **client-side** at Save by the two hand-synced parity-tested modules `src/aiProvenanceDiff.js` ↔ `forge-admin-web/src/features/programming/aiProvenanceDiff.ts`, then written to the row. **P11.2 must not create a third diff engine (§59).**

---

## 1. Canonical variant vocabulary audit (§6 — MANDATORY)

**Canonical persisted variant keys — `['rx', 'intermediate', 'beginner', 'onramp']`.**
Source of truth: `prescriptionContract.(ts|js)` `VARIANT_KEYS` (line 15), enforced by the DB trigger `validate_movement_prescriptions()` (migration `20260829090000`) and by `sectionEditing.ts` `SCALING_KEYS`.

| Concept | Canonical id | Notes |
|---|---|---|
| RX | `rx` | always present; the tier the model actually produces |
| Intermediate | `intermediate` | |
| Beginner | `beginner` | **UI sometimes labels this "Scaled" — canonical storage is `beginner`.** Learning evidence stores `beginner`. |
| On-Ramp | `onramp` | **no underscore.** The *read-side legacy* type `ScalingLevel` (`types.ts`) spells it `on_ramp`; the editor/prescription canon is `onramp`. `variantKeyFromLevel()` normalises `[_\s-]` out. AI mapper `AI_LEVEL_TO_EDITOR_KEY` maps both `on_ramp`→`onramp` and `onramp`→`onramp`. |

`wods` legacy columns per variant: `movements_{k}` (text[]), `notes_{k}`, `{k}_weight_male`, `{k}_weight_female`. Canonical structured store: `wods.movement_prescriptions` (`{ version, variants: { [k]: { movements: MovementInstance[] } } }`).

**Gender is not a variant.** It is a *dimension inside a metric spec*:
`RepsSpec | LoadSpec | DistanceSpec | CaloriesSpec` each have `mode: 'universal' | 'sex_specific'` (`reps` also `'text'`); `sex_specific` → `{ male: number|null, female: number|null, unit? }`. `resolveSpec()` returns a `null` value for unknown gender — **unknown gender never silently resolves to male** (global invariant upheld).

---

## 2. `EditableSection` / `MovementInstance` shape (the P11.2 source shape)

```
EditableSection {
  typeKey: 'warmup'|'skill'|'metcon',  isPrimary, scored,  legacySlot,
  title, format, formatConfig: {...},        // primary section only for variants:
  variants: { rx|intermediate|beginner|onramp: {
    instances: MovementInstance[],            // CANONICAL editable representation
    movements: string[],                      // DERIVED legacy text (regenerated from instances on save)
    weight: { male: string, female: string }, // DERIVED lossy legacy mirror
    note: string
  }}
}
MovementInstance { instanceId, name, canonicalMovementId?,  reps?, load?, distance?, calories? }   // metrics are specs
```

**AI weight round-trip (important):** `buildVariants()` calls `hydrateInstancesFromLegacy(rxLines, {male:null,female:null})` — but `rxLines` come from `composeMovementLine(m)` which **appends `@ 60/40kg`** when the model returned a weight, and `hydrateInstancesFromLegacy` → `parsePastedMovementLine` **parses `@ x/y kg` back into `instance.load`**. → **AI load proposals do land in `instances[].load` as `sex_specific`/`universal` specs**, so `diffAiVsSaved` sees load edits. (Edge case: a model that writes the weight *into the movement name* yields `nameAlreadyHasWeight` and no `instance.load` — rare, documented as a limitation.)

---

## 3. P11.1 `semantic_diff` coverage matrix (§5 — evidence-tagged)

`sectionFormatSig()` compares exactly: `format`, `structure` (AMRAP `null ≡ 'Repeated Rounds'`), `scoreType`, `durationSec` (+ `timeCapSec`/`totalDurationSec` aliases), `restSec`, `rounds` (`roundCount ?? rounds ?? totalRounds` — **roundCount-first, INC-07 compliant**). Per variant (`rx` always; `intermediate/beginner/onramp` **only if the AI baseline populated that tier**): positional movement diff over `reps/load/distance/calories` spec-tuples + identity + order + note.

| Correction domain | In `semantic_diff`? | Delta `kind` | Tag |
|---|---|---|---|
| format | ✅ | `format_changed` (critical) | **PROVEN** |
| structure Repeated↔Sequence | ✅ | `structure_changed` (critical) — INC-11 golden | **PROVEN** |
| score family | ✅ | `score_family_changed` (critical) | **PROVEN** |
| duration / time cap | ✅ | `duration_changed` (semantic) | **PROVEN** |
| rounds (semantic `roundCount`) | ✅ | `rounds_changed` (semantic) | **PROVEN** |
| rest seconds (`restSec`) | ✅ | `rest_changed` (semantic) | **PROVEN** |
| **work seconds (`workSec`)** | ❌ **not compared** | — | **GAP — D3** |
| **`restPlacement` (INC-07)** | ❌ **not compared** | — | **GAP — D3** |
| **interval/EMOM/DeathBy/AscAMRAP params** (`intervalSec`, `startReps`, `incrementReps`, Tabata `workSec/restSec`, Chained `stages`) | ❌ **not compared** | — | **GAP — D3** |
| movement identity / substitution | ✅ | `movement_substituted` (critical) | **PROVEN** |
| movement add / remove (carries `at` index) | ✅ | `movement_added` / `movement_removed` (semantic) | **PROVEN** |
| movement reorder | ✅ | `movement_reordered` (semantic) | **PROVEN** — ambiguous when a movement repeats (multiset key collision) → mark **AMBIGUOUS** |
| movement rename (same identity) | ✅ | `movement_renamed` (cosmetic) | **PROVEN** |
| reps (per movement, incl `sex_specific`) | ✅ | `reps_changed` (semantic) | **PROVEN** |
| load — incl **gender halves** | ✅ | `load_changed` (semantic); tuple `[null,[male,female],unit]` **carries both halves** | **PROVEN**; gender split is **LIKELY** (deterministic post-process of the stored tuple) |
| distance / calories (per movement) | ✅ | `distance_changed` / `calories_changed` (semantic) | **PROVEN** |
| note / title | ✅ | `note_changed` / `title_changed` (cosmetic) | **PROVEN** |
| section add / remove | ✅ | `section_added` / `section_removed` (critical if scored) | **PROVEN** |
| **variant the AI OMITTED, coach programs** (`intermediate/beginner/onramp` empty in baseline) | ❌ **tier skipped entirely** — zero deltas | — | **GAP — D2** |
| variant the AI populated, coach empties | ✅ (as per-movement `movement_removed`) | | **PROVEN** |
| RX corrections | ✅ (rx is always diffed) | as above, `variant:'rx'` | **PROVEN** |

**Repeated-movement position (§25):** deltas carry `at: i` (index within the variant list) → third-station edit is attributable to index 2, not index 0. **PROVEN** for add/remove/metric; **AMBIGUOUS** only inside a pure `movement_reordered`.

**Contamination already handled by P11.1:** `abandoned` / `save_failed` outcomes and `status<>ok` runs are separate from `accepted_*`; manual workouts never create an `ai_analysis_runs` row at all (Smoke C proved 0). P11.2 keys strictly off `outcome IN ('accepted_unchanged','accepted_cosmetic','accepted_semantic')` + `saved_at IS NOT NULL` + `status='ok'`.

---

## 4. Proposed evidence model (pending D1)

### 4.1 Learning unit (§8)

> One **semantic field correction** inside **one AI run → one section → one variant → one movement/prescription target → one canonical context**.

`run_id · section_index · variant · movement (canonicalMovementId|normName) · position · field · before → after`, independently queryable from every other unit of the same run.

### 4.2 Correction taxonomy (§14 — only Forge-supported fields)

`FORMAT · STRUCTURE · SCORE_FAMILY · DURATION · ROUNDS · REST_TIME` · *(WORK_TIME · REST_PLACEMENT — only if D3=A)* · `MOVEMENT_IDENTITY(substitution) · MOVEMENT_ORDER · MOVEMENT_ADD · MOVEMENT_REMOVE · REPS · LOAD · DISTANCE · CALORIES · SECTION_ADD · SECTION_REMOVE · NOTE(cosmetic) · TITLE(cosmetic)` · *(VARIANT_COMPLETION · PRESCRIPTION_COMPLETION — only if D2=A)*.

`reps` is always classified **structure**, never prescription (§20). `REST` is always **timing**, never a movement — no evidence row ever has `movement = 'Rest'` (§21). `structure_changed` (Repeated↔Sequence) is its own high-value kind (§15).

### 4.3 Reliability state (§37 / §38) — categorical, never a fake number

`DETERMINISTIC` (both sides structurally identified, canonical id or unambiguous name, before/after trustworthy) · `AMBIGUOUS` (reorder with a repeated movement, name-only identity that resolves to multiple catalog rows, tier the AI left empty and D2=B) · `UNSUPPORTED` (a domain outside `semantic_diff` coverage, e.g. `workSec` when D3=B) · `COSMETIC` (note/title/rename — recorded, excluded from programming-learning queries by default, §31).

### 4.4 Eligibility (§37)

`eligible` iff: `status='ok'` · `normalized_output` present · `saved_output` present · `wod_id` linked · field deterministically identified · before & after trustworthy · `gym_id` known · **no reconstruction from any mutable current WOD** (§11/§49 — the extractor reads ONLY the frozen P11.1 snapshots).

### 4.5 Approval lifecycle (§39) — P11.2 stops at capture

`captured` → `eligible` / `ineligible` / `ambiguous`. **No** `approved_for_tenant`, **no** `approved_global` in P11.2 (D3 unchanged: global promotion = owner only, not built here). One correction = one observation, never a rule (§46 — stated as a hard precedence rule in the doc footer).

### 4.6 Context for future relational retrieval (§44/§45) — derived, not duplicated

Per evidence row, a small deterministic **context fingerprint** copied from the frozen `saved_output` section: `{ format, structure, scoreType, durationSec, roundCount, sectionType, movementCanonicalIds: [...], repPattern: [...] }`. No workout blobs (the full before/after already live in the linked run). **No embeddings, no vector column.**

### 4.7 Extraction location (§57) — recommended: **DB, replayable**

A `SECURITY DEFINER` SQL function `p11_extract_correction_evidence(p_run_id uuid)` that reads the frozen `semantic_diff` (+ `normalized_output`/`saved_output` for D2), classifies, and upserts evidence rows — **idempotent** via `UNIQUE (ai_run_id, correction_path, extractor_version)` + `ON CONFLICT DO NOTHING`. Called by an `AFTER UPDATE ON ai_analysis_runs` trigger that fires exactly once on `saved_at NULL → NOT NULL`, wrapped in `BEGIN … EXCEPTION WHEN OTHERS THEN` so **extraction failure never rolls back the coach's Save-linkage** (§58). Also invocable manually for backfill / re-extraction after an `extractor_version` bump (§13/§48 — new version writes new rows, old rows untouched). **No third JS diff module; the classifier consumes the already-computed diff.**

### 4.8 RLS (§56) — mirrors `ai_analysis_runs`

anon: none · member: none · coach/admin: `SELECT` where `is_coach_or_admin(gym_id)` · client `INSERT`/`UPDATE`/`DELETE`: **none** (only the `SECURITY DEFINER` extractor writes). `gym_id` copied from the trusted run, never client-supplied. No cross-tenant read, no cross-tenant aggregate (§40).

### 4.9 Privacy (§42)

Evidence carries programming data only — movement names, canonical ids, numeric specs, format params. **No** member name / email / phone / DOB / profile / logs. `wod_logs` is **never read** (§7/§50). `coach_id` is referenced via the run, not re-copied.

### 4.10 Metrics (§52/§53) — read-only, tenant-guarded, no dashboard

`p11_correction_evidence_stats(p_gym_id, p_from, p_to, p_prompt_version, p_model)` → counts by `taxonomy_kind / format / structure / variant / movement / prompt_version / model / extractor_version`, ambiguous+ineligible counts, and — **separately** — `accepted_unchanged` run count as **positive evidence** (§32). **Denominator semantics (§53):** correction rate = `eligible corrections / eligible saved AI runs` (the run is the opportunity), **never** `corrections / correction rows`. Documented in the function comment.

---

## 5. Canonical-rule precedence (§60) — stated now, binding on every later phase

Learned evidence is **always beneath** these hard invariants and can never override them:
`REST` is timing, never a movement · `reps` are structure, never a prescription characteristic · P10 snapshot-first (historical truth from the frozen log, never the mutable WOD) · programmed variant ≠ performed modification · `Sequence` ≠ `Repeated Rounds` · member display name = `profiles.full_name` · gender = `members.gender`, unknown never male.

---

## 6. Owner decisions required (§75) — implementation is BLOCKED on these

### D1 — Evidence storage: **materialized table** vs **derived view**

| | Option A — `ai_correction_evidence` table (append-only, trigger + replayable extractor, `extractor_version`-stamped) | Option B — SQL view over `ai_analysis_runs.semantic_diff` |
|---|---|---|
| Field-level cross-run queries (§51/§52) | indexed, fast | jsonb-array unnest per query, slow |
| `semantic_diff` format may evolve | pinned by `extractor_version` | view silently reinterprets old runs (§48 violation) |
| Interpretation frozen at extraction time (§12) | yes | no |
| D2 omission evidence (needs `normalized`↔`saved` compare) | natural home | expensive in a view |
| New storage / migration | +1 table, +1 trigger, +1 function | none |
| Matches P11.1 precedent (separate append-only ledger) | yes | no |

**Recommendation: A.** All four mission "prefer-materialized" triggers hold (§9).

### D2 — AI omission / coach-completion evidence (§28/§29)

When the model returns **no** `intermediate/beginner/onramp` and the coach programs one, P11.1 emits **zero deltas** — the correction is invisible.

- **Option A (recommended):** the extractor additionally compares `normalized_output` vs `saved_output` at variant granularity and emits a **distinct** `evidence_kind = 'coach_completion'` (`variant_added` / `prescription_completed` / `timing_completed`) — never merged into `correction` rows.
- **Option B:** out of scope for P11.2; capture only before→after on fields the AI populated; document omission as a P11.3 gap.

**Recommendation: A** — the owner's motivating example (a 4-tier proposal, 3 tiers corrected) is exactly this authoring signal; but it is a genuine product-semantics choice.

### D3 — Interval work/rest-timing coverage (§3 / §22 / §64) needs a minimal P11.1 diff extension

`sectionFormatSig` does not diff `workSec`, `restPlacement`, or format-specific interval params, so those corrections can never reach P11.2.

- **Option A:** additively extend the shared `aiProvenanceDiff` `sectionFormatSig` (`workSec`→`work_time_changed`, `restPlacement`→`rest_placement_changed`, generic `format_param_changed` for `intervalSec`/`startReps`/`incrementReps`), parity-test both copies, redeploy `analyze-workout`, re-run P11.1 tests. Small, additive, **no P11.1 schema change**.
- **Option B (recommended for a truly minimal P11.2):** consume `semantic_diff` as-is; capture everything in the §3 PROVEN rows; document `workSec` / `restPlacement` / interval-param as an explicit P11.2 limitation for a later phase.

**Recommendation: B for minimal scope; A only if the owner wants interval-timing learning in this phase** (the mission repeatedly asks for it, and the change is genuinely small — owner's call on whether that counts as "reopening P11.1" per §0).

---

## 7. Test plan (on approval) — §61–§71

Basic (accepted-unchanged / cosmetic-only / one semantic / multiple semantic / critical / abandoned / analysis failure / manual workout / save_failed) · Variants (RX/Intermediate/Beginner/OnRamp — the 4-tier fixture: RX unchanged + 3 independent load units, **zero cross-variant leakage**) · Gender (`M 60/F 40` → `M 60/F 35` = one `female` unit, no male unit) · Structure (Repeated↔Sequence both directions, `roundCount` change; if D3=A: `workSec`, `restPlacement`) · Movements (substitute / reorder / add / remove / repeated-at-different-station / same-id-renamed / ambiguous) · Reps vs Load independence · Omissions (only if D2=A) · Historical immutability (extract → mutate a simulated current WOD → evidence identical) · Tenant (Gym A vs Gym B never blend) · Idempotency (extract ×2 → same set, no dupes, no overwrite) · Retention (evidence usable after `input_text` NULLed).

Regression gate (§72): `aiProvenanceDiff` (js+ts) · `p11_1AiProvenanceMigration` · `analyze-workout/index.test.ts` · INC-11/11.1 · INC-09 · INC-08/08A · INC-07 · INC-06 · INC-04 · P10 · P9.5.6/7/8/8.1 · security · `appHookOrderIntegrity` · eslint · build · Deno EF tests.

Migration safety (§73): if D1=A, single-migration procedure identical to P11.1 — pre-check version+objects absent, apply transactionally, verify, register **only** the P11.2 version, **no `--include-all`, no `migration repair`**, leave the known historical ledger drift untouched.

---

## 8. Limitations (known, regardless of D1–D3)

- Coverage is bounded by P11.1 `semantic_diff` (§3 GAP rows).
- `movement_reordered` with a repeated movement is `AMBIGUOUS` by design — never promoted to a deterministic per-movement mapping.
- A model that writes a weight into the movement *name* (not as `@ x/y`) yields no `instance.load` and no load evidence for that movement.
- Substitution evidence is contextual (`Pull-up→Ring Row` in *one* workout), never a global substitution rule (§27).
- `abandoned` runs are **not** negative examples and are excluded (§34); failed analyses are operational evidence, kept out of correction evidence (§35).

---

## 9. Recommended next phase (not started)

P11.3 = **read-model / relational retrieval design** (still no embeddings): given N eligible corrections for `{variant, movement, format, structure}`, decide when a *pattern* becomes a tenant-scoped authoring hint — owner-gated, beneath all §5 invariants.

---

**HARD STOP** — awaiting owner decisions D1, D2, D3. No schema, migration, Edge Function, or client code has been changed by this audit. Retrieval / RAG / embeddings / fine-tuning / member-performance intelligence / INC-10: not started.
