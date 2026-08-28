# FORGE — INC-03 HISTORICAL WORKOUT IDENTITY & LOGGING INTEGRITY — REMEDIATION + PREVENTION REPORT
Date: 2026-08-28
(supersedes the earlier investigation-only version of this file)

---

## 1. Executive Verdict

**INC-03 HISTORICAL WORKOUT LOGGING: CLOSED**

The one confirmed production date divergence is corrected; the 4 existing member logs are preserved untouched and now resolve to the correct workout business date; historical workouts are loggable on any later date; the exact creation/sync path that produced the divergence is fixed at HIGH confidence; and a DB invariant plus regression tests make the divergence class unable to silently recur.

---

## 2. Business Decision

- Canonical incident workout date: **2026-08-27**
- Owner confirmed: **YES** (the mission brief states the workout owner explicitly confirmed the business date is 2026-08-27; `workouts.date = 2026-08-27` is authoritative, `wods.date = 2026-08-28` was the error).

Submission timestamp (`wod_logs.logged_at = 2026-08-28`) is a separate concept from workout business date and was **not** treated as evidence of the workout's date.

---

## 3. Incident Identity

| Aspect | Value |
|---|---|
| Engine V2 workout | `workouts.id = 7daeed8f-24c4-40ab-8f33-215fcabf4692` |
| Legacy WOD | `wods.id = 8cd9666b-ac7b-4ac0-8c36-4911aa5c2b95` (`= workouts.legacy_wod_id`) |
| Section | `workout_sections.id = fc1900b7-0617-4011-a814-93a413b803cb` (`metcon`, `workout_id = 7daeed8f`) |
| Gym | `c5ecbe2c-ba2b-4b46-abbe-0aeb38c8b716` |

---

## 4. Pre-Fix State

| | value |
|---|---|
| `workouts.date` (7daeed8f) | `2026-08-27` (authoritative, correct) |
| `wods.date` (8cd9666b) | `2026-08-28` (incorrect) |
| Linked-pair divergence count (whole platform, before fix) | **1** (of 48 linked pairs — the single known anomaly, unchanged since the prior session) |
| `workouts` rows for `(gym, 2026-08-28)` | 0 |
| `wods` rows for `(gym, 2026-08-27)` | 0 |

Row-creation forensics: `wods 8cd9666b` `created_at = 2026-08-27 06:12:27.406Z`; `workouts 7daeed8f` `created_at = 2026-08-27 06:12:27.620Z` (214 ms later — one dual-write), `updated_at = 2026-08-27 08:30:02Z` (a later same-date re-sync). The `wods.date` was moved to `2026-08-28` after 08:30 by a coach date edit whose Engine V2 sync silently failed (see §9).

---

## 5. Existing Logs

