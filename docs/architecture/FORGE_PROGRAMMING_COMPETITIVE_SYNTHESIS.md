# Forge Programming — Competitive Synthesis

**Status:** Approved (Frozen)
**Version:** 1.0
**Companion to:** `PROGRAMMING_DOMAIN_ARCHITECTURE.md` v1.1 (Approved / Frozen)

This document validates and strengthens the already-frozen Programming Domain Architecture against deep, evidence-based research into eight production platforms and one coaching methodology. It does not redesign that architecture. Where this research confirms a decision already made, that is recorded as confirmation. Where it surfaces a genuine refinement or a well-evidenced future direction, that is recorded as such — never as a reopening of a frozen decision.

---

## 1. Executive Summary

Forge's Programming Domain was architected first, from product-architecture principles, and frozen as `PROGRAMMING_DOMAIN_ARCHITECTURE.md` v1.1. This document asks a harder question of that architecture after the fact: does it hold up against how the best production systems in this exact category actually behave, at scale, in the real world? Eight platforms were studied in depth — Beyond the Whiteboard, SugarWOD, PushPress Train, Wodify, Kilo, TrainHeroic, TeamBuildr, and CrossFit's own Affiliate Programming (CAP) methodology — covering programming philosophy, coach workflow, workout modeling, editing paradigms, AI integration, calendar mechanics, scaling, coach/athlete notes, media, multi-program support, content versioning, and results coupling. Every one of Forge's core architectural decisions survives this scrutiny. Several are now demonstrably stronger than any single competitor's equivalent, not merely equal to it. One decision — Programming's deliberate independence from Results — diverges from near-universal industry practice, and is retained anyway, for reasons this document states plainly rather than hides.

## 2. Methodology

Research was conducted independently per platform, grounded in each platform's own public documentation: official help centers, product pages, blog posts, app-store listings, and credible third-party reviews. No authenticated access to any competitor's live product was used or required. Every finding cited below traces to a specific, named source examined during that research; where public documentation was silent on a question, that silence is treated as an absence of evidence, not as a fact in either direction. CrossFit's own Affiliate Programming (CAP) was studied exclusively as a coaching methodology — how elite coaches structure a class, separate their own reasoning from what they tell an athlete, and think about scaling — never as software, and never compared against software conclusions.

## 3. Common Industry Patterns

Findings that held across the overwhelming majority of platforms studied, and are treated here as close to industry truths:

1. **Date is the universal organizing spine.** Every platform studied — without exception — organizes programming content by date first.
2. **A parallel-program mechanism exists in six of eight platforms.** Beyond the Whiteboard's Track, SugarWOD's Track, PushPress's Program types, Wodify's Program, TrainHeroic's Team, and TeamBuildr's nested Team hierarchy all give a coach a way to run more than one population's content in parallel.
3. **Coach-only content is a first-class, access-controlled concept, not a convention**, in six of seven software platforms — and CAP's own coaching methodology arrives at the identical split independently, from pure pedagogical reasoning (a coach's internal, multi-causal diagnosis versus the single, deliberately compressed cue actually spoken to an athlete). This is the strongest convergence found in the entire study.
4. **Structured scoring, never free text, is universal.** Every platform enumerates a closed, typed scoring taxonomy.
5. **Duplication, not templating from a blank canvas, is the primary authoring-speed mechanism** across every platform studied.
6. **Movement/exercise is a governed reference object**, with demonstration video attached to the movement itself so every future use inherits it for free.
7. **AI is absent from the core authoring workflow in the overwhelming majority.** Five of seven software platforms document zero AI involvement in programming specifically; every AI feature they do have is scoped to business operations, marketing, or churn prediction.
8. **Programming is tightly, often structurally, coupled to Results** across affiliate-style platforms. This is the one pattern Forge deliberately does not follow — addressed in full in Section 10.

## 4. Divergent Patterns

Findings where the industry itself has no single answer:

