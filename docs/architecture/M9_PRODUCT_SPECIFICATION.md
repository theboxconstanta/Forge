# M9_PRODUCT_SPECIFICATION.md

**Status**: CANONICAL
**Milestone**: M9 — Member & Membership Lifecycle Management
**Governs**: every subsequent M9 document (Technical Architecture, Implementation Plan, Execution Plan)

**Conformance note**: this document clarifies business behavior for the capabilities the Milestone Definition placed in scope. It does not redefine M9's objective, principles, or architectural constraints — those remain exactly as approved. Where a capability's name in the Milestone Definition was an example rather than a precise specification (the Milestone Definition itself states "these are examples only"), this document resolves it into unambiguous business behavior; every such resolution is recorded explicitly in §11 (Product Decisions), not left implicit.

**Scope carried forward from the Milestone Definition Review**: Freeze/Resume and any proration-bearing Upgrade/Downgrade were identified as requiring resolution before inclusion. This Product Specification does not include them — they are formally deferred (§9, Explicitly Out of Scope), consistent with that review's second resolution path.

---

## 1. Executive Summary

M9 gives a gym administrator the operational tools to manage a member's relationship with their gym, and that member's commercial plan, throughout the entire period after first contact — from before they have an account, through their ongoing day-to-day administration, to any point they need a correction, an extension, or an ending. Today, Forge can acquire a member (self-service signup, first purchase) and can end a member's relationship with a gym (Removal, Transfer). It has no administrator-invoked path to add someone directly, no way to invite someone and track their acceptance, no way to edit a member's own record on their behalf, and no unified view of a member's history. M9 closes that gap.

M9 does not change what a Member is, what a Gym Membership is, or what a Subscription is. It gives administrators new ways to act on those existing concepts, and one new concept of its own (an Invitation, for someone who is not yet a Member). Every existing member, Gym Membership, Subscription, Order, and Payment continues to behave exactly as it does today unless an administrator explicitly performs one of the actions defined below.

---

## 2. Business Concepts

This section is the single source of truth for terminology in this document and every document that follows it. Every business rule below identifies which of these concepts it affects, and never uses two of these terms interchangeably.

- **Member**: an individual's identity on the Forge platform, independent of any gym. Owned by the Member Domain, unchanged by M9. A Member may exist with or without a current Gym Membership.
- **Gym Membership**: the relationship between a Member and a specific Gym — the fact of currently belonging, or having belonged, to that Gym. Owned by the Member Domain, unchanged by M9. A Gym Membership's lifecycle (active, ended as a removal, ended as a transfer) is exactly as the Member Domain and Gym Transfer already define it; M9 introduces no new state to it.
- **Subscription**: the commercial plan governing a Member's paid access at a Gym — what plan, what period, what session allowance, what price. Owned by the Financial Domain, unchanged by M9. A Subscription's existence is independent of a Gym Membership's existence in the data sense, but in ordinary business use a Member only has an active Subscription while they have an active Gym Membership.
- **Invitation**: new in M9. A record of an administrator's intent to bring a specific, named individual onto the platform as a Member of their Gym, sent before that individual has any account. An Invitation is not a Member and not a Gym Membership — it is a pending state that resolves into both, together, only when accepted.
- **Administrative Adjustment**: new in M9. A logged, administrator-performed correction to a Subscription's or Gym Membership's details (e.g., a date, a session count) made outside the normal flow of the lifecycle actions this document defines — distinguished from those actions by being a correction, not a business event in its own right.
- **Timeline**: new in M9. The complete, chronological, read-only record of everything that has happened to a specific Member — identity changes, Gym Membership changes, Subscription changes, and Administrative Adjustments — assembled from the Member Domain and Financial Domain's own existing histories. The Timeline introduces no new Source of Truth; it is a composed view over data each domain already owns.
- **Audit Log**: new in M9, as a business concept. The record of who performed each administrator-invoked action defined in this document, when, and with what outcome — visible only to administrators of the Gym where the action occurred.

---

## 3. Actors

