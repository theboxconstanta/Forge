# Per-Movement Prescription Engine — P9 Report

Date: 2026-08-29
Status: **P9 SHIPPED (member resolution + frozen logger prescription + immutable
snapshot). HARD STOP before P10. Manual browser acceptance requires the owner.**
Companion to `PER_MOVEMENT_PRESCRIPTION_ENGINE_AUDIT_AND_ARCHITECTURE.md`
(§C.6) and `..._P5_P8_REPORT.md`.

---

## PRE-P9 PRODUCTION EXPOSURE GUARD — what was done

**No client feature-flag infrastructure exists in WOD-SIMPLE** (the `app_version`
table's `trial_expiry_enforcement_enabled` key is read only server-side, not by
the client). Per the owner's "smallest reversible guard" instruction:

- `buildLegacyArtifactsForVariant(instances, { inlineLoad = FALSE })` (both
  repos, commit *pre-guard*). The regenerated `wods.movements_{variant}` text
  lines are now **plain** ("20 Snatch", no `@ x/y`). A structured workout's
  legacy render is therefore **plain movement lines + one weight badge (first
  load)** = the exact status quo for any multi-weighted workout today. The
  confusing "gender-neutral inline value competing with a badge" case disclosed
  in P5–P8 §K.1 **can no longer occur**.
- The full per-movement prescription is preserved in `wods.movement_prescriptions`
  and is surfaced by the P9 structured member renderer, which **never reads
  `movements_{variant}` for a structured workout**.
- **Not a hard builder gate** — coaches can still author structured workouts —
  but member-visible output is now never worse than the pre-engine baseline, and
  P9 (this deploy) makes the point moot.
- **Dev/test access is unaffected** (a build-time param default, overridable in
  tests; no environment gating).
- Reversible: pass `{ inlineLoad: true }` at the two call sites to restore inline
  rendering.

---

## A. STATUS

**PASS at the contract + code-path level. Owner manual browser acceptance
REQUIRED** (this mission had no logged-in member/coach browser session — the
standing "the user logs in, I navigate" constraint). Automated coverage is
comprehensive (see §K); the App.jsx wiring is thin glue over the tested shared
contract.

---

## B. MEMBER RESOLUTION

### Exact resolver path

```
wods row (fetchWodZi)                         ← gym-scoped RLS fetch
  .movement_prescriptions                     ← canonical typed contract v1
  → activePrescriptionDoc                     ← App.jsx: logCtx.prescriptionDoc in a frozen
                                                 flow, else the live wods doc
  → metconVariantsForDisplay(section, doc, memberGenderKey)
      variantKeyFromLevel(v.level)            ← 'RX'|'OnRamp'|… → 'rx'|'onramp'|…
      resolveVariantDisplayLines(doc, vk, memberGenderKey)   ← shared contract
        resolveVariantForMember → resolveMovementInstance per instance → renderInstanceLine
  → structured lines replace v.movements; v.weightMale/Female set null
```

### Gender behaviour

- `memberGenderKey = resolveAthleteGenderKey(userProfile.gender)` where
  `userProfile` is loaded from **`supabase.from('members').select('…gender…')`**
  (App.jsx:7348) — canonical `members.gender`, **never `profiles.gender`**.
- `'masculin' → 'male'`, `'feminin' → 'female'`, anything else → **`null`**.
- `null` (unknown/unresolved): `resolveSpec` returns `value: null` +
  `bothValues: [male, female]`; `renderInstanceLine` emits `"45/30 kg"` /
  `"15/12 Cal Row"`. **No male fallback anywhere.** Workout access is never
  blocked; the profile is never auto-mutated.

### Structured vs legacy fallback

| Condition | Behaviour |
|---|---|
| `movement_prescriptions.variants[variant].movements` non-empty | **structured**: member-resolved lines; legacy variant weight badge suppressed |
| absent / empty | **legacy fallback**: byte-identical to pre-P9 — `metconScalingVariantsForDisplay` text lines + `resolveMovementDisplayText` inline-`x/y` gender resolution + the legacy weight |

**No workout combines both representations.** For a structured variant the
legacy `weightMale/weightFemale` are explicitly `null` in the display object.

