# INC-08 — Structured Interval Result Detail / Leaderboard Projection

**Date:** 2026-09-01
**Status:** SHIPPED.
**Repo:** `WOD-SIMPLE` only. Projection (read) only. **ZERO schema / migration / backfill /
`wod_logs` mutation.**
**Adjacent:** INC-07 / INC-06 / P10 / P9.5.7 / P9.5.6 / P9.5.8 / P9.5.8.1 / INC-04 — untouched, all GREEN.

---

## §A. Incident

INC-07 shipped structured interval semantics (Home / Logger / Builder correct). But
**Leaderboard → member → Result Detail** (and the Journal card) still rendered:

```
Rundă 1   23 reps
Rundă 2   4 reps
…
Rundă 15  1 reps
```

Those 15 rows are **score entries** (`5 rounds × 3 stations`), not 15 semantic rounds.

## §B. Root cause

`parseWodLogDetails` (`App.jsx` ~5711) builds `wSetsParti` by mapping **every
`wod_logs.sets` entry 1:1** to a display row, with the raw `sets` key as the label:

```js
const wSetsParti = Object.entries(w.sets).map(([cheie, seturi]) => ({ cheie, seturiTxt: … }))
```

It has no concept of structured-interval round grouping. Both result-detail surfaces —
the **leaderboard expanded card** (`App.jsx` ~2456) and the **Journal card** (~6220) —
render `wSetsParti.map(p => <div>{p.cheie}</div><div>{p.seturiTxt}</div>)`. For a
structured-interval log the 15 `intervalStationKey` entries
(`"Rundă 1 · 1. Max.reps: Handstand Push-up"`, …) render as 15 flat rows.

## §C. Frozen-evidence audit (§6 / §46 — read-only)

`wods 2ed71d47` has **3** `wod_logs` (member `97a4e88a`, RX, section `98f62722`, all
`result`/`time_result` null — family `sets`):

| log id | `format_config_snapshot` | `sets` keys | verdict |
|---|---|---|---|
| `2d6a279d` | `{workSec:40, restSec:20, rounds:15, **roundCount:5, stationMode:'per-interval', restPlacement:'after-each-station'**}` | 15 × `"Rundă {r} · {s}. {name}"` (round-major, `intervalStationKey`) | **STRUCTURED — frozen evidence present.** Logged through the INC-07 structured logger. Has `prescription_snapshot`, no `performed_prescription`, `movements_snapshot` = 3 station names. |
| `f8b25935` | `{restSec:20, rounds:15, workSec:40}` — **no roundCount / no stationMode** | 15 × `"Rundă 1".."Rundă 15"` (flat) | **LEGACY** (pre-INC-07 test log). §8 → stays flat, never reinterpreted. |
| `5f7a177c` | `{restSec:20, rounds:15, workSec:40}` | 15 × `"Rundă 1".."Rundă 15"` (flat) | **LEGACY** — same. |

So: **structured logs created after INC-07 DO freeze `roundCount` / `stationMode` /
`restPlacement` / `workSec` / `restSec` inside `format_config_snapshot`** (the
`snapshot_wod_log_context()` trigger copies the whole `w.format_config`). P10 provenance is
intact (§45). The one structured log (`2d6a279d`) has sufficient frozen evidence → **§6 YES,
proceed**. The two legacy logs stay legacy — **no `15 ÷ 3 = 5`**.

## §D. Generic structured resolver — `src/resultIntervalStructure.js` (new, pure)

**`resolveStructuredIntervalResult(log)`** — takes the log ONLY (arity 1, no workout
argument; P10). Returns `null` (caller keeps the flat `wSetsParti` rendering) unless **all**
of:
- `getFormat(log.format_snapshot).rowMode === 'interval'`,
- `log.format_config_snapshot.stationMode === 'per-interval'`,
- `parseInt(log.format_config_snapshot.roundCount) > 0`,
- ≥1 `sets` key parses as `intervalStationKey` (`/^Rundă (\d+) · (\d+)\. (.*)$/`).

