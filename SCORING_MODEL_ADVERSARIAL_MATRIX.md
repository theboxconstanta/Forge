# Forge — Scoring Model Adversarial Matrix

**Status:** Validation exercise only. No code, schema, or migrations. Companion to `SCORING_MODEL_ARCHITECTURE_VNEXT.md` — read that document first; this one exists to prove (or break) its model against real workout structures, not to introduce new concepts of its own.

**Method:** every workout below is modeled against the existing, already-specified entities (`RESULTS_DOMAIN_ARCHITECTURE.md` v1.0 + `RESULTS_DOMAIN_V1_1.md`'s Score primitives, Time Cap Declaration, Tie-Break Key; `PROGRAMMING_DOMAIN_V1_2.md`'s WorkoutVersion; `SEGMENT_MODEL_SPEC_v1.md`'s Segment tree) plus the two additive refinements this investigation proposes (§ see VNEXT doc §8–§11): **(R1)** a WorkoutVersion may declare more than one independently-scored Section, and a Result references a specific Section, not bare Workout identity; **(R2)** `completionState` is persisted explicitly, computed from the existing Time Cap Declaration rule rather than left implicit. Where a workout cannot be modeled cleanly with only these, the gap is named, not papered over. Real-world source material: `docs/fckb/WORKOUT_FORMATS.md` (this session), `SCORING_COMPETITIVE_LANDSCAPE.md` (this session), official CrossFit/IWF rules (same).

For each workout: **Structure** (Segment shape) → **Score Definition** (Score Model + Section count) → **Member Input** → **Stored Result** → **Completion State** → **Tiebreak** → **Comparator** → **Display** → **Leaderboard**.

---

### 1. Simple For Time — "Fran" (21-15-9 Thrusters/Pull-ups)
- **Structure:** 1 Section, 1 leaf Segment, `scheme: rounds(3), repSequence:[21,15,9]`.
- **Score Definition:** Duration, lower-better. No Time Cap Declaration (uncapped).
- **Member input:** elapsed time.
- **Stored:** `{primitive: Duration, value: 5:24}`.
- **Completion state:** COMPLETED (Duration models with no cap declaration are always COMPLETED by construction — cap absence means there's no "didn't finish" state to represent).
- **Tiebreak:** none declared.
- **Comparator:** lower time wins.
- **Display:** `5:24`.
- **Leaderboard:** single list, partitioned by classifiedTier.

### 2. Capped For Time — 5 RFT, cap 20:00
- **Structure:** 1 Section, 1 leaf, `scheme: rounds(5)`.
- **Score Definition:** Duration, Time Cap Declaration `{capDuration:20:00, cappedScoringRule:'rounds-and-reps-as-composite'}`.
- **Member input (finisher):** elapsed time. **Member input (capped):** rounds+reps completed.
- **Stored (finisher):** `{primitive: Duration, value: 17:42, completionState: COMPLETED}`. **Stored (capped):** `{primitive: Composite(Count,Count), value:(4,17), completionState: CAPPED}`.
- **Completion state:** explicit field, not inferred from which value is populated — closes this session's own just-fixed production bug (`LEADERBOARD_FINISH_TIME_INVESTIGATION.md`) at the architecture-paper level, not merely at the one buggy code path.
- **Tiebreak:** optional, `{sourceAttemptRole: "last-completed-round-checkpoint"}` — same mechanism as official CrossFit's own checkpoint convention (confirmed, `SCORING_COMPETITIVE_LANDSCAPE.md` §7).
- **Comparator:** COMPLETED always outranks CAPPED; within COMPLETED, lower Duration wins; within CAPPED, higher Composite wins (lexicographic rounds-then-reps); tiebreak only invoked among exact CAPPED ties.
- **Display:** `17:42` or `CAP · 4+17`.
- **Leaderboard:** one list; CAP-labeled rows visually distinct, never silently blank.

### 3. RFT — same as #2, no cap
- Identical to #1's mechanism (Duration, no Time Cap Declaration) with `scheme: rounds(N)` instead of a rep-sequence ladder. No new case.

### 4. Capped RFT with rounds+reps display, prescribed rounds known
- **Structure:** 1 Section, `scheme: rounds(5)`.
- **Score Definition:** Duration + Time Cap Declaration, `cappedScoringRule: 'rounds-and-reps-as-composite'`.
- **Member input:** either elapsed time (finished all 5 rounds — the composite is never member-entered here, it's derived from `scheme.count` exactly as `composeFinishedRoundsText` already does live in Forge today) or rounds+reps (capped).
- Same mechanism as #2. Named separately only to confirm the model correctly reuses `scheme.count` (already Segment-owned, §7 of Segment spec) rather than asking the member to re-state "I did all 5 rounds" by hand — directly matching Forge's own already-shipped `composeFinishedRoundsText` behavior.

### 5. Chipper (8+ distinct movements, one pass, sequential-partial)
- **Structure:** 1 Section, 1 leaf, `scheme: once`.
- **Score Definition:** Duration + Time Cap Declaration, `cappedScoringRule: 'reps-as-count'` (a Chipper's capped state is a flat rep/movement-position count, not rounds+reps — no repeated rounds exist to count).
- **Member input:** time, or per-movement partial-reps breakdown (sequential, not rounds+reps).
- **Stored:** capped case is `{primitive: Count, value: <total completed>, breakdown: [ResultAttempt per movement]}`.
- Models cleanly — this is exactly why Time Cap Declaration's `cappedScoringRule` is an enum with more than one value rather than a single fixed rule.

### 6. AMRAP (multi-movement, rounds+reps)
- **Structure:** 1 Section, `scheme: amrap(durationSeconds)`.
- **Score Definition:** Composite(Count,Count) — no Duration primitive at all, no Time Cap Declaration (AMRAP has no "finish early" state; the clock always runs out).
- **Member input:** rounds completed + partial reps.
- **Completion state:** always COMPLETED once the clock expires and a score is submitted — there is no capped/DNF distinction for a pure AMRAP (confirmed against official rules, `SCORING_COMPETITIVE_LANDSCAPE.md` §5). A zero-score AMRAP is `DNS`/`DNF` only in the sense of "submitted nothing," not a workout-specific state.
- **Tiebreak:** `{sourceAttemptRole: "time-of-last-completed-round"}`, matching the CrossFit Open convention verified this session.
- **Comparator:** higher Composite wins; tie → tiebreak Duration, lower wins.
- Models cleanly, no gap.

### 7. AMRAP with tiebreak — CrossFit Open-style (e.g. 18.1-shaped)
- Identical to #6 with the Tie-Break Key populated as declared, non-optional for this Score Model (competition-mode requirement, `RESULTS_DOMAIN_V1_1.md` §3: "required only for competition-mode Score Models"). No new mechanism — confirms the existing spec's own scoping language is sufficient.

### 8. EMOM — completion only
- **Structure:** 1 Section, `scheme: interval(workSeconds, restSeconds, rounds)`.
- **Score Definition:** Completion primitive per interval, declared aggregation = "all-or-nothing" (a Score-Model-level flag, not a new primitive — Interval already declares its own aggregation rule per `RESULTS_DOMAIN_ARCHITECTURE.md` v1.0 §6.2).
- **Member input:** did-you-complete-each-interval, or a single "completed all" flag for the common case.
- **Stored:** one Result Attempt per interval (or, Minimal-Core default, none at all if the member just confirms overall completion — Result Attempt granularity is opt-in, `RESULTS_DOMAIN_ARCHITECTURE.md` §2.9).
- Models cleanly.

### 9. EMOM — total reps
- Same structure as #8, Interval primitive with declared aggregation = SUM instead of Completion. No new mechanism.

### 10. EMOM — load (build to heavy single per interval)
- Same structure, Interval primitive over Load instead of Count, declared aggregation = MAX (the Max Effort flag applied per-interval, then Interval's own aggregation takes the overall max across intervals — a two-level composition already anticipated: Max Effort is "a Score Model flag," not a primitive of its own, `RESULTS_DOMAIN_ARCHITECTURE.md` §6.2). Models cleanly — this is the first case that stress-tests Max Effort *composing with* Interval rather than standing alone, and it survives.

### 11. E2MOM (interval_sec ≠ 60)
- Identical mechanism to #8–10; `interval_sec` is a Segment `scheme.workSeconds` value, not a new Score Model concern. No gap.

### 12. Death By (ascending reps per interval until failure)
- **Structure:** 1 Section, `scheme: interval` with `startReps`/`incrementReps` — a Segment scheme variant already named as a known limitation in `SEGMENT_MODEL_SPEC_v1.md`'s own JSON Schema note (the ascending-target case isn't in the v1 Scheme oneOf list as written; flagged there as future work, confirmed here as still open, not solved by this investigation).
- **Score Definition:** Count, "last fully-completed interval's target" as the score, `completionState: CAPPED` at the failure point by convention (Death By's own failure IS its completion signal, not a separate cap concept).
- **Gap named honestly:** the Segment `Scheme` schema needs an `ascending-interval` variant (start/increment on an interval scheme, mirroring the `rounds` scheme's own `repSequence`) before Death By is cleanly representable — this is a Programming-side Segment gap, not a Results-side scoring gap; the scoring model itself (Count, last-completed-interval) has no issue once the structure exists.

### 13. Ascending Ladder (For Time)
- **Structure:** 1 Section, `scheme: rounds(N), repSequence:[increasing]`. Already directly supported (Segment spec §9 Example 3 covers descending; ascending is the same mechanism, increasing instead of decreasing — no schema difference).
- **Score Definition:** Duration (or Composite if capped). No gap.

### 14. Descending Ladder ("21-15-9" family)
- Identical to #1 structurally — Segment spec's own worked example. No gap.

### 15. Interval times (5×500m row, each scored)
- **Structure:** 1 Section, `scheme: interval`, Score Model = Interval(Duration), aggregation declared = "list" (each interval individually visible) rather than collapsed to one number.
- **Stored:** 5 Result Attempts, each `{primitive: Duration, value}`.
- **Display:** the ordered list (`1:42, 1:44, 1:47, 1:48, 1:51`), matching the mission's own example verbatim.
- Models cleanly — this is the case that proves Interval's "declared aggregation" must itself support a non-collapsing "expose the full list" option, not only SUM/MIN/MAX/AVERAGE. **Named refinement, not a gap:** add `aggregation: 'list'` to the existing enum (RESULTS_DOMAIN_ARCHITECTURE.md v1.0's Interval primitive already says "a defined aggregation... not assumed" — this is filling that already-open slot, not inventing a new mechanism).

### 16. Interval total / average / best / worst (same 5×500m row)
- Same structure as #15, `aggregation: SUM | AVERAGE | MIN | MAX` respectively — all already-named values in the existing enum. No gap. Confirms mission §21's four candidate interpretations are all already expressible via one existing field, coach-declared once at authoring time (per §27's inference-with-override principle — Forge would infer `list` as the sensible default display alongside whichever single-number aggregation the coach's chosen scoring intent implies, e.g. "Row, total" → SUM).

### 17. Strength 5×5 (straight sets)
- **Structure:** 1 Section, `scheme: rounds(5), repSequence:[5,5,5,5,5]` (uniform, so effectively `rounds(5)` with no ladder needed).
- **Score Definition:** Load, Max Effort flag = false (this is NOT "find your max," it's "log what you did") — a plain Load-primitive Score Model, one Result Attempt per set.
- **Stored:** 5 Result Attempts, `{primitive: Load, value}` each; the Result's own Score = the top set's Load (or, per coach's declared aggregation, MAX across the 5) — same "declared aggregation over Result Attempts" mechanism as #15/#16, applied to Load instead of Duration.
- Models cleanly, confirming the aggregation mechanism generalizes across primitive types without a primitive-specific special case.

### 18. Heavy single (build to a 1RM)
- **Structure:** 1 Section, `scheme: once` (or `rounds(N)` for the build-up sets, with `primaryChildId`-style "only the last/heaviest set counts" — but at Segment level this is Section-internal work, not multiple Sections).
- **Score Definition:** Load, Max Effort flag = **true**.
- **Stored:** N Result Attempts (the build-up sets, optionally logged) + one Score = MAX across them, per Max Effort's own definition (`RESULTS_DOMAIN_ARCHITECTURE.md` §6.2: "a Score Model flag indicating that among several Result Attempts, only the single best qualifies as the Result's Score"). No gap — this is the primitive's own worked example, verified against a real workout.

### 19. 3RM test
- Identical mechanism to #18 with `targetRepMax: 3` as Score Model metadata (already named in FCKB's own Max Load entry, §6.3, as a required distinguishing field — "a 3RM and a 1RM are NOT comparable scores for the same movement"). Confirms PR derivation (`RESULTS_DOMAIN_ARCHITECTURE.md` §8.2) must key Movement PR by `(movementId, targetRepMax)`, not just `movementId` — **named refinement to PR Architecture**, not a scoring-model gap; already implicit in "per Movement at one rep-scheme" language, made explicit here under adversarial pressure.

### 20. Weightlifting complex (Power Clean + Front Squat + Push Jerk, unbroken, build)
- **Structure:** 1 Section, 1 leaf, `unbroken: true`, `scheme: rounds(N)` — Segment spec's own worked Example 9, unmodified.
- **Score Definition:** Load, Max Effort = true, scored as one unit (the complex's own heaviest unbroken completion) — `unbroken` is presentation/coaching metadata (Segment spec §5, explicitly "never scoring-relevant"), not a Score Model concern; the classifier simply compares the logged Load, same as #18. No gap.

### 21. Snatch — 3 competition attempts, success/fail
- **Structure:** freestanding Result (no Workout reference necessarily — this is a Max-Effort test day, may or may not be tied to a programmed Section) or 1 Section, `scheme: rounds(3)`.
- **Score Definition:** Load, Max Effort = true, **`attemptTracking: true`** (new, narrow flag this investigation proposes — VNEXT §11).
- **Member input:** 3 Result Attempts, each `{primitive: Load, value, outcome: SUCCESS|FAIL}` — `outcome` is the one genuinely new field this entire adversarial pass justifies adding to the existing Result Attempt entity.
- **Stored Score:** MAX across Attempts where `outcome == SUCCESS` only (a failed attempt at a higher weight never becomes the Score, matching IWF's own rule verified this session, `SCORING_COMPETITIVE_LANDSCAPE.md` §10).
- Models cleanly with the one named additive field — this is the adversarial case that proves `outcome` is necessary (§18–20 don't need it; #21 does), confirming it as a genuinely load-bearing, not speculative, addition.

### 22. Clean & Jerk — 3 attempts
- Identical mechanism to #21. No new case.

### 23. Weightlifting Total (best Snatch + best Clean & Jerk)
- **Structure:** 2 Sections (Snatch, Clean & Jerk), each per #21/#22 — **this is the direct proof case for R1** (a Workout with more than one independently-scored Section).
- **Score Definition (Total):** a third, derived value = `bestSnatch.value + bestCleanJerk.value` — **not a third Section's own logged Score**, but a computed aggregate over two already-scored Sections' Results, belonging to the same "cross-Section combination" boundary named in §33 of the fresh mission and resolved in VNEXT §9 as explicitly out of ordinary Result scope.
- **Resolution:** Total is a Leaderboard-layer derived view (a third leaderboard column computed by summing the other two Sections' Results for the same Member/day), never its own persisted Result — directly reusing `RESULTS_DOMAIN_ARCHITECTURE.md` §2.6's "derived, never trusted as stored fact" principle, now applied across Sections instead of only within one.
- **Tiebreak (official IWF rule, verified this session):** earliest-timestamp/attempt-order — NOT bodyweight (outdated rule). This is a cross-Section tiebreak, correctly modeled as a Leaderboard-layer rule (comparing each Result's own `logged_at`/attempt-order metadata), not a Score-Model-level Tie-Break Key (which is scoped to one Section's own Result Attempts).

### 24. Part A: 3 RFT (Time) + Part B: 1RM Clean (Load)
- **Structure:** 2 Sections, independently scored — the mission's own headline multi-score example (§6 of the fresh mission), and the direct real-world confirmation from FCKB's own §11.1 ("Multi-Part Workout... each part scored independently... the source schema's single workout_format_id per workout row... cannot represent multi-part events at all").
- **Resolution:** R1 exactly. Two Results, two leaderboards, no combined ranking unless a coach explicitly configures one (matching the mission's own explicit non-assumption: "no combined ranking unless explicitly configured").

### 25. Three independent AMRAPs (same session, individually + optionally aggregate)
- **Structure:** 3 Sections, each `scheme: amrap`, independently scored (per R1) — three separate leaderboards, the mission's own "Option A."
- **Aggregate ("Option C," both individual and combined):** same resolution as #23's Total — a Leaderboard-layer derived SUM across the 3 Sections' Results, never a 4th Result. Confirms the same cross-Section-aggregate pattern handles both the weightlifting-Total case and the multi-AMRAP-total case with one mechanism, not two.

### 26. Buy-in + rounds + cash-out, only the middle scored
- **Structure:** 1 Section, composite Segment, `resultCombination: "primary-only"`, `primaryChildId` = the main block — Segment spec's own worked Example 4, unmodified, unchanged by this investigation.
- Confirms: this is a within-Section aggregation (Segment-owned), correctly distinct from #23–25's cross-Section aggregation (Leaderboard-owned) — the two mechanisms don't collide because they operate at different tree levels, exactly as `SEGMENT_MODEL_SPEC_v1.md` §0's own dividing line predicts.

### 27. Partner For Time (You-Go-I-Go)
- **Structure:** 1 Section, ordinary Duration/Composite Score Model, unchanged — the score belongs to the **team**, not the individual.
- **Gap named honestly (not resolved by this investigation):** Result's Member reference is today one-to-one (`RESULTS_DOMAIN_ARCHITECTURE.md` v1.0 ERD: `MEMBER ||--o{ RESULT`). A Partner/Team Result needs either a many-to-many Member reference or a "Team" as a first-class participant identity — **already named, already deferred**, in `RESULTS_DOMAIN_V1_1.md`'s own scope and `RISK_REVIEW.md`'s Future Feature Risks, restated here as confirmed-still-open by this adversarial pass, not newly discovered.

### 28. Team AMRAP (combined reps, team of 3, simultaneous)
- Same gap as #27 — Team/Relay's many-to-many Member reference. Not resolved here; correctly out of this investigation's scope per the same prior deferral.

### 29. HYROX-style fixed race (8 runs + 8 stations, one overall time)
- **Structure:** 1 Section, composite Segment, `restBetweenChildren: "as-programmed"` × 16 children (alternating run/station leaves), `resultCombination: "sum"` (Duration values sum to one race time) — models cleanly using the *existing* Segment composite mechanism, no HYROX-specific concept needed at the scoring layer (the canonical 16-leg sequence itself is content, authored once and reused, a Programming-side convenience, not a Results-side scoring concern).

### 30. Competition workout with tiebreak, points-across-events standing
- **Structure:** N Workouts (not Sections — a multi-day/multi-event competition, `SCORING_COMPETITIVE_LANDSCAPE.md` §5's own confirmed distinction between "multi-part workout" and "competition standings").
- **Resolution:** each event scores independently via the mechanisms above (#1–#29 cover every individual event shape); the cross-event points standing is Competition Mode (`LEADERBOARD_RULES.md` §9, already drafted, deliberately unfrozen) — explicitly, correctly out of this investigation's scope, per the fresh mission's own §33 instruction not to embed competition scoring inside ordinary WorkoutResult.

---

## Summary of gaps found (honest accounting, per the mission's own "if the model cannot express one cleanly, explain why" instruction)

| # | Gap | Owning layer | Status |
|---|---|---|---|
| 12 | Death By's ascending-interval scheme isn't in Segment v1's `Scheme` enum | Programming (Segment) | Named, not resolved — a Segment-spec addition, not a scoring-model gap |
| 15–16 | Interval primitive's aggregation enum needs a non-collapsing `'list'` value | Results (Score Model) | Small, additive — fills an already-open slot in an existing enum |
| 19 | PR keying needs `(movementId, targetRepMax)`, not just `movementId` | Results (PR Architecture) | Small, additive clarification — already implicit, made explicit |
| 21–23 | Result Attempt needs an optional `outcome: SUCCESS\|FAIL` field, gated by a new `attemptTracking` Score Model flag | Results (Score Model + Result Attempt) | The one genuinely new field this whole exercise justifies |
| 23, 25 | Cross-Section aggregate (Total, combined-AMRAP-sum) | Results (Leaderboard, derived-view only) | Resolved: never a new Result, always a read-time Leaderboard derivation over already-scored Sections |
| 27–28 | Team/Partner scoring needs Result's Member reference to become many-to-many | Results (core entity) | Already named and deferred by prior work; confirmed still-open, not newly discovered, not resolved here |
| 30 | Cross-event competition standing | Leaderboard (Competition Mode) | Already drafted, deliberately unfrozen; correctly out of scope |

**Nothing in this 30-workout pass required a new top-level entity beyond what `RESULTS_DOMAIN_ARCHITECTURE.md` v1.0/`RESULTS_DOMAIN_V1_1.md`/`PROGRAMMING_DOMAIN_V1_2.md`/`SEGMENT_MODEL_SPEC_v1.md` already specify**, once R1 (multiple scored Sections per Workout, Result scoped to Section) and R2 (explicit `completionState`) are applied, plus the two small, independently-justified additive fields named above (`Interval.aggregation: 'list'`, `ResultAttempt.outcome`). Every remaining gap was already known and already deferred by prior work, not discovered fresh by this exercise — the model survived the adversarial pass without requiring a new abstraction.
