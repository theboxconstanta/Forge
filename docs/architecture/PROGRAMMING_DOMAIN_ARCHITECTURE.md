# Forge Programming Domain Architecture

**Status:** Proposed for Freeze
**Version:** 1.1
**Prepared:** 2026-08-04
**Last Reviewed:** 2026-08-04

This document is the canonical product specification for the Programming Domain. It defines the domain model, not the data model. No SQL, no table names, no Supabase-specific mechanics, no UI, no implementation plan appear in this document.

This document is written to remain correct for 5-10 years of platform growth, not for the current implementation.

Programming integrates with, but does not redesign, the following architecturally frozen domains: Authentication, Profiles, Multi-tenancy, Members, Financial Domain, Membership Catalog, Classes, Attendance. Any Programming capability that would require a change to one of these frozen domains is not treated as active architecture in this document — it is named explicitly as **Deferred by Architectural Boundary**, so the dependency is visible rather than assumed away.

---

# Executive Summary

Programming is the domain that defines what a coach is teaching and what an athlete is training, on a given day, at a given gym. It exists because a gym's entire daily value proposition is decided here and nowhere else in the platform: Classes decides *when* and *where* people gather, Attendance decides *who* showed up, but neither says *what happened once they were in the room*. Programming is built for the coach first, as the person who must be able to author a session quickly, faithfully, and without friction, every single day, for years, and it is built for the athlete second, as the person who must be able to trust that what they see is exactly what their coach intended, and that it stays trustworthy even after the fact. It is an independent domain — not a feature of Classes, not a feature of the Member App — because its content, its authoring lifecycle, and its own internal richness have a shape and a lifecycle that belong to none of the other frozen domains. Its responsibility ends precisely at delivering trustworthy, correctly-scoped content: it does not decide how results are shown, does not decide who may see it beyond membership eligibility, and does not silently change what a coach already told an athlete to expect.

---

# 1. Domain Purpose

Programming exists to answer one question, correctly, every day, for the life of the platform: **what is today's training, and can everyone who needs it trust it — both right now and in hindsight?**

Concretely, its purpose is to:

- Give a coach a place to author training content that is fast enough to use every single day without becoming a chore.
- Preserve that content faithfully — structure, scaling, intent — from the moment it is authored to the moment an athlete reads it, with nothing silently lost in between.
- Guarantee that once content has been delivered, any later change to it is detectable, never silent, by anything that depended on it.
- Make that content discoverable and reusable over time, so a gym's own programming history becomes an asset, not a pile of forgotten records.
- Provide a stable, well-defined unit of content that other domains — a future Performance/Logging domain, a future Engagement domain — can attach to, without Programming itself taking on responsibility for what those domains do with it.

Programming's purpose is not to run a class, track who attended, decide what a membership includes, decide how results are displayed, or determine what an athlete achieved. Those are the responsibilities of other domains, frozen or future.

---

# 2. Product Philosophy

**Coach First, AI-Assisted.** AI output lands in the exact same editable surface as manually typed content, is never distinguished from it after save, and never publishes or gates anything on its own. Programming is a coach-first product with a fast on-ramp, not an AI-first one.

**Calendar First.** Every authored Workout is organized by Day, within one Gym. This is the fundamental spine of the domain — every other structure (Sections, Scaling, Notes, Media) exists inside a Day's Workout, not alongside it. Calendar First does not mean a Workout is bound to a specific Class time slot (Section 7, REJECT); the calendar axis is the Day, not the session.

**Structured Data, where it earns its keep.** Anything that must be counted, compared, searched, or logged against — Movements, scoring, Scaling Levels — is structured data. Anything that is purely descriptive and coach-authored — a whiteboard description, a coaching cue — remains legitimate free text. Neither "everything structured" nor "everything free text" is correct; the boundary is drawn by what downstream needs to be reliable.

**Minimal Core, Progressive Complexity.** A coach must be able to produce a complete, useful, valid day of programming with almost no required structure — a date and some content. Every additional layer — Sections beyond the primary one, Scaling Variants, tagged Movements, Metadata, Media — is strictly optional and additive, never a precondition to saving. Domain richness is real and preserved; authoring friction is not.

