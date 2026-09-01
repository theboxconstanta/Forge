# INC-07 — Interval / Station Workout Structure Semantics

**Date:** 2026-09-01
**Status:** audit STOPPED for owner approval → **owner approved** → **IMPLEMENTED + SHIPPED**.
See "IMPLEMENTATION + CLOSURE" at the end for the delivered contract; the audit below is
retained as the root-cause record.
**Repo:** `WOD-SIMPLE`. Client-side + one authorized `format_config` correction. ZERO schema
change, ZERO migration, ZERO `wod_logs` mutation.
**Adjacent phases:** P9.5.6 / P9.5.7 / P9.5.8 / P9.5.8.1 / P10 / INC-06 / INC-04 — untouched, all GREEN.

---

## §A. Incident

Coach programmed today's (2026-09-01) workout as **Intervals — 5 Rounds**, each round three
timed work stations (`:40` HSPU / `:40` Renegade Row @ 17.5 kg / `:40` Shuttle Run) with a
`:20` rest after each. Correct structure: **5 rounds × 3 scoreable stations = 15 scoreable
work intervals**, `5 × 3 × (40 + 20) = 900 s = 15:00`.

Production shows **"15 Rounds / Work: 0:40 / Rest: 0:20"** and the logger builds
**"Rundă 1 … Rundă 15"** — one score input each. Forge is displaying the *derived count of
scoreable work intervals* as the *round count*.

## §B. Root cause

`Intervals` (and `Tabata`) is modelled in `src/workoutFormats.js` as a **single scalar
`format_config.rounds` = "number of scoreable score inputs"**, with **no station concept**:

| Surface | Code | Behaviour |
|---|---|---|
| Member Home / Coach Preview | `computeMemberDetailLines` (`workoutFormats.js:1038`) | `roundsKey = cfg.rounds` → pushes **`"15 Rounds"`**; then `workSec` → `"Work: 0:40"`, `restSec` → `"Rest: 0:20"` |
| Logger | `defaultRowsForFormat` (`workoutFormats.js:1163`) | `for i in 1..cfg.rounds → out["Rundă i"] = [emptyRow()]` — **the `movements` array is ignored entirely** |
| Duration | `estimateTotalDurationSec` (`workoutFormats.js:858`) | `rounds × (workSec + restSec)` = `15 × 60` = 900 s |
| Score | `composeWodLogFields` (family `sets`) + `computeSetsScore` | sum of the `cfg.rounds` inputs = Total Reps |

The value `15` **is the persisted, canonical `format_config.rounds`** (see §C/§D). The coach's
"5 rounds × 3 stations" is **not stored anywhere**. `15 = 5 × 3` is precisely the inference
§95 forbids.

### Where the `15` came from (write path)

`created_at 2026-08-30`, movement names carry the `"Max.reps:"` AI-parse prefix → this
workout was authored via **AI Analyze** (`supabase/functions/analyze-workout`). The prompt
(`prompt.ts:30`) defines Intervals as *"formate stil Fight Gone Bad (mai multe statii,
interval fix per statie, scor = total reps)"* and (`prompt.ts:76`) tells the model to fill
`rounds` for Intervals. `transform.ts:62` stores `rounds: fc?.rounds ?? null` **verbatim** —
no client/transform multiplication. So the LLM, following the FGB guidance, computed the
*total scoreable intervals* (`5 × 3 = 15`) and emitted `rounds: 15`. For the current schema
that is arguably "correct" (it is the number of score inputs) — but it **destroys the
round/station structure at the source**, and nothing downstream can recover it.

## §C. Current persisted representation (legacy `wods`, incident row `2ed71d47`)

