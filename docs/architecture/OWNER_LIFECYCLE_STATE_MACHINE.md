# Forge Owner Lifecycle State Machine

This document defines the canonical, permanent state machine governing a Gym Owner's lifecycle on Forge. It is a companion to `OWNER_ACTIVATION_ARCHITECTURE.md` (frozen), which it does not redesign, extend the scope of, or reinterpret — it operationalizes it. Where that document defines *what First Value and Activation mean and why*, this document defines *the complete set of states an Owner can be in, and the complete set of legal ways to move between them*, so that every future module (billing, CRM, marketing automation, analytics, support tooling) can reason about "what state is this Owner in" against one shared, unambiguous answer instead of inventing its own.

**This is not a database schema.** No table, column, or migration is implied by anything here. It is a product/behavioral contract: entry conditions, exit conditions, allowed actions, and visible product behavior per state. Implementation is free to represent this however it needs to; it is not free to disagree with what a state *means*.

**Status: proposed for freeze — see Section 9 for the adversarial self-review and final verdict.**

---

## 1. Modeling Rule: State vs. Event

Before any state is defined, one rule governs the entire document, because the request that produced this document names several things ("Trial: Started," "Reactivated") that read as states but do not behave like states on inspection:

> **A STATE has duration.** An Owner remains in it for a measurable span of time, and it owns its own entry criteria, exit criteria, allowed/blocked actions, UI, and messaging.
> **An EVENT is instantaneous.** It has no duration, owns no "allowed actions" of its own, and its only architectural job is to *trigger a transition* between two states.

Treating an instantaneous occurrence as if it were a durable state produces a **zero-duration pseudo-state** — a box on the diagram that is entered and exited in the same instant, which cannot have meaningfully different "allowed actions" from the state it immediately enters. That is a direct violation of this document's own "no overlap, no ambiguity" mandate. Three specific corrections follow from this rule, each flagged explicitly rather than silently applied:

- **"Trial: Started"** is the EVENT (email verification succeeds), not a state. The state it enters is **Trial: Running**.
- **"Reactivated"** is the EVENT (a Cancelled or Expired Owner pays again), not a state. The state it enters is **Paying** — the same state a first-time conversion enters. The distinction between a first-time and a won-back customer is preserved in the **event name** (`subscription_reactivated` vs `subscription_converted`), which is what CRM/marketing needs — it does not need a different *product* state, because the product behaves identically either way.
- **First Value and Activation** (Sections 7–8 of the frozen document) are each **both** an event and a state, in the standard FSM sense: the *event* (a qualifying Member completes M9; the Owner returns and performs a real action) *triggers entry into* a *state* (First Value Reached; Activated) that the Owner then durably occupies. This resolves the frozen document's own open question precisely — see Section 4.

---

## 2. Architecture Decision: Two Independent Axes, Not One Chain

The request frames this as a single lifecycle. It is not one — and forcing it into one is the single biggest risk this document identifies and rejects. An Owner's **engagement with the product** (have they seen it work? do they keep coming back?) and an Owner's **commercial relationship with Forge** (are they paying?) are different questions that change on different triggers, at different speeds, and — critically — **must never be coupled into one mechanism**, per `OWNER_ACTIVATION_ARCHITECTURE.md` Principle 3.7 and Section 15's permanent SaaS-Billing/Activation boundary.

Collapsing them into one chain produces real, concrete bugs, not just theoretical untidiness:

- An Owner who reaches Activation and then cancels their subscription **did not un-activate**. Their engagement history is real and permanent. A single-chain model would force a choice between "regress them to an earlier engagement state" (factually wrong — they proved engagement, that fact doesn't disappear) or "leave them stuck in 'Activated' forever with no way to represent that they've also churned" (loses real, needed commercial information). Two axes resolve this without contortion: **Activated (engagement axis) × Cancelled (commercial axis)** is simply a valid, nameable combination — the "activated churner" cohort, which needs different win-back messaging than an Owner who never engaged at all.
- An eager Owner can pay Forge before ever reaching First Value. Real, valid, and must not be treated as an FSM error. Two axes make this a plain combination (**Onboarding × Paying**) rather than an impossible state.

This document therefore defines **two independent state machines** — the **Activation Lifecycle** (Section 3) and the **Commercial Lifecycle** (Section 5) — plus the explicit rules for how they combine (Section 6) and a single cross-cutting terminal state that can end either (Section 7).

---

## 3. Axis A — Activation Lifecycle

Scoped **per Gym**, not per Owner account (Section 8 makes this scoping rule explicit and non-negotiable). Monotonic: this axis never moves backward. Once a fact is true (a real Member joined; the Owner genuinely returned), it stays true regardless of anything that happens afterward on the commercial axis.

### A1 — Unverified

| | |
|---|---|
| **Purpose** | Owner has submitted credentials Forge cannot yet trust. |
| **Entry criteria** | Signup form submitted (email + password + Gym name, per frozen Section 9–10). |
| **Exit criteria** | Email verification succeeds → **A2**. (No other exit. No timeout-based auto-exit in v1 — see Section 9 self-review.) |
| **Allowed actions** | Browse marketing/product pages; begin filling the Gym-creation form (not yet consequential, per Principle 3.15); resend verification email. |
| **Blocked actions** | Sending any real invitation; connecting payment; anything with a real-world consequence (Principle 3.11). |
| **Visible UI** | "Verify your email" prompt/banner. |
| **Emails** | Verification email (immediate); one reminder if unverified after 24h. |
| **Notifications** | None — no verified channel exists yet. |
| **Analytics events** | `owner_signup_submitted` |
| **Success metric** | % reaching A2 within 1 hour of signup. |
| **Failure modes** | Verification email lost to spam/deliverability issues (a real, previously-audited risk for this domain); Owner never returns — expected attrition, not an FSM defect. |

### A2 — Onboarding (Pre-First-Value)

| | |
|---|---|
| **Purpose** | Verified Owner setting up their Gym and working the Activation Checklist; First Value has not yet occurred. |
| **Entry criteria** | Email verification succeeds. **This same event also fires `Trial: Started` on the commercial axis** — the one deliberate, explicitly-named coupling point between the two axes (Section 6). |
| **Exit criteria** | First Value event fires → **A3**. No other exit exists on this axis — expiry of the trial does *not* move an Owner off A2; it is purely a commercial-axis transition (Section 6). |
| **Allowed actions** | Confirm/edit Waiver; invite Members; everything in the Activation Checklist (frozen Section 12). |
| **Blocked actions** | None beyond what A1 already blocked and A2 has already satisfied by verifying. |
| **Visible UI** | Activation Checklist, in the recommended-order/progressive-disclosure shape (frozen Section 11–12). |
| **Emails** | Welcome email; checklist nudges; trial-progress emails — paced by *this* state, since First Value hasn't happened yet (frozen Section 13's messaging refinement). |
| **Notifications** | None — nothing checklist-worthy has happened yet. |
| **Analytics events** | `gym_created`, `waiver_confirmed`, `first_invitation_sent` |
| **Success metric** | Median time from A2 entry to First Value. |
| **Failure modes** | Invitation sent, never accepted — the Owner can be genuinely stuck here indefinitely. This is a real, identifiable, *named* failure mode (not silent drop-off) and warrants its own nudge ("your invite is still pending"), distinct from the generic checklist nudge. |

### A3 — First Value Reached

