# FORGE — Phase 1B, Layer 2b — Section-Aware Leaderboards — Implementation Report

**Status: COMPLETE.** Section-aware leaderboard grouping and ranking is implemented, tested, deployed, and verified live in production in both WOD-SIMPLE (member PWA) and forge-admin-web (coach/admin app). A real, pre-existing, out-of-scope bug in the Programming-domain Skill-section format editor was discovered during live verification, disclosed below, and is NOT fixed by this mission (Results/leaderboard read-side only). Phase 1B is now feature-complete for whole-Section scoring; A+B aggregation and Segment/Attempt remain explicitly out of scope and were not started.

## Executive Summary

Before this mission, both clients' leaderboards (`Clasament` in WOD-SIMPLE, `LeaderboardView`/`ranking.ts` in forge-admin-web) grouped every logged result for a Workout by `wod_id` alone, then sliced only by Scaling tier (RX/Intermediate/Beginner/OnRamp). This was correct for 100% of production Workouts to date (every one has exactly one scored Section, confirmed live before starting), but structurally wrong the moment a coach used Layer 1/2a's own "independently scored" feature to add a second scored Section: every result — regardless of which Section it actually belonged to, or which comparator family it used (TIME vs LOAD vs ROUNDS_REPS) — was pooled into one ranking. `workout_section_id` (Layer 2a's write-time identity, Layer 2a.5's proven-stable identity) was already selected in both clients' queries but never read by the ranking/grouping logic.

This mission re-keys both clients' leaderboard grouping from `(wod_id, variant_level)` to effectively `(wod_id, workout_section_id, variant_level)`, exactly as the Phase 1A readiness document prescribed. It also adds `skill_logs` as a second leaderboard result source in both clients — previously never read for leaderboard purposes at all, despite already carrying `workout_section_id` since Layer 2a. The existing per-format comparator engine (`sortLogs`/`ranking.ts`'s `rankResultsForWorkout`) is reused unmodified in its core logic — only extracted into a reusable, per-Section-parameterized form, not rewritten. Single-scored-Section Workouts (100% of real data today) render byte-identical to before Layer 2b; the "PART" grouping UI only appears once a Workout genuinely has more than one scored Section.

## Scope

In scope: Section-aware leaderboard grouping, ranking, and member/coach result display, for `wod_logs`- and `skill_logs`-backed results, in both clients. Out of scope (per mission, none started): A+B aggregation, overall/combined winner, Segment, Attempt, a new scoring engine, Rx/scaling-tier support for non-primary Sections, authoring/write-path changes (aside from the disclosed pre-existing bug found and *not* fixed).

## Prior Layer Dependencies

