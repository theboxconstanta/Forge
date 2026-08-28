# FORGE INC-02 — Score Logging Fix Report

Status: **CLOSED.** Deployed to production (`2026-08-28T07:16:23Z`, commit `2dd8dde`).

---

## 1. Root Cause

`saveWodLog` (WOD-SIMPLE `App.jsx`) constructed `wodHeaderLine` with an unconditional `wodZiData.type`/`wodZiData.name` access whenever `variantaAleasa !== null` (an official RX/Intermediate/Beginner/OnRamp variant was selected). This assumed `variantaAleasa !== null` implies `wodZiData` (the fetched WOD-of-the-day row) is populated — an assumption that does not hold. `TypeError: Cannot read properties of null (reading 'type')` aborted the function **before** it reached the `supabase.from('wod_logs').insert(...)` call, so no save request was ever sent.

## 2. Why `wodZiData` Was Null

**A legitimate, common, and correctly-anticipated state elsewhere in the same function** — not a malformed or impossible state. `fetchWodZi()` explicitly does `setWodZiData(data || null)`, setting `null` whenever no `wods` row exists for the currently-displayed date (any day with no official WOD scheduled, which is entirely normal). Two other lines in the very same function already guarded against exactly this (`wodZiData ? formatWodDurata(wodZiData.duration) : ''`, `wodZiData?.date`) — only the header-line construction was missed.

