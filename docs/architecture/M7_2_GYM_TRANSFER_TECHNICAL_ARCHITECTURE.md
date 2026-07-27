# M7.2 — Gym Transfer Technical Architecture

**Status**: CANONICAL
**Implements**: Gym Transfer Product Specification (M7.1) — APPROVED, CANONICAL, FROZEN
**Constrained by**: Member Domain Architecture (frozen), Financial Domain Architecture (frozen)

**Terminology**: this document uses every product-level term (Recognition, Transfer Code, Primary Journey, Fallback Journey, Origin Gym, Destination Gym, Transfer) exactly as M7.1 defines it, with no synonym or alternative wording. Where a term is purely technical (Terminal State, Derived Expiry, Source of Truth), it is defined once, at its first authoritative use below, and referenced everywhere else. Each state name of the Transfer Code state machine (Active, Used, Revoked, Superseded) and of the Membership state machine (Active, Removed, Transferred) is a proper noun throughout this document.

---

## 1. Executive Summary

This document implements M7.1 exactly as written. It reuses every Forge capability M7.1's own reasoning already identifies as reusable, and introduces only the components M7.1 acknowledges as new: the Transfer Code and its lifecycle, and the narrow origin-side action that ends a Membership as Transferred rather than Removed.

The Primary Journey requires no new backend capability. It is the existing member self-service gym-join mechanism, exercised unmodified, against a Member whose most recent Membership carries a status value the schema has reserved since M1.1. The Fallback Journey requires new, narrowly-scoped infrastructure, defined completely in Sections 5 and 9.

This document changes no Business Rule, Product Decision, or journey defined by M7.1. Where a technical requirement of M7.1 was not fully supported by what already exists in the repository, that gap was named as such and closed within this document's own authority, without modifying M7.1, the Member Domain Architecture, or the Financial Domain Architecture. No such gap remains open (Section 21).

---

## 2. Scope

**In Scope**
- Tagging a Membership's ending as Transferred.
- Deriving Recognition from Membership history.
- The complete Transfer Code lifecycle (Section 9): issuance, exclusivity, supersession, Derived Expiry, revocation, single-use redemption.
- The Fallback Journey's destination-side redemption action.
- Authorization, audit, and concurrency handling for every write path this document introduces.

**Out of Scope**
- Any change to the Financial Domain's tables, RPCs, or business rules.
- Any change to `members`, its columns, or its ownership of identity.
- Any change to `profiles.gym_id`'s role as the platform's tenancy signal.
- Workout history / PR portability across a Transfer (M7.1 §14).
- Any consequence attached to Recognition (M7.1 §11 Rule 13).
- Bulk/franchise-closure transfer tooling.

**Assumptions**: the existing gym-change synchronization trigger, the existing member self-service join RPC, and the existing gym-code reservation pattern remain live and unmodified except where Section 5 names an extension explicitly.

**Non-goals**: no generic domain-event platform is introduced (Section 8). No background or scheduled job is introduced; every time-dependent state is derived at the moment it is checked (Section 9).

---

## 3. Architectural Constraints

**Financial Domain (frozen)**: Orders MUST remain immutable once created; Payments MUST remain append-only; this feature MUST NOT introduce any new Order- or Payment-producing path. This feature's only Financial Domain interaction is the origin-ending action's reuse of the existing subscription-ending capability, invoked exactly as Member removal already invokes it (Section 6).

**Member Domain (frozen)**: `members` MUST remain the sole Source of Truth for identity; `memberships.status` MUST remain limited to Active, Removed, and Transferred; a Membership's ending MUST remain terminal; status MUST be derived rather than trusted as a stored fact wherever a derivation exists (Member Domain Architecture §2.2). This document introduces no new status value, column, or entity to `members` or `memberships`; it populates a value the schema has reserved since M1.1. Recognition (Section 10) applies §2.2's own derivation principle rather than creating an exception to it.

**M7.1 (frozen)**: identity-based recognition is primary; the Transfer Code is fallback-only and MUST NOT appear in the Primary Journey; Recognition is informational only; tenant isolation is absolute in both journeys; exactly one Transfer Code SHALL be active per Transferred Membership at any time; a replacement SHALL supersede the code it replaces; every Transfer Code SHALL be globally unique. Every section below implements these properties directly; Section 21 traces each technical decision to the Business Rule it implements.