```
type            : "Intervals"
format_config   : { "restSec": 20, "rounds": 15, "workSec": 40 }   ← ONLY these 3 keys
movements_rx    : ["Max.reps: Handstand Push-up", "Max.reps: Renegade Row", "Max.reps: Shuttle run"]   (3)
movements_intermediate : ["Max.reps: Handstand Push-up", "Max.reps: Renegade Row", "100 m Shuttle Run"] (3)
duration        : "15:00"   (text, authoritative for display)
movement_prescriptions.variants.rx.movements : 3 instances, each with instanceId; Renegade Row load {male:17.5,female:12.5,kg}
rx_weight_male/female : 17.5 / 12.5
```

**No `sets`, no `stationCount`, no `roundCount`, no structural discriminator, no frozen "5" —
anywhere.**

## §D. Engine V2 representation (`workout_sections`, same workout)

`format = "Intervals"`, `format_config = { restSec:20, rounds:15, workSec:40 }` (identical
mirror), `movements` = the same 3 station objects (with `instanceId`, `prescription`,
`weight "17.5/12.5kg"`), `duration_minutes = null`. **No additional structure. Byte-parallel
with the legacy row.**

## §E. Legacy representation

= §C. The legacy `wods` row *is* the legacy representation; Engine V2 is a faithful mirror.

## §F. Existing INC-06 semantics (what is right, and where it collapses)

INC-06 established, correctly and still valid:
- `Intervals` = `family:'sets'`, `rowMode:'interval'`, `simpleReps:true`, `scoringMode`
  default **`Total Reps`**.
- `result` / `time_result` = null; per-input reps in `wod_logs.sets`; aggregate derived at
  read (`computeSetsScore` / `resolveSetsScoringMode`).
- **REST = `format_config.restSec` only** — never a movement, never a `sets` row, zero score
  contribution. This is correct and must be preserved.
- The interval logger emits exactly **`format_config.rounds` WORK inputs**.

**Where it collapses:** INC-06's model has **one axis** ("number of work inputs = `rounds`")
where the product needs **two** ("rounds" × "scoreable stations"). INC-06 never had to
distinguish them because every Intervals workout it saw scored one number per input. It did
not introduce the `5 → 15` conflation — the schema never had a round/station split to begin
with.

## §G. Canonical round-count source
**None exists.** `format_config.rounds` is the count of score inputs, not rounds.

## §H. Canonical station-count source
**None exists.** `movements` length is a *candidate*, but it is not a reliable station
count — see §J: three production Intervals workouts use `movements` for three different
things.

## §I. Derived interval count
Would be `roundCount × stationCount`. Cannot be derived today because neither operand is
stored.

## §J. Rest representation — and why three production Intervals workouts prove the model is underspecified

| Date | `format_config` | `movements` (count) | `duration` | What it actually is |
|---|---|---|---|---|
| **2026-08-14** | `{rounds:6}` | 6 (`1:00 double-unders`, `1:00 snatches`, `2:00 double-unders`, …) | 3:00 | 6 work intervals, **movement *i* = interval *i*** (ascending-time). No rest. |
| **2026-08-21** | `{rounds:3, workSec:240, restSec:120}` | 14 (incl. `"Amrap 4:"` headers **and `"2:00 Rest"` lines baked into the movement list**) | 18:00 | **3 real rounds**, each a 4-min AMRAP block of ~4 movements, 2 min rest **between rounds**. One score per round. `restSec` = between-rounds. |
| **2026-09-01** (incident) | `{rounds:15, workSec:40, restSec:20}` | 3 (HSPU, Renegade Row, Shuttle) | 15:00 | Coach intent: **5 rounds × 3 stations**, `:20` rest after **every** station. `restSec` = after-every-station. |

`format_config.rounds` = {6, 3, 15} means "score-input count" in all three. `movements`
means "per-interval prescription" / "flattened per-round block incl. rest text" / "stations
to cycle" respectively. `restSec` means "n/a" / "between rounds" / "after every station".
**The schema cannot tell these apart.** REST is modelled *only* as a uniform scalar
`restSec`; the "rest after each station including the last" semantics the incident needs is
not expressible, and neither is "rest only between rounds" vs "rest after every station".