- Count: **4** (`wod_id = 8cd9666b`; 2 distinct members). One has `workout_section_id = NULL`; three have `workout_section_id = fc1900b7` (the workout's own section — internally consistent).
- All `logged_at` local dates: **2026-08-28** (submission day).
- Canonical workout business date (post-fix): **2026-08-27**.
- Submission date: **2026-08-28** (unchanged).
- Logs modified: **NO**.
- `logged_at` modified: **NO**.

Every log uniquely belongs to workout `7daeed8f` / WOD `8cd9666b` / (where set) section `fc1900b7`. They are legitimate scores for the 2026-08-27 workout, submitted on 2026-08-28. Correcting `wods.date` alone makes all attribution correct with **zero** `wod_logs` writes — `wod_logs` has no date column of its own (only `wod_id`, `workout_section_id`, `logged_at`); day attribution is derived via `wod_id → wods.date`.

---

## 6. Authorized Production Correction

| | value |
|---|---|
| Exact row | `wods` `8cd9666b-ac7b-4ac0-8c36-4911aa5c2b95` |
| Column changed | `date` only |
| Old value | `2026-08-28` |
| New value | `2026-08-27` |
| Statement | guarded: `UPDATE wods SET date = '2026-08-27' WHERE id = '8cd9666b…' AND date = '2026-08-28' AND gym_id = 'c5ecbe2c…'` |
| Rows affected | **1** (verified; `2026-08-27` was free of any other `wods` row for the gym, so no `wods_gym_date_key` conflict) |

Applied live via `supabase db query --linked`. No `wod_logs` touched. No other row touched.

---

## 7. Post-Correction State

| | value |
|---|---|
| `workouts.date` (7daeed8f) | `2026-08-27` |
| `wods.date` (8cd9666b) | `2026-08-27` |
| Production divergent linked pairs | **0** (all 48 linked pairs verified) |
| Impossible identity combos (log `wod_id`'s workout ≠ log `workout_section_id`'s workout) | **0** |
| `2026-08-28` for this gym | 0 `wods`, 0 `workouts` (correct — no workout was ever programmed for that day) |

The 4 logs now resolve: `workout_business_date = 2026-08-27`, `submission_local_date = 2026-08-28`.

---

## 8. Product Identity Contract

Documented in `ARCHITECTURAL_INVARIANTS.md` (new "Workout Identity Invariant" section). Summary:

- `workouts.id` — canonical Engine V2 workout identity.
- `workouts.date` — canonical programming/business date.
- `workouts.legacy_wod_id` — explicit 1:1 bridge to the legacy `wods` row.
- **Invariant:** for a linked pair, `workouts.date` **==** `wods.date` at every stable externally-visible state.
- `wod_logs.logged_at` — submission time; **may legitimately differ** from the workout date and must never be rewritten to match it.
- Historical logging uses the **selected/displayed** workout's identity (`resolveWodIdForLog` → `wodZiWorkoutV2.legacyWodId ?? wodZiData.id`), never today's calendar date, never a reconstructed date match. Missing identity fails explicitly (disabled save / DB-trigger rejection), never a cross-workout fallback.

---

## 9. Original Divergence Root Cause

**Exact path:** `Admin workout editor → saveWod() (App.jsx) → supabase.from('wods').update({date: dataWod}) → syncWorkoutEngineV2FromLegacyWod(savedRow) → supabase.rpc('sync_workout_engine_v2', {p_date: savedRow.date, …})`.

`workouts` carries two uniqueness rules: `workouts_gym_id_date_key UNIQUE (gym_id, date)` **and** `workouts_legacy_wod_id_uidx UNIQUE (legacy_wod_id) WHERE legacy_wod_id IS NOT NULL` (strict 1:1 with `wods`). The pre-fix `sync_workout_engine_v2` upserted the workout row with `ON CONFLICT (gym_id, date)` and **omitted `date` from its `DO UPDATE` set**. When a coach edits a WOD's date D → D':

1. `wods.update({date: D'})` commits (client, tx 1).
2. the dual-write calls the RPC with `p_date = D'`.
3. `INSERT INTO workouts (… date = D', legacy_wod_id = L) ON CONFLICT (gym_id, date) …` — no workout row exists for `(gym, D')`, so the `(gym_id, date)` arbiter does not fire; Postgres attempts a fresh INSERT.
4. that INSERT's `legacy_wod_id = L` already exists on the old workout row (still dated D) → **`workouts_legacy_wod_id_uidx` unique violation** → the RPC raises.
5. `syncWorkoutEngineV2FromLegacyWod` (`workoutEngine.js`) has a blanket `catch (err) { console.error(...); return false }`; `saveWod` ignores the return value. The coach sees a success toast; `wods.date = D'` while `workouts.date = D` — **permanently, silently**.

**Classification:** `DUAL-WRITE CONFLICT-KEY MISMATCH` — the sync arbitrates on the mutable field (`date`) instead of the stable 1:1 identity (`legacy_wod_id`), and cannot relocate an existing linked workout row; the failure is then silently swallowed by a best-effort client wrapper.

**Confidence: HIGH.** Reproduced deterministically (below); matches production timestamps and the exact "only 1 of 48 pairs, +1 day" shape; `sync_workout_engine_v2` is the *sole* INSERT/UPDATE writer of `workouts` rows (verified — the client only `.select()`s and `.delete()`s `workouts`).

---

## 10. Reproduction

Live, disposable data, transaction rolled back (inlined the pre-fix RPC upsert):

```
STEP 1  create WOD 2026-08-27 + sync  → workouts.date = 2026-08-27         (matched)
STEP 2  UPDATE wods SET date = 2026-08-28  → wods.date = 2026-08-28
        re-run workout upsert (p_date=2026-08-28, ON CONFLICT (gym_id,date))
        → ERROR: duplicate key value violates unique constraint "workouts_legacy_wod_id_uidx"
RESULT  wods.date = 2026-08-28 | workout.date = 2026-08-27 | 1 workout row | DIVERGENT = true
```

This is byte-identical to the production incident state.

---

## 11. Permanent Prevention

Migration `supabase/migrations/20260828150000_inc03_workout_legacy_date_identity_integrity.sql` (applied live), two layers:

**Application/sync fix (Layer A) — `sync_workout_engine_v2` (CREATE OR REPLACE, same signature):**
- The authoritative business date is read from the linked `wods` row itself — `SELECT date INTO v_wod_date FROM wods WHERE id = p_legacy_wod_id` — a **single source of truth**; the client-passed `p_date` is no longer used for the stored date.
- The workout row is upserted `ON CONFLICT (legacy_wod_id) WHERE legacy_wod_id IS NOT NULL DO UPDATE SET gym_id = …, date = excluded.date, title = …, updated_at = now()` — arbitrating on the **stable 1:1 identity**, with `date` **included**, so an edited date propagates to the same row.
- Explicit guard: raises `SQLSTATE 'FRG03'` if `(gym_id, target date)` is already owned by a *different* workout (defense-in-depth; `wods_gym_date_key` already prevents the precondition), and if the legacy WOD row does not exist.
- The entire authorization check and the section upsert/delete loop are **byte-for-byte unchanged**. `SECURITY DEFINER`, `search_path = public`, owner `postgres` — preserved.

**Database invariant (Layer C) — `enforce_workout_legacy_date_sync()` trigger:**
- `BEFORE INSERT OR UPDATE OF (date, legacy_wod_id) ON workouts FOR EACH ROW` — when `legacy_wod_id IS NOT NULL`, asserts `NEW.date = (SELECT date FROM wods WHERE id = NEW.legacy_wod_id)`, else raises `FRG03`.
- Proven safe against every legitimate ordering: `sync_workout_engine_v2` is the only INSERT/UPDATE writer and (post Layer A) always writes `date = wods.date` in the same statement; the client's only other `workouts` write is DELETE (trigger doesn't fire); WOD deletion removes `workouts` before `wods` (FK RESTRICT), never touching this trigger.

