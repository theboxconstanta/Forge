# Forge — Admin Member Management Specification

This document is the canonical Product Specification for the Member Management module: the complete administrative experience for managing members inside Forge.

It is not a Software Architecture document, a Technical Design document, an API specification, or a Database specification. It defines administrator workflows, product behaviour, UX responsibilities, business rules, information architecture, navigation, and administrative capabilities. It does not define database schema, tables, APIs, RPCs, RLS, or any backend or frontend implementation detail.

This document is built entirely on top of two canonical, frozen architecture documents: `MEMBER_DOMAIN_ARCHITECTURE.md` and `FINANCIAL_DOMAIN_ARCHITECTURE.md`. Neither is redesigned, modified, or extended here. Every capability this specification describes must already be expressible through the entities and rules those documents define. Where a desired product behaviour cannot be expressed that way, this document marks it **"Requires ADR"** rather than silently assuming new architecture.

---

# 1. Purpose

This specification answers one question: **how should an administrator manage members inside Forge?**

Forge is a world-class SaaS platform for CrossFit, Functional Fitness, and Gym Management — not an imitation of legacy gym software. Its product philosophy is inspired by Stripe Dashboard, Linear, GitHub, and Notion: simple, intentional, scalable, enterprise-grade, obvious, and efficient.

Every screen has one primary responsibility. Every action has one obvious location. Nothing exists without purpose. Complexity exists only where it creates measurable value.

---

# 2. Design Principles

These principles govern every decision in this document and every chapter that follows.

1. Simplicity over complexity.
2. Product before implementation.
3. Enterprise-grade usability.
4. One obvious place for every action.
5. Minimize clicks.
6. Respect the frozen architecture.
7. Separate Product Design from Architecture.
8. Design for gyms with both 20 members and 10,000 members.
9. Every screen has one primary responsibility.
10. Every feature must justify its existence.
11. Clarity is more valuable than completeness.
12. If something belongs elsewhere, move it there.
13. Never duplicate responsibilities.
14. The simplest solution that completely solves the problem is preferred.

**Design discipline.** Never introduce a feature because a competitor has it — every feature must solve a clearly defined problem and improve administrator efficiency. Every responsibility belongs to exactly one place; if something belongs inside Member Profile, it does not also live inside Member Directory, and vice versa. When evaluating whether to add something, the right question is not "what else can we add," but "what can we remove without reducing product quality." Every feature increases maintenance cost; only features that create clear, stated value earn a place in this specification.

**Product quality standard.** Every design decision in this document is made as if Forge already had 50,000 gyms using it. If a decision would not hold at that scale, it is redesigned before being included here. This specification optimizes for the next decade, not for the next release.

---

# 3. Scope

## 3.1 In scope

The Member Management module owns:
- The Member Directory — the gym-scoped roster view (Chapter 4).
- The Member Profile — the complete record and workflow surface for one member (a subsequent chapter).
- Administration of the Membership lifecycle from an administrator's perspective: enrolling a member, removing a member, and any other Membership-level decision the frozen Member Domain Architecture defines.
- Administration of a member's Subscription from an administrator's perspective: assigning a Plan, renewing, pausing, and ending — always by invoking the commercial terms the Membership Catalog already defines, never by defining new ones here.
- Visibility into a member's financial standing at exactly the level the Financial Domain Architecture exposes it (an Order's settlement status), without owning financial configuration or financial actions.
- Search, filtering, sorting, and bulk operations across the roster.

## 3.2 Out of scope

The following are real, necessary parts of Forge, but are not designed in this document. Each belongs to a module of its own, and this specification only ever consumes what that module already defines — it never redefines it:
- **Membership Catalog** — which Plans exist, their pricing, and their terms.
- **Financial Domain configuration** — refund policy, payment methods, provider integration.
- **Classes, bookings, and attendance.**
- **Workout programming and the Workout Engine.**
- **Coach role administration and permissions configuration.**
- **Platform-level settings** — gym profile, branding, integrations.
- **Reporting & Analytics** beyond the lightweight, roster-level information this document's own chapters justify.
- **Communications** — messaging, campaigns, notifications.

## 3.3 Relationship to frozen architecture

Every fact this specification displays and every action it describes must trace to an entity, invariant, or rule already defined in `MEMBER_DOMAIN_ARCHITECTURE.md` or `FINANCIAL_DOMAIN_ARCHITECTURE.md`. This document does not introduce new entities, new relationships, or new lifecycle states. If a chapter cannot be fully specified without one, that gap is stated explicitly as **"Requires ADR,"** with the reasoning made clear, rather than resolved by assumption.

## 3.4 Document map

- Chapter 4 — Member Directory
- Further chapters (Member Profile and others) follow, each specified in the same sequence: Purpose, Objectives, Responsibilities, Non-Responsibilities, before any interface detail.

---

# 4. Member Directory

**Status:** Approved
**Version:** 1.0
**State:** Frozen

This chapter is frozen. Future modifications require an explicit Product Design Review and approval before implementation.

## 4.1 Purpose

The Member Directory exists to let an administrator locate, understand at a glance, and act on any Membership within their Gym, without opening each one individually. It is the entry point to every other member-management workflow, but it is not where those workflows are completed — it is where they are found and triaged, then handed off to the place designed for each decision, principally the Member Profile.

## 4.2 Objectives

The Member Directory must let an administrator:

1. Find a specific member in seconds, regardless of roster size.
2. Understand, without opening a profile, whether a member currently has access and why.
3. Distinguish members who need attention from members who do not.
4. Reach any member's full record in exactly one action.
5. Act on multiple members at once when a task is genuinely repetitive across many members, without forcing that repetition through individual profiles.
6. Begin enrolling a new member from a single, obvious place.

Every capability in this chapter exists to serve one of these six objectives. Anything that does not is out of scope for this screen.

## 4.3 Responsibilities

The Member Directory owns:

- The single, gym-scoped list view of every Membership belonging to the administrator's Gym.
- Search, filtering, and sorting of that list.
- A lightweight, at-a-glance summary of each Membership's current access status, computed live the same way access is determined anywhere else in Forge (the Member Domain Architecture's Entitlement derivation) — never a separately maintained or cached value.
- Navigation into the Member Profile for any Membership.
- The entry point for enrolling a new member, surfaced permanently in the command region (4.5), not only when the roster is empty. The enrollment workflow itself is specified separately; this chapter owns only where it begins.
- Bulk operations that are unambiguous and require no additional per-member decision (4.10).
- Lightweight per-row actions that require nothing beyond confirmation (4.11).

## 4.4 Non-Responsibilities

The Member Directory does not own, and must never duplicate:

- **Editing a member's personal information.** Belongs to Member Profile.
- **Assigning, changing, freezing, or renewing a Subscription with any choice involved** — which Plan, which date, what amount. Any action requiring a decision beyond "yes, do this" belongs to Member Profile, where the necessary context exists to make that decision responsibly.
- **Payment and financial history.** The Financial Domain's Order and Payment records are a distinct, independent concern from roster membership — the frozen Financial Domain Architecture treats entitlement, commercial agreement, and financial movement as three facts, none derived from another. The Directory reflects only access status (4.6); it never displays financial detail, never infers access status from financial state, and never exposes financial actions. Those belong to Member Profile's financial section or a dedicated Billing/Reports module.
- **Catalog management.** Which Plans exist, their pricing, and their terms are owned by the Membership Catalog module (3.2). The Directory only ever consumes the catalog; it never edits it.
- **Class, booking, or attendance management.** A separate module.
- **Communication with members.** Sending messages, campaigns, or notifications is a separate concern with its own product requirements. A member's contact identifier already being visible directly in the row (4.6) is a permitted convenience, not a communications feature — it is information the row already shows, not a messaging capability the Directory adds.

## 4.5 Information Architecture

The Member Directory is a single, flat list of Memberships — one row per Membership, not per Member, because Membership is the gym-scoped anchor the frozen Member Domain Architecture defines (a Member's identity exists independent of any Gym; what appears on *this* Gym's roster is its Memberships). It is not organized into categories, tabs, or sub-views by default: the objectives (4.2) are served by search, filter, and sort acting on one list, not by pre-splitting the roster into destinations an administrator must choose between before they know what they are looking for.

The screen is composed of three regions, each with one responsibility:

- A **command region** — search, filters, sort, bulk-action controls, and the entry point for enrolling a new member: everything that changes *what* the list shows, acts on *many* rows at once, or begins adding a new one.
- A **list region** — the roster itself.
- A **row** — exactly one Membership, exposing its summary information (4.6) and its per-row actions (4.11).

There is no separate detail panel or preview surface within the Directory. A row has exactly two destinies: stay a row, or become the entry point to the Member Profile. An in-between state — a side panel duplicating profile information — would duplicate a responsibility Member Profile already owns (Principle 13).

## 4.6 Information Displayed

Every field shown in a row must serve Objective 2 or 3 directly — nothing is shown merely because it exists.

- **Name** — the member's identity. Always present, primary.
- **Contact identifier** (email or phone, whichever the Gym primarily uses) — sufficient to disambiguate two similarly named members without opening a profile.
- **Standing** — a single, plain-language summary of the Membership's current access status: whether access is currently granted, and if not, why (no active Subscription, Subscription expired, Subscription paused, or a future Subscription already scheduled to begin). This is always computed live, the same way access is determined anywhere else in Forge (the Member Domain Architecture's Entitlement derivation) — never a stored flag, and never something the Directory computes or caches independently.
- **Plan name** — which Plan the member's current or most recent Subscription belongs to, so an administrator scanning the roster can distinguish, for example, unlimited members from punch-card members without a separate step.
- **Access-ends / renews on** — whichever constraint will actually end this Membership's access first: a date, a remaining-session count, or both together when a capped Subscription is also date-bound and either could bind first. This is the single most actionable field on the row: it is what turns browsing into triage, and it must never be represented as a date alone when a session count is the more urgent constraint.

Explicitly excluded from the row, and why:

- **Session/visit count** — belongs to Member Profile; relevant to one member's detail, not to scanning many.
- **Payment status** — a Financial Domain concern (4.4); showing it here would duplicate a responsibility that belongs to Member Profile's financial section.
- **Tenure / "member since"** — a real, valid fact, but it does not help distinguish who needs attention today; it belongs in Member Profile.

## 4.7 Search

Search serves Objective 1 alone: find a specific, known member in seconds. It matches against name and every contact identifier a Member has on record — email and phone alike — regardless of which one is shown in the row (4.6): an administrator holding only a phone number must still find a member whose row displays email, and vice versa. It is not a filter — search and filters are separate, composable controls that narrow the same list simultaneously, not alternate modes.

Search must return relevant results as the administrator types, without a separate submit step. A directory an administrator must deliberately "search," rather than simply type into, adds a click to the single most frequent operation this screen performs.

## 4.8 Filters

Filters serve Objective 3: distinguish members who need attention. Every filter corresponds to a real, already-derived access-status or Membership fact — never an invented category.

Filters this chapter justifies:

- **Standing** — active, expiring soon, no active access, paused. The same live access status shown in 4.6, made filterable.
- **Plan** — narrow to members on a specific Plan, for example during a Plan-specific renewal push.
- **Membership state** — active roster versus removed or transferred, the only Membership states the frozen Member Domain Architecture defines. By default, the Directory shows only `active` Memberships; a removed or transferred Membership is not "on the roster" in the sense this screen exists to manage, so it is excluded by default rather than shown alongside active members.

Filters this chapter explicitly rejects, and why:

- **Financial or payment status** — Non-Responsibility (4.4).
- **Arbitrary custom fields or tags** — no such concept exists in the frozen Member Domain. Introducing one here would be inventing a capability outside this document's authority. A real business need for member tagging is a Member Domain modeling question first, a filter second.

## 4.9 Sorting

Sorting serves Objective 3 through ranking rather than exclusion. Two sorts matter: by name (the default, for predictable lookup) and by access-ends date (to surface who needs attention first). Sorting by a field not shown in the row (4.6) is not offered — an administrator should never need to sort by something they cannot see.

## 4.10 Bulk Actions

A bulk action is justified only when the exact same, unambiguous action is genuinely needed across many Memberships at once, with no per-member decision required. Two qualify:

- **Remove.** Ending the Membership for a set of selected members — for example, an end-of-season roster cleanup. A single, unambiguous action per the Member Domain Architecture's own Membership removal. Because its blast radius scales with the size of the selection, not with a single row, it requires confirmation proportional to that scope — the administrator must be shown, and explicitly acknowledge, how many Memberships are affected before it proceeds. This is deliberately a stricter bar than the single-row Remove Member action in 4.11, matching the difference in consequence between the two.
- **Export.** Producing a roster export of the current filtered or selected set. An administrative reporting convenience, not a Financial Domain or Member Domain action, and therefore carries no architectural weight — included because it serves a common, real need (external reporting, compliance requests) at no cost.

Bulk actions this chapter explicitly rejects, and why:

- **Bulk plan change or bulk renewal** — every such action requires a per-member decision (which Plan, what price, what start date) that the frozen Subscription model treats as an explicit, individually agreed commercial term. Applying it in bulk would either strip that individuality or silently assume a decision on the administrator's behalf. This belongs to Member Profile, one member at a time, however many times it needs repeating.
- **Bulk messaging** — Non-Responsibility (4.4).

## 4.11 Context Menu

A row-level action belongs in the context menu only if it requires nothing beyond a single confirmation — no form, no additional choice. Two qualify:

- **View Profile** — the row's primary destiny (4.5); always present, always first.
- **Remove Member** — ends the Membership; a single confirmation, no further input.

Everything else — changing a Plan, recording a payment, freezing for a specific duration, transferring to another Gym — requires a decision that deserves the full context Member Profile provides, and does not belong here (4.4; Principle 4). A context menu crowded with actions that immediately open a form elsewhere is not a convenience; it is a second, worse entry point to the place the row's own primary action already reaches.

## 4.12 Empty States

Two distinct situations require distinct treatment, because they mean different things:

