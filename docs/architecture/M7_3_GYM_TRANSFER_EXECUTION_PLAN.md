# M7.3 — Gym Transfer Execution Plan

**Status**: Executed in full — see Closure Note at the end of this document
**Converts**: M7.3 Implementation Plan (frozen) into a sequenced, commit-level roadmap
**Authority**: this document sequences and gates work already approved in M7.1/M7.2/M7.3. It introduced no architecture, no implementation decision, and no feature not already specified.

---

## 0. How to Read This Plan

Execution proceeded in four phases, matching M7.3's own phase structure, subdivided into 11 atomic steps. Each step was one commit. No step began until the previous step's validation checklist was green. No phase began until its preceding phase's checkpoint had passed.

---

## 1. Execution Steps

### Step 1 — Trigger extension: reason-aware ending branch
Modify only the `gym → null` branch of `member_domain_sync_on_profile_gym_change()`. Migration only. Rollback: `create or replace function` reverting to the pre-Step-1 body. Risk: Low — additive, backward-compatible by construction.

### Step 2 — Edge Function: `admin-transfer-member`
Origin-admin action mirroring `admin-remove-member`. Edge Function deploy. Risk: Medium — first new write path touching `profiles.gym_id` under this feature.

### Step 3 — React: origin-admin Transfer action
Admin-facing Transfer action, same confirmation weight as Remove. Frontend deploy. Risk: Low.

### ⛳ CHECKPOINT 1 — Origin-Side Ending Complete

### Step 4 — Recognition derivation (read path)
Derive Recognition from Membership history, informational only. Risk: Low — read-only.

### ⛳ CHECKPOINT 2 — Primary Journey Complete (Ship-Ready Milestone)

### Step 5 — Transfer Code schema
New entity for the Fallback credential. Migration only. Risk: Low — additive, no existing dependents.

### Step 6 — Issuance / revocation RPCs
Exclusivity-enforcing issuance, plus revocation. Migration only. Risk: Medium — first concurrency-sensitive logic in this feature.

### Step 7 — Supersession on Primary Journey completion
Close the previously identified lifecycle gap. Migration only. Risk: Medium-High — second edit to a function already modified once (Step 1).

### Step 8 — Derived Expiry validation logic
Compute expiry at check-time against the 72-hour window; no stored `expired` value ever written. Migration only. Risk: Low.

### Step 9 — React: origin-admin Transfer Code management UI
Let the origin admin request/view/revoke a Transfer Code for a Membership already `transferred`. Frontend deploy. Risk: Low.

### ⛳ CHECKPOINT 3 — Transfer Code Lifecycle Complete (Fallback Not Yet Live)

### Step 10 — Fallback redemption Edge Function
Destination-side redemption of a Transfer Code. Edge Function deploy. Risk: High — the only write path in this entire feature performed on a Member's behalf without their own session.

### Step 11 — React: destination-admin redemption UI
Minimal entry point for a destination admin to redeem a presented code. Frontend deploy. Risk: Low (UI only).

### ⛳ CHECKPOINT 4 — Full Feature Complete

---

## 2. Commit Strategy

Each commit mapped to exactly one execution step above, kept small and independently reviewable. No commit bundled a migration with an Edge Function or React change unless genuinely inseparable for review purposes — none were.

---

## 3. Mandatory Checkpoints

**Checkpoint 1 — Origin-Side Ending Complete** (after Step 3): an admin can end a Membership as Transferred; the member disappears from the origin roster exactly as Remove Member already does. Must not break Remove Member.

**Checkpoint 2 — Primary Journey Complete** (after Step 4) — Ship-Ready Milestone: the complete Primary Journey works end-to-end; Recognition correctly surfaces. Independently shippable.

**Checkpoint 3 — Transfer Code Lifecycle Complete** (after Step 9): issuance, exclusivity under concurrency, both supersession triggers, revocation, Derived Expiry — no redemption path live yet. Must not break the ordinary join path (touched again in Step 7).

