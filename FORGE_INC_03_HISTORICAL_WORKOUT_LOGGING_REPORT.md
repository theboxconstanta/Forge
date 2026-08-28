# FORGE — INC-03 HISTORICAL WORKOUT LOGGING — INVESTIGATION REPORT
Date: 2026-08-28
Status: **investigation complete — implementation BLOCKED at a stop condition, awaiting approval.**

---

## 1. Executive Verdict

**INC-03 HISTORICAL WORKOUT LOGGING: NOT CLOSED**

Root cause identified with HIGH confidence. The fix requires a **historical production-data
correction** plus a **product decision** about 4 existing logs — both are explicit STOP
conditions for this mission (STOP #3 "the correct historical workout cannot be uniquely
determined [without owner input]" and STOP #5 "fix would require historical data rewrite").
No code, DB schema, RLS, or data was changed. Reporting and waiting for approval.

---

## 2. User-Reported Behavior

- Today: `2026-08-28`.
- Historical date: `2026-08-27` ("yesterday").
- Observed wrong behavior: opening `2026-08-27`'s workout and logging a result ends up
  logging/using **today's** workout context; the historical date does not remain
  independently loggable.

---

## 3. Expected Contract

A selected historical workout must be logged against **itself** — its own `workouts`
row / `legacy_wod_id`, its own `workout_section_id`, its own business date, its own
variant. "Today" must never be substituted or used as a fallback. Absence of a required
historical relationship must fail safely (clear error / disabled save), never silently
fall back to today.

---

## 4. Reproduction

**The reported flow is fully reproducible, but it is not a client-state bug — it is one
corrupt data row.**

Live production facts (read-only, verified this session):

| Table | Row | `date` | Link |
|---|---|---|---|
| `workouts` (Engine V2) | `7daeed8f-24c4-40ab-8f33-215fcabf4692` | **`2026-08-27`** | `legacy_wod_id = 8cd9666b…` |
| `wods` (legacy) | `8cd9666b-ac7b-4ac0-8c36-4911aa5c2b95` | **`2026-08-28`** | — |
| `workout_sections` | `fc1900b7-0617-4011-a814-93a413b803cb` | (parent `7daeed8f`) | `type_key = metcon`, the workout's only section |

- `2026-08-28` ("today") has a `wods` row (`8cd9666b`) but **no `workouts` row**.
- `2026-08-27` ("yesterday") has a `workouts` row (`7daeed8f`) but **no `wods` row**.
- It is **one single workout** whose two representations disagree on which calendar day
  it is. This is the exact anomaly documented in `FORGE_YESTERDAY_WOD_LOGGING_FORENSIC_REPORT.md`
  and carried forward in `FORGE_MASTER_HANDOFF_2026-08-28` as **"FOLLOW-UP: Engine V2 ↔
  Legacy WOD Date Divergence — Status: OPEN / NOT BLOCKING"**. It was **1 of 45** pairs
  then; it is now **1 of 48** pairs — still the same unique row, never remediated
  (production data was deliberately left unchanged).

**What the member experiences**

Client fetch on the Home screen, per selected date `dataAcasa`:
- `fetchWodZi(date)` → `wods WHERE date = <date>` → `wodZiData`
- `fetchWodZiWorkoutV2(date)` → `workouts WHERE date = <date>` (+ sections) → `wodZiWorkoutV2`
- `workoutForDisplay = wodZiWorkoutV2 || mapLegacyWodToWorkout(wodZiData)`

| Selected date | `wodZiData` | `wodZiWorkoutV2` | Card shows | Primary "Log Score" |
|---|---|---|---|---|
| `2026-08-28` (today) | `8cd9666b` (legacy) | `null` (no V2 row) | the workout, via legacy fallback | **enabled** |
| `2026-08-27` (yesterday) | **`null`** (no `wods` row for that date) | `7daeed8f` (V2) | the **same** workout, via V2 | **DISABLED** |

On `2026-08-27` the primary "Log Score" button is `disabled={variantaAleasa === null}`,
and `variantaAleasa` is force-cleared whenever `wodZiData === null` (the INC-02
companion effect, `App.jsx` `useEffect` on `[wodZiData]`) — and the auto-select effect
also refuses to select a variant with no `wodZiData`. The workout's **only** section is
the primary `metcon`, so `additionalScoredSectionsV` (non-primary scored sections only)
is empty and there is no independent-section log path either; there is no Skill section.
**Result: the member literally cannot log this workout while viewing `2026-08-27`.**

Every actual log of this workout therefore carries `wod_id = 8cd9666b`, whose
`wods.date = 2026-08-28`. Downstream — the Journal, the Leaderboard (`fetchClasament`
groups by the WOD for a date), and the Home "is today done?" check (`logZiWod =
wodLogs.find(l => l.wod_id === wodZiData.id …)`, where today's `wodZiData` **is**
`8cd9666b`) — all attribute the log to **`2026-08-28`**. From the member's mental model
("I'm logging the workout I missed = yesterday's") the log "switched to today."

**Pre-fix payload (member logs this workout, any working path):**
```
wod_id:              8cd9666b-ac7b-4ac0-8c36-4911aa5c2b95   (wods.date = 2026-08-28)
workout_section_id:  fc1900b7-… (or null)                    (parent workouts.date = 2026-08-27)
logged_at:           2026-08-28…  (primary/section path: DB default now(); skill path:
                     dateWithCurrentTime(wodZiWorkoutV2.date) = 2026-08-27)
actual logical date: 2026-08-27  (per the authoritative workouts row)
```
The DB trigger `snapshot_wod_log_context()` **accepts** this (the section's parent
`legacy_wod_id` equals the `wod_id`), so the row persists — but it persists attributed
to the wrong calendar day.

---

## 5. Root Cause

- **File / object:** production data — `public.wods` row `8cd9666b-ac7b-4ac0-8c36-4911aa5c2b95`.
- **Function / state:** none in application code. `fetchWodZi` / `fetchWodZiWorkoutV2` /
  `resolveWodIdForLog` / `saveWodLog` all behave correctly given the data.
- **The defect:** `wods.date` (`2026-08-28`) ≠ its Engine V2 counterpart `workouts.date`
  (`2026-08-27`) for the same logical workout. The date-keyed client lookups then place
  the one workout on two different days and make it loggable only against the wrong one.
- **Classification:** `OTHER — single corrupt production row (Engine V2 ↔ legacy WOD
  date divergence), not a today-bound / stale-closure / async-race client defect`.
  (The closest listed label, "DATE-BASED LOOKUP OVERRIDES SELECTED WORKOUT", is
  *mechanically* accurate for the symptom but misattributes cause to the client; the
  date-based lookups are correct — the data they query is wrong.)
- **Confidence:** **HIGH.** Only 1 of 48 workout/wods pairs is divergent; it is the
  exact row named in the prior forensic report; for every one of the other 47
  (correctly-synced) dates, historical logging was traced and works correctly (see §12).

**This is NOT a regression of the closed "yesterday WOD logging" fix.** That fix
(`resolveWodIdForLog`) correctly made the *save* succeed against the DB trigger; it never
claimed to fix, and could not fix, the underlying date divergence — which the same
report explicitly left OPEN as a follow-up. INC-03 is that follow-up surfacing as a
second symptom (mis-attribution) of the same untouched row.

---

## 6. Save Paths

Re-identified from current `App.jsx`. All four member logging save paths were audited.

| Save Path | Trigger | Workout source | WOD ID source | Section source | Date (`logged_at`) source | Historical-safe (for a correctly-synced date)? |
|---|---|---|---|---|---|---|
| **Primary official-variant** (`saveWodLog`, main branch) | Home → "Log Score" (`variantaAleasa !== null`) | `wodZiData` + `wodZiWorkoutV2` for `dataAcasa` | `resolveWodIdForLog(wodZiWorkoutV2, wodZiData)` = `wodZiWorkoutV2?.legacyWodId ?? wodZiData?.id` | `primarySectionV.id` (from `workoutForDisplay`), gated on `wodZiWorkoutV2` | `dateWithCurrentTime(wodZiData.date)` | **Yes** — but requires `wodZiData` (blocked when the legacy row is missing/mis-dated) |
| **Additional independently-scored section** (`saveWodLog`, `logTargetSectionId` branch) | Home → scored non-primary section card | same | `resolveWodIdForLog(wodZiWorkoutV2, wodZiData)` | `logTargetSectionId` | `composeWodLogFields()` (no explicit `logged_at` → DB `now()`) | **Yes** for identity; `logged_at` falls to today (pre-existing, minor) |
| **Skill Work** (`skill_logs` upsert) | Home → Skill/Skill2 "Log" | same | `resolveWodIdForLog(wodZiWorkoutV2, wodZiData)` | `skillSectionIdV2` | `dateWithCurrentTime(wodZiWorkoutV2?.date ?? wodZiData?.date)` | **Yes** |
| **Free-text / "Logare Nouă"** (`saveFreeTextLog`, and `variantaAleasa === null` in `saveWodLog`) | Home/Journal → New log | none | `null` (deliberate) | `null` | DB `now()` | N/A — intentionally unlinked |

For the anomalous workout specifically: the primary path is **unreachable** (no
`wodZiData` on `2026-08-27`); the section and skill paths are also unreachable (only a
primary `metcon` section, no skill). So the workout can only be logged from the
`2026-08-28` view, which is exactly the mis-attribution.

---

## 7. Canonical Identity

For this workout, the identity is **uniquely determined**:

| Aspect | Value |
|---|---|
| Workout (Engine V2) | `workouts` row `7daeed8f-24c4-40ab-8f33-215fcabf4692` |
| Legacy WOD | `wods` row `8cd9666b-ac7b-4ac0-8c36-4911aa5c2b95` (this is `workouts.legacy_wod_id`) |
| Section | `workout_sections` row `fc1900b7-0617-4011-a814-93a413b803cb` (`metcon`) |
| Business date | **Ambiguous at the data layer**: `workouts.date = 2026-08-27` vs `wods.date = 2026-08-28`. The prior forensic report concluded `workouts.date` (`2026-08-27`) is correct; however 4 existing member logs and the members' own logging behaviour sit on `2026-08-28`. This single question is what needs owner confirmation. |

---

## 8. Fix

**Not implemented — requires approval.** The smallest correct fix is a **one-row data
correction** so the two representations agree on the date, after which all client paths
work unchanged:

**Option A (recommended, matches the prior forensic report's conclusion):**
```sql
UPDATE public.wods SET date = DATE '2026-08-27'
WHERE id = '8cd9666b-ac7b-4ac0-8c36-4911aa5c2b95';   -- align legacy with authoritative workouts.date
```
Effect: `2026-08-27` gains a `wods` row → primary "Log Score" works there; `2026-08-28`
correctly shows "no WOD scheduled". **But** the 4 existing `wod_logs` on `8cd9666b`
(all `logged_at` = `2026-08-28`, 2 distinct members) become "logged on 08-28 for the
08-27 workout" — i.e. those members did the workout a day late, OR their `logged_at`
should also move to `2026-08-27`. **That is the product decision.**

**Option B:** `UPDATE workouts SET date = '2026-08-28' …` (treat `wods.date` as correct).
Effect: the workout consolidates on `2026-08-28`; the 4 logs stay consistent; but this
contradicts the prior forensic finding and there would then be genuinely no `2026-08-27`
workout (fine if none was ever scheduled).

**Option C (client hardening, separate + additive, does NOT close INC-03):** make the
primary log path Engine-V2-capable when `wodZiData === null` (derive variants/movements
from `wodZiWorkoutV2.sections[].scalingVersions` + metadata, which the card already
renders), so a V2-only historical workout is loggable against its own identity. This is
a real but larger app change and **still cannot fix the date attribution** — the log
would still carry `wod_id = 8cd9666b` (dated 08-28). It should be considered only
alongside A/B, not instead of them.

**Also worth a small, safe, standalone hardening (app-only, not required to close
INC-03):** `fetchWodZi` and `fetchWodZiWorkoutV2` write two independent state atoms
(`wodZiData`, `wodZiWorkoutV2`) for the *same* logical selected workout, with **no
request-currency guard**. On rapid date switching the two responses can land out of
order, transiently leaving them describing different dates; `resolveWodIdForLog` prefers
`wodZiWorkoutV2?.legacyWodId`, so a lagging `wodZiWorkoutV2` could yield a different
day's `wod_id`. This is a latent race, **not** the deterministic reported symptom, but a
per-request "is this still the selected date?" check (ref token) would close it.

---

## 9. No-Today-Fallback Rule

**Confirmed present in code: YES** (for correctly-synced dates). The save paths do not
fall back to today's workout/WOD-id/section/variant; when a required relationship is
absent the primary button is disabled and section/skill paths are gated on
`wodZiWorkoutV2`. The observed "switch to today" is **not** a code fallback — it is that
the one workout is physically addressable only via its mis-dated `wods` row.

---

## 10. Regression Matrix

Traced against live data (no code run — client-state trace + DB verification):

| # | Case | Result |
|---|---|---|
| 1 | Today (`2026-08-28`) → log today | Works; `wod_id = 8cd9666b`, `logged_at` 08-28, consistent (4 real logs exist) |
| 2 | `2026-08-27` → log yesterday | **FAILS** — primary button disabled (`wodZiData` null); no section/skill path; workout only loggable from the 08-28 view → mis-attributed |
| 3 | `2026-08-26` (synced pair) → log 2 days ago | **Works** — `wodZiData` + `wodZiWorkoutV2` both load; `resolveWodIdForLog` → `5a3a3fa2`; section from V2; `logged_at` = 08-26 |
| 4 | Switch today → 08-26 → save | Works; mid-fetch, `resolveWodIdForLog` falls back to `wodZiData.id` (correct once the fast `fetchWodZi` resolves) |
| 5 | Switch 08-26 → today → save | Works |
| 6 | today → 08-26 → today → 08-26 → save | Works (each effect run passes the explicit date; final state converges) — **except** the latent out-of-order race noted in §8 |
| 7 | Historical workout with official variant (synced date) | Works |
| 8 | Historical workout, legacy `wods` row missing (the anomaly) | **FAILS** — §4 |
| 9 | Historical workout, multiple sections (synced date) | Works — section resolved by `slotKey`/`id` from `wodZiWorkoutV2` |
| 10 | Skill Work historical save (synced date) | Works — `skillSectionIdV2` + `resolveWodIdForLog` |
| 11 | Additional scored-section historical save (synced date) | Works — `logTargetSectionId` + `resolveWodIdForLog` |
| 12 | Missing `legacy_wod_id` | `resolveWodIdForLog` → `wodZiData?.id ?? null`; if also null, `wod_id` null → primary path sets `null` only when `variantaAleasa === null`; otherwise a null `wod_id` with a real section is rejected by the DB trigger (fails safe, no today-fallback) |

**Only cases 2 and 8 fail, and both are the single mis-dated row.**

---

## 11. Automated Tests

Not added — implementation is blocked. If Option A/B is approved, the regression tests
to add (per Phase 14) are: given `workouts.date = D` and its `wods.date = D`, a save from
the `D` view produces `wod_id = <that wods.id>` and `logged_at` date `= D`; and a
guard/assert that refuses to persist when `workoutForDisplay`'s own `legacyWodId`'s
`wods.date` ≠ the selected date (surfacing, not silently repairing, any future
divergence). Current baseline (unchanged, re-confirmed this session): **923 / 923**.

---

## 12. Positive Controls

Today's normal logging: **PASS** — 4 real `wod_logs` on `2026-08-28` for this workout,
all internally consistent (`wod_id` ↔ section ↔ `logged_at`). Synced historical date
(`2026-08-26`): **PASS** (traced). The platform's historical logging is correct for 47
of 48 workout dates.

---

## 13. Production Evidence

- Workout/WOD date divergences, full history: **1 of 48 pairs** — `workouts.date =
  2026-08-27` / `wods.date = 2026-08-28`, workout `7daeed8f` / wods `8cd9666b`.
- `wod_logs` on `wod_id = 8cd9666b`: **4** rows, **2** distinct members, all
  `logged_at` local date `2026-08-28`; 3 carry `workout_section_id = fc1900b7` (the
  workout's own metcon section — internally consistent), 1 has no section.
- `skill_logs` on that `wod_id`: **0**.
- No log anywhere shows `wods.date` ≠ `logged_at` local date (the mis-attribution is
  invisible in that check because both sit on `2026-08-28`).
- No orphaned / partial / trigger-rejected rows.

Classification: **CONFIRMED HISTORICAL IMPACT (narrow)** — 4 logs / 2 members are
attributed to `2026-08-28` for a workout whose authoritative date is `2026-08-27`; and
any member who tried to log via the `2026-08-27` view was silently unable to.

---

## 14. Production Data

Historical rows modified: **NO.** Nothing was written. The `wods`/`workouts`/`wod_logs`
rows are exactly as found.

---

## 15. DB / RLS / Security

Changed: **NO.** No schema, function, trigger, RLS policy, or grant was touched. The DB
contract is correct: `wod_logs.wod_id → wods.id`, `workout_section_id → workout_sections.id`,
`snapshot_wod_log_context()` validates the section's parent `legacy_wod_id` against
`wod_id`. The DB derives nothing from `current_date`/today for logging. The client sends
a self-consistent payload; the payload's *date meaning* is wrong only because the `wods`
row it necessarily references is mis-dated.

---

## 16. Other Closed Items

| Item | State |
|---|---|
| INC-01 (member names) | unchanged |
| INC-02 (score-save null guard) | unchanged |
| "Yesterday WOD" `legacy_wod_id` fix | unchanged — `resolveWodIdForLog` still in place at all 3 sites; **not reopened** (this is its documented open follow-up, not a regression) |
| P0-01 timezone | unchanged (verified live earlier this session) |
| `dashboard_resolve_window` timezone | unchanged |
| `m9_publish_waiver` timezone | unchanged |
| Security Gate | GREEN |

---

## 17. Deployment

Production: **NO.** Commit: **NONE.** Nothing to deploy — implementation blocked pending
approval.

---

## 18. Final Verdict

**INC-03 HISTORICAL WORKOUT LOGGING: NOT CLOSED**

Root cause is HIGH-confidence and narrow (one mis-dated `wods` row — the OPEN Engine V2 ↔
legacy date-divergence follow-up). The fix is a one-row historical data correction whose
direction (`wods.date` → `2026-08-27`, or `workouts.date` → `2026-08-28`) and whose
handling of 4 existing logs (2 members) is a **product decision requiring the gym
owner's input** and **explicit approval for a historical-data write** — both hard STOP
conditions for this mission. A separate, additive, app-only hardening (request-currency
guard on the two workout fetches; optionally a V2-capable primary log path) is available
but does not by itself close INC-03.

**Recommended next step:** confirm the workout's true business date with the owner, then
authorize Option A (or B) as a single narrowly-scoped data migration + a decision on the
4 logs' `logged_at`.
