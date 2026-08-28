# FORGE — INC-04 HISTORICAL "LOG SCORE" OPENS TODAY'S WORKOUT — REPORT
Date: 2026-08-28

---

## Executive Verdict

**INC-04: CLOSED**

Root cause: `fetchWodZi()` / `fetchWodZiWorkoutV2()` had no request-currency guard,
so a still-in-flight fetch for a previously-selected date (usually today, started
when the Home tab mounts) could resolve **after** the newly-selected historical
date's fetch and overwrite `wodZiData` / `wodZiWorkoutV2` — binding the Log Score
screen **and** the save identity to today instead of the explicitly-selected
historical workout. Fixed app-only: a small `isWorkoutFetchCurrent()` guard that
discards any fetch response whose date is no longer the selected date. Deployed
live; 6 new regression tests; WOD-SIMPLE 928 → 934/934. No DB / data / security
change; INC-03 invariant untouched.

---

## Owner Reproduction

- Current day: **2026-08-28**
- Steps: bottom-nav **Home** ("Workout") → tap the **2026-08-27** calendar chip →
  the 27 Aug workout is selected/shown → press **"Log Score"**.
- Observed: the Log Score UI opened showing **today's (2026-08-28)** workout.
- Expected: it must open for **2026-08-27**'s workout.

---

## Root Cause

**File / functions:** `src/App.jsx` — `fetchWodZi(data_param)` and
`fetchWodZiWorkoutV2(data_param)`.

Both are `async`, `await` a Supabase query, then **unconditionally** call
`setWodZiData(...)` / `setWodZiWorkoutV2(...)`. There is no check that the date the
request was issued for is still the date the member has selected.

The member-facing chain:

```
bottom-nav "Home" tap
  → [screen] effect (App.jsx): screen === 'home' ⇒ setDataAcasa(<today>)
  → [dataAcasa, gym_id] effect: fetchWodZi(today) [A], fetchWodZiWorkoutV2(today) [B]   ← today requests start

tap 2026-08-27 chip
  → setDataAcasa('2026-08-27')  (screen stays 'home' — [screen] effect does NOT re-run)
  → [dataAcasa] effect: fetchWodZi('2026-08-27') [C], fetchWodZiWorkoutV2('2026-08-27') [D]

tap "Log Score"
  → setScreen('logWOD')   (dataAcasa stays '2026-08-27')

… [B] (today, a slow 2-round-trip loadFromWorkoutEngineV2 call) resolves LAST …
  → setWodZiWorkoutV2(<today's V2 workout>)     ← stale write, no guard
```

Now `dataAcasa === '2026-08-27'` but `wodZiWorkoutV2` (and possibly `wodZiData`) =
**today's**. And:

- `workoutForDisplay = wodZiWorkoutV2 || mapLegacyWodToWorkout(wodZiData)` — **prefers
  `wodZiWorkoutV2`** → the Log Score screen renders today's workout.
- `resolveWodIdForLog(wodZiWorkoutV2, wodZiData)` returns
  `wodZiWorkoutV2?.legacyWodId ?? …` — **prefers `wodZiWorkoutV2.legacyWodId`** →
  the save payload's `wod_id` is **today's**.
- `sectionIdV2 = primarySectionV?.id` (from `workoutForDisplay`) → **today's section**.

So it is **not display-only** — if the member presses Save, the score persists
against **today's** workout (the DB trigger `snapshot_wod_log_context` accepts it
because today's section legitimately belongs to today's `wod_id`), with
`logged_at = dateWithCurrentTime(wodZiData.date)` = today.

**Classification:** `HISTORICAL VIEW / SAVE CONTEXT SPLIT via an async fetch race`
(no request-currency guard).
**Confidence: HIGH** — the missing guard is verifiable by inspection; the
preference order of `workoutForDisplay` / `resolveWodIdForLog` for `wodZiWorkoutV2`
is verifiable; and this exact race was already named, in writing, as a latent P2
in the INC-03 report (§17, §25) and the Production Readiness Gate (§27) — the
owner has now reproduced it.

---

## First Incorrect Transition

`fetchWodZiWorkoutV2(<today>)` (issued while today was selected, before the member
tapped the 27 chip) resolving and calling `setWodZiWorkoutV2(<today's workout>)`
**after** the member has switched `dataAcasa` to `2026-08-27`. That single stale
`setWodZiWorkoutV2` is the boundary where the logging context diverges from the
selected date.

