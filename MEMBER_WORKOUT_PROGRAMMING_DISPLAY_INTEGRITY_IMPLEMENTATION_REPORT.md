# Member Workout Programming Display Integrity — Implementation Report

## 1. Mission Statement

Repair the complete Programming → Member View display contract in WOD-SIMPLE (member PWA), not just the two symptoms named in the original report ("workout title missing", "`3 RFT` shown as `RFT`"). Audit the full current format registry (22 formats), fix every proven case of structural metadata loss, leave scoring/leaderboard/Results/Performance/Canonical Movement Identity untouched, and produce this report plus a final structured verdict.

## 2. Scope Boundaries (honored)

- No scoring, leaderboard, Results, aggregation, Performance, or Canonical Movement Identity code touched.
- No schema changes. No new tables/columns.
- No workout data rewritten — this is a read/display-only fix.
- No per-format JSX special-casing added — both fixes reuse existing, already-proven-correct central helpers.
- No login as a member — all verification done via code reading, unit tests, and read-only production SQL (per this project's standing rule).

## 3. Investigation Method

1. Located the exact real production reproduction workout from the mission's screenshot (`wods.id = 50350578-a6cd-4434-84c6-44f43ca6bf65`: movements "50 Ab-mat sit-ups", "30 Goblet box step-up", "DB Front Rack Carry 100m").
2. Traced every code path between a saved `wods`/`workouts` row and what a member actually sees, across both the legacy fallback (`mapLegacyWodToWorkout`) and Workout Engine V2 (`workouts`/`workout_sections`) shapes.
3. Cross-checked legacy vs. V2 data for the repro workout and for the whole platform via direct read-only SQL, to rule out a V2/legacy sync divergence.
4. Ran a full production audit of `format_config` key usage per format (both `wods` and V2 `workout_sections`, `slot_key='metcon'`) to ground every fix decision in real authored data, not speculation.
5. Read every existing format-label/format-detail helper function to map the complete set of display code paths before writing any fix.

## 4. Finding on Bug #1 (missing workout title) — does NOT reproduce as described

For the exact repro workout, `wods.name` is `null` on both the legacy row and its synced V2 `workouts.title`. The coach never saved a title for this specific workout. The existing render logic (`workoutForDisplay.title && (...)` in `App.jsx`, Home "WORKOUT OF THE DAY" card) is already correct: it shows nothing when there is no title, and shows `"Title"` in quotes when there is one — this is the intended empty-state behavior, not a bug.

**General title contract, verified separately**: queried the 5 most recently authored titled workouts in production. In all 5 cases, `wods.name` and the synced `workouts.title` are byte-identical:

| date | wods.name | v2 workouts.title | match |
|---|---|---|---|
| 2026-08-13 | Four of a Kind | Four of a Kind | ✅ |
| 2026-08-11 | Uneven Ground | Uneven Ground | ✅ |
| 2026-08-10 | AFTERBURN | AFTERBURN | ✅ |
| 2026-08-01 | Twin Engines - Partner WOD | Twin Engines - Partner WOD | ✅ |
| 2026-07-27 | PARTNER MARY | PARTNER MARY | ✅ |

`mapLegacyWodToWorkout` (`workoutEngine.js:151`) and the legacy→V2 sync RPC (`workoutEngine.js:348`) both correctly propagate `wod.name`. **Verdict: the title-preservation contract is sound. No code change made for bug #1** — it would have been a fix for a problem that does not exist, violating the "no invented fixes" instruction.

## 5. Root Cause of Bug #2 (`3 RFT` → `RFT`) — two real, distinct gaps

**Gap A — the authoritative header widget never enriched its label.** `WorkoutFormatHeader` (the single, explicitly-documented-as-universal Member View format widget, reused identically for the single-variant member card and the 4-tier accordion) sources its `primary` text from `getWorkoutFormatDisplay()`, whose `primary` field was unconditionally `formatId` — bare, on both return branches, for every format. Meanwhile a second, more-capable helper, `formatTypeLabel()`, already existed and already correctly computed `"3 RFT"` — but was wired only into the member's Journal (log-history) subtitle, never into `WorkoutFormatHeader`. This explains a real, visible inconsistency already present in production: a member's own Journal entry for a workout already said **"3 RFT"**, while the Home "Workout of the Day" header for the *same workout, same day* said bare **"RFT"**.

**Gap B — the accordion branch had zero structural fallback at all.** A second, generic mechanism, `formatMemberScheduleLines()`, already existed to surface any config field not covered by the header (e.g. `"3 Rounds"`, `"Target: 5RM"`, `"Sets scheme: 5-5-5-5-5"`). It was wired into the single-variant member card (member with `usual_level` set) but **never wired into the accordion branch** — the branch used by (a) every admin/coach previewing the workout, and (b) every member who has not yet set a `usual_level`. For those viewers, selecting a variant showed the bare format id and nothing else: no rounds, no target label, no sets scheme, no ladder scheme — for **any** format, not just RFT. This is the more consequential of the two gaps, since it affects a broader viewer population and every structural field, not just rounds.

## 6. Full-Registry Production Evidence Audit

Ran read-only SQL against both `wods` (legacy) and `workout_sections` (V2, `slot_key='metcon'`) to find real `format_config` key usage per format. V2 and legacy were confirmed byte-identical in structure — no sync divergence exists anywhere in the primary-section pipeline.

| Format | Real production rows with structural config | Field(s) | Header enrichment needed? | Covered by scheduleLines? |
|---|---|---|---|---|
| RFT | 9 (highest) | `rounds` | **Yes — fixed** | Yes (already was, for single-variant) |
| For Time (`structure:'Repeated Rounds'`) | 2 | `rounds`, `structure` | **Yes — fixed** (same defect class as RFT, documented in the format catalog itself as semantically identical) | Yes |
| Ladder | 2 | `sharedRepScheme`, `ladderType` | No (not a "N `<format>`" convention) | Yes — was accordion-only gap, now fixed |
| Build to Heavy/1RM | 1 | `targetLabel` | No | Yes — was accordion-only gap, now fixed |
| Strength Sets | 1 | `setsScheme` | No | Yes — was accordion-only gap, now fixed |
| Ascending AMRAP, Buy-In/Cash-Out, Chained AMRAP, Intervals, Partner WOD | 1 each | various | No (single occurrences, generic fallback line is adequate and was already the documented design intent) | Yes — was accordion-only gap, now fixed |
| All other formats (AMRAP, EMOM, Tabata, Weightlifting, Complex, Superset, Death By, Death By Weight, Chipper, Max Effort, Not For Time, AMRAP w/ Buy-In) | 0 real rows with extra structural fields beyond timing (already handled) | — | No | N/A |

## 7. Fix Implemented

### 7.1 `src/workoutFormats.js`

- `formatTypeLabel(formatId, config)` extended: now also recognizes `For Time` with `config.structure === 'Repeated Rounds'` and `config.rounds` set, returning `"${rounds} For Time"` — the second real production-evidence case, using the format catalog's own documented equivalence (a "For Time" authored as repeated identical rounds is semantically RFT).
- `getWorkoutFormatDisplay()`'s `primary` field now calls `formatTypeLabel(formatId, config)` instead of returning the bare `formatId`, on both return branches. This is the single source `WorkoutFormatHeader` reads from, so the fix propagates to every surface that uses the widget without any JSX change to the widget itself.

No new function, no new abstraction — both changes reuse helpers that already existed and were already proven correct in the Journal.

### 7.2 `src/App.jsx`

- Accordion branch (admin/coach view + member-without-`usual_level` view, `App.jsx` ~9644-9702): now computes `accordionScheduleLines` via the same `formatMemberScheduleLines()` call already used by the single-variant branch, and renders it directly under `WorkoutFormatHeader`, using the identical line styling already used in the single-variant branch. This closes Gap B for every format, not just RFT.
- `PastWodCard`'s collapsed header row (coach's own past-WODs list) changed from raw `w.type` to `formatTypeLabel(w.type, w.format_config)`, for consistency with the Journal and the Home header — same helper, zero new logic.

