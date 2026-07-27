# M7.3 — Gym Transfer Implementation Plan

**Status**: Implementation-ready (executed in full — see M7_3_GYM_TRANSFER_EXECUTION_PLAN.md and M7_FREEZE_NOTICE.md for closure status)
**Implements**: M7.2 Gym Transfer Technical Architecture (frozen), realizing M7.1 (frozen)
**Constrained by**: Member Domain Architecture (frozen), Financial Domain Architecture (frozen)
**Authority**: this plan sequences and operationalizes M7.2. It introduces no architecture. Any point marked "ADR CANDIDATE" is a stop condition, not a decision made by this plan.

---

## 0. Governing Documents and Non-Negotiables

Implementation follows M7.1 and M7.2 exactly. The following are restated here only because they constrain every task below, not because they are being redefined:

- `memberships.status` MUST remain limited to `active` / `removed` / `transferred`. No new value, column, or table is added to `members` or `memberships`.
- No Order, Payment, or Subscription-producing path is introduced. The only Financial Domain touchpoint is an unmodified call to the existing `end_subscription` RPC, invoked exactly as `supabase/functions/admin-remove-member/index.ts` already invokes it.
- No background/scheduled job is introduced anywhere in this plan.
- Transfer Code validity window is 72 hours (M7.2 §21) — an implementation parameter, changeable later without an ADR.

---

## 1. Existing Components This Plan Builds On (verified against the live repository)

| Component | File | Relevant behavior |
|---|---|---|
| Gym-change synchronization trigger | `supabase/migrations/20260726140000_member_domain_live_sync.sql` — function `member_domain_sync_on_profile_gym_change()`, trigger `member_domain_sync_gym_change_trg` | On `null → gym`: inserts an `active` Membership, guarded against re-firing the same transition twice. On `gym → null`: unconditionally sets the active Membership's `status = 'removed'`. This second branch is Phase 1's only modification target. |
| Origin gym-ending action (Remove Member) | `supabase/functions/admin-remove-member/index.ts` | Authorizes caller as an admin of the target's gym (`authorizeMemberRemoval`); deletes `bookings`, `class_waitlist`, `class_reminders`, `push_subscriptions`; ends any active Subscription via `end_subscription`; sets `profiles.gym_id = null`. |
| `profiles.gym_id` immutability guard | `prevent_profiles_gym_id_change()` | Blocks only `<gym> → <different gym>`. Does not inspect `auth.uid()`, so a service-role write setting `gym_id` from `null` to a value on a different user's row is unaffected. |
| Member self-service join | RPC `join_gym_with_code(p_code text)`, wired to `handleJoinGymWithCode()` in `src/App.jsx` | Requires caller's own `profiles.gym_id` to be `null`; resolves the code; sets `gym_id`. This is the entire Primary Journey mechanism — reused with zero modification. |
| Gym-code precedent | `gym_signup_codes` table | Precedent for a reserved, RLS-scoped, single-purpose code — the design shape Transfer Code follows (a distinct entity, not a shared table). |
| Visibility-removing Broadcast | Function `notify_visibility_change()`, trigger `notify_member_removed_visibility` | Fires on any `gym_id → null` transition, regardless of `memberships.status` — no change needed for Phase 1. |
| Idempotent-write precedent | `register_payment` | `insert ... exception when unique_violation then select existing row` — the pattern Phase 3/4 reuse. |
| Admin confirmation pattern | `adminEliminaMembru()`, `src/App.jsx` | Type-the-member's-email-to-confirm before calling the Edge Function — the UI shape Phase 1's Transfer action reuses (a sibling confirmation flow, not shared state). |

---

## Phase 1 — Origin-Side Reason Tagging

**Objective**: allow a Membership to end as `transferred` instead of `removed`, with zero change to Remove Member's own behavior.

### Task 1.1 — Trigger extension: reason-aware ending branch
Modify only the `gym → null` branch of `member_domain_sync_on_profile_gym_change()` to read a transaction-scoped reason signal (`current_setting('forge.member_domain_ending_reason', true)`, set via `set_config(..., true)`) and write `'transferred'` when present, defaulting to `'removed'` otherwise. Default behavior, the `null → gym` branch, and the exception-isolation wrapper MUST NOT change.

### Task 1.2 — New sibling Edge Function: `admin-transfer-member`
Mirrors `admin-remove-member/index.ts` exactly in shape — same caller-token verification, same `authorizeMemberRemoval` check (reused, not reimplemented), same operational-row cleanup, same `end_subscription` loop — differing only in signaling `'transferred'` for this transaction immediately before the `profiles.gym_id = null` update, and its own route. `admin-remove-member/index.ts` itself is not touched.

### Task 1.3 — React: origin-admin Transfer action
New action in the admin Members screen's per-member action menu, adjacent to Remove, with its own confirmation state — not shared with Remove's.

**Completion Criteria**: a Transfer-tagged ending is behaviorally identical to Removal except for the recorded `memberships.status` value.

---

## Phase 2 — Recognition

