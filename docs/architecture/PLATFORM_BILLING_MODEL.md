# Platform Billing Model — Final Commercial Review, Pre-M10.4

This document freezes Forge's own commercial model — the policy governing how Forge prices, versions, and evolves what it charges Gyms — before M10.4 seeds the first real row into `platform_plans`/`platform_plan_versions`. It changes nothing about the Financial Domain, Orders, Payments, Subscriptions, or the Stripe integration boundary already specified in `OWNER_DOMAIN_IMPLEMENTATION_ARCHITECTURE.md` Section 5.2–5.4 and Section 7. Every recommendation below is expressible inside that already-frozen schema shape; none requires a table, column, or mechanism beyond what those documents already define, except where explicitly named as "M10.5's own concern" and deferred.

**Honesty note, carried from the M10 engineering discipline into this commercial one:** this document does not have access to independently verified, current competitor pricing figures — the market research referenced in project history was delivered as conversational output in an earlier session and was not preserved as a file this document can cite. Where competitor pricing would strengthen a recommendation, this is named as a gap, not papered over with invented numbers. Recommendations below are reasoned from the product's own architecture, positioning, and stated principles (`OWNER_ACTIVATION_ARCHITECTURE.md`), not from unverified market data.

---

# Executive Summary

Forge should launch with **one plan, monthly billing, priced in EUR, 14-day trial, no card required** — the proposal on the table is correct, and every element of it survives challenge. The one open item this document cannot close is the exact launch number itself; that is a real founder/market decision this document deliberately does not fabricate (see Launch Pricing Strategy). Structurally, the model that matters more than any single price is **insert-only Plan Versions** — a rule already frozen in `OWNER_DOMAIN_IMPLEMENTATION_ARCHITECTURE.md` Section 5.2, restated and made concrete here — combined with the fact that a Platform Subscription always carries its own agreed price (Section 5.3), never a live pointer to "whatever the Plan costs today." That single combination is what lets Forge change its price next year without touching a single historical row, without a migration script rewriting Orders, and without any customer's existing terms silently moving. Everything else in this document is detail in service of that one mechanism.

---

# Commercial Principles

Four rules, specific to this review, each answering one of the questions posed:

1. **A Plan Version is a fact about the past the moment it is first sold, not a live price tag.** Once any Platform Subscription references it, it is frozen forever — never edited, only superseded.
2. **A Subscription's price is what was agreed, not what the catalog currently says.** The catalog can move under a customer's feet with zero effect on them, because their own row already carries the number that matters.
3. **Retirement, never deletion, never mutation.** A Plan Version that stops being sold is marked not-accepting-new-subscriptions; it is never removed, and it never stops being a valid, resolvable reference for the historical Orders that point to it.
4. **Model for the market Forge has, not the one it might have.** Multi-currency, annual billing, add-ons, and enterprise pricing are all cheaply reachable later from this shape without a redesign — so none of them are built now. Building them now would be exactly the speculative work `M10_IMPLEMENTATION_PLAN.md`'s own M10.4 scope note already warns against.

---

# Launch Pricing Strategy

**Q1 — one plan or multiple.** One plan. Forge has zero market signal yet on how Gyms would actually segment against tiered feature sets, and guessing a tier structure before a single real customer exists risks anchoring the wrong segmentation permanently into early customers' expectations. A single plan is also the more honest reflection of where the product actually is: Forge does not yet have a feature-gated "Pro" surface to sell — building one to justify a second tier would be inventing product surface to justify a pricing decision, backwards from how this should work. Nothing about this is a structural limitation: `platform_plans` is a table, not a singleton row, so a second tier later is a new row plus a new Version, never a schema change.

**Currency — EUR vs. RON.** The proposal's EUR is the right call, made deliberately rather than by default. The counter-case for RON is real and worth naming: every existing price in this codebase (Membership Plans, e.g. `"379 RON"`) is RON, the current customer base is Romania-first, and a Romanian Owner may read a RON price as more trustworthy/local than a EUR one. Against that: Forge's own architecture already treats "regional pricing" and "multiple currencies" as a cheap later addition (Section 9, below) — meaning the currency choice at launch is not a permanent commitment either way, and EUR is the safer default specifically because it is the currency Stripe, and most SaaS billing tooling, treats as the unmarked default; launching in RON and later needing to also support EUR for international expansion is no harder than the reverse, so there is no structural tiebreaker. The tiebreaker is market trust, not architecture — and on that axis, RON is arguably the stronger choice for a Romania-first launch. **Recommendation: this is the one place in this document where the architecture genuinely does not decide the answer — it is named as a real founder call, not resolved here.** If forced to pick one, EUR is defensible as the more portable long-term default; RON is defensible as the lower-friction launch choice for the actual first customers. Either is implementable with zero difference in schema.

