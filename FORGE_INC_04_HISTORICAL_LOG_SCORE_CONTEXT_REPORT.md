# FORGE — INC-04 HISTORICAL "LOG SCORE" OPENS TODAY'S WORKOUT — REPORT
Date: 2026-08-28

---

## Executive Verdict

**INC-04: FIX DEPLOYED — AWAITING OWNER ACCEPTANCE**

**Scope: ALL WORKOUTS / ALL DATES / ALL VARIANTS / ALL LOG-SCORE ENTRY POINTS.**
No date, workout, variant, or section is special-cased anywhere in the
implementation.

This is a two-part fix:

1. **`27131a5` (Layer 1 — request-currency guard).** `fetchWodZi()` /
   `fetchWodZiWorkoutV2()` had no guard, so a stale in-flight fetch for a
   previously-selected date could resolve last and overwrite `wodZiData` /
   `wodZiWorkoutV2`. Fixed with `isWorkoutFetchCurrent()`: a response is applied
   only while the date it was issued for is still selected. **Necessary but not
   sufficient** — the owner reproduced the split-brain again.

2. **`8501356` (Layers 2 + 3 — frozen logging identity).** The architectural root
   cause: the logger and `saveWodLog` / `saveSkillLog` **reconstructed** workout
   identity from mutable global state (`wodZiData`, `wodZiWorkoutV2`, `dataAcasa`,
   `variantaAleasa`) **after** the click, instead of carrying the identity of the
   workout the user actually clicked. The fix captures a **frozen `logCtx`
   snapshot** of the currently-displayed workout at the exact moment "Log Score" /
   Skill "Log" is pressed; a `homeDisplayIsCurrent` gate blocks the click while the
   display is stale relative to the selected date; and every logger/save
   identity-bearing read switches to `logCtx` for the whole session. No
   today / first-RX / previous-state fallback — an incomplete frozen identity
   fails closed.

Deployed live (commit `8501356`, Vercel production, bundle `index-Cza3PlDO.js`
verified to contain the frozen-context object keys). `app_version` bumped. 14 new
regression tests total (6 currency-guard + 8 generic multi-workout). WOD-SIMPLE
928 → **942 / 942**, build PASS. **No DB / RLS / grant / data change; INC-03
invariant untouched (0 linked-date divergences, 0 impossible log identities).**

**Not CLOSED** until the owner manually verifies the workflow end-to-end
(§ Owner Acceptance).

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

## Canonical Logging-Target Invariant

Forge now guarantees, for **every workout, every date (past / today / future),
every format, every variant, every section, every Log Score entry point**:

```
DISPLAYED WORKOUT
  = frozen logging target (captured at click)
  = logger content
  = selected variant
  = scored section
  = legacy WOD id
  = save payload identity
```

The logging target is **frozen at the instant the button is pressed** and is the
**sole** source of identity for the rest of the logger session. Nothing
downstream re-resolves identity from `wodZiData` / `wodZiWorkoutV2` / `dataAcasa` /
`variantaAleasa` / "today" / "first RX" / previous screen state.

---

## Fix

Two layers, both **app-only** — `src/utils.js` + `src/App.jsx`. **No date,
workout id, workout name, variant, or section is referenced anywhere in the
implementation** (verified: `git show 27131a5 8501356 -- src/ | grep -E
'2026-08-2[78]|Buy-?In|Cash-?Out|8cd9666b|fc1900b7'` → no matches in non-test
code).

### Layer 1 — request-currency guard (`27131a5`)

- `src/utils.js`:
  ```js
  export function isWorkoutFetchCurrent(fetchedForDate, currentSelectedDate) {
    return fetchedForDate != null && fetchedForDate === currentSelectedDate
  }
  ```
- `src/App.jsx`: `fetchWodZi` / `fetchWodZiWorkoutV2` bail out
  (`if (!isWorkoutFetchCurrent(data_str, dataAcasaRef.current)) return`) before
  **every** `setWodZiData(...)` / `setWodZiWorkoutV2(...)` (success **and** catch).
  Default `data_str` fallback switched from the `dataAcasa` closure to
  `dataAcasaRef.current`.

