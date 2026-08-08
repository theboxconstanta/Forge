# Forge Results Domain — v1.1 Hardening

**Status:** Draft, additive/hardening relative to `RESULTS_DOMAIN_ARCHITECTURE.md` v1.0 (Proposed for Freeze)
**Prepared:** 2026-08-08

This document specifies what changes, is formalized, or is newly named relative to v1.0. It restates v1.0 content only where necessary to show the delta in context. Where silent, v1.0 governs unmodified. Every principle, invariant, and entity in v1.0 §2, §4, §5, §7, §8, §9, §10 remains in force exactly as frozen; this document adds to it.

---

## 1. Domain boundary restatement

Unchanged from v1.0 §3: Results sits between Programming and Membership (frozen, supplying context) and Classes/Attendance (frozen, deliberately untouched), with Dashboard as a future read-only consumer. This document adds exactly one boundary clarification: **Results now references Programming's WorkoutVersion (`PROGRAMMING_DOMAIN_V1_2.md` §3), not bare Workout identity, for every Scoring Snapshot.** This is a strengthening of v1.0's own reference, not a new dependency direction — v1.0 already depended on Programming's content-stability contract; this document depends on the concrete entity that contract now formally produces. Programming remains completely unaware Results exists, unmodified.

## 2. Result aggregate

Unchanged in composition from v1.0 §4.1: Result, Result Attempt (child), Scoring Snapshot (owned, one-to-one). One field addition to Scoring Snapshot:

- **v1.0 Scoring Snapshot**: `{ scoreModel, scalingContext }`, captured at logging time.
- **v1.1 Scoring Snapshot**: `{ scoreModel, scalingContext, workoutVersionRef, renderedVariantHash }`.
  - `workoutVersionRef` — the specific `(workout_id, version_number)` the athlete was training against, permanently resolvable per `PROGRAMMING_DOMAIN_V1_2.md` §4 rule 2.
  - `renderedVariantHash` — a content hash of the specific RenderedVariant (`VARIANT_GENERATION_ENGINE.md`) the athlete actually viewed at log time, captured for reproducibility auditing (§8 below) and for detecting the rare race condition where a WorkoutVersion changes between an athlete opening a Workout and logging against it (`RISK_REVIEW.md`, concurrency section). This is a diagnostic field, not a ranking or classification input — it changes nothing about how a Score is interpreted, which remains governed entirely by `scoreModel`/`scalingContext` exactly as v1.0 §5.1 specifies.

## 3. Score model and score types

Unchanged from v1.0 §6.2's primitive-composition model (Duration, Count, Load, Distance, Completion, Composite, Interval, Max Effort). Two additive properties, both already anticipated as safe extensions in `SCORING_DOMAIN_ARCHITECTURE_INVESTIGATION.md` §7:

- **Time Cap Declaration**: `{ capDuration, cappedScoringRule: 'reps-as-count' | 'rounds-and-reps-as-composite' | 'completion-only' }`, optional on any Duration-primary Score Model. Governs the exact capped-scoring behavior specified in `SCORING_DOMAIN_ARCHITECTURE_INVESTIGATION.md` §7.2, restated here as binding: a capped, incomplete result under `reps-as-count`/`rounds-and-reps-as-composite` always ranks below every completed Duration result in the same leaderboard partition, never compared on a shared numeric scale.
- **Tie-Break Key**: `{ sourceAttemptRole: string }`, optional, naming which Result Attempt (by its declared role within the Score Model, e.g., "rep 1 split") supplies a secondary comparison value when the primary Score is tied. Absent by default; required only for competition-mode Score Models (`LEADERBOARD_RULES.md` §7).

## 4. Validation pipeline

New in v1.1, formalizing v1.0 §13's already-named-but-unspecified "Score validation" shared engine. On every Result write (create or Score-changing edit):

```
Result Attempt → Rx Engine (RX_ENGINE_SPEC.md) → ValidationRecord → persisted as part of the Result
```

