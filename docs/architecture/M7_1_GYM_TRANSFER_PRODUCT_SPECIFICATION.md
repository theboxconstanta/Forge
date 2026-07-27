# M7.1 — Gym Transfer Product Specification

## Freeze Notice

**Status:** APPROVED, CANONICAL, FROZEN
**Frozen:** 2026-07-26

This document is the sole authoritative Product Specification for Gym Transfer. It has completed Product Design, an adversarial Design Challenge against its own initial recommendation, a Final Architecture Validation against the frozen Member Domain Architecture, a Canonical Review for internal self-consistency, and a Final Editorial Freeze Pass. No open questions remain.

From this point forward, this document MUST NOT be modified except through an explicit, approved Architecture Decision Record (ADR). Any apparent gap, ambiguity, or implementation difficulty discovered later MUST be raised as an ADR candidate, never silently resolved by reinterpreting this text.

**Scope boundary**: this document defines product behavior only — journeys, business rules, security properties, and product decisions. It defines zero technical architecture, zero database schema, zero API surface, and zero implementation sequencing. That is M7.2 (Technical Architecture) and M7.3 (Implementation Plan / Execution Plan), both of which implement this document exactly as written and may not reinterpret it.

**Explicitly out of scope, deferred to M7.2**: the precise redemption mechanics of how a Transfer Code interacts with the destination gym's own join flow (replace vs. supplement) is deliberately left unresolved here — M7.2 resolves it as a technical implementation decision, not a reopening of this document's own ambiguity.

---

## 1. Executive Summary

Gym Transfer lets a Member who is leaving one Gym continue their relationship with Forge at a new Gym, without losing the platform-level continuity of their identity. The origin Gym ends the Membership as a Transfer, distinct from an ordinary Removal. The Member, at their own later discretion, joins any Gym using Forge's existing self-service join mechanism — this is the Primary Journey, and it requires no new capability beyond recognizing that the ending was a Transfer. For the narrow case where the Member cannot complete that self-service join themselves, a Transfer Code — a fallback-only, single-use, time-limited credential — lets the origin Gym's admin issue a code the destination Gym's admin can redeem on the Member's behalf. In both journeys, tenant isolation is absolute: no Gym ever learns anything about another Gym.

## 2. Business Goals

- Let a Member's relationship with Forge survive a change of Gym, without requiring a new account or losing platform history.
- Give an origin Gym's admin a clean, deliberate way to end a Membership specifically because the Member is moving elsewhere, distinct from Removal (which carries no such implication).
- Support the realistic case where the Member cannot complete their own join at the new Gym, without weakening tenant isolation to do so.
- Do this without requiring any Gym to ever learn about, or exchange data with, another Gym.

## 3. Product Principles

- **Identity-based continuity is primary.** The ordinary, expected path is the Member joining a new Gym themselves, using the exact same self-service mechanism already used for a first-time join. Nothing new is required of the Member for this path to work.
- **The Transfer Code is fallback-only.** It exists solely for the case where the Member cannot complete the Primary Journey themselves. It is never part of the ordinary journey, never required, and never the primary mechanism.
- **Recognition is informational only.** Whether Forge recognizes a new Membership as a continuation of a prior Transfer has no consequence of any kind — no data migration, no automatic entitlement, no special treatment. It exists to give the Member and admin a sense of continuity, nothing more.
- **Tenant isolation is absolute.** No Gym ever learns about another Gym — not its name, not its existence, not any fact about a Member's history there — through any mechanism this feature introduces, in either journey.
- **Finality.** A Transfer, like a Removal, is a final, terminal ending of the Membership at the origin Gym. It is never reversible, never partially undone, and carries the same one-time, deliberate weight as Removal.

## 4. Definitions

- **Transfer**: the act of an origin Gym's admin ending a Member's Membership specifically because the Member is moving to another Gym, distinct from an ordinary Removal.
- **Origin Gym**: the Gym a Member is leaving via a Transfer.
- **Destination Gym**: the Gym a Member subsequently joins, via either the Primary or Fallback Journey. Not necessarily known, named, or predetermined at the moment of Transfer.
- **Primary Journey**: the Member independently completing the existing self-service join at any Gym, after their Membership ended as a Transfer.
- **Fallback Journey**: the alternate path used only when the Member cannot complete the Primary Journey themselves — an origin-admin-issued Transfer Code, redeemed by the destination admin on the Member's behalf.
- **Recognition**: Forge determining that a newly created Membership belongs to the same, immutable Member identity whose most recent previous Membership ended as a Transfer.
- **Transfer Code**: a fallback-only, single-use, time-limited, one-active-at-a-time, globally unique credential, issued by the origin Gym's admin and redeemed by the destination Gym's admin, standing in for the Member's own action only when they cannot perform it themselves.