## 8. forge-admin-web (Admin) Parity Audit

Searched forge-admin-web for any equivalent of `getWorkoutFormatDisplay`/`WorkoutFormatHeader`/`formatMemberScheduleLines` — none exists. Admin's authoring UI (`formatCatalog.ts`, `VariantTabs.tsx`, `QuickCreateDialog.tsx`) renders format config as **labeled editable form fields directly** (e.g. a "Rounds" number input showing `3`), never synthesizes a compact display string like `"3 RFT"`. A coach editing a workout in Admin always sees the raw `rounds` field with its own label — there is no code path in Admin that could lose this information the way the member-facing compact header did. **Verdict: no equivalent Admin-side defect exists. No Admin code changed** (per the mission's explicit "no unnecessary UI added to Admin" constraint).

## 9. Journal / History Regression Check

- Journal log subtitle (`App.jsx:5541-5544`, `formatTypeLabel`) — unchanged, already correct, not touched.
- `PastWodCard` expanded detail (`describeFormatConfig`) — unchanged, already comprehensive (shows every config field as generic lines), not touched.
- `PastWodCard` collapsed header — the one line changed (§7.2), strictly additive (same helper, already proven safe in Journal).

## 10. Automated Tests

Added to `src/workoutFormats.test.js`:
- New `describe('formatTypeLabel (Member Workout Display Integrity)')` block: 7 cases — RFT with/without rounds, For Time with/without `structure:'Repeated Rounds'`, unrelated formats unaffected, null/undefined config safety.
- Updated the one existing `getWorkoutFormatDisplay` test that asserted the old (buggy) bare-`RFT` behavior, plus 2 new cases for the For Time/Repeated-Rounds path and the "For Time without that structure stays bare" negative case.

