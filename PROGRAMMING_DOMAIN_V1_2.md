# Forge Programming Domain v1.2

**Status:** Draft — prepared for Principal Architecture Review Board evaluation, prior to freeze
**Prepared:** 2026-08-08
**Relationship to prior documents:** additive to `PROGRAMMING_DOMAIN_ARCHITECTURE.md` v1.1 (Approved for Freeze). v1.1 is treated as frozen and is not rewritten here. Every section below either adds a new architectural contract, clarifies an existing one, or states explicitly that a v1.1 decision is unchanged. No section of this document should be read as superseding v1.1 by silent omission — where this document is silent, v1.1 governs without modification.

---

## 1. Executive Summary

### 1.1 Why v1.2 exists

Programming v1.1 defines what a coach authors: a Workout, composed of Sections, carrying Movements, optionally scaled into named variants, optionally asserted as a Benchmark. It does not define how that content is machine-verifiably reproducible over time, how a Scaling Variant's content is generated rather than only hand-authored, or how a canonical Movement identity is resolved from free text — three capabilities a downstream domain (Results) now requires in order to build automatic Rx classification, deterministic rendering, and reproducible historical analytics without inventing a competing implementation of any of them. v1.2 exists to supply exactly these three capabilities, as additions to Programming's existing authority, and nothing beyond them.

### 1.2 Relationship to frozen v1.1

v1.2 changes the *shape* of nothing v1.1 already defined. Workout, Day, Section, Movement, the two-tier Movement Library, Scaling (as a concept), Benchmark Identity, Metadata, Notes, Media, and the Draft → Published lifecycle with its content-stability contract are unchanged. v1.2 adds new entities beneath and around them (WorkoutVersion, a Movement Identity resolution mechanism, Load Profile, Scaling Profile, the Variant Generation Engine) and formalizes one v1.1 promise (detectable revision) into a concrete, addressable mechanism. Every new entity in this document is additive; none requires an existing v1.1 entity's public contract to change.

### 1.3 Relationship to Results Domain

Results v1.0 (Proposed for Freeze) already depends on Programming's content-stability contract for its own historical-permanence guarantees, and already reuses Programming's Scaling Level catalog and Format catalog rather than maintaining parallel vocabularies. v1.2 deepens that reuse relationship in one specific direction: it gives Results something addressable and immutable (WorkoutVersion, §4) to pin against, where v1.0 previously had only a promise (detectable revision) with no concrete entity behind it. This document defines Programming's side of that contract; Results' own consuming behavior is specified in a companion document (`RESULTS_DOMAIN_V1_1.md`) and is not re-derived here. Programming's awareness of Results remains, as a design property, asymmetric: Results depends on Programming; Programming's schema and logic contain no dependency on Results, and this document contains no entity or rule whose *existence* requires Results to exist — see §2.3 for the precise boundary statement and §12 for the reasoning trail showing this asymmetry was actively preserved, not assumed.

### 1.4 Why no Scoring Domain is introduced

A prior investigation (`SCORING_DOMAIN_ARCHITECTURE_INVESTIGATION.md`) evaluated whether workout-intelligence and execution-intelligence capabilities (automatic variant generation, deterministic rendering, Rx classification, leaderboards, analytics) justify a new, third domain. Its conclusion, adopted as a standing constraint on this document, was that they do not: variant generation is authoring-time intent and belongs to Programming; classification, rendering-consumption, ranking, and analytics are execution-time fact and belong to Results. A third domain would duplicate authority either Programming or Results already holds, violating both frozen documents' own governing "zero duplicated logic" principle at domain scale. This document is Programming's half of that conclusion, made concrete.

---

## 2. Domain Boundary

### 2.1 What Programming owns (v1.1, restated for completeness, unchanged)

Workout identity, Day/Gym anchoring, Section structure and ordering, Movement references drawn from a governed Movement Library, the Draft → Published lifecycle and its content-stability contract, Scaling as an authoring concept (a named variant of a Workout or Section), Benchmark Identity as a coach-asserted property, Metadata, and the Coach Notes / Athlete Notes / Media split.

### 2.2 What Programming owns, newly, in v1.2

| New responsibility | Section |
|---|---|
| An immutable, addressable version lineage beneath each Workout | §4 |
| Canonical Movement identity resolution (populating the pre-existing `canonicalName` stub) | §5 |
| Structured, machine-readable Load prescriptions | §6 |
| Structured, machine-readable Scaling content | §7 |
| Automated, coach-reviewed Scaling content generation | §8 |
| A deterministic rendering contract other domains may rely on | §9 |

### 2.3 What Programming does not own

