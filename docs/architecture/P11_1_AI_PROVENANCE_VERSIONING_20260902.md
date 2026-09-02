# P11.1 — AI Analyze Provenance + Versioning Foundation

**Date:** 2026-09-02 · **Status:** implemented; migration pending production apply; production smoke pending.
Owner decisions D1–D5 (see `P11_AI_LEARNING_ARCHITECTURE_AUDIT_20260902.md` §52) approved.

**Goal:** make AI Analyze **measurable** — not smarter. Record every run, its versions, its raw + normalized output, and — once the coach saves — the final canonical workout with a deterministic semantic diff. NO retrieval, NO RAG, NO embeddings, NO member-log reads, NO fine-tuning, NO model/prompt change.

---

## 1. Architecture

One append-only-in-spirit ledger, **`ai_analysis_runs`**, keyed by run id. **Nothing is added to any canonical workout table** (D1). Three write points, all **best-effort / fail-open** — a provenance failure never breaks workout authoring (§35):

```
coach paste ─▶ analyze-workout EF ──(service role)──▶ INSERT ai_analysis_runs   [WRITE-ONCE evidence]
                     │ returns { ...WorkoutAnalysis, aiRunId }
                     ▼
        client Builder (forge-admin / PWA), seeded by normalized_output
                     │
        coach edits ─┤
                     ▼
        Save ──(coach, RLS-scoped)──▶ UPDATE ai_analysis_runs   [FILL-ONCE lifecycle: saved_at, wod_id,
                     │                                            workout_id, saved_output, semantic_diff,
                     │                                            edit_severity, outcome]
        close w/o Save ─▶ UPDATE outcome='abandoned' (only while saved_at IS NULL)
                     ▼
        pg_cron: input_text → NULL @ 90d ; raw_output → NULL @ 365d   (D4)
```

The **AI run id** (`ai_analysis_runs.id`, `gen_random_uuid()`) is minted server-side in the EF, returned as `aiRunId` on the response, threaded `QuickCreateDialog → WorkoutDayPage → EditWorkoutDialog` (forge-admin) / held in refs in `App.jsx` (PWA), consumed exactly once at Save.

---

## 2. Schema (`supabase/migrations/20260902090000_p11_1_ai_analysis_provenance.sql`)

### `ai_analysis_runs`

| group | columns |
|---|---|
| identity | `id uuid pk`, `gym_id uuid NOT NULL → gyms ON DELETE CASCADE`, `coach_id uuid → auth.users ON DELETE SET NULL`, `function text ('analyze-workout'|'regenerate-variant', default analyze-workout)` |
| request (write-once; `input_text` expires) | `created_at`, `input_text text`, `input_hash text` (sha256 hex of trimmed input — survives retention) |
| model / reproducibility (write-once) | `provider ('openai')`, `model text NOT NULL` (the **actual resolved** model, not the env default), `model_config jsonb` (`{api, reasoning_effort, store, timeout_ms, retry}`), `prompt_version`, `schema_version`, `transform_version`, `validator_version` (NULL until P11.4) |
| output (write-once; `raw_output` expires) | `status ('ok'|'benchmark'|'refused'|'truncated'|'invalid'|'error')`, `error_detail text` (short; never secrets), `raw_output jsonb` (model flat JSON), `normalized_output jsonb` (transform.ts result = the Builder baseline), `token_usage jsonb`, `latency_ms int`, `completed_at` |
| lifecycle (fill-once, on Save) | `saved_at`, `wod_id uuid → wods ON DELETE SET NULL`, `workout_id uuid → workouts ON DELETE SET NULL`, `saved_output jsonb` (final canonical workout), `semantic_diff jsonb`, `edit_severity ('none'|'cosmetic'|'minor'|'semantic'|'critical')`, `outcome ('accepted_unchanged'|'accepted_cosmetic'|'accepted_semantic'|'abandoned'|'save_failed')` |

Indexes: `(gym_id, created_at desc)`, `(input_hash) where not null`, `(gym_id, prompt_version, model)`, `(wod_id) where not null`, `(gym_id, outcome) where not null`, partial `(created_at)` on the two retention-eligible columns.

