# Forge — Scoring Domain Architecture Investigation

**Status:** Research Only — Not Approved, Not Frozen, Not Implementable As-Written
**Prepared:** 2026-08-08
**Author role:** Principal Software Architect + Principal Product Architect (investigation mode)

This document is analysis. It contains no SQL, no migrations, no code, and proposes no change to any frozen domain. Where it recommends a new capability, it states explicitly which existing domain would own it, under that domain's own existing authority, and names the specific section of that domain's frozen document the recommendation extends rather than contradicts.

This document treats four prior deliverables as immutable input, never re-litigated here: `PROGRAMMING_DOMAIN_ARCHITECTURE.md` v1.1 (Approved for Freeze), `RESULTS_DOMAIN_ARCHITECTURE.md` v1.0 (Proposed for Freeze), `FORGE_PROGRAMMING_COMPETITIVE_SYNTHESIS.md`, `FORGE_RESULTS_COMPETITIVE_SYNTHESIS.md`, and the Forge CrossFit Knowledge Base research package (`docs/fckb/*`, Approved as Foundation With Required Revisions). Every one of these already exists in this repository. A principal architect who ignored them and designed a "Scoring Domain" from a blank page would be re-deriving decisions this platform has already made, correctly, at real cost.

---

## 1. Executive Summary

The mission that produced this document asks for a new "Scoring Domain" spanning sixteen investigation areas — canonical workout representation, variant generation, adaptive rendering, a scoring engine, Rx validation, leaderboards, analytics, and versioning. Read in isolation, that would justify designing a third major domain alongside Programming and Results.

It does not. **The single most important finding of this investigation is that "Scoring Domain," as named in the mission brief, is not one new domain — it is two already-distinct concerns wearing one name, and both already have a home.**

- Everything about **generating** Male/Female, kg/lb, Rx/Intermediate/Beginner/OnRamp content from one coach input is an *authoring-time* capability. Programming already defines the target of that generation — Scaling Variants (`PROGRAMMING_DOMAIN_ARCHITECTURE.md` §3, §7 ADOPT) — as a first-class, coach-owned concept. What Programming does not yet have is a fast, automated *way to fill in* those variants. That is an addition to Programming's authoring surface, not a new domain: it produces the exact same kind of content a coach already produces by hand today, through the exact mechanism Programming's own philosophy already names for exactly this shape of problem — "AI-Assisted... AI output lands in the exact same editable surface as manually typed content" (`PROGRAMMING_DOMAIN_ARCHITECTURE.md` §2).
- Everything about **interpreting** what a coach authored for one specific athlete — adaptive rendering, Rx classification, score capture, leaderboards, PR detection, performance analytics — is a *read/log-time* concern. This is not a gap. `RESULTS_DOMAIN_ARCHITECTURE.md` v1.0 already specifies a Score Architecture (§6), a Scaling Architecture (§9), a Leaderboard Architecture (§11), and an Analytics Architecture (§12) that already cover the substance of ten of the mission's sixteen investigation areas. It is Proposed for Freeze, not yet implemented — the correct next step for most of this mission's ambition is *building what is already architected*, not architecting it a second time under a new name.
- The one genuinely new capability this investigation identifies — deterministic, at-read-time Rx/Intermediate/Beginner/OnRamp classification, driven by comparing an athlete's logged score against a structured prescription — is not a new domain either. It is a formalization and generalization of a pattern **already live in production today**: `rxEngine.js`, the athlete-context weight-standard parser and classifier shipped in Results Phase 3. This investigation's Rx Validation Engine (§8) is that engine's natural evolution, not a new invention.

Reframed this way, the actual architectural work ahead is smaller, safer, and mostly already decided: (1) a narrow, additive **Variant Generation Engine** inside Programming's authoring surface, producing ordinary Scaling Variant content; (2) **building** the already-specified Results Domain, with its Score Model generalized (per Results §6.2's own explicit design) to cover the full format range Programming and FCKB have already cataloged; and (3) generalizing the already-shipped `rxEngine.js` pattern into a first-class, multi-dimension classifier inside that Score Architecture. No frozen domain changes shape. No new domain needs to be declared. This document's Final Recommendation (§18) is exactly this: freeze nothing new, build two already-approved documents, and treat "Scoring Domain" as a marketing label for that combined effort rather than a fourth architectural pillar.

---

## 2. Industry Benchmark Analysis

This section synthesizes what Forge's own prior competitive research (`FORGE_PROGRAMMING_COMPETITIVE_SYNTHESIS.md`, `FORGE_RESULTS_COMPETITIVE_SYNTHESIS.md`) already established, plus targeted findings specific to this mission's scoring/variant question, rather than re-running that research from zero.

### 2.1 Workout representation

Every platform researched (btwb, SugarWOD, Wodify, TrainHeroic, PushPress, TeamBuildr) converges on the same shape Programming already adopted independently: a Day-anchored authored unit, composed of ordered Sections, each carrying a Format and Movements. None of them treat "the workout" and "the score" as one entity — score representation is always a distinct, later-stage concern layered on top of authored content. This validates Programming/Results' existing domain split rather than suggesting a merge.

### 2.2 Variant generation — the genuinely differentiated gap

This is where the competitive research is thinnest, and where Forge's opportunity is real. **No platform examined auto-generates Rx/Intermediate/Beginner/OnRamp content from a single input.** Every one of them requires the coach to author each scaling tier by hand — SugarWOD and Wodify both support multiple "versions" of a workout but as independent authored copies, not derivations. btwb's own scaling support is closer to Programming's existing model (named tiers as siblings of one workout) but is still fully manual. TrainHeroic and TeamBuildr, being strength/conditioning-first rather than CrossFit-metcon-first, barely address the Rx/Scaled axis at all — their variant concept is closer to percentage-based load progression than to a parallel-difficulty ladder. **A working, coach-editable variant *generator* — not just a variant *container* — is a feature none of Forge's researched competitors has shipped.** This is the actual product opportunity buried inside the mission's sixteen-area brief, and it is narrower and more concrete than "build a Scoring Domain."

### 2.3 Score representation and the primitive-composition pattern

