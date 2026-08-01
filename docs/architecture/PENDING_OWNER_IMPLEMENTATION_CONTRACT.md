# Pending Owner & Atomic Bootstrap — Implementation Contract

This document transforms `ADR-001_OWNER_IDENTITY_BOOTSTRAP.md` (STATUS: ACCEPTED) into the binding contract between Product Architecture and Engineering. It does not reopen, redesign, or reconsider the ADR's decision. Where this contract makes a choice the ADR left to implementation (for example, exactly which fields Pending Owner carries, or exactly how Bootstrap achieves atomicity), that choice is made here, once, and becomes equally binding.

This is not architecture and not implementation. It is the specification engineering builds against. A future implementation that satisfies this document is, by definition, ADR-001-compliant. A future implementation that violates it is non-compliant regardless of how it was arrived at.

---

# Part 1 — Pending Owner

## What Pending Owner IS

**Pending Owner is a state, not a table.** It names the interval between "someone submitted an email and password" and "that email has been verified." Concretely, it is nothing more than an unconfirmed `auth.users` row — a mechanism Supabase's own authentication system already provides, already manages the lifecycle of, and already enforces email uniqueness on. Forge introduces no new schema to represent it.

This is a deliberate, minimal decision, not an oversight: `OWNER_DOMAIN_IMPLEMENTATION_ARCHITECTURE.md` Principle 3.7 requires reusing a proven mechanism before inventing a parallel one, and Supabase's unconfirmed-user state already *is* exactly what Pending Owner needs to be — revocable, uniquely keyed by email, natively expirable, natively resend-capable. Building a second, Forge-owned table to duplicate this would be exactly the kind of parallel mechanism this project's own architecture already rejects.

## What Pending Owner IS NOT

- It is not an Owner. "Owner" is a role that exists only once Bootstrap succeeds (`ADR-001` Invariant 1).
- It is not a business resource of any kind, and owns none.
- It is not a draft, placeholder, or partially-configured Gym.
- It is not tracked, referenced, or joined against by any table this domain or any other domain owns. Nothing in Forge's schema holds a foreign key to a Pending Owner, because nothing is allowed to depend on a state that may never resolve.

## Purpose

To let a prospective Owner begin the one action Forge requires before trusting them with anything real — proving control of their email — without Forge committing any real resource on the strength of an unverified claim.

## Lifecycle

1. **Creation.** A prospective Owner submits email and password. Forge calls Supabase's native sign-up mechanism with email confirmation required. This is the entire creation step — no Forge-owned write occurs.
2. **Verification.** The Owner clicks the confirmation link Supabase sent. Supabase itself marks `email_confirmed_at` and, per `ADR-001`, this transition is what makes an authenticated session meaningful for the first time. No Forge code participates in this step.
3. **Expiration.** An unconfirmed identity that has not verified within **30 days** of creation is eligible for cleanup. Thirty days is chosen deliberately: comfortably longer than any single confirmation link's own expiry (so a slow-to-check-email Owner who eventually requests a fresh link is never punished for the first one lapsing), short enough that abandoned attempts do not accumulate indefinitely and do not permanently squat an email address a real person might later want to use again.
4. **Deletion.** A scheduled, service-role-only job removes unconfirmed identities past the expiration threshold, via the Auth Admin API. This is routine cleanup, not an error-recovery path — nothing of consequence is ever lost, because nothing of consequence was ever created.
5. **Recovery.** If a confirmation link expires before use, recovery is Supabase's own native resend-confirmation mechanism. Forge builds no separate recovery path, because there is no Forge-owned state to recover — the Pending Owner record (the unconfirmed `auth.users` row) is untouched by a lapsed link and remains valid to resend against, right up until step 3's threshold.
6. **Idempotency & retry.** A second sign-up attempt with the same, still-pending email is handled entirely by Supabase's own native behavior (a fresh confirmation email is issued rather than a duplicate identity being created or an opaque error being raised). Forge adds no idempotency logic of its own here — there is nothing to make idempotent beyond what the platform already guarantees.
7. **Abandonment.** The expected, common, non-exceptional outcome for some fraction of every funnel. It is resolved entirely by the expiration policy in step 3 and is never treated as a failure state anywhere in this contract.

## Minimum Data — Every Field Justified Against Removal

The mission's own test is applied literally: for every candidate field, *can Bootstrap still work without it?* If yes, it is removed.

| Field | Owned by | Justification |
|---|---|---|
| Email | Supabase Auth, not Forge | The one piece of information the entire Pending state exists to verify. Bootstrap cannot function without an identity to attach resources to. |
| Password (hashed) | Supabase Auth, not Forge | Required for the identity to authenticate at all; Forge never stores or reasons about it directly. |
| `email_confirmed_at` | Supabase Auth, not Forge | The single fact Bootstrap's entry condition checks. |