1. **Scaling** is modeled at least three genuinely different ways: pre-authored structured content per ability level; a log-time Rx/Scaled flag chosen against a single prescription; and percentage-of-tested-max auto-calculation.
2. **Content lifecycle after publish has no consensus.** Five distinct models were found: full immutability with fork-only reuse; copy-on-assign with the original never propagating; copy-on-assign with a read-only lock once delivered; fully in-place mutation with an automatic annotation on affected results; and live propagation to every not-yet-completed occurrence only.
3. **The editing paradigm splits evenly** between structured block/drag-and-drop editors and free-text descriptions wrapped in structured metadata.
4. **Multi-program structure shape diverges sharply** — flat parallel lists versus a three-level nested inheritance hierarchy versus a flat team-plus-individual-override model.
5. **Publishing has no shared model** — global default with per-item override, versus assignment-is-publication with no separate draft concept at all, versus a visibility-window preference layered over an already-committed save.

## 5. Hidden Tradeoffs

- **Pre-authored Scaling Variants** optimize consistent, coach-communicated intent per level and work without a coach improvising live, at the cost of authoring time and levels drifting out of sync.
- **Log-time Rx/Scaled flags** optimize authoring speed and one clean leaderboard number-line, at the cost of shifting all ahead-of-time scaling guidance onto live, in-the-moment coaching.
- **Full immutability** optimizes historical integrity, at the cost of real coach correction friction.
- **In-place mutation with only a results-side annotation** optimizes correction speed, at the cost of the athlete having no independent record of what they actually saw.
- **Nested multi-level program inheritance** optimizes expressing large, multi-population organizations, at the cost of real reasoning complexity about who sees what.
- **Tight Results coupling** optimizes the retention loop every affiliate-style platform names explicitly as its business rationale, at the cost of architectural entanglement — in the most extreme case found, a workout structurally fails to display without scoreable content, meaning Results stops being a downstream consumer and becomes a hard dependency.
- **Movement Library governance** — a fully closed vocabulary optimizes cross-gym analytics comparability at the cost of gym expressiveness (a documented real complaint); a fully open, ungoverned vocabulary optimizes zero friction at the cost of zero analytics value.

## 6. Comparative Analysis

Synthesizing Sections 3–5 against Forge's own frozen architecture: every principle in `PROGRAMMING_DOMAIN_ARCHITECTURE.md` v1.1 independently converges with the majority industry pattern it corresponds to — Calendar First, structured-where-it-counts, Coach/Athlete Notes separation, governed Movement Library, Coach First AI-Assisted authoring. None of these were adopted because a competitor has them; the research confirms they are what a coach-facing daily-authoring product converges on when built honestly, which is a materially stronger form of validation than simple imitation would be. The one place Forge's architecture does not follow the majority pattern — Results coupling — is treated with the seriousness that divergence deserves, in Section 10.

## 7. Forge Synthesis

- **Philosophy, Workflow, Editing Model, Calendar Model** — confirmed as frozen. No platform studied assigns different programming content to different class time-slots on the same day within the same program, which strengthens rather than changes the existing rejection of per-class-instance content.
- **Information Architecture / Track** — Track remains outside the active model; the mechanical blocker (Classes has no field to route a class to one of several parallel programs, and Programming cannot add that field to a frozen domain unilaterally) is unaffected by how common Track is elsewhere. What changes is priority: six of eight platforms studied have some parallel-program mechanism, which means the cross-domain resolution work Track depends on should be scoped early once Programming ships, not treated as indefinitely postponed.
- **Publishing Model** — confirmed: a gym-level default publish schedule with per-item override is the clear majority pattern among affiliate-style platforms, and Forge's Draft-to-Published lifecycle sits squarely inside that norm.
- **Scaling Model** — confirmed, deliberately unchanged despite a real, sophisticated alternative existing elsewhere in the industry. Forge's pre-authored Scaling Variant model is live, proven production behavior; discarding it for an unproven alternative because other platforms chose differently would be optimizing for novelty, not evidence.
- **Notes Model** — the single strongest confirmation in this entire study: Coach Notes versus Athlete Notes as a first-class, permanent split is present in six of seven software platforms and independently in CrossFit's own coaching methodology.
- **Media Model** — confirmed: at least one platform studied explicitly documents an inability to attach files or PDFs at all as a real, named limitation of a link-only approach, reinforcing that Media deserves to be a first-class structured concept rather than a link smuggled into a text field.
- **AI Model** — confirmed and strengthened: the large majority of platforms studied have no AI in programming at all; only one has a shipped equivalent to Forge's own AI-assisted authoring, and Forge's implementation is at least as concrete. Forge is not behind the industry here — it is tied for the most concrete implementation found.
- **Versioning Policy** — the clearest example of genuine synthesis in this study. Five real competitor models exist, each buying one property at a documented cost to another. Forge's content-stability contract — corrections are always allowed, but never silent — takes the correction speed the best competitors optimize for without inheriting either's specific cost, and takes the integrity the strictest competitors optimize for without their forced-forking cost. No competitor studied states this as an explicit, general contract; each backed into one tradeoff as an implementation consequence of a narrower decision.