## §K–§R. Contracts (Builder / Preview / Home / Logger / Persistence / Result / Leaderboard / Journal)
**Not defined** — implementation was not reached. The intended shape (from the ticket §56) is
`resolveIntervalStructure → { roundCount, stations[], workSec, restSec, scoreableIntervalCount = roundCount × stationCount, totalDurationSec, scoreMode }`, consumed by one shared resolver across Home / Preview / Logger / Result. That shape **requires a persisted `roundCount` distinct from a station list, plus a discriminator for the §J models and the §36/§37 rest-placement question** — none of which the current schema carries.

## §S. Historical fallback
Per §30 / §78: old flat 15-entry (or 6-entry, or 3-entry) interval logs carry **no frozen
evidence** of an *N × M* structure. They must keep rendering truthfully as N flat inputs.
**No `5 × 3` may be invented for them.** (The existing `wod_logs` — 4 rows on 2026-08-14,
9 on 2026-08-21, 2 on 2026-09-01 — store `sets` keyed `"Rundă 1".."Rundă N"` where N =
`format_config_snapshot.rounds`; frozen, correct for the flat model, untouchable.)

## §T–§V. Variant / performed-prescription / repeated-movement behaviour
Not implemented. Note the incident already has **per-variant station lists** (RX and
Intermediate each have 3, with different names — "Renegade Row" vs "Renegade Row",
"Max.reps: Shuttle run" vs "100 m Shuttle Run") and **per-variant loads** (RX 17.5/12.5,
Int 14/10) — so a future logger must resolve station structure from the **selected variant**
(§25), and P9.3 instance identity (`instanceId` present on all station objects) is available
for §22 repeated-movement disambiguation.

## §W. Duration calculation
`5 × 3 × (40 + 20) = 900 s = 15:00`. **15:00 is already correct** — `wods.duration = "15:00"`
is stored and displayed via `formatWodDurata`. `estimateTotalDurationSec` (a fallback)
happens to also give 900 s *only because* `rounds` is persisted as 15. Reinterpreting
`rounds` as 5 would make that fallback yield `5 × 60 = 5:00` — one of ~5 call sites that
would need updating in any implementation.

## §X. Files changed
**None.**

## §Y. DB impact
**None.** (And per §94/§95, a migration is **not** applied — it is *proposed below* for owner
decision.)

## §Z. Tests
**None added** (no implementation).

## §AA. Regression counts
N/A — no change. Baseline unaffected (full suite 1638 pass + 9 pre-existing Deno failures).

## §AB. Mobile smoke
N/A.

## §AC. Production smoke
Read-only DB inspection only (§C/§D/§J/§S). No writes.

## §AD. Console
N/A.

## §AE–AG. Commit / bundle / app_version
**None** (report doc only).

## §AH. Remaining limitations
The entire feature — this is a STOP, not a partial fix.

## §AI. Closed-phase regression statuses
P9.5.6 GREEN · P9.5.7 GREEN · P9.5.8 GREEN · P9.5.8.1 GREEN · P10 GREEN · INC-06 GREEN ·
INC-04 GREEN — all untouched.

## §AJ. INC-07 final status
**STOPPED — awaiting owner decision.** Not closed. Not implemented.

## §AK. No unrelated phase started.

---

# STOP RATIONALE

- **§10 Outcome D / §95:** the schema stores only a scalar "scoreable-interval count"
  (`format_config.rounds`). There is **no canonical or frozen** representation of
  `roundCount = 5` / `stationCount = 3`. `15 ÷ 3 = 5` is the exact inference §95 prohibits,
  and §J shows it would also be *wrong* for the other two production Intervals workouts.
- **§31:** today's workout literally contains only `15`, with no recoverable `5`. Editing it
  is forbidden without explicit owner instruction.
- **§94:** a truthful generic round × station × rest model **cannot be represented without a
  `format_config` contract change** (new `roundCount`, a station/round-model discriminator,
  and a rest-placement field). The migration is proposed below, **not applied**.
