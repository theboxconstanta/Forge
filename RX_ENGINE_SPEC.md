# Forge — Rx Engine Specification

**Owning domain:** Results (`RESULTS_DOMAIN_V1_1.md` §5)
**Status:** Draft for review
**Prior art:** `src/rxEngine.js` (WOD-SIMPLE, shipped in production, Results Phase 3) — this specification is a generalization of that engine's already-proven design, not a new invention. Every design choice below either extends a decision that engine already made or explicitly supersedes it, named as such.

---

## 1. Why a boolean was always wrong, and what replaces it

`rxEngine.js`'s shipped `classifyRxStatus` returns `'rx' | 'not_rx' | null`. This was correct for its scope (single-dimension Load comparison against one binary threshold) but does not generalize: it cannot represent *why* a classification was reached, cannot represent a four-tier outcome, cannot represent partial compliance (correct movement, wrong load; correct load, substituted movement), and cannot separately answer "is this Rx" versus "is this eligible to appear on a leaderboard at all" — two genuinely different questions today silently conflated into one boolean. This specification replaces the boolean with a structured **ValidationRecord**, produced once per Result, persisted as part of that Result's permanent record (`RESULTS_DOMAIN_V1_1.md` §4).

## 2. ValidationRecord — structure

```
ValidationRecord {
  resultId
  performedVariant: {
    movements: [{ movementId, loadValue?, loadUnit?, repsCompleted? }]
    scoreValue: <the primitive Score value(s) actually logged>
  }
  prescribedVariant: {
    scalingLevelId          // which tier's Scaling Profile this comparison was run against
    movements: [{ movementId, loadValue?, loadUnit?, repsRequired? }]
  }
  rxEligible: boolean | null          // null = "cannot classify", never a false negative
  classifiedTier: ScalingLevelId | 'modified' | null
  leaderboardEligible: boolean
  scalingDelta: {
    loadDeltaPercent?: number         // performed vs. prescribed, signed
    repDeltaCount?: number
  }
  movementSubstitutions: [{ prescribedMovementId, performedMovementId, substitutionRecognized: boolean }]
  loadDeviations: [{ movementId, prescribedLoad, performedLoad, withinTolerance: boolean }]
  repDeviations: [{ movementId, prescribedReps, performedReps }]
  validationReasons: [ValidationReasonCode]   // see §5
  confidenceScore: number   // 0.0–1.0, per FCKB_ARCHITECTURE_REVIEW.md §6's confidence-scoring recommendation
}
```

This is the literal answer to the mission's explicit instruction: "instead of a boolean, define a structured classification object" — every field above is either already-proven in `rxEngine.js` (performed/prescribed comparison, graceful null-on-ambiguity) or a direct, named generalization of it.

## 3. Decision matrix

The classifier evaluates, per Scaling Level tier, from most to least strict (Rx first), and assigns `classifiedTier` to the **highest** tier the performed Attempt meets or exceeds on every dimension that tier's Scaling Profile prescribes:

| Dimension | Comparison rule | On ambiguity/unparseable input |
|---|---|---|
| **Movement** | `performedMovementId == prescribedMovementId`, OR a recognized substitution relationship exists in the Movement Library pointing from the prescribed movement toward an *easier* tier (a substitution recognized for Intermediate does not itself satisfy Rx) | Movement unresolved (no `canonicalName`, `PROGRAMMING_DOMAIN_V1_2.md` §5) → that movement dimension is excluded from comparison for this Result, `confidenceScore` reduced accordingly, never silently assumed to match |
| **Load** | `performedLoadKg >= prescribedLoadKg` (canonical-unit comparison, reusing Results v1.0 §10 unit conversion directly) | No parseable Load Profile for this movement → dimension excluded, not treated as automatic pass or fail (this exact rule is `rxEngine.js`'s own `MULTI_MOVEMENT_STANDARD`/null-return discipline, generalized) |
| **Reps/Rounds** | `performedReps >= prescribedReps` for the Section's declared work, OR `roundsCompleted >= prescribedRounds` under the Composite comparison rule (`RESULTS_DOMAIN_V1_1.md` §3) | A Section logged only as a whole-workout Score with no Result Attempt-level rep breakdown → dimension excluded (a Minimal-Core, §Log-Score-Architecture-compliant log never blocks classification, it only reduces the dimensions the classifier can check) |
| **Equipment** | `performedEquipment ⊇ prescribedEquipment` where equipment metadata exists on the Movement Library entry | No equipment metadata recorded → dimension excluded |
| **Order** | Sequence of logged Result Attempts matches the Section's declared Movement order | Whole-workout (non-split) logging → dimension excluded (order is only checkable when split logging, `RESULTS_DOMAIN_V1_1.md`/§Log-Score-Architecture, is used) |
| **Time-cap behavior** | A capped, incomplete Result never classifies above the tier its `cappedScoringRule` (`RESULTS_DOMAIN_V1_1.md` §3) explicitly allows — e.g., a Reps-as-Count capped Result is compared against the prescribed rep target for that tier, exactly like an uncapped Count comparison, with no special exemption | N/A — cap behavior is always fully determined by the Score Model, never ambiguous by construction |

**Tier assignment rule**: `classifiedTier = ` the strictest (highest) Scaling Level for which every *non-excluded* dimension above passes. If zero excluded dimensions and zero tiers pass, `classifiedTier = 'modified'`. If every checkable dimension is excluded (total ambiguity — e.g., an entirely free-text-logged Result against an entirely free-text-prescribed Section with no structured Load Profile anywhere), `classifiedTier = null` and `rxEligible = null` — **never** a default assumption in either direction, directly satisfying `rxEngine.js`'s own governing discipline, generalized to the full multi-dimension case.

## 4. Rx eligibility vs. leaderboard eligibility — the two questions this replaces the single boolean to keep separate

- **`rxEligible`**: `classifiedTier == prescribedVariant.scalingLevelId` for the specific Scaling Level the Result's own Scoring Snapshot declared (`RESULTS_DOMAIN_V1_1.md` §2, `scalingContext`). This answers "did this athlete actually do what they claimed to do."
- **`leaderboardEligible`**: `true` whenever `classifiedTier` is non-null, **regardless of whether it equals the declared tier.** A Result classifying as Beginner when the athlete declared Intermediate is still leaderboard-eligible — it simply ranks in the Beginner leaderboard (`RESULTS_DOMAIN_V1_1.md` §6.1, §7.1), not the Intermediate one. `leaderboardEligible = false` only when `classifiedTier` is `null` (total ambiguity, §3) or `'modified'` **and** the platform's leaderboard configuration excludes Modified from ranked display (a gym-configurable choice, not a hardcoded rule — some gyms may want to rank Modified results for participation purposes, others may not; this document names the toggle, `LEADERBOARD_RULES.md` §1 specifies its default).

## 5. Validation reason codes (non-exhaustive, illustrative set)

`MOVEMENT_MATCH`, `MOVEMENT_SUBSTITUTED_RECOGNIZED`, `MOVEMENT_SUBSTITUTED_UNRECOGNIZED`, `MOVEMENT_UNRESOLVED`, `LOAD_MET`, `LOAD_BELOW_PRESCRIBED`, `LOAD_UNPARSEABLE`, `REPS_MET`, `REPS_BELOW_PRESCRIBED`, `NO_REP_BREAKDOWN`, `MULTI_MOVEMENT_AMBIGUOUS` (directly ported from `rxEngine.js`'s existing `MULTI_MOVEMENT_STANDARD` sentinel), `TIME_CAP_REACHED`, `NO_PRESCRIPTION_AVAILABLE`. Every reason code is additive, append-only vocabulary (a new code may be added; an existing one is never repurposed to mean something else, for the same historical-integrity reasons Results v1.0 §15 already applies elsewhere).

## 6. Determinism and re-runnability

The Rx Engine is a pure function of `(Result Attempt content, WorkoutVersion's Scaling Profiles)`, both immutable (`RESULTS_DOMAIN_V1_1.md` §9, `PROGRAMMING_DOMAIN_V1_2.md` §4). This means a ValidationRecord is not merely cached — it is **re-derivable, exactly, forever**, which is what makes it safe to treat as part of a Result's permanent record (§9's historical-reproducibility guarantee) rather than a fragile, one-time computation. If the Rx Engine's own comparison logic is later improved (e.g., a new alias resolution rule resolves a previously-`MOVEMENT_UNRESOLVED` movement), re-running the engine against old, immutable Results produces a *new* ValidationRecord for that Result, appended alongside the original (never overwriting it, per the same append-only discipline as PR Events, `RESULTS_DOMAIN_ARCHITECTURE.md` §8.6) — the athlete's leaderboard position may improve retroactively as a direct, disclosed, and correct consequence, never as a silent, unexplained change.
