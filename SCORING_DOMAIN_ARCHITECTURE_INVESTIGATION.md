# Forge — Scoring Domain & Workout Intelligence Architecture Investigation

**Status:** Research and synthesis — not approved, not frozen, not implementable as-written
**Prepared:** 2026-08-08
**Author role:** Principal Software Architect + Principal Product Architect + Principal UX Architect (investigation mode)

This document supersedes the earlier `SCORING_DOMAIN_ARCHITECTURE_INVESTIGATION.md` produced in this same work-stream. It is not a rewrite from zero: in the interval between that document and this one, its central finding was acted on — a full architecture review package (`EXECUTIVE_ARCHITECTURE_SUMMARY.md`, `PROGRAMMING_DOMAIN_V1_2.md`, `RESULTS_DOMAIN_V1_1.md`, `VARIANT_GENERATION_ENGINE.md`, `RX_ENGINE_SPEC.md`, `LEADERBOARD_RULES.md`, `SEQUENCE_DIAGRAMS.md`, `ERD.md`, `ARCHITECTURAL_INVARIANTS.md`, `RISK_REVIEW.md`) was produced, and a companion investigation into the actual, audited state of both client codebases (`UNIFIED_WORKOUT_BUILDER_PLAN.md`, `WORKOUT_BUILDER_SPEC_V2.md`) was completed. This document is the top-level synthesis of all of that work, reorganized around one new, explicit, non-negotiable constraint this mission introduces: **Forge is one product with two clients, never two products that happen to share a backend.** Every section below is written to be self-contained and reviewable on its own; where a companion document already contains the full depth on a topic, this document says so explicitly and cites it, rather than silently duplicating or silently contradicting it.

---

## 1. Executive Summary

### 1.1 The central finding, restated and now client-aware

The original investigation concluded that no new "Scoring Domain" should be created as a third pillar alongside Programming and Results — the mission's sixteen investigation areas resolve into capability that already belongs to Programming (authoring-time: Workout, Section, Movement, Scaling, and now WorkoutVersion and the Variant Generation Engine) or to Results (execution-time: Score validation, the Rx Engine, Leaderboard, Analytics). That finding stands, unmodified, and this document does not reopen it.

What this document adds is the client dimension the original investigation did not need to address: **the same Programming and Results domains must be consumed identically by two clients — the Forge Web App and the Forge PWA — with zero duplicated business logic between them.** This is not a new architectural pillar either. It is a constraint on how the already-correct domain split is *exposed*, and — critically, per the direct audit performed for `UNIFIED_WORKOUT_BUILDER_PLAN.md` — a constraint the platform is currently **failing** in one specific, now-documented way: the two clients' workout-authoring surfaces have independently drifted, each gaining real capability the other lacks, while nominally editing the same underlying data. Section 14 of this document is the direct architectural response to that failure.

### 1.2 What "one domain model, one source of truth, two client experiences" means concretely

It means every one of the following must be true, and this document verifies each against the platform's actual, audited state rather than asserting it: the Workout Schema is the same schema on both clients (§4); the Scoring Engine is the same engine (§9, §12 — already a frozen Results v1.0 invariant, §13 Cross-Interface Contract, "no client computes any of these independently"); the Validation Engine is the same engine (§11); the Leaderboard Engine is the same engine (§12). Where this document found evidence that a capability exists on only one client today (movement autocomplete, AI paste-to-draft on the PWA; Duplicate/clone, an accessible modal pattern, and an unsaved-changes guard on the Web App), that is named as a **convergence gap to close**, not as an acceptable permanent asymmetry, and not as evidence that a "PWA feature" or "Web feature" is a legitimate category of thing to have going forward.

### 1.3 Relationship to prior work in this stream

| Prior document | What it already answers | What this document does with it |
|---|---|---|
| `PROGRAMMING_DOMAIN_V1_2.md` | WorkoutVersion, Movement Identity, LoadProfile, ScalingProfile, Variant Generation Engine, Deterministic Rendering Contract | Adopted unmodified as this investigation's answer to §4–§8, §13 |
| `RESULTS_DOMAIN_V1_1.md` | Result aggregate, Score Model extensions, AnalyticsEvent, hardened leaderboard eligibility | Adopted unmodified as this investigation's answer to §9, §11, §12 |
| `VARIANT_GENERATION_ENGINE.md`, `RX_ENGINE_SPEC.md`, `LEADERBOARD_RULES.md` | Deep, implementation-adjacent specs for three of the named engines | Cited, not re-derived, in §7, §11, §12 |
| `ERD.md`, `SEQUENCE_DIAGRAMS.md`, `ARCHITECTURAL_INVARIANTS.md`, `RISK_REVIEW.md` | Data model, lifecycle flows, invariants, risk review — all single-client-agnostic | Extended in this document with the client dimension they did not previously carry (§14, §16) |
| `UNIFIED_WORKOUT_BUILDER_PLAN.md`, `WORKOUT_BUILDER_SPEC_V2.md` | The *actual, audited* state of both clients' authoring surfaces, and the canonical contract both must converge to | The direct evidentiary basis for §14 and for this document's claim that "one product, two clients" is a real, current gap, not a hypothetical future risk |

### 1.4 Why no Scoring Domain is introduced (unchanged verdict)

