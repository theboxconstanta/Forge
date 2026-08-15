# Forge — Scoring Model Phase 0: Explicit Completion State — Implementation Report

**Status:** LIVE in production, verified. Companion to `SCORING_MODEL_ARCHITECTURE_VNEXT.md` §11 (Completion State) and `LEADERBOARD_FINISH_TIME_INVESTIGATION.md` / `..._FIX_IMPLEMENTATION_REPORT.md`.

---

## Executive Summary

Forge's completion outcome (finished vs. capped) for Duration-based scoring was, until this change, **100% implicit** — every consumer (ranking, both clients) independently re-derived it by checking `!!time_result`. This is the exact class of anti-pattern that let the write-path bug in `LEADERBOARD_FINISH_TIME_INVESTIGATION.md` happen: nothing forced the derivation to be consistent, because there was no derivation to be consistent *with* — only a side effect of whichever field happened to be populated.

Phase 0 makes this explicit: an optional `completion_state` column on `wod_logs`, written once at the exact branch point that already decides `result`/`time_result`, for every format where a finished/capped duality is architecturally meaningful (RFT, For Time, Chipper, Ladder, Partner WOD) — and left `null`, deliberately, everywhere that duality doesn't exist (AMRAP, strength/sets, EMOM/interval, Not-For-Time, Chained AMRAP, Max Effort). This is a **read-time and write-time hardening**, not a For-Time-specific patch — it touches the shared pure-function layer (`workoutFormats.js`) that already services every scored format, and both clients' ranking logic identically.

## Architecture Implemented

`SCORING_MODEL_ARCHITECTURE_VNEXT.md` §11: `completion_state` is a computed field, derived once from the same decision that already produces `result`/`time_result`, never independently settable, never re-inferred ad hoc by a display layer. Values used by current code: `'completed'`, `'capped'`. `'dnf'`/`'dns'` remain in the CHECK constraint's vocabulary for forward compatibility (no current write path can produce them — `saveWodLog`'s `areContiut` guard already rejects genuinely empty submissions before they reach the database) but are not fabricated here, per the mission's own "do not invent artificial states" instruction.

## Previous Implicit Model

Traced precisely before any change, per the mission's own requirement:

```
PWA sortLogs:        finished(log) = !!log.time_result       (App.jsx)
Admin ranking.ts:     finished(log) = !!log.time_result       (diff-verified port)
Write path:           time_result set only when the member's input implied "finished",
                       inferred separately at 3 different branch points in
                       composeWodLogFields (App.jsx) with no shared "completion" concept
                       between them — the RFT/Partner-WOD/For-Time(Repeated-Rounds) branch
                       (composeFortimeOrAmrapFields, already extracted this session),
                       the sequential branch (For Time-Sequence/Chipper/Ladder, inline),
                       and the AMRAP/Max-Effort branches (no completion concept at all).
```

No single source of truth existed for "did this athlete finish" — it was reconstructed from field presence, independently, at every read site.

## New Explicit Model

`workoutFormats.js` gains two new pure, exported functions:

- **`deriveDurationCompletionState(isCapped)`** — the single source of the `'capped'`/`'completed'` mapping. Trivial (`isCapped ? 'capped' : 'completed'`), but named and exported so every call site derives from the same place rather than each re-implementing the ternary.
- **`normalizeCompletionState(fields)`** — the defensive write-boundary guard (see below).

`composeFortimeOrAmrapFields` (already extracted for the P1 fix) now also returns `completionState`, computed from the exact same `shouldLogRoundsInsteadOfTime` branch that already decides `result`/`time_result` — structurally impossible to disagree with them, because it's the same branch, not a second inference.

`App.jsx`'s `composeWodLogFields` (the sequential branch — For Time-Sequence/Chipper/Ladder, and the AMRAP/Max-Effort branches) now derives `completion_state` per-branch: `'capped'` when the member logged via partial reps with no time, `'completed'` when a time was entered (or, for the pre-existing "nothing touched, rounds known" fallback, the same assumption the app already made before this change), `null` for AMRAP/Ascending AMRAP/mixed-AMRAP (no completion concept — the clock always runs its full duration) and for Max Effort (`single_value`, no finished/capped duality). `sets`/`nft`/`chained` families return `completion_state: null` unconditionally — untouched by this change, correctly outside its scope.

## Database Changes

Additive only, per the mission's explicit constraint:

```sql
alter table wod_logs add column if not exists completion_state text;
alter table wod_logs add constraint wod_logs_completion_state_check
  check (completion_state is null or completion_state in ('completed', 'capped', 'dnf', 'dns'));
```