Full suite: **872 tests passed, 0 failed** (9 pre-existing file-level failures are `@std/assert`/Deno import-resolution errors in `supabase/functions/*.test.ts`, unrelated to this change and unrelated to any file touched — confirmed present before this session's edits).

## 11. Live Production Verification (read-only, no login)

Ran the actual `getWorkoutFormatDisplay`/`formatMemberScheduleLines` functions via `vite-node` against real production `format_config` shapes pulled by SQL:

- Repro workout (RFT, `rounds:3`, time cap 20:00): header now **`"3 RFT"`** (was `"RFT"`).
- Two additional real, more recent production RFT workouts found during verification — `AFTERBURN` (2026-08-10, `rounds:5`) and `Twin Engines - Partner WOD` (2026-08-01, `rounds:4`) — now render **`"5 RFT"`** and **`"4 RFT"`** respectively (previously both bare `"RFT"`).
- Build to Heavy/1RM (`targetLabel:'5RM'`): `formatMemberScheduleLines` → `"Target label: 5RM"`, now rendered in the accordion branch (previously invisible there).
- Strength Sets (`setsScheme:[5,5,5,5,5]`): → `"Sets scheme: 5-5-5-5-5"`, now rendered in the accordion branch.
- Ladder (`sharedRepScheme:[21,15,9], ladderType:'Descending'`): → two lines, both now rendered in the accordion branch.

No data was mutated; all verification used direct function calls against real config shapes and read-only `SELECT` queries.

## 12. Disclosed, Not Fixed (out of evidence-backed scope)

- Ascending AMRAP, Buy-In/Cash-Out, Chained AMRAP, Intervals, Partner WOD each had exactly 1 real production row using an extra config field. These are now surfaced via the accordion fix (§7.2/Gap B) through the generic scheduleLines fallback, same as before for the single-variant branch — no format-specific header enrichment was added for them, consistent with the code's own pre-existing design comment that only rounds-based conventions (RFT-style) warrant header-level enrichment.
- No forge-admin-web changes were needed or made (§8).

## 13. Final Verdict

Both proven, evidence-backed gaps are closed: the header-enrichment inconsistency (Gap A, RFT + For-Time-as-Repeated-Rounds) and the accordion's total lack of structural fallback (Gap B, all formats, both admin/coach and level-less members). Bug #1 as literally described does not reproduce; the general title contract was verified sound. No scoring/leaderboard/Results/Performance/Canonical Movement Identity code was touched. Full test suite green. Admin parity audited, no defect found, no Admin change made.