Restated once, briefly, because this document's own required structure asks for an Executive Summary that stands alone: a third domain would duplicate authority Programming or Results already holds, at exactly the moment this document is also arguing against duplicating authority *across clients*. The same discipline — one authority per concern, reused rather than re-implemented — applies at both the domain axis and the client axis, and this document treats that as one unified principle (§3), not two coincidentally similar ones.

---

## 2. Industry Benchmark Analysis

### 2.1 Workout and score representation (unchanged from the original investigation, not re-derived)

Every platform researched (btwb, SugarWOD, Wodify, TrainHeroic, PushPress, TeamBuildr) converges on a Day-anchored authored unit composed of ordered Sections, each carrying a Format and Movements, with score representation as a distinct, later-stage concern layered on top — validating Programming/Results' existing split. No platform examined auto-generates Rx/Intermediate/Beginner/OnRamp content from a single input; a working variant *generator*, not merely a variant *container*, remains a genuine, differentiated opportunity (`VARIANT_GENERATION_ENGINE.md`).

### 2.2 The client-architecture angle, newly examined for this document

This is the one area the original investigation did not examine, because "one product, two clients" was not yet a stated constraint. It is directly relevant now: **btwb and SugarWOD both already ship separate coach/box-management apps and separate athlete-facing apps** — the same "one product, two clients" shape this mission mandates for Forge, not a novel risk Forge is introducing. This is industry-validated architecture, not an untested idea. What neither platform's public-facing material demonstrates convincingly (and what Forge's own competitive research, `FORGE_RESULTS_COMPETITIVE_SYNTHESIS.md`, already flagged as unverifiable from the outside) is *how* they guarantee logic parity between those two clients internally — whether they share a domain layer the way this document requires, or whether their two apps have quietly drifted the same way Forge's own two clients already have (§14). Forge cannot benchmark this specific property externally; it can only get it right internally, which is this document's own purpose.

### 2.3 Competition-tier formats and scoring (unchanged from the original investigation)

CrossFit Open/Quarterfinal/Semifinal/Games programming, and HYROX's fixed station sequence, remain evidence that the primitive-composition Score Model (§9) is sufficient and that the real gap is format *composition* (multi-part events, buy-in/cash-out as distinct sub-blocks), not a missing score primitive — restated here because §5 and §13's open questions depend on this conclusion.

### 2.4 Olympic weightlifting and powerlifting logging systems (unchanged)

A stable, small vocabulary — attempt as (load, reps, success/fail), session as an ordered attempt set, max as a derived aggregate — already maps directly onto Results' Result Attempt entity and Max Effort primitive (§9). No new entity required.

---

## 3. Architecture Principles

These govern every decision in this document, and — per §1.2 — are now explicitly dual-axis: a domain axis (inherited from the original investigation) and a client axis (new).