- **Gym Administrator**: the primary actor for every capability in this document. May act only on Members, Gym Memberships, Subscriptions, and Invitations belonging to their own Gym — this is unchanged from every existing administrator capability in Forge.
- **Member**: the subject of most M9 capabilities. Retains full, unchanged use of every capability already available to them (their own profile edits, their own self-service join, their own Renew Now). Is the actor who accepts an Invitation, converting themselves from Invitee to Member.
- **Invitee**: a named individual an administrator has invited, who is not yet a Member. Can only accept or decline the Invitation; has no other access to Forge until acceptance.
- **Coach**: not an actor in this document. Coaches' existing scope (WOD and Classes only) is unchanged; M9 introduces no new Coach permission.
- **Platform Admin**: not an actor in this document. M9 is gym-level operational management; Platform Admin's existing, separate scope (cross-gym administration) is unaffected.

---

## 4. Capabilities

### 4.1 Add Member Manually

**Purpose**: let an administrator bring a specific individual onto the platform as a Member of their Gym immediately, without requiring that individual to complete any signup step themselves.

**Business Intent**: covers the common gym scenario where someone joins in person, by phone, or is being recorded after the fact (e.g., a walk-in, a paper-form signup, a migration from a prior system) — the administrator should never be blocked from recording a real member just because that person cannot or has not completed a self-service flow.

**Actors**: Gym Administrator (performs the action). The new Member is the subject, not an actor in this capability.

**Preconditions**: the administrator is acting within their own Gym. The individual being added does not already have a Member identity with the same identifying detail (see Business Rules) at this Gym.

**Business Rules**:
1. Adding a Member creates both a Member and, in the same business action, a Gym Membership linking that Member to the administrator's Gym — the two are never left in a half-created state from the administrator's perspective.
2. A manually-added Member is not, by this action alone, given any way to log into Forge themselves. Granting that access is the separate, optional act of inviting them (§4.2) at any later time.
3. No Subscription is created by this action. Establishing a Subscription is a separate, already-existing capability, optionally performed immediately afterward or at any later time.
4. If the identifying detail supplied matches an existing Member who currently has no Gym Membership anywhere, the administrator must be offered that existing Member instead of creating a duplicate identity — Member identity is never duplicated by this capability.
5. If the identifying detail matches an existing Member who already has a current Gym Membership (at this Gym or another), the action is rejected — this capability does not reassign an existing, active relationship.

**Expected Behaviour**: the administrator supplies the new Member's identifying and profile details; on success, that Member appears immediately in the administrator's own Gym roster with an active Gym Membership.

**Validation Rules**: the identifying detail supplied (at minimum, enough to check for an existing Member per Rule 4/5) must be present and well-formed before the action can be attempted.

**Permissions**: Gym Administrator only, scoped to their own Gym.

**Success Outcomes**: a new or existing Member has an active Gym Membership at the administrator's Gym; this event appears on the Member's Timeline and the Gym's Audit Log.

**Failure Outcomes**: rejected, with a clear reason, if the identifying detail matches a Member who already has an active Gym Membership anywhere (Rule 5), or if required details are missing or invalid.

**Edge Cases**:
- The identifying detail matches a Member whose most recent Gym Membership ended as a Transfer or a Removal: allowed — this is exactly the scenario the existing self-service join and Gym Transfer's Recognition already handle for the member's own action; this capability is the administrator-invoked equivalent and must recognize the same continuity where it applies.
- Two administrators attempt to add the same new individual at the same time: only one Gym Membership may result; the second attempt is rejected once the first succeeds, per Rule 5.
- Administrator supplies incomplete profile information: the Member and Gym Membership may still be created with minimum required detail; profile completeness is not a precondition for existing.

**Interactions with Existing Forge Behaviour**: reuses the Member Domain's own continuity handling (Gym Transfer's Recognition) where the added individual has prior history. Never touches the Financial Domain. Never affects any other Member's or Gym's data.

---

### 4.2 Invite Member

**Purpose**: let an administrator initiate a prospective member's own onboarding, tracked from the moment of invitation through acceptance, rather than relying on a generic, untracked join code.

**Business Intent**: an administrator often knows exactly who is about to join before that person acts — a scheduled trial, a referral, a pending signup conversation. Today, the administrator has no way to record that intent or track whether it was ever completed. This capability gives every invited individual a personal, trackable path onto the platform, distinct from the general-purpose gym join code, which remains unchanged for anyone joining without a prior invitation.