- **A Gym with no members yet.** A new Gym's first state. The Directory orients the administrator toward the action that populates it, rather than merely reporting absence.
- **A search or filter that matches nothing.** The roster is not empty — the current narrowing is simply too specific. The Directory makes it obvious that a filter or search term is active and offers to clear it, and never implies the Gym itself has no members.

Conflating these into one generic "no results" message would leave an administrator unable to tell "I have no members" from "I filtered too narrowly" — an avoidable moment of confusion.

## 4.13 Performance & Scalability

The Directory must behave identically in character whether a Gym has 20 members or 10,000 (Principle 8):

- Search and filter results must feel instantaneous regardless of roster size.
- The Directory must never require the entire roster to be present before the screen becomes usable.
- Bulk actions (4.10) must be able to target a selection defined by search or filter criteria, not only individually clicked rows — at 10,000 members, clicking each one is not a real option.

This chapter does not prescribe how these are achieved; that is implementation, out of this document's scope.

## 4.14 Permissions

The Member Directory is an administrator surface. Consistent with this platform's existing role model, a Coach's access is scoped to WOD and Classes, not member management — the Directory is outside that scope, and this document introduces no change to that boundary. Every capability in this chapter — viewing, searching, filtering, sorting, bulk removal, export, per-row removal — is available only to an administrator of the Gym being viewed. This document takes no position on how that restriction is enforced, only that no capability described here is ever exposed to a non-administrator, or across a Gym boundary, in the product.

## 4.15 Future Extensibility

The Member Domain Architecture already names several future capabilities as additive, not requiring redesign: multi-location and franchise access, family and dependent memberships, corporate and bulk seats. The Member Directory, as specified here, is compatible with all three without modification to this chapter:

- **Multi-location** — the Directory remains Gym-scoped; a Member holding Memberships at multiple Gyms simply appears once per Gym's own Directory, exactly as today.
- **Family and dependent memberships** — an open product-policy question at the architecture level, not yet decided. This chapter does not anticipate it; when it is decided, the Directory's one-row-per-Membership model (4.5) is the correct place to extend from, not redesign.
- **Corporate and bulk seats** — a seat becomes an ordinary Membership once assigned to a Member; it requires no change here, since the Directory already treats every Membership uniformly regardless of who is paying for it.

No capability in this chapter requires an ADR against the frozen architecture. Everywhere this chapter reads a fact — access status, Membership state, Plan name — or performs an action — enroll, remove — it does so through a concept the Member Domain Architecture or Financial Domain Architecture already defines.

---

# 5. Member Profile

**Status:** Approved
**Version:** 1.1
**State:** Frozen

This chapter is frozen. Future modifications require an explicit Product Design Review and approval before implementation.

**Revision history:** Version 1.1 supersedes Version 1.0, following a narrowly scoped Product Design Review that resolved a verified inconsistency with the frozen Member Domain Architecture — Resume was added to 5.16 as the required counterpart to Freeze. No other section changed between versions.

## Fundamental Principle

**The Member Profile is the single place to see everything true about one member and act on all of it — by orchestrating what other domains already own, never by owning any of it itself.**

Every section below exists to serve this principle. Where a section would make the Profile the source of truth for a fact or a rule that Member, Membership, Subscription, or the Financial Domain already owns, that section is wrong, regardless of how convenient it would be.

The Member Directory (Chapter 4) answers "who should I work on?" The Member Profile answers "what do I need to know about this member, and what can I do for them?" It is the administrator's operational workspace for exactly one member — never a list, never a dashboard, never a second implementation of a domain that already has one.

## 5.1 Purpose

The Member Profile exists so that once an administrator has found a member — through the Directory, or by any other path that reaches this screen — everything relevant to that member and every action available for them is in one place, requiring no separate visit to another screen, system, or mental model.

It is also where Chapter 4 explicitly deferred every decision-requiring action: editing personal information, assigning or changing a Plan, freezing, renewing, recording a payment, issuing a refund, removing, and transferring. Nothing on this list was designed in Chapter 4. This chapter designs where, and how, each of them belongs here.

## 5.2 Objectives

The Member Profile must let an administrator:

1. See everything currently true about this one member without navigating elsewhere.
2. Understand not just *that* this member's access is what it is, but *why* — which Subscription, which Plan, since when, and until when.
3. Understand how this member arrived at their current state — their history with this Gym, not only their present moment.
4. Take any action this member's situation calls for, from this one screen, with exactly the context needed to make each decision responsibly.
5. Move between this member's identity-level facts and their commercial facts with equal ease — neither buried beneath the other.
6. Move from one member to the next within a filtered or sorted set, without returning to the Directory between them.

Every capability in this chapter exists to serve one of these six objectives.

## 5.3 Responsibilities

The Member Profile owns:

- Displaying this Member's personal identity, and the means to edit it.
- Displaying this Membership's roster-relationship facts and current lifecycle state.
- Displaying this Membership's current, live access status and the Subscription terms behind it.
- Displaying this member's financial history, at exactly the level the Financial Domain Architecture exposes it.
- Compositing a single chronological history from facts that Membership, Subscription, and Payment already independently guarantee are historical — introducing no new historical record of its own.
- Free-text, admin-authored notes about this Membership — the Member Domain Architecture's own "non-authoritative operational metadata" (Section 8.3), never influencing any derived fact.
- Every decision-requiring action Chapter 4 named as belonging here, and no others.

## 5.4 Non-Responsibilities

The Member Profile does not own, and must never duplicate:

- **Browsing or triaging many members at once.** That is the Directory's exclusive responsibility (Chapter 4). The Profile is never a list, and never gains list-like features — no filtering across members, no bulk anything.
- **Defining commercial terms.** Which Plans exist, their pricing, their terms — owned by the Membership Catalog module. The Profile only ever consumes a Plan by reference, exactly as the Directory does.
- **Configuring Financial Domain policy.** Refund rules, available payment methods, proration formulas — Financial Domain configuration, out of this module's scope entirely (3.2). The Profile triggers financial actions; it never defines the rules those actions follow.
- **Classes, bookings, attendance, and workout history.** Separate modules, out of scope for the whole Member Management module (3.2), not only for this chapter.
- **Communication and messaging.** Same boundary as the Directory (4.4) — a member's contact identifier is visible here (in full, unlike the Directory's single field), which is information, not a messaging capability.
- **Designing dependent or managed members.** An open product-policy question the Member Domain Architecture has not decided (Section 12). This chapter does not anticipate it — see 5.20.
- **A member's self-service view of their own record.** The Financial Domain Architecture's security model permits a Member to read their own Orders and Payments, but *where* and *how* that self-service view exists is a different product surface entirely, not designed here.

## 5.5 Product Principles

Principles specific to this chapter, in addition to the Fundamental Principle above and Chapter 2's global principles:

1. **Every fact states its own owner, implicitly or explicitly.** A reader of this chapter should always be able to tell whether a fact comes from Member, Membership, Subscription, or the Financial Domain.
2. **Every action here already exists in the frozen architecture.** The Profile is a second entry point to capabilities Member Domain or Financial Domain already defines — never the origin of a new one.
3. **History is only ever what the frozen architectures already guarantee as historical.** Nothing is reconstructed, inferred, or backfilled to make the timeline more complete than the underlying facts actually are.
4. **Current state outranks historical state.** An administrator opening this screen understands *now* immediately; history is available, not competing for primary attention.
5. **Financial detail is visible, and actionable through existing capabilities — never configurable.** The Profile can show money and trigger the two actions the Financial Domain already authorizes an administrator to take. It never defines a new financial rule.

## 5.6 Information Architecture

The Profile is organized into zones, each owned by exactly one concern, each exposing its own actions at its own boundary rather than through a single global action menu — a global menu would blend ownership the way a single Directory detail panel would have (Chapter 4, 4.5); keeping actions co-located with the zone that owns them is what makes "every action belongs to one domain" true in the interface, not only in this document.

- **Member Summary** — identity, always visible, never scrolled away (5.9).
- **Membership Information** — this Gym-relationship's own facts (5.10).
- **Access Information** — current, live access status and its reasoning (5.11).
- **Financial Information** — this member's Order and Payment history (5.12).
- **Activity Timeline** — the composited history across all of the above (5.13).
- **Notes** — free-text operational context (5.14).

Each zone that owns an action (5.15, 5.16) surfaces it at that zone's own edge — a Member-identity action near Member Summary, a commercial or financial action near the zone it concerns.

## 5.7 Information Hierarchy

In order of priority, top to bottom:

1. **Identity** — who this is. Always first.
2. **Standing** — can they access right now, and why. The single most operationally important fact on the screen, immediately after identity, before any history.
3. **Current commercial term** — the active or most recent Subscription and Plan behind that standing.
4. **Financial snapshot** — whether anything is currently owed or pending, shown as its own fact, never blended into standing (Section 3, Non-Responsibilities, and the Financial Domain Architecture's own "three independent facts" principle both require this).
5. **History** — Activity Timeline and past Subscriptions. Available on the same screen, not requiring navigation, but never positioned above the current state it explains.
6. **Notes** — supplementary at every point; never competing with operational facts for primary attention.

## 5.8 Navigation

The Profile is reached from the Directory's "View Profile" action (4.11), and from nowhere else this document defines — how the Directory's enrollment entry point (4.3) concludes is the enrollment workflow's own decision, not one this chapter makes on its behalf. Returning from the Profile restores the Directory exactly as it was left — including any active search, filter, or sort (Chapter 4, 4.7–4.9).

Within a filtered or sorted Directory result, an administrator can move to the next or previous member without returning to the list first — a real, common workflow (working through everyone whose access expires this week, one at a time) that the Directory's own filtering and sorting already make possible; the Profile simply lets that sequence continue without a detour back to the list on every step.

A specific member's Profile is a durable, referenceable destination — reaching the same member's Profile twice always reaches the same place.

## 5.9 Member Summary

Always visible, never scrolled away: name, full contact information (both email and phone, where known — unlike the Directory's single displayed identifier, the Profile has room for both), avatar, and this Membership's affiliation-since date (the "member since" fact Chapter 4 deferred here — Membership-owned per the Member Domain Architecture, surfaced prominently here for glanceability; its full detail lives in 5.10).

If this Membership is not currently active — removed or transferred — that fact is shown here, immediately, so no administrator mistakes a former member's record for a current one. The Profile remains reachable for non-active Memberships (the Directory's own filters allow finding them — 4.8); what changes is which actions are available (5.16), not whether the record can be viewed.

## 5.10 Membership Information

This Gym-relationship's own facts, owned by Membership per the frozen Member Domain Architecture and never blended with Subscription or access-status facts:

- Membership state — active, removed, or transferred, the only three states the architecture defines.
- Affiliation-since date, in full (the same fact summarized in 5.9).
- If removed or transferred: when, and — where the architecture records it — why, distinguishing removal from transfer exactly as the Member Domain Architecture requires (its own Section 7.1 treats these as different facts specifically so reporting and support can tell them apart; this section does not blur that distinction back together).

This section does not show Subscription or Plan detail — that is Access Information (5.11). Roster presence and current access status are different facts (Member Domain Architecture, Section 2.2), and this chapter keeps them in different sections for the same reason the architecture keeps them as different concepts.

## 5.11 Access Information

The full reasoning behind the Standing the Directory already summarizes (4.6): whether access is currently granted, and why — which Subscription (or Subscriptions — the Member Domain Architecture permits more than one simultaneously active Subscription per Membership, Section 9.1, and this section reflects all of them, not just one), which Plan, and whichever constraint actually governs when each one's access ends (a date, a remaining-session count, or both, exactly as Chapter 4 defines for the same field, 4.6). Where a Subscription is capped, remaining sessions are shown here in full, not abbreviated — this is where Chapter 4 deferred that detail (4.6, "Explicitly excluded from the row").

This section shows *current* Subscription terms only. Past Subscriptions — renewals, upgrades, downgrades, the lineage that produced the current ones — are history, and belong to the Activity Timeline (5.13), not here.

## 5.12 Financial Information Visibility

This member's Order and Payment history, at exactly the level the Financial Domain Architecture exposes it to an administrator: each Order's settlement status, and each Payment's amount, direction, date, and method where known. Where this Membership has more than one concurrently active Subscription (5.11), each Subscription's Order remains distinct and attributable to it — the Financial Domain Architecture's own one-to-one relationship between a Subscription and its Order (Section 4.5) is reflected here exactly as it exists, never collapsed into one undifferentiated total. Nothing here is inferred or summarized beyond what those records already state — this section is display only; the actions available against this data are specified in 5.16, not here, so this section's name means exactly what it says.

Consistent with the Financial Domain Architecture's own principle that entitlement, commercial agreement, and financial movement are three independent facts, none derived from another: this section never states or implies that a financial fact explains an access fact, or the reverse. A member can show as fully entitled here regardless of what this section shows, and vice versa — if a reader could infer one from the other by reading this section, that would be a defect, not a convenience.

## 5.13 Activity Timeline

A single chronological composite of facts that Membership, Subscription, and Payment already independently guarantee as historical (Member Domain Architecture, Section 8.2; Financial Domain Architecture, Section 3.1): Membership status changes (joined, removed, transferred), the full Subscription lineage (created, renewed, upgraded, downgraded, paused, resumed, ended), and Payment events (charges, refunds).

This section introduces no new record of its own — it is a read-composition across three already-append-only sources, never a fourth source competing with them. Where 5.10 and 5.11 show *current* state, this section shows *how the member arrived there* — the two are complementary, not duplicative: current-state sections never repeat history, and this section never restates current state as though it were an event.

## 5.14 Notes

Free-text, admin-authored context about this Membership — the Member Domain Architecture's own "internal admin notes... that do not affect billing or access" (Section 8.3). Each note is timestamped and attributed to the administrator who wrote it. Notes may be freely added, edited, or removed, exactly as the architecture's own "freely edited" category permits (Section 8.3) — they are the one part of this screen that is not historical by requirement.

Notes are never read by the member themselves, never referenced by any derived fact (access, financial, or otherwise), and never a substitute for the Activity Timeline — a note is someone's observation; the Timeline is the record.

## 5.15 Member Actions

Actions on the Member — the cross-Gym identity, not this Gym-specific relationship:

- **Edit personal information.** Name, contact information, date of birth, gender, emergency contact, waiver status, avatar, language and unit preference — every field the Member Domain Architecture names as freely editable (Section 8.3), and no others.

Nothing else belongs here. An action that also affects this Membership's roster status or commercial standing belongs in 5.16, even if it happens to touch a Member-owned field in passing (there is no such action in this specification — none of 5.16's actions modify identity).

