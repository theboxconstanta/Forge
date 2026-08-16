# Forge — Workout Aggregation Architecture (A+B / Cross-Section Aggregate Scoring)

**Status:** Research + architecture proposal only. Not approved, not frozen, not implementable as-written. No code, schema, migration, or leaderboard behavior changed by this document.
**Prepared:** 2026-08-16
**Companions:** `WORKOUT_AGGREGATION_USE_CASE_MATRIX.md` (30 worked cases), `WORKOUT_AGGREGATION_COMPETITIVE_RESEARCH.md` (external evidence).

---

## 1. Executive Summary

Forge's Section-scoped scoring model (Layers 1/2a/2a.5/2b, all live in production) deliberately stopped at "each Section ranks independently." This document answers the one question that stack left open on purpose: **when should two or more of a Workout's own independently-scored Sections combine into one overall result or ranking, and when should they not?**

The answer this document reaches is narrow by design and, for the most part, was *already decided* by prior work — this document's job is to name that decision precisely, generalize it from the one case it was proven against (Weightlifting Total), and stress-test it against 30 real cases, not to invent new architecture from scratch:

- **`SCORING_MODEL_ARCHITECTURE_VNEXT.md` §14 and its Invariant I-19** already state: a cross-Section aggregate is *never* a new persisted Result — it is always a read-time Leaderboard derivation over already-scored Results. This document does not reopen that decision; it is this document's central, load-bearing premise.
- **`SCORING_MODEL_ADVERSARIAL_MATRIX.md` #23/#25** already worked the Weightlifting Total and multi-AMRAP-sum cases through this exact mechanism and found no gap. This document generalizes those two worked examples into a small, named taxonomy (§8) rather than leaving "sum the values" as an ad hoc, case-by-case idea.
- **`LEADERBOARD_RULES.md` §9** already specifies Competition Mode (scoring windows, freeze, judge verification) as the *separate* mechanism for cross-event/cross-day standings. This document draws a hard line (§13) so within-Workout aggregation is never confused with, or accidentally grows into, that mechanism.

What this document adds that did not already exist: a **two-family taxonomy** (§8) — value-combine (sum/best-of/average/max/min, same-unit) and rank-combine (placement-sum/points-sum, unit-agnostic) — reduced from the mission's own nine candidate types by recognizing several of them are the same primitive parameterized differently; a precise **ownership split** (§16) that puts the aggregate's *definition* in Programming (frozen into WorkoutVersion, versioned for free) and its *computation* in Results/Leaderboard (derived, never stale by construction); a **missing-data default** (`unavailable`, never a silent zero) consistent with this codebase's own established "return no answer rather than guess" philosophy (`PROGRAMMING_DOMAIN_V1_2.md` §5.5); and a **30-case red-teamed matrix** proving the model survives reorder, edit, deletion, versioning, and AI-inference pressure without a new entity, a new domain, or a general formula engine.

**Bottom line, stated in the mission's own terms:** the smallest explicit aggregation model Forge needs is one optional, versioned field on a Workout's content (`aggregateDefinition`, null by default) plus one pure, read-time computation reusing Layer 2b's already-built per-Section ranking — nothing else. Full decision block: §44.

## 2. Research Methodology

Two passes, matching this codebase's established two-pass discipline (`SCORING_COMPETITIVE_LANDSCAPE.md` §1): (1) exhaustive internal reading of every already-frozen or already-drafted architecture document this mission named as required reading, plus the live-code/live-schema facts those documents themselves verified; (2) targeted external research, run as two parallel research passes, scoped narrowly to aggregation mechanics specifically (CrossFit/IWF official rules; Competition Corner, Wodify, PushPress Train, btwb, SugarWOD help-center documentation) — deliberately *not* re-researching ordinary single-workout scoring, which `SCORING_COMPETITIVE_LANDSCAPE.md` already covered exhaustively and which this document treats as settled, cited, not re-verified. Every external claim in `WORKOUT_AGGREGATION_COMPETITIVE_RESEARCH.md` is tagged OBSERVED FACT / INFERENCE / ANECDOTAL / UNKNOWN, matching the tagging convention `SCORING_COMPETITIVE_LANDSCAPE.md` and `SCORING_PHASE1A_MULTI_SECTION_IMPLEMENTATION_READINESS.md` already established as this codebase's standard for research documents.

## 3. External Sources

Full source list and per-claim tags: `WORKOUT_AGGREGATION_COMPETITIVE_RESEARCH.md`. Two authoritative primary sources anchor the weightlifting side, already verified in a prior session and reused here rather than re-fetched: the **IWF Technical and Competition Rules & Regulations** (2024 edition) and the **CrossFit Games Competition Rulebook** — both cited in `SCORING_COMPETITIVE_LANDSCAPE.md` §2 with the same confidence this document inherits.

## 4. Current Forge Foundation

Live and load-bearing, verified by prior sessions and not re-verified here (cited, not re-derived):

