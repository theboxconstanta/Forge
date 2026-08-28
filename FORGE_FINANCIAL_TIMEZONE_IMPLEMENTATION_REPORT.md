# FORGE — FINANCIAL TIMEZONE F-01 / F-02 / F-03 — IMPLEMENTATION REPORT
Date: 2026-08-28

---

## 1. Executive Verdict

**FINANCIAL TIMEZONE F-01/F-02/F-03: CLOSED**

The three approved gym business-date corrections are implemented in one migration
(`20260828160000`), deployed live, and verified session-timezone-independent. No
money amount, subscription duration/end-date formula, payment semantic, historical
row, application code line, or security attribute changed. **F-04 remains DEFERRED**
— untouched, and the generic Financial date/time policy is **not** globally closed.

---

## 2. Owner Decision

- F-01: **APPROVED**
- F-02: **APPROVED**
- F-03: **APPROVED**
- F-04: **DEFERRED** (future accounting/revenue-reporting decision)

---

## 3. Business Policy

For the current single-gym Romania deployment, `Europe/Bucharest` is the explicit
business timezone for gym-local calendar-date decisions. Applied server-side only
where a gym-local calendar day is meant (subscription start / "covered today?" /
platform-billing reactivation). Absolute instants (`orders.created_at`,
`payments.created_at`, `platform_*` timestamps, `now()` in the payment/order/
platform RPCs) stay `timestamptz` and are unchanged. **No `gyms.timezone` column
introduced.** Not a generic multi-timezone architecture.

---

## 4. F-01 — `activate_queued_subscription`

- **Old behavior:** `v_start_date date := current_date` (DB session date = UTC in
  production) persisted to `subscriptions.start_date`. In the ~00:00–03:00
  gym-local window, `start_date` was stored as the *previous* calendar day.
- **New behavior:** `v_start_date` = the gym-local calendar day of activation.
- **Exact expression:**
  `v_start_date date := (now() AT TIME ZONE 'Europe/Bucharest')::date;`
- **Everything else unchanged:** `p_end_date` handling, auth (admin / owner /
  service_role), the self-service payment-amount rejection, the order creation +
  `FRG02` "order not paid" guard, the deactivate-other-active-subs `UPDATE`, the
  `is_active`/`queued`/`sessions_used` update, the `RETURN QUERY` shape.
- **Tests:**
  - Pre-fix (live, disposable, rolled back): `start_date` = `2026-08-28` under
    `SET TIME ZONE 'UTC'` vs `2026-08-29` under `'Pacific/Kiritimati'` → **DIVERGENT**
    (session-tz-dependent — the defect).
  - Post-fix (live, deployed): `start_date` = `2026-08-28` (gym-local) under UTC,
    Europe/Bucharest, Pacific/Kiritimati, America/New_York → **identical**.

---

## 5. F-02 — `create_subscription`

- **Old behavior:** `v_today date := current_date` drove (a) the "does this member
  already have an active subscription covering *today*?" lookup
  (`start_date <= v_today and end_date >= v_today`), which routes the new
  subscription to *queued* vs *active immediately*, and (b) the placeholder
  `start_date`/`end_date` of a *queued* row (overwritten on activation). In the
  danger window `v_today` was a day early → coverage over-estimated → renewal
  queued instead of activated.
- **New behavior:** "covered today?" and the queued placeholder use the gym-local
  calendar date.
- **Exact expression:**
  `v_today date := (now() AT TIME ZONE 'Europe/Bucharest')::date;`
- **Everything else unchanged:** the `v_is_admin`/`v_is_self` auth, the plan
  lookup, the `v_has_valid_active` session-remaining logic, the queued-vs-active
  branch structure, the admin-active path's use of caller-supplied
  `p_start_date`/`p_end_date`, order creation, payment registration (`p_amount_paid`),
  the `RETURN QUERY` shape.
- **Tests:**
  - Pre-fix: existing active sub ending "gym-local today" → `create_subscription`
    returned `queued = true` under UTC vs `queued = false` (activated) under
    Pacific/Kiritimati → **DIVERGENT**.
  - Post-fix: `queued = true` under UTC / Europe/Bucharest / Pacific/Kiritimati /
    America/New_York → **identical** (member IS covered on the gym-local today →
    correctly queues).
  - Money invariant: admin `create_subscription` with `p_amount_paid = 149.99`,
    `subscription_plans.price = 149.99` → `orders.total_amount = 149.99`,
    `payments.amount = 149.99`, `subscriptions.end_date` = the caller-passed
    `p_end_date` verbatim. **No amount changed.**

---

## 6. F-03 — `set_gym_paid_until`

