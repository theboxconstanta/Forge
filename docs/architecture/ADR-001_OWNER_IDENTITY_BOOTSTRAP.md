# ADR-001 — Owner Identity Bootstrap

**Status: PROPOSED** (resolved to ACCEPTED or REJECTED at the end of this document)

This is an Architecture Decision Record. It does not redesign, challenge, or add to any decision recorded in `MEMBER_DOMAIN_ARCHITECTURE.md`, `FINANCIAL_DOMAIN_ARCHITECTURE.md`, `OWNER_ACTIVATION_ARCHITECTURE.md`, `OWNER_LIFECYCLE_STATE_MACHINE.md`, `OWNER_DOMAIN_IMPLEMENTATION_ARCHITECTURE.md`, or `M10_IMPLEMENTATION_PLAN.md`. It resolves a question none of them settled: at what exact moment is Forge permitted to bring a Gym, and everything attached to it, into existence.

---

# Context

M10.1's implementation investigation surfaced a fact none of the six frozen documents above had confronted directly: Supabase's own email-confirmation mechanism establishes no authenticated session immediately after `signUp()` when confirmation is required. Forge's existing owner-registration sequence — the one M10.1 extended, not replaced — assumes the opposite: that an authenticated session exists the instant an account is created, and uses that session to immediately create a Gym, an Admin relationship, and (as of M10.1) a Trial and an Audit trail.