**Actors**: Gym Administrator (sends the Invitation); Invitee (accepts it, becoming a Member).

**Preconditions**: the administrator is acting within their own Gym. The invited individual's identifying detail does not already belong to a Member with an active Gym Membership.

**Business Rules**:
1. An Invitation identifies exactly one intended individual and exactly one Gym. It is never generic or reusable by anyone other than its intended recipient.
2. An Invitation remains outstanding until the invited individual accepts it, the administrator revokes it, or it is superseded by a new Invitation to the same individual — at most one Invitation may be outstanding for a given individual at a given Gym at any time.
3. Accepting an Invitation creates a Member (or resolves to an existing Member, per the same identity-matching principle as §4.1 Rule 4) and a Gym Membership together, in one business action, and grants that individual their own access to Forge.
4. An administrator may revoke an outstanding Invitation at any time before it is accepted; a revoked Invitation cannot later be accepted.
5. Declining or letting an Invitation lapse has no effect on any existing Forge data — it simply means no Member or Gym Membership is created from it.

**Expected Behaviour**: the administrator supplies the invitee's identifying detail; the invitee receives the Invitation through a channel outside the app (comparable to how existing account-related communications already reach members) and completes their own account setup to accept it.

**Validation Rules**: the same identity-matching precondition as §4.1 applies before an Invitation may be sent.

**Permissions**: sending and revoking is Gym Administrator only, scoped to their own Gym. Accepting is available only to the specific individual the Invitation names.

**Success Outcomes**: on acceptance, a Member with an active Gym Membership exists, with their own Forge access; the administrator can see that the Invitation was accepted.

**Failure Outcomes**: sending is rejected if the individual already has an active Gym Membership anywhere. Acceptance is rejected if the Invitation was revoked, has already been accepted, or has expired.

**Edge Cases**:
- The invitee already has a dormant Member identity (a prior Transfer or Removal): acceptance resolves to that existing identity, exactly as §4.1's continuity handling requires, not a duplicate.
- An administrator sends a second Invitation to the same individual before the first is resolved: the second supersedes the first, per Rule 2 — the first becomes unacceptable.
- The invitee attempts to accept after the invitation window elapses: rejected, with a path for the administrator to send a new one.

**Interactions with Existing Forge Behaviour**: the resulting Member/Gym Membership creation is the same underlying business event as §4.1's, differing only in who initiates the credential-setting step. Does not alter the existing, general-purpose gym join code, which continues to work exactly as it does today for anyone not using a personal Invitation.

---

### 4.3 Edit Member

**Purpose**: let an administrator correct or update a Member's own identity details on that Member's behalf.

**Business Intent**: today, only the Member themselves can change their own identity information. An administrator legitimately needs to fix a misspelled name, correct a birth date entered wrong at signup, or update a detail on behalf of a member who cannot do it themselves (no app access, unfamiliar with the interface, etc.).

**Actors**: Gym Administrator.

**Preconditions**: the Member being edited currently has an active Gym Membership at the administrator's Gym.

**Business Rules**:
1. An administrator may edit only identity details of a Member currently, actively, a member of their own Gym — never a Member with no current Gym Membership, and never a Member of another Gym.
2. Editing a Member's identity through this capability changes the same, single identity record the Member's own self-service edits change — there are never two competing versions of a Member's identity.
3. Every edit made this way is attributed to the administrator who made it, distinctly from an edit the Member makes themselves.

**Expected Behaviour**: the administrator opens a specific Member's record within their own roster, changes one or more identity fields, and saves — the change is reflected immediately, identically to how the Member's own edits already appear.

**Validation Rules**: the same field-level validity rules that already govern a Member's own profile edits apply identically here — this capability does not introduce a separate, looser, or stricter validation standard.

**Permissions**: Gym Administrator only, scoped to Members with a current, active Gym Membership at their own Gym.

**Success Outcomes**: the Member's identity record reflects the change; the edit is attributed to the administrator on the Member's Timeline.

**Failure Outcomes**: rejected outright if the target Member has no current, active Gym Membership at the administrator's Gym — including a Member whose Gym Membership ended as a Removal or Transfer, matching the same visibility boundary already established by Gym Transfer.

**Edge Cases**: the Member independently edits the same field at the same time — whichever change is saved last stands; there is no merge, matching how any single-record edit already behaves elsewhere in Forge.