- **Old behavior:** two `current_date` uses in the `gyms.is_active`
  auto-reactivation `CASE`
  (`(paid_until is null or paid_until < current_date) and p_paid_until >= current_date`).
- **New behavior:** a single local `v_today` = the gym-local calendar date; the
  `CASE` compares against it.
- **Exact expression:** function now has a `declare` block:
  `v_today date := (now() AT TIME ZONE 'Europe/Bucharest')::date;`
  and the `CASE` reads `... paid_until < v_today ... p_paid_until >= v_today ...`.
- **Everything else unchanged:** `is_platform_admin()` gate, `paid_until = p_paid_until`
  assignment, the "don't override a deliberate manual deactivation" intent, the
  `void` return.
- **Tests:**
  - Pre-fix: disposable inactive gym, `paid_until` in the past, `p_paid_until` =
    gym-local today → reactivated (`is_active` → true) under UTC vs **not**
    reactivated under Pacific/Kiritimati → **DIVERGENT**.
  - Post-fix: reactivated under UTC / Europe/Bucharest / Pacific/Kiritimati →
    **identical**.
  - The real gym's `is_active` was never touched (all F-03 tests used a disposable
    gym, transaction rolled back).

---

## 7. F-04

- **Status:** DEFERRED.
- **Implementation:** NONE. No change to `payments.created_at` / `orders.created_at`
  interpretation, revenue/MRR/ARR reporting (none exists), VAT, tax periods, fiscal
  periods, accounting periods, payment-day bucketing, or cashflow. Recorded in the
  ADR as a prerequisite decision for a future revenue-reporting feature —
  owner/accountant call, no default proposed, no Romanian tax-law assumption.

---

## 8. Migration

- **Filename:** `supabase/migrations/20260828160000_financial_business_date_timezone_safe.sql`
- **Objects changed:** `public.create_subscription`, `public.activate_queued_subscription`,
  `public.set_gym_paid_until` — each `CREATE OR REPLACE FUNCTION`, same signature.
- No other object. No schema change, no trigger, no RLS, no GRANT, no data.

---

## 9. Session-Timezone Independence

Post-deploy, same absolute instant, disposable data, transaction rolled back:

| Function | `UTC` | `Europe/Bucharest` | `Pacific/Kiritimati` | `America/New_York` |
|---|---|---|---|---|
| F-01 `start_date` | `2026-08-28` | `2026-08-28` | `2026-08-28` | `2026-08-28` |
| F-02 `queued` | `true` | `true` | `true` | `true` |
| F-03 reactivated | `true` | `true` | `true` | `true` |

- UTC: **PASS**
- Europe/Bucharest: **PASS**
- Other (Pacific/Kiritimati, America/New_York): **PASS**

---

## 10. DST

Expression-level (`(synthetic now AT TIME ZONE 'Europe/Bucharest')::date`, the
exact deployed expression):

| Instant | old `current_date` (UTC) | new gym business date |
|---|---|---|
| `2026-01-14 22:30Z` (00:30 EET, winter) | `2026-01-14` | **`2026-01-15`** |
| `2026-01-14 21:30Z` (23:30 EET) | `2026-01-14` | `2026-01-14` |
| `2026-07-14 21:30Z` (00:30 EEST, summer) | `2026-07-14` | **`2026-07-15`** |
| `2026-07-14 20:30Z` (23:30 EEST) | `2026-07-14` | `2026-07-14` |
| `2026-08-31 21:30Z` (00:30 local, month rollover) | `2026-08-31` | **`2026-09-01`** |
| `2025-12-31 22:30Z` (00:30 local, year rollover) | `2025-12-31` | **`2026-01-01`** |

- Winter (EET): **PASS**
- Summer (EEST): **PASS**
- IANA `Europe/Bucharest` applies the seasonal offset automatically; no `+02`/`+03`
  hardcoded anywhere.

---

## 11. Subscription Semantics

- Duration formula changed: **NO** (`subscription_plans.duration_months` /
  `addMonthsClamped` client-side / `p_end_date` — all untouched).
- End-date formula changed: **NO** (`p_end_date` passed through verbatim; verified
  `end_date = 2026-09-27` for `p_end_date = 2026-09-27`).
- Sessions changed: **NO** (`sessions_total`, `sessions_used`, the
  session-remaining check — untouched).
- Queued semantics changed: **NO**, except the approved correction — the
  queued-vs-active decision now uses the gym-local "today" instead of the UTC
  "today".
- Cancellation / renewal semantics: **NO** (`end_subscription`,
  `delete_queued_subscription`, the deactivate-other-subs `UPDATE` — untouched).

---

## 12. Money

