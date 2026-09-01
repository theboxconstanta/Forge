# INC-08A — Forensic: production Result Detail still flat after INC-08

**Date:** 2026-09-01
**Mode:** FORENSIC AUDIT ONLY — **zero code, zero data, zero deploy.**
**Verdict:** **Classification A — the owner expanded a LEGACY log. Expected P10 behaviour. INC-08 stays CLOSED (code is correct).**

---

## §1. Incident

Owner opened production Leaderboard → member Result Detail and saw `Rundă 1 … Rundă 15`
(one score per row), score sequence `23, 4, 3, 5, 6, 23, 2, 3, 4, 5, 4, 32, …`.

## §2. The exact production log rendered

The Leaderboard shows **one row per member = the log with the latest `logged_at`**
(`App.jsx:2088`: `if (new Date(log.logged_at) > new Date(curr.logged_at)) byMember[…] = log`).

For member `97a4e88a` on workout `2ed71d47` there are **4** `wod_logs`:

| log id | `logged_at` (Europe/Bucharest) | `format_config_snapshot` | `sets` keys | Total Reps | class |
|---|---|---|---|---|---|
| `2d6a279d` | 09-01 **11:00:11** | `{workSec:40, restSec:20, rounds:15, **roundCount:5, stationMode:'per-interval', restPlacement:'after-each-station'**}` | 15 × `"Rundă {r} · {s}. {name}"` (round-major) | 150 | **STRUCTURED** |
| `4e226ab4` | 09-01 **11:32:17** | same structured object | 15 × `"Rundă {r} · {s}. {name}"` | 399 | **STRUCTURED** |
| `f8b25935` | 09-01 **15:26:05** | `{restSec:20, rounds:15, workSec:40}` — **no roundCount / no stationMode** | 15 × `"Rundă 1".."Rundă 15"` (flat) | 238 | LEGACY |
| `5f7a177c` | 09-01 **18:29:19** | `{restSec:20, rounds:15, workSec:40}` — **no roundCount / no stationMode** | 15 × `"Rundă 1".."Rundă 15"` (flat) | 203 | LEGACY |

**Latest `logged_at` = `5f7a177c` (18:29) → that is the log on the Leaderboard.**

Confirmed three ways:
- The Leaderboard row reads **`203 reps` · `06:29 PM`** = `5f7a177c` (Total Reps 203, 18:29 local).
- The expanded card's movement list shows **`• Renegade Row`** (no `Max.reps:` prefix) =
  `5f7a177c.movements_snapshot[1] === "Renegade Row"` (the other three logs have
  `"Max.reps: Renegade Row"` / `"Max.reps: Dumbbell renegade rows"`).
- Its score sequence `23, 4, 3, 5, 6, 23, 2, 3, …` == `5f7a177c.sets["Rundă 1"..].reps`.

**The owner is viewing `5f7a177c` — a LEGACY log.**

## §3. Why `5f7a177c` renders flat — and why that is correct

`resolveStructuredIntervalResult(log)` (INC-08) returns `null` unless the FROZEN
`log.format_config_snapshot.stationMode === 'per-interval'` **and** `roundCount > 0` **and**
≥1 `sets` key matches the round-major form. `5f7a177c`:
- `format_config_snapshot` (client runtime value, verified — the Leaderboard query is
  `select('*')`, `App.jsx:8535`, so nothing is missing) = `{restSec:20, rounds:15, workSec:40}`.
- `stationMode` = **`undefined`**. → **gate fails → resolver returns `null`.**
- `sets` keys = `"Rundă 1".."Rundă 15"` (flat) — do not match `/^Rundă (\d+) · (\d+)\. (.*)$/`.

→ `parseWodLogDetails.intervalResult = null` → the render branch falls back to
`wSetsParti.map(…)` → 15 flat `Rundă N` rows.

This is **exactly what INC-08 §8 / §11 / §37 and P10 require**: a log with no frozen
`roundCount` / `stationMode` **must not** be reinterpreted as 5×3. `15 ÷ 3 = 5` is
forbidden.

## §4. INC-08 IS working — proven on the SAME session / SAME bundle

On the current production bundle, the Journal (which lists **all** of the member's logs,
not deduped) for the same workout renders — verified by DOM scrape:

- `2d6a279d` and `4e226ab4` (STRUCTURED) → **`Round 1 … Round 5`** (5 semantic groups, 3
  station rows each). `structuredRoundLabels` in the DOM = `["Round 1"…"Round 5", "Round
  1"…"Round 5"]` (2 logs × 5).