**Interactions with Existing Forge Behaviour**: this is the one capability in this document that introduces authorization Forge does not have today — an administrator acting on a Member's own identity record. It must respect the same boundary Gym Transfer already established (an administrator cannot see or act on a Member who is not currently, actively theirs) and must never allow an administrator to reach a Member outside their own Gym's active roster.

---

### 4.4 View Member History

**Purpose**: let an administrator see one Member's complete story at their Gym in a single place.

**Business Intent**: today, a Member's identity details, Gym Membership status, and Subscription history are each visible separately, if at all, with no single, ordered account of what has happened to them. An administrator resolving a dispute, answering a member's question, or simply understanding someone's situation needs one coherent picture, not several disconnected screens.

**Actors**: Gym Administrator.

**Preconditions**: the Member has, or has had, a Gym Membership at the administrator's Gym.

**Business Rules**:
1. This capability displays the Timeline (§2) — it creates no data of its own.
2. An administrator may view the Timeline only for a Member who currently has, or has ever had, a Gym Membership at their own Gym — never a Member with no relationship to their Gym.
3. The Timeline shown to an administrator includes only events relevant to that Member's relationship with the administrator's own Gym — never events at another Gym, consistent with the tenant-isolation principle every existing frozen domain already enforces.

**Expected Behaviour**: the administrator selects a Member from their roster (current or historical) and sees an ordered account of identity changes, Gym Membership events, Subscription events, and Administrative Adjustments.

**Validation Rules**: not applicable — this is a read-only capability.

**Permissions**: Gym Administrator only, scoped as in Rule 2.

**Success Outcomes**: an accurate, complete, correctly-ordered account is shown.

**Failure Outcomes**: access is denied if the Member has never had a relationship with the administrator's Gym.

**Edge Cases**: a Member who was Transferred away and later Transferred back, or who has been Removed and later rejoined independently — the Timeline shows every one of these events in order, exactly as they occurred, per Rule 1; it never collapses or hides a prior relationship.

**Interactions with Existing Forge Behaviour**: composes data already owned by the Member Domain and Financial Domain; introduces no new Source of Truth and changes nothing about how either domain stores its own history.

---

### 4.5 Create Gym Membership (for an Existing Member)

*Note on scope: this capability resolves the Milestone Definition's "Create Membership" and "Assign Membership" into one capability — see §11, Product Decision 1.*

**Purpose**: let an administrator establish a Gym Membership for a Member identity that already exists but currently has no active Gym Membership anywhere.

**Business Intent**: covers the case not already covered by §4.1/§4.2 — an administrator knows of an existing Member (perhaps previously a member elsewhere, or found through search) and wants to bring them into their Gym directly, without that individual needing to use the general-purpose join code or a fresh Invitation.

**Actors**: Gym Administrator.

**Preconditions**: the target Member exists and currently has no active Gym Membership anywhere.

**Business Rules**:
1. This capability never creates a new Member identity — it acts only on an already-existing one. Creating a new identity is §4.1 or §4.2.
2. If the target Member already has an active Gym Membership anywhere, this action is rejected — exactly the same rule already established for Gym Transfer's own primary journey (a rejoin is a new Gym Membership, never a reactivation of an old one, and never a second simultaneous one).
3. Recognition (as already defined by Gym Transfer) applies identically here if the Member's most recent previous Gym Membership ended as a Transfer.

**Expected Behaviour**: the administrator locates the existing Member and confirms the action; a new, active Gym Membership at their Gym results immediately.

**Validation Rules**: the target must resolve to exactly one existing Member identity.

**Permissions**: Gym Administrator only, scoped to their own Gym.

**Success Outcomes**: an active Gym Membership exists for that Member at the administrator's Gym.

**Failure Outcomes**: rejected if the Member already has an active Gym Membership anywhere.

**Edge Cases**: same as §4.1's Recognition-related edge cases — a Member with a long history of prior Gym Memberships is handled the same way regardless of how many they have had before.

**Interactions with Existing Forge Behaviour**: this is the administrator-invoked equivalent of the Member's own self-service join, and must produce the exact same kind of outcome (a new, active Gym Membership, Recognition evaluated the same way) — it is a second entry point to the same underlying business event, not a different one.