Then it rebuilds:
```
{ structured:true, roundCount, stationCount, stationLabels,
  rounds: [ { roundIndex, stations: [ { stationIndex, label, reps: string|null } ] } ],
  expectedScoreEntryCount, actualScoreEntryCount, extraEntries }
```
- **`roundCount`** — from `format_config_snapshot.roundCount` (frozen). Never `sets.length`.
- **`stationCount`** — `max(stationIndex)` across the parsed frozen keys. Never assumed.
- **Station identity** — the `(roundIndex, stationIndex)` pair from the key. Repeated
  movements stay distinct by `stationIndex` (§14/§33). **`label`** — the frozen name part of
  the key, positionally (`stationLabels[stationIndex-1]`).
- **Round-major mapping** — `byKey.get(\`${r}:${s}\`)`; iterates `1..roundCount` ×
  `1..stationCount`.
- **Partial** (§18/§34) — a slot with no entry → `reps: null` → rendered `—`. **Never
  fabricated `0`.**
- **`0` reps** (§35) — `repsOf` treats only `'' / null / undefined` as "not logged"; `'0'`
  and `0` are real values → `reps: '0'`.
- **Extra entries** (§43/§44) — keys whose `roundIndex` is outside `[1..roundCount]` go into
  `extraEntries` and are **never** rendered as rounds (conservative; surfaced, not silently
  mapped).

**`parseIntervalStationKey(key)`** exported too (mirrors `workoutFormats.intervalStationKey`).

## §E. Wiring — `App.jsx`

- `parseWodLogDetails` → `+ intervalResult = resolveStructuredIntervalResult(w)` in its
  return; `+` suppresses the "N sets" count line (`rezultatBucati`) when structured.
- New shared component **`IntervalResultRounds({ intervalResult, t })`** — R round groups
  (`t.logIntervalRoundLabel(n)`), each with S station rows (`label` ⟷ `reps`). Same Forge
  text hierarchy as the flat version (bold round label / muted station line). **No icons, no
  redesign.**
- **Leaderboard expanded card** (~2456) and **Journal card** (~6220):
  `{intervalResult ? <IntervalResultRounds …/> : wSetsParti.map(…)}`.

## §F. Surfaces NOT affected

- **`forge-admin-web` `ScoreDisplay`** — renders `resultPieces` (aggregate) + movement lines
  only; **never** `setsParts` per-round breakdown. Unchanged.
- **Share popup** (`WorkoutSharePopup`) — aggregate `result`/`timeResult` + `movements.join`
  only; no per-round `sets`. Unchanged.
- **Home / Logger / Builder** (INC-07) — regression only, no change.
- **`cardMovementLines`** (P9.5.7 top movement summary) — unchanged; the fix is only the
  score breakdown below it (§22).

## §G. Score / ranking (§23 / §24 / §65)

Untouched. `computeSetsScore` / `setsScoreText` sum `Object.values(sets).flat()` — fully
key-agnostic → Total Reps identical. The `showSetsScoreAtEnd` block, `resolveResultProvenance`,
`resultCompositionModified`, RX/Modified classification, sort, ties — none touched.

## §H. Files changed
- `src/resultIntervalStructure.js` — **new** pure module.
- `src/App.jsx` — import + `parseWodLogDetails.intervalResult` + `IntervalResultRounds` +
  2 render-site branches + suppress "N sets" for structured.
- `src/inc08StructuredIntervalResultProjection.test.js` — **new**, 21 tests.

## §I. DB impact
**0 schema · 0 migrations · 0 backfills · 0 `wod_logs` mutations · 0 production-data
mutations.** Projection-only.