**14-day trial, no card required.** Not new decisions — both are already frozen. `OWNER_LIFECYCLE_STATE_MACHINE.md`/`OWNER_DOMAIN_IMPLEMENTATION_ARCHITECTURE.md` Section 6.1 already fix the trial at 14 days (`trial_ends_at = now() + 14 days`), and `OWNER_ACTIVATION_ARCHITECTURE.md` line 285 already fixes "card required: no" as a stage-appropriate, explicitly revisitable decision. This review inherits both rather than re-deciding them — restating them here only to confirm they are consistent with, not contradicted by, the billing model.

**Plan name: "Forge."** Correct — using the product's own name for its only plan is the right call precisely because there is only one plan; a distinguishing tier name (e.g. "Forge Starter") would imply a sibling tier that doesn't exist yet and would need renaming the moment a second tier is added.

**The actual number.** Deliberately not decided in this document, per the mission's own framing ("The goal is NOT to choose today's price"). What this document does fix is the *policy* for arriving at it and changing it later — see below. The concrete amount remains a founder decision to be supplied before the M10.4 seed migration is written.

---

# Platform Plan Lifecycle

Kept as small as the frozen architecture already implies, not smaller and not larger.

**`platform_plans` (the named catalog entry, e.g. "Forge"):** no lifecycle state at all. It is a stable grouping row — a name — and carries no active/retired concept itself. All commercial state lives one level down, on the Version, exactly as `OWNER_DOMAIN_IMPLEMENTATION_ARCHITECTURE.md` Section 5.2 already frames retirement as a Version-level flag, not a Plan-level one.

**`platform_plan_versions` (the actual sellable, priced offer):** exactly two states, expressed as a single nullable field, not an enumerated status column:
- **Active** — `retired_at IS NULL`. Visible on the public pricing page, purchasable.
- **Retired** — `retired_at IS NOT NULL`. Invisible on the public pricing page, not purchasable by a new Subscription, but permanently valid and resolvable for every existing Order/Subscription that already references it.