**Deliberately excluded, and why this is stricter than a casual reading of `ADR-001` might suggest:** the ADR's own illustrative language described Pending Owner as holding "the form fields the Owner already typed," which could be read as including the chosen Gym name. Applying the removal test rigorously: Bootstrap *can* work without a carried-forward Gym name — it can simply ask for it at Bootstrap time instead, in the now-authenticated context where it will be immediately consumed. Since the answer to "can Bootstrap work without it" is yes, it is removed from Pending Owner entirely. The Gym name is collected fresh, post-verification, as the first input of the Bootstrap step itself (Part 2). This is not a resumability violation of Principle 3.14: typing a Gym name into a pre-identity, uncommitted form is a zero-cost, non-consequential action (Principle 3.4/3.13 already establish that this class of input is cheap to ask for again), and asking once, at the moment it is actually used, is simpler and safer than carrying it across an unbounded, possibly-abandoned interval.

**Conclusion: Pending Owner, as a Forge-owned concept, contains zero fields.** It is fully and completely represented by Supabase's own native unconfirmed-user state.

## Forbidden Data — Explicit, and Why

Pending Owner must **never** contain, reference, or cause the creation of:

- **A Gym row, in any form, including a "draft" or `is_pending` placeholder.** This is named explicitly because it is the most likely shortcut a future engineer under time pressure might reach for ("just add a status column instead of truly deferring creation"). It is forbidden without exception: `ADR-001` Invariant 1 requires that no Gym exist before verification, and a placeholder row with a status flag is still a Gym row — it still claims the name-uniqueness namespace, still appears in every naive `select * from gyms`, still requires every future consumer to remember a filter that a true absence would never have required.
- **A Trial / Commercial Lifecycle record.** A Trial clock is a business commitment (`OWNER_ACTIVATION_ARCHITECTURE.md` Section 13 already ties its start to verification specifically) — starting it earlier is the exact error `ADR-001` was written to foreclose.
- **An Activation Lifecycle record.** Same reasoning — it is a business resource, not an identity fact.
- **Any Billing or Platform Subscription reference.** Forbidden on both `ADR-001` grounds and `OWNER_ACTIVATION_ARCHITECTURE.md` Principle 3.7 grounds (SaaS Billing must never be reachable from anything resembling an unqualified identity).
- **An Admin relationship, or any permission grant.** Authorization must never be extended to an identity Forge has not yet chosen to trust with anything.
- **Any Audit Log entry.** An audit trail records what a real actor did with real authority. An unverified sign-up attempt is not yet an actor with authority to record.
- **Membership data of any kind.** Pending Owner has no relationship to the Member Domain whatsoever, in either direction.
- **The chosen Gym name, or any other business-adjacent input**, per the Minimum Data section above — not merely unused, but never written anywhere Forge owns.

---

# Part 2 — Atomic Bootstrap

## Definition

**Bootstrap begins** at the exact moment a verified Owner (an identity whose `email_confirmed_at` is set) has an authenticated session and invokes the Bootstrap operation. **Bootstrap ends** only when every required business resource exists successfully — never in a partially-completed state, and never silently.

## The Canonical Mechanism: One RPC, One Transaction

`M10_1_IMPLEMENTATION_STRATEGY.md` correctly identified that the *original* production bootstrap sequence could not be a single database transaction, because a Gym could not exist before `auth.uid()` existed, which in turn could not exist before an active session did. **That constraint is exactly the one `ADR-001` removes.** Because Bootstrap now never begins until a real, authenticated, verified session already exists, the chicken-and-egg problem that forced a multi-step, client-orchestrated sequence in M10.1 no longer applies.

**This contract therefore mandates that Bootstrap be implemented as a single `SECURITY DEFINER` RPC, executing as one Postgres transaction** — the same pattern already proven by `handle_new_user()` and the `m9_final_commit_*` functions, applied here in its fullest, literal form. This is a real, binding correction to M10.1's shape, not a stylistic preference: a genuine database transaction gives Bootstrap true atomicity (all-or-nothing, enforced by Postgres itself) rather than the application-level idempotency M10.1 had to construct by hand because true atomicity wasn't available to it yet.

## Resources Created, and Order

Inside the single transaction, in the order their foreign-key dependencies require:

