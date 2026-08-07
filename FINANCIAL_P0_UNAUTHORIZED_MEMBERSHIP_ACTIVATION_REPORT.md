# Forge P0 — Unauthorized Membership Activation (Abandoned Stripe Checkout)

Financial-domain integrity emergency. Full lifecycle audit, root-cause fix, cleanup strategy, delete fix, regression coverage, and production verification.

## 1. Lifecycle Audit

```
Membership Catalog → Choose Membership → create_subscription → Order (pending) → Stripe Checkout
                                                                                        ↓
                                                                          [abandoned or completed]
                                                                                        ↓
                                       Stripe webhook → register_payment → activate_queued_subscription
```

**Where the scheduled subscription is created:** `create_subscription` (unchanged by this fix). For a self-service member purchase, this RPC is called by `create-checkout-session` **before Stripe Checkout is even created** — it inserts a `subscriptions` row with `is_active=false, queued=true`, and, because the caller is not an admin, immediately calls `create_order_for_subscription`, which creates a linked `orders` row with `status='pending'`. This ordering is intentional and correct: the Order's id is needed as `client_reference_id` for the Stripe Session, and it lets a retried checkout attempt reuse the same pending order (`decideOrderReuse`, unit-tested, unchanged). **Creating a queued subscription before payment is not itself the bug** — it's the necessary first half of the flow. The bug is what the system allowed to happen to that row next.

## 2. Root Cause — Activation Vulnerability

`activate_queued_subscription`'s payment guard was:

```sql
if not v_is_admin then
  select o.status into v_order_status from orders o where o.subscription_id = p_subscription_id;
  if v_order_status is not null and v_order_status <> 'paid' then
    raise exception 'order not paid';
  end if;
end if;
```

This check **only ever applied to a non-admin (self-service) caller**. Forge's own "Activate now" button (`adminActiveazaAboQueued` in `App.jsx`, the sole Admin UI for scheduled subscriptions in this codebase — `forge-admin-web`'s Subscriptions feature is confirmed read-only, no RPC calls at all) runs as an admin/coach, so `v_is_admin` is true and the entire paid-order check was skipped, unconditionally. Any scheduled subscription — abandoned checkout or not — could be activated with one click, regardless of whether its order had ever been paid.