## 5.16 Membership Actions

Every consequential, decision-requiring action concerning this member's standing at this Gym — spanning the Membership and Subscription entities, and the two Financial Domain actions this document's boundary (5.12) deliberately keeps separate from display. Grouped here under one label because, to the administrator making the decision, they are one category: things you decide about this member's place at this Gym. Each is the same capability the frozen architecture already defines; none is new. Ownership of each, within this shared list, is kept explicit below rather than implied by the section title alone:

**Subscription decisions:**

- **Assign or change Plan.** Creates a new Subscription — the same mechanism whether the result is described as a renewal, an upgrade, or a downgrade (Member Domain Architecture, Section 6.3). Requires choosing a Plan; the price and term follow from that choice, never entered independently.
- **Freeze.** Pauses the current Subscription for a specified duration. The sole in-place exception to Subscription immutability the architecture permits (Section 6.3, D4) — nothing else about the Subscription changes.
- **Resume.** Ends an active pause immediately, regardless of how much of the originally specified duration remains, returning the Subscription to active. The architecture names Pause and Resume as one indivisible mechanism (Section 4) — offering Freeze without its counterpart would leave half of that mechanism unreachable from this screen.
- **Renew.** The same mechanism as Assign/Change Plan, with the current Plan pre-selected — offered as its own action because it answers a distinct, recurring trigger (this member's access is ending) rather than because it is architecturally distinct.
- **End Subscription.** Ends this member's current access without ending the Membership itself — the roster relationship continues; only entitlement stops.

**Financial actions:**

- **Record a payment.** Available wherever an amount is genuinely owed. Requires an amount and, optionally, a method — nothing about pricing or terms is decided here, only that a specific payment occurred.
- **Issue a refund.** Bounded by the architecture's own invariant that a refund can never exceed the remaining refundable balance (Financial Domain Architecture, Section 3.4) — this screen reflects that ceiling; it does not enforce a different one.

**Membership decisions:**

- **Remove.** Ends the Membership. Available here with the same single-confirmation weight as the Directory's own Remove (Chapter 4, 4.11) — this is the same action, reached from a second, equally valid entry point, not a stricter or looser version of it.
- **Transfer.** Ends this Membership and begins a new one at a destination Gym — the Member Domain Architecture's own Section 8.9 describes this as "a removed-equivalent end of the origin Membership," so Transfer carries the same confirmation weight as Remove, for the same reason. This chapter names the action and its purpose only; the destination-selection workflow, and the open policy question of whether workout history moves with it (Section 12 of that architecture), are not designed here.

Explicitly excluded, and why:

- **Editing a Plan's own definition** from this screen — Catalog's responsibility, not this member's.
- **Any bulk form of these actions** — the Profile concerns one member; bulk operations, where justified at all, are the Directory's responsibility (Chapter 4, 4.10), and only for the two actions justified there.

## 5.17 Empty States

Three situations, each requiring its own treatment because each means something different:

- **No Subscription history yet.** A newly enrolled member. Access Information (5.11) shows no active Subscription; the Activity Timeline (5.13) shows only the enrollment event. This is a normal, expected state, not an error.
- **No financial history yet.** A comp or trial member who has never been charged, or a member enrolled moments ago. Financial Information (5.12) states plainly that no payments are on record, rather than appearing broken or incomplete.
- **No notes yet.** The Notes section (5.14) invites the first one rather than showing a bare, unexplained blank space.

## 5.18 Permissions

Unchanged from the Directory (Chapter 4, 4.14): the Profile is an administrator surface, scoped to the administrator's own Gym, with no change to the existing Coach role boundary. Which specific actions (5.15, 5.16) are available on a given visit depends on the Membership's and Subscription's current state — for example, Remove is not offered a second time for an already-removed Membership — but this is a consequence of the frozen state machines, not a separate permission model this chapter introduces.

## 5.19 Performance Expectations

The Directory's scaling concern is roster size (Chapter 4, 4.13); the Profile's is different — a single, long-tenured member's own history. The Profile must remain fast and fully usable for a member with years of tenure, dozens of past Subscriptions, and hundreds of Payment and Timeline entries, exactly as it is for a member enrolled yesterday. This chapter does not prescribe how that is achieved; that is implementation, out of this document's scope, exactly as Chapter 4 already establishes for itself.

## 5.20 Future Extensibility

Compatible with the same future capabilities Chapter 4 already named (4.15), without modification to this chapter:

- **Multi-location** — the Profile, like the Directory, is Gym-scoped by construction: it is one Membership's complete view, never a merged view across a Member's Memberships at different Gyms. A future multi-location Member is simply seen through a separate Profile per Gym, exactly as they are seen through a separate Directory row per Gym today.
- **Family and dependent memberships** — an open architecture-level policy question (Member Domain Architecture, Section 12), not designed here. When it is decided, the zone structure in 5.6 is the correct place to extend from.
- **Corporate and bulk seats** — a seat is an ordinary Membership once assigned; this chapter already treats every Membership uniformly, so nothing here changes.

No capability in this chapter requires an ADR against the frozen architecture. Every fact this chapter displays and every action it offers traces to something the Member Domain Architecture or the Financial Domain Architecture already defines — including recording a payment and issuing a refund, which the Financial Domain Architecture explicitly leaves as a product decision for exactly this kind of document to make (its own Section 2, Non-Goals: "whether, and how, a client surfaces that capability is a client concern").

---

# 6. Member Enrollment

**Status:** Frozen
**Version:** 1.0
**Frozen:** 2026-07-26

This chapter is frozen. Future modifications require an explicit Architecture Decision Record (ADR) before this chapter may be modified.

## Fundamental Principle

**Member Enrollment owns exactly one moment: the creation of a new Membership at a Gym — including a new Member identity where one does not already exist, and never invented or duplicated where one does. Everything the Membership becomes after that moment belongs to Member Profile, not to this chapter.**

## 6.1 Purpose

Before this chapter, nothing in this specification defines how a Membership comes into existence. Chapter 4 reserved a permanent entry point for it and explicitly deferred the workflow behind that entry point; Chapter 5 assumes a Membership already exists. Member Enrollment closes that gap: it defines the one workflow that turns "no Membership" into "a Membership exists," and nothing beyond it.

The Member Domain Architecture's own separation of identity from commerce (Section 2.1 — "identity outlives commerce") is the reason this chapter cannot be a simple record-creation form: a person may already hold a Member identity in Forge, independent of any Gym, before this enrollment ever begins. Getting that distinction right, every time, is this chapter's central responsibility.

## 6.2 Objectives

Member Enrollment must let an administrator:

1. Determine, correctly, whether the person being enrolled already holds a Member identity in Forge — never inventing a duplicate, and never silently assuming a match without resolving genuine uncertainty.
2. Bring a new Membership into existence for that identity.
3. Make the one-time opportunity to assign a Plan and choose its activation timing, without being required to.
4. Make the one-time opportunity to record how payment is being handled, independent of that commercial choice.
5. Always know what happened — a completed Membership, or a clearly abandoned attempt that left nothing behind. Never an ambiguous, half-finished state.

## 6.3 Responsibilities

Member Enrollment owns:

- **Identity resolution** — determining whether the person being enrolled already exists as a Member, including resolving an uncertain or ambiguous match explicitly (6.5).
- **Membership creation** — bringing the new Gym-relationship into existence for the resolved identity (6.5).
- **The initial commercial decision** — the one-time opportunity, available only as part of this act, to assign a Plan and choose immediate-versus-scheduled activation (6.6).
- **The initial financial decision** — the one-time opportunity to record how payment is being handled, independent of the commercial decision (6.7).
- **Outcome** — what a completed enrollment and an abandoned one each mean, with no state in between (6.8).

## 6.4 Non-Responsibilities

Member Enrollment does not own, and must never duplicate:

- **Defining what Plans exist, their pricing, or their terms.** The Membership Catalog's responsibility. This chapter consumes a Plan by reference only, exactly as Chapters 4 and 5 already do.
- **Any decision about an already-existing Membership** — changing its Plan, freezing, resuming, renewing, removing. The instant a Membership exists, every one of these becomes Chapter 5's responsibility (5.16), permanently — including the very first change to what this chapter just set up, made a moment later.
- **Browsing, searching, or finding members.** Chapter 4's responsibility. This chapter never searches; it only creates.
- **Financial Domain configuration** — refund policy, available payment methods, provider integration. Out of this module's scope entirely (Chapter 3.2), unchanged from every other chapter's own boundary here.
- **Full personal-information editing.** This chapter captures only what identity resolution and Membership creation require. The complete set of freely editable Member fields remains Chapter 5's (5.15), never duplicated here.
- **Provisioning the member's own self-service access.** How a Member eventually gains their own login is a different product surface — this chapter creates the administrative record, not the member-facing surface, the same reasoning Chapter 5 already applied to exclude a member's self-service view entirely.
- **The destination-side details of a Gym Transfer.** This chapter owns the mechanism of bringing a new Membership into existence; a future Gym Transfer chapter owns *why* that mechanism is invoked during a transfer, and what becomes of the origin Membership. This chapter makes no assumption about that future chapter's own, still-unresolved cross-tenant coordination question, and does not depend on one.
- **Communication or welcome messaging to the new member.** Out of scope for the whole module (Chapter 3.2).
- **Dependent or managed member enrollment.** An open, undecided question at the Member Domain Architecture level (Section 12). This chapter does not anticipate a resolution it doesn't own.
- **Enrolling more than one person in a single act.** This chapter concerns one Membership at a time, consistent with Chapter 5's own exclusion of bulk actions (5.4).

## 6.5 Identity Resolution

Member identity is not Gym-scoped — a person may already hold a Member identity in Forge from a prior enrollment at this Gym, an active Membership at a different Gym, or simply having been created without yet being affiliated anywhere. Identity Resolution owns determining the correct Member identity for this enrollment — which existing identity applies, or that none does — before a new Membership is created, using the same identifying information the Member Domain Architecture already places under Member's own ownership — name and contact information — never a new identifier invented for this purpose.

Three outcomes are possible:

- **No plausible match.** The enrollment proceeds by creating a new Member identity together with the new Membership.
- **A confident match.** The enrollment proceeds using the existing identity; no new Member identity is created.
- **Identity cannot be established with sufficient certainty.** Administrator confirmation is required before enrollment may continue — confirming the existing identity, or confirming that this is a genuinely different person. This is the case the Fundamental Principle's promise depends on: an unresolved ambiguity is never silently decided by default, in either direction.

A confident match additionally requires one further check: whether the resolved identity already holds an **active** Membership at *this* Gym. If it does, enrollment does not create a second, duplicate Membership — the administrator is directed to that Membership's existing Profile instead, where every capability this situation calls for already exists (Chapter 5). In every other case — no Membership at this Gym at all, a previously removed one here, or an active one only at a different Gym — enrollment proceeds normally: a new Membership is created, exactly as the Member Domain Architecture's own rejoin pattern already establishes for the removed case — a removed Membership is never reactivated in place; rejoining always creates a new one (Section 7.1).

## 6.6 The Initial Commercial Decision

Once identity is resolved, the administrator may — but is not required to — assign a Plan as part of the same act that creates the Membership, and choose whether the resulting Subscription begins immediately or on a future date. This is the same mechanism Chapter 5 already established for assigning or changing a Plan (5.16), reached here for the first time rather than reused later — renewal, upgrade, and downgrade are already one mechanism with different inputs (Member Domain Architecture, Section 6.3), and creation-at-enrollment is the same mechanism again, not a fourth variant.

Declining this opportunity is a complete, valid outcome, not an unfinished one: the Member Domain Architecture explicitly permits a Membership to exist with zero active Subscriptions (Section 4). A Membership created with no Plan is, from that instant, an ordinary Membership Chapter 5 governs — whether a Plan is assigned a moment later or never. This chapter's responsibility for the commercial decision ends the instant the Membership exists, regardless of which way it was resolved.

## 6.7 The Initial Financial Decision

This decision only arises once a Plan has actually been assigned (6.6) — with no Plan, there is nothing to attach a payment to. Where a Plan was assigned, recording how payment is being handled is required before enrollment can complete: collected now, deferred to be collected later, or waived entirely as a complimentary or trial arrangement, consistent with how the Member Domain Architecture already permits a Subscription's price to be zero by design, not by omission (Section 9.4). No outcome is assumed by default — enrollment does not complete with a Plan assigned and this decision unresolved.

This decision is independent of the activation timing decided in 6.6, not a variant of it: an administrator may activate a Membership immediately with no payment at all, or with payment deferred to be collected later, exactly as the frozen architecture already permits for an administrator-initiated Subscription. Choosing to collect payment now invokes the same recording capability Chapter 5 already established (5.16) — this chapter does not define a second way to record a payment.

## 6.8 Completion and Outcome

Enrollment is complete the moment a Membership exists with every decision it required actually resolved — or, where identity resolution (6.5) finds that an active Membership already exists at this Gym, the moment the administrator is redirected to it instead, which is a complete outcome in its own right, not an interruption of one. No Plan assigned at all (6.6) is a complete outcome in itself. A Plan assigned together with its financial outcome (6.6–6.7) is a complete outcome. A Plan assigned with no financial outcome recorded is not — per 6.7, enrollment does not complete in that state. From the moment enrollment does complete, the administrator is taken to that Membership's Profile (Chapter 5), not returned to the Directory: every decision the administrator might reasonably need to make next about this member is already Chapter 5's territory, and returning to the Directory first would only add a step to find the very record just created.

Where enrollment is abandoned or fails before a Membership is created, nothing is left behind: no Membership, and no Member identity beyond one that already existed independently of this attempt. If a financial artifact was already created before the abandonment — an Order, specifically — its handling is not redefined here; it already follows the Financial Domain Architecture's own rule that an Order is never deleted when abandoned, only ever left behind (Section 3.1). This chapter's responsibility for outcome extends only to the Membership-creation side of that moment, never to how an already-created financial record is subsequently treated.

## 6.9 Product Boundaries

- **Member Directory (Chapter 4).** Directory owns the entry point only, already frozen (4.3, 4.5). This chapter begins exactly where that entry point hands off, and never redesigns the roster view or the entry point itself.
- **Member Profile (Chapter 5).** The boundary is temporal: before the Membership exists (this chapter) versus after (Chapter 5). The commercial and financial decisions in 6.6–6.7 are not a duplication of Chapter 5's own ongoing actions — they are the same underlying mechanisms, reached through a one-time, at-creation context, exactly as Chapter 5 already distinguished Renew from Assign/Change Plan on the same grounds.
- **Financial Domain.** This chapter triggers the same already-existing financial mechanisms Chapter 5 established — an Order, and optionally a Payment. It defines no new financial behavior and holds no configuration authority, identical to every other chapter's boundary here.
- **Member Domain.** This chapter is built entirely on entities the Member Domain Architecture already defines. It introduces no new entity, state, or transition — including the rejoin pattern relied on in 6.5, which the architecture already specifies in full.
- **Membership Catalog.** Referenced, never owned — identical boundary to Chapters 4 and 5.
- **Gym Transfer (future Chapter 7).** This chapter's Membership-creation mechanism is a plausible, but not assumed, building block for a transfer's destination-side Membership. This chapter does not foreclose that reuse, and equally does not assume the exact form it will take. The cross-tenant coordination question a transfer requires — how an administrator with no visibility into a destination Gym causes anything to happen there — remains entirely open, and entirely a future chapter's own question to resolve.

## 6.10 Permissions

Unchanged from Chapters 4 and 5: Member Enrollment is an administrator surface, scoped to the administrator's own Gym, with no change to the existing Coach role boundary. Where identity resolution (6.5) directs an administrator to an existing Membership's Profile instead of creating a new one, that Profile is subject to the exact same permission boundary Chapter 5 already establishes (5.18) — this chapter introduces no exception to it.

## 6.11 Future Extensibility

- **Multi-location.** Already handled by construction, not as an extension: identity resolution (6.5) is defined around a Member potentially holding Memberships at other Gyms today, not as a future case to accommodate later.
- **Corporate and bulk seats.** The Member Domain Architecture already describes a seat becoming an ordinary Membership once assigned to a Member (Section 10). When that capability exists, seat assignment is a form of enrollment in every sense this chapter defines — identity resolution, Membership creation, and an initial commercial decision already made by the seat's own terms — requiring no redesign here.
- **Dependent or managed members.** An open, undecided architecture-level question (Section 12), correctly excluded rather than anticipated (6.4). When it is resolved, identity resolution (6.5) is the correct place to extend from, not redesign.

No capability in this chapter requires an ADR against the frozen architecture. Every fact this chapter relies on and every action it triggers traces to something the Member Domain Architecture or the Financial Domain Architecture already defines.

---

# 7. Gym Transfer

**Status:** Frozen
**Version:** 1.0
**Frozen:** 2026-07-26

This chapter is frozen. Future modifications require an explicit Architecture Decision Record (ADR) before this chapter may be modified.

## Fundamental Principle

**Gym Transfer owns only the connection between two independent, tenant-isolated decisions — an origin Gym ending a Membership, and a destination Gym completing an enrollment for the same person — coordinating them into one continuous business event without ever performing either decision itself.**

Every section below exists to serve this principle. Where a section would have this chapter end a Membership, create a Membership, or grant an administrator visibility beyond their own Gym, that section is wrong, regardless of how convenient it would be.

## 7.1 Purpose

Chapter 5 already names Transfer as a Membership action (5.16): ending a Membership because the member is continuing at a different Gym, carrying the same confirmation weight as Remove, for the same reason the Member Domain Architecture gives both — "a removed-equivalent end of the origin Membership" (Section 8.9). Chapter 6 already owns bringing a new Membership into existence, for an identity that may already exist, at whichever Gym an administrator invokes it (6.1–6.8). Between them, every mechanical step a transfer requires already has an owner.

What neither chapter can do, and what neither was ever meant to do, is reach across the boundary the other depends on. Chapter 5's Transfer action ends a Membership at the origin Gym; it has no way to cause anything to happen at a destination Gym its own administrator cannot see. Chapter 6's enrollment mechanism is, by its own Permissions section, scoped to the administrator's own Gym (6.10); it has no way to know a given enrollment is the continuation of a Membership that just ended somewhere else. Gym Transfer exists to close exactly this gap, and no other: it connects the two, without becoming either.

## 7.2 Objectives

Gym Transfer must:

1. Allow a transfer, once initiated at the origin Gym, to be completed at a destination Gym without either administrator ever gaining visibility into the other Gym.
2. Leave ending the origin Membership entirely to Chapter 5, and creating the destination Membership entirely to Chapter 6 — introducing no second way to do either.
3. Give the platform a way to know, later, whether a given transfer was completed or never completed — a distinction that must exist as a real product fact, not merely as a coincidence of matching names.
4. Introduce no new decision for either administrator to make. Every decision a transfer requires already belongs to Chapter 5 or Chapter 6.

## 7.3 Responsibilities

Gym Transfer owns:

- **The continuity between the two decisions.** What allows a Membership ending at one Gym and a Membership beginning at another to be recognized as one event rather than two unrelated ones. The Member themselves — the one party the Member Domain Architecture already designs to outlive any single Gym relationship (Section 3; Section 7.1's Member-to-Membership cardinality, "sequentially, after a transfer") — is who carries this continuity. This chapter does not define how; it defines only that this is what connects the two events, and that nothing else does.
- **The outcome of a transfer once initiated.** Whether it completed, or was never completed at any destination (7.7).
- **Confirming, so no later reader has to infer it, that Chapter 5 and Chapter 6 remain exactly as they are.** Nothing here modifies either.

## 7.4 Non-Responsibilities

Gym Transfer does not own, and must never duplicate:

- **Ending the origin Membership.** Chapter 5's Transfer action (5.16), unchanged — same mechanism, same single-confirmation weight as Remove, reached exactly as it already is today.
- **Creating the destination Membership, including identity resolution, the commercial decision, and the financial decision.** Chapter 6, unchanged, in full (6.5–6.7). The moment a destination administrator begins an enrollment, whatever they are doing is an ordinary Chapter 6 enrollment — this chapter adds no second identity-resolution outcome, no second commercial decision, no second financial decision.
- **Any visibility for one Gym's administrator into another Gym's members, Memberships, or pending activity.** No such visibility is introduced anywhere in this chapter. An administrator at the origin Gym has no way to see whether, or where, a transfer was completed; an administrator at the destination Gym has no way to see anything about the origin Gym beyond what the member themselves is able to tell them.
- **Choosing, or requiring the choice of, a destination Gym as part of initiating a transfer.** Chapter 5's own text leaves the destination-selection workflow undesigned ("the destination-selection workflow... [is] not designed here," 5.16). This chapter does not resolve that gap either — whether, and how, a destination Gym is identified at the moment Transfer is chosen remains an unresolved product decision, not something this chapter assumes an answer to.
- **Whether a Member's workout history or PRs move with a transfer.** An explicitly open question at the Member Domain Architecture level (Section 12) — a policy and competitive-fairness question the architecture itself declines to resolve. This chapter neither resolves it nor depends on it being resolved.
- **Financial Domain behaviour at either Gym.** Untouched. Any Order or Payment the destination enrollment produces is created exactly as Chapter 6 already produces one for any other enrollment (6.7); any financial history the origin Membership already accumulated is untouched, exactly as it already is for an ordinary removal.
- **Any new administrator decision.** Every decision a transfer touches — choosing to transfer, resolving identity at the destination, the commercial and financial decisions there — already belongs to Chapter 5 or Chapter 6. This chapter introduces none of its own.

## 7.5 The Origin Decision

An administrator ends a Membership as a transfer exactly as Chapter 5 already defines (5.16) — the same action, the same confirmation weight as Remove, for the same underlying reason the Member Domain Architecture gives both (Section 8.9). This chapter changes nothing about how that decision is made, confirmed, or recorded.

From the moment that Membership ends, this chapter's only interest in it is the outcome defined in 7.7. Nothing about the origin Membership remains open, pending, or reversible because a transfer was chosen rather than a removal — the Member Domain Architecture treats both as an equally terminal state for that Membership (Section 7.1), and this chapter introduces no exception to that.

Whether the administrator names a specific destination Gym at this moment, or a transfer can be initiated without one, is not settled by Chapter 5 and is not settled here. This chapter does not depend on either answer: its own responsibility begins only once the origin Membership has already ended.

## 7.6 The Connection

What makes an enrollment at a destination Gym the completion of a specific transfer, rather than an unrelated new enrollment for someone who happens to share a name, is the Member themselves. The Member Domain Architecture already establishes that a Member's identity is not owned by any single Gym and is capable of holding Memberships at different Gyms sequentially over a lifetime (Section 3; Section 7.1). Gym Transfer relies on nothing more than this: the same person who was present when the origin Membership ended is the one present when the destination enrollment begins, and no capability beyond what already exists at each end is required to make that true.

This chapter does not define how the destination administrator recognizes that a given enrollment is the continuation of a transfer, or how the Member conveys that continuity. That is a product decision still to be made, not an architectural question this chapter is positioned to answer, and it must not be resolved by assumption here. What this chapter does establish is the boundary such a decision must respect: it may not grant either administrator visibility into the other Gym, and it may not become a second way of performing identity resolution — whatever form it takes, it can only ever be additional input into the identity resolution Chapter 6 already owns (6.5).

## 7.7 Outcomes

A transfer has exactly two outcomes, and no state in between:

- **Completed.** The destination enrollment is completed under Chapter 6's own, already-defined completion criteria (6.8), recognized as continuing the same Member identity that held the origin Membership. From this point, the destination Membership is, in every respect, an ordinary Membership Chapter 5 governs — nothing about having arrived via transfer distinguishes it going forward.
- **Not completed.** No destination enrollment ever completes as a continuation of this transfer. The origin Membership's ending is unaffected either way — Chapter 5's action was already final the moment it was confirmed (7.5), and this chapter does not make it, or any Subscription it ended, contingent on a destination ever materializing.

There is no administrator action, in this chapter or any other, that reverses an origin Membership's ending because a transfer was never completed at a destination. This is not a gap; it is the same finality the Member Domain Architecture already gives Remove, applied consistently to Transfer for the same reason (Section 7.1: terminal for this Membership in both cases).

Where a destination enrollment is itself abandoned or fails partway through, that is not a distinct outcome this chapter defines — it is Chapter 6's own abandonment outcome (6.8), unmodified, applying to this enrollment exactly as it would to any other.

## 7.8 Product Boundaries

- **Member Directory (Chapter 4).** No direct relationship. At the origin Gym, a transferred Membership is already visible through the Directory's existing removed/transferred handling, unmodified. At the destination Gym, the new Membership appears exactly as any other enrollment would.
- **Member Profile (Chapter 5).** Chapter 7 depends on, and never modifies, the Transfer action already defined there (5.16). Choosing Transfer produces the continuity described in 7.6 as an additive consequence of that existing action — 5.16's own text is unchanged.
- **Member Enrollment (Chapter 6).** Chapter 7 depends on, and never modifies, identity resolution (6.5) or any other part of the enrollment mechanism. Whatever the Member is able to provide as continuity (7.6) is new input to a determination Chapter 6 already owns, never a new determination this chapter makes on Chapter 6's behalf.
- **Member Domain.** Built entirely on entities and states the Member Domain Architecture already defines — the `transferred` Membership state and its terminal nature (Section 7.1), and the Member identity's own capacity to hold Memberships at different Gyms sequentially (Section 3). No new entity, state, or transition is introduced.
- **Financial Domain.** No direct relationship. Any financial fact at either Gym is reached exclusively through Chapter 6's already-established boundary, exactly as every other chapter in this specification already relies on it.

## 7.9 Permissions

Unchanged from Chapters 4, 5, and 6: every capability this chapter touches is exercised by an administrator acting only within their own Gym. An origin administrator's authority extends only to ending a Membership (5.16) — never to anything at a destination Gym. A destination administrator's authority extends only to performing an enrollment (Chapter 6) — never to anything at an origin Gym, including whether, when, or where a transfer was initiated. This chapter introduces no exception to either boundary, and no new permission of any kind.

## 7.10 Future Extensibility

- **A Member transferring more than once over their lifetime.** Already valid without modification — each transfer is an independent instance of the same origin-ends, destination-creates pattern; nothing here accumulates or changes shape with repetition.
- **A Member with no active Subscription, or with historical Orders and Payments, transferring.** Already valid — Chapter 5's ending action does not depend on Subscription state, and historical Financial Domain records are untouched by a Membership's state changing, exactly as already established for ordinary removal.
- **Gyms with no business relationship to one another.** This chapter places no dependency on any relationship existing between an origin and a destination Gym, and none is required for a transfer to complete.
- **The still-open question of whether workout history or PRs move with a transfer.** When the Member Domain Architecture resolves it (Section 12), the extension point is there, not here — this chapter places no obstacle in either direction.
- **How continuity is actually conveyed between the two decisions (7.6), and how a destination Gym is identified at the point of initiating a transfer (7.4, 7.5).** Both remain open product decisions, not yet made. Nothing in this chapter assumes an answer to either, and nothing here needs to change once they are decided — the boundary described in 7.6 already accommodates whatever form that decision eventually takes.

No capability in this chapter requires an ADR against the frozen architecture. Every fact this chapter relies on, and the one capability it adds — the continuity between an ending and a beginning — traces to something the Member Domain Architecture already defines.