**Checkpoint 4 — Full Feature Complete** (after Step 11): the entire Fallback Journey works end-to-end, including concurrent redemption attempts and uniform rejection of any invalid code.

---

## 4. Test Execution Order

1. Unit — trigger branch logic, Derived Expiry boundaries, authorization predicates.
2. Database — direct SQL/RPC exercise of each new function/RPC.
3. Integration — full Edge Function → trigger → resulting row chain.
4. Authorization — cross-gym rejection, admin-target rejection, non-admin rejection.
5. Tenant Isolation — no gym observes another gym's data beyond what M7.2 §12 allows.
6. Concurrency — every race scenario in M7.3 §6.3.
7. Regression — the full existing Remove Member and self-service join suites, re-run unchanged.
8. End-to-End — complete Primary Journey and complete Fallback Journey.

---

## 5. Deployment Plan

Development → Local Validation → Migration Deployment → Edge Function Deployment → Frontend Deployment → Smoke Tests → Production Deployment, applied at each checkpoint boundary, with a scoped rollback strategy per step (§1) rather than a blanket revert.

---

## 6. Stop Conditions

Implementation was to halt immediately, marking the step **ADR CANDIDATE**, on: any required modification to Member Domain–owned objects beyond the two named trigger extensions; any required modification to the Financial Domain beyond the existing `end_subscription` call; any required modification to M7.1/M7.2/M7.3; a domain-ownership violation; a migration inconsistent with the live schema; a missing dependency; an inability to achieve tenant isolation; any new entity/table/column/workflow beyond what M7.2/M7.3 name.

No stop condition was triggered during execution (see Closure Note).

---

## 7. Success Criteria

- Every Business Rule in M7.1 §11 has a passing verification.
- Every component named in M7.2 exists in the deployed system.
- Every task in M7.3 is complete.
- The full regression suite passes with zero behavioral difference from pre-M7.3 `main`.
- Tenant isolation, authorization, and concurrency are verified at every checkpoint.
- No stop condition was triggered without a corresponding ADR.

---

## Closure Note (added at M7 close-out, 2026-07-27)

All 11 steps were implemented, independently reviewed, validated against the linked database, approved, and committed:

| Step | Commit |
|---|---|
| 1 | `2e3640e` |
| 2 | `9dae32e` |
| 3 | `0715541` |
| 4 | `1634fe3` |
| 5 | `4ea01ee` |
| 6 | `291ae84` |
| 7 | `16d6ac0` |
| 8 | `f93ab1a` |
| 9 | `d4546f6` |
| 10 | `b3bfabb` |
| 11 | `8530b6f` |

No stop condition was triggered. Two implementation-level technical necessities were identified and resolved within M7.2 §11's own stated implementation latitude, confirmed not to require an ADR, and are recorded here rather than by editing the original step tables above (preserving this document as the historical record of what was approved going in):

- **Step 2 and Step 6** originally estimated no new database objects/RPC for the origin-ending signal and (implicitly) for exclusivity enforcement. Implementation found that (a) signaling the ending reason and writing `profiles.gym_id` must happen inside one transaction, requiring one small service-role-gated RPC (`end_membership_as_transfer`), and (b) guaranteeing "exactly one active Transfer Code" under genuinely concurrent issuance requires a database-level constraint (a partial unique index), not application logic alone. Both were flagged explicitly before implementation, confirmed compliant with M7.2 §11's explicit delegation of this choice to implementation, and did not require modifying any frozen document. Full reasoning: Step 2 and Step 6 implementation/review records (this session) and the corresponding migration file comments.
- The same transactional-boundary reasoning was reused, without re-litigation, for Step 10's `redeem_transfer_code` RPC.

Every Business Rule in M7.1 §11, every component in M7.2, and every task in M7.3's Implementation Plan were verified end-to-end, including a complete cross-step lifecycle sweep (transfer → issue → replace → supersede-on-join → recognize; and transfer → issue → redeem → recognize) with no regression found anywhere in Steps 1–10 at any later step. See `docs/architecture/M7_FREEZE_NOTICE.md` for final governance status and `docs/CHANGELOG.md` for the closure entry.
