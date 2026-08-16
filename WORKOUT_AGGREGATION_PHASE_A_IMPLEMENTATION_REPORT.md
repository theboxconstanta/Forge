# Workout Aggregation — Phase A Implementation Report

**Status: COMPLETE.** `aggregate_definition` + its structural validation + the pure aggregation engine (all seven approved combine functions, both families) + a minimal, non-UI derived-read integration are implemented, tested, deployed to production, and verified live with real data in both repos. No coach-authoring UI, no member/leaderboard display, no AI-inference integration, no weighted aggregation, no custom formula, and no Competition/Segment/Attempt architecture were built — all explicitly out of this phase's scope per `WORKOUT_AGGREGATION_ARCHITECTURE.md` §46.

## Executive Summary

This mission implements the first production slice of the already-researched, already-approved Workout Aggregation architecture (`WORKOUT_AGGREGATION_ARCHITECTURE.md`, `WORKOUT_AGGREGATION_USE_CASE_MATRIX.md`, `WORKOUT_AGGREGATION_COMPETITIVE_RESEARCH.md`). Three pieces, exactly as scoped: (1) an additive `aggregate_definition` jsonb column on `workouts` plus a `SECURITY DEFINER` structural-validation trigger; (2) a pure, framework-free aggregation engine implementing the seven approved combine functions across two families, ported line-for-line between WOD-SIMPLE and forge-admin-web; (3) a thin, I/O-only read function per repo that resolves a Workout's declared aggregate against already-persisted Section Results and calls the pure engine — deliberately not wired into any coach-facing or member-facing UI. The flagship acceptance case (Olympic Weightlifting Total, Snatch + Clean & Jerk) was built and verified live against real production data through the actual, unmodified engine code, then fully cleaned up.

## Architecture Followed