- **§96:** the REST model change must not touch the movement library — the proposal keeps
  REST as pure timing structure, satisfied.

---

# PROPOSED MINIMAL PATH (for owner approval — NOT executed)

### 1. `format_config` contract extension (JSONB — no SQL migration, but a semantic change)

Add to the `Intervals` schema, all optional/back-compatible:

| key | meaning | example |
|---|---|---|
| `roundCount` | real repeats of the station sequence | `5` |
| `stationMode` | `'per-interval'` (each station its own timed work interval — FGB / incident) vs `'per-round'` (one score for the whole round's block — 2026-08-21) | `'per-interval'` |
| `restPlacement` | `'after-each-station'` (incl. last, cycle continues) vs `'between-rounds'` | `'after-each-station'` |

Then: `stationCount = movements.length` (for `stationMode:'per-interval'`);
`scoreableIntervalCount = stationMode === 'per-interval' ? roundCount × stationCount : roundCount` (derived, never stored);
`totalDurationSec` derived from the above + `workSec` + `restSec` + `restPlacement`.
**Legacy rows without these keys** → fall back to today's exact behaviour (`rounds` = flat
input count, movements decorative) — truthful legacy rendering, no invention (§S/§78).

### 2. Incident workout (`2ed71d47`) — owner decision required

Its `format_config.rounds:15` must become `{ roundCount:5, rounds:15 (or drop), stationMode:'per-interval', restPlacement:'after-each-station', workSec:40, restSec:20 }`, **or** the owner re-authors it in the Builder. Either way this is a **single deliberate production edit the owner must sanction** — not an automatic backfill. Duration stays 15:00.

### 3. Shared resolver + surfaces

One pure `resolveIntervalStructure(formatId, config, movements)` in `workoutFormats.js`
feeding `computeMemberDetailLines`, `defaultRowsForFormat`, `estimateTotalDurationSec`,
Coach Preview, and the result surfaces. Logger becomes a `roundCount × stationCount` matrix
(mobile: stacked round cards). REST never gets an input. AI-analyze prompt updated to emit
`roundCount` + `stationMode` instead of pre-multiplying into `rounds`.

### 4. Estimated blast radius
`workoutFormats.js` (schema, `computeMemberDetailLines`, `defaultRowsForFormat`,
`estimateTotalDurationSec`, new resolver, `computeSetsScore` key-ordering), `FormatLogger.jsx`
(interval matrix), `FormatConfigEditor.jsx` (Builder fields), `App.jsx` (Home render of the
station timeline + logger wiring), `supabase/functions/analyze-workout/{prompt,openaiSchema,transform}.ts`, `prescriptionContract` parity if the resolver is shared with `forge-admin-web`. ~8–10 files, new tests, and the one owner-sanctioned production edit. Non-trivial; needs its own implementation ticket after the contract is approved.

---

# IMPLEMENTATION + CLOSURE (owner approved 2026-09-01)

## Owner-approved contract (final, as persisted)

`format_config` for a **structured per-interval** Intervals workout:

```json
{
  "roundCount": 5,
  "stationMode": "per-interval",
  "restPlacement": "after-each-station",
  "workSec": 40,
  "restSec": 20,
  "scoringMode": "Total Reps",
  "rounds": 15
}
```

- **`roundCount`** — the real number of repeated rounds. THE canonical semantic round count.
- **`stationMode: 'per-interval'`** — the structural discriminator. `resolveIntervalStructure`
  treats a workout as structured **iff** this is stored **and** `roundCount > 0`.
- **`restPlacement: 'after-each-station'`** — the only value this phase implements; the field
  exists so other placements can be added later without another contract change.
- **`rounds`** (legacy) — kept and re-derived on every save (= `roundCount × stationCount`)
  so surfaces not yet migrated, `estimateTotalDurationSec` on a stored row, and any external
  reader still get a sane number. It equals the DERIVED scoreable-interval count, **never**
  the round count (§88).
