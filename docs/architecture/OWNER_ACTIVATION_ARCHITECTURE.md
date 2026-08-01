# Forge Owner Activation Architecture

This document is a foundational architecture specification, held to the same standard as `MEMBER_DOMAIN_ARCHITECTURE.md` and `FINANCIAL_DOMAIN_ARCHITECTURE.md`. Unlike those two, it does not describe an already-implemented system — it defines the target architecture for a domain that does not yet exist in production. Where those documents record what is true, this document records what must become true, and why, so that implementation can proceed without redesigning the product vision mid-build.

This document must remain consistent with `MEMBER_DOMAIN_ARCHITECTURE.md` and `FINANCIAL_DOMAIN_ARCHITECTURE.md`. It does not redefine anything either of them owns. It defines a new domain that sits *before* both of them in a Gym's lifecycle, and that ultimately produces the inputs — a Gym, an Admin identity — those two domains already know how to operate on.

**Status: FROZEN**, following the Architecture Review recorded in Section 20. Section 20 is not a postscript — it is the record of a deliberately adversarial second review that changed real conclusions in this document (most significantly, Section 8) before freeze. A reader who wants to understand *why* a decision landed where it did, not only *what* it is, should read Section 20 alongside the section it revised.

---

# 1. Purpose

Forge already knows how to run a gym once one exists: the Member Domain, the Financial Domain, class programming, bookings, attendance, and leaderboards are built, frozen where appropriate, and proven against real usage. What Forge does not yet have is a real answer to the question that precedes all of that: **how does someone who has never heard of Forge become a Gym Owner who is successfully running their gym on it?**

That question is not a registration flow. Registration is a mechanism. The question is about **activation** — and this document treats First Value and Activation as two distinct, precisely defined milestones (Sections 7 and 8), not one. Every decision in this document is subordinate to reaching both as fast, and with as little unnecessary friction, as the product honestly allows — and never mistaking an easier-to-build milestone (an account, a database row, a single action) for either.

This document defines the Owner Activation domain: the complete journey from first discovery through durable, evidenced engagement, and the architectural boundaries that keep this new domain from leaking into, or being confused with, the two domains that already exist.

---

# 2. Scope

### In scope — owned by this domain

- **The Owner's pre-authentication journey** — landing, discovery, and the decision to try Forge — insofar as it determines what the product must be ready to do the instant an Owner arrives.
- **Owner identity and account creation** — a Gym Owner's authentication identity, distinct in purpose (though not in underlying mechanism) from a Member's.
- **Gym creation, in its minimal, activation-first form.**
- **The Setup/Activation experience** — whatever guides a brand-new, unconfigured Gym to a working state.
- **The definitions of First Value and Activation** — two distinct artifacts, and the most important this document produces (Sections 7 and 8).
- **SaaS Billing** — the commercial relationship between Forge and a Gym Owner, as a domain in its own right (Section 15).

### External dependencies — referenced, never redefined

Per the same governance convention `MEMBER_DOMAIN_ARCHITECTURE.md` and `FINANCIAL_DOMAIN_ARCHITECTURE.md` already established between each other, this document references entities it does not own and never redefines:

- **Gym, Admin, Membership Plan, Waiver** — owned by the Member Domain. This document determines *when* and *in what minimal shape* they first come into existence for a new Owner; it never redefines what they are.
- **The M9 Invitation flow** — frozen, owned by the Member Domain. This document reuses it exactly as it exists for a new Owner's first Member invitation. It is not re-specified here.
- **Order, Payment** — owned by the Financial Domain, and exclusively concerned with Gym-to-Member commerce. This document's own commercial concern (Section 15) is a sibling, never a tenant, of that domain.

### Non-goals

- **This document does not design multi-location or franchise support**, and, as of the Section 20 review, explicitly does not design an enterprise/franchise *sales-led* buying motion either — see Section 18's boundary statement. Nothing here precludes either later; nothing here builds either now.
- **This document does not specify implementation** — no schema, no code, no provider integration detail. Per its own mandate, it must remain implementable by a team that has never seen this conversation.
- **This document does not reconsider the frozen Member onboarding architecture.** Members never search for gyms, never see gym codes, and never create public accounts. That remains true, unconditionally, throughout everything below.

---

# 3. First Principles

These principles govern every decision in this document and in any implementation that follows it. Where a later section would appear to contradict one, the section is wrong, not the principle. Principles 3.13–3.17 were added during the Section 20 review; they are not later-tier principles, they carry the same weight as 3.1–3.12.

**3.1 Owners and Members are different products.** Owners buy Forge. Members use Forge. One is a commercial decision-maker evaluating a business tool; the other is a gym-goer who was invited by someone they already trust. Conflating their journeys — sharing screens, sharing language, sharing metaphors — serves neither well.

**3.2 The owner journey and the member journey never leak into each other.** An Owner is never asked to behave like a Member (search, browse, self-register). A Member is never asked to behave like an Owner (configure, pay Forge, administer). This is the direct extension of 3.1 into interaction design.

**3.3 Neither First Value nor Activation is measured by the existence of a record.** An account existing, a Gym row existing, a form being submitted — none of these are First Value or Activation. Section 7 defines the first; Section 8 defines the second; they are not the same threshold, and a design that treats reaching one as proof of the other is wrong.

**3.4 A required step must justify itself against what the product cannot function without — never against what is merely convenient to collect.** If Forge does not need a piece of information to do the very next thing an Owner will do, asking for it now is friction spent for no benefit, and it is deferred.

