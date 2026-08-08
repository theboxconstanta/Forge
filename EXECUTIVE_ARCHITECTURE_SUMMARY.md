# Forge — Executive Architecture Summary

**Package:** Architecture Review Package for Results Domain v1.1 Freeze Candidacy
**Status:** Draft for Principal Architect Review — not approved, not frozen
**Prepared:** 2026-08-08
**Scope of this document:** orientation only. Each responsibility named below is specified to implementation depth in its own document within this package.

---

## 1. Purpose of this package

This package documents the complete design required to freeze Results Domain v1.1 without introducing a new domain and without modifying the two domains already frozen (Member, Financial) or redesigning the domain already frozen (Programming v1.1) beyond the additive delta this package proposes as v1.2. It exists because `SCORING_DOMAIN_ARCHITECTURE_INVESTIGATION.md` concluded that the platform's next major capability — automatic variant generation and deterministic Rx classification — requires no new domain, only implementation of what Programming and Results already own, plus two precisely-scoped additive engines. This package is that implementation-ready design.

## 2. System boundaries

Four domains exist. Two are closed to this package by mandate; two are its subject.

| Domain | Status | In scope for this package? |
|---|---|---|
| **Member Domain** | Frozen | No. Referenced only by identity (a Result attaches to a Member; a Member has a display-unit preference and a training-level signal). Zero proposed change. |
| **Financial Domain** | Frozen | No. Zero relationship to anything in this package, named for completeness only, matching Results v1.0's own symmetry statement. |
| **Programming Domain** | Frozen v1.1 → proposed v1.2 (this package) | Yes, additively. v1.1's Workout/Day/Section/Movement/Scaling/Benchmark Identity/Metadata/Notes/Media model is unchanged in shape. v1.2 adds WorkoutVersion, Movement Identity resolution, Load Profile, Scaling Profile, and Variant Generation Engine ownership — all additive extensions, none requiring v1.1's existing entities to change meaning. |
| **Results Domain** | Proposed for Freeze v1.0 → hardened v1.1 (this package) | Yes. v1.0's Result/Result Attempt/Scoring Snapshot/Benchmark/Scaling Context/Personal Record/PR Event/Leaderboard model is unchanged in shape. v1.1 hardens the Score Model to reference WorkoutVersion explicitly, formalizes the Rx Engine as a named shared engine producing a ValidationRecord, formalizes AnalyticsEvent as the substrate for reproducible analytics, and names six leaderboard categories explicitly. |

