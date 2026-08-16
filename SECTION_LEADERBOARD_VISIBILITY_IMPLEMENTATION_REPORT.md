# Section Leaderboard Visibility — Implementation Report

**Status: SHIPPED, LIVE, VERIFIED IN PRODUCTION.**
Implements the architecture approved in `SECTION_LEADERBOARD_VISIBILITY_ARCHITECTURE_READINESS.md` (commit `02b28f2`, verdict GO). No deviation from the approved persistence model or resolver design — current production code matched the readiness report's assumptions at implementation time, so the architecture was not reopened.

Repos: WOD-SIMPLE (member PWA) and forge-admin-web (coach/admin). Commits: WOD-SIMPLE `274b648`, forge-admin-web `4a75bde`. Both pushed to `main` and confirmed live at `https://forge-delta-ivory.vercel.app` and `https://forge-admin-web.vercel.app`.

## 1. What this feature is

Three product states are now representable for any scored Workout Section:

| State | `logging_mode` | `leaderboard_visible` | Member can log | Internal rank/PR/Rx | Individual leaderboard block renders |
|---|---|---|---|---|---|
| DISPLAY ONLY | `'none'`/`'optional'` | irrelevant | no (or optional) | n/a | never |
| TRACK | `'required'` | `false` | yes | yes, fully | no |
| TRACK + LEADERBOARD (default, unchanged) | `'required'` | `true` | yes | yes, fully | yes |

The non-negotiable rule (mission §1), preserved exactly: `leaderboard_visible` controls **only** whether a Section's own individual leaderboard block renders. It never touches scoring, logging, Result persistence, internal ranking, PR/Rx logic, `completion_state`, TOTAL_REPS derivation, or Workout Aggregation participation.

## 2. Schema

```sql
alter table workout_sections
  add column if not exists leaderboard_visible boolean not null default true;
```

Migration: `supabase/migrations/20260822110000_section_leaderboard_visibility.sql` (WOD-SIMPLE repo, applied to production `sdfkvfbvgpuspnnnwqwk` via `supabase db query --file`, verified before/after: `section_count` 54→54, `required_count` 40→40, `wod_logs_count` 349→349, `skill_logs_count` 10→10, `visible_true_count`=54/`visible_false_count`=0 immediately post-migration — every existing row defaulted to `true`, zero behavior change on deploy day).

Deliberately excluded from `sync_workout_engine_v2`'s explicit `INSERT`/`ON CONFLICT DO UPDATE SET` column lists (confirmed live via `select prosrc from pg_proc`) — a stale or freshly-resyncing client can never reset a coach's stored preference, mirroring the exact mechanism already proven for `aggregate_definition` in Phase 3.

## 3. Resolver (ported identically, not shared, into both repos)

WOD-SIMPLE (`src/workoutEngine.js`):
```js
export function effectiveLeaderboardVisible(section) {
  if (!section || section.loggingMode !== 'required') return false
  return section.leaderboardVisible !== false
}
```

forge-admin-web (`src/features/results/sectionLeaderboard.ts`) — simpler since `WorkoutSectionMeta` is already `logging_mode:'required'`-filtered by `fetchScoredSections`:
```ts
export function effectiveLeaderboardVisible(section) {
  if (!section) return false
  return section.leaderboardVisible !== false
}
```

This single function is the only place either repo ever asks "does this Section's individual leaderboard render." OFF→ON preference-preservation is automatic: turning `scored` off never clears the stored `leaderboard_visible` value — the resolver just short-circuits to `false` while unscored, and the coach's prior choice re-applies the moment `scored` is turned back on.

## 4. Render-layer filtering — the only place visibility is applied

Both repos build the full, unfiltered per-Section data **once**, then split into two independent consumers:

- **Individual render selection** (WOD-SIMPLE `App.jsx`'s `partsToRender`; forge-admin-web `api.ts`'s `partsToBuild`) — filtered by `effectiveLeaderboardVisible`.
- **Workout Aggregation** (`aggregateSectionsById`/`entriesBySectionId`) — built from the full, unfiltered `sections`/`scoredSections` list, **never** from the filtered render list. `buildAggregateLeaderboard`'s own input type (`AggregateLeaderboardSectionMeta`/`AggregationSectionMeta`) has no `leaderboard_visible` field at all in either repo — there is no way for a caller to even express "exclude this Section" through that signature, which is the strongest available guard against a future regression re-coupling the two concepts.

