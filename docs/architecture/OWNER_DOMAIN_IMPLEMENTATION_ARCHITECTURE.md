# Forge Owner Domain — Implementation Architecture (M10, Phase 2)

This document is the implementation architecture for the Owner Domain. It transforms four frozen, product-level documents — `MEMBER_DOMAIN_ARCHITECTURE.md`, `FINANCIAL_DOMAIN_ARCHITECTURE.md`, `OWNER_ACTIVATION_ARCHITECTURE.md`, `OWNER_LIFECYCLE_STATE_MACHINE.md` — into the entities, commands, read models, events, and boundaries a build team implements against. None of the four are redesigned, challenged, or reinterpreted here; where this document appears to add a rule those four didn't state, that rule is an implementation consequence of theirs, never a new product decision.

This document defines the domain model, not the data model, in the same sense `MEMBER_DOMAIN_ARCHITECTURE.md` and `FINANCIAL_DOMAIN_ARCHITECTURE.md` do — but unlike those two, it is explicitly an *implementation* architecture (per its own mandate), and therefore references RPC names, Edge Function boundaries, and RLS boundaries where a rule has no other unambiguous description. It contains no SQL, no migrations, and no React.

**Status: proposed for freeze — see Section 15 for the adversarial self-review and final verdict.**

---

# 1. Purpose and Governing Constraint

