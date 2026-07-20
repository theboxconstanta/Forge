# DECISIONS.md — Forge

> Important product and architecture decisions, with the reasoning behind them. Read this before proposing to change something that looks frozen or "obviously" improvable — the reasoning here is usually the answer to "why didn't they just...".
>
> Last updated: 2026-07-20.

---

## Multi-tenancy: one gym per account, manual activation (2026-07-14)

**Decision**: one gym per account (not multi-gym-per-login), modeled after BeyondTheWhiteboard. Owner signup requires a registration code the platform admin issues manually after an offline payment conversation. Gym activation/deactivation (the entire payment-enforcement mechanism) is a manual toggle in a Platform Admin tab — no billing integration.

**Why**: converting to multi-tenant was already a large architectural change (19 tables, 64 RLS policies); adding real payments/Stripe at the same time would have stacked two major risks at once. Payments were explicitly scoped out until a self-serve signup flow is separately justified.

**Revisit when**: the manual activation workflow becomes a real bottleneck (more than a handful of gyms), or self-serve signup becomes a business priority.

---

## Workout Engine V2: dual-write, not a hard cutover (2026-07-16)

**Decision**: `workout_sections`/`workouts` (V2) are kept in sync with the legacy `wods` table via dual-write, rather than cutting reads over everywhere at once. Journal, Leaderboard, and log-editing still read through `wods`; only Member View and Logging were migrated to read V2 natively.

**Why**: each read-path migration was its own phase with its own live-validation pass; cutting everything over simultaneously would have made it much harder to isolate what broke if something did. The remaining `wods`-reading surfaces are a known, explicit scope boundary, not an oversight.

**Revisit when**: a new phase is explicitly requested to migrate Journal/Leaderboard/log-editing to V2 natively (see `/docs/ROADMAP.md`).

---

## Workout Composer: never infer structure from unstructured text (2026-07-17, reaffirmed 2026-07-18)

**Decision**: the Composer only reads structured fields (`family`, `scoreMode`, `rowMode`, config field presence/type). It never parses prose to reconstruct missing structure (e.g. it will not try to extract "21-15-9" out of a movement's free-text notes if `sharedRepScheme` wasn't populated).

**Why**: this is the same "never invent" discipline established during Workout Intelligence — a heuristic that guesses right most of the time but occasionally guesses wrong on real user data is worse than an honest gap that's visibly a data-authoring problem. Verified directly: a legacy WOD authored before `sharedRepScheme` existed renders its raw, un-ideal text until someone re-enters it through the Admin form — confirmed as the *correct*, intended behavior, not a bug, via a live before/after test (re-entering the same WOD's fields produced the exact desired output with zero code changes).

**Standing rule (2026-07-17)**: going forward, only *recurring, evidence-based* feedback from real Admin usage justifies changing the Composer. A single one-off observation ("this looks slightly off") gets logged as product feedback, not acted on immediately. The architecture is considered validated; iteration from here is product polish, not architecture work.

---

## Workout Composer: presentation logic must be semantic-driven, never format-identity-driven (2026-07-18)

**Decision**: after closing the Composer as an architecture initiative, an explicit audit found 3 remaining places where output phrasing was decided by checking a literal format name (`formatId === 'RFT'`, etc.) rather than a semantic field. All 3 were removed — each turned out expressible using fields the catalog already had, with **zero new catalog metadata**.

**Why this matters going forward**: it proves the "add a new format, touch only the Workout Engine catalog, never the Composer or React" claim is actually true today, not aspirational. Before adding a new format-name check to `workoutComposer.js` in the future, actively look for an existing semantic field/tag that already expresses the distinction — the pattern established here (check `rounds`/`baseFormat`/`totalRounds`/`hasEscalatingScheme()` field presence, not names) is the bar to clear.

---

## Segment domain model: specified, then postponed (2026-07-17)

