# Forge — Leaderboard Finish-Time Inconsistency Investigation

**Status:** Investigation complete. No code, schema, or data changed.
**Scope:** WOD-SIMPLE (PWA, the only write path for `wod_logs`) + forge-admin-web (read-only consumer, faithful port).
**Method:** Full pipeline trace (write UI → composition → insert → rank → render) in both repos, plus a live, read-only query against Forge Production (`sdfkvfbvgpuspnnnwqwk`) to find real same-workout examples. No writes, migrations, or backfills were executed.

---

## 1. Executive Summary

This is **a write-path bug (Class A), not a UI/rendering bug and not a ranking bug.**

For the three scored formats whose score can be *either* a finish time *or* a partial-rounds count on the same log — **RFT**, **For Time** with `structure: 'Repeated Rounds'`, and **Partner WOD** (For Time base with `rounds` configured) — the logging form (`FormatLogger.jsx`) shows the Time input and the "Runde complete" (rounds-completed) input **simultaneously, with no mutual exclusivity**. The save logic (`composeWodLogFields` in `src/App.jsx`) resolves the ambiguity by giving the rounds-completed field unconditional priority: if it is non-empty, the entered time is **silently discarded and never written to the database**, regardless of whether the member also correctly filled in the Time fields.

The leaderboard ranking and rendering logic — in both WOD-SIMPLE's `Clasament` and forge-admin-web's `ranking.ts`/`ScoreDisplay` (a diff-verified, behaviorally identical port) — is **correct** given the data it receives: it consistently shows `time_result` when present, falls back to `result` (the rounds/reps text) when not, and ranks finishers (has `time_result`) strictly above non-finishers. There is no cross-client drift and no query/normalization bug.

The member-visible symptom — "some members show a finish time, others on the exact same workout don't" — is real, but the underlying cause is **data loss at write time**, not a display decision. A live query against production confirms the exact fingerprint this bug predicts (Section 5).

**Secondary, lower-severity finding**: the PWA's per-section "⏱ for time" / "🔄 AMRAP" leaderboard badge is derived by majority-vote on which rows happen to have `time_result` vs `result`, not from the workout's actual configured format — so a For Time/RFT day with a lot of non-finishers can be mislabeled "AMRAP" in the section header. This is a genuine display bug but is independent of the missing-time bug and does not hide anyone's score.

---

## 2. Exact Root Cause

**File:** `WOD-SIMPLE/src/App.jsx`, function `composeWodLogFields` (~line 7678), specifically the `useReps` calculation (~line 7726) and the returned `time_result` field (~line 7759).

```js
const isSequential = isSequentialFormat(activeLogFormatId, activeLogFormatConfig)
const useReps = isSequential
  ? !wodTime.trim()
  : (format.scoreMode === 'amrap'
    || (format.family === 'mixed' && activeLogFormatConfig?.mainFormat === 'AMRAP')
    || (format.scoreMode === 'fortime_or_amrap' && wodRoundsCompleted.trim() !== ''))
...
return {
  result: rezultatFinal || null,
  time_result: useReps ? null : (wodTime.trim() || null),   // <-- time is nulled here
  ...
}
```

For **RFT / For Time (Repeated Rounds) / Partner WOD**, `useReps` is `true` whenever `wodRoundsCompleted` (the "Runde complete" field) is non-empty — **independent of `wodTime`**. If a member fills in both the Time fields *and* the Runde-complete field, `useReps` is `true`, so `time_result` is written as `null`, discarding the entered time. `result` is instead composed from `composeAmrapResult(wodRoundsCompleted, wodPartialReps, movements)` (~`workoutFormats.js:369`), which for a full-rounds entry with no partial reps produces literally `"5 runde complete"` — textually indistinguishable from what a genuine finisher would see, but with no time attached.

**Root UI cause:** `FormatLogger.jsx`, `ScoredFields`, the `fortime_or_amrap` branch (~line 171–203). For non-sequential formats (RFT/Partner WOD/For Time-Repeated-Rounds), `TimeResultFields` (min/sec inputs) and `RoundsPartialFields` (rounds-completed + partial-reps inputs) are **both always rendered, stacked in the same form**, distinguished only by an 11px gray hint line:

> *"Dacă nu ai terminat în time cap, completează în loc runde + reps parțiale"* ("If you didn't finish in the time cap, fill in rounds + partial reps **instead**")

Nothing in the UI enforces "instead" — no mutual exclusivity, no disabling, no single toggle ("Did you finish?"). The "Runde complete" field's own label is the generic `t.logWodRoundsCompletedLabel` ("Runde complete"), with no inline qualifier reminding the member it's only for non-finishers. A member who finished and, out of habit or to be thorough, also types their round count into that box (a very natural action — it *is* literally true that they completed 5 rounds) loses their time.

**Contrast with the sequential formats** (For Time-Sequence, Chipper, Ladder): for these, `useReps = !wodTime.trim()` — presence of partial-reps entries does **not** override a filled Time field. Only the non-sequential `fortime_or_amrap` branch has this asymmetric, rounds-field-wins priority. This is why the bug is scoped to RFT/For Time(Repeated Rounds)/Partner WOD and does not affect Chipper/Ladder/plain-sequence For Time.

---

## 3. Current Score Model (as actually implemented, live)

`wod_logs` (confirmed live via `information_schema.columns` against Forge Production, 2026-08-14):

| Column | Type | Meaning |
|---|---|---|
| `result` | text | Free-form or auto-composed score text: partial reps, rounds+partial, AMRAP rounds+reps, or auto "N runde complete" |
| `time_result` | text | Elapsed/finish time, `"MM:SS"` or `"H:MM:SS"` text. **Presence of this field is the sole signal the entire pipeline uses to mean "this member finished."** |
| `sets` | jsonb | Per-row `{reps, weight}` structured data — `family: 'sets'` formats only (EMOM, Tabata, Intervals, Death By, Weightlifting, Strength Sets, Build to Heavy/1RM, Complex, Superset) |
| `log_meta` | jsonb | `{completed}` for `nft`; `{stages, totalReps}` for `chained` (Chained AMRAP) |
| `weight_logged` | text | Single-movement weight, used by `rxEngine.js` for RX/Not-RX classification |

**There is no `capped` / `is_completed` / `reps_remaining` column anywhere in the schema.** "Completed vs. capped" is **entirely implicit**, derived at read time from whether `time_result` is null:

```js
const finished = (log) => !!log.time_result   // App.jsx:1781, ranking.ts:148 (identical)
```

This is a deliberate, existing architectural choice (documented in code comments as intentional, not accidental) and is not, by itself, the bug — a boolean "capped" flag would be redundant with `time_result` presence *if* `time_result` were always written correctly. The bug is that the one signal this whole model depends on can be silently zeroed by the write path described in Section 2.

**Format-family semantics** (`workoutFormats.js`), confirmed exhaustively:
- `family: 'scored'`, `scoreMode: 'amrap'` (AMRAP, Ascending AMRAP) — **no time_result concept**. Score is rounds+reps only. No time field exists in the UI for these. Not affected.
- `family: 'scored'`, `scoreMode: 'fortime_or_amrap'` — RFT, For Time, Partner WOD. `sequentialPartial: true` on For Time/Chipper/Ladder marks the "unique sequence, not repeated rounds" sub-case.
- `family: 'sets'` (EMOM, Tabata, Intervals, Death By, Weightlifting, Strength Sets, Build to Heavy/1RM, Complex, Superset) — **no `time_result`/`result` at all**, ever (`composeWodLogFields` returns both `null` for this family by design). Score lives entirely in `sets`. Finish time legitimately does not exist for these formats — this is correct, not a bug.
- `family: 'mixed'` (Buy-In/Cash-Out, AMRAP with Buy-In) — sets + scored + sets; `mainFormat: 'AMRAP'` forces `useReps = true` unconditionally (no time). `mainFormat: 'For Time'` was not exercised in the production sample found and should be checked before shipping a fix (see Section 7).
- `family: 'chained'` (Chained AMRAP) — always `result: null, time_result: null`; real score is `log_meta.totalReps`. Time-based stages are explicitly out of scope by the format's own design comment. Not affected.
- `family: 'nft'` (Not For Time) — `log_meta.completed` boolean only, no score. Not affected, has no leaderboard concept.

---