| | |
|---|---|
| **Purpose** | The Owner has undeniable, third-party evidence the product works (frozen Section 7). Return engagement has not yet been demonstrated. |
| **Entry criteria** | First Value event fires: a genuinely distinct, non-test Member completes M9 Final Commit for this Gym. |
| **Exit criteria** | Activation event fires → **A4**. No other exit — irreversible, monotonic. |
| **Allowed actions** | Everything. |
| **Blocked actions** | None. |
| **Visible UI** | Checklist collapses to a lightweight "Getting Started" panel holding only remaining optional items (frozen Section 8). First-Value celebration moment is shown. |
| **Emails** | "Your first member joined" notification (frozen Section 7's mandatory notification requirement); soft payment-prompt becomes eligible to show from this point on (frozen Section 14). |
| **Notifications** | The synchronous First-Value notification itself — the one mandatory, marked moment in the whole journey. |
| **Analytics events** | `first_value_reached` |
| **Success metric** | % of A3 owners who reach A4 before the trial resolves. |
| **Failure modes** | An Owner reaches A3 via one low-effort invitation to a friend and never returns — real, expected, and *the exact reason A4 is a separate, later state* (frozen Section 8's design intent). This cohort must be visible in reporting as "reached First Value, did not activate," never silently folded into "activated." |

### A4 — Activated

| | |
|---|---|
| **Purpose** | The Owner has demonstrated durable, return-initiated engagement — the strongest engagement signal this domain defines. |
| **Entry criteria** | Activation event fires: the Owner returns on a day separate from setup/First Value and performs a real operating action (frozen Section 8). |
| **Exit criteria** | **None on this axis.** Permanent, monotonic status. It does not mean "active this week" — that is Retention, deliberately kept out of this FSM (Section 4). |
| **Allowed actions** | Everything. |
| **Blocked actions** | None. |
| **Visible UI** | Full operating dashboard; onboarding scaffolding fully and permanently retired for this Gym. |
| **Emails** | Standard lifecycle emails (features, billing) replace the "getting started" drip sequence. |
| **Notifications** | Standard product notifications only — no special Activation-specific notification (the marked moment already happened at A3; Activation is confirmed quietly by returning, not celebrated a second time, since manufacturing a second "big moment" out of ordinary usage would cheapen the first one). |
| **Analytics events** | `activated` |
| **Success metric** | % of trials reaching Activated — this is this domain's core, top-line success metric. |
| **Failure modes** | None specific to entering this state. What happens to an Activated Owner's product *usage* afterward is Retention (Section 4), not a failure mode of this FSM. |

---

## 4. First Value, Activation, and Retention — Direct Answers

**Is First Value a state or an event?** Both, precisely: the *event* is "a qualifying Member completes M9," and it triggers entry into the *state* A3. There is no meaningful sense in which "First Value" needs to be a standalone state distinct from A3 — A3 *is* the state First Value produces. It begins the instant the qualifying Final Commit succeeds and ends the instant the Activation event fires.

**Is Activation a state, an event, or a milestone?** All three, and that is not a hedge: "milestone" is the product-language name for the pairing of the *event* (qualifying return action) and the *state* it produces (A4), exactly as "First Value" names the A3 pairing. Calling it only an event would lose the fact that, once true, it stays true. Calling it only a state would lose the fact that a specific, detectable action is what causes entry into it.

**Does Retention belong in this state machine, or is it purely analytics?** **Purely analytics — deliberately excluded from the FSM.** Retention has no clean entry/exit criteria of its own: it is a continuous, rolling measure ("used the product in the last N days"), not a discrete condition an Owner is definitively "in" or "not in" the way A3 vs A4 is definitive. Modeling it as a state would require an artificial threshold (how many days of inactivity flips it?) that adds a state transition with no product decision attached to it — no email, no UI change, no blocked action hangs off "became less retained" the way real ones hang off every state above. Retention is computed *from* this FSM's event stream (frequency of return visits after A4, specifically) — it consumes the FSM, it does not extend it. This is also the direct, practical answer to Principle 3.17 (frozen document): Retention data, once it exists, is what validates or invalidates whether A4's specific trigger condition is actually the right one — the FSM produces the data that later judges the FSM's own design.

---

## 5. Axis B — Commercial Lifecycle

Also scoped per Gym (Section 15 of the frozen document scopes the Platform Subscription per Gym; this axis mirrors that exactly, not by convention but because it *is* the Platform Subscription's own status).

### B2 — Trial: Running

| | |
|---|---|
| **Purpose** | Full product access under trial terms; commercial clock counting down. |
| **Entry criteria** | `Trial: Started` event (email verification succeeds — same instant as A2's entry). |
| **Exit criteria** | Days-remaining crosses the "ending" threshold → **B3**. Clock reaches zero with no payment → **B4**. Owner pays at any point → **B5**. |
| **Allowed actions** | Full self-serve access — nothing is commercially gated during an active trial. |
| **Blocked actions** | None. |
| **Visible UI** | Subtle trial-days-remaining indicator. |
| **Emails/notifications** | Paced jointly by this state **and** the Activation axis (frozen Section 13) — the one other deliberate cross-axis coupling this document defines (Section 6). |
| **Analytics events** | `trial_started` |
| **Failure modes** | None unique. |

### B3 — Trial: Ending

| | |
|---|---|
| **Purpose** | Final days of the trial window — exists solely to justify more urgent, more specific messaging, never to change access. |
| **Entry criteria** | Days remaining falls at or below a configured threshold (e.g., 3 days — a tuning parameter, not an architectural commitment). |
| **Exit criteria** | Clock reaches zero with no payment → **B4**. Owner pays → **B5**. |
| **Allowed/Blocked actions** | Identical to B2 — this state changes messaging only, never access. |
| **Visible UI** | Prominent trial-ending banner; upgrade CTA surfaces. |
| **Emails/notifications** | Urgency-paced reminders, content differentiated by Activation-axis position: an Owner at A3/A4 gets "keep the momentum going"; an Owner still at A2 gets "you haven't invited your first member yet" — genuinely different content, not merely different tone (frozen Section 13). |
| **Analytics events** | `trial_ending_entered` |
| **Failure modes** | Owner ignores it entirely — expected, tracked, not an FSM defect. |

### B4 — Expired

| | |
|---|---|
| **Purpose** | Trial window closed with no payment ever captured. |
| **Entry criteria** | Trial end date reached while still in B2 or B3. |
| **Exit criteria** | Owner pays, any time later, no deadline → **B5**. |
| **Allowed actions** | None functional. Gym configuration is preserved, never destroyed (Principle 3.9's spirit, extended to this axis). |
| **Blocked actions** | Day-to-day product usage — classes, bookings, invitations. **This is the first state in either axis where real functional access is blocked**, and it is worth naming explicitly: only the commercial axis ever blocks usage; the engagement axis never does. |
| **Visible UI** | Hard paywall / "reactivate your account" screen. |
| **Emails** | Win-back sequence, framed as "start your subscription" (they never paid). |
| **Notifications** | None — Owner isn't actively using the product. |
| **Analytics events** | `trial_expired` |
| **Success metric** | Win-back rate at 30/60/90 days. |
| **Failure modes** | Permanent abandonment — a common, expected, non-defective outcome. |

### B5 — Paying

| | |
|---|---|
| **Purpose** | Active, in-good-standing Platform Subscription. |
| **Entry criteria** | Successful payment captured, from B2, B3, B4, or B7 (Cancelled). |
| **Exit criteria** | Payment failure → **B6**. Explicit cancellation → **B7**. |
| **Allowed actions** | Everything, no restriction. |
| **Visible UI** | Normal product; billing settings available. |
| **Emails** | Receipt on entry; standard renewal-cycle emails thereafter (mechanism owned by frozen Section 15, not re-specified here). |
| **Analytics events** | `subscription_converted` on first-ever entry; `subscription_renewed` on each subsequent cycle (same state, re-entered — not a new state); `subscription_reactivated` when entered from B7 or B4 specifically, so CRM can distinguish a won-back customer from a first-time one without the product needing a different state for it. |
| **Failure modes** | None on entry; ongoing risk is B6. |

### B6 — Past Due

| | |
|---|---|
| **Purpose** | A payment attempt failed; grace window before real consequences. |
| **Entry criteria** | Payment failure on an active B5 subscription. |
| **Exit criteria** | Retry succeeds → **B5**. Grace period elapses with no successful payment → **B7**. |
| **Allowed actions** | Full access continues through the grace period — an Owner is not punished the instant a card fails (mirrors Principle 3.9: an imperfect state is normal, not an error to react to harshly). |
| **Visible UI** | Non-blocking "update your payment method" banner. |
| **Emails** | Dunning sequence (mechanism owned by Section 15). |
| **Analytics events** | `payment_failed` |
| **Success metric** | % recovered without reaching B7. |
| **Failure modes** | Card genuinely dead and Owner never notices the banner → cascades to B7. |

### B7 — Cancelled

| | |
|---|---|
| **Purpose** | No active Platform Subscription, and not in a trial. |
| **Entry criteria** | Explicit Owner-initiated cancellation from B5, **or** grace period exhausted from B6. |
| **Exit criteria** | Owner pays again, any time → **B5** (as a `subscription_reactivated` event, per B5's notes above). No other exit. |
| **Allowed actions** | None functional. Gym data preserved, never destroyed as a consequence of cancellation. |
| **Blocked actions** | Full product access. |
| **Visible UI** | Reactivation screen. |
| **Emails** | Win-back sequence, framed differently from B4's — "come back, here's what's waiting for you" rather than "start your subscription," since this Owner has real history to reference. |
| **Analytics events** | `subscription_cancelled` |
| **Success metric** | Win-back rate. |
| **Failure modes** | Permanent churn — expected, not defective. |

**Explicit note on B5⇄B6 forming a cycle:** a bounded, legitimate cycle (fail → recover → possibly fail again later) is not a design flaw — real billing is inherently cyclical. It is called out here specifically so it is not mistaken for an unreviewed circular transition during the self-review in Section 9.

---

## 6. Cross-Axis Coupling and the Combination Matrix

Exactly **two** points of coupling exist between the axes, both already named above, and no others are permitted:

1. Email verification is a single event that fires both A2's entry and `Trial: Started` (B2's entry) simultaneously.
2. Trial/checklist messaging content (B2/B3) is chosen jointly using both axes' current state.

Everything else about the two axes is independent, which is what makes the following combinations all valid, nameable, and product-relevant rather than edge cases to suppress:

| | A1 Unverified | A2 Onboarding | A3 First Value | A4 Activated |
|---|---|---|---|---|
| **B2/B3 Trial** | only valid pairing pre-verification is A1 with *no* commercial state yet (trial can't start before verification) | normal trial journey | normal trial journey, moving toward A4 | rare but valid: activated before the trial even ends |
| **B4 Expired** | impossible (trial can't expire before it starts) | never invited anyone, or nobody accepted, before time ran out | **"engaged but didn't convert"** — real cohort, needs its own win-back message | activated within a trial window that has since lapsed on renewal terms not yet accepted — treat identically to A4×B7 below |
| **B5 Paying** | impossible | **eager converter** — paid before reaching First Value; must not be assumed Activated | converted after seeing value, before returning again | the expected, healthy end state |
| **B6 Past Due** | impossible | rare, real: payment failed while still pre-First-Value | payment failed after seeing value | payment failed after genuine activation |
| **B7 Cancelled** | impossible | churned before ever seeing value | **"saw it work, still left"** — distinct from A4×B7 | **"activated churner"** — the highest-value win-back target; they proved the product works for them once |

The **only** impossible combinations are anything paired with A1 on the commercial axis beyond "no trial yet" — because the coupling in point 1 above makes reaching any commercial state without first leaving A1 structurally unreachable. Every other cell is a real, intended, distinctly-messaged segment. A single-chain model would have quietly collapsed several of these into one bucket (most damagingly, A4×B7 into the same treatment as A2×B7) and lost real information the business needs.

---

## 7. Cross-Cutting Terminal State — Account Deleted

Found during the adversarial self-review (Section 9), not in the original pass: neither axis, as drafted, had an answer for an Owner who deletes their Gym/account outright — a real, expected future requirement (data-deletion requests, GDPR-style obligations). Modeling deletion as a same-axis state on either chain is wrong, because deletion is not a degraded engagement or commercial condition — it is the end of the entity's existence in this FSM entirely.

**Account Deleted** is therefore modeled as a single cross-cutting terminal state, reachable via an explicit Owner-initiated (or, later, compliance-driven) deletion action from **any** state on either axis simultaneously. It has no exit. A new signup afterward, even with the same email, is architecturally a **new instance** of this entire state machine — never a re-entry into the deleted one, and never a "reactivation." This keeps the reactivation semantics in Section 5 clean (B7 → B5 is Forge remembering a real, continuous relationship; a post-deletion resignup remembers nothing, by design).

---

## 8. Checklist Progress and Future Module Compatibility

**How checklist progress changes state:** almost none of it does. Confirming the Waiver, uploading a logo, connecting payments, setting a class schedule — these are real, trackable touchpoints (worth their own analytics events) but none of them are state-transition-worthy on their own. **Exactly one** checklist outcome changes FSM state: a sent invitation being accepted, which fires the First Value event (A2→A3). Every other checklist item is analytics-only, consistent with Section 4's treatment of Retention — this FSM is deliberately narrow, and resisting the urge to add a state for every trackable action is what keeps it free of ambiguity.

**Future modules**, checked individually against this FSM rather than assumed compatible:

- **Programming, Classes, Bookings, Attendance** — all downstream product usage that happens *inside* A3/A4/B5 (`Allowed actions: everything`). None require a new lifecycle state; their usage frequency is exactly the raw material Retention analytics (Section 4) is computed from.
- **Billing** — already Axis B in full; future dunning-cadence or plan-tier changes are tuning inside B5/B6, not new states.
- **AI** — no dependency in either direction, matching the frozen document's own Section 18 conclusion; AI features live inside whatever state the Owner is already in.
- **CRM, Marketing** — consume this FSM's event stream (`owner_signup_submitted`, `first_value_reached`, `activated`, `trial_ending_entered`, `payment_failed`, `subscription_cancelled`, `subscription_reactivated`, …) as their trigger surface. No new states; this FSM's events *are* the CRM integration point.
- **Multi-location** — already solved by the per-Gym scoping rule stated at the top of Sections 3 and 5: an Owner with multiple Gyms has multiple, fully independent instances of this entire two-axis machine, one per Gym, exactly mirroring the frozen document's Platform-Subscription-per-Gym decision. No redesign required when a second Gym appears.
- **Enterprise** — a sales-led provisioning path may need to create a Gym that enters directly at **B5 (Paying)**, skipping the trial axis entirely. This FSM explicitly allows that: B5's entry criteria is "successful payment captured," with no requirement that a trial preceded it. A model that forced every Gym through B2 first would have broken for exactly this future case; this one doesn't need to change.

---

## 9. Final Review — Attempting to Break This Model

**Dead states:** none found. Every state has both a real entry and a real exit, with one deliberate, justified exception: **A4 (Activated)** has no exit. This is not a dead state — a dead state is one that's unreachable or pointless to be in; A4 is reachable, meaningful, and permanent by design (Section 3's monotonicity rule). Its lack of an exit is the intended behavior of a durable achievement flag, not an oversight.

**Impossible transitions:** the request's implied linear chain ("Unverified → ... → Trial → Paying → ...") would have made A3→A2 or A4→A3 look plausible by proximity; both are explicitly forbidden (monotonic axis, Section 3). Any commercial state other than "no trial yet" paired with A1 is impossible, and is why Section 6's matrix marks those cells explicitly rather than leaving them blank.

**Duplicate states:** two were caught and resolved by Section 1's state-vs-event rule before they could ship as duplicates: `Trial: Started` (duplicate of the first instant of B2) and `Reactivated` (duplicate of B5, distinguished instead by event name, not by state).

**Missing states:** one real gap found — no terminal state existed for account/Gym deletion. Resolved in Section 7.

**Circular transitions:** exactly one exists (B5⇄B6), and it is explicitly named and justified in Section 5 as legitimate, bounded, real-world billing behavior rather than left as an unexplained loop.

**Ambiguous transitions:** the request's own framing of "Reactivated" as a single downstream step after Cancelled was ambiguous about whether it re-enters Paying or becomes its own bucket — resolved unambiguously in Section 5/6: it re-enters B5, tagged by a distinct analytics event.

**One additional weakness surfaced by this review, named rather than silently fixed:** A1 (Unverified) has no timeout-based auto-exit or cleanup path. This is a deliberate, bounded gap — not adding speculative deletion-after-N-days logic for a case with no evidenced need yet (consistent with the frozen document's own Principle 3.4 discipline) — but it is explicitly flagged here as a known, open, non-blocking item rather than an unnoticed hole, so a future revision is not surprised by it.

This state machine supports Forge's product surface, billing model, and every named future module (Section 8) without requiring a new state for any of them, using two independent, individually simple axes instead of one overloaded chain — which is precisely the property a 5–10 year foundation needs: new features consume this FSM's events, they don't force new states into it.

**Final verdict: APPROVED FOR FREEZE.**
