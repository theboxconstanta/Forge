# Forge Programming Domain — v1.2 Delta

**Status:** Draft, additive to `PROGRAMMING_DOMAIN_ARCHITECTURE.md` v1.1 (Approved for Freeze)
**Prepared:** 2026-08-08

This document specifies **only** what changes or is clarified relative to frozen Programming v1.1. It does not restate v1.1's content and carries no authority to alter it. Where this document is silent, v1.1 governs unmodified. Section 10 states explicitly what remains unchanged.

---

## 1. The one departure this document must justify before anything else: WorkoutVersion

Results v1.0 §5.1 evaluated four models for historical permanence and explicitly **rejected** a formal "Versioned Workouts" entity: *"Programming maintains an explicit version history Results pins to — rejected as out of this document's authority... Programming's existing 'detectable revision' contract is sufficient for Results' purposes without requiring Programming to change."* This package's invariants (`ARCHITECTURAL_INVARIANTS.md`) require "every result references exactly one WorkoutVersion" and "published workout versions are immutable" and "rendered variants are deterministic." A principal architect reviewing this package is entitled to ask: **did this package silently reopen a decision v1.0 already closed?**

It did not, for a specific, narrow reason. v1.0 §5.1's rejection was of *Results* maintaining a *second, parallel* version history — the objection was duplication (Results §2.8, "zero duplicated logic"), not the existence of versioning as a concept. v1.0 relied instead on Programming's existing content-stability contract: "any edit after a Workout has been referenced produces a detectable revision, never a silent one." That contract is sufficient for a **human** reading old content to notice something changed. It is **not** sufficient for a **machine** — specifically, the Variant Generation Engine and the Rx Engine — to answer the question "what exact content shape produced this specific rendered output or this specific classification decision, reproducibly, forever?" "Detectable" is a promise about noticeability; it is not a promise about addressability. Determinism (this package's own explicit requirement, and a named Architectural Invariant) requires an addressable, immutable pinning point. Programming's mutable-with-detectable-revision Workout does not provide one; nothing in v1.0 provided one either, because v1.0 did not need bit-for-bit rendering determinism — it only needed "the Score's meaning doesn't silently change," which the Scoring Snapshot already solved without versioning.

**Resolution:** WorkoutVersion is introduced, owned entirely by Programming, as the formal, addressable entity that Programming's own "detectable revision" promise already implied but never named. This is additive to v1.1 in the strict sense this package's constraints require: Workout's public behavior — permanent identity, coach-editable after publish, detectable (never silent) revision — is **unchanged**. What is new is that "detectable revision" now has a concrete mechanism: **every Publish, and every edit to already-Published content, creates a new, immutable WorkoutVersion row; Workout's "current content" becomes a derived pointer to its latest WorkoutVersion; nothing about a Workout's own identity, gym, day, or lifecycle state changes shape.** Results does not gain a second version history — Results simply references Programming's one, real, immutable version lineage by identity, precisely the reuse-not-duplication pattern v1.0 §2.8 already mandates elsewhere (Scaling Context reusing Programming's Scaling Level catalog; Score Model reusing Programming's Format catalog). WorkoutVersion is the same pattern, applied one layer deeper: Results now reuses Programming's *content itself*, addressably, instead of reusing only Programming's *catalogs*.

This is named here, first, deliberately, because a reviewer who does not accept this reasoning should reject this package's WorkoutVersion entity outright rather than accept it by default — the alternative (Results maintaining its own Scoring Snapshot as the sole determinism mechanism, with no formal WorkoutVersion) remains available and is named as **Rejected Alternative 1** in `RISK_REVIEW.md`.

---

## 2. Canonical workout model

Unchanged from v1.1 §3, §4: Workout remains the top-level authored unit, one per Gym per Day, composed of ordered Sections, each carrying a Format and Movements. This package adds no new top-level authoring entity above Workout.

## 3. WorkoutVersion — model

- **Identity**: `(workout_id, version_number)`, version_number monotonically increasing per Workout, starting at 1 on first Publish. Draft edits do **not** create a WorkoutVersion — versioning begins at the moment content first becomes externally referenceable, matching v1.1's own "nothing external depends on [Draft] yet."
- **Immutability**: a WorkoutVersion, once created, is never updated and never deleted. Every field it captures (Section content, Movement references, Scaling Profiles as authored or generated-and-accepted at that moment, Benchmark Identity, Metadata) is a frozen copy, not a live reference back to Workout's mutable state.
- **Creation trigger**: (a) first Publish of a Draft Workout; (b) any subsequent edit to already-Published content, including an edit that only touches a Scaling Profile. A pure metadata-only edit (e.g., correcting a typo in a Coach Note, which athletes never see per v1.1 §3) is a genuine open question this document does not resolve unilaterally — see `RISK_REVIEW.md`.
- **Withdrawal**: unchanged from v1.1's tombstone behavior — retracting a Workout does not delete its WorkoutVersion lineage; the lineage remains permanently addressable, only new references are prevented.
- **Relationship to Workout**: one Workout, many WorkoutVersions (one-to-many, append-only). Workout's "currently active content" is `MAX(version_number)` for that `workout_id` among non-withdrawn versions — a derived pointer, not a duplicated copy, avoiding the exact "stored status as competing authority" failure Results §2.6 already warns against, applied here to Programming's own new entity for consistency.

## 4. Workout version immutability rules

1. A WorkoutVersion's content fields are write-once at creation, enforced structurally (no field on a WorkoutVersion row is ever the target of an UPDATE after insert — a correction always produces a new WorkoutVersion, never a mutation of an existing one).
2. A Result's Scoring Snapshot (Results v1.1) references a specific `(workout_id, version_number)` pair permanently. That reference is guaranteed resolvable forever, even after Workout withdrawal (§3, tombstone behavior extends to the version lineage, not just the Workout row).
3. A RenderedVariant (Variant Generation Engine's output, `VARIANT_GENERATION_ENGINE.md`) computed against a specific WorkoutVersion is reproducible byte-for-byte at any future time, because every input to that computation (the WorkoutVersion's frozen Scaling Profiles, the Movement Library entries it references by permanent identity, the Variant Generation Rules in effect *at generation time*, themselves versioned — see §8) is itself immutable or independently versioned.
4. Coach-facing UI always presents "the current Workout" (the latest WorkoutVersion) by default; presenting a specific historical WorkoutVersion is an explicit, secondary UI affordance (e.g., "what did this look like when I logged it"), never the default authoring surface — Draft/Published/edit workflows in v1.1 §5 are entirely unchanged; a coach never directly authors "a WorkoutVersion," they author "the Workout," and WorkoutVersion creation is a side effect of Publish/edit, invisible to the coach's own workflow.

## 5. Movement identity model

Formalizes the `canonicalName: string | null` field already present in Programming's shipped domain model (`workoutEngine.js`, `workoutMapping.ts`) and populated `null` by every current code path — this is not a new field, it is the first specification of how that existing field gets filled.

- **Resolution mechanism**: a two-layer alias system, adopted directly from `FCKB_ARCHITECTURE_REVIEW.md` §4 (already the approved-as-foundation recommendation, not re-derived here): (1) a fixed, code-level normalization pass (case-fold, de-pluralize, de-hyphenate, strip diacritics) applied to both input text and canonical names before comparison; (2) a `movement_aliases`-equivalent lookup for genuinely irregular forms only (abbreviations, nicknames, cross-community naming).
- **Ambiguity handling**: where an alias resolves to more than one candidate Movement (FCKB's documented SDL/DB/SC/AB/SB collision set), resolution returns a ranked candidate set with a confidence score, never a silently-chosen single answer, per `FCKB_ARCHITECTURE_REVIEW.md` §5-§6. `canonicalName` remains `null` for any Movement text that resolves ambiguously below a documented confidence threshold, correctly and honestly, rather than guessing.
- **Storage tier**: per `FCKB_ARCHITECTURE_REVIEW.md` §13's hybrid recommendation, the Movement Library and its alias/normalization rules ship as versioned code assets (extending the already-proven `formatCatalog.ts` pattern), not as a fully relational catalog — a decision this document adopts, not reopens.
- **Backfill**: existing `wods.movements_*` free-text arrays are resolved retroactively via a `wod_movement_resolutions`-equivalent linking table (`FCKB_ARCHITECTURE_REVIEW.md` §1), capturing `(workout_version_id, section_slot, source_text, resolved_movement_id, confidence_score)` — this table is itself append-only per-resolution-attempt, never overwritten, so a later improvement to the resolution algorithm produces new resolution rows rather than silently rewriting history.

## 6. Load profile model

A Load Profile is a structured elaboration of a prescribed weight, distance, or calorie target for one Movement within one Section, formalizing what `rxEngine.js`'s `parseWeightStandardFromText` already infers informally from free text today.

- **Shape**: `{ dimension: 'load' | 'distance' | 'calories', prescriptionType: 'literal' | 'formula', maleValue, femaleValue, unit, formulaReference? }`.
- **Literal** covers the overwhelming majority case (a fixed number per sex, e.g., `61kg / 42.5kg`).
- **Formula** covers the documented bodyweight-percentage case (`BENCHMARK_WORKOUTS.md`'s Linda example: `1.5 × bodyweight` deadlift) — `formulaReference` names the athlete attribute the multiplier applies against (bodyweight is the only value this platform's research found evidence for; the shape is intentionally general rather than hardcoding "bodyweight" as the sole possible reference, per `FCKB_ARCHITECTURE_REVIEW.md` §11).
- **Free text remains legitimate**: a coach may still type a weight as free text inline in a Movement's description, exactly as today; Load Profile is an *additional*, optional structured field, not a replacement requirement — directly applying v1.1 §2's own "Structured Data, where it earns its keep" principle, since a formula or literal Load Profile earns its keep specifically where the Rx Engine and Variant Generation Engine need to compare and transform it programmatically, while a purely descriptive weight note does not.
- **Canonical storage**: a Load Profile's `maleValue`/`femaleValue` are stored in the canonical unit for their dimension, reusing Results v1.0 §10's unit architecture directly rather than inventing a second one — Programming depends on a Results-owned shared primitive here (Unit System, already named in Results v1.0 §4.1 as "a cross-domain boundary concept, owned by neither domain exclusively"), which is the correct, symmetric application of that primitive's own stated ownership model.

## 7. Scaling profile model

A Scaling Profile is the structured elaboration of a Scaling Variant's content (v1.1 §3's existing "carrying its own content where it differs from the base version"), now machine-readable:

- `{ scalingLevelId, sourceType: 'authored' | 'generated' | 'generated-then-edited', movementOverrides: [{ sectionMovementId, substituteMovementId? , loadProfile?, repOverride?, roundOverride? }], generatedByRuleSetVersion? }`.
- `sourceType` is purely provenance metadata for internal tooling and is never surfaced to athletes as a permanent, visible property — directly reapplying v1.1 §7 REJECT's existing prohibition on "persisting AI provenance or confidence as a permanent, visible property of saved content" to this new generation source, without modification.
- A Scaling Profile is captured, frozen, inside its parent WorkoutVersion (§3) at the moment that WorkoutVersion is created — a later edit to a Scaling Profile creates a new WorkoutVersion, exactly like any other content edit, per §4 rule 1.

## 8. Variant Generation Engine (ownership statement; full design in `VARIANT_GENERATION_ENGINE.md`)

Owned by Programming. Inputs: a base Scaling Profile (or the Section's base Movement/Load content where no Scaling Profile yet exists for the target tier), a target Scaling Level, the Movement Library, and a gym's own Variant Generation Rule set (§9). Output: a proposed Scaling Profile with `sourceType: 'generated'`, presented to the coach for review before it becomes part of any Published WorkoutVersion. The engine itself holds no state and produces no side effects until a coach explicitly accepts its output — Principle 4 of `SCORING_DOMAIN_ARCHITECTURE_INVESTIGATION.md`, restated here as a hard Programming-domain constraint, not a suggestion.

## 9. Deterministic rendering guarantees

Programming's obligation, discharged jointly with the Variant Generation Engine and stated here as the contract Results (and any future client) is entitled to rely on: **given the same `(workout_id, version_number)` and the same Variant Generation Rule set version, the Variant Generation Engine's proposed output is bit-for-bit identical on every invocation.** This requires the engine to be a pure function with no hidden inputs (no wall-clock time, no random seed, no external network call whose response could change) — a constraint this document imposes on the engine's implementation, detailed in `VARIANT_GENERATION_ENGINE.md` §3. Once a coach accepts and the content is frozen into a WorkoutVersion (§3), determinism is trivial (it is now stored, immutable data); the harder guarantee this section states is that the *pre-acceptance proposal* is itself reproducible, which matters for debuggability and for the "why did the engine suggest this" support/trust question named in `RISK_REVIEW.md`.

## 10. Benchmark workout handling

Unchanged in concept from v1.1 §3 (Benchmark Identity remains a first-class, coach-asserted Workout property). One clarification: Benchmark Identity is asserted on a **Workout**, not a WorkoutVersion — a Benchmark's identity ("this is Fran") is a property of the authored intent across the Workout's entire lifecycle, not tied to one specific content snapshot. A specific WorkoutVersion may, however, carry a *different* set of Scaling Profiles than an earlier version of the same Benchmark-asserted Workout (a coach correcting a wrong rep scheme, the exact scenario Results v1.0 §7.4 already names) — Results' own Benchmark leaderboard aggregation (v1.0 §7.5, §11.2) already reads across every Workout instance carrying a Benchmark identity; this document adds that it also, correctly, spans every WorkoutVersion of each such Workout, since a Result's Scoring Snapshot already pins interpretation regardless of which version it was logged against.

## 11. Coach override behavior

A coach may edit any Scaling Profile — authored, generated, or generated-then-edited — through the single, existing Scaling Variant editor (v1.1 §5 workflow step 5), unchanged in UI/UX terms from today. The moment a coach edits a `sourceType: 'generated'` Scaling Profile, its `sourceType` becomes `'generated-then-edited'` (internal provenance only, per §7). No separate "override" entity or workflow exists — an override is simply an edit, and Programming's existing content-stability contract (detectable revision, new WorkoutVersion on next Publish, §4) already governs it correctly with zero new mechanism required.

## 12. Gym-specific scaling policies

A **Variant Generation Rule Set** is a gym-scoped (with a platform-provided default a gym may adopt unmodified) configuration: per-tier load-reduction percentages, a movement-substitution preference table (which of the Movement Library's documented substitution relationships a gym prefers when more than one exists), and per-tier rep/round reduction ratios. Rule Sets are themselves versioned (§9's determinism requirement depends on this) — a gym changing its default Intermediate load-reduction percentage from 70% to 65% creates a new Rule Set version; previously-generated Scaling Profiles are unaffected (they are already frozen into a WorkoutVersion, §3), and only future generation invocations use the new version. This mirrors Programming's own Scaling Level catalog governance (platform-seeded, gym-extensible, v1.1 §3) exactly, applied to generation configuration rather than to the Scaling Level vocabulary itself.

## 13. Render precedence rules

When the Variant Generation Engine or the view-time rendering pipeline (`VARIANT_GENERATION_ENGINE.md` §2) must resolve what content to show for a given `(WorkoutVersion, Scaling Level)` pair, precedence is strict and total, evaluated top-down, first match wins:

1. A Scaling Profile with `sourceType: 'authored'` or `'generated-then-edited'` for that exact Scaling Level, if present on the WorkoutVersion.
2. A Scaling Profile with `sourceType: 'generated'` for that exact Scaling Level, if present and coach-accepted.
3. The Workout's base (typically Rx) content, with the Rx Engine's own Load Profile scaling applied inline as a last-resort **view-time-only** approximation (never written back into the WorkoutVersion) — used only for a Scaling Level with genuinely no authored or generated Scaling Profile at all, disclosed to the coach as "unscaled — showing Rx" rather than silently presenting Rx content as if it were scaled.

No fourth case exists. A render request for a Scaling Level absent from all three tiers above returns an explicit "not available" state, never a silent fallback to a different Scaling Level than the one requested.

---

## 14. What remains entirely unchanged from v1.1

For the avoidance of doubt, this document changes none of the following, which continue to govern exactly as frozen: Workout's own identity/Day-anchoring/Draft-Published lifecycle model (§3 of v1.1); Section as a structural subdivision with exactly one currently-primary scored Section (still explicitly Deferred, v1.1 §7 DEFER, not resolved by this document); the two-tier Movement Library governance model (Platform/Gym, never auto-merged); the Coach Notes/Athlete Notes split; Media as a distinct concept from Notes; Metadata as disposable, non-authoritative descriptive content; the REJECT list in its entirety (no per-class-instance assignment, no closed movement vocabulary, no silent mutation, no AI-as-author-of-record, no Programming decisions about how results are displayed); Track, cross-gym sharing, and fine-grained Publishing authority remaining Deferred by Architectural Boundary, unaffected by anything in this document.