**3.5 The trial is the demo.** For a product whose value is directly experiential — running real classes, inviting a real member, watching them show up — self-experience is a stronger, faster proof than any guided pitch. A sales demonstration is offered as an option for those who want it, never substituted for the product itself as the primary path.

**3.6 This domain is additive. It never modifies a frozen invariant.** Nothing built to satisfy this document may alter the Member Domain's or Financial Domain's own rules, tables, or RPCs. Where this domain needs something from them, it calls the mechanisms they already expose, exactly as any other caller would.

**3.7 SaaS Billing and Member Billing are different commercial relationships between different parties, and must never share a mechanism.** Forge is paid by the Owner. The Gym is paid by its Members. These two facts must never be modeled, stored, reconciled, or reasoned about as the same kind of event. Section 15 makes this a permanent boundary, not a preference.

**3.8 An Owner is never asked for information Forge cannot yet act on.** Every field in every form in this domain must have an immediate, nameable consumer. "We might need it later" is not a justification.

**3.9 A Gym is allowed to exist, and be useful, in a partially configured state.** Partial setup is a normal, supported condition — not an error state the product nags about until resolved. The product's job is to make the *next* useful step obvious, not to insist on completeness for its own sake.

**3.10 Self-service is the default. Human assistance is the exception offered to those who want it — never the gate everyone must pass through.** This determines the shape of Section 11 (the Checklist decision) and Section 13 (Trial), and both are argued for, not assumed.

**3.11 No consequential action happens before the Owner has verified control of their own identity.** Payment, Gym creation with real invitations going out under the Owner's name, and anything else with a real-world consequence waits behind email verification. Low-consequence actions (starting to fill in a form) do not.

**3.12 The activation unit is "one Owner, one Gym" today, but the architecture must generalize to "one Owner, many Gyms" without redesign.** Section 18 is the direct consequence of this principle, not a bolted-on afterthought.

**3.13 Every step must increase either Trust or Activation. A step that does neither is friction with no offsetting benefit and is removed.** This is the general form Principle 3.4 is a special case of.

**3.14 Progress must always be resumable.** No Owner action is ever lost to a closed tab, a crashed session, or a return three days later. A design that requires an unbroken single sitting to reach a meaningful state is wrong regardless of how short that sitting is.

**3.15 Configuration must never block exploration.** An Owner may look around and see what the product can do before committing to configure anything.

**3.16 A milestone reachable by a single, low-effort, one-time action must never be treated as proof of durable engagement.** Durable engagement is evidenced by return behavior, not by a single event, however meaningful that event felt in isolation. This principle is why Sections 7 and 8 are not the same milestone.

**3.17 An activation metric is a hypothesis until it is validated against real retention data, and must be revisited once that data exists.** The definition in Section 8 is this document's best reasoned answer at a stage where Forge has no retention data of its own to test it against. That is stated plainly, not hidden — see Section 20.

---

# 4. Customer Research

Six distinct Owner profiles exist, each with a different activation obstacle. None is hypothetical — all are already represented, in some form, in Forge's real current customer base.

### 4.1 CrossFit Affiliate Owner
**Goals:** Track WODs, PRs, and leaderboards properly — the thing generic gym software does badly. Keep a roster of engaged, retained athletes.
**Fears:** Switching software mid-season disrupts a community that runs on trust and routine. Losing historical PR data feels like losing part of the gym's identity.
**Questions:** "Does this actually handle CrossFit-style programming, or is it a generic class scheduler with a WOD field bolted on?"
**Objections:** Contract lock-in; another tool to learn while already time-poor (most affiliate owners also coach).
**Activation obstacle:** Needs to see real WOD logging and a real leaderboard populate before believing this is CrossFit-native, not generic.

### 4.2 Independent Functional Fitness Gym Owner
**Goals:** Professional member experience without building one themselves.
**Fears:** Looking amateurish next to bigger competitors with polished apps.
**Questions:** "Can my members actually use this on their phones without friction?"
**Objections:** Cost relative to a small, uncertain revenue base.
**Activation obstacle:** Needs a real member to complete the Member App flow (M9) and see how smooth it is — this owner reaches First Value by *watching someone else's* first experience, not their own.

### 4.3 Boutique Studio Owner (yoga, pilates, spin — future)
**Goals, fears, questions:** Largely the same as 4.2, but with one specific, real product-fit question this document must not paper over: **Forge's current programming model is CrossFit-native (WODs, PRs).** A studio running fixed class schedules with no WOD concept at all may find the product's onboarding correctly explains it can run their business, but the *value proof* (Section 7) must not assume WOD logging is universally the "aha moment" — for this profile, a clean class schedule and a smooth booking flow is the equivalent proof, and the activation experience must recognize that, not force a CrossFit-shaped narrative onto a non-CrossFit gym.
**Activation obstacle:** Believing this isn't "CrossFit software with a class list bolted on," the mirror image of 4.1's concern.

### 4.4 Traditional/Commercial Gym Owner
**Goals:** Manage open-access membership (not primarily class-based) at higher member volume.
**Fears:** Software built for boutique/CrossFit gyms won't scale to hundreds of members or handle open-gym access patterns.
**Questions:** "Is this built for 50 members or 500?"
**Objections:** Perceived mismatch between Forge's CrossFit-community feel and a higher-volume, lower-touch operating model.
**Activation obstacle:** Genuinely the hardest-fit profile today; honest positioning (Section 6) matters more than onboarding polish here. This profile is also the one most likely to want more guidance than a bare checklist offers — see Section 11's response to that concern.