**Resolved discrepancy, not requiring an ADR**: M7.1 and the underlying Admin Member Management Specification's Chapter 7 reference an administrator-invoked enrollment mechanism ("Chapter 6") as a precondition of the Fallback Journey's destination side. Repository verification found no such mechanism. Because M7.1 deliberately leaves the exact redemption mechanism unspecified (its own Canonical Review left "how a Transfer Code is redeemed" open to M7.2), this document resolves the gap by defining the Fallback destination-side redemption action as a new, narrowly-scoped component (Section 5), without assuming Chapter 6 exists and without modifying M7.1 to remove the reference. No ADR is required, because no frozen document requires modification to reach this resolution (Section 21 confirms no ADR-triggering issue exists).

---

## 4. Existing Components Reused

| Component | Current Responsibility | Reuse in Gym Transfer | Modification Required |
|---|---|---|---|
| Member self-service gym join | Lets an authenticated Member with no current gym join one via that gym's own join code | The entire mechanism behind the Primary Journey — a member whose Membership ended as Transferred reaches the same no-gym state Removal produces, and completes their side of the Transfer through this unmodified capability | None |
| Gym-change synchronization trigger | Creates a new Membership on a no-gym-to-gym transition; ends the active Membership on a gym-to-no-gym transition | The Membership-creation half is reused unmodified. The Membership-ending half is extended (Section 5) to write Transferred instead of Removed when signaled to do so, and to supersede an outstanding Transfer Code on the Membership-creation half (Section 9) | Extended, not replaced (Section 5) |
| Origin gym-ending action (the existing Remove Member pattern) | Verifies administrator authority, clears the tenancy signal, ends any active Subscription via the existing subscription-ending capability | Chapter 5's Transfer action reuses this exact shape via a sibling action (Section 5), differing only in the reason signaled to the synchronization trigger | None to the existing action itself — a sibling is introduced instead, to isolate all regression risk from Remove Member |
| Gym-code reservation pattern (existing gym join codes) | Issues and validates short, single-purpose codes granting a bounded capability without a pre-existing relationship | The Transfer Code's design (Section 5, Section 7) follows this proven shape as precedent | None — Transfer Code is a distinct entity (Section 7), because it is scoped to one Membership and one Member, not to a gym at large |
| Visibility-removing Broadcast mechanism (existing, used for Remove Member) | Notifies a client whose own row is about to leave its RLS-visible set | Fires identically and unmodified on a Transfer-tagged ending, because that ending is structurally the same visibility-removing transition Remove Member already produces | None |
| Unique-constraint-based idempotent write pattern (existing, used for Payment registration) | Guarantees a specific action's effect is not duplicated under retry or concurrent delivery | Secures Transfer Code single-use redemption (Section 14) | None |

---

## 5. New Technical Components

**Transfer-tagged origin ending action**
- *Purpose*: lets an origin administrator end a Membership as Transferred.
- *Responsibilities*: authorize the calling administrator against the target gym; clear the Member's tenancy signal for that gym; signal "Transferred" as the reason to the synchronization trigger extension below; invoke the existing subscription-ending capability unchanged.
- *Dependencies*: the gym-change synchronization trigger extension; the existing subscription-ending capability.
- *Ownership*: Member Domain owns the ending itself; Gym Transfer owns the reason it signals (Section 6).

**Gym-change synchronization trigger extension**
- *Purpose*: allows the existing Membership-ending logic to write Transferred instead of Removed when signaled, and completes the Transfer Code lifecycle (Section 9) on both halves of the transition it governs.
- *Responsibilities*: on a gym-to-no-gym transition, read the reason signal and write the corresponding status, defaulting to Removed when no signal is present; on a no-gym-to-gym transition (Membership creation, either journey), supersede any Transfer Code still Active for that Member's most recently ended Transferred Membership, per Section 9.
- *Dependencies*: the Transfer-tagged origin ending action (its only source of the Transferred signal); the Transfer Code entity (as the target of the supersession it performs).
- *Ownership*: Member Domain owns the trigger; Gym Transfer owns both extensions to it.