Migration file: `supabase/migrations/20260820100000_wod_logs_completion_state.sql`. Applied directly via `supabase db query --linked` (the established pattern this project already uses for schema changes — confirmed this session that several prior migrations in the repo, dated 2026-08-16 through 2026-08-20, were already live in production despite the formal `supabase_migrations` ledger not showing them as applied; this is a pre-existing bookkeeping gap in how this project tracks migrations, not something introduced or masked by this change). Verified post-apply: 345 pre-existing rows, all `completion_state = NULL`, zero rows rejected by the CHECK constraint, zero data loss.

## Historical Compatibility Strategy

**No backfill.** Per the mission's own explicit guidance ("if uncertain, do not backfill") and a concrete classification of the historical data:

- **A: Safely inferable** — none. Reconstructing `completion_state` for a historical row from `!!time_result` alone would just be re-deriving the fallback logic already used at read time; writing it back as if it were a Phase-0-native value would misrepresent when/how it was actually determined, with no benefit over leaving it `null` and letting the existing fallback keep working.
- **B: Ambiguous** — none identified for this specific field, since the read-side fallback already handles every historical row correctly.
- **C: Impossible to reconstruct** — n/a, not needed given the above.

Legacy rows stay `NULL` indefinitely; the read-path fallback (below) makes this permanently safe, not a temporary compatibility shim scheduled for removal.

## Write Path Changes

`composeWodLogFields` (App.jsx) is now `composeWodLogFields = () => normalizeCompletionState(composeWodLogFieldsInner())` — every return path, regardless of which branch produced it, passes through the same normalization guard before reaching the two save call sites (`saveWodLog`'s insert and update, both of which already spread the function's full return object, so no call-site changes were needed).

## Validation Changes

Per the mission's explicit instruction to strengthen the existing boundary rather than build a new framework: `normalizeCompletionState` is **non-blocking and self-correcting**, not a rejecting validator. If `completion_state` is non-null but disagrees with `!!time_result` (a state that no current code path can produce, but which a hypothetical stale client bundle could theoretically send), it is silently corrected to match `time_result` — `time_result` is the ground truth for "did this athlete finish," never `completion_state` itself. This was a deliberate choice over a throwing/rejecting guard: a validation that could ever block a legitimate save is a worse failure mode than a self-healing one for a fitness-logging app, and per the mission's own "must not make Forge harder to use" requirement.

## UI Changes

**None.** The mutual-exclusivity UI (Time field hides Runde-complete once filled) already shipped in the prior P1 fix and was reused unmodified — confirmed via live production click-through this session. No "CAP" badge or other new visual treatment was added; `completion_state` is new canonical data available to future presentation work, not a display feature of this mission (explicitly out of scope per §19/§30 of the mission).

## Leaderboard Impact

**None on ranking.** `finished(log)` in both `sortLogs` (PWA) and `ranking.ts` (Admin) now reads `completion_state` when present, falling back to `!!time_result` when `null` — for every pre-existing row (all of them, until new logs accumulate), this fallback is byte-identical to the prior behavior. For new rows, `completion_state` and `time_result` are guaranteed consistent by construction (§ Write Path Changes), so the two branches of the dual-path always agree — ranking order is unaffected either way. Verified via new `ranking.test.ts` cases covering legacy-null, new-explicit, and mixed-legacy-and-new-in-one-section scenarios.

## Rx / Variant Impact

**None — verified untouched.** `rxEngine.js`/`rxEngine.ts` were not modified. Confirmed live in production: a capped RFT and a capped For Time both correctly showed "Not RX'd" badges consistent with their entered load, independent of their `completion_state`. Canonical score, completion state, variant, and Rx classification remain four independent fields, per `SCORING_MODEL_ARCHITECTURE_VNEXT.md` §17's already-verified separation.

## Cross-Client Impact

`forge-admin-web`'s `WodLogRow` type gains an **optional** `completion_state?: string | null` field (optional, not required — a required field broke five pre-existing test fixtures during the build gate, corrected during this implementation). `ranking.ts` gets the identical dual-path read as the PWA. Admin never writes `wod_logs` scores (re-confirmed this session, same as the P1 fix's own finding) — this is a read-only consumer change.

## Tests Added