## §J. Tests
`src/inc08StructuredIntervalResultProjection.test.js` (21): key round-trip; 5×3 (5 groups,
3 stations, 15 entries, NOT 15 rounds); round-major value placement + Total-Reps sum match;
4×2 / 6×4 / 5×1; repeated-movement distinct-by-index; partial (7 logged / 8 null, no fake 0);
0-reps is real; extra-entries surfaced not rendered; legacy Intervals / legacy Tabata /
non-interval / structured-snapshot-but-flat-keys → null; null log → null; **P10** (arity 1 —
log only, no workout arg; frozen roundCount 4 wins; frozen station name survives WOD change);
variant (Intermediate stations); no-hardcode source scan.

## §K. Regression
- Full `vitest run` — **1691 passed** / 9 pre-existing Deno `@std/assert` failures (unchanged
  baseline).
- `appHookOrderIntegrity` 3 · `eslint` **0 errors** (11 pre-existing unused-disable) · `vite
  build` clean.
- INC-07 (`inc07IntervalStationStructure` 32) · INC-06 (`incFutureIntervalLogging` 38) ·
  P10 (`p10HistoricalResultTruth`) · P9.5.7 (`p957ResultDetailProjection` 41) · P9.5.6 ·
  P9.5.8 · P9.5.8.1 · INC-04 — all pass, untouched.

## §L. Production smoke (verified LIVE 2026-09-01, owner account, `forge-delta-ivory.vercel.app`)

- **Commit** `60dc2c9` · **bundle** `dist/assets/index-*.js` (station-key regex present) ·
  **app_version** `structured-interval-result-projection-inc08-20260901`.
- **STRUCTURED (§63) — PASSED.** Journal → the structured Intervals log (frozen
  `roundCount:5` + `stationMode:'per-interval'`, 15 `intervalStationKey` `sets`) renders:
  **Round 1 … Round 5** (5 semantic groups), each with **3 station rows**
  (`Max.reps: Handstand Push-up` / `Max.reps: Renegade Row @ 17.5 kg` / `Max.reps: Shuttle
  run`, in order, `10 reps` each), **15 score values, 0 Rest rows, no Round 6–15**.
  Prescription (`@ 17.5 kg`) shown. Native Forge styling, no icons.
- **LEGACY (§64) — PASSED.** The two legacy Intervals logs on the same workout
  (`format_config_snapshot` without `stationMode`, flat `"Rundă 1".."Rundă 15"` keys) still
  render **15 flat `Rundă N` rows** — in the Journal AND in the Leaderboard expanded card.
  **Not reinterpreted as 5×3** (§8 / §37).
- **Leaderboard ranking** unchanged (single RX participant, `203 reps` — the aggregate is
  computed the same key-agnostic way).
- **Console:** app-error free across Leaderboard expand + Journal (structured + 2 legacy).
- The Leaderboard's own row currently dedupes to the latest (legacy) log; the structured
  branch there shares the exact `parseWodLogDetails` path proven live in the Journal.

## §M. Remaining limitations
1. The `"Max.reps:"` prefix on the incident's frozen station labels (a pre-INC-06 AI-parse
   artifact, baked into the `sets` keys at log time) is shown as-is. Out of INC-08 scope
   (frozen log data; a cleaner label source — `movements_snapshot` / `prescription_snapshot`
   per P9.5.7 precedence — is a possible follow-up).
2. The **two legacy logs** (`f8b25935`, `5f7a177c`) still render 15 flat `"Rundă N"` rows —
   correct for their frozen legacy model (§8 / §37). No remediation without owner-authorised
   snapshot edits (out of scope, §55).
3. `stationCount` is derived from the frozen keys' `max(stationIndex)`, not from a frozen
   `stationCount` field (the contract has none). Safe: the keys are round-major and complete
   for any log written by the INC-07 logger.

## §N. Adjacent phase status
INC-07 GREEN · INC-06 GREEN · P10 GREEN · P9.5.7 GREEN · P9.5.6 GREEN · P9.5.8 GREEN ·
P9.5.8.1 GREEN · INC-04 GREEN — all untouched.

## §O. INC-08 final status
**CLOSED** on merge + green production result-detail smoke.

## §P. No workout-id hardcode · no movement-name hardcode · no unrelated phase started.