**Trustworthy, not just fast.** Speed of authoring and reliability of what has already been delivered are not in tension, and this domain does not trade one for the other. Once content has reached an athlete, Programming guarantees that any later change is detectable — not that it never happens. Coaches make honest mistakes and must be able to fix them without that guarantee breaking.

**Community, results, and social interaction are excluded from Programming's own philosophy.** Programming's job ends at delivering trustworthy content. A shared results surface, competition presentation, engagement, and social interaction are downstream consumption concerns belonging to other domains, both in philosophy and in the product decisions that follow from it (Section 7, Section 10).

---

# 3. Core Concepts

### Workout
The top-level authored unit: one gym's training content for one Day. It is the thing a coach creates and edits, and the thing an athlete ultimately reads and trains against.

*Responsibility:* owning identity (which gym, which day), owning its publication lifecycle (Draft vs. Published) and its content-stability contract (below), and being the stable anchor other domains attach to.

*Not responsible for:* how it is scored or rendered in detail (that lives inside its Sections), who attended, what class it was taught in, what an athlete did with it, or how results across athletes are shown.

*Lifecycle and content stability:*
- A Workout's **identity** — the specific Workout that a Class, a log, or an athlete's history refers to — is permanent once created. It is never reassigned to different content and never silently disappears once anything downstream has referenced it.
- A **Draft** Workout's content may change freely; nothing external depends on it yet.
- A **Published** Workout's content may still be edited by its coach — mistakes happen and must be fixable — but every edit after publication produces a **detectable revision**. Any consumer that read or logged against the Workout before the edit must be able to tell that the content has since changed. The contract is that mutation is never silent; it does not require that Published content be frozen outright.
- Retracting a Published Workout back to Draft, or removing it, is permitted, but once anything downstream has referenced it, the reference must resolve to "this content used to exist and has been withdrawn," never to nothing at all.

### Day
The atomic unit of the calendar spine. A Day is anchored to the Gym's own local time zone — the same Day boundary a Class (frozen) already resolves against.

### Section
A structural subdivision of a Workout — warmup, skill work, the primary metcon, and so on. A Workout is composed of one or more Sections, with exactly one currently treated as the primary, scored Section (Section 7, DEFER).

*Responsibility:* organizing a Workout into the phases a coach actually teaches in sequence, each carrying its own format, movements, and scaling content.

*Not responsible for:* standing alone as an independently discoverable or loggable unit outside its parent Workout, unless a future domain explicitly needs that.

### Movement
An atomic, named reference to an exercise (e.g., "Back Squat"), drawn from a governed Movement Library rather than typed as free text, and attached to a Section.

*Responsibility:* giving Programming a reliable, comparable vocabulary.

*Not responsible for:* carrying coaching instruction itself (that belongs to Notes).

### Movement Library
The governed catalog Movements are drawn from, with two distinct tiers:
- **Platform Movements** — maintained by Forge itself, visible to every gym, the canonical shared vocabulary of the sport.
- **Gym Movements** — created by an individual gym for something genuinely specific to how it trains. Gym Movements are private to the gym that created them by default: they are never automatically merged into, or made visible within, the Platform tier, and no gym's extension is visible to any other gym.

*Responsibility:* being the single place "what movements exist" is answered, without either closing the vocabulary to gyms or letting gym-level extension silently fragment the shared, cross-gym vocabulary.

*Not responsible for:* automatically reconciling or promoting a Gym Movement into a Platform Movement. If that is ever needed, it is a deliberate, platform-level curation action, never an implicit side effect of a gym adding its own entry.

### Scaling
A named, ordered variant of a Workout or Section (e.g., RX, Intermediate, Beginner, On-Ramp) carrying its own content where it differs from the base version.

*Responsibility:* letting one authored Workout serve a gym's full range of athletes without forking into separate, disconnected workouts. All Scaling Variants of a Workout remain siblings of that one authored unit — this is a statement about authoring structure only.

*Not responsible for:* how results across Scaling Variants are displayed, compared, or presented to athletes. That is a Results-domain decision, not made here (Section 7, Section 10).

### Benchmark Identity
A first-class, coach-asserted property of a Workout that identifies it as a specific named benchmark or hero workout (e.g., "this is Fran"), distinct from general Metadata (below).