## 8. Decision Matrix

### 8.1 Calendar-first vs. Program-first

- **Alternative A:** Date is the primary organizing axis; Program/Track is a secondary, optional dimension layered on top.
- **Alternative B:** Program/Track is the primary container; Date is nested inside a chosen program.
- **Industry evidence:** Every platform studied anchors its atomic authored unit to a date. Several platforms (Beyond the Whiteboard, TeamBuildr) present Track/Team as the entry point for *browsing*, but the underlying unit being browsed is still date-anchored.
- **Tradeoff:** Program-first suits multi-population gyms navigating "my track's calendar" first; Calendar-first suits the more common case — "what's today" as the primary question, with population handled as an optional filter.
- **Forge decision:** Calendar-first. Day, within one Gym, is the spine.
- **Architectural rationale:** Matches both CAP's own coaching methodology (a week/cycle is sequenced by day) and Forge's own live, single-program production reality. Program-first would require Track to be live before Programming could exist meaningfully — directly contradicting the already-frozen decision that Track is deferred pending cross-domain resolution work Programming cannot do alone.

### 8.2 Structured blocks vs. free-text authoring

- **Alternative A:** A block-based editor where the atomic unit of editing is a movement/component field, assembled by drag-and-drop.
- **Alternative B:** A free-text description wrapped in structured metadata (score type, movement tags).
- **Industry evidence:** Split evenly among platforms with a clear classification — no consensus either way.
- **Tradeoff:** Blocks optimize machine-readable precision at the cost of authoring friction; free-text-wrapped optimizes authoring speed and expressiveness at the cost of requiring separate structured fields to carry anything that must be counted.
- **Forge decision:** Hybrid — structured where content must be counted (Movements, Scoring, Scaling), free text where it must be expressive (description, Notes).
- **Architectural rationale:** The absence of industry consensus is itself the signal that this is correctly an implementation-level choice, not an architectural one. Forge's existing native section-editor model already proves the hybrid works in live production.

### 8.3 Pre-authored scaling variants vs. log-time scaling flags

- **Alternative A:** A coach authors distinct content per ability level ahead of time.
- **Alternative B:** A single prescription is authored; an athlete selects Rx/Scaled/Modified when logging a result.
- **Industry evidence:** Both models are used by sophisticated, results-analytics-heavy platforms.
- **Tradeoff:** Pre-authored optimizes consistent, coach-communicated intent per level at the cost of authoring time; log-time optimizes speed and leaderboard simplicity at the cost of leaving all ahead-of-time scaling guidance to live coaching.
- **Forge decision:** Pre-authored Scaling Variants, unchanged.
- **Architectural rationale:** This is live, proven, real production behavior today, not a hypothesis being evaluated fresh. Replacing proven behavior with an unproven alternative for no evidenced Forge-specific reason is precisely the standard this research was conducted to avoid.

### 8.4 Immutable publishing vs. editable publishing