### 4.5 Existing Gym Migrating from Another Software
**Goals:** Better product, without breaking what already works.
**Fears, dominant and specific:** Losing member history; member confusion or churn during transition; double-paying for two tools during overlap.
**Questions:** "What happens to my existing members — do I have to re-invite every single one?"
**Objections:** Switching cost, both in effort and in risk.
**Activation obstacle:** The single highest-value, highest-friction segment. This document does not solve data migration (out of scope), but it must not make the *first* new invitation any harder for this owner than for a brand-new gym — Section 10's minimal Gym creation applies identically.

### 4.6 Brand-New Gym Opening Next Month
**Goals:** Have everything ready before day one.
**Fears:** Spending money on software before there's a single paying member to justify it.
**Questions:** "Can I set this up now and start inviting people before we officially open?"
**Objections:** No revenue yet to weigh against cost.
**Activation obstacle:** Zero existing members means First Value (Section 7) may take longer to reach — the trial length (Section 13) must accommodate a pre-launch gym, not only an already-operating one.

---

# 5. The Complete Owner Journey

```mermaid
flowchart LR
    A[Discovery: Google, Instagram, word of mouth] --> B[Landing]
    B --> C[Decision: start trial or request a demo]
    C --> D[Owner account created, email verification pending]
    D --> E[Email verified - trial clock starts]
    E --> F[Gym created - minimal]
    F --> G[Activation Dashboard]
    G --> H[First Value: first real Member accepts an invitation]
    H --> N[Owner notified - moment is marked, not silent]
    N --> I[Activation: Owner returns on a later day and performs a real operating action]
    I --> J[Daily usage: classes, programming, bookings, attendance]
    J --> K[Trial ends: soft or hard payment prompt]
    K --> L[Renewal]
    L --> M[Expansion: more Members, more Plans, eventually more Gyms]
```

Every stage above exists because removing it breaks something specific:

- **Discovery/Landing** exists because an Owner cannot decide without knowing what Forge is and who it's for (Section 6).
- **Decision** exists because not every prospect wants the same amount of friction before committing time (Section 6, Section 13).
- **Account creation, then email verification** exists because Section 3.11 requires verified identity before anything consequential (Section 9).
- **Gym creation** is deliberately minimal (Section 10) — it exists to produce the one thing everything downstream needs (a `gym_id` and an Admin), nothing more.
- **Activation Dashboard** exists because an empty product with no guidance is where trials silently die (Section 12).
- **First Value, then a notified pause, then Activation** (Sections 7 and 8) are the twin hinges of the entire document — deliberately two beats, not one, per Section 20's revision.
- **Daily usage, renewal, expansion** are not re-specified here — they are the already-built, already-proven product this whole journey exists to deliver an Owner *into*.

---

# 6. Landing Page

**Primary CTA: Start Free Trial.** Argued in Section 13, not assumed here — self-service is the default per Principle 3.10, and the landing page's primary action must match the primary path.

**Secondary CTA: Book a Demo** — present, visible, never hidden, but visually and hierarchically secondary. It exists for the segments in Section 4 with genuinely higher-friction concerns (4.4's fit question, 4.5's migration anxiety) without forcing every visitor through it.

