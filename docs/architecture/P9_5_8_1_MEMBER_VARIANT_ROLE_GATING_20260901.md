# P9.5.8.1 — Member Variant Visibility / Role-Gating Correction

**Date:** 2026-09-01
**Status:** SHIPPED (pending owner production acceptance)
**Repo:** `WOD-SIMPLE` only. `forge-admin-web` untouched (it only *reads* `wod_logs`; no result-entry workflow exists — §S).
**DB / schema / migration / historical rows:** ZERO change.
**Scoring / ranking / classification / P9.5.6 / P9.5.7 / P10 / INC-06:** untouched. INC-04 stays PAUSED.

---

## §A. Screenshot symptom

Owner (admin account) on the Home WOD card, workout expected RX-only:

```
RX
Intermediate
Beginner
OnRamp
[ Log — Intermediate ]
```

P9.5.8's own report stated *"admin/coach exempt everywhere by design"* and its prod smoke
confirmed *"admin Home WOD card still shows all 4 accordions"*. That carve-out is the bug.

## §B. Exact root cause

P9.5.8 gated variant availability on **role** instead of **surface**:

- `App.jsx` `memberVariantAllowed(levelOrKey)` short-circuited to `true` when `isAdmin || isCoach`
  (and also when the programmed set was empty).
- `App.jsx` `saveWodLog` guard was gated `!isAdmin && !isCoach`.

The owner is a row in `admins` → `isAdmin === true` → every variant "allowed" on the Home
card (a **consumption** surface) → all four accordions rendered and selectable, the CTA
followed the selection, and a save under an unprogrammed variant would not be blocked.

## §C. Role used by the screenshot path

`isAdmin` (from `checkAdmin()` — a row in the `admins` table). Account-level, not
surface-scoped. `isCoach` is the analogous `coaches` row. Neither is a "view-as" mode; the
Home WOD card is the same component for every role.

## §D. Canonical programmed variants for that WOD (2026-09-01)

RX-only. Proof:

| Source | Value |
|---|---|
| `wods.movements_rx` | 3 entries |
| `wods.movements_intermediate / _beginner / _onramp` | NULL |
| `wods.notes_intermediate / …` | NULL |
| `wods.*_weight_male / _female` (scaled) | NULL |
| `wods.movement_prescriptions.variants` keys | `rx` only |
| Engine V2 `workout_sections.scaling_versions` | NULL |

## §E. `getProgrammedVariantLevels` result

`['rx']`.

## §F. Exact exemption/bypass removed or narrowed

| # | Location | Before | After |
|---|---|---|---|
| 1 | `App.jsx` `memberVariantAllowed` → renamed **`homeVariantSelectable`** | `isAdmin \|\| isCoach \|\| set.length===0 \|\| set.includes(key)` | `set.includes(key)` — **role-free, no empty fallback** |
| 2 | `App.jsx` `saveWodLog` guard | `variantaAleasa!==null && logWodZiData && !isAdmin && !isCoach && !isProgrammedVariant(...)` | drop `!isAdmin && !isCoach` — **role-independent** |
| 3 | `workoutEngine.js` `isProgrammedVariant` | `if (programmed.length === 0) return true` | removed — `[]` now **rejects every key** (fail safe) |
| 4 | `App.jsx` Home single-variant branch (`10524`) | `!isAdmin && !isCoach && … && memberVariantAllowed(...)` | **keeps** `!isAdmin && !isCoach` — this gate is a *display-density* choice (plain members get the streamlined single-variant card; admin/coach keep the full accordion), **not** an availability bypass. `homeVariantSelectable` now also required. |
| 5 | `App.jsx` `usual_level` auto-select effect | soft default only, `if (variantaAleasa !== null) return` | now also **sanitizes** a stale/invalid selection (see §O) |

The `isAdmin`/`isCoach` uses at `App.jsx` ~10413–10453 (`warmup_visible` / `skill_visible`
"hidden from members" toggles) are a **different feature** and are untouched.

## §G. Final authoring-vs-consumption rule

| Surface | Class | Variant exposure |
|---|---|---|
| WOD editor variant tabs (`AdminApp`, `VARIANTE_WEIGHT_BASE.map`, `primary.variants`) | **AUTHORING** | all four creation slots — unchanged, every role |
| Home WOD card accordion / single-variant view / "Log — X" button | **CONSUMPTION** | only `getProgrammedVariantLevels()` — every role |
| `logWOD` screen (consumes frozen `variantaAleasa`) | **CONSUMPTION** | inherits the frozen selection; `saveWodLog` guard is the backstop |
| `saveWodLog` official-variant write | **SAVE VALIDATION** | `selectedVariant ∈ frozen programmed set`, role-independent, fail closed |
| Leaderboard / Journal / share / result cards | **RESULT / HISTORICAL DISPLAY** | render saved truth — untouched (P9.5.7 / P10) |
| `metconScalingVariantsForDisplay` | **CONFIG METADATA** | still returns 4 rows; the consumption surface filters them |