Stops a stale in-flight response for a previously-selected date from overwriting
the display state. **Necessary but not sufficient**: it does not stop the logger
from *opening on top of* state that is already stale (a prior Home visit's
today-fetch populated `wodZiData` / `wodZiWorkoutV2`; the just-selected date's
fetch had not landed yet).

### Layer 2 — frozen logging identity (`8501356`)

- `src/utils.js` — two new pure helpers:
  - `freezeLoggingContext(displayedWorkout, wodZiData, wodZiWorkoutV2, businessDate)`
    → returns an immutable snapshot
    `{ businessDate, wodZiData, wodZiWorkoutV2, workout, primarySection,
    supportingSections, additionalScoredSections }` taken from the **currently
    displayed** workout.
  - `resolveLoggedWorkoutIdentity(logCtx, variantLevel)` → derives
    `{ wodId, sectionId, businessDate, variantMovements }` **only** from the
    frozen `logCtx` (via `resolveWodIdForLog` on the frozen V2/legacy pair);
    returns all-null when `logCtx` is absent (**fail closed**).
- `src/App.jsx`:
  - new state `const [logCtx, setLogCtx] = useState(null)` — the frozen target.
  - `captureLogCtx = () => freezeLoggingContext(workoutForDisplay, wodZiData,
    wodZiWorkoutV2, dataAcasa)`.
  - `displayedWorkoutDate = wodZiWorkoutV2?.date ?? wodZiData?.date ?? null`;
    `homeDisplayIsCurrent = displayedWorkoutDate != null &&
    displayedWorkoutDate === dataAcasa` — true only when the **workout object's
    own date** equals the selected date.
  - **all 4 identity-bearing entry points** (primary official variant button;
    additional-scored-section card "Log"; Skill Work slot 1; Skill Work slot 2):
    `if (!homeDisplayIsCurrent) return; setLogCtx(captureLogCtx());` **before**
    navigating; the primary button is also `disabled` unless
    `variantaAleasa !== null && homeDisplayIsCurrent`.
  - for the **entire** non-edit `logWOD` / `logSkill` session, an alias block
    routes every logger + save read through the frozen context:
    ```js
    const inFrozenLogFlow = (screen === 'logWOD' || screen === 'logSkill') && !editLogId && logCtx != null
    const logWodZiData            = inFrozenLogFlow ? logCtx.wodZiData            : wodZiData
    const logWodZiWorkoutV2       = inFrozenLogFlow ? logCtx.wodZiWorkoutV2       : wodZiWorkoutV2
    const logBusinessDate         = inFrozenLogFlow ? logCtx.businessDate         : dataAcasa
    const logPrimarySectionV      = inFrozenLogFlow ? logCtx.primarySection       : primarySectionV
    const logSupportingSectionsV  = inFrozenLogFlow ? logCtx.supportingSections   : supportingSectionsV
    const logAdditionalScoredSectionsV = inFrozenLogFlow ? logCtx.additionalScoredSections : additionalScoredSectionsV
    ```
    Rewired reads: `activeLogFormatId` / `activeLogFormatConfig` /
    `miscariPentruLog` / `prescribedWeightPentruLog` / `logTargetSection`; the
    `logWOD` render (date label, type + duration, variant summary, per-variant
    movements, format description); the `logSkill` render (skill type, movements,
    name, format config, new-vs-edit title); `saveWodLog` **primary path**
    (`cheieVarianta`, `miscariWodZi`, `durStr`, `computeWodHeaderLine`,
    `loggedAt`, `sectionIdV2`, `wodIdPtSalvare = resolveWodIdForLog(logWodZiWorkoutV2,
    logWodZiData)`, share popup); `saveWodLog` **scored-section path**
    (`wod_id: resolveWodIdForLog(logWodZiWorkoutV2, logWodZiData)`); `saveSkillLog`
    (guards `if (!logWodZiData) return`, section id, `wod_id`, `logged_at`).
  - `logCtx` is cleared on leaving the logger
    (`[screen]` effect: `if (screen !== 'logWOD' && screen !== 'logSkill') setLogCtx(null)`).