- Amounts changed: **NO** — `plan.price`, `p_amount_paid`, `orders.total_amount`,
  `payments.amount` all verified unchanged (149.99 → 149.99 through the full admin
  create path).
- Payment logic changed: **NO** — `register_payment`, `create_order_for_subscription`,
  `refund_payment`, `recompute_order_status`, `register_platform_payment` still
  contain no `current_date` and were not touched.
- VAT / accounting changed: **NO** — none exists; F-04 untouched.

---

## 13. Historical Data

- Modified: **NO.**
- Remediation: **NONE** — the investigation found NO EVIDENCE of any affected
  historical row (0 of 229 subscriptions created in a UTC↔Europe/Bucharest
  divergence window; 0 of 3 gyms have `paid_until` set). Re-confirmed unchanged.
- All implementation tests used disposable rows inside transactions that were
  `ROLLBACK`'d; post-run leak check: 0 disposable plans / subscriptions / gyms /
  admin rows / platform_admin rows persisted. The only permanent production write
  was the migration's three `CREATE OR REPLACE FUNCTION` statements.

---

## 14. Security

- RLS changed: **NO**
- GRANTs changed: **NO**
- Function security posture changed: **NO** — all three functions re-verified live
  post-deploy: `SECURITY DEFINER` (`prosecdef = true`), `search_path = public`,
  owner `postgres`. Every `is_admin(...)` / `is_platform_admin()` /
  `auth.jwt() ->> 'role' = 'service_role'` / owner-self check unchanged. `CREATE OR
  REPLACE FUNCTION` with the identical signature preserves ownership and ACL.
- Security Gate: **GREEN** (no broad security audit run).

---

## 15. Application

- Code modified: **NO.** No `src/` file, no Edge Function. The client callers
  (`saveAbonament`, `activateQueuedSubscription`, the Platform Admin panel, the
  `create-checkout-session` and `stripe-webhook` Edge Functions) pass the same
  arguments; `activate_queued_subscription` still has no `p_start_date` parameter.

---

## 16. Production

- Deployed: **YES** — migration applied live to Forge Production
  (`sdfkvfbvgpuspnnnwqwk`) via `supabase db query --linked` as `postgres`.
- Live definitions verified: **YES** — `pg_get_functiondef` re-read for all three:
  each contains `(now() AT TIME ZONE 'Europe/Bucharest')::date`, **zero**
  `current_date` occurrences remain, `prosecdef = true`, `proconfig =
  {search_path=public}`, owner `postgres`.

---

## 17. Regression Tests

| Test | Result |
|---|---|
| Pre-fix reproduction (F-01/F-02/F-03, UTC vs Pacific/Kiritimati) | all 3 **DIVERGENT** — defect reproduced |
| Post-fix session-tz independence (F-01/F-02/F-03 × UTC / Europe/Bucharest / Pacific/Kiritimati / America/New_York) | all **identical** — PASS |
| DST winter (EET) / summer (EEST) / month rollover / year rollover (expression) | all **correct gym-local date** — PASS |
| Money invariant (plan price / order total / payment amount / end_date pass-through) | **unchanged** — PASS |
| Entitlement invariant (duration / end_date / sessions / queued / cancel / renew) | **unchanged** — PASS |
| Live post-deploy re-verification | **PASS** |
| Disposable-data leak check | **0 rows persisted** — PASS |
| WOD-SIMPLE Vitest full suite | **928 / 928** (9 pre-existing Deno-only file-load failures unchanged) |
| Build / lint | N/A — no executable JS/TS changed (SQL migration only) |

---

## 18. Closed Systems

| System | State (read-only re-verified live) |
|---|---|
| P0-01 `enforce_class_deletion_policy` | unchanged (`AT TIME ZONE 'Europe/Bucharest'`) |
| `dashboard_resolve_window` | unchanged |
| `m9_publish_waiver` | unchanged (`v_today date := (now() AT TIME ZONE 'Europe/Bucharest')::date`) |
| INC-03 `sync_workout_engine_v2` / `workouts_enforce_legacy_date_sync` | unchanged; linked workouts/wods divergences = 0 |
| Payment/order/refund/platform-billing RPCs | unchanged; still no `current_date` |
| INC-01 / INC-02 | unchanged |
| Security Gate | GREEN |

---

## 19. Remaining Financial Timezone Work

**F-04 only — DEFERRED.** Reason: it is an accounting/business decision (which
gym-local day, and which fiscal/VAT period, a payment instant belongs to) that is
only relevant once revenue/accounting reporting is scoped and built. No such
feature exists today. No default proposed.

---

## 20. Final Verdict

**FINANCIAL TIMEZONE F-01/F-02/F-03: CLOSED**