1. **`gyms`** — the new Gym row, keyed by an id the RPC generates internally (never accepted as a client-supplied parameter — see Security).
2. **`admins`** — the Owner's Admin relationship to that Gym.
3. **`gym_activation_state`** and **`gym_commercial_state`** — order-independent relative to each other, both dependent only on step 2's `admins` row existing (for `owner_admin_id`) and step 1's `gyms` row existing. `gym_commercial_state` is created with `commercial_state = 'trial_running'`, `trial_started_at = now()`, `trial_ends_at = now() + 14 days` — set directly, in this same transaction, never deferred to a separate trigger, because by construction Bootstrap never runs before verification, so there is no longer an "unverified" intermediate activation state to pass through (unlike M10.1's shape, which had to accommodate a Gym existing before verification).
4. **`profiles.gym_id`** claim — the existing, unchanged `null → value` transition already enforced by `prevent_gym_id_change()`.
5. **Audit trail entry** — written last, inside the same transaction, recording Gym creation and Owner identity resolution (`OWNER_DOMAIN_IMPLEMENTATION_ARCHITECTURE.md` Section 13's "must always be audited" list).

**Which operations are atomic:** all of them, together — that is the entire point of one transaction. There is no sub-step this contract permits to commit independently of the others.

**Which operations may be retried:** the Bootstrap call as a whole, from outside — never a sub-step from inside. A retry is simply invoking the same RPC again.

**Which operations must never be retried in isolation:** none exist, because none of the five steps above is ever reachable as an independent operation in the first place — they are statements inside one function body, not separately callable units.

## Idempotency, Precisely

The RPC's first action, before any insert, is to check whether the calling identity already has an `admins` row. If one exists, the RPC returns that identity's existing Gym rather than attempting any insert — a repeated call (double-click, browser refresh, a client retrying after a lost response) is therefore always safe, and always returns the same result. This is the sole idempotency mechanism this contract requires at the application level; a second, independent backstop exists at the database level regardless (see Self-Review, Race Conditions).

## Gym Name Collision

Because the Gym name is collected fresh at Bootstrap time (Part 1) and `gyms.name` is globally unique, a genuine, expected failure mode exists: two verified Owners choosing the identical name. This is not an error condition to hide — the RPC catches the resulting unique-constraint violation and returns a specific, distinguishable outcome (name already taken) rather than a generic failure, so the client can prompt for a different name. This is a real business outcome, not a bug.

---

# Failure Handling

| Scenario | Behavior |
|---|---|
| **Power failure / server restart mid-transaction** | Impossible to observe as a partial state — Postgres's own transaction durability guarantees the transaction is either fully committed or fully rolled back before any crash becomes externally visible. This is the direct, primary benefit of true atomicity over M10.1's multi-step shape. |
| **Browser refresh / double-click** | Safe. The RPC's own idempotency check (above) returns the existing Gym rather than erroring or duplicating. |
| **Expired verification link** | Bootstrap is never reached — no session exists. Resolved entirely by Supabase's native resend mechanism, upstream of this contract's scope. |
| **Session timeout during Bootstrap** | A JWT is validated once, at the moment the RPC is invoked. Once the transaction is executing inside Postgres, it runs to completion or rollback purely on database grounds — it is not interrupted by a client-side token expiring mid-flight. If the *call itself* is rejected for lacking a valid session, the client simply retries once a valid session exists (standard SDK-managed refresh); no partial resource is ever at risk, because none was ever created. |
| **Network interruption after the transaction commits, before the client sees the response** | The one genuinely ambiguous case atomicity alone does not resolve — the transaction may have already succeeded on the server with the client unaware. Resolved by the same idempotency check: the client's natural retry detects the already-created Gym and returns it, rather than erroring or duplicating. This is precisely why idempotency-at-the-call-boundary is mandatory, not optional, even with true transactional atomicity underneath it. |
| **Duplicate protection generally** | Two independent, layered mechanisms: the RPC's own existence-check (application layer), and `admins.id`'s primary-key constraint (database layer, the ultimate backstop if the first layer were ever bypassed or buggy) — the same layered-defense pattern this project's Financial Domain webhook already established for its own duplicate-delivery problem, reused here rather than reinvented. |
| **Partial transaction** | By definition impossible — this is the entire architectural point of moving to one real transaction rather than a client-orchestrated sequence. |

---

# Invariants

Each restated from the mission's own list, with its justification made explicit — permanent, binding on every future implementation:

1. **Pending Owner never owns business resources.** Directly restates `ADR-001` Invariant 1; this is the entire reason this ADR and this contract exist.
2. **Bootstrap never starts without a verified identity.** Enforced twice: the RPC requires an authenticated caller (standard session/JWT context) and independently re-checks `email_confirmed_at` itself rather than trusting that the caller could only have reached it properly — defense in depth against any future change elsewhere in the auth flow that might otherwise let an unverified session slip through.
3. **Bootstrap never executes twice for the same identity.** Enforced by the idempotency check plus the primary-key backstop (Failure Handling, above) — two independent layers, not one.
4. **Gym, Admin, Commercial Lifecycle, and Activation Lifecycle creation are impossible outside Bootstrap.** Enforced structurally, not by convention: no `INSERT` RLS policy exists on any of these tables for any client role, at any privilege level. The only writer is the Bootstrap RPC itself, running as `SECURITY DEFINER`. This is a real, required tightening relative to M10.1's shipped schema, which granted authenticated clients a direct (ownership-gated) insert path — that path is superseded and must be removed, because the RPC needs no client-facing grant to do its own privileged writes.
5. **Business resources are either ALL created or NONE created.** The direct, literal consequence of true transactionality — not an aspiration, a guarantee Postgres itself enforces.

---

# Security

**Trust boundaries.** Two, matching `ADR-001` exactly: the *identity boundary* (anyone may attempt to create a Pending Owner; cheap, revocable, rate-limited by Supabase's own signup rate limiting) and the *business boundary* (only a verified, authenticated identity may cross into Bootstrap). Nothing in this contract introduces a third.

**Service Role responsibilities.** The Bootstrap RPC is the sole writer of `gyms`, `admins`, `gym_activation_state`, `gym_commercial_state`, and the associated audit entry, for this flow, running with definer privileges — the same established pattern as `handle_new_user()` and the `m9_final_commit_*` functions.

**Client responsibilities.** Call Supabase's native sign-up to create a Pending Owner; call the Bootstrap RPC after landing back with a confirmed session. The client is never expected — and, per Invariant 4, is structurally unable — to write directly to any business-resource table.

**RLS responsibilities.** `SELECT` policies on `gym_activation_state`/`gym_commercial_state` (any Admin of the gym) are unchanged from M10.1. `INSERT` policies on `gyms`, `admins`, `gym_activation_state`, and `gym_commercial_state` for the `authenticated` role are **removed** — a named, required schema change relative to what M10.1 shipped, per Invariant 4.

**Replay protection.** The email confirmation link itself is single-use, enforced natively by Supabase — Forge builds no separate mechanism for it. The Bootstrap RPC call is not a replayable token-based operation at all (unlike M9's HMAC-hashed invitation tokens) — it is a standard authenticated session call, protected by ordinary JWT/session security, and its safety under repetition comes from idempotency (above), not from single-use-token semantics. These are two different mechanisms solving two different problems; this contract does not conflate them.

**Cross-tenant protection.** The Bootstrap RPC accepts no `gym_id` or any other resource identifier from the client — it generates its own internally and only ever creates resources scoped to the calling identity's own new Gym. This mirrors `m9_final_commit_new_prospect`'s own discipline of never trusting a caller-supplied identifier for anything consequential.

---

# Observability

**Audit events.** One entry per successful Bootstrap, written inside the same transaction (Part 2, step 5) — Gym creation and Owner identity resolution, per `OWNER_DOMAIN_IMPLEMENTATION_ARCHITECTURE.md` Section 13's existing "must always be audited" list.

**Domain events — a required refinement of the existing Event Model.** `OWNER_DOMAIN_IMPLEMENTATION_ARCHITECTURE.md` Section 9 defined a single `OwnerSignedUp` event at what was then one undifferentiated signup step. Under this contract, signup and Bootstrap are two genuinely separate moments, and the event model must reflect that split explicitly:
- `PendingOwnerCreated` — fires at Supabase sign-up (Pending Owner creation). Carries only an email. Consumed by funnel/conversion analytics.
- `OwnerBootstrapped` — fires at successful Bootstrap completion (supersedes the old `OwnerSignedUp` naming, since "signed up" no longer coincides with "has a Gym"). Carries `gym_id`, `owner_admin_id`.

**Metrics.** Bootstrap success rate; failure rate, broken down by reason (name-collision — expected and non-systemic — versus unexpected error, which is not); idempotent-retry rate (calls that resolved to an already-existing Gym rather than a fresh creation); Bootstrap transaction duration (expected to be low and stable, given a single-transaction design with no external calls); Pending-Owner-to-Bootstrap conversion rate (the direct, measurable expression of `ADR-001`'s own "qualification, not merely security" claim — this is the number that will eventually let `OWNER_ACTIVATION_ARCHITECTURE.md` Principle 3.17's provisional metrics be validated against real data); abandoned-Pending-Owner count (consumed by the expiration cleanup job, Part 1).

**Logs.** A structured log entry per Bootstrap attempt, success or failure, naming the exact step reached — reusing `invitation-final-commit`'s own established `step` variable pattern for pinpointing failure location, not inventing a new logging convention.

**Monitoring.** Alert on Bootstrap failure rate crossing a threshold — deliberately excluding name-collision outcomes from that threshold, since they are an expected, healthy, non-systemic result and must not be conflated with a real regression (an RLS misconfiguration, a broken FK) in the same alert.

---

# Self-Review — Attempting to Destroy This Contract

**Hidden state, checked:** none found. Pending Owner carries zero Forge-owned fields (Part 1's stricter conclusion); there is no metadata payload, no shadow table, nothing for a future engineer to accidentally treat as authoritative.

**Ghost resources / half-created Gyms, checked:** eliminated by true transactionality (Failure Handling, "partial transaction" row) — not mitigated, structurally impossible.

**Duplicate Gyms or Trials, checked:** prevented by two independent, layered mechanisms (application-level idempotency check, database-level primary-key constraint) — the same layered-defense discipline already proven correct elsewhere in this codebase, deliberately reused rather than trusting either layer alone.

**Race conditions, found and resolved:** two verified Owners' Bootstrap calls, for the *same* already-partially-processed identity (a genuine double-click racing itself), could in principle both pass the idempotency check before either has committed (a classic time-of-check-to-time-of-use gap). This is resolved by the database-level backstop, not the application check alone: the loser of the race hits the `admins.id` primary-key violation at commit time, and the RPC must catch that specific exception and treat it as a successful idempotent outcome (return the winner's Gym), never surface it as a raw error to the client. This is named here explicitly as a required implementation behavior, not an incidental detail — an RPC that lets this exception propagate unhandled would violate Invariant 3 under exactly this race.

**A second race, found and resolved the same way:** two *different*, unrelated Owners racing to Bootstrap the identical Gym name. Resolved identically — the loser hits `gyms.name`'s unique-constraint violation, which the RPC must map to the distinguishable "name already taken" outcome (Part 2's Gym Name Collision section), never a generic failure.

**Replay attacks, checked:** addressed under Security — the two relevant mechanisms (single-use confirmation link; idempotent, non-token-based Bootstrap call) are correctly distinguished, not conflated.

**Session races, checked:** addressed under Failure Handling — a JWT's validity is resolved once, at call time; the transaction's own fate is a purely database-side concern afterward.

**Broken retries, checked:** the failure mode M10.1 itself demonstrated (a naive retry re-attempting an already-succeeded step and hitting a primary-key violation with no recovery path) cannot recur under this contract — there is no longer a "partially succeeded, retry from where it left off" state to reason about at all, since the entire operation is one transaction with one all-or-nothing outcome.

**Violation of `ADR-001`, checked:** no business resource is created before verification anywhere in this contract; the Invariants section is a direct, traceable restatement of the ADR's own.

**Violation of Member Domain, checked:** Bootstrap never reads or writes `members`, `memberships`, or any table that domain owns.

**Violation of Financial Domain, checked:** Bootstrap never reads or writes `orders`, `payments`, or any table that domain owns.

**Anything requiring future redesign, checked and named rather than hidden:** if Forge ever wants to collect substantially more than a single Gym name at Bootstrap time, cramming an ever-growing set of inputs into one RPC call could eventually become unwieldy. This is not treated as a flaw to pre-solve here — Principle 3.4's own minimal-required-fields discipline (Part 1) is exactly what keeps this from becoming a real problem under any currently-anticipated requirement, and if it ever does, that is new, future, separate ADR-worthy scope, not a defect in this one.

---

# Final Architect Review — The Five-Year Test

Asked directly: *if Forge had 100,000 Gyms, millions of Members, multiple regions, multiple payment providers, and enterprise customers, would Pending Owner and Bootstrap still be built exactly this way?*

**Yes, and more clearly correct at that scale than at today's.** Fewer moving parts (no Pending Owner table to shard, index, or clean up beyond what Supabase already manages), atomicity that scales natively with Postgres rather than requiring any distributed-transaction machinery, and layered idempotency that costs nothing extra under high concurrency. The one honest, named boundary this review surfaces: true single-transaction atomicity assumes a single Postgres primary for the write. A future multi-region *write* topology (not merely multi-region *read* replicas, which do not affect this) would need to reconsider this specific mechanism — named here explicitly, as a real future condition, not hidden as a silent assumption. It is not a reason to reject this design today; it is a reason a future ADR, if that condition ever becomes real, has a precise, correct starting point to reopen.

No condition tested here required rejecting or altering this contract.

---

**READY TO IMPLEMENT M10.1**
