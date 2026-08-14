# Forge — Universal Scoring Model, VNext

**Status:** Architecture proposal only. Not approved, not frozen, not implementable as-written. No code, schema, migration, or leaderboard behavior changed.
**Prepared:** 2026-08-14

This document does not introduce a new domain, a new logging table, or a competing vocabulary. Its single job is to resolve one specific, already-named, still-open question — `PROGRAMMING_DOMAIN_V1_2.md` §13 item 3, "whether 'exactly one primary, scored Section' per Workout should change" — using entities `RESULTS_DOMAIN_ARCHITECTURE.md` v1.0, `RESULTS_DOMAIN_V1_1.md`, `PROGRAMMING_DOMAIN_V1_2.md`, and `SEGMENT_MODEL_SPEC_v1.md` already define, and to complete the one design pass `SEGMENT_MODEL_SPEC_v1.md`'s own final section explicitly deferred: "the shape of a logged result for a composite section... a separate design pass against `wod_logs`/`skill_logs`, to happen once this model is stable."

---

## 1. Executive Summary

The mission that produced this document proposed a hypothesis — four new primitives (Score Component, Completion State, Tiebreak, Rx/prescription split) — and required it be challenged, not adopted blindly. It did not survive unmodified. Three of the four either already exist in prior, unfrozen-but-thorough architecture work, or turn out not to need a new entity at all:

- **Tiebreak** is already fully specified (`RESULTS_DOMAIN_V1_1.md` §3, §8, "Tie-Break Key") — adopt as-is, no new work.
- **Rx/prescription split** is already fully specified and already shipped in production (`RX_ENGINE_SPEC.md`, `rxEngine.js`) — adopt as-is, no new work.
- **Completion State** is already specified as a *rule* (Time Cap Declaration's `cappedScoringRule`, `RESULTS_DOMAIN_V1_1.md` §3) but not yet as a persisted, explicitly-readable field — small, additive refinement, not a new primitive.
- **Score Component**, the hypothesis's centerpiece, does **not** survive as a new entity. The capability it was reaching for — a Workout producing more than one independently-ranked score — is fully achievable by resolving an already-open Programming question (allow a Workout to declare more than one scored Section) and scoping Result to the specific Section it was logged against, rather than inventing a new entity that would sit awkwardly beside Section and Result, duplicating what each already almost does alone.

One genuinely new field survives the 30-workout adversarial pass in `SCORING_MODEL_ADVERSARIAL_MATRIX.md`: an optional `outcome: SUCCESS | FAIL` on the already-existing Result Attempt entity, gated behind a new, narrow `attemptTracking` Score Model flag — needed only for competition-style bounded attempt sequences (weightlifting testing), never for ordinary metcon logging.

## 2. Existing Forge Reality

Two realities coexist in this codebase, and this document is explicit about which one it extends. **Live, shipped, production reality**: `wod_logs` (`result`, `time_result`, `sets`, `log_meta` — four loosely-typed fields), `workoutFormats.js`'s 21-format catalog with family-scoped composition (`scored`/`sets`/`mixed`/`nft`/`chained`), `rxEngine.js`'s shipped, generalization-pending Rx classification, and `sortLogs`/`ranking.ts`'s two-tier finisher-then-partial comparator — verified directly against code and a live production query this session, including the finish-time precedence bug just fixed in it (`LEADERBOARD_FINISH_TIME_INVESTIGATION.md`). **Paper, unfrozen, never-implemented reality**: `RESULTS_DOMAIN_ARCHITECTURE.md` v1.0 ("Proposed for Freeze"), `RESULTS_DOMAIN_V1_1.md`, `PROGRAMMING_DOMAIN_V1_2.md`, `RX_ENGINE_SPEC.md`, `SEGMENT_MODEL_SPEC_v1.md`, `LEADERBOARD_RULES.md`, `ARCHITECTURAL_INVARIANTS.md` — a substantially more rigorous model than what's live, produced across several prior sessions, none of it built. This document is additive to the *second* reality, not the first — it does not re-derive what that body of work already settled, and every current-code fact it cites is explicitly marked as "live" to avoid the two realities blurring together.

## 3. Research Inputs

`SCORING_COMPETITIVE_LANDSCAPE.md` (this session, seven platforms + official CrossFit/IWF rules), `docs/fckb/WORKOUT_FORMATS.md` (this session, real-world workout structures across 19+ format families), and the full paper-architecture stack named in §2. No new external research was performed for this document — the competitive and rules research was already exhaustive; this document's job was internal reconciliation, not further fact-gathering.

## 4. Design Goals

Reused, unmodified, from the paper architecture's own governing principles (`RESULTS_DOMAIN_ARCHITECTURE.md` §2, `PROGRAMMING_DOMAIN_V1_2.md`'s "Minimal Core, Progressive Complexity"): a logged Result is a fact, never a projection of current Programming state; automatic intelligence is the default; structure exists only where it must be compared, aggregated, or detected automatically; a Member logs with almost no required structure; the coach is not required to configure scoring separately from format wherever Forge can infer it (this document's own added emphasis, directly from the fresh mission's §27).

