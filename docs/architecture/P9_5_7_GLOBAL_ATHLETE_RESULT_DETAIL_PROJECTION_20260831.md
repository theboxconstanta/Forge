# P9.5.7 — GLOBAL ATHLETE RESULT DETAIL PROJECTION

**Expanded result cards show WHAT THE ATHLETE ACTUALLY PERFORMED.**

**Status:** CLOSED — SHIPPED LIVE 2026-08-31.
**Commits:** WOD-SIMPLE `c03329d`; forge-admin-web `a2a7e4c`.
**Bundle:** `assets/index-YU_UyZ__.js`. **app_version:** `result-detail-projection-p957-20260831`.
**DB / schema / migration / backfill / historical-row mutation:** 0.
**Score / ranking / classification change:** 0.

---

## A. Owner-observed inconsistency

- **Modified RX result** ("Test", 3 RFT) — expanded card correctly shows the
  performed movements: `15 Wallballs @ 9 kg · 15 Sumo DL high-pull @ 35 kg ·
  15 Box jumps · 15 Push Press @ 23 kg` + `RESULT 1 round + 23`.
- **Unmodified Intermediate result** (Ergun, 3 RFT) — expanded card shows only
  `VARIANT: Intermediate` + `RESULT: 3 rounds complete · 20:00`. **The movement
  section is gone.**

## B. Exact root cause

Every athlete-result movement surface (leaderboard expanded card, Journal card,
share card) rendered:

```
cardMovementLines = resultPerformedLines(log) ?? miscariAfisate
```

- `resultPerformedLines(log)` returns `null` when `performed_prescription` is
  NULL (P9.5.5 — "performed as programmed").
- `miscariAfisate` = `parseWodLogDetails(log).miscariAfisate` — the movement
  lines parsed out of `wod_logs.notes` (first `\n---\n` segment, minus the
  format-header line).

For a **structured** workout whose legacy `wods.movements_<variant>` column is
empty — i.e. the coach built the workout at **RX only**
(`movement_prescriptions.variants = { rx }`, section `scaling_versions = []`,
`movements_intermediate/beginner/onramp = []`) — `saveWodLog`'s `miscariFinale`:

```
const cheieVarianta = VARIANTE_CONFIG[variantaAleasa].key   // 'movements_intermediate'
const miscariWodZi  = logWodZiData?.[cheieVarianta] ? … : []   // []  (column empty)
const miscariFinale = miscariWodZi.length > 0 ? miscariWodZi : wodMiscari   // []
```

`miscariFinale` never falls back to the logger's resolved structured lines, so
`notes` is written as just `"RFT · 15:00"` → `miscariAfisate = []` → **nothing to
render**, and NULL `performed_prescription` was treated as "no detail to show"
rather than "show the programmed prescription."

## C. Why the modified result worked

`performed_prescription != null` → `resultPerformedLines` →
`composePerformedResultLines` returns the full performed movement list (a full
clone of the selected variant's instances, per-movement edits + substitutions
applied), so the modified card always had its lines.

## D. Why the unmodified Intermediate result failed

`performed_prescription == null` → fell to `miscariAfisate`, which was `[]` for
this class of log (§B). No tier below `notes` was ever consulted.

## E. `performed_prescription` contract

- **NULL** = performed as programmed (P9.5.2). Only written when the athlete's
  performed overlay MATERIALLY differs from the frozen programmed prescription
  (`performedIsModified` gate).
- **Non-NULL** = `{ version:1, variantKey:'rx'|…, source:'performed', sectionId,
  movements:[ MovementInstance… ] }`. It is a **FULL performed document** (not a
  sparse overlay) — every movement instance is present. Athlete-edited metrics
  are stored `{mode:'universal', value, unit}`; untouched metrics keep their
  `{mode:'sex_specific', male, female, unit}` spec and resolve against the
  FROZEN gender at display. Preserves `instanceId`, `canonicalMovementId`,
  `substitutedFrom`. **Sufficient to render without the current WOD.**
  `variantKey` must be one of `rx|intermediate|beginner|onramp`
  (`validatePerformedPrescription`) — it mirrors a real scaling key, never the
  free-text `variant_level`.

## F. `prescription_snapshot` contract

- P9.1 flat shape: `{ version:1, variant:'rx'|…, gender:'male'|'female'|null,
  source:'structured', resolvedAt, movements:[ { instanceId, name,
  canonicalMovementId, displayLine, load?, reps? } ] }`.
- Contains **only the SELECTED variant**, member/gender-**resolved**:
  `displayLine` is the final text (`"15 Wallballs @ 9 kg"`). Order + repeated
  instances preserved.