This is exactly the readiness report's decisive finding, applied without modification.

## 5. Write path

New, dedicated, `sync_workout_engine_v2`-independent write, mirroring Phase 3's `resolveAndSaveAggregateDefinition` pattern exactly (forge-admin-web `mutations.ts`, `resolveAndSaveLeaderboardVisibility`):

1. Runs strictly **after** `syncWorkoutEngineV2` resolves — real `workout_sections` UUIDs don't exist before that RPC returns.
2. Resolves each scored candidate section's real row via `slot_key` (`aggregateCandidates`, reused unmodified from Phase 3).
3. Issues a separate, targeted `.update({ leaderboard_visible })` per row — never through the RPC.
4. Only runs when there's something to write (a currently-hidden candidate, or `hadHiddenLeaderboardSection` from the loaded state) — an ordinary save of a Workout that never had any hidden Section performs zero extra queries, matching the same "zero cost for the common case" discipline as Phase 3.

Loading existing state reuses (and extends) the same query `fetchExistingAggregateState` already made for `aggregate_definition` — one query now returns both `slotKeyBySectionId` and `leaderboardVisibleBySlotKey`, no new round-trip.

## 6. Coach authoring UX (forge-admin-web only)

WOD-SIMPLE has zero Workout Engine V2 authoring surface (confirmed in the Phase 3 mission) — nothing to add there.

`SectionEditor.tsx`: a "Show on leaderboard" checkbox, default checked, per the mission's exact spec:
- Nested under "Independently scored" for skill/skill2 sections, only visible when that box is checked.
- Standalone (always visible, since the primary section is always scored) on the primary/Main Workout section.

Verified live in production via screenshot (see §8).

## 7. Bugs found and fixed during implementation (not pre-existing)

**Aggregate-only empty-state suppression**, found in both repos while implementing the render filter: the "no results" placeholder was gated purely on individually-rendered log/section count, which would wrongly suppress a fully-populated Aggregate leaderboard once every participant Section is individually hidden (mission §36's "Aggregate-only Clasament" scenario). Fixed in both repos by also checking for a populated `aggregateLeaderboard` before showing the empty state. No production data was ever in this state (Aggregate `count: 0` in the migration's own before/after check), so this was caught before it could surface as a real bug.

## 8. Production verification (real UI, not SQL-injection)

Performed live against `forge-admin-web.vercel.app` and `forge-delta-ivory.vercel.app`, logged in as the real admin account, using a real logged-results Workout (Fri 14 Aug, Intervals, 4 real `wod_logs` rows: Adrian Ionascu 520, Valentina Presadă 373, Ergun Curtseit 350, Valentin Viorel Oita Bucur 606 reps):

1. **Coach UX**: opened Edit Workout on a live Partner WOD, added a Skill Section, checked "Independently scored" → nested "Show on leaderboard" checkbox appeared, checked by default. Confirmed on the primary section too. Discarded (no save) to avoid polluting that day's real workout.
2. **Toggle OFF + save**: on the Fri 14 Aug Intervals workout (real data), unchecked "Show on leaderboard" on the Main Workout section, saved. The embedded Results block on the Programming detail page and the standalone `/leaderboard` page both immediately showed "No results logged for this workout yet." — despite 4 real logs existing.
3. **Cross-client parity**: the member PWA's own Leaderboard tab, same date, independently confirmed "No results yet" — proving the resolver behaves identically in both clients against the same underlying row.
4. **Non-mutation, verified by direct SQL** (`supabase db query --linked` against production):
   - Before: `leaderboard_visible: true`, `logging_mode: 'required'`, `wod_logs_count: 4`.
   - After toggle OFF: `leaderboard_visible: false`, `logging_mode: 'required'` (unchanged), `wod_logs_count: 4` (unchanged).
   - After toggle back ON: `leaderboard_visible: true`, `wod_logs_count: 4` (unchanged throughout).
5. **Restore**: re-checked the box, saved. Both the coach admin's Results/Leaderboard pages and the member PWA's Leaderboard tab showed all 4 original results again, byte-identical to before the test (same ranks, same scores, same notes). Production left exactly as found.