- **Alternative A:** Published content can never be edited in place; only forking (Clone/Create Variant) produces new content.
- **Alternative B:** Published content can be edited in place, with some form of trace left behind.
- **Industry evidence:** Five distinct models were found across the platforms studied, spanning the full spectrum from full immutability to unconstrained live propagation.
- **Tradeoff:** Immutability optimizes integrity at the cost of correction friction; unconstrained editability optimizes correction speed at the cost of either silent mutation or an ambiguous exposure window for athletes who already saw the content.
- **Forge decision:** Editable, but never silent — a content-stability contract where corrections are always allowed and every edit produces a detectable revision.
- **Architectural rationale:** A genuine synthesis, not a selection from the menu — it takes the correction speed the most flexible competitors optimize for without their specific cost, and the integrity the strictest competitors optimize for without forcing a fork for a one-word fix.

### 8.5 Shared Programming Domain vs. per-interface duplication

- **Alternative A:** One Programming Domain — tables, RPCs, and business logic — shared by every Forge client.
- **Alternative B:** Each client (PWA, Admin Web, future Admin Mobile) maintains its own local Programming logic.
- **Industry evidence:** Not a competitor-comparison question — no single-vendor competitor faces this problem the way a multi-client platform does. The relevant evidence is Forge's own record: Classes and Attendance were both built once and reused, with zero duplicated tables or RPCs across two independent frontends.
- **Tradeoff:** Duplication moves faster per-interface in the short term but silently diverges over time — the exact failure mode Forge's own cross-client consistency discipline exists to prevent. A shared domain costs more upfront coordination.
- **Forge decision:** Single shared Programming Domain.
- **Architectural rationale:** Directly mandated by Forge's own platform engineering standard and already proven twice over in this exact platform. No new reasoning required — only consistent application.

### 8.6 Results coupling vs. Results decoupling

- **Alternative A:** Programming and Results are one effectively-inseparable domain.
- **Alternative B:** Programming excludes Results entirely; a Workout is a stable, identifiable thing a future Results domain can attach to, nothing more.
- **Industry evidence:** The overwhelming majority of affiliate-style platforms studied couple these tightly — in the most extreme case, a workout fails to display correctly without scoreable content, meaning Results is a hard dependency, not a downstream consumer.
- **Tradeoff:** Coupling optimizes the retention/engagement loop every one of those platforms names explicitly as its business rationale, at the cost of architectural entanglement. Decoupling optimizes long-term domain independence at the cost of not having that engagement loop built into Programming from day one.
- **Forge decision:** Decoupled. Programming excludes Results.
- **Architectural rationale:** See Section 10 in full — this is the one deliberate divergence from majority industry practice in this entire document, and it is argued there on its own terms rather than asserted here.

### 8.7 Track now vs. Track deferred

- **Alternative A:** Build a parallel-program (Track) concept as part of Programming's initial scope.
- **Alternative B:** Defer Track until a cross-domain resolution mechanism with Classes exists.
- **Industry evidence:** Six of eight platforms studied have some parallel-program mechanism — a near-universal capability, not a hypothetical one.
- **Tradeoff:** Building Track now matches the industry norm immediately, but requires either modifying the frozen Classes domain (not permitted) or inventing an ungrounded stand-in. Deferring ships Programming on solid ground sooner, at the cost of lagging a near-universal capability until the cross-domain work is scoped.
- **Forge decision:** Track deferred by architectural boundary.
- **Architectural rationale:** This is a hard mechanical blocker, not a preference — Classes has no field to route a class to a specific program, and Programming cannot add one unilaterally. The strength of the industry evidence changes the *priority* of the follow-on cross-domain work, not the deferral itself.

### 8.8 Media assets vs. URL-based media

- **Alternative A:** Media is natively uploaded and hosted by the platform.
- **Alternative B:** Media is a link to externally-hosted content (YouTube, Vimeo).
- **Industry evidence:** Split — some platforms natively host and support broader file types (including PDF export); at least one platform studied explicitly documents that it does *not* support file or PDF attachment at all, as a real, named limitation of a link-only design.
- **Tradeoff:** Native hosting is richer and has no external-host dependency, at the cost of storage/infrastructure. Link-based has zero infrastructure cost, at the cost of breaking if the external host changes the content, and structurally cannot cover non-video file types.
- **Forge decision:** Media is a first-class structured concept attached to what it illustrates; the specific hosting mechanism is correctly left as an implementation decision.
- **Architectural rationale:** What is architecturally non-negotiable is that Media must never be smuggled into a text field — already decided. Which hosting mechanism backs it is a "how," not a "whether," and does not belong at the architecture level.

