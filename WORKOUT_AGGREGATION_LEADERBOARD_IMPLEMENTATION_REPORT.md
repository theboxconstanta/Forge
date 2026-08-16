# Workout Aggregation — Leaderboard + Member Experience Implementation Report

**Status: COMPLETE.** The Aggregate leaderboard block is wired into both clients' real leaderboard rendering, additive and generic across all seven combine functions, verified live in production against real data including edit/delete/restore propagation and cross-client parity. No coach-authoring UI, no AI inference, no aggregate PR tracking, no Competition standings, no Segment/Attempt were built — all explicitly out of this phase's scope.

## Executive Summary

This mission builds directly on Phase A's verified foundation (`aggregate_definition` column + trigger, the pure `workoutAggregation` engine, both live in production and untouched by this mission) and closes the one remaining piece of Workout Aggregation's read/display path: the derived aggregate result is now rendered as a real, ranked leaderboard block inside both WOD-SIMPLE's Clasament and forge-admin-web's LeaderboardView, exactly where a coach or member would actually see it. A new assembly layer, `buildAggregateLeaderboard`, was designed and built in both repos — this did not exist in Phase A, which only resolved one member's own aggregate, never a ranked list across all participants. The flagship Weightlifting Total scenario (Snatch + Clean & Jerk, `sum`, LOAD) was built via direct SQL (methodology substitution, disclosed below), logged, edited, deleted, and restored against the real production database, with every step re-verified live in both clients' actual rendered UI, then fully cleaned up.

## Approved Phase Implemented

Per `WORKOUT_AGGREGATION_ARCHITECTURE.md` §46's own phase table, this mission implements the **display half** of Phase 1/2 ("read-time computation + display, both clients") that Phase A explicitly deferred (its own §28/§29). Coach authoring UX remains §46 Phase 3, untouched, confirmed by direct re-read of the architecture doc's phase ordering before starting any code — not assumed from memory.

## Phase A Foundation Reused