- Built at log time ONLY when `variantHasStructuredPrescription(frozenDoc,
  selectedVariantKey)` is true. **Prod reality: 0 / 128 non-RX logs have it**
  (coaches build variants rarely; auto-generation isn't persisted per-log).

## G. Canonical source precedence — `resolveResultMovementLines(log)`

`src/resultWorkoutLines.js` — a **pure module**, independently tested, that can
never reach the live workout. Wired into all 3 WOD-SIMPLE surfaces + the admin
`ScoreDisplay`.

| tier | source | notes |
|---|---|---|
| **1** | `performed_prescription` → `composePerformedResultLines` (P9.5.5) | athlete's actual performed overlay, frozen gender |
| **2** | `prescription_snapshot.movements[].displayLine` (new `snapshotDisplayLines`) | frozen RESOLVED prescription for the SELECTED variant — carries loads, variant-correct, order + repeats preserved |
| **3** | `notes` movement lines (`notesMovementLines`, header stripped) | frozen text at save — variant-specific whenever the coach defined per-variant movements (structured Builder OR legacy `movements_<variant>` text) |
| **4** | `movements_snapshot` | frozen movement **NAMES** (`wods.movements_rx`). Reached ONLY when 2 AND 3 are both empty — which the prod data proves happens **exclusively** when NO per-variant movement override was ever defined → the movements are identical across variants → the RX names ARE this athlete's movements. **Names only; no loads synthesised.** |
| **5** | `[]` | no frozen movement source at all (oldest legacy rows, `movements_snapshot` NULL) — keep VARIANT + RESULT, omit the section. Never invent. |

**The current mutable `wods` row is NEVER consulted** (P10 §11/§20 — a later coach
edit cannot rewrite a saved result). `resolveResultMovementLines.length === 1`
(the log only). Statically asserted: the function body references only
`log.performed_prescription`, `log.prescription_snapshot`, `log.notes`,
`log.movements_snapshot`.

## H. Selected-variant handling

The programmed fallback is inherently the selected variant's:
- tier 2: `prescription_snapshot` is built for the frozen `variantKeyFromLevel(varianta.nivel)`.
- tier 3: `notes` was composed from the selected variant's movement text at save.
- tier 4: only reached when the workout has NO per-variant movements at all → the
  variant shares the RX movements.
There is **no `variant === 'RX'` fallback** anywhere; a non-RX result never
borrows RX values when any variant-specific frozen source exists (tier 2/3).

## I. Historical-truth handling

Every tier is frozen, log-owned. `resolveResultProvenance` (P10) unchanged. A
`wods` edit after logging cannot change a result's movement names / loads /
distances / calories / order — regression-tested.

## J. Legacy handling

| legacy class | behaviour |
|---|---|
| frozen `notes` movement lines present (92/110 Int · 11/14 Beg) | tier 3 — shown as-is |
| no snapshot, header-only `notes`, `movements_snapshot` present (~14 rows incl. Ergun) | tier 4 — movement NAMES |
| no snapshot, no notes lines, `movements_snapshot` NULL (~11 oldest rows) | tier 5 — omit section, keep VARIANT + RESULT |

Never uses the current workout to fill a gap.

## K. Shared projection architecture

One pure module `src/resultWorkoutLines.js` exporting `resolveResultMovementLines`,
`resultPerformedLines` (moved here from App.jsx), `notesMovementLines`. It
composes existing shared primitives — P9.5.5 `composePerformedResultLines`, P9.4
`composeStructuredWorkoutDisplay` (via it), and the new
`prescriptionContract.snapshotDisplayLines` (WOD-SIMPLE `.js` + forge-admin-web
`.ts` parity). No new result-domain framework.

## L. Leaderboard behaviour

Expanded card → `resolveResultMovementLines(log)`. Collapsed card unchanged.
Bucketing / ranking / RX-Mixed split / badge — untouched (P9.5.4 / P9.5.6).

## M. Journal behaviour

`JurnalList` card → `resolveResultMovementLines(w)` (same rule). P9.5.5 performed
rendering and P9.5.6 `resultModifiedLog` classification unchanged.

## N. Share behaviour

`saveWodLog`'s share-data assembly builds `shareMovementLines` with the same
precedence available at save time: `performedShareLines` →
`snapshotDisplayLines(prescriptionSnapshot)` → `miscariFinale` →
`miscariPentruLog`. (`movements_snapshot` is written by the trigger AFTER the
insert, so the share popup's tier 4 is deferred to the next leaderboard/Journal
render.)

## O. Benchmark / history behaviour

Benchmark-history detail is **score-only by design** (`benchmarkScoreDisplay` +
`capped` badge + P9.5.5b modified badge) — no movement rows. **Not redesigned**
(§41). P10 snapshot-first scoring unchanged.

forge-admin-web `ScoreDisplay` (coach Workout History + Leaderboard) — was
pre-P9.5.5 (movements from `notes` only) → had the same "movements vanish" bug.
Now routes through the same precedence.

## P. RX matrix · Q. Intermediate matrix · R. Beginner matrix · S. OnRamp matrix

`src/p957ResultDetailProjection.test.js` §23 — for each of RX / Intermediate /
Beginner / OnRamp / `CUSTOM_TEST` (synthetic):
- unmodified (with `prescription_snapshot`) → full variant lines.
- modified load → all 4 lines, the performed value on the changed movement,
  unchanged values preserved.
Plus the primary fixtures §45-52: unmodified RX (loads from snapshot, not the
load-less notes text); Ergun's exact row shape → movement NAMES; unmodified
non-RX with variant-specific notes text (no snapshot) → the notes lines (RX
`movements_snapshot` does NOT win).

## T. Repeated-movement tests

§25/§55 — same canonical movement twice, distinct `instanceId`s, different loads;
modify only the second → `['10 DB Snatch @ 15 kg', '10 DB Snatch @ 12 kg']`. No
name-based collapse.

## U. Substitution tests

§7/§53 — programmed Wallballs, performed Dumbbell Power Snatch →
`15 Dumbbell Power Snatch @ 15 kg`; no ghost `Wallballs`; unchanged rows kept.
§26/§54 — 4-movement workout, 2 changed → 4 lines, exactly the 2 overrides.

## V. Cross-format tests

§57-65 — the movement source is **independent of score family**: TIME /
TIME_CAPPED / RFT / AMRAP (partial round) / REPS (low & high) / LOAD (achieved
200 as score) / DISTANCE / CALORIES / SETS-Intervals — all yield identical full
movement lines for the same frozen prescription. §62 — the achieved-load SCORE
is never treated as a movement prescription.

## W. Malformed-data behaviour

§67 — a malformed `performed_prescription` (`{version:99, movements:'x'}`) →
`composePerformedResultLines` returns null → the resolver **falls through to the
frozen `prescription_snapshot`** (safe). Empty `{}` / `null` / `undefined` →
`[]`, no crash, no error boundary.

## X. Files changed

| repo | file | change |
|---|---|---|
| WOD-SIMPLE | `src/resultWorkoutLines.js` **(new)** | `resolveResultMovementLines`, `resultPerformedLines` (moved), `notesMovementLines` |
| WOD-SIMPLE | `src/prescriptionContract.js` | `snapshotDisplayLines` |
| WOD-SIMPLE | `src/App.jsx` | import; leaderboard + Journal `cardMovementLines`; share `shareMovementLines`; removed inline `resultPerformedLines` |
| WOD-SIMPLE | `src/p957ResultDetailProjection.test.js` **(new, 41)** · `src/p955ResultPerformedProjection.test.js` (static assertions updated) |
| forge-admin-web | `src/features/programming/prescriptionContract.ts` | `snapshotDisplayLines` (parity) |
| forge-admin-web | `src/features/results/ScoreDisplay.tsx` | `resultMovementLines` + `notesMovementLinesOnly` |
| forge-admin-web | `src/features/results/types.ts` | `WodLogRow` += `prescription_snapshot` / `performed_prescription` / `movements_snapshot` |
| forge-admin-web | `src/features/results/ScoreDisplay.test.tsx` (+3) |

## Y. DB impact

**None.** No migration, schema, trigger, view, function, backfill, or historical
row mutation. `app_version` bump is the only DB write.

## Z. Tests

- `src/p957ResultDetailProjection.test.js` — **41 pass** (see §P-W).
- Full WOD-SIMPLE suite: **1586 pass** (1545 + 41), **9 pre-existing Deno
  `@std/assert` file-load failures unchanged**. eslint 0 errors. `vite build` OK.
  `appHookOrderIntegrity` — 3 pass.
- forge-admin-web: `tsc -p tsconfig.app.json` **0 errors**; `src/features/results`
  suite **475 pass** (incl. 3 new `ScoreDisplay` P9.5.7 tests); parity 96 pass.

## AA. Full regression count

WOD-SIMPLE **1586** · forge-admin-web results **475**.

## AB. Production acceptance

Live prod (`assets/index-YU_UyZ__.js`, hard reload), 2026-08-31 RFT leaderboard:

| case | expanded card | verdict |
|---|---|---|
| **§80 Ergun** — unmodified Intermediate, no snapshot | `VARIANT: Intermediate` · `15 Wallballs` · `15 Sumo deadlift high-pull` · `15 Box jumps` · `15 Push Press` · `RESULT: 3 runde complete · 20:00` — **movement section restored** (names, tier 4), no RX loads, no badge | ✅ |
| **§81 modified RX "Test"** — `performed_prescription` overlay | `VARIANT: RX` · `15 Wallballs @ 9 kg` · `15 Sumo deadlift high-pull @ 35 kg` · `15 Box jumps` · `15 Push Press @ 23 kg` (performed load) · `RESULT: 1 runde + 23` — **no regression** | ✅ |
| **§82 unmodified RX "Adrian"** — has `prescription_snapshot` | `VARIANT: RX` · WEIGHT 9 · `15 Wallballs @ 9 kg` · `15 Sumo deadlift high-pull @ 35 kg` · `15 Box jumps` · `15 Push Press @ 35 kg` — **now WITH loads** (tier 2, was load-less notes text) · no `Not RX'd` badge | ✅ |
| console | only the generic Chrome-extension "message channel closed" noise (`:0:0`); no app errors | ✅ |

## AC. Commit · AD. Bundle · AE. app_version

- WOD-SIMPLE `c03329d`; forge-admin-web `a2a7e4c`.
- `https://forge-delta-ivory.vercel.app/assets/index-YU_UyZ__.js` (deploy `Aqrm1SKs9TPFaqtS8FNmGQWc8vW8`).
- `result-detail-projection-p957-20260831` (`app_version.current`, live `updated_at 2026-08-31 18:23Z`).

## AF. Remaining limitations

1. **~11 oldest legacy rows** (`movements_snapshot` NULL, no snapshot, no notes
   lines) render **no movement section** — VARIANT + RESULT only (tier 5). There
   is no frozen movement source; inventing from the current workout would violate
   P10. Documented, not fixed (§74 — no schema change).
2. **RX-only workouts, non-RX unmodified logs** (Ergun's class) show movement
   **NAMES only** (tier 4) — the Intermediate/Beginner/OnRamp *loads* were never
   frozen because the coach built only RX and the auto-scaled variant is not
   persisted per-log. Truthful (the athlete did those movements at a
   self-selected load); fully closing it (per-variant load snapshot) is a
   schema change → out of scope.
3. **Share popup tier 4**: `movements_snapshot` isn't available at save time (the
   trigger writes it post-insert), so a just-saved Ergun-class result's share
   popup shows no movement list until the row is refetched by the leaderboard /
   Journal. Transient; the athlete just performed the workout.
4. **`saveWodLog` write-side notes gap unchanged**: future non-RX logs on
   RX-only workouts will still get header-only `notes`. The read-model tier 4
   (`movements_snapshot`) covers them, so no write-side change was made
   (minimal, read-model fix).
5. **forge-admin-web performed-overlay parity**: `ScoreDisplay` now consults
   `performed_prescription` (P9.5.7), closing what was also a P9.5.5 gap on the
   coach app.

## AG. P9.5.6 remains CLOSED

`resultCompositionModified` / `isMixedCategory` / the badge / variant tiering —
untouched. Classification still reads the programmed `miscariAfisate`, NOT
`cardMovementLines` (statically asserted). Expected classification changes: **0**.

## AH. P10 remains CLOSED

`resolveResultProvenance`, snapshot-first historical interpretation, legacy
"do-not-invent" policy, frozen gender — untouched. Current-WOD-edit regression
green.

## AI. INC-06 remains CLOSED

Interval / future-workout logic untouched. Intervals per-round reps stay
score/performance data; the movement projection shows the programmed/performed
movements.

## AJ. INC-04 remains PAUSED

Not touched. Frozen-logging-identity (`freezeLoggingContext` /
`resolveLoggedWorkoutIdentity`) untouched.

## AK. No unrelated phase started

---

## FINAL PRODUCT INVARIANT (enforced)

**ATHLETE RESULT DETAIL = WHAT THAT ATHLETE ACTUALLY PERFORMED.** If modified,
the performed prescription; if not, the programmed prescription of the SELECTED
variant. `performed_prescription == NULL` is never "nothing to display."
`Intermediate / Beginner / OnRamp` is never "fall back to RX." A later coach edit
never rewrites historical athlete result detail — for structured logs, frozen
log-owned provenance is authoritative over live workout data.

## HARD STOP

Audit → root-cause proof → canonical result-detail contract → one shared pure
projection (`resolveResultMovementLines`, 5-tier frozen precedence) → cross-variant
+ cross-format + cross-surface tests → full regression → deploy → production
acceptance (Ergun's Intermediate movements restored; modified RX unregressed;
unmodified RX now shows loads) → report. **Stopping. INC-04 stays paused.
P9.5.6 / P10 / INC-06 stay CLOSED. No leaderboard redesign. No unrelated phase.**