The `editLogId` path (Journal edit of an existing log) is deliberately **not**
routed through `logCtx` — it already carries its own row identity and must not be
reframed by the current Home selection.

### Fail-closed behaviour

| Situation | Result |
|---|---|
| displayed workout's date ≠ selected date | all 4 entry points **no-op**; primary button **disabled** — logger never opens on stale content |
| historical date has no workout | `workoutForDisplay` null → `captureLogCtx()` freezes a null workout → entry points no-op / disabled |
| frozen `logCtx` present but identity incomplete | `resolveLoggedWorkoutIdentity` returns null `wodId` / `sectionId`; save follows the existing null-wod_id path (free-text / no section) — **never** substitutes today's or "first RX" identity |
| `wodZiData` cleared mid-session (INC-02 effect) | non-edit logger keeps reading the frozen `logCtx`, not the now-null live state |

---

## All Entry Points

| # | Entry point | Screen | Save path | Frozen at click | Save identity source |
|---|---|---|---|---|---|
| 1 | Primary official variant "Log Score" | `logWOD` | `wod_logs` insert (primary) | `setLogCtx(captureLogCtx())` + `disabled`/`homeDisplayIsCurrent` gate | `resolveWodIdForLog(logWodZiWorkoutV2, logWodZiData)`, `logPrimarySectionV.id` |
| 2 | Additional independently-scored section "Log" | `logWOD` | `wod_logs` insert (section) | `if (!homeDisplayIsCurrent) return; setLogCtx(...)` | `resolveWodIdForLog(logWodZiWorkoutV2, logWodZiData)`, `logTargetSection.id` |
| 3 | Skill Work slot 1 "Log" | `logSkill` | `skill_logs` upsert | `if (!homeDisplayIsCurrent) return; setLogCtx(...)` | `resolveWodIdForLog(...)`, `logSupportingSectionsV` skill slot id |
| 4 | Skill Work slot 2 "Log" | `logSkill` | `skill_logs` upsert | `if (!homeDisplayIsCurrent) return; setLogCtx(...)` | `resolveWodIdForLog(...)`, `logSupportingSectionsV` skill2 slot id |
| — | Journal edit (`editLogId`) | `logWOD` | `wod_logs` update | *not frozen — carries its own row identity* | existing row's `wod_id` |
| — | Free-text log | `logWOD` | `saveFreeTextLog` (`wod_id: null`) | frozen (no-op for identity — always null) | n/a |

---

## Regression Matrices

All in `src/utils.test.js` with **generic fixtures** — `mkWorkout(tag, date)` /
`mkLegacy(tag, date)`, workouts **A** (`2026-08-20`), **B** (`2026-08-21`),
**C** (`2026-07-14`), each with `movements_rx: ['RX-<tag>-...']` so all three
carry an identical `"RX"` variant **label** but distinct ids, dates and movements.

### Same-label collision

| Scenario | Assertion |
|---|---|
| Freeze A while B is the live `wodZiWorkoutV2` | `resolveLoggedWorkoutIdentity(freeze(A)).wodId` === A's legacy id, **not** B's — the shared `"RX"` label does not leak B's identity |
| Frozen `variantMovements` for `"rx"` | equals `A.movements_rx`, never B's / C's |

### Multi-date

| Scenario | Assertion |
|---|---|
| Freeze historical C (`2026-07-14`) while today ≠ C | `businessDate` === `2026-07-14`; identity === C's |
| D+n (C is 45 days back) | identity independent of "today" — frozen `businessDate` is C's |

### Multi-variant