Unchanged from v1.1, restated because it is load-bearing to every other section of this document: how a logged Score is interpreted, validated, or ranked; who achieved a Personal Record; what a leaderboard shows; any analytics derived from athlete behavior; whether an athlete attended a class; billing, membership eligibility, or any Financial Domain concept. v1.2 adds **no** exception to this list. The Variant Generation Engine (§8) produces authoring content a coach reviews — it does not decide what counts as Rx, which is Results' Rx Engine's exclusive authority (`RX_ENGINE_SPEC.md`), reading Programming's output but never the reverse.

### 2.4 Integration boundary with Results

A single, one-directional dependency: Results reads Programming's WorkoutVersion, Movement identity, Load Profile, and Scaling Profile data, by permanent reference, never by copy of Programming's internal representation and never by write access. Programming has zero code path, foreign key, or schema awareness referencing any Results-owned entity. This asymmetry is the precise, checkable boundary a reviewer should verify against Programming's own dependency graph — not merely accept as a stated intention. Full contract in §10.

---

## 3. Canonical Workout Model

### 3.1 Workout identity (v1.1, unchanged)

A Workout's identity — `(gym, day)`, one per pair — is permanent once created. It is never reassigned to different content and never silently disappears once referenced. v1.2 adds no new identity concept at the Workout level; it adds a version lineage *beneath* that identity (§4).

### 3.2 Workout intent

"Intent" is what a coach means for a Day's training to be, as distinct from any one rendered presentation of it. Intent is captured in Workout + Section + Movement + base Load prescription — the coach-authored, Rx-tier (or otherwise designated base-tier) content. Every other tier (Intermediate, Beginner, OnRamp, gym-custom) is a *derivation* of intent for a different population, never a second, independent intent. This framing is the direct justification for why Scaling Profiles (§7) are modeled as elaborations of a Section's content rather than as sibling Workouts — a decision v1.1 already made (§3, "letting one authored Workout serve a gym's full range of athletes without forking into separate, disconnected workouts") and v1.2 does not revisit.

### 3.3 Movement identity

Unchanged in role from v1.1 (a Movement is an atomic, named reference drawn from a governed Movement Library, not free text); newly specified in resolution mechanism in §5.

### 3.4 Structure representation

Unchanged from v1.1: Workout → Section(s) → Movement(s), Coach/Athlete Notes, Media. v1.2 does not introduce format composition/nesting (multi-part events, buy-in/cash-out as structurally distinct sub-blocks) — this remains a named, open, unresolved question, carried forward explicitly in §13, not silently assumed solved by anything in this document.

### 3.5 Load representation

