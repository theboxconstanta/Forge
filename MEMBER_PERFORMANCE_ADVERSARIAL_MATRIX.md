# Member Performance — Adversarial Case Matrix

**Status: Research only. No code, schema, or production data changed. Each case evaluated against the architecture recommended in `MEMBER_PERFORMANCE_DOMAIN_ARCHITECTURE_V1.md`, informed by the live-verified facts in `MEMBER_PERFORMANCE_CURRENT_STATE_AUDIT.md`.**

For each case: Result source, comparison identity used, what it IS comparable with, what it is NOT comparable with, PR eligibility, history behavior, variant handling, edit/delete behavior, and any architectural gap.

## 1. Back Squat 1RM

- **Source**: `wod_logs` (V2 additional Section) or `skill_logs` (legacy), `sets` JSON, format `Build to Heavy/1RM`.
- **Identity**: `movement="Back Squat"` (text) + `rep_scheme` (column exists, **not yet enforced** at detection time).
- **Comparable with**: any other logged row with the identical movement text — including, today, a 3RM or 5RM Back Squat entry (real gap).
- **Not comparable with**: a different movement text ("Front Squat").
- **PR eligible**: yes, via `evaluate_movement_prs` (weight-fallback scoring already correct per Universal Scoring Audit).
- **History**: shown in Movement History (V1), scoped honestly to "all Back Squat entries," not rep-scheme-filtered.
- **Variant**: N/A (strength formats have no Rx/Scaled tier concept the same way metcons do).
- **Edit/delete**: PR Event, once recorded, is not reconciled on later edit (architectural gap, documented).
- **Gap**: rep-scheme not keyed — this is THE central adversarial case motivating that fix as the top deferred-phase priority.

## 2. Back Squat 5RM

Same as #1, mirrored. **Adversarial point proven**: cases 1 and 2, logged on different dates, are currently **comparable to each other** at the detection-rule level (both just "movement=Back Squat"), which is architecturally wrong — a 5RM is not a 1RM. This is the concrete failure mode Decision D/F names.

## 3. Back Squat 5x5

- **Source**: `wod_logs`/`skill_logs`, format `Strength Sets`.
- **Identity**: same movement text, same ungated rep-scheme gap.
- **PR eligible**: yes, but ranks by **best single set weight** (Max Weight fallback), not volume — a disclosed, correct-by-design limitation (Universal Scoring Audit), not a new gap. A 5x5 training day should NOT be shown as a "5RM PR" unless the coaching-semantics question in mission §10 is explicitly resolved — **this architecture recommends it should NOT**, matching the Architecture doc's Movement History scoping decision.

## 4. Snatch 1RM

- **Identity**: `movement="Snatch"` — text-dependent, no canonical Movement identity to guarantee this doesn't collide with "Power Snatch," "Hang Snatch," etc. if a coach/member ever types inconsistently.
- **Gap**: movement-identity 0%-populated finding applies directly here — this is the real-world instance of mission §13's named risk.

## 5. Power Snatch 1RM

- **Comparable with #4?** Only if the raw text happens to be identical (it won't be — "Snatch" vs "Power Snatch" are different strings) — so in practice these are correctly kept separate **today, by accident of text difference**, not by design guarantee. A typo or alias variant (e.g. "PS" abbreviation) could silently fragment or wrongly merge history — neither failure is currently detectable.

## 6. Fran Rx, repeated 6 months later

