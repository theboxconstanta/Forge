# Forge — Leaderboard Finish-Time Score Loss: Fix Implementation Report

**Status:** LIVE in production, verified.
**Basis:** `LEADERBOARD_FINISH_TIME_INVESTIGATION.md` (approved as-is; root cause and scope confirmed unchanged against current code before implementing).
**Scope discipline:** exactly the write-path precedence bug + its UI cause, for exactly the three formats the investigation identified. No schema change, no ranking change, no rendering change, no Results Domain redesign, no fix for the separate for-time/AMRAP badge heuristic (left as a named follow-up, untouched).

---

## 1. Exact Root Cause (re-confirmed against current code)

`src/App.jsx`, `composeWodLogFields`, the `useReps` decision for `scoreMode: 'fortime_or_amrap'` non-sequential formats (RFT, For Time with `structure: 'Repeated Rounds'`, Partner WOD):

```js
// BEFORE
|| (format.scoreMode === 'fortime_or_amrap' && wodRoundsCompleted.trim() !== '')
```

`wodRoundsCompleted` presence alone decided `useReps`, independent of whether `wodTime` was also filled in. Since `time_result: useReps ? null : (wodTime.trim() || null)`, a member who entered both a real time and their rounds count had their time silently discarded. `FormatLogger.jsx`'s `ScoredFields` showed the Time input and the "Runde complete" input simultaneously, with only an 11px hint text ("completează în loc" — "fill in *instead*") as the only signal they were meant to be mutually exclusive.

## 2. Files Changed