**Transfer Code**
- *Purpose*: a narrow, single-purpose credential standing in for a Member's own action, exclusively in the Fallback Journey.
- *Responsibilities*:
  - identify the Transferred Membership and the Member identity it belongs to;
  - enforce global uniqueness — no two Transfer Codes, issued at any gym at any time, may collide;
  - enforce exclusivity — exactly one Transfer Code SHALL be Active per Transfer at any time; issuing a replacement, or the Transfer completing through the Primary Journey instead, MUST supersede any code still Active for that Transfer;
  - enforce single-use redemption — a successful redemption is the only path to Used, and no code may be redeemed more than once, including under concurrent attempts;
  - support explicit revocation by the origin administrator;
  - expose its own validity as a Derived Expiry (Section 9), never as a maintained fact.
- *Dependencies*: the Transferred Membership it is issued for; the Member identity it resolves to; the gym-change synchronization trigger extension (as the system-initiated source of supersession).
- *Ownership*: Gym Transfer, exclusively. No other domain reads or writes it.

**Fallback destination-side redemption action**
- *Purpose*: lets a destination administrator complete an enrollment on behalf of a Member who cannot complete the Primary Journey themselves, using a Transfer Code as the credential identifying which Member is joining.
- *Responsibilities*: validate the presented code is Active, unused, unexpired (Section 9), and unrevoked; authorize the calling administrator against their own gym; perform the same tenancy-signal and Membership-creation effect the Primary Journey already produces, for the Member identity the code resolves to; mark the code Used.
- *Dependencies*: the Transfer Code (as the credential validated); the gym-change synchronization trigger's Membership-creation behavior (reused, not duplicated).
- *Ownership*: Gym Transfer, exclusively. Scoped as narrowly as possible per Section 3's resolved discrepancy — it MUST NOT be extended into a general administrator-enrollment mechanism.

---

## 6. Domain Boundaries

| Domain | Owns | Interaction with Gym Transfer |
|---|---|---|
| Member Domain | Member identity; the Membership entity; its three status values (Active, Removed, Transferred); the fact of a Membership's creation or ending | Receives a one-directional reason signal at the moment of ending; its own synchronization trigger performs Transfer Code supersession as an extension it owns (Section 5) |
| Financial Domain | Every commercial entity and rule | Invoked exactly once, unmodified, via the existing subscription-ending capability, by the origin-ending action — no Order, Payment, or Subscription is created, read, or modified by any new component in this document |
| Gym Transfer | The reason distinction between Removed and Transferred at the moment of ending; the Transfer Code entity and its complete lifecycle; the Fallback destination-side redemption action; the Recognition derivation | Reads Membership history to derive Recognition; never writes to `memberships` or `members` through any path other than the Member Domain's own trigger |

No responsibility above appears in more than one domain's list.

---

## 7. Database Architecture

**Existing entities, unmodified**: `members`, `memberships`, `profiles` (specifically its tenancy-signal column), and the Financial Domain's own tables (invoked, never modified).

**Existing entity extended**: `memberships`. No new column, no new constraint — the Transferred value of its existing status field, reserved since M1.1, becomes populated for the first time (Section 3).

**New entity**: Transfer Code, holding: the Transferred Membership it belongs to; the Member identity it resolves to; its current state (Active, Used, Revoked, Superseded — Section 9); when and by whom it was issued; its validity window (Section 21); when and how it reached a Terminal State.

**Relationships**: a Transferred Membership MAY have a succession of Transfer Codes issued over time, but SHALL have at most one Active at any moment (Section 9, Section 5).

**Source of Truth**: `memberships.status` is the sole Source of Truth for whether a Membership ended as a Removal or a Transfer. The Transfer Code entity is the sole Source of Truth for whether a specific Fallback credential is currently usable. Ownership and write-exclusivity for both are defined authoritatively in Section 16.

---

## 8. Domain Events

No generic event mechanism is introduced. Every event below is carried by an existing mechanism (Section 4).

| Event | Producer | Consumer | Mechanism | Idempotency |
|---|---|---|---|---|
| Membership ended as Transferred | Origin ending action | Origin gym's roster view; the departing Member's own session | Existing visibility-removing Broadcast, unmodified | Already idempotent — a second attempt on an already-terminal Membership finds nothing to act on |
| New Membership created (either journey) | Gym-change synchronization trigger | The joining Member's own session; the destination gym's roster view | Ordinary Postgres Changes | Already idempotent (existing guard-free creation logic, unchanged) |
| Transfer Code issued / used / Superseded / revoked | Respective actions | Origin gym administrators (all transitions); redeeming destination administrator (Used, only) | Ordinary Postgres Changes, scoped per Section 12 | Enforced via the pattern in Section 4 (Payment-registration precedent) |