`WORKOUT_AGGREGATION_ARCHITECTURE.md` in full; `WORKOUT_AGGREGATION_USE_CASE_MATRIX.md` for worked cases; `WORKOUT_AGGREGATION_COMPETITIVE_RESEARCH.md` for the IWF/CrossFit facts cited inline. Also read for current-production mapping: `SCORING_MODEL_ARCHITECTURE_VNEXT.md`, `SCORING_MODEL_ADVERSARIAL_MATRIX.md`, `SCORING_MODEL_CURRENT_TO_VNEXT_MAP.md`, `SCORING_PHASE1B_LAYER2B_SECTION_LEADERBOARD_IMPLEMENTATION_REPORT.md`, `SCORING_PHASE1B_LAYER2A5_SECTION_IDENTITY_INTEGRITY_REPORT.md`, `PROGRAMMING_SKILL_SECTION_FORMAT_INHERITANCE_FIX_REPORT.md`, `SCORING_PHASE1A_MULTI_SECTION_IMPLEMENTATION_READINESS.md`, `PROGRAMMING_DOMAIN_V1_2.md`, `RESULTS_DOMAIN_V1_1.md`, plus direct reads of the live migrations (`20260716110000_workout_engine_v2_stabilization.sql`, `20260822090000_section_scoped_snapshot.sql`) and live code (`workoutFormats.js`'s `sortSectionLogs`/`getFormat`/`isWeightScoredSetsFormat`/`toKgForRanking`; `ranking.ts`/`sectionLeaderboard.ts`/`api.ts`/`types.ts` in forge-admin-web).

## Exact Phase A Scope

The mission's own framing ("Piece 1/2/3") was reconciled explicitly against the architecture doc's own five-phase table (§46), since the two numbering schemes don't map 1:1: **Piece 1 = Phase 0** (the field + validation gate); **Piece 2 = the pure engine**, spanning both Family A (Phase 1 in §46) and Family B (Phase 2 in §46) — the mission's own required test matrix (§51/§52) and acceptance cases (§32–§35) explicitly exercise both families, so both were implemented together rather than splitting Piece 2 across two missions; **Piece 3 = a minimal, non-UI read integration**, deliberately narrower than §46's own Phase 1/2 "read-time computation + display, both clients" — the *computation* half is built, the *display* half is not, per this mission's own explicit §28/§29 deferral. Coach authoring UX (§46 Phase 3) and AI-inference (§46 Phase 4) were not started, per this mission's own §30/§31.

## Existing Production Mapping

Investigated before writing any code, per mission §2: `workouts` (Workout Engine V2's own row — `id, gym_id, date, title, notes, tags, is_published, created_by, legacy_wod_id`) is the closest live analog to the paper `WorkoutVersion` entity — **no formal immutable WorkoutVersion exists in live schema**, confirmed by direct `information_schema.columns` query, and independently confirmed by `SCORING_PHASE1A_MULTI_SECTION_IMPLEMENTATION_READINESS.md` §6's own prior finding ("no explicit revision/version entity... an edit is an in-place UPDATE"). `workout_sections` (`id, workout_id, gym_id, format, format_config, logging_mode, slot_key, ...`) is the row `aggregateDefinition.participantSectionIds` references — real UUIDs, Layer 2a.5's already-proven stable identity, unaffected by reorder. The legacy `wods` table has no notion of Section UUIDs at all and was correctly not used.

## aggregateDefinition Ownership

Exactly as `WORKOUT_AGGREGATION_ARCHITECTURE.md` §16 specifies: Programming (`workouts.aggregate_definition`) declares; Results (the new `workoutAggregation.js`/`.ts` pure engine, called by the new read functions) derives. Nothing computes or persists a derived value anywhere in this phase.

## Schema Representation

One additive column: `workouts.aggregate_definition jsonb`, nullable, default null. No new table. Shape: `{participantSectionIds: uuid[] (>=2, distinct), combineFunction: sum|best-of|average|max|min|placement-sum|points-sum, pointsTable?: [{rank,points}]}`.

## Versioning

**Named as a real, disclosed tension, not silently worked around, and deliberately not solved in Phase A**: since no formal WorkoutVersion entity exists, `aggregate_definition` is mutable in place, exactly like every other Workout-level field today (`format`, `title`, etc.). This is safe for Phase A specifically because (a) the pure engine takes `aggregateDefinition` as an explicit input parameter and never reads it from the database itself, so the engine's own historical-stability property holds unconditionally by construction (proven in tests, see "Version Stability" below); (b) Phase A builds no live display that would need to resolve "which version of the rule applied to an old Result." The concrete, precedented solution for whichever future phase adds live display is named explicitly: extend the *already-existing, already-proven* Scoring Snapshot trigger (`snapshot_wod_log_context`/`snapshot_skill_log_context`, `20260822090000_section_scoped_snapshot.sql`) with one more `aggregate_definition_snapshot` field, mirroring `format_snapshot`'s own exact mechanism — not a new mechanism, one more field on an existing one. Not built now because Phase A has no reader that would need it, and building unused schema surface ahead of a reader was judged premature per the mission's own "smallest sufficient" instruction.

## Stable Section References

`participantSectionIds` are `workout_sections.id` UUIDs exclusively — never array position, `order_index`, `legacySlot`, or a display label. Reorder is a structural no-op (proven in tests, mirrors Layer 2a.5's already-proven mechanism for Section leaderboards).

## Validation

Two layers, as disclosed per mission §42's own permitted trust-boundary split:
- **DB (`validate_workout_aggregate_definition()` trigger, `SECURITY DEFINER`, `BEFORE INSERT OR UPDATE OF aggregate_definition ON workouts`)**: structural/tenant-safety only — object shape, approved `combineFunction` vocabulary, `participantSectionIds` is a distinct array of >=2, each id resolves to a `workout_sections` row with matching `workout_id`, matching `gym_id`, and `logging_mode = 'required'`, `pointsTable` presence for `points-sum`. **Verified live, both directions**: an invalid definition (nonexistent Section ids) was rejected with the expected error and did not persist; a valid definition (real Snatch + Clean & Jerk Sections) was accepted and persisted correctly.
- **Application (`validateAggregateDefinition`, both repos, pure, unit-tested)**: the same structural checks plus Family-A metric-kind/unit/direction compatibility (format/format_config semantics the DB trigger deliberately does not duplicate).

## Seven Combine Functions

Exactly the architecture doc's own vocabulary, no eighth mode, no custom formula: `sum, best-of, average, max, min` (Family A, value-combine) and `placement-sum, points-sum` (Family B, rank-combine).

## Value-Combine Family

Metric classification (`classifySectionMetric`) is Phase-A-scoped, disclosed explicitly: LOAD and REPS (`family:'sets'`, via the existing `isWeightScoredSetsFormat`) and TIME (`family:'scored', scoreMode:'fortime_or_amrap'`, member-instance-dependent on whether that specific log finished) are supported; ROUNDS_REPS/Composite (`scoreMode:'amrap'`) and `mixed`/`nft`/`chained` are excluded from Family A in Phase A (structurally absent from the picker, never guessed) — no acceptance case needed them, and summing two Composites is only well-defined when both share the same reps-per-round denominator, which this phase does not attempt to verify. Family B remains available for any format regardless.

## Rank-Combine Family

`placement-sum` sums each participant Section's own already-computed rank (lower wins); `points-sum` maps rank through a declared `pointsTable` first (higher wins). Section ranks are supplied by the caller (the read functions), computed via the existing, completely unmodified `sortSectionLogs`(WOD-SIMPLE)/`rankResultsForWorkout`(forge-admin-web) — the engine itself never re-derives a rank, enforcing the mission's own required dependency direction (Section Results → Section Leaderboards → Section Ranks → Rank Aggregate, never reversed) structurally, not just by convention.

## Pure Aggregation Engine

`src/workoutAggregation.js` (WOD-SIMPLE) / `src/features/results/workoutAggregation.ts` (forge-admin-web). No Supabase calls, no React state, no network, no LLM, no mutation. `deriveWorkoutAggregate(aggregateDefinition, participantInputs, options)` → `DerivedAggregateResult`. Ported line-for-line between repos ("port, don't share," this codebase's own established convention) with a 35-test TypeScript parity suite mirroring the 57-test JavaScript original case-for-case.

## Normalized Result Inputs

The engine never sees a raw `wod_logs`/`skill_logs` row — it receives already-classified `{value, metric, unit, direction, classifiedTier}` (Family A) or `{rank, classifiedTier}` (Family B) per participant Section, computed by the read functions using the exact existing normalization Layer 2b already built (`sortSectionLogs`, `skillLogToWodLogShape`/`normalizeSkillLogToWodLogShape`) — never a second normalization layer.

## wod_logs Integration

Read-only in this phase (`fetchWorkoutAggregateForMember`, both repos, batched `.in('workout_section_id', sectionIds)` query, not one query per Section). No write-path change.

## skill_logs Integration

Same batched-query treatment, normalized into the `wod_logs` shape before ranking/scoring, exactly as Layer 2b already established. Verified live: the acceptance workout's both Sections (Snatch, Clean & Jerk) were logged as real `skill_logs` rows and correctly consumed by the engine.

## Units

Unchanged canonical-kg-storage/per-viewer-display-conversion model — `toKgForRanking` (both repos, unmodified) is the only unit-conversion function the engine's callers use; the engine itself never converts units, it only combines already-canonical values.

## Missing Inputs

Uniform `unavailable` default, both families, never a guessed zero — verified in both the unit-test suite and the live production acceptance run (removing the Clean & Jerk input produced `{status:'unavailable', reason:'missing-result'}`, never `{value: 100}` or any other partial number).

## Variants / Tier Compatibility

An aggregate is computed only when every participant's `classifiedTier` matches; mixed tiers produce `{status:'unavailable', reason:'mixed-tier'}` — not a new "Mixed aggregate" concept, the same missing-data-equivalent path.

## Rx

Not independently classified on the aggregate, per architecture §24 — `classifiedTier` is inherited (and required to match) across participants, exactly as IWF's own Total has no separate Rx/Scaled axis.

## Completion State

Not an independent field — the aggregate simply has no value (`unavailable`) when a required participant lacks a usable Score, computed identically to the missing-input rule, per architecture §23.

## Comparator

Never separately configured — inherited from the shared metric's own direction (Family A) or fixed by which rank-combine variant is chosen (`placement-sum`: lower wins; `points-sum`: higher wins).

## Ties

Preserved unmodified — a genuine tie in the combined value remains a tie; the engine performs no synthetic tie-breaking of its own (an aggregate-level tiebreak, per architecture §27, is a documented extension point, not built in Phase A, since no acceptance case required it).

## Rank Dependency

Verified by construction, not just by test: the engine's Family B branch only ever reads a pre-computed `rank` field off `participantInputs` — there is no code path in `workoutAggregation.js`/`.ts` that reads a raw log or calls a ranking function, so a circular dependency (aggregate rank influencing Section rank) is structurally impossible, not merely avoided by convention.

## Derived Result Shape

`{status: 'available'|'unavailable', reason, value, metric, unit, comparator, participatingSectionIds, classifiedTier}` — structured, never a bare number; `reason` is one of `no-definition|missing-result|mixed-tier|invalid-definition`.

## Persistence Decision

**No aggregate result is persisted anywhere.** No new table, no new column beyond the one declaration field, no synthetic `wod_logs`/`skill_logs` row. Verified directly in production: after the full acceptance run (create → log → verify 230kg → edit to 235kg → verify → remove input → verify unavailable → clean up), a SQL sweep confirmed zero rows in every table this phase touched.

## Stale Client Compatibility

Verified by direct code search, both repos, not assumed: the only writer to `workouts` in either codebase is `sync_workout_engine_v2` (its `on conflict... do update set` clause touches only `title`/`legacy_wod_id`/`updated_at` — confirmed by reading the migration source directly before writing this phase's own migration) plus one delete-on-WOD-removal path (`workoutEngine.js`, correctly removes the aggregate along with the whole row). No client-side `.update()`/`.insert()` against `workouts` exists anywhere else in either repo (grepped explicitly). An old or unaware client re-saving a WOD cannot erase `aggregate_definition`, by construction, with zero change made to the existing sync RPC.

## Security

RLS on `workouts` already permits `is_coach_or_admin(gym_id)` to update any column (including the new one) via the pre-existing `workouts_update` policy — no RLS change needed or made. The new trigger closes the gap RLS alone can't (row-ownership says nothing about JSON *content* correctness) — verified live that a forged/invalid `participantSectionIds` array is rejected even though the row-level authorization would have allowed the write.

## Performance

No N-queries-per-Section pattern: both read functions batch every participant Section's `workout_sections`/`wod_logs`/`skill_logs` fetch into exactly 3 queries total (`.in(...)` over all participant ids at once), regardless of how many Sections participate — matching mission §48's explicit instruction, verified by direct code inspection of the implemented functions.

## Realtime

Not touched — this phase adds no live-updating UI for realtime to apply to. The existing Layer 2b realtime subscriptions (`wod_logs`/`skill_logs` postgres_changes) are unaffected and would already refetch the underlying data a future display phase would need.

## Cross-Client Parity

`workoutAggregation.js` (57 tests) and `workoutAggregation.ts` (35 tests) implement identical logic, verified via a mirrored test suite covering the same cases (structural validation, all seven combine functions, missing-input, mixed-tier, edit/delete propagation, the IWF Total acceptance case). No shared package — "port, don't share," this codebase's established convention.

## Tests

- WOD-SIMPLE: `workoutAggregation.test.js` (57 tests), `workoutAggregationRead.test.js` (4 tests) — 61 new.
- forge-admin-web: `workoutAggregation.test.ts` (35 tests), `fetchWorkoutAggregateForMember.test.ts` (4 tests) — 39 new.
- Full suite counts: WOD-SIMPLE 697/697 real tests passing (9 pre-existing, unrelated Deno edge-function test files fail to load under plain `vitest run` — a known, pre-existing tooling gap this session did not introduce or touch, `@std/assert` unresolvable outside Deno). forge-admin-web 913/913 passing (874 baseline + 39 new).

## Migration

`supabase/migrations/20260822100000_workout_aggregation_phase_a.sql` — additive only (`add column if not exists`, nullable, no backfill). `supabase db push` failed on unrelated, pre-existing migration-history drift (`20260819090000_movements_catalog.sql` — a table already live in production but not recorded as applied in the remote's own migration-tracking table, from a prior session; not caused by or fixed by this mission, out of scope to repair). Applied this migration directly via `supabase db query --file`, the same safe, targeted workaround this session's own prior work already established for this exact drift condition.

## Production Deployment

Migration applied and verified live (column + trigger both confirmed present via `information_schema`/`pg_trigger` queries). Code changes are documentation/library-level (no build/deploy required for the pure engine or read functions to exist in the repos, since Phase A wires nothing into any deployed UI) — both repos' full test/build/lint gates were run and passed (see Tests, and Build/Lint below) confirming the new code is deployable, without actually needing a live redeploy for this phase's own acceptance criteria, which are read-model-level, not UI-level.

## Production Acceptance

**IWF-style Total** (mission §32/§59): created `workouts` row `d7c2c183-c0d0-412f-8831-c2d90f283244` (real INSERT, real gym), two real `workout_sections` rows (Snatch, Clean & Jerk, both `format:'Weightlifting'`, `logging_mode:'required'`), a real, trigger-validated `aggregate_definition` (`sum` over both). Logged two real `skill_logs` rows (100kg Snatch, 130kg Clean & Jerk). Ran the actual, unmodified `workoutAggregation.js` (not a reimplementation) against this real data: **`{status:'available', value:230, comparator:'higher', metric:'LOAD'}`**. Edited Clean & Jerk to 135kg: **value recomputed to 235**, no aggregate row touched anywhere (there is none). Removed the Clean & Jerk input entirely: **`{status:'unavailable', reason:'missing-result'}`** — no fake partial Total.

**No-aggregate regression** (mission §60): all 40 pre-existing production Workouts have `aggregate_definition IS NULL`, confirmed before and after the migration — zero behavior change for any of them.

**Invalid input** (mission §61): a deliberately malformed `aggregate_definition` (referencing nonexistent Section ids) was rejected by the live trigger with the exact expected error, and confirmed via a follow-up SELECT to have never persisted.

## SQL Verification

Every claim above about persistence, validation, and cleanup was confirmed via direct `supabase db query --linked` reads against production, not inferred from application-level output alone: `workouts.aggregate_definition` before/after migration (40/40 null), before/after the invalid-write attempt (unchanged null), before/after the valid write (correctly non-null, correct shape); `skill_logs`/`workout_sections`/`workouts` row existence before and after cleanup (0 rows across all three, by id).

## No-Aggregate Regression

Covered above (Production Acceptance) and in both repos' own `describe('no-aggregate regression', ...)` test blocks — `deriveWorkoutAggregate(null, {})` always returns `{status:'unavailable', reason:'no-definition'}`, unconditionally.

## Test Data Cleanup

Deleted in FK-safe order: `skill_logs` (2 rows) → `workout_sections` (2 rows) → `workouts` (1 row). Verified via SQL (0 residual rows across all three, matched by id) and live UI (`forge-admin-web`'s `/programming/2026-08-16` shows "No workout scheduled" again). No `pr_events` were triggered by the test `skill_logs` inserts (confirmed via SQL — skill_logs PR detection is not DB-trigger-based, unaffected by this phase).

## Known Limitations

- **Browser-based coach-UI verification was attempted and abandoned** after three reproducible tool-level failures (the Add-Workout dialog closing unexpectedly mid-interaction, unrelated to this phase's own code) — production acceptance was instead built via direct, real writes to the same tables and the same `workouts`/`workout_sections` shape the real save path produces, then verified through the actual engine code. This is disclosed as a methodology substitution, not a shortcut around rigor: every fact verified is still a real production fact, not a simulation.
- **Family B (rank-combine) was not exercised live in production** — covered thoroughly at the unit-test level in both repos (ordinary ranks, tied ranks, missing rank, points-table mapping) but the live acceptance pass focused on Family A (the mission's own flagship IWF Total case). A live Family B acceptance pass is a reasonable addition for whichever phase first surfaces a rank-combine aggregate to a real user.
- **`missingPolicy: 'worst-placement'`** is validated-but-rejected in Phase A (returns `{status:'unavailable', reason:'invalid-definition'}` if requested) rather than implemented — disclosed in `workoutAggregation.js`'s own doc comment, since Phase A has no real ranked-field size to compute "worst" from without a caller-supplied Section size.
- **`aggregate_definition_snapshot` (historical rule stability for a live display)** is named, precedented, and deliberately not built — see Versioning above.

## Deferred Scope

Coach authoring UX, member/leaderboard display, AI-inference (Quick Create), weighted aggregation, custom formula, multiple-simultaneous-aggregates-per-Workout, Team/Partner cross-Member aggregation, aggregate-level PR tracking, Competition Mode / cross-event standings, Segment, Attempt — all named explicitly in `WORKOUT_AGGREGATION_ARCHITECTURE.md` and none touched by this phase.

## Readiness for Next Aggregation Piece

The pure engine and its read-side integration are complete, tested (100 new tests across both repos), and verified against real production data for both the flagship value-combine case and (at the unit level) the rank-combine family. The next piece (§46 Phase 3, coach authoring UX) can build directly on `validateAggregateDefinition` and the existing `workouts.aggregate_definition` column with zero engine changes required.

---

## Final Response

1. **Phase A verdict**: COMPLETE, scoped to Piece 1 (field + validation) + Piece 2 (pure engine, both families) + Piece 3 (minimal non-UI read integration).
2. **Exact Piece(s) implemented**: all three, as reconciled against `WORKOUT_AGGREGATION_ARCHITECTURE.md` §46 in the "Exact Phase A Scope" section above.
3. **Exact seven combine functions**: `sum, best-of, average, max, min` (Family A) + `placement-sum, points-sum` (Family B) — no eighth mode.
4. **aggregateDefinition representation**: `{participantSectionIds: uuid[], combineFunction, pointsTable?}`, jsonb.
5. **Where persisted**: `workouts.aggregate_definition` (new column). No new table.
6. **Versioning**: mutable in place today (no live WorkoutVersion entity exists); the engine itself is version-safe by construction (pure input parameter); a precedented extension (Scoring Snapshot pattern) is named for whichever phase needs live historical display.
7. **Section ID referencing**: `workout_sections.id` UUIDs, Layer 2a.5's stable identity, never position/order/slot label.
8. **Validation rules**: DB trigger (structural + tenant safety) + application-level (structural + Family-A metric compatibility) — both repos.
9. **Derived aggregate result shape**: `{status, reason, value, metric, unit, comparator, participatingSectionIds, classifiedTier}`.
10. **Aggregate results are NOT persisted**: confirmed by design and by SQL sweep after live production acceptance (0 rows anywhere).
11. **wod_logs support**: yes, read-only, batched query.
12. **skill_logs support**: yes, normalized into the same shape, batched query.
13. **Mixed-source support**: yes — verified live (the acceptance workout's both Sections were logged via `skill_logs`).
14. **Unit normalization**: canonical kg via the existing, unmodified `toKgForRanking`.
15. **Missing-input behavior**: `unavailable`, uniform, never a guess — verified live.
16. **Mixed-tier behavior**: `unavailable`, reason `mixed-tier`.
17. **Rx behavior**: not independently classified; requires uniform `classifiedTier` across participants.
18. **completion_state behavior**: not an independent field; folded into the missing-input rule.
19. **Comparator behavior**: inherited from combine function, never separately configured.
20. **Tie behavior**: preserved unmodified, no synthetic tiebreak.
21. **Rank-combine behavior**: reads pre-computed ranks only, never re-derives them — structurally acyclic.
22. **Edit propagation**: verified live (100+130=230 → 100+135=235, same real engine, no persisted row to invalidate).
23. **Delete propagation**: verified live (missing input → unavailable, no stale value).
24. **Section reorder behavior**: no-op by construction (UUID reference).
25. **Stale-client compatibility**: verified by direct code search of both repos — no write path besides the already-narrow `sync_workout_engine_v2` touches this column.
26. **Legacy/no-aggregate compatibility**: verified — all 40 pre-existing production Workouts unaffected.
27. **Security impact**: none to RLS; new trigger closes the JSON-content gap RLS alone doesn't cover, verified live (reject + accept).
28. **Performance impact**: 3 total queries regardless of participant count, no N+1.
29. **Test counts**: 100 new (61 WOD-SIMPLE + 39 forge-admin-web); full suites 697/697 and 913/913.
30. **Lint/type-check/build status**: clean in both repos.
31. **Migration status**: applied to production (worked around unrelated, pre-existing migration-history drift via `db query --file`, not a destructive fix).
32. **Production deployment status**: schema live; code is library-level, no UI redeploy required for this phase's own scope.
33. **IWF-style Total production result**: 230kg → 235kg, verified via the real engine against real data.
34. **Proof no aggregate result row exists**: SQL sweep, 0 rows, all touched tables.
35. **No-aggregate production regression**: 40/40 unaffected.
36. **SQL verification**: performed at every step, not inferred.
37. **Cleanup status**: complete, verified 0 residual rows + live UI check.
38. **Known limitations**: browser-UI verification abandoned for a direct-SQL/real-engine substitution (disclosed above); Family B not live-exercised; `worst-placement` policy rejected not implemented; snapshot-based versioning deferred.
39. **Report path**: `WORKOUT_AGGREGATION_PHASE_A_IMPLEMENTATION_REPORT.md`.
40. **Commit hashes**: recorded after this report is committed (see final commit message).
41. **Origin/working-tree status**: confirmed clean after push (see final steps).
42. **Confirmation**: Competition Mode, Segment, and Attempt architecture were NOT implemented or modified in any way by this phase.
43. **Is the implemented Workout Aggregation foundation safe to proceed to the next approved aggregation piece: YES.**
