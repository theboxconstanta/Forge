# Per-Movement Prescription Engine — P9.3 Movement Capability Integrity

Date: 2026-08-30
Status: **Full read-only audit + resolver hardening + 11-row data correction
complete. Deployed. HARD STOP — owner representative manual acceptance before
P10.** Companion to `..._P9_REPORT.md` / `..._P9_1_REPORT.md` / `..._P9_2_REPORT.md`.

---

## A. STATUS — **PASS** (code + catalog-wide automated integrity; awaiting owner spot-check)

The Wall Ball failure was a **resolver** bug (fragile display-name equality), not
bad catalog data. The catalog itself was audited end-to-end and found in good
shape — 11 deterministic corrections applied via a narrow migration. A
catalog-wide automated integrity test now guards all 465 rows in both repos.

---

## B. FULL CATALOG SUMMARY (live, project `sdfkvfbvgpuspnnnwqwk`, post-migration)

| Metric | Count |
|---|---|
| Total `movements` rows | **465** |
| Platform (`gym_id IS NULL`) | 465 |
| Gym-local | **0** |
| `allowed_prescription_metrics` non-empty | 408 |
| `allowed_prescription_metrics = {}` (legit: benchmark names, isometric holds, unclassified skills) | 57 |
| `default_prescription_metric` NOT ∈ `allowed` (invariant violations) | **0** |
| Deterministically classified & verified against expectation table | 48 representative + full self-resolution over all 465 |
| Deliberate duplicate rows (DB/Dumbbell, KB/Kettlebell, &/And) | 29 pairs — **kept**, resolved deterministically |
| Capability-DISAGREEING duplicate pairs | **1** (`Sledgehammer Strike` / `Strikes`) — fixed |
| Self-resolution failures (row → its own name → itself/cap-equal) | **0** after fix |
| Cross-repo semantic mismatches | **0** (shared module + shared snapshot, parity test) |
| Lookup failures for a known canonical id | **0** (id-first resolution) |

`allowed_prescription_metrics` combos (post-fix): `load+reps` 226 · `reps` 129 ·
`{}` 57 · `distance+load` 24 · `distance` 15 · `distance+calories` 9 · `calories` 0
(Air Bike moved to `distance+calories`).

---

## C. DEFECT LIST — every incorrect movement found

| id | name | before (allowed / default) | after | root cause |
|---|---|---|---|---|
| `73d372fe…` | Handstand Hold | `{reps}` / `reps` | `{}` / null | seed inconsistency — isometric time-hold; 7 sibling holds already `{}` |
| `2f8ba2ef…` | Hollow Hold | `{reps}` / `reps` | `{}` / null | same |
| `bc1596e0…` | L Sit | `{reps}` / `reps` | `{}` / null | same (matches existing `L-sit Hold`) |
| `ccbec918…` | Plank | `{reps}` / `reps` | `{}` / null | same |
| `d35f4ee9…` | Wall Sit | `{reps}` / `reps` | `{}` / null | same |
| `689e89de…` | Sledgehammer Strikes | `{}` / null | `{reps,load}` / `load` | plural duplicate of `Sledgehammer Strike` (`{reps,load}`) — the ONE cap-disagreeing pair in the catalog |
| `6fa1e269…` | Air Bike | `{calories}` / `calories` | `{distance,calories}` / `calories` | same fan bike as Assault/Echo/Bike Erg (all `{distance,calories}`) — Air Bike alone was calories-only |