---

## C. MEMBER DISPLAY

Reference workout (`3 RFT`; RX: Snatch 45/30 kg, Wall Ball 9/6 kg, DB Snatch
22.5/15 kg, Row 15/12 cal, Run 400 m):

**Male:**
```
20 Snatch @ 45 kg
20 Wall Ball @ 9 kg
20 DB Snatch @ 22.5 kg
15 Cal Row
400 m Run
```
**Female:**
```
20 Snatch @ 30 kg
20 Wall Ball @ 6 kg
20 DB Snatch @ 15 kg
12 Cal Row
400 m Run
```
**Unknown gender:**
```
20 Snatch @ 45/30 kg
20 Wall Ball @ 9/6 kg
20 DB Snatch @ 22.5/15 kg
15/12 Cal Row
400 m Run
```

Preserved unchanged: rounds / scheme / time cap (`WorkoutFormatHeader`,
`formatMemberScheduleLines`), score type, section labels, notes, the
`cleanMovementDisplayText` pipeline (a no-op on already-resolved lines).

**Duplicate legacy weight badge for structured workouts: REMOVED** — the display
object carries `weightMale: null, weightFemale: null` for a structured variant,
and the member view renders no separate weight element besides the per-movement
`@` in each line.

---

## D. FROZEN LOG TARGET

`freezeLoggingContext(displayedWorkout, wodZiData, wodZiWorkoutV2, businessDate)`
(`utils.js`) — **fields added/changed by P9:**

| Field | Value | Why it can't be re-resolved after click |
|---|---|---|
| `prescriptionDoc` | `wodZiData?.movement_prescriptions ?? null` — captured **by object reference** at "Log Score" click | `logCtx.prescriptionDoc` holds the reference to the doc object that existed at click time. A later `setWodZiData(freshRow)` replaces the *state*, not the object `logCtx` points at. A coach edit that changes `wods` does not reach into `logCtx`. |
| `frozenAt` | `new Date().toISOString()` at click | recorded onto the snapshot as `resolvedAt` |

Already frozen by INC-04 (unchanged): `wodZiData`, `wodZiWorkoutV2`, `workout`,
`businessDate`, `primarySection`, `supportingSections`, `additionalScoredSections`.

**Every identity-bearing read in the logging session** goes through the INC-04
alias block (`logWodZiData`, `logWodZiWorkoutV2`, `logBusinessDate`,
`logPrimarySectionV`, …) **plus** the new `activePrescriptionDoc` (=
`logCtx.prescriptionDoc` in a frozen flow). No component after the click reads
live `wodZiData` / `dataAcasa` / `variantaAleasa`-derived workout state, or does a
fresh `wods` / date lookup, for a prescription or an identity.

Second logging target: **not created.** P9 extends the single INC-04 `logCtx`.

---

## E. SNAPSHOT CONTRACT

`wod_logs.prescription_snapshot` (jsonb, added in P3a migration `20260829090000`),
built by `buildPrescriptionSnapshot({ doc, variantKey, gender, resolvedAt,
source })` **from `logCtx.prescriptionDoc`** at save:

```jsonc
{
  "version": 1,
  "variant": "rx",                       // FROZEN variant
  "gender": "female" | "male" | null,    // members.gender at freeze time
  "resolvedAt": "<logCtx.frozenAt>",
  "source": "structured",
  "movements": [
    {
      "instanceId": "mi_a",              // MOVEMENT-INSTANCE identity preserved
      "name": "Snatch",
      "canonicalMovementId": "sn",       // canonical-movement identity where available
      "displayLine": "20 Snatch @ 30 kg",// member-resolved text (secondary, not sole truth)
      "reps": { "value": 20 },
      "load": {
        "value": 30,                     // "what applied to THIS athlete"
        "unit": "kg",
        "mode": "sex_specific",
        "bothValues": [45, 30]           // "what the coach PROGRAMMED"
      }
    },
    { "instanceId": "mi_e", "name": "Run",
      "distance": { "value": 400, "unit": "m", "mode": "universal", "bothValues": null } }
  ]
}
```