- `f8b25935` and `5f7a177c` (LEGACY) → **`Rundă 1 … Rundă 15`** flat. `flatRundaLabels` in
  the DOM = 30 (2 logs × 15).

So the INC-08 branch fires correctly for structured logs and correctly declines for legacy
logs, **on the exact bundle the owner is running.**

## §5. Build / cache — ruled out

| check | value |
|---|---|
| prod `app_version` | `structured-interval-result-projection-inc08-20260901` |
| prod GitHub deployment SHA | `f179de8` (parent `60dc2c9` = INC-08 impl) |
| prod HTML → bundle | `/assets/index-BkpbBIce.js` |
| bundle contains INC-08 station-key regex `Rundă (\d+) · (\d+)` | **yes** |
| **browser session** loaded `<script src>` | `index-BkpbBIce.js` (same) |
| service worker | `sw.js` — `state: activated`, **`waiting: null`, `installing: null`** |
| workbox precache (`workbox-precache-v2-…`) | `index-BkpbBIce.js` + `index-B-muBZ3L.css` (current, no stale entry) |

**No stale bundle, no waiting SW, no CDN mismatch. Classification B / C — ruled out.**
(Note: this is *this* session's device. A different owner device with a not-yet-updated
service worker would show the old bundle — but even the OLD bundle would render `5f7a177c`
flat, because it is a legacy log; and the score values prove the log identity regardless.)

## §6. Why the two legacy logs outrank the two structured ones on the Leaderboard

`saveWodLog` stamps `logged_at = dateWithCurrentTime(workout.date)` — the **workout's date
(`2026-09-01`) with the real wall-clock time** (INC-04-era behaviour). The two legacy logs
were created during INC-06/INC-07 testing (on an earlier calendar day, in the afternoon/
evening) → `logged_at` = `2026-09-01 15:26` / `18:29`. The two real structured logs were
created after the INC-07 fix, late morning → `logged_at` = `2026-09-01 11:00` / `11:32`.
All four carry the same date, so the Leaderboard's `logged_at`-max dedup permanently
surfaces a **legacy afternoon test log** and hides the structured morning ones.

The two legacy logs are the **owner's own test data**. Their `format_config_snapshot` is
legacy because the `snapshot_wod_log_context` trigger fires `BEFORE INSERT OR UPDATE OF
wod_id` and freezes `wods.format_config` **as it was at insert time** — and at that time
(before the INC-07 `format_config` correction) the workout was still legacy
`{rounds:15, workSec:40, restSec:20}`. Their flat `sets` keys were generated by the
pre-INC-07 flat logger.

## §7. Evidence table (§22)

| | value |
|---|---|
| A. exact log id | `5f7a177c-9189-4ab5-ba46-945b4bbf3480` |
| B. structured or legacy | **legacy** |
| C. DB has `roundCount`? | **no** (`format_config_snapshot = {restSec, rounds, workSec}`) |
| D. client object has `roundCount`? | **no** (Leaderboard query is `select('*')` — nothing dropped) |
| E. client `stationMode`? | **undefined** |
| F. `rowMode`? | `'interval'` (derived from `getFormat('Intervals')` — this gate passes; the `stationMode` gate is the one that fails) |
| G. `sets` key format | `"Rundă 1" … "Rundă 15"` (flat) |
| H. resolver called? | **yes** (`parseWodLogDetails` → `resolveStructuredIntervalResult(w)`) |
| I. resolver result | **`null`** — gate `format_config_snapshot.stationMode !== 'per-interval'` |
| J. render branch used | flat `wSetsParti.map(…)` — **correct** |
| K. loaded `app_version` | `structured-interval-result-projection-inc08-20260901` |
| L. loaded bundle hash | `index-BkpbBIce.js` (current INC-08) |
| M. service worker state | active `sw.js`, no waiting/installing, current precache |

## §8. Root-cause classification (§23)

**A. USER OPENED LEGACY LOG — EXPECTED P10 BEHAVIOR.**

Not B (stale cache), not C (deploy mismatch), not D (query missing fields), not E
(detection bug), not F (regex bug), not G (mobile/alternate path — the mobile Journal and
mobile Leaderboard both use the same `parseWodLogDetails` → `IntervalResultRounds` branch,
verified rendering structured logs as `Round 1..5` in the narrow layout).

