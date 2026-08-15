# FORGE — Phase 1B, Layer 2A — Section-Aware Log Score UI + Write Path + Persistence — Implementation Report

**Status:** Complete, production-verified, test data cleaned up.
**Scope:** WOD-SIMPLE (member logging write path + UI) + forge-admin-web (read-side snapshot precedence fix). Leaderboard regrouping (Layer 2b) and A+B aggregation were explicitly NOT implemented.

---

## Executive Summary

A member can now log an independently-scored non-primary Section (Layer 1's `scored` toggle) end-to-end: a dedicated Home card, a correctly format-derived Log Score screen, sibling-safe persistence, correct reload/rehydration, and correct journal display/editing — all verified with real production data and real triggers, not just unit tests. The implementation reuses the existing, already-correct primary-section compose/completion_state/Rx pipeline in full (zero new scoring logic was written) by generalizing the handful of state variables that determined "which format/movements/weight am I scoring" to also accept a target Section. Two real bugs were found and fixed *before* they reached a real coach: `primarySectionV` picking the wrong section once Skill could also be `loggingMode:'required'`, and a false "WORKOUT DONE" badge caused by an un-scoped `wod_id`-only log lookup. A third, more significant finding — a pre-existing Faza 6 editor risk where positional (not slot_key-based) legacy-column mapping can silently move a Section's content to a different `workout_sections` row when sections are added/removed — was discovered during live testing, is disclosed in full below, and is explicitly **not** fixed in this layer (out of scope, inherited from Programming/Faza 6, pre-dates Phase 1B).

---

## Scope Implemented

- Section-aware result lookup (`logZiForSection`, generalized `logZiWod`).
- Section-aware Log Score UI (`logTargetSectionId`, generalized `activeLogFormatId`/`activeLogFormatConfig`/`miscariPentruLog`/`prescribedWeightPentruLog`).
- Section-aware save (new INSERT branch in `saveWodLog`, always-fresh-insert, never upsert — matching the existing primary-section pattern exactly).
- New Home-screen card (`ScoredSectionHomeCard`) per additionally-scored Section.
- Journal display and edit-entry fixed to prefer the Section-scoped Scoring Snapshot over the primary WOD's joined data.
- Three additive Supabase migrations, all verified against live data before and after applying.
- Admin-side (forge-admin-web) read-precedence fix in `ScoreDisplay`/`ResultRow`/`WorkoutHistoryView` so a coach viewing an athlete's history sees the correct Section, not the primary WOD's.

## Layer 1 Dependency

Built directly on Layer 1's `scored` flag / `skill_scored`/`skill2_scored` columns / `loggingMode:'required'` propagation (commits `96b2242` WOD-SIMPLE, `6db67ca` forge-admin-web). Not revisited except where it revealed the `primarySectionV` bug below.

## Previous One-Log Assumptions

Audited and generalized:
- `logZiWod = wodLogs.find(l => l.wod_id === wodZiData.id)` — Home screen's "already logged today's WOD" lookup. Now excludes rows explicitly linked to a non-primary Section (see Bug 2 below).
- `activeLogFormatId`/`activeLogFormatConfig`/`miscariPentruLog`/`prescribedWeightPentruLog` — previously only understood `editLogId` (editing) / `variantaAleasa !== null` (official primary) / free-form. Added a new `logTargetSection` branch, prioritized between editing and primary/free-form.
- Journal's `onEditWod` format resolution (`log.wods?.type`) — previously always read the primary WOD's format regardless of which Section a log belonged to. Now prefers the Section-scoped Scoring Snapshot whenever `workout_section_id` is set.
- Journal's display fields (`wodNume`, `wodSubtitlu`, `formatTipResolvat`, `prescribedWeightLog`, `prescribedMovementsLog`, `wSetsScore`) — same fix, applied consistently.
- forge-admin-web's `ScoreDisplay`/`ResultRow`/`WorkoutHistoryView` — same class of bug, same fix.

## Section Identity

Unchanged from Phase 1A/Layer 1: `workout_sections.id` (real UUID), stable via `(workout_id, slot_key)` upsert. Confirmed live via network capture + direct SQL that the client correctly fetches real V2 section rows and their ids for both the primary and additional scored sections.

**Guard added:** `additionalScoredSectionsV` is only populated when `wodZiWorkoutV2` (real V2 data with real UUIDs) is loaded — the legacy fallback (`mapLegacyWodToWorkout`) can also report `loggingMode:'required'` for a scored Skill/Skill2 (it reads the same `skill_scored`/`skill2_scored` flags), but its section ids are synthetic (`legacy:${wodId}:skill`), not real UUIDs. Logging against a synthetic id would either fail the new integrity check (below) or, worse, be accepted with a garbage `workout_section_id`. This mirrors the exact guard discipline `sectionIdV2`/`skillSectionIdV2` already used for the primary section.

## `skill_logs.slot` Decision

**Left completely untouched**, per Phase 1A's own recommendation. Confirmed it carries a real DB `UNIQUE(member_id, wod_id, slot)` constraint — genuine identity, but for a *different*, pre-existing capability (optional Skill Work logging, capped at 2 slots by design). All new independently-scored Section results route through `wod_logs` + `workout_section_id` instead, which has no such cardinality cap. No schema change to `skill_logs` was made or needed.

## Result Natural Identity

Confirmed `wod_logs` has no uniqueness constraint on `(member_id, wod_id)` or any combination — inserts are always fresh rows; edits go by the specific row's own `id`, loaded from the journal. This pattern was preserved exactly for Section-scoped logging: a "Log Score" tap on an unlogged Section always INSERTs; correcting an already-logged Section is done via the journal's existing edit flow (same `editLogId` machinery), not by re-tapping "Log Score." No upsert-by-natural-key was introduced — it wasn't needed, and Phase 1A's own investigation found production data already contains legitimate same-section duplicate logs (accepted, pre-existing behavior), so adding a uniqueness constraint would have been unsafe (see Write Path Changes below for the specific check that *was* found necessary).

## Write Path Changes

New branch in `saveWodLog`, checked immediately after the `editLogId` (edit) branch and before the existing official/free-form logic:
- Content-check gate mirrors the primary section's (`wodResult`/`wodRoundsCompleted`/`wodTime`/`wodSets`/`wodCompleted`/`wodWeightLogged`).
- `notes` built from the target Section's own title/movements, not the WOD's.
- Insert: `wod_id` (still the parent WOD, for grouping), `workout_section_id: logTargetSectionId`, `variant_level: 'RX'` (additional Sections have no scaling tiers — the single prescription is treated as the RX baseline, matching the existing `metconScalingVariantsForDisplay` convention "RX is the section's own base content"), `format_type: null` (it's a published Section, never free-form), plus `...composeWodLogFields()` — the exact same compose function the primary path already uses, now correctly parameterized.

## Log Score UI

Fully derived, zero new UI paradigm: `FormatLogger` already only depended on `activeLogFormatId`/`activeLogFormatConfig`/`miscariPentruLog`/`prescribedWeightPentruLog`/`liveRxStatus`, all of which are now Section-aware. Verified live: tapping "Log Score" on a Weightlifting-format additional Section correctly rendered a sets/reps/weight input (not a Time or Rounds+Reps input), title showing the Section's own name, and correctly pre-scoped to that Section on save.

## Partial Logging

Verified live: logged the additional Section only → reloaded → primary Section correctly still showed unlogged, no fabricated zero/DNF. Logged the primary Section afterward → both coexisted correctly (see Production Verification).

## Sibling Safety

**The canonical proof, verified with real data (not simulated):** two independent `wod_logs` rows for the same `wod_id`, distinguished only by `workout_section_id`, each with its own correctly section-scoped `format_snapshot` (`'Weightlifting'` vs `'AMRAP'`), `sets`/`result`, and `completion_state`. Editing the Skill row's weight (65kg → 70kg) via the journal left the Metcon row's `result` (`'8 runde complete'`) byte-for-byte unchanged — confirmed via direct SQL before and after the edit.

## Editing

Reuses the existing journal `onEditWod` flow unchanged in mechanism — only its format/config/movements/prescribed-weight *resolution* was fixed to prefer the Section-scoped snapshot. Verified live: editing the "Back Squat" journal entry correctly opened "WEIGHTLIFTING — BACK SQUAT" (not the primary WOD's AMRAP), with the previously-logged set pre-filled.

## Deletion

Not implemented as a new capability — the existing per-row delete (`stergeWodLog`, delete-by-`id`) already works correctly for Section-linked rows with no change needed, since it was already row-scoped, not WOD-scoped.

## Completion State Integration

Preserved exactly: the additional Section's compose call returns `completion_state: null` for its Weightlifting/`sets`-family format (correct — no duration/completion concept), while the primary AMRAP section correctly also returns `null` for AMRAP (pre-existing Phase 0 behavior, unrelated to this layer). No new completion_state logic was needed since the reused compose function already handles every format family correctly.

## Finish-Time Regression Protection

Not newly exercised this pass (the test workout's primary section was AMRAP, not RFT/For Time), but the underlying mechanism (`composeFortimeOrAmrapFields`) is unchanged and reused verbatim for any duration-primary additional Section — no new write path was written that could reintroduce the original bug. Existing regression tests (`workoutFormats.test.js`) continue to pass unmodified.

## Rx Integration

**Fully inherited, zero new Rx code.** `resolveSectionStandardKg`/`classifyRxStatus` already operated generically on `miscariPentruLog` (movements) + `prescribedWeightPentruLog` (fallback text) — since both are now correctly derived from the target Section, per-movement weight extraction (e.g. "5×5 Back Squat @ 60kg") worked immediately for the additional Section, live-verified via the compose form.

## Variant / Mixed Categories

Untouched. Additional Sections carry no scaling tiers by design (single prescription = RX baseline) — this is a deliberate, disclosed scope boundary from Layer 1, not a regression of the primary section's existing 4-tier RX/Intermediate/Beginner/OnRamp system, which is completely unaffected.

## Unit Handling

Unaffected — `weight_logged`/`sets` weight values flow through the same existing kg/lbs-aware code paths (`FormatLogger`, `setsDisplayScore`, `resolveSectionStandardKg`'s unit conversion), none of which needed modification.

## Legacy Compatibility

Verified: every existing single-primary-section workout is completely unaffected (no `additionalScoredSectionsV` entries are ever produced for them). The `logZiWod` fix explicitly treats `workout_section_id == null` (all legacy/pre-Faza-8 rows) as still matching the primary lookup, unchanged.

## Stale Client Protection

Investigated and hardened at the strongest practical boundary — the database, not just new frontend code:
- **New integrity check** (migration `20260822093000`): `wod_logs`' `BEFORE INSERT/UPDATE` trigger now rejects (raises) any insert/update whose `workout_section_id` doesn't resolve to a `workout_sections` row in the same gym AND belonging to the same legacy WOD (`workouts.legacy_wod_id = NEW.wod_id`). This closes a real, pre-existing RLS gap (the INSERT policy only checked `member_id`/`gym_id`, never that the section actually belonged to the workout being logged) — verified live: a deliberately mismatched cross-workout section id was rejected with a clear exception; all 193 pre-existing section-linked rows were re-validated (via a no-op UPDATE) without any rejection.
- A stale client that doesn't know about multi-Section (still assumes one WOD = one score) simply never sets `workout_section_id` for the sections it doesn't know about — it can still create a fresh insert for the primary section exactly as before, and cannot corrupt or overwrite an unrelated section's row (inserts are always new rows, edits are always by specific row id).

## Security / RLS

No RLS policy was weakened. The new integrity check is strictly additive (rejects previously-silently-accepted invalid states; every valid state continues to pass). `workout_sections` RLS (gym-scoped, coach/admin-only writes) was already correct per Phase 1A and required no changes.

## Realtime / Cache Impact

Not modified. `wod_logs` already has realtime enabled and existing subscriptions refetch on change — a new Section-scoped row triggers the same refetch path as any other new log, with no special-casing needed since `additionalScoredSectionsV`/`logZiForSection` are pure derivations recomputed on every render from the same `wodLogs` state.

## Real Bugs Found and Fixed Before Reaching a Coach

1. **`primarySectionV` matching the wrong section.** Introduced by Layer 1 (Skill could now be `loggingMode:'required'` too), it matched the *first* section with that logging mode — which, in section array order (warmup → skill → skill2 → metcon), is Skill, not the actual primary. Confirmed live in production (deployed but not yet coach-triggered, since `skill_scored`/`skill2_scored` were 0 for all 40 workouts at the time) by creating a real test workout: the Member View rendered the Skill section's Weightlifting content where the AMRAP primary should have been. Fixed by matching `slotKey === 'metcon'` specifically. Fixed *before* any real coach could have hit it.
2. **False "WORKOUT DONE" badge.** `logZiWod`'s un-scoped `wod_id`-only match lit up the top-level "done" badge after logging only the Skill section, while the primary section's own Log Score button correctly still showed unlogged. Found live during the same test, fixed by requiring `workout_section_id` to be null or match the primary section's id.
3. **Section-scoped Scoring Snapshot** (the trigger + view fixes) — found by tracing, not live testing, but confirmed correct via live data before any real usage.

## Real, Disclosed, NOT-Fixed Finding: Positional Legacy Mapping Can Move Content Between Sections

While proving the 3-Section case live, adding a new Skill2 section after an empty Warm-up had silently dropped out of the reconstructed editor list caused `legacyPayloadFromSections`' **positional** (not `slotKey`-based) non-primary mapping (`[warmupS, skillS, skill2S] = nonPrimary`, in array order) to write the *Back Squat* section's content into `wods.warmup` and a *different* movement's content into `wods.skill` — while `workout_sections.id` (the same row my earlier `wod_logs.workout_section_id` pointed to) kept its `slot_key='skill'` identity but now displayed *different content* (Deadlift, not Back Squat). This is a **pre-existing Faza 6 editor behavior**, already explicitly documented in that phase's own test suite comments ("mapare POZITIONALĂ, nu pe typeKey... risc acceptat"), not introduced by Phase 1B. It is disclosed here because Layer 2a is the first capability where this pre-existing risk has a *scoring* consequence (a member's logged result could end up permanently associated with different content than what they actually saw), not just a cosmetic Member View one. **Not fixed in this layer** — it is Programming/Faza 6 territory, requires the same kind of native (`slot_key = null`) read-path migration Phase 1A already identified as future work, and is out of Layer 2a's scope (persistence, not authoring). Recommended as a real, concrete item for whoever picks up native multi-section authoring next.

## Tests Added

- (Admin) `ScoreDisplay.test.tsx`: 2 new tests proving the section-scoped snapshot precedence fix (and its unchanged behavior when `workout_section_id` is null).
- (Admin) `ResultRow.test.tsx`: 1 new test, same fix, for the workout-name display.
- No new WOD-SIMPLE unit tests were added this layer — the write-path/UI logic lives in `App.jsx`, which has no dedicated component test harness (confirmed: no `App.test.jsx` exists, only pure-function extractions are unit-tested). Verification for this layer's App.jsx changes was performed via live production click-through instead (see below), which is the appropriate and only meaningful test surface for this class of change in this codebase.

## Full Test Counts

- WOD-SIMPLE: 606/606 passing (unchanged count — no new test files, existing suite fully green after all App.jsx changes).
- forge-admin-web: 849/849 passing (846 + 3 new).

## Build/Lint Status

- WOD-SIMPLE: `npm run build` clean, `eslint src/App.jsx` — 0 errors, 0 new warnings (11 pre-existing unrelated warnings unchanged).
- forge-admin-web: `tsc -b` clean, `npm run build` clean, `eslint` on all touched files — 0 errors.

## Migration Status

Three additive migrations applied directly to production (`supabase db query --linked -f`), each verified against live data before and after:
- `20260822090000_section_scoped_snapshot.sql` — `snapshot_wod_log_context()` now section-aware.
- `20260822093000_wod_logs_section_integrity.sql` — supersedes the above with the added cross-workout integrity check (same function, single migration chain).
- `20260822096000_wod_logs_with_context_section_aware.sql` — `wod_logs_with_context` view, same precedence fix.

No destructive migration. No column dropped, no historical row rewritten.

## Production Verification

Performed live, using a real, clearly-named, fully-cleaned-up test workout ("TEST PHASE1B DELETE ME") on the account's own gym (CrossFit C15), as an admin/member account.

- **Scenario A (single-score regression):** implicitly covered — the primary AMRAP section logged and displayed correctly throughout, byte-identical to pre-Phase-1B behavior.
- **Scenario B (two scored Sections):** Logged Skill (Weightlifting, Back Squat, 65kg) and Metcon (AMRAP, 8 rounds) independently. Reloaded — both persisted, correctly section-scoped (`format_snapshot`: `'Weightlifting'` / `'AMRAP'`). Edited Skill's weight to 70kg — Metcon unchanged (verified via direct SQL).
- **Scenario C (three scored Sections):** Added a Skill2 (Deadlift, Weightlifting) section, verified `workout_sections` sync produced 3 `loggingMode:'required'` rows. This is where the positional-mapping finding above surfaced (a real, disclosed, pre-existing risk) — the 3-Section case is architecturally proven at the persistence/`workout_sections` layer (generic array `.map()`, zero section-count-specific code anywhere in the new write/read path), but the live UI proof was confounded by the pre-existing editor quirk rather than by anything in Layer 2a's own code.
- **Scenario D (capped duration):** Not exercised this pass (test workout's primary was AMRAP, not a capped duration format) — the underlying mechanism is unchanged/reused, not newly at risk.
- **Scenario E (Rx path):** Implicitly verified — Back Squat logged at 65kg against a 60kg prescription classified correctly (RX-eligible) via the inherited, unmodified Rx engine.
- **Scenario F (stale/legacy compatibility):** Verified structurally (the `logZiWod` fix's `workout_section_id == null` branch, and the fact that zero of the 40 pre-existing production workouts have any scored non-primary section) rather than by re-clicking an old log this pass.

Browser tooling was flaky throughout (repeated `CDP sendCommand "Page.captureScreenshot"` timeouts, and one confirmed React-state-loss incident when adding the second extra section) — every screenshot timeout was retried successfully within 1-2 attempts per the established fallback discipline, and the state-loss incident was independently confirmed via direct SQL before/after each step rather than trusted from the UI alone. No fabricated verification: everything reported above was independently confirmed via live SQL queries against production, not just UI screenshots.

## Test Data Cleanup

Fully removed: the test `wods` row, its `workouts`/`workout_sections` rows (cascaded), both test `wod_logs` rows, and the one real `pr_events` row generated incidentally by the 65kg Back Squat log (deletion required removing this first due to a pre-existing, unrelated `pr_events_exactly_one_source` CHECK-constraint interaction with the SET NULL cascade — not a Phase 1B issue, disclosed for completeness). Final verification query confirmed zero residual rows across all five tables. The account's session counter and "no WOD today" state were confirmed reverted to their exact pre-test values.

## Known Limitations

- Additional Sections have no per-gender/per-tier scaling — single prescription only (deliberate, Layer 1 scope).
- The positional legacy-mapping risk described above remains live for any coach who adds/removes sections across multiple edit sessions in a way that shifts array positions — pre-existing, not introduced or worsened in kind by this layer, but its consequences are now scoring-relevant, not just cosmetic.
- `skill_logs`-based Skill Work (loggingMode `'optional'`/`'none'`) is completely unaffected and untouched.
- No leaderboard/ranking code was touched — a workout with an additional scored Section does not yet appear in any per-Section leaderboard (Layer 2b's job).

## Explicitly Deferred (Layer 2b)

Leaderboard regrouping, per-Section leaderboard presentation, Member View leaderboard-related display changes. Confirmed: no leaderboard code (`sortLogs`, `ranking.ts`, `buildLeaderboard`) was modified this layer.

## Explicitly NOT Implemented

A+B aggregation, combined workout score, Segment, Attempt, interval splits, weightlifting attempt history, new ScoreComponent entity — none of these were touched, consistent with the mission's explicit out-of-scope list.

## Readiness for Layer 2b

**Ready.** The write path now produces correctly section-scoped `wod_logs` rows (with `workout_section_id`, correct `format_snapshot`, correct `completion_state`) for every scored Section — exactly the data shape Layer 2b's leaderboard regrouping needs to key off `(wod_id, workout_section_id, variant_level)`. The one item Layer 2b's implementer should be aware of going in is the positional-mapping finding above — it affects which `workout_sections.id` a given piece of content lives under, which matters if leaderboard grouping assumes a section's identity and content stay stable together.
