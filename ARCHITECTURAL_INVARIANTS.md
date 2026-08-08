# Forge — Architectural Invariants

**Status:** Draft for review. Every invariant below is either restated from an already-frozen/proposed-for-freeze document (marked "inherited") or newly introduced by this package (marked "new"), with an explicit enforcement strategy for each — a statement with no enforcement mechanism is a hope, not an invariant, and this document treats the distinction as load-bearing.

---

## 1. Referential and identity invariants

**I-1. Every Result references exactly one WorkoutVersion (or exactly one Benchmark, or both, or neither — never a bare, versionless Workout).** *(New.)*
Enforcement: `ScoringSnapshot.workoutVersionRef` is a mandatory, immutable field, set once at Result creation, never nullable after write (`RESULTS_DOMAIN_V1_1.md` §2). A Result with no Workout context at all (a freestanding logged effort, `RESULTS_DOMAIN_ARCHITECTURE.md` v1.0 §6.1) simply has no `workoutVersionRef`; it still declares a Score Model directly, satisfying "exactly one WorkoutVersion, if any Workout reference exists at all" precisely.

**I-2. A WorkoutVersion, once created, is never mutated and never deleted.** *(New, formalizes Programming v1.1's "detectable revision" promise.)*
Enforcement: structural — no application code path performs an UPDATE or DELETE against an existing WorkoutVersion row; every content change produces a new WorkoutVersion row (`PROGRAMMING_DOMAIN_V1_2.md` §4 rule 1). Recommended implementation-layer enforcement (named here, not designed to schema depth per this package's analysis-only constraint): a database-level trigger or equivalent immutability constraint rejecting UPDATE/DELETE on the WorkoutVersion table outright, so the invariant does not depend solely on application-code discipline.

**I-3. A Workout's withdrawal never deletes its WorkoutVersion lineage or any Result referencing it.** *(Inherited from `RESULTS_DOMAIN_ARCHITECTURE.md` v1.0 §5.1-§5.2, extended to the new WorkoutVersion entity.)*
Enforcement: withdrawal sets a status flag on Workout (and, by extension, marks its WorkoutVersion lineage as belonging to a withdrawn Workout for query-filtering purposes) — it triggers no cascading DELETE anywhere. This is the direct, named correction to the pre-existing production defect (`RESULTS_DOMAIN_ARCHITECTURE.md` v1.0 §14.4), now extended to cover the new entity this package introduces.

## 2. Determinism invariants

**I-4. Rendered variants are deterministic: identical `(WorkoutVersion, ScalingContext, unitPreference, renderRuleSetVersion)` inputs always produce byte-identical RenderedVariant output**, with the sole, explicitly disclosed exception of formula-type Load Profiles resolved against a Member's own current, possibly-changing attribute value (`VARIANT_GENERATION_ENGINE.md` §4.2). *(New.)*
Enforcement: the Rendering Pipeline is specified as a pure function with no wall-clock, random, or live-network input (`VARIANT_GENERATION_ENGINE.md` §4.2's purity requirement). Enforcement at the engineering-practice level (named, not designed here): a determinism test suite that invokes `render()` twice against identical frozen fixture inputs and asserts byte-identical output, run in CI on every change to the Rendering Pipeline's implementation.

**I-5. Validation is deterministic: identical `(Result Attempt, WorkoutVersion's Scaling Profiles)` inputs always produce an identical ValidationRecord**, and a ValidationRecord is therefore always exactly re-derivable, never merely cached. *(New — `RX_ENGINE_SPEC.md` §6.)*
Enforcement: same class of purity requirement and CI-level determinism test as I-4, applied to the Rx Engine specifically. A re-run producing a *different* ValidationRecord (following an Rx Engine logic improvement) is explicitly permitted and appends a new record rather than overwriting (I-9 below) — determinism is about reproducibility of a *given version* of the engine's logic, not about the engine's logic itself being permanently frozen.

**I-6. The Variant Generation Engine's proposed output is deterministic for a given `(base content, target tier, Movement Library, VariantGenerationRuleSet version)`.** *(New — `PROGRAMMING_DOMAIN_V1_2.md` §9.)*
Enforcement: identical purity requirement (`VARIANT_GENERATION_ENGINE.md` §4.1), plus the explicit rule that a VariantGenerationRuleSet is itself versioned and immutable once published (`PROGRAMMING_DOMAIN_V1_2.md` §12) — the Generation Engine's *input* cannot silently change under it, which is the precondition for its output being provably stable.

## 3. Immutability and historical-permanence invariants

**I-7. A Result's Scoring Snapshot is written once and never updated.** *(Inherited, `RESULTS_DOMAIN_ARCHITECTURE.md` v1.0 §4.3, §5.1, unmodified.)*
Enforcement: unchanged from v1.0 — no application code path updates an existing ScoringSnapshot row; a Score edit (v1.0 §8.4) is modeled as the Result's own Score value changing, not as the Scoring Snapshot being rewritten. (Note for reviewer precision: v1.0 §8.4 permits editing a Result's *Score value*; it does not permit editing the Scoring Snapshot's *interpretive* fields — `scoreModel`, `scalingContext`, and now `workoutVersionRef`/`renderedVariantHash` — which remain fixed at original logging time even across a later Score-value edit, exactly as v1.0 §2.1 requires.)

**I-8. No Programming-domain action may destroy, silently corrupt, or silently reinterpret an already-logged Result.** *(Inherited, `RESULTS_DOMAIN_ARCHITECTURE.md` v1.0 Non-Negotiable Invariant #1, unmodified, now additionally guaranteed at the machine-verifiable level by I-1/I-2/I-3 rather than only at the human-detectable level v1.0 originally relied on.)*
Enforcement: unchanged mechanism (permanent identity reference, never ownership; tombstone on withdrawal), strengthened by WorkoutVersion's immutability (I-2) removing the last remaining dependency on Programming's *current* mutable state for historical interpretation.

**I-9. A PR Event and a ValidationRecord, once recorded, are never rewritten — each is a permanent ledger entry; a later re-evaluation appends a new entry, it does not overwrite the old one.** *(PR Event inherited from `RESULTS_DOMAIN_ARCHITECTURE.md` v1.0 §8.6; ValidationRecord's identical treatment new in this package, `RX_ENGINE_SPEC.md` §6.)*
Enforcement: append-only table discipline for both — no UPDATE/DELETE code path exists for either entity type, matching I-2's structural-immutability enforcement pattern.

**I-10. AnalyticsEvent is append-only; analytics aggregations are pure functions over the AnalyticsEvent stream and can be recomputed in full from that stream alone, without depending on any other mutable state.** *(New — `RESULTS_DOMAIN_V1_1.md` §6.2, §10.)*
Enforcement: AnalyticsEvent rows are never updated or deleted (same structural pattern as I-2/I-9). A "rebuild analytics from scratch" operational procedure — replay the full AnalyticsEvent stream from the beginning into a fresh aggregation store — is named here as the concrete verification mechanism a reviewer or an operator can run to prove this invariant holds in practice, not merely on paper.

## 4. Leaderboard invariants

**I-11. A leaderboard is always computed at read time from current Result/ValidationRecord data; a LeaderboardEntry is never the primary source of truth, even where a materialized cache of it exists.** *(Inherited, `RESULTS_DOMAIN_ARCHITECTURE.md` v1.0 §11.1, unmodified.)*
Enforcement: any materialized LeaderboardEntry cache (`LEADERBOARD_RULES.md`, `RISK_REVIEW.md`) carries a documented, testable invalidation rule and a "delete the entire cache, leaderboard reads still produce correct results, only slower" operational property — a cache whose deletion would produce *incorrect* (not merely slower) results is, by definition, not a cache under this invariant and would itself be an invariant violation.

**I-12. Leaderboard category membership is a computed property of ValidationRecord.classifiedTier, never a value an athlete or coach directly sets.** *(New, direct enforcement of the mission's own explicit design goal, "the user must not decide whether a workout is Rx.")*
Enforcement: no write path exists that sets `classifiedTier` directly; it is exclusively an output field of the Rx Engine (`RX_ENGINE_SPEC.md` §3), never an input to any API surface.

**I-13. Leaderboard, Analytics, and Validation queries run on properly indexed, gym-scoped data from first implementation onward.** *(Inherited, `RESULTS_DOMAIN_ARCHITECTURE.md` v1.0 Non-Negotiable Invariant #12, unmodified, extended in scope to cover this package's new read paths — RenderedVariant selection, ValidationRecord lookup.)*
Enforcement: unchanged discipline — this is a delivery-process invariant (indexing is part of the definition of done for any new query path), not a runtime-checkable one; named here to keep it visible to this package's own new surfaces, not merely Results v1.0's original ones.

## 5. Boundary invariants

**I-14. No client computes a PR, a leaderboard rank, a Score's validity, or a Rx classification independently — every client reads the same shared engine output.** *(Inherited, `RESULTS_DOMAIN_ARCHITECTURE.md` v1.0 §2.8, §13, Non-Negotiable Invariant #11, unmodified, now explicitly covering the Rx Engine and Variant Generation Engine as two of the "same shared engines" this invariant already required to be singular.)*
Enforcement: unchanged — a single, shared engine implementation invoked identically by PWA, Admin Web, and any future Dashboard client, never duplicated client-side logic.

**I-15. Programming remains completely unaware Results exists; the reference direction (Results → Programming) never reverses.** *(Inherited, `RESULTS_DOMAIN_ARCHITECTURE.md` v1.0 §3, verified not merely assumed in the original document, unmodified here.)*
Enforcement: unchanged — zero foreign key or code dependency from any Programming entity (including the new WorkoutVersion, LoadProfile, ScalingProfile, VariantGenerationRuleSet) toward any Results entity. This is directly checkable by inspecting Programming's own schema/module dependency graph for any import of or reference to a Results-owned concept — a concrete, testable property, not merely an intention.

**I-16. Results and Attendance never structurally reference each other; any correlation is computed by a downstream, read-only consumer.** *(Inherited, `RESULTS_DOMAIN_ARCHITECTURE.md` v1.0 §3, §12.3, Non-Negotiable Invariant #9, unmodified — restated here because this package's AnalyticsEvent addition could plausibly be misread as inviting a direct Attendance reference; it does not.)*
Enforcement: unchanged — AnalyticsEvent's `payload` never carries an Attendance-domain foreign key; Day-level correlation remains a Dashboard-layer join over two independent event/fact streams, exactly as v1.0 §12.2 already specifies.

## 6. Coverage summary

| Invariant class | Count | New in this package | Inherited unmodified |
|---|---|---|---|
| Referential/identity | 3 | 2 | 1 |
| Determinism | 3 | 3 | 0 |
| Immutability/historical | 4 | 2 | 2 |
| Leaderboard | 3 | 1 | 2 |
| Boundary | 3 | 0 | 3 |
| **Total** | **16** | **8** | **8** |

Exactly half of this package's invariants are genuinely new; the other half are restatements this document keeps visible specifically because a reviewer evaluating a "hardening" package should be able to verify, invariant by invariant, that nothing already frozen was quietly weakened in the process of adding the new capability.