### 8.9 AI-assisted authoring vs. manual-first authoring

- **Alternative A:** AI is the primary path to producing a Workout.
- **Alternative B:** Manual authoring is primary; AI is an optional accelerant that drafts into the same editable state a coach would produce by hand.
- **Industry evidence:** The large majority of platforms studied have no AI in programming at all; the one platform with a shipped, comparable feature uses it exactly as an optional, reviewable drafting aid — never as the primary path.
- **Tradeoff:** AI-first optimizes theoretical authoring speed with zero evidenced industry validation, and risks reducing the coach to a reviewer of machine output. Manual-first with AI-assist optimizes trust and accountability at a marginal speed cost for coaches who skip the AI shortcut.
- **Forge decision:** Manual-first, AI-assisted — Coach First, AI-Assisted.
- **Architectural rationale:** Matches Forge's own real, working AI parser exactly (output lands in the same editable state as manual entry; provenance is never persisted), and is now confirmed as the industry's own de facto choice, not merely Forge's preference.

### 8.10 Single-domain architecture vs. multi-domain Programming

- **Alternative A:** Programming as one domain covering authoring, delivery, and eventually results/community together.
- **Alternative B:** Programming as a narrow, single-responsibility domain, with Results, Engagement, and class-delivery planning left as separate, future domains.
- **Industry evidence:** Every affiliate-style competitor studied effectively bundles Programming with Results and community as one domain, in some cases (Section 8.6) as a hard structural dependency. Forge's own platform has already drawn narrow domain lines successfully across Members, Financial, Classes, and Attendance, each scoped narrowly and finished before the next began.
- **Tradeoff:** A single bundled domain reaches competitive feature parity faster; a narrow, multi-domain approach is slower to reach that same visible feature set, but each domain remains independently correct, testable, and extensible without one domain's constraints leaking into another.
- **Forge decision:** Multi-domain. Programming stays narrow; Results and Engagement are explicit, separate, future domains.
- **Architectural rationale:** Consistent, proven platform-engineering discipline already established across every other Forge domain. This is Forge's own architectural identity, not a industry-following choice — and the clearest instance in this matrix of Forge choosing not to converge with the majority.

## 9. 10 Non-Negotiable Principles

These are permanent architectural constraints, enforceable by any future engineering team, not implementation preferences subject to taste.

1. **Single Programming Domain.** Forge PWA, Forge Admin Web, and any future Forge client are interfaces over one shared Programming Domain. No client may own its own copy of Programming's tables, RPCs, or business logic.
2. **Calendar-first information architecture.** Day, within one Gym, is the fundamental organizing spine of Programming. Per-class-instance content assignment is rejected; Track remains a secondary, currently-inactive dimension until its cross-domain blocker is resolved.
3. **Programming is independent from Results.** Programming defines Workouts, Sections, Scaling, Notes, Media, Metadata, and Publishing. It never defines, gates on, or is gated by scores, leaderboards, PRs, or competition presentation.
4. **Coach Notes and Athlete Notes are permanently separate.** They are never merged into one field and never distinguished only by a visibility flag on shared content.
5. **The Movement Library is a governed reference layer, never free text at the point of use.** Movements are drawn from a platform-seeded, gym-extensible catalog; a gym's own extensions remain private to that gym unless deliberately promoted.
6. **AI augments the canonical workout model; it never replaces it.** AI-derived content lands in the same editable, coach-owned state as manual authorship and becomes indistinguishable from it the moment a coach saves. No permanent provenance flag survives to mark content as machine-originated.
7. **Published content is stable, not frozen.** A coach may always correct a mistake, but no edit to Published content is ever silent to anything that already depended on it.
8. **No cross-interface divergence.** The same Workout, read from the PWA or from Forge Admin, resolves to the same data through the same authorization rules. A client may render differently; it may never compute differently.
9. **A dependency on a frozen domain is named, never assumed away.** Anything Programming cannot deliver without changing Classes, Multi-tenancy, or Authentication/Members is marked Deferred by Architectural Boundary — never worked around with an ungrounded stand-in.
10. **Production data is the validation source, not a hypothesis.** Every claim about the live Programming domain — schema, RLS, RPCs — is verified directly against the production database before being relied on, never assumed from a prior document alone.