The Validation pipeline runs synchronously at write time (matching v1.0 §8.1's existing PR-check timing precedent — "checked automatically at the moment it is logged... no client re-implements this check"), is idempotent (re-running it against the same immutable inputs — Result Attempt content, WorkoutVersion's Scaling Profiles — always produces the same ValidationRecord), and is the single, shared implementation every client invokes, per v1.0 §13's Cross-Interface Contract, unmodified.

## 5. Generalized Rx Engine

Full specification in `RX_ENGINE_SPEC.md`. Summarized here as a Results-owned capability: the Rx Engine consumes a Result Attempt and the WorkoutVersion's Scaling Profiles (Programming-owned, referenced not duplicated) and produces a structured ValidationRecord — never a boolean, never a client-computed classification (v1.0 §13, unmodified). It is the concrete, generalized evolution of `rxEngine.js`, already shipped in production as Results Phase 3.

## 6. Variant classification and AnalyticsEvent

### 6.1 Variant classification

A Result's ValidationRecord (§5) names the Scaling Level tier the logged Attempt classifies as (`RX_ENGINE_SPEC.md` §3's decision matrix). This value is what Results §9's Scaling Context *should have been declared as*, cross-checked against what the athlete's Scoring Snapshot *actually declares* — the two may disagree (an athlete logging under a self-selected "Intermediate" Scaling Context whose actual performed load, per the Rx Engine, only meets Beginner-tier prescription). Both values are preserved: `scalingContext` (declared, from the Scoring Snapshot, v1.0 §9, unmodified) and `classifiedTier` (computed, from the ValidationRecord, new in v1.1). Leaderboard partitioning (`LEADERBOARD_RULES.md`) uses `classifiedTier`, not the athlete's self-declared `scalingContext`, directly satisfying this package's own explicit design goal ("the user must not decide whether a workout is Rx" — restated from `SCORING_DOMAIN_ARCHITECTURE_INVESTIGATION.md` §9.1) as a hard leaderboard-eligibility rule, not merely a display nicety.

### 6.2 AnalyticsEvent

New true entity, append-only, immutable once written: `{ eventType: 'result-logged' | 'result-edited' | 'result-deleted' | 'pr-achieved', memberId, gymId, timestamp, resultRef, payload }`. Emitted synchronously alongside every Result write and every PR Event (v1.0 §8.6, unmodified) — one write-path, two append-only outputs, never a background job that could silently fall behind or fail independently of the write it describes. Every aggregation named in v1.0 §12 (Athlete/Coach/Owner analytics) is redefined, in this document, as a pure function over the AnalyticsEvent stream, not over raw Result rows directly — a strictly stronger, more auditable guarantee than v1.0 stated, and the mechanism that makes "analytics can be recomputed from immutable history" (`ARCHITECTURAL_INVARIANTS.md`) literal rather than aspirational: a full analytics rebuild replays the AnalyticsEvent stream from the beginning, never re-derives intent from mutable state, because there is none — Result itself is already append-only-with-edit-as-new-fact (v1.0 §8.4) and now has an append-only event shadow to match.

## 7. Leaderboard eligibility and categories

### 7.1 Categories

Six named partitions, all instances of the single leaderboard mechanism v1.0 §11.2-§11.3 already specifies — no new ranking logic, an explicit enumeration of what was already a general `classifiedTier` (§6.1) partition key: **Rx, Intermediate, Beginner, OnRamp, Adaptive, Open.** Adaptive and Open are new names, defined here:

- **Adaptive** — a Result logged under a gym-declared Adaptive Scaling Context (v1.1's gym-extensible Scaling Level catalog, `PROGRAMMING_DOMAIN_V1_2.md` §7 unmodified in this respect from v1.1). The Rx Engine does not attempt Load/Rep/Movement classification against an Adaptive Scaling Context's own prescription in the same deterministic way it does for Rx/Intermediate/Beginner/OnRamp (`RX_ENGINE_SPEC.md` §4) — an Adaptive Result's `classifiedTier` is definitionally `'adaptive'`, taken directly from the declared Scaling Context, since adaptive prescriptions are inherently individualized and not meaningfully comparable against a single fixed standard.
- **Open** — not a Scaling Level at all; a **leaderboard-only** category representing the union of every classified tier's results, ranked together, used specifically for CrossFit Open-style competition scoring where all divisions/scaled categories are shown on one combined event leaderboard with separate internal filters. This is a read-time view composition, not a seventh Scaling Level, and requires no new Scaling Context value.

### 7.2 Eligibility

A Result is leaderboard-eligible if and only if: (a) its ValidationRecord's `leaderboardEligible` field is `true` (`RX_ENGINE_SPEC.md` §3 — distinct from Rx eligibility; a Not-Rx-classified Result is still leaderboard-eligible, ranked in its own classified tier); (b) it references a Workout or Benchmark identity that has not been withdrawn without tombstone resolution (v1.0 §5.3, unmodified); (c) it is the athlete's most recent, non-deleted Result against that specific `(WorkoutVersion or Benchmark, date)` pair — duplicate-prevention detail in `LEADERBOARD_RULES.md` §2.

## 8. Tie-break handling

Standard competition ranking (1-1-3, v1.0 §11.4, unmodified) applies first. Where a Score Model declares a Tie-Break Key (§3), a genuine tie at the primary Score is broken by the named secondary Attempt value before falling back to shared rank — full behavior in `LEADERBOARD_RULES.md` §5.

## 9. Immutable result guarantees

Unchanged from v1.0 §2.1, §2.2, §5, §8.6 in full. This document adds one guarantee, made possible by §2's `workoutVersionRef`: **a Result's full interpretive context — Score Model, Scaling Context, and now the exact WorkoutVersion and RenderedVariant it was logged against — is 100% reconstructable at any future date, without approximation**, closing the one remaining gap v1.0 left implicit (v1.0 relied on Programming's Workout *plus* the Scoring Snapshot; this document relies on a specific, immutable WorkoutVersion *referenced by* the Scoring Snapshot, removing any dependency on Programming's current, mutable state to reconstruct history).

## 10. Historical reproducibility guarantees

Stated as a single, composed guarantee, assembled entirely from already-frozen or already-hardened pieces, added here for the first time as an explicit, named property of the domain rather than an implicit consequence a reader would have to derive themselves:

**Given any Result, at any point in the platform's future, the following are all independently, deterministically reconstructable with no ambiguity and no dependency on Programming's or Results' current mutable state:** the exact Score and what it meant (Scoring Snapshot, v1.0 §5.1); the exact content the athlete trained against (WorkoutVersion, `PROGRAMMING_DOMAIN_V1_2.md` §3-§4); the exact rendered view the athlete saw (RenderedVariant, reconstructable from WorkoutVersion + Scaling Context + the Variant Generation Rule Set version in effect, `VARIANT_GENERATION_ENGINE.md` §3); the exact Rx/tier classification decision and why (ValidationRecord, `RX_ENGINE_SPEC.md`, itself a pure function of immutable inputs and therefore re-derivable, not merely stored); and the exact sequence of analytics-relevant facts (AnalyticsEvent stream, §6.2). No part of this chain requires trusting a cached or mutable value; every link is either immutable data or a pure function over immutable data.

---

## 11. What remains entirely unchanged from v1.0

Design Principles §2.1-§2.9 in full; the Entity Summary and its "true entity vs. derived view" classification for every v1.0 entity (§4.1-§4.3), unmodified except for the one Scoring Snapshot field addition in §2 above; the entire Historical Permanence Model (§5) as the governing model, now with one entity (WorkoutVersion) formalizing what it already relied on; Benchmark Architecture (§7) in full; Personal Record Architecture (§8) in full, including the three-category (not four) decision and the manual-attestation exception; Scaling Architecture (§9) in full — Scaling Context still references Programming's one catalog, never a second vocabulary; Unit Architecture (§10) in full; Leaderboard Architecture's computed-never-stored principle (§11.1) and partitioning logic (§11.3), extended in scope (§7 above) but not altered in mechanism; the Cross-Interface Contract (§13) in full; every Non-Negotiable Invariant (§15) in full, none weakened, several (1, 6, 7, 11) now more strongly enforceable given §2's and §6.2's additions.