---

## 9. State Machines

**Membership** (Member Domain; unchanged in shape, newly populated in one branch):
```
Active ──► Removed      (Terminal State)
Active ──► Transferred  (Terminal State)
```
No transition out of either Terminal State exists.

**Transfer Code**:
```
Active ──► Used         (Terminal State — Fallback redemption succeeds)
Active ──► Revoked      (Terminal State — origin administrator action)
Active ──► Superseded   (Terminal State — either trigger below)
Active ──► [Expired]    (not a stored transition — Derived Expiry, below)
```

**Superseded has exactly two triggers, both producing the same Terminal State**:
1. A replacement Transfer Code is issued for the same Transfer.
2. The Transfer completes through the Primary Journey while this code is still Active. The gym-change synchronization trigger extension (Section 5) performs this transition automatically, in the same transaction as the new Membership's creation, as a system-initiated consequence — it carries no authorization check, since it decides nothing; it records that a decision already made elsewhere (the Transfer's completion) has occurred.

Every still-Active Transfer Code associated with a Transferred Membership therefore reaches exactly one Terminal State the moment that Transfer completes by any means. No path exists by which a Transfer completes while its Transfer Code remains Active.

**Superseded, explicitly**: Superseded is a Terminal State, reached identically to Used or Revoked — no code, once Superseded, can return to Active or reach any other state. A Superseded code is never deleted and remains permanently visible to the origin administrator under the audit rules of Section 13, regardless of which of the two triggers produced it.

**Derived Expiry**: consistent with the Member Domain's own principle that status is derived rather than trusted as a stored fact (Section 3), Expired is never a stored transition. Validity is computed at the moment a Transfer Code is checked, by comparing its issuance time plus its validity window (Section 21) against the current time. A code past its window behaves as expired the instant it is examined, whether or not it was ever examined before.

**Exactly one successful Transfer completion is structurally guaranteed**, not procedurally enforced: both journeys act on the same no-gym-to-gym tenancy-signal transition for the same Member, and only one such transition can succeed. Whichever action reaches it first completes the Transfer; the other finds the Member no longer eligible and takes no effect.

**Recognition**: not a state machine. A derived fact, recomputed on demand, with no dependency on Transfer Code state (Section 10).

---

## 10. Recognition Architecture

**Authoritative definition**: Recognition is the determination, at the moment a new Membership is created (either journey) or at any later moment it is displayed, of whether that Member's most recent previous Membership carries the Transferred status.

**Dependency**: Membership history alone. No Transfer Code, session state, or cross-tenant lookup is involved.

**Persistence**: none required. A read-optimization cache MAY exist on the new Membership row, but it is never authoritative — the derivation against history is, per Section 3's application of Member Domain Architecture §2.2.

**Failure behavior**: Recognition is informational only (M7.1 §11 Rule 13) and MUST NOT gate Membership creation. A failure to compute it has no effect on the Membership itself and can be retried at any later time from the same durable history.

**Idempotency**: trivial — recomputation at any time yields the same answer, because it depends only on data that does not change once written.

---

## 11. Backend Responsibilities

**Application layer**: presents Recognition (informational) and the existing no-gym journey, unbranched for this feature — a transferred Member and a genuinely new joiner see the same screen and the same mechanism.

**Services / RPCs**: the Transfer-tagged origin ending action; Transfer Code issuance, revocation, and replacement; the Fallback destination-side redemption action (Section 5).

**Triggers**: the single extension to the gym-change synchronization trigger, covering both the reason-signaling and the supersession responsibilities (Section 5, Section 9). No other trigger is introduced or modified.

**Edge Functions**: the Transfer-tagged origin ending action and the Fallback redemption action fit the same pattern the existing removal action already uses. This document does not mandate Edge Functions over an equivalent RPC shape; the choice is an implementation detail, provided the authorization and signaling responsibilities in Section 5 are met (Section 21, Implementation Independence).

**Background jobs**: none. Every time-dependent behavior is a Derived Expiry (Section 9), never a periodic process.

**Notifications**: reuse the existing in-app state patterns already used for other account-state changes. No new notification channel is introduced.

---

## 12. Authorization Model