## 5. Non-Goals

Explicitly not attempted here, per the fresh mission's own repeated caution against over-engineering: a general aggregation DSL (§14); a mirrored Segment-Result tree (§13); a competition-standings/points-across-events engine (already Competition Mode's job, deliberately unfrozen, `LEADERBOARD_RULES.md` §9); Team/Relay's many-to-many Member reference (already named and deferred by prior work, confirmed still-open by this pass, not solved here); any change to Programming's Segment structure beyond naming one already-disclosed gap (Death By's ascending-interval scheme).

## 6. Domain Boundaries

Unchanged from `RESULTS_DOMAIN_ARCHITECTURE.md` §3 and `PROGRAMMING_DOMAIN_V1_2.md` §2. This document adds no new domain and no new cross-domain reference. The one boundary clarification it makes: **Result's reference to Programming content narrows from `(workout_version_id)` to `(workout_version_id, section_id)`** — a precision increase, not a new dependency direction; Results already depended on WorkoutVersion (`RESULTS_DOMAIN_V1_1.md` §1), this simply names which part of it a given Result concerns.

## 7. Canonical Concepts

Restating the mission's own required separation (§2 of the fresh mission) and auditing Forge's paper architecture against it — every boundary already holds, verified, not assumed:

| Concept | Owner | Example |
|---|---|---|
| Workout structure | Programming — Workout, WorkoutVersion, Section, Segment tree | "5 RFT" |
| Scoring semantics | Programming (declares) / Results (interprets) — Section's Score Model | "Duration, lower-better, cap 20:00" |
| Result | Results — Result + Result Attempt | "18:42" |
| Prescription/variant | Programming — Scaling Profile, ScalingContext | "Intermediate" |
| Rx validation | Results — ValidationRecord.classifiedTier | "Rx" |
| Display formatting | Presentation, derived from Result at read time | `"18:42"` string |
| Leaderboard position | Results — derived, never stored as authority | `#4` |

No collapse found. This audit is what §22 of the fresh mission asked for; the answer is that Forge's paper architecture already respects every boundary the mission worried about — the risk was theoretical, not present in the existing design.

## 8. Score Definition

= Programming's existing **Section**, with its already-specified Score Model (`RESULTS_DOMAIN_ARCHITECTURE.md` §6.1: Programming's Format catalog *is* the Score Model vocabulary, Results never duplicates it). No new entity. What changes: a Score Definition (Section) is no longer constrained to be the Workout's single "primary" one — §9.

## 9. Score Component — verdict: not a new entity, resolved as "Section, pluralized"

The mission's hypothesis treated Score Component as a new sibling of Result. This investigation's finding: the capability gap the hypothesis was reaching for (a Workout producing 2+ independently-ranked scores, `SCORING_COMPETITIVE_LANDSCAPE.md` §8's confirmed weakest-Forge-capability finding) is fully closed by two changes, both **additive to already-specified entities**, neither a new one:

- **R1a (Programming):** a Workout's WorkoutVersion may declare more than one Section flagged as independently scored/loggable — directly resolving `PROGRAMMING_DOMAIN_V1_2.md` §13 item 3 in the "allow N" direction. Segment's own scoping (§10 of `SEGMENT_MODEL_SPEC_v1.md`: score label/type lives on WorkoutSection, never on Segment) already anticipated this without saying so explicitly — a Section's Score Model was always meant to be the unit of scoring; the paper architecture just never said "and there can be more than one."
- **R1b (Results):** Result's reference to Programming content becomes `(workout_version_id, section_id)` instead of bare `workout_version_id`. One Result per Member per scored Section per day, not per Workout. Everything downstream — Scoring Snapshot, ValidationRecord, PR derivation, Leaderboard partitioning — already operates at "one Score Model, one comparison" granularity (confirmed by direct re-reading of `RESULTS_DOMAIN_ARCHITECTURE.md` §4.3's ERD and §11.2); it simply now does so per-Section instead of implicitly-per-Workout, a distinction invisible until now only because every Workout so far has had exactly one scored Section.