---

### 4.6 Renew Subscription (Administrator-Initiated)

**Purpose**: let an administrator renew a Member's Subscription on their behalf.

**Business Intent**: the existing "Renew Now" flow is Member-initiated only. An administrator handling a cash or bank-transfer payment, or acting for a member without independent app access, needs the equivalent capability available to them directly.

**Actors**: Gym Administrator.

**Preconditions**: the Member has an active Gym Membership at the administrator's Gym.

**Business Rules**:
1. This capability produces the same kind of outcome the Member's own existing Renew Now flow already produces — a new Subscription period on an existing or chosen plan. It does not introduce a second, different renewal concept.
2. The administrator must select a plan and a payment method appropriate to how the payment was actually received, exactly as the existing administrator subscription-creation capability already requires.

**Expected Behaviour**: the administrator selects the Member and a plan, records the renewal, and the Member's Subscription reflects the new period immediately.

**Validation Rules**: same as the existing administrator subscription-creation validation.

**Permissions**: Gym Administrator only, scoped to their own Gym's Members.

**Success Outcomes**: the Member has a current, active Subscription reflecting the new period.

**Failure Outcomes**: rejected if the Member has no active Gym Membership at the administrator's Gym.

**Edge Cases**: the Member already has an active, unexpired Subscription — the administrator's renewal extends the commercial relationship going forward; it does not retroactively alter time already paid for.

**Interactions with Existing Forge Behaviour**: this is not a new Financial Domain capability — it is the existing administrator-side subscription-creation/renewal capability, formally recognized here as part of M9's operational toolkit rather than a separate feature request.

---

### 4.7 Extend Subscription

**Purpose**: let an administrator lengthen a Member's current Subscription period, or add sessions to it, without a new commercial transaction.

**Business Intent**: gyms routinely need to compensate members for a closure, an error, or a goodwill gesture — adding time or sessions to what a member already has, without creating a new purchase.

**Actors**: Gym Administrator.

**Preconditions**: the Member has a current Subscription.

**Business Rules**:
1. An extension changes only the length or session allowance of the existing Subscription — it never creates a new Order or Payment, and never implies money changed hands.
2. Every extension is attributed to the administrator who performed it and is visible on the Member's Timeline, distinctly from a Renewal (Rule 1, §4.6) or a purchase.

**Expected Behaviour**: the administrator selects the Member's current Subscription and specifies the extension (additional time or sessions); the change applies immediately.

**Validation Rules**: the extension must be a positive adjustment to an existing, current Subscription.

**Permissions**: Gym Administrator only, scoped to their own Gym's Members.

**Success Outcomes**: the Subscription's period or session allowance reflects the extension.

**Failure Outcomes**: rejected if the Member has no current Subscription to extend.

**Edge Cases**: an extension applied to a Subscription that is very close to, or past, its original end date — the extension still applies from the Subscription's own current end point, never retroactively shortening what the Member already had.

**Interactions with Existing Forge Behaviour**: distinct from the existing session-count adjustment capability only in being formally named, scoped, and made auditable as part of M9 — it does not replace or duplicate that capability's own existing mechanics (see §11, Product Decision 3).

---

### 4.8 Cancel Subscription

*Note on scope: this capability resolves the Milestone Definition's "Cancel," "End immediately," and "End at period end" into one capability with two explicit modes — see §11, Product Decision 2.*

**Purpose**: let an administrator end a Member's Subscription, choosing whether access ends right away or continues through what has already been paid for.

**Business Intent**: an administrator ending a commercial relationship needs to distinguish between "this should stop right now" (e.g., a dispute, a policy violation) and "this member is leaving on good terms and should keep what they already paid for."

**Actors**: Gym Administrator.

**Preconditions**: the Member has a current, active Subscription.

**Business Rules**:
1. Cancelling immediately ends the Member's paid access at the moment the action is taken — the same outcome the existing subscription-ending capability (already used by Remove Member and Gym Transfer) already produces.
2. Cancelling at period end takes no immediate effect on the Member's access — they retain it through their Subscription's existing, already-paid end date — but records the administrator's decision that it will not continue past that point.
3. Cancelling a Subscription, in either mode, has no effect on the Member's Gym Membership by itself — ending the Gym Membership itself is a separate, already-existing action (Remove Member or Transfer), not implied by this capability.
4. Neither mode creates a refund. A refund, where warranted, remains a separate, already-existing Financial Domain action.