| Action | Actor | Required Condition | Boundary | Cross-Tenant Protection |
|---|---|---|---|---|
| End a Membership as Transferred | An administrator of the Membership's own gym | Identical to existing Removal authorization | Origin gym only | Cannot act on any Membership at another gym |
| Issue / revoke / replace a Transfer Code | An administrator of the Transferred Membership's own (Origin) gym | Membership status MUST already be Transferred | Origin gym only | No other gym's administrator can see or act on this code |
| Redeem a Transfer Code (Fallback) | An administrator of the Destination gym | Code MUST be Active, unused, unexpired, unrevoked | Destination gym only, scoped to the enrollment it produces | The redeeming administrator learns only that a code was presented — never which gym issued it |
| Complete the ordinary join (Primary) | The Member, authenticated as themselves | Existing self-service join authorization, unmodified | Whichever gym the Member chooses | Structurally impossible for either gym to observe the other, since neither participates in the other's authorization check |

No action in this document grants any administrator visibility beyond their own gym, in either journey.

---

## 13. Audit Model

| Event | Generated By | Visibility | Immutability |
|---|---|---|---|
| Membership ended as Transferred | Origin ending action | Origin gym's own administrators only | Immutable once written |
| Transfer Code issued / revoked / Superseded (by either trigger, Section 9) | Respective actions, or the synchronization trigger extension | Origin gym's own administrators only | Terminal and immutable; never deleted; never reactivated, regardless of which Superseded trigger applied |
| Transfer Code Used | Fallback redemption action | Destination gym sees only that a code was presented; the origin gym sees the full outcome of its own issued code | Immutable |
| New Membership created (either journey) | Gym-change synchronization trigger | Destination gym's own administrators; the Member themselves | Immutable |

Every event above records who, when, and its Terminal State using the same `created_at`/`created_by` convention already established across this schema (Section 4). No new audit mechanism is introduced.

---

## 14. Concurrency Model

- **Duplicate origin-ending attempts**: resolved identically to existing Removal behavior — the first commit succeeds; the second finds an already-Terminal Membership and fails cleanly.
- **Duplicate Transfer Code issuance requests**: exclusivity (Section 5, Section 9) is enforced as a single atomic unit — the previous Active code, if any, is marked Superseded and the new one becomes Active within one transaction, so no window exists with two codes simultaneously Active.
- **Simultaneous redemption attempts with the same code**: resolved via the unique-constraint-based idempotent pattern (Section 4); the first successful redemption wins, the second is rejected as no longer Active, without distinguishing why.
- **Concurrent administrator actions on the same Transfer Code** (e.g., revoke racing a replacement): whichever transaction commits first determines the resulting state; the second is evaluated against the now-current state, not a stale read — no invalid intermediate state is reachable, because every transition is Terminal.
- **Primary Journey completing while a Fallback redemption is in flight**: resolved structurally, not procedurally, per Section 9 — only one no-gym-to-gym transition can succeed for a given Member.

---

## 15. Failure Handling

- **Expected failures**: an action targeting a Membership or Transfer Code no longer in the expected state fails cleanly and uniformly, per the state machines in Section 9.
- **Unexpected failures**: a failure in the synchronization trigger extension is isolated using the same exception-handling discipline already established for that trigger; it MUST NOT block the primary write it reacts to. A resulting data-quality gap is a reconciliation concern under existing Member Domain discipline, not a reason to fail the Member-facing action.
- **Partial failures**: the Fallback redemption action's two effects (consuming the code, producing the new Membership) MUST succeed or fail together within one transaction. A partial outcome is not a reachable state.
- **Recovery**: a failed Primary Journey attempt can simply be retried, unaffected by this feature. A failed Fallback redemption can be retried with the same code, provided it has not itself reached a Terminal State.
- **Rollback / retry strategy**: every new write is a standard transactional operation, idempotent-by-design per Section 14 — no compensating or saga-style rollback is required, and no bespoke retry policy is introduced.
- **Dead-state prevention**: exclusivity combined with unconditional supersession on replacement guarantees a Member is never permanently blocked by a lost or unusable code — a replacement is always obtainable through the same origin administrator action.

---

## 16. Data Ownership

