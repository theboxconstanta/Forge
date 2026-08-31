# INC-06 — GENERIC FUTURE-WORKOUT LOGGING + INTERVAL RESULT SEMANTICS

**Status:** CLOSED — SHIPPED LIVE 2026-08-31.
**Commit:** `a2f11be` (WOD-SIMPLE `main`). **Bundle:** `assets/index-ypO55mVQ.js`.
**app_version:** `future-interval-logging-inc06-20260831`.
**Priority:** P1. **DB / schema changes:** 0. **Historical row mutations:** 0.
**forge-admin-web changes:** 0 (its `ScoreDisplay` already gates on `isWeightScoredSetsFormat`).

---

## A. Owner symptoms

Testing (business date 2026-08-31) a workout programmed for **2026-09-01**:
Intervals · 15 Rounds · Work 0:40 · Rest 0:20 · `Max.reps: Handstand Push-up`,
`Renegade Row @ 17.5 kg`, `Max.reps: Shuttle run`.

- **A** Log Score does not produce the expected accumulated performance result.
- **B** Result / share presentation can show `—` instead of a meaningful score.
- **C** After logging the future workout, the result does not appear on the
  2026-09-01 leaderboard as expected.
- **D** The result appears to have no correct destination after Save.

## B. Exact reproduction