Newly specified in §6 (Load Profile). Free-text load prescriptions remain fully legitimate wherever a Load Profile does not earn its keep (v1.1 §2's "Structured Data, where it earns its keep" principle, applied here without modification).

### 3.6 Scaling representation

Newly specified in §7 (Scaling Profile), as a structured elaboration of what v1.1 already calls Scaling.

---

## 4. WorkoutVersion

This is the section this document's own instructions identify as most important, and it is treated accordingly: full reasoning, no summary shortcuts.

### 4.1 Why WorkoutVersion is introduced

Results v1.0 §2.1 requires that a Result's interpretation be "frozen at the moment of logging, even when identity and content are not." v1.0 satisfied this without a formal version entity, using two mechanisms: Programming's own promise that any post-publish edit produces a "detectable revision, never a silent one," and a Results-owned Scoring Snapshot capturing the *interpretation-critical* facts (Score Model, Scaling Context) at logging time. This was sufficient for v1.0's own scope, because v1.0 needed only that a human — an athlete or coach looking at old data — could tell something had changed, and that the *meaning* of a stored Score never silently shifted.

It is not sufficient for what v1.2 now requires: a **machine-verifiable, byte-reproducible rendering and classification guarantee** (§9). "Detectable" answers "did something change." It does not answer "exactly what did the athlete see, and can I reconstruct precisely that, forever, to re-run a classification or a render and get the identical answer." Without an addressable, immutable content snapshot, "detectable revision" is a promise about *noticeability*, not about *reproducibility* — and reproducibility is what a deterministic rendering contract and a re-runnable Rx classification both require as a hard precondition, not a nice-to-have.

### 4.2 Why WorkoutVersion belongs to Programming, not Results

Two candidate owners exist. Results could own a version history of Workout content it references; alternatively, Programming — which already authors and edits that content — could own it. This document adopts Programming as owner for a specific, non-cosmetic reason: **the content being versioned is Programming's own authored content, produced by Programming's own workflow, edited through Programming's own coach-facing tools.** A version history of that content is a natural extension of Programming's existing authorship responsibility, not a new responsibility invented for Results' benefit. Results already established the correct general pattern for this exact situation elsewhere — Scaling Context reuses Programming's Scaling Level catalog, Score Model reuses Programming's Format catalog, rather than Results maintaining parallel vocabularies "because Results needs them." WorkoutVersion is the same pattern applied one layer deeper: Results reuses Programming's *versioned content itself*, by reference, rather than maintaining a second copy or a second version-tracking mechanism of its own.

### 4.3 How this reconciles with Results v1.0's earlier rejection of a formal version entity

Results v1.0 §5.1 evaluated and rejected "Versioned Workouts (Programming maintains an explicit version history Results pins to)" as "out of this document's authority... Programming's existing 'detectable revision' contract is sufficient for Results' purposes without requiring Programming to change." A careful reading shows this rejection was scoped narrowly: v1.0 rejected the idea *conditioned on Results needing Programming to change to support it*, and concluded, correctly, at the time, that no change was needed because v1.0's own requirements did not demand reproducibility, only interpretability. v1.2 does not reopen that conclusion for v1.0's original requirements — it observes that a **new** requirement (v1.2's own deterministic rendering contract, §9, which v1.0 never had and never needed) now exists, driven by Programming's own new capability (the Variant Generation Engine, §8), and that this new requirement is the actual reason WorkoutVersion is now justified — not a re-litigation of whether v1.0's original historical-permanence needs were adequately met (they were, and remain so, unchanged). Stated plainly: **WorkoutVersion exists because Programming's own new capability needs it to be deterministic, and Results benefits as a direct, welcome consequence — not because Results asked Programming to change on Results' behalf.** This framing is what keeps the addition inside Programming's own authority rather than requiring Results to renegotiate a settled decision.

### 4.4 Immutability guarantees

- A WorkoutVersion, once created, is never the target of an update or a delete. Every field it captures is a frozen copy of Workout content at the moment of creation.
- Version numbers are monotonically increasing per Workout, starting at 1.
- A WorkoutVersion's content is fully self-contained: it does not hold live references back into Workout's current, mutable state for any field whose later change should not retroactively alter that version's own meaning.

### 4.5 Publication lifecycle

WorkoutVersion creation is a side effect of two, and only two, events: (a) the first Publish of a Draft Workout; (b) any subsequent edit to already-Published content. A Draft Workout's freely-mutable editing (v1.1 §3, "nothing external depends on it yet") produces no WorkoutVersion — versioning begins exactly at the moment content first becomes externally referenceable, matching v1.1's own stated rationale for why Draft content carries no stability guarantee at all. Workout's own "current content," once any WorkoutVersion exists, is redefined as a derived pointer to its latest non-withdrawn WorkoutVersion, never independently-stored duplicate content.

### 4.6 Historical reproducibility

Given any `(workout_id, version_number)` pair, the exact Section structure, Movement references, Load Profiles, Scaling Profiles (as they existed at that version), Benchmark Identity, and Metadata are reconstructable with no ambiguity and no dependency on Workout's current state, at any future point in the platform's life. This is the concrete property §4.1 identified as missing from v1.0's original mechanism, and its presence is what makes §9's deterministic rendering contract provable rather than merely asserted.

### 4.7 Ownership boundaries

WorkoutVersion is created, read, and retained entirely within Programming's own authority and schema. Results references a `(workout_id, version_number)` pair by value, permanently, exactly as it already references bare Workout identity today — the reference *shape* Results uses is unchanged; only its *precision* (a specific version, not merely "the Workout, whatever it currently is plus a promise of noticeable change") is new.

### 4.8 Tradeoffs, discussed explicitly

| Property | With WorkoutVersion (adopted) | Without it (v1.0's original mechanism, retained for non-rendering purposes) |
|---|---|---|
| Historical interpretability of a Score | Sufficient (unchanged from v1.0 — Scoring Snapshot already handled this) | Sufficient |
| Machine-reproducible rendering / re-runnable classification | Possible — content is addressable and frozen | Not possible without inventing an equivalent mechanism elsewhere, likely inside Results, which would then duplicate Programming's own authorship data |
| Storage cost | One new row per Publish-or-edit event, unbounded growth over a Workout's editing history | None |
| Coach-facing complexity | None — versioning is invisible to the authoring workflow (§4.5); a coach still edits "the Workout" | None |
| Conceptual surface area for reviewers | One new entity to reason about | Zero, but at the cost of the reproducibility gap above |

The storage-cost row is named honestly as a real, non-zero cost of this decision, not dismissed — see §13 for the specific open question about edit-granularity (whether every field edit, including purely descriptive ones, should create a new version) this cost consideration bears on directly.

---

## 5. Movement Identity Model

### 5.1 Canonical movement IDs

Every Movement reference resolves, where resolution succeeds, to a permanent `movement_id` in the governed Movement Library (v1.1's existing two-tier Platform/Gym structure, unchanged). This formalizes the `canonicalName: string | null` field already present in Programming's shipped domain model and populated `null` by every current code path — v1.2 specifies how that field gets filled, not a new field.

### 5.2 Metadata ownership

Movement-level metadata (equipment requirements, taxonomy classification, documented substitution relationships to other Movements) is owned by the Movement Library entry itself, never duplicated onto individual Section-level Movement references. A Section's Movement reference carries only what varies per-authoring-instance (a specific Load Profile, a specific rep scheme); everything intrinsic to "what this movement is" lives once, on the canonical entry.

### 5.3 Equipment

An attribute of a Movement Library entry: the equipment category or categories required to perform it. Used by the Rx Engine's equipment-dimension comparison (a Results-domain consumer, `RX_ENGINE_SPEC.md`) and, prospectively, by gym-facing "what equipment do I need today" tooling — named as a consuming use case, not designed to that depth here.

### 5.4 Movement taxonomy

A Movement Library entry belongs to a documented category (e.g., Olympic Lifting, Powerlifting, Gymnastics, Monostructural/Cardio, Functional Bodybuilding/Accessory). Taxonomy is descriptive classification, governed the same way v1.1 already governs Metadata generally — useful for discovery and grouping, never authoritative over a Movement's own identity or comparability.

### 5.5 Resolution mechanism

A two-layer alias system: (1) a fixed, code-level normalization pass (case-folding, de-pluralization, de-hyphenation, diacritic-stripping) applied identically to input text and canonical names before any comparison; (2) a lookup table for genuinely irregular forms only — abbreviations, nicknames, cross-community naming — never enumerating every mechanically-derivable spelling variant as its own row. Where resolution is ambiguous (more than one candidate Movement above a minimum confidence threshold, with no disambiguating context), resolution returns no single answer rather than guessing — `canonicalName` remains `null`, honestly, rather than silently wrong.

### 5.6 Future extensibility

The taxonomy and equipment vocabularies are additive, versioned, code-level assets (not free-growing database rows) — adding a new category or equipment type is a reviewed, code-level change, matching the storage-tier discipline already established for other rarely-changing, developer-authored reference data in this codebase. Movement Library entries themselves may grow in count without bound (a live, real vocabulary of a sport), but the *categories and equipment types* that classify them are deliberately kept small and curated.

---

## 6. Load Profile Model

### 6.1 Structure

A Load Profile is a structured prescription attached to a Movement within a Section (or within a Scaling Profile, §7): `{ dimension, prescriptionType: literal | formula, maleValue, femaleValue, unit, formulaReference? }`.

### 6.2 Rx / Intermediate / Beginner / OnRamp

Each Scaling Level's Load Profile is an independent value set, not a computed discount applied at read time to a single stored Rx value — each tier's Load Profile, once authored or generated-and-accepted, is itself frozen content inside its parent WorkoutVersion (§4), exactly like any other authored field. The Variant Generation Engine (§8) *proposes* a discounted value at generation time; once accepted, that proposal becomes ordinary, independent, frozen content, indistinguishable in storage from a hand-typed value for a tier a coach chose to author directly.

### 6.3 Sex-specific loads

`maleValue` and `femaleValue` are two fields on one Load Profile, not two separate Scaling tiers. This is a deliberate correction of a framing this document's own predecessor investigation identified as an error: sex is a prescription dimension within a tier, not a fifth-and-sixth tier alongside Rx/Intermediate/Beginner/OnRamp.

### 6.4 Unit independence

A Load Profile's `maleValue`/`femaleValue` are stored in the canonical unit for their dimension (mass or distance), reusing the Unit System primitive Results v1.0 already established and named as "a cross-domain boundary concept, owned by neither domain exclusively." Programming depends on this shared primitive rather than inventing a second unit-storage convention — display-unit conversion happens entirely downstream, at render time (§9), never inside Programming's own stored representation.

### 6.5 Snapshot behavior

A Load Profile, once frozen into a WorkoutVersion, never changes. A correction to a wrong prescribed load is authored as an edit to the Workout, which (§4.5) produces a new WorkoutVersion with a new, independently-frozen Load Profile — the old WorkoutVersion's old Load Profile remains permanently, unambiguously readable exactly as it was, satisfying §4.6's historical-reproducibility guarantee for this specific field type.

---

## 7. Scaling Profile Model

### 7.1 Definition

A Scaling Profile is the structured, machine-readable form of what v1.1 already names Scaling: `{ scalingLevelId, sourceType: authored | generated | generated-then-edited, movementOverrides: [...], generatedByRuleSetVersion? }`. It is not a new concept relative to v1.1 — it is v1.1's existing Scaling concept given a shape a generation engine and a rendering pipeline can both read and write, rather than only a human-readable free-text field.

### 7.2 Gym-specific policies

Realized through the Variant Generation Rule Set (§8.4), gym-scoped with a platform-provided default. A gym's own Rule Set governs how the Variant Generation Engine proposes content for that gym's workouts; it does not alter the *shape* of a Scaling Profile itself, which is uniform across every gym on the platform.

### 7.3 Coach overrides

A coach edits any Scaling Profile — authored, generated, or generated-then-edited — through the single, existing Scaling Variant editing surface v1.1 §5 already specifies, with zero UI/UX change required by this document. Editing a `generated` Scaling Profile transitions its `sourceType` to `generated-then-edited`, an internal provenance marker only, never surfaced to athletes as a permanent, visible property — direct, unmodified application of v1.1 §7 REJECT's existing prohibition on persisting AI/generation provenance as visible content.

### 7.4 Precedence rules

Strict, total, evaluated top-down, first match wins, for a given `(WorkoutVersion, requested Scaling Level)`:

1. An `authored` or `generated-then-edited` Scaling Profile for that exact Scaling Level, if present.
2. A `generated` (coach-accepted, unedited) Scaling Profile for that exact Scaling Level, if present.
3. The Workout's base (typically Rx) content, with Load Profile scaling applied as a view-time-only approximation, explicitly disclosed to the viewer as unscaled base content rather than silently presented as genuine tier-specific content.

No fourth case exists; a request for a Scaling Level absent from all three tiers returns an explicit "not available" state.

### 7.5 Future adaptive support

An Adaptive Scaling Level is modeled as an ordinary entry in Programming's existing gym-extensible Scaling Level catalog (v1.1, unchanged) — no schema change required to introduce it. Its Scaling Profile is expected to remain coach-authored directly rather than Variant-Generation-Engine-proposed for the foreseeable term, since individualized/adaptive prescriptions do not reduce to a fixed-percentage discount rule the way Intermediate/Beginner/OnRamp already do — named here as a scoping statement, not a permanent technical limitation.

---

## 8. Variant Generation Engine

### 8.1 Render-time vs. publish-time generation

Generation is **publish-time and coach-triggered**: a coach explicitly requests proposed content for one or more target tiers; the engine's output is reviewed, edited or accepted, and becomes ordinary frozen WorkoutVersion content (§4, §6, §7) before any athlete can see it. No generation occurs automatically, silently, or at the moment an athlete requests a Workout — by the time any athlete-facing request occurs, all content involved is already frozen, authored (in the domain sense — coach-reviewed) content. This is a deliberate choice, discussed against the alternative in §12.

### 8.2 Computed vs. persisted variants

Two distinct outputs, not to be conflated:

- **Scaling Profile** (this section's actual output, once accepted) — persisted, frozen into a WorkoutVersion, indistinguishable from hand-authored content.
- **RenderedVariant** (§9's output, a Results/client-facing concern realized at view time) — computed, not persisted as authority; may be cached, but the cache is a pure performance optimization over already-frozen Scaling Profile content, never a second source of truth.

### 8.3 Deterministic algorithm, described architecturally

Given a base Scaling Profile (or a Section's base content), a target Scaling Level, the Movement Library, and a specific, versioned Variant Generation Rule Set: for each prescribed Movement, the engine independently evaluates (a) a documented movement-substitution lookup (never inventing a substitution absent from the Movement Library's own declared relationships, §5.2), (b) a load-reduction percentage from the Rule Set applied to literal Load Profiles only (a formula-type Load Profile is left unscaled at generation time, since scaling a formula's multiplier at generation time and again at render time would double-apply the reduction), and (c) a rep/round-reduction ratio from the Rule Set. The engine holds no state across invocations and reads no input beyond these four, all of which are either already-immutable (base content, Movement Library) or independently versioned (Rule Set) — the precondition for the determinism claim in §9.

### 8.4 Caching strategy

Content-addressed: a generation result is cacheable under the key `(sectionId, targetScalingLevel, ruleSetVersion)`, since output depends on nothing else. High cache-hit rates are expected once a gym's Rule Set stabilizes, since most Sections authored under an unchanged Rule Set version produce a cache hit on regeneration attempts (e.g., a coach reviewing, discarding, and re-requesting a proposal).

### 8.5 Invalidation rules

None required in the traditional sense — content-addressed keys mean a changed input (a new Rule Set version, edited base content) is simply a different key, never a stale hit under an unchanged one. The operational concern is cache *eviction* (garbage-collecting entries for superseded Rule Set versions or WorkoutVersions no longer receiving read traffic), a standard LRU-style policy, not a correctness mechanism.

### 8.6 Benchmark handling

Benchmark Identity (v1.1, unchanged) is asserted on a Workout, not on any specific WorkoutVersion — it is a property of authored intent across the Workout's full lifecycle. A specific WorkoutVersion of a Benchmark-asserted Workout may carry different Scaling Profile content than an earlier version of the same Workout (a coach correcting a wrong rep scheme), without altering the Workout's own Benchmark identity. The Variant Generation Engine treats a Benchmark-asserted Workout no differently from any other for generation purposes — Benchmark status affects Results-side leaderboard/PR aggregation (a Results-domain concern), never Programming's own generation or storage behavior.

### 8.7 Override behavior

Fully specified in §7.3; restated here only as a cross-reference: an override is an ordinary Scaling Profile edit through the existing editor, with no separate override entity, workflow, or API surface introduced by this engine.

---

## 9. Deterministic Rendering Contract

### 9.1 Formal statement

**Inputs:** a specific WorkoutVersion (§4); a Member profile (specifically, the Member's declared Scaling Context and unit preference — Results-owned data, read by reference, never copied into Programming); a Gym's scaling policy (the Variant Generation Rule Set version in effect, if the requested tier's content derives from generation, §8.3, or nothing further if the requested tier's Scaling Profile is `authored`/`generated-then-edited`, in which case Rule Set state is irrelevant to rendering — it was already fully applied at generation time and is now frozen content).

**Output:** a RenderedVariant — the fully-resolved, unit-converted, precedence-selected (§7.4) presentation of that WorkoutVersion for that Member.

**Guarantee:** given identical inputs — the identical WorkoutVersion, the identical Member Scaling Context and unit preference, and (where relevant) the identical Rule Set version — the render function produces byte-identical output, on every invocation, indefinitely, with exactly one disclosed exception: a Load Profile of `prescriptionType: formula` (§6.1) resolves against a Member's own current attribute value (e.g., bodyweight) at render time, and its rendered output legitimately changes if that attribute changes between two renders — named explicitly as the sole, scoped departure from strict input-output determinism, not a silent gap in the guarantee.

### 9.2 Why this guarantee is provable, not merely asserted

Every input to rendering is either already-immutable (WorkoutVersion, §4.4) or independently versioned (Rule Set, §8.3-8.5) or Results-owned reference data this document takes as a given, external input rather than something Programming computes. No step in rendering reads wall-clock time, a random value, or a live network response. This is the direct mechanism by which §4's entire justification (a machine-reproducible pinning point) is realized in practice, not merely claimed.

---

## 10. Integration Contract with Results

### 10.1 What Programming provides

| Provided value | Description |
|---|---|
| `workout_version_id` | Permanent, immutable reference a Result's Scoring Snapshot pins to, forever resolvable per §4.6. |
| Prescribed loads | Load Profiles (§6) for whichever Scaling Level a Result's classification needs to compare against, read-only. |
| Rendered variant | The RenderedVariant (§9) a Member actually viewed — Programming computes it; Results may capture a reference/hash to it for its own audit purposes, never a copy of Programming's internal representation. |
| Score type | The Format/Score Model vocabulary Programming's Section already declares — Results inherits this vocabulary by reference, unchanged from v1.0's existing reuse pattern, not newly introduced here. |
| Validation rules | Structured Load/Movement/Rep prescriptions (Load Profile, Scaling Profile) Results' own Rx Engine reads to perform classification — Programming provides the *data* the rules operate over; Programming does not itself validate, classify, or rank anything. |
| Tie-break rules | Not a Programming-owned concept; named here only to state explicitly that this responsibility remains entirely with Results' Score Model (a Results-domain extension point), and nothing in this document introduces Programming authority over it. |

### 10.2 What Results is prohibited from doing

Results may not write to any Programming-owned entity (Workout, WorkoutVersion, Movement Library, Load Profile, Scaling Profile, Variant Generation Rule Set) under any circumstance, including a correction, an administrative override, or a data-quality fix — any such correction is authored through Programming's own coach-facing tools, producing an ordinary new WorkoutVersion, never a direct write from Results' own code path. Results may not maintain its own copy or shadow representation of Programming content beyond the specific, narrow interpretation-critical fields its own Scoring Snapshot already captures (Score Model, Scaling Context, and the `workout_version_id` reference) — a full duplicate of Workout/Section/Movement content inside Results is explicitly out of bounds, as it would reintroduce the exact duplicated-authority failure mode both domains' governing principles exist to prevent. Results may not decide, infer, or override a Movement's canonical identity, a Load Profile's prescribed value, or a Scaling Profile's content — these remain exclusively Programming's authored (or generated-and-coach-accepted) truth.

---

## 11. Architectural Invariants

Invariants owned by Programming. Each is stated with rationale, enforcement mechanism, and the consequence of violation, per this document's own required rigor.

### I-P1. WorkoutVersion immutability

**Statement:** a WorkoutVersion, once created, is never updated or deleted.
**Rationale:** this is the sole mechanism by which §9's deterministic rendering guarantee, and Results' own historical-reproducibility guarantee, hold at all — any mutation, however small, would silently invalidate every prior render, classification, or Scoring Snapshot pinned to that version.
**Enforcement:** no application code path performs an update or delete against an existing WorkoutVersion row; a structural (e.g., database-level) constraint rejecting such operations outright is the recommended enforcement, so the invariant does not depend solely on application-code discipline.
**Consequence of violation:** every downstream guarantee this document makes (§4.6, §9.1) becomes false retroactively and undetectably — the single most severe possible failure mode this document defines, since it would corrupt not just future behavior but the platform's entire historical record silently.

### I-P2. Deterministic rendering

**Statement:** identical `(WorkoutVersion, Member Scaling Context, unit preference, Rule Set version)` inputs always produce byte-identical RenderedVariant output, excepting formula-type Load Profile resolution (§9.1).
**Rationale:** Results' Rx Engine and any future re-classification or audit tooling depend on being able to reproduce exactly what a Member saw, at any point in the future — non-determinism here would make every downstream classification an unverifiable, one-time event rather than an auditable, re-derivable fact.
**Enforcement:** the rendering function is specified as pure (§9.2, no hidden inputs); a determinism test suite comparing repeated invocations against frozen fixture inputs is the recommended verification mechanism at implementation time.
**Consequence of violation:** Rx classification and any leaderboard/analytics computation built on it become unreproducible and untrustworthy on audit, even though the underlying stored data remains technically intact.

### I-P3. Movement identity stability

**Statement:** a Movement Library entry's `movement_id` is permanent once created; a later correction to its display name, taxonomy, or metadata does not change its identity, and existing references to it remain valid.
**Rationale:** Movement Performance aggregation (a Results-domain concern, `RESULTS_DOMAIN_ARCHITECTURE.md` v1.0 §5.3) depends on this exact guarantee to remain safe under renames — restated here as a Programming-owned obligation, since Programming is the party actually capable of violating it.
**Enforcement:** `movement_id` is never reassigned or reused; a rename is an update to a display field only, never to the identity field.
**Consequence of violation:** silent corruption of every Movement-level Personal Record and trend aggregation referencing the affected identity, with no detection mechanism available downstream.

### I-P4. Load Profile immutability (within a WorkoutVersion)

**Statement:** a Load Profile, once frozen into a WorkoutVersion, never changes; a correction produces a new WorkoutVersion with a new, independent Load Profile.
**Rationale:** direct corollary of I-P1, stated separately because Load Profile is the specific field type most likely to require correction in practice (a genuinely wrong prescribed weight), making its immutability the one most likely to be tested by real coach behavior.
**Enforcement:** identical mechanism to I-P1 — Load Profile is a field of WorkoutVersion, not an independently-mutable entity.
**Consequence of violation:** identical to I-P1's consequence, scoped to Load-comparison-dependent classification specifically (Rx Engine's Load dimension, `RX_ENGINE_SPEC.md` §3) — a retroactively-changed Load Profile would silently reclassify every historical Result compared against it.

### I-P5. Benchmark identity preservation

**Statement:** a Benchmark's identity, once asserted on a Workout, is permanent; it may be corrected in content (§8.6) but never silently reassigned or retracted without an explicit, coach-visible action.
**Rationale:** unchanged from v1.1's own existing rationale for Benchmark Identity as "load-bearing, not disposable" — restated here as a formal invariant because v1.1 stated it as a design principle without the explicit rationale/enforcement/consequence structure this document's own review standard requires.
**Enforcement:** unchanged from v1.1 — no code path silently clears or reassigns a Benchmark Identity as a side effect of an unrelated content edit.
**Consequence of violation:** a Benchmark's cross-time leaderboard/PR aggregation (Results v1.0 §7.5) silently fragments, with no detectable cause from Results' own side, since Results has no independent record of what a Workout's Benchmark identity used to be.

---

## 12. Tradeoff Analysis

Alternatives considered and rejected, stated with reasoning rather than assertion.

### 12.1 No WorkoutVersion (retain v1.0's original mechanism only)

**Rejected.** Sufficient for v1.0's original scope (interpretability) but not for v1.2's new requirement (machine-reproducible determinism, §4.1). Retaining this alternative would force either (a) Results inventing its own version-tracking mechanism over content it does not author — reintroducing exactly the duplicated-authority failure both domains' governing principles exist to prevent — or (b) simply not offering a deterministic rendering/re-classification guarantee at all, which this document's own mandate (§9) does not permit abandoning without explicit sign-off from whatever review process evaluates this document.

### 12.2 Persisted variants (store every tier's fully-rendered, per-Member output permanently)

**Rejected.** Would conflate §8.2's two distinct outputs (Scaling Profile, properly persisted; RenderedVariant, properly computed) into one, producing either a combinatorial storage explosion (one stored row per Member × per WorkoutVersion × per unit preference, for content that is otherwise a pure, cheap function of already-stored data) or a stale-cache risk if that storage were treated as authoritative rather than as a cache. The content-addressed caching strategy (§8.4) already provides every performance benefit this alternative would offer, without its storage cost or staleness risk.

### 12.3 Duplicated workouts (author a fully separate Workout per Scaling tier)

**Rejected**, matching v1.1's own original, still-standing rejection of forking — restated here because v1.2's new capabilities make the rejection's cost more visible, not less valid: duplication would mean the Variant Generation Engine (§8) would need to produce and independently version *N* separate Workouts per authored Day rather than *N* Scaling Profiles beneath one, multiplying every guarantee in §4/§9/§11 by the tier count for no architectural benefit, and destroying the single-shared-Workout-per-Day model v1.1 §6 already relies on for athlete consumption ("all athletes on a given Day... are reading content from the *same* authored Workout").

### 12.4 Mutable scaling tables (a Scaling Profile editable in place, no WorkoutVersion snapshot)

**Rejected**, as the direct converse of I-P4/I-P1: mutability here would silently invalidate every historical classification and rendered view that depended on the pre-edit content, the exact failure this entire document's WorkoutVersion mechanism (§4) exists to prevent. This alternative was the closest candidate to today's actual production behavior (informal, mutable Scaling content with no versioning) and its rejection is this document's single most consequential decision.

### 12.5 Results-owned rendering (Results computes RenderedVariant itself, reading raw Programming content directly)

**Rejected.** Would require Results to understand Programming's internal Scaling Profile precedence rules (§7.4), Load Profile formula resolution (§6.1), and unit-conversion logic independently — a direct violation of the "zero duplicated logic" principle both domains already share, and a guarantee to drift out of sync the first time Programming's own precedence or generation logic evolves without a corresponding, coordinated change on the Results side. Keeping rendering inside Programming (§9) means Results consumes one, single, authoritative RenderedVariant output and never re-implements how it was produced.

---

## 13. Open Questions

Stated honestly, not resolved by assertion.

1. **Edit granularity for WorkoutVersion creation.** §4.5 states that any edit to already-Published content creates a new WorkoutVersion. Whether a purely descriptive, athlete-invisible edit (a Coach Note correction, which athletes never see per v1.1 §3) should trigger this, versus being treated as a metadata-only update with no version-lineage consequence, is not resolved here. The tradeoff (§4.8's storage-cost row) is named but not settled; resolving it requires a decision about whether "immutability" should apply to every field of a WorkoutVersion uniformly or only to fields with actual interpretation/rendering consequence — a genuine architectural choice, not merely an implementation detail.

2. **Format composition/nesting** (multi-part competition events, buy-in/cash-out as distinct structural sub-blocks) remains entirely unaddressed by this document, exactly as it was unaddressed by v1.1. This is the single largest standing prerequisite for any competition-tier (Open, Quarterfinal, Games, HYROX) capability this platform intends to support, and this document does not attempt to resolve it — it is named here so a reviewer understands it as a known, bounded gap rather than an oversight.

3. **Whether "exactly one primary, scored Section" per Workout should change**, carried forward unresolved from v1.1's own DEFER list. This document's own Scaling Profile and Load Profile models are agnostic to this question (they apply per-Section regardless of Section count), but several of Results' own hardened capabilities (multi-part scoring) would benefit directly from its resolution — named as an accelerating pressure on an already-open question, not a new one this document introduces.

4. **Whether the Variant Generation Rule Set should be gym-configurable at full generality (per-movement substitution overrides, arbitrary percentage tables) or a smaller, platform-curated set of presets a gym selects from**, at V1. Full configurability is more flexible and more expensive to build, test, and support; a curated preset set is faster to ship and harder to misconfigure into implausible content (`RISK_REVIEW.md`'s own multi-tenant risk section names this same tension from the risk-assessment side). This document states the tradeoff and does not resolve it.

5. **Whether Movement Library resolution confidence scoring (§5.5) should ever block Publish outright** (a Workout cannot be published while it contains unresolved, ambiguous Movement text) versus always allowing Publish with `canonicalName: null` for unresolved entries, degrading only downstream classification quality rather than authoring speed. This document assumes the latter (consistent with v1.1's own "Minimal Core, Progressive Complexity" principle — structure is never a precondition to saving) but does not treat this as a foreclosed question; a reviewer prioritizing classification quality over authoring friction might reasonably challenge this default.