**Objective**: derive Recognition from Membership history, per M7.2 §10.

### Task 2.1 — Recognition derivation
A read-only query/RPC: for a Member's newly created Membership, find their most recent *previous* Membership (excluding the new row) and check whether its `status = 'transferred'`. No write path. Failure must not block Membership creation.

**Completion Criteria**: correct recognition in both directions, with zero effect on join success either way.

---

## Phase 3 — Transfer Code Lifecycle

**Objective**: support the Fallback Journey's origin side — issuance, exclusivity, both supersession triggers, revocation, Derived Expiry.

### Task 3.1 — Transfer Code table
New table: the Transferred Membership it belongs to; the Member identity it resolves to; current state (`active`/`used`/`revoked`/`superseded`); issuance metadata; a globally-unique code value; redemption timestamp. RLS scoped to the origin gym's own admins (`is_admin(gym_id)`) — destination gym admins get no broad SELECT policy at all.

### Task 3.2 — Issuance / revocation RPCs
Issuance, within one transaction: supersede any existing `active` code for the same Transfer, then insert the new one. Precondition: only a Membership already `transferred` may have a code issued for it. Revocation: restricted to the origin gym's admins, only against a code currently `active`.

### Task 3.3 — Supersession on Primary Journey completion
Extend the `null → gym` branch of the same trigger touched in Task 1.1: supersede any `active` Transfer Code for the Member's most recently ended `transferred` Membership, in the same transaction as the new Membership's insert. System-initiated, no authorization check.

### Task 3.4 — Derived Expiry
A shared check (`issued_at + 72 hours < now()`), consumed by every validation of a Transfer Code's current validity (issuance-exclusivity check, revocation check, redemption check). No value named `'expired'` is ever written.

**Completion Criteria**: every Transfer Code Business Rule in M7.1 §11 independently verified, including the completed lifecycle (both supersession triggers).

---

## Phase 4 — Fallback Redemption

**Objective**: support the Fallback Journey's destination side.

### Task 4.1 — Fallback redemption action
New Edge Function, callable only by an authenticated admin: validates the presented code (`active`, unexpired, unrevoked, unused); authorizes the calling admin against their own gym; performs the same tenancy-signal write the ordinary join performs, for the Member identity the code resolves to; marks the code `used` — all in one transaction. Membership creation is produced by the existing, unmodified synchronization trigger, not duplicated. Scoped narrowly — MUST NOT become a general administrator-enrollment mechanism (M7.2 §3's resolved discrepancy).

### Task 4.2 — React: destination-admin redemption UI
Minimal, isolated entry point (distinct from the Members screen used for issuance) where an admin enters a presented code. The ordinary `noGymMembership`/`handleJoinGymWithCode` path remains completely untouched.

**Completion Criteria**: the Fallback Journey proven end-to-end, including every concurrency and failure scenario in M7.2 §14–15.

---

## 5. Cross-Phase Concerns

**RLS**: no existing table's RLS is modified. The only new RLS surface is the Transfer Code table, scoped by the same `is_admin(gym_id)`/`my_gym_id()` primitives already used throughout this schema.

**Realtime**: no new Broadcast channel or trigger. `notify_member_removed_visibility` already fires, unmodified, on the Transfer-tagged ending. Transfer Code's own state changes use ordinary Postgres Changes.

**Audit**: every new write uses the same `created_at`/`created_by`-style columns already conventional across this schema.

---

## 6. Full Validation Plan

Unit-level (trigger branch logic, Derived Expiry boundaries, authorization predicates), Integration (full Edge Function → trigger → resulting row chains), Concurrency/Race Conditions (duplicate ending attempts, duplicate issuance, duplicate redemption, ordinary-join-vs-outstanding-code race), Idempotency, Authorization/Tenant Isolation, Failure Handling, Regression (existing Remove Member and self-service join suites re-run unchanged) — each Business Rule in M7.1 §11 traced to a specific verification.

---

## 7. Overall Deployment Sequence

1. Phase 1 (migration → Edge Function → UI)
2. Phase 2 (read path, independent of Phase 1's UI, dependent on its migration)
3. Phase 3 (table → RPCs → second trigger extension → Derived Expiry → UI)
4. Phase 4 (redemption function → UI)

Phases 1–2 alone constitute a complete, shippable Primary Journey. Phases 3–4 are additive.

---

## 8. ADR Watchlist (informational — not a blocker)

M7.2 §3 resolved, within its own authority, the discrepancy between M7.1/Chapter 7's assumption that an administrator-enrollment mechanism ("Chapter 6") already exists and the repository's actual state. This plan implements that resolution as a narrowly-scoped new component (Task 4.1). No task in this plan requires an ADR.

---

## Closure Note

All four phases (Tasks 1.1 through 4.2) were executed in full via the M7.3 Execution Plan's 11 steps, each independently reviewed, validated, and committed. See `M7_3_GYM_TRANSFER_EXECUTION_PLAN.md` for the step-by-step execution record and `docs/architecture/M7_FREEZE_NOTICE.md` for final closure status.