> **A user's role never creates a workout variant.** Programming defines what variants exist.

## §H. Old role behaviour → §I. New role behaviour

| | Old (P9.5.8) | New (P9.5.8.1) |
|---|---|---|
| member, RX-only Home | RX only ✓ | RX only ✓ |
| **coach, RX-only Home** | **all four ✗** | **RX only ✓** |
| **admin, RX-only Home** | **all four ✗** | **RX only ✓** |
| **owner (admin), RX-only Home** | **all four ✗** | **RX only ✓** |
| member+coach / member+admin, RX-only Home | all four ✗ | RX only ✓ |
| any role, WOD editor | all four authoring tabs ✓ | all four authoring tabs ✓ |
| **admin save of Intermediate on RX-only** | **allowed ✗** | **rejected (fail closed) ✓** |

## §J. Member Home behaviour
Only programmed variants render as accordions. Incomplete workout (empty set) → no accordion,
Log button disabled.

## §K. Logger behaviour
`logWOD` consumes the frozen `variantaAleasa`. Because Home can no longer select an
unprogrammed variant (any role) and the selection is sanitized on navigation, the logger
only ever opens under a programmed variant. `saveWodLog` re-checks against the frozen
`logCtx`.

## §L. CTA behaviour
`CTA_VARIANT ∈ programmed set` for every role. RX-only ⇒ "Log — RX". A stale/invalid
selection ⇒ button disabled, "choose a variant" label.

## §M. Save validation behaviour
Role-independent. `variantaAleasa !== null && logWodZiData && !isProgrammedVariant(logPrimarySectionV, activePrescriptionDoc, VARIANTE_CONFIG[variantaAleasa]?.nivel)`
→ `toastVariantNotProgrammed`, abort. No silent Intermediate→RX coercion. Validated against
the **frozen `logCtx`** (P9.5.8 decision preserved), never a re-fetch. Empty programmed set
also fails closed here.

## §N. `usual_level` behaviour
A preference, never permission. `resolveDefaultProgrammedVariantKey`: `usual_level` if
programmed → RX if programmed → first programmed level → no selection. `usual_level =
intermediate` on an RX-only workout ⇒ selection resolves to **RX** for every role.

## §O. Stale selection behaviour (§13 / §14)
The Home selection effect now does **two** jobs in one hook:
1. **soft default** — nothing selected + `usual_level` set ⇒ pre-select the resolved default;
2. **sanitize** — a selection exists but its key ∉ `getProgrammedVariantLevels(metcon, doc)`
   for the workout now displayed ⇒ deterministically re-resolve (same contract), or clear to
   no-selection if nothing is programmed.

Scenario: Workout A (RX+Int) → select Intermediate → navigate to Workout B (RX-only) ⇒
selection becomes RX, CTA "Log — RX", no stale Intermediate anywhere. A still-valid
selection is kept (no churn — `if (next !== variantaAleasa)`).

## §P. Zero-programmed-variant behaviour (§19 / §52)
`getProgrammedVariantLevels` empty ⇒ `isProgrammedVariant` / `homeVariantSelectable` return
`false` for every key ⇒ **no accordion rendered, Log button disabled** (the workout is
incomplete). The pre-P9.5.8 "show all four" fallback is **gone**. **0 / 54 production
workouts** resolve empty (verified query — every workout has ≥ RX or another detectable
variant), so this only guards a malformed / half-authored row. No legacy class depends on
the old fallback (§Q).

## §Q. Legacy fallback behaviour
**None retained.** The audit query replicating the resolver against all 54 `wods`
(movements / notes / per-level weight / structured entry, per level) returned
`resolves_empty = 0`. The two `movements_rx = []` rows resolve non-empty:
"J.T." via `movement_prescriptions.variants.rx`, "ANCHOR DOWN" via `movements_intermediate`
(→ `['intermediate']`). No modern *or* legacy production workout needs an all-four fallback.

## §R. Builder behaviour
Unchanged. The WOD editor (`AdminApp`) builds its variant tabs from `VARIANTE_WEIGHT_BASE`
independently of `homeVariantSelectable` / `getProgrammedVariantLevels`. A coach opening an
RX-only workout still gets Intermediate / Beginner / OnRamp authoring tabs; adding content
to one and saving makes that variant appear on member Home legitimately.