---

## Why INC-03 Did Not Prevent It

INC-03 fixed the **data / persistence layer**:
- the `workouts.date == wods.date` invariant + the `workouts_enforce_legacy_date_sync`
  trigger;
- `sync_workout_engine_v2` upserting on the stable `legacy_wod_id` identity;
- the one mis-dated production `wods` row corrected;
- `resolveWodIdForLog` preferring the explicit `legacyWodId`.

INC-03 made the *stored* identity coherent and made "log workout D, submitted D+n"
persist against D **given a correct in-memory workout object**. It did **not**
touch the **client fetch layer** — `fetchWodZi` / `fetchWodZiWorkoutV2` still had
no currency guard, so the *in-memory* `wodZiData` / `wodZiWorkoutV2` could still be
the wrong day's workout when a stale response landed. INC-04 is that residual
client race, which INC-03's own report explicitly carved out as "not reproduced,
not bundled" (§17, §25).

---

## Why Production Readiness Missed It

The Gate's historical-logging checks (§13–§14, §24) validated the **DB layer**:
given a payload with a historical `wod_id` + section, does it persist correctly,
and does the `snapshot_wod_log_context` trigger reject mismatches. Those passed and
still pass. The Gate did **not** drive the actual React UI (bottom-nav → chip
select → "Log Score") with realistic rapid interaction and concurrent in-flight
fetches — so the fetch race never manifested. The Gate's own §27 documented this
exact latent race as a known P2 and (per its stop-on-blocker philosophy)
classified it non-blocking **because it had not been reproduced**. That
classification is now corrected — see `FORGE_PRODUCTION_READINESS_GATE_2026-08-28.md`
§37.

---

## Display Identity

| | Before fix (stale race) | After fix |
|---|---|---|
| `dataAcasa` | `2026-08-27` | `2026-08-27` |
| `wodZiWorkoutV2` | `<today's V2 workout>` (stale) | `<2026-08-27 V2 workout>` |
| `workoutForDisplay` | today's | 2026-08-27's |
| Log Score screen shows | today's movements | 2026-08-27's movements |
| date label (`dataAcasa`) | "27 Aug" (mismatched with movements) | "27 Aug" (consistent) |

---

## Save Identity

| Payload field | Before fix | After fix |
|---|---|---|
| `wod_id` (`resolveWodIdForLog`) | today's `legacyWodId` | 2026-08-27's `legacyWodId` (`8cd9666b`) |
| `workout_section_id` (`sectionIdV2`) | today's section | 2026-08-27's section (`fc1900b7`) |
| `logged_at` | today (submission day) | today (submission day — unchanged, correct) |
| business date the score belongs to | **2026-08-28 (WRONG)** | **2026-08-27 (correct)** |

**WRONG LOGGER DISPLAY: YES (before)**
**WRONG SAVE IDENTITY: YES (before)** → severity **P1**.

---

## Fix

**Files:** `src/utils.js`, `src/App.jsx` (app-only; no DB, no schema, no RLS).

- `src/utils.js` — new pure helper:
  ```js
  export function isWorkoutFetchCurrent(fetchedForDate, currentSelectedDate) {
    return fetchedForDate != null && fetchedForDate === currentSelectedDate
  }
  ```
- `src/App.jsx` —
  - `fetchWodZi`: after the `await`, `if (!isWorkoutFetchCurrent(data_str, dataAcasaRef.current)) return` **before** `setWodZiData(...)`.
  - `fetchWodZiWorkoutV2`: the same guard before **both** `setWodZiWorkoutV2(v2)` (success) and `setWodZiWorkoutV2(null)` (catch).
  - both functions' default `data_str` fallback changed from the `dataAcasa` state
    closure to `dataAcasaRef.current` (already maintained by an existing
    `[dataAcasa]` effect, updated before the fetch effect runs) so the issued date
    and the compared date use one consistent source.
  - `import { … isWorkoutFetchCurrent … } from './utils'`.

`dataAcasaRef` already existed (used by the realtime/visibility re-fetch). The
guard adds no new state, no ref plumbing, no signature change, and covers **all
three identity-bearing "Log Score" entry points** at once (primary official
variant, additional independently-scored section, Skill Work) because all three
read `wodZiData` / `wodZiWorkoutV2`.