**Value proposition:** must be honest about product fit (Section 4.3/4.4's concerns are real, not merely objections to be overcome with better copy) — the landing page should let a CrossFit/functional-fitness owner self-identify immediately, rather than presenting Forge as generic gym software that happens to also do WODs.

**Social proof:** real, specific, and small is more credible than generic and large at Forge's current stage — a named, real gym's real usage outweighs an invented "trusted by X gyms" counter with a fabricated number.

**Pricing visibility:** visible without requiring an email first. Hiding pricing behind a lead-capture gate is a sales-led pattern this document explicitly rejects as primary (Section 20, Phase 8, names why an enterprise/sales-led motion is out of scope rather than silently assumed). An Owner deciding whether to invest 15 minutes in a trial needs to know the eventual cost is reasonable *before* they invest that time, not after.

**Demo availability:** always available, never the only path (restates Section 3.10 at the landing-page layer).

---

# 7. First Value

**First Value is:** the moment a genuinely distinct, non-Owner identity — a real invited Member — successfully completes the M9 onboarding flow (Final Commit succeeds) for the Owner's Gym, and that Member becomes visible on the Owner's own roster.

This is the earliest point at which the Owner is shown undeniable, third-party evidence that Forge works: a real person, invited by them, is now inside their gym because of an action they took. Everything before this moment is the Owner's own belief about the product; this moment is the product proving itself through someone else's real action.

**First Value is not:**
- Account created — zero product experience has occurred.
- Gym created — still zero real-world consequence.
- Gym configured (a Plan exists, a Waiver is published) — this is *setup*, a chore performed in anticipation of value, not the value itself.
- First invitation sent — this is an *action* the Owner took; it proves intent, not outcome. An invitation that is never opened proves nothing.

**A precision this definition requires:** the completing identity must not be the Owner's own account re-invited or a same-person test pass. Implementation must be able to distinguish "the Owner invited themselves to verify the flow works" from "the Owner invited a real prospective Member" — the former is legitimate and expected (an Owner should be able to test the Member experience), but it does not count as First Value.

**This moment must be marked, not merely reflected.** The product must notify the Owner synchronously when this event occurs — turning what would otherwise be a passive wait (the Owner refreshing a dashboard, unsure if anything happened) into a designed, positive moment. This document does not specify the mechanism (push, email, in-app); it specifies that the moment is a first-class product requirement, not an implementation footnote. This requirement exists because the wait between "invitation sent" and "invitation accepted" is genuinely a moment of suspense for the Owner (Section 20, Phase 6), and a product that leaves that suspense unresolved wastes its own best emotional beat.

**What First Value is not, and this is the load-bearing distinction of the whole document:** proof that the Owner will keep using Forge. One Member joining once is real, meaningful evidence the product *works* — it is not evidence the Owner will *run their gym* on it. That stronger claim is Activation, defined next, deliberately as a separate, later, harder-to-reach threshold.

---

# 8. Activation

**Activation is:** the Owner returning to Forge on a day separate from their initial setup and First Value, to perform a genuine gym-operating action — inviting a second Member, managing the roster, publishing a schedule change, reviewing who accepted an invitation, or any other real use of the product beyond the one-time configuration burst of getting started.

This is deliberately a **return-behavior** definition, not a single-event one, for a precise reason: no single action — however meaningful it feels in the moment — reliably distinguishes "an Owner who is going to run their business on Forge" from "an Owner who tried it once." Only a genuine return, on the Owner's own initiative, on a separate day, does that. This is Principle 3.16 applied to its own most important case.

**Why this is not the same milestone as First Value (Section 7), even though the original draft of this document treated them as one:** First Value can be reached by one real but low-effort action — sending one invitation to one person who happens to accept it. That is sufficient to prove the *mechanism* works. It is not sufficient to predict the Owner will *keep* using it; an Owner who invites one friend as a courtesy and never opens the product again reached First Value and never activated. Collapsing the two concepts either overstates what a single accepted invitation proves, or — if the bar is raised to compensate — delays "activation" so long that the document's own speed mandate (get an Owner to proof of value fast) is undermined. Keeping them separate lets each be optimized correctly: Section 7 is optimized for *speed*; Section 8 is optimized for *evidence*.

**Deliberately not defined as a specific downstream feature action** (a booking, an attendance check-in, a logged workout): each of those is real usage for *some* Owner segments and structurally unreachable, or biased, for others — booking-based activation would systematically under-count 4.4's open-access traditional gym; workout-logging-based activation would systematically under-count 4.3's non-CrossFit boutique studio. A return-behavior definition is the one formulation that is portable across every Owner profile in Section 4 without privileging one gym type's workflow over another's.

**This definition is explicitly provisional (Principle 3.17).** It is this document's best reasoned answer at a stage where Forge has no real trial-cohort retention data to test it against. It should be revisited, not defended indefinitely, once that data exists — see Section 20.

**What replaces onboarding scaffolding, and when, given the two-tier definition:**
- At **First Value**, the Activation Checklist (Section 12) collapses into a lighter "Getting Started" panel holding only remaining optional items — the Owner now has a real, populated product to look at, so the full checklist's job is mostly done.
- At **Activation**, onboarding scaffolding is retired for that Gym entirely, replaced permanently by the Owner's real operating dashboard (roster, upcoming classes, recent activity). This later trigger is deliberate: switching fully into "you're all set up and running" framing after a single accepted invitation would be premature — the product should keep gently surfacing next steps until real, repeated engagement is actually observed.

---

# 9. Owner Account & Email Verification

**When the account is created:** at the first form submission (email, password, Gym name captured together — Section 10) — creating the account is cheap and reversible, so it happens immediately rather than being gated behind anything.

**When email verification is required:** immediately after, before anything consequential. This is a deliberate, explicit divergence from the Member Domain's own M9.1 decision to remove email-OTP verification for Members. That decision was correct *for Members* specifically because a Member's identity is already vouched for by an Admin who deliberately invited a known address — the invitation itself is the trust signal. An Owner has no equivalent vouching party: they are the *first* trust boundary Forge establishes for an entire Gym, and everything downstream (who can invite Members, who controls billing, who is legally represented as the account holder) depends on that identity being real. The two decisions are not in tension; they are the same principle (verify proportional to what is actually at stake) reaching different, correct conclusions for two different parties.

**Should verification block access?** No — the Owner may begin exploring, may even begin the Gym-creation form, without being stopped (Principle 3.15). Blocking too early adds friction before any commitment has been asked for, violating Section 3.4.

**Should verification block payment?** Trivially yes, but moot — per Section 14, payment is not part of this journey until far later, by which point verification has long since happened.

**Should verification block activation?** It blocks First Value directly and Activation transitively: reaching First Value requires an invitation to have been sent under the Owner's identity, and sending a real invitation is exactly the kind of consequential action Section 3.11 gates. This is not a separate rule — it falls directly out of the two principles already stated.

---

# 10. Gym Creation

**Minimum required information:** a Gym name. Nothing else is required to produce the one thing every downstream domain needs — a `gym_id` with an Admin attached to it.

**Maximum allowed friction:** one field, on the same screen as account creation (Section 9) — not a separate step. Splitting "create your account" and "name your gym" into two sequential screens would be friction spent for no benefit (Section 3.4): both pieces of information are captured before any async gate (email verification) is even reached, so there is no reason for them to be two screens instead of one form.

**Everything else** — branding, additional Plans, class schedule, payment connection — is explicitly deferred to the Activation Dashboard (Section 12), where it belongs as optional, not as a blocked prerequisite to having a Gym at all (Principle 3.9).

---

# 11. Setup Experience: Wizard vs. Activation Checklist

Both were compared directly on psychology, not on ease of building — the choice is proven here, not assumed, and the Section 20 review specifically re-examined this decision against momentum, cognitive load, discoverability, flexibility, maintainability, recoverability, and resumability.

**Where a wizard genuinely wins:** momentum. A forced, visible sequence ("2 of 5 done") manufactures forward pull that a self-directed checklist does not automatically provide — an Owner facing an unordered list can just as easily complete the easiest optional item and stop as tackle what actually matters. This is a real cost of the checklist shape, not a dismissible one, and it is why Section 12's checklist is not left as a flat, unordered list (see below).

**Where a checklist wins, decisively and structurally, not just stylistically:** the Owner lands in the real product immediately rather than a form sequence divorced from it (cognitive load, discoverability, flexibility, maintainability all favor this, as argued in the original draft). But the single sharpest argument is this: **Section 8's Activation event is, by definition, dependent on another person's action on their own schedule** — an invited Member choosing when to accept. A linear wizard cannot contain that as a blocking "Next" step without either stalling the Owner indefinitely mid-sequence, or ending the wizard early and handing off to some other surface anyway — at which point a second UI (a checklist, in practice) has been built for the tail of the journey regardless. A wizard is not merely a worse fit here; it is **structurally incapable** of containing the one step this entire document is built around. That is decisive on its own, independent of every softer argument.

**Resumability** also favors the checklist unambiguously (Principle 3.14): checklist items are independent and idempotent, always resumable in any order, with no "abandoned mid-wizard, unclear state" failure mode to design around.

**Decision, reaffirmed: Activation Checklist — with one concession to the wizard's real strength.** To recover the momentum a pure, unordered checklist would otherwise lose, Section 12 specifies a **recommended order with progressive disclosure**, not a flat list: required items are visually primary and lightly sequenced by suggestion, optional items are present but visually secondary, and a dependency (Waiver before invitation) is explained inline rather than silently enforced. This is not a retreat toward a wizard — it borrows the wizard's one genuine advantage without adopting the structural flaw (Section 8's async dependency) that disqualifies it outright.

This also directly answers 4.4's concern (Section 4, Section 20 Phase 1): a less technical Owner is not left with a bare, unguided list — the recommended order and inline "why" explanations exist specifically to substitute for a wizard's hand-holding without inheriting its gating shape.

---

# 12. Activation Dashboard

**Required tasks**, shown in a recommended order (Section 11), each justified against what the product cannot function without (Principle 3.4):
1. **Confirm your Waiver / Gym Rules.** Pre-filled from a standard starting template the Owner reviews and confirms rather than composes from a blank page — reducing effort without removing the requirement, since a Waiver is a real liability document a generic default cannot responsibly stand in for unmodified. Already a hard backend requirement for any Member to complete M9 onboarding; the checklist surfaces this honestly rather than letting an Owner discover it by trial and error the first time an invitation fails.
2. **Invite your first Member.** The action that leads to First Value (Section 7).

**No longer required, revised from the original draft:** a Membership Plan is **auto-created with a sensible default** (a single, clearly-labeled starter Plan) at Gym creation, rather than demanded as a manual step before an Owner can invite anyone. Per Principle 3.4, the *exact* price does not need to exist before a first invitation goes out — M9's own Final Commit produces a Member, a Membership, and a Waiver acceptance with **no automatic Subscription** (frozen Financial Domain behavior, unchanged and unaffected here). Asking a brand-new Owner to make a real pricing decision before they have seen the product work is exactly the kind of premature-commitment friction Section 3.4 exists to catch. "Customize your pricing" moves to the optional list below.

**Optional tasks**, visible, explicitly labeled optional, never blocking anything:
- Customize your default Membership Plan, or add additional ones
- Upload a logo / branding
- Invite a co-admin or coach
- Connect online payments for Members
- Set up a class schedule

**Dependency, shown inline, not as a hard gate:** "Invite your first Member" carries a clear, specific reason ("Confirm your Waiver first") if attempted before its one remaining prerequisite exists — guidance, not a disabled, unexplained button, and never a separate wizard screen.

**When it changes, in two stages (Section 8):** at First Value, the checklist collapses into a lighter "Getting Started" panel holding the remaining optional items. At Activation — genuine return behavior, not the same event — onboarding scaffolding retires permanently, replaced by the Owner's real operating dashboard.

---

# 13. Trial Strategy

**Trial or no trial:** trial. Per Principle 3.5, the trial *is* the demo for a product this experiential — there is no substitute for an Owner watching a real Member move through M9 themselves.

**Length: 14 days.** Seven is too short for even one full CrossFit-style weekly cycle to repeat twice; thirty invites indefinite deferral at a stage where Forge specifically needs fast, real signal. Fourteen is the standard middle ground for exactly those two reasons, and it comfortably accommodates Section 4.6's pre-launch gym, who may need a few days of the window before their first real invitation is even possible.

**Card required: no.** Card-gated trials convert better per attempt but suppress top-of-funnel signups sharply — the wrong trade for a brand with no existing trust to spend (Section 6's honest positioning matters more than a card wall at this stage). This is explicitly a stage-appropriate decision, not a permanent one — revisit once Forge has real brand recognition and volume (Section 20 names this as an assumption to re-test, not a permanent conclusion).

**Exactly which event starts the countdown:** email verification succeeding (Section 9), not account creation, and deliberately not Gym creation or First Value either. Starting the clock before the Owner has even confirmed they control their own email would burn trial days on nothing; starting it later (at Gym creation, or worse, at First Value) would let an unverified or unconfigured trial sit indefinitely with no forcing function at all, which defeats the reason a time-bounded trial exists in the first place. Email verification is the earliest event that is both meaningful (a real commitment, not merely a page load) and unconditional (it does not reward stalling by waiting for it).

**Refinement from the Section 20 review:** trial communication (reminder emails, in-product urgency framing) must be paced by the Owner's actual progress relative to First Value and Activation, not by elapsed days alone. An Owner who has not yet reached First Value by day 10 needs different messaging than one who reached it on day 2 and has already returned twice — pure day-count messaging treats two very different situations identically and is explicitly rejected as the communication model, even though day-count remains the correct model for when the countdown itself starts and ends.

**What happens after expiry:** if First Value never occurred, the Gym and its configuration are preserved, not deleted — access is paused, not destroyed, so a late-returning Owner loses no setup work (Principle 3.9 holds even at the trial boundary). If First Value did occur, expiry becomes the hard payment prompt described in Section 14.

---

# 14. Payment

Every possibility is weighed, not assumed:

- **Before First Value:** rejected. Asking for payment before any value has been demonstrated inverts Section 7's entire premise.
- **Immediately, at signup:** rejected for the same reason, more severely — the worst option for an unrecognized brand.
- **After First Value, during the trial (soft prompt):** the correct *first* moment to surface an upgrade option — not forced, but contextually offered right when the Owner's own confidence in the product is highest, immediately after witnessing their first real Member join. This is anchored to First Value specifically (not Activation) because it is the moment of peak individual excitement — the right moment for a low-pressure mention, not the right moment to insist.
- **At trial expiry (hard prompt):** the correct backstop — required only if the Owner has not already self-initiated payment, and only after the full 14-day window, never earlier.

Payment is therefore never a step *in* the primary path (Sections 9-12) at all — it is deferred entirely out of that path and reintroduced at exactly two, well-justified moments afterward, tied to the two-tier value model in Sections 7-8 rather than to raw elapsed time.

---

# 15. SaaS Billing — An Independent Domain

**This is not an extension of the Financial Domain. It is a sibling domain, with its own boundary, referencing shared platform concepts but owning none of the Financial Domain's entities.**

### What it owns
- The commercial relationship between Forge and a Gym's Owner — a **Platform Subscription**, conceptually parallel to, but never the same table, mechanism, or webhook as, the Member Domain's own `Subscription`.
- Its own settlement history — Forge is the seller here, and the Owner is the buyer; the direction of money is the reverse of every transaction the Financial Domain already models.

### What it references, never owns
- **Gym** — the Platform Subscription's subject. Owned by the Member Domain, referenced only.
- **Owner/Admin identity** — the paying party. Same identity mechanism every other Forge identity uses (never a second auth system invented for one domain), referenced only.

### What it must never do
- Share a table, a webhook handler, a Stripe Customer graph, or a mental model with the Financial Domain's Order/Payment mechanism (Principle 3.7, non-negotiable).
- Be reachable from, or influence, anything about a Gym's own Members, their Subscriptions, Orders, or Payments.
- Be inferred from, or reconciled against, the Financial Domain's own revenue reporting — Forge's platform revenue and a Gym's member revenue are different businesses' books, even though both happen to run through Forge's infrastructure.

### Future scalability of this boundary
Scoping a Platform Subscription **per Gym, not per Owner**, is the specific design choice that lets Section 18's multi-location future arrive without redesign: an Owner with five Gyms naturally has five Platform Subscriptions, exactly mirroring how the Member Domain's own `members`-is-identity / `memberships`-is-per-Gym split already solved the identical shape of problem for people, not businesses. This is not a speculative parallel — it is the same architectural move, proven once already in Forge's own frozen history, applied here deliberately rather than reinvented.

### Why this boundary is drawn now rather than deferred
A domain *boundary* costs nothing to state today — it is a rule about what must never share a mechanism, not a mandate to fully build a second billing system before it is needed. It is deliberately established now, ahead of the implementation it constrains, because untangling two billing concerns that were allowed to merge under time pressure is expensive in exactly the way stating a boundary in advance is not (Section 20, Phase 1, Weakness 4).

---

# 16. Integration Verification

- **Member Domain:** unaffected. This domain produces a `Gym` and its first `Admin`; M9's invitation mechanism is reused for the Owner's first Member invitation exactly as it exists today, unmodified.
- **Financial Domain:** unaffected, and permanently separated from this domain's own billing concern (Section 15).
- **Invitation Flow:** reused verbatim. This document does not add a second invitation mechanism.
- **Membership Plans, Waivers:** this domain's checklist (Section 12) guides an Owner *to* the already-built management surfaces for both; it does not rebuild them.
- **Programming, Classes, Bookings, Attendance, Leaderboards, Reports:** already built, already multi-tenant, already `gym_id`-scoped, already proven against real usage. None of them require any change for a new Gym to use them — they become available the instant a `gym_id` exists, which is this domain's entire output. This document is therefore not "laying groundwork" for these systems in any technical sense; it is removing the acquisition-funnel gap that currently prevents a new Gym from reaching them at all.
- **Future AI modules:** no dependency identified in either direction; any future AI capability operates within an already-active Gym, downstream of everything this document produces.

---

# 17. Anti-Patterns

Forge must never:

- Ask a Member to search for a gym or enter a gym code. (Frozen, restated, non-negotiable.)
- Expose an invitation token or gym-join mechanism publicly or make either guessable.
- Force an Owner through a setup step the product does not yet actually require (Principle 3.4) — including, as of the Section 20 review, forcing a manual pricing decision before a first invitation can be sent (Section 12).
- Gate an Owner's own dashboard access behind payment while a trial is still active.
- Let the Owner Activation journey write to, or depend on, any Member-facing mechanism other than by invoking the exact, unmodified M9 mechanisms every other invitation already uses.
- Invent a second authentication system for Owners distinct from the one every other Forge identity already uses.
- Let SaaS Billing and Member Billing share a table, a webhook, or a mental model (Section 15, restated because it is the single easiest boundary to accidentally erode under implementation time pressure).
- Require a fully-configured Gym before an Owner can send their first real invitation — over-gating directly trades away the speed both Section 7 and Section 8 depend on.
- Treat account creation or Gym creation as First Value or as Activation (Sections 7-8, restated because it is the single most common mistake this kind of document exists to prevent).
- Treat a single accepted invitation as proof of durable engagement (Principle 3.16) — that overclaims what First Value actually establishes.
- Let trial communication be paced by elapsed days alone, ignoring whether the Owner has reached First Value or Activation (Section 13).
- Build multi-location, franchise, or sales-led enterprise capability speculatively, before a real, concrete need for it exists — while simultaneously never designing the single-Gym, self-serve Owner unit in a way that would require rebuilding it when that need arrives (Section 15's Platform-Subscription-per-Gym choice is precisely how both halves of this are satisfied at once).

---

# 18. Future Scalability

- **Multi-location / franchise (self-serve growth path):** already accommodated by scoping the Platform Subscription per Gym (Section 15) and by Principle 3.12 — an Owner activating a second Gym repeats Sections 9-12 exactly, with a pre-verified identity already in place, shortening the journey rather than complicating it.
- **Enterprise organizations and franchise systems as a *buying motion*, explicitly out of scope here:** the Section 20 review surfaced a real gap in the original draft — this document had implicitly assumed one journey shape serves every future buyer, when in fact enterprise and franchise customers typically buy through a fundamentally different, sales-led motion (custom terms, multi-stakeholder approval, provisioning by a Forge team member rather than self-service). This document does not design that motion. What it does guarantee is that nothing here *precludes* it: the same Gym-scoped Platform Subscription and the same minimal Gym-creation shape (Section 10) can be provisioned by a human on the Owner's behalf exactly as they would be self-service, without inventing a second Gym concept. The self-serve journey this document defines is one buying motion, not the only one Forge will ever have.
- **Additional languages:** already proven at the Member level (M9's own per-person language preference, `members.language`); the Owner-facing surface should follow the identical, already-established convention rather than a new one.
- **Additional countries/currencies:** the Financial Domain already records currency per Order and per Payment without assuming cross-currency arithmetic (its own documented non-goal, deliberately deferred there). This domain's own Platform Subscription should follow the identical convention — currency recorded per subscription/payment, no conversion logic assumed — reusing an already-established pattern rather than inventing a new one.
- **Additional payment providers:** Section 15 already isolates SaaS Billing from the Member Financial Domain; a second payment provider for either domain is an additive value in an existing field (mirroring the Financial Domain's own documented extension rule for its Payment method vocabulary), never a structural change to this document.
- **AI automation, marketplace, API ecosystem:** no dependency identified in either direction at this horizon. The one item worth naming as a future watch, not a design constraint: a marketplace or agency model could eventually introduce a third party (someone managing multiple Owners' accounts on their behalf) — noted here so a future revision is not surprised by it, not designed for now, per this document's own discipline against speculative building (Principle 3.4's spirit applied to the document itself).

---

# 19. What Changed From the Original Draft

Recorded plainly, because a frozen document that hides its own revision history is less trustworthy than one that shows its work:

- **Removed:** the claim that First Value and Activation are the same event. This was the single most significant revision in this document's history (Section 20, Phase 2).
- **Removed:** a required, manually-configured Membership Plan as a precondition to inviting a first Member (Section 12) — replaced by an auto-created default.
- **Simplified:** the Waiver requirement remains mandatory but is now template-assisted rather than composed from a blank page.
- **Simplified:** the Wizard-vs-Checklist argument (Section 11), from a stylistic/philosophical case to a structural one — a wizard cannot contain an externally-dependent step at all, which is decisive on its own.
- **Postponed:** any design for an enterprise/franchise sales-led buying motion — explicitly named as future, out-of-scope work (Section 18) rather than silently assumed to be covered by the self-serve journey.
- **Added:** the Owner-notification requirement at First Value (Section 7), the progress-paced trial communication requirement (Section 13), and five new permanent principles (3.13-3.17).
- **Fixed:** a number of internal cross-references in the original draft pointed at the wrong section (a symptom, not a cause, of drafting the document non-linearly) — corrected throughout as part of this revision, and named here rather than silently patched, because an architecture document with broken internal citations was not actually ready for freeze regardless of how sound any individual section read in isolation.

---

# 20. Final Architecture Review & Freeze Record

This section records a deliberately adversarial second review, conducted after the original draft, with an explicit mandate to reject the document rather than defend it. Its conclusions changed real content above; it is not a formality appended after the fact.

### Phase 1 — Self-critique

The most serious weakness found was not a missing consideration but a piece of circular reasoning: the original Section 8 justified First Value = Activation by citing the document's own Mission statement, rather than independently testing whether the two concepts actually coincide. That is a document agreeing with itself, not an architectural proof. A second, related weakness: the original activation metric ("first invitation accepted") was chosen for being the *earliest* available proof point without being tested against the actual question that matters commercially — which event best predicts an Owner keeps using Forge. Earliest and most-predictive are not the same property, and the original draft conflated them. A third, more mechanical weakness: internal section cross-references had drifted from the actual section numbers in several places, a direct consequence of the document having been drafted non-linearly and not re-checked — corrected throughout (Section 19).

### Phase 2 — First Value vs. Activation

Reasoned independently, not assumed: **they are not the same milestone, and should not be.** An Owner can reach First Value (Section 7) through a single, real but low-effort action — one invitation, accepted once — which proves the mechanism works but does not predict continued use. Activation (Section 8) is redefined as return behavior: the Owner coming back, on a separate day, to do something beyond initial setup. This resolves the "gameable metric" weakness from Phase 1 as a direct structural consequence, not through better detection logic: a one-off test invitation naturally fails to produce a genuine return, so it reaches First Value without ever reaching Activation, which is the correct outcome.

### Phase 3 — The activation metric, compared against alternatives

Every candidate named in the review request was evaluated against "best predicts continued use," not "earliest available": Gym/Plan/Waiver creation carry no engagement signal at all. First invitation sent proves intent, not outcome. First invitation accepted (the original definition) proves the mechanism works but not that the Owner will return — it became this document's definition of First Value, not Activation. First booking, attendance, or logged workout are all real signals but are structurally biased toward specific Owner segments (booking- and workout-logging-centric gyms) and would systematically under-count the traditional-gym and non-CrossFit-studio profiles named in Section 4 — rejected as the canonical metric for that reason, not because they are meaningless. A return-behavior definition, portable across every profile, was the one formulation found that avoids this bias while still requiring more than a single event.

### Phase 4 — Checklist vs. Wizard, on psychology

Re-examined on the specific dimensions requested. Wizard wins only on momentum. Checklist wins on cognitive load, discoverability, flexibility, maintainability, and resumability — and wins decisively, not marginally, on a dimension the original draft under-argued: a wizard is structurally incapable of containing Section 8's externally-dependent step at all. The recommendation stands, strengthened, with one concession imported from the wizard (a recommended order with progressive disclosure, Section 11) to recover the momentum a flat checklist would otherwise sacrifice.

### Phase 5 — Onboarding friction, re-audited

One required step was found to be removable outright: a manually-configured Membership Plan does not need to exist before a first invitation can be sent, because M9's Final Commit does not require a Subscription at all. Replaced with an auto-created default (Section 12). The Waiver requirement survives — it is a real liability document, and a silent, un-reviewed default would carry more risk than the friction of requiring confirmation — but its authoring burden is reduced via a starting template.

### Phase 6 — Owner emotion, mapped

The most significant gap found: the wait between sending an invitation and it being accepted is a real, designed-for-nothing moment of suspense in the original draft — the product simply expected the Owner to notice a changed dashboard eventually. Corrected by making Owner notification at First Value a first-class requirement (Section 7), not an implementation afterthought, turning passive dead time into a deliberate, positive reveal.

### Phase 7 — Trial start event, re-argued

Compared against Gym creation, first login, and First Value as alternative start events. Starting later than email verification (e.g., at First Value) was seriously considered and rejected: it would let an unverified or unconfigured trial sit with no clock running at all, which defeats the reason a time-bounded trial exists. Email verification remains correct as the start event; the real improvement found was not to the start event but to trial *communication*, which must be paced by progress toward First Value and Activation, not by elapsed days alone (Section 13).

### Phase 8 — Scalability, stress-tested

The architecture holds structurally at 10,000-100,000 Gyms and for AI/marketplace/API expansion — nothing in this document assumes a shared bottleneck across Gyms. The genuine gap found was conceptual, not technical: the original draft implicitly assumed one self-serve journey shape would also serve enterprise and franchise buyers, without ever stating that assumption or testing it. Corrected by explicitly naming the self-serve motion this document defines as one buying motion, not the only one, and moving enterprise/franchise sales-led onboarding to a named, acknowledged, out-of-scope future concern (Section 18) rather than a silent gap.

### Phase 9 — Missing principles

Five were added (3.13-3.17), each traceable to a specific weakness found in Phases 1-8 above rather than added generically: Trust-or-Activation as the general test every step must pass; resumability as a first-class, permanent guarantee; configuration never blocking exploration; the rejection of single-event engagement proof; and the explicit, permanent acknowledgment that the activation metric itself is a hypothesis pending real data, not a settled fact.

### Phase 10 — Freeze test

Asked honestly: before this review, the answer was **no** — the First Value/Activation conflation and an activation metric justified by circular reference to the document's own Mission statement were real, freeze-blocking weaknesses, not stylistic concerns. After the revisions recorded in this section and reflected throughout Sections 1-18, the answer is **yes**. The document's remaining open items (Section 3.17's provisional metric, Section 18's acknowledged enterprise-motion gap) are named, bounded, and deliberately deferred — not hidden weaknesses discovered too late to fix, but scoped boundaries a frozen document is allowed to have.

---

**Final verdict: APPROVED FOR FREEZE.**