1. **A capability's home is determined by its lifecycle, not by which product feature or which client surfaces it.** Unchanged from the original investigation's Principle 1, restated to make explicit that "which client asked for it" is never a valid reason to place logic in that client instead of the shared domain.
2. **Reuse an existing frozen or already-specified decision before proposing a competing one — across domains, and across clients.** The original investigation's Principle 2, extended: a client that builds its own copy of validation, scoring, or leaderboard logic because "porting was slower" is committing the exact violation this principle exists to prevent, regardless of how well-intentioned the shortcut was.
3. **A new capability that only reads existing frozen/specified entities is safe to add; one that requires a frozen entity or an already-specified engine to change shape is not addable without renegotiating that authority.** Unchanged.
4. **Automatic generation is a first draft, never an authority — on either client.** Unchanged from the original investigation, restated for both clients explicitly.
5. **A derived answer is computed, never trusted as stored fact, on either client** — the direct client-axis extension of Results v1.0 §2.6, made explicit here because a client-side cache of a "current PR" or "leaderboard rank" that silently becomes the client's own source of truth is a realistic failure mode this principle exists to name and forbid.
6. **Nothing in this document may require Programming or Results, as already specified, to change shape** — unchanged.
7. **One domain model, one source of truth, two client experiences.** *(New, this document's own governing addition.)* Every engine named in this document (Score validation, Rx classification, Leaderboard ranking, Analytics aggregation, Variant Generation) is invoked identically by both clients. Differences between clients are permitted only in presentation and interaction (§14) — never in the answer either client computes for the same question against the same data.
8. **A capability gap between clients is a defect to close, not a permanent product differentiation.** *(New.)* Where one client has a capability the other lacks (§14's convergence table), that asymmetry is named, dated, and scheduled for closure (`WORKOUT_BUILDER_SPEC_V2.md` §8's convergence phases) — it is never treated as an acceptable, permanent "PWA does X, Web does Y" split, because that split is precisely what already happened once, silently, before anyone was investigating for it.

---

## 4. Canonical Workout Model

Fully specified in `PROGRAMMING_DOMAIN_V1_2.md` §3–§4 and adopted here unmodified: Workout (permanent identity, Day/Gym-anchored) as the top-level authored unit; WorkoutVersion (new, immutable, append-only, Programming-owned) as the addressable, machine-reproducible snapshot lineage beneath it, introduced specifically to satisfy the deterministic-rendering guarantee (§8 below) that the original Scoring Snapshot mechanism alone did not provide. Every format in the mission's required list (For Time, AMRAP, EMOM, E2MOM, Every X, Intervals, Tabata, Rounds, Chippers, Buy-in/Cash-out, Ladders, Complexes, Strength, Olympic lifting, Powerlifting, Distance, Calorie, Mixed modality, Multi-score, Team, Relay, Open/Quarterfinal/Games-style) is a Format within Programming's existing, already-cataloged 22-format vocabulary (confirmed live and identical across both clients by the `UNIFIED_WORKOUT_BUILDER_PLAN.md` audit — §14.1), composed from Results' seven Score primitives (§9) — not a new kind of Workout. **The Workout Schema is already the canonical source of truth in the sense this mission asks; it is not yet the canonical source of truth in the sense of being the entity either client's builder actually writes to today** — both write to the legacy `wods` table with a best-effort mirror into the structured schema, a gap named honestly in `PROGRAMMING_DOMAIN_V1_2.md` §9.1 and not re-litigated here.

---

## 5. Workout Section Architecture

Section remains a Programming-owned structural subdivision (`PROGRAMMING_DOMAIN_ARCHITECTURE.md` v1.1 §3, unchanged). Two open questions, both already named and both still open, are restated here rather than re-derived: whether "exactly one primary, scored Section" per Workout should change (v1.1's own DEFER list, restated in `PROGRAMMING_DOMAIN_V1_2.md` §13 item 3), and whether format composition/nesting (a Buy-in/Main/Cash-out structure, a multi-part competition event) should become a first-class structural capability (`PROGRAMMING_DOMAIN_V1_2.md` §13 item 2, `FCKB_ARCHITECTURE_REVIEW.md` §2's own prior finding that this is the single largest blocker to representing real-world workouts). This document adds no new position on either question; both remain the standing prerequisite for full competition-tier support on *both* clients, not a client-specific gap.

---

## 6. Movement Architecture

Fully specified in `PROGRAMMING_DOMAIN_V1_2.md` §5: canonical `movement_id`, a governed two-tier (Platform/Gym) Movement Library, a two-layer alias-resolution mechanism (normalization + a curated irregular-forms table, per `FCKB_ARCHITECTURE_REVIEW.md` §4), equipment and taxonomy as Library-entry metadata, substitution relationships as declared Library data (never invented at generation time, `PROGRAMMING_DOMAIN_V1_2.md` §8.3). The client-axis finding worth stating explicitly here: the PWA's `movements.js`/`miscareSugestii`/`MovementSuggestions` autocomplete is real, working, shipped movement-search capability the Web App entirely lacks today (`UNIFIED_WORKOUT_BUILDER_PLAN.md` §1.3, confirmed by direct audit) — this is not a gap in the *architecture* described in `PROGRAMMING_DOMAIN_V1_2.md` §5, it is a gap in which client currently exposes that architecture's benefit to a coach, and it is scheduled for closure in `WORKOUT_BUILDER_SPEC_V2.md` §8 Phase 2.

---

## 7. Variant System

Fully specified in `PROGRAMMING_DOMAIN_V1_2.md` §7–§8 and `VARIANT_GENERATION_ENGINE.md` in full: Scaling Profile as the structured elaboration of Scaling content; the Variant Generation Engine as a publish-time, coach-triggered, deterministic transformation producing coach-reviewable proposed content, never self-publishing; strict render-time precedence (authored/generated-then-edited > generated > view-time base-content approximation); Male/Female modeled as a prescription dimension *within* a tier, not as two additional tiers (a framing correction this document does not revisit, `PROGRAMMING_DOMAIN_V1_2.md` §6.3). **Client-axis status:** neither client today implements the Variant Generation Engine at all — both model Scaling as a flat, hand-authored, four-tier structure (`UNIFIED_WORKOUT_BUILDER_PLAN.md` §5.3's alignment table). This is not a client-asymmetry to converge; it is a genuinely unbuilt capability on both clients equally, and `WORKOUT_BUILDER_SPEC_V2.md` §6.1's `VariantPanel` component is the named seam where it attaches once built, on both clients simultaneously by construction (since the component is shared, §14).

---

## 8. Adaptive Rendering Engine

Fully specified in `PROGRAMMING_DOMAIN_V1_2.md` §9 (the Deterministic Rendering Contract) and `VARIANT_GENERATION_ENGINE.md` §2 (the render-time vs. publish-time reasoning). The rendering decision — view-time, never publish-time (would require Programming to fork content per athlete, contradicting the single-shared-Workout-per-Day model) and never fully re-resolved at log-time (would break Scoring Snapshot determinism) — is unchanged and is now stated as binding on **both clients identically**: the render function `render(workoutVersion, scalingContext, unitPreference, renderRuleSetVersion)` is the same function, invoked by both the Web App and the PWA, per Principle 7 (§3). Sex, unit preference, and training-level/preferred-variant selection are all already-modeled inputs (Member Domain preference data, Scaling Context); gym configuration is the Variant Generation Rule Set (`PROGRAMMING_DOMAIN_V1_2.md` §12); available-equipment and future injury-restriction inputs are named, not yet designed, extensions to the same `render()` input contract — additive, per Architecture Principle 9 from `PROGRAMMING_DOMAIN_V1_2.md` §Principles ("every canonical component must have a clear extension point"), not a redesign trigger.

---

## 9. Universal Scoring Engine

Fully specified in `RESULTS_DOMAIN_ARCHITECTURE.md` v1.0 §6.2 (seven composable primitives: Duration, Count, Load, Distance, Completion, Composite, Interval, Max Effort) and hardened in `RESULTS_DOMAIN_V1_1.md` §3 (Time Cap Declaration, Tie-Break Key as additive Score Model properties). Every score type in the mission's required list — Time, Rounds, Reps, Rounds+Reps, Weight, Distance, Calories, Max reps/load, Successful attempts, Multi-score, Interval, Split, Team, Relay — is a composition of these seven primitives, already confirmed against this exact list in the original investigation (§6.1–§6.4) and not re-derived here, with two named, still-open extensions: multi-score/multi-part aggregation depends on format composition (§5, unresolved), and Team/Relay scoring requires Result's Member reference to become many-to-many, explicitly named as undesigned in `RESULTS_DOMAIN_V1_1.md`'s own scope and in `RISK_REVIEW.md`'s Future Feature Risks. **Client-axis requirement:** the scoring engine's comparison/composition logic is Results-owned and invoked identically by both clients (§3 Principle 7) — neither client may implement its own scoring-comparison shortcut, a requirement already satisfied by construction since no scoring-comparison logic exists client-side in either audited codebase today (`UNIFIED_WORKOUT_BUILDER_PLAN.md`'s audit found none).

---

## 10. Log Score Architecture

The fast-path design (Score + Scaling Context only, Minimal Core, under-10-second target) is unchanged from the original investigation §8 and Results v1.0 §2.9's own governing principle. What this document adds, directly from `WORKOUT_BUILDER_SPEC_V2.md` §4.8/§5: **Draft/Published is a required v2 builder state that exists on neither client today** — both clients currently save workouts direct-to-live with no draft concept, confirmed by direct audit. This is stated here as a cross-cutting fact relevant to Log Score specifically because a Draft workout should not yet be loggable by athletes on either client — the absence of Draft/Published today means this constraint is currently enforced only implicitly (a Draft workout simply isn't visible because nothing distinguishes it from Published), a fragile state this document does not consider acceptable for a 12–24 month horizon and names as required convergence work (`WORKOUT_BUILDER_SPEC_V2.md` §4.8, §5.2's Mermaid state diagram). Split logging, offline logging, and edit history are unchanged from the original investigation (§8.5–§8.6) with one addition: offline logging's Scoring Snapshot determinism argument (a locally-cached WorkoutVersion resolves correctly on sync regardless of server-side edits in the interim) is a PWA-specific concern today, and this document requires the same guarantee hold if and when the Web App ever supports offline/degraded-connectivity logging — the guarantee is a property of the shared domain model (`RESULTS_DOMAIN_V1_1.md` §2's `workoutVersionRef`), not something either client's own offline implementation has to separately re-derive.

---

## 11. Rx Validation Engine

Fully specified in `RX_ENGINE_SPEC.md`: a structured `ValidationRecord` (never a boolean) produced by a deterministic, per-dimension decision matrix (movement, load, reps, equipment, order, time-cap behavior) comparing a Result Attempt against a WorkoutVersion's Scaling Profiles, with graceful "cannot classify" behavior on ambiguity rather than a false negative — the direct, generalized evolution of the already-shipped `rxEngine.js` (Results Phase 3, live in production on the PWA today, per this session's own project memory). **Client-axis requirement, stated explicitly here because it is the mission's own non-negotiable framing ("the athlete must never manually choose Rx"):** the Rx Engine is invoked identically by both clients, at write time, and its `classifiedTier` output — never a client-local computation, never a client-specific heuristic — is what both clients' leaderboard and log-confirmation UI read. `rxEngine.js` today exists only in the PWA's codebase; its generalized form (per `RX_ENGINE_SPEC.md`) must be ported to, or made callable identically from, the Web App as part of closing the client-parity gap this document requires (§14) — the Web App today has no Rx classification capability of its own to converge *away from*, which somewhat simplifies this specific convergence item relative to the Workout Builder's own two-sided capability transfer (§14.2).

---

## 12. Leaderboard Architecture

Fully specified in `RESULTS_DOMAIN_ARCHITECTURE.md` v1.0 §11 (computed at read time, never stored as competing authority) and `LEADERBOARD_RULES.md` in full (six categories — Rx, Intermediate, Beginner, OnRamp, Adaptive, Open; eligibility, duplicate prevention, tie resolution, version isolation, unit normalization, late/edited submissions, judge verification, competition mode with its one deliberate, disclosed freeze-semantics exception to the always-fresh rule). **The mission's own explicit requirement — "the same leaderboard rules must power both clients" — is already this architecture's design, not a new constraint requiring new work**: Results v1.0 §13's Cross-Interface Contract already states "no client computes any of these independently," and this document's Principle 7 (§3) simply names the PWA and Web App explicitly as the two clients that contract has always applied to, closing any ambiguity about whether "client" in that 2026-08-05 document meant "any future client" abstractly or these two specific, concrete ones. Competition mode, gym mode, and global mode map directly onto `LEADERBOARD_RULES.md` §1's category partitioning and Results v1.0 §16's deferred, opt-in cross-gym "World" leaderboard — unchanged from prior work.

---

## 13. Workout Versioning

Fully specified in `PROGRAMMING_DOMAIN_V1_2.md` §4, including its own full reconciliation of why WorkoutVersion (a formal, Programming-owned, immutable version entity) does not reopen Results v1.0 §5.1's earlier, narrower rejection of a Results-owned version history — that reasoning is not restated here in full; it is authoritative in `PROGRAMMING_DOMAIN_V1_2.md` §4.3 and this document defers to it entirely. The mission's specific question — "what happens when a coach edits a workout after athletes have already logged scores" — is answered identically regardless of which client the coach used to make the edit: a new WorkoutVersion is created, the old one remains permanently resolvable, existing Results' Scoring Snapshots remain fully valid and correctly interpretable, and the leaderboard partitions correctly across the version boundary per `LEADERBOARD_RULES.md` §4's version-isolation rule. This is the one place in this entire document where "which client did the edit" is provably, architecturally irrelevant to the outcome — offered here as a concrete illustration of what Principle 7 (§3) means in practice, not merely an abstract commitment.

---

## 14. Cross-Platform (Web + PWA) Architecture

This section is the direct architectural response to §1.1's central client-axis finding and is the one section in this document not fully answerable by citing a single prior document — it synthesizes `WORKOUT_BUILDER_SPEC_V2.md` §6–§7 (which covers the builder specifically) and extends the same reasoning to the full lifecycle this mission's mandatory capability list requires.

### 14.1 Confirmed current state (audited, not assumed)

Per `UNIFIED_WORKOUT_BUILDER_PLAN.md`'s direct, line-cited audit of both codebases: both clients already write to the same `wods` table, enforce the identical validation rule, and declare the identical 22-format catalog — they are not architecturally estranged, they are two independently-maintained forks of one original port that have since diverged in **workout authoring** specifically. Neither client's audit found any Rx-classification, leaderboard-ranking, or scoring-comparison logic implemented client-side — the domains that most directly demand "one engine, two clients" (§9, §11, §12) are, encouragingly, already client-agnostic in practice, simply because neither client has yet built its own competing implementation of them. The confirmed drift is scoped narrowly to the **authoring surface**: movement autocomplete and AI paste-to-draft exist only on the PWA; Duplicate/clone, an accessible modal pattern, and an unsaved-changes guard exist only on the Web App; the PWA's own movement-reordering interaction is confirmed broken for mouse input on desktop.

### 14.2 Capability-by-capability specification

| Capability | Web App | PWA | Shared Domain |
|---|---|---|---|
| **Workout creation** | Primary authoring surface (coach-oriented desktop UX); hosts the Duplicate/clone dialog, the accessible modal chrome, the unsaved-changes guard — all already-superior Web capabilities per §14.1, retained and extended to the PWA (`WORKOUT_BUILDER_SPEC_V2.md` §8 Phase 2) | Secondary but fully capable authoring surface; hosts movement autocomplete and AI paste-to-draft — already-superior PWA capabilities, ported to Web (same phase) | Format catalog, section-editing/validation logic, serialization (`legacyPayloadFromSections`), movement catalog + resolution, AI-draft mapping, duplicate/clone logic — all per `WORKOUT_BUILDER_SPEC_V2.md` §7.1 |
| **Workout editing** | Full parity with creation | Full parity with creation | Same shared logic as creation |
| **Workout publishing** | Primary (coach workflow) | Capable but secondary | Draft/Published state model (`WORKOUT_BUILDER_SPEC_V2.md` §5.2) — not yet built on either client; when built, identical state machine on both |
| **Adaptive rendering** | Full support (a coach previewing an athlete's view, or an admin auditing content) | Primary (athlete's own daily view) | `render()` function (§8), Programming-owned, identical inputs/output contract on both clients |
| **Log Score** | Supported (a coach logging on an athlete's behalf, or walk-in logging) | Primary (athlete self-logging, the under-10-second fast path) | Result/Scoring Snapshot creation, Rx Engine invocation (§11), identical validation on both |
| **Leaderboard** | Full support (gym-wide, coach/owner-facing views, competition-mode administration) | Primary (athlete-facing, day-to-day) | `LEADERBOARD_RULES.md` in full — one computation, both clients render it |
| **PR tracking** | Full support (coach/owner reviewing athlete progress) | Primary (athlete's own history) | PR derivation + PR Event ledger (Results v1.0 §8), identical on both |
| **Analytics** | Primary (coach/owner-facing aggregate views, Dashboard-adjacent) | Athlete-facing personal analytics only | AnalyticsEvent stream + aggregation functions (`RESULTS_DOMAIN_V1_1.md` §6.2), one stream, two presentation layers |
| **Notifications** | Web-native notification patterns (in-app, email where applicable) | Push notifications (PWA-native capability the Web App does not have) | Notification *triggering* logic (what event causes a notification) is shared; notification *delivery mechanism* is platform-specific by necessity, not by architectural choice |
| **Offline behavior** | Not currently a requirement (desktop, assumed-connected usage pattern) | Required (mobile, gym-floor connectivity is unreliable) | The determinism guarantees (§8, §13) that make offline-then-sync safe are shared and domain-owned; the offline storage/queueing mechanism itself is platform-specific (`WORKOUT_BUILDER_SPEC_V2.md` §7.2) |
| **Realtime updates** | Supported (live leaderboard/attendance views already shipped elsewhere on this platform) | Supported (already-proven Live Sync capability this platform has used for Members/Subscriptions/Plans, per Results v1.0 §11.5's own citation) | The realtime subscription *contract* (which tables/channels matter) is shared; each client's own subscription wiring is platform-specific |

### 14.3 What belongs in shared domain logic, restated as a hard boundary

Format catalog; section-editing and structural validation; workout/result serialization; movement catalog and resolution; the Variant Generation Engine; the Deterministic Rendering Contract's `render()` function; the Universal Scoring Engine's comparison/composition rules; the Rx Engine's decision matrix; the Leaderboard's eligibility/ranking/tie-break rules; PR derivation and the PR Event ledger; AnalyticsEvent emission and aggregation. None of these may have a second, client-specific implementation, on pain of directly violating Principle 7 (§3) — and, per §14.1, none of them currently do, which this document treats as a real strength to protect going forward, not a coincidence to take for granted.

### 14.4 What belongs in web-specific presentation

Desktop-oriented information density (multi-column layouts, hover states, keyboard shortcuts beyond the shared Enter-to-commit baseline); React Router-based navigation; the `Dialog.tsx` accessible-modal chrome (already the stronger pattern, per §14.1, and the one being ported *to* the PWA, not from it); coach/owner-oriented bulk/administrative views (gym-wide analytics, competition-mode administration) that have no natural athlete-facing PWA equivalent.

### 14.5 What belongs in PWA-specific presentation

Mobile-first, single-column, touch-target-sized layouts; screen-state-based navigation; touch-gesture interactions (movement-list drag-reordering, once fixed per §14.1's disclosed bug); push notification delivery; offline-first data caching and the service-worker-backed install/update model (this platform's own already-documented `app_version` near-instant-refresh mechanism); the athlete-facing fast-path Log Score UI's specific visual treatment.

### 14.6 The convergence sequencing this section depends on

Not re-derived here — `WORKOUT_BUILDER_SPEC_V2.md` §8's four-phase plan (fix the confirmed PWA bug and unify messaging; bidirectional capability transfer; visual/interaction/accessibility parity; shared-core extraction) is adopted as this document's own binding answer to "how do we get from §14.1's current, partially-drifted state to §14.2's target state," and its own acceptance criteria (`WORKOUT_BUILDER_SPEC_V2.md` §11) are adopted as this document's own definition of "one product, two clients" being achieved in practice, not merely stated as a principle.

---

## 15. Integration Boundaries

Unchanged from the original investigation and from `RESULTS_DOMAIN_ARCHITECTURE.md` v1.0 §3: Results sits between Programming and Membership (frozen, supplying context) and Classes/Attendance (frozen, deliberately untouched structurally, with Day-level correlation as the only sanctioned analytics-layer join, Results v1.0 §12.2). `PROGRAMMING_DOMAIN_V1_2.md` §10's Integration Contract (what Programming provides to Results: `workout_version_id`, prescribed loads, rendered variant, score type, validation-rule data; what Results is prohibited from doing: writing to any Programming-owned entity, maintaining a shadow copy of Programming content beyond its own narrow interpretation-critical Scoring Snapshot fields, deciding or overriding Movement/Load/Scaling truth) is adopted unmodified. The one addition this document makes: every boundary named above is a boundary between **domains**, enforced identically regardless of which **client** is on the other end of the request — a Web App request and a PWA request hitting the Results→Programming boundary are subject to the identical read-only, permanent-identity-reference contract, with no client-specific exception carved out anywhere in this architecture.

---

## 16. Data Model Investigation

Fully specified in `ERD.md`: Workout, WorkoutVersion, Section, MovementLibraryEntry, LoadProfile, ScalingProfile, VariantGenerationRuleSet (Programming-owned); Result, ResultAttempt, ScoringSnapshot, Benchmark, PersonalRecord, PREvent, ValidationRecord, AnalyticsEvent (Results-owned); RenderedVariant and LeaderboardEntry explicitly modeled as **derived, cache-eligible views, never true persisted authorities** — preserving Results v1.0 §11.1's leaderboard-integrity principle even while satisfying this mission's own explicit request to see them as entities. This document adds no new entity to that list; every entity this document's own required examples name (WorkoutSchema, WorkoutVariant, WorkoutSection, WorkoutMovement, ScoreSchema, WorkoutAttempt, AttemptModification, Score, Split, PerformanceMetric, PerformanceSnapshot) maps directly onto an already-named entity in `ERD.md` or an already-disclosed, not-yet-designed extension point (Team/Relay's many-to-many Member reference, §9; format composition's own internal structure, §5) — restated here as a mapping table for this document's own completeness:

| Mission's example entity | Maps to |
|---|---|
| WorkoutSchema | Workout + WorkoutVersion (`ERD.md` §3) |
| WorkoutVariant | ScalingProfile |
| WorkoutSection | Section |
| WorkoutMovement | MovementLibraryEntry (reference) + Section's own Movement-reference-within-Section |
| ScoreSchema | Score Model (Results v1.0 §6.1) |
| WorkoutAttempt | ResultAttempt |
| AttemptModification | Not yet a named entity — see `RESULTS_DOMAIN_V1_1.md` §8.6's audit-trail recommendation, disclosed as additive, not yet built |
| Score | Result's own Score value, interpreted via ScoringSnapshot |
| Split | ResultAttempt, used at split-logging granularity |
| PerformanceMetric / PerformanceSnapshot | AnalyticsEvent-derived aggregation output — explicitly a derived view, never its own persisted authority |

---

## 17. Event Flows

Fully specified in `SEQUENCE_DIAGRAMS.md` (nine Mermaid diagrams: coach creates workout, workout published, member requests workout, workout rendered, member submits score, score validated, leaderboard updated, analytics generated, workout edited after scores exist). This document adds the explicit client annotation those diagrams did not previously carry, per the mission's own requirement to "include both Web and PWA flows":

**Coach Flow** (Create → Analyze → Generate Schema → Generate Variants → Publish → Members Receive Adaptive Workout): primary path is Web App (per §14.2's "primary authoring surface" designation), fully executable on the PWA as well with no missing shared-domain capability — the *only* difference is which client's UI chrome the coach is looking at, never a different sequence of domain events.

**Athlete Flow** (Open Workout → Adaptive Rendering → Log Score → Validation → Classification → Leaderboard → Analytics): primary path is PWA (per §14.2's "primary" designation for daily athlete use), fully executable on the Web App with no missing shared-domain capability, for the walk-in-logging and coach-assisted-logging scenarios §14.2 names.

Both flows invoke the identical `render()`, Rx Engine, and Leaderboard computations regardless of client, per §14.3's hard boundary — the sequence diagrams in `SEQUENCE_DIAGRAMS.md` are, by design, already client-agnostic at the level that matters (which engine is called, in which order), and this document's contribution is confirming that agnosticism is intentional, not an oversight in how those diagrams were originally drawn.

---

## 18. Scalability

Fully specified in `RISK_REVIEW.md` §2 (Scaling Risks) and the original investigation's §15: competition-mode leaderboard burst-write patterns as the concrete, named trigger condition for Results v1.0 §16's deferred materialized-leaderboard cache (never pre-built speculatively); content-addressed RenderedVariant caching with LRU-style eviction; AnalyticsEvent's append-only growth requiring an eventual windowed/incremental aggregation strategy at genuine 5-year, thousands-of-gyms scale. The client-axis addition: **two clients querying the same shared engines does not, by itself, double load in any architecturally interesting way** — both clients hit the identical read paths (§14.3), so scaling analysis is client-count-agnostic at the domain layer; what *does* scale with client count is realtime-subscription connection count and offline-sync reconciliation volume (PWA-specific, §14.2's Offline behavior row), both already-bounded, already-understood problem classes on this platform (Live Sync, already proven across Members/Subscriptions/Plans) rather than new scaling unknowns this document needs to flag.

---

## 19. Migration Strategy

Strategy only, no execution plan, per this document's own analysis-only mandate. Sequencing, synthesized from `PROGRAMMING_DOMAIN_V1_2.md` §12, `RESULTS_DOMAIN_ARCHITECTURE.md` v1.0 §14.5, and `WORKOUT_BUILDER_SPEC_V2.md` §8, in dependency order:

1. **FCKB's required revisions** (`FCKB_ARCHITECTURE_REVIEW.md` §16) — the movement/format data foundation the Movement Identity Model (§6) and the generalized Rx Engine's movement-dimension comparison (§11) both depend on. No client-axis dependency; proceeds independently of §14's convergence work.
2. **Results v1.0/v1.1's own migration** (unify the two current logging tables into Result/ResultAttempt, backfill Scaling Context and canonical units, correct the Workout-reference cascade-delete defect) — Results-domain work, client-agnostic by construction since neither client currently implements Results-domain logic client-side (§14.1).
3. **Workout Builder convergence, Phases 1–4** (`WORKOUT_BUILDER_SPEC_V2.md` §8) — the client-axis work this document's own §14 depends on; can proceed in parallel with steps 1–2, since it touches the authoring surface, not the scoring/leaderboard/analytics surfaces those steps harden.
4. **Variant Generation Engine build-out** — sequenced after step 1 (FCKB) to avoid generating unreliable substitutions against an under-resolved Movement Library (`SCORING_DOMAIN_ARCHITECTURE_INVESTIGATION.md`'s original §16.3 risk, still valid, not re-litigated), and after step 3's `VariantPanel` component exists on both clients as the shared review surface.
5. **Rx Engine generalization** — sequenced after step 1 (FCKB) and after Results' shared Score-validation engine (step 2) exist, and ported to/made callable from the Web App as part of closing §14's parity gap (§11's own explicit note that the Web App has no existing Rx logic to migrate away from, only to gain).
6. **Format composition/nesting** (§5) — the standing, still-undesigned prerequisite for any competition-tier work, tracked as its own future architecture exercise, not scheduled within this 12–24 month horizon by this document.

---

## 20. V1 / V2 / V3 Roadmap

| Tier | Scope |
|---|---|
| **V1** | Results v1.0/v1.1 core build-out (Result/ResultAttempt/ScoringSnapshot, PR derivation, basic Leaderboard, AnalyticsEvent substrate); FCKB required revisions; Workout Builder Convergence Phases 1–2 (bug fixes, messaging unification, bidirectional capability transfer — movement autocomplete + AI-paste to Web, Duplicate/clone + accessible modal + unsaved-changes guard to PWA); Rx Engine ported to/made callable from both clients at its **current** (Load-dimension-only) capability level. |
| **V2** | Variant Generation Engine (rule-based, gym-configurable Rule Sets); Rx Engine generalized to full multi-dimension, four-tier classification (§11); Workout Builder Convergence Phases 3–4 (visual/interaction/accessibility parity, shared-core extraction); WorkoutVersion and Draft/Published state built and wired into both clients' Publish workflow (§10); split-logging-dependent analytics (pace curves, round/transition times, movement bottlenecks — `SCORING_DOMAIN_ARCHITECTURE_INVESTIGATION.md`'s original §11.2 prioritization, unchanged). |
| **V3** | Format composition/nesting and its dependent competition-tier capabilities (multi-part Quarterfinal/Games scoring, HYROX-style named-protocol support); Team/Relay Results (requiring Result's Member reference to become many-to-many, still undesigned); AI scaling suggestions (as opposed to rule-based generation) via the same `VariantPanel` seam; a materialized Leaderboard/PR cache, if and only if real competition-mode read-latency at scale demands it (never pre-built speculatively); estimated-aerobic-capacity analytics (genuinely research-dependent, not just engineering). |

---

## 21. Open Questions

Consolidated from every prior document in this stream, deduplicated, none newly resolved here:

1. **Format composition/nesting** — the single largest standing architectural gap this entire body of work depends on, named repeatedly (§5, §9, §19) and resolved nowhere.
2. **Whether "exactly one primary, scored Section" per Workout should change** — still open from Programming v1.1's own DEFER list.
3. **Team/Relay Results' many-to-many Member reference** — named, not designed, in `RESULTS_DOMAIN_V1_1.md` and `RISK_REVIEW.md`.
4. **WorkoutVersion edit-granularity** — whether a purely descriptive, athlete-invisible edit (a Coach Note correction) should create a new WorkoutVersion, or only edits with actual interpretation/rendering consequence should (`PROGRAMMING_DOMAIN_V1_2.md` §13 item 1).
5. **Variant Generation Rule Set configurability** — full gym-configurability vs. a curated platform preset set at V1 (`PROGRAMMING_DOMAIN_V1_2.md` §13 item 4).
6. **Whether Movement resolution confidence scoring should ever block Publish outright** (`PROGRAMMING_DOMAIN_V1_2.md` §13 item 5).
7. **Competition-mode leaderboard freeze semantics** — the one deliberate, disclosed exception to "leaderboard always computed fresh" (`LEADERBOARD_RULES.md` §9), and whether that exception's scope is correctly drawn.
8. **The AI-determinism boundary** — any future move to ML/LLM-based (rather than rule-based) variant generation requires its own architecture review to preserve or explicitly relax the determinism guarantee this document's §7–§8 depend on (`RISK_REVIEW.md`'s AI Integration Risks).
9. **Recovery/wellness data's eventual domain home** — explicitly out of Results' scope, not yet assigned anywhere.
10. **Whether the shared-domain/two-client discipline this document requires (§3 Principle 7–8) should eventually be enforced by real cross-repo package infrastructure** (an npm workspace, a private registry, or monorepo consolidation) **rather than the disciplined-port pattern both clients currently use** — named as a genuine future option in `UNIFIED_WORKOUT_BUILDER_PLAN.md` §3.2 step 9/§7 M8, not a precondition for anything in this document, and not resolved here.

---

## 22. Final Recommendation

Reviewed as a Principal Architect would review a request to re-justify a conclusion already reached, now under a new and more demanding constraint:

**The verdict stands, and the new constraint strengthens rather than weakens it.** "One domain model, one source of truth, two client experiences" is not a reason to reconsider whether a third Scoring Domain is needed — it is, if anything, the single strongest argument *against* one: a third domain would be a third place two clients would each need to independently integrate with correctly, doubling the exact convergence risk this document's own audit (§14.1) already found real, live evidence of at the authoring-surface layer. The correct architecture keeps exactly two domains (Programming, Results), each already specified to the depth `PROGRAMMING_DOMAIN_V1_2.md` and `RESULTS_DOMAIN_V1_1.md` provide, each exposing exactly one set of shared engines (§3 Principle 7) that both clients invoke identically — and this document's own direct contribution, beyond confirming that shape still holds, is naming and scoping the one place this platform is *not yet* living up to that shape (the authoring surface, §14) and adopting an already-written, already-sequenced plan (`WORKOUT_BUILDER_SPEC_V2.md`) to close it.

Twelve to twenty-four months of work is implied by this document's own §19–§20, and none of it requires reconsidering the domain boundary this stream of investigations has now confirmed three separate times, from three different angles (the original domain investigation, the review-package hardening, and this document's own client-axis audit): Programming owns authored intent, Results owns logged fact, and — new, binding, and now verified against real code rather than assumed — both clients are equal, symmetric consumers of both, with zero authority to diverge from either.

SCORING DOMAIN ARCHITECTURE INVESTIGATION COMPLETE