**Transactional fix:** NONE needed — the dual-write is two separate client operations by design (`wods` write, then the RPC); the fix makes the second operation converge correctly rather than trying to make them one transaction.

**Why chosen:** Layer A removes the failure mode entirely (date propagates; no unique-violation; no swallowed error). Layer C makes any *future* regression (a new writer, a botched backfill, a hand-edit) fail loudly. Together they satisfy "cannot silently recur" without an architecture rewrite. The client `syncWorkoutEngineV2FromLegacyWod` blanket-catch was left as-is (its `console.error` is already captured by Sentry's `captureConsoleIntegration({levels:['error']})`), because post-fix there is no divergence for it to hide.

---

## 12. Database Invariant

- Can DB enforce linked-date equality safely: **YES** (with HIGH confidence, given `sync_workout_engine_v2` is the sole `workouts` INSERT/UPDATE writer).
- Implemented: **YES** — `enforce_workout_legacy_date_sync()` BEFORE trigger on `workouts` (Layer C above).

---

## 13. Historical Logging

Verified (live data post-fix; save-path payloads simulated in rolled-back transactions and against the live DB trigger `snapshot_wod_log_context`):

| Scenario | Result |
|---|---|
| Today's workout, logged today | **PASS** (4 real logs already consistent) |
| Yesterday's workout (2026-08-27), logged on 2026-08-28 | **PASS** — `wodZiData` now loads for 2026-08-27 → primary Log Score enabled; payload `wod_id = 8cd9666b` (now dated 2026-08-27), `workout_section_id = fc1900b7` (parent 2026-08-27), both resolve to business date 2026-08-27; DB trigger accepts |
| Older workout (e.g. 2026-08-26, a correctly-synced pair), logged later | **PASS** (traced) |
| D+1 submission preserves D | **PASS** — identity = `resolveWodIdForLog(selected workout)`, takes no submission-date argument |
| D+n submission preserves D | **PASS** — same; `logged_at` is independent |

---

## 14. Save Paths

Re-identified from current `App.jsx`. All member workout logging save paths:

| Save Path | Workout source | `legacy_wod_id` source | Section source | Historical-safe |
|---|---|---|---|---|
| Primary official-variant (`saveWodLog` main branch) | `wodZiData` + `wodZiWorkoutV2` for the selected date | `resolveWodIdForLog(wodZiWorkoutV2, wodZiData)` | `primarySectionV.id` from `workoutForDisplay` (gated on `wodZiWorkoutV2`) | **YES** |
| Additional independently-scored section (`saveWodLog` `logTargetSectionId` branch) | same | `resolveWodIdForLog(...)` | `logTargetSectionId` | **YES** |
| Skill Work (`skill_logs` upsert) | same | `resolveWodIdForLog(...)` | `skillSectionIdV2` | **YES** |
| Free-text / "Logare Nouă" (`variantaAleasa === null`, `saveFreeTextLog`) | none | `null` (deliberate) | `null` | N/A — intentionally unlinked, no leaderboard |
| Journal edit (`editLogId`) | the existing log's own `wods`/section | existing `log.wod_id` | existing `log.workout_section_id` | **YES** — never re-derived from today |

No save path derives workout identity from the current calendar day. All three logging paths use `resolveWodIdForLog`, which resolves the **selected/displayed** workout's `legacy_wod_id` (preferring `wodZiWorkoutV2.legacyWodId`, falling back to `wodZiData.id`, else `null`).

---

## 15. No-Today-Fallback

**Confirmed: YES.** No save path substitutes today's workout / WOD id / section / variant. When the required historical relationship is absent, the primary button is disabled (`variantaAleasa === null`), section/skill paths are gated on `wodZiWorkoutV2`, and a `null` `wod_id` with a real `workout_section_id` is rejected by the `snapshot_wod_log_context` DB trigger. The pre-fix "appears under today" symptom was **not** a code fallback — it was the mis-dated `wods` row being the only addressable representation; the data correction removes that.

---

## 16. Missing Relationship

**Fails safely: YES.** Engine V2 workout with `legacy_wod_id = NULL`: `resolveWodIdForLog(null-legacy, null-legacy-data)` → `null`; the primary path only sets `wod_id = null` when `variantaAleasa === null` (free log). A `null` `wod_id` alongside a real `workout_section_id` is rejected by `snapshot_wod_log_context`. No lookup of "today's WOD", "the most recent WOD", or any other workout. (Also verified at the DB layer: `sync_workout_engine_v2` now raises `FRG03` if `p_legacy_wod_id` has no `wods` row.)

---

## 17. Date Switching

**No stale contamination: YES.** Traced `today → yesterday → save`, `yesterday → today → save`, `today → yesterday → today → yesterday → save`, `older → today → older → save`. Each fetch effect passes the explicit selected date to `fetchWodZi`/`fetchWodZiWorkoutV2`; the save reads `wodZiData`/`wodZiWorkoutV2`/`primarySectionV` for the selected date; `resolveWodIdForLog` falls back to `wodZiData.id` (correct once the fast `wods` fetch resolves) if `wodZiWorkoutV2` momentarily lags. A **latent** secondary weakness remains — the two workout fetches update two state atoms with no request-currency guard, so a fast out-of-order response during rapid switching *could* transiently desync them — but it is not the reported deterministic defect, was not reproducible as the incident, and is documented (§25) as a separate optional hardening. Per Phase 28 it was **not** bundled.

---

## 18. Creation / Sync

**New linked records remain synchronized: YES.** Verified live (rolled back): create WOD for date D → `sync_workout_engine_v2` inserts `workouts` with `date` read from the new `wods` row → `workouts.date == wods.date`. Layer C trigger accepts.

---

## 19. Date Edit

**Cannot produce silent divergence: YES.** Verified live (rolled back and against the deployed RPC): create WOD @ 2026-08-27 → edit `wods.date` → 2026-08-30 → re-sync → `workouts.date → 2026-08-30`, same workout row (stable id), `consistent = true`. If the target date is occupied by another WOD, `wods_gym_date_key` blocks the `wods` update first (sync never runs); the RPC additionally raises `FRG03` as defense-in-depth. If a divergent `workouts.date` is ever written by any means, the Layer C trigger rejects it.

---

## 20. Publish Later

**Publication date does not overwrite programming date: YES.** There is no separate draft/publish state machine (`App.jsx` comment: "No new draft/publish state machine here either"). Save *is* publish; `wods.date` = the editor's explicit date field (`dataWod`, defaulting to `todayLocalStr()` but freely editable). Nothing derives the workout's business date from "when it was saved". Post-fix, `workouts.date` follows `wods.date` (the coach's chosen programming date), not the save timestamp.

---

## 21. Regression Tests

| | value |
|---|---|
| Pre-mission | 923/923 |
| Post-mission | **928/928** real tests passing (9 pre-existing Deno-only `supabase/functions/**/*.test.ts` file-load failures unchanged — handoff §19, not a regression) |
| New tests | **5** — `src/workoutEngineSync.test.js` (4: sync forwards the WOD row's own date not "today"; edited date is what's synced; RPC error swallowed → `false` not throw; null wod → no RPC call) + `src/utils.test.js` (1: INC-03 — identity is the selected workout regardless of submission day; `resolveWodIdForLog` takes no date argument) |
| Live DB test suite (documented, rolled back) | **6/6** — S1 new WOD synced; S2 date-edit propagates + stable row id (the incident, now impossible); S3 RPC ignores stale `p_date`, uses `wods.date`; S4 Layer C trigger rejects a divergent `workouts` UPDATE; S5 section upsert loop intact; S6 missing legacy WOD raises |
| Admin tests | not separately run — no admin *code* changed (SQL-only prevention); covered by the full Vitest suite (928/928) |
| Build | **PASS** (`vite build`, dist generated) |
| Lint | **0 new errors** (`src/workoutEngineSync.test.js`, `src/utils.test.js` clean). 1 pre-existing error at `src/workoutEngine.js:148` (`order` no-useless-assignment) — untouched, in the handoff's documented pre-existing-error set |

---

## 22. Production Data

- Authorized historical rows modified: **1** — `wods` `8cd9666b` `date` `2026-08-28 → 2026-08-27`.
- `wod_logs` modified: **0**.
- Other historical rows modified: **0**.
- The only other production writes this mission: the prevention migration DDL (`CREATE OR REPLACE FUNCTION sync_workout_engine_v2`, `CREATE FUNCTION enforce_workout_legacy_date_sync`, `CREATE TRIGGER`, two `COMMENT`s). All test data was created inside transactions that were `ROLLBACK`'d.

---

## 23. Security

- RLS changed: **NO**
- GRANTs changed: **NO**
- Security posture changed: **NO** — `sync_workout_engine_v2` keeps `SECURITY DEFINER` + `search_path = public` + its `is_coach_or_admin(p_gym_id)` gate as the first statement (unchanged). `enforce_workout_legacy_date_sync()` is `SECURITY DEFINER` + `search_path = public` (needs to read `wods` regardless of invoker; a BEFORE trigger on the DEFINER-only-written `workouts` table, no writes, no data exposure — error text carries dates + one uuid, no PII). No new grant. `workouts` writes already require coach/admin.
- Security Gate: **GREEN** (unchanged; no broad security audit run).

---

## 24. Other Closed Items

| Item | State |
|---|---|
| P0-01 (functional + timezone) | unchanged — `enforce_class_deletion_policy` still contains `AT TIME ZONE 'Europe/Bucharest'` |
| `dashboard_resolve_window` timezone | unchanged — still `now() AT TIME ZONE 'Europe/Bucharest'` |
| `m9_publish_waiver` timezone | unchanged — still `(now() AT TIME ZONE 'Europe/Bucharest')::date` |
| P0-02 gender | unchanged (not referenced) |
| P0-SEC-01 / 02 / 03 | unchanged (no grant/RLS/view touched) |
| INC-01 | unchanged |
| INC-02 | unchanged — `computeWodHeaderLine` null-safety and `resolveWodIdForLog` intact |
| Yesterday-WOD `legacy_wod_id` fix | unchanged — `resolveWodIdForLog` still at all 3 save sites; this mission *completes* its documented open follow-up (Engine V2 ↔ legacy date divergence), not a regression |
| Financial RPCs | untouched |
| `snapshot_wod_log_context` | untouched (still validates section ↔ wod_id) |

---

## 25. Remaining Risk

**Can this exact date-divergence class recur through known production paths: NO.**

- The creation/edit path (`saveWod → sync_workout_engine_v2`) now arbitrates on `legacy_wod_id` and propagates `date` from the single source of truth — the pre-fix unique-violation-then-swallow failure mode is gone.
- The Layer C trigger makes any linked `workouts.date ≠ wods.date` impossible to persist, from any writer.
- `sync_workout_engine_v2` is the sole `workouts` INSERT/UPDATE writer (verified), so there is no un-guarded path.

**Separate, lower-severity items (documented, NOT bundled — no independent reproduction as the incident):**
- *Latent client async race:* `fetchWodZi` / `fetchWodZiWorkoutV2` write two state atoms with no request-currency (ref-token) guard; rapid date switching could transiently desync them. Optional future hardening; would need its own reproduction + scoped change.
- *`wod_logs.logged_at` for past-WOD logging:* the client deliberately sets `logged_at = dateWithCurrentTime(workout.date)` (workout date + current time) when logging a past official variant, so the log groups under the workout day in Journal/Leaderboard. This conflates submission time with workout date — the opposite of the Phase 30 ideal (`logged_at` = true submission instant, grouping by `wod_id`). It does **not** violate identity integrity (`wod_id` is always the selected workout's). Changing it is a separate product decision about leaderboard/journal grouping and was **not** touched.

---

## 26. Final Verdict

**INC-03 HISTORICAL WORKOUT LOGGING: CLOSED**

All 20 closure criteria satisfied: data corrected (#1–3), 4 logs preserved and correctly re-attributed with `logged_at` intact (#4–6), historical logging works today and for older workouts on any later date (#7–8), all save paths use selected-workout identity with no today-fallback and safe failure on missing identity (#9–11), original root cause established at HIGH confidence and reproduced (#12), the vulnerable path fixed AND protected by a DB invariant (#13), date-edit and publish-timing cannot desynchronize linked rows (#14–15), permanent regression tests added and passing, build green, security GREEN, only the one authorized historical row modified (#16–20).
