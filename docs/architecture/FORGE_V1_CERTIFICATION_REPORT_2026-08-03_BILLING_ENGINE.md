# Forge V1 Certification Report

This audit reviews the complete Owner journey as one integrated system — signup through billing through cancellation and back — not milestone by milestone. Every finding below is grounded in what was actually built and actually verified across this project's history, not in what the frozen architecture documents describe as intended. Where the two diverge, the divergence itself is the finding.

---

# Executive Summary

Forge's Owner Domain is architecturally sound and, within the boundary of what has been built, unusually well-verified — the money-safety primitives (immutability, idempotency, tenant isolation, attestation-authority) are not aspirational, they are proven against real deployed code and real (if synthetic) data, repeatedly, across every milestone. That is the genuine strength this audit found.

But the audit's job is to find reasons not to ship, and four were found that are not stylistic — they are the difference between "Forge can present a bill" and "Forge can run a subscription business." **The payment-confirmation webhook is not connected to Stripe. There is no mechanism to ever collect a second payment from any Gym. A cancelled Gym never loses access. And the entire Owner-facing billing UI has never been operated by a human being.** Any one of these would be serious. Together, they mean the system as it exists today can *display* pricing, *initiate* a checkout, and *record* a subscription — but cannot yet reliably *complete* a real transaction, cannot *repeat* one, and cannot *enforce* the commercial terms it just recorded.

**Verdict: PRODUCTION BLOCKED.** Not because the architecture is wrong — because four specific, nameable gaps sit directly between "built" and "can be trusted with a paying customer's money."

---

# Product Overview

The audited journey: Anonymous Visitor → Pricing → Signup → Email Verification → Owner Bootstrap → Trial → Activation Dashboard → Invite Member/Admin → Waiver → Billing → Purchase → Stripe Checkout → Webhook → Subscription → Upgrade/Downgrade → Cancellation → Trial Expiry → Reactivation.

Two eras exist within this journey, worth naming because they carry different evidentiary weight in this audit. M10.1–M10.4 (Owner Authentication through the Pricing Catalog) predate this session and, per project history, have accumulated real usage and prior verification passes. M10.5–M10.8 (the entire commercial engine — purchase, billing management, trial enforcement) were built and verified entirely within this session, with a consistent, real discipline of live SQL-level verification against disposable synthetic data — but **zero** live browser sessions, because this session's own standing policy is that the assistant never logs in as a user. That asymmetry matters throughout this report: the newer, financially-critical half of the product is the half that has never been touched by a human hand.

---

# Architecture Audit

**Genuinely sound.** The two-axis lifecycle split (Activation vs. Commercial state) was deliberately built to prevent exactly the failure class it exists to prevent, and every access-blocking check added this session (`is_gym_access_blocked`) was verified, via direct inspection of the live function body, to reference Commercial State only. Platform Billing's schema is a clean, structural copy of the Financial Domain's own proven ledger shape (append-only Payments, derived Order status, refund-never-exceeds-charge) — reused as a pattern, never shared as a mechanism, exactly as Principle 3.2 requires. No cross-domain table, function, or webhook was ever found shared between Member billing and Platform billing.

**One real, load-bearing gap: no renewal mechanism exists anywhere in the codebase.** `platform_subscriptions.renews_at` is computed and stored at purchase/upgrade/downgrade time and displayed in the Billing UI — but nothing in the entire system ever reads it to trigger a second charge. Stripe Checkout Sessions are created with `mode: 'payment'` (a one-time charge), not `mode: 'subscription'`, a deliberate, reasoned choice made in M10.5 on the grounds that Forge's own scheduled commands should drive renewal rather than Stripe's native recurring engine — but the scheduled command that was supposed to drive it (M10.7, Past Due & Dunning) was never built. The result is not "renewal is deferred" — it is "there is no code path, anywhere, that can ever produce a second Payment for a Gym that already converted." This is an architecture gap with direct financial consequences, detailed further under Financial Audit.

**A second, smaller gap:** the M10.8 feature-flag mechanism (a repurposed row in `app_version`, a table whose name and existing purpose is "deployed app version") is a real, documented semantic wart. It works, and its one side effect (an unrelated service-worker update check firing on toggle) is harmless and already documented — but a future engineer grepping for "feature flags" will not find this without already knowing to look in `app_version`.

