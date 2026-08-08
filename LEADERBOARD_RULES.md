# Forge — Leaderboard Rules

**Owning domain:** Results (`RESULTS_DOMAIN_V1_1.md` §7)
**Status:** Draft for review

All six categories (Rx, Intermediate, Beginner, OnRamp, Adaptive, Open) share one computation mechanism (`RESULTS_DOMAIN_ARCHITECTURE.md` v1.0 §11.1, unmodified: computed at read time, never a stored competing authority). This document specifies the rules that mechanism applies, per category and per edge case.

---

## 1. Category eligibility rules

| Category | Included Results | Excluded Results |
|---|---|---|
| **Rx** | `classifiedTier == 'rx'` (`RX_ENGINE_SPEC.md` §3-4) | Anything classified below Rx, `classifiedTier == null`, `classifiedTier == 'modified'` |
| **Intermediate** | `classifiedTier == 'intermediate'` | Anything else |
| **Beginner** | `classifiedTier == 'beginner'` | Anything else |
| **OnRamp** | `classifiedTier == 'onramp'` | Anything else |
| **Adaptive** | `scalingContext.scalingLevelId == 'adaptive'` (declared, not Rx-Engine-classified — `RESULTS_DOMAIN_V1_1.md` §7.1) | Any non-Adaptive-declared Result |
| **Open** | Union of Rx/Intermediate/Beginner/OnRamp/Adaptive, `leaderboardEligible == true` | `classifiedTier == null` always; `classifiedTier == 'modified'` per the gym-configurable toggle named in `RX_ENGINE_SPEC.md` §4, **default: excluded** |

The `'modified'`-inclusion default is stated here as this document's own binding decision, not left ambiguous: **Modified results are excluded from every ranked leaderboard by default.** Rationale: a Modified classification means the Rx Engine could not confirm the athlete met *any* tier's prescription on the checked dimensions — ranking it would imply a comparability the classification explicitly could not establish. A gym may opt in to a separate, clearly-labeled "Participation" view including Modified results; that view is out of this document's scope (a presentation concern, not a ranking rule).

## 2. Duplicate prevention

An athlete may log multiple Attempts against the same `(WorkoutVersion or Benchmark, date)` pair (a re-attempt, a correction). Leaderboard eligibility (`RESULTS_DOMAIN_V1_1.md` §7.2) is scoped to **the athlete's single best non-deleted, non-superseded Result** for that pair, determined by the Score Model's own declared comparison direction (§6.2's higher/lower-is-better rule) — not "most recent," "best," matching universal CrossFit leaderboard convention (an athlete's best score for the day counts, not their last attempt chronologically). A Benchmark leaderboard spanning multiple calendar days (`RESULTS_DOMAIN_ARCHITECTURE.md` v1.0 §7.5, §11.2) applies this same best-of rule per distinct date, then further reduces to one entry per athlete per requested date range only if the leaderboard view is explicitly "personal-best-of-range" mode; a "daily leaderboard" view naturally shows one row per athlete per day with no further reduction needed.

## 3. Tie resolution

Standard competition ranking (1-1-3), `RESULTS_DOMAIN_ARCHITECTURE.md` v1.0 §11.4, unmodified as the default. Where a Score Model declares a Tie-Break Key (`RESULTS_DOMAIN_V1_1.md` §3), a tie at the primary Score is resolved first by the named secondary Attempt value (e.g., time-to-a-mid-workout-rep-marker) before falling back to shared rank; a tie that persists after applying the Tie-Break Key still shares rank per the 1-1-3 convention — a Tie-Break Key narrows ties, it does not eliminate the possibility of one.

## 4. Version isolation

A Workout leaderboard is scoped to results referencing the **same WorkoutVersion identity chain** — specifically, every WorkoutVersion beneath one Workout, since a coach's post-publish correction (`PROGRAMMING_DOMAIN_V1_2.md` §4) does not change what athletes were actually doing in any way that should split them onto different leaderboards (the same physical workout, corrected). A **Benchmark** leaderboard deliberately spans every WorkoutVersion of every distinct Workout that ever carried that Benchmark identity (`RESULTS_DOMAIN_ARCHITECTURE.md` v1.0 §7.5, unmodified) — the wider, intentional aggregation Benchmark identity exists to unlock. The one case version isolation must actively prevent: a WorkoutVersion edit that changes the **Score Model itself** (e.g., a Section's format changes from Rounds+Reps to a straight Duration score, an edit Programming permits per its content-stability contract) produces Results whose Scoring Snapshots declare genuinely different, non-comparable Score Models. A leaderboard read spanning such a boundary must partition by Score Model identity in addition to Scaling tier — named here as a required check, not merely a theoretical edge case, since Programming's content-stability contract explicitly permits exactly this kind of edit.