| Entity | Owner | Writer | Source of Truth |
|---|---|---|---|
| Member identity | Member Domain | Existing identity write paths, unmodified | `members` |
| Membership (including Transferred) | Member Domain | The gym-change synchronization trigger, exclusively, including its extensions | `memberships.status` |
| Transfer Code | Gym Transfer | Issuance, revocation, replacement, redemption actions, and the synchronization trigger's supersession extension — no other writer | The Transfer Code entity itself |
| Recognition | Gym Transfer (derivation) | No writer — never stored as authoritative | Membership history, not a separate record |
| Financial Domain entities | Financial Domain | Unchanged — invoked, never written to, by this feature | Unchanged |

No entity above has more than one writer.

---

## 17. Sequence Diagrams

**Primary Journey**
```
Origin Admin → Transfer-tagged Origin Ending Action → Membership (Transferred, Terminal)
                                                     → Existing subscription-ending capability
                                                     → Existing visibility Broadcast

... Member acts at any later time, at their own discretion ...

Member (own session) → Existing self-service join RPC → Synchronization Trigger
                                                        → Membership (new, Active)
                                                        → [if a Transfer Code was Active: Superseded — Section 9]
Member's session ← Recognition derived on demand (Section 10)
```

**Fallback Journey**
```
Member → (requests, out of band) → Origin Admin
Origin Admin → Transfer Code Issuance → Transfer Code (Active)
Member → (carries code, out of band) → Destination Admin
Destination Admin → Fallback Redemption Action → validate Transfer Code (Active, unused, unexpired, unrevoked)
                                                → Synchronization Trigger's Membership-creation behavior (reused)
                                                → Membership (new, Active)
                                                → Transfer Code (Used, Terminal)
Member's session ← Recognition derived on demand (Section 10)
```

**Recognition**
```
New Membership created (either journey)
    → Query: this Member's most recent previous Membership
    → Is its status Transferred?
        yes → Recognition = true (informational only)
        no  → Recognition = false
```

**Transfer Code superseded by Primary Journey completion**
```
[Transfer Code: Active, issued earlier for this Transfer]
Member (regains access) → Existing self-service join RPC → Synchronization Trigger
                                                            → Membership (new, Active)
                                                            → Transfer Code (Superseded, Terminal) — same transaction

Destination Admin (later attempts Fallback redemption with the now-Superseded code)
    → Fallback Redemption Action → validate Transfer Code → found: Superseded
                                                            → reject uniformly, no further detail
                                                            → no Membership created, no other state changed
```

**Failure — Fallback redemption with an already-Used code**
```
Destination Admin → Fallback Redemption Action → validate Transfer Code → found: Used
                                                                          → reject uniformly, no further detail
                                                                          → no Membership created, no other state changed
```

---

## 18. Implementation Strategy

**Phase 1 — Origin-side reason tagging.** Deliverables: the Transfer-tagged origin ending action; the synchronization trigger's reason-signaling extension. Dependencies: none beyond what exists today. Completion: a Transfer-tagged ending is behaviorally identical to Removal except for the recorded status (Section 19).

**Phase 2 — Recognition.** Deliverables: the derivation (Section 10) and its surfacing. Dependencies: Phase 1. Completion: correct in both directions, with no effect on join success either way.

**Phase 3 — Transfer Code lifecycle.** Deliverables: issuance, revocation, replacement/supersession, and the Primary-Journey-completion supersession path, implemented as a second condition on the same supersession logic used for replacement — not a separate mechanism (Section 9). Dependencies: Phase 1. Completion: every Transfer Code Business Rule (M7.1 §11) independently verified, including the completed lifecycle.

**Phase 4 — Fallback redemption.** Deliverables: the Fallback redemption action. Dependencies: Phase 3. Completion: the Fallback Journey proven end-to-end, including the concurrency and failure scenarios of Sections 14–15.

Phases 1–2 alone deliver the complete Primary Journey, which M7.1 identifies as covering the ordinary case.

---

## 19. Validation Strategy

- **Technical acceptance**: every Business Rule in M7.1 §11 has an independently verifiable behavior in this architecture, traced in Section 21.
- **Integration validation**: the origin-ending action's call into the subscription-ending capability MUST behave identically to Remove Member's own call.
- **Regression validation**: Remove Member's and the self-service join's behavior MUST be verified unchanged by every extension this document introduces.
- **Security validation**: an origin administrator MUST be unable to observe any redemption fact; a destination administrator MUST be unable to observe any origin-gym fact; a Fallback redemption MUST reveal nothing beyond "a code was presented."
- **Tenant isolation validation**: exhaustive verification that no new query, trigger, or action crosses a gym boundary in either direction, in either journey.
- **Idempotency validation**: concurrent duplicate issuance requests MUST leave exactly one Active code; concurrent duplicate redemption attempts MUST succeed exactly once.
- **Lifecycle completeness validation**: no Transfer Code may remain Active once its Transfer has completed by any means (Section 9).