*Responsibility:* being a reliable identifier that any future domain needing to group or compare workouts across time (e.g., "your Fran history") can depend on. Unlike general Metadata, Benchmark Identity is treated as load-bearing, not disposable.

*Not responsible for:* carrying anything beyond identity — coaching guidance about how to run a benchmark workout belongs to Notes; general classification belongs to Metadata.

### Metadata
Descriptive information about a Workout that is not the workout content itself, and not its Benchmark Identity — classification, coaching guidance, AI-derived context.

*Responsibility:* making a Workout more discoverable, filterable, and understandable, whether entered by a coach or suggested by AI.

*Not responsible for:* ever being the authoritative content of the Workout, or overriding what a coach explicitly authored. Metadata augments; it never replaces, and unlike Benchmark Identity, nothing downstream is entitled to assume Metadata is reliable or complete.

### Notes
Free-text, coach-authored context attached to a Workout or Section, split by audience: **Coach Notes** (teaching cues, how to run the session — never shown to athletes) and **Athlete Notes** (scaling rationale, context — shown to athletes).

*Responsibility:* carrying expressive, non-analytic information, cleanly separated by who is meant to read it.

*Not responsible for:* carrying information that should be structured (a movement, a scaling level) simply because it's easier to type into a text box.

### Media
A visual or reference asset (a video, an image) genuinely attached to a Workout or Section as its own concept, not smuggled into a Notes field as a pasted link.

*Responsibility:* letting a coach show, not just describe, a movement or standard.

*Not responsible for:* replacing Notes as a place for expressive text.

---

# 4. Information Architecture

The organizing hierarchy, concept to concept:

```
Gym
 └─ Day                            (anchored to Gym-local time)
     └─ Workout                    (one per Gym, per Day)
         ├─ Section(s)             (ordered; exactly one primary, for now — Section 7)
         │   ├─ Movement(s)        (drawn from the Movement Library)
         │   ├─ Scaling Variant(s)
         │   ├─ Coach Notes / Athlete Notes
         │   └─ Media
         ├─ Benchmark Identity     (optional, coach-asserted)
         ├─ Metadata               (optional, descriptive)
         └─ Status                 (Draft → Published, with a content-stability contract)

Gym
 └─ Movement Library                (Platform tier + Gym tier, never auto-merged)
 └─ Section Type catalog            (platform-seeded, gym-extensible)
 └─ Scaling Level catalog           (platform-seeded, gym-extensible)
```