## 4. Pipeline Trace

```
FormatLogger.jsx (ScoredFields, fortime_or_amrap branch)
  → member sees BOTH TimeResultFields (min/sec) AND RoundsPartialFields
    (rounds-completed + partial reps), simultaneously, no exclusivity
  → onChange patches local state: wodTime, wodRoundsCompleted, wodPartialReps

App.jsx saveWodLog()
  → composeWodLogFields()
      useReps = (scoreMode === 'fortime_or_amrap' && wodRoundsCompleted.trim() !== '')
                 ← time presence NOT checked here
      time_result = useReps ? null : (wodTime.trim() || null)   ← BUG: real time dropped
      result      = useReps ? composeAmrapResult(...) : (composeFinishedRoundsText(rounds) ?? wodResult)
  → supabase.from('wod_logs').insert({ ...composeWodLogFields(), ... })   (App.jsx:7839)
  → row lands in Postgres exactly as composed — no further transformation,
    no trigger touches result/time_result (confirmed: no migration defines
    a trigger on these columns)

Clasament (App.jsx ~1632-2062, PWA leaderboard) / LeaderboardPage → buildLeaderboard
  → sortLogs / rankResultsForWorkout: finished(log) = !!log.time_result
    (App.jsx:1781, ranking.ts:148 — identical semantics, diff-verified port)
  → headline score: log.time_result || log.result || '—'  (App.jsx:2002)
  → ScoreDisplay (forge-admin-web): resultPieces = [result, time_result, ...].filter(Boolean).join(' · ')

Member/coach sees: no time, "5 runde complete" text, ranked below every real finisher,
tie-broken only by logged_at among other data-loss victims.
```

No transformation between DB and screen drops or hides a `time_result` value that actually exists — every layer downstream of the insert was checked and found to correctly propagate whatever the write path gave it. **The value never reached the database in the first place.**

---

## 5. A vs. B Comparison (live production data, anonymized)

Query (read-only, `supabase db query --linked`) against `wod_logs` joined to `wods` for `type in ('For Time','RFT','Chipper','Ladder','Partner WOD')`, grouped by workout, filtered to workouts with a real mix of finish-time-present vs. finish-time-absent logs. Five such workouts were found immediately; the top one:

**Workout:** one RFT, `rounds: 5`, no time cap configured (`format_config.timeCapSec: null`), 14 total logs, all `variant_level` mostly `RX`.

| Member (anon.) | `time_result` | `result` | Interpretation |
|---|---|---|---|
| A | `23:34` | `5 runde complete` | Genuine finisher — both fields correct |
| B | `18:10` | `5 runde complete` | Genuine finisher |
| C | `17:43` | `5 runde complete` | Genuine finisher |
| D | `null` | `5 runde complete` | **Suspect** — text claims all 5 rounds done, no time |
| E | `null` | `5 runde complete` | **Suspect** |
| F | `null` | `5 runde complete` | **Suspect** |
| G | `null` | `5 runde complete` | **Suspect** |
| H | `null` | `5 runde complete` | **Suspect** |
| I | `null` | `4 runde complete` | Plausibly a genuine non-finisher (stopped exactly at end of round 4) |
| J | `null` | `4 runde complete` | Plausibly genuine |
| … | `null` | `5 runde complete` | **Suspect** (9 of 11 no-time rows read "5 runde complete" for a 5-round RFT) |

**Why rows D–H (and the other "5 runde complete, no time" rows) are the fingerprint of this exact bug, not legitimate DNFs:** for a Rounds-For-Time format, once you complete the last rep of the last prescribed round, you are by definition finished — there is no such thing as "completed all 5 of 5 rounds but did not finish." A `result` of `"5 runde complete"` is only reachable two ways: (a) the auto-compose path taken when a finisher leaves the rounds-completed field empty and the app derives the text from `config.rounds` (the intended finisher path — see `composeFinishedRoundsText`), or (b) a member manually types `5` into the rounds-completed box, which — per Section 2 — takes unconditional priority and zeroes `time_result` even if a real time was also entered. **9 of 11 non-finishers on this one workout show this exact, structurally-impossible-as-a-DNF pattern.** Two rows (I, J) show `4 runde complete`, which *is* a coherent DNF (stopped cleanly at the round boundary) and are not flagged as suspect.