## 5. Unit normalization

Every Load and Distance comparison and every displayed value uses Results v1.0 §10's canonical-storage-plus-read-time-conversion model, unmodified. A leaderboard's internal ranking always compares canonical-unit values; only display converts per-viewer, per Member preference (v1.0 §10.3, "two Members viewing the same Benchmark leaderboard in their own respective preferred units is expected and correct... never two different stored facts").

## 6. Late submissions

A Result logged against a Workout/Benchmark identity after the "natural" logging window (e.g., days after the Workout's own Day) is leaderboard-eligible under the exact same rules as a same-day log — Results' domain model carries no concept of a logging deadline for ordinary (non-competition-mode) leaderboards, matching v1.0's own silence on this point (deliberate, not an oversight: a gym's own social/community norms govern "when is it too late to log," not the domain model). **Competition mode** (§7 below) is the one context where lateness has a hard, enforced consequence.

## 7. Edited submissions

An edit to an already-logged Result's Score is treated, for leaderboard purposes, exactly as Results v1.0 §8.4 already specifies for PR purposes: the edited Result simply produces a different value on the *next* leaderboard read (v1.0 §11.1's computed-at-read-time principle applies without modification — there is no separate "leaderboard edit" concept to design, because there is no stored leaderboard row to edit). One addition: an edit that changes a Result's `classifiedTier` (via re-running the Rx Engine, `RX_ENGINE_SPEC.md` §6) moves that Result to a different category's leaderboard on the next read, with no manual re-categorization step required — a direct, correct consequence of category membership being a computed property, not a stored assignment.

## 8. Judge verification

Not modeled in Results v1.0 and not a gap this document invents a full solution for — named here as a real, disclosed extension point. The recommended shape, consistent with this package's existing patterns: a `judgeVerification` field on ValidationRecord (`RX_ENGINE_SPEC.md` §2), `{ verifiedBy: memberId, verifiedAt: timestamp, verificationNotes }`, optional, additive, never required for ordinary leaderboard eligibility. Its only leaderboard-visible effect, when a gym enables **competition mode** (§7 below) for a specific event, is: an un-verified Result is excluded from that event's competition-mode leaderboard specifically (not from ordinary gym leaderboards), forcing explicit judge sign-off before a competition result counts — this is the one place this document recommends leaderboard eligibility depend on something beyond the Rx Engine's own automatic classification, and it is scoped deliberately narrowly (competition mode only) to avoid weakening the "user does not decide Rx status" guarantee for ordinary daily training.

## 9. Competition mode

A leaderboard-level configuration, not a Score Model or Workout-level one, activated per event: `{ scoringWindowStart, scoringWindowEnd, requiresJudgeVerification: boolean, freezeAt: timestamp | null }`.

- **Scoring window**: Results logged outside `[scoringWindowStart, scoringWindowEnd]` are excluded from the competition-mode leaderboard (though they remain ordinary, fully valid Results for every other purpose — training history, PR tracking, gym leaderboards — competition-mode exclusion is a read-time filter, not a write-time rejection).
- **Freeze semantics**: this is the one deliberate, named exception to Results v1.0 §11.1's "always computed fresh" rule, and is named here as exactly that — an exception, not a silent departure. When `freezeAt` is set and reached, the competition-mode leaderboard's read-time computation is pinned to the Result set *as of* `freezeAt`, ignoring any Result logged, edited, or deleted after that timestamp for **this leaderboard view only**. The underlying Results are entirely unaffected (they remain live, editable, and correctly reflected in every non-frozen leaderboard view — gym leaderboards, Benchmark history, personal history) — freeze is a property of one specific read-time query's time-bound, not a mutation of any stored data, and is implemented as a parameterized historical read (`RESULTS_DOMAIN_ARCHITECTURE.md` v1.0 §11.3's existing "historical leaderboards... parameterized by a past date... no separate historical storage required" mechanism, applied at a instant-of-time granularity instead of a date granularity).
- **Why this does not weaken Results' core invariant**: a frozen competition-mode read and a live, current-state read of the same underlying data can legitimately disagree after `freezeAt` (e.g., an athlete's Result is later corrected for an unrelated typo) — this is intentional and disclosed, exactly the kind of real, honest tension a competition integrity requirement creates against a "leaderboard is always fresh" default, resolved by scoping the exception to one explicitly-labeled view rather than changing the underlying mechanism for everyone.