- **`scoreableStationCount`** = scoreable stations in `movements` (rest lines excluded via
  `isRestLine`). **`scoreableIntervalCount`** = `roundCount × stationCount` — derived, never
  stored as truth.
- Duration = `roundCount × stationCount × (workSec + restSec)` for `after-each-station`
  → incident `5 × 3 × 60 = 900 s = 15:00` (unchanged).

**Legacy Intervals / Tabata** (only `format_config.rounds`, no `stationMode`) — untouched.
`resolveIntervalStructure` returns `{ structured:false }`; every surface keeps its
pre-INC-07 behaviour. The two other production Intervals workouts (2026-08-14, 2026-08-21 —
audit §J) are not re-saved and never reinterpreted. `15 divided by 3 = 5` is applied to nothing.

## The shared resolver (`src/workoutFormats.js`)

- **`resolveIntervalStructure(formatId, config, movements)`** -> `{ structured, roundCount,
  stationCount, stations, scoreableIntervalCount, workSec, restSec, restPlacement,
  totalDurationSec, scoreMode }` — the ONE structural truth. Home, Coach Preview, the
  logger and `estimateTotalDurationSec` all consume it.
- **`isStructuredInterval(config)`** — the discriminator (config-only).
- **`isRestLine(text)`** — rest never counts as a station.
- **`intervalStationKey(round, station, name)`** = `Runda {r} . {s}. {name}` —
  deterministic round-major score key; the station index keeps a movement repeated inside a
  round two distinct inputs (§33/§41).
- **`intervalTimelineLines(formatId, config, stationLines)`** -> `["0:40  Handstand Push-up",
  "0:20  Rest", ...]` for structured; `null` for legacy.

## Surface-by-surface

| Surface | Behaviour |
|---|---|
| **Builder** (`FormatConfigEditor` + `Intervals` schema) | schema field `rounds` -> **`roundCount`** (label unchanged, "Rounds"). Legacy rows show their stored `rounds` value in that field so editing is not broken; it becomes stored `roundCount` (upgrading the row to structured) only once the coach edits it. Work / Rest fields unchanged. No new controls, no icons, no redesign. |
| **Builder save** (`wodSections.legacyPayloadFromSections`) | Intervals section with `roundCount > 0`: derive `rounds = roundCount x RX-station-count`, stamp `stationMode` / `restPlacement`, compute duration from the structure. An Intervals section whose config never got a `roundCount` is written back exactly as loaded — stays legacy flat. |
| **AI Analyze** (`openaiSchema` + `prompt` + `transform` + `workoutIntelligence`) | new `roundCount` + `stationMode` in the contract; the prompt tells the model to emit `roundCount` = the real rounds (NEVER `rounds x stations`), `stationMode:'per-interval'`, and put each scoreable station (no "Rest") in `movements`. `transform.ts` passes them through; the client translator keeps them when present, else stays the legacy `rounds` model. No invention — leave both null when structure is unclear. |
| **Engine V2** | `workout_sections.format_config` is a verbatim mirror of `wods.format_config`. No divergent model. `legacy_wod_id` / date identity untouched. |
| **Member Home / Coach Preview** | round label from **`roundCount`** -> "5 Rounds"; the bare "Work: 0:40 / Rest: 0:20" generic lines are suppressed for structured; the station list is replaced by the **timeline** `0:40 <station> / 0:20 Rest / ...`. Same white surfaces / typography / borders / green CTA. No icons. Duration still "15:00". |
| **Logger** (`FormatLogger.SetsFields`) | structured -> **round-grouped stacked layout**: `roundCount` groups, one reps input per station, round header ("RUNDA 1"). `roundCount x stationCount` inputs, round-major keys, zero Rest inputs. Stacked (not a matrix) -> usable on the narrowest phones. Same input styling, no icons. Legacy -> unchanged flat "Runda i". |
| **Score persistence** | reuses `wod_logs.sets` (`{ [intervalStationKey]: [{reps,...}] }`). 15 keys, round-major. Zero DB change. |
| **Result aggregation / Leaderboard** | `computeSetsScore` sums `Object.values(sets).flat()` — key-agnostic -> Total Reps = sum of all 15 station values, unchanged (INC-06). Ranking untouched (§46). |
| **Result detail / Journal / Share** | render from the log's own frozen `format_config_snapshot` (P10). Old flat logs stay flat. No surface prints "15 rounds". |

