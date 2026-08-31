# P9.5.6 — GLOBAL RESULT CLASSIFICATION CONTRACT

**Variant / prescription status is independent from completion status.**

**Status:** CLOSED — SHIPPED LIVE 2026-08-31.
**Commits:** WOD-SIMPLE `af09ee7` (fix) + report; forge-admin-web `ce4121b` (badge wording).
**Bundle:** `assets/index-Bd7SHSNx.js`. **app_version:** `variant-prescription-completion-p956-20260831`.
**DB / schema / migration / backfill / historical-row mutation:** 0.
**Score / ranking change:** 0.

---

## A. Owner-observed bug

Production row `wod_logs.9dffb7ce` — **Adrian Ionascu**, workout **3 RFT**, selected
variant **RX**, followed the RX prescription, completed **2 of 3 rounds**
(`completion_state='capped'`, `time_result=null`, `result='2 runde complete'`,
`weight_logged='9'`, `performed_prescription=null`).

The UI showed **"Not RX'd"** while *also* showing **VARIANT: RX** and
**"2 rounds complete"** — three internally-contradictory statements. The athlete
did not change the workout; he simply did not finish all programmed work.

## B. Root cause

`workoutFormats.js` `isNotRxd()`:

```
isNotRxd = resultCompositionModified(log, prescribedWeight, loggedMovements, prescribedMovements)
         || ( effectiveScoreMode(formatId, config) === 'fortime_or_amrap' && !log.time_result )
```

The second term — **"did not finish inside the time cap"** — is a **COMPLETION**
signal (AXIS C) ORed into the **PRESCRIPTION-MODIFICATION** badge (AXIS B). For
Adrian: `effectiveScoreMode('RFT',{rounds:3})='fortime_or_amrap'`, `time_result`
is null → the term is `true` → the badge fired, even though
`resultCompositionModified(...) = false`.

**This is GLOBAL.** Every capped / unfinished result of a `fortime_or_amrap`
format (For Time · RFT · Ladder · Chipper · Partner-WOD-ForTime), on **any**
variant, carried a false badge. Live DB at fix time: e.g. `dc2568e8` (Test,
RFT RX capped), `9e8b0e60` (Stelian, RFT RX capped), `38a535eb` (Lavinia, RFT
RX "10 runde complete" capped), plus many pre-`completion_state` Intermediate
rows (`c9b9e9ae`, `981d2bbb`, `c5c844ef` …).

## C. Exact old "Not RX'd" logic vs. the fix

| | before | after |
|---|---|---|
| badge helper | `isNotRxd(log, pw, formatId, config, lm, pm)` | **deleted** |
| badge value | `resultCompositionModified(...) \|\| neterminatInTimp` | `resultCompositionModified(log, pw, lm, pm)` |
| bucket (`isMixedCategory`) | `resultCompositionModified(...)` | unchanged |
| benchmark-history badge (`resultIsCompositionModified`) | `resultCompositionModified(...)` via provenance | unchanged (was already correct) |

Badge, bucket and history badge are now **one rule**; they can never disagree.

## D. Canonical 3-axis model (now enforced)

| axis | question | source |
|---|---|---|
| **A — PROGRAMMED VARIANT** | which programmed version did the athlete choose? | `wod_logs.variant_level` (`RX` / `Intermediate` / `Beginner` / `OnRamp` / future custom) — identity, never changed by completion or modification |
| **B — PRESCRIPTION STATUS** | did they perform that variant *as prescribed*? | `resultCompositionModified(log, prescribedWeight, loggedMovements, prescribedMovements)` |
| **C — COMPLETION / PERFORMANCE** | how much did they complete / what score? | `completion_state` (`completed`/`capped`/`null`), `time_result`, `result` ("2 runde complete"), rounds, magnitude |

Axis B reads **nothing** from axis C.

## E. Programmed-variant semantics (AXIS A)

`variant_level` is a **fixed enum** — `NIVELE` / `VARIANTE_CONFIG` /
`NIVELE_OFICIALE = ['RX','Intermediate','Beginner','OnRamp']`. Not coach-defined,
not dynamic. The Builder (forge-admin-web) generates exactly these four scaling
tiers. `variantKeyFromLevel` normalises spelling to `rx|intermediate|beginner|onramp|null`.

The selected variant **survives logging unchanged** — completion / partial
rounds / score never rewrite it. `resolveResultProvenance` (P10) never mutates it.

## F. Prescription-modification semantics (AXIS B)

`resultCompositionModified` = **exactly three** read-time signals, **all relative
to the SELECTED variant**:

1. `greutateEsteSubStandard(weight_logged, prescribedWeight)` — logged weight
   **below the selected variant's standard**. `prescribedWeight` is resolved by
   `resolveResultProvenance` from the log's **own frozen `prescription_snapshot`**,
   which was built for the frozen selected variant (`buildPrescriptionSnapshot({
   variantKey: variantKeyFromLevel(varianta.nivel) })`). An Intermediate athlete
   at the Intermediate load is **As Prescribed** — it is never compared to RX.
2. `movementsChanged(loggedMovements, prescribedMovements)` — the logged movement
   list differs from the prescribed one.
3. `performed_prescription != null` — a material P9.5.2 performed overlay (a
   per-movement load/distance/calorie change or a canonical substitution; a
   clone of the *selected* variant's instances).

It takes **no variant argument** and contains **no `variant === 'RX'` branch**
(`resultCompositionModified.length === 4`, all data). It looks at **no**
completion / time / rounds / score field.

## G. Completion semantics (AXIS C)

`completion_state` ∈ `completed` | `capped` | `null`, persisted by
`composeWodLogFields` / `deriveDurationCompletionState` for the finished/capped
Duration formats only. Shown **separately**: as the result text ("2 runde
complete"), and on benchmark history as its own `capped` badge
(`log.completion_state === 'capped'`). **Not touched by this fix** (§16/§17
preserved).

## H. Current variant architecture discovered

Fixed 4-tier enum (see §E). `wod_logs.variant_level` stores the capitalised
display string. Free logs store a format name there and never render a badge
(`_supportsRx:false` / no `wod_id` / no prescribed data → `resultCompositionModified`
returns `false`). No hybrid, no coach-defined variants today.

## I. RX behaviour

- RX + As Prescribed + Finished → **RX**, no badge.
- RX + As Prescribed + Capped → **RX**, no badge, "did not finish" shown as the score/`completion_state`.
- RX + As Prescribed + Incomplete (Adrian) → **RX**, no badge, "2 rounds complete". **[was: "Not RX'd"]**
- RX + Modified (any completion) → **Mixed Categories** bucket, **"Not RX'd"** badge.

## J. Intermediate behaviour

- Intermediate + As Prescribed + any completion → **Intermediate** tier, **no badge** (never "Not RX'd").
- Intermediate + Modified + any completion → **Mixed Categories** bucket (sub-label *Intermediate*), badge reads **"Modified"** (not "Not RX'd" — it was never an RX attempt).

## K. Beginner behaviour · L. OnRamp behaviour

Identical to §J with the tier name substituted. Beginner/OnRamp + As Prescribed +
Incomplete → that tier, no badge. Beginner/OnRamp + Modified → Mixed Categories
(sub-labelled), "Modified" badge.

## M. Future / custom variant behaviour

`resultCompositionModified` is variant-name-agnostic → a hypothetical
`MASTERS` / `SCALED` / `TEENS` variant inherits the contract with **no new
conditional**. `NotRxdBadge` wording is `String(variant ?? 'rx').toLowerCase()
.replace(/[_\s-]/g,'') === 'rx'` → any non-`rx` key shows **"Modified"**. Proven
by the `CUSTOM_TEST` fixture (test-only).

## N. Cross-format matrix (all in `src/p956VariantPrescriptionCompletion.test.js`)

| family | unmodified result | modified result |
|---|---|---|
| For Time (finished / capped) | As Prescribed | Modified |
| RFT (all rounds / partial) | As Prescribed | Modified |
| AMRAP (partial round is normal) | As Prescribed | Modified |
| REPS (low / high / zero score) | As Prescribed | Modified |
| LOAD (achieved 40 / 80 / 200 kg as score) | As Prescribed — **the achieved-load score is never compared to a movement load** | Modified (via overlay / movement) |
| DISTANCE (achieved metres as score) | As Prescribed | Modified |
| CALORIES (achieved cal as score) | As Prescribed | Modified |
| SETS / Intervals (INC-06 preserved; low reps / zero reps in one interval) | As Prescribed | Modified (performed overlay) |

Score magnitude / rounds count / time / DNF **never** move axis B — property-
tested for every variant.

## O. Leaderboard grouping audit

**Model = hybrid (D).** Primary grouping is by selected `variant_level` (RX,
Intermediate, Beginner, OnRamp tiers). Any **composition-modified** result of any
tier is pulled into a shared **"Mixed Categories"** block, sub-labelled by origin
tier (`_nivelOriginal`). After P9.5.6, a merely incomplete/capped result is **not**
composition-modified, so it stays in its variant tier (verified live: Adrian in
the RX tier, Ergun in the Intermediate tier, only the performed-overlay "Test"
row in Mixed Categories).

**Not redesigned (§39).** Whether "Mixed Categories" is the ideal long-term
container for a *modified non-RX* result (vs. e.g. an "Intermediate — Modified"
sub-group) is a **product decision**, deferred. The variant information is
preserved via the sub-label. The completion-vs-prescription bug is fixed
independently of any grouping change.

## P. Badge audit

| surface | before | after |
|---|---|---|
| Leaderboard card badge (`resultModifiedLog`) | `isNotRxd` (had completion term) | `resultCompositionModified`, variant-aware label |
| Leaderboard bucket (`isMixedCategory`) | already composition-only | unchanged |
| Jurnal card badge (`resultModifiedLog`) | `isNotRxd` | `resultCompositionModified`, variant-aware label |
| Share popup badge (`resultModified` key) | `isNotRxd` | `resultCompositionModified`, variant-aware label |
| Benchmark-history badge (`resultIsCompositionModified`) | already composition-only | +variant-aware label |
| Benchmark-history "capped" badge (`completion_state==='capped'`) | separate axis | unchanged |
| forge-admin-web `ResultRow` badge (`rxStatus==='not_rx'`) | weight-only classification (already completion-independent) | +variant-aware wording |

## Q. Journal audit

`JurnalList` computed `notRxdLog` via `isNotRxd` → **BUG** (same completion term).
Fixed to `resultModifiedLog = resultCompositionModified(w, prescribedWeightLog,
miscariAfisate, prescribedMovementsLog)` (`prescribedWeightLog`/`prescribedMovementsLog`
already resolved from the log's own frozen provenance, P10). Same rule as the
leaderboard. P9.5.5 performed-movement rendering untouched.

## R. Share audit

`WorkoutSharePopup` `notRxd` field (renamed `resultModified`) was `isNotRxd(...)`
→ **BUG**. Fixed to `resultCompositionModified({ ...logFields, performed_prescription:
performedToSave }, prescribedWeight, miscariFinale, prescribedMovements)`.
`prescribedWeight` for a structured workout is the frozen structured standard for
the selected variant (P9.1). Movements / score / INC-06 share derivation
untouched.

## S. History audit

`resolveResultProvenance` (P10) — untouched, snapshot-first. Benchmark history
already classified composition-only (`resultIsCompositionModified`) and shows the
`capped` badge on its own axis. Completion alone still does not alter historical
prescription status. **P10 remains CLOSED.**

## T. Exact files changed

| repo | file | change |
|---|---|---|
| WOD-SIMPLE | `src/workoutFormats.js` | **delete `isNotRxd`**; expanded `resultCompositionModified` / `isMixedCategory` doc comments (bodies unchanged) |
| WOD-SIMPLE | `src/App.jsx` | 3 badge call sites → `resultCompositionModified`; `NotRxdBadge` variant-aware; 4 `<NotRxdBadge>` call sites pass `variant`; stale comments |
| WOD-SIMPLE | `src/translations.js` | +`modifiedBadge` (`Modificat` / `Modified`) |
| WOD-SIMPLE | `src/FormatLogger.jsx` | comment fixes only |
| WOD-SIMPLE | `src/p956VariantPrescriptionCompletion.test.js` | **new (81)** |
| WOD-SIMPLE | `workoutFormats.test.js` · `p954LeaderboardClassification.test.js` · `p10HistoricalResultTruth.test.js` · `performedPrescription.test.js` | updated to the new contract |
| forge-admin-web | `src/features/results/ResultRow.tsx` + `.test.tsx` | variant-aware "Not RX'd" / "Modified" wording |

## U. DB impact

**None.** No migration, schema, trigger, view, function, backfill, or historical
row mutation. `app_version` bump is the only DB write (deploy ritual). Adrian's
row and every affected row render correctly after deploy with **no data change**.

## V. Test results

- `src/p956VariantPrescriptionCompletion.test.js` — **81 pass**: §35 full
  VARIANT×MODIFIED×COMPLETION truth table (RX/Int/Beg/OnRamp/**CUSTOM_TEST**),
  §70 completion-independence property (verdict identical across finished / capped /
  incomplete / partial / zero for every variant), §71 variant-independence
  property + `resultCompositionModified.length === 4`, §13/§14/§15 relative-to-
  selected-variant, §31 LOAD score never compared, §56-63 every score family,
  §64-69 named owner fixtures (Adrian + Intermediate/Beginner/OnRamp/custom),
  §64/§68 no-overcorrection, wiring assertions (`isNotRxd` gone, no completion
  term in `resultCompositionModified`, one `isMixedCategory` call site, variant-
  aware label, no athlete/date special case).
- Full WOD-SIMPLE suite: **1545 pass** (1462 + 81 new + 2 net from updates),
  **9 pre-existing Deno `@std/assert` file-load failures unchanged**. eslint
  0 errors. `vite build` OK.
- forge-admin-web: `tsc -p tsconfig.app.json` **0 errors**; `src/features/results`
  suite **376 pass** (incl. new `ResultRow` "Modified" test).

## W. Production acceptance

Live prod (`assets/index-Bd7SHSNx.js`, hard reload), 2026-08-31 RFT 15:00 leaderboard:

| # | check | result |
|---|---|---|
| 1 | `isNotRxd` absent from prod bundle | ✓ (`grep -c` = 0) |
| 2 | `modifiedBadge` / `Modificat` in bundle | ✓ |
| 3 | Adrian Ionascu (RX, followed RX, 2/3 rounds) | **RX tier, rank #5, "2 runde complete", NO badge** ✓ |
| 4 | Adrian expanded card | VARIANT: RX · WEIGHT: 9 · movements unchanged · RESULT: "2 runde complete" · no badge ✓ |
| 5 | RX tier finishers (Alina/Lavinia/Cosmin/Corina) | in RX tier, no badge ✓ |
| 6 | Ergun Curtseit (Intermediate, finished) | **Intermediate tier, no badge, not "Not RX'd"** ✓ |
| 7 | "Test" (RX, `performed_prescription` overlay, capped) | **Mixed Categories bucket + "Not RX'd" badge** — a genuine modification still flagged ✓ (no overcorrection) |
| 8 | badge / bucket consistency | RX-tier rows no badge; Mixed row badged — never contradictory ✓ |
| 9 | console errors | none ✓ |

**Owner §75 BEFORE → AFTER:** `RX · Not RX'd · 2 rounds complete` → `RX · 2 rounds complete`.

## X. Commit · Y. Bundle · Z. app_version

- Commit: WOD-SIMPLE `af09ee7`; forge-admin-web `ce4121b`.
- Bundle: `https://forge-delta-ivory.vercel.app/assets/index-Bd7SHSNx.js`, deploy `ELMkMW1bxWDi1Zo2LhPxeBRvqoz2`.
- app_version: `variant-prescription-completion-p956-20260831` (`app_version.current`, live `updated_at 2026-08-31 17:33Z`).

## AA. Remaining limitations / product decisions

1. **Non-RX movement substitution outside the performed-overlay flow.** The
   `snapshot_wod_log_context` trigger only freezes the **RX** movement list
   (`movements_snapshot := to_jsonb(w.movements_rx)`), and P10's Option-A resolver
   reads `movements_snapshot` only for `variant_level === 'rx'` (to avoid
   comparing a non-RX result against RX movements — §13). So a
   Beginner/Intermediate/OnRamp athlete who **retypes** a movement in the free
   movement list (not via the structured performed-edit flow) is **not** flagged
   Modified. Detected correctly when the change goes through
   `performed_prescription` (the common path). Fully closing this needs a
   **per-variant movement snapshot = a schema/trigger change** → out of scope
   (§7 / §86.A). No regression: the fix only removed the completion term.
2. **"Mixed Categories" grouping for modified non-RX results** — kept as-is
   (§39). A variant-aware grouping model (e.g. per-tier "Modified" sub-group) is
   a product decision, deferred; the variant is preserved via the sub-label.
3. **Legacy rows with no frozen prescription** (P10 Option A) — `prescribedWeight`
   is `null`, so the weight term is skipped; a legacy result is classified
   Modified only via `movements_snapshot` (RX) or `performed_prescription`.
   Incomplete performance is **never** used as a proxy for modification (§54).

---

## Required final confirmation

**Forge now treats programmed variant, prescription modification, completion
status, and performance score as independent result dimensions. The
classification is data-driven and is not hard-coded to RX, Intermediate,
Beginner, OnRamp, any athlete, any workout, or any score format.**

## HARD STOP

Audit → root-cause proof → canonical 3-axis contract → minimal shared fix
(`isNotRxd` deleted; one rule `resultCompositionModified` for badge + bucket +
history; variant-aware wording) → cross-variant + cross-format tests → full
regression → build → deploy → production acceptance (Adrian: RX / As Prescribed /
2 rounds complete, no false badge) → report. **Stopping. P10 CLOSED. INC-06
CLOSED. No unrelated phase started. No leaderboard grouping redesign.**