Why this beats a new "Score Component" entity: it requires zero new mechanics for Scoring Snapshot, ValidationRecord, PR, or Leaderboard — all four already work at exactly this granularity. A new sibling entity would have required either duplicating those four mechanics at the Component level, or awkwardly making Result "contain" N Components each with its own snapshot/validation/PR/leaderboard behavior — reinventing what Section+Result already do, once each.

## 10. Score Result

= the existing **Result** (`RESULTS_DOMAIN_ARCHITECTURE.md` §4.1), unmodified in shape, now scoped per §9's `(workout_version_id, section_id)` reference. A simple, single-Section Workout is the trivial case: exactly one Result, exactly as today's paper architecture already describes — §5's "no visible Score Component abstraction leaks into ordinary UX" requirement is satisfied by construction, since there is no new abstraction, only a Workout that happens to have one Section instead of a theoretical N.

## 11. Completion State

**Verdict: MODIFIED — small additive refinement to an existing rule, not a new primitive.** `RESULTS_DOMAIN_V1_1.md` §3's Time Cap Declaration already specifies the *rule* (`cappedScoringRule`), but the outcome of applying it is not currently a persisted, independently-queryable field — it's implicit in which Score-primitive value is populated. This document proposes making it explicit: `Result.completionState: COMPLETED | CAPPED | DNF | DNS`, computed once at write time from the Time Cap Declaration's rule and never independently settable. This closes, at the architecture-paper level, the exact class of bug this session found and fixed in production (`LEADERBOARD_FINISH_TIME_INVESTIGATION.md` — 100%-implicit completion inference is what let a write-path bug silently discard a valid time). `DNS` (did-not-start) is added beyond the mission's own suggested list because official CrossFit rules distinguish "scored 0, submitted nothing" from "attempted and capped" (`SCORING_COMPETITIVE_LANDSCAPE.md` §6, verified via the CrossFit rulebook's own §1.25). Scope: per Result (i.e., per scored Section, §9) — "Part A completed, Part B not attempted" is naturally two Results with two independent `completionState` values, no ambiguity, confirmed in the adversarial matrix #24.

## 12. Tiebreak

**Verdict: YES, already first-class, adopt unmodified.** `RESULTS_DOMAIN_V1_1.md` §3's Tie-Break Key (`{sourceAttemptRole}`, naming a Result Attempt by role) already reuses the same Result Attempt / Score-primitive vocabulary as the primary Score — directly answering the mission's own §11 question ("Can tiebreak itself reuse the same metric abstraction as a primary score? ... determine whether that simplifies the model") in the affirmative, already, in prior work. §8 confirms tie resolution order (1-1-3 ranking first, then Tie-Break Key). No new mechanism required.

## 13. Attempt / Segment Decision

**Attempt — verdict: YES, already exists (Result Attempt), one additive field.** `RESULTS_DOMAIN_ARCHITECTURE.md` v1.0 §4.1 already models Result Attempt as "one individual recorded effort... a single set, rep, or interval." The adversarial pass (workouts #21–23) is what proves a genuinely new field is needed beyond that: `outcome: SUCCESS | FAIL`, gated by a new `attemptTracking: boolean` Score Model flag (default false), used only for Max Effort Score Models representing a bounded competition-style attempt sequence (weightlifting testing). Ungated by default so ordinary strength logging (workouts #17–20) is entirely unaffected.

**Segment — verdict: NOT required as a Results-layer concept.** Segment (`SEGMENT_MODEL_SPEC_v1.md`) fully owns prescribed *structure*, already frozen-pending, unmodified by this document. The mission's own §22 question — "can Score Components cleanly model intervals without creating five independent leaderboard scores, or does the model need `Score Component → Segment Results → aggregate`?" — is answered by the adversarial pass (#15–16): the existing Interval primitive's own declared aggregation (already in `RESULTS_DOMAIN_ARCHITECTURE.md` §6.2) is sufficient, once its aggregation enum gains a non-collapsing `'list'` value (§14). A parallel, tree-shaped "Segment Result" mirroring the prescribed Segment tree 1:1 was considered and rejected as unnecessary complexity — nothing in the 30-workout pass needed it.

## 14. Aggregation Decision

Two existing mechanisms cover every case found; no third, general aggregation DSL is introduced, directly per the mission's own explicit caution (§8) against building one speculatively:

1. **Within one Section** (combining multiple prescribed pieces into that Section's one Score): Segment's own `resultCombination` (`sum | primary-only | best-of | last`, `SEGMENT_MODEL_SPEC_v1.md` §4) — Programming-owned, already frozen-pending, unmodified.
2. **Within one Interval-family Score Model** (combining N Result Attempts of the same primitive into one Score): the Interval primitive's declared aggregation (`RESULTS_DOMAIN_ARCHITECTURE.md` §6.2) — Results-owned, already specified, gaining one new enum value (`'list'`) per §13's finding.

**Explicitly not built:** a third mechanism for combining *across* independently-scored Sections (workouts #23, #25's Total/combined-AMRAP-sum cases). That combination is always a read-time Leaderboard derivation over already-scored Results — never a new persisted Result, never a third Score Component — directly reusing `RESULTS_DOMAIN_ARCHITECTURE.md` §2.6's "derived, never a competing authority" principle at the cross-Section scope instead of only within one Result.

## 15. Units

Unchanged from `RESULTS_DOMAIN_ARCHITECTURE.md` §10 (canonical storage, per-Member display conversion) — already confirmed, this session, as a genuine, live Forge strength (`toKgForRanking`, `SCORING_COMPETITIVE_LANDSCAPE.md` §9's finding that Forge already handles this better than most competitors researched). No change proposed. Direction (lower/higher-is-better) is derived from primitive type, never separately persisted (`RESULTS_DOMAIN_ARCHITECTURE.md` §6.2's own per-primitive comparison-direction statement) — directly satisfying the fresh mission's §15 ask to avoid redundant configuration.

## 16. Validation

Unchanged from `RESULTS_DOMAIN_V1_1.md` §4–§5 and `RX_ENGINE_SPEC.md` in full — the Validation pipeline and ValidationRecord already scoped correctly at "one Result, one classification," which under §9's refinement now naturally means "one scored Section's Result, one classification," with zero change to the pipeline's own mechanics.

## 17. Rx / Variant Separation

Unchanged, and confirmed this session as Forge's single strongest, uniquely-differentiated capability (`SCORING_COMPETITIVE_LANDSCAPE.md` §11: no other researched platform separates prescription variant from result validity — all six gym-software competitors conflate the two into one self-reported tag). `ValidationRecord.classifiedTier` (computed) vs. `ScoringSnapshot.scalingContext` (declared) — already two independent fields (`RESULTS_DOMAIN_V1_1.md` §6.1). This document strengthens nothing here because nothing needed strengthening; it only confirms the separation survives §9's multi-Section refinement unmodified (each Section-scoped Result carries its own independent classification, exactly as today).

## 18. Multi-Score Composition

Directly answered by §9 + the adversarial matrix's #24 worked example (Part A: Time, Part B: Load): two Sections, two Results, two independent leaderboards, no combined ranking unless a coach explicitly configures one via the §14-named Leaderboard-layer derivation. This is the mission's own headline example (§6), and it resolves without any concept beyond "a Workout may have more than one scored Section."

## 19. Leaderboard Derivation

Unchanged in mechanism from `RESULTS_DOMAIN_ARCHITECTURE.md` §11 (computed at read time, never stored as authority) and `LEADERBOARD_RULES.md` in full. Two additive consumers of §9's refinement: (a) a Leaderboard is now naturally scoped per `(WorkoutVersion, Section)` rather than per bare Workout — trivially the same thing when a Workout has one Section, genuinely two separate boards when it has two; (b) the §14 cross-Section aggregate (Total, combined sum) is one more derived view the Leaderboard layer can compute, never a new persisted entity. `LeaderboardEntry` remains derived, never authoritative — confirmed still true even for the multi-Section and cross-Section-aggregate cases, per the fresh mission's own §32 requirement.

## 20. Log Score UI Derivation

Unchanged in principle from `SCORING_DOMAIN_ARCHITECTURE_INVESTIGATION.md`'s original finding and Forge's own already-shipped design goal (confirmed uniquely strong in competitive research, `SCORING_COMPETITIVE_LANDSCAPE.md` §13: no researched competitor has an AI-parse-to-structured-workout pipeline at all). A Score Model (Section-scoped, §8) deterministically selects the Log Score form's shape — Duration → time input; Composite → rounds+reps; Load → load input; a declared Time Cap Declaration adds the capped-state alternative inputs; a declared Tie-Break Key adds the optional secondary field, shown only when the primary is genuinely tied (progressive disclosure, directly per the fresh mission's §48 "30-second rule"). A multi-Section Workout (§9) generates one such form *per* scored Section the member is completing, sequentially or as separate cards — never one bespoke combined form per workout-format-name, which is exactly the "conditional jungle" the fresh mission's §34 explicitly warns against.

## 21. Display Derivation

Unchanged in principle: canonical `{primitive, value, completionState}` (§10, §11) is the single source; every display string (`"18:42"`, `"CAP · 4+17"`, `"120kg"`) is a pure, downstream formatting function over that structured data, never itself the stored fact — already Forge's live convention in spirit (`workoutFormats.js`'s `secToTime`/display helpers), now made the paper architecture's own explicit invariant too (§27, I-17 below).

## 22. Analytics Implications

Unchanged from `RESULTS_DOMAIN_V1_1.md` §6.2's AnalyticsEvent stream — every event already carries a `resultRef`, which under §9 now resolves to a Section-scoped Result. No analytics computation this document is aware of assumed "one Result per Workout" as a hard invariant; the ones that do (frequency, consistency counts) are correct either way, since a multi-Section day still produces "at least one Result logged," the actual signal those aggregations read. PR derivation gains one refinement independent of §9 (found via adversarial workout #19): Movement PR must key by `(movementId, targetRepMax)`, not `movementId` alone, to avoid conflating a 1RM and a 3RM as comparable — already implicit in `RESULTS_DOMAIN_ARCHITECTURE.md` §8.2's "per Movement at one rep-scheme" language, made explicit here.

## 23. Versioning / Historical Integrity

Unchanged from `PROGRAMMING_DOMAIN_V1_2.md` §4 and `RESULTS_DOMAIN_V1_1.md` §9–§10 in full. §9's refinement adds one precision: a WorkoutVersion's Section-count is itself frozen content (I-P1's own immutability guarantee already covers this — adding a Section to a Workout is an edit, producing a new WorkoutVersion, exactly like any other structural edit, per `PROGRAMMING_DOMAIN_V1_2.md` §4.5). A Result's `section_id` reference resolves within a specific WorkoutVersion exactly as `workout_version_id` already does — no new reproducibility mechanism, the existing one simply now has one more coordinate.

## 24. Backward Compatibility

The single most load-bearing property of this whole document, tested explicitly: every Workout that has ever existed, or ever will under the common case, has exactly one scored Section — under §9's model this is not a special case requiring compatibility shims, it is the *default* case, indistinguishable in shape from what the paper architecture already fully specifies. Nothing in `RESULTS_DOMAIN_ARCHITECTURE.md`, `RESULTS_DOMAIN_V1_1.md`, or `PROGRAMMING_DOMAIN_V1_2.md` needs to change shape — §9's change is additive (a Workout *may* have N scored Sections; it always could have had exactly one, and one remains the overwhelmingly common, zero-extra-complexity case). Live-code Forge (§2) maps onto this even more directly, per `SCORING_MODEL_CURRENT_TO_VNEXT_MAP.md`.

## 25. Adversarial Workout Validation

Full 30-workout pass in `SCORING_MODEL_ADVERSARIAL_MATRIX.md`. Summary: zero workouts required a concept beyond what §8–§14 above define; two structural gaps were found and honestly named as **not resolved here** (Segment's ascending-interval scheme, Team/Relay's many-to-many Member reference) because both are Programming-side or entity-shape changes outside a Results-scoring document's authority, already named by prior work, not newly discovered by this pass.

## 26. Competitive Cross-Check

Against `SCORING_COMPETITIVE_LANDSCAPE.md`'s feature matrix: §9's multi-Section resolution directly closes the #1 confirmed Forge gap (tied with btwb, worst of everything researched) by adopting the *shape* of Wodify/PushPress Train's independently-scored-Component pattern — validated as mature, shipped, industry-proven — while implementing it as "N Sections" rather than "N Components," fitting Forge's own existing Programming/Results split rather than copying either competitor's literal data model (a **B. Improve** classification per the original mission's own framework, not blind adoption). §11–12's Completion State and Tiebreak, once built, would put Forge ahead of every gym-software competitor researched (none has a structured tiebreak; only btwb has a comparably structured cap mechanism) — a **B. Improve, going beyond the median competitor** classification, consistent with the original landscape document's own §19 table.

## 27. Architectural Invariants

Extending `ARCHITECTURAL_INVARIANTS.md`'s existing 16 (§6's own coverage table), all inherited unmodified, plus:

**I-17. A Result's `completionState` is a computed field, derived once at write time from its Score Model's Time Cap Declaration and the logged value — never independently settable, never inferred ad hoc by a display layer.** *(New.)* Rationale: directly closes the class of bug `LEADERBOARD_FINISH_TIME_INVESTIGATION.md` found in live code, at the paper-architecture level, before any VNext implementation could reintroduce it. Enforcement: no write path sets `completionState` directly; it is exclusively an output of applying `cappedScoringRule` to the Score value(s) actually logged.

**I-18. A WorkoutVersion's scored-Section count is ordinary frozen content, covered by I-P1 (Programming, `PROGRAMMING_DOMAIN_V1_2.md`) — adding, removing, or re-scoping a Section is a Workout edit like any other, producing a new WorkoutVersion.** *(New, but a direct, obvious corollary of an already-existing invariant, not a new mechanism.)*

**I-19. A cross-Section aggregate (Total, combined sum) is never persisted as its own Result; it is always a read-time Leaderboard derivation over two or more already-scored, already-persisted Results.** *(New.)* Rationale: the direct extension of I-11 (`ARCHITECTURAL_INVARIANTS.md`) to the multi-Section case — the fresh mission's own §32 requirement, made a named, checkable invariant rather than left implicit.

## 28. Risks

**Coach confusion from a rarely-used capability.** Mitigation: §20's UI-derivation principle means a single-Section Workout's authoring flow is visually and interactively identical to today's — the "add another scored Section" option is opt-in, discoverable only when a coach is authoring something that structurally needs it (a Part A/Part B workout), never surfaced for the 95%+ common case. **Leaderboard proliferation** (a coach accidentally creating many trivial extra Sections, each with a near-empty leaderboard). Mitigation: named as a product-policy question for whoever implements this, not resolved here — plausibly addressed by UI friction alone (multi-Section authoring is deliberately a few more taps than single-Section) rather than a hard technical constraint. **`attemptTracking`'s narrow scope creeping wider than intended** (coaches wanting attempt-level tracking for ordinary metcon logging, defeating the Minimal-Core principle). Mitigation: the flag defaults false and is only exposed on Score Models where Max Effort is already true — structurally unreachable from an ordinary For Time/AMRAP authoring flow.

## 29. Open Questions

Consolidated, none newly resolved by this document, several newly *sharpened*: (1) whether adding a Section should require the same publish/edit friction as any other Workout edit, or a lighter-weight "add a part" affordance — a UI question, not an architecture one, deliberately left to implementation. (2) Whether `completionState`'s `DNS` value should be distinguishable from "logged nothing at all" (no Result exists) at the Leaderboard layer, or treated identically — a real, narrow UX question this document surfaces but does not resolve. (3) Segment's ascending-interval scheme gap (adversarial workout #12) — Programming-side, out of this document's authority. (4) Team/Relay's many-to-many Member reference (adversarial workouts #27–28) — already deferred by prior work, confirmed still open.

## 30. Recommended Evolution Path

Per `SCORING_MODEL_CURRENT_TO_VNEXT_MAP.md`'s classification and the mission's own §50 phasing request — not implemented, sequencing only:

| Phase | Capability | Depends on | Risk | Migration impact |
|---|---|---|---|---|
| 0 | `completionState` explicit field (§11) | Nothing — pure refinement of an already-specified rule | Low | Additive column, backfillable from existing implicit logic |
| 1 | Multi-Section Workouts + Section-scoped Result (§9) | Phase 0 (cleaner to land completionState first, on the simple case) | Medium — touches Result's own reference shape | Every existing Result maps to "the Workout's one Section," zero data loss, per §24 |
| 2 | `Interval.aggregation: 'list'` + Result Attempt `outcome` field (§13–14) | Phase 1 | Low — both are narrow, additive, opt-in fields | None — unused by any existing Score Model until a coach opts in |
| 3 | Cross-Section aggregate Leaderboard views (§14, §19) | Phase 1 | Low — pure read-time derivation, no write-path change | None |
| 4 | Segment ascending-interval scheme; Team/Relay many-to-many Member reference | Independent of Phases 0–3 | Medium (Team/Relay is a real entity-shape change) | Out of this document's authority to plan further |

Every phase is independently shippable and independently valuable — Phase 0 alone would already close this session's own just-fixed bug class at the architecture level; Phase 1 alone would already close Forge's single largest confirmed competitive gap. No phase requires a big-bang rewrite of anything already live or already frozen.

---

**STOP.** Architecture proposal complete. No code, schema, migration, or leaderboard behavior was implemented as part of this document.