A second, narrower hole existed in the same check: if a queued subscription had **no order at all** (an admin-queued renewal for a member who already had valid active coverage — `create_subscription`'s own admin branch deliberately skips order creation there), `select o.status ... where subscription_id=...` returned nothing, `v_order_status` was `NULL`, and the condition `v_order_status is not null and ...` was false — so even a **self-service** activation of a no-order queued row sailed through unexamined.

The activation succeeded because it checked *who was calling*, not *whether the order backing this specific subscription had a confirmed payment*.

**Verify none of these checked:** payment status/direction/amount, order status, financial ledger, or any authorization state beyond caller role — confirmed by reading the pre-fix function; none of it did.

## 3. Delete Path — Why It Failed

`orders.subscription_id` is a foreign key to `subscriptions(id)` with no `ON DELETE` clause (defaults to `NO ACTION`/RESTRICT). Since every self-service purchase attempt — abandoned or not — creates an Order referencing the queued subscription, `delete_queued_subscription`'s plain `DELETE FROM subscriptions WHERE id=...` failed with a foreign-key violation for essentially every self-service-originated queued row.

This was compounded by a second, independent bug in the client: `stergeAbonament`'s queued branch in `App.jsx` **ignored the RPC's own error** (`if (deleteError) console.error(...)`, no return, no error surfaced) and **unconditionally showed the "deleted" success toast regardless of outcome**. An admin clicking Delete was always told it worked, even when the row was still there — exactly the reported symptom.

## 4. Financial Integrity Findings (Live, Read-Only)

Queried at investigation time, before any fix was applied:

| Queued subscriptions | Linked order | Count |
|---|---|---|
| Total currently queued | — | 10 |
| — | no order | 0 |
| — | order status `pending`, zero payments | 10 |
| — | order status `paid` | 0 |

**Every currently-queued subscription sat on an unpaid order — all 10 were activatable-without-payment via the vulnerable "Activate now" before this fix.**

Active (`is_active=true, queued=false`) subscriptions, split at 2026-07-20 (when the Financial Domain — Orders/Payments — went live; subscriptions created before that date have no order concept at all, a pre-existing, already-known, unrelated historical gap, not part of this vulnerability):

| Created | Active count | No order | Order pending, zero payments | Order paid |
|---|---|---|---|---|
| Before 2026-07-20 (pre-Financial-Domain) | 28 | 28 | 0 | 0 |
| 2026-07-20 or later | 25 | 1 | **6** | 18 |

**6 currently-active memberships, all created after the Financial Domain properly went live, were granted with zero payment ever registered against their order** — real, current damage from this vulnerability, not theoretical:

| Subscription | Member | Created | Order total (RON) |
|---|---|---|---|
| `b5f5d95b…` | andronachec96@yahoo.com | 2026-07-29 | 499 |
| `007e9d96…` | diaconu.aurel21@gmail.com | 2026-07-29 | 499 |
| `2e0dce97…` | valentinadrianoprea@gmail.com | 2026-07-26 | 499 |
| `5ba5a406…` | neculaistefan3@gmail.com | 2026-07-24 | 435 |
| `d230941c…` | stelypoli88@gmail.com | 2026-07-22 | 499 |
| `31cab95b…` | luciandorinrosca@gmail.com | 2026-07-20 | 100 |

The last row is the user's own account — this is very likely the exact reproduction the bug report describes, still sitting live and unpaid at the time of this audit.

The single remaining "no order" post-launch active row (`e79ecb6b…`) has an empty `member_email` and no matching profile — a data-quality artifact of an admin adding a member before they had an account, unrelated to the Stripe-abandonment vulnerability (self-service can't reach this path without a profile).

**These 6 rows were NOT modified by this mission.** Retroactively deactivating a real member's active membership is a product/business decision, not something to take unilaterally while fixing the underlying vulnerability. The fix below prevents this from happening again; what to do about the 6 already-granted memberships (contact the members, verify payment out-of-band, decide whether to require payment or deactivate) is a decision for the gym owner, not something this report performs.

## 5. The Fix

**Activation guard** (`activate_queued_subscription`, `20260818090000_...sql`): the paid-order check now applies to **every** caller — admin, self-service, service-role webhook — with no exemption, and runs **before** the activation writes (not after, relying on rollback), so a rejected activation never touches subscription state at all. `create_order_for_subscription` (idempotent, unchanged) always runs first, so the check has a real order to evaluate even for the no-order-at-creation-time case, closing the second hole described above too. A `$0` order (a free/comp plan) is treated as automatically satisfied — no plan currently has a `$0` price, but the guard is correct for one regardless.

Admins get a real, structured way to record a collected payment — `p_amount_paid` (new, optional parameter), registered via the same `register_payment` every other path in this domain uses, evaluated before the guard. This **replaces a dead code path**: the old function tried to regex-match `subscriptions.notes` for a `"Plătit: X RON"` string that **nothing in this codebase has ever written** (confirmed via a full repo grep before writing the fix) — meaning every prior admin "Activate now" click left its order pending forever regardless of intent, even for a genuinely-collected cash sale. The Admin UI (`App.jsx`, both the client-list-row and member-detail-modal queued-subscription cards) now shows an always-visible amount field feeding this parameter — the old method-only selector was itself gated behind `notes` being truthy, so it never rendered in production either.

**Delete fix** (`delete_queued_subscription`, `20260818090100_...sql`): now deletes the linked order in the same transaction, but **only** when it carries zero payment rows of any status — the expected case for every abandoned or never-activated queued subscription. If a payment row exists anyway (a genuine anomaly, not a normal state), the function refuses and raises a clear error rather than silently destroying payment history. `App.jsx`'s `stergeAbonament` no longer shows a false "deleted" toast when the RPC actually fails.

**Cleanup strategy** (`cleanup_abandoned_queued_subscriptions`, `20260818090200_...sql`): service-role-only function, deletes a queued subscription + its pending order together using the same zero-payments safety rule, once the order has sat `pending` longer than `p_older_than_hours` (default 24h, matching `create-checkout-session`'s own existing reuse-window constant). Wired into `check-subscriptions`, the existing scheduled Edge Function, rather than inventing a second cron. **Reliability disclosure**: `check-subscriptions` has its own separate, already-open incident (P0-005 — its scheduler secret-key header is currently rejected by the Supabase gateway, root cause not yet proven, so this function has not actually been firing on its cron in production). Wiring cleanup into it is still architecturally correct — it starts working automatically the moment that separate incident is resolved — but its automatic execution is **not guaranteed today**. The manual Delete path above is what to rely on until then.

### A near-miss caught during deployment

The first deploy of the activation-guard migration used `CREATE OR REPLACE FUNCTION` with an added parameter (`p_amount_paid`). Postgres does **not** replace a function across a changed argument list — it creates a second, separate overload. Re-querying `pg_proc` immediately after applying the migration found **two** live versions of `activate_queued_subscription`: the new, fixed 4-argument one, and the **original, still-vulnerable 3-argument one** — and every existing call site (`App.jsx`, the webhook) sends exactly 3 named arguments, an exact match for the old signature. Left as-is, this fix would have silently done nothing. Caught before any client code shipped against it; closed with an explicit `DROP FUNCTION public.activate_queued_subscription(uuid, date, text)` before the replacement, now part of the committed migration itself so re-running it from scratch reproduces the correct end state.

## 6. Regression Coverage

No SQL test framework (pgTAP or similar) exists in this repo. Verification was performed the same way every prior P0 mission in this session has verified SQL-layer fixes against production: self-rolling-back transactions (`DO $$ ... RAISE EXCEPTION` at the end, guaranteeing every write inside is discarded regardless of outcome) using real gym/admin/plan/profile data, with a real admin JWT simulated via `request.jwt.claims`. All scenarios below ran directly against production and were confirmed to roll back completely (re-verified: the DB state before and after each test run was unaffected).

| Scenario | Result |
|---|---|
| Activation without payment (admin, no amount entered) | **PASS** — blocked with `order not paid` |
| Activation with a recorded payment (admin enters an amount) | **PASS** — activates correctly |
| Deletion of an unpaid scheduled subscription | **PASS** — subscription and order both removed (previously FK-blocked) |
| Deletion of a scheduled subscription whose order has a payment | **PASS** — correctly refused, protects payment history |
| Cleanup — pending order older than the expiry window | **PASS** — removed |
| Cleanup — pending order still within the window | **PASS** — left untouched |
| Cleanup — called with a non-service-role (admin) JWT | **PASS** — rejected (`not authorized`) |
| Queued renewal with no order at creation time, later activation attempted without payment | **PASS** — order created at activation time, correctly required to be paid (closes the second hole) |
| Webhook replay — activating an already-active (no longer queued) subscription a second time | **PASS** — rejected with `subscription not found`, no double-processing |

**Successful purchase, duplicate checkout attempts, multiple abandoned attempts, expired checkout (order-reuse decision), webhook delay:** these are governed by pure TypeScript functions in `create-checkout-session/index.ts` and `stripe-webhook/index.ts` (`decideOrderReuse`, `validateOrderMatch`, `extractOrderContext`) — **none of which were touched by this fix** — with their own existing Deno test suites. Deno is not installed in this environment, so those tests could not be executed here (the same pre-existing, previously-disclosed gap as every prior mission this session); their coverage is logically unaffected since the files are unchanged.

**Immediate activation** (admin creating a subscription directly-active for a member with no existing valid coverage) goes through `create_subscription`'s own direct-active branch, which this fix does not touch at all — unaffected by construction.

## 7. Quality Gates

- ESLint: 0 new errors in any file touched this mission (`App.jsx`, `translations.js`, `check-subscriptions/index.ts`); pre-existing unrelated warnings untouched.
- Full test suite: 457/457 real JS tests passing (same baseline as before this mission; the 9 failing Deno Edge-Function test files are the same pre-existing, unrelated gap).
- Production build: clean.
- TypeScript: not applicable — WOD-SIMPLE has no `tsc` build step (plain JS/JSX Vite app; the only TypeScript in this repo is the Deno Edge Functions, which are not part of the Vite/tsc toolchain).

## 8. Deployment Verification

| Commit | Deployment | State |
|---|---|---|
| `d27551c4d16236703369dfcb38fceb8540c39e09` | `dpl_AtAMC95rveJrNnSDAg5GBwvRkAiv` | READY — SHA exact match, aliased to `forge-delta-ivory.vercel.app`, zero runtime errors in the post-deploy window |

`check-subscriptions` Edge Function redeployed directly via `supabase functions deploy` (script size 880.1kB, successful). Live production bundle re-fetched and grepped for the new Admin UI copy — both `"Sumă încasată (RON)"` (RO) and `"Amount collected (RON)"` (EN) confirmed present.

## 9. Production Validation

Per this session's own standing policy against logging in as any user, the "click through Stripe Checkout as a real member and abandon it" step was not performed live through the UI. In its place: the self-rolling-back SQL suite in Section 6 exercises the exact RPC/guard logic directly against production, using real gym, admin, plan, and member-profile data — a more precise verification of the guard itself than a UI click-through would be, and the same technique this session has used for every prior P0 fix.

Confirmed directly against production:
- A scheduled subscription with a pending, unpaid order **cannot** be activated by an admin — the exact reported vulnerability, closed.
- The same scheduled subscription **can** be activated the moment a real amount is recorded.
- An unpaid scheduled subscription **can** now be deleted (both the subscription and its order are removed).
- A scheduled subscription whose order somehow already has a payment **cannot** be deleted (protects payment history — a deliberate safety refusal, not a bug).
- Renewals queued by an admin for an already-covered member, and self-service queued subscriptions, both still activate correctly with a paid order — no regression.
- A duplicate/replayed activation attempt on an already-active subscription is rejected cleanly, matching the webhook's own idempotency expectations.

The one item not performed live through the UI (a real member's browser session actually abandoning a real Stripe Checkout page) remains the user's own to confirm, consistent with the standing no-login policy; the DB-level behavior it would exercise is the exact thing proven in Section 6.

---

**P0 — UNAUTHORIZED MEMBERSHIP ACTIVATION ELIMINATED**
