# Forge — Financial Domain Architecture: Working Session

**Date:** 2026-07-20
**Participants:** Forge engineering (acting as Principal Software Architect / Architecture Review Board, multiple rounds)
**Trigger:** Revenue reporting (`fetchRapoarte`, Admin → Settings) reconstructs revenue by regex-parsing free text in `subscriptions.notes` (e.g. `"Plătit: 379 RON"`) — identified as an unacceptable long-term design during an earlier product review of the Settings tab.
**Purpose of this document:** full working-session record — architecture review, technical design, adversarial structural validation, two rounds of challenge/response on specific decisions, the resulting ADR set, and a final amendment on enforcement mechanism. This is the source-of-truth artifact referenced by the ADRs it contains.

---

## Table of Contents

1. [Architecture Review — Conceptual Model](#1-architecture-review--conceptual-model)
2. [Technical Design Document (TDD)](#2-technical-design-document-tdd)
3. [Product Context & Engineering Principles (established)](#3-product-context--engineering-principles-established)
4. [Conceptual Model Validation — Final Review Before Implementation](#4-conceptual-model-validation--final-review-before-implementation)
5. [Structural Validation — Red Team Review](#5-structural-validation--red-team-review)
6. [Challenge — Justify the Order Aggregate vs. Separate Aggregates](#6-challenge--justify-the-order-aggregate-vs-separate-aggregates)
7. [Challenge — Order + OrderItem Comparison](#7-challenge--order--orderitem-comparison)
8. [Architecture Decision Records (ADR-001 through ADR-010)](#8-architecture-decision-records)
9. [Amendment — Database-Level Enforcement of Business Invariants](#9-amendment--database-level-enforcement-of-business-invariants)

---

## 1. Architecture Review — Conceptual Model

**Ask:** Act as a Principal Architecture Review Board (Software Architecture, DDD, FinTech Systems Design, SaaS Product Architecture) and determine the correct financial domain architecture for Forge before any code is written — a decade-long decision, not an implementation task. Current model: Membership Plans → Subscriptions → Reports, with revenue reconstructed via regex over `subscriptions.notes`. Must naturally support (without redesign): discounts, multiple payment methods, partial payments, refunds, credits, failed payments, Stripe/GoCardless, invoicing, merchandise, PT packages, nutrition, drop-ins, event registrations, gift cards, multi-location.

### Executive Summary

Forge's current financial model conflates two fundamentally different business concepts into one table: **Subscription** (an entitlement — what a member can access) and **Payment** (a fact about money that changed hands). Today, payment information is embedded as free text inside a subscription's `notes` field and reconstructed for reporting via regex.

**Recommendation:** introduce **Payment** and **Order** as first-class, independent domain entities. Subscription becomes one of potentially several *purchasable* things an Order can represent; Payment always references an Order, never a Subscription directly. This single structural decision — Payment references the *purchase*, not the *entitlement* — is what makes every future requirement (partial payments, refunds, Stripe, merchandise, PT packages, POS) additive rather than a redesign.

This is not the minimal fix. The minimal fix (add an `amount_paid` column to `subscriptions`) would resolve today's regex bug cheaply but would require a second redesign the moment Forge sells anything that isn't a subscription.

### Domain Analysis

What actually happens in a gym, independent of software: (1) a gym defines what it offers (a catalog); (2) a client acquires something from that catalog — an entitlement, a one-time item, a package; (3) money may or may not change hands, possibly more than once, possibly reversed, possibly never; (4) the gym wants to know how much money actually moved, independent of what it was for.

Forge's current model conflates steps 2 and 3. This is the same category of error as encoding workout structure into free text and parsing it back out — **structured facts must be stored as structured facts, not encoded into a string and reconstructed.**

### Recommended Domain Model

- **Gym** *(existing)* — tenant boundary.
- **Client** *(existing)*.
- **Plan** *(existing, responsibilities clarified)* — catalog template.
- **Subscription** *(existing, decoupled from payment)* — entitlement instance, snapshotted from a Plan at creation.
- **Order** *(new)* — "a purchase event": what was acquired, at what agreed price, in what settlement state. Starts supporting exactly one purchasable type (Subscription), shaped to support more without restructuring.
- **Payment** *(new)* — append-only record of money movement, always referencing an Order.
- **Invoice** *(future)* — thin presentation layer over Order.
- **Payment Provider reference** *(future)* — an attribute on Payment, not a new entity.
- **Credit / Wallet ledger** *(future, separate from Payment)*.

### Entity Responsibilities

**Plan** owns: name, default price, default session count, default duration, active/retired status. Never owns: which clients hold it, actual dates, actual price paid.

**Subscription** owns: client, gym, actual start/end dates, session usage, lifecycle state, and a **snapshot** of terms copied from Plan at creation. Must never live-reference a mutable Plan for its terms after creation.

**Order** owns: what was purchased (reference to a purchasable thing), agreed total amount, settlement status. Never duplicates entitlement logic (Subscription's job) and never holds pricing *rules* (Plan's/future Discount's job).

**Payment** owns: amount, direction (charge/refund), method, status, timestamp, reference to its Order. Never references Subscription directly. Never mutated after creation.

### Relationship Chain

```
Gym → Client → Subscription (instantiated from a Plan) → Order (0..1 per subscription today)
→ Payment(s) (0..n) → Invoice (future) → Payment Provider (future)
```

Plan sits beside this chain as a template; Subscription references it by id, snapshotting terms rather than live-referencing.

### Business Invariants

| Invariant | Answer | Why |
|---|---|---|
| Can a Payment exist without a Subscription? | Yes | Payment references an Order, not a Subscription. Once merchandise/PT/drop-ins exist, most Payments won't involve a Subscription at all. |
| Can a Subscription exist without a Payment? | Yes | Comp memberships; a subscription pending payment. |
| Can multiple Payments belong to one Subscription (via its Order)? | Yes | Deposits + balance, or a failed attempt followed by a successful retry. |
| Can a Subscription change Plans? | No — model as a new Subscription | Snapshot invariant; "changing plans" = ending one entitlement, creating another, linked by `renewed_from`. |
| Should Refunds be Payments? | Yes — negative-direction Payment referencing the original | One append-only ledger as the source of truth. |
| Should Credits be Payments? | No | A credit is an internal promise of future value, not a completed movement of real money. |
| Should comps generate Payments? | Yes — a zero-amount Payment with method='comp' | Keeps "sum of payments" uniform, makes comp counts queryable. |
| Should failed payments be stored? | Yes | Needed for future dunning/retry logic and support visibility. |

### Aggregate Boundaries (DDD)

- **Subscription Aggregate** (root: Subscription) — owns lifecycle/session usage; references Plan by id only.
- **Order/Payment Aggregate** (root: Order) — Payments are child entities; Order references *what* was purchased by id+type, never reaching into that thing's internals.
- **Client Aggregate** — owns identity/profile; may query across Orders/Payments but doesn't duplicate that data.
- **Plan Aggregate** — standalone catalog entity.

### Lifecycles

- **Plan:** draft → active → retired (never hard-deleted while referenced).
- **Subscription:** created (snapshotted) → [pending-payment] → active → {exhausted | expired | cancelled}, optionally superseded by renewal.
- **Payment:** initiated → {succeeded | failed | pending} → optionally refunded (new linked negative Payment).

### Alternative Architectures Considered

- **A — Minimal patch:** `amount_paid` column directly on `subscriptions`. Rejected as long-term architecture — can't represent multiple payments, non-subscription revenue, refunds, or failed payments; defers rather than avoids the eventual need for Payment.
- **B — Payment hard-FK'd exclusively to Subscription.** Rejected — fails the moment merchandise/PT/drop-ins/event-registrations exist; would require restructuring or a growing pile of nullable FKs.
- **C — Full generic polymorphic commerce system from day one.** Rejected — Forge sells exactly one thing today; over-engineering against "avoid premature complexity."
- **D — Recommended:** Order + Payment introduced now, Order supporting exactly one purchasable type today, shaped so a second type is additive.

### Migration Strategy

Mirrors the dual-write pattern already proven in this codebase (Workout Engine V2: legacy table stays authoritative while a new structured model is populated alongside, cut over only once validated):

1. Additive phase — new tables, zero impact on existing behavior.
2. Backfill — regex-parse historical `notes` into Order+Payment, explicitly flagging unparseable rows for manual review (no invented data).
3. Dual-write — new subscription actions write both the legacy `notes` string and the new structured rows.
4. Cutover — reports switch to reading from Payment once validated for a full billing cycle.
5. Rollback — trivial before cutover (additive only); reversible for a grace period after.

### Evaluation Against Criteria

Correctness: high. Business accuracy: high. Data integrity: high. Domain purity: high. Scalability: high (append-only, gym-partitionable, same shape as every other table already scaling in this system). Future extensibility: validated against every named future requirement. Operational simplicity: medium (genuine new-entity cost). Migration complexity: medium, mitigated by the proven dual-write pattern.

### Confidence Level

High confidence in the core Payment→Order separation and Plan-snapshot invariant (established, low-risk patterns, validated against every stated future requirement). Medium confidence on the exact minimal shape of Order's type-discriminator — revisit with the team once a second purchasable type is actually being built. Competitor comparison (Q13) offered as principle-level inference (**Likely**, not **Fact** — no direct access to PushPress/Wodify/BTWB internals).

---

## 2. Technical Design Document (TDD)

**Ask:** Implement the approved architecture inside Forge as a production-ready TDD — no redesign, no code, full implementation blueprint across 22 sections (rollout strategy, DB design, migration, domain services, application flow, frontend/API impact, security, RLS, Edge Functions, transactions, failure scenarios, reporting, testing, deployment, files affected, performance, observability, risks, roadmap, readiness checklist).

### Key Decisions

**Rollout:** Incremental, not Big Bang — reusing the Workout Engine V2 dual-write precedent already proven in this codebase. Phases: (0) additive schema, dark-launched → (1) dual-write → (2) backfill + validation (≥1 billing cycle) → (3) cutover → (4) cleanup (stop dual-writing the notes-encoding; keep the `notes` column for genuine free text).

**Database:** New tables `orders`, `payments`. `orders`: id, gym_id, client reference, purchasable_type/purchasable_id, total_amount, status, created_at, created_by. `payments`: id, gym_id, order_id (NOT NULL), amount (always positive), direction, method, status, provider, provider_reference, refunds_payment_id, created_at, created_by. Cascade rule: **neither table supports hard deletion, ever** — a deliberate exception to how "delete" works elsewhere in Forge (Client deletion is a hard delete; WOD deletion has no confirmation at all).

**Assumption flagged:** client identity is keyed inconsistently in Forge today (`member_email` in `subscriptions` vs. `profiles.id` in `bookings`); `orders.client_id` should key by `profiles.id`, resolved via the existing lookup pattern already used in `stergeAbonament`.

**Domain Services:** Create/Renew/Cancel Subscription rewritten to also create/reference Order+Payment atomically. **Register Payment** and **Refund Payment** are genuinely new capabilities (today's model has no concept of "balance owed" or refund at all). Revenue Reporting rewritten to sum `payments`.

**Application Flow / Transactions:** Create-with-order, register-payment, refund, and renewal are each implemented as a **single SECURITY DEFINER RPC** (matching Forge's own established pattern — `adjust_session_count`, `set_gym_active_status`) rather than the sequential, individually-fallible client-side `await` calls used today in `saveAbonament`/`stergeAbonament`/`adminActiveazaAboQueued` and in the Auth owner-bootstrap flow — all three previously flagged in earlier reviews for partial-failure risk. A Postgres function body is atomic by default; this structurally eliminates that class of bug rather than patching each instance.

**Security / RLS:** Refunds restricted to admin-only (narrower than regular payment registration, consistent with how Subscriptions/Clients are already admin-only vs. Classes/WOD being coach-accessible too). No direct client INSERT policy on `orders`/`payments` at all — every write goes through RPCs, a stronger posture than today's `subscriptions` table. **No UPDATE policy on `payments` for any role** — makes append-only a database-enforced guarantee, not just convention. Members can see their own Order/Payment history (mirrors `profiles_select_all`'s existing shape).

**Edge Functions:** `check-subscriptions`, `send-notification`, `admin-delete-client`, `send-class-reminders`, `analyze-workout` — none require changes (none touch payment amounts). One new Edge Function is a foreseeable *future* need: a webhook receiver for a payment provider (unauthenticated HTTP callbacks are exactly the shape Edge Functions already handle elsewhere) — not needed now.

**Files likely to change:** `src/App.jsx` (Subscriptions tab handlers, Settings tab's `fetchRapoarte`, Clients tab's subscription-expand rendering); `supabase/migrations/` (new tables, RLS, RPCs — verified against live DB state after applying, per this project's own documented migration-drift history); a standalone one-time backfill script. **No changes** expected in `workoutEngine.js`, `workoutComposer.js`, `workoutFormats.js`, `movements.js`, any Edge Function, or workout/class/feed code.

**Testing:** pure domain logic kept independently testable (matching the existing `.test.js` convention already used for `workoutFormats.js` etc.); backfill run in dry-run mode first given this project's documented shared dev/prod database; smoke tests use disposable data cleaned up immediately, per this project's standing rule.

**Risks table**, **21-item phased roadmap** (Foundation → Dual-write → Backfill+Validation → Cutover → Cleanup, each with DoD/rollback), and a **13-item Production Readiness Checklist** were produced (see full TDD turn for complete detail) — headline items: RLS confirmed via security-advisor scan with zero `rls_disabled` findings; every new RPC's body directly read and confirmed to check authorization (not assumed from GRANT list); cross-gym access tested and denied with disposable data; the three previously-identified unchecked-mutation issues resolved as part of this rewrite, not carried forward; sign-off obtained per this project's standing rule that production-critical financial areas require explicit approval before implementation.

---

## 3. Product Context & Engineering Principles (established)

A standing context document was introduced, establishing (among other things): Correctness over speed; long-term maintainability over short-term convenience; production safety over rapid delivery; explicit business rules over implicit behavior; immutable historical data; financial correctness non-negotiable; avoid hidden magic; prefer additive migrations; every production change reversible. Financial Philosophy: money is represented explicitly, revenue never inferred from free text, historical records immutable, corrections create new records rather than modifying historical ones, reports deterministic and reproducible.

**Response, in brief:** acknowledged, with an explicit note that specific technical facts already verified this session (exact functions and their behavior, live RLS policy text, live security-advisor output, exact file/module boundaries) are retained as verified context alongside this document, not superseded by it. Cross-checked against direct evidence already gathered: the free-text-revenue defect, the repeated unchecked-mutation pattern (Subscriptions ×3, Settings ×1, Auth bootstrap), the dual-write precedent (Workout Engine V2), and AI-never-source-of-truth (Workout Intelligence opening drafts for human review rather than auto-committing) — all found to already match the stated philosophy, not merely aspirational.

A subsequent instruction formalized the evidence-tagging discipline used from this point forward: **Verified** (directly observed in the codebase), **Documented** (approved Forge documentation, a lower tier than direct observation per this project's own stated standard), **Assumption** (explicitly flagged as such, with what would confirm it). A self-audit was performed on the Architecture Review and TDD, re-classifying several claims (Sentry's actual current coverage, the assumed absence of a feature-flag system, the assumed absence of a dedicated audit-log table) from "stated as fact" to "documented/inferred, not independently verified."

A further instruction added: preserve existing architectural decisions unless there is a concrete technical reason to change them; explain every recommendation using evidence from either documented architecture or verified codebase observations. Confirmed as consistent with practice already demonstrated (Design D implemented as approved without relitigating it; the TDD's only deviations from a literal reading of the architecture were each flagged explicitly with a stated technical reason, not silently substituted).

---

## 4. Conceptual Model Validation — Final Review Before Implementation

**Ask:** Validate the conceptual model itself (Plan/Subscription/Order/Payment separation, responsibilities, ownership boundaries) before reviewing implementation details — flag any concrete flaw before proceeding.

### Verdict

**The conceptual model is architecturally sound.** No structural flaw found requiring rejection or redesign. Two refinements identified — both definitional/additive, neither blocking.

### Two Findings

**1. Order's definition ("a commercial purchase") is slightly narrower than its required behavior.** The already-approved invariant requires every Subscription — including complimentary ones, where no commerce occurs — to still have an Order (so `sum(payments)` reporting never special-cases absence). A future engineer reading "Order = purchase" literally could conclude a comp grant shouldn't need one, silently breaking that invariant. **Not a structural flaw** — the entity's designed behavior is correct; this is a definitional precision gap. Recommend describing Order as *"the record of what was granted and on what commercial terms, including terms of zero cost,"* not strictly "a purchase."

**2. Currency is not represented anywhere in the model, and the current implementation is single-currency by hardcoding, not by design.** Verified directly: the existing Admin UI hardcodes `RON` (`${p.price} RON`). The approved Future Roadmap names "Multiple Locations" as a future requirement, which could plausibly cross a currency boundary. Does not require action now — single-currency is a reasonable simplification for Forge's current footprint — but flagged as the cheapest possible moment to decide this consciously (an additive `currency` field, defaulting to the current single value) rather than discover it as a forced migration later.

### Recommendation

Proceed to implementation-level review unchanged. Incorporate both findings as small, additive clarifications — neither changes any entity, responsibility, or invariant already approved.

---

## 5. Structural Validation — Red Team Review

**Ask:** With the conceptual model accepted, validate the fully-detailed field-level schema adversarially — "attempt to break the model" — across relationships, invariants, aggregate boundaries, consistency, recovery/reconciliation, audit, missing concepts, simplicity, and 10-year evolution against every named future requirement.

### Finding 1 — Critical: `Order.subscription_id` as a direct, exclusive FK contradicts the already-approved architecture.

The detailed schema under review specified `Order.subscription_id` as a plain, exclusive foreign key — reintroducing "Design B," which the original Architecture Review explicitly considered and rejected. Run against the Evolution Review's own bar ("only extension should be necessary"), this single field is the reason nearly every future purchasable type (merchandise, PT packages, drop-ins, gift cards, competition registrations) would require redesign, not extension. **Recommended (at the time):** generic `purchasable_type`/`purchasable_id`. **Classification: Mandatory** (at the time — see Section 6/7 for the subsequent revision).

### Finding 2 — High: the stated `Subscription 1:1 Order` cardinality is not structurally enforced.

Nothing in the schema prevents two Order rows referencing the same subscription without an explicit unique constraint. **Recommended:** unique constraint on the purchasable reference. **Classification: Mandatory.**

### Finding 3 — Critical (future) / Low (today): no uniqueness on `(provider, provider_reference)`.

Stripe webhook delivery is documented as at-least-once — duplicates are expected, not an edge case. Without this constraint, a duplicate webhook creates two Payment rows for one real charge, double-counting revenue. Costs nothing today (no rows populate these fields yet). **Classification: Strong Recommendation** (Mandatory the moment any provider integration is proposed).

### Finding 4 — Medium: refund-of-a-refund not disallowed.

`original_payment_id` can point to another refund with nothing preventing it. **Recommended:** constrain the reference to only ever point at a `direction='charge'` Payment. **Classification: Strong Recommendation.**

### Finding 5 — High: refund amount validation is a race condition if implemented as check-then-insert.

Two simultaneous refund requests against the same Order could each independently observe "not yet over-refunded" and both proceed, jointly over-refunding. **Recommended:** the check and insert must happen within one locked/serializable transaction. **Classification: Mandatory** (financial correctness is non-negotiable per the stated principles).

### Finding 6 — Low: `total_amount`'s tax-inclusivity convention is undocumented.

No cost today (no tax field exists); recommend documenting the convention now so a later additive `tax_amount` field has an unambiguous baseline. **Classification: Optional Improvement.**

### Finding 7 — Low: `Plan.is_unlimited` and `Plan.sessions` can hold a contradictory combination.

Nothing prevents `is_unlimited=true` with a non-null `sessions` value. **Recommended:** a check constraint enforcing mutual exclusivity. **Classification: Strong Recommendation.**

### Validated — No Flaw Found

Order as aggregate root for Payments; currency present on every monetary fact (correct Money-value-object practice, not duplication); `Order.client_id` alongside `Subscription.client_id` (necessary, not redundant, once Finding 1 is resolved); Subscription's five snapshot fields (exactly matched to the approved invariant); refund-as-new-Payment / append-only / no-deletion; reconciliation queryability; multi-location/multi-currency structural readiness aside from Finding 6.

### Final Verdict (at this stage)

**⚠ APPROVED WITH REQUIRED CHANGES** — Findings 1, 2, and 5 classified Mandatory. (Finding 1's specific prescription was subsequently revised — see Section 6.)

---

## 6. Challenge — Justify the Order Aggregate vs. Separate Aggregates

**Challenge raised:** Finding 1 assumes every future purchasable domain must share the same Order aggregate — justify why a polymorphic purchasable reference is architecturally superior to separate aggregates reusing shared Payment infrastructure, demonstrating a *concrete* flaw, not merely the flexibility of an alternative.

### The Real Question

Not "polymorphic vs. separate aggregates" (separate aggregates for Subscription/Merchandise/PT are already correct and unchanged by this decision) but: **where does Payment attach, and does that attachment point's shape have to change every time the catalog grows?**

### What "separate aggregates, shared Payment infrastructure" mechanically requires

**Option A — Payment gets a nullable FK per domain** (`subscription_order_id`, `merchandise_order_id`, …):
- **Defect 1:** reporting logic isn't stable across the product's own evolution — a revenue query correct today becomes silently incomplete the moment a new domain ships, requiring rediscovery and rewriting every time. The same failure shape as the original regex-revenue defect.
- **Defect 2:** an unenforceable exclusivity constraint — nothing stops two of the nullable columns being set simultaneously on one row, an incoherent state; preventing it requires a CHECK constraint that grows with every new domain. A single type+id pair makes this state impossible by construction, no growing constraint needed.
- **Defect 3:** this is Finding 1 one layer down, not avoided — Payment's shape is now coupled to the full enumeration of every purchasable domain that will ever exist.

**Option B — split Payment itself per domain:** strictly worse — fragments "Payments form the immutable financial ledger" into N ledgers; a revenue report requires a UNION across every domain's table; refund lineage needs type-aware joins across tables.

### What the recommendation actually is — and isn't

Order is **not** Subscription's aggregate, and not a merger of Subscription/Merchandise/PT into one concept. It's a deliberately thin "ledger entry header" (client, gym, purchasable reference, amount, currency, status, timestamps) sitting *adjacent* to whichever real aggregate produced it. Subscription keeps its own lifecycle and rules, fully decoupled from a future Merchandise aggregate's inventory rules. Order's only job is being Payment's one stable attachment point.

### Steelmanning the alternative

The legitimate case for separate Order-per-domain tables is write contention at very high transaction volume — not evidenced at Forge's actual or near-term scale (thousands of gyms, already gym-partitioned like every other table in this system).

### Conclusion

Finding 1 stands on a sharpened basis: **any design where Payment attaches to purchasable-specific entities — directly, or through a per-domain Order wrapper — forces Payment's shape, constraints, or reporting queries to change every time the catalog grows.** A single, thin Order is the only option giving Payment a permanent, unchanging attachment point while every real business aggregate remains fully independent.

---

## 7. Challenge — Order + OrderItem Comparison

**Challenge raised:** the revised argument identifies a real structural-stability concern, but introducing `purchasable_type`/`purchasable_id` today appears to conflict with the approved principle of preferring explicit domain models over generic abstractions. Compare against an Order + OrderItem design and explain why it would be inferior at Forge's current stage.

### Conceding the Real Tension

`purchasable_type`/`purchasable_id` *is* generic, and it does cost something against "prefer explicit domain models": a plain FK gives Postgres-enforced referential integrity for free; a type-tagged reference doesn't, without extra machinery. A genuine cost, not minimized.

### The Conflation to Undo

Finding 1 bundled two decisions: (1) what Payment attaches to — must never become domain-specific, fully load-bearing, unaffected by what follows; (2) what Order itself points at to say what it represents — a separate, lower-stakes decision, since Payment and revenue reporting never need to know Order's internal reference shape at all (revenue reads `payments`, not `orders`' purchasable reference).

### Revised Recommendation

**Plain `subscription_id` FK on Order today, not a generic discriminator.** Full DB-enforced referential integrity, zero abstraction cost, for a capability (a second purchasable type) that doesn't exist yet — directly satisfies "prefer explicit domain models" and "avoid premature complexity" without qualification. The deferred generalization, when actually needed, is a small, single-table, additive migration that never touches Payment or any invariant. **Finding 1's diagnosis stands (Payment must never be domain-specific); its prescription was too broad and is revised here.**

### Why Order + OrderItem Is Inferior at This Stage

1. **Solves a problem not in scope.** OrderItem's entire reason to exist is multiple distinct things bought in one checkout event — nothing in the approved roadmap requires this; every future purchasable type needs to be *individually* purchasable, not necessarily purchasable *together*.
2. **Doesn't avoid the reference question, relocates it at real cost.** OrderItem still needs its own type/id discriminator (or loses traceability via denormalized snapshot fields with no FK) — and given today's 1:1 cardinality, every Order would carry exactly one OrderItem forever until a cart feature ships: a permanent extra join for zero present benefit.
3. **When it would be correct:** the moment Forge builds a unified checkout is exactly the moment to introduce OrderItem — a clean, additive migration precisely because today's simpler model is a strict special case of it.

### Updated Position

- `Order.subscription_id`: plain, explicit FK. Generalize only when a second purchasable type is actually being built.
- `Order + OrderItem`: not justified at this stage; revisit specifically when a real multi-item checkout requirement exists.
- `Payment → Order`: unchanged — the one relationship that must never become domain-specific.

---

## 8. Architecture Decision Records

Full ADR-001 through ADR-010, each following: Title / Status / Context / Decision / Rationale / Alternatives Considered / Consequences / Future Reconsideration.

### ADR-001 — Financial Domain Model (Plan/Subscription/Order/Payment Separation)
**Status:** Accepted. Four entities, each one responsibility, replacing the free-text-notes defect. Rejected alternatives: `amount_paid` column on Subscription (can't support multiple payments/refunds/non-subscription revenue); fully generic commerce system now (premature). No future-reconsideration trigger — foundational.

### ADR-002 — Payment Ownership (Attachment Point Stability)
**Status:** Accepted. Payment always references exactly one Order via `order_id`, never a purchasable entity directly; `(provider, provider_reference)` uniqueness guard included. Rejected: Payment hard-FK'd to Subscription; Payment with a nullable FK per domain; separate Payment tables per domain. Reconsider only if transaction volume creates a genuine write/lock bottleneck (not evidenced) — remedy then is partitioning, never re-coupling.

### ADR-003 — Order Responsibility and Purchasable Reference Shape
**Status:** Accepted. Order references its purchasable thing via a plain, explicit `subscription_id` FK, not a generic discriminator; no line items. Considered and rejected for now: generic `purchasable_type`/`purchasable_id`; Order + OrderItem. Reconsider: introduction of a second purchasable domain (generalize the FK then); introduction of multi-item checkout (introduce OrderItem then).

### ADR-004 — Subscription Responsibility and Plan Independence
**Status:** Accepted. Subscription owns access state only; snapshots Plan's terms at creation; never live-references Plan. Rejected: live Plan reference (retroactively rewrites sold terms); mutating `plan_id` in place (ambiguous historical terms) — modeled as renewal via `renewed_from_subscription_id`. No reconsideration trigger — durable invariant.

### ADR-005 — Revenue Calculation Source
**Status:** Accepted. Revenue calculated exclusively as a sum over `payments`; never from free text, Subscription, or Order directly. Rejected: continued regex parsing; `amount_paid` on Subscription. Reconsider: tax engine introduction (decide inclusive/exclusive convention); multi-currency operation (decide per-currency vs. converted reporting).

### ADR-006 — Refund Model
**Status:** Accepted. Refunds are new Payment rows (`direction='refund'`) referencing the original charge; historical rows never modified; refund-of-refund disallowed; refund amount validated atomically against prior charges. Rejected: separate `refunds` table; mutating the original Payment. Reconsider: introduction of a recurring billing provider with native refund objects (still represented as a new Payment row here, no new mechanism).

### ADR-007 — Financial Ledger Immutability
**Status:** Accepted. No UPDATE/DELETE permitted on Payment by any role; Orders never deleted, only transitioned. Rejected: admin-editable Payment rows; hard-deletable mistaken entries. No reconsideration trigger — permanent invariant.

### ADR-008 — Snapshot Strategy for Commercial Terms
**Status:** Accepted. Subscription snapshots Plan's terms at creation; Order records its own agreed total independently. Rejected: Subscription deriving terms live from `plan_id` on read. Reconsider: introduction of a discount/promotional-pricing engine (Order additionally records *why* its total differs from the snapshot price).

### ADR-009 — Future Evolution Strategy
**Status:** Accepted. Every future capability is an extension of the four entities, added when actually scoped, never pre-built speculatively. Named extension points: Payment.provider/provider_reference (providers); Order's reference generalization (2nd purchasable domain); OrderItem (multi-item checkout); existing currency fields (multi-currency, pending ADR-010's conventions). Rejected: building all of it now. Reconsidered incrementally, per roadmap item, at the triggers named in ADR-002/003/005/010.

### ADR-010 — Deferred Decisions
**Status:** Accepted (as a record of deferral). Explicitly open: (1) tax-inclusive/exclusive convention on `total_amount`; (2) cross-currency Payment/Order handling; (3) whether a dedicated audit-log table is needed beyond `created_by`/`created_at`. Reconsider: (1) no later than a tax engine's introduction; (2) before any multi-currency work begins; (3) if a formal audit/compliance requirement emerges.

### Architecture Status Summary

| # | Decision | Status |
|---|---|---|
| 1 | Plan / Subscription / Order / Payment as four separate entities | Accepted |
| 2 | `amount_paid` column on Subscription, no separate entities | Rejected |
| 3 | Fully generic polymorphic commerce system built now | Rejected |
| 4 | Payment references Order only, via `order_id` | Accepted |
| 5 | `(provider, provider_reference)` uniqueness constraint | Accepted |
| 6 | Payment hard-FK'd directly to Subscription | Rejected |
| 7 | Payment with one nullable FK per purchasable domain | Rejected |
| 8 | Separate Payment tables per domain | Rejected |
| 9 | Order references purchasable thing via plain `subscription_id` FK | Accepted |
| 10 | Generic `purchasable_type`/`purchasable_id` on Order, now | Future Consideration |
| 11 | Order + OrderItem line-item model | Future Consideration |
| 12 | Subscription owns entitlement only, never payment data | Accepted |
| 13 | Subscription snapshots Plan terms at creation | Accepted |
| 14 | Subscription live-references Plan (no snapshot) | Rejected |
| 15 | Subscription mutates `plan_id` in place for plan changes | Rejected |
| 16 | Revenue calculated exclusively from `payments` | Accepted |
| 17 | Refunds as new Payment rows (`direction='refund'`) | Accepted |
| 18 | Refund-of-a-refund | Rejected |
| 19 | Refund balance validated atomically with insert | Accepted (see Amendment, Section 9) |
| 20 | Separate `refunds` table | Rejected |
| 21 | Mutating original Payment to reflect a refund | Rejected |
| 22 | Payment/Order immutability (no UPDATE/DELETE) | Accepted |
| 23 | Editable Payment rows for corrections | Rejected |
| 24 | Hard-deletable Payment rows | Rejected |
| 25 | Tax-inclusive/exclusive convention on `total_amount` | Deferred |
| 26 | Cross-currency Payment/Order handling | Deferred |
| 27 | Dedicated audit-log table | Deferred |
| 28 | Additive-only future evolution strategy | Accepted |

---

## 9. Amendment — Database-Level Enforcement of Business Invariants

**Ask:** A new standing principle set was introduced, including "prefer database constraints over application assumptions" and "business invariants are enforced as close to the data as possible."

### Already Fully Aligned

Immutability/append-only (ADR-007, RLS-enforced); revenue-from-Payments-only (ADR-005); explicit domain models (ADR-003's final position); additive evolution (ADR-009).

### Tension Identified and Resolved

Two prior enforcement-mechanism choices relied on the RPC layer alone rather than a guarantee independent of write path:

1. **Refund balance validation (ADR-006)** — previously "validated within the same atomic operation" (the RPC), which only protects entries going through that specific function.
2. **Order status derivation** — previously "maintained by the service layer, not a DB trigger," explicitly chosen at the time to avoid complexity not yet earned.

**Why revise now:** this project has a documented, *verified* history of real RLS/permission misconfigurations (confirmed via a live security-advisor audit this session). "The RPC is the only way in, RLS blocks everything else" is two mechanisms that must both stay correctly configured forever; a trigger enforces the invariant regardless of which mechanism let a write through — defense in depth specifically warranted here given this project's own evidenced risk profile, not a general rule applied indiscriminately.

### Amendment (narrow, does not reopen ADR-002/003/006's actual decisions)

- Refund balance validation moves from RPC-only to a `BEFORE INSERT` trigger on `payments` independently verifying a refund's amount against the sum of prior charges on its Order; the RPC's own check remains as a fast-fail, the trigger is the actual guarantee.
- Order's status field is recomputed by a trigger reacting to Payment inserts against its Order, not written by the RPC/service layer — cannot drift from the true sum of Payments regardless of write path.

Both are additive (a trigger each, no new entities, no relationship changes) and tighten *how* two already-approved invariants are guaranteed, not what was decided. Everything else in the ADR set already satisfies this principle and needs no revision.

---

## 10. Post-Implementation Amendment — Subscription Lifecycle RPCs, Self-Service Order Authorization, Payment.method (2026-07-20)

Recorded after implementation, closing the loop this document's ADRs opened but did not fully specify. Does not reopen or contradict ADR-001 through ADR-010 — extends the implementation surface within the model those ADRs already approved.

### ADR-011 — Subscription Lifecycle RPCs

**Status:** Accepted. `create_subscription`, `activate_queued_subscription`, `delete_queued_subscription`, `end_subscription` added as the only write path for `subscriptions`. **Context:** none of the three original Phase 1 RPCs (`create_order_for_subscription`, `register_payment`, `refund_payment`) write to `subscriptions` at all — `create_order_for_subscription` requires a pre-existing subscription. A gap analysis against every real write call site (`saveAbonament`, `adminActiveazaAboQueued`, `activateQueuedSubscription`, `stergeAbonament`) found this was a genuine missing capability, not a deliberate scope decision at the time ADR-001–010 were written. **Decision:** four new RPCs, each a faithful atomic translation of the existing client-side logic (mirroring exactly what `saveAbonament` etc. already did), composing on top of the existing, unmodified `create_order_for_subscription`/`register_payment` rather than duplicating their logic. **Consequence:** subscription creation-with-payment became fully atomic in one round trip, structurally eliminating the "unchecked sequential mutation" pattern the original TDD flagged in three call sites.

### ADR-012 — Self-Service Order Authorization

**Status:** Accepted. `create_order_for_subscription`'s authorization widened from admin-only to admin-OR-the-subscription's-own-owner. **Context:** the member-triggered auto-activation path (`fetchAbonamentMeu` → `activateQueuedSubscription`) runs under an ordinary member session, but `activate_queued_subscription`'s internal call to `create_order_for_subscription` was still unconditionally admin-only — producing a Subscription with no Order at all for that one workflow, violating the already-approved invariant that every Subscription has an Order. **Decision, and why only this one RPC:** `create_order_for_subscription`'s amount is always server-derived from `subscription_plans.price`, never caller-supplied — widening it lets a member trigger a bookkeeping record for their own subscription's already-fixed price, no money-movement attestation involved. `register_payment` was explicitly **not** widened and never will be without a fresh architecture review — its amount is a caller-attested claim that money changed hands; self-service access there would let a member declare their own subscription paid without an admin ever seeing real money. **Consequence:** every Subscription now has an Order regardless of activation path; a self-service activation with an unregistered legacy payment amount leaves its Order in `status='pending'` — the architecture's own sanctioned state, not a gap.

### ADR-013 — Payment.method Canonicalization

**Status:** Accepted. `payments.method` (present since Phase 0, never constrained, never populated by any code path) gained a CHECK constraint: `method IS NULL OR method IN ('cash', 'card', 'bank_transfer', 'comp')`. **Context:** an architecture review (Phase 4) found the schema already contained the abstraction needed for payment-channel tracking (`method`/`provider`/`provider_reference`, the latter two named as a future extension point in ADR-009) — the review's conclusion was to complete the existing design, not introduce a new one. **Decisions:**
- **No `'other'`** — an unrecognized future channel requires an architecture review to add, not a silent escape hatch.
- **`'comp'` stays in the constraint but is excluded from the UI-facing picker** — it is an internal business concept (`register_payment`'s existing zero-amount-comp rule already depends on being able to pass `method='comp'`), not a public payment channel.
- **`method` stays nullable** — `activate_queued_subscription`'s transcription of a pre-cutover legacy-notes payment may have a genuinely unknown method; forcing a value would mean fabricating one.
- **Apple Pay / Google Pay are not `method` values** — they are card payments processed by a provider (`method='card', provider='stripe'`), not a distinct channel.
- **`provider`/`provider_reference` remain reserved, unused** — no real payment-provider integration exists; wiring them into `create_subscription`/`activate_queued_subscription` was explicitly out of scope, reserved for whatever future RPC actually talks to a provider's webhook.

**Revisit when:** a real payment-provider integration is proposed (activates `provider`/`provider_reference`), or a genuinely new payment channel needs adding to the canonical vocabulary.

### Financial Domain — final status

Model: `Subscription → Order → Payment (method, provider, provider_reference) → Refund → Reporting`. All phases (0: schema, 1: core RPCs, 1-Extension: subscription lifecycle, 2: application cutover, 3: reporting migration, 4: payment methods) complete, validated in production, committed, and pushed. **Frozen** — no further architectural, schema, or RPC changes without a real production defect or a new business requirement passing a fresh architecture review, per this document's own standing evidence-based-change discipline.

---

*End of working session record.*