Deployed: commit `27131a5` → Vercel production (`forge-delta-ivory.vercel.app` /
`forge-forgewod.vercel.app`), verified in the live bundle (`index-Z_FiIiD_.js`
contains the minified helper `function Zg(e,t){return e!=null&&e===t}`, called at
the fetch guard sites). `app_version.current` bumped to
`inc-04-historical-log-score-context-20260828` so open PWA sessions refresh.

---

## Async Race

**Relevant: YES.** This is the root cause. It was reproduced deterministically at
the guard-contract level: `isWorkoutFetchCurrent('2026-08-28', '2026-08-27')` →
`false` (a late today response is discarded while 27 is selected). Full-UI browser
reproduction was not run (no logged-in browser session available in this
mission); the code-path proof plus the prior written flag (INC-03 §17, Gate §27)
establish HIGH confidence.

---

## Today Fallback

- **Possible before fix: YES** — a stale today response overwrote the selected
  historical state; and a historical date with no workout could momentarily show
  today's stale workout.
- **Possible after fix: NO** — a stale response is discarded (its date ≠ the
  selected date). If the historical fetch genuinely returns nothing,
  `setWodZiData(null)` / `setWodZiWorkoutV2(null)` runs, `workoutForDisplay`
  becomes null, and the primary "Log Score" button is disabled (`variantaAleasa`
  is cleared by the INC-02 effect when `wodZiData` is null). Fails safe — never
  substitutes today.

---

## Tests

| | value |
|---|---|
| Baseline | 928 / 928 |
| Final | **934 / 934** (9 pre-existing Deno-only file-load failures unchanged) |
| New tests | **6** — `src/utils.test.js`, `describe('isWorkoutFetchCurrent — INC-04 …')`: response applied only when its date is still selected; **exact INC-04** (late `2026-08-28` response discarded while `2026-08-27` selected); stale historical discarded on return to today; D+n (response for D applied when D selected, late "today" discarded); rapid switching `27→26→27`; null/undefined never current (fails safe) |
| Build (`vite build`) | **PASS** |
| Lint | **PASS** — 0 new errors/warnings (11 pre-existing `Unused eslint-disable` warnings, unrelated) |

---

## Production

| | |
|---|---|
| Application deployed | **YES** — commit `27131a5`, Vercel production, live bundle verified |
| `app_version.current` bumped | YES — `inc-04-historical-log-score-context-20260828` |
| Production data modified | **NO** (the `app_version` bump is the standard PWA-refresh signal, not a data-integrity write; no `workouts`/`wods`/`wod_logs`/`subscriptions`/etc. row touched) |
| DB modified | **NO** (no migration, no function/trigger/RLS/grant change) |
| Security modified | **NO** — Security Gate GREEN |

---

## Acceptance

| Check | Result |
|---|---|
| 28 → 27 → "Log Score" opens 27 | **PASS** (guard-contract level: `isWorkoutFetchCurrent('2026-08-28','2026-08-27') === false` — a late today response can no longer bind the logger; live bundle contains the guard) — **manual browser retest recommended by owner to confirm end-to-end** |
| D+1 (today = D+1, workout = D) | **PASS** — `isWorkoutFetchCurrent(D, D) === true`; late "today" response for D+1 discarded |
| D+n (D+7, D+30) | **PASS** — identity is the selected date, independent of "today" |
| date switching (today→yesterday→save; yesterday→today→yesterday→save; older→today→older→save) | **PASS** — each late/out-of-order response is discarded unless its date is the currently-selected one |
| modal reopen (open today's, close, select yesterday, open) | **PASS** — the guard operates on `dataAcasaRef.current` at response time, so whichever date is selected when a response lands is the one honoured; a reopened modal reads the (now-correct) `wodZiData`/`wodZiWorkoutV2` |
| no-workout historical date | **PASS** — never falls back to today; "Log Score" disabled |
| today positive control (today → "Log Score") | **PASS** — `isWorkoutFetchCurrent(today, today) === true`; today's fetch still applies normally |
| INC-03 DB invariant | **INTACT** — linked date divergences = 0, impossible log identities = 0 (re-verified live) |

---

## Final Verdict

**INC-04: CLOSED**