**Expected Behaviour**: the administrator selects the Member's Subscription and chooses immediate or period-end cancellation; the outcome is applied as described in Rules 1–2.

**Validation Rules**: the target Subscription must be current and active.

**Permissions**: Gym Administrator only, scoped to their own Gym's Members.

**Success Outcomes**: the Subscription is ended (immediate mode) or marked to end at its existing period boundary (period-end mode); the outcome is recorded on the Member's Timeline.

**Failure Outcomes**: rejected if the Member has no current, active Subscription.

**Edge Cases**: an administrator cancels at period end, then the Member's circumstances change and the administrator wants to reverse that decision before the period actually ends — this must be possible, since period-end cancellation has not yet taken effect; reversing an already-effective immediate cancellation is not possible, consistent with immediate cancellation's existing, already-established finality.

**Interactions with Existing Forge Behaviour**: immediate cancellation reuses the exact same underlying capability Remove Member and Gym Transfer already rely on for ending a Subscription — it does not introduce a second way to do the same thing. Period-end cancellation is the one genuinely new Subscription-ending behavior in this document.

---

### 4.9 Timeline (as a standalone capability)

Defined in full at §4.4 (View Member History), which is the administrator-facing expression of the Timeline concept (§2). No separate capability definition is needed; this entry exists only to confirm the Milestone Definition's "Timeline" item is fully addressed by §4.4, not omitted.

---

### 4.10 Audit Visibility

**Purpose**: let an administrator see who performed each M9 action at their Gym, when, and with what outcome.

**Business Intent**: every capability in this document is consequential enough (creating, editing, or ending a commercial or membership relationship) that a gym needs to know which of its own administrators did what, both for its own internal accountability and to investigate a member's question about their own account.

**Actors**: Gym Administrator.

**Preconditions**: none beyond being an administrator of the Gym whose Audit Log is being viewed.

**Business Rules**:
1. Every action defined in this document is recorded in the Audit Log: which administrator, which Member or Invitee, what action, when, and its outcome.
2. An administrator may see only their own Gym's Audit Log — never another Gym's, matching the tenant-isolation principle already enforced everywhere else in Forge.
3. The Audit Log is a record of fact; it is never edited or removed by any action in this document.

**Expected Behaviour**: an administrator can view a chronological log of M9 actions taken at their Gym, and can view the subset of that log relevant to one specific Member via the Timeline (§4.4).

**Validation Rules**: not applicable — read-only.

**Permissions**: Gym Administrator only, scoped to their own Gym.

**Success Outcomes**: an accurate, complete, tamper-free record is available.

**Failure Outcomes**: not applicable to a read-only capability beyond the standard permission boundary in Rule 2.

**Edge Cases**: an action later found to have been performed in error — the Audit Log still shows the original action exactly as it happened; correcting the underlying situation is a new, separate action (e.g., an Administrative Adjustment), never a rewrite of what the log already recorded.

**Interactions with Existing Forge Behaviour**: extends, with the same shape, the audit expectation already established for Gym Transfer's own actions — nothing about this capability changes how any other, non-M9 action is or is not currently logged.

---

### 4.11 Administrative Adjustment

**Purpose**: let an administrator make a logged, deliberate correction to a Subscription's or Gym Membership's recorded details, outside the ordinary lifecycle actions this document defines.

**Business Intent**: mistakes happen — a session count entered wrong, a date that needs fixing, a detail that was correct when recorded but needs updating for a reason outside the normal course of business. This must be possible without disguising the correction as one of the named lifecycle actions above, which each carry their own specific business meaning.

**Actors**: Gym Administrator.

**Preconditions**: a current or historical Subscription or Gym Membership exists to adjust.

**Business Rules**:
1. An Administrative Adjustment is always attributed to the administrator who made it, always timestamped, and always visible on the affected Member's Timeline, distinctly labeled as a correction rather than a business event.
2. An Administrative Adjustment must never be used to bypass the business rules of a named capability in this document (e.g., using an adjustment to grant a Gym Membership without going through §4.1/§4.2/§4.5) — it exists for correcting recorded detail, not for circumventing process.
3. An Administrative Adjustment carries no automatic financial consequence (no Order, no Payment, no refund) — where a correction genuinely requires a financial consequence, that remains a separate, already-existing Financial Domain action.