This is not a Supabase limitation to route around. It is evidence that Forge has never actually decided *when*, relative to identity verification, a Gym is allowed to exist. `OWNER_ACTIVATION_ARCHITECTURE.md` Principle 3.11 already requires that "anything consequential" wait behind email verification — but it does not say whether Gym creation itself is consequential, and the system currently in production answers that question by accident (today's `enable_confirmations = false` setting), not by design.

This ADR answers it by design, permanently.

---

# Problem

Forge creates several classes of persistent business resource at Owner registration time: a Gym, an Owner-to-Gym relationship, a Commercial Lifecycle record, an Activation Lifecycle record, a Trial, an Admin relationship, and an Audit trail entry. Every one of these is real: it occupies a namespace (a Gym's name is globally unique), it starts a clock (a 14-day Trial), it becomes visible to Customer Success and analytics, and it is expensive to unwind cleanly once created.

The question this ADR resolves: **at what exact moment has a prospective Owner earned the creation of these resources?**

---

# Constraints

- Must not contradict any frozen document. In particular: Principle 3.10 (self-service is the default, human assistance is the exception), Principle 3.11 (nothing consequential happens before verified identity), Principle 3.14 (progress is always resumable), Principle 3.15 (configuration never blocks exploration), and Section 13's already-frozen decision that the Trial clock starts at email verification, not at account creation or Gym creation.
- Must not require a card, a human reviewer, or any gate beyond what a fully automated, self-serve flow can satisfy.
- Must remain implementable without inventing a second authentication system (restates `OWNER_DOMAIN_IMPLEMENTATION_ARCHITECTURE.md` Section 4).
- Must account for the fact that this decision is being made *after* an initial implementation (M10.1) already shipped a specific answer to it, by default rather than by decision. That fact does not privilege the shipped answer — an ADR is where the accidental becomes deliberate, or is corrected.

---

# Options Considered

### Option A — Create account → Verify → Auto-login → Bootstrap → Trial → Dashboard

A fully sequential chain: nothing exists until the account is created, verification happens, and only then does the rest cascade automatically. As diagrammed, this option is under-specified in one important way: it does not say where the Gym name — already typed by the Owner before verification — is held during the wait. Taken literally, it either discards that input (forcing re-entry after the email round-trip, a resumability violation of Principle 3.14) or silently assumes some holding mechanism identical to what Option C names explicitly. This ADR treats Option A as **Option C without a named holding state** — a real gap, not a difference in philosophy.

### Option B — Create account → Bootstrap Gym → Verify later

Business resources are created immediately, using the session `signUp()` returns; verification, if it happens at all, is a background event that upgrades an already-fully-real Gym rather than creating it. This is what M10.1 shipped, because it is what the pre-existing production code already did, extended rather than redesigned in that implementation pass.

### Option C — Pending Owner → Verify → Bootstrap

Nothing but a lightweight, revocable *intent record* — an unconfirmed identity plus the form fields the Owner already typed, held for exactly as long as it takes to verify — exists before verification. No Gym, no Admin relationship, no Trial, no Audit entry, no namespace claim. The instant verification succeeds, Bootstrap fires, creating every business resource atomically, in the same step.

### Option D — A superior alternative, if one exists

Considered and rejected as a distinct option: any design in this space is fundamentally a choice of *how much* to create before verification, on a spectrum from "everything" (B) to "nothing but a bare identity" (C/A). No fourth point on that spectrum was found that isn't simply a hybrid — e.g., "create the Gym row but not the Trial" — and every such hybrid was rejected for the same reason: it creates *some* real, permanent, unqualified resource (a namespace claim, an audit entry) while deferring only the *cheapest* one (a Trial clock), which inverts the actual risk ordering rather than resolving it. No Option D is proposed.

**A pattern worth naming explicitly, because it is not a coincidence:** Option C is structurally identical to the architecture Forge already froze and shipped once before, for the sibling problem of Member identity — M9's Model D. There, a real `auth.users` identity and session are deliberately deferred until the invitee proves possession of the channel an Admin vouched for (accepting the invitation token); only then does Final Commit atomically create the Member and Membership together. Option C is the same shape applied to Owner self-registration, with one substitution: there is no vouching Admin for an Owner, so the Owner proves possession of their own claimed channel (email) instead. This is not a new pattern being invented for this ADR — it is the reuse of a mechanism this project has already built, proven, and frozen once.

---

# Comparative Analysis

### Twenty criteria, evaluated identically for all three options

| # | Criterion | A (as diagrammed) | B (shipped in M10.1) | C |
|---|---|---|---|---|
| 1 | Product experience | Same as C once the holding-state gap is closed | Fastest apparent start; real state exists instantly | Equal to A once closed; a short, honest wait with nothing lost |
| 2 | Psychological friction | Same as C | Lowest — no visible gate | Real but bounded; matches a wait the Owner already expects (a "check your email" pattern used everywhere) |
| 3 | Conversion impact | Same as C | Marginally higher top-of-funnel count, but see 4 | Marginal signups lost are, by construction, the ones least likely to convert to First Value anyway |
| 4 | Lead qualification | Same as C | Every Gym-shaped row conflates real and unreachable leads | Every Gym that exists represents a reachable, deliberate signup — the pipeline is clean by construction |
| 5 | Business intent signal | Same as C | None captured — the same instant produces the account and the Gym | Verification *is* the signal — see Special Analysis |
| 6 | Security | Same as C | Weakest — a Gym exists before its Owner's identity is confirmed | Strongest — nothing exists to attack or impersonate before identity is confirmed |
| 7 | Data quality | Same as C | Degrades over time — the Gym table accumulates unqualified/abandoned rows permanently | Clean by construction — every row is a real attempt that completed the one qualifying step |
| 8 | Architecture cleanliness | Same as C | Identity and business-resource creation are one undifferentiated step | Identity and business resources are two distinct concepts with a named boundary between them — see Domain Purity |
| 9 | Operational complexity | Same as C, plus the unresolved holding-state question | Lowest short-term complexity, but pushes cleanup (stale unverified Gyms) onto every future system that touches Gym data | One clear boundary to build once; every downstream system (CRM, analytics, support) inherits a clean invariant for free |
| 10 | Trial management | Same as C | Trial start (verification) and Gym existence (signup) are two different instants — an inconsistency already visible in M10.1's own code | Trial start and Gym existence are the same instant, by construction — no inconsistency to reason about |
| 11 | Billing implications | Same as C | A future Platform Subscription must be able to reference a Gym that may represent an unreachable person | A Platform Subscription only ever references a Gym that already passed the one qualification step Forge has |
| 12 | Long-term maintainability | Same as C | Every future report, dashboard, or migration touching Gyms must remember to filter by verification status | No filter is ever needed — "a Gym exists" already means "a real, verified attempt" |
| 13 | Scalability | Same as C | Unqualified rows compound with volume — namespace pollution at 100k gyms is a real, permanent cost | Pending-state records are cheap and disposable; nothing permanent accumulates from abandoned attempts |
| 14 | Recovery after abandonment | Same as C | A half-real Gym with no Owner attention is a genuinely ambiguous state to recover from (delete it? Wait indefinitely? Both were live risks in the code M10.1 inherited) | A Pending Owner record is unambiguous — it either completes or it is stale and disposable, never a resource with real consequences hanging off it |
| 15 | Analytics quality | Same as C | "Gyms created" is not a meaningful metric on its own | "Gyms created" is meaningful by construction, with no caveat required |
| 16 | Customer Success implications | Same as C | CS outreach at Gym-creation time sometimes reaches nobody, degrading CS's own engagement metrics with no way to distinguish why | CS can act confidently the instant a Gym exists — it always represents a reachable person |
| 17 | Future AI implications | Same as C | An automated or adversarial actor can create real, permanent resources without proving reachability | A clean boundary for any future agentic or automated provisioning flow to reason about — one unambiguous moment authority transfers from prospective to real |
| 18 | Multi-location compatibility | Same as C | Unaffected either way — see Architectural Invariants | Unaffected — verification gates an identity's *first* Gym only, never subsequent ones (stated explicitly as an invariant below) |
| 19 | Enterprise compatibility | Same as C | Unaffected — a sales-led path already bypasses self-serve entirely | Unaffected, for the identical reason — a staff-attested provisioning path substitutes for self-verification, exactly as `OWNER_LIFECYCLE_STATE_MACHINE.md` Section 8 already requires a Gym be able to enter directly at Paying, skipping Trial |
| 20 | Future platform evolution | Same as C | Every future consumer of Gym data inherits an ambiguity this decision could have resolved once | One invariant, established once, that every future system can simply trust |

Option A and Option C converge on every criterion once A's holding-state gap is closed — at that point they are the same architecture, and this document proceeds treating C as the complete, correctly-specified version of that shared architecture.

---

# Special Analysis — Is email verification a security feature or a qualification step?

**True — and provably so, not merely plausible.**

The proof is internal to this project's own frozen decisions, not a general claim about email verification everywhere. `M9.1` (frozen, already shipped) removed the equivalent verification requirement for Members, and did so correctly — for a documented reason: an M9 invitee's identity is already vouched for by the inviting Admin, so an additional email-possession proof adds negligible *security* value on top of that vouching. If email verification's value were purely about security (proving inbox control, preventing impersonation), the same logic would have applied identically to Owners, since inbox-control proof is inbox-control proof regardless of who is being verified. It did not. `OWNER_ACTIVATION_ARCHITECTURE.md` Section 9 already states why: an Owner has no vouching party — they are the *first* trust boundary Forge establishes for an entire Gym.

But "no vouching party" only explains why verification is *still needed* for Owners; it does not by itself explain why it should gate resource *creation* rather than merely resource *use* (Option B's actual shape). The sharper argument is this: a clicked email link is a weak proof of identity in isolation — it proves nothing about who a person is, only that they took one more deliberate, slightly costly action after leaving the product. That is not primarily a security property. It is exactly the same property `OWNER_ACTIVATION_ARCHITECTURE.md` Section 20 Phase 3 already used to choose Activation's own definition: a signal is valuable not because it is unforgeable, but because a low-effort, disinterested actor will not bother producing it. Verification is the first instance of that same filter, one step earlier in the funnel than Activation itself — the same kind of signal Forge already trusts, applied one layer up.

Both properties are real simultaneously — verification still provides some genuine security value (it prevents casual typo-Gyms and outright impersonation) — but the qualification property is the one doing the load-bearing work in *this* decision, because the security property alone would be satisfied just as well by Option B's "verify later, revoke if never verified" shape. Only the qualification framing explains why *creation itself*, not merely continued *access*, should wait.

---

# Product Philosophy — Minimum Level of Intent

**Should Forge create business resources for someone who has not yet demonstrated the minimum level of intent to run a business on it? No.**

**"Minimum level of intent" is defined precisely, not left as a feeling:** an action that (a) cannot be produced at zero cost by an automated, careless, or merely curious actor, and (b) requires the person to leave the product and deliberately return to it. Email verification is exactly this, and nothing less than this qualifies:

- A filled-in form does not qualify — Principle 3.4/3.13 already establish that a step with no cost to a disinterested actor proves nothing.
- A credit card does not qualify either, in the other direction — Section 13 already, deliberately, rejected requiring one at this stage; demanding proof of *payment* intent this early would contradict a decision this ADR has no authority to relitigate.
- Elapsed time does not qualify — waiting proves nothing about the waiter.

Email verification sits precisely at the minimum bar this definition describes, which is exactly why it is the correct, and only necessary, gate for resource creation.

---

# Domain Purity — Identity and Business Resources

**They must remain completely separate concepts, and Forge has already proven this exact lesson once, one layer down.**

`MEMBER_DOMAIN_ARCHITECTURE.md` Decision D1/D2 froze, as permanent law, that a Member's identity must never be conflated with that Member's relationship to a specific Gym — Member is a person, Membership is a fact about a person and a Gym, and collapsing the two was identified as the single most common modeling mistake in this product category. This ADR is the identical lesson, applied one layer earlier: an **identity attempting to exist** (a signup, unconfirmed) must never be conflated with **a business committing real resources on the strength of that identity** (a Gym, a Trial, an Audit trail). Option B commits exactly this conflation at signup time, in the same shape the Member Domain already learned, the hard way, to reject at membership time.

---

# Competitor Pattern Extraction — Philosophy, Not Implementation

**Developer/team tools (Slack, Notion, Linear, ClickUp, Asana, Monday):** the consistent philosophy is to let a prospective user *explore* a product's shape freely and immediately, while gating the *consequential* commitments — a permanent workspace identity, inviting a real team, connecting billing — behind a confirmed identity. This is not a different philosophy from the one already frozen in `OWNER_ACTIVATION_ARCHITECTURE.md` Principles 3.11 and 3.15 together; it is the same split (explore freely, commit only once verified), applied by this whole category to workspace creation specifically.

**Commerce platforms (Shopify and peers):** the same split, anchored at a different consequential moment appropriate to a commerce product — a store shell can begin almost instantly, but *accepting real customer money* is gated behind deeper verification. The pattern generalizes: gate resource creation at whichever moment is *this specific product's* first genuinely consequential act, not earlier and not later. For Forge, that moment is the point at which a Gym namespace is claimed and a Trial clock starts — not the point at which money moves (which is later still, per Section 14).

**Vertical fitness-industry SaaS (PushPress, BTWB, TeamUp, Wodify, Mindbody):** this category has historically leaned toward more human-assisted, sales-guided onboarding, consistent with a buyer profile (`OWNER_ACTIVATION_ARCHITECTURE.md` Persona 4.4/4.6) that is often less technical and more time-poor than a developer-tools buyer. Forge already made a considered, frozen, documented choice to lead with self-serve anyway (Section 13, Section 20 Phase 8), explicitly carving the more-assisted motion out as a separate, named, future exception (Section 18) rather than adopting this category's default. This ADR's decision must fit *within* that already-chosen self-serve shape — and it does: verification-gated Bootstrap is fully automated, requires no human reviewer, and adds no step beyond what a self-serve flow already contemplates.

---

# Decision

**Option C — Pending Owner → Verify → Bootstrap.**

A prospective Owner's typed inputs (email, password, chosen Gym name) are held as a lightweight, disposable, revocable intent record — no Gym, no Admin relationship, no Trial, no Activation Lifecycle, no Audit entry. The instant, and only instant, email verification succeeds, Bootstrap fires once, atomically, creating every business resource together. This is the same architecture already frozen for Member identity bootstrap (M9 Model D), applied to the structurally identical problem of Owner self-registration.

---

# Consequences

- **A required, explicit follow-up to M10.1.** M10.1's already-shipped bootstrap sequence implements Option B's shape — business resources are created immediately, using the session `signUp()` returns, with verification treated as advisory. This ADR, once accepted, requires that sequence to be restructured to Option C's shape: no Gym, Admin, Activation State, or Commercial State row until verification succeeds. This is named here as a required consequence of accepting this ADR, not silently deferred — it is the concrete reason this decision needed to be made at all.
- A "Pending Owner" holding state must be specified (not designed here — that is implementation, out of this ADR's scope) with a defined disposal policy for abandoned attempts.
- Gym name uniqueness is never claimed by an unverified attempt — two people typing the same name during their respective pending windows is not a conflict; only the first to *verify* claims the name. This resolves an ambiguity Option B's current shape does not have to face, because it claims the name immediately.
- Every future system that reads Gym data (CRM, analytics, Customer Success tooling, Financial-Domain-adjacent Platform Billing) inherits, for free and permanently, the invariant that a Gym's existence already means a verified, reachable Owner — no caveat, no filter, ever required.

---

# Trade-offs

Accepted deliberately, not overlooked:
- A real, if bounded, wait is introduced between "typed a Gym name" and "has a real Gym" — for every Owner, not only the ones an abuse case would target. This ADR's own Special Analysis and criterion-4/9 rebuttal establish why this is not a net increase in experienced friction (verification was already mandatory per frozen Principle 3.11; this decision only moves *where* its already-mandatory wait's consequences land), but the honest trade-off — a structural dependency on Owners actually checking their email promptly — is real and named, not hidden.
- Some small number of genuinely real, intending Owners who are simply slow to check email will perceive a delay before their Gym "exists" in any dashboard, support tool, or CRM view — mitigated, not eliminated, by resumability (Principle 3.14: nothing they typed is lost) but not fully erased.

---

# Rejected Alternatives

**Option A, as literally diagrammed** — rejected not on philosophy but on specification: it does not name where pre-verification input is held, which is either a resumability violation or, once fixed, simply Option C under a different name. Superseded by Option C, not independently rejected.

**Option B** — rejected. It is what shipped in M10.1, and is now the answer this ADR overturns. Every criterion in the Comparative Analysis where B and C diverge favors C; none favor B decisively enough to outweigh the compounding, permanent data-quality and namespace-pollution cost B accepts as volume grows (criteria 7, 9, 13, 20).

**A fourth, hybrid option** ("create some resources now, defer others") — considered and rejected in the Options Considered section: every hybrid inverts the actual risk ordering by keeping the cheapest deferral (a Trial clock) while still committing the more permanent one (a namespace claim, an Audit entry).

---

# Future Implications — The Five-Year Test

Tested explicitly against every named future condition, not assumed to survive them:

- **100,000 gyms:** Option C's advantage compounds rather than degrades — namespace and analytics cleanliness matter *more*, not less, at this volume, and Pending Owner records remain cheap and disposable regardless of scale.
- **Millions of members:** unaffected — this ADR governs Owner bootstrap only; Member Domain's own, separately-frozen Model D is untouched and was, if anything, the template this decision reused.
- **Enterprise organizations:** unaffected — a staff-attested provisioning path substitutes for self-verification without altering the pattern, exactly as `OWNER_LIFECYCLE_STATE_MACHINE.md` Section 8 already requires elsewhere.
- **Multiple countries:** unaffected — verification-then-bootstrap has no locale dependency; `members.language`-style per-identity preference (already proven at the Member level) is the correct, already-established pattern to extend here, unrelated to this decision.
- **Multiple payment providers:** unaffected — this decision resolves *whether a Gym exists*, strictly upstream of any payment concern (Section 14's own payment-timing decisions are untouched).
- **AI automation:** strengthened, not weakened — a clean, unambiguous moment at which "prospective" becomes "real" is exactly the boundary a future automated or agentic provisioning flow needs to reason about safely; Option B's ambiguity would have been inherited by every such future system.
- **Marketplace, open APIs, white-label:** none of these change the fundamental question this ADR answers — each would simply be a new *caller* of the same Bootstrap boundary, not a reason to move it.

The decision holds, unchanged, under every named condition. Nothing here required rejecting it.

---

# Self-Review — The Strongest Case Against This Decision

**The objection, stated as strongly as it can be:** "This adds friction to the product experience of every single Owner, even the overwhelming majority who verify within minutes — for the sake of preventing a comparatively rare abuse case (namespace squatting by unverified signups). Principle 3.4/3.13 already require that friction justify itself against what the product *cannot function without*, and Forge obviously *can* function with an unverified-but-real Gym — that is exactly what has shipped in production, successfully, until this ADR. You are trading a universal, guaranteed cost for a narrow, probabilistic benefit."

**Response, addressed directly, not dismissed:**

The objection is right that this is a real, non-zero cost, applied universally — that is conceded plainly in Trade-offs, not argued away. But the objection's framing contains a hidden, false premise: that Option B avoids this cost. It does not. Principle 3.11 already mandates that "anything consequential" — explicitly including sending a real invitation under the Owner's name — wait behind email verification, regardless of which option this ADR chose. A correctly-built Option B would therefore *already* have to block the Owner from doing anything that matters until verified; the only thing it does differently is create the *database rows* early while leaving them *unusable* in the interim. The Owner-experienced wait is identical either way, because it is fixed by Principle 3.11, which this ADR has no authority to change. What differs is not how long the Owner waits — it is only whether, during that identical wait, Forge is carrying a real, permanent, namespace-claiming, audit-logged resource that may never be used. Reframed accurately, the objection is not "Option C adds friction Option B avoids" — it is "Option B accepts worse permanent data hygiene for the exact same friction Option C accepts." Stated that way, the objection does not survive its own premise, and no option other than C was found stronger after taking it seriously.

A second, narrower version of the objection — "you lose the ability to run CRM win-back campaigns on abandoned signups without a persistent business resource to hang them off of" — is also addressed, not brushed aside: the Pending Owner record itself, plus Supabase's own native unconfirmed-signup and resend-confirmation mechanisms, is already sufficient for this; M9's own `gym_invitations` table already proves this exact pattern works for nurturing an unaccepted invitation with no Membership yet in existence.

No option other than C survived this review.

---

# Architectural Invariants

Permanent, binding on every future implementation, until superseded by a new ADR:

1. **No Gym, Admin relationship, Commercial Lifecycle record, Activation Lifecycle record, Trial, or Audit trail entry may be created for an Owner identity that has not completed email verification.**
2. **Verification gates an identity's first Gym only.** An already-verified Owner creating a second or subsequent Gym never re-verifies — this invariant is about establishing trust in an identity once, not re-gating every Gym-creation event.
3. **A Gym name is never claimed by an unverified attempt.** Namespace uniqueness is resolved only at Bootstrap, never at Pending-Owner creation.
4. **Bootstrap is atomic.** Every business resource this ADR governs is created together, in one step, the instant verification succeeds — never in a partially-completed intermediate state.
5. **A staff-attested provisioning path may substitute for self-verification** (the enterprise/sales-led exception already named in frozen documents) without violating Invariant 1 — staff attestation *is* the qualification proof in that path, not an exception to the requirement that one exist.

---

# Final Recommendation

Accept Option C, and treat this ADR's Consequences section as an open, tracked obligation: M10.1's current implementation does not yet conform to it and must be revised in a follow-up implementation pass before this invariant can be considered actually enforced, not merely decided.

**STATUS: ACCEPTED**