| Question | Answered by |
|---|---|
| What did the coach program? | `load.bothValues` / `load.mode` (`sex_specific` vs `universal`) per instance |
| What value applied to this athlete? | `load.value` (already resolved to `gender`) |
| Movement-instance identity | `instanceId` (survives — repeated same movement kept distinct, tested) |
| Canonical movement identity | `canonicalMovementId` (or null) |
| Variant / workout / section relation | `variant` on the snapshot; `wod_id` (`resolveWodIdForLog` from the frozen V2/legacy pair) + `workout_section_id` (frozen primary section) on the log row itself |
| Universal vs sex-specific | `mode` per spec — a universal `distance` never becomes `{male:400, female:null}` (tested) |
| Decimals | `22.5` / `47.5` survive verbatim (tested) |

**Determinism:** identical `(frozen doc, variant, gender)` → byte-identical
snapshot (pure function over frozen inputs). **No re-read of mutable `wods`** —
the doc is the frozen reference.

---

## F. SAVE PATHS

| Path | Change |
|---|---|
| `wod_logs.insert` — primary official variant (`saveWodLog`, `variantaAleasa !== null`) | **writes `prescription_snapshot`** when `variantHasStructuredPrescription(frozenDoc, frozenVariantKey)`; omits the key (→ `null`) otherwise |
| `wod_logs.insert` — additional scored section (`logTargetSectionId`) | **no snapshot** — a supporting section is not a metcon variant; engine is metcon-only |
| `wod_logs` — free-text log (`saveFreeTextLog`) | unchanged (no variant, no `wod_id`) |
| `wod_logs` — Journal edit (`editLogId`) | unchanged — `inFrozenLogFlow` is false for an edit; the existing row's snapshot (if any) is not touched |
| `skill_logs.upsert` (`saveSkillLog`) | **`prescription_snapshot` deliberately NOT written** (P9-M — see §I) |

---

## G. RACE CONDITION RESULTS

Tested at the contract + freeze level (`utils.test.js`, `prescriptionContract.test.js`).
Full-UI browser reproduction is the owner's manual step (§L).

| Scenario | Observed |
|---|---|
| **P1 → coach edits to P2 → member saves** | `freezeLoggingContext` captures `prescriptionDoc` by reference at click. A subsequent replacement of the source row (fresh fetch / realtime) does not change `logCtx.prescriptionDoc`. `buildPrescriptionSnapshot({ doc: logCtx.prescriptionDoc, … })` produces **P1** — `load.value` = 30 for a female member, `displayLine` = `"20 Snatch @ 30 kg"`, `bothValues` = `[45, 30]`. **Not P2 (35).** |
| **Variant switch after logger open (P9-H)** | `frozenVariantKey` / `snapshotVariantKey` derive from `VARIANT E_CONFIG[variantaAleasa]` at the time of the save call inside the frozen flow; the alias block + INC-04 `logCtx` already pin the section/workout to the clicked one. The snapshot's `variant` is the frozen variant. (INC-04 GLOBAL fixtures cover the identity half; P9 adds the prescription half.) |
| **Date switch after logger open (P9-I)** | `logBusinessDate` / `logWodZiData` / `logWodZiWorkoutV2` are the INC-04-frozen values; `wod_id` = `resolveWodIdForLog(logCtx.wodZiWorkoutV2, logCtx.wodZiData)` = the explicit `legacy_wod_id` of the clicked workout. **No `wods`-by-date lookup at save.** |

---

## H. HISTORICAL LOGGING

Open Date D → "Log Score" → the INC-04 `logCtx` freezes W(D)'s
`wodZiData`/`wodZiWorkoutV2`/`prescriptionDoc`/`businessDate`. Navigate to D+N,
then save: `wod_id` = W(D)'s explicit `legacy_wod_id`; `logged_at` =
`dateWithCurrentTime(logWodZiData.date)` = D-based; `prescription_snapshot` built
from W(D)'s frozen doc. The result belongs to W(D). **No date reconstruction.**
(Same mechanism proven by INC-03 / INC-04; P9 adds the frozen `prescriptionDoc`
to the same snapshot.)

---