Both `wod_id` / `workout_id` are `ON DELETE SET NULL` — the ledger **never blocks a workout delete** (§35).

### Functions / trigger
- `enforce_ai_analysis_run_immutability()` — `BEFORE UPDATE`. Rejects any change to a write-once column **except** the two retention transitions (`input_text → NULL`, `raw_output → NULL`); rejects any lifecycle change once `saved_at IS NOT NULL` (fill-once, no re-link — §29/§38); `gym_id` immutable.
- `p11_expire_ai_analysis_input_text()` / `p11_expire_ai_analysis_raw_output()` — `SECURITY DEFINER`, idempotent, NULL the column past 90 / 365 days. Only these two functions ever null anything; run id / versions / `normalized_output` / `semantic_diff` / `outcome` are kept indefinitely.
- `cron.schedule('p11-expire-ai-input-text-daily', '17 3 * * *', …)` + `…-raw-output-daily` — same shape as `advance-trial-state-hourly` / `gym-billing-block-daily` (pg_cron is already in use — no new infra, §17 STOP not triggered).
- `p11_ai_acceptance_stats(p_gym_id, p_from, p_to, p_prompt_version, p_model)` → `TABLE(...)`. `SECURITY DEFINER`, tenant-guarded (`RAISE` unless `is_coach_or_admin(p_gym_id)`). Returns `runs_total, runs_failed, saved_total, accepted_unchanged, accepted_cosmetic, accepted_semantic, abandoned, save_failed, semantic_acceptance_rate`. **Metric = `(accepted_unchanged + accepted_cosmetic) / saved_total`; abandoned is a separate column, never a semantic failure** (§12/§32).

---

## 3. RLS / tenant isolation / actor

| action | policy |
|---|---|
| SELECT | `authenticated USING (is_coach_or_admin(gym_id))` — coach/admin of the run's gym only. Members: no policy → denied. Anonymous: no `to anon` policy → denied. |
| INSERT | `authenticated WITH CHECK (false)` — **never from a client.** Only the EF, which uses `SUPABASE_SERVICE_ROLE_KEY` (RLS-exempt). |
| UPDATE | `authenticated USING/WITH CHECK (gym_id = my_gym_id() AND is_coach_or_admin(gym_id))` — plus the trigger enforces column-level immutability + fill-once. |
| DELETE | no policy → denied for every client. Rows are never deleted; retention nulls columns. |

**Tenant (`gym_id`)** on the run: the EF prefers the client-sent `gymId` **only if it equals the caller's own admin/coach `gym_id`**; otherwise it uses the caller's canonical gym (`admins.gym_id` / `coaches.gym_id`). An arbitrary client tenant id is never trusted (§19). If neither resolves, **the run is not written** (`gym_id NOT NULL`).

**Actor (`coach_id`)** = `caller.id` from the Bearer token (`auth.getUser`). Never invented. **Gap:** if an admin has rows in `admins` for multiple gyms, `.maybeSingle()` returns nothing → `callerGym` NULL → the run is skipped (fail-open). No such production data is known; documented as a limitation.

---

## 4. Versioning

Stable, human-meaningful identifiers (NOT git hashes — §14), stamped on every run:

| constant | file | value |
|---|---|---|
| `PROMPT_VERSION` | `analyze-workout/prompt.ts` | `analyze-prompt-2026-09-02-inc11` |
| `SCHEMA_VERSION` | `analyze-workout/openaiSchema.ts` | `analyze-schema-2026-09-02-inc11` |
| `TRANSFORM_VERSION` | `analyze-workout/transform.ts` | `analyze-transform-2026-09-02-inc11` |
| `validator_version` | — | NULL until P11.4 exists |