## 5. Complete User Journey

A Member's relationship with the origin Gym ends via a Transfer, initiated by an admin there. From that moment, the Member is free — at any time, with no urgency imposed by the system — to join any Gym they choose, using the exact same self-service mechanism as any new member. If they can do this themselves, nothing else is required: this is the complete journey, start to finish. If they cannot — no account access, no app, no ability to complete it unassisted — the origin Gym can, at the Member's own request, issue a Transfer Code, which the Member then presents to whichever Gym they are joining. That Gym's admin uses the code to complete the enrollment on the Member's behalf.

## 6. Member Journey

- Their Membership at the origin Gym ends, communicated as a Transfer (not a Removal).
- At any later time, of their own choosing, they join a new Gym using that Gym's own join code — identical to how any new Member joins, with no special step, no special screen, no indication anywhere in that flow that a Transfer even occurred.
- If Recognition applies, they may see an informational confirmation that their continuity was recognized — this has no effect on anything else.
- If they cannot complete this themselves, they request a Transfer Code from the origin Gym (out of band — a call, a message, an in-person request), then present that code to the destination Gym when asked.

## 7. Origin Admin Journey

- Ends a Member's Membership via the Transfer action — the same single-confirmation weight as Remove Member, a deliberate, final action.
- May, at the Member's own later request, issue a Transfer Code for that specific ended Membership — never proactively, never for a Membership that did not end as a Transfer.
- May revoke an issued Transfer Code at any time before it is used.
- Learns nothing about which Gym, if any, the Member eventually joins, through either journey.

## 8. Destination Admin Journey

- In the ordinary case, does nothing different from any other new Member's join — they are not aware a Transfer occurred at all, since the Primary Journey is indistinguishable from an ordinary first-time join.
- In the fallback case, is presented with a Transfer Code by the Member and completes the enrollment using it. Learns only that a code was presented and used — never which Gym issued it, never anything about the Member's history there.

## 9. System Journey

The origin Gym's admin ends the Membership, tagged as a Transfer rather than a Removal — a terminal, final state, per the Member Domain's own Membership state machine. At any later time, the Member's own join at any Gym creates a new Membership for that same, immutable Member identity. Forge determines Recognition by checking whether that Member's most recent previous Membership ended as a Transfer — a fact derived from history, not stored or trusted as an independent flag. Where the Fallback Journey is used instead, a Transfer Code — issued only against an already-Transferred Membership, unique, single-use, time-limited, at most one active at a time — is what stands in for the Member's own join action, consumed exactly once upon successful redemption.

## 10. State Transition Narrative

A Membership begins Active. It ends exactly once, terminally, either as Removed or as Transferred — these are mutually exclusive, final states; neither reverses, and neither converts into the other after the fact. A Transferred ending does not, by itself, create anything else — it is purely a fact recorded about how that specific Membership ended. A new Membership, created later at any Gym (via either journey), is a wholly new Membership for the same Member identity — never a reactivation of the old one. Recognition is evaluated fresh each time it matters, by looking at whether that new Membership's immediately preceding one ended as a Transfer — it is never itself a stored state that could drift from the truth.

## 11. Business Rules

1. A Transfer is a final, terminal ending of a Membership, carrying the same single-confirmation weight as a Removal — never reversible, never partial.
2. A Membership may end as Removed or as Transferred, never both, and never convert from one to the other after the fact.
3. The Primary Journey's join mechanism is identical, in every respect, to the ordinary first-time join — no new step, field, or screen is introduced into it for a transferred Member.
4. Recognition applies only when a Member's immediately preceding Membership ended as a Transfer — not any Membership further back in their history, and not a Membership that ended as a Removal.
5. Recognition is purely informational — it has no effect on billing, training history, entitlements, or any other system behavior, in either direction.
6. Recognition, when it applies, is surfaced to the Member with full context of what it means (a returning identity, not a new one), why it is happening (their most recent previous Membership ended as a Transfer), and that it carries no consequence beyond the informational confirmation itself.
7. A Transfer Code may be issued only against a Membership that has already ended as a Transfer — never against an active Membership, never against one that ended as a Removal.
8. At most one Transfer Code may be Active for a given Transfer at any time.
9. Issuing a replacement Transfer Code immediately and unconditionally supersedes any Transfer Code still Active for that same Transfer.
10. A Transfer Code is single-use — a successful redemption is the only path to its Used state, and it cannot be redeemed a second time.
11. A Transfer Code is time-limited — it becomes invalid once its validity window elapses, whether or not it was ever used.
12. A Transfer Code may be explicitly revoked by the origin Gym's admin at any time before it is used.
13. Recognition and the Transfer Code are entirely independent of the Financial Domain — no Order, Payment, Subscription, or billing fact is created, read, or affected by either journey.
14. Every Transfer, and every Transfer Code issuance/revocation/use, is auditable — who acted, when, and what the resulting state was — visible only to the Gym(s) legitimately entitled to see it.