## §9. Why the prior INC-08 production smoke "passed" (§29)

It **did** test both cases and **did** record this exact situation. The INC-08 report,
§L: *"the Leaderboard's own row currently dedupes to the latest (legacy) log; the
structured branch there shares the exact `parseWodLogDetails` path proven live in the
Journal."* The smoke expanded the Leaderboard row, identified it as legacy
(`5f7a177c`, 203 reps), confirmed it stays flat (§64 legacy smoke), then verified a
STRUCTURED log renders `Round 1..5` **in the Journal** (§63). Both were green. The owner's
INC-08A screenshot is the same legacy Leaderboard row, re-interpreted as a failure.

## §10. Should INC-08 be reopened? (§22)

**No — INC-08 stays CLOSED.** The projection code is correct and verified live for both
structured and legacy logs on the current bundle. There is **no code defect**.

## §11. Minimum "fix" — proposal only (§23, NOT implemented)

There is nothing to fix in the projection. The residual issue is **test-data noise on the
Leaderboard**:

- **Option 1 (owner action, no code):** delete the two legacy test logs (`f8b25935`,
  `5f7a177c`) from the owner's own Journal (× button). The Leaderboard then surfaces
  `4e226ab4` (structured) → `Round 1..5`.
- **Option 2 (separate ticket, if it recurs with real members):** the Leaderboard could
  prefer the member's **best** score rather than the **latest** `logged_at` — but that is a
  ranking-semantics change, out of scope here and unrelated to INC-08.
- **Option 3 (separate ticket):** the `dateWithCurrentTime(workout.date)` `logged_at`
  quirk (a future-dated workout gets logs stamped with today's clock time under tomorrow's
  date) is INC-04-adjacent and could be revisited independently.

**No historical mutation is proposed automatically** (§24). The two legacy logs correctly
carry legacy provenance; rewriting their snapshots to structured would be inventing history
(forbidden, P10 / INC-08 §8).

## §12. Minimum regression test that would have pre-empted the confusion (§30)

An **integration test that asserts the Leaderboard dedup + Result Detail branch for a
member who has BOTH a legacy and a structured log on the same workout** — proving the
Leaderboard shows whichever is latest, and each renders in its correct branch. (Unit
coverage already proves the resolver; the gap was a same-workout multi-log Leaderboard
scenario.) **Not implemented in this task.**

## §13. Final answers

1. INC-08A status: **AUDIT COMPLETE — NOT FIXED (no fix needed).**
2. Production log owner is viewing: `5f7a177c-9189-4ab5-ba46-945b4bbf3480`.
3. Structured or legacy: **legacy.**
4. Exact `format_config_snapshot`: `{"restSec":20,"rounds":15,"workSec":40}`.
5. `rowMode`: `'interval'` (passes); the failing gate is `stationMode`.
6. `sets` key format: `"Rundă 1" … "Rundă 15"` (flat).
7. DB contains `roundCount`? **No.**
8. Frontend runtime object contains `roundCount`? **No.**
9. Resolver invoked? **Yes.**
10. Resolver return: **`null`.**
11. Failing gate: `format_config_snapshot.stationMode !== 'per-interval'` (and flat keys).
12. Render branch: flat `wSetsParti.map(…)` — correct.
13. Mobile different path? **No** — same `parseWodLogDetails` → `IntervalResultRounds` branch.
14. Loaded `app_version`: `structured-interval-result-projection-inc08-20260901`.
15. Loaded bundle hash: `index-BkpbBIce.js`.
16. Expected INC-08 bundle/version: same (`app_version` above, commit `60dc2c9`/`f179de8`).
17. Service worker state: active, no waiting/installing.
18. Cache state: current precache only, no stale asset.
19. Classification: **A.**
20. Why prior smoke passed: it tested both branches and documented the Leaderboard-shows-legacy fact; the structured branch was verified in the Journal.
21. Why owner still sees 15 flat rows: the Leaderboard row is `5f7a177c`, a legacy log; INC-08 correctly renders legacy logs flat (P10).
22. INC-08 CLOSED or REOPENED: **CLOSED.**
23. Minimum fix: **none in code** — delete the owner's two legacy test logs, or (separate ticket) change Leaderboard dedup to best-score.
24. Minimum regression test: same-workout legacy+structured multi-log Leaderboard integration test.
25. DB mutations: **0.**
26. Code changes: **0.**
27. Deployments: **0.**
28. Unrelated changes: **0.**