**Expected Behaviour**: the administrator selects the record needing correction, states the corrected detail, and the correction applies immediately with full attribution.

**Validation Rules**: the same field-level validity that already governs the underlying record applies to any adjustment of it.

**Permissions**: Gym Administrator only, scoped to their own Gym's Members.

**Success Outcomes**: the record reflects the correction; the adjustment is visible on the Timeline and Audit Log.

**Failure Outcomes**: rejected if it would violate the business rules of the capability that would normally govern the change (Rule 2).

**Edge Cases**: an adjustment to a Subscription that has already ended — permitted only where it corrects a factual error in what already happened (e.g., a wrong recorded date), never used to retroactively reopen an ended relationship, which remains governed exclusively by the capabilities that create one (§4.1, §4.2, §4.5).

**Interactions with Existing Forge Behaviour**: this is the formalization, under one named, audited concept, of correction capability that exists today only informally (e.g., the existing session-count adjustment) — see §11, Product Decision 3.

---

## 5. Cross-Cutting Business Rules

These apply to every capability in §4 without exception:

1. **Tenant isolation**: an administrator may act only within their own Gym. No capability in this document allows an administrator to see or act on another Gym's Members, Gym Memberships, Subscriptions, Invitations, or Audit Log, under any circumstance.
2. **Attribution**: every write action in this document is attributed to the specific administrator who performed it.
3. **No silent side effects**: no capability in this document triggers another capability's business rule invisibly — where two capabilities interact (e.g., §4.1 and an optional subsequent Subscription creation), the interaction is an explicit, separate step, never an automatic, hidden consequence.
4. **Existing behavior is inviolate**: no capability in this document changes the behavior, availability, or outcome of any existing Forge capability (self-service join, Renew Now, Remove Member, Gym Transfer, or any other) for any Member or administrator who does not explicitly invoke an M9 capability.

---

## 6. UX Principles

- **Clarity of consequence**: before any ending or cancelling action (§4.8) is finalized, the administrator must be able to see plainly what will happen and when — immediate loss of access versus continued access through an existing period — since these have materially different consequences for the member.
- **No ambiguous terminology surfaced to the user**: the distinction between Member, Gym Membership, and Subscription (§2) must be reflected in how these capabilities are presented, not collapsed into a single, vague "membership" label that would recreate the ambiguity this document exists to resolve.
- **Consistency with existing Forge patterns**: every capability that ends or removes something (Cancel Subscription) carries the same weight of deliberate confirmation already established by Remove Member and Transfer — a single, clear confirmation, not a casual action.
- **Minimal friction for the common case**: adding a known individual (§4.1) should require no more information than is actually needed to create the record — completeness is never a precondition for existing (§4.1, Edge Cases).

---

## 7. Edge Cases (Cross-Capability)