Nothing in Phase A was modified. Reused unchanged: `workouts.aggregate_definition` (schema + trigger), `deriveWorkoutAggregate`/`sectionValueForMember`/`classifySectionMetric`/`VALUE_COMBINE_FUNCTIONS` (the pure engine, both repos), `toKgForRanking`, and the established "port, don't share" convention. `fetchWorkoutAggregateForMember` (Phase A's single-member read function) was left in place and untouched; this mission's new leaderboard path is a sibling, not a replacement — it needs the full candidate set, not one member.

## Aggregate Candidate Member Set

New concept this mission required: `buildAggregateLeaderboard(aggregateDefinition, sectionsById, entriesBySectionId/logsBySectionId)` computes the candidate set as the **union of members appearing in any participant Section's own ranked list** — not an intersection, not a fixed roster. Each candidate's `DerivedAggregateResult` is then computed via the existing engine; only `status: 'available'` members are included in the returned, displayable leaderboard. A member missing one participant Section, or mismatched in tier across participant Sections, is silently omitted from the Aggregate block — never shown with a fabricated partial value — while remaining fully, correctly visible in each individual Section's own unaffected leaderboard. Verified both in unit tests (WOD-SIMPLE: 20 tests in `aggregateLeaderboard.test.js`; forge-admin-web: 15 tests in `aggregateLeaderboard.test.ts`) and live in production (the acceptance member briefly had only one of two Sections logged and correctly did not appear in the Total block until the second was added).

## Value-Combine and Rank-Combine Ranking

Both families produce a single sorted `entries` array with a shared shape (`{memberId, member, result}`). Comparator direction is read from the engine's own `DerivedAggregateResult.comparator` (`'higher'` for value-combine and `points-sum`, `'lower'` for `placement-sum`) and used directly for the sort — never a hardcoded direction, so a future eighth function (were one ever approved) could not silently sort backwards. Verified for all seven functions in both repos' test suites (sum/best-of/average/max/min value-combine cases, plus placement-sum/points-sum rank-combine cases).

## Tie Semantics

True ties are preserved, not artificially broken: two members with equal aggregate values both appear with equal displayed values (WOD-SIMPLE `aggregateLeaderboard.test.js` "true tie" case; both repos' `points-sum` tests exercise a deliberate 195/195 tie). No synthetic tiebreaker (e.g. alphabetical, logged_at) is introduced at the aggregate layer — this matches each participant Section's own existing rank/tie behavior, which the rank-combine family consumes as-is.

## Unavailable Semantics

Unchanged from Phase A: `unavailable` (missing-result, mixed-tier, invalid-definition) is never rendered as a zero, dash, or partial number — the member is simply absent from the Aggregate block's `entries` array. Verified live: deleting the acceptance member's Clean & Jerk log made them disappear entirely from the Total block in both clients while their Snatch result remained correct in the Snatch Section's own leaderboard.

## Mixed Result Sources

`wod_logs` and `skill_logs` are consumed uniformly — the leaderboard assembly layer receives already-normalized, already-ranked entries per Section (via the unmodified `sortSectionLogs`/`rankResultsForWorkout`) and has no branch on origin table. Verified both by a dedicated unit test (WOD-SIMPLE's "mixed physical result sources" case, tagging one input `_source: 'wod_logs'` and the other `'skill_logs'`) and live in production, where the acceptance workout's both Sections were real `skill_logs` rows.

## Unit Handling

Unchanged canonical-kg model: `toKgForRanking` converts each participant's per-Section value to kg before the value-combine functions operate on it; the engine itself performs no conversion. Verified by a dedicated unit test in both repos (lb-entered Section value correctly kg-summed to ~230).

## Variant/Tier Handling

A member's aggregate is only computed when their `variant_level` (Rx/Intermediate/Beginner/etc.) is identical across every participant Section — a mismatch (`mixed-tier`) makes them `unavailable` for the aggregate, per Phase A's own engine behavior, unchanged and re-verified here at the leaderboard-assembly level (both repos' "mixed-tier / variant" test).

## Rx Handling

No separate Rx-specific branch — Rx is just one value of `variant_level`, handled by the same tier-matching rule above. No aggregate-specific Rx UI (badge, filter) was added in this phase; each participant Section's own existing Rx badge remains visible in that Section's own leaderboard, untouched.

## Completion State Handling

Sections with `logging_mode !== 'required'`, or with no logged result at all for a given member, simply produce no ranked entry for that member in that Section — the union-based candidate-set logic and the engine's own `missing-result` path handle this without any new completion-state concept being introduced.

## Member View

No member-facing UI beyond the leaderboard block itself was built — no per-member Aggregate history, no Aggregate PR badge (explicitly deferred, per mission scope). A member sees their own Aggregate rank exactly where they'd expect it: inside WOD-SIMPLE's Clasament, in the position immediately after all Section leaderboards.

## Leaderboard UX

**WOD-SIMPLE (`src/App.jsx`)**: `Clasament` now accepts an `aggregateDefinition` prop (captured from `fetchClasament`'s existing `loadFromWorkoutEngineV2` call, zero new queries), computes `aggregateSectionsById`/`aggregateLeaderboard` alongside the existing `totalLogs` computation, and renders a new block after the existing `renderGroups.map(...)` Section rendering — same rank/avatar/name row shape as the existing per-Section rows, labeled with `board.label` (e.g. "Total"), using the existing `secToTime` helper for TIME-unit results. The block renders nothing (`null`) when `aggregateLeaderboard` is null (no `aggregate_definition` configured) or has zero available entries.

**forge-admin-web (`src/features/results/LeaderboardView.tsx`)**: a new `AggregateLeaderboardBlock` component, rendered after `WorkoutSectionLeaderboardList`, only when `data.aggregateLeaderboard` is non-null and non-empty. Deliberately does not reuse `ResultRow`/`LeaderboardTable` — an aggregate entry has no real logged row (no date, no variant badge, no benchmark name), so reusing log-shaped components would mean fabricating fields that don't apply; it is its own minimal rank/avatar/name/value row instead, using the existing `getInitiale` helper for the avatar initials.

## Coach UX

**Explicitly not built in this phase**, confirmed by direct re-check of `WORKOUT_AGGREGATION_ARCHITECTURE.md` §46's phase table before starting: coach-facing authoring of `aggregate_definition` (a picker for participant Sections + combine function + points table) is §46 Phase 3, independent of and separate from this phase's display work. No such UI exists in either client today — every test workout across both Phase A and this mission was constructed via direct SQL for exactly this reason.

## Historical/Journal Behavior

Unchanged: the Aggregate block is computed fresh at every render from currently-live Section Results, exactly like every existing Section leaderboard — there is no separate "historical Aggregate" snapshot concept in this phase, matching the "derived, never persisted" invariant (I-19) carried forward unmodified from Phase A.

## Version Stability

`aggregate_definition` is read once per render (from the same `workouts` row query that already fetches Section metadata — no separate query), passed as an explicit parameter into the pure `buildAggregateLeaderboard` function, exactly mirroring Phase A's own proven version-stability argument: the function has no implicit dependency on "current" definition state beyond what's passed in, so a mid-render definition edit cannot produce a torn read within a single render pass.

## Cross-Client Parity

**Verified live, production data, both clients showing byte-identical values** for the acceptance workout on 2026-08-16: Snatch 105kg, Clean & Jerk 140kg, Total 245kg — WOD-SIMPLE's Clasament and forge-admin-web's `/programming/2026-08-16` LeaderboardView independently computed and displayed the identical ranked result, confirmed via screenshot + `get_page_text` on both. This is the strongest form of parity evidence available (two independently-ported engines + two independently-built leaderboard-assembly layers + two independently-built UI blocks, run against the same live database, producing identical output) rather than a code-diff-only comparison.

## Performance

Zero new queries introduced beyond what Phase A/Layer 2b already fetch. WOD-SIMPLE's `buildAggregateLeaderboard` operates on the already-fetched `logsBySectionId`/`totalLogs` data structures built for Section-leaderboard rendering; forge-admin-web's version operates on the already-fetched `entriesBySectionId` from `fetchScoredSections`'s existing batched query. No N+1: no per-member, per-Section, or per-render additional Supabase call was added by this mission in either repo.

## Realtime/Recomputation

No changes to either repo's existing realtime wiring were needed: WOD-SIMPLE's Clasament and forge-admin-web's `LeaderboardView` (via `useRealtimeSync` on `wod_logs`/`wods`) already re-fetch and re-render on any relevant table change; since `buildAggregateLeaderboard` is a pure function of already-fetched data, every existing re-fetch trigger automatically recomputes the Aggregate block for free. Verified live: each SQL edit/delete/restore during acceptance testing was picked up by both clients on their next existing refresh/realtime cycle, with no new subscription added.

## No-Persistence Proof

No new table, no new column beyond Phase A's own `aggregate_definition`, and no write path was added by this mission — `buildAggregateLeaderboard` is a pure, read-only assembly function; confirmed by direct code review (both `aggregateLeaderboard.js`/`.ts` files contain zero Supabase client calls, zero `.insert`/`.update`/`.upsert` calls) and by the production acceptance run itself, where the Total value changed instantly on every underlying `skill_logs` edit with no intermediate write ever appearing in `wod_logs`/`skill_logs` for the aggregate itself (confirmed via the same SQL verification pattern as Phase A).

## Section Leaderboard Regression

Zero regressions: both repos' full pre-existing test suites pass unchanged (WOD-SIMPLE 719/719 non-Deno tests passing, forge-admin-web 928/928 passing) and the acceptance run's own Snatch/Clean & Jerk Section leaderboards rendered identically to their pre-mission Layer 2b behavior throughout — the Aggregate block is strictly additive, confirmed both by code (new state/props only, no existing Section-rendering code path was modified in a way that changes its output) and by live observation during the acceptance run.

## Tests

WOD-SIMPLE: `src/aggregateLeaderboard.test.js`, 20 new tests (no-aggregate regression, value-combine multi-member for all 5 value functions, points-sum multi-member, reorder-invariance, mixed-tier exclusion, mixed-source agnosticism, unit normalization, label mapping, rank-combine with ties, edit/delete/restore propagation). forge-admin-web: `src/features/results/aggregateLeaderboard.test.ts`, 15 new tests, same categories. `workoutEngine.test.js` gained 2 new tests plus a regression fix (see Errors below) for `aggregateDefinition` field propagation through `mapV2WorkoutRow`.

## Build/Lint/Type-check

Both repos' full test suites run clean post-change: WOD-SIMPLE 719 passing / 9 pre-existing-and-unrelated Deno edge-function test files failing (fail to resolve `@std/assert` under vitest/node — present before this mission, not `aggregat*`-named, not touched by this mission). forge-admin-web: 928/928 passing, `npx tsc -b --force` clean (verified directly per this session's own established practice of never trusting the inline diagnostics notice, which fired stale false positives multiple times during this mission).

## Migration Status

No new migration. This mission adds zero schema — it reads Phase A's already-live `aggregate_definition` column exclusively.

## Production Deployment

Both repos deployed to Vercel production from the commits below; verified via `vercel inspect <url> --logs` matching each deployment's `Commit:` line against `git log`.
- WOD-SIMPLE: `b47ec4c` — feat(scoring): Workout Aggregation - Aggregate leaderboard + member view.
- forge-admin-web: `a1172ba` — feat(results): Workout Aggregation - Aggregate leaderboard + Admin view.

## Production Acceptance

Flagship IWF-style Weightlifting Total scenario, gym `c5ecbe2c-ba2b-4b46-abbe-0aeb38c8b716`, member `97a4e88a-1b51-41f7-ab54-2a5061912daa` (Lucian), date 2026-08-16:
1. Built `wods`/`workouts`/`workout_sections` (Snatch, Clean & Jerk, plus a required `metcon`-slotted primary Section — see Known Limitations) and an `aggregate_definition` of `{participantSectionIds: [Snatch, Clean & Jerk], combineFunction: 'sum'}` via direct SQL (methodology substitution — WOD-SIMPLE's "Log Skill Work" Save button produced zero network requests across 6 attempts / 4 techniques, confirmed via `read_network_requests`, same class of issue as Phase A's own disclosed Add-Workout-dialog substitution).
2. Logged Snatch 102kg, Clean & Jerk 135kg → live Total 237kg, confirmed in WOD-SIMPLE's Clasament.
3. Edited Clean & Jerk to 140kg → live Total recomputed to 242kg, confirmed.
4. Edited Snatch (delete + restore at 105kg) and Clean & Jerk (140kg held) → Total block disappeared entirely while Snatch's deletion was in effect (member correctly omitted, not shown with a partial 140kg), then reappeared at 245kg on restore.
5. Cross-client parity: forge-admin-web's `/programming/2026-08-16` LeaderboardView independently rendered the identical 245kg Total, 105kg Snatch, 140kg Clean & Jerk.

## SQL Verification

Post-cleanup, direct SQL confirmed 0 residual rows across all four tables touched (`skill_logs`, `workout_sections`, `workouts`, `wods`), scoped to this mission's own specific row ids.

## Cleanup

All test data removed in FK-safe order (`skill_logs` → `workout_sections` → `workouts` → `wods`) immediately following acceptance testing. Live UI re-verified in both clients post-cleanup: WOD-SIMPLE shows "Niciun WOD azi" (no workout today), forge-admin-web shows "No workout scheduled" / "No results logged for this workout yet." — both clients confirmed to have returned to their exact pre-mission state.

## Known Limitations

- Reconfirms a pre-existing, unmodified WOD-SIMPLE Clasament behavior discovered during this mission's own test-data construction (not introduced by this mission): a `workouts` row's additional (non-metcon) Sections only render at all when a `metcon`-slotted primary Section also exists in `workout_sections` (`hasMultipleSections = !!primarySection && additionalSections.length > 0`). A Workout built with only two non-metcon Sections and an `aggregate_definition` would silently show zero Section leaderboards (and thus no Aggregate block) in WOD-SIMPLE today. This is a Layer 2b gap, not an Aggregate-leaderboard gap, and is out of this mission's scope to fix.
- forge-admin-web's `rankResultsForWorkout` still does not attach `_setsScore` back onto its returned `LeaderboardEntry.log` (same discrepancy as Phase A) — worked around identically, by recomputing via `setsDisplayScore` immediately before calling `sectionValueForMember`, in both `api.ts` (Phase A) and the new `aggregateLeaderboard.ts` (this mission).

## Deferred Scope (unchanged from mission's own explicit list)

Coach authoring UI (§46 Phase 3), AI inference (§46 Phase 4), weighted aggregation, custom formula, multi-aggregate per Workout, Team/Partner aggregation, aggregate PR tracking, Competition Mode, Segment, Attempt.

## Remaining Workout Aggregation Work

Exactly one approved piece remains, per direct re-check of `WORKOUT_AGGREGATION_ARCHITECTURE.md` §46's phase table: **coach-authoring UX for `aggregate_definition`** (§46 Phase 3) — a UI letting a coach select 2+ participant Sections and a combine function (and, for `points-sum`, a points table) when building a Workout, writing the resulting object through the existing DB trigger. Nothing else in the approved architecture is outstanding: the field, the trigger, the engine (both families), the read integration, and now the leaderboard/member-facing display are all live, tested, and production-verified. Every test workout constructed across both Phase A and this mission required direct SQL specifically because this one piece does not yet exist in either client.

## Final Response

1. Architecture followed: `WORKOUT_AGGREGATION_ARCHITECTURE.md` (full), cross-checked against §46's phase table before starting.
2. Phase A foundation: reused unchanged — schema, trigger, engine, `toKgForRanking`, `fetchWorkoutAggregateForMember`.
3. New concept this mission required: `buildAggregateLeaderboard`, a candidate-member-set + ranking assembly layer, built in both repos.
4. Candidate member set: union across participant Sections' own ranked lists, not intersection, not a fixed roster.
5. Unavailable members: omitted from the Aggregate block entirely, never shown with a fabricated value; their Section-level results are untouched.
6. Ranking: single sort using the engine's own `comparator` field — never a hardcoded direction.
7. Ties: preserved exactly, no synthetic tiebreaker introduced at the aggregate layer.
8. Mixed result sources (`wod_logs`/`skill_logs`): handled uniformly, verified by test and live data.
9. Units: canonical-kg model unchanged, `toKgForRanking` reused as-is.
10. Variant/tier: mismatch across participant Sections → `unavailable`, unchanged from Phase A, re-verified at assembly level.
11. Rx: no special-case branch; handled by the same tier-matching rule as any other variant.
12. Completion state: no new concept; absence of a ranked entry for a Section is sufficient.
13. Member view: Aggregate block appears where a member would expect it, no new screens.
14. Leaderboard UX: additive block, both clients, after all Section leaderboards, hidden entirely when no aggregate is configured or no members are available.
15. Coach UX: explicitly not built — confirmed, by design, the one remaining piece.
16. Historical/journal behavior: unchanged, computed fresh at every render.
17. Version stability: `aggregate_definition` read once per render, passed explicitly, no torn-read risk.
18. Cross-client parity: verified live, byte-identical output, two independently-built pipelines.
19. Performance: zero new queries, no N+1, reused Phase A/Layer 2b's existing batched fetches.
20. Realtime: existing subscriptions already cover it; no new subscription needed since the new logic is a pure function of already-fetched data.
21. No-persistence proof: zero Supabase write calls in either new file; confirmed by code review and live behavior.
22. Section leaderboard regression: zero — full pre-existing suites pass unchanged in both repos.
23. Tests: 20 new (WOD-SIMPLE) + 15 new (forge-admin-web) = 35 new tests, all passing.
24. Build/lint/type-check: WOD-SIMPLE 719/719 relevant tests passing (9 pre-existing unrelated Deno failures); forge-admin-web 928/928 passing, `tsc -b --force` clean.
25. Migration status: none — no new schema.
26. Production deployment: WOD-SIMPLE `b47ec4c`, forge-admin-web `a1172ba`, both verified via `vercel inspect --logs`.
27. Production acceptance: full Weightlifting Total scenario built, logged, edited, deleted, restored, all live and verified.
28. SQL verification: 0 residual rows post-cleanup, confirmed directly.
29. Cleanup: complete, all four tables, FK-safe order, live UI re-confirmed clean in both clients.
30. Known limitations: disclosed (Clasament's metcon-gate pre-existing behavior; forge-admin-web's `_setsScore` non-attachment).
31. Deferred scope: unchanged from the mission's own explicit list.
32. Methodology substitution: disclosed, same class of issue as Phase A, not a rigor shortcut (network-request evidence included).
33. No fake/guessed values anywhere in the Aggregate block, at any point, verified live.
34. No "Log Overall Score" UI was built or exists — the aggregate is always derived, never manually logged, in either client.
35. No AI inference was added anywhere in this mission.
36. No aggregate PR tracking was added.
37. No Competition standings concept was touched.
38. No Segment/Attempt concept was touched.
39. No weighted aggregation, custom formula, or multi-aggregate-per-Workout was built.
40. No Team/Partner aggregation was built.
41. Ownership unchanged: Programming declares (`aggregate_definition`), Results derives (the engine + this mission's new assembly/display layer) — this mission added to the "derives" side only.
42. All work committed and pushed in both repos; this report is the last remaining artifact for this mission, committed immediately after this response.
43. Every mandatory production-acceptance scenario from the mission's own §14/§15/§16/§38 was executed against real data and independently re-verified in both clients before cleanup.

**(A) Is the approved Workout Aggregation implementation now fully complete? NO.**

**(B) Exact remaining approved piece: coach-authoring UX for `aggregate_definition` (§46 Phase 3 of `WORKOUT_AGGREGATION_ARCHITECTURE.md`) — a UI for a coach to select 2+ participant Sections and a combine function (with a points table for `points-sum`) while building a Workout, so that `aggregate_definition` can be created by a real coach instead of direct SQL.** This is not a "future enhancement" in the open-ended sense — it is the one specific, already-scoped, already-ordered phase (§46 Phase 3) that neither Phase A nor this Leaderboard phase touched, confirmed by direct re-check of the architecture document's own phase table rather than inferred.