- **Source**: `wod_logs`, `For Time`.
- **Identity**: `benchmark_id` (resolved via `resolve_benchmark_names`) + Scaling Context (Rx).
- **Comparable with**: every other Rx Fran result for this member, any date.
- **Not comparable with**: a Scaled Fran result (see #7).
- **PR eligible**: yes, via `evaluate_benchmark_pr` (For Time branch, live and correct).
- **History**: Benchmark History (V1), shown chronologically, best Rx highlighted.
- **Edit/delete**: same stale-ledger caveat as #1.
- **Gap**: none — this is the cleanest, fully-ready case in the entire matrix.

## 7. Fran Scaled, then Rx

- **Identity**: two distinct Scaling Contexts under the same `benchmark_id`.
- **Comparable with**: only within the same tier — Scaled compares to Scaled, Rx to Rx, never pooled (frozen invariant, verified).
- **Display**: both appear in Benchmark History, visually separated, matching every competitor researched (btwb/SugarWOD/Wodify all confirmed to do this).

## 8. Fran capped, then completed

- **Source**: two `wod_logs` rows, one with `completion_state='capped'`, one `'completed'`.
- **Comparable with**: each other, within the same Scaling Context — capped-vs-completed ranking is inherited from Results' own already-audited rule (completed always outranks capped).
- **PR eligible**: the completed result can be a PR; whether a capped result itself can be "best" depends entirely on whether any completed result exists yet — inherited logic, not re-decided by Performance.
- **History**: both shown — a capped attempt is real training history, not hidden.

## 9. Arbitrary For Time workout, repeated

- **Source**: `wod_logs`, no asserted Benchmark identity.
- **Identity**: `performance_identity_id` (Signature V1 — format+config+normalized movement text).
- **Comparable with**: any other log resolving to the identical signature.
- **Proven on real data**: the "PARTNER MARY"/untitled-workout collision (Slice 4's own verification) is exactly this case, confirmed working.
- **Gap**: none for detection; **no dedicated UI** to browse "arbitrary repeated workout" history yet (V1 does not add this — only Movement/Benchmark Detail are in scope; a generic "Performance Identity Detail" screen is implicitly deferred, since it wasn't named in V1 Scope and should be treated as such explicitly).

## 10. AMRAP, repeated

- **Identity**: same Performance Identity mechanism as #9.
- **PR eligible**: yes — `evaluate_benchmark_pr`'s AMRAP branch (live, confirmed).
- **Gap**: none.

## 11. TOTAL_REPS format (Tabata/Intervals/Death By), repeated

- **Identity**: Performance Identity (Signature V1) can resolve a repeat, but **PR detection cannot** — `evaluate_benchmark_pr` only branches on `For Time`/`AMRAP`; Movement-PR detection requires numeric `reps`+`weight` per row, and a pure-reps sets-family log often has an **empty weight string** (exactly the live production finding: 4 real logs after Aug 6, all Intervals, all failed the movement-PR filter for this reason).
- **Gap, confirmed live and real, not hypothetical**: this is the literal, concrete, currently-happening cause of the empty PR ledger. A TOTAL_REPS repeat (e.g. improving from 500 to 606 reps) produces **zero** PR event today.

## 12. Track-only strength result (Section leaderboard hidden)

- **Identity**: unaffected — PR/Performance-Identity triggers never read `leaderboard_visible`.
- **PR eligible**: yes, fully — verified structurally.
- **Gap**: none.

## 13. Hidden-leaderboard result (same as #12, different phrasing in the mission)

- Identical answer to #12 — Track-only and hidden-individual-leaderboard are the same underlying mechanism (`leaderboard_visible=false`), confirmed by the Section Leaderboard Visibility architecture.

## 14. Edited Result (e.g. 120kg → 110kg after a PR was recorded)

- **Identity**: unchanged (same movement/benchmark).
- **PR eligible for the edit itself**: no new PR event fires on UPDATE (triggers are `AFTER INSERT` only).
- **Gap, confirmed**: the original `pr_events` row for 120kg remains, unreconciled — "current best" (a derived view) would need to be re-verified for correctness under this exact scenario, which this audit did not live-test (would require mutating production). **Named as an explicit open risk**, not silently assumed safe.

## 15. Deleted Result

- **Gap/behavior, confirmed by schema**: `pr_events.source_wod_log_id` is `ON DELETE SET NULL` — the PR event survives, by design (Results Domain Architecture Invariant #6: never rewritten). Whether a *different*, earlier PR becomes "current" again after this deletion depends on the `movement_pr_events_current`/`benchmark_pr_events_current` view logic, not independently re-verified live this audit.

## 16. Same load in kg vs. lb

- **Identity**: unaffected — comparison identity doesn't depend on unit.
- **Correctness**: already verified elsewhere (Universal Scoring Audit) that ranking uses an unrounded kg-normalized comparison value; `pr_events.score_unit` stores the unit alongside the value. No new gap.

## 17. Same movement, alias variant (e.g. "Back Squat" vs "Back squat" vs a future canonical alias)

- **Gap, confirmed**: no canonical movement identity exists in production — case-sensitivity/whitespace/alias variants are **not** guaranteed to be unified. This is the direct, real instantiation of the movement-identity-quality risk named throughout this audit.

## 18. Section reorder (Warm-up/Skill/Skill2 swapped)

- **Identity**: unaffected — Section identity resolution is by stable `workout_section_id` UUID, never array position (verified, Universal Scoring Audit + Layer 2a.5 fix). Performance Identity/PR triggers read the log row's own snapshotted data, independent of current Section ordering.
- **Gap**: none.

## 19. Workout version change (coach edits a Workout after Results were logged against it)

- **Identity**: unaffected — the Scoring Snapshot pattern freezes format/config/movements at logging time; Performance Identity resolution uses the snapshot, not the live (possibly since-edited) Workout row. Verified via Slice 4's own Duplicate-to-Date check.
- **Gap**: none, **except** that no formal `WorkoutVersion` entity exists at all (confirmed via direct schema query) — "version" is really "whatever the snapshot froze," which is sufficient for Performance's own needs but should not be over-claimed as a general-purpose versioning system.

## 20. Workout Aggregate Total (e.g. Snatch + C&J = 230kg)

- **Identity**: N/A — no `wod_logs`/`skill_logs` row exists for an Aggregate value at all (always derived at read time, never persisted, confirmed Invariant I-19).
- **PR eligible**: no — cannot be, structurally, since the PR triggers only ever fire on real log INSERTs.
- **Gap**: correctly and deliberately absent — matches Workout Aggregation's own existing, still-current deferral (§41 of that architecture). Not a new gap this audit is raising; a confirmation that the deferral still holds.

---

## Summary Table

| # | Case | Comparable identity | PR-eligible today | History-ready | Gap severity |
|---|---|---|---|---|---|
| 1 | Back Squat 1RM | movement text | Yes | Yes (unscoped) | Medium (rep-scheme) |
| 2 | Back Squat 5RM | movement text | Yes | Yes (unscoped) | Medium (collides with #1) |
| 3 | Back Squat 5x5 | movement text | Yes (best-set only) | Yes | Low (disclosed, correct-by-design) |
| 4 | Snatch 1RM | movement text | Yes | Yes | Medium (alias risk) |
| 5 | Power Snatch 1RM | movement text | Yes | Yes | Medium (alias risk) |
| 6 | Fran Rx repeated | benchmark_id+tier | Yes | Yes | **None** |
| 7 | Fran Scaled→Rx | benchmark_id+tier | Yes (per tier) | Yes | None |
| 8 | Fran capped→completed | benchmark_id+tier | Yes (completed) | Yes | None |
| 9 | Arbitrary For Time repeat | performance_identity_id | Yes | No dedicated UI (deferred) | Low |
| 10 | AMRAP repeat | performance_identity_id | Yes | No dedicated UI (deferred) | Low |
| 11 | TOTAL_REPS repeat | performance_identity_id | **No** (real, live, confirmed) | N/A | **High** |
| 12 | Track-only strength | unaffected | Yes | Yes | None |
| 13 | Hidden-leaderboard | unaffected | Yes | Yes | None |
| 14 | Edited Result | unaffected | Stale ledger risk | Yes (with caveat) | Medium |
| 15 | Deleted Result | unaffected (SET NULL) | Survives by design | Yes | Low (by design, not a bug) |
| 16 | kg vs lb | unaffected | Yes | Yes | None |
| 17 | Movement alias variant | **broken** | Fragmented | Fragmented | **High** |
| 18 | Section reorder | unaffected | Yes | Yes | None |
| 19 | Workout version change | unaffected (snapshot) | Yes | Yes | None |
| 20 | Aggregate Total | N/A | No (by design) | N/A (deferred) | None (deliberate) |

Three real, high-severity gaps confirmed across all 20 cases: **#11 (TOTAL_REPS formats cannot produce a PR — the live cause of the empty ledger), #17 (movement alias/case fragmentation), and #1/2/4/5's shared rep-scheme/identity keying gap.** Everything else either already works correctly or is a deliberate, already-documented, correct-by-design deferral.