| Scenario | Assertion |
|---|---|
| `resolveLoggedWorkoutIdentity(logCtx, 'RX')` vs `'Scaled'` | returns `movements_rx` vs `movements_scaled` **from the frozen `wodZiData`** — variant switch never re-reads live state |
| null `variantLevel` | `variantMovements` === `[]` (fail closed, no default variant) |

### Multi-section

| Scenario | Assertion |
|---|---|
| Frozen workout with metcon + 2 supporting sections | `primarySection` === the `slotKey==='metcon'` section; `supportingSections` === the other two |
| `additionalScoredSections` | only supporting sections with `loggingMode === 'required'`, and only when a V2 workout is frozen |
| legacy-only workout (no `wodZiWorkoutV2`) | `sectionId` === `null` (no invented section) |

### Async / navigation

| Scenario | Assertion |
|---|---|
| Freeze A, then mutate the source objects | frozen `logCtx` is unchanged (snapshot, not reference) — `freezeLoggingContext` deep-picks primitives + new arrays |
| Layer 1: late `2026-08-28` response while `2026-08-27` selected | `isWorkoutFetchCurrent('2026-08-28','2026-08-27') === false` |
| Layer 1: rapid `27→26→27` switching | only the response matching the currently-selected date is applied |

### Save identity

| Scenario | Assertion |
|---|---|
| Frozen V2 + legacy disagree on identity | `resolveLoggedWorkoutIdentity` returns the **frozen V2's `legacyWodId`** (matches `resolveWodIdForLog` preference), not the live pair |
| No workout frozen (`logCtx` null) | `{ wodId: null, sectionId: null, businessDate: null, variantMovements: [] }` — save cannot bind to any workout |

---

## Async Race

**Relevant: YES — and now addressed at two levels.** Layer 1 discards a stale
response deterministically (`isWorkoutFetchCurrent('2026-08-28','2026-08-27') ===
false`). Layer 2 makes the race **irrelevant to logging**: even if the live state
is momentarily stale when the button is pressed, the `homeDisplayIsCurrent` gate
blocks the click, and once past the gate the frozen `logCtx` — not the live
state — is what the logger and save use. Full-UI browser reproduction was not run
(no logged-in browser session in this mission); the two-layer code-path proof
plus the 14 regression tests establish HIGH confidence. **Owner end-to-end
acceptance is still required** (§ Owner Acceptance).

---

## Today Fallback

- **Possible before fix: YES** — the logger and save reconstructed identity from
  live global state after the click, so a stale "today" workout (or "first RX"
  variant, or previous-screen section) could bind.
- **Possible after fix: NO** — identity comes only from the frozen `logCtx`. If
  the displayed workout is stale, the click no-ops. If the frozen workout is
  null or its identity incomplete, save follows the existing null-`wod_id` path;
  it never falls back to today, first-RX, or previous state.

---

## Tests

| | value |
|---|---|
| Baseline | 928 / 928 |
| After Layer 1 (`27131a5`) | 934 / 934 |
| **Final (Layer 2, `8501356`)** | **942 / 942** (9 pre-existing Deno-only file-load failures unchanged) |
| New tests | **14** — 6 `isWorkoutFetchCurrent` (Layer 1) + **8** `freezeLoggingContext` / `resolveLoggedWorkoutIdentity` (Layer 2): same-`RX`-label collision (frozen id ≠ live id); freeze immutability under source mutation; per-variant frozen movements; multi-section metcon/supporting split; historical D+n frozen `businessDate`; legacy-only → `sectionId` null; no-workout → all-null fail-closed; frozen V2/legacy disagreement resolves to frozen V2's `legacyWodId` |
| Build (`vite build`) | **PASS** |
| Lint | **PASS** — 0 new errors/warnings |

---

## Production