## 10. Why Forge Deliberately Diverges from the Industry

Every CrossFit-affiliate-style platform studied couples Programming and Results tightly, and each names the same reason: retention. One goes furthest of all — a workout that lacks scoreable components does not display correctly on that platform's own in-class screen, meaning in that architecture Results is not a downstream consumer of Programming, it is a dependency Programming cannot function without.

Forge's frozen architecture rejects this coupling outright. This is not a case of Forge simply not having reached that point yet — it is a considered decision that holds regardless of how many competitors chose otherwise, for three reasons:

1. **None of these competitors had to integrate Programming into an already-independently-frozen platform.** Forge's Financial, Membership, Classes, and Attendance domains were each deliberately scoped narrowly and completed before the next began — the same discipline this document applies here. A Results domain does not exist yet. Coupling Programming to it now would mean either building Results prematurely, violating the same minimal-core discipline this entire architecture rests on, or coupling to a domain that isn't there — which is not deferral, it is a defect waiting to surface.
2. **The most extreme competitor coupling found is itself the cautionary evidence, not a counterexample.** A workout that cannot display without scoreable content is exactly the outcome a narrow domain boundary exists to prevent: a future domain's own constraints leaking backward into what an earlier domain is allowed to be.
3. **The retention value every competitor chases is real — and belongs to a domain that doesn't exist yet, not to Programming.** Nothing in this architecture prevents a future Results or Engagement domain from building the same shared-leaderboard, PR-detection, community experience these competitors offer. It only prevents Programming from pre-deciding, today, what that future domain's own design must look like.

This is the correct call held under real, evidenced, majority-practice pressure — not an omission this research happened to reveal, but a position that survives being argued against directly.

## 11. Future Evolution

None of the following requires reopening this document or `PROGRAMMING_DOMAIN_ARCHITECTURE.md` v1.1 when it eventually happens — each is additive within an already-anticipated extension point:

- **Track**, once a resolution mechanism is jointly designed with whoever owns Classes. Industry evidence (six of eight platforms) raises the priority of scoping this work; it does not change the deferral itself.
- **Tag-constrained movement substitution** — one competitor's mechanism for constraining an athlete's or coach's substitution choices to movements sharing a governed tag, preventing an inappropriate swap (a squat silently becoming a deadlift). A clean future elaboration of the already-adopted Movement Library, not adopted now.
- **A durable home for AI-derived rich metadata** (classification, coaching guidance) that is currently generated and discarded — an elaboration of the Metadata concept already named in the frozen architecture.
- **A Results/Engagement domain**, built independently, that consumes Programming's stable Workout/Section identity without Programming needing to change at all to support it.
- **Richer media handling** (native upload, broader file-type support) as an elaboration of the Media concept already named, not a new one.

## 12. Final Architectural Verdict

Every decision in `PROGRAMMING_DOMAIN_ARCHITECTURE.md` v1.1 was tested against eight real production systems and one rigorous coaching methodology, and every one survives. Several — the content-stability contract most of all — are demonstrably stronger than any single competitor's own equivalent, having synthesized the best property of multiple approaches without inheriting any one approach's specific cost. The one deliberate divergence from majority industry practice, Programming's independence from Results, was argued on its own merits rather than asserted, and holds.

This document is approved as the companion validation record to `PROGRAMMING_DOMAIN_ARCHITECTURE.md` v1.1. Both are frozen. Programming Phase 1 may proceed on this foundation.

**APPROVED FOR FREEZE**