`RESULTS_DOMAIN_ARCHITECTURE.md` §6.2 already adopted the correct answer here — Duration/Count/Load/Distance/Completion/Composite/Interval/Max-Effort as composable primitives rather than a growing enum — and this pattern is exactly what the deepest research (`FORGE_RESULTS_COMPETITIVE_SYNTHESIS.md`) found distinguishes platforms that handle novel formats gracefully (btwb) from those that hard-code a fixed score-type list and struggle with anything outside it (documented gaps in several researched platforms' handling of Rounds+Reps tie-breaking and Interval scoring). Competition-tier formats (CrossFit Open, Quarterfinals, Semifinals, Games) do not require a different primitive set — they require the *same* primitives composed under stricter time-cap and tie-break rules (§7 below), which is precisely why Results' primitive-composition choice, made before this investigation began, already generalizes correctly to them.

### 2.4 Movement modeling, aliases, and named-workout identity

FCKB's own research package (`MOVEMENT_CATALOG.md`, `MOVEMENT_ALIASES.md`, `BENCHMARK_WORKOUTS.md`, `HERO_WORKOUTS.md`, `OPEN_WORKOUTS.md`) and its critical review (`FCKB_ARCHITECTURE_REVIEW.md`) already performed exactly the industry-modeling investigation this mission's §3 (Movement Modeling) and part of §1 (Canonical Workout Representation, movement/benchmark identity) ask for — including direct comparison against btwb/SugarWOD/Wodify movement catalogs and named-benchmark handling, and a formal review verdict ("Approved as Foundation, With Required Revisions"). Re-running that research here would duplicate, not add to, existing work. This document defers to it and treats its six required revisions (format composition/nesting, alias normalization split, confidence scoring, expanded format/movement catalogs, connection to Programming's live `canonicalName` stub, and the hybrid static-asset/relational storage question) as **prerequisites** to any Movement/Format catalog work the Variant Generation Engine (§5) or Rx Validation Engine (§8) would depend on.

### 2.5 Competition-tier formats: Open, Quarterfinals, Semifinals, Games, HYROX

CrossFit's own competition season is the clearest existing proof that the primitive-composition model (§2.3) is sufficient: an Open workout is a For-Time or AMRAP with a stricter, published tie-break rule and a hard time cap; a Quarterfinal or Games event routinely adds multi-part composite scoring (points-per-event, summed across a weekend) — which is Programming's own already-identified, not-yet-built need for format *composition/nesting* (`FCKB_ARCHITECTURE_REVIEW.md` §2), not a new score primitive. HYROX's fixed eight-station sequence with division-specific loads is the same pattern FCKB's review already named as a "named protocol" reference-data need (`FCKB_ARCHITECTURE_REVIEW.md` §12) — a lookup against an externally-authoritative structure, not a new scoring concept. Nothing in competition-tier programming requires a score primitive beyond what §6.2 of the frozen Results document already defines; it requires format composition (a Programming-domain authoring concern) and stricter time-cap/tie-break semantics (§7 below, a Score Model concern already anticipated by Results §6.2's "declared comparison rule").

### 2.6 Olympic weightlifting and powerlifting logging systems

Dedicated strength-logging systems (a category TrainHeroic and TeamBuildr both partially occupy) converge on a small, stable vocabulary: an attempt is a (load, reps, success/fail) tuple; a session is an ordered set of attempts against one or more lifts; a "max" is a derived aggregate (best successful attempt, or an estimated 1RM formula applied to a sub-maximal set). This maps directly onto Results' existing Result Attempt entity (§4.1: "One individual recorded effort within a Result — a single set, rep, or interval") plus its Max Effort primitive (§6.2) and its explicitly-named Derived PR category (§8.2, "an optional, explicitly-labeled estimate"). No new entity is needed for strength/Olympic-lifting logging; Results' existing model already anticipated it by name.

---

## 3. Architecture Principles

These govern every recommendation in this document. Where a later section appears to conflict with one of these, the principle wins and the section is wrong.

1. **A capability's home is determined by its lifecycle, not by which product feature it supports.** "Generate Rx/Scaled/Beginner content" has an authoring lifecycle (created once, edited by a coach, versioned like any other Programming content) — it belongs in Programming, regardless of how closely it is marketed alongside scoring features. "Classify this logged score as Rx" has a per-athlete, per-log lifecycle — it belongs in Results.
2. **Reuse an existing frozen decision before proposing a competing one.** Every mission area that already has an answer in `RESULTS_DOMAIN_ARCHITECTURE.md` or `PROGRAMMING_DOMAIN_ARCHITECTURE.md` is pointed at that answer, not re-decided. This mirrors both frozen documents' own stated governing principle (Results §2.8, Programming's reuse of its own Scaling/Benchmark/Movement concepts throughout).
3. **A new capability that only reads existing frozen entities is a safe addition; a new capability that requires a frozen entity to change shape is not addable without renegotiating that domain's freeze.** Every recommendation in this document is checked against this test explicitly.
4. **Automatic generation is a first draft, never an authority.** Exactly as Programming already establishes for AI-assisted authoring (§2, "AI output lands in the exact same editable surface as manually typed content... never publishes or gates anything on its own"), any automatically generated Variant or automatically computed Rx classification is coach-editable and athlete-visible as a derivation, never a silently authoritative fact a human cannot see or override.
5. **A derived answer is computed, never trusted as stored fact**, unless a documented cache-invalidation rule exists — Results §2.6, adopted here without modification for every new derivation this document proposes (Rx classification, adaptive rendering, leaderboard rank).
6. **Nothing in this document may require Programming or Results, as already frozen/proposed, to change shape.** Every entity this document proposes is either new-and-additive, or a specific, named elaboration of an entity those two documents already declared (e.g., Score Model's declared comparison rule, Result Attempt).

---

## 4. Canonical Workout Model

### 4.1 The question, restated correctly

The mission asks whether a "Workout Schema" should be the canonical source of truth, and whether workout representation should be immutable or mutable. This question is already answered, correctly, by Programming's frozen model — this section explains why, rather than re-deciding it.

### 4.2 Programming's Workout is already the canonical representation

A Workout (`PROGRAMMING_DOMAIN_ARCHITECTURE.md` §3) is already: Day-anchored, one per Gym per Day; composed of ordered Sections, each carrying a Format and Movements drawn from a governed Movement Library; carrying a permanent identity with a content-stability contract (Draft may change freely, Published produces a detectable revision on edit, never a silent one, and withdrawal resolves to a tombstone, never to nothing). Every one of the mission's required-support formats — For Time, AMRAP, EMOM, E2MOM, Every X, Intervals, Tabata, Rounds, Chippers, Buy-in, Cash-out, Ladders (ascending/descending), Complexes, Strength, Olympic lifting, Powerlifting, Distance, Calorie, Mixed modality, Multi-score, Team, Relay, Open-style, Quarterfinal-style, Games-style — is a Format, in Programming's own already-defined sense (a Section's declared scoring/structure shape), not a different kind of Workout. FCKB's `WORKOUT_FORMATS.md` already catalogs 55 of them.

### 4.3 Immutable vs. mutable — the correct answer is "both, at different layers," already decided

Programming's Draft/Published lifecycle is deliberately **mutable with detectable revision**, not immutable — a coach must be able to fix a typo (Programming §3, §7 REJECT: "Silent, undetectable mutation of Published content" is rejected; silent-free mutation is not). Results' Scoring Snapshot (§5.1) is **immutable once written** — the interpretation-critical facts (Score Model, Scaling Context) are frozen at logging time regardless of what Programming does afterward. **These are not in tension; they are two different objects with two different lifecycles, exactly as Results §5.1 already designed.** A third, competing "Workout Schema" entity — mutable or immutable — would either duplicate Programming's Workout (violating Results §2.8/Principle 2 above) or duplicate the Scoring Snapshot (same violation). Neither is needed.

### 4.4 What is genuinely missing, and where it belongs

Format *composition* — a Buy-in/Main/Cash-out structure, a multi-part Quarterfinal event, a nested EMOM — is a real gap, already named by `FCKB_ARCHITECTURE_REVIEW.md` §2 as the single largest blocker in the current format model. It is a Programming-domain gap (Section's Format field needs a recursive/nestable shape, or a `parent_format_id`/`slot_role` structure, or a composition JSON), not a Results-domain or "Scoring Domain" gap — Results' Score Model already declares it will inherit whatever format vocabulary Programming defines (§6.1: "Programming already defines the complete vocabulary of formats... Results does not define a second, parallel scoring vocabulary"). This investigation flags format composition as the correct owner (Programming) and correct priority (highest, per FCKB's own review), not as new Scoring Domain scope.

---

## 5. Variant System (the Variant Generation Engine)

This is the section that most directly answers the mission's stated objective ("a coach can create a workout once, while Forge automatically generates Male/Female/kg-lb/Rx/Intermediate/Beginner/OnRamp/Adaptive"), and the section where this investigation departs furthest from treating the mission's framing at face value.

### 5.1 What already exists

Scaling is already a first-class Programming concept (§3: "A named, ordered variant of a Workout or Section... letting one authored Workout serve a gym's full range of athletes without forking into separate, disconnected workouts"), with a platform-seeded, gym-extensible Scaling Level catalog (RX, Intermediate, Beginner, On-Ramp plus gym-custom tiers) already live in production and already reused by Results' own Scaling Context (`RESULTS_DOMAIN_ARCHITECTURE.md` §9.2). What does not exist today is a way to *populate* those variants automatically instead of by hand, for every Section of every Workout, every day.

### 5.2 Recommended shape: a generation service that writes ordinary Scaling Variant content

The Variant Generation Engine is not a new persisted entity. It is a **stateless transformation** — Workout Section + target Scaling Level + Movement Library + (for FCKB-driven cases) a resolved canonical Movement → a proposed Scaling Variant, written into the exact same Scaling Variant slot a coach would fill in by hand. Concretely, for each Movement in a Section, it applies a small number of independent, composable transformation rules:

- **Load scaling**: reduce a prescribed Load by a documented per-tier percentage or a fixed catalog substitution (e.g., RX 61/42.5kg → Intermediate 43/30kg), sourced from a gym-configurable default table, never invented per-workout.
- **Movement substitution**: replace a Movement with a documented easier variant from the Movement Library's own modifier/substitution relationships (FCKB `MOVEMENT_CATALOG.md`'s own movement-substitution research; e.g., Muscle-Up → Ring Row, Handstand Push-Up → Pike Push-Up), never a free invention — every substitution the engine proposes must trace to a Movement Library-declared relationship.
- **Rep/round scaling**: reduce total volume by a documented per-tier ratio, consistent with how the current live implementation's own `movements_intermediate`/`movements_beginner`/`movements_onramp` free-text arrays already informally encode this same idea today (`FCKB_ARCHITECTURE_REVIEW.md` §1).
- **Unit conversion (kg/lb)**: a pure, already-solved function — Results §10 already establishes canonical storage plus read-time conversion from a Member's own preference; the generation engine needs no new logic here at all, only to call the same conversion primitive Results and Personal Record already use.
- **Male/Female**: not actually a *variant* in Programming's sense — it is a **prescription pair on a single Scaling Variant**, exactly as `rxEngine.js` already models it today (`parseWeightStandardFromText` returns `{maleKg, femaleKg}` from one piece of text, not two separate variants). The mission's framing of "Male version / Female version" as if they were siblings of Rx/Intermediate/Beginner is a modeling error this investigation corrects: sex-based prescription is a dimension *within* a Scaling Variant's Load field, not a fifth-and-sixth Scaling Level.

### 5.3 Inheritance and override model

- **Base**: whatever the coach authored (typically Rx, per current live convention, though Programming's model does not require this).
- **Generated layer**: every other Scaling Variant, produced by applying §5.2's rules against the base, written as ordinary Scaling Variant content, visually and structurally indistinguishable from hand-authored content once saved — Principle 4's direct application, mirroring Programming's own AI-authoring pattern exactly.
- **Coach override**: a coach edits any generated variant through the exact same Scaling Variant editor already used for manual authoring (Programming §5, coach workflow step 5). No separate "regenerate" concept is required at the domain level — an edited Scaling Variant is simply a Scaling Variant a coach has since touched, and Programming's existing content-stability contract (detectable revision on edit) already covers it.
- **Movement/weight/rep/distance/equipment overrides** are not new concepts; they are ordinary edits to the fields the Scaling Variant already carries.

### 5.4 Should variants be immutable snapshots?

No — and this question, asked at face value, reveals another framing error worth naming explicitly. A Scaling Variant is *authored content*, living under Programming's Draft/Published lifecycle (§4.3 above); it is *not* a logged fact about what an athlete did, which is the actual domain where immutability matters (Results' Scoring Snapshot). Making Scaling Variants immutable would prevent a coach from ever correcting a bad auto-generated substitution — a direct violation of Programming §7 REJECT ("Requiring any structural layer as a precondition to saving" / the coach-correction guarantee). The generation engine's *output*, once accepted or edited, is exactly as mutable-with-detectable-revision as any other Programming content, and no more.

### 5.5 Coach editing workflow

Extends Programming's existing coach workflow (§5) by inserting one new, optional step: after authoring the primary Section (step 4), the coach may trigger "Generate Variants," reviews the proposed Intermediate/Beginner/OnRamp/scaled-load content inline in the same Scaling Variant editor already used today, edits or accepts each, and proceeds to save exactly as before. This is additive to an already-frozen coach workflow, not a replacement of any step in it.

---

## 6. Scoring Engine

### 6.1 The engine already exists at the design level

`RESULTS_DOMAIN_ARCHITECTURE.md` §6.2 already defines the complete composable primitive set this mission's §6 investigation area asks for: Duration, Count, Load, Distance, Completion, Composite (Rounds+Reps, compared lexicographically), Interval (a repeated sequence with a declared aggregation rule), and Max Effort (a flag over Result Attempts, not a distinct primitive). This section evaluates that design against the mission's explicit list rather than proposing an alternative.

| Mission requirement | Covered by | Notes |
|---|---|---|
| Time | Duration | lower-is-better |
| Rounds | Count | higher-is-better |
| Reps | Count | higher-is-better |
| Rounds + reps | Composite | lexicographic comparison, exactly matching CrossFit convention |
| Weight | Load | canonical-unit storage (§10) |
| Distance | Distance | canonical-unit storage (§10) |
| Calories | Count | Results §6.2 explicitly names "calories treated as a count" |
| Max reps / max load | Max Effort flag | over Count or Load respectively |
| Successful/unsuccessful attempts | Completion | boolean qualifier, not independently ranked — correct for strength attempts |
| Multi-score workouts | Composite / multiple declared Score Models per Section | see §6.3 |
| Interval scores | Interval | per-interval measure plus declared aggregation |
| Split scores | Result Attempt sequence | §4.1's "one individual recorded effort... for Results richer than a single whole-Workout Score" |
| Team / relay scores | Composite over multiple Members' Attempts | see §6.4 |

### 6.2 Are score types composable? Yes — this is already the design, not an open question

The mission's §6 explicitly asks "should score types be composable." Results §6.2 already answers yes, structurally: every named score type in the mission's list is expressed as a composition of the seven primitives above, "never as a growing enum of unrelated score types," and explicitly states "custom formats are supported without a model change: any new Score Model is a new named composition of the primitives above, plus a declared comparison rule." This is the correct answer and is not revisited here.

### 6.3 Multi-score / multi-part workouts

A genuine gap, but a narrow one, and the same gap `FCKB_ARCHITECTURE_REVIEW.md` §2 already identified at the Programming/format layer (format composition/nesting). A Quarterfinal event scored across three independent parts is not a new Score primitive — it is three ordinary Score Models (one per Section, once Programming supports multiple independently-scored Sections per Workout, currently deferred per `PROGRAMMING_DOMAIN_ARCHITECTURE.md` §7 DEFER: "Whether 'exactly one primary, scored Section' remains correct") plus a declared aggregation rule (sum of points, best-of-N) at the Result level. This investigation recommends the aggregation rule live as a property of the *Scoring Snapshot* (Results §5.1) captured at logging time — consistent with the same "interpretation frozen at logging time" discipline Results already applies to everything else.

### 6.4 Team and relay scores

Not modeled today anywhere in Forge's frozen architecture, and this document does not invent a full model for them — it identifies the correct shape and defers detail design. A Team/Relay Result is structurally a Result whose Scoring Snapshot references *multiple* Members rather than one, with the same Score Model and comparison rules applying to the team's combined effort. This requires Results' Result entity to support a many-to-many relationship to Member for this specific case (today: one Member per Result, per `RESULTS_DOMAIN_ARCHITECTURE.md` §4.3's ER diagram, "MEMBER ||--o{ RESULT: logs"). This is named here as a **required, but not yet designed, extension to the frozen Results document** — not something this investigation resolves unilaterally, consistent with Results' own discipline of naming rather than hand-waving open questions (§17 below).

---

## 7. Time Cap Semantics

Not addressed explicitly in either frozen document today — a genuine gap this investigation identifies and scopes, without designing it to completion (per Architecture Principle 3: no proposal here should require Results to change shape, only to add a declared rule within the shape it already has).

### 7.1 The correct model: a Score Model property, not a new primitive

A time cap is a property of a **Duration**-scored Score Model: a declared maximum Duration value plus a declared **capped-scoring rule** — what to record and how to compare when the cap is reached before completion. This fits inside Results §6.2's existing "declared comparison rule" concept for a Score Model without adding a new primitive.

### 7.2 Required capped-scoring rules (industry-standard, all CrossFit Open/Games-verified)

- **Cap reached, work incomplete, reps countable** — score becomes a Count (reps completed) rather than a Duration, with an explicit convention that any Count-based score in this Score Model always ranks below any completed Duration score (the universal CrossFit convention: anyone who finishes beats anyone who is capped, regardless of how many reps the capped athlete completed).
- **Cap reached, work incomplete, rounds+reps countable** — identical to the above using the Composite primitive instead of a bare Count.
- **Partial completion with no countable sub-unit** (e.g., a max-load attempt not completed in time) — Completion=false, no ranked score; this is not a gap, it is the correct, already-modeled behavior of the Completion primitive (§6.2).
- **Scaled cap behavior** — a different Scaling Context may declare a different cap value for the same Section; this is a property of the Scaling Variant (§5), not the Score Model, and requires no new mechanism.

### 7.3 Tie-breaking

Competition tie-break rules (e.g., CrossFit Open's own published tie-break policy: time to a specific mid-workout rep marker) require a Score Model to optionally declare a **secondary comparison key** sourced from a specific Result Attempt (§4.1's split-logging capability, §8 below) rather than the whole-Result Score. This is additive to Results' existing comparison-rule concept, not a redesign of it.

---

## 8. Log Score Architecture

### 8.1 Design target

The mission's explicit target — under 10 seconds for the majority of athletes — is a UX/implementation performance goal, not primarily an architecture question. This section defines the architecture that makes a sub-10-second path *possible*, not the UI itself.

### 8.2 One-screen fast path, backed by Minimal Core

Results §2.9 ("Minimal Core, Progressive Complexity... a Member must be able to log a complete, valid Result with almost no required structure — a Score and a Scaling Context") is the architectural precondition for a fast path. The fast-path screen requires exactly two inputs: the Score (in whatever shape the Section's Score Model declares — a single Duration field, a single Count field, etc.) and a Scaling Context (pre-selected to the Member's own last-used or default tier, changeable with one tap). Every other capability — Movement Attempts, split logging, notes — is progressive disclosure behind an explicit "add detail" affordance, never a precondition, matching Results §2.9 exactly.

### 8.3 Auto-generated input fields

The specific input control rendered (a time picker, a numeric stepper, a rounds+reps dual field) is determined entirely by the Section's Score Model — one generic "Score Capture" component parameterized by Score Model type, not one bespoke screen per workout format. This is directly analogous to how Programming's own `FormatConfigEditor.jsx` already renders format-specific authoring controls from one shared component parameterized by format, a pattern already proven in this exact codebase.

### 8.4 Progressive disclosure and the complex-workout editor

For a multi-part or Interval Score Model, the fast path still presents one primary input (the Score Model's declared "headline" measure — e.g., total time for a multi-part-summed event) with an optional expand-to-detail affordance revealing per-part or per-interval Result Attempts. The architecture requirement this implies: a Score Model must declare which of its composed measures is the "headline" one for fast-path display, distinct from its full composition — a small, additive property on the existing Score Model concept, not a new entity.

### 8.5 Split logging, offline logging

Split logging is Result Attempt (§Results §4.1) applied at UI level — nothing new architecturally. Offline logging is a client-side concern (local-first write, sync on reconnect) layered over the same Result/Scoring Snapshot model; because a Scoring Snapshot is frozen at the *moment of logging* (Results §5.1), an offline-queued log's snapshot is correctly captured against whatever Score Model/Scaling Context was in effect on the device at logging time, and reconciles safely on sync without needing special server-side logic — a direct, favorable consequence of Results' existing snapshot design, not something this document has to solve separately.

### 8.6 Editing historical results, audit history, result versioning

Already decided by Results §8.4 (a Member may edit their own logged Result, treated identically to a new eligible Result for PR purposes) and §8.6 (a PR Event, once recorded, is a permanent ledger entry, never rewritten, even if a later Result edit changes whether it counts as a PR "going forward"). This investigation adds one recommendation: an edited Result's *prior* Score value should be preserved as an audit trail (a simple append-only log of "Score changed from X to Y at time T by actor Z"), mirroring the PR Event ledger's own discipline, for the same reason — an athlete's history should never lose a fact, even a superseded one. This is additive to Results' existing model and does not require Section 4's core entities to change.

---

## 9. Automatic Rx Validation (the Rx Validation Engine)

### 9.1 This already exists — the task is generalization, not invention

`rxEngine.js`, shipped in Results Phase 3, already implements the deterministic core of what the mission's §9 asks for: it parses a structured `{maleKg, femaleKg}` weight standard from a Section's own free text, resolves an athlete's gender-appropriate standard, and classifies a logged weight as `rx` or `not_rx` by direct numeric comparison — never asking the athlete to self-declare. Its design already embodies the two principles the mission's §9 asks for explicitly: the user does not decide Rx status, and the engine is derived-at-read-time rather than pre-computed-and-stored ("Derivat la citire, nu stocat," in the engine's own governing comment) — meaning a later correction to a prescribed weight never desyncs from a stale cached classification.

### 9.2 What is genuinely missing, scoped precisely

1. **Multi-dimension comparison.** Today's engine compares Load only. The mission asks for comparison across movements, reps, weights, distances, calories, equipment, order, and time-cap behavior. Each of these is a straightforward extension of the same pattern — parse a structured prescription from the Section's Score Model/Movement content, compare the athlete's logged Attempt against it per-dimension — but is not built today. This is the single largest concrete implementation gap this investigation identifies.
2. **Movement/equipment/order matching.** Requires the FCKB Movement resolution work (§2.4 above) to be in place first — an engine cannot verify "did the athlete use the prescribed movement" without a canonical Movement reference to compare against, which is exactly the `canonicalName: null` gap `FCKB_ARCHITECTURE_REVIEW.md` §1 already named as FCKB's real, live integration point.
3. **A four-way (not two-way) classification.** Today's engine returns `rx`/`not_rx`. The mission wants Rx/Intermediate/Beginner/OnRamp/Modified — a straightforward generalization: compare the logged Attempt against *each* Scaling Variant's declared prescription (§5) in descending order of difficulty, and classify to the highest tier the Attempt meets or exceeds, falling to "Modified" if it meets none. This requires no new architecture beyond what the current engine already does per-comparison, run once per tier instead of once.
4. **Graceful ambiguity handling, already correctly designed.** The current engine's `MULTI_MOVEMENT_STANDARD` sentinel (returning "cannot classify" rather than guessing when a Section has more than one distinct weighted movement and only one logged number) is exactly the confidence-aware behavior `FCKB_ARCHITECTURE_REVIEW.md` §6 recommends generally. The generalized engine should preserve this discipline for every new comparison dimension it adds: an ambiguous or unparseable comparison returns "no classification," never a false negative — Results §2.6's "computed, never trusted" principle applied at the level of the classifier's own confidence, not only its output value.

### 9.3 Where this engine lives architecturally

Inside Results' Score Architecture (§6), as the concrete implementation of "Score validation" already named as one of Results' five shared engines in its Cross-Interface Contract (§13: "Score validation, PR detection, Benchmark recognition, Leaderboard ranking, Analytics aggregation — invoked identically by every client"). It is not a sixth engine bolted on from outside; it is the engine Results already promised to have and has already partially built.

---

## 10. Leaderboard Integrity

Fully specified already by `RESULTS_DOMAIN_ARCHITECTURE.md` §11 — computed at read time, never stored as a competing authority (§11.1); Workout and Benchmark leaderboards as the same mechanism with different filters (§11.2); partitioned by Scaling Context first, then ordered by the Score Model's declared comparison direction (§11.3); standard competition tie ranking, 1-1-3 (§11.4). This investigation's only addition: the mission's explicit worry about "edited score handling" and "deleted score handling" is already answered structurally, not as an afterthought — because a Leaderboard is computed fresh from current Results on every read (§11.1), an edited or deleted Result simply changes what the *next* read computes; there is no separate leaderboard-row entity that could become stale or corrupted, which is precisely why "cannot be accidentally corrupted" (the mission's own framing) is a property of Results' existing design, not a new invariant this document has to add.

**Competition mode vs. gym mode vs. global mode**, named in the mission but not in Results' frozen document: this maps directly onto Results §11.2's existing Workout/Benchmark leaderboard filters, gym-scoped by default (Results Non-Negotiable Invariant #9's spirit), with a cross-gym "global"/"World" leaderboard already named as a deliberately deferred, opt-in future evolution item in Results §16 ("a cross-gym, opt-in 'World' Benchmark leaderboard... clearly marked opt-in to respect the gym-scoped-by-default invariant"). Competition mode (a time-boxed, published-scoring-window leaderboard for an Open/Quarterfinal-style event) is the one genuinely new leaderboard *behavior* this investigation identifies: a leaderboard that is deliberately frozen/published at a specific close-of-scoring moment rather than perpetually live. This is a read-time parameterization (a leaderboard computed as-of a specific timestamp, using the exact same "historical leaderboards... parameterized by a past date or date range" mechanism Results §11.3 already describes as needing no separate historical storage), not a new entity.

---

## 11. Performance Analytics

`RESULTS_DOMAIN_ARCHITECTURE.md` §12 already defines the Athlete/Coach/Owner analytics model this mission's §11 asks for, at the aggregation level; this section prioritizes the mission's specific example list against that existing model.

### 11.1 Already in scope, per Results §12

Progress, consistency, frequency, benchmark trends, PR trends, movement trends (§12.1); benchmark participation, athlete progress scoped to a coach's roster (§12.2); engagement, retention, community health, attendance-performance correlation (§12.3, explicitly named as a capability "every competitor... either siloed away entirely or only marketed without verifiable proof of shipping" that Forge's architecture is "structurally better positioned... to build this for real").

### 11.2 Prioritization of the mission's specific list (V1 / V2 / V3)

| Metric | Tier | Rationale |
|---|---|---|
| Volume accumulation, load accumulation | **V1** | Direct aggregation over already-structured Load/Count Attempts once canonical units (Results §10) are live — no new capture required. |
| Estimated 1RM | **V1** | Already named as Results' own Derived PR category (§8.2) — an explicitly-labeled estimate from existing Load data via a standard formula. |
| Workout density (work per unit time) | **V1** | Derivable directly from existing Duration/Count/Load Scores; no new capture. |
| Pace curves, round times, transition times | **V2** | Requires Result Attempt-level split capture (§8.5) to be in active use, not just architecturally possible — a capture-behavior dependency, not a modeling one. |
| Buy-in time, cash-out time | **V2** | Same dependency as above — requires format composition (§4.4, §6.3) to exist first so a buy-in/cash-out is a distinct, splittable Section/Attempt. |
| Movement bottleneck identification | **V2** | Requires per-movement Attempt-level timing, which requires both split capture (V2 above) and canonical Movement resolution (FCKB dependency, §2.4). |
| Estimated aerobic capacity | **V3** | Requires a validated sport-science formula and a broader Interval/Duration dataset per athlete than V1/V2 provide; genuinely research-dependent, not just an engineering task. |
| Attendance correlation | **V1 architecturally, V2 in practice** | The *mechanism* is already fully specified (Results §12.3, Day-level Gym-scoped correlation, no new cross-domain reference) and could ship as soon as Results itself ships; realistic product sequencing likely places it just after the core logging/PR/leaderboard loop is proven, hence V2 in practice despite zero remaining architectural work. |
| Recovery indicators | **Out of scope for this domain entirely** | Requires data Results does not and should not own (subjective wellness, sleep, HRV) — a future Wellness/Recovery domain's concern, explicitly not modeled here per Architecture Principle 1 (lifecycle determines home; recovery data has an entirely different capture lifecycle than a logged Score). |

---

## 12. Workout Versioning

Fully specified already by `RESULTS_DOMAIN_ARCHITECTURE.md` §5, and this is the section where the mission's own "what happens if a coach edits a workout after athletes have logged scores" question is answered most directly and completely by existing, frozen-adjacent work — this investigation does not improve on it, only confirms its sufficiency against the mission's stated concerns.

- **What happens on edit**: Programming's content-stability contract guarantees a detectable revision, never a silent one (`PROGRAMMING_DOMAIN_ARCHITECTURE.md` §3); Results' Scoring Snapshot additionally guarantees the *already-logged* Score remains correctly interpretable under the Score Model that was in effect at logging time, even if the Section's format is later changed (`RESULTS_DOMAIN_ARCHITECTURE.md` §5.3, "Workout edits").
- **What happens on deletion**: resolves to a tombstone, never a cascade-delete of logged Results (§5.1, §5.2 — named as "the single most consequential defect in production today" that this exact mechanism was designed to correct).
- **WorkoutVersion as a formal entity**: explicitly evaluated and rejected by Results §5.1 ("Versioned Workouts... rejected as out of this document's authority... Programming's existing 'detectable revision' contract is sufficient"). This investigation does not reopen that decision; a formal WorkoutVersion entity remains unnecessary because the permanent-identity-plus-Scoring-Snapshot hybrid already achieves everything a formal version history would, at lower cost and without requiring Programming to change shape.
- **Migration behavior, leaderboard preservation, analytics integrity**: all already covered by Results §5.3's five named scenarios (Workout edits, Workout deletion, Benchmark changes, Movement renames, Scaling changes).

---

## 13. Data Model

This section proposes candidate entities **only** for the genuinely new capabilities this investigation has identified (§5 Variant Generation, §7 Time Cap declarations, §9 Rx classification generalization). Every entity from `RESULTS_DOMAIN_ARCHITECTURE.md` §4.1 (Result, Result Attempt, Scoring Snapshot, Benchmark, Scaling Context, Unit System, Personal Record, PR Event, Movement Performance, Leaderboard) is adopted unmodified and is not re-listed here — repeating them would misrepresent already-decided entities as open questions.

| Candidate concept | Entity type | Owning domain | One-line definition |
|---|---|---|---|
| **Variant Generation Rule** | True entity (reference/config) | Programming | A gym- or platform-level default rule (load-reduction percentage, movement-substitution mapping, rep-reduction ratio) the Variant Generation Engine (§5) applies; not a Workout-specific object. |
| **Generation Proposal** | Transient, not persisted | Programming | The output of applying Variant Generation Rules to a Section — exists only in the coach's editing session until accepted, at which point it becomes an ordinary Scaling Variant. No table is needed; this is a pure function's output. |
| **Time Cap Declaration** | Property of Score Model | Results (extends §6) | A Duration ceiling plus a declared capped-scoring rule (§7.2), attached to a Score Model, not a new top-level entity. |
| **Tie-Break Key** | Property of Score Model | Results (extends §6) | An optional secondary comparison source (a named Result Attempt) for competition-grade Score Models (§7.3). |
| **Rx Classification** | Derived value | Results (extends §6, formalizes `rxEngine.js`) | A pure function of a Result Attempt against a set of Scaling Variant prescriptions — never stored as fact, exactly like Personal Record (§2.6). |
| **Team Result** | Open question, not designed | Results | Named in §6.4 as requiring Results' Member reference to become many-to-many for this case only; explicitly deferred to a future, dedicated design exercise, not resolved here. |

**No new frozen domain, and no new top-level "Scoring" table family, is proposed.** This is the direct, load-bearing consequence of §1's central finding: nearly everything the mission's data-model section asks for already has an owning entity in Programming or Results.

---

## 14. Event Flows

### 14.1 Coach Flow (as the mission requests, annotated by owning domain)

```
Create workout                         [Programming — existing]
   ↓
Analyze workout (AI-assisted, optional) [Programming — existing, "Coach First, AI-Assisted"]
   ↓
Generate variants (NEW — §5)            [Programming — additive]
   ↓
Coach reviews/edits generated variants  [Programming — existing Scaling Variant editor]
   ↓
Publish                                 [Programming — existing Draft → Published lifecycle]
```

Only one step in this flow is new relative to today's already-frozen Programming domain: "Generate variants." Everything before and after it is Programming's existing, unmodified coach workflow (`PROGRAMMING_DOMAIN_ARCHITECTURE.md` §5).

### 14.2 Athlete Flow (as the mission requests, annotated by owning domain)

```
Open workout                    [Programming — existing Athlete Consumption Model, §6]
   ↓
Adaptive rendering               [Results — NEW capability, see §14.3 below]
   ↓
Log score                        [Results — existing, §Log Score Architecture / §8 above]
   ↓
Validation (Rx classification)   [Results — extends existing rxEngine.js, §9 above]
   ↓
Classification (tier assignment) [Results — same engine, §9.2 item 3]
   ↓
Leaderboard                      [Results — existing §11]
   ↓
Analytics                        [Results — existing §12]
```

Only "Adaptive rendering" is a capability not already explicitly named in Results' frozen document (though closely related to Results §9's Scaling Context). It is addressed in detail below.

### 14.3 Adaptive rendering — resolving the mission's own open question

The mission's §5 explicitly asks whether adaptive rendering should occur at publish time, view time, or log time, and asks for tradeoff analysis. This investigation's answer:

- **Not at publish time.** Programming's Published content is gym-wide, not per-athlete (`PROGRAMMING_DOMAIN_ARCHITECTURE.md` §6: "All athletes on a given Day... are reading content from the *same* authored Workout"). Rendering per-athlete at publish time would require Programming to fork content per athlete, directly contradicting this already-frozen decision.
- **At view time — the correct answer.** An athlete's own Scaling Context preference, unit preference, and (in future) training-level signal are read at the moment they open the Workout, and the already-published, gym-wide Scaling Variant content (§5) is selected and unit-converted (Results §10.2's existing read-time conversion pattern) for display. This requires zero new persisted state — it is a pure, per-request selection function over already-published, already-generated content.
- **Not fully re-resolved at log time.** By the time an athlete logs a score, the Scaling Context they trained under must already be fixed and captured into the Scoring Snapshot (Results §5.1) — re-deriving "what they trained under" from view-time signals after the fact would violate Results' own frozen historical-permanence model. Log time consumes the Scaling Context view time already resolved; it does not re-resolve it.

**Tradeoff analysis**: view-time rendering costs one extra read-time computation per Workout view (negligible — a selection over already-materialized data, not a generation) in exchange for zero data duplication, zero staleness risk (a later Scaling Variant edit is immediately visible to every athlete who hasn't yet logged against it, exactly as Programming's content-stability contract already promises), and full compatibility with Results' snapshot-at-log-time model. Publish-time rendering was rejected because it would require Programming to abandon its single-shared-Workout-per-Day model, which this document has no authority to change (Absolute Constraint: "Do not propose changes that require rewriting existing domains").

---

## 15. Scalability

### 15.1 What Results already commits to

`RESULTS_DOMAIN_ARCHITECTURE.md` Non-Negotiable Invariant #12 already requires "properly indexed, gym-scoped data from the first migration onward — this is not deferred as acceptable at small scale," and §16 already names a materialized Leaderboard/PR cache as a future evolution item, explicitly triggered only if real read-latency at scale demands it (following btwb's own documented precedent of needing exactly one such batch path at real scale, not more). This investigation adds no new commitment here; it inherits Results' existing one.

### 15.2 New scalability surfaces this investigation introduces

- **Variant Generation** (§5) is a write-time, coach-triggered, low-frequency operation (once per Section, per authoring session) — negligible read-path impact, no realtime requirement, and safely implementable as an on-demand synchronous call rather than a background job at any scale this platform is likely to reach in the 12-24 month horizon this document targets.
- **Rx Classification** (§9) runs once per logged Result, at write time, exactly like the PR-detection check it sits alongside (Results §8.1: "checked automatically at the moment it is logged"). Its cost is proportional to the number of Scaling Variants on the relevant Section (typically 2-4), not to leaderboard size — it does not become a bottleneck as gym count or athlete count grows, only (trivially) as the number of scaling tiers per workout grows, which is bounded by product design, not data volume.
- **Competition-mode leaderboards** (§10) introduce a genuinely new load pattern — a large burst of near-simultaneous logs during a live Open/Quarterfinal scoring window, all reading and writing against one Workout/Benchmark's leaderboard at once. This is the first scenario in this investigation that plausibly justifies Results §16's deferred materialized-cache evolution item earlier than "large-scale, indeterminate future" — this document flags competition-mode support as the concrete trigger condition Results §16 left unnamed, not as a reason to build the cache preemptively before competition mode itself is built.
- **Offline-first logging** (§8.5) shifts some write-path latency tolerance to the client, and does not introduce new server-side scalability concerns beyond ordinary eventual-consistency reconciliation on sync — already a solved problem pattern elsewhere in this platform (Live Sync, referenced directly by Results §11.5 as the mechanism Leaderboards should extend rather than reinvent).

### 15.3 Multi-gym and global leaderboard scale

Already addressed by Results §11.3 (gym-scoped partitioning by default) and §16 (an opt-in, explicitly-deferred cross-gym "World" leaderboard). This investigation's only addition: a global/World leaderboard, if and when built, should reuse the exact same computed-at-read-time, never-materialized-as-primary-authority discipline (§11.1) that gym-scoped leaderboards already use — a cross-gym aggregation is a wider filter on the same derivation, not a structurally different mechanism requiring its own caching strategy from day one.

---

## 16. Migration Strategy

This section describes strategy only, at the level Results §14 already establishes as the correct level of detail for a frozen-adjacent architecture document — no SQL, no execution plan.

### 16.1 What this investigation does not need to migrate

Because §1 through §14 conclude that no new frozen domain is required, there is no "Scoring Domain migration" in the sense of moving data out of Programming or Results into a third home. The migration surface is exactly Results §14's own already-strategized migration (unifying the two current logging tables into Result/Result Attempt, backfilling Scaling Context, backfilling canonical units, correcting the cascade-delete relationship) plus the additive, lower-risk work this investigation identifies on top of it.

### 16.2 Sequencing, building directly on Results §14.5's own five steps

1. Results §14.5 steps 1-4 execute first, unmodified — introduce Result/Result Attempt/Scoring Snapshot/Benchmark/PR Event additively, backfill, correct the cascade-delete relationship, cut clients over to shared engines.
2. **In parallel with Results §14.5 step 1** (since it depends on nothing Results migrates), FCKB's required revisions (`FCKB_ARCHITECTURE_REVIEW.md` §16, priority-ordered: format composition, alias normalization split, confidence scoring, expanded catalogs, Programming `canonicalName` connection, hybrid storage decision) proceed as their own workstream — the Rx Validation Engine's multi-dimension comparison (§9.2 item 2) depends on this, not on Results' own migration.
3. **After** Results' shared Score-validation engine exists (Results §14.5 step 4) and FCKB's Movement resolution is live, generalize `rxEngine.js` into the multi-dimension, four-tier classifier described in §9.2 — a pure extension of already-shipped, already-tested code, not a rewrite.
4. **In parallel with, or after, step 3** (no hard dependency either direction), build the Variant Generation Engine (§5) as an additive Programming authoring capability, since it depends only on Programming's existing Scaling Variant model and the Movement Library/substitution data FCKB is already producing.
5. Format composition (§4.4, §6.3) — the highest-priority FCKB-review gap — should land before competition-tier (Quarterfinal/Games) multi-part scoring is attempted, since without it there is no way to represent a multi-part Workout at all, in either domain.

### 16.3 Risk of sequencing this incorrectly

The one sequencing risk this investigation flags explicitly: building the Variant Generation Engine (§5) *before* FCKB's alias-normalization and confidence-scoring revisions land (`FCKB_ARCHITECTURE_REVIEW.md` §4, §6) would mean movement-substitution proposals are generated against an under-resolved, ambiguous Movement Library — producing plausible-looking but unreliable auto-generated variants that erode coach trust in the feature before it has a chance to prove itself. This is a real, named risk, not a hypothetical one, given FCKB's own review already documents live collision cases (SDL, DB, SC, AB, SB) that a premature generation engine would silently mishandle.

---

## 17. Open Questions

Named honestly, per the same discipline both frozen documents already model (a real gap named explicitly is stronger than a shortcut built to avoid admitting one exists — Programming §12, Results §17).

1. **Team/Relay Results** (§6.4): requires Results' Member reference to become many-to-many for this one case. Not designed here; requires a dedicated exercise, ideally jointly reviewed against whatever the eventual Programming Team/Partner-format work (already named as a real, cataloged gap in `FCKB_ARCHITECTURE_REVIEW.md` §2) produces, since the two are closely coupled.
2. **Format composition/nesting** (§4.4, §6.3): the single highest-priority prerequisite this investigation depends on for both multi-part competition scoring and buy-in/cash-out-level analytics (§11.2), and it is a Programming-domain design exercise this document has no authority to complete — named as a dependency, not designed here.
3. **Whether "exactly one primary, scored Section" per Workout should change** (`PROGRAMMING_DOMAIN_ARCHITECTURE.md` §7 DEFER, restated here because §6.3 and §11.2 both depend on its resolution): still open in Programming's own frozen document; this investigation adds no new pressure to resolve it beyond confirming that Results/Scoring-side work would directly benefit if it is resolved toward "yes, multiple independently-scored Sections."
4. **Whether Variant Generation Rules (§13) should be gym-configurable or platform-fixed at V1**: a real product-scope question with real implementation-cost implications (a gym-configurable rule set is more flexible, more work, and more testing surface than a fixed, platform-authored default table) — this document names the tradeoff and does not resolve it.
5. **How aggressively to auto-apply generated Scaling Variants vs. always requiring explicit coach acceptance**: Architecture Principle 4 requires that generation never publishes on its own, but does not settle whether an *unedited, accepted* generated variant should be visually flagged as machine-generated to athletes, coaches, or neither, indefinitely or only until first coach edit. Programming's own AI-authoring precedent (§7 REJECT: "Persisting AI provenance or confidence as a permanent, visible property of saved content") suggests the answer is "neither, and never," but this is named as an open product decision, not asserted as settled by this document.
6. **Competition-mode leaderboard freeze semantics** (§10): whether a "closed" competition leaderboard should become genuinely immutable (a real exception to Results §11.1's "always computed fresh" rule) or merely display a frozen-as-of snapshot while remaining recomputable underneath — a real tension between competition integrity (never let a late score edit silently change a published final competition result) and Results' own "never a competing stored authority" principle, not resolved here.
7. **Recovery/wellness data** (§11.2): explicitly named as out of this domain's scope, but its eventual home (a new domain? an extension of Member profile data?) is not decided here.

---

## 18. Final Recommendation

Reviewed as a Principal Architect would review a proposal to add a fourth major domain to a platform that already has three frozen or freeze-proposed ones:

**Do not create a "Scoring Domain."** The investigation requested by this mission's sixteen areas, read carefully against what already exists in this repository, resolves into three honest categories: (a) capabilities already fully architected and merely not yet built — the overwhelming majority of the mission's Scoring Engine, Leaderboard, Versioning, and Analytics sections, all already specified in `RESULTS_DOMAIN_ARCHITECTURE.md` v1.0; (b) one narrow, genuinely new, safely additive capability — the Variant Generation Engine (§5) — that belongs inside Programming's existing authoring surface, using Programming's existing Scaling Variant concept as its output shape, exactly as AI-assisted authoring already does for ordinary content; and (c) one capability that already exists in production and needs disciplined generalization rather than invention — the Rx Validation Engine (§9), which is `rxEngine.js` today and a broader version of the same pattern tomorrow.

Declaring a fourth domain here would violate this investigation's own Architecture Principle 2 (reuse an existing frozen decision before proposing a competing one) at the largest possible scale — an entire domain's worth of duplicated authority over Score Models, Scaling, and Leaderboards that Results already claims, correctly, as its own (`RESULTS_DOMAIN_ARCHITECTURE.md` §13's Cross-Interface Contract: "No client computes any of these independently"). A "Scoring Domain" that reimplemented Rx validation, leaderboard ranking, or PR detection outside Results would itself become the second, competing implementation Results §2.8 and §13 exist specifically to prevent — the exact failure mode both frozen documents were written to guard against, now nearly re-introduced by the very mission meant to extend them.

The correct 12-24 month roadmap implied by this investigation is not a new domain's roadmap — it is: **(1) build `RESULTS_DOMAIN_ARCHITECTURE.md` v1.0 as already approved-for-freeze-track**, since the majority of this mission's ambition is already fully specified there and simply not yet implemented; **(2) complete FCKB's required revisions** (`FCKB_ARCHITECTURE_REVIEW.md` §16) as the movement/format data foundation both the Variant Generation Engine and the generalized Rx Validation Engine depend on; **(3) build the Variant Generation Engine as an additive Programming capability**, sequenced after FCKB's alias/confidence work to avoid the trust-eroding risk named in §16.3; **(4) generalize `rxEngine.js`** into the multi-dimension, four-tier classifier described in §9, sequenced after Results' shared Score-validation engine and FCKB's Movement resolution are both live; and **(5) treat format composition/nesting (§4.4) as the standing prerequisite** for every competition-tier and multi-part-scoring capability named in this mission, tracked as Programming's own open item, not manufactured as new Scoring Domain scope.

No frozen domain requires any change to its own architecture to accommodate any recommendation in this document. Programming's Workout/Section/Scaling/Movement model, and Results' Result/Scoring Snapshot/Benchmark/Scaling Context/PR/Leaderboard model, both already have the shape this investigation's sixteen mission areas need — what they need next is implementation, and in exactly two places (Variant Generation, Rx multi-dimension classification), a small, precisely-scoped, additive extension.

SCORING DOMAIN ARCHITECTURE INVESTIGATION COMPLETE