---

## 20. Risks

| Risk | Impact | Likelihood | Mitigation |
|---|---|---|---|
| The synchronization trigger's extensions regress Remove Member or the existing self-service join | High, if it occurred | Low, if isolated as additive branches with existing behavior as the default | Regression validation (Section 19) prior to Phase 1/3 completion |
| A leaked Transfer Code is used by someone other than the intended Member | Bounded to a single Fallback enrollment | Low (M7.1 §16) | Single-use enforcement, bounded validity window (Section 21), unconditional supersession on replacement |
| Recognition's derivation grows expensive at very large Membership-history scale | Low — informational only, never a gate | Low at current and foreseeable scale | The optional read-optimization cache (Section 10) remains available without changing the derivation's authority |

---

## 21. Technical Decisions

| Decision | Reason | Trade-off | M7.1 Provision Implemented | Frozen Architecture Affected |
|---|---|---|---|---|
| Recognition is a derivation, never a stored authoritative fact | Applies the Member Domain's own status-derivation principle (§2.2) | A small, avoidable recomputation cost versus a stored flag that could silently drift from the truth | §11 Rule 13; Section 10 | None |
| Expiry is computed at check-time, never written by a background process | Avoids any scheduled job, consistent with this platform's standing preference against them absent a proven need | Nothing observes a code becoming Expired at the exact instant its window elapses — only when next examined | §11 Rule 11; Section 9 | None |
| Transfer Code default validity window is 72 hours from issuance — an implementation parameter, not a Product Decision | Balances the realistic Fallback contact-and-relay gap (often spanning a weekend) against bounding a leaked single-use credential's exposure to a materially finite window | A Member whose process exceeds 72 hours must request a replacement (already zero-friction, per Rule 8) rather than the original remaining valid indefinitely | §11 Rule 11 | None — the value may change later without an ADR, since the mechanism (Derived Expiry, no stored transition, no background job) is unaffected by which number is used |
| An Active Transfer Code is automatically Superseded the moment its Transfer completes through the Primary Journey instead | Closes the one previously undefined lifecycle case; guarantees no Transfer Code can remain Active once its Transfer is already complete | None of substance — a strict tightening of an already-required invariant, not a new constraint on any legitimate use | §11 Rules 8, 9; Section 9 | None — implemented as a second trigger condition on existing supersession behavior, introducing no new entity or authorization actor |
| Transfer Code is a new entity, not an extension of the existing gym-code mechanism | The existing mechanism is gym-scoped and reusable across many joiners; a Transfer Code is scoped to one Membership and one Member | A second kind of code exists in the schema rather than one generalized mechanism | §11 Rules 6–10 | None to the existing gym-code mechanism |
| The origin-ending action is a sibling to the existing Removal action, not a modification of it | Isolates all regression risk to Remove Member's own, already-validated behavior | Two similar actions exist instead of one parameterized one | §11 Rule 1; Product Principles (finality) | None |
| The Fallback redemption action is scoped as narrowly as possible, not built as a general administrator-enrollment capability | No existing administrator-enrollment mechanism was found to extend (Section 3); a general capability would exceed this feature's authority | The Fallback Journey's destination side is single-purpose, not reusable | §6 (Member/Destination Admin journeys); §11 Rule 3 | None — a discrepancy named, not resolved by inventing scope beyond this feature |

---

## Internal Consistency Confirmation

Every Business Rule and Product Decision in M7.1 is implemented above and traced in Section 21, unchanged from M7.1's own text. No column, table, or status value is added to the frozen Member Domain Architecture beyond populating a reserved value. The Financial Domain is touched only through one existing, unmodified, invoked capability. Every responsibility in Section 6 has exactly one owner; every entity in Section 16 has exactly one writer. Every state machine (Section 9) is complete, with every transition Terminal and no undefined state reachable. Every new component (Section 5) is justified against what was verified not to exist. Every technical decision (Section 21) traces to a specific M7.1 provision, and none requires modifying M7.1, the Member Domain Architecture, or the Financial Domain Architecture. This document is internally self-consistent and is the canonical M7.2 Technical Architecture.