**Track.** Some gyms may eventually want to run more than one parallel program under one roof or across locations (an internal Competitors track, a second physical location's own calendar). This capability is deliberately not part of the active information architecture above. A Class (frozen) is identified only by Gym, Date, and Time, with no field indicating which of several parallel programs it belongs to; introducing such a field is a change to a frozen domain, outside Programming's authority to make unilaterally. Until a resolution mechanism is jointly designed with whoever owns Classes, every Gym is treated as having exactly one implicit program, and Track does not exist as a live entity in this model. This is marked **Deferred by Architectural Boundary** (Section 7, Section 11).

A Workout's relationship to Classes (frozen) is a **lookup, not an ownership link**: any Class occurring at a given Gym on a given Day resolves to that Gym-and-Day's single Workout. Programming does not store which Classes exist, and Classes does not store which Workout it belongs to. A Workout's relationship to Attendance (frozen) is nonexistent by design.

---

# 5. Coach Workflow

1. The coach opens Programming for a specific Day at their Gym.
2. The coach starts from one of three equally valid entry points: a blank Day, a cloned/reused prior Workout from the gym's own Library, or pasted raw text handed to AI for a first draft. All three converge on the same authoring surface.
3. If AI produced a draft, its output is immediately and fully editable, exactly like manually typed content, with no separate "AI state" that persists once the coach starts working with it.
4. The coach organizes the day's training into Sections, tags relevant Movements from the Movement Library within each, and defines how the primary Section is scored.
5. Where the gym's population requires it, the coach fills in Scaling Variants for each level that applies.
6. The coach writes Coach Notes and Athlete Notes as two separate, intentional pieces of writing.
7. The coach attaches any relevant Media.
8. If the Workout is a known benchmark or hero workout, the coach may assert its Benchmark Identity. The coach reviews any suggested Metadata (AI-derived or self-entered) — accepting, editing, or ignoring it never blocks saving.
9. The coach saves. Saving does not require every optional layer above to be filled in; a bare date and primary Section content is a complete, valid Workout.
10. The coach chooses to keep the Workout as a Draft, publish it immediately, or rely on the gym's configured automatic publish schedule for that Day.
11. Once Published, the Workout becomes visible to every athlete with access to that Gym for that Day, and permanently joins the gym's own searchable Library. Any later edit the coach makes produces a detectable revision, per the content-stability contract in Section 3 — the coach is never blocked from correcting a mistake, and nothing downstream is ever left with a silently wrong picture of what changed.

---

# 6. Athlete Consumption Model

Athletes never enter Programming's authoring surface. They only ever see Published content, and only the subset of it meant for them:

- An athlete sees the Workout for **their Gym**, for the current Day — resolved by Gym+Day, the same axis a Class resolves against.
- Within that Workout, an athlete sees their relevant Scaling Variant(s), the shared descriptive content, tagged Movements, and Athlete Notes — never Coach Notes, never internal Metadata.
- All athletes on a given Day, regardless of which Scaling Variant they use, are reading content from the *same* authored Workout. This is a statement about authoring structure only — how their results, if logged, are shown to one another is not decided by Programming (Section 7, Section 10).
- An athlete's ability to see a Day's Workout at all is gated by their Membership's access to that Gym (Financial/Membership concern, frozen, untouched here) — not by their specific Class booking. Booking a class (Classes, frozen) determines *when* they show up; Programming determines *what* they'll be doing once they're there, related only by sharing the same Day.
- What an athlete *does* with the Workout once they see it — logging a score, marking a PR, commenting, reacting — is explicitly not part of this domain's responsibility (Section 10). Programming's only obligation is to remain a stable, identifiable thing to attach that behavior to, with the content-stability guarantee in Section 3 so that attachment stays trustworthy over time.
- History: an athlete can look back at prior Published Workouts through the same Gym+Day resolution, since Programming's content is retained indefinitely as part of the gym's own Library.

---

# 7. Product Decisions

## ADOPT

- **Coach Notes vs. Athlete Notes as a permanent, general split.** Validated by CrossFit coaching methodology's own separation of what a coach needs to know from what an athlete needs to know.
- **A two-tier, governed Movement Library** — Platform Movements maintained by Forge, Gym Movements private to the gym that created them, never auto-merged. This avoids both a fully closed vocabulary and unrestrained, silently fragmenting extension.
- **Scaling Variants as siblings of one authored Workout, structurally.** This is a decision about authoring, not about result presentation. How results across variants are displayed is explicitly not decided here (Section 10).
- **Benchmark Identity as a first-class, coach-asserted Workout property, separate from general Metadata.** Downstream correctness (grouping a gym's own "Fran" history reliably over years) depends on it, so it does not belong in a bucket defined as disposable.
- **A genuine Draft → Published lifecycle, paired with an explicit content-stability contract.** Publication state alone is not enough; the guarantee that a Published edit is never silent to whatever has already depended on the content is what makes the lifecycle trustworthy (Section 3).
- **Reuse through a searchable Library plus a duplication (clone) action, as a general capability.**
- **AI strictly as a drafting assistant, never an author of record.**
- **Day, within one Gym, as the fundamental organizing spine of Programming**, anchored explicitly to Gym-local time.

## REJECT

- **Per-class-instance assignment of Workouts.** No evidence examined supports needing different content per class time slot on the same Day; the occasional real need for divergent content is a program-level concern (Track, deferred), not a per-class one. This is the current best conclusion from available evidence, not a permanent prohibition — see Section 9 and Section 11 for the specific untested scenario that could overturn it.
- **A fully closed, platform-only movement vocabulary.**
- **Media expressed as a link pasted into a text Notes field.**
- **Persisting AI provenance or confidence as a permanent, visible property of saved content.**
- **Requiring any structural layer as a precondition to saving.**
- **Silent, undetectable mutation of Published content.** A coach may still edit Published content, but the domain explicitly rejects any design where a downstream consumer has no way to know the content it once read has since changed.
- **Programming defining, deciding, or constraining how results, leaderboards, or competition are presented.** Any future design for Results must not find a pre-made constraint baked into this document.

## DEFER

- **Track (multiple parallel programs per Gym) — Deferred by Architectural Boundary.** Cannot be safely activated until a resolution mechanism is jointly designed with the Classes domain; not something Programming can resolve unilaterally (Section 4, Section 11).
- **Cross-gym or franchise-level programming sharing — Deferred by Architectural Boundary.** Would require a cross-tenant sharing primitive that Multi-tenancy (frozen) does not currently provide. Not modeled here, and not assumed to arrive automatically alongside Track.
- **Fine-grained Publishing authority (e.g., a Head Coach role distinct from any coach) — Deferred by Architectural Boundary.** Publishing authority is intentionally undifferentiated from authoring authority — any coach or admin who can author can publish, matching the same coach/admin distinction used everywhere else on this platform. A finer-grained role would require the frozen Authentication/Members domain to introduce sub-roles within "coach," which Programming cannot introduce on its own.
- **Whether "exactly one primary, scored Section" per Workout remains correct.** Carried forward from the current implementation as the default minimal shape, but explicitly not treated as permanent. If real usage shows gyms need independently scored, non-metcon elements in the same Day (e.g., a separately logged strength lift), this should be revisited directly, ideally alongside whatever future domain owns logging/Results.
- **A distinct "Template" entity, separate from an ordinary reusable past Workout.**
- **A richer, coach-only "Class Plan" or "Whiteboard Brief" layer beyond Coach Notes.**
- **AI-driven personalization or scaling suggestion based on individual athlete history.**
- **Exactly where persisted Metadata is stored, and how it survives the current legacy-to-structured migration.**
- **Whether logging/scoring/results tracking is its own frozen domain, or remains closely adjacent to Programming.**

---

# 8. Future Evolution

Most deferred items remain additive within Programming's own boundary and require no re-architecture when they arrive:

- **Templates**, if ever justified, become a specialization of the existing Library/Clone mechanism.
- **Class Plans / Whiteboard Briefs** attach beside a Workout, referencing it, without altering what a Workout itself is or requires.
- **AI Coaching / personalization** becomes a new consumer of the already-defined Metadata concept and of athlete history owned by other domains.
- **Rich Metadata** is an elaboration of the Metadata concept already named in Section 3.
- **Video/media libraries** are an elaboration of the Media concept already named in Section 3.
- **A unified Movement Library** fulfills a decision already made in Section 7; only the migration of the two existing lists remains.

Three items are not unilaterally additive within Programming's own boundary:

- **Track** requires a jointly-designed resolution mechanism with Classes before it can safely exist as a live concept. Until that mechanism is designed, Programming's own model does not change to accommodate it.
- **Cross-gym/franchise sharing** requires a cross-tenant primitive from Multi-tenancy that does not exist today.
- **Fine-grained Publishing roles** require sub-role support from Authentication/Members that does not exist today.

Each of these three is a coordinated, cross-domain architectural exercise in its own right, not a future phase of Programming alone.

---

# 9. Architectural Principles

1. **Programming exists for the coach; every other consumer is downstream of what the coach authors.**
2. **Day, within one Gym, is the fundamental organizing spine of Programming.** Class-instance assignment is rejected as the current best conclusion from available evidence, not as a permanent prohibition; it is explicitly revisitable if a genuine need for differentiated same-day content is demonstrated (Section 11).
3. **Structure exists where it must be counted, compared, searched, or logged against; free text remains legitimate everywhere else.**
4. **A Workout must be completely authorable with almost no required structure, and every additional layer is strictly additive, never a precondition.**
5. **AI assists creation; it is never the author of record.**
6. **Athletes consume Programming; they never author it, and what they do with it belongs to other domains, not to this one.**
7. **Programming's responsibility ends at delivering trustworthy, correctly-scoped content.** It does not run a class, track attendance, decide membership eligibility, or decide how results are shown.
8. **Once content has been delivered, later changes to it are never silent to whatever depended on it.** Coaches may correct mistakes, but nothing downstream is ever left holding a stale, undetectable picture of what a Workout said.
9. **A dependency on a frozen domain is named explicitly as Deferred by Architectural Boundary, never resolved by assuming the frozen domain will change to accommodate Programming.**

---

# 10. Out of Scope

To prevent scope creep in every future phase built on this document, Programming is explicitly **not**:

- **Not a scheduling system.** Classes (frozen) owns when and where.
- **Not an attendance system.** Attendance (frozen) owns who showed up.
- **Not a membership or eligibility system.** The Financial Domain and Membership Catalog (frozen) own who is allowed to see what.
- **Not a results, scoring-history, leaderboard, or PR-tracking system.** Logging a score and everything that follows from it — personal records, history, leaderboards, competition presentation — is a distinct concern for a future domain, and Programming must not make decisions that presuppose or constrain how that future domain will work (Section 7, REJECT).
- **Not a community or social platform.** Comments, reactions, feeds, and athlete-to-athlete interaction belong to a future Engagement-style domain.
- **Not a billing or commercial concept.**
- **Not a business-analytics or coaching-performance system.**

---

# 11. Risks

- **Whether Track will actually be needed, and on what timeline** — and, separately, whether the Classes-resolution mechanism it depends on will ever be designed. Both are open; this document does not assume either.
- **Whether the rejection of per-class-instance content is actually correct.** The specific untested scenario is a gym running genuinely different content at different times of day within the same program (not a scaling difference, a different metcon entirely) — no source examined during discovery was asked about this directly, so its absence from the evidence is not proof it doesn't happen. This is the most likely candidate to overturn Section 7's REJECT decision if real usage surfaces it.
- **Whether the two-tier Movement Library governance is sufficient at platform scale**, or whether cross-gym movement analytics eventually need a promotion path from Gym tier to Platform tier that this document does not yet define.
- **Whether coaches will use Draft state meaningfully, or publish everything immediately regardless**, as the current implementation implicitly does today.
- **Whether "exactly one primary, scored Section" holds under real gym demand** for independently logged strength and conditioning elements in the same Day.
- **Where persisted Metadata should live**, and who besides the authoring coach should ever see AI-derived content — a required near-term follow-up once any future phase makes AI-assisted authoring write-capable in a persisted way.
- **Whether Results/Logging deserves its own frozen domain**, and whether that future domain, once designed, discovers it needs something from Programming that a stricter boundary did not anticipate.
- **Cross-gym/franchise programming sharing and fine-grained Publishing roles** remain genuinely unresolved, blocked on frozen-domain evolution this document cannot and does not attempt to force.

---

# 12. Final Recommendation

Reviewed as a Principal Product Architect would review a domain proposal intended to anchor the next decade of the product:

Every concept defined in Sections 3-4 is internally consistent and self-contained within Programming's own authority: Workout, Day, Section, Movement, the two-tier Movement Library, Scaling, Benchmark Identity, Metadata, Notes, and Media require no change to any frozen domain to exist exactly as described. The Draft-to-Published lifecycle carries an explicit content-stability contract, giving downstream domains a concrete, durable guarantee — Published content may be corrected, but never silently — rather than leaving historical integrity as an assumption. The domain boundary is drawn tightly and consistently: Programming defines authored content and its lifecycle; it does not decide how results are displayed, who is eligible to see content beyond gym membership, or when and where a class happens, and no product decision in this document quietly presupposes an answer to any of those questions.

Three capabilities — Track, cross-gym or franchise-level programming sharing, and fine-grained Publishing authority — cannot honestly be delivered without a corresponding change to a frozen domain (Classes, Multi-tenancy, and Authentication/Members respectively). Each is named explicitly as Deferred by Architectural Boundary rather than modeled as if it already worked, and none of them is required for the core domain to function or to remain stable as the platform grows. Two further questions — whether a single primary, scored Section per Workout is sufficient, and whether per-class-instance content differentiation will eventually prove necessary — are named as open risks with a specific, concrete trigger condition for revisiting them, rather than settled permanently on today's limited evidence.

This is the correct shape for a domain architecture meant to last: a small, coach-first core that is fully decided and internally consistent, a domain boundary that other future domains cannot be quietly boxed in by, and every genuine external dependency named rather than assumed away.

**APPROVED FOR FREEZE**, scoped to the concepts and decisions defined within Programming's own authority in this document. Track, cross-gym sharing, and fine-grained Publishing authority are excluded from this freeze by definition and become their own architectural exercises if and when the domains they depend on change.