- **Layer 1**: `logging_mode`/`*_scored` on Sections — the source of truth for "is this Section independently scored" (`workout_sections.logging_mode = 'required'`).
- **Layer 2a**: `workout_section_id` on both `wod_logs` and `skill_logs`; the section-scoped Scoring Snapshot trigger (`snapshot_wod_log_context`/`snapshot_skill_log_context`, both `BEFORE INSERT OR UPDATE OF wod_id`, confirmed live to branch correctly on non-primary Sections).
- **Layer 2a.5**: `legacySlot`-based identity stability — proven live (this mission's own production reproduction, see below) that reordering Sections after results exist never moves content or corrupts result-to-Section linkage.

## Current Leaderboard Pipeline Before

Traced precisely before making any change (both repos):

- **WOD-SIMPLE**: `fetchClasament` (`App.jsx`) queried `wod_logs` filtered by `wod_id` only (no `skill_logs` at all); `Clasament`'s `sortLogs`/`dedupLogsGlobal`/`getSectionLogs`/`NIVELE` closed over a single page-wide `wodZiFormat`/`wodZiData` derived from the day's primary `wods` row. `dedupLogsGlobal` ran globally across every result before any tier split — a member with results in two Sections would have one silently dropped.
- **forge-admin-web**: `fetchWorkoutResultsForDate` (`api.ts`) queried `wod_logs` only; `buildLeaderboard`/`rankResultsForWorkout` (`ranking.ts`) already read `workout_section_id` off each row (typed on `WodLogRow`) but never grouped by it — `LeaderboardSection.tier` was the only grouping key, sourced purely from `variant_level`.
- Both repos: comparator dispatch (`sortLogs`'s three branches / `rankResultsForWorkout`'s three branches) selected a comparator family from the **primary Section's** format only, regardless of which Section a given row actually belonged to.

## Result Sources

Confirmed via live schema inspection (not assumed): both `wod_logs` and `skill_logs` carry `workout_section_id`, and both have their own section-scoped Scoring Snapshot trigger. Which physical table a result lands in is decided by the **Section's own format family** at write time, not by `slot_key`: a `skill`/`skill2`-slot Section with a `family:'sets'` format (Weightlifting, Strength Sets, etc.) logs through `skill_logs` (the dedicated "Skill Work" UI); a `skill`/`skill2`-slot Section with any other format (AMRAP, RFT, For Time, etc.) logs through the **same** generalized `wod_logs` + `workout_section_id` write path Layer 2a built for genuinely new Sections. This was verified directly in production during this mission's own acceptance test (see below) — not assumed from reading code alone.

## `wod_logs` Integration

Unchanged write path. Read side: both clients now group `wod_logs` rows by `workout_section_id`, falling back to the primary Section's id when `workout_section_id` is `NULL` (pre-Layer-2a legacy rows — by construction always primary-Workout logs, so this fallback is exact, not a guess, per the Phase 1A readiness doc §35).

## `skill_logs` Integration

Newly read for leaderboard purposes in both clients (previously not read at all outside each member's own Workout History/Journal). `skill_logs` rows lack several `wod_logs` fields (`time_result`, `weight_logged`, `completion_state`, `variant_level`) — both clients normalize a `skill_logs` row into the shape the shared comparator/display code already expects (`sortSectionLogs`'s reused fields in WOD-SIMPLE; `skillLogToWodLogShape` in forge-admin-web), rather than writing a second, parallel ranking/display implementation. `variant_level` is set to the literal `'RX'` on normalization, matching exactly what Layer 2a already writes for `wod_logs`-backed additional Sections ("a single prescription, treated as RX" — skill/skill2 never had scaling tiers). A `skill_logs` row with `workout_section_id NULL` (pre-Layer-2a Skill Work, predating any scored-Section concept entirely) is deliberately **excluded**, not defaulted to primary — there is no correct Section to attach it to, and it remains fully visible in the member's own history, just not ranked.

## Section Identity Grouping

Both clients: fetch every currently `logging_mode:'required'` Section for the displayed Workout (primary/`metcon` first, others in `order_index` order), then group all fetched logs (`wod_logs` ∪ normalized `skill_logs`) by resolved Section id, restricted to Sections in that required-set. A result whose Section was later un-scored by the coach is excluded, not silently reassigned to a neighboring Section. When zero Sections exist (legacy Workout, or nothing scheduled), every log is bucketed under one implicit key — byte-identical to pre-Layer-2b behavior, not a special case grafted on top of it.

## Normalization Layer

No new database table, view, or entity. WOD-SIMPLE: `sortSectionLogs` + three small pure helpers (`parseTimeResult`/`parseRoundsScore`/`partialRepsOfLog`), moved from a `Clasament`-local closure into `workoutFormats.js` as parameterized, independently-testable exports. forge-admin-web: a new small pure module `sectionLeaderboard.ts` (`groupLogsBySection`, `resolveSectionId`, `sortScoredSections`, `wrapAsSingleTier`, `skillLogToWodLogShape`) — `ranking.ts` itself (the actual comparator engine) was **not modified**, only called once per Section instead of once per Workout.

## Comparator Reuse

The three-branch comparator (`sets` family / `chained` family / default finished-vs-partial) is untouched logic in both repos — only its inputs changed, from a single page-wide format to each Section's own `format`/`format_config`. No new scoring engine, no new tie-break rule, no change to the `completion_state ?? !!time_result` dual-path. The pre-existing, documented deviation from `LEADERBOARD_RULES.md`'s "1-1-3 shared ranking" / "best of the day, not most recent" rules (both repos' comparators use a strict `logged_at` tie-break and keep-most-recent duplicate selection) was identified during research and deliberately **preserved as-is**, not fixed — out of this mission's scope, disclosed here rather than silently carried forward.

## Completion State

Unaffected — the per-row `completion_state ?? !!time_result` dual-path already operated at `wod_logs`-row granularity, the same granularity a Section-scoped result now uses. Verified live: the primary RFT Section's logged result correctly showed `completion_state:'completed'` and ranked via the finished branch.

## Rx

Preserved, unchanged, for the **primary** Section only (the only Section type that ever had scaling tiers/Rx classification). Additional Sections (Skill/Skill2/new) have no Rx/Not-Rx classification — disclosed as a known, pre-existing limitation (Layer 2a never built weight/movement-deviation capture for `skill_logs`, and the `workout_sections.movements` JSON shape isn't compatible with the existing `isNotRxd`/`classifyRxStatus` comparison logic without new capability this mission didn't build). Not a regression — these Sections never had Rx classification before Layer 2b either.

## Variants / Mixed Categories

Fully preserved, unchanged, for the primary Section (WOD-SIMPLE's RX/Intermediate/Beginner/OnRamp split + synthetic "Mixed Categories" bucket; forge-admin-web's `buildLeaderboard`/`resolveEntryRxStatus`). Additional Sections render a single flat block (no tiers, no Mixed Categories bucket) — correct, since they have no scaling variants to be "mixed" against.

## Male/Female

Unchanged filter, now applied per-Section-block instead of once globally — same underlying `profile.gender` post-filter logic, just re-run per group.

## Units

Unchanged kg/lb ranking normalization (`toKgForRanking`) — verified still applies correctly to a LOAD-scored additional Section (Squat Clean, live production test: single-member so cross-unit ranking wasn't directly exercised live, but the exact same, unmodified `toKgForRanking`-based comparator function is called for every Section, primary or not — see Known Limitations for the live-verification gap this implies).

## True Ties

No change — the pre-existing `logged_at` strict tie-break (see Comparator Reuse) is used per-Section now instead of per-Workout. Not independently re-verified live per-Section (single test member throughout); covered at the unit-test level (`sortSectionLogs`/`rankResultsForWorkout` ties already tested pre- and post-this-mission).

## Partial Logging

Verified directly, both live and at the unit level: a member's result for Section A does not require or imply a result for Section B — each Section's bucket is built independently from its own filtered subset. Fixed a related latent bug while doing this: the old `dedupLogsGlobal` deduped a member to their single most-recent log **across all Sections** before any Section split — a member with real results in two Sections would have had one silently dropped. Both repos' dedup now happens per-Section-bucket, not globally.

## Editing / Deletion

Not independently exercised live this pass (would require creating and then editing/deleting a second result, beyond this mission's live-verification budget) but structurally guaranteed: each Section's ranking is recomputed independently from its own filtered log subset on every fetch — editing or deleting a result in Section A cannot affect Section B's computation, since Section B's query/filter never includes Section A's rows in the first place. Covered at the unit level (`sortSectionLogs`/`groupLogsBySection` tests exercise add/edit/delete-equivalent scenarios by varying the input array between calls).

## Member View

WOD-SIMPLE: `Clasament` now renders one block per scored Section, each internally identical to the pre-Layer-2b single-block UI (tier headers, medal/rank cards, expand-for-detail). A "PART" header (the Section's own title, or a sensible slot-based fallback) appears above each block **only** when more than one scored Section exists — verified live: the primary+additional 3-Section test workout showed "Metcon" / "Squat Clean" / "8min AMRAP" headers; a single-Section Workout (all other production Workouts today) shows no header at all, matching pre-Layer-2b output exactly.

## One-Score Compatibility

Verified both by construction (the single-Section code path is the literal same code as the multi-Section path, just not wrapped in a "PART" header, and is exercised by every pre-existing production Workout) and live: navigating Clasament to dates with real pre-existing single-Section Workouts showed unchanged output throughout this session.

## Legacy Compatibility

Verified: a Workout with zero Workout Engine V2 data (`sections.length === 0`) buckets every log under one implicit key, identical to pre-Layer-2b behavior. `wod_logs` rows with `workout_section_id NULL` resolve to the primary Section exactly (not a guess — see Result Sources). `skill_logs` rows with `workout_section_id NULL` are excluded, not guessed into any Section.

## Reorder / Identity Safety

**Verified live in production**, the single most important regression test tying Layer 2a.5's proven identity stability to Layer 2b's new grouping logic: created a 3-Section test Workout, logged real results against all 3 Sections, then reordered two Sections in the Admin editor (moved the AMRAP Section from 2nd to 1st position) and saved. SQL confirmed both `wods.skill`/`skill2` content and `workout_sections.id`/`slot_key` were **completely unchanged** by the reorder. Reloaded the leaderboard in both clients — every score remained correctly attributed to its own Section (Metcon 4:22, Squat Clean 110kg, 8min AMRAP unchanged), proving the leaderboard follows semantic Section identity, never array position or display order.

## Snapshot / Version Safety

Verified via direct trigger-definition inspection (not assumed): `snapshot_wod_log_context`/`snapshot_skill_log_context` are both `BEFORE INSERT OR UPDATE OF wod_id` (column-scoped, so ordinary edits never re-fire them) and both correctly branch on `workout_section_id` for non-primary Sections, freezing that Section's own `format`/`format_config`/`movements`/`title` at logging time — this was already Layer 2a's work, confirmed still correct and sufficient for Layer 2b's needs without any further change.

## Performance

No N×N pattern introduced. Both clients already fetched the full log set for a Workout in one query per table; Layer 2b adds exactly one more query (`skill_logs`, run in parallel via `Promise.all` alongside `wod_logs`) and one small `workout_sections` fetch, then groups/ranks in memory — no per-Section round trip to the database.

## Realtime

WOD-SIMPLE's `skill_logs` realtime subscription previously only refetched the member's own Journal — extended to also refetch Clasament, matching the existing `wod_logs` subscription's behavior, so a Section B result now correctly triggers a live leaderboard refresh, not just a Section A one.

## Security

No RLS change made or needed — `workout_section_id` was already a plain column under the existing gym-scoped `SELECT` policies on both tables (`wod_logs_select_all`/`skill_logs_select_all`), confirmed via direct policy inspection before starting. Grouping by it is a pure client-side/query-shape change downstream of already-correctly-tenant-scoped data.

## Tests

- WOD-SIMPLE (`workoutFormats.test.js`): 20 new tests covering one-score regressions per format family (For Time/RFT/AMRAP/LOAD/Chipper), Section-independent comparator selection, `skill_logs`-shaped-row compatibility, partial logging, edit/delete-equivalent re-sorts, dedup-of-duplicate-logs-per-member, `completion_state` explicit-vs-inferred, true ties, kg/lb cross-unit ranking, and unknown-format/empty-array safety.
- forge-admin-web (`sectionLeaderboard.test.ts`): 15 new tests covering `skillLogToWodLogShape` normalization, `resolveSectionId`'s four cases (wod_logs-with-id, wod_logs-null-fallback, skill_logs-null-excluded, skill_logs-with-id), `groupLogsBySection`'s legacy/single/multi-Section/partial-logging/un-scored-exclusion/orphaned-skill_logs-exclusion behavior, `sortScoredSections` ordering, and `wrapAsSingleTier`.
- Full suite counts: WOD-SIMPLE 630/630 passing (610 baseline + 20 new). forge-admin-web 868/868 passing (853 baseline + 15 new).

## Build / Lint / Type-check

WOD-SIMPLE: `npm run build` clean, `eslint` 0 errors (11 pre-existing, unrelated warnings unchanged). forge-admin-web: `tsc -b` clean, `eslint` 0 errors/warnings on all touched files, `npm run build` (`tsc -b && vite build`) clean.

## Migration Status

**None required or made.** This mission is entirely application-layer (fetch/group/rank/render). No schema, RPC, or trigger change.

## Production Verification

Complete. Both deployments confirmed live via `vercel inspect --logs` (exact source commit match: WOD-SIMPLE `04264a5`, forge-admin-web `5fa0e15`) plus direct bundle verification (forge-admin-web: byte-identical SHA256 between the served bundle and a fresh local build; WOD-SIMPLE: served bundle contains the new code's distinctive translation-key fingerprints, with a fresh, non-growing `Age` header ruling out CDN staleness — learned directly from the prior Layer 2a.5 session's false-alarm investigation not to conclude staleness from a filename/hash mismatch alone).

Built and verified the mission's own canonical 3-Section acceptance workout live, as a real coach/member (single account — see Known Limitations): Section A "Metcon" (RFT, primary, TIME family, `wod_logs`), Section B "Squat Clean" (Weightlifting, LOAD family, `skill_logs`), Section C "8min AMRAP" (AMRAP, ROUNDS_REPS family, `wod_logs` via the generalized non-primary path — proving the format-family-decides-table rule described under Result Sources). Logged one real result against each Section. Verified in **both** clients' UI: three independently labeled, independently ranked, independently formatted leaderboard blocks (`4:22` / `110kg` / `6 runde + 5/10 Burpees`), with **no** combined/overall score anywhere — satisfying §33/§45's explicit no-aggregation requirement by direct observation, not just by code inspection.

**Real bug found and disclosed, not fixed (out of scope):** while building the test Workout, the Skill Section's Format dropdown visually showed "Weightlifting" (the correct intended value) but the underlying saved `skill_type` was actually `'RFT'` (silently inherited from the primary Section) until the dropdown was explicitly re-interacted with and re-saved. This is a pre-existing bug in the Programming-domain Skill-section editor's initial-value binding, unrelated to and not introduced by Layer 2b — but it directly threatens Layer 2b's "correct comparator per Section" guarantee if a coach never happens to touch a Skill Section's Format dropdown after its implicit default is wrong. **Recommended as a P1 follow-up for the Programming domain, not fixed here.**

## SQL Verification

Every claim above about Section identity, `workout_section_id` resolution, and reorder safety was confirmed via direct `supabase db query --linked` reads against production before and after each UI action — not inferred from UI screenshots alone. Specifically: `wods.skill`/`skill2` content and `workout_sections.id`/`slot_key` before and after the live reorder test (identical); `wod_logs`/`skill_logs` rows' `workout_section_id` values matched against `workout_sections.slot_key` for all three test results; zero cross-table duplicate results for the same (member, Section) pair found (§22's "cross-source ambiguity" guard was never triggered, confirmed empty by direct query).

## Test Data Cleanup

All test data (1 `wods` row, 1 `workouts` row + 3 `workout_sections` rows via cascade, 2 `wod_logs` rows, 1 `skill_logs` row, 1 auto-triggered `pr_events` row) removed via direct SQL, in FK-safe order (`pr_events` → `skill_logs`/`wod_logs` → `workouts` → `wods`). Confirmed via a final SQL sweep (0 rows across all six tables/ids) and confirmed live in the browser (`Acasă` for the test date shows "Niciun WOD azi" again).

## Known Limitations

- **Programming-domain Format-dropdown bug** (see Production Verification) — disclosed, not fixed, recommended as a separate P1 follow-up.
- **Rx/Not-Rx classification does not extend to additional Sections** — pre-existing gap (Layer 2a never built the capture/comparison machinery for it), not a Layer 2b regression, disclosed rather than silently worked around.
- **Multi-member scenarios (§45/46/47: different winners per Section, true ties, capped-vs-completed under real concurrent load) were not exercised live** — this session operates under a standing constraint of never logging in as any account other than the one the user is already authenticated as, so a second real member's Section results could not be created live. These scenarios are covered at the unit-test level (multiple distinct `member_id`s, explicit tie fixtures, explicit capped/completed fixtures) but not click-through-verified end-to-end with multiple real logged-in accounts.
- **Editing/deleting an already-logged Section result was not exercised live** (structural guarantee + unit-test coverage only — see Editing/Deletion above).
- **Cross-unit (kg/lb) live ranking on a non-primary Section was not exercised live** (single test member, one weight unit) — covered at the unit-test level only for the Section-parameterized comparator specifically (the underlying `toKgForRanking` function itself already had live-production precedent from before this mission, for the primary Section).
- The pre-existing tie-break/duplicate-selection deviation from `LEADERBOARD_RULES.md` (see Comparator Reuse) remains, unchanged, disclosed.

## Explicit No-Aggregation Boundary

Confirmed by direct code inspection and live observation: no code path in either repo sums, combines, or cross-ranks two Sections' scores. Each Section's `tierSections`/render block is computed and displayed fully independently. No "overall winner," "total points," or "combined rank" concept exists anywhere in the changed code.

## Readiness for Next Phase

**Phase 1B is complete for whole-Section scoring.** Layer 2b's mission is fully delivered: section-aware leaderboard grouping, ranking, and display, across both clients, both result-source tables, verified live in production with real (test) data and cleaned up afterward. Workout Aggregation (A+B combined standings) and Segment/Attempt (sub-Section interval scoring) remain explicitly out of scope and were not started, per the mission's own boundary — any future work in either direction is a new, separate mission.