## I. LEGACY COMPATIBILITY

- **Legacy-only workout** (`movement_prescriptions` empty for the variant):
  `resolveVariantDisplayLines` returns `null` → member display + logger fall back
  to the **existing** legacy path (`metconScalingVariantsForDisplay` text +
  `resolveMovementDisplayText` + legacy weight), byte-identical to pre-P9.
  `variantHasStructuredPrescription(...)` is false → **`prescription_snapshot`
  stays `null`**. **No historical semantics invented from ambiguous global
  legacy fields.** P10 will keep the legacy fallback for `null`-snapshot logs.
- **Chosen behaviour: A** (snapshot null for legacy; P10 legacy fallback). Not B
  (deriving a legacy snapshot) — deterministic legacy structure is not available
  from a single global `{male,female}` pair over multiple movements.

---

## J. SECURITY / TENANCY

- The frozen `prescriptionDoc` originates from `wodZiData`, fetched by
  `fetchWodZi` with `.eq('gym_id', gymId)` — the member's own gym only. A member
  cannot inject another gym's workout/prescription: there is no code path that
  reads a cross-gym `wods` row into `wodZiData`.
- `prescription_snapshot` is a derived jsonb column on the member's own
  `wod_logs` row (RLS: member-write / gym-read, unchanged). `wod_id` /
  `workout_section_id` on the same row are the frozen-target values, not
  member-supplied.
- No new RLS policy, no `SECURITY DEFINER`, no grant change in P9. Cross-gym
  tampering test = a code-path argument here + a to-be-run automated assertion in
  P11/P12 (owner-gated).

---

## K. TESTS

| Repo | Before P9 | After P9 |
|---|---|---|
| WOD-SIMPLE | 1015 | **1024** (+9; 9 pre-existing Deno-only file-load failures unchanged) |
| forge-admin-web | 1164 | **1166** (+2 parity) |

New (WOD-SIMPLE):
- `utils.test.js` — `freezeLoggingContext` captures `prescriptionDoc` by
  reference (immutable vs a later live edit); `frozenAt` recorded; `null` when no
  structured prescription.
- `prescriptionContract.test.js` "P9 — member resolution + snapshot from frozen
  doc" — male/female/unknown display lines (no male fallback); universal Row
  distance same for all vs sex-specific Row calories differ; `null` for a
  variant with no structured prescription; `variantKeyFromLevel` every spelling;
  repeated same movement → 40/47.5/55 resolved + instanceIds survive in the
  snapshot; snapshot RX variant identity + programmed-vs-resolved both
  recoverable + universal/sex-specific distinguishable + decimals survive;
  snapshot P1→P2 race unaffected by a later mutation.
- `prescriptionContract.parity.test.ts` (admin) — `resolveVariantDisplayLines` +
  `variantKeyFromLevel` parity.

Build (`vite build` / `vite build`), `tsc -b`, ESLint: **PASS, 0 errors** both
repos (11 pre-existing `Unused eslint-disable` warnings in App.jsx, unrelated).

Coverage of the owner's P9 matrix (1–28): items 1–14, 20–26 have direct
automated tests; 15 (no duplicate legacy badge) is covered by the display-object
`weightMale/Female: null` assertion path + the render change; 16–19 (legacy
unchanged, historical D→D+N, explicit `legacy_wod_id`, no date reconstruction)
ride the INC-03/INC-04 regression suite which still passes; 27 (cross-gym) and 28
(skill null) are §J / §I code-path arguments plus the skill-log path carrying no
snapshot key — a dedicated cross-gym automated assertion is P11/P12 (owner-gated).

---

## L. MANUAL ACCEPTANCE

**NOT PERFORMED — requires the owner** (no logged-in browser session in this
mission; "the user logs in, I navigate"). The owner must verify, on the live
PWA (after refresh to `app_version prescription-engine-p9-20260829`), using a
controlled structured test workout:

| Scenario | Pass criterion |
|---|---|
| **Male member** | Home card shows `@ 45 / 9 / 22.5 kg`, `15 Cal Row`; open logger → identical; save → `wod_logs.prescription_snapshot.movements[*].load.value` = 45/9/22.5, `.gender` = "male" |
| **Female member** | `@ 30 / 6 / 15 kg`, `12 Cal Row`; logger identical; snapshot `.load.value` = 30/6/15, `.gender` = "female" |
| **Unknown gender** | `@ 45/30`, `@ 9/6`, `@ 22.5/15`, `15/12 Cal Row` — never male-only |
| **Edit race** | female opens 30 kg → opens logger → coach edits workout to 35 kg female → logger still shows 30 → save → snapshot `.load.value` = 30, `.bothValues` = [45, 30] |
| **Historical date** | open old Date D → log on D+N → snapshot + `wod_id` (= `legacy_wod_id`) + `logged_at` all belong to W(D) |
| **Same movement ×3** | Power Clean 60/40, 70/47.5, 80/55 → female sees 40 / 47.5 / 55; snapshot keeps 3 distinct `instanceId`s |
| **No duplicate badge** | a structured workout shows no variant-level weight badge separate from the per-movement `@` values |

---

## M. PRODUCTION DATA

**Zero rows created / modified / deleted.** Verified live 2026-08-29 immediately
before and after deploy: `structured_wods = 0`, `wod_logs` with snapshot `= 0`,
`skill_logs` with snapshot `= 0`. No test writes were made to production.
`app_version.current` → `prescription-engine-p9-20260829` (the standard
PWA-refresh signal, not a data write).

---

## N. MIGRATIONS

**None.** P3a migration `20260829090000` already added
`wod_logs.prescription_snapshot` / `skill_logs.prescription_snapshot` (plain
`jsonb`, nullable, no constraint/trigger). No schema correction was discovered to
be required during P9.

---

## O. COMMITS

| Repo | Commit (message) |
|---|---|
| WOD-SIMPLE + admin | `fix(prescription): P9 pre-guard - regenerated legacy lines stay PLAIN` |
| WOD-SIMPLE | `feat(prescription): P9 - member resolution + frozen logger prescription + immutable snapshot` |
| forge-admin-web | `feat(prescription): P9 - resolveVariantDisplayLines + variantKeyFromLevel (shared contract)` |

(Exact hashes in each repo's `git log`.)

---

## P. OPEN ISSUES (real P9 issues only)

1. **Manual browser acceptance is outstanding** (§L) — this is the P9 acceptance
   gate. The automated + code-path evidence is strong (the App.jsx change is thin
   glue over the tested shared contract, and the freeze mechanism is the proven
   INC-04 one), but the owner's own verification of the edit-race and the
   snapshot contents on a live save is the standard for calling P9 done.

2. **Logger single "prescribed weight" field for a multi-load structured
   workout.** `prescribedWeightPentruLog` (used only for the real-time RX/Not-Rx
   badge and the `weight_logged` pre-fill) still reads the legacy global column
   (= the first load-bearing movement's value under the P9 pre-guard). For a
   workout with several different loads this is the *first* movement's load, not
   a per-movement comparison. The per-movement prescription is fully in the
   snapshot; a per-movement actual-vs-prescribed comparison is future work
   (mission Phase 6 / P10+), not a P9 defect. Disclosed, not hidden.

3. **`inlineLoad` stays `false`.** The regenerated `movements_{variant}` legacy
   text is a plain skeleton. The P9 structured renderer does not use it for a
   structured workout, so this is correct; a later phase may choose to also
   regenerate it with inline `@ x/y` for non-member legacy consumers. Not needed
   for P9. Disclosed.

4. **Cross-gym automated assertion + full P9 matrix items 27/28** are P11/P12
   (owner-gated). §J is the code-path argument; the skill-log path demonstrably
   writes no snapshot key.

No P9 defect is deferred as "P10 work". Items 2–4 are disclosed scoping
decisions; item 1 is the acceptance gate.

---

## HARD STOP

**P10 NOT STARTED.** `isNotRxd`, Journal, leaderboard historical classification
and performance readers are **unchanged** — they still resolve prescribed weight
live from `wods` for every log (snapshot or not). Switching them snapshot-first
is P10, awaiting the owner's review of P9 (member display + frozen logger +
snapshot write).