- **Section-scoped scoring is live in production**: `workout_sections`, `wod_logs.workout_section_id`/`skill_logs.workout_section_id`, stable per-Section identity surviving reorder (Layer 2a.5), and section-aware leaderboard grouping/ranking reusing one unmodified comparator engine (Layer 2b) — `SCORING_PHASE1B_LAYER2B_SECTION_LEADERBOARD_IMPLEMENTATION_REPORT.md`.
- **Zero production Workouts have ever had more than one required Section** (`SCORING_PHASE1A_MULTI_SECTION_IMPLEMENTATION_READINESS.md` §2, live query) — this document's proposals are evidenced-safe precisely because they are additive to a capability that is proven correct but not yet exercised at volume.
- **WorkoutVersion** (`PROGRAMMING_DOMAIN_V1_2.md` §4) is Programming's own immutable, addressable content snapshot, created on every publish/edit, already the pinning point every other piece of authored Workout content (Load Profile, Scaling Profile) freezes into.
- **Scoring Snapshot** (`RESULTS_DOMAIN_V1_1.md` §2) already captures `workoutVersionRef` per Result — the mechanism this document needs for historical aggregate-rule stability (§20) already exists, unmodified.
- **Segment** (`SEGMENT_MODEL_SPEC_v1.md`) already owns within-one-Section combination (`resultCombination: sum | primary-only | best-of | last`) and Interval already owns within-one-Score-Model attempt aggregation (`aggregation: SUM | AVERAGE | MIN | MAX | list`, per `SCORING_MODEL_ADVERSARIAL_MATRIX.md` #15–16) — both are the direct vocabulary precedent this document reuses at a third scope (§9).
- **Competition Mode** (`LEADERBOARD_RULES.md` §9) already exists as a drafted, deliberately-unfrozen mechanism for cross-event standings, scoring windows, and freeze semantics — the boundary this document must not blur (§13), and the mechanism §36 reuses for a real red-team finding.

## 5. Problem Definition

Restated precisely: given a WorkoutVersion with 2+ `loggingMode:'required'` Sections, each already independently scored and independently ranked (Layer 2b, unchanged), under what conditions, and by what mechanism, should Forge compute and display one additional, combined value or ranking spanning two or more of those Sections' Results for the same Member? The mechanism must never require a new persisted Result, must degrade to exactly today's behavior for every Workout that has (as 100% of production Workouts do today) exactly one required Section, and must not silently assume an aggregate exists just because more than one Section does.

## 6. Non-Goals

Explicitly not attempted, mirroring the mission's own repeated caution and this codebase's own established pattern of naming non-goals precisely (`SCORING_MODEL_ARCHITECTURE_VNEXT.md` §5): a general aggregation formula DSL (§30); Team/Partner cross-Member aggregation (blocked on Result's Member reference becoming many-to-many, already named and deferred, `SCORING_MODEL_ADVERSARIAL_MATRIX.md` #27–28); cross-event/cross-day Competition Mode standings (already Leaderboard's own separate, unfrozen concern, §9 `LEADERBOARD_RULES.md`); weighted aggregation (§29, deferred pending real demand); aggregate-level PR tracking (§41, named as a real future question, not solved here); any change to Segment, Attempt, or the existing per-Section ranking engine, all of which this document reuses unmodified.

## 7. Aggregation vs Multi-Score

**Multi-score does not imply aggregate score.** Stated here as the governing invariant this entire document is built around, not merely a starting assumption: a Workout's default state, at any Section count, carries no `aggregateDefinition`. This is not a conservative placeholder pending future work — it is permanent, correct behavior for the overwhelming majority of multi-Section Workouts (case #1/#5/#21 in the use-case matrix), because most multi-part workouts (a strength piece plus a conditioning piece, three independent AMRAPs a coach simply wants three separate leaderboards for) have no legitimate combined meaning at all. An aggregate exists only when a coach explicitly configures one (§17), or, pending review, when Forge's own AI parser confidently infers one from unambiguous source text (§18) — never as a default derived merely from Section count.

## 8. Aggregation Taxonomy

Reduced from the mission's nine candidate types (`NONE, RAW_SUM, PLACEMENT_SUM, POINTS_SUM, WEIGHTED_POINTS, BEST_OF, AVERAGE, MAX, MIN, DERIVED_FORMULA`) to the smallest orthogonal set the 30-case matrix actually requires:

- **NONE** — not an aggregation type; the absence of `aggregateDefinition`. The default for every Workout.
- **Family A — value-combine**: `sum | best-of | average | max | min`, applied directly to the participant Sections' own raw Score values. Requires every participant to share the same metric kind, canonical unit, and comparator direction (§13). This is the **same enum, reused verbatim** from Segment's `resultCombination` and Interval's `aggregation` (§9) — not a fourth, competing vocabulary invented for this one new scope.
- **Family B — rank-combine**: `placement-sum | points-sum`, applied to the participant Sections' own already-computed ranks (identity-mapped for placement-sum, table-mapped for points-sum). Unit-agnostic by construction — this is the only family available when participants are metric-incompatible (§14).

No third family. `WEIGHTED_POINTS` collapses into `points-sum` with an optional per-participant weight, explicitly deferred (§29) rather than built now. `DERIVED_FORMULA` is rejected outright (§30). `BEST_OF/AVERAGE/MAX/MIN` are not a separate concept from Family A — they are Family A's own combine-function values, and are also already the *exact* vocabulary Segment/Interval use one and two scopes down (§9), which is the strongest evidence this reduction is correct rather than merely convenient: the codebase converged on this vocabulary twice already, independently, before this document existed.

## 9. Raw Aggregation (Family A)

A `sum`/`best-of`/`average`/`max`/`min` over 2+ participant Sections' own Scores, in their shared canonical unit. Direction is never separately configured — it is inherited from the shared primitive's own comparator direction (Load: higher wins; Duration: lower wins), exactly as `SCORING_MODEL_ARCHITECTURE_VNEXT.md` §15 already establishes for the single-Section case ("direction is derived from primitive type, never separately persisted"), now extended one scope up. Worked example: matrix case #2 (Weightlifting Total, `sum`). A participant missing a usable Score makes the whole aggregate `unavailable` for that Member (§21) — Family A never treats a missing operand as zero.

## 10. Placement Aggregation (Family B, `placement-sum` variant)

Each participant Section is ranked independently first (Layer 2b, unmodified); the aggregate sums each Member's own rank position across the declared participant Sections; lower total wins. This is the mechanism a same-Workout, multi-Part competition-style event uses when its parts are metric-incompatible (matrix case #7) — the CrossFit-Games-style "Part A/Part B, ranked separately, combined by placement" pattern `docs/fckb/WORKOUT_FORMATS.md` §11.1/§11.3 already names as a real, if rare, affiliate-adjacent format. Scoped to **one Workout's own Sections** — see §13 for the hard boundary against cross-Workout placement standings.

## 11. Points Aggregation (Family B, `points-sum` variant)

Identical mechanism to §10, except each participant Section's rank maps through a declared `pointsTable` (a rank→points lookup, coach- or platform-provided) before summing; higher total wins (points tables are conventionally higher-is-better even though the underlying ranks are lower-is-better). Matrix cases #8–#9. Verified directly against the 2024 CrossFit Games Competition Rulebook §1.16 this pass: *"Competitions may determine the winner by highest point total or lowest point total, or any method or combination of methods CrossFit selects. Point values for finishing position will be released before the start of the event."* — CrossFit itself does not commit to one fixed table or direction; it declares one per event, ahead of time. This is direct, official confirmation that `pointsTable` must be a **declared, configurable artifact**, never a hardcoded platform constant — the exact design choice this taxonomy already makes. The specific numeric table CrossFit uses for its own televised finals could not be independently re-verified this pass (site fetches blocked/JS-rendered; secondary sources conflict — see `WORKOUT_AGGREGATION_COMPETITIVE_RESEARCH.md`) and Forge does not need to replicate any one specific table to support the mechanism.

## 12. Weightlifting Total

The canonical, fully-worked Family-A example (matrix case #2/#25), already resolved once in `SCORING_MODEL_ADVERSARIAL_MATRIX.md` #23 and reaffirmed, generalized, here. Verified directly against the IWF Technical and Competition Rules & Regulations this pass (§6.8.1): Total is *"the aggregate of the best Snatch and the best Clean & Jerk results"* — Snatch and Clean & Jerk are two independently-scored Sections (each Load, `targetRepMax:1`, `attemptTracking:true` per `SCORING_MODEL_ARCHITECTURE_VNEXT.md` §13); Total is `sum` over their best-successful-attempt Scores; never itself a third Section's own logged value. **Confirmed, §6.9**: an athlete with a successful Snatch but zero successful Clean & Jerk attempts *"will not receive points for the Total"* at all — no Total is computed, not a zero, not a penalty value; the athlete keeps their standalone Snatch result and is not eliminated (unless the event medals Total only). Tiebreak (§6.8.2): the earliest-achieved result by attempt-calling-order wins — **not bodyweight**; a bodyweight-first tiebreak does appear in an older, superseded IWF edition also checked this pass, confirming the commonly-repeated "lighter athlete wins" folklore is outdated. (The current, in-force Nov-2025 IWF edition could not be independently re-fetched this pass — Cloudflare-blocked; the 2024-headered text quoted above is the most recent version directly verified.)

## 13. Competition Boundary

The single hardest, most consequential line this document draws, because the mission's own examples (Open-style placement standings, Games-style points) are real patterns that exist at **two different scopes**, and collapsing them would be the most damaging mistake this document could make:

- **Within one Workout's own Sections, same day** (a multi-Part *event*: Part A/Part B of one competition WOD) → **Workout Aggregation**, this document's scope, using either Family A or Family B.
- **Across multiple Workouts/days/weeks** (CrossFit Open's 24.1+24.2+24.3 three-week overall standing; any multi-day in-house challenge) → **Competition Mode**, `LEADERBOARD_RULES.md` §9's already-drafted, deliberately-unfrozen mechanism, which operates over multiple Workout *identities*, not multiple Sections of one Workout identity.

`aggregateDefinition` (§16) is therefore scoped, structurally, to reference only Sections of its own WorkoutVersion — it has no way to reference another Workout's Section even if someone wanted it to, which is the enforcement mechanism, not merely a stated policy (matrix case #23).

Confirmed this pass, directly against the 2024 CrossFit Games Competition Rulebook §1.24: the Open's own three-week overall standing is exactly a **Family-B `placement-sum`** — *"an athlete with 2nd-place, 3rd-place and 5th-place finishes will have 10 total points (2+3+5=10)"*, lowest total wins — the same primitive this document defines, just applied at the cross-Workout scope this section deliberately excludes. This is not a coincidence worth resolving by merging the two scopes; it is confirmation that Family B's *math* is genuinely reusable across both scopes even though its *ownership* (Programming's WorkoutVersion vs. Competition Mode's own leaderboard configuration) correctly stays separate — Competition Mode, whenever built, should reuse this document's Family B computation as a library function, not reinvent it, but that reuse is a future implementation detail, not a reason to widen this document's own scope now.

## 14. Segment Boundary

Segment (`SEGMENT_MODEL_SPEC_v1.md`) owns combination **within** one Section — repeated or composite pieces of what is authored and displayed as one scoreable block (5×500m row splits, a buy-in/main/cash-out composite). Workout Aggregation owns combination **across** 2+ independently-identified, independently-scored Sections. The dividing rule, extending `SCORING_PHASE1A_MULTI_SECTION_IMPLEMENTATION_READINESS.md` §19's own boundary sentence one level further: *if the pieces being combined were ever independently rankable on their own leaderboard, combining them is Workout Aggregation's job; if they were never independently rankable — they only ever existed as part of one Section's own internal structure — combining them is Segment's job.* The mission's own Example E (three 500m row splits) is, by this rule, a Segment/Interval `aggregation` case (already solved, `SCORING_MODEL_ADVERSARIAL_MATRIX.md` #15–16), **not** a Workout Aggregation case — named explicitly per the mission's own request to resolve this ambiguity (§1 Example E).

## 15. Attempt Boundary

Attempt (`RESULTS_DOMAIN_ARCHITECTURE.md` §4.1, `attemptTracking`/`outcome`, `SCORING_MODEL_ARCHITECTURE_VNEXT.md` §13) owns combination **within** one Score Model's own bounded attempt sequence (three Snatch attempts, best successful one becomes that Section's Score). Workout Aggregation only ever operates on a Section's *already-finalized* Score — it never sees or re-derives individual attempts. "Snatch 90/95/100kg, best=95" is Attempt's job, one level below where Workout Aggregation starts.

## 16. Ownership

**Programming owns the *declaration*.** `aggregateDefinition: { participantSectionIds: uuid[], combineFunction: 'sum'|'best-of'|'average'|'max'|'min'|'placement-sum'|'points-sum', pointsTable?: [...] } | null` is one more field frozen into WorkoutVersion, exactly like Load Profile or Scaling Profile (`PROGRAMMING_DOMAIN_V1_2.md` §6–§7) — it inherits I-P1's immutability, §4.6's historical reproducibility, and §4.5's versioning-on-edit for free, with zero new mechanism. **Results/Leaderboard owns the *computation*.** At read time, the Leaderboard layer resolves the current WorkoutVersion's `aggregateDefinition`, reads the already-persisted, already-scored Results for each `participantSectionId` (Layer 2b's own existing per-Section grouping, unmodified), and computes the aggregate — directly, literally I-19's own words, generalized from "Total" to the full taxonomy. **Competition Mode owns cross-Workout standings** (§13), untouched by this document.

## 17. Coach UX

Progressive disclosure, matching this codebase's own repeatedly-validated pattern (`SCORING_MODEL_ARCHITECTURE_VNEXT.md` §28, `SCORING_PHASE1A...` §17 case 6/8): a Workout with 0 or 1 required Section — the overwhelming common case today — shows no aggregate UI at all, not even a disabled affordance. Only once a coach has created a 2nd `loggingMode:'required'` Section does an optional "Combine these into one overall score?" step appear, default OFF. If enabled: the coach picks participant Sections (defaulting to "all currently required"), and picks a combine function; Family A (`sum`/`best-of`/etc.) is only offered when the selected Sections are metric-compatible (§13 of the mission — an absent option, not a validation error surfaced after the fact); Family B is always available regardless of compatibility.

## 18. AI Inference

Quick Create's parser may propose an `aggregateDefinition` when source text unambiguously implies one ("Total: Snatch + Clean & Jerk", or `docs/fckb/WORKOUT_FORMATS.md` §11.1's "Event 3: Part A / Part B" phrasing) — but the proposal must be coach-reviewed and accepted before publish, using the exact same governance the Variant Generation Engine already established (`PROGRAMMING_DOMAIN_V1_2.md` §8.1: "generation is publish-time and coach-triggered... reviewed, edited or accepted... becomes ordinary frozen WorkoutVersion content before any athlete can see it"). At leaderboard-read time, zero LLM calls occur — the computation is a pure function over frozen `aggregateDefinition` + already-scored Results, satisfying I-P2's determinism invariant by direct reuse, not a new guarantee invented here.

## 19. Aggregate Definition

Shape given in §16. Lives once per WorkoutVersion (§35 — no nesting, no multiple simultaneous aggregates in v1). Validation gate, mirroring `validateSectionsForLegacy`'s established "hard block, not silent" pattern: `participantSectionIds` must (a) be a non-empty set with no duplicates, (b) resolve only to `loggingMode:'required'` Sections of the *same* WorkoutVersion, (c) for Family A specifically, share metric kind/unit/direction (checked at configuration time, not merely at read time).

## 20. Aggregate Result — Derived or Persisted?

**Derived, always — never persisted as its own Result.** This reaffirms I-19 exactly, generalized from the single Total case to the full taxonomy: no new table, no new row, no new write path. The full weight of this decision's correctness is demonstrated concretely in §36–39 (edit/delete/reorder/versioning), each of which becomes trivially safe *specifically because* there is no stored aggregate that could ever go stale.

## 21. Units

Unchanged from `RESULTS_DOMAIN_ARCHITECTURE.md` §10 and `SCORING_MODEL_ARCHITECTURE_VNEXT.md` §15: canonical-unit storage, per-viewer display conversion, ranking always on canonical values. Family A's compatibility check (§13/§9) compares canonical units, never display units — two Sections authored in kg and lb respectively are still compatible for `sum` (matrix case #19), exactly as today's single-Section kg/lb cross-member ranking already works.

## 22. Missing Results

**Uniform default: `unavailable`, never a silent zero, for both families.** This is a deliberate, direct extension of this codebase's own established "return no answer rather than guess" value (`PROGRAMMING_DOMAIN_V1_2.md` §5.5: Movement resolution "returns no single answer rather than guessing... honestly, rather than silently wrong") applied to a new kind of ambiguity. A missing, DNF, or DNS participant Section makes the aggregate unavailable for that Member, for both families, by default (matrix cases #12–14).

Verified this pass, and deliberately **not adopted as Forge's default**: the CrossFit Games Rulebook (§1.25/§1.28) scores a missing/invalidated workout as a literal **"0"**, which — because CrossFit's own overall standing is itself a Family-B placement-sum (§1.24) — mechanically becomes "worst placement for that event" without needing a distinct status at all; the athlete is never excluded, just penalized maximally. Competition Corner independently confirms the same idea with named states (**DNF = scored 0, remains rankable at a disadvantage; WD = pushed to the bottom, out of contention**). This is a real, evidenced, internally-consistent convention — but it only ever makes sense for **Family B** (a "0" is meaningful only as an input to a rank, never as a raw operand summed into a Load or Duration total, which is exactly why Family A stays `unavailable`-only, no exceptions). The named extension point is therefore scoped precisely: `missingPolicy: 'unavailable' (default) | 'worst-placement'`, **Family B only**, not built by default, not offered for Family A at all — a sharper, now evidence-backed version of the placeholder this section originally carried.

## 23. Completion State

Not an independent field on the aggregate. Computed identically to §22's missing-data rule: the aggregate "completes" if and only if every required participant has a usable Score; otherwise it is simply absent for that Member, not a fourth `completion_state` value bolted onto a new entity — directly mirroring I-17's own "computed once, never independently settable" principle.

## 24. Rx

Not independently classified. An aggregate is only computed when **every** participant Section's Result shares the same `classifiedTier` (matrix cases #15–16) — Rx+Rx aggregates as Rx-equivalent; any mixed-tier combination makes the aggregate unavailable, the same missing-data-equivalent path as §22, not a new "Mixed aggregate" concept. This directly satisfies the mission's own instruction (§23) not to force Rx onto the aggregate where it isn't conceptually meaningful — IWF's own Total has no Rx/Scaled axis at all, and this rule produces exactly that behavior for Forge's version of it.

## 25. Variants

Same-tier-only, stated precisely in §24 — this is also the direct, evidenced answer to the mission's own §24 question ("same variant only, mixed variants, or Mixed Categories" — answer: **same variant only**, including Mixed Categories as its own tier that must match itself across participants like any other tier).

## 26. Comparator

Never separately stored — derived entirely from the chosen `combineFunction`, exactly as the mission's own §26 anticipates and exactly matching the "direction derived from primitive type, never persisted" precedent already established (§9, §21). Family A inherits its shared primitive's direction; `placement-sum` is always lower-wins (rank arithmetic); `points-sum` is always higher-wins (points-table convention).

## 27. Tiebreaks at Aggregate Level

A real, distinct concept from any individual Section's own Tie-Break Key — evidenced directly by IWF's Total tiebreak (§12). `aggregateDefinition` may optionally declare its own tiebreak, reusing `RESULTS_DOMAIN_V1_1.md` §3's existing `{sourceAttemptRole}` vocabulary but scoped to name a specific participant Section's own attempt (matrix case #18) — not a new tiebreak mechanism, a new *scope* for the one that already exists.

## 28. True Ties

Preserved unmodified at the aggregate level: a genuine tie remains a tie (1-1-3 ranking) unless the aggregate's own declared tiebreak resolves it — never faked apart by insertion order or row id, matching `LEADERBOARD_RULES.md` §3's existing standard applied one scope up (matrix case #17).

## 29. Weighted Aggregation

**Deferred — real, evidenced, but competition-tier, not daily-gym-tier** — the same classification pattern `SCORING_COMPETITIVE_LANDSCAPE.md` §19 already applied to age-division leaderboards, now applied here with direct confirmation rather than assumption: Competition Corner's help documentation confirms a live, shipped "Use weighted scoring" toggle (per-workout percentage weight, default 100%, e.g. a final set to 200%). This is not a speculative feature — it is real and used. But it is real specifically on a **dedicated competition platform**, not on any of the six daily-gym competitors researched (`SCORING_COMPETITIVE_LANDSCAPE.md` §3), and Forge is a daily-gym product first. Structurally anticipated (a `weight` field could sit on `pointsTable`'s per-participant entries later without changing the taxonomy's shape) but not built now, matching the mission's own explicit instruction to challenge it and matching zero observed demand inside Forge's own daily-gym use case specifically — deferred to whenever Forge's own future competition-tier capability (§13's already-separate Competition Mode) is prioritized, not to this document's scope.

## 30. Custom Formula

**Rejected.** Directly reaffirms `SCORING_MODEL_ARCHITECTURE_VNEXT.md` §14's own prior rejection of "a third, general aggregation DSL," now stated for a second, independent mission asking a related question — two separate architecture passes converging on the same "no general formula engine" conclusion is treated here as strong, not merely repeated, evidence that this is a stable Forge value, not an oversight either time.

## 31. Aggregation vs Segment

Fully resolved, §14.

## 32. Aggregation vs Attempt

Fully resolved, §15.

## 33. Master Use-Case Matrix

30 cases, full detail: `WORKOUT_AGGREGATION_USE_CASE_MATRIX.md`. Summary of coverage: every one of the mission's own 25 required cases is represented (mapped 1:1, in order); 5 additional cases (reorder, edit, versioning, AI-inference, nesting) were added during red-teaming (§34) because the mission's own list, while thorough on scoring semantics, did not stress the *lifecycle* safety of a persisted-declaration-plus-derived-computation design as hard as this document's own §20 decision requires.

## 34. Red-Team the Model

Systematic attack pass, per the mission's own required categories:

- **Invalid metric mixing** — prevented structurally: Family A's compatibility check makes an incompatible pairing an *absent option*, not a runtime error (§13/§20 matrix case).
- **Partial input ambiguity** — resolved by the uniform `unavailable` default (§22), never a guess.
- **Circular aggregates / aggregate of aggregate** — structurally impossible: `participantSectionIds` can only resolve to genuine Sections, and an aggregate is not itself a Section (§35, matrix case #30).
- **Unstable rank dependency** — a real, *expected*, not-a-bug behavior for Family B: since each participant Section's rank is recomputed live (Layer 2b, unmodified), a Member's aggregate rank can shift because *someone else* logged a new Result in a participant Section, not only because the Member's own Result changed — this is exactly how live CrossFit Open-style standings already work, and Forge already has the correct tool for when this liveness is undesirable: `LEADERBOARD_RULES.md` §9's `freezeAt` mechanism generalizes to Family B aggregates for free (it already pins a read-time query to a past instant; nothing about Family B's computation requires a new freeze mechanism).
- **Ranking recomputation loops** — impossible by construction: Section ranks are always computed first, by the existing, unmodified Layer 2b engine; the aggregate reads their *output*, never feeds back into it.
- **Versioning problems** — resolved, §20 of this document / §4 `PROGRAMMING_DOMAIN_V1_2.md`, unmodified mechanism.
- **Stale-client issues** — no new class of staleness: a derived-at-read-time value needs only the same refetch/realtime pattern Layer 2b's own live leaderboard already uses.
- **Unit mismatch** — resolved, §21.
- **Result deletion / edited Sections / removed Sections** — all resolved by §20's central decision (derived, never persisted, nothing can go stale) plus §16's ownership split (a removed Section invalidates the *declaration*, caught at edit time by validation, matrix case #26; an edited or deleted Result simply changes what the *next read* computes, matrix case #28).
- **Historical rule changes** — resolved, §20 of this document, reusing `LEADERBOARD_RULES.md` §4's existing Score-Model-identity partitioning rule, extended to `aggregateDefinition` identity (matrix case #28).

**Net result: the model survives.** No attack in this pass required a new entity, a new persisted table, or a new mechanism beyond what §16–§28 above already specify.

## 35. Should Aggregates Nest?

**No.** A Workout carries at most one `aggregateDefinition` in v1; `participantSectionIds` may only resolve to genuine Sections, never to another aggregate — self-reference is category-impossible (an aggregate is not a Section), not merely policy-forbidden (matrix case #30). Supporting multiple *simultaneous, different* aggregates on one Workout (e.g., both a raw Total and a separate points standing) is not ruled out architecturally by this shape, but is deliberately not built in v1, absent real demand — the same "smallest sufficient" discipline applied consistently throughout this document.

One genuinely different aggregation shape was found this pass and is named here explicitly so it is not later mistaken for an oversight: HYROX's Elite qualification standing sums an athlete's **best 5 results within a rolling 365-day window** (a best-N-of-M, time-windowed selection, layered underneath a percentile-of-winner points conversion) — structurally distinct from every primitive in §8's taxonomy, since it operates across many *separate* races over *time*, with a pruning step (best-N-of-M) this document's Family A/B primitives do not have. This is real, sourced (`WORKOUT_AGGREGATION_COMPETITIVE_RESEARCH.md`), and **not adopted** — it belongs, if ever built, to Competition Mode's future scope (§13), not to Workout Aggregation, and is named only to show it was found and deliberately excluded, not missed.

## 36. Aggregation Dependency Graph

Cycles: impossible (§35). Duplicate inclusion: forbidden by validation (`participantSectionIds` is a set, §19). Cross-Workout references: structurally impossible — `participantSectionIds` is always resolved against the *same* WorkoutVersion's own Sections, never a foreign Workout's. Deleted Section references: caught at edit time (§37).

## 37. Result Deletion

Trivially safe, precisely *because* §20 decided the aggregate is never persisted: deleting a participant Section's Result changes nothing stored; the very next leaderboard read simply computes `unavailable` for that Member (§22) instead of a value. No stale aggregate can ever exist to be found later, because none is ever written.

## 38. Result Edit

Identical reasoning to §37: an edited Score is reflected on the next read, automatically, with no invalidation step required — this is the single strongest practical argument for §20's derived-not-persisted decision, and is stated here as its direct, provable consequence rather than a separately-designed feature.

## 39. Section Reorder

`participantSectionIds` references stable Section UUIDs (Layer 2a.5's already-proven identity mechanism), never array position or `order_index` — reordering participant Sections in the coach's editor is a complete no-op for the aggregate, exactly as it already is for each Section's own individual leaderboard (matrix case #27).

## 40. Section Removal

A coach removing a Section that participates in the current `aggregateDefinition` produces, per `PROGRAMMING_DOMAIN_V1_2.md` §4.5/I-18, a new WorkoutVersion — the editor must validate the new version's `aggregateDefinition` against its own (now-smaller) Section set at that same edit, blocking save if it would reference an absent Section (mirroring `validateSectionsForLegacy`'s existing hard-block behavior, matrix case #26), forcing the coach to either re-pick participants or clear the aggregate. The *prior* WorkoutVersion's `aggregateDefinition` remains frozen and correct for any Result already logged against it (I-P1), unaffected.

## 41. Current Forge Mapping

| Concept | Classification | Layer |
|---|---|---|
| Section-scoped independent scoring | Already exists | Programming + Results, live (Layer 1/2a/2a.5/2b) |
| Per-Section ranking/comparator | Already exists, reused unmodified | Results (`sortLogs`/`ranking.ts`) |
| Stable Section identity across reorder | Already exists, reused unmodified | Programming (Layer 2a.5) |
| WorkoutVersion immutability/versioning | Already exists, reused unmodified | Programming (`PROGRAMMING_DOMAIN_V1_2.md` §4) |
| Value-combine vocabulary (sum/best-of/average/max/min) | Semantic equivalent exists (Segment/Interval), extended one scope | Programming (Segment) + Results (Interval) → this doc's Family A |
| Rank-combine (placement-sum/points-sum) | Small additive extension | New computation in Results/Leaderboard, no new entity |
| `aggregateDefinition` field | Small additive extension | New field on WorkoutVersion (Programming) |
| Missing-data `unavailable` default | Semantic equivalent exists (§5.5 Movement resolution), applied to a new case | Programming precedent, Results application |
| Competition Mode / cross-event standings | Already exists (drafted, unfrozen), explicitly out of this scope | Results/Leaderboard (`LEADERBOARD_RULES.md` §9) |
| Team/Partner cross-Member aggregation | Requires future Results entity change, deferred | Results (Member reference), not started |
| AI-inferred aggregate proposal | Small additive extension, reuses Variant Generation Engine governance | Programming (Quick Create parser) |
| Weighted aggregation | Deferred | Not started |
| Custom formula engine | Rejected | N/A |
| Aggregate-level PR tracking | Real open question, not started | Results (PR Event Ledger), future mission |

## 42. Competitor Cross-Check

Full detail: `WORKOUT_AGGREGATION_COMPETITIVE_RESEARCH.md`. Confirmed, precisely: **PushPress Train has no documented automatic combine feature at all** — its own help docs require the coach to manually annotate which movement/component is scored, or do the arithmetic outside the app. **Wodify is a genuine partial exception**, not a clean "no" — its component-scoring measure list includes a first-class **"Weightlifting Total"** type, confirming Wodify recognizes the Snatch+Clean&Jerk-style Total as a named concept; its *internal* computation (auto-summed from two sub-entries, vs. a single manually-typed number merely labeled "Total") could not be verified from public documentation (a real gap, not assumed either way — see competitive research doc). **Competition Corner** — the one platform researched with genuine, confirmed points-per-place and weighted multi-event aggregation (§11, §29) — explicitly operates at the **cross-event** scope (summing whole separate competition events into an overall standing) and its own "Cumulative Units" raw-sum mechanism carries the *exact* same same-unit compatibility constraint this document derived independently (§13/§9: *"all workouts MUST SHARE the same unit"*) — strong independent validation of that rule, arrived at twice, by two different systems, without either copying the other. Critically, **no help-center page researched, on any platform, describes defining a single event/workout's own score as the algebraic sum of two of that same event's own sibling parts** (Competition Corner's Cumulative Units sums across whole separate events/days, never within one event's own Part A + Part B) — the *specific* problem this document solves (within-one-Workout, cross-Section combination, §12's Weightlifting Total example) appears to remain undocumented industry-wide, even on the one platform built specifically for competition scoring.

## 43. Forge Differentiation

**Yes — and more precisely than the general "no one does this" claim would suggest.** Not "no competitor has any Total concept" (Wodify's named measure type means that overclaim would be wrong) — the accurate, defensible claim is narrower and still real: no platform researched, including the one purpose-built for competition scoring, documents **automatically deriving one event's own score as the sum of two of its own sibling parts' independently-logged Results**, computed at read time from already-scored, already-persisted data, the way §16/§20 of this document specify. Forge's own AI-first authoring precedent (`SCORING_COMPETITIVE_LANDSCAPE.md` §13, §18 point 5 — "no researched competitor has an AI-parse-to-structured-workout pipeline") extends naturally here: Forge inferring "Total: Snatch + Clean & Jerk" from pasted text and proposing a coach-reviewable `aggregateDefinition` (§18) would be a capability with no evidenced competitor equivalent — narrower, more honest, and, precisely because it's narrower, more credible than the broader claim this section would otherwise have made.

## 44. Required Architectural Decisions

**A. Is Workout Aggregation a first-class concept?**
**YES** — narrowly: one optional field (`aggregateDefinition`) on WorkoutVersion, not a new domain, not a new persisted entity, not a new table.

**B. Does every multi-score Workout have an aggregate?**
**NO.** Default is null/absent, always, for every Section count, unless a coach explicitly configures one (or reviews and accepts an AI proposal). Restated as the governing invariant, §7.

**C. Is aggregate derived or authoritative persisted data?**
**DERIVED.** Reaffirms and generalizes I-19 (`SCORING_MODEL_ARCHITECTURE_VNEXT.md`) from the single Total case to the full taxonomy. Never a new Result row.

**D. Does aggregate belong to Programming definition + Results derivation?**
**YES**, exactly as specified — Programming owns and versions the declaration (`aggregateDefinition`, frozen into WorkoutVersion); Results/Leaderboard owns the read-time computation over already-scored Section Results.

**E. Does competition placement/points aggregation belong here?**
**PARTIALLY.** Within one Workout's own Sections (a multi-Part *event*, same day) — yes, via Family B. Across multiple Workouts/days (Open-style multi-week standings) — no, that is `LEADERBOARD_RULES.md` §9's Competition Mode, a structurally separate scope (§13).

**F. Does IWF Total belong here?**
**YES** — the canonical, fully-worked Family A example (§12), already resolved once (`SCORING_MODEL_ADVERSARIAL_MATRIX.md` #23) and generalized, not re-litigated, by this document.

**G. Are Segment/Attempt aggregation separate?**
**YES**, both — definitively bounded in §14/§15, with zero mechanism overlap, while deliberately reusing the same small combine-function vocabulary across all three scopes where it applies.

**H. Is arbitrary custom formula support needed?**
**NO / DEFERRED.** Rejected per §30, directly reaffirming `SCORING_MODEL_ARCHITECTURE_VNEXT.md` §14's own prior, independent rejection of the same idea.

**I. Can architecture evolve additively?**
**YES.** Every piece proposed is a new, optional field or a new pure read-time computation; zero existing entity's shape changes; zero migration required for anything already live — matching this platform's now-repeated, proven additive-migration discipline (Phase 0, Faza 8, Results Phase 2 slices, Phase 1A itself, all cited as precedent, not merely asserted).

**J. Ready for implementation?**
**GO**, scoped exactly to: (1) an additive `aggregateDefinition` field wherever WorkoutVersion's real (today: `wods`+`workout_sections`) representation lives; (2) a pure Leaderboard-layer computation function consuming Layer 2b's existing per-Section ranking output, unmodified; (3) coach UX gated behind 2+ required Sections already existing, matching §17's progressive-disclosure design. **NOT a GO** for: weighted aggregation (§29), custom formula (§30), multiple simultaneous aggregates per Workout (§35), Team/Partner cross-Member aggregation (§6), aggregate-level PR tracking (§41) — each named, each deferred with a stated reason, none silently dropped.

## 45. Required Deliverables

This document, `WORKOUT_AGGREGATION_USE_CASE_MATRIX.md`, and `WORKOUT_AGGREGATION_COMPETITIVE_RESEARCH.md` — all three produced, per the mission's own required structure.

## 46. Implementation Sequencing (if GO)

Not implemented here; sequencing only, following this platform's own established phase-table convention (`SCORING_MODEL_ARCHITECTURE_VNEXT.md` §30):

| Phase | Capability | Depends on | Risk | Migration impact |
|---|---|---|---|---|
| 0 | `aggregateDefinition` field on WorkoutVersion's real representation, validation gate (§19/§40), no read-side computation yet | Nothing beyond what Layer 2b already shipped | Low — pure additive field, unread by anything until Phase 1 | Additive column/JSON field, no backfill (null for every existing Workout, correctly) |
| 1 | Family A (`sum`/`best-of`/`average`/`max`/`min`) read-time computation + display, both clients | Phase 0 | Low — pure derivation over already-correct Layer 2b output | None |
| 2 | Family B (`placement-sum`/`points-sum`) read-time computation + display, both clients | Phase 0 (independent of Phase 1) | Low-Medium — needs each participant Section's rank as an intermediate value, not just its raw Score, a genuinely new read shape though not a new write | None |
| 3 | Coach authoring UX (§17), gated behind 2+ required Sections | Phase 0 | Low | None |
| 4 | AI-inference proposal (§18), Quick Create integration | Phases 0 and (1 or 2) | Low — reuses Variant Generation Engine's existing review-before-publish governance | None |
| 5 | Weighted aggregation, aggregate-level PR tracking, multiple-simultaneous-aggregates, Team/Partner aggregation | Independent of 0–4, each blocked on its own named prerequisite | Varies, named per item in §6/§29/§35/§41 | Out of this document's authority to plan further |

Every phase independently shippable and independently valuable, matching this platform's own established discipline — Phase 0+1 alone would already deliver the mission's own headline example (Weightlifting Total) end to end.

## 47. Five-Year Standard

Answered deterministically, per the mission's own required shape: *Do A and B combine?* → only if `aggregateDefinition` is non-null for this WorkoutVersion (§7/§19). *Which Sections participate?* → `participantSectionIds`, identity-stable across reorder (§39). *How?* → one of two families, seven combine functions total (§8). *What result is produced?* → a single derived value or rank, computed fresh on every read (§20). *How is it ranked?* → inherited from the combine function, never separately configured (§26). *What happens if one input is missing?* → `unavailable`, uniformly, never guessed (§22). All without a single hardcoded, workout-name-specific branch anywhere in the design.

## 48. Product Quality Bar

Preserved without exception: the ordinary "Paste → Analyze → Publish" flow for a 1-Section or independent-multi-Section Workout is byte-identical to today, forever, because `aggregateDefinition` defaults to null and is invisible until a coach has already created 2+ required Sections (§17) — the same, now three-times-validated pattern (multi-Section authoring itself, §28 of `SCORING_MODEL_ARCHITECTURE_VNEXT.md`; this document's own aggregate UI) of "structurally present, never surfaced until structurally relevant."

## 49. Stop Condition

Honored. No code, schema, or migration was written. No leaderboard behavior was changed. No production data was modified. This document, its two companions, and this mission's commit are documentation-only.

---

## Final Question

> **What is the smallest explicit aggregation model Forge needs so that A+B has a correct meaning when it should — and no meaning when it should not?**

One optional, versioned field (`aggregateDefinition`, null by default, frozen into WorkoutVersion exactly like every other authored field) naming which of a Workout's own already-independently-scored Sections participate and which of seven combine functions (across two families — value-combine, reusing Segment/Interval's own existing vocabulary, and rank-combine, unit-agnostic by construction) applies; plus one pure, read-time computation in the Results/Leaderboard layer over those Sections' already-persisted Results, reusing Layer 2b's ranking engine unmodified, producing `unavailable` rather than a guess whenever an input is missing, mixed-tier, or metric-incompatible. Section Results remain atomic truth, untouched, unmutated, exactly as I-19 already required. No multi-score Workout aggregates unless a coach says so. No Workout Aggregate is ever confused with a Competition Standing (§13), a Segment (§14), or an Attempt (§15). Nothing here is a new domain, a new table, or a new formula engine — it is the smallest possible generalization of a decision (I-19) this codebase had already, correctly, made once, proven against one real case (§12), and never yet had to name for the other six.

---

**STOP.** Architecture proposal complete. No code, schema, migration, or leaderboard behavior was implemented as part of this document.