This pattern repeated, at a glance, across the other four workouts the same query surfaced (all RFT/Partner WOD, all with a `with_time : without_time` ratio skewed heavily toward "without," e.g. 3:11, 4:10, 4:9, 1:10, 6:4) — consistent with a systemic write-path issue rather than isolated user error, though the investigation did not exhaustively re-derive every row across all five.

---

## 6. Impact Assessment

| Area | Affected? | Detail |
|---|---|---|
| **Display only** | No | The bug is upstream of display; rendering is correct given its input. |
| **Stored results** | **Yes** | Real, member-entered finish times are permanently lost at insert time — unrecoverable (the member has left the gym; there is no raw-input log to replay). |
| **Ranking** | **Yes, indirectly** | Ranking logic itself is correct, but it operates on corrupted input: genuine finishers who hit this bug are ranked as non-finishers (below every real finisher) and, among each other, ordered by arbitrary logged_at rather than performance. |
| **RX validation** | No | `weight_logged`/`rxEngine.js` classification is independent of `time_result`/`result`; not touched by this bug. |
| **Categories / variant tiers** | No | `variant_level` is set at a different point in `saveWodLog`, unaffected. |
| **Historical data** | **Yes** | Every past RFT/For Time(Repeated Rounds)/Partner WOD log where a member filled both fields is silently affected already, going back to whenever this scoring UI shipped — not a new regression from a recent change. |
| **Analytics** (Results Phase 2 Slice 3/5: PR events, performance summaries) | Likely, not directly investigated | PR-event evaluation for For Time/AMRAP (`evaluate_benchmark_pr`, per memory) reads `time_result`; a lost time on a genuinely-fast performance could suppress a PR detection. Flagged as needing a follow-up check, not confirmed in this pass. |

---

## 7. Scope

**Confirmed affected:** RFT (always), For Time with `config.structure === 'Repeated Rounds'`, Partner WOD with `baseFormat: 'For Time'` and `rounds` configured. These are exactly the formats that are (a) non-sequential and (b) `scoreMode: 'fortime_or_amrap'`.

**Confirmed NOT affected:**
- For Time (default `structure: 'Sequence'`), Chipper, Ladder — `sequentialPartial: true` formats use `useReps = !wodTime.trim()`, so a filled Time field is never overridden by partial-reps entries.
- AMRAP, Ascending AMRAP — no time concept, by design.
- `sets` family (EMOM, Tabata, Intervals, Death By, Weightlifting, Strength Sets, Build to Heavy/1RM, Complex, Superset) — no time concept, by design.
- Chained AMRAP — time-based stages explicitly out of scope by the format's own design.
- Not For Time — no score/time concept.

**Needs a follow-up check before a fix ships:** `Buy-In/Cash-Out` with `mainFormat: 'For Time'` — not exercised in the production sample examined, and `composeWodLogFields`'s `mixed` handling was not fully traced against this specific sub-case in this pass.

---

## 8. Recommended Fix (proposed only — NOT implemented)

Smallest architecturally-correct change, staying inside the existing implicit-completion model (no new column, no migration):

1. **Enforce mutual exclusivity in the write logic**, not just the UI hint: in `composeWodLogFields`, for the `fortime_or_amrap` non-sequential branch, prioritize a non-empty `wodTime` over a non-empty `wodRoundsCompleted` — i.e. flip the precedence so an entered time is never discarded:
   ```js
   const useReps = ...(format.scoreMode === 'fortime_or_amrap' && wodRoundsCompleted.trim() !== '' && !wodTime.trim())
   ```
   This alone fixes the silent data loss without touching the schema, ranking, or rendering.
2. **Make the UI mutually exclusive**, not just hinted: when `wodTime` has a value, visually disable/collapse `RoundsPartialFields` (and vice versa), so a member physically cannot fill both — turns "silently discarded" into "impossible to enter," which is the more durable fix and prevents the next variant of the same ambiguity.
3. Extend the same precedence fix to `Partner WOD` and `For Time (Repeated Rounds)`, since they share the exact same `ScoredFields` branch.
4. Explicitly verify (not assume) `Buy-In/Cash-Out` with `mainFormat: 'For Time'` is either unaffected or covered by the same fix.