## §S. Historical compatibility / §T. Old Ergun behaviour
Zero `wod_logs` rows read, rewritten, relabelled, or removed from any result surface. The
110 Intermediate / 14 Beginner / 4 OnRamp existing logs stay exactly as saved. Old Ergun
`variant_level = 'Intermediate'` remains visible as historical truth in Journal, leaderboard,
and share. P9.5.7 movement-line projection and P10 provenance are untouched.
**No separate admin manual-result-entry workflow exists** — `forge-admin-web` only issues
`SELECT` / realtime subscriptions on `wod_logs` (grepped: `features/results/api.ts`,
dashboards). So there is nothing for the role-independent save guard to conflict with.

## §U. Role × variant test matrix

`getProgrammedVariantLevels` / `isProgrammedVariant` take **no role argument** — the matrix
collapses: for every role the selectable set on a consumption surface is exactly the
programmed set.

| Workout | Programmed set | Selectable (every role) |
|---|---|---|
| RX only | `['rx']` | RX |
| Intermediate only | `['intermediate']` | Intermediate (RX **not** fabricated) |
| RX + Intermediate | `['rx','intermediate']` | RX, Intermediate |
| RX + Beginner | `['rx','beginner']` | RX, Beginner |
| RX + OnRamp | `['rx','onramp']` | RX, OnRamp |
| all four | `['rx','intermediate','beginner','onramp']` | all four |
| incomplete | `[]` | none (Log disabled) |

## §V. Files changed
- `src/workoutEngine.js` — `isProgrammedVariant`: `[]` now rejects every key (was: allow all).
- `src/App.jsx` — `memberVariantAllowed` → `homeVariantSelectable` (role-free, no empty
  fallback); Home selection effect merged soft-default + stale-selection sanitize;
  `saveWodLog` guard de-roled; comments corrected at the single-variant branch.
- `src/p9_5_8ProgrammedVariantAvailability.test.js` — 2 tests flipped (empty ⇒ reject; null
  section ⇒ reject).
- `src/p9_5_8_1MemberVariantRoleGating.test.js` — **new**, 12 tests.

## §W. DB impact
0 schema · 0 migrations · 0 triggers · 0 backfills · 0 row mutations.

## §X. Tests / §Y. Regression counts
- `p9_5_8_1MemberVariantRoleGating.test.js` — 12 new.
- `p9_5_8ProgrammedVariantAvailability.test.js` — 24 (2 rewritten).
- Full `vitest run` — **1622 passed**, 9 pre-existing Deno `@std/assert` file-load failures
  (unchanged baseline).
- `appHookOrderIntegrity` — 3 passed.
- `eslint src/App.jsx src/workoutEngine.js` — **0 errors** (11 pre-existing unused-disable
  warnings, untouched lines).
- `vite build` — clean (`index-*.js` ~1219 kB).

## §Z. Production acceptance
- **Owner account (admin), prod alias:** _to record post-deploy_ — RX-only WOD (2026-09-01)
  ⇒ Home shows RX accordion only; CTA "Log — RX"; Intermediate/Beginner/OnRamp absent.
- **Pure member account:** NOT VERIFIED (no member login available to this session).
- **Builder:** admin opens the same workout in the WOD editor ⇒ Intermediate/Beginner/OnRamp
  authoring tabs still present.
- **Console:** app-error free (known Chrome-extension "message channel closed" noise only).

## §AA. Commit — _filled at deploy_
## §AB. Bundle — _filled at deploy_
## §AC. app_version — `member-variant-role-gating-p9581-20260901`

## §AD. Remaining limitations
- Pure-member production visual not verified this session (no member login).
- The Home single-variant *streamlined card* is still admin/coach-excluded — a deliberate
  display-density choice, not an availability difference (admin/coach get the same filtered
  accordion).
- An incomplete workout shows a disabled Log button with the generic "choose a variant"
  label rather than a bespoke "workout not fully programmed" message (out of scope; safe).

## §AE–AJ. Adjacent phase status
- **P9.5.8** — corrected by this task; the availability contract stands, the role carve-out
  is removed.
- **P9.5.7** — CLOSED / untouched.
- **P9.5.6** — CLOSED / untouched.
- **P10** — CLOSED / untouched.
- **INC-06** — CLOSED / untouched (future-workout variant availability now also role-free).
- **INC-04** — PAUSED / untouched.

## §AK. No unrelated phase started.