The actual defect enabling this combination to arise was a **state desync**, not the null itself: a `useEffect` (Coach Quick Create's "usual level" auto-select) sets `variantaAleasa` from the member's preference the first time `wodZiData` loads — but nothing ever clears `variantaAleasa` when `wodZiData` subsequently becomes `null` again (navigating to a different day with no WOD, or a long-lived PWA session spanning a local midnight rollover — `dataAcasa` is only ever advanced by explicit navigation or the `useEffect` re-fetch, never by a timer). The result: a stale `variantaAleasa` pointing at a variant selection that no longer corresponds to any loaded WOD.

## 3. Fix

Two changes, both in the immediate save path and its direct upstream state, per the mission's own minimality directive:

1. **`src/utils.js`** — extracted the crashing expression into a new pure function, `computeWodHeaderLine({ variantaAleasa, wodZiData, varianteNivel, durStr, wodTip, wodDurata, freeLogConfigDesc })`. When `variantaAleasa !== null` and `wodZiData` is null, it now returns the selected variant's own level name (e.g. `"RX"`) — the only real information available at that point — instead of crashing. Every other branch (official variant + `wodZiData` present; free log) is byte-for-byte the same expression as before, just relocated.
2. **`src/App.jsx`** — `saveWodLog` now calls `computeWodHeaderLine(...)` instead of the inline ternary. A new companion `useEffect` clears `variantaAleasa`/`wodMiscariCustom` whenever `wodZiData` becomes null (mirroring the exact reset pattern already used elsewhere in the same component after a successful save), directly eliminating the state-desync that produced the invalid combination in the first place — not just papering over its one crash site.

No optional chaining was added purely to "make the error go away" — the fallback value (`varianteNivel`) is semantically meaningful (it correctly describes what the member is actually logging: an RX/Intermediate/Beginner/OnRamp result with no linked official WOD), matching this exact function's own established pattern of degrading gracefully (the `wod_id`/`variant_level` fields already handled this case correctly before this fix — only the header text did not).

## 4. Related Unsafe Accesses

Searched the entire `saveWodLog` function (lines ~8254-8420) for every `wodZiData.*`/`wodZiData?.*` reference. Found exactly one other candidate (`wodZiData.duration`) and one more (`wodZiData.date`) — **both were already correctly guarded** (`wodZiData ? ... : ''` and `wodZiData?.date` respectively) before this fix. The crashing line was the sole unguarded access in the immediate save path. No sibling fix was required.

## 5. Regression Test

`src/utils.test.js`, `describe('computeWodHeaderLine - INC-02 (SENTRY-CYAN-HARBOR-4T) regression')`:
- **The exact production scenario**: `variantaAleasa: 0` (RX selected) with `wodZiData: null` — asserts the call does not throw, and returns `'RX'`. A second case repeats this for `Intermediate` to prove the fallback uses the *correct* selected level, not a generic placeholder. Both of these would have thrown under the pre-fix inline logic — this is a genuine regression test, not a superficial "does the field exist" check.
- **Empty-state edge case**: no variant, no `wodZiData`, no free-log fields — returns `''` without throwing.

## 6. Positive Control

Two dedicated tests confirm the `wodZiData`-present path is **byte-for-byte unchanged**: `{ type: 'AMRAP', name: 'GET UP' }` with a duration string produces exactly `'AMRAP · 20:00 — "GET UP"'` (the pre-fix expected output), and a case with no name/duration correctly produces just the type. A third confirms the free-log path (`variantaAleasa: null`) still ignores `wodZiData` entirely and builds its header from `wodTip`/`wodDurata`/`freeLogConfigDesc` exactly as before.

## 7. Score Types

The fix is entirely upstream of any score-type-specific logic (`composeWodLogFields()`, called after `wodHeaderLine` is computed, is untouched) — it does not distinguish or depend on time/reps/weight/movement-keyed formats. The full WOD-SIMPLE suite (which includes `workoutEngine.test.js`, `scalingEngine.test.js`, `rxEngine.test.js`, and other score-type-specific suites) passes unchanged, confirming no regression across any scoring type.

## 8. Sentry

The specific dereference pattern behind `SENTRY-CYAN-HARBOR-4T` (`wodZiData.type` accessed with no null check, reachable when `variantaAleasa !== null`) no longer exists in the codebase — `computeWodHeaderLine` checks `wodZiData` truthiness before touching any of its properties, in every code path. Sentry error reporting itself was not touched, disabled, or broadly caught — any *other, unexpected* score-save failure remains fully observable exactly as before.

## 9. Database

**NO.** No schema, RLS policy, or trigger was created, altered, or even queried in a way that could affect them. This was confirmed in the original investigation as a purely client-side, pre-network-call failure, and the fix accordingly touches only `src/App.jsx` and `src/utils.js`.

## 10. Production Data

**NO real member data was changed.** No score was recovered or fabricated (per the investigation's own finding: the failed attempts never reached Supabase, so there was nothing stored to recover or reconstruct). The only production-affecting action taken was bumping `app_version` (`inc-02-score-logging-null-guard-20260828`), the platform's standard client-visible-change signal so open PWA sessions pick up the fix — not a data change.

## 11. Tests

```text
Baseline (before this fix): 906/906 real tests passing
After this fix:             912/912 real tests passing (+6 new: 2 regression, 3 positive control,
                             1 edge case)
Pre-existing, unrelated:    9 Deno-only supabase/functions/**/*.test.ts files still fail to LOAD
                             (`@std/assert` import, confirmed pre-existing in every prior mission,
                             untouched by this fix)
```

## 12. Build / Type-check / Lint

```text
build:  PASS (vite build, 0 errors, standard chunk-size warning only, pre-existing/unrelated)
lint:   PASS, 0 errors (11 pre-existing warnings on unrelated lines, unchanged count from baseline)
```
(WOD-SIMPLE has no separate `tsc` type-check step configured — it is a plain JS/JSX project; `build` is the applicable equivalent verification here.)

## 13. Closed P0 Regression

```text
P0-01:     INTACT - not referenced anywhere in this diff; no DB object touched.
P0-02:     INTACT - gender resolution (resolveAthleteGenderKey/weightKeyForVariant) is not
           reached by this code path at all (the crash occurs before that logic runs) and was
           not modified.
P0-SEC-01: INTACT - no view/grant touched.
P0-SEC-02: INTACT - no subscriptions/entitlement logic touched.
P0-SEC-03: INTACT - no view touched.
P0-03:     INTACT - this fix is unrelated to date/timezone derivation; the diff was checked and
           contains zero occurrences of todayLocalStr/localDayBoundsUTC/date-related identifiers
           beyond the pre-existing import line (only extended to add the new, unrelated
           computeWodHeaderLine import).
```

Confirmed via targeted diff review, not a broad re-audit, per this mission's explicit instruction.

## 14. Remaining INC-02 Risks

**P3.** The suspected upstream trigger condition (§2 — a long-lived PWA session spanning a local midnight, or fast date-navigation, causing `dataAcasa`/`wodZiData` to change while stale UI selection lingers) is now provably non-crashing and semantically correct regardless of cause, so no further urgency remains. A genuinely optional, non-blocking follow-up would be re-examining whether `dataAcasa` should refresh on visibility-change for very long-lived sessions — this is a UX-polish question about *how often* a member sees a stale date, not a correctness or crash risk, and is explicitly out of this mission's scope (not proposed for implementation here).

## 15. Final Verdict

## INC-02 CLOSED

The confirmed root cause (an unguarded null dereference at the exact Sentry-identified location) has been eliminated with a minimal, semantically-correct, regression-tested fix. The database layer was independently verified healthy in the original investigation and remains untouched. All acceptance criteria are met: the crash is gone, the previously-null `wodZiData` state now produces a valid, meaningful header instead of aborting the save, normal (non-null) behavior is proven byte-for-byte unchanged, the full test suite passes with the new regression coverage included, build/lint are clean, no database or production data was touched, and all five closed P0/security items plus P0-03 remain unregressed. The fix is deployed to production (commit `2dd8dde`, Vercel `2026-08-28T07:16:23Z`).

---

Per this mission's explicit instruction: INC-01 was not touched, no additional audit was performed, and this mission stops here.
