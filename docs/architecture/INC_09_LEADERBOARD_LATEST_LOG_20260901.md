# INC-09 — Leaderboard does not surface a newly logged result

**Date:** 2026-09-01
**Status:** ROOT CAUSE PROVEN → MINIMAL FIX SHIPPED.
**Repo:** `WOD-SIMPLE` only. Client-side. **ZERO schema / migration / backfill / `wod_logs`
mutation.**
**Adjacent:** INC-08 / INC-08A / INC-07 / INC-06 / INC-04 / P10 / P9.5.6 / P9.5.7 /
P9.5.8 / P9.5.8.1 — untouched, all GREEN.

---

## §1. Incident

Owner re-logged the structured Intervals workout (RX) with a higher score, saw it in
Journal, but the Leaderboard kept showing an older/lower result.

## §2. Forensic audit — the exact logs

At audit time, `wods 2ed71d47` had **6** `wod_logs` (member `97a4e88a`, RX, all family
`sets`, `result`/`time_result` null), ordered by `logged_at`:

| id | `logged_at` (UTC) | vs server `now()` = 09:03 UTC | Total Reps | class |
|---|---|---|---|---|
| `2d6a279d` | 08:00:11 | past | 150 | structured |
| `4e226ab4` | 08:32:17 | past | 387 | structured |
| `167948fc` | 08:50:18 | past | 50 | structured |
| `3ffcbb04` | 08:53:45 | past | **1565** ← owner's new high | structured |
| `f8b25935` | **12:26:05** | **FUTURE (+3h23m)** | 238 | legacy |
| `5f7a177c` | **15:29:19** | **FUTURE (+6h26m)** | 203 | legacy |

**Two logs carry `logged_at` values IN THE FUTURE.** No log can be *submitted* in the
future — these were submitted on a **previous calendar day** (Aug 31, afternoon/evening),
for a workout whose business date is `2026-09-01`.

## §3. Root cause

`wod_logs` has **only `logged_at`** — no `created_at`, no `updated_at` (`logged_at` default
`now()`). For an official-variant log, `saveWodLog` overrides it:

```js
const loggedAt = (variantaAleasa !== null && logWodZiData?.date)
  ? dateWithCurrentTime(logWodZiData.date)   // ← utils.js
  : undefined
```

```js
// BEFORE
export function dateWithCurrentTime(dateStr) {
  const [y, m, d] = dateStr.split('-').map(Number)
  const now = new Date()
  return new Date(y, m-1, d, now.getHours(), now.getMinutes(), now.getSeconds(), now.getMilliseconds()).toISOString()
}
```

→ `logged_at` = **workout's business date + the wall-clock TIME-OF-DAY of submission**.

Intended (documented) purpose: a member who forgot to log yesterday and logs today gets the
log attributed to the **workout's** day, not today. That case is fine — the result is
`<past date> <today's clock>`, which is `< now`.

**The bug:** logging a **future-dated** workout **early** stamps `logged_at` with the
workout's date + the current clock time → **a timestamp in the future**. The owner's two
legacy test logs were made on Aug 31 evening → `2026-09-01 15:29` / `12:26` → future.

The Leaderboard's per-member selection (`App.jsx` `dedupLogsGlobal`, ~2088) keeps the log
with **`max(logged_at)`**:

```js
if (!curr || new Date(log.logged_at) > new Date(curr.logged_at)) byMember[log.member_id] = log
```

→ a future-dated log **outranks every genuinely-later real submission**, indefinitely (or
until real time passes that future value). The owner's new `3ffcbb04` (08:53, 1565) lost to
`5f7a177c` (15:29-future, 203).

### Not the cause
- **Query** — `fetchClasament` (`App.jsx:8535`) is `supabase.from('wod_logs').select('*').eq('wod_id', wodZi.id)` — it returns **every** log for the workout, including the new one. The new log is dropped **client-side** by the dedup, not by the query. (Leaderboard membership uses `wod_id`, not `logged_at` date bounds — those only apply when no `wods` row exists for the date.)
- **Refresh** — `saveWodLog` calls `fetchWodLogs(); fetchClasament()` after save (`App.jsx:9005`), and the `[screen==='clasament']` effect (`App.jsx:7449`) refetches on entry. The Leaderboard **does** refresh; it refetches all logs and still dedupes to the future-dated one.
- **Realtime** — a `wod_logs` postgres-changes subscription also calls `fetchClasament` on INSERT.
- **Identity** — the new log's `wod_id` (`2ed71d47`), `workout_section_id` (`98f62722`, the current metcon), and `variant_level` (`RX`) all match. No identity mismatch.

### Journal vs Leaderboard
| | Journal (`fetchWodLogs`) | Leaderboard (`fetchClasament`) |
|---|---|---|
| filter | `.eq('member_id', user.id)` | `.eq('wod_id', wodZi.id)` (all members) |
| dedup | **none** — every log rendered | **per-member, `max(logged_at)`** |
| order | `.order('logged_at', desc)` | none |

→ Journal shows the new log (no dedup); Leaderboard's `max(logged_at)` dedup keeps the
future-dated legacy log.

## §4. Root-cause classification

**B — NEW LOG HAS OLDER / NON-MONOTONIC `logged_at`.** `dateWithCurrentTime` can produce a
future `logged_at`; the leaderboard's `max(logged_at)` per-member dedup then permanently
prefers it. Compounded by **H (tie / non-deterministic order)** — the dedup used a bare `>`
with no tie-break and the query has no `ORDER BY`, so a `logged_at` tie was resolved by
whatever order the DB returned rows in.

## §5. State changed mid-audit