| | |
|---|---|
| Application deployed | **YES** — commit `8501356` (on top of `27131a5`), Vercel production (`forge-delta-ivory.vercel.app` / `forge-forgewod.vercel.app`) |
| Live bundle verified | **YES** — `index-Cza3PlDO.js` contains the frozen-context object-literal keys esbuild does not rename: `additionalScoredSections` ×2, `businessDate` ×2, `primarySection` ×2, `supportingSections` ×2 — matching the local build |
| `app_version.current` bumped | **YES** — `inc-04-global-frozen-logging-identity-20260828` (live, `updated_at 2026-08-28 14:05Z`) |
| Production data modified | **NO** (the `app_version` bump is the standard PWA-refresh signal; no `workouts` / `wods` / `wod_logs` / `skill_logs` / `subscriptions` / etc. row touched) |
| DB modified | **NO** — no migration, no function / trigger / RLS / grant change. No DB change was necessary; none was made. |
| Security modified | **NO** — Security Gate remains GREEN |
| Special-casing | **NONE** — no production date / id / workout name in implementation code (only in test fixtures and this report) |

---

## Owner Acceptance

**INC-04 is NOT CLOSED.** Status: **FIX DEPLOYED — AWAITING OWNER ACCEPTANCE.**

The owner must manually verify, on the live PWA (after the app refreshes to
`app_version inc-04-global-frozen-logging-identity-20260828`), that **the workout
shown on screen is exactly the workout the logger opens and saves** for **at
least**:

| # | Manual check | Pass criterion |
|---|---|---|
| 1 | **Yesterday's** workout → "Log Score" | logger content === the yesterday workout shown; date label = yesterday |
| 2 | **Today's** workout → "Log Score" | logger content === today's workout; date label = today |
| 3 | **Another historical date** (e.g. a week back) with a different workout → "Log Score" | logger content === that date's workout; date label = that date |
| 4 | For each of the above, open a **variant** (RX / Scaled / …) and a **scored section** / **Skill** entry | movements shown in the logger match the selected workout + variant, not another day's |
| 5 | Rapidly switch dates then immediately press "Log Score" | either the correct workout opens, or the button does nothing (never a different workout) |

Only after the owner confirms all of the above does INC-04 move to CLOSED.

---

## Acceptance (contract-level, pre-owner)

| Check | Result |
|---|---|
| Displayed workout === frozen target === logger content === save identity | **PASS** (tested — `resolveLoggedWorkoutIdentity(freeze(X))` === X's identity for A/B/C with shared `"RX"` label) |
| Historical date, logger opens that date's workout | **PASS** (frozen `businessDate` + identity are the displayed workout's own, not "today") |
| Stale display blocks the click | **PASS** — `homeDisplayIsCurrent` false ⇒ all 4 entry points no-op, primary button disabled |
| No-workout historical date | **PASS** — never falls back to today; entry points disabled/no-op |
| Incomplete frozen identity | **PASS** — fails closed to null-`wod_id` path; no today / first-RX substitution |
| All 4 Log Score entry points covered | **PASS** — primary variant, scored section, Skill slot 1, Skill slot 2 |
| Save payload identity (`wod_id`, section) from frozen target | **PASS** — `saveWodLog` (both paths) + `saveSkillLog` read `logWodZi*` |
| Journal edit unaffected | **PASS** — `editLogId` path excluded from `inFrozenLogFlow` |
| Layer 1 currency guard retained | **PASS** — `isWorkoutFetchCurrent` still guards every fetch setState |
| INC-03 DB invariant | **INTACT** — linked-date divergences = 0, impossible log identities = 0 (re-verified live) |
| No DB / RLS / grant / data / special-case change | **CONFIRMED** |

---

## Final Verdict

**INC-04: FIX DEPLOYED — AWAITING OWNER ACCEPTANCE.**

The remediation is **global** — it is not tied to 2026-08-27, Buy-In/Cash-Out, or
any production id. Every workout, every date, every format, every variant, every
section, and all four Log Score entry points now derive their logging and save
identity from a single frozen snapshot captured at click time, with a
stale-display gate in front and fail-closed behaviour behind. INC-04 remains
**open** until the owner completes the manual acceptance checks above.