No entity in this package requires Member, Financial, or the *shape* of Programming v1.1 or Results v1.0 to change. Every new entity is additive, and every behavioral change is a formalization of a behavior already implied but not previously named (see `PROGRAMMING_DOMAIN_V1_2.md` §1 for the one place this package departs furthest from its predecessor's stated position, and the explicit reasoning for why that departure is additive rather than contradictory).

## 3. Programming responsibilities (v1.2)

Programming remains the domain of authored intent: what a coach means for a Day's training to be. Its v1.2 responsibilities, unchanged in kind from v1.1 and expanded in depth:

- Own Workout identity, Day anchoring, Section structure, and the Draft → Published lifecycle with content-stability guarantees (v1.1, unchanged).
- **New in v1.2:** own an immutable, append-only **WorkoutVersion** lineage beneath each Workout — the formal, addressable answer to "detectable revision," not a new promise, a new addressable entity behind an existing promise.
- **New in v1.2:** own **Movement Identity** resolution (canonical Movement + alias resolution, populating the `canonicalName` field Programming's own domain model has carried as a stub since Phase 1).
- **New in v1.2:** own **Load Profile** and **Scaling Profile** as structured elaborations of what a Scaling Variant already is conceptually in v1.1 — a named, ordered variant of a Workout or Section — now with a machine-readable shape a generation engine can read and write, not only a human-readable free-text field.
- **New in v1.2:** own the **Variant Generation Engine** — an authoring-time capability that proposes Scaling Profile content for Intermediate/Beginner/OnRamp/gym-custom tiers from a coach-authored base, always coach-reviewable, never self-publishing (Programming v1.1 §2's existing AI-assistance principle, applied to this new generator without modification).

Programming does **not** decide how results are shown, validated, ranked, or analyzed. This boundary is unchanged from v1.1 §Out of Scope and is load-bearing to this entire package.

## 4. Results responsibilities (v1.1)

Results remains the domain of what actually happened. Its v1.1 responsibilities, unchanged in kind from v1.0 and expanded in depth:

- Own the Result/Result Attempt/Scoring Snapshot/PR Event model, and the historical-permanence guarantee that no Programming action can destroy or silently reinterpret a logged Result (v1.0, unchanged).
- **New in v1.1:** pin every Result's Scoring Snapshot to a specific, immutable **WorkoutVersion** rather than to Programming's mutable Workout identity plus an informal detectable-revision promise — closing the last gap between "interpretation frozen at logging time" (v1.0 §2.1) and true machine-verifiable determinism.
- **New in v1.1:** own the generalized **Rx Engine** as the concrete implementation of the Score-validation engine v1.0 §13 already named but did not specify, producing a structured **ValidationRecord**, never a boolean.
- **New in v1.1:** formalize **AnalyticsEvent** as an append-only substrate emitted alongside every Result write, making "analytics can be recomputed from immutable history" a literal, mechanical guarantee rather than an aspirational aggregation strategy.
- **New in v1.1:** name six leaderboard categories explicitly (Rx, Intermediate, Beginner, OnRamp, Adaptive, Open) as partitions of the same single leaderboard mechanism v1.0 §11 already specified — no new ranking logic, an explicit enumeration of an already-general partition key.

## 5. Variant Generation Engine responsibilities

A stateless, deterministic, authoring-time transformation: `(base Scaling Profile, target tier, Movement Library, gym-configured Variant Generation Rules) → proposed Scaling Profile`. It never writes Programming content without coach review-and-accept; its output is indistinguishable from hand-authored content once accepted. Full design in `VARIANT_GENERATION_ENGINE.md`.

## 6. Rx Engine responsibilities

A stateless, deterministic, log-time (and re-runnable, historically, at any later time against the same immutable inputs) classification: `(Result Attempt, WorkoutVersion's Scaling Profiles) → ValidationRecord`. It never asks the athlete to self-declare Rx status; it never produces a false negative from ambiguous input — it produces "cannot classify" instead. Full design in `RX_ENGINE_SPEC.md`.

## 7. Rendering pipeline (summary)

```
WorkoutVersion (immutable) + Athlete Context (Scaling Context, unit preference)
   → RenderedVariant (deterministic, view-time, cacheable but never authoritative)
   → displayed to athlete
```

Rendering occurs at **view time**, never at publish time (which would require Programming to fork content per athlete, contradicting v1.1's single-shared-Workout-per-Day model) and never fully re-resolved at log time (which would break Scoring Snapshot determinism). Full design in `VARIANT_GENERATION_ENGINE.md` §2.

## 8. Validation pipeline (summary)

```
Result Attempt logged
   → Rx Engine reads the WorkoutVersion's Scaling Profiles (the same immutable content the RenderedVariant was computed from)
   → produces ValidationRecord (performed variant, prescribed variant, Rx/leaderboard eligibility, deltas, reasons)
   → ValidationRecord persisted as part of the Result's own permanent record
```

Full design in `RX_ENGINE_SPEC.md`.

## 9. Leaderboard pipeline (summary)

```
Read request (Workout or Benchmark, date range, category)
   → filter Results by WorkoutVersion/Benchmark identity + ValidationRecord.leaderboardEligible + category
   → partition by category (Rx/Intermediate/Beginner/OnRamp/Adaptive/Open)
   → order by the Score Model's declared comparison rule
   → apply standard competition tie ranking (1-1-3)
   → return LeaderboardEntry rows (derived, not authoritative — see ERD.md)
```

Full design in `LEADERBOARD_RULES.md`.

## 10. Analytics pipeline (summary)

```
Every Result write (create/edit/delete) and every PR Event
   → emits an AnalyticsEvent (append-only, immutable)
   → downstream aggregations (Athlete/Coach/Owner analytics, v1.0 §12) are pure functions over the AnalyticsEvent stream
   → any aggregation can be recomputed in full from the AnalyticsEvent stream alone, without re-reading raw Result rows
```

Full design in `RESULTS_DOMAIN_V1_1.md` §6.

## 11. What this package explicitly does not do

- It does not create a Scoring Domain (`SCORING_DOMAIN_ARCHITECTURE_INVESTIGATION.md` §18, standing).
- It does not modify Member or Financial Domain in any respect.
- It does not change the *shape* of any entity Programming v1.1 or Results v1.0 already defined — only adds new entities beneath them and formalizes previously-informal guarantees.
- It does not resolve Team/Relay Results, format composition/nesting, or the "exactly one primary Section" question — all three remain open, named in `SCORING_DOMAIN_ARCHITECTURE_INVESTIGATION.md` §17 and restated in `RISK_REVIEW.md` where they bear on this package's own risk surface.

## 12. Reviewer's map

| If reviewing... | Read |
|---|---|
| Domain boundary correctness | This document + `PROGRAMMING_DOMAIN_V1_2.md` §1 + `RESULTS_DOMAIN_V1_1.md` §1 |
| Whether WorkoutVersion is a legitimate addition or a scope violation | `PROGRAMMING_DOMAIN_V1_2.md` §1 |
| Rendering determinism | `VARIANT_GENERATION_ENGINE.md` |
| Rx classification correctness | `RX_ENGINE_SPEC.md` |
| Leaderboard correctness under edits/deletes/late submissions | `LEADERBOARD_RULES.md` |
| End-to-end flow correctness | `SEQUENCE_DIAGRAMS.md` |
| Data shape and relationships | `ERD.md` |
| What must never be violated, and how that's enforced | `ARCHITECTURAL_INVARIANTS.md` |
| What could go wrong | `RISK_REVIEW.md` |