Plus 4 **alias** additions (resolver can't derive these): `Row` += `rower` / `c2 row`
/ `concept2 row`; `Ski Erg` += `ski` / `skierg`; `Bike Erg` += `bikeerg`; `Run` +=
`running` / `jog`.

**No fuzzy blanket update.** Every change is an exact id with a stated before/after.

---

## D. WALL BALL ROOT CAUSE

The live `Wall Ball` row (`b6e1fec2…`) is **correct**: `allowed_prescription_metrics
= {reps,load}`, `default = load`. `Wall Ball Shot` and `Wall Ball Sit-up` are also
correct.

The failure was in the name matcher, identical in both repos
(`App.jsx` `matchRow` / `MovementCatalogProvider` `matchMovementRow`):

```js
const cands = [n, n.replace(/\bdb\b/,'dumbbell'), …, n.replace(/s$/,'')]
gymMovements.find(r => r.name.toLowerCase() === c || aliases.includes(c))
```

It only handled: lowercase, a single trailing "s", `db↔dumbbell`, `kb↔kettlebell`.
It did **not** collapse whitespace, hyphens, `&`, or interior plurals. So the
coach's `"Wallballs"` produced candidates `wallballs` / `wallball` — neither
equals `"wall ball"` (the space). Match failed → `resolveMovementCapability(null)`
→ `{allowed:[], default:null, unknown:true}` → no Load control. Because the row
already carried a `reps` spec (from paste or seeding), `MovementRowPWA` rendered
the reps editor with its Scheme toggle and, since `active.size > 0`, showed
neither "+ Load" nor "+ Add prescription" — exactly the screenshot.

This is a **class** of bug: `"Toes-to-Bar"`, `"Pull Ups"`, `"Handstand Push Up"`,
`"Chest to Bar"`, `"Farmer Carry"`, `"Clean and Jerk"` all failed the same way.

---

## E. CANONICAL IDENTITY ARCHITECTURE — before → after

### Before
- `capabilityFor(instance.name)` — re-resolved from **display text on every
  render**, even when `instance.canonicalMovementId` was set.
- Matcher: 6 hard-coded string candidates, exact `===` against row name/aliases.
- Manual name entry in **forge-admin-web** never set `canonicalMovementId` at all
  (WOD-SIMPLE's catalogfix had fixed its side; admin passed `null`).
- Legacy hydration never set an id.

### After (`prescriptionContract` — shared, byte-for-byte both repos)
- **`normalizeMovementName(s)`** — lowercase, `&`→`and`, `- _ / .`→space, strip
  quotes/parens/commas, collapse whitespace.
- **`movementNameKeys(name)`** — the ordered key set: normalized, space-stripped,
  depluralised-per-word, `db↔dumbbell` / `kb↔kettlebell`. Aliases indexed
  **exact** (no depluralisation — they are deliberate).
- **`buildMovementIndex(rows)`** → `{ byId, byKey, rows }`. Rows keep their own
  identity; **nothing is merged or deleted**.
- **`resolveCatalogMovementByName(index, name)`**:
  - one row for a key → that row
  - several rows that **agree** on capability signature → deterministic pick
    (shortest canonical name, then id) — the 29 DB/KB/& duplicates land here
  - rows that **disagree** on capability → `{ ambiguous: true, candidates }` → the
    UI shows Review / unknown, never a wrong silent pick
  - nothing → `null`
- **`resolveCatalogMovementForInstance(index, instance)`** — **id-first**: a
  persisted `canonicalMovementId` resolves the row directly (`byId`), display
  text is only the fallback for a never-resolved instance. **Identity is never
  re-derived from text once an id is known.**
- **`resolveInstanceCapability`**, **`backfillInstanceIdentity`** (fill ids at
  save for deterministic names), **`assertCapabilityIntegrity`** (dev/test
  invariant, §"scheme masking" below).

### Lookup priority (both repos, every entry path)
1. `instance.canonicalMovementId` → `index.byId` (O(1), exact)
2. deterministic normalized-name resolution
3. ambiguous → Review/unknown (never guessed)
4. none → unknown → "+ Add prescription"

---

## F. ALIAS / DUPLICATE GROUPS

- **29 duplicate name pairs**: `DB X` ⇄ `Dumbbell X` (19), `KB X` ⇄
  `Kettlebell X` (9), `Clean & Jerk` ⇄ `Clean And Jerk` (1). Every pair has
  **identical capability** → resolved deterministically (capability-safe), rows
  untouched. Merging them is a future catalog-cleanup project (explicitly out of
  scope here).
- **1 capability-disagreeing pair**: `Sledgehammer Strike` `{reps,load}` vs
  `Sledgehammer Strikes` `{}` → aligned by migration. Now a safe duplicate.
- `Wall Ball` / `Wall Ball Shot` / `Wall Ball Sit-up` — genuinely distinct
  movements, NOT a collision (aliases `wb` / `wbs` stay exact).
- 50 rows carry aliases (mostly 2-letter abbreviations: `pc`, `dl`, `hspu`, …) —
  all now resolve to their own row.

Machine-readable: `src/movementCapabilitySnapshot.json` (both repos) — id / name /
aliases / allowed / default for all 465 rows.

---

## G. CAPABILITY CORRECTIONS — exact DB rows

Migration `supabase/migrations/20260830100000_p9_3_movement_capability_integrity.sql`
— 7 capability UPDATEs + 4 alias UPDATEs, each guarded by a `WHERE
allowed_prescription_metrics = <before>` so a re-run is a no-op. Verified live
(§C table). Reversible (DOWN block in the file). `movements_default_prescription
_metric_subset` CHECK holds before and after every row.

**Production data touched: 11 `movements` rows (platform tier). Zero `wods`,
`wod_logs`, `skill_logs`, `prescription_snapshot` rows.** No backfill.

---

## H. CODE CORRECTIONS

### `prescriptionContract` (shared — `src/prescriptionContract.js` ⇄ `src/features/programming/prescriptionContract.ts`)
`normalizeMovementName`, `movementNameKeys`, `buildMovementIndex`,
`resolveCatalogMovementByName`, `resolveCatalogMovementForInstance`,
`resolveInstanceCapability`, `backfillInstanceIdentity`, `assertCapabilityIntegrity`
(+ TS types `CatalogMovementRow` / `MovementIndex` / `CatalogMatch`).

### WOD-SIMPLE
- `src/App.jsx` — `movementCatalog` builds a `buildMovementIndex`; `matchRow` now
  uses `resolveCatalogMovementByName`; new `capabilityForInstance` / `resolveId` /
  `backfillIdentity` / `index`. `MovementRowPWA` capability is id-first
  (`capabilityForInstance(instance)`). `MovementRowListPWA` runs
  `assertCapabilityIntegrity` in dev. `saveWod` / duplicate / template paths pass
  `movementCatalog.index` to `sectionsFromLegacyWod` + `legacyPayloadFromSections`.
- `src/wodSections.js` — `hydrateInstancesFromLegacy(lines, weight, movementIndex?)`
  assigns canonical ids on reload for deterministic names;
  `legacyPayloadFromSections(sections, { movementIndex })` backfills ids at save;
  `sectionsFromLegacyWod(w, { movementIndex })` threads it.
- `src/movementCapabilitySnapshot.json` (new) · `src/movementCapabilityIntegrity.test.js` (new)

### forge-admin-web
- `MovementCatalogProvider.tsx` — index-based `matchMovementRow`; new
  `capabilityForInstance` / `movementIndex` / `backfillIdentity` on the context.
- `movementCatalogContext.ts` — context type additions.
- `MovementRow.tsx` — id-first `cap`; `changeName` resolves + persists the
  canonical id via a new `resolveCanonicalId` prop (was always `null`).
- `MovementRowList.tsx` — threads `capabilityForInstance` / `resolveCanonicalId`;
  dev `assertCapabilityIntegrity`.
- `sectionEditing.ts` — `hydrateInstancesFromLegacy` / `sectionsFromWodRow` /
  `legacyPayloadFromSections` gain the optional `movementIndex`.
- `mutations.ts` — `saveWorkoutSections(…, movementIndex?)`.
- `EditWorkoutDialog.tsx` + `useMovementIndex.ts` (new) — supplies the index to
  the save pipeline (it lives above `MovementCatalogProvider`).
- `movementCapabilitySnapshot.json` (new) · `movementCapabilityIntegrity.test.ts` (new)

---

## I. FULL CATALOG TEST

`movementCapabilityIntegrity.test(.js/.ts)` — iterates the checked-in 465-row
snapshot with the shipped resolver:
1. **invariant** — `default` ∈ `allowed` OR null, for every row (mirrors DB CHECK).
2. **every allowed metric** ∈ `reps|load|distance|calories`.
3. **self-resolution** — every row's own name (and every alias) resolves to
   itself or a capability-equal duplicate. **0 failures.**
4. **expectation table** — 48 representative deterministic movements
   (barbell / DB-KB / wall ball / gymnastics / erg / run / carry / holds /
   the sledgehammer pair) asserted metric-exact. A future seed change that
   breaks e.g. Deadlift fails here.
5. **Wall Ball class** — 7 spellings all → `Wall Ball` with `load`.
6. **id-first** — a drifted name with a persisted id still resolves.
7. **ambiguity** — capability-disagreeing rows → `{ambiguous:true}` (synthetic).
8. **dev invariant** — `assertCapabilityIntegrity` throws for a poisoned row.

Failures **before**: catalog had 7 wrong rows + resolver missed ~30 % of realistic
coach spellings. **After**: 0 / 0.

---

## J. BUILDER CONTROL MATRIX (derived from the resolver — deterministic movements)

| Movement family | Expected controls | Result |
|---|---|---|
| Power Clean / Snatch / Deadlift / Thruster / C&J / Front-Back-OH Squat / Presses / Jerks | reps + **Load M/F** | PASS |
| DB Snatch / DB Thruster / Goblet Squat / KB Swing / Kettlebell Swing | reps + **Load M/F** | PASS |
| **Wall Ball / Wall Ball Shot** (all 7 spellings) | reps + **Load M/F**, **no height** | PASS |
| Burpee / Pull-up / C2B / T2B / Push-up / Air Squat / HSPU / Muscle-up / Double Under | **reps only** | PASS |
| Row / Ski Erg / Bike Erg / Assault Bike / Echo Bike / **Air Bike** | **Distance ∣ Calories** chooser | PASS |
| Run / Shuttle Run / Swim / Sprint | **Distance** | PASS |
| Farmers / Sandbag / Suitcase / Overhead Carry | **Load + Distance** | PASS |
| Plank / Wall Sit / Handstand Hold / Hollow Hold / L Sit | "+ Add prescription" (explicit unknown — time lives in the section) | PASS |
| Benchmark names (Fran, Cindy, …) / unclassified skills | "+ Add prescription" | PASS (explicit unknown, not a defect) |

Deterministic-movement FAIL count: **0**.

---

## K. QUICK PASTE

`parsePastedMovementLine`'s internal `num()` already routes through the shared
numeric parser (P9.2). Its `lookupCanonical` hook is wired to the same
`resolveCatalogMovementByName` in both repos, so a pasted `"20 Wallballs @
9/6kg"` now resolves to `Wall Ball` and the row carries `canonicalMovementId`.
Ambiguous text still yields a Review chip; no invented movement. The id is
**not** discarded afterwards — `MovementInstance.canonicalMovementId` is a plain
field carried through save / render / snapshot.

---

## L. LEGACY HYDRATION

`hydrateInstancesFromLegacy(lines, weight, movementIndex)` — for each parsed
line, if the name resolves **deterministically** it assigns the canonical id;
**ambiguous names stay id-less** (never guessed) and fall to Review/name
resolution. On the coach's next save, `legacyPayloadFromSections({ movementIndex })`
runs `backfillInstanceIdentity` → any still-id-less instance whose name is now
deterministic gets its id persisted. **A movement is thereafter identified by id,
not text.**

---

## M. GYM-LOCAL CUSTOM MOVEMENTS

0 gym-local rows exist today. The design is unchanged and safe: a gym row is
indexed by its own id + name like any platform row; `resolveCatalogMovementBy
Name` never maps a custom movement onto a similarly-named platform row unless
their **capability signatures are identical** (in which case the coach gets
correct controls either way). No cross-gym leakage — `fetchMovementsForGym`
already scopes to `gym_id = this OR NULL`.

---

## N. CROSS-REPO PARITY

Both repos import the **same** `prescriptionContract` resolver (byte-for-byte)
and the **same** `movementCapabilitySnapshot.json`. `movementCapabilityIntegrity
.test` runs identically in each. **0 semantic mismatches** — a movement id
produces the same capability signature in forge-admin-web and WOD-SIMPLE.

---

## O. REGRESSION

- **P9.2 decimal input** — untouched. `resolveNumericInput` / `NumField` /
  `PmpeNumField` unchanged; parity + `MovementRow` decimal tests green.
- **P9 / P9.1 frozen logger** — untouched. `freezeLoggingContext`,
  `snapshotPrescriptionDoc`, `buildPrescriptionSnapshot`, logCtx immutability
  tests all green. A `canonicalMovementId` now more reliably present on the
  instance only *improves* the snapshot's identity fidelity.
- **No male fallback** — `resolveAthleteGenderKey` / `resolveSpec` untouched.
- **V2 mirror** — `movementObjectsForV2` unchanged; still one-way; `canonicalName`
  = `mv.canonicalMovementId`, now more often populated.
- **No date reconstruction**, **business date ≠ submission timestamp**,
  **repeated instances distinct** — all untouched.
- **Legacy-only workouts** — byte-identical fallback; `movementIndex` is optional
  everywhere (null → prior behavior).
- **P9.1 catalogfix** (`movementCatalog` prop threading) — preserved and
  strengthened.

---

## P. TEST COUNTS

| Repo | before | after | added |
|---|---|---|---|
| forge-admin-web | 1231 | **1272** | +41 (`movementCapabilityIntegrity.test.ts`) |
| WOD-SIMPLE | 1099 | **1171** | +72 (`movementCapabilityIntegrity.test.js`) |

- forge-admin-web: 1272 pass · `tsc -b` clean · `vite build` clean · `eslint` clean.
- WOD-SIMPLE: 1171 pass · `vite build` clean · `eslint` 0 errors (11 pre-existing
  unrelated warnings) · the **9 pre-existing Deno-only `supabase/functions/*`
  `@std/assert` failures** are unchanged and unrelated.

---

## Q. MIGRATIONS

One: `20260830100000_p9_3_movement_capability_integrity.sql` — applied live,
verified, reversible. 11 `movements` rows (7 capability + 4 alias). No schema
change, no trigger change, no RLS change.

---

## R. PRODUCTION DATA

**11 platform `movements` rows modified** (ids in §C). **Zero** `wods`,
`workouts`, `workout_sections`, `wod_logs`, `skill_logs`, `prescription_snapshot`
rows touched. No historical backfill. No catalog rows deleted or merged.

---

## S. COMMITS

| Repo | Message |
|---|---|
| WOD-SIMPLE | `fix(prescription): P9.3 - deterministic canonical movement identity + catalog capability integrity` |
| forge-admin-web | `fix(prescription): P9.3 - deterministic canonical movement identity + catalog capability integrity` |

`app_version.current` = `prescription-engine-p9-3-movement-identity-20260830`.

---

## T. OWNER MANUAL SPOT-CHECK (live iPhone PWA — ~12 movements, NOT 465)

Hard-refresh to `…p9-3-movement-identity-20260830`. Metcon builder, add each and
check the controls:

| # | Type it as | Expect |
|---|---|---|
| 1 | **Wallballs** | reps + **Load M/F (kg)**, no height |
| 2 | **Wall Ball Shots** | reps + Load M/F |
| 3 | **Power Clean** | reps + Load M/F |
| 4 | **Dumbbell Snatch** | reps + Load M/F |
| 5 | **Kettlebell Swings** | reps + Load M/F |
| 6 | **Toes-to-Bar** (with hyphen) | reps only |
| 7 | **Pull Ups** (two words) | reps only |
| 8 | **Burpees** | reps only |
| 9 | **Rower** | Distance ∣ Calories chooser |
| 10 | **Echo Bike** | Distance ∣ Calories |
| 11 | **Running** | Distance |
| 12 | **Farmers Carry** | Load + Distance |
| 13 | **Plank** | "+ Add prescription" (no reps field) |
| 14 | a made-up name (`Zniffle Press`) | "+ Add prescription" (explicit unknown, not silently reps) |

Then: enter a decimal load (`9,5` / `6,5`) on Wallballs → saves `9.5 / 6.5`
(P9.2 regression check). Save, reload → controls + values unchanged. Open as a
male / female / no-gender member → correct per-side display, no male fallback.

Owner does **not** need to test every movement — the catalog-wide automated test
proves the rest.

---

## U. OPEN ISSUES

1. **Owner representative spot-check (§T)** — the remaining gate.
2. **29 duplicate rows** (DB/Dumbbell, KB/Kettlebell, &/And) remain in the
   catalog. Deterministically resolved (capability-safe), not a defect. Merging
   them is a separate future catalog-cleanup project — explicitly out of P9.3
   scope ("Do NOT merge rows automatically. Do NOT delete catalog rows.").
3. **Ambiguous/unclassified rows** (~57 `{}`): benchmark WOD names polluting the
   catalog (Fran, Cindy…), a few genuinely ambiguous skills (Bear Crawl,
   Broad Jump, Med Ball Run, Assault Runner). Left as **explicit unknown** — the
   builder shows "+ Add prescription", which is correct and non-misleading. Not
   guessed.
4. `weight_logged` Home pre-fill still reads the legacy first-load column
   (carried from P9.1 §J) — unchanged.

No deterministic capability defect is deferred to "future cleanup."

---

## HARD STOP

**P10 NOT STARTED.** `isNotRxd` / Journal / leaderboard historical
classification / performance readers still resolve prescribed weight live from
`wods`. P10 (snapshot-first) begins only after the P9.1 / P9.2 / P9.3 reviews
pass **and** owner manual acceptance passes.