Live DB forensics + a controlled reproduction test (`src/incFutureIntervalLogging.test.js`)
against the **real production payload** (row `wod_logs.5f7a177c`, member `97a4e88a` =
the owner's `Test` account, `wod_id 2ed71d47`):

- `result = null`, `time_result = null`, `completion_state = null`, `log_meta = null`.
- `sets` = 15 work-round entries, reps `[23,4,3,5,6,23,2,3,4,5,4,32,43,43,3]` (Σ = **203**).
- `format_snapshot = 'Intervals'`, `format_config_snapshot = {restSec:20, rounds:15, workSec:40}` — **no `scoringMode` key**.
- `workout_section_id = 98f62722` = the `slot_key='metcon'` Intervals section of Engine V2 workout `72444bbc`.

## C. Track A classification — **A2** (correct write / blocked leaderboard read)

The write target is **fully correct**. A1 / A3 / A4 / A5 ruled out.

## D. Track A root cause

The leaderboard **and** the Jurnal forward-date navigation were hard-capped at
"today":

| surface | cap |
|---|---|
| `Clasament` `›` button | `disabled={isToday}` (App.jsx ~2229) |
| `JurnalList` `›` button | `disabled={jurnalDate >= jurnalTodayISO}` (App.jsx ~10850) |
| `JurnalList` date picker | `<input type="date" … max={jurnalTodayISO}>` (App.jsx ~10857) |
| `JurnalList` swipe-forward | `if (jurnalDate < jurnalTodayISO) goJurnalDay(1)` (App.jsx ~7161) |

The **Home calendar has no such cap** — a workout can be selected and *logged*
for a future business date, but its result could not be *viewed* until that date
arrived. That inconsistency is the defect. `fetchClasament` itself resolves any
date correctly (`wods.date → wod_id → wod_logs.wod_id`); there is no query bug,
no eligibility bug.

## E. Track A evidence (identity captured at every stage)

| stage | value |
|---|---|
| Engine V2 workout | `72444bbc`, `date = 2026-09-01`, `legacy_wod_id = 2ed71d47` |
| legacy `wods` row | `2ed71d47`, `date = 2026-09-01`, `type = 'Intervals'`, `format_config = {restSec:20,rounds:15,workSec:40}` |
| `workouts.date == wods.date` | ✓ (no INC-03-style divergence) |
| frozen `logCtx` (`freezeLoggingContext`) | `wodZiWorkoutV2.legacyWodId = 2ed71d47` |
| `resolveWodIdForLog(logCtx…)` | `2ed71d47` |
| saved `wod_logs.wod_id` (both rows) | `2ed71d47` ✓ |
| saved `workout_section_id` | `98f62722` (the metcon Intervals section) ✓ |
| saved `logged_at` | `2026-09-01 <local submission time>` (`dateWithCurrentTime(workout.date)`) |
| `wod_logs.wod_id` → `wods` → `wods.date` | `2026-09-01` ✓ — **the 2026-09-01 workout owns the result** |

Leaderboard render path proven correct **independently**: the live 2026-08-21
"Intervals 18:00" leaderboard renders `23 reps` / `16 reps` / `13 reps` in the
list and `TOTAL 23 reps` + the per-round breakdown in the expanded card.

## F. Track B root cause

**The canonical Intervals score contract EXISTS and is correct** — §27 does NOT
trigger. `workoutFormats.js` `'Intervals'` = `family:'sets'`, `rowMode:'interval'`,
`simpleReps:true`, `config.scoringMode` select `['Lowest Reps','Total Reps']`
**default `'Total Reps'`**. `composeWodLogFields` for `family:'sets'` writes
`result/time_result = null` and the per-round reps into `sets`; the aggregate is
**derived at read** by `computeSetsScore` / `setsDisplayScore`, whose
`resolveSetsScoringMode` applies the schema default when `format_config` omits
`scoringMode`. Same contract as Tabata / Complex / Build-to-Heavy.

**Three WOD-SIMPLE read/display surfaces bypassed the canonical resolver**
(`resolveSetsScoringMode` / `isWeightScoredSetsFormat`) that the WOD-SIMPLE
leaderboard card **and** the forge-admin-web Results view already use:

1. **Share popup** (`WorkoutSharePopup`, App.jsx ~6503 + the assembly ~9069):
   `scoreParts = [result, timeResult].filter(Boolean)` — both **always null** for
   `family:'sets'` (and `family:'chained'`). Share never derives the score →
   **`—` for every sets-family and chained result** (owner symptom B).
2. **Logger total label** (`FormatLogger.SetsFields`, ~line 279): keyed off raw
   `config?.scoringMode === 'Total Reps'`. For a coach-programmed Intervals that
   never explicitly picked a scoring mode, `computeSetsScore` correctly returns
   the **sum** (schema default), but the label fell through to
   `"Cea mai slabă rundă"` / `"Lowest round"` — a SUM mislabelled as the lowest
   round (owner symptom A).
3. **Jurnal WOD card + Skill Jurnal card** (App.jsx ~6119 / ~6280): appended
   `kg`/`lbs` **unconditionally** (`` `${score}${unitLabel}` ``) → **`203kg`** for
   a rep score — a leaderboard/Jurnal disagreement (§34).

## G. Existing canonical Intervals score contract

| aspect | value |
|---|---|
| `formatId` | `Intervals` |
| `family` | `sets` |
| `rowMode` | `interval` (one reps input per WORK round) |
| `simpleReps` | `true` |
| score family | REPS (per-round), aggregated |
| scoring mode | `config.scoringMode` → **schema default `'Total Reps'`** (also `'Lowest Reps'`) |
| result shape | per-round reps in `wod_logs.sets`; `result`/`time_result` **always null** |
| aggregate | derived at read: `computeSetsScore` → Σ reps (`Total Reps`) or `min` (`Lowest Reps`) |
| `NOT_SCORED` | not applicable — the format is always scored |

## H. `Max.reps` semantics

`Max.reps: …` is a **movement-name prefix** authored in the Builder
(`wods.movements_rx` free text) plus a section-movement `prescription.reps =
{mode:'universal', value:null}` (no prescribed rep target). It means "perform max
reps in the work window; log the count per round." It is **presentation / label
metadata** — it does not change the score family, add a metric, or alter
persistence. The interval logger renders exactly `config.rounds` reps inputs; the
athlete's per-round count is the performance.

## I. Rest representation

Purely `wods.format_config.restSec` (a duration in the timing structure). Rest is
**NOT** in `wods.movements_rx`, **NOT** a section movement, **NOT** a `sets` row.
The interval logger emits only `config.rounds` WORK-round inputs (15), zero rest
inputs. Structured representation — no text parsing, no `text.includes("rest")`.

## J. Rest score exclusion

**Zero, by construction.** `computeSetsScore` sums only `sets` reps and there are
no rest rows. Verified for arbitrary configs (40/20, 30/30, 60/15) and with
`restSec` present / 0 / absent — the score is unchanged. No code change was
required for Rest; a permanent anti-regression test locks it (§50).

## K. Elapsed-duration behaviour

`wods.duration = '15:00'` already equals `rounds × (workSec + restSec)` =
15 × 60 = 900 s. This is the **workout timeline**, kept entirely separate from the
**athlete score** (203 reps). The two never mix.

## L. Exact implementation

**New shared pure helpers — `src/workoutFormats.js`:**

```
setsScoreText(formatId, config, sets, weightUnit, repsWord='reps') → string|null
  = setsDisplayScore(value)  +  unit gated on isWeightScoredSetsFormat
    rep-scored   → "203 reps"      weight-scored → "142 kg"      no score → null

setsScoreLabel(mode, t) → string
  'Lowest Reps' → lowest-round label ; 'Total/Max Weight' → Weight label ; else → Total-reps label
```

**Track B:**
- `FormatLogger.SetsFields` — label via `setsScoreLabel(resolveSetsScoringMode(formatId, config), t)`.
- `App.jsx` `JurnalList` WOD card — `wSetsText = setsScoreText(formatTipResolvat, formatConfigResolvat, w.sets, weightUnit, t.clasamentRepsUnit)`; `rezultatBucati = wSetsText != null ? [wSetsText] : …`. Removed the unconditional `unitLabel` constant.
- `App.jsx` `JurnalList` Skill card — `skillScorText = setsScoreText(skillFormatId, skillFormatConfigActual, sl.sets, weightUnit, t.clasamentRepsUnit)`.
- `App.jsx` `saveWodLog` share-data assembly — `derivedShareScore` = `setsScoreText(…)` for `family:'sets'`, else `t.jurnalTotalRepsLabel(log_meta.totalReps)` for `family:'chained'`, else `null`; `result: derivedShareScore ?? logFields.result`.

**Track A:**
- `App.jsx` `Clasament` — removed `disabled={isToday}` (+ disabled styling) on the `›` button.
- `App.jsx` `JurnalList` — removed the `>= jurnalTodayISO` cap on the `›` button, the `< jurnalTodayISO` guard on swipe-forward, and `max={jurnalTodayISO}` on the date picker.

## M. Earliest broken reusable layer fixed

- **Track A:** the leaderboard / Jurnal date-navigation cap (UI) — not compensated downstream, not a query change.
- **Track B:** the canonical sets-score **display** layer — one shared helper
  (`setsScoreText` / `setsScoreLabel`) now feeds every surface, matching what the
  leaderboard card and the admin Results view already did. Not hidden in one surface.

## N. Exact files / functions changed

| file | change |
|---|---|
| `src/workoutFormats.js` | + `setsScoreText`, + `setsScoreLabel` |
| `src/FormatLogger.jsx` | `SetsFields` total label via `setsScoreLabel(resolveSetsScoringMode(...))` |
| `src/App.jsx` | `JurnalList` WOD card (`wSetsText`), Skill card (`skillScorText`), removed `unitLabel`; `saveWodLog` share assembly (`derivedShareScore`); `Clasament` `›` uncapped; `JurnalList` `›` / swipe / date-picker uncapped |
| `src/incFutureIntervalLogging.test.js` | + 38 tests |

## O. Systems deliberately NOT changed

`composeWodLogFields`, `computeSetsScore` / `setsDisplayScore` / `resolveSetsScoringMode`
/ `isWeightScoredSetsFormat` (the value logic — already correct), the leaderboard
card render, `freezeLoggingContext` / `resolveLoggedWorkoutIdentity` / `resolveWodIdForLog`
(P9.1 / INC-04 — already correct for future workouts), `fetchClasament` query,
DB schema, RLS, triggers, functions, P9.x / P10 semantics, forge-admin-web,
Builder, `App()` structure.

## P. DB / schema impact

**None.** Read-only inspection only. `app_version` row bumped (a pre-existing
deploy ritual, not a data change).

## Q. Controlled production rows

None created by this remediation. The 2 pre-existing rows (`5f7a177c`, `f8b25935`,
member `97a4e88a` = owner's `Test` account, from the owner's own testing) were
**not touched** — they are correctly written and now render correctly on every surface.

## R. Future-date test matrix (`incFutureIntervalLogging.test.js`)

| case | result |
|---|---|
| today D → workout D+1, save D | result belongs D+1 (`resolveLoggedWorkoutIdentity`) ✓ |
| today D → workout D+3, save D | belongs D+3 ✓ |
| today D → workout D+7, save D | belongs D+7 ✓ |
| today D → workout D, save D | belongs D ✓ (same-day, live-verified) |
| today D+1 → historical D, save D+1 | belongs D ✓ |
| open D+3 logger, current state drifts, Save | still D+3 (reads frozen `logCtx` only) ✓ |
| open D+1 → close → open D+7 → save | D+7, no D+1 leak ✓ |
| no frozen context | null identity, no today fallback (fail-closed) ✓ |
| leaderboard reaches a future date | `›` no longer `disabled={isToday}` ✓ + **live: 2026-09-01 leaderboard shows `203 reps` / `TOTAL 203 reps`** |
| Jurnal reaches a future date | caps removed ✓ + **live: 2026-09-01 Jurnal shows `RESULT 203 reps`** |

## S. Interval test matrix

| case | result |
|---|---|
| A REP-ONLY (work+rest+rep stations) | rest excluded, `computeSetsScore` = Σ work reps ✓ |
| B REP + LOAD prescription | load stays prescription; a per-round `weight` field is NOT added to the rep sum ✓ |
| C MIXED UNIT | `simpleReps` interval rows are reps-only — no invalid universal sum is ever produced ✓ |
| D Lowest-Reps Intervals | `setsScoreText` = lowest work round ✓ |
| E Tabata (same family) | reps, not kg ✓ |
| F 40/20 | rest non-scoreable ✓ |
| G 30/30 | rest non-scoreable ✓ |
| H 60/15 | rest non-scoreable ✓ |

## T. Score-family regression matrix

`setsScoreText` is `family`-gated → returns `null` for `For Time` / `RFT` /
`AMRAP` / `EMOM` etc.; TIME / TIME_CAPPED / ROUNDS_REPS / REPS / LOAD / DISTANCE /
CALORIES continue to use `result` / `time_result` unchanged. Full WOD-SIMPLE
suite **1462 pass** (1424 + 38), **9 pre-existing Deno `@std/assert` file-load
failures unchanged**. eslint 0 errors. `vite build` OK.

## U. P9 / P10 regression results

P9.1 frozen `logCtx`, P9.4 display projection, P9.5.2 `performed_prescription`,
P9.5.4 RX/Mixed classification, P9.5.5 performed-first result rendering, P10
`resolveResultProvenance` — all untouched and green in the full suite. The
live 2026-09-01 leaderboard card shows a clean `RX` bucket, no false
`Not RX'd` / `Mixed`.

## V. Production acceptance

Live prod (`assets/index-ypO55mVQ.js`, hard reload):

| # | check | result |
|---|---|---|
| 1 | App boots | ✓ (login + Home, 0 console errors) |
| 2 | 2026-09-01 leaderboard reachable (forward nav) | ✓ "Tue, Sep 1 · Intervals 15:00" |
| 3 | future Intervals result on that leaderboard | ✓ `Test — 203 reps` |
| 4 | expanded card: per-round + total, no Rest row | ✓ `Rundă 1…15`, `TOTAL 203 reps` |
| 5 | 2026-09-01 Jurnal reachable + correct result | ✓ `Intervals · RESULT 203 reps` (not `203kg`) |
| 6 | weight-scored Skill Jurnal still correct | ✓ `RESULT 80 kg` |
| 7 | Share popup score | fix verified by unit + 3 regression assertions (pure `result: derivedShareScore ?? …` substitution); live post-save popup not re-exercised — the session's browser tooling was too degraded for the Home→future-date→Log→enter→Save→popup chain (repeated CDP screenshot timeouts) |

## W. Saved WOD date vs submission timestamp proof

- **Workout business date:** `wod_logs.wod_id (2ed71d47) → wods.date = 2026-09-01`.
- **Submission timestamp:** `logged_at = 2026-09-01 <local time>` — the row was
  created on 2026-08-31 (afternoon, Romania local) but `dateWithCurrentTime(workout.date)`
  binds `logged_at` to the workout's business date + the current wall-clock time.
  Identity (`wod_id`) is independent of `logged_at`; the leaderboard filters by
  `wod_id`, never by `logged_at`, whenever the `wods` row exists.

## X. Logger / DB / Leaderboard / Jurnal / Share score proof (one saved result)

| surface | value |
|---|---|
| LOGGER (`FormatLogger.SetsFields` total box) | `Total reps: 203` |
| DB | `sets` (15 rounds) → `computeSetsScore('Intervals', {…}, sets)` = `203` |
| LEADERBOARD | `203 reps` (list) · `TOTAL 203 reps` (card) — **live** |
| JURNAL | `RESULT 203 reps` — **live** |
| SHARE | `203 reps` (`derivedShareScore = setsScoreText(…) = "203 reps"`, rendered via `scoreParts.join(' · ')`) |

## Y. Commit

`a2f11be` — `fix(results): INC-06 - generic future-workout viewing + interval sets score on every surface`

## Z. Bundle

`https://forge-delta-ivory.vercel.app/assets/index-ypO55mVQ.js` (prod), Vercel deploy `AjHRJNmGsz3MQieVw5mNKZnso7tu`.

## AA. app_version

`future-interval-logging-inc06-20260831` (`app_version.current`, live `updated_at 2026-08-31 16:33Z`).

## AB. Remaining limitations

1. **`family:'chained'` (STAGES) share** now shows `log_meta.totalReps` via the
   same assembly; other chained surfaces were already correct.
2. **Weight-scored sets logger label** for Complex `Total/Max Weight` now shows
   the *Weight* label rather than the misleading rep label — a small improvement
   beyond the reported scope, kept because it is the same one-line canonical fix.
3. **Observed, out of scope — `fetchWodZi` display currency under heavy client
   lag.** During acceptance under a severely degraded browser session, a
   Home date-chip tap intermittently failed to register / `dataAcasa` reverted
   to today via the `[screen]` effect, so the logger could open on the
   still-current workout. This is the pre-existing INC-03/INC-04 residual
   (`fetchWodZi` / `fetchWodZiWorkoutV2` request-currency; `freezeLoggingContext`
   + `isWorkoutFetchCurrent` were added to bound it). It is **not caused by**
   INC-06 (which touches no fetch / freeze / Home-nav code) and the owner's own
   saved rows prove real logging resolved to the correct `wod_id`. Flagged for a
   separate ticket, not bundled.
4. **Future leaderboard / Jurnal for a date with no programmed workout** shows
   the empty state (same as the Home calendar navigating to an empty future day).

---

## HARD STOP

Root-cause proven, minimal generic fix implemented, 38 tests + full regression
green, deployed, production-verified (5 of 6 surfaces live, the 6th proven by
test). No date / workout / movement / interval-instance special case was
introduced. **Future workout identity and interval Rest semantics are enforced
through reusable canonical contracts.**