- **Two administrators of the same Gym act on the same Member at the same time** (e.g., one edits identity while another performs an Administrative Adjustment): both actions are independently attributed and recorded; whichever is applied last to a given field stands, matching how any concurrent edit already behaves elsewhere in Forge.
- **An action is attempted against a Member who has, in the same moment, been Removed or Transferred by another administrator**: the action is rejected on the same "must have a current, active Gym Membership" precondition already required throughout §4 — this is a business-perspective restatement of the same structural guarantee Gym Transfer already relies on (only one relationship-ending transition can succeed for a given Member at a time).
- **An Invitation and a self-service join, or a manual Add, target the same individual at the same time**: only one Gym Membership can result, per the same identity and active-Gym Membership rules already stated in §4.1 and §4.2 — whichever completes first succeeds, the other is rejected on the now-current state.
- **A retried action** (e.g., a network issue causes an administrator to submit the same Add Member or Cancel Subscription action twice): the second attempt must never produce a duplicate Member, duplicate Gym Membership, or a double-cancellation — it must resolve to the same single outcome the first attempt already produced or is producing.
- **Partial completion**: no capability in this document is considered complete until every one of its defined outcomes (e.g., §4.1's Member and Gym Membership together) has occurred — a state where only part of a capability's outcome exists is not a valid resting state for that capability.

---

## 8. Success Criteria

M9 is complete when:

- An administrator can add a Member to their Gym without that Member completing any self-service step, per §4.1.
- An administrator can invite a specific individual and see whether they accepted, per §4.2.
- An administrator can edit a Member's identity on their behalf, per §4.3.
- An administrator can see one coherent Timeline for any Member with a relationship to their Gym, per §4.4.
- An administrator can establish a Gym Membership for an existing Member without them using a join code, per §4.5.
- An administrator can renew, extend, or cancel (immediately or at period end) a Member's Subscription, per §4.6–§4.8.
- An administrator can view their Gym's Audit Log and make an attributed Administrative Adjustment, per §4.10–§4.11.
- Every one of the above is scoped correctly to the administrator's own Gym, with no exception found.
- No existing Member, Gym Membership, Subscription, Order, Payment, or existing flow behaves differently than before M9, for any account that never touches an M9 capability.

---

## 9. Explicitly Out of Scope

- **Freeze / Resume** of a Subscription — deferred per the Milestone Definition Review; whether this is achievable without new Financial Domain capability has not been established.
- **Upgrade / Downgrade** of a Subscription plan where proration or mid-cycle financial adjustment is implied — deferred for the same reason. (Changing a Member to a different plan going forward, with no proration, is achievable today as Cancel Subscription at period end, §4.8, followed by a new Subscription via §4.6 at the new period — this is already fully covered by this document and requires no separate capability.)
- Multi-gym membership (a Member belonging to more than one Gym at once).
- Any change to self-serve gym signup or platform-level billing.
- Any change to Gym Transfer's own defined journeys, Business Rules, or Transfer Code lifecycle.
- Any new Coach or Platform Admin permission.
- Bulk operations (adding, inviting, or adjusting many Members in one action) — every capability in this document is defined as a single-Member action.

---

## 10. Acceptance Criteria

For each capability in §4, the following must be independently demonstrable:

1. The capability succeeds under its stated preconditions and produces exactly its stated Success Outcome.
2. The capability fails, with its stated Failure Outcome, when its preconditions are not met.
3. The capability is unavailable to, and has no effect when attempted by, an administrator of a different Gym.
4. Every edge case named for that capability in §4 or §7 produces the behavior described there, not an undefined or inconsistent result.
5. No existing Forge capability's behavior changes as a result of this capability existing, until it is explicitly invoked.
6. The action is correctly attributed and visible on the relevant Timeline and Audit Log.

M9 as a whole is acceptance-complete when all eleven capabilities in §4 independently satisfy the six criteria above.

---

## 11. Product Decisions

Recorded here, as required, rather than left implicit:

1. **"Create Membership" and "Assign Membership" are one capability, not two** (§4.5). Read together, the Milestone Definition's two line items describe the same underlying business event — establishing a Gym Membership for an existing Member — differing only in which entry scenario prompted it. Defining them separately would have produced two capabilities with identical business rules and no meaningful distinction, violating this document's own unambiguousness standard.
2. **"Cancel," "End immediately," and "End at period end" are one capability with two modes, not three capabilities** (§4.8). "Cancel" is the administrator's general intent; immediate and period-end are its two possible executions. Treating them as three separate, equally-weighted capabilities would have implied a third, distinct outcome that does not exist.
3. **"Extend" and "Administrative Adjustment" are distinct** (§4.7, §4.11), despite both involving a correction-shaped action. Extend has a specific, named business meaning (lengthening a Subscription without a new transaction); Administrative Adjustment is the general-purpose mechanism for everything else. Collapsing them would have hidden Extend's specific meaning inside a generic catch-all.
4. **Every "Membership" reference in the Milestone Definition's example list was mapped to exactly one of Gym Membership or Subscription** (§2), per that document's own required resolution. Where the mapping was not self-evident from the capability's name alone (Renew, Cancel, Extend, End immediately, End at period end — all mapped to Subscription, since none of them describes a concept the Gym Membership state machine actually has), that reasoning is recorded in each capability's own Business Intent above.

---

## Open Questions

None remain. Every ambiguity identified in the Milestone Definition Review has been resolved above, either by explicit business rule or by formal deferral (§9).