## The one-off production correction (§49 — the only authorized mutation)

**`wods` `2ed71d47` + its Engine V2 metcon section** `format_config`:
`{restSec:20, rounds:15, workSec:40}` -> `{restSec:20, workSec:40, roundCount:5,
stationMode:'per-interval', restPlacement:'after-each-station', rounds:15}` (`rounds:15`
unchanged — it already equalled `5 x 3`). `scoringMode` left as stored. Duration "15:00"
unchanged. The 3 RX + 3 Intermediate stations untouched.

**Pre-mutation checks (§50/§54) — all passed:**
- ID `2ed71d47-9484-4062-9505-ca70aa9a3e70`, `type='Intervals'`, `format_config` exactly the
  audited `{restSec:20, rounds:15, workSec:40}`, 3 RX + 3 Int stations, `duration='15:00'`.
- **2 existing `wod_logs`** (owner's INC-06 test rows). Each carries its own frozen
  `format_config_snapshot = {rounds:15}` (no `stationMode`). `resolveIntervalStructure` on a
  log reads the snapshot -> legacy -> flat 15 entries -> rendering unchanged;
  `computeSetsScore` sums the 15 `sets` values -> Total Reps unchanged. No reinterpretation,
  no conflict. -> proceed.

**Zero** `wod_logs` / `skill_logs` / score / snapshot / performed-prescription mutation.

## Files changed

- `src/workoutFormats.js` — `Intervals` schema (`rounds`->`roundCount`); `+ isRestLine`,
  `+ isStructuredInterval`, `+ resolveIntervalStructure`, `+ intervalStationKey`,
  `+ intervalTimelineLines`; `defaultRowsForFormat` (structured branch);
  `computeMemberDetailLines` (roundCount label + suppress work/rest for structured);
  `estimateTotalDurationSec` (structured-aware, optional `movements` arg).
- `src/wodSections.js` — `legacyPayloadFromSections`: structured-Intervals `primaryFormatConfig`
  derivation + duration from resolver.
- `src/FormatLogger.jsx` — `SetsFields` round-grouped structured-interval branch.
- `src/FormatConfigEditor.jsx` — `roundCount` number field shows legacy `rounds` as fallback.
- `src/workoutIntelligence.js` — `Intervals` AI translator keeps `roundCount`/`stationMode`.
- `src/App.jsx` — `metconVariantsForDisplay` emits the interval timeline; `memberMovementLine`
  renders timeline lines verbatim.
- `supabase/functions/analyze-workout/{openaiSchema,prompt,transform}.ts` — `roundCount` +
  `stationMode` in the AI contract, FGB-style guidance, no pre-multiplication.
- `src/inc07IntervalStationStructure.test.js` — new, 32 tests.

## DB impact
**0 schema . 0 migrations . 0 columns . 0 tables . 0 backfills . 0 `wod_logs` mutations.**
One authorized `UPDATE` of `format_config` on one `wods` row + its mirrored
`workout_sections` row (§49).

## Regression
- Full `vitest run` — **1670 passed** / 9 pre-existing Deno failures (unchanged baseline).
- `appHookOrderIntegrity` 3 . `eslint src/*` **0 errors** . `vite build` clean.
- INC-06 (38) . P9.5.6 . P9.5.7 . P9.5.8 . P9.5.8.1 . P10 . P9.4 . P9.3 . `wodSections` .
  `workoutIntelligence` . `workoutComposer` — all pass, untouched.

## Remaining limitations
1. **`forge-admin-web` programming Builder** still authors the legacy `rounds` model for a
   new Intervals workout. Its RESULT surfaces are unaffected (aggregate score is
   format-agnostic). Parity port = a scoped follow-up. The primary Builder (WOD-SIMPLE
   Admin) and the incident's authoring path (AI Analyze) are fixed.
2. **Non-uniform / explicit per-station rest** is not authored — only uniform `restSec` +
   `restPlacement:'after-each-station'`. Contract has room for it without a schema change.
3. **Non-rep stations** (calories/distance per interval) still score as reps for structured
   Intervals — `simpleReps` unchanged (§39). Capability boundary, documented.
4. **Legacy Intervals opened in the WOD-SIMPLE editor**: the Rounds field shows the stored
   flat `rounds`; editing + saving upgrades the row to structured. Deliberate re-authoring;
   the two legacy production rows are historical and will not be re-saved.
5. The `"Max.reps:"` prefix on the incident's station names (a pre-INC-06 AI-parse artifact)
   is shown as-is — a pre-existing display-cleanup concern, out of INC-07 scope.

## Adjacent phase status
P9.5.6 GREEN . P9.5.7 GREEN . P9.5.8 GREEN . P9.5.8.1 GREEN . P10 GREEN . INC-06 GREEN .
INC-04 GREEN — all untouched.

## Deploy / production smoke

- **Commits:** `6549bb8` (impl) + `013d867` (logger round-group label "Round N" not "SET N")
  + `7cb5159` (audit) + report follow-up.
- **Bundle:** `dist/assets/index-DCysmpVN.js` live on `forge-delta-ivory.vercel.app`.
- **app_version:** `interval-station-structure-inc07b-20260901`.
- **Edge function:** `analyze-workout` redeployed (project `sdfkvfbvgpuspnnnwqwk`).
- **One-off correction applied:** `wods` `2ed71d47` + its Engine V2 `workout_sections` metcon
  row, both now `{workSec:40, restSec:20, rounds:15, roundCount:5, stationMode:'per-interval',
  restPlacement:'after-each-station'}`. `wod_logs` untouched (2 rows, frozen snapshots).

### Production acceptance (owner account, live)
- **§92 Home — PASSED.** Sept 1 WOD card RX accordion: **"Intervals   15:00"**, **"5 Rounds"**
  (not "15 Rounds"), timeline **`0:40 Max.reps: Handstand Push-up` / `0:20 Rest` / `0:40
  Max.reps: Renegade Row @ 17.5 kg` / `0:20 Rest` / `0:40 Max.reps: Shuttle run` / `0:20
  Rest`**. No "Work:/Rest:" generic lines. Current Forge design, no icons. Intermediate
  variant accordion present (P9.5.8).
- **§93 Logger — PASSED.** "Intervals 15:00 / 5 Rounds" header, then **Round 1 … Round 5**
  (5 groups), **3 reps inputs per group**, **15 total inputs**, **0 Rest inputs**, ends at
  Round 5. Stacked layout, native logger styling, no icons.
- **§94 Builder — unit + config verified; visual pending.** The browser was too degraded
  this session (repeated CDP timeouts) to drive the Admin WOD editor. Covered by 8
  `legacyPayloadFromSections` unit tests + the corrected `format_config.roundCount:5` which
  is exactly what the editor's Rounds field renders. NOT visually confirmed on prod.
- **§95 AI Analyze — schema/prompt deployed; not exercised** on a live paste this session
  (would create a production workout). Covered by the schema + `workoutIntelligence.js`
  translator change; the prompt now forbids `rounds × stations`.
- **Console:** app-error free across Home + Logger + Admin nav (only Chrome-extension noise).

## INC-07 final status
**CLOSED.** Home + Logger production-verified; Builder unit + config verified (visual smoke
pending owner confirmation); AI Analyze contract deployed.

## No unrelated phase started.