The four frozen documents establish *what* is true (an Owner's activation is a two-axis lifecycle; a Platform Subscription is commercially independent of Member billing; First Value and Activation are distinct, evidenced milestones). None of them establish *where a byte lives*, *which process writes it*, or *who is allowed to call what*. That is this document's entire job.

One constraint governs every decision below, inherited directly from `FINANCIAL_DOMAIN_ARCHITECTURE.md` Section 3.7 and restated here because it is the single most important implementation rule in this domain: **no client owns business logic.** A Gym's Activation Checklist, a Platform Subscription's settlement status, whether an invitation is still valid — every one of these is computed by this domain's own mechanisms and observed identically by every client, never decided by one.

---

# 2. Scope

### In scope — owned by the Owner Domain

- **Owner identity's relationship to a Gym** — not a new authentication system (Section 4.1), but the fact that a specific existing identity is the Gym's billing-responsible party.
- **Gym Lifecycle State** — the two-axis state machine defined in `OWNER_LIFECYCLE_STATE_MACHINE.md`, as data.
- **Platform Plan, Platform Subscription, Platform Order, Platform Payment** — Forge's own SaaS-billing ledger, structurally parallel to, and permanently separate from, the Financial Domain's Order/Payment.
- **Admin Invitation** — inviting a co-Admin or coach, a distinct relationship from M9's Member invitation.
- **The Activation Checklist read model, the Owner Dashboard read model, and this domain's own canonical events.**

### External dependencies — referenced, never redefined

- **Gym** — the shared, cross-domain tenant primitive. Exactly as `FINANCIAL_DOMAIN_ARCHITECTURE.md` Section 4.3 already established for itself ("Gym is a shared platform boundary... not a concept owned by either the Financial Domain or the Member Domain"), this domain does not own Gym either. It owns the *command that first creates one* (Section 6.1) and a *separate, 1:1-referencing entity* that carries this domain's own facts about it (Section 5) — never a column added onto Gym itself.
- **Member, Membership, Subscription, Membership Plan, Plan Version** — Member Domain, untouched.
- **Order, Payment** (Member-facing) — Financial Domain, untouched, and never reused as a mechanism for anything in this document (`OWNER_ACTIVATION_ARCHITECTURE.md` Principle 3.7).
- **The M9 invitation mechanism** (`gym_invitations`, `resolveInvitationByToken`, `m9_final_commit_*`) — Member Domain, frozen, reused verbatim for a Gym's first (and every) Member invitation. This domain never wraps, duplicates, or modifies it (Section 6.2).
- **Existing identity/profile mechanism** (`auth.users`, `profiles`, the `handle_new_user()`-style trigger pattern) — reused, extended, never replaced by a second auth system.
- **`admin_audit_log`** (or its equivalent) — reused as the audit sink (Section 13); this domain does not build a parallel audit table.

### Non-goals

- **Hard deletion of a Gym.** Cascades across every gym-scoped domain (Member, Financial, Programming, this one). Out of scope of M10 entirely; a future, separate architectural decision. Only *deactivation* (a commercial-axis transition, Section 5) is in scope.
- **Transfer of Gym ownership** (an Owner sells the gym, hands it to a new principal). Not designed here. Flagged explicitly as a real, future gap rather than silently unsupported (Section 15).
- **Support/staff impersonation tooling.** Named in Section 12 as a deferred, bounded extension point, not designed now.
- **Enterprise/franchise sales-led provisioning workflow**, beyond the one accommodation `OWNER_LIFECYCLE_STATE_MACHINE.md` Section 8 already requires (a Gym may enter directly at Paying). The workflow that would create such a Gym is out of scope.

---

# 3. Implementation Principles

Each restates a frozen-document principle at the layer this document operates on — never a new product rule, only its technical consequence.

**3.1 A state is derived or it is a lifecycle fact — never a client's belief.** Activation Checklist progress, Platform Subscription settlement status, and Gym Lifecycle State are each computed from authoritative facts by this domain's own mechanisms (extends `MEMBER_DOMAIN_ARCHITECTURE.md` 2.2 and `FINANCIAL_DOMAIN_ARCHITECTURE.md` 3.3 into this domain).

**3.2 Platform billing and Member billing never share a table, a webhook, or a mental model.** `OWNER_ACTIVATION_ARCHITECTURE.md` Section 15 / Principle 3.7 made this a permanent product boundary; here it becomes a permanent *implementation* boundary — a distinct schema, a distinct Stripe webhook endpoint, distinct RPCs, checked in Section 15's self-review.

**3.3 This domain observes the Member Domain; it never modifies it.** Wherever this domain needs a fact the Member Domain owns (a qualifying Final Commit succeeded), it reads that fact through a narrow, explicit mechanism defined here (Section 6.2) — never by editing an M9 RPC, never by adding a Member-Domain-side call-out.

**3.4 An invariant holds regardless of which path performed the write** (`FINANCIAL_DOMAIN_ARCHITECTURE.md` 3.4, unchanged). Every constraint in Section 5 is enforced at the data layer, not merely inside one RPC's own logic.

**3.5 Attestation authority governs write access, not merely a valid caller** (`FINANCIAL_DOMAIN_ARCHITECTURE.md` 3.5, unchanged, reapplied in Section 11 to Platform billing specifically).

**3.6 Every write happens through exactly one command.** No table this domain owns is ever written to directly by a client. Section 6 is exhaustive: an operation not listed there does not exist.

**3.7 Reuse a proven mechanism before inventing a parallel one.** Where an existing pattern already solves this domain's problem (ledger-style Subscription lineage, versioned catalog entries, token-hashed invitations), this document reuses that exact shape rather than a novel one, and says so explicitly each time.

---

# 4. Identity: What "Owner" Actually Is

**An Owner is not a new identity type.** Per `OWNER_ACTIVATION_ARCHITECTURE.md`'s own mandate ("the same identity mechanism every other Forge identity uses"), Owner reuses the existing `auth.users` + `profiles` (Admin-role) identity exactly as it exists today. What does not yet exist is a single new fact: **which specific Admin identity is the Gym's billing-responsible party.**

That fact is not stored on the identity (a `profiles` row must not carry `is_owner`, because an Admin's relationship to billing is a fact about a specific *Gym*, not a fact about the person — the same person could, in the multi-Gym future `OWNER_LIFECYCLE_STATE_MACHINE.md` Section 8 already anticipates, be the billing Owner of one Gym and an ordinary Admin of another). It is stored as a single reference, **`owner_admin_id`**, on the Gym Lifecycle State entity (Section 5.1) — one per Gym, always resolved, never null.

**Invariant:** exactly one `owner_admin_id` per Gym at all times. No command in Section 6 creates a Gym without simultaneously resolving this reference, and no command removes it without replacing it — Gym-ownership transfer is explicitly not designed (Section 2), so today the only two states this reference can be in are "set, at Gym creation" and "unchanged, forever after."

**Consequence for authorization (detailed in Section 11):** "Owner" and "Admin" are now two distinct authorization tiers, not one. Every Admin in a Gym may operate the product. Only the Gym's one Owner may act on Platform billing. This is a genuinely new distinction this domain introduces — a coach given Admin access to help run classes should not, by that grant alone, see Forge's own invoice to the gym or be able to cancel the gym's subscription.

---

# 5. Domain Model

### 5.1 Gym Lifecycle State

**Purpose.** Carries this domain's own facts about a Gym — everything `OWNER_LIFECYCLE_STATE_MACHINE.md` defines — without adding a single column to the shared, cross-domain `Gym` primitive (Section 2, mirroring how neither the Member nor Financial Domain adds its own fields to Gym directly).

**A deliberate implementation split, not one row.** `OWNER_LIFECYCLE_STATE_MACHINE.md` Section 2 established that the Activation axis and the Commercial axis are architecturally independent and must never be conflated — most concretely, *only the Commercial axis ever blocks product access; the Activation axis never does.* Modeling both axes as columns on one physical row invites exactly the failure that rule exists to prevent: a future authorization check reading `activation_state` where it meant to read `commercial_state`, silently blocking (or failing to block) access on the wrong signal. This document therefore specifies **two logically separate entities**, both 1:1 with Gym, both owned by this domain:

- **Gym Activation State** — `owner_admin_id`, `activation_state` (`unverified` / `onboarding` / `first_value_reached` / `activated`), `first_value_at`, `activated_at`. Never consulted by any access-control check, anywhere (Section 11).
- **Gym Commercial State** — `commercial_state` (`trial_running` / `trial_ending` / `expired` / `paying` / `past_due` / `cancelled`), `trial_started_at`, `trial_ends_at`, `platform_subscription_id` (current). This, and only this, entity is ever consulted to decide whether a Gym's day-to-day product access is blocked.

Both are created atomically with the Gym itself (Section 6.1) and never independently.

**Lifecycle.** State values and every legal transition between them are exactly `OWNER_LIFECYCLE_STATE_MACHINE.md` Sections 3 and 5 — this document adds no new state and no new transition. Transitions are written exclusively by the commands and triggers in Section 6, never by direct client update.

**Invariants:**
- `activation_state` is monotonic — no command or trigger ever moves it backward (`OWNER_LIFECYCLE_STATE_MACHINE.md` Section 3's rule, enforced structurally: no write path exists that sets an earlier value once a later one is recorded).
- `owner_admin_id` is never null after creation (Section 4).
- Exactly one Gym Commercial State row exists per Gym for the Gym's lifetime; `platform_subscription_id` may be null (pre-conversion) but the row itself always exists.

**Future scalability.** A second Gym for the same Owner is a second, fully independent pair of these rows — no shape change, exactly as `OWNER_LIFECYCLE_STATE_MACHINE.md` Section 8's multi-location treatment requires.

### 5.2 Platform Plan / Platform Plan Version

**Purpose.** Forge's own sellable catalog — the SaaS-tier offer (e.g., a monthly price, a feature tier), independent of any one Gym. Structurally identical to Member Domain's Membership Plan / Plan Version (`MEMBER_DOMAIN_ARCHITECTURE.md` Section 4), reused here deliberately rather than inventing a weaker, unversioned catalog (Principle 3.7): if Forge ever changes its own pricing, an existing Platform Subscription must not silently reprice, for exactly the reason a Member's existing Subscription doesn't when a Gym changes its Membership Plan pricing.

**What it owns:** name, price, currency, billing cadence, feature-tier flags. Not gym-scoped — one platform-wide catalog, unlike Membership Plan which is scoped per Gym.

**Lifecycle.** A Plan Version, once referenced by any Platform Subscription, is frozen — new pricing is a new Version, never an edit (identical rule to `MEMBER_DOMAIN_ARCHITECTURE.md` D3).

**Invariants:** identical in shape to Membership Plan / Plan Version's own (Section 8.1 of that document) — frozen once referenced, retirement via a `not accepting new subscriptions` flag rather than deletion.

### 5.3 Platform Subscription

**Purpose.** The commercial term between a Gym and Forge — the direct structural analog of Member Domain's Subscription, with the direction of commerce reversed (Gym is the buyer here, not the seller).

**What it owns:** which Platform Plan Version, which Gym, start date, end date/renewal date, the actual agreed price (which may differ from the Plan Version's list price — same "actual agreed price, not just a pointer" rule as `MEMBER_DOMAIN_ARCHITECTURE.md` Section 4, "Subscription"), and its own lineage (`predecessor_id`/`successor_id`).

**Lifecycle — reused verbatim from Member Domain's proven pattern (Principle 3.7):** immutable once created; renewals, upgrades, and downgrades each create a new, linked Platform Subscription rather than mutating one in place, exactly `MEMBER_DOMAIN_ARCHITECTURE.md` D4's mechanism, applied here because it is the same structural problem (a recurring commercial term that must produce a perfect ledger) reused rather than reinvented.

**Invariants:** at most one *currently active* Platform Subscription per Gym at a time (not "at most one ever" — renewals/upgrades legitimately produce a new one). `predecessor_id` lineage is append-only, exactly as Member Domain's Subscription lineage is.

**Relationships.** References Gym (tenant scope) and Platform Plan Version. Referenced by Platform Order.

### 5.4 Platform Order / Platform Payment

**Purpose.** The append-only financial ledger for Forge's own revenue from Gyms — structurally identical to Financial Domain's Order/Payment (`FINANCIAL_DOMAIN_ARCHITECTURE.md` Section 4), and for the same reason Platform Subscription reuses Member Domain's Subscription shape: this is the same class of problem (a commercial agreement, settled by zero-or-more money movements) already solved correctly once in this codebase.

**They are a *separate schema and separate mechanism*, never the same tables.** This is the one place where reuse-the-pattern (Principle 3.7) and never-share-the-mechanism (Principle 3.2 / `OWNER_ACTIVATION_ARCHITECTURE.md` Section 15) must both hold simultaneously, and they are not in tension: reusing Financial Domain's *design* (ledger, direction-not-sign, derived settlement status, immutable Payment) is exactly what Principle 3.7 asks for. Reusing Financial Domain's *tables* would violate Principle 3.2. The resolution is to copy the architecture, not the object.

- **Platform Order** owns the agreed amount, currency, and the one Platform Subscription it represents; its settlement status (`pending`/`partial`/`paid`/`refunded`) is derived from its Platform Payments exactly as `FINANCIAL_DOMAIN_ARCHITECTURE.md` Section 5.2 derives Order's status — same rule, restated for this ledger.
- **Platform Payment** owns amount (non-negative), direction (`charge`/`refund`), outcome, and provider reference; immutable once created, exactly `FINANCIAL_DOMAIN_ARCHITECTURE.md` Section 4.2's invariants, restated for this ledger.

**Invariants:** identical in shape to Financial Domain's own (Section 4 of that document) — a refund never exceeds its Order's succeeded charges; a Payment is never updated or deleted by any caller at any privilege level.

### 5.5 Admin Invitation

**Purpose.** Inviting a co-Admin or coach — a person who will operate the Gym, not join its Member roster. This is genuinely distinct from M9's Member Invitation (which grants Membership, roster presence, leaderboard participation) and must not be modeled as a variant of it; the relationship being granted is different in kind, not degree.

**What it reuses from M9's proven shape (Principle 3.7), without reusing M9's table:** a random, HMAC-hashed, single-use, time-limited, revocable token — the same properties `OWNER_ACTIVATION_ARCHITECTURE.md`'s own M9.1 review already validated as sufficient security for a possession-based invitation. A separate table (`admin_invitations`, not `gym_invitations`) because accepting one performs a structurally different write (grants an Admin role on an existing or new identity; never creates a Membership, a Waiver acceptance, or any Member Domain row).

**Lifecycle:** `pending` → `accepted` | `expired` | `revoked`. No further lifecycle after acceptance — an accepted invitation is a permanent historical record, never reused or reactivated (a revoked invitee is re-invited via a brand-new row, exactly as M9 already does for Members).

**Invariants:** token uniqueness and single-use enforced identically to `gym_invitations` (Principle 3.7); scoped by `gym_id`, tenant-isolated identically to every other gym-scoped table (Section 10).

**Open question, named rather than resolved:** does accepting an Admin Invitation *elevate an existing Member* to also hold Admin access, or does it always require a distinct identity? Left open deliberately — `MEMBER_DOMAIN_ARCHITECTURE.md` Section 12 leaves a structurally similar question (dependent Members) open for the same reason: it is a product-policy decision, not an architecture one, and answering it here would bake an unreviewed business choice into an implementation contract meant to outlive it.

### 5.6 Activation Checklist — explicitly not a stored entity

**Purpose.** Exactly as `MEMBER_DOMAIN_ARCHITECTURE.md` Section 4 treats Entitlement — "included explicitly so that no future engineer discovers a need for a stored flag and wires up a second source of truth" — Activation Checklist is a **pure read-model derivation**, never a table with its own progress-tracking columns.

**Derivation:** a Gym's checklist state is computed at read time from three existing facts: (1) does a confirmed Waiver exist for this Gym (an existing Member-Domain-adjacent fact, read not owned), (2) has at least one Admin Invitation or M9 Member Invitation ever been sent for this Gym, (3) the Gym's own Activation State (Section 5.1). No command in Section 6 writes "checklist progress" anywhere — there is nothing to write, because there is no independent fact a checklist row could hold that isn't already recorded somewhere else.

---

# 6. Command Boundaries

Every write to any entity this domain owns happens through exactly one of the commands below (Principle 3.6). Each entry states purpose, what it creates/validates, what it deliberately never does, and which invariant it exists to preserve — authorization is deferred to Section 11, failure handling to Section 12, exactly as `FINANCIAL_DOMAIN_ARCHITECTURE.md` Section 6 defers both.

### 6.1 Identity & Gym Creation

**`register_owner`**
- **Purpose.** Bring a new Owner identity and their first Gym into existence together, in one atomic operation.
- **Mechanism.** Reuses the existing trigger-based identity-creation pattern (the same shape as the Member Domain's proven `handle_new_user()`-style trigger) rather than a bespoke Edge Function orchestration — chosen specifically for consistency with an already-proven mechanism (Principle 3.7), not because the alternative (an Edge Function calling Auth then a follow-up RPC) is unworkable. The Gym name, captured on the same form as signup (`OWNER_ACTIVATION_ARCHITECTURE.md` Section 10), travels as signup metadata and is read by the trigger.
- **Creates.** One `auth.users` row (via Supabase Auth's own signup, unmodified), one Admin-role `profiles` row, one Gym, one Gym Activation State row (`activation_state = unverified`), one Gym Commercial State row (`commercial_state = null` — no trial yet, per `OWNER_LIFECYCLE_STATE_MACHINE.md` Section 6: no commercial state exists before verification). `owner_admin_id` is resolved to the new Admin identity, atomically, in the same transaction — never as a follow-up step.
- **Does not do.** Never starts a trial. Never sends an invitation. Never creates a Platform Subscription.
- **Invariants preserved.** Section 5.1's "never null `owner_admin_id`"; Section 4's "exactly one Owner per Gym at creation."

**`on_owner_email_verified`** *(reactive trigger, not a client-callable command — Section 11 names why)*
- **Purpose.** React to Supabase Auth's own native email-confirmation event.
- **Creates/transitions.** Gym Activation State → `onboarding`; Gym Commercial State → `trial_running`, `trial_started_at = now()`, `trial_ends_at = now() + 14 days` (`OWNER_LIFECYCLE_STATE_MACHINE.md` Section 5/13).
- **Does not do.** Never re-fires if called twice for the same confirmation (idempotent by construction — Section 12).
- **Invariants preserved.** The one deliberate cross-axis coupling point (`OWNER_LIFECYCLE_STATE_MACHINE.md` Section 6): both transitions happen in the same instant, from the same trigger, never as two independently-timed writes.

### 6.2 Activation Axis — observing the Member Domain

**`evaluate_first_value`** *(reactive trigger on the Member Domain's own Final-Commit write path, not a client-callable command)*
- **Purpose.** Detect the moment `OWNER_ACTIVATION_ARCHITECTURE.md` Section 7 defines, without touching the RPC that produces it.
- **Mechanism.** A trigger on the table M9's Final Commit writes to on success (the Membership-creation write), scoped to Gyms whose Activation State is still `onboarding`. This is the concrete technical answer to Principle 3.3: the trigger lives on the *table*, not inside the *RPC* — M9's `m9_final_commit_*` functions require zero modification, and this domain's presence is invisible to the Member Domain entirely.
- **Validates.** The completing identity is not the Owner's own test pass (Section 7 of `OWNER_ACTIVATION_ARCHITECTURE.md`'s precision requirement) — checked by comparing the new Member's identity against the Gym's `owner_admin_id`-linked identity.
- **Transitions.** Gym Activation State → `first_value_reached`, `first_value_at = now()`. Emits `FirstValueReached` (Section 8).
- **Does not do.** Never writes to any Member Domain table. Never blocks or delays the Final Commit transaction it observes.

**`evaluate_activation`** *(reactive, same mechanism as above, generalized)*
- **Purpose.** Detect `OWNER_ACTIVATION_ARCHITECTURE.md` Section 8's return-behavior event.
- **Mechanism.** A lightweight check, run when the Owner's own identity performs a real operating action (invites a second Member, edits the schedule, etc.), verifying that action occurs on a calendar day distinct from `first_value_at`'s day and distinct from Gym creation's day.
- **Transitions.** Gym Activation State → `activated`, `activated_at = now()`. Emits `OwnerActivated`.
- **Invariants preserved.** `OWNER_LIFECYCLE_STATE_MACHINE.md` Principle 3.16 — a single-session action never qualifies, by construction (the distinct-day check is the enforcement mechanism for that principle, not a separate rule).

### 6.3 Admin Invitation

**`send_admin_invitation`** — creates a `pending` Admin Invitation for a `gym_id` + email. Never creates a second pending invitation for the same email within the same Gym (existing pending row is reused/re-sent, mirroring M9's own resend behavior).

**`accept_admin_invitation`** — consumes a valid, unexpired, unrevoked token; grants Admin role on the resolved identity for that Gym; marks the invitation `accepted`. Never grants Owner status (only `register_owner`, at Gym creation, ever sets `owner_admin_id` — Section 4).

**`revoke_admin_invitation`** — marks a `pending` invitation `revoked`. No-op, safely, on an already-accepted or already-expired one (never errors on a stale client retry — Section 12).

### 6.4 Platform Billing

**`purchase_platform_plan`**
- **Purpose.** Owner-initiated conversion from trial (or a lapsed/cancelled state) to Paying.
- **Creates.** A Platform Subscription (referencing the chosen Platform Plan Version) and a Platform Order, through the same two-step shape Financial Domain's `create_order_for_subscription` already established — reused pattern, separate mechanism (Section 5.4). Requests a Stripe Checkout Session referencing that Platform Order, via the Edge Function boundary in Section 7.
- **Does not do.** Never records a Platform Payment itself — that is exclusively the webhook's job (Section 6.5), identical to Financial Domain's own division of responsibility (`FINANCIAL_DOMAIN_ARCHITECTURE.md` Section 7.1).
- **Invariants preserved.** At most one currently-active Platform Subscription per Gym (Section 5.3).

**`upgrade_platform_plan` / `downgrade_platform_plan`** — mechanically one operation (Principle 3.7, reusing `MEMBER_DOMAIN_ARCHITECTURE.md` Section 6.3's "renewal/upgrade/downgrade are one mechanism" pattern exactly): creates a new Platform Subscription with `predecessor_id` set, marks the old one `superseded`. "Upgrade" vs. "downgrade" is a UI label from comparing prices, not a different code path.

**`cancel_platform_subscription`** — Owner-initiated only (Section 11). Marks the current Platform Subscription `cancelled`; Gym Commercial State → `cancelled`. Never deletes Gym data (`OWNER_LIFECYCLE_STATE_MACHINE.md` Section 5, B7).

### 6.5 Platform Billing — Verified Internal Caller Only

**`register_platform_payment`** — the sole mechanism creating a Platform Payment with `direction = charge`. Invoked exclusively by the Platform Billing webhook (Section 7), after the same three-step verification Financial Domain's webhook already performs (`FINANCIAL_DOMAIN_ARCHITECTURE.md` Section 7.2): verify the message genuinely came from Stripe, re-derive the Platform Order from Forge's own record, confirm the claim matches before writing anything.

**`refund_platform_payment`** — the sole mechanism creating a Platform Payment with `direction = refund`. Same restriction, same verification sequence.

**Both** preserve Financial Domain's exact invariant (Section 4.2 of that document, restated for this ledger): a refund never exceeds its Order's succeeded charges; a Payment, once created, is never revisited.

### 6.6 Trial/Commercial Clock

**`advance_trial_state`** *(scheduled, not client-callable)* — a periodic check moving Gym Commercial State `trial_running` → `trial_ending` (threshold crossed) → `expired` (clock reached zero, no Platform Subscription converted). Never touches Gym Activation State (Section 5.1's split is enforced here concretely: this command has write access to exactly one of the two entities).

---

# 7. Edge Function Boundaries

The rule dividing Edge Function, SQL RPC, and frontend is the same rule `invitation-final-commit` (Member Domain, existing) already establishes in practice: **an external API call, or public pre-auth exposure, belongs in an Edge Function; an invariant-bearing write with no external dependency belongs in a SQL RPC; nothing belongs in the frontend beyond calling one of the two.**

| Operation | Layer | Why |
|---|---|---|
| `register_owner` | SQL (trigger-based) | No external API involved beyond Supabase Auth's own signup, already handled by the existing trigger pattern. |
| `on_owner_email_verified`, `evaluate_first_value`, `evaluate_activation`, `advance_trial_state` | SQL (trigger/scheduled) | Purely reactive to in-database events; no external call, no public exposure. |
| `send_admin_invitation`, `revoke_admin_invitation` | SQL RPC | Caller is already an authenticated Admin; no external API. |
| `accept_admin_invitation` | **Edge Function** | Public, pre-auth exposure (the invitee has no session yet) — same reason `invitation-final-commit` is an Edge Function, not a SQL RPC, for the identical structural reason. |
| `purchase_platform_plan` | **Edge Function** | Must call the Stripe API to create a Checkout Session — an external call, exactly `FINANCIAL_DOMAIN_ARCHITECTURE.md` Section 7.1's reasoning. |
| `platform-billing-webhook` (hosts `register_platform_payment`, `refund_platform_payment`, dunning transitions) | **Edge Function** | Receives an external, unauthenticated (until verified) inbound call from Stripe — cannot be a SQL RPC by construction. **Must be a separate Edge Function and a separate Stripe webhook endpoint from the existing Member-billing `stripe-webhook`** — Principle 3.2, non-negotiable. |
| `cancel_platform_subscription`, `upgrade_platform_plan`, `downgrade_platform_plan` | SQL RPC | Caller is already authenticated as the Gym's Owner; amount is always server-derived from the target Platform Plan Version (Section 11's attestation-authority reasoning), so no external call is needed to validate intent. |
| Dashboard, Checklist, Billing, Settings, Notifications reads (Section 8) | Frontend, via direct table reads under RLS | No orchestration required — reading is a property of the tables themselves (`FINANCIAL_DOMAIN_ARCHITECTURE.md` Section 8.2's identical reasoning, reapplied). |

The frontend owns none of the above logic: it calls one of these two layers and renders the result, exactly as Principle 3.6 requires.

---

# 8. Read Models

**Owner Dashboard** — the Owner's home view. Composes Gym Activation State, Gym Commercial State, and recent domain events (Section 9) into one summary. No independent storage; a join across existing entities.

**Activation Checklist** — Section 5.6's derivation, surfaced to the client. Collapses to the lighter "Getting Started" shape once `activation_state = first_value_reached`, and disappears once `activated`, exactly `OWNER_LIFECYCLE_STATE_MACHINE.md` Section 8's two-stage retirement — implemented as a display rule over the same derivation, not a second derivation.

**Billing** — current Platform Subscription, Platform Order/Payment history, Gym Commercial State. Read access restricted to the Gym's Owner specifically, not every Admin (Section 4's new tier distinction, enforced in Section 10's RLS boundary).

**Settings** — Gym profile, staff (Admin) list, pending Admin Invitations. Readable by any Admin of the Gym.

**Notifications** — a projection over this domain's own emitted events (Section 9) relevant to the current caller; not a general-purpose notification entity owned here (Section 2 — delivery mechanism is a shared platform capability referenced, not owned).

**Live-sync scope, decided by precedent, not invented fresh:** `FINANCIAL_DOMAIN_ARCHITECTURE.md`-adjacent billing data was deliberately excluded from the M13.2 Live Sync rollout pending separate approval (project precedent). Platform Billing read models follow the identical precedent by default — excluded from real-time sync until the same governance gate explicitly approves it — rather than silently assumed included.

---

# 9. Event Model

Logical events only — each is a named, defined moment with a defined trigger and payload. This document does not mandate an event-sourcing mechanism, a queue, or a specific delivery technology; nothing in this platform's existing architecture uses one, and introducing that paradigm here would be exactly the kind of unreviewed mechanism-invention Principle 3.7 warns against. Each event below is producible by the trigger/command already named in Section 6 — the event is what that write *means*, not a new thing to build.

| Event | Fires when | Carries | Primary consumers |
|---|---|---|---|
| `OwnerSignedUp` | `register_owner` completes | `gym_id`, `owner_admin_id` | Marketing/CRM, analytics |
| `OwnerEmailVerified` | `on_owner_email_verified` fires | `gym_id` | Analytics, trial-clock start |
| `TrialStarted` | same instant as above | `gym_id`, `trial_ends_at` | Trial-communication cadence (Section 13) |
| `FirstValueReached` | `evaluate_first_value` fires | `gym_id`, `member_id` | Owner notification (mandatory, `OWNER_ACTIVATION_ARCHITECTURE.md` Section 7), analytics, soft-payment-prompt eligibility |
| `OwnerActivated` | `evaluate_activation` fires | `gym_id` | Analytics — this domain's core success metric |
| `TrialEnding` | `advance_trial_state`, threshold crossed | `gym_id`, `days_remaining` | Trial-communication cadence |
| `TrialExpired` | `advance_trial_state`, clock reaches zero | `gym_id` | Hard-paywall UI, win-back sequence |
| `PlatformPlanPurchased` | `purchase_platform_plan` completes | `gym_id`, `platform_subscription_id` | Billing UI, analytics |
| `PlatformPaymentSucceeded` | `register_platform_payment` (charge) | `platform_order_id`, `amount` | Receipt email, revenue reporting |
| `PlatformPaymentFailed` | webhook records a failed charge | `platform_subscription_id` | Dunning sequence, Past Due transition |
| `PlatformSubscriptionCancelled` | `cancel_platform_subscription` | `gym_id` | Win-back sequence, analytics |
| `PlatformSubscriptionReactivated` | a Paying entry from Cancelled/Expired | `gym_id` | CRM (won-back cohort tagging, per `OWNER_LIFECYCLE_STATE_MACHINE.md` Section 5) |
| `AdminInvited` / `AdminInvitationAccepted` | Section 6.3 commands | `gym_id`, `invited_email` | Settings UI, audit |
| `GymDeactivated` | Gym Commercial State reaches a blocking state | `gym_id` | Support tooling, analytics |

---

# 10. Database — Logical Architecture

No SQL. Table names below are the minimum needed for an unambiguous description (matching `FINANCIAL_DOMAIN_ARCHITECTURE.md`'s own stated convention).

**New tables, owned by this domain:**
- `gym_activation_state` (1:1 → `gyms`) — Section 5.1.
- `gym_commercial_state` (1:1 → `gyms`) — Section 5.1.
- `platform_plans`, `platform_plan_versions` — platform-wide catalog, not gym-scoped.
- `platform_subscriptions` (→ `gyms`, → `platform_plan_versions`, self-referential lineage) — Section 5.3.
- `platform_orders` (→ `platform_subscriptions`), `platform_payments` (→ `platform_orders`, self-referential for refunds) — Section 5.4.
- `admin_invitations` (→ `gyms`) — Section 5.5.

**Referenced, not owned:** `gyms`, `auth.users`, `profiles`, `admin_audit_log`, everything Member Domain owns.

**Tenant isolation.** Every new table above carries `gym_id` (directly, or transitively through a single hop — `platform_orders`/`platform_payments` reach `gym_id` via `platform_subscriptions`, never duplicated onto themselves, mirroring `FINANCIAL_DOMAIN_ARCHITECTURE.md` Section 4.3's "Gym reference exists on both Order and Payment" — here it exists once, on Platform Subscription, and Order/Payment reach it by reference, since unlike Financial Domain's Order/Payment there is no independent need to scope them without their parent). `platform_plans`/`platform_plan_versions` carry no `gym_id` at all — deliberately, as the one platform-wide (not tenant-scoped) exception, exactly as noted in Section 5.2.

**Indexes (logical only):** `gym_id` on every tenant-scoped table (lookup path for every read model in Section 8); `owner_admin_id` on `gym_activation_state` (resolves "which Gyms does this Owner own," relevant the moment a second Gym exists); token-hash uniqueness on `admin_invitations` (identical requirement to `gym_invitations`); `platform_subscription_id` foreign-key path on `platform_orders`/`platform_payments` (settlement-status derivation, read on every Billing read-model render).

**RLS boundaries (logical):**
- `gym_activation_state`, `gym_commercial_state`: readable by any Admin of the Gym; writable by no client at any privilege level — every write is a Section 6 trigger/command running as a privileged internal caller, identical in spirit to Financial Domain's own append-only enforcement (`FINANCIAL_DOMAIN_ARCHITECTURE.md` Section 8.4).
- `platform_subscriptions`, `platform_orders`, `platform_payments`: readable **only by the Gym's Owner** (`owner_admin_id` match), not by every Admin — the new tier distinction from Section 4. Write access per Section 11.
- `admin_invitations`: readable/writable by any Admin of the Gym, scoped by `gym_id` — the same shape `gym_invitations` already uses successfully.
- `platform_plans`/`platform_plan_versions`: readable by anyone (public catalog, unauthenticated included — needed for a pricing page), writable by no client.

---

# 11. API Surface & Security Model

### 11.1 Three kinds of caller — reused directly from Financial Domain, extended by one tier

`FINANCIAL_DOMAIN_ARCHITECTURE.md` Section 8.1 defined three caller kinds (Member, administrator, verified internal caller). This domain reuses that exact framework and adds the one distinction Section 4 requires:

- **A Gym's Owner** — the party who may act on Platform billing (Section 6.4) and read Billing (Section 8). Exactly one per Gym.
- **A Gym's Admin** (including the Owner, who is always also an Admin) — may operate the product, invite co-Admins, read Settings and Dashboard. Never Platform billing.
- **A verified internal caller** — today, exclusively the Platform Billing webhook (Section 7), after independently confirming Stripe origin, exactly Section 8.1's existing standard, applied to a second webhook endpoint.

### 11.2 Write access, per operation — governed by the same attestation-authority principle

`FINANCIAL_DOMAIN_ARCHITECTURE.md` Principle 3.5 (Section 8.3, reused as Principle 3.5 here) draws the line by *what the amount represents*, not by role, and produces the identical shape for this domain:

- **`purchase_platform_plan`, `upgrade_platform_plan`, `downgrade_platform_plan`, `cancel_platform_subscription`** are open to the Gym's **Owner only** (not every Admin — billing intent is the Owner's to attest, per Section 4). Their amounts are always derived from an already-fixed Platform Plan Version price — no attestation risk, matching exactly why `create_order_for_subscription` is open to a Member acting on their own Subscription in the Financial Domain.
- **`register_platform_payment`, `refund_platform_payment`** are restricted to the verified internal caller only — not even the Owner. These are claims that real money moved; opening them to the party they concern would let a Gym assert its own payment history by declaration, the exact case Section 3.5 forbids.
- **`send_admin_invitation`, `revoke_admin_invitation`** are open to any Admin, not Owner-restricted — inviting help to run the gym is an operational decision, not a billing one.
- **`accept_admin_invitation`** is open to whoever holds a valid token — identical trust model to M9's own Final Commit.

### 11.3 Append-only and tenant-isolation enforcement, independent of any RPC

Restating `FINANCIAL_DOMAIN_ARCHITECTURE.md` Section 8.4 for this domain's own ledger: no caller, at any privilege level, is ever granted update/delete on `platform_payments`, and no caller may ever change which Gym a `platform_subscription`/`admin_invitation` belongs to once set — both enforced as standing properties of the data itself, not rules any RPC has to remember.

### 11.4 Future staff accounts (support access)

Named, not designed. A future Forge-internal support identity that can read (never silently write) across Gyms for troubleshooting is a real, anticipated need — and a high-risk one (cross-tenant read access is exactly the kind of capability that must never be granted casually). This document defers it explicitly, the same way `MEMBER_DOMAIN_ARCHITECTURE.md` Section 12 defers dependent-Member design: naming the gap is the deliverable, not an unreviewed implementation of it.

---

# 12. Failure Recovery

### 12.1 Idempotency, reused directly from Financial Domain's proven layered model

`FINANCIAL_DOMAIN_ARCHITECTURE.md` Section 9.1's three-layer duplicate-delivery defense is reused verbatim for the Platform Billing webhook: a duplicate checkout attempt is collapsed before the database is touched twice; the Platform Order's own derived status recognizes an already-settled Order and takes no further action; `register_platform_payment`'s own uniqueness guarantee on the provider reference is the independent backup layer. Same three layers, same independence, different ledger.

### 12.2 `register_owner` atomicity

Gym, Gym Activation State, Gym Commercial State, and the Admin `profiles` row are created in one transaction — no state where a Gym exists without its lifecycle rows, or a lifecycle row exists without its Gym. A failure partway through rolls back entirely; the Owner sees a signup failure and may retry, never a half-created Gym.

### 12.3 Reactive triggers (`evaluate_first_value`, `evaluate_activation`) are naturally idempotent

Because each checks the current `activation_state` before transitioning (Section 5.1's monotonicity invariant), a trigger firing twice for the same underlying event (a retry, a replayed transaction) is a no-op the second time — the state is already past the point the trigger would move it to. No separate deduplication mechanism is needed; monotonicity itself is the guard.

### 12.4 Admin Invitation duplicate acceptance

A second attempt to accept an already-accepted token fails cleanly (matching M9's own established behavior for a reused/expired token) — no partial Admin grant, no silent no-op that hides the failure from the client.

### 12.5 Payment retries / dunning

Exactly `OWNER_LIFECYCLE_STATE_MACHINE.md` Section 5's B5⇄B6 cycle, already named there as a legitimate, bounded loop, not a defect. Implementation consequence: `advance_trial_state`-equivalent scheduled logic for Past Due (grace-period expiry → Cancelled) is a second, structurally identical scheduled command to Section 6.6's trial-clock one — not a new mechanism, a second use of the same one.

### 12.6 Partial failure: Stripe succeeds, Forge write fails

Handled by the same principle Financial Domain already established (Section 7.3 of that document): Forge's own Platform Order/Payment records are authoritative. If a webhook's own write fails after Stripe has already confirmed a charge, Stripe's own retry-on-non-2xx-response behavior redelivers the event, and Section 12.1's layered idempotency guarantees the eventual successful write is not a duplicate.

---

# 13. Audit

**Must always be audited** (written to the existing `admin_audit_log` mechanism, Section 2 — no parallel table): Gym creation (`register_owner`), every Admin Invitation sent/accepted/revoked, every Platform Subscription state change (purchase, upgrade, downgrade, cancel, reactivate), every Platform Payment event (charge, refund), Owner-identity resolution at Gym creation (`owner_admin_id` assignment).

**Must never be audited:** Dashboard/Checklist/Settings reads, notification read-receipts, routine `advance_trial_state` ticks that produce no transition. None of these carry business or security value as a log entry — restating `FINANCIAL_DOMAIN_ARCHITECTURE.md`'s own restraint (a dedicated audit log was explicitly scoped to financial *writes*, never reads) at this domain's boundary.

---

# 14. Test Strategy

- **Unit** — pure derivation functions: Activation Checklist computation (Section 5.6), Platform Order settlement-status derivation (Section 5.4), the FSM transition-legality check itself (given a current state and an attempted target, is this transition in `OWNER_LIFECYCLE_STATE_MACHINE.md`'s table?).
- **Integration** — RPC-level: `register_owner` atomicity under simulated partial failure (Section 12.2); `accept_admin_invitation` against expired/revoked/already-accepted tokens; webhook idempotency under simulated duplicate delivery (Section 12.1).
- **Architecture (fitness functions)** — automated checks, in the same spirit as this repo's existing `configIntegrity.test.js`-style structural tests: no Owner-Domain table is written to from a Member-Domain code path and vice versa; every new table has an RLS policy; `platform_payments`/`platform_orders` have no client-facing update/delete grant, checked directly, not by convention.
- **Domain** — every cell of `OWNER_LIFECYCLE_STATE_MACHINE.md` Section 6's cross-axis combination matrix, tested as a real, reachable, correctly-permissioned state, including the specifically-named edge cells (eager converter, activated churner, engaged-but-expired).
- **Security** — RLS boundary tests per caller kind (Section 11.1): an Admin who is not the Owner cannot read `platform_subscriptions`; a different Gym's Owner cannot read this Gym's Billing; the webhook's verified-internal-caller path is unreachable by any authenticated client session.
- **Regression** — the existing M9 invitation flow, `m9_final_commit_*` RPCs, and Financial Domain's own webhook remain provably untouched (Section 6.2's non-invasive trigger design is what makes this testable at all: no code diff should touch those files).
- **Acceptance** — end-to-end: signup → verify → Gym + both lifecycle rows exist → invite first Member → Final Commit succeeds → `FirstValueReached` fires and Owner is notified → Owner returns a second day and performs a real action → `OwnerActivated` fires — the full journey `OWNER_ACTIVATION_ARCHITECTURE.md` and `OWNER_LIFECYCLE_STATE_MACHINE.md` describe, observed as an actual sequence of state transitions.

---

# 15. Implementation Phases

Each milestone leaves production in a valid state on its own and requires nothing from a later milestone.

- **M10.1 — Gym Lifecycle State foundation.** `gym_activation_state`, `gym_commercial_state` schema; `register_owner` extended to create them; `on_owner_email_verified`, `evaluate_first_value`, `evaluate_activation` triggers wired. No UI change. **Valid state:** existing Owners/Gyms are backfilled into a lifecycle state consistent with reality (already-operating Gyms marked `activated`/`paying`, per a one-time backfill); new signups get real state nobody reads yet. Nothing observable changes for any user.
- **M10.2 — Activation Checklist + Owner Dashboard.** Read models (Section 8) and their UI, consuming M10.1's facts. **Valid state:** new Owners now see guided onboarding; existing Owners see a normal dashboard reflecting their already-`activated` state. No billing exists yet — everything is still effectively unlimited/free from the product's own perspective.
- **M10.3 — Admin Invitation.** `admin_invitations` schema, `send/accept/revoke_admin_invitation`. Independent of billing; can ship in any order relative to M10.4+. **Valid state:** Owners can add staff; nothing else changes.
- **M10.4 — Platform Plan catalog + Platform Subscription/Order schema + purchase flow.** Stripe Checkout Session creation, `purchase_platform_plan`. **Valid state:** Owners *may* voluntarily start paying; nothing is enforced yet — trial expiry does not yet block anything (M10.6 is what adds enforcement), so this milestone cannot break an existing free-riding trial Gym.
- **M10.5 — Platform Billing webhook + Past Due/Cancel/Reactivate.** `register_platform_payment`, `refund_platform_payment`, dunning transitions. **Valid state:** payments now actually settle and failures now actually get dunned; still no access is blocked by any of this yet.
- **M10.6 — Trial expiry enforcement.** `advance_trial_state`'s `expired` transition begins actually blocking product access (Section 6.6). Deliberately last, since it is the only milestone in this list capable of removing access from a real Owner — shipped only once every upstream milestone (billing capture, Checklist guidance, notification-on-First-Value) has been live and proven, so that an Owner who hits the paywall always has a working purchase path already in front of them.

---

# 16. Self-Review — Attempting to Break This Architecture

**Hidden coupling, found and fixed:** the first draft of Section 5.1 modeled Activation State and Commercial State as one table. This would have let a future access-control check read the wrong field — since only the Commercial axis may ever block access (`OWNER_LIFECYCLE_STATE_MACHINE.md` Section 6) — and silently violate that rule the moment someone wired a check against the wrong column out of convenience. Fixed by splitting into two logically separate entities (Section 5.1), so "which one of these can block access" is answered by *which table you queried*, not by which column you remembered to check.

**Leaky abstraction, checked and confirmed absent:** does `evaluate_first_value`/`evaluate_activation` require the Member Domain to know about the Owner Domain? No — both are triggers on a table the Member Domain already writes to for its own reasons; `m9_final_commit_*` requires zero code change (Section 6.2). This was verified, not assumed, by tracing the actual write path M9's Final Commit already uses.

**Circular dependency, checked and confirmed absent:** Owner Domain reads Member Domain facts (via the trigger above) and Financial Domain's *pattern* (Section 5.3/5.4, copied not referenced). Neither Member nor Financial Domain reads anything from Owner Domain. The dependency graph is one-directional.

**Duplicate responsibility, found and fixed:** an early version of this document risked two independent "is the checklist done" computations — one implied by Gym Activation State's own values, one in a separately-imagined checklist-progress table. Resolved by making Section 5.6 explicit that no such table exists; there is exactly one derivation, over existing facts.

**Weak tenant isolation, flagged rather than assumed safe:** this project has a documented history of real, previously-discovered multi-tenant RLS defects (SECURITY DEFINER recursion, `WITH CHECK` evaluating the pre-update row, UPDATE requiring a matching SELECT policy, upsert-plus-NOT-NULL interactions). Every new RLS policy this document specifies (Section 10) is a *new* policy, not a reuse of an already-audited one, and must be independently re-verified against that exact checklist before ship — named here explicitly as a required verification step for M10.1's implementation, not assumed safe by analogy to `gym_invitations`' already-proven shape.

**Missing invariant, found and fixed:** the original draft did not state what prevents two Owners from racing to claim the same Gym, or what happens on a Gym-ownership transfer. Resolved by making "exactly one `owner_admin_id`, set once, at creation, never reassigned" an explicit, structurally-enforced invariant (Section 4/5.1), and explicitly naming ownership transfer as an out-of-scope future concern (Section 2) rather than an implied-but-unbuilt capability.

**Race condition, checked and confirmed handled:** could an eager Owner invite a Member before `on_owner_email_verified` completes? No — `send_admin_invitation`'s M9-equivalent (the existing M9 invitation-send path) already requires an authenticated, verified session by construction (Section 6.1 of `OWNER_ACTIVATION_ARCHITECTURE.md`, Principle 3.11), so this is enforced by existing auth, not a new gap this document needed to close.

**Complexity, checked against the alternative:** two lifecycle-state tables, two ledgers (Platform vs. Member), two webhook endpoints — more moving parts than a naive single-table, shared-webhook design. Each split is justified by a specific, named failure it prevents (Sections above), not by symmetry for its own sake; a simpler design was considered and rejected in each case, not merely not considered.

**Violation of frozen architecture, checked:** no command in Section 6 writes to a Member Domain or Financial Domain table; no RLS policy in Section 10 grants cross-domain access; Platform billing shares no table or webhook with Member billing (Principle 3.2, verified against Section 7's endpoint list). None found.

---

**Final verdict: READY FOR M10 IMPLEMENTATION**