| File | Change |
|---|---|
| `src/workoutFormats.js` | New pure functions: `shouldLogRoundsInsteadOfTime(wodTime, wodRoundsCompleted)` and `composeFortimeOrAmrapFields({...})` — the corrected precedence + score-composition logic, extracted so it's independently unit-testable (it wasn't before — `composeWodLogFields` is an untested closure inside `App.jsx`). |
| `src/App.jsx` | `composeWodLogFields` now early-returns via `composeFortimeOrAmrapFields` for the exact affected subset (`!isSequential && format.scoreMode === 'fortime_or_amrap'`), before the generic `useReps` chain. The generic chain (AMRAP, Ascending AMRAP, sequential For Time/Chipper/Ladder, mixed-family Buy-In/Cash-Out) is untouched — verified behaviorally identical for every case it still handles, since it never had `format.ascending` or `isSequential` true for this affected subset in the first place. Removed now-dead code (the `finishedRoundsText` branch that only ever fired for this subset) and two now-unused imports (`effectiveScoreMode`, `composeFinishedRoundsText` — both still used internally by `workoutFormats.js`, just no longer needed directly in `App.jsx`). |
| `src/FormatLogger.jsx` | `ScoredFields`'s `fortime_or_amrap` non-sequential branch: the "Runde complete" section (hint text + `RoundsPartialFields`) now renders only while `value.time` is empty — it disappears entirely, live, the moment the member types into the Time field. Existing values in `roundsCompleted`/`partialReps` are preserved (not cleared) if Time is cleared again — non-destructive toggle by visibility, not by data loss. |
| `src/workoutFormats.test.js` | 15 new tests: `shouldLogRoundsInsteadOfTime` (5 cases) + `composeFortimeOrAmrapFields` (8 cases, covering every scenario in the mission's test plan) + 2 tests documenting the one pre-existing, unchanged edge case (nothing entered at all) so it isn't confused with the fixed bug later. |
| `src/FormatLogger.test.jsx` | 4 new component tests proving the UI mutual exclusivity, including a `rerender` test that starts from "Runde completate" and adds a Time value, asserting "Runde complete" disappears live. |

## 3. Precedence Rule — Before vs. After

**Before:** `wodRoundsCompleted` non-empty ⟹ log as rounds/partial-reps, **discard any entered time**, regardless of `wodTime`.

**After:** Time is authoritative whenever present. `shouldLogRoundsInsteadOfTime(wodTime, wodRoundsCompleted)` is `true` **only** when `wodTime` is empty and `wodRoundsCompleted` is not — i.e., the capped/incomplete path is reached only in the absence of a real time. A filled Time field always wins, even if `wodRoundsCompleted` also has a value (the exact contradictory-payload case from the investigation). This is enforced in `composeFortimeOrAmrapFields` itself — a pure function, not a UI-dependent code path — so it protects against any caller (current UI, a future UI variant, a stale cached client bundle, an edited/replayed payload), per the mission's "defensive write-path" requirement.

## 4. UI Behavior — Before vs. After

**Before:** Time input and "Runde complete" input always both visible and always both enterable; a hint line was the only guidance.

**After:** Both visible when nothing is entered (unchanged starting state). The instant the Time field gets a value, "Runde complete" and its hint text disappear from the form entirely — there is no longer a UI state in which both are simultaneously *editable* with contradictory values. Verified interactively (see Section 6) in both local dev and production: typing into Time makes "Runde complete" vanish on the very next render.

## 5. Tests Added

`src/workoutFormats.test.js` (`shouldLogRoundsInsteadOfTime`, `composeFortimeOrAmrapFields`):
- Time only → time wins, canonical score is the time.
- Time + all prescribed rounds entered → rounds do **not** replace time (mission's core invariant, verbatim).
- Completed RFT (5/5 rounds + time) → `18:42`, not `"5 runde complete"` with no time.
- Capped RFT (4 rounds + 12 reps, no time) → existing canonical capped representation preserved unchanged (`"4 runde + 12 Pull-ups"`, `time_result: null`).
- Contradictory payload (valid time + rounds + partial reps all present) → time wins.
- No `rounds` prescribed (Partner WOD without `config.rounds`), finished → falls back to free-text `wodResult`, unchanged pre-existing behavior.
- Nothing entered at all, `rounds` configured → documented as a **pre-existing, unchanged** edge case (auto-assumes "finished, no time" — this was true before the fix too and is out of this mission's scope; a separate test asserts it explicitly so it's never mistaken for a regression).
- Nothing entered, no `rounds` configured → no score, both fields null.

`src/FormatLogger.test.jsx`: initial state (both visible) → Runde-completate-only (both still visible, capped path available) → Time-filled (Runde complete gone) → `rerender` from Runde-completate to Runde-completate-plus-Time (Runde complete disappears live, proving the fix reacts to the exact contradictory-entry sequence a real member would produce).

AMRAP, strength/sets, chained, mixed, variant tiers (RX/Intermediate/Beginner/OnRamp), and Mixed Categories are unaffected by construction — none of those code paths were touched (`composeAmrapResult`, `computeSetsScore`, `rxEngine.js`/`rxEngine.ts` classification, `ranking.ts`/`sortLogs` are all untouched files/functions) — confirmed by running their existing, unmodified test suites (all still passing, see Section 7) rather than by re-asserting them from scratch.

## 6. Manual Verification

Per standing constraint, I never authenticate myself — the user logged in on request each time; I navigated and drove the UI afterward.

**Local dev server** (`localhost:5173`, unregistered any stale service worker/caches first): created a free-log RFT (5 rounds, "10 Pull-ups"), confirmed both Timp and Runde complete visible with nothing entered, typed "18" into the minutes field and watched Runde complete disappear live, entered 18:42, saved. Journal showed `REZULTAT: 5 runde complete · 18:42`. Deleted the test entry afterward (`✓ Antrenament șters!`).

**Production** (`https://forge-delta-ivory.vercel.app`, confirmed live via `LEADERBOARD_RULES.md`-adjacent config `supabase/config.toml`'s `site_url`): repeated the identical click-through end to end — same live disappearance of Runde complete on typing Time, saved, confirmed `5 runde complete · 18:42` rendered correctly, deleted the test entry (`✓ Antrenament șters!`). Local dev and production share the same Supabase database (per standing project knowledge), so this also incidentally re-confirmed the local-dev run wasn't an artifact of a different backend.

Clasament (the day-scoped official-WOD leaderboard) was not exercisable in this pass — there was no official WOD published for today at either environment, and free/standalone logs never set `wod_id` (pre-existing, unrelated behavior), so they don't appear there by design. `ranking.ts`/`sortLogs`, which drive Clasament/LeaderboardTable, are unmodified files with unmodified, still-passing tests — the Journal-level confirmation that `time_result` is now correctly persisted is the load-bearing proof; ranking correctness given correct data was already established by the investigation and is untouched here.

## 7. Test / Lint / Build Results

- `npx vitest run src/workoutFormats.test.js src/FormatLogger.test.jsx`: **193/193 passed** (all new + all pre-existing in those two files).
- `npx vitest run` (full suite): **593/593 real tests passed**. 9 unrelated `supabase/functions/*/index.test.ts` files fail to resolve `@std/assert` (Deno-only import; these are Deno edge-function tests vitest can't run, not part of this or any prior vitest-based check — pre-existing, confirmed unrelated to this change).
- `npm run lint`: pre-existing errors/warnings only, all in files this change never touched (`public/sw.js`, `public/push-handler.js`, `src/InviteOnboarding.jsx`, `src/main.jsx`, `src/workoutEngine.js`, `src/workoutEngine.test.js`, `vite.config.js`) — confirmed via `git diff --stat` that only the 5 intended files changed, none of which appear in the lint output.
- `npm run build`: succeeds. Pre-existing >500kB chunk-size warning only (the deliberately-deferred bundle-splitting item, unrelated).

## 8. Deployment Status

- Committed: `7d1d866` — *"fix(results): stop RFT/For Time/Partner WOD from silently discarding finish time"*.
- Pushed to `origin/main`.
- `app_version.current` bumped (`finish-time-precedence-fix-20260814`, matching the project's existing manual-bump-after-push convention — no CI step exists for this yet) — pushes the near-instant service-worker update to all connected PWA clients.
- Vercel deployment confirmed live: the production bundle's `Last-Modified` header was 3 seconds after the `app_version` bump timestamp, and the interactive click-through against `https://forge-delta-ivory.vercel.app` in Section 6 directly exercised the new code path and produced the corrected result. (The Vercel MCP's `list_deployments`/`get_project` calls returned 403/404 for this project — a known, pre-existing gap, not new to this mission.)

## 9. Production Verification

Confirmed live and correct via the Section 6 production click-through: a completed RFT with both Time and full rounds entered now persists and displays the real finish time (`18:42`), with "Runde complete" no longer offered as a contradictory input once Time is filled. No production data was left behind — both the local-dev and production test entries were created and then deleted by the same click-through session, using the app's own existing delete-log flow (no direct database mutation of member data).

## 10. Historical-Data Limitations

**No backfill or migration was executed**, per the mission's explicit instruction. As the investigation report already established: the real finish time for historically-affected rows was never persisted anywhere (not in `notes`, not in any other column) — it is genuinely lost, not merely hidden, and cannot be reconstructed from inference (leaderboard position, timestamps, attendance, or notes), so none was attempted. Historically-affected rows continue to render and rank exactly as they did before (as non-finishers, via the pre-existing implicit `!!time_result` model) — this fix only prevents **new** occurrences going forward. Historical remediation (e.g., a coach-facing audit query to flag likely-affected rows for manual, human-verified re-entry) remains a separate, not-yet-authorized follow-up, matching the investigation's own Section 10 recommendation.

## 11. Explicitly Out of Scope (unchanged, not touched)

- The PWA's per-section "for time"/"AMRAP" badge majority-vote heuristic (separate, lower-severity finding) — left as-is, named as its own follow-up.
- `Buy-In/Cash-Out` with `mainFormat: 'For Time'` — the investigation flagged this as needing a follow-up check; confirmed in this pass that it is structurally unreachable by the new early-return (mixed-family formats never have `format.scoreMode === 'fortime_or_amrap'` literally in the catalog), so it was never at risk from the old bug either — no fix needed, but noted here since the investigation had marked it as unverified.
- Results Domain architecture, ranking semantics, RX classification, Mixed Categories, database schema — all unmodified.