**Decision**: a fuller compositional replacement for the enumerative Workout Format Catalog (`Workout → WorkoutSection → Segment tree → Movements`) was fully designed (`SEGMENT_MODEL_SPEC_v1.md`) after two real Workout Intelligence parser gaps (Chained AMRAP, Buy-In/Cash-Out) suggested the enum model might be hitting its limits. After an explicit cost/benefit review, the decision was to **postpone**, not build.

**Why**: neither motivating bug was actually a Workout Engine V2/format-catalog limitation — both had cheap point-fixes inside the current architecture (now shipped). No concrete planned feature was found to be blocked without it. The estimated migration cost (schema + AI schema + editor + renderer + logger rewrite, plus a genuinely unresolved logging-model question) was comparable to or larger than the entire 8-phase Workout Engine V2 migration that had just closed.

**Revisit when** (any one of):
- 3+ genuinely new formats are needed in a short window (not one-off).
- A concrete feature is actually blocked by the enum model (not just inconvenienced).
- `FORMAT_CONFIG_TRANSLATORS`/`FormatConfigEditor.jsx` visibly becomes a maintenance bottleneck.
- Workout Engine V2 has run stable in production for a meaningful stretch, freeing up appetite for another foundational change.

`SEGMENT_MODEL_SPEC_v1.md` stays in the repo root as a frozen, dated reference — do not treat its absence from `/docs` as it being abandoned.

---

## Workout Intelligence: AI assists, never replaces or auto-publishes (2026-07-16)