No `draft` state — Plan Versions are inserted via a reviewed migration, which is itself the review step; adding an in-database "draft" status would duplicate a review process that already happens in the PR/migration-review workflow, for no benefit, exactly the kind of extra state Question 5 asks to avoid inventing. No `scheduled` state — this happens "a handful of times a year" (M10.4's own scope note); a migration deployed at the intended go-live moment is scheduling, achieved for free, without a cron job or a status machine to maintain. No separate `archived` vs. `retired` — Section 5.2 names one retirement concept, not two; splitting it would be a distinction with no behavioral difference.

---

# Platform Plan Fields

**Minimum correct model**, deliberately excluding anything M10.5 (Stripe integration) will need but M10.4 does not — see Editable vs. Immutable Fields for why Stripe identifiers are named as out of scope here, not merely omitted by oversight.

`platform_plans`:
- `id`
- `name` — e.g. "Forge"
- `created_at`

`platform_plan_versions`:
- `id`
- `platform_plan_id` — FK
- `price_amount` — integer, minor currency units (matches this codebase's existing convention for money columns)
- `currency` — e.g. `'EUR'`
- `billing_cadence` — e.g. `'monthly'` (a text field now, not an enum, so `'annual'` is addable later by inserting a new Version, never an ALTER)
- `trial_days` — `14` at launch, stored rather than hardcoded so a future change is a new Version, not a code deploy
- `description` — nullable, public-facing marketing copy
- `retired_at` — nullable, the one mutable field on this table (see below)
- `created_at`

**Deliberately excluded from M10.4's schema:** `stripe_product_id`, `stripe_price_id`, and any feature-flag columns. Feature flags are excluded because a single-tier launch has nothing to differentiate — adding flag columns now would be modeling a distinction that doesn't exist yet, reversible for free later by an additive `ALTER TABLE` when a second tier actually needs to express one. Stripe identifiers are excluded because M10.4's own frozen scope states "Edge Function impact: None" — no Stripe integration exists in this milestone at all; adding Stripe columns now would be exactly the "preparation for M10.5" the M10.4 mission explicitly forbids. M10.5 adds them via its own additive migration when it actually needs them.

---

# Editable vs. Immutable Fields

| Field | Policy | Why |
|---|---|---|
| `platform_plans.name` | Editable, by migration only | Cosmetic — carries no price, so changing it (e.g. a rebrand) creates no commercial ambiguity for any existing Subscription, which never references the Plan directly for pricing purposes (it references the Version). |
| `platform_plan_versions.price_amount` | Immutable forever | The one fact this entire model exists to protect. Editing it in place would silently reprice every Subscription that resolved its price display from this row, and would corrupt the very distinction (Section 5.3: "actual agreed price... may differ from the Plan Version's list price") that makes historical reporting trustworthy. |
| `platform_plan_versions.currency` | Immutable forever | A currency change is a new commercial offer, not an edit to an existing one — identical reasoning to price. |
| `platform_plan_versions.billing_cadence` | Immutable forever | Same reasoning — monthly vs. annual is a different product, not a parameter tweak. |
| `platform_plan_versions.trial_days` | Immutable forever | A trial-length change affecting an already-running trial would be a silent, retroactive change to terms a prospect may already be relying on. |
| `platform_plan_versions.description` | Immutable forever | Kept uniform with the rest of the row rather than special-cased as "just text" — a Version's entire commercial-facing content is frozen as one unit, which is simpler to reason about and enforce than "everything except description." |
| `platform_plan_versions.retired_at` | Mutable — the one designed exception | This is the retirement flag itself (Section 5.2's own language: "retirement via a flag"). It is the single field this table is allowed to change after creation, and its only legal transition is `NULL → now()`, never back. |

**No field is ever "editable only before activation."** That would require tracking whether a Version has been referenced yet — an extra piece of state to compute and enforce, for a benefit (editing a price that happens to not have sold yet) that a five-minute migration rollback already covers just as well before the seed migration is deployed. Keeping the rule uniform ("Versions are insert-only, full stop") is simpler and has no real cost, since Plan Versions are created by reviewed migration in the first place — a typo caught before deploy is fixed by editing the migration file, not the row.

---

# Price Versioning Policy

Directly restating `OWNER_DOMAIN_IMPLEMENTATION_ARCHITECTURE.md` Section 5.2, made concrete for a real repricing event:

**Forge launches at €79/month. One year later, Forge wants €99/month.**

- **New Platform Plan Version created**, `price_amount = 9900`, same `platform_plan_id`, `retired_at = NULL`.
- **Old Version (€79) is retired**, `retired_at = now()`. It is never deleted, never edited.
- **New signups** from that point resolve the pricing page and `purchase_platform_plan` against the new, active Version — they see and agree to €99.
- **Existing customers' current Platform Subscription is completely unaffected.** It already carries its own agreed price (Section 5.3) on the Subscription row itself — not a pointer to the Version's current list price — so nothing about their existing term silently repriced. This is true structurally, by construction, not because of any special-case logic this document needs to invent.
- **Historical Orders are untouched.** Every Order already recorded the agreed amount at the moment it was created (Section 5.4); a later Version change has no bearing on a ledger entry that already exists. Reporting simply reads the ledger as it already is — no recalculation, no backfill, no "as-of" logic needed anywhere.
- **What happens to a customer's *next* renewal** is explicitly a separate, currently-unspecified question — see Future Price Change Policy, below, on why this document deliberately does not answer it yet.

---

# Grandfathering Policy

**Yes, for free, for the lifetime of a customer's current Subscription term — and that is currently the entire extent of it.**

Because a Platform Subscription is immutable once created and always carries its own agreed price (Section 5.3), a price increase can never touch an already-active customer's current term. That is grandfathering, and it requires building nothing — it is a direct consequence of the ledger discipline already frozen, not a feature this document is proposing.

**What this document deliberately does not define:** whether a customer's *next renewal* re-prices at the new list price or preserves the old one indefinitely. The frozen architecture (Section 6.4) names exactly four Platform Subscription commands — `purchase_platform_plan`, `upgrade_platform_plan`/`downgrade_platform_plan`, `cancel_platform_subscription` — and no distinct "renew" command exists yet in this codebase's frozen contract. Answering "does grandfathering survive a renewal" before the renewal mechanism itself has been designed would be deciding a policy with no code path to attach it to — premature, not conservative. **This is named here as an explicit open question for whichever milestone designs renewal** (adjacent to M10.6/M10.7 in the existing roadmap), not resolved by this document. Recommend it not be configurable (no per-Gym or per-cohort grandfathering toggle) unless a real cohort-fairness need appears — a single, uniform renewal policy is simpler to reason about, communicate, and support than a configurable one, and nothing today justifies the complexity of the configurable version.

---

# Future Price Change Policy

Restated compactly from the two sections above, as the single policy statement a future engineer or founder can act on without re-deriving it:

1. A price change is always a **new Plan Version**, never an edit.
2. The **old Version is retired**, never deleted.
3. **Existing Subscriptions are never touched** — their agreed price lives on their own row.
4. **New signups** always resolve against the current active Version.
5. **Renewal pricing is an open question**, intentionally deferred to whichever milestone builds the renewal mechanism — not decided here, and not assumed to default either way.

---

# Stripe Mapping

Not built in M10.4 — M10.4's own frozen scope has zero Edge Function or Stripe impact. Recorded here as guidance for M10.5, so that milestone inherits a decided mapping rather than re-deriving one under implementation pressure:

**One Platform Plan → one Stripe Product.** A Stripe Product is the stable, named "thing being sold" and can hold many Prices over its life — this maps naturally onto `platform_plans` as the stable grouping row that survives repricing.

**One Platform Plan Version → one Stripe Price.** This is the clean part of the mapping: Stripe Prices are themselves immutable once created — Stripe's own model already enforces exactly the same insert-only discipline this document just froze for Plan Versions. A new Version and a new Stripe Price are created together, in lockstep, with no translation logic needed to reconcile two different immutability rules, because there is only one rule, expressed identically on both sides.

`stripe_product_id` lives on `platform_plans`; `stripe_price_id` lives on `platform_plan_versions` — both added by M10.5's own migration, not this one.

---

# Future Expansion Strategy

| Capability | Timing | Why |
|---|---|---|
| Annual billing | Later | `billing_cadence` already accommodates it; a new Version with `cadence = 'annual'` costs zero schema change. |
| Coupons / discounts | Later | Stripe-native (Checkout promo codes) — an M10.5-era Stripe configuration concern, not a Forge schema concern. |
| Launch promotions | Later, but already free when it arrives | A Subscription's agreed price may already differ from its Version's list price (Section 5.3) — a manually-agreed promotional price requires no schema change, ever. |
| Regional pricing / multi-currency | Later | `currency` is already a Version-level column; a new Version per market is directly expressible. Seeding multiple currencies before there is international demand would be speculative. |
| VAT | Later, needs its own review | Expected to be a Stripe Tax/Checkout-time concern with no Forge schema impact, but not confirmed here — flagged for dedicated review when M10.5 is scoped, not resolved in this document. |
| Enterprise plans | Later | Expressible as another `platform_plans` row, or as an off-catalog agreed price on a manually-created Subscription — either way, no schema change. |
| Add-ons | **Never, absent a real need** | Financial Domain's own Order shape (Section 5.4) represents "the one Platform Subscription it represents" — singular, no line-item concept. Introducing add-ons would be a real Order-Domain extension, not a seeding exercise; this is the one item on this list that would actually require redesign, and it is named as such rather than glossed over. |
| Seat pricing | **Never, absent a real need** | Forge's value unit is a Gym, not a seat. Retrofitting seat-based pricing onto this model is a structural change, not a configuration one — flagged honestly as out of reach without redesign, unlike everything else on this list. |

---

# Product Owner Recommendations

1. Launch with **one plan, named "Forge," monthly billing, 14-day trial, no card required** — all four already correct or already frozen elsewhere; nothing here changes.
2. Decide **EUR vs. RON** as a real, standalone founder call — this document lays out the tradeoff honestly but does not resolve it, since architecture doesn't favor either.
3. Supply the **actual launch price** before the M10.4 seed migration is written — this document deliberately does not propose a number, consistent with the review's own stated goal.
4. Adopt the **insert-only Plan Version discipline** exactly as specified — this is the one mechanism doing almost all of the long-term work in this model, and it costs nothing extra to build correctly from day one versus retrofitting it after a first repricing event has already happened without it.
5. Treat **renewal pricing policy** as an explicitly open question for a future milestone, not a gap in this one.
6. Do **not** build Stripe identifiers, feature flags, add-ons, or seat pricing into M10.4's schema — every one of them is either free to add later or, for add-ons/seats specifically, genuinely requires a future redesign this document is not attempting to pre-solve.

---

# Final Verdict

The proposed launch shape (one plan, monthly, 14-day trial, no card) survives challenge on every axis except the currency call, which is a genuine, evenly-balanced founder decision this document correctly declines to make for them. The one mechanism that actually matters for the next several years of Forge's own pricing history — Plan Versions are insert-only, Subscriptions always carry their own agreed price — is not new; it was already frozen in `OWNER_DOMAIN_IMPLEMENTATION_ARCHITECTURE.md` before this review began. This document's contribution is confirming that mechanism is sufficient at 10,000-Gym scale, across currencies, across billing cadences, and across a future repricing event, with exactly one honestly-named gap (consolidated multi-Gym franchise billing) and exactly one honestly-named "would require real redesign" item (seat pricing / add-ons) — neither of which blocks M10.4.

READY FOR M10.4 IMPLEMENTATION