Explicitly **not** recommended: adding a stored `capped`/`is_completed` boolean column. The implicit `!!time_result` model is otherwise working correctly end-to-end (ranking, both clients' rendering) once the write path stops corrupting its one input signal — introducing a second, parallel "completion" concept would be new complexity solving a problem the fix in (1)/(2) already solves.

---

## 9. Regression Test Plan

None of the following exist today — `composeWodLogFields` and `useReps` live as an untested local closure inside `App.jsx` (no `App.test.jsx` exists at all), and `FormatLogger.test.jsx` has no case exercising the `fortime_or_amrap` non-sequential branch's field-priority behavior.

Required before/with the fix:
1. **Unit test** (extract `composeWodLogFields`'s core precedence logic to a pure, testable function first, mirroring how `wodDateFirst.js` was recently extracted for testability): given RFT/`rounds:5` config, `wodTime: '17:34'` AND `wodRoundsCompleted: '5'` both set → asserts `time_result === '17:34'` and `result` reflects the finish (not silently `null`ing time).
2. **Unit test**: same config, only `wodRoundsCompleted: '4'` (no time) → asserts `time_result === null`, `result === '4 runde complete'` (genuine DNF path, must keep working).
3. **Unit test**: same config, only `wodTime` set, `wodRoundsCompleted` empty → asserts existing finisher path unchanged (`composeFinishedRoundsText`).
4. **Component test** (`FormatLogger.test.jsx`): fortime_or_amrap non-sequential branch — filling the Time input disables/clears the rounds-completed input (or equivalent UI enforcement), and vice versa.
5. **Ranking regression** (`ranking.test.ts` / equivalent PWA test): a synthetic entries array with one log having both `result` text implying full completion and `time_result: null` should NOT be reachable from real input anymore — this is more a write-path guard than a ranking test, since ranking.ts correctly handles this shape today by design (ranks it as non-finished); the fix is upstream.
6. **Data audit query** (one-off, not a code test): the query used in Section 5 above, to size the actual number of historically-affected rows across all gyms before deciding on Section 10.

---

## 10. Data Remediation

**No backfill or migration was executed in this investigation**, per the mission's explicit constraint.

Recommendation: **no automatic backfill is possible** — the member's actual finish time was never captured anywhere (not in `notes`, not in any other column); it is genuinely lost, not merely hidden. The only options are:
- **No action** (accept historical loss, fix forward only) — recommended default, since there is no source of truth to recover from.
- **Rendering compatibility**: none needed — existing rows with `result: "N runde complete"` and `time_result: null` already render and rank exactly as the current implicit model intends (as a non-finisher); the fix does not require reinterpreting old rows differently.
- Optionally, a **read-only coach-facing audit** (the Section 5 query, run gym-by-gym) to identify which specific historical entries are likely affected, so a coach who remembers the actual clock time from that day could manually re-enter it via the existing edit-log flow — a manual, human-verified correction, not an automated backfill guessing at lost data.

---

## Severity: **P1**

Materially incorrect score representation and ranking degradation for a real, non-trivial subset of production data, with **unrecoverable data loss** (borders on P0 in that respect) — but not classified P0 because: the ranking *algorithm* itself is not broken (it correctly ranks whatever data it's given), the corruption is scoped to three specific formats' write path rather than the whole Results pipeline, and it does not corrupt already-correct historical data going forward (each affected row is an independent, one-time loss at the moment of that specific save, not an ongoing silent overwrite of good data). Recommend treating as high-priority for the next fix cycle given the confirmed real-world frequency (majority of non-finisher rows on the sampled RFT workouts show the tell-tale "full rounds text + no time" fingerprint) and the fact every day this ships unfixed adds more unrecoverable losses.

---

## Next Implementation Step (awaiting authorization)

Do not implement yet, per the mission's stop condition. Recommended next step once authorized: implement Section 8 items 1–3 (precedence fix + UI mutual exclusivity) together with the Section 9 test plan, scoped narrowly to `composeWodLogFields` + `ScoredFields`'s `fortime_or_amrap` branch — no schema change, no ranking change, no rendering change in either client.