**Decision** (principle #0, the north star every other Workout Intelligence decision serves): **"Workout Intelligence exists to make coaches better, not to replace them."** Concretely: AI never auto-publishes a workout; AI never silently overwrites a human edit once made; uncertainty is always shown, never hidden behind a confident-looking guess; the manual editor path never becomes second-class; no permanent "AI-assisted" mark survives on a published workout; member-facing automated scaling/coaching is a distinct, separately-approved future capability, not an assumed roadmap item.

**Why**: this is a trust-and-liability-sensitive feature (a wrong AI guess on a workout's structure reaches real athletes' training) — the product bet is that coach confidence in the tool depends on it never taking silent, unreviewable action.

**Also decided**: re-analysis policy (what happens when a coach re-clicks "Analizează" over an already-edited draft) is currently a **placeholder** ("always overwrite"), explicitly not a decided policy — see `/docs/ROADMAP.md` (WI-2).

---

## Demo environment for external review: full isolation over shared-DB reuse (2026-07-18)

**Decision**: when asked to prepare a public demo environment for an external AI product review (ChatGPT), the demo was built on a **new, fully isolated Supabase project** rather than reusing the existing (shared local/prod) database with seeded fake data.

**Why**: local dev and production already share one live database — seeding realistic fake members/subscriptions/payments into it would have polluted real CrossFit C15 data visible to real staff/members, and handing an Owner/Admin login connected to that data to an external third-party service is a real security/privacy exposure. Explicitly the user's own call after being presented the trade-off, not assumed unilaterally.

**Also decided during the same task**: a raw `pg_dump`/`psql` workaround (to get a schema-only copy without installing Docker Desktop) was declined even though it was technically feasible, because an automated safety check flagged the specific combination (touching the production connection right after, in service of a public-facing demo) as risky — the official, Docker-Desktop-dependent path was chosen instead. General principle worth keeping: when a safety check flags a workaround as risky in a context involving real user data and external/public exposure, stop and ask rather than find a different technical path around it.

---

## Financial Domain: Order/Payment/Refund replace notes-based revenue tracking (2026-07-20)

**Decision**: revenue is no longer reconstructed by regex-parsing `subscriptions.notes` (e.g. `"Plătit: 379 RON"`). A structured `orders`/`payments` model was introduced — every Subscription has exactly one Order (its commercial terms, price server-derived from `subscription_plans.price`, never client-supplied); Payments are append-only records of money movement (`direction` charge/refund, `status`), always attached to an Order, never to a Subscription directly. All writes go through SECURITY DEFINER RPCs; direct client writes to `orders`/`payments` are blocked at both the RLS and grant layer.

**Why**: the same category of error as encoding workout structure into free text and parsing it back out (see Workout Composer decisions, above) — structured facts must be stored as structured facts. The regex approach could not represent multiple payments, partial payments, refunds, or non-subscription revenue without a second redesign.

**Full reasoning, adversarial review, and the complete ADR set (ADR-001 through ADR-013)**: `docs/2026-07-20_Financial_Domain_Architecture_Working_Session.md` — frozen, do not edit; append future amendments the same way its own §9/§10 do.

**Revisit when**: a real production defect is found, or a new business requirement (a second purchasable domain, multi-item checkout, a real payment-provider integration) passes a fresh architecture review. ADR-009 already names the specific extension points for each of these — do not design them speculatively ahead of need.

---

## Financial Domain: self-service Order creation widened, Payment registration never is (2026-07-20)

**Decision**: `create_order_for_subscription`'s authorization was widened from admin-only to admin-OR-the-subscription's-own-owner, so a member self-activating their own queued subscription produces an Order like every other path. `register_payment` was explicitly left admin-only and will not be widened without a fresh architecture review.

**Why the asymmetry**: `create_order_for_subscription`'s amount is always server-derived from `subscription_plans.price` — no money-movement claim is involved, just a bookkeeping record of the subscription's own already-fixed price. `register_payment`'s amount is a caller-attested claim that real money changed hands — self-service access there would let a member declare their own subscription paid without an admin ever seeing real money, a fraud vector, not a narrow risk. The invariant actually being protected is "every Subscription has an Order" (explicit in the original architecture review); a Subscription without a Payment (`status='pending'`) was already an explicitly sanctioned state, so leaving `register_payment` untouched closes the real gap without taking on the payment-attestation risk.

**Revisit when**: a legitimate need for member-initiated payment registration is identified — treat as a new architecture review, not an incremental widening.

---

## Financial Domain: Payment.method completes an existing design, does not introduce a new one (2026-07-20)

**Decision**: `payments.method` (present since the original schema, never constrained, never populated by any code path) gained a closed CHECK-constrained vocabulary: `cash`, `card`, `bank_transfer`, `comp` — explicitly no `'other'` escape hatch. `provider`/`provider_reference` (also present since the original schema, with a `UNIQUE` idempotency guard already in place for future webhook delivery) remain reserved and unpopulated.

**Why**: an architecture review found the schema already contained the abstraction needed (`method`/`provider`/`provider_reference`, `provider`/`provider_reference` explicitly named as a future extension point in ADR-009) — the review's conclusion was to complete the existing design rather than propose a new one. `'comp'` stays valid at the database level (an existing internal business rule in `register_payment` depends on it) but is deliberately excluded from the admin-facing picker — it's an internal concept, not a public payment channel. Apple Pay/Google Pay are modeled as `method='card'` with a `provider`, not as distinct channels, since from the gym's perspective both settle as card money.

**Why no `'other'`**: an unrecognized future payment channel should require a deliberate architecture-review decision to add to the vocabulary, not a silent catch-all that quietly accumulates unclassified data.

**Revisit when**: a real payment-provider integration is proposed (this is what activates `provider`/`provider_reference`), or a genuinely new payment channel needs to be added.

---

## Online Payments (Stripe): commercial intent exists before payment, not after webhook confirmation (2026-07-20)

**Decision**: for the Stripe Checkout initiative, the Order (and its Subscription) is created when the member starts checkout, not deferred until the webhook confirms payment. The webhook's job is to confirm an already-existing Order, not to originate one.

**Why**: the alternative ("deferred/atomic-on-webhook" — create nothing until the webhook fires) was the initial recommendation, proposed specifically because it would have structurally closed a security gap in `activate_queued_subscription`'s self-service path. That recommendation was explicitly rejected: closing the gap by removing the Order lifecycle was the wrong trade — the fix belongs in activation rules (see the paid-Order guard decision below), not in avoiding commercial-intent records existing before money moves. A member starting checkout is a real, meaningful business event worth recording even if payment never completes.

**Consequence**: `create_subscription`'s self-service path (Phase 5a) creates a queued Subscription + pending Order immediately, before any Stripe interaction. `queued=true` now carries two related-but-distinct real-world meanings — an admin-scheduled future renewal, or a member's Stripe-pending purchase intent — disambiguated for free by whether the subscription has an Order (self-service always creates one immediately; admin-scheduled queuing does not), with no schema change needed.

**Revisit when**: Phase 5b–5f (Checkout Session creation, webhook receiver) surface a concrete reason this ordering doesn't hold up in practice.

---

## Online Payments (Stripe), Phase 5a: activate_queued_subscription gains a paid-Order activation guard (2026-07-20)

**Decision**: any non-admin caller (the subscription's own owner, or `service_role`) is blocked from activating a queued subscription whose Order exists and is not `status = 'paid'`. Admin retains an unconditional override. Subscriptions with no Order at all (the pre-existing admin-scheduled-renewal path) are completely unaffected — the guard only evaluates when there's an Order to check.

**Why**: this is the actual fix for the security gap the rejected deferred-webhook model would have closed structurally instead. Without it, a member could call `activate_queued_subscription` directly on their own Stripe-pending subscription and self-activate before ever paying — the RPC had no concept of "payment must precede activation." Applying the guard to `service_role` too (not just the member path) is deliberate defense-in-depth: even if a future webhook handler ever called activation before registering payment by mistake, the database rejects the premature activation rather than trusting the caller's own sequencing.

**Consequence**: `register_payment` must bring an Order to `status='paid'` before `activate_queued_subscription` can succeed for any non-admin caller — the two RPCs are now sequence-dependent for self-service/webhook activation, by design.

**Revisit when**: a legitimate need for activation-before-full-payment is identified (e.g. a deposit/partial-payment product policy) — treat as a new architecture review, the guard is intentionally binary (`paid` or not) today.

---

## Pre-existing defect found during Phase 5a validation: subscriptions_restrict_member_update() blocked service_role entirely (2026-07-20)

**Not a new Stripe feature** — a gap in an unrelated, pre-existing trigger (part of the waitlist auto-booking system, added 2026-07-01/07-04) that Phase 5a's mandated validation happened to surface, because it was the first work to ever attempt a `service_role`-authorized write to `subscriptions`.

**The defect**: `subscriptions_restrict_member_update()`'s bypass condition (`is_coach_or_admin()` OR the row's `member_email` matches `auth.jwt() ->> 'email'`) has no case that is ever true for `service_role` — `auth.uid()` is null under that role (so `is_coach_or_admin()` is false), and a real Supabase service-role JWT carries no per-request `email` claim. Confirmed by isolated repro: a `service_role` no-op update (`SET is_active = is_active`) was rejected with the trigger's waitlist-specific error message. This would have silently broken the Stripe webhook's activation step in production — payment registered and Order marked `paid`, but the Subscription never actually activated — despite the Phase 5a RPC-level authorization being correct.

**Decision**: extend the trigger's existing bypass condition with one additional clause, `OR (auth.jwt() ->> 'role') = 'service_role'` — matching the same trust model already used consistently across the four Phase 5a RPCs (service_role is only ever reachable from the verified webhook context, never arbitrary user input).

**Why minimal, not a rewrite**: the trigger's actual purpose (preventing one authenticated member from tampering with another member's subscription via a direct table update, while still allowing the legitimate waitlist auto-book `sessions_used +1` path) is unrelated to Stripe and was left completely untouched. Re-verified explicitly post-fix: non-owner `sessions_used +1` still allowed, non-owner still blocked from any other column change or any other increment amount, row owner still fully unrestricted — zero behavior change for any caller class except the newly-added `service_role` path.

**Revisit when**: never, absent a new defect — this is a narrow, closed fix, not an open design question.
