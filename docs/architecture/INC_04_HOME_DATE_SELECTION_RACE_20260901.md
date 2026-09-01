# INC-04 — Home Date Selection / Workout Identity Race — FINAL CLOSURE

**Date:** 2026-09-01
**Status:** SHIPPED (pending owner network-throttle acceptance)
**Repo:** `WOD-SIMPLE` only. Client-side only.
**DB / schema / migration / historical rows:** ZERO change.
**Scoring / ranking / classification / P9.5.6 / P9.5.7 / P9.5.8 / P9.5.8.1 / P10 / INC-06:** untouched.

---

## §A. Incident definition

Under client lag / overlapping async work, an explicit Home date selection (D±n or a
historical/future day) could be silently overwritten and the Home card would return to
**Today**; and transiently the selected chip and the displayed workout could diverge.

## §B. Exact root cause — three independent writers

| # | Writer | Trigger | Effect |
|---|---|---|---|
| **1** | `App.jsx` `[screen]` effect — `if (screen === 'home') setDataAcasa(<today>)` | **every** transition into Home | returning from the logger (cancel **or** save), Leaderboard, Journal, Feed, Admin, PRs reset the selected date to today |
| **2** | `App.jsx` `[user]` effect — `setDataAcasa(todayStr)` | any change of the `user` **object reference** | `onAuthStateChange` did `setUser(session?.user ?? null)` for every event; `TOKEN_REFRESHED` (hourly, **and on every tab-focus** via the `visibilitychange` handler's `getSession()`) delivers a brand-new `user` object → `[user]` effect re-runs → date reset. This is the "under lag / after the phone wakes, Home is back on Today" class. |
| **3** | `isWorkoutFetchCurrent(fetchedForDate, currentSelectedDate)` — **date-equality only** | any two in-flight requests for the *same* date | the same date is requested repeatedly (the `[dataAcasa]` effect, the realtime `wods` handler at App.jsx ~7548, a focus refresh, an A→B→A chip sequence); an **older** response for the currently-selected date passed the guard and could commit over the **newer** in-flight one (content divergence, not a date rollback) |

Writers 1 and 2 produce the "rolls back to Today" symptom. Writer 3 produces "selected chip and
displayed workout temporarily diverge" / stale content.

## §C. State-flow (post-fix)

```
                         useState(() => todayStr)         ← the ONLY unconditional default
                                    │
  ┌── user chip / arrow / "back to today" ──┐             ← USER INTENT
  │                                          ▼
  │                              dataAcasa (canonical selection)
  │                                          │
  │         [user] effect (genuine account change only) ──┤  ← resets to today on real sign-in
  │                                          │
  │                          dataAcasaRef.current (mirror for async closures)
  │                                          │
  │        [dataAcasa] effect: 1) drop a workout loaded for another day
  │                            2) fetchWodZi(dataAcasa)      → ++wodZiReqSeqRef
  │                            3) fetchWodZiWorkoutV2(dataAcasa) → ++wodZiV2ReqSeqRef
  │                                          │  await …
  │                     homeWorkoutResponseIsCurrent({ requestSeq, latestSeq, requestDate, selectedDate })
  │                                          │  (seq === latest  AND  date === selected)
  │                                          ▼
  │                          setWodZiData / setWodZiWorkoutV2   ← only the newest request for the current date
  │                                          │
  └──────────────── homeDisplayIsCurrent = (displayedWorkoutDate === dataAcasa)
                                             │
                            Log button enabled / captureLogCtx() allowed
```

## §D. Every pre-fix `dataAcasa` writer (classified)

| Line (pre-fix) | Writer | Class | Action |
|---|---|---|---|
| `useState(() => todayStr)` | initial value | INITIALIZATION | keep — the one true default |
| `[user]` effect `setDataAcasa(todayStr)` | login/session | INITIALIZATION (was: fired on every token refresh) | **narrowed** — the `setUser` id-gate means this effect now only runs on a genuine identity change |
| `[screen]` effect `setDataAcasa(<today>)` when `screen==='home'` | screen navigation | **BUG** | **removed** — replaced with `scrollChipToDate(dataAcasaRef.current)` |
| "back to today" button `onClick` (Home + calendar picker) | user tap | USER INTENT | keep |
| date chip `onClick={() => setDataAcasa(ds)}` | user tap | USER INTENT | keep |
| calendar-picker day `onClick` | user tap | USER INTENT | keep |
| `onEditSkill` `if (sl.wods?.date) setDataAcasa(sl.wods.date)` | edit a skill log from Journal | EDIT-FLOW (pre-existing) | keep — the skill-edit logger still resolves its save target off live `wodZiData` (no frozen `logCtx` on that path); documented pre-existing coupling, out of scope. `onEditWod` does **not** touch `dataAcasa` (it uses `resolveResultProvenance`). |

No unexplained writer remains.

## §E. Every pre-fix workout-state (`wodZiData` / `wodZiWorkoutV2`) writer

| Writer | Class | Action |
|---|---|---|
| `fetchWodZi` → `setWodZiData` | CURRENT REQUEST COMMIT | **guarded** by `homeWorkoutResponseIsCurrent` (monotonic seq + date) |
| `fetchWodZiWorkoutV2` → `setWodZiWorkoutV2` (both success + catch branches) | CURRENT REQUEST COMMIT | **guarded** (its own seq) |
| `[dataAcasa]` effect (new) — functional updater dropping a workout for a different day | TRANSITIONAL COHERENCE | **added** |
| realtime `wods` handler → `fetchWodZi` / `fetchWodZiWorkoutV2` | CURRENT REQUEST COMMIT | flows through the same guard; gets a fresh seq and supersedes any in-flight fetch |

## §F. Exact race reproduction (deterministic)

`src/inc04HomeDateSelectionRace.test.js` — a **deferred-promise** harness that is App.jsx's
`fetchWodZi` verbatim (`++seq` → real `await` → `homeWorkoutResponseIsCurrent` guard →
commit), with the network replaced by promises resolved by hand in hostile order:

- **Scenario A** — Today pending → select D+1 → D+1 resolves first, Today last → final **D+1**.
- **Scenario B** — reverse resolution order → final **D+1** (both orders converge).
- **rapid future** Today→D+1→D+3→D+7, delivered D+3, Today, D+1, D+7 → final **D+7**.
- **rapid historical** Today→D-1→D-7→D-30, hostile order → final **D-30**.
- **A→B→A** — the stale first-A response (seq 1) arrives last; **rejected**; the fresh A
  response (seq 3) is what commits.
- **same-date refetch** (realtime `wods` while the `[dataAcasa]` fetch is still out) → #2 wins.
- **empty selected date** → settles on empty for that date, a late Today response is dropped.
- **failed latest request** → an older Today success does **not** resurface as current.
- **initial default** → Today.
- **screen round-trip** → selection persists.

## §G. Request-ordering proof

`homeWorkoutResponseIsCurrent({ requestSeq, latestSeq, requestDate, selectedDate })` =
`requestSeq === latestSeq && requestDate != null && requestDate === selectedDate`.

`latestSeq` is `wodZi(V2)ReqSeqRef.current`, which only ever increments and is bumped by
**every** call to the fetch. So `requestSeq === latestSeq` is true for **exactly one**
in-flight request — the most recent. Any earlier request (same date or not) fails the
check when it resolves. The date sub-check is retained as a second, independent guarantee
(a response for a date that is no longer selected never commits even if seq bookkeeping
somehow matched).

## §H. Selected-date ownership model

`dataAcasa` is **canonical user/navigation state**. It is written by: (1) `useState` default
once; (2) an explicit user gesture (chip, arrow-less calendar, "back to today"); (3) the
`[user]` effect **only on a genuine account change**. Nothing else. Screen navigation,
async responses, token refresh, focus, context hydration — none of them write it.

## §I. Request-currency mechanism

Two module-scope `useRef(0)` counters (`wodZiReqSeqRef`, `wodZiV2ReqSeqRef`) — one per
independent fetch. `const mySeq = ++ref.current` at issue; commit iff
`homeWorkoutResponseIsCurrent(...)` with `latestSeq: ref.current`. No `AbortController`
(the Supabase query builder has no real cancellation), no timers, no debounce.

## §J. Loading-state currency
There is no dedicated `wodZiLoading` boolean on the Home path. "Loading" is derived:
`workoutForDisplay == null` while a fetch is out. The `[dataAcasa]` effect drops a
workout loaded for a different day the instant the selection changes, so the derived
loading state is scoped to the current selection. A stale response cannot flip it (guard).

## §K. Error-state currency
`fetchWodZiWorkoutV2`'s catch path is guarded identically — a late failure for an old date
cannot `setWodZiWorkoutV2(null)` over a loaded newer workout. `fetchWodZi` swallows errors
into `data = undefined` → `null` and is guarded the same way.

## §L. Empty-state currency
An older empty (`null`) response fails the seq guard and is discarded (test: "empty
selected date"). The selected date stays; the empty state shown belongs to the current
selection.

## §M. `[screen]` effect behaviour
No longer touches `dataAcasa`. On entering Home it only re-centres the date-chip strip on
the **currently selected** date (`scrollChipToDate(dataAcasaRef.current)`), replacing the
old "scroll to today's chip".

## §N. Home return behaviour
Returning to Home from **any** screen preserves `dataAcasa`. (Logger cancel/save,
Leaderboard, Journal, Feed, Admin, PRs.)

## §O. Logger cancel behaviour
`screen` → `logWOD`/`logSkill` → back → `home`. `[screen]` effect fires, does **not**
reset the date. Home shows the same day. `logCtx` is cleared (unchanged, correct).

## §P. Logger save behaviour
`saveWodLog` navigates to `log` or `home`. Either way `dataAcasa` is untouched. The saved
row's identity comes from the frozen `logCtx` (INC-04 GLOBAL / Layer 2, unchanged) — the
date-selection fix does not alter it.

## §Q. CTA transitional behaviour
Already gated by `homeDisplayIsCurrent = (wodZiWorkoutV2?.date ?? wodZiData?.date) === dataAcasa`.
During a transition the previous workout is dropped → `displayedWorkoutDate` is `null` →
`homeDisplayIsCurrent` false → the Log button is disabled and `captureLogCtx()` is not
allowed to run. The CTA can never point at a stale workout under a new date.

## §R. Selected-variant transitional behaviour
When the workout is dropped on date change, `wodZiData` → `null` → the P9.5.8/P9.5.8.1
selection effect early-returns and the INC-02 clear effect resets `variantaAleasa`. No
stale variant remains actionable (the Log button is disabled anyway). When the new
workout lands, the selection effect re-resolves against it.

## §S. Same-date refetch behaviour
Every fetch call bumps its seq, so #2 (realtime `wods` handler, focus refresh) always
supersedes an in-flight #1 for the same date. Test: "same-date refetch".

## §T. A→B→A behaviour
The old date-equality guard would let an old A response commit once A is re-selected. The
seq guard rejects it — only the newest A request (highest seq) commits. Test: "A → B → A".

## §U. Future-date behaviour
D+1 / D+3 / D+7 stable under hostile response order. INC-06 future-workout logging path
unchanged.

## §V. Historical-date behaviour
D-1 / D-7 / D-30 stable under hostile response order.

## §W. Empty-date behaviour
Selected date with no workout stays selected, shows the truthful no-workout state, no Log
button, **no** Today rollback.

## §X. Failed-request behaviour
The selected date stays. A stale older success is not shown as current. (No new
error/retry UI was added — that was out of scope; existing behavior of showing the
no-workout state on a failed fetch is preserved, now without the date rollback.)

## §Y. Engine V2 / legacy identity preservation
`resolveWodIdForLog(wodZiWorkoutV2, wodZiData)` = `wodZiWorkoutV2?.legacyWodId ?? wodZiData?.id`
— **unchanged**. `fetchWodZiWorkoutV2` still loads by `(gym_id, date)` and prefers the
explicit `legacy_wod_id` on the row. The fix only decides *which* response commits; it
never reconstructs a legacy WOD by date when an explicit link exists.

## §Z. Business-date policy preservation
No change. `dataAcasa` is still `YYYY-MM-DD` built from local `new Date()` (existing
policy); business/SQL calendar stays Europe/Bucharest. No new device-local policy, no
timezone redesign.

## §AA. Files changed
- `src/App.jsx` — `onAuthStateChange` id-gate on `setUser`; `[user]` effect comment;
  `[screen]` effect drops the date reset (chip re-centre only); 2 new seq refs;
  `[dataAcasa]` effect drops a stale-day workout before fetching; `fetchWodZi` /
  `fetchWodZiWorkoutV2` use `homeWorkoutResponseIsCurrent` with a monotonic seq.
- `src/utils.js` — `+ homeWorkoutResponseIsCurrent(...)`.
- `src/utils.test.js` — `+ describe('homeWorkoutResponseIsCurrent …')` (6); one misleading
  `isWorkoutFetchCurrent` A→B→A comment corrected.
- `src/inc04HomeDateSelectionRace.test.js` — **new**, 12 deferred-promise scenarios.

## §AB. DB impact
0 schema · 0 migrations · 0 triggers · 0 backfills · 0 historical row mutations.

## §AC. Tests added
6 (`homeWorkoutResponseIsCurrent`) + 12 (`inc04HomeDateSelectionRace`).

## §AD. Regression counts
- Full `vitest run` — **1638 passed** / 9 pre-existing Deno `@std/assert` file-load
  failures (unchanged baseline).
- `appHookOrderIntegrity` — 3 passed.
- `eslint src/App.jsx src/utils.js` — **0 errors** (11 pre-existing unused-disable warnings,
  untouched lines).
- `vite build` — clean (`index-*.js` ~1219 kB).
- P9.5.8 / P9.5.8.1 / P9.5.7 / P9.5.6 / P10 / INC-06 suites — all pass, untouched.

## §AE. Production acceptance (verified LIVE 2026-09-01, owner account, `forge-delta-ivory.vercel.app`)
- **Select Aug 31 (D-1) → Leaderboard → Home** ⇒ Home **stays on Aug 31** (green chip,
  "August 2026", "← Back to today", Monday's classes). Pre-fix: snapped to Sept 1.
- **Select Aug 31 → open logger (correct "3 RFT" workout frozen) → cancel** ⇒ Home **stays
  on Aug 31**.
- **Rapid chip taps 29 Aug → 2 Sep** ⇒ settles on **2 Sep**; its WOD card shows Sept 2's
  "AMRAP 10:00" (coherent, not a stale earlier day), Log button correctly enabled.
- **"← Back to today"** ⇒ Sept 1, "TODAY", link gone.
- **Console:** no new app errors across all of the above (only the known Chrome-extension
  "message channel closed" noise, pre-dating the test).
- Not verified this session (no artificial lag tooling / no member login): the exact
  hostile-async-order commit race — covered by the 12 deterministic deferred-promise
  scenarios — and token-refresh-on-focus, covered by the `setUser` id-gate.

## §AF. Console status
Preview build boots clean (login screen, no error boundary); no app-code console errors.
Known Chrome-extension "message channel closed" noise is unrelated.

## §AG. Commit — `76eaafe` (WOD-SIMPLE, `theboxconstanta/Forge` main); report follow-up commit for §AE
## §AH. Bundle — `dist/assets/index-Cc9FQn_9.js` live on the prod alias
## §AI. app_version — `home-date-selection-race-inc04-20260901`

## §AJ. Remaining limitations
- `onEditSkill` still sets `dataAcasa = <log's date>` (a pre-existing coupling: the
  skill-edit logger resolves its save target from live `wodZiData`, not a frozen context).
  After such an edit Home is left on that log's date rather than today — harmless and
  consistent with "Home date = last navigation", but a future "Layer 3" could freeze the
  skill-edit context and drop this writer.
- No new error/retry UI for a failed Home fetch (out of scope) — a failed latest request
  shows the no-workout state for the selected date.
- Transient chip↔content: on a slow connection, after tapping a new date the card briefly
  shows the loading/no-workout state before the new workout paints (chosen over showing
  the previous day's workout under the new chip). CTA is disabled throughout.

## §AK–AP. Adjacent phase status
- **P9.5.8** GREEN / untouched · **P9.5.8.1** GREEN / untouched · **P9.5.7** GREEN /
  untouched · **P9.5.6** GREEN / untouched · **P10** GREEN / untouched (no historical
  reinterpretation) · **INC-06** GREEN / untouched.

## §AQ. INC-04 final status
**CLOSED** on merge + green production network-throttle acceptance.

## §AR. No unrelated phase started.

---

## Production acceptance checklist (post-deploy, prod alias, browser throttling)

- [ ] Rapid `Today → D+1 → D+3 → D+7` under "Slow 3G" → settles on **D+7**, no rebound to Today.
- [ ] Rapid historical selection under throttling → settles on the last selected historical date.
- [ ] Select a date with no workout → empty state for that date, no Today rollback.
- [ ] Select non-Today date → open logger → cancel → Home still on that date.
- [ ] Select non-Today date → open logger → save → saved row targets that date's workout.
- [ ] Background the tab on a non-Today date → refocus → still that date (token refresh no longer resets).
- [ ] Console: no new app errors.