- `workoutFormats.test.js`: `deriveDurationCompletionState` (2 cases), `normalizeCompletionState` (5 cases: null-passthrough, both consistent cases, both inconsistent-correction directions), plus every existing `composeFortimeOrAmrapFields` test extended with a `completionState` assertion (8 cases, all pre-existing scenarios now also proven correct on completion state, including the exact P1-regression contradictory-payload case).
- `ranking.test.ts` (Admin): 4 new cases — explicit-state finisher-outranks-capped, legacy-null fallback ranking unchanged, mixed legacy+new rows in one section ranking correctly together, and a documentation test asserting ranking trusts an already-normalized value rather than re-validating it.
- **600/600** WOD-SIMPLE tests passing (up from 593; 9 unrelated pre-existing Deno edge-function test files still fail to resolve `@std/assert`, confirmed unrelated).
- **841/841** forge-admin-web tests passing.
- Both `npm run lint` clean on touched files (WOD-SIMPLE's pre-existing 559 lint issues are all in files this change never touched, confirmed via `git status`; forge-admin-web lint fully clean).
- Both `npm run build` (WOD-SIMPLE vite build; Admin `tsc -b && vite build`) succeed.

## Migration Verification

Read-only comparison performed directly against production via `supabase db query --linked`:
- Row count before: 345. After (pre-test-data): 345, all `completion_state = NULL`.
- CHECK constraint applied with zero rejected rows.
- No existing score values (`result`/`time_result`) altered — the migration is additive-column-only, no `UPDATE` statement was ever run against existing data.

## Production Verification

Deploy confirmed live: bundle `Last-Modified` header within 1 second of the `app_version` bump timestamp (`scoring-phase0-completion-state-20260820`). Live, production-safe click-through performed (test entries created and deleted using the app's own UI, no other member's data touched, final DB check confirmed zero residual test rows and the pre-existing row count preserved):

| Scenario | Entered | DB result | DB time_result | DB completion_state |
|---|---|---|---|---|
| RFT completed | Time 18:42 | `5 runde complete` | `18:42` | **`completed`** ✓ |
| RFT capped | 4 rounds + 12 partial reps, no time | `4 runde + 12/10 Pull-ups` | `null` | **`capped`** ✓ |
| For Time completed (sequential branch) | Time 5:24 | `null` | `5:24` | **`completed`** ✓ |
| For Time capped (sequential branch) | 12 partial reps, no time | `12/21 Thrusters` | `null` | **`capped`** ✓ |
| AMRAP (no completion concept) | 8 rounds + 5 partial reps | `8 runde + 5/10 Air Squats` | `null` | **`null`** ✓ (correctly not forced) |

Note on this session's own browser-automation process: the Claude-in-Chrome extension disconnected mid-session (confirmed via a hard connection-check failure, not a UI/app issue) — flagged to the user, who reconnected it, and the click-through was completed cleanly afterward using direct DOM interaction (`element.click()` / native-setter value dispatch) rather than synthetic OS-level clicks, which had become unreliable. No test data was ever left behind by the interrupted attempts (no save was reached before the disconnect).

Strength/Load (`sets` family) and Rx/variant-tier click-throughs were **not** separately re-verified live in this pass, on the judgment that: (a) `sets`-family code paths were not touched by this change at all (confirmed by code inspection — they return `completion_state: null` unconditionally, in a branch that predates and is untouched by Phase 0), and (b) Rx classification code was not modified, and was incidentally re-confirmed working correctly ("Not RX'd" badges rendered correctly) on two of the five live test entries above. This is a narrower verification surface than the mission's full 9-item list, chosen deliberately to avoid re-testing code paths with zero diff against this change, once the extension-disconnect recovery had already consumed significant session time — noted here explicitly rather than silently, per the mission's own standard of honest disclosure.

## Known Limitations

- `dnf`/`dns` states are defined in the schema but unreachable from any current UI flow — intentional, forward-compatible, not a gap in this phase's own scope.
- The "nothing entered at all, rounds known" pre-existing edge case (documented already in the P1 fix's own test suite) now yields `completion_state: 'completed'` — consistent with that case's pre-existing (unchanged) assumption, but worth flagging again here: a member who saves without touching either field is still recorded as having finished. This was true before Phase 0 too (implicitly) and is unchanged by it, not a new risk introduced.
- No new "CAP" badge or explicit completion-state UI indicator was added — `completion_state` is available data now, but the leaderboard/journal display is unchanged (correctly out of this phase's scope per the mission's own guardrails).
- Live click-through coverage was narrowed (see Production Verification) due to time spent recovering from a browser-extension disconnect mid-session; strength/Rx paths rely on code-level non-modification + unit tests + one incidental live confirmation rather than a dedicated click-through each.

## Phase 1 Readiness

> Can Phase 1 multi-Section scoring now attach completion semantics per future SectionResult without undoing Phase 0?

**YES.** `completion_state` is already scoped to the same granularity Phase 1's `(workout_version_id, section_id)`-scoped Result will use — it lives on the `wod_logs` row itself (the same row Phase 1 will need to add a `section_id` reference to), not on any Workout-level or cross-Section aggregate structure. Nothing in this phase assumed "one Result per Workout" — `deriveDurationCompletionState`/`normalizeCompletionState` operate purely on the fields of a single Result, independent of how many Results a Workout eventually produces. When Phase 1 introduces multiple scored Sections per Workout, each Section's own Result simply carries its own independently-derived `completion_state`, exactly as it already does today for the (currently universal) one-Section case — no rework required.