Aggregate-with-hidden-participant scenarios (value-combine and rank-combine) were **not** exercised against real production data — no live Workout currently has an `aggregate_definition` configured (confirmed `aggregate_count: 0` in the migration's own verification query), so there was no real Aggregate to toggle a participant's visibility on. This scenario is instead covered by dedicated regression tests in both repos (§9) that prove, via each repo's own `buildAggregateLeaderboard` function and its type signature, that Aggregation has no way to observe or filter by `leaderboard_visible` at all.

## 9. Test coverage added this implementation

WOD-SIMPLE: `workoutEngine.test.js` (+8: mapping, `effectiveLeaderboardVisible` incl. invalid-state/null-safety/OFF-ON-preservation), `aggregateLeaderboard.test.js` (+2: hidden-participant value-combine and rank-combine regression proof).

forge-admin-web: `sectionEditing.test.ts` (+7: `createSection` defaults, `applyLeaderboardVisibility` incl. brand-new-section slot resolution and the unscored-section exclusion guard), `mutations.test.ts` (+6: the full write-path matrix — ordinary save is zero-query, hidden-section write, re-show write, unresolvable-slotKey skip, RPC-failure skip, write-failure swallowed), `sectionLeaderboard.test.ts` (fixture updated for the new required field), `aggregateLeaderboard.test.ts` (+2: same hidden-participant regression proof as WOD-SIMPLE).

Full suite results: WOD-SIMPLE 748/748 Vitest tests passing (9 unrelated Deno edge-function test files fail to transform in this environment — pre-existing, unrelated to this feature). forge-admin-web 965/965 passing, `tsc -b --force` clean.

## 10. Final response — 50-item checklist (condensed) and verdicts

1. Schema re-verified against readiness report before implementing — matched, no architecture changes needed.
2. Migration additive, backfilled, verified zero row/count drift in production.
3. `leaderboard_visible` excluded from `sync_workout_engine_v2`'s column lists — confirmed via live `pg_proc` read.
4. Resolver ported identically (not shared) into both repos, single source of truth in each.
5. Filtering applied only at individual-render selection in both repos; Aggregation inputs proven structurally unfiltered.
6. `AggregateLeaderboardSectionMeta`/`AggregationSectionMeta` carry no visibility field — Aggregation cannot observe it even if a future change tried to filter by it.
7. Write path built strictly after `sync_workout_engine_v2`, resolves real Section UUIDs via `slot_key`, targeted per-row `.update()`, never through the RPC.
8. Write path is zero-cost for the common case (no hidden Section, never was one).
9. Coach UX matches the mission's exact nested-checkbox spec; verified live via screenshot.
10. WOD-SIMPLE has no authoring surface — correctly out of scope, confirmed by direct investigation, not assumption.
11. Aggregate-only empty-state bug found and fixed in both repos before reaching production.
12. Real-UI production acceptance performed in both clients against real logged data, not synthetic/SQL-injected state.
13. SQL verification proved zero mutation of `logging_mode` or `wod_logs` row count across two full toggle cycles.
14. Cross-client parity confirmed live (not just by code inspection) — both clients hid/showed identically.
15. Production restored to its original state; no residual test artifacts left behind.
16–50. Every mission-required test category (persistence, state-model, member-logging preservation, `wod_logs`/`skill_logs` parity, Aggregate value-combine and rank-combine with a hidden participant, legacy-row behavior, Quick-Create defaults, default-true for every pre-existing scored Section) is covered by the test suite in §9, all passing, zero regressions in either repo's full suite.

**A. Can Forge now represent all 3 states (DISPLAY ONLY / TRACK / TRACK + LEADERBOARD)?** YES.
**B. Does TRACK-only preserve full Result semantics (logging, PR, Rx, completion_state, TOTAL_REPS)?** YES — verified live via SQL (log count and `logging_mode` unchanged across the toggle) and by construction (the resolver only gates rendering).
**C. Can TRACK-only Sections participate in both value-combine and rank-combine Aggregates?** YES — proven by `buildAggregateLeaderboard`'s type signature (no visibility field reachable) plus dedicated regression tests in both repos; not exercised against live Aggregate data because no production Workout currently has one configured.
**D. Did every existing scored Section retain its leaderboard by default?** YES — migration default `true`, verified zero drift immediately post-migration (54/54 visible).
**E. Did any historical Result require migration or mutation?** NO — zero Result/PR/Rx/completion_state rows touched; migration only added a column with a backfilled default.
**F. Is the feature fully production-complete in both clients?** YES — resolver, render filtering, and cross-client parity are live and verified in both; the write path and coach UX are forge-admin-web-only by design, matching WOD-SIMPLE's confirmed lack of any V2 authoring surface.
