# FORGE — Yesterday's Workout Score-Logging Forensic Report

No PII (names/emails) is printed anywhere in this report — only counts, booleans, and anonymized/real non-personal identifiers (workout/section UUIDs, dates).

---

## 1. Executive Verdict

## YES — yesterday's workout can now be logged (fixed and deployed). Before this mission's fix, logging it via an official variant selection (with Workout Engine V2 loaded) reliably failed.

## 2. Exact Business Date

Canonical Forge business date investigated, per `FORGE_DATE_TIME_POLICY.md` §1-2 (device-local timezone, not UTC): **2026-08-27** (today, per the platform's own current-date context, is 2026-08-28).

## 3. Exact Workout

```text
Gym:                    c5ecbe2c-ba2b-4b46-abbe-0aeb38c8b716 (the platform's one real production gym)
Workout Engine V2 row:  workouts.id = 7daeed8f-24c4-40ab-8f33-215fcabf4692
  date:                 2026-08-27 (correct)
  legacy_wod_id:        8cd9666b-ac7b-4ac0-8c36-4911aa5c2b95
  section count:        1 (single primary "metcon" section)
Legacy row (via legacy_wod_id): wods.id = 8cd9666b-ac7b-4ac0-8c36-4911aa5c2b95
  date:                 2026-08-28 (INCORRECT relative to the linked workouts row - see §15)
  type:                 RFT
  duration:              20:00
Published/official:     yes - a real scheduled WOD, not a draft
```

## 4. Successful Production Logs

```text
Logs linked to wod_id (8cd9666b...):            1
Logs linked to workout_section_id (the primary
  metcon section, fc1900b7...):                  0
Orphaned/partial rows (workout_section_id set,
  wod_id null - would indicate a corrupted
  partial insert):                               0
```

Classification: **B — some paths could log, others could not.** Exactly one real log exists for this workout, created via a path that never attempted to set `workout_section_id` (consistent with either a free-standing log or a log created before this specific failure condition was hit) — it succeeded because it never triggered the section/wod_id cross-check described below. Zero logs exist via the official-variant-with-V2-section path, which is the path this mission confirms was broken.

## 5. Failing Section

The workout's sole section: `workout_sections.id = fc1900b7-0617-4011-a814-93a413b803cb`, `slot_key = 'metcon'` (the primary section), `format = 'Buy-In/Cash-Out'`. Any official-variant score submission for this workout necessarily targets this section.

## 6. Reproduction

Followed the exact save-path logic in `saveWodLog()` (`App.jsx`) end-to-end, using the real, live production identifiers above, then live-tested the exact resulting database call as a real authenticated member (disposable, rolled back — no real member data touched):

```text
Member navigates to 2026-08-27 (yesterday)
→ fetchWodZi('2026-08-27') queries `wods` WHERE date = '2026-08-27' → 0 rows → wodZiData = null
→ fetchWodZiWorkoutV2('2026-08-27') queries `workouts` WHERE date = '2026-08-27' → 1 row (loads
  correctly, including its section) → wodZiWorkoutV2 = { id: 7daeed8f..., sections: [...] }
→ workoutForDisplay = wodZiWorkoutV2 || ... → member sees a normal-looking workout, unaware
  anything is wrong
→ member selects an official variant (e.g. RX) → variantaAleasa = 0
→ member enters a valid score, taps Save
```

## 7. Pre-Save State

```text
wodZiData:              null
wodZiWorkoutV2:          { id: '7daeed8f...', legacyWodId (after fix)/absent (before fix),
                           sections: [{ id: 'fc1900b7...', slotKey: 'metcon', ... }] }
variantaAleasa:          0 (RX selected) - NOT null
sectionIdV2 (primarySectionV.id): 'fc1900b7-0617-4011-a814-93a413b803cb' - a real, valid id
wod_id (BEFORE fix):     wodZiData?.id || null → null (wodZiData is null)
wod_id (AFTER fix):      resolveWodIdForLog(wodZiWorkoutV2, wodZiData) →
                          wodZiWorkoutV2.legacyWodId → '8cd9666b-ac7b-4ac0-8c36-4911aa5c2b95'
computeWodHeaderLine result: 'RX' (via the INC-02 fix's own null-safe fallback - no crash here,
                          confirmed still correct, see §13)
```

## 8. Save Button

**Enabled**, not disabled, not hidden. The "select an official variant + Save" flow is entirely UI-driven from `wodZiWorkoutV2`/`workoutForDisplay`, which loaded successfully — there is no validation condition anywhere in the traced path that checks `wodZiData` truthiness before allowing variant selection or enabling Save. The button's own gating (`areContiut` — result/time/movements/sets non-empty) was satisfied normally by a valid score entry; it does not reference `wodZiData` at all.

## 9. saveWodLog Trace

First point where actual behavior diverged from intended behavior — **not** a client-side branch at all (no early return, no validation rejection): the divergence is in the **value** computed for `wod_id`, which silently resolved to `null` (before this fix) despite a real, valid workout existing for that day. Every other line in `saveWodLog` executed normally and constructed a syntactically valid insert payload.

## 10. Supabase Boundary

## SAVE REQUEST REACHES SUPABASE: YES

```text
operation:          INSERT
table/RPC:           wod_logs
payload shape (sanitized): { member_id: <real>, gym_id: <real>, wod_id: null,
                     workout_section_id: 'fc1900b7-0617-4011-a814-93a413b803cb',
                     variant_level: 'RX', notes: <header + movements>, result: <valid score>, ... }
HTTP/PostgREST status: 400 (constraint/trigger violation surfaced through PostgREST)
Postgres code:       P0001 (raised exception)
Postgres message:    "workout_section_id fc1900b7-0617-4011-a814-93a413b803cb does not belong to
                     wod_id <NULL> in gym c5ecbe2c-ba2b-4b46-abbe-0aeb38c8b716"
```

Live-reproduced exactly this error via a disposable, rolled-back insert as a real authenticated member, using the precise pre-fix payload shape.

## 11. Exact Error

```
ERROR:  P0001: workout_section_id fc1900b7-0617-4011-a814-93a413b803cb does not belong to wod_id <NULL> in gym c5ecbe2c-ba2b-4b46-abbe-0aeb38c8b716
CONTEXT:  PL/pgSQL function snapshot_wod_log_context() line 25 at RAISE
```

The client's own error handler (`if (error) { showToast(t.toastLogWodInsertError); console.error(error) }`) swallows this exact message from the member's view, showing only a generic "couldn't save" toast — consistent with the member's report of simply "cannot log" the workout, with no further detail available to them.

## 12. Sentry

No corresponding Sentry event was found for this specific `P0001`/`snapshot_wod_log_context` error signature at the time of this investigation — plausible explanations, not confirmed: (a) the member's attempt(s) predate this investigation and rolled off the queried window, (b) Sentry's Supabase integration captures `console.error` output but this specific error's `[object Object]`-style message may not have matched the keyword searches performed, or (c) very few attempts were made before the member gave up and reported the issue directly rather than retrying repeatedly. This is disclosed as a genuine gap rather than claimed as a confirmed absence of any Sentry signal.

## 13. INC-02

**YES — the INC-02 fix is working correctly for this WOD, and remains CLOSED.** `computeWodHeaderLine` was invoked with `variantaAleasa = 0`, `wodZiData = null` — its own null-safe branch correctly returned `'RX'` (the variant's own level name) rather than throwing. **No crash occurred at any point in this trace.** The failure this mission investigates is a completely different, later step in the same function (the `wod_id` value sent to Supabase, not a client-side exception) — confirmed by the Supabase-boundary evidence in §10 (the request did reach Supabase; INC-02's own bug, by contrast, never got that far). INC-02's regression tests were re-run and still pass unmodified (see §23).

## 14. Score Type

`RFT` (Rounds for Time — matches the legacy `wods.type` for `8cd9666b...`), with the primary section's `format = 'Buy-In/Cash-Out'`. The score entered by the member (a valid time/rounds-based result) was correctly parsed, validated, and normalized by the existing, untouched scoring pipeline (`composeWodLogFields`) — the resulting `result`/`time_result` fields in the payload were valid and well-formed at every stage. The score TYPE and its parser are **not implicated** — the payload's `wod_id` field was the sole defect.

## 15. Workout Structure

The unusual element is not in the workout's *content* (a single, ordinary metcon section, RFT format, is entirely typical) — it is in its **cross-table identity linkage**: `workouts.date` (2026-08-27, correct) disagrees with the `wods.date` (2026-08-28) reachable via `workouts.legacy_wod_id`, for what is meant to be the same logical, single workout. Both rows were created within roughly the same second (`2026-08-27 06:12:27` UTC), consistent with the platform's existing "dual-write" architecture (`sync_workout_engine_v2`, invoked as a best-effort side effect of the primary `wods`-table save — see the existing code comment in `workoutEngine.js`: *"editorul continua sa scrie in `wods` ca sursa de adevar... o eroare aici NU trebuie sa strice salvarea reala"*) — plausibly a timing/ordering artifact of that dual-write, though the exact mechanism by which the two dates ended up different was not further reverse-engineered (out of scope — the fix does not depend on knowing precisely how the anomaly was created, only on making the client resilient to it when it occurs).

## 16. Creation Path

Not directly traceable to a specific Admin action from the data alone (no creation-audit trail beyond `created_at`/`updated_at` timestamps was queried) — both rows were created within the same second via what the codebase's own architecture describes as the standard "editor saves to `wods`, V2 sync follows as a best-effort side effect" flow, consistent with a normal WOD-of-the-day creation/edit through the existing Admin editor (not a bulk import, not a manual SQL edit — no evidence of either).

## 17. Failing vs Working WOD

| Property | Yesterday's WOD (2026-08-27) | 44 other checked workouts (2026-06-29 through 2026-08-26) |
|---|---|---|
| `workouts.date` vs linked `wods.date` | **MISMATCH** (one day apart) | Match, in all 44 |
| Section count | 1 (metcon only) | Varies, unremarkable |
| Score type | RFT | Varies, unremarkable |
| Creation timing (workouts vs wods `created_at`) | Same second | Not individually re-verified for all 44, not the differentiating factor |

The sole, decisive structural difference is the date mismatch — nothing about the workout's own content (format, section count, movements) is unusual.

## 18. Payload Comparison

| Field | Failing (pre-fix) | Fixed | Known-successful pattern (any of the 44 unaffected workouts, official-variant path) |
|---|---|---|---|
| `wod_id` | `null` | `'8cd9666b-...'` (correct) | Always the correct, matching `wods.id` |
| `workout_section_id` | `'fc1900b7-...'` (real, valid) | unchanged | Always a real, valid section id |
| `variant_level` | `'RX'` | unchanged | Same |
| `result`/`time_result` | valid | unchanged | Same |

The only differing field, in both the failing and now-fixed case, is `wod_id` — every other field was always correctly constructed.

## 19. Database Control

## YES — the corrected payload persists successfully as an authenticated member.

Live-verified (disposable row, rolled back, real auth boundary — `SET LOCAL ROLE authenticated` with a real member's JWT claims, not `service_role`): the exact same insert, with `wod_id` corrected to `'8cd9666b-ac7b-4ac0-8c36-4911aa5c2b95'` (the value `resolveWodIdForLog` now produces), succeeded cleanly and returned the inserted row.

## 20. Root Cause

## CLIENT ↔ WORKOUT CONTRACT MISMATCH

**Confidence: HIGH.**

The client independently re-derived `wod_id` via a separate, date-keyed lookup against the legacy `wods` table, instead of using the `legacy_wod_id` value already present on the successfully-loaded `workouts` (Engine V2) row — the same value the database's own `snapshot_wod_log_context()` trigger authoritatively validates section/workout linkage against. When the two independently-derived values disagree (a rare, one-off data anomaly — 1 of 45 checked workouts, not a systemic pattern), the client's payload becomes self-contradictory (`workout_section_id` from V2, `wod_id` from a mismatched/absent legacy lookup) and is correctly rejected by the database.

## 21. Why Tests Missed It

916 (now 923) passing tests did not include a fixture reproducing the specific combination this incident required: **Workout Engine V2 present and successfully loaded, `wodZiData` (legacy) absent, and a real `workout_section_id` derived from V2 being sent alongside a `wod_id` derived from the absent legacy source.** INC-02's own regression tests (added just before this incident) covered `wodZiData === null` for the *header-text* crash specifically, but did not extend to the *`wod_id` value* sent in the same save call — a related but distinct concern in the same function, missed because the original INC-02 investigation's confirmed crash was purely about the unguarded `.type` access, not about `wod_id` correctness once the crash was fixed. No existing fixture combined "V2 loaded with a real section" with "legacy lookup absent" for the `wod_id`-specific assertion.

## 22. Fix

**Implemented — HIGH-confidence, minimal, code-only fix. No data, schema, RLS, or trigger changes.**

- **`src/utils.js`** (new): `resolveWodIdForLog(wodZiWorkoutV2, wodZiData)` → `wodZiWorkoutV2?.legacyWodId ?? wodZiData?.id ?? null`. Prefers the Engine V2 row's own `legacy_wod_id` (the same value the DB trigger validates against) whenever V2 is loaded; falls back to the legacy lookup only when V2 isn't available at all.
- **`src/workoutEngine.js`**: `mapV2WorkoutRow` now exposes `legacyWodId: workout.legacy_wod_id ?? null` — the raw column was already being fetched (`select('*')`) but never surfaced to callers.
- **`src/App.jsx`**: all 3 `wod_id` derivation sites updated to use `resolveWodIdForLog`: the primary official-variant save, the additional-scored-section save (Layer 2a), and the Skill Work save. The Skill Work site had a second, separate defect fixed in the same pass — an **unguarded** `wodZiData.id`/`wodZiData.date` access (would throw `TypeError`, the same class of bug as INC-02, in a function INC-02 never touched) — not reachable for yesterday's specific metcon-only workout (which has no Skill section), but a real, confirmed latent crash for any workout with a Skill section that encounters this same date-mismatch condition in the future.

## 23. Tests

```text
New regression tests:  7 (5 for resolveWodIdForLog in utils.test.js, reproducing the exact
                        anonymized production values plus 4 positive controls; 2 for
                        mapV2WorkoutRow's new legacyWodId field in workoutEngine.test.js)
INC-02 regression:     re-run explicitly (src/utils.test.js's computeWodHeaderLine suite) -
                        all 6 original tests + 3 positive controls still pass, unmodified
Full suite:            923/923 real tests passing (was 916 before this fix; +7 new). Same 9
                        pre-existing, unrelated Deno-only supabase/functions/**/*.test.ts files
                        still fail to LOAD (@std/assert import) - confirmed pre-existing baseline
Build:                 PASS, 0 errors
Lint:                  4 pre-existing errors (workoutEngine.js/workoutEngine.test.js) - verified
                        byte-for-byte identical against the unmodified baseline via git stash
                        (same file, same error types, unrelated to this fix's own changes,
                        introduces zero new lint errors); 11 pre-existing warnings elsewhere,
                        unchanged
Type-check:             N/A - WOD-SIMPLE has no separate tsc step (plain JS/JSX project); build
                        is the applicable equivalent, and it passed
```

## 24. Production Verification

**Exact yesterday WOD verified: YES**, at the database-payload level — both the pre-fix failure (exact reproduction of the real `P0001` error) and the post-fix success (exact same payload, corrected `wod_id`, persists cleanly) were directly verified against live production, using a real authenticated member's auth boundary (never `service_role`), with all test data disposable and rolled back. Full browser-based UI end-to-end verification (physically opening the deployed PWA and clicking through Save) was **not** performed — no browser automation session was available in this investigation — this is disclosed honestly rather than claimed. Given the confirmed root cause is entirely about the *value* constructed for one payload field (not client-side control flow, rendering, or button-enablement logic, all of which were traced and confirmed unaffected), the database-level verification is considered sufficient proof for this specific, narrow defect class.

## 25. Production Data

```text
Real production WOD modified:    NO
Real member score modified:      NO
Schema/RLS/triggers modified:    NO
```

No `UPDATE`/`INSERT`/`DELETE` was executed against `workouts`, `wods`, `wod_logs`, `skill_logs`, or any other data table for real records. The only production-affecting action was bumping `app_version` (`yesterday-wod-legacy-wod-id-fix-20260828`) — the platform's standard PWA-refresh signal, not a data change. The underlying `workouts.date`/`wods.date` mismatch for this one workout was **not** corrected at the data level — per this mission's explicit stop condition ("if yesterday's actual WOD data must be edited... STOP"), a pure code fix was found and implemented instead, which is fully sufficient (the client now derives the correct `wod_id` regardless of whether the underlying date anomaly is ever separately reconciled).

## 26. Closed Invariants

```text
P0-01:     INTACT - not referenced anywhere in this diff
P0-02:     INTACT - gender resolution not reached by this code path, not modified
P0-SEC-01: INTACT - no view/grant touched
P0-SEC-02: INTACT - no subscriptions/entitlement logic touched
P0-SEC-03: INTACT - no view touched
P0-03:     INTACT - unrelated to date/timezone derivation; this fix is about workout identity
           linkage (wod_id), not date computation
INC-01:    INTACT - no member/profile name-resolution code touched
INC-02:    INTACT and explicitly re-verified (§13, §23) - the fix this mission made lives in
           the same function as INC-02's own fix but addresses a distinct field (wod_id, not
           the header-line text); both fixes coexist correctly, confirmed by test and live
           reproduction
```

## 27. Final Verdict

## YESTERDAY WOD LOGGING ISSUE CLOSED

Root cause proven with HIGH confidence, live-reproduced with the exact production error, fixed with a minimal, safe, code-only change, regression-tested against the exact anonymized real values, deployed to production (commit `2bb9202`, Vercel deploy confirmed via Sentry release tracking at `2026-08-28T07:55:05Z`), and independently re-verified to resolve cleanly at the database-payload level. The underlying one-off data anomaly (`workouts.date` vs `wods.date` disagreement for this single workout) was deliberately left untouched, per this mission's own explicit instruction not to mutate production WOD data without separate approval — the code fix makes this class of anomaly non-blocking going forward, regardless of whether the specific anomaly is ever separately reconciled.

---

Stopping here per this mission's instruction. No unrelated work performed.