## 12. Security Model

Tenant isolation is structural, not procedural — no Gym ever learns about another Gym through this feature, in either journey. The origin admin never learns which Gym, if any, a former Member eventually joins. The destination admin, in the Fallback Journey, learns only that a Transfer Code was presented and successfully used — this is the only fact the fallback journey reveals beyond what the primary journey reveals, and it never includes which Gym issued the code, or anything about the Member's history there. A Transfer Code's failure to redeem (invalid, expired, revoked, used, or otherwise not currently valid) is communicated uniformly — the destination admin cannot distinguish why a given code did not work, preventing any code from being used as a probe for information about its own history or origin.

## 13. Failure Handling

- An admin attempting to issue a Transfer Code against a Membership not already ended as a Transfer is rejected outright, with no code created.
- An admin attempting to act on a Transfer Code already in a terminal state (used, revoked, or a replaced/superseded one) is rejected uniformly, with no indication of which terminal state applies.
- A Member unable to complete either journey (no self-service join possible, and no Transfer Code obtainable or usable) simply remains without a Gym — the same state any Member without a current Gym is already in; no journey in this feature is ever mandatory or time-pressured beyond the Transfer Code's own validity window.
- A destination admin presented with an invalid, expired, used, or revoked code is told only that it is not valid — never why.

## 14. Edge Cases

- **Member has no account access at all** (lost credentials, no device): the origin Gym can issue a Transfer Code, at the Member's own request, for exactly this situation.
- **Member never joins any new Gym**: no consequence — they simply remain without a Gym indefinitely, exactly as any Member choosing not to join one would.
- **Member is transferred more than once over time**: Recognition, each time, considers only the immediately preceding Membership — a Member with a long history of Transfers and ordinary Removals is recognized correctly based only on their most recent ending, not their full history.
- **An issued Transfer Code is never used and never revoked**: it simply becomes invalid once its validity window elapses — no cleanup action is required of anyone.
- **Workout history, PRs, and other training/social data**: explicitly out of scope for this feature — Gym Transfer concerns only the Membership relationship and Member identity continuity, not portability of any other data across Gyms. See Outstanding Risks.

## 15. Product Decisions

Recognition, for the ordinary case where a Member later joins a Gym entirely through their own action, requires no new capability beyond what already exists — the self-service join mechanism is entirely unmodified, and Recognition itself is a read-only determination over existing Membership history. The feature's real, new supporting capability — the Transfer Code and its complete lifecycle — exists specifically and only for the Fallback Journey, where the Member cannot act on their own behalf.

Whether a Transfer Code, when presented, replaces or supplements the destination Gym's own ordinary join flow is deliberately left unresolved at the product level — this is a technical redemption-mechanics decision for M7.2, not a product ambiguity requiring resolution here. Both the Member's own journey and the Transfer Code's journey are described, in this document, only in terms of what each accomplishes, not the exact mechanical shape of how a presented code is entered or processed.

## 16. Outstanding Risks

- Workout history, PRs, and other training/social data do not follow a Member across a Transfer in any automated way — this is a known, accepted product limitation, not a defect, and is explicitly out of scope for this feature.
- A leaked or shared Transfer Code could be used by someone other than the intended Member before the legitimate Member uses it — mitigated by the code's single-use, time-limited, revocable design, and judged an acceptable, bounded risk given the code grants only a single enrollment action, nothing more.
- A future need for bulk/franchise-level transfers (many Members moving at once, e.g. a gym closing) is explicitly not addressed by this feature, which is scoped to individual, admin-initiated transfers only.

## 17. Open Questions

None remain.