Bump **intentionally** when the semantics change (each file's comment says exactly when).

---

## 5. Model configuration capture

Recorded per run, verbatim, **unchanged by this phase**: `provider='openai'`, `model` = the resolved `OPENAI_MODEL` env (`gpt-5-mini` default — the **runtime** value, never assumed to equal the default, §15), `model_config = { api:'responses', reasoning_effort:'low', store:false, timeout_ms:45000, retry:1 }`. **`store: false` is unchanged** (§16) — Forge owns the ledger; provider-side retention is not relied on.

---

## 6. Raw vs normalized output (§7)

- `raw_output` = the model's `flat` structured JSON, pre-transform. Retained 365 days for debugging.
- `normalized_output` = `toWorkoutAnalysis(flat, sourceText)` = the exact `WorkoutAnalysis` the client mapped into the Builder. Kept indefinitely.
- Together they let a future analysis separate **MODEL error** (`raw_output` already wrong), **TRANSFORM error** (`raw_output` fine, `normalized_output` wrong — `transform_version` narrows it), and **COACH correction** (`normalized_output` fine, `saved_output` differs → `semantic_diff`).

---

## 7. Final canonical output + linkage (§8/§29)

At Save the client updates the run with `saved_output` = the final structured section list (the Builder's `EditableSection[]` / `wodSections`, the same shape as `normalized_output` after `sectionsFromAiAnalysis` — **structured, not rendered text**), `wod_id` = the saved `wods.id` (canonical), `workout_id` = `workouts.id where legacy_wod_id = wod_id` (canonical Engine V2 id, resolved by lookup — **never** reconstructed by date).

---

## 8. Semantic diff (`aiProvenanceDiff.js` ↔ `.ts`)

Pure, ported byte-for-byte to forge-admin (`workoutIntelligence.js↔.ts` pattern), parity-tested. `diffAiVsSaved(baseline, final)` over two `EditableSection[]` → `{ deltas[], counts, severity, outcome }`.

**Comparison** — section-by-section (matched by index), per section:
`format`, `structure` (AMRAP: absent ≡ `'Repeated Rounds'`), `score_family`, `duration`, `rest`, `rounds`, `title`; then per variant (`rx` always; `intermediate`/`beginner`/`onramp` **only if the AI baseline populated them** — coach filling an empty tier is NOT a correction, §2/§13.3), the ordered movement instance list:
- **movement identity** = `canonicalMovementId` when both sides have one, else normalised name (`normMovementName`: lowercase, strip punctuation, collapse spaces, naive singular). Repeated movements stay distinct by position (§31). Display-text equality is never the sole comparator.
- pure reorder (same multiset, different order) → `movement_reordered`.
- positional identity mismatch → `movement_substituted`.
- per metric (`reps`/`load`/`distance`/`calories`) tuple change → `*_changed`.

## 9. Edit severity (§10) — deterministic

| severity | triggers |
|---|---|
| **none** | structurally identical |
| **cosmetic** | movement renamed but same normalised identity; `note` / `title` change |
| **semantic** | any numeric change (`reps`/`load`/`distance`/`calories`/`duration`/`rest`/`rounds`); movement added/removed/reordered; non-scored section added/removed |
| **critical** | `format` / `structure` / `score_family` changed; movement substituted (different identity); scored section added/removed |

`minor` is in the schema CHECK for future use; the diff never emits it (all P11.1 categories are deterministic without it). Overall run severity = max across all deltas.

## 10. Acceptance classification (§11)

| `outcome` | condition |
|---|---|
| `accepted_unchanged` | severity `none` |
| `accepted_cosmetic` | severity `cosmetic` |
| `accepted_semantic` | severity `semantic` or `critical` |
| `abandoned` | run succeeded, coach closed the Builder without saving (best-effort; only while `saved_at IS NULL`) |
| `save_failed` | reserved — a coach Save that errored (not wired in P11.1; the client save path currently just retries) |
| *analysis_failed* | **derived, not stored**: `status <> 'ok'/'benchmark'` and no lifecycle |

---

## 11. Behaviours (mission §24–§28)

- **Manual / template workout** (no AI run) → `aiRunId` undefined → **no ledger row, no fake provenance** (§24).
- **AI + accepted unchanged** (§26) → one run, linked, `semantic_diff.severity='none'`, `outcome='accepted_unchanged'`.
- **AI + corrected** (§25) → one run, linked, diff names the exact fields, `outcome='accepted_semantic'`.
- **Abandoned** (§23) → `outcome='abandoned'` on Builder close; if the coach later returns and saves, the real Save supersedes it (trigger allows it while `saved_at` is still NULL).
- **Multiple analyses before one Save** (§27) → each `analyze-workout` call writes its own run. Only the run whose `normalized_output` seeded the **final** Builder state is linked (the client tracks the current `aiRunId`; a new analysis marks the previous run `abandoned` first).
- **Failed analysis** (§22) → a run row with the failure `status` + `error_detail`; `raw_output`/`normalized_output` only when we got that far (shape-validation failure keeps both for debugging). No misleading "ok".
- **Builder edits** (§28) → **snapshot comparison** (`normalized_output` vs `saved_output`), not keystroke logging.

---

## 12. Failure containment (§35)

Every write is **fail-open**:
- EF `recordRun` — `try/catch`, `console.error`, returns `null`; the response is unchanged (returns `aiRunId: null`). If the table doesn't exist yet (deploy order), same result. **So client + EF code can deploy before the migration is applied.**
- Client `linkAiAnalysisRun` / `markAiAnalysisRunAbandoned` — `try/catch`, `console.error`, fire-and-forget (`void`). The Save flow, `onSaved`, and dialog close are never blocked or delayed.

Cost: some provenance is lost on transient failure. Acceptable for a *measurement* phase (not audit-compliance). An outbox/retry is explicitly out of scope.

---

## 13. Idempotency / concurrency (§37/§38)

- One `analyze-workout` call → one INSERT (single request, no client retry of the same run — the EF's own 1-retry is *inside* one model call, before the INSERT).
- `linkAiAnalysisRun` is guarded by `aiRunLinkedRef` (once per Builder session) **and** the DB trigger (fill-once once `saved_at` set) — a double Save / double tab cannot re-link or cross-link.
- `markAiAnalysisRunAbandoned` is `.is('saved_at', null)` scoped — cannot clobber a linked run.

---

## 14. Retention (§17/§54) — deterministic, tenant-agnostic, idempotent

`input_text → NULL` after 90 days (D4); `raw_output → NULL` after 365 days. pg_cron daily. **Kept forever:** run id, versions, `model`, `input_hash`, `normalized_output`, `token_usage`, `latency_ms`, `semantic_diff`, `edit_severity`, `outcome`. The rows are never deleted.

---

## 15. Metric query (§53)

```sql
select * from public.p11_ai_acceptance_stats(
  '<gym_id>'::uuid,
  '2026-09-01'::timestamptz,   -- from (default -infinity)
  '2026-10-01'::timestamptz,   -- to   (default  infinity)
  'analyze-prompt-2026-09-02-inc11',  -- prompt_version (default null = all)
  'gpt-5-mini'                          -- model (default null = all)
);
```
Returns one row: `runs_total, runs_failed, saved_total, accepted_unchanged, accepted_cosmetic, accepted_semantic, abandoned, save_failed, semantic_acceptance_rate`. No UI.

---

## 16. Files changed

**WOD-SIMPLE**
- `supabase/migrations/20260902090000_p11_1_ai_analysis_provenance.sql` — **new**.
- `supabase/functions/analyze-workout/index.ts` — run capture (`buildRunRecord`, `sha256Hex`, `tokenUsageOf`, `recordRun`, `aiRunId` in response). **First test file:** `index.test.ts` + `@std/assert` in `deno.json`.
- `supabase/functions/analyze-workout/{prompt,openaiSchema,transform}.ts` — version constants.
- `src/aiProvenanceDiff.js` — **new** (pure diff). `src/App.jsx` — `aiRunId`/`aiBaseline` refs, `linkAiRunOnSave` in `saveWod`, `markAiRunAbandonedIfUnlinked` in `resetWodFormFields`, capture in `analyzeWorkout`.
- Tests: `src/aiProvenanceDiff.test.js` (18), `src/p11_1AiProvenanceMigration.test.js` (20).

**forge-admin-web**
- `src/features/programming/aiProvenanceDiff.ts` — **new** (port). `aiProvenanceDiff.test.ts` (9).
- `mutations.ts` — `linkAiAnalysisRun`, `markAiAnalysisRunAbandoned`.
- `workoutIntelligence.ts` — `WorkoutAnalysis.aiRunId`.
- `QuickCreateDialog.tsx` / `WorkoutDayPage.tsx` / `EditWorkoutDialog.tsx` — thread `aiRunId` + `aiBaseline`; link on Save; abandon on close.

---

## 17. Tests / regression

- PWA: **1795 passed** (+38: 18 diff + 20 migration). 10 failed *files* = 9 pre-existing Deno edge-fn test files + the new `analyze-workout/index.test.ts` (Deno, correctly not runnable under vitest — passes under `deno test`).
- `deno test --config supabase/functions/analyze-workout/deno.json` — **6 passed** (first-ever coverage for that function).
- `deno check` on the 4 function source files — clean.
- forge-admin: **1289 passed** (+9), `tsc --noEmit` clean, build clean.
- eslint: 0 errors on every touched file (both repos).
- Regression spot: INC-11, INC-11.1, P10, `appHookOrderIntegrity`, `configIntegrity`, `workoutIntelligence` — all green.

---

## 18. Rollback (§39)

1. **Kill switch (no deploy):** the EF's `recordRun` and the client link helpers are all best-effort — dropping the table (`DROP TABLE public.ai_analysis_runs`) makes every write no-op instantly; AI Analyze + the Builder + Save keep working (fail-open, verified in tests).
2. **Full DOWN** (in the migration footer): `cron.unschedule` ×2, `DROP FUNCTION` ×3, `DROP TRIGGER`, `DROP FUNCTION` (immutability), `DROP TABLE`. Additive-only; restores the exact prior schema. No data migrated, no canonical object touched.
3. The version constants and diff modules are inert without the table — leaving them costs nothing.

---

## 19. Production apply / deploy order

The **migration must be applied to production** (no in-session DB access — same gap as `app_version` bumps). Because every write is fail-open, deploy order is free:
1. (any order) deploy the client + EF code — provenance simply no-ops until the table exists.
2. apply `20260902090000_p11_1_ai_analysis_provenance.sql`.
3. `supabase functions deploy analyze-workout`.
4. run the production smoke (§20 below / mission §52).

`app_version` bump **not required** — no member-facing PWA behaviour changes (the AI Analyze / Builder / Save UI is byte-identical for the coach; provenance is invisible telemetry).

---

## 20. Production smoke (pending)

| case | verify |
|---|---|
| **A — accepted unchanged** | analyze a safe test workout → Builder → Save without edits → `select status, outcome, edit_severity, wod_id from ai_analysis_runs order by created_at desc limit 1` → `ok / accepted_unchanged / none`, `wod_id` set |
| **B — corrected** | analyze → change one semantic field (e.g. a rep count, or AMRAP structure) → Save → run shows `accepted_semantic`, `semantic_diff.deltas` names the exact field |
| **C — manual** | create a manual workout → **no new `ai_analysis_runs` row** |
| **D — tenant / security** | a coach of gym B: `select * from ai_analysis_runs where gym_id = '<gym A>'` → 0 rows; anon → denied; `select p11_ai_acceptance_stats('<other gym>')` → raises |
| cleanup | delete the safe test workout(s) if convention allows (the run rows stay — they are the audit evidence) |

---

## 21. Outstanding limitations

1. **Migration not yet applied to production** + EF not yet deployed (§19).
2. **Multi-gym admin** → run skipped (fail-open) — no such data known.
3. `save_failed` outcome is defined but not wired (the client save path has no distinct "tried and errored" signal to the linker in P11.1).
4. **Some provenance lost on transient write failure** — accepted for a measurement phase; no outbox.
5. **`abandoned` detection is best-effort** — a hard browser close / crash before the close handler won't mark it; such a run stays `status='ok'` with no lifecycle (correctly counts as neither accepted nor a failure).
6. **DB/RLS behaviour is asserted structurally** (`p11_1AiProvenanceMigration.test.js`), not by a live pgTAP test (no such infra in the repo) — the runtime guarantees are verified in the §20 smoke.
7. `regenerate-variant` is **not** captured in P11.1 (the table's `function` column is ready; adding it is a small follow-up, no diff logic).