Between the first and second forensic query (~10 min), the owner **deleted 5 of the 6 test
logs** from their own Journal (`× → deleteWod`, `wod_logs.delete().eq('id', id)`). Only
`2d6a279d` (150, structured) remains; the Leaderboard now shows it correctly with the
INC-08 `Round 1…5` projection. The specific incident data is gone, but the **root cause is
real and reproducible** (any future-dated `logged_at` recreates it).

## §6. Minimal fix

### `src/utils.js`
**`dateWithCurrentTime` — never return a future timestamp:**
```js
const at = new Date(y, m-1, d, now.getHours(), ...)
return (at.getTime() > now.getTime() ? now : at).toISOString()
```
- Past / today workout → `at <= now` → **unchanged** (business-date attribution preserved).
- Future workout logged early → returns `now()` (the real submission moment). `logged_at`
  is henceforth **never in the future**, so the dedup can't be poisoned going forward.
- Leaderboard **membership** uses `wod_id` (unaffected). The only behaviour change is
  Journal day-grouping for the rare "log a future workout ≥1 day early" case — it now shows
  under the submission day rather than the (still future) workout day.

**`+ logIsMoreRecent(candidate, current)`** — one shared, deterministic "which log is the
more recent submission": compare `logged_at` (ms), tie-break on `id` (stable across
refetches regardless of DB row order). **Score is never a factor** — the contract stays
*latest submission*, not *best result* (§2 / §28).

### `src/App.jsx` (`Clasament`)
The three `new Date(x.logged_at) > new Date(y.logged_at)` selections now call
`logIsMoreRecent`:
- `dedupLogsGlobal` (~2088) — per-member canonical row (primary section).
- `sortFormatFor` (~2101) — representative log for frozen-format resolution.
- `buildBlocksForAdditionalSection` `repAdd` (~2160) — same, for additional scored sections.

**No query change, no realtime change, no refresh change** (the audit proved those already
work). No ranking change. No scoring change. No `logged_at` semantics redesign — only the
future-timestamp bug is corrected.

## §7. Contract after fix

**One member row on the Leaderboard = that member's LATEST submission for that
workout/section**, chosen deterministically by `logged_at` (never future) then `id`. The
row's score, variant, sets, snapshot and expanded detail all come from **that same log**.
INC-08 structured projection applies when that log is structured; INC-08A legacy flat
rendering applies when it is legacy (P10).

## §8. Files changed
- `src/utils.js` — `dateWithCurrentTime` cap-at-now; `+ logIsMoreRecent`.
- `src/App.jsx` — 3 `Clasament` latest-log selections → `logIsMoreRecent`.
- `src/utils.test.js` — `+ 3` `dateWithCurrentTime` cases, `+ 6` `logIsMoreRecent` cases.

## §9. DB impact
**0 schema · 0 migrations · 0 backfills · 0 `wod_logs` mutations · 0 manual production
data edits.** The owner's own deletion of their test logs (§5) is not part of this fix.

## §10. Tests
`src/utils.test.js`:
- `dateWithCurrentTime`: past workout unchanged (existing) · today's workout ≈ now · future
  workout logged early → `<= now`, real submission moment.
- `logIsMoreRecent`: null current; later `logged_at` wins; **score not a factor** (lower
  newer wins); ms tie → deterministic `id` tie-break, order-independent; unordered `reduce`
  converges; incident shape.

## §11. Regression
- Full `vitest run` — **1699 passed** / 9 pre-existing Deno `@std/assert` failures
  (unchanged baseline).
- `appHookOrderIntegrity` 3 · `eslint src/App.jsx src/utils.js` **0 errors** (11 pre-existing
  unused-disable warnings) · `vite build` clean.
- INC-08 (`inc08StructuredIntervalResultProjection` 21) · INC-07 (32) · INC-06 (38) ·
  INC-04 (`homeWorkoutResponseIsCurrent` + `inc04HomeDateSelectionRace`) · P10 · P9.5.7 (41)
  · P9.5.6 · P9.5.8 · P9.5.8.1 — all pass, untouched.

## §12. Production smoke
_Recorded at deploy._ The original incident data was deleted by the owner mid-audit (§5);
the exact "new log not surfacing" flow cannot be re-reproduced without re-creating a
future-dated `logged_at` (which the fix now prevents). Post-deploy smoke = boot + the
current single log renders correctly (structured, `Round 1…5`) + a legacy result still
renders flat.

## §13. Remaining limitations / observations
1. **Additional scored sections have no per-member dedup** (`buildBlocksForAdditionalSection`
   renders one row per log, not per member) — pre-existing, unrelated to INC-09, possibly
   intentional for section boards. Not changed.
2. **No `created_at` on `wod_logs`.** `logged_at` remains the only timestamp and still
   serves dual duty (business-date attribution + recency). The cap-at-now fix makes it
   monotonic for the common case (log on/after the workout day). A future ticket could add
   a `created_at timestamptz default now()` column for an unambiguous submission timestamp —
   **schema change, owner decision, out of scope here.**
3. **Existing future-dated logs are not repaired.** Any `wod_logs` row already carrying a
   future `logged_at` (only ever the owner's own INC-06/07-era test data on this one
   workout) keeps it. Repairing them is a historical timestamp mutation — owner decision.

## §14. Adjacent phase status
INC-08 GREEN · INC-08A GREEN · INC-07 GREEN · INC-06 GREEN · INC-04 GREEN · P10 GREEN ·
P9.5.6 GREEN · P9.5.7 GREEN · P9.5.8 GREEN · P9.5.8.1 GREEN — all untouched.

## §15. INC-09 final status
**CLOSED** on merge + green boot/legacy/structured production smoke.

## §16. No workout-id / date / movement-name hardcode. No unrelated phase started.