**Recurring pattern worth naming as a systemic issue, not a one-off:** across this session, a default-Postgres-privilege auto-grant (to `anon` or to the `PUBLIC` pseudo-role) on a newly-created table or function was found live, after the fact, on *four separate occasions* (M10.1, M10.3, M10.5, and again on M10.5's own `purchase_platform_plan`). Every one was caught only because of a disciplined manual "query `information_schema.role_table_grants`/`role_routine_grants` after every migration" habit — not because any automated check exists. That habit is not itself part of the shipped system. There is no CI-enforced test anywhere in this codebase that fails a build if a new table or function is reachable by `anon` or `PUBLIC` when it shouldn't be. At the scale of "every future migration, forever," relying on a human remembering to check by hand is a real, structural risk — the fourth occurrence of the identical bug class is evidence this is a process gap, not a string of unrelated mistakes.

---

# Product Audit

The Owner journey's product logic composes correctly at every seam that was checked: a trial-expired Owner who opens Billing sees the real purchase flow, not a dead end; an Owner who cancels and returns to Billing sees the real purchase flow again (no separate "reactivation" mechanism was needed, by construction); upgrade and downgrade are genuinely one mechanism wearing two labels, exactly as the frozen architecture specifies.

**The paywall's own promise is currently false.** `OWNER_LIFECYCLE_STATE_MACHINE.md` B4 and B7 both explicitly describe blocked product access as the defining behavior of an expired trial *and* of a cancelled subscription. Trial-expiry blocking exists and was exhaustively verified — but ships disabled by design pending a manual go/no-go, which is correct and expected. Cancellation blocking does not exist at all, in any milestone, disabled or otherwise. The product experience today, honestly stated: an Owner can cancel their Platform Subscription and the product will never notice.

**Email is absent from every billing-adjacent moment.** Purchase receipt, plan-change confirmation, cancellation confirmation, trial-expiry win-back — every one of these was named as required in the frozen plan for the milestone that shipped the underlying capability, and none were implemented. An Owner who pays, upgrades, downgrades, or cancels receives zero email acknowledgment of any of it. For a product about to take real money from real small-business owners, this is a trust gap as much as a feature gap: the first question a confused customer asks support is "did you get my payment," and today there is no automated answer.

---

# Security Audit

RLS and grant boundaries for everything built in this session were independently, live-verified — not once, but after every single migration, including re-verification after every corrective fix. The specific, non-negotiable rules this session was repeatedly told to protect were checked directly against deployed code, not trusted from the SQL source: `is_gym_access_blocked`'s function body contains zero references to `gym_activation_state`, confirmed via `pg_get_functiondef` against the live database, not code review. `register_platform_payment`/`refund_platform_payment` are unreachable by any authenticated client, confirmed by attempting the call as both a non-owner Admin and a plain authenticated user and observing denial both times. Cross-tenant reads were never found possible on any Platform Billing table.

**The one real gap:** audit-trail completeness. `OWNER_DOMAIN_IMPLEMENTATION_ARCHITECTURE.md` Section 13 requires Gym creation, every Admin Invitation event, and every Platform Subscription/Payment event to be audited "no exceptions." A direct grep across every migration and Edge Function in this repository, performed during this session's own verification work, found that Owner bootstrap (`owner_gym_bootstrapped`) and every Admin Invitation event never actually write an audit row, despite the `admin_audit_log` vocabulary having been extended to include them as far back as M10.1. Only Platform Billing's own events (fixed this session, in M10.5a) and the original M9 Member-add flow actually produce a real audit entry. For a security-relevant log whose entire purpose is reconstructing "who did what," roughly half of the events the frozen architecture requires it to contain are silently absent.

No privilege-escalation path was found. No SQL injection surface was found (every write goes through a parameterized SECURITY DEFINER function, no raw client-constructed queries exist anywhere in the Owner Domain). Secrets are correctly separated per environment/endpoint (Platform billing's webhook secret is distinct from Member billing's, by design and by verification).

---

# Financial Audit

This is where the certification actually turns. Individually, every financial-safety *primitive* Forge already relies on is real and proven: Orders and Payments are immutable at the grant level, not merely by convention. The three-layer duplicate-delivery defense was verified against the real, deployed webhook using a cryptographically valid, self-signed Stripe event — a genuine live test, not a simulation. A race condition that could have silently dropped a real charge (two pending Orders for one Gym both completing payment) was found through deliberate adversarial testing and fixed before it ever shipped. The one-active-subscription-per-Gym invariant held under every test thrown at it, including a direct reproduction of the exact race that could have broken it.

**But the ledger these primitives protect is not currently connected to real money, and even where it is, it can only ever be written to once per Gym.**

- **The webhook has no real counterpart in Stripe.** `PLATFORM_STRIPE_WEBHOOK_SECRET` is a value this session generated itself, set directly via the Supabase CLI, used only to sign a synthetic test event against the function's own signature-verification logic. No webhook endpoint was ever registered in a real Stripe account pointing at this function's URL. Until that manual step happens, a real Owner completing a real Stripe Checkout produces a real charge on Stripe's side and **nothing on Forge's side** — the Gym's Subscription stays `pending_payment` forever, silently.
- **`STRIPE_SECRET_KEY`'s live-versus-test status was never determined**, and this session deliberately never attempted a real Checkout Session creation call rather than risk finding out the wrong way. This means, as of today, nobody — including this audit — knows for certain what mode Forge's own Stripe integration is actually running in.
- **No mechanism exists to bill a Gym a second time.** This is stated under Architecture above; its financial consequence is direct: the commercial model this system was built to enforce is a *recurring* monthly subscription, and the system as shipped can produce, at most, one Payment per Gym for the entire lifetime of that Gym's relationship with Forge, ever. At 100 Gyms this is a bug. At 1,000 Gyms this is the entire difference between a subscription business and a one-time-fee business that happens to display a "renews on" date it will never honor.
- **A cancelled Gym keeps paying-tier access forever**, at zero further cost to them — the direct commercial mirror of the missing renewal mechanism, and arguably worse, since it is an *active*, already-reachable path (Cancel is a shipped, working button) rather than a passive gap waiting for a clock to run out.

None of these are subtle. Each one is the direct, load-bearing reason the corresponding milestone (M10.5's webhook wiring, M10.7, and B7's own access-blocking requirement) exists in the frozen plan at all — they are not edge cases the plan missed, they are capabilities the plan named and that were not yet built when this audit was requested.

---

# UX Audit

Every UI decision that was reviewable by code and by component test held up: the Buy button is never shown to an already-paying Owner; the cancel action requires an explicit second confirmation; the plan-change selector correctly renders nothing today (single-tier catalog) without presenting broken or dead controls; a non-Owner sees a paywall message they can actually act on ("contact your gym owner") rather than a purchase button they cannot.

**None of this has been seen rendered by a human.** Every Billing-adjacent screen built this session — the Buy CTA, the Stripe Checkout redirect, the pending-payment polling modal, the plan-change confirmation flow, the cancel-confirmation flow, and the trial-expired hard paywall — has been verified exclusively through component-level tests with mocked data and through direct code review. Not one of them has been clicked by a person in a real browser against the real, deployed Edge Functions. Component tests prove the React logic branches correctly given the inputs they're handed; they do not prove a real click on a real button in a real browser actually reaches the real Edge Function and produces the real redirect. For a payment flow specifically, this is the single largest gap between "verified" and "actually works," and it is the one gap in this entire audit that costs nothing but time to close before launch.

---

# Operational Audit

**Observability is thin exactly where it matters most.** Sentry captures frontend `console.error` calls. Nothing alerts anyone — automatically — if the (currently disconnected) webhook starts failing signature verification, if a Subscription has sat in `pending_payment` for an hour past what any real Checkout Session's expiry should allow, or if the `advance_trial_state` cron job stops running. Today, the only way any of these would be discovered is a customer complaint.

**No support tooling exists.** `OWNER_DOMAIN_IMPLEMENTATION_ARCHITECTURE.md` Section 11.4 names this explicitly as a deferred, not-yet-designed gap: a Forge-internal support identity that can read (never silently write) across Gyms for troubleshooting. At low Gym counts this is survivable via direct database access. At hundreds of Gyms it is not — "an Owner emails asking why their payment didn't go through" currently has no answer that doesn't involve a raw SQL query run by an engineer.

**The kill switches work as designed.** M10.8's feature flag was verified, live, to restore access instantly with no redeploy. This is a genuine operational strength worth stating plainly, not just a checkbox — it is the one part of this system explicitly built for the "something is on fire" scenario, and it was proven to actually work under that scenario.

---

# Production Readiness

| Concern | Status |
|---|---|
| Financial-safety primitives (immutability, idempotency, tenant isolation) | **Verified**, live, repeatedly |
| Payment confirmation actually reaching Forge from a real Stripe account | **Not connected** |
| Recurring billing | **Does not exist** |
| Cancellation enforcement | **Does not exist** |
| Trial-expiry enforcement | Built and verified; deliberately disabled pending go/no-go |
| Billing UI, human-operated | **Never tested** |
| Audit trail completeness | **Partial** — Owner bootstrap and Admin Invitation events silently missing |
| Transactional email | **Absent** across every billing-adjacent action |
| Support/impersonation tooling | **Does not exist**, named as deferred |
| Monitoring/alerting on financial code paths | **Does not exist** |
| RLS/grant correctness | **Verified**, with a known recurring process gap (no automated check) |

---

# Material Risks

Findings that do not, individually, block certification but must be tracked and are directly relevant to correctness, reliability, or paying customers:

- **Audit trail is materially incomplete** for Owner bootstrap and every Admin Invitation event — a real security/compliance gap, not cosmetic.
- **No automated test prevents the recurring `PUBLIC`/`anon` default-grant class of bug** from shipping a fifth time — this has now happened four times, always caught by manual review, never by an automated gate.
- **No monitoring exists on any financially-critical code path** (webhook failures, stuck payments, cron health).
- **No support/impersonation tooling exists** — an operational gap that becomes acute, not theoretical, past a few dozen Gyms.
- **Genuine concurrency (true parallel connections) was never load-tested** — every race condition this session found and fixed was reproduced via sequential simulation under an explicit row lock, which is the correct way to prove the lock works, but is not the same as observing behavior under real concurrent load.
- **The feature-flag mechanism's reuse of `app_version` is a maintainability wart** — documented in its own migration, but discoverable only by someone who already knows to look there.

---

# Non-blocking Improvements

- Deno-runtime Edge Function tests cannot execute in this development environment; whether the real CI environment can run them was never confirmed either way.
- `App.jsx`'s continued growth (now well past 8,000 lines) is an already-acknowledged, already-deliberately-deferred maintainability concern, not new to this audit.
- The two parallel (Member-billing / Platform-billing) checkout-polling code paths are a deliberate, documented duplication accepted in exchange for zero regression risk to a live financial code path — a reasonable trade, worth revisiting only if the duplication itself ever causes a bug.

---

# Self-Review — Would This Certification Hold at Scale?

At 100 Gyms: the missing renewal mechanism and missing cancellation-enforcement are bugs a handful of customers would eventually notice, manually correctable by staff before serious damage.

At 500 Gyms: manual correction stops being viable. The revenue leak from "every cancelled Gym keeps full access forever" and "no Gym is ever billed twice" is no longer a curiosity — it is the majority of Forge's own expected revenue simply never arriving, silently, with no alert ever firing to say so.

At 1,000 Gyms: the same two gaps mean Forge's actual collected revenue asymptotically approaches "number of Gyms × one payment each," regardless of how long any of them stay subscribed. Combined with the disconnected webhook, a real, painful fraction of that one payment each may not even be collected correctly at signup time.

This scaling exercise does not surface new problems — it confirms the four blockers below are not edge cases this audit is being overly cautious about. They are the specific mechanisms standing between the architecture that was built and a business that actually collects the revenue that architecture was designed to protect.

---

# Final Certification

Four specific, material blockers stand between the current system and confidently onboarding a single paying Gym:

1. **The Platform Billing webhook is not connected to a real Stripe account.** A real Checkout completion cannot currently reach Forge's own records. Requires registering a real Stripe webhook endpoint and confirming the live signing secret, then a real, reconciled test-mode purchase end-to-end.
2. **No mechanism exists to bill a Gym more than once.** The recurring-subscription commercial model this system was built to run cannot currently produce a second Payment for any Gym, ever.
3. **A cancelled Platform Subscription never blocks product access.** The Cancel action is live and reachable; its own stated consequence — losing access — was never implemented.
4. **The entire Owner-facing billing UI has never been operated by a human in a real browser.** Every Billing screen built this session is verified only by mocked component tests and code review, never by a real click reaching a real, deployed Edge Function.

None of these require architectural redesign — every one of them is a specific, nameable, closeable gap sitting on top of an architecture and a set of financial-safety primitives that this audit found to be genuinely sound. That is the actual state of Forge V1: the foundation is trustworthy; four concrete pieces of the building on top of it are not yet in place.

PRODUCTION BLOCKED
