# FORGE — FINANCIAL RPC TIMEZONE — INVESTIGATION REPORT
Date: 2026-08-28
**Investigation-only. Zero implementation. Zero production mutation.**

---

## 1. Executive Verdict

**FINANCIAL TIMEZONE INVESTIGATION: COMPLETE**
**IMPLEMENTATION: NOT AUTHORIZED**

3 confirmed session-timezone-dependent `current_date` uses in the Financial domain
(`create_subscription`, `activate_queued_subscription`, `set_gym_paid_until`).
Highest severity **P2**. **No money amount is affected. No accounting/tax period is
affected. No revenue/MRR reporting exists. Historical impact: NO EVIDENCE** (0 of
229 subscriptions created in a divergence window; 0 of 3 gyms have `paid_until`
set). All payment/order/refund/platform-billing RPCs are already correct
(absolute-instant `timestamptz` + `now()`). An ADR
(`FORGE_ADR_FINANCIAL_TIMEZONE_POLICY.md`) is proposed for owner approval.

---

## 2. Objects Investigated

Every `public` function matching `(current_date|now()::date|date_trunc(...now()))`
plus every function whose name matches
`subscription|payment|refund|order|invoice|billing|revenue|mrr|arr|churn|plan|paid_until`:

- **`create_subscription`** — `current_date` — **FINDING F-02**
- **`activate_queued_subscription`** — `current_date` — **FINDING F-01**
- **`set_gym_paid_until`** — `current_date` — **FINDING F-03**
- `create_order_for_subscription`, `register_payment`, `refund_payment`,
  `end_subscription`, `delete_queued_subscription`, `recompute_order_status` — no
  timezone-sensitive expression (verified)
- `register_platform_payment`, `_change_platform_plan`,
  `cleanup_abandoned_queued_subscriptions`, `recompute_platform_order_status`,
  `purchase_platform_plan`, `upgrade_platform_plan`, `downgrade_platform_plan`,
  `cancel_platform_subscription`, `refund_platform_payment` — only `now()` /
  `now() ± interval` on `timestamptz` columns (absolute instants) — **correct, not
  a finding**
- `enforce_subscription_sessions` (booking gate) — compares `date` to `date`, no
  `current_date` — **correct**
- `subscriptions_restrict_member_update` — no date logic
- **Adjacent, non-Financial:** `get_membership_summary` uses `CURRENT_DATE` for
  `memberships_expiring_7d/_30d` counts — Dashboard domain, display-count only,
  noted as **F-04 (out of core scope)**

**No revenue / MRR / ARR / gross / net / invoice / VAT function exists** anywhere
(confirmed by function scan + client grep).

---

## 3. Live Definitions (relevant expressions only)

**`create_subscription`** — `LANGUAGE plpgsql`, `SECURITY DEFINER`,
`SET search_path TO 'public'`, owner `postgres`, `VOLATILE`:
```
v_today date := current_date;
...
-- (a) "does the member already have coverage today?"
select ... from subscriptions
where lower(member_email) = v_email and gym_id = v_gym_id
  and is_active = true and queued = false
  and start_date <= v_today and end_date >= v_today ...
...
-- (b) queued-row placeholder (overwritten later by activate_queued_subscription)
insert into subscriptions (... start_date, end_date ...) values (... v_today, v_today ...)
```
The **admin active-subscription path** inserts `p_start_date` / `p_end_date`
(caller-supplied, gym-local) — `current_date` is *not* used for that path's stored
dates.

**`activate_queued_subscription`** — same attributes:
```
v_start_date date := current_date;
...
update subscriptions
set is_active = true, queued = false, start_date = v_start_date, end_date = p_end_date, sessions_used = 0
where id = p_subscription_id;
```
`start_date` is **persisted** from `current_date`; `end_date` is `p_end_date`
(caller-supplied). No `p_start_date` parameter exists.

**`set_gym_paid_until`** — same attributes, `is_platform_admin()` gated:
```
update gyms set
  paid_until = p_paid_until,
  is_active = case
    when is_active = false and (paid_until is null or paid_until < current_date) and p_paid_until >= current_date
      then true
    else is_active
  end
where id = p_gym_id;
```
`gyms.paid_until` is set to `p_paid_until` (admin input); `current_date` only gates
the `is_active` auto-reactivation.

---

## 4. Callers

| RPC | Caller | Object | Inputs | Output use | Live? |
|---|---|---|---|---|---|
| `create_subscription` | `saveAbonament` (embedded Admin) | `WOD-SIMPLE/src/App.jsx:3830` | `p_start_date = dataStartAbonament` (picker, default `todayLocalStr()`), `p_end_date` (client `addMonthsClamped`), amount, currency, method | shows "queued"/"added" toast | **ACTIVE** |
| `create_subscription` | `create-checkout-session` Edge Function | `WOD-SIMPLE/supabase/functions/create-checkout-session/index.ts:206` | member self-service; start/end from the checkout flow | Stripe checkout | **ACTIVE** |
| `activate_queued_subscription` | `activateQueuedSubscription` (self-service) | `App.jsx:240` | `p_subscription_id`, `p_end_date` (client `addMonthsClamped(new Date(), duration)`) — **no start date** | activation | **ACTIVE** |
| `activate_queued_subscription` | admin activate-queued | `App.jsx:3207` | same | activation | **ACTIVE** |
| `activate_queued_subscription` | `stripe-webhook` Edge Function | `.../stripe-webhook/index.ts:144` | `p_subscription_id`, `p_end_date` | post-payment activation | **ACTIVE** |
| `set_gym_paid_until` | Platform Admin panel | `App.jsx:2697` / `:2703` | `p_gym_id`, `p_paid_until` (date or null) | gym billing state | **ACTIVE** (platform-admin only) |

All three RPCs are **ACTIVE LIVE PATHS**.

---

## 5. Financial Semantics

| RPC | Classification | What it does |
|---|---|---|
| `create_subscription` | SUBSCRIPTION STATE + MEMBERSHIP ENTITLEMENT | Creates a `subscriptions` row; decides *queued* (member already covered / self-service) vs *active immediately* (admin, member uncovered). Kicks off order creation and (admin, with amount) payment registration. |
| `activate_queued_subscription` | SUBSCRIPTION STATE + MEMBERSHIP ENTITLEMENT + PAYMENT STATE | Flips a queued row to `is_active = true, queued = false`, sets `start_date`/`end_date`, `sessions_used = 0`; deactivates the member's other active subs; enforces the order is paid (`FRG02`) for members with a profile. |
| `set_gym_paid_until` | PLATFORM BILLING (gym ↔ Forge) | Platform admin sets `gyms.paid_until`; auto-reactivates a gym that was deactivated for non-payment if the new date is in the future. |

None of the three is REVENUE REPORTING, MRR/ARR, INVOICE/ACCOUNTING, FORECASTING,
or CASHFLOW.

---

## 6. Date/Time Classification

| Value | SQL Type | Semantic Type | Source | Used For |
|---|---|---|---|---|
| `create_subscription.v_today` | `date` | **A** (business calendar date) | `current_date` | "covered today?" check + queued placeholder |
| `activate_queued_subscription.v_start_date` | `date` | **E** (subscription effective date) | `current_date` | **persisted** `subscriptions.start_date` |
| `activate_queued_subscription.p_end_date` | `date` | **F** (subscription expiry date) | caller (browser-local) | `subscriptions.end_date` |
| `create_subscription.p_start_date` / `p_end_date` | `date` | **E** / **F** | caller (gym-local picker) | active sub's dates |
| `set_gym_paid_until.p_paid_until` | `date` | **A** (platform-billing date) | platform admin | `gyms.paid_until` |
| `set_gym_paid_until` `current_date` | `date` | **A** (business calendar date) | `current_date` | `gyms.is_active` reactivation gate |
| `subscriptions.created_at` | `timestamptz` | **B** (absolute instant) | `now()` default | audit / ordering |
| `orders.created_at`, `payments.created_at` | `timestamptz` | **B** (absolute payment/order instant) | `now()` default | audit; `cleanup_abandoned` cutoff |
| `orders.total_amount`, `payments.amount` | `numeric` | **money** | explicit params | — **never** derived from any date |
| `platform_subscriptions.started_at` / `renews_at` | `timestamptz` | **B** | `now()` / `now() + interval '1 month'` | platform billing cycle |

---

## 7. Reproduction (session-timezone scenarios)

`current_date` ≡ `(now() AT TIME ZONE current_setting('TimeZone'))::date`.
Right now (mid-afternoon) `current_date` = `2026-08-28` under UTC, Europe/Bucharest,
and America/New_York — no divergence. At danger-window instants (verified live):

| Instant | `current_date` (prod, UTC) | gym-local (`Europe/Bucharest`) | agree? |
|---|---|---|---|
| `2026-07-14 21:30:00Z` (= 00:30 EEST, summer) | `2026-07-14` | **`2026-07-15`** | **NO** |
| `2026-01-14 22:30:00Z` (= 00:30 EET, winter) | `2026-01-14` | **`2026-01-15`** | **NO** |
| `2026-07-14 20:30:00Z` (= 23:30 EEST) | `2026-07-14` | `2026-07-14` | yes |

- **F-01:** activation at `2026-07-14 21:30Z` → `subscriptions.start_date` stored as
  `2026-07-14`; gym-local activation day is `2026-07-15`.
- **F-02:** at that instant, the "covered today?" check evaluates
  `end_date >= 2026-07-14` instead of `>= 2026-07-15` — a sub that expired
  `2026-07-14` is still seen as covering "today" → the renewal is **queued**.
- **F-03:** `p_paid_until >= current_date` evaluates against `2026-07-14` not
  `2026-07-15`.

---

## 8. Midnight Boundary

- **Winter (EET, UTC+2):** danger window ≈ `00:00`–`02:00` gym-local.
- **Summer (EEST, UTC+3):** danger window ≈ `00:00`–`03:00` gym-local.
- IANA `Europe/Bucharest` handles the seasonal offset automatically; no `+02`/`+03`
  is hardcoded anywhere and none should be.
- Month/year rollover in the window behaves the same way (the date is simply a day
  behind); a Dec-31-late-UTC activation would store a Dec-31 `start_date` while the
  gym is already on Jan 1.

---

## 9. Financial Impact

| Dimension | Affected? | Detail |
|---|---|---|
| **Money amounts** (gross/net/VAT/cash/MRR/ARR) | **NO** | Every amount is an explicit parameter or `subscription_plans.price`; no amount is derived from any date. No revenue/MRR RPC exists. |
| **Payment state** | **NO** | `payments`/`orders` use `timestamptz` `now()` (absolute instants) — correct. Refund/register/recompute functions have no `current_date`. |
| **Subscription state / entitlement** | **MARGINAL** | F-01: `start_date` +1 day at the front (into the already-past, unbookable direction). F-02: a danger-window renewal may be `queued` instead of `active` for ~2–3h/night (recoverable). Neither grants nor removes a *forward* booking right. |
| **Membership activation / expiry** | **F-01 only, marginally** | `start_date` earlier by 1 day in the window; `end_date` (caller-supplied, browser-local) unaffected. |
| **Reporting windows** | **N/A (Financial)** | No Financial reporting RPC. (`get_membership_summary`'s expiring-count window is Dashboard-domain — F-04, not in scope.) |
| **Accounting / invoicing / tax** | **NO** | No invoice date, accounting period, or VAT logic exists. |
| **Display only** | partial | F-02's queued-placeholder dates are shown briefly until activation. |

---

## 10. Historical Impact

| Finding | Classification | Evidence |
|---|---|---|
| **F-01** | **NO EVIDENCE** | 229 subscriptions; **0** created during a UTC↔Europe/Bucharest date-divergence window; **0** with `start_date` = UTC-creation-date where that differs from the gym-local creation date. |
| **F-02** | **NO EVIDENCE** | Same 0-in-danger-window result; no queued/active mis-routing detectable and none plausible without a danger-window creation. |
| **F-03** | **NO EVIDENCE** | **0 of 3 gyms have `paid_until` set** — the date branch has never produced a persisted effect. |

Aggregate only; no PII accessed.

---

## 11. Persisted vs Computed

| Finding | Classification | Columns |
|---|---|---|
| **F-01** | **PERSISTED DATA** | `subscriptions.start_date` (0 rows currently wrong) |
| **F-02** | **BOTH** | computed queued/active branch decision + transient persisted placeholder `subscriptions.start_date`/`end_date` on a queued row (overwritten on activation) |
| **F-03** | **PERSISTED DATA** (potential) | `gyms.is_active` flip only (0 rows ever affected) |

No remediation performed. No remediation SQL produced.

---

## 12. Root Causes

| Finding | Classification | Confidence |
|---|---|---|
| **F-01** | `CURRENT_DATE SESSION-TIMEZONE BUG` | **HIGH** |
| **F-02** | `CURRENT_DATE SESSION-TIMEZONE BUG` (manifesting as a queued-vs-active branch error) | **HIGH** |
| **F-03** | `CURRENT_DATE SESSION-TIMEZONE BUG` (latent — never exercised) | **HIGH** (that it is tz-dependent); impact assessed LOW |

All three: `current_date` resolves in the DB session timezone (UTC) where a
**gym-local business calendar date** is meant.

---

## 13. Severity

| Finding | Severity | Rationale |
|---|---|---|
| **F-01** | **P2** | Persisted business date wrong, but only for ~2–3h/night activations, only widens coverage backward into the unbookable past, recoverable, no money, no forward entitlement change, zero historical evidence. |
| **F-02** | **P2** | Renewal routed to `queued` vs `active` for danger-window creations on the post-lapse day; recoverable by admin; no money. |
| **F-03** | **P3** | Latent, platform-admin-only, trivial recovery, never exercised (no gym has `paid_until`). |
| F-04 (adjacent) | **P3 / hardening** | Dashboard display count; not Financial; fold into a dashboard pass. |

Severity is **not** inflated for being in the Financial domain — none of these
corrupts money, payment state, or a paid entitlement window forward.

---

## 14. Europe/Bucharest Applicability

| Finding | Should use `Europe/Bucharest` business date? | Why |
|---|---|---|
| **F-01** | **YES** | `subscriptions.start_date` is a gym-local coverage calendar day (semantic type E). |
| **F-02** | **YES** | "Is the member covered *today*?" means the gym's today. |
| **F-03** | **YES** (low urgency) | `gyms.paid_until` reactivation is a gym-local calendar-day decision. |
| Payment/order `created_at`, `now()` in platform RPCs | **NO** | Absolute instants — `timestamptz` is already correct; converting them would be wrong. |
| F-04 accounting/reporting-day bucketing (future) | **BUSINESS DECISION REQUIRED** | Which day a `21:30 UTC` payment belongs to, and which fiscal period, is an accounting/business call — not decided here. |

---

## 15. Business Decisions Required

See `FORGE_ADR_FINANCIAL_TIMEZONE_POLICY.md` for full option analysis. Summary:

- **DECISION F-01** — `activate_queued_subscription.start_date` → gym-local? *(Rec: YES)*
- **DECISION F-02** — `create_subscription` "covered today?" check → gym-local? *(Rec: YES, same migration as F-01)*
- **DECISION F-03** — `set_gym_paid_until` reactivation gate → gym-local? *(Rec: YES opportunistically, or defer as P3)*
- **DECISION F-04** — accounting-period / reporting-day policy — **NOT NEEDED NOW**; owner/accountant decision when revenue reporting is built.

---

## 16. Proposed Policy (summary)

Absolute instants stay `timestamptz` + `now()`. Subscription `start_date`/`end_date`
and `gyms.paid_until` are gym business calendar dates; any server-side "today" that
sets or compares them uses `(now() AT TIME ZONE 'Europe/Bucharest')::date` — the
same explicit single-gym constant as P0-01 / `dashboard_resolve_window` /
`m9_publish_waiver`. Reporting/accounting-period bucketing is deferred to an
explicit owner/accountant decision. No `gyms.timezone`.

---

## 17. Proposed Fixes

*(NOT implemented.)* In `create_subscription`, `activate_queued_subscription`, and
(if F-03 approved) `set_gym_paid_until`: replace `current_date` with
`(now() AT TIME ZONE 'Europe/Bucharest')::date` (~3 expression swaps total). All
business rules, signatures, return shapes, auth checks, and security attributes
byte-identical. Full function-by-function diff and type proof in the ADR.

---

## 18. Expected Behavioral Changes

- Money totals: none. API shapes: none. Caches/invoices: none exist.
- `subscriptions.start_date` for danger-window activations: one day later than
  today's behaviour.
- Danger-window renewals on the post-lapse day: `active` instead of `queued`.
- Everything outside the ~2–3h nightly window: byte-identical.

---

## 19. Historical Remediation

**Required: NO.** No evidence any historical row was affected (0 subscriptions in a
divergence window; 0 gyms with `paid_until`). No remediation SQL produced. Any
future defensive re-scan would be read-only and is not part of this mission.

---

## 20. Accounting/Tax Gate

**Required: NO** for F-01/F-02/F-03 — no accounting/invoicing/VAT/fiscal-period
logic exists to get wrong. **F-04** (a future revenue-reporting feature's
day/period bucketing) *would* require an owner/accountant decision — flagged, not
decided, no default proposed, no Romanian tax-law assumption made.

---

## 21. Security

Changed: **NO.** All three RPCs remain `SECURITY DEFINER`, `search_path = public`,
owner `postgres`; every `is_admin`/`is_platform_admin`/`service_role`/owner-self
check and all GRANTs/RLS are untouched (nothing was touched). Security Gate:
**GREEN**.

---

## 22. Production Data

Modified: **NO.** Read-only queries and expression-level date arithmetic only.
Nothing written.

---

## 23. Application Code

Modified: **NO.**

---

## 24. Database Code

Modified: **NO.** No `CREATE OR REPLACE`, no `ALTER`, no migration, no trigger/RLS/
grant change.

---

## 25. Deployment

Performed: **NO.**

---

## 26. Closed Systems

| System | State (read-only re-verified live) |
|---|---|
| P0-01 `enforce_class_deletion_policy` | unchanged — still `((OLD.date + OLD.end_time) AT TIME ZONE 'Europe/Bucharest') < now()` |
| `dashboard_resolve_window` | unchanged — `now() AT TIME ZONE 'Europe/Bucharest'`, no `date_trunc('day', now())` |
| `m9_publish_waiver` | unchanged — `v_today := (now() AT TIME ZONE 'Europe/Bucharest')::date`, no live `current_date` (only a comment reference) |
| INC-03 `sync_workout_engine_v2` | unchanged — `ON CONFLICT (legacy_wod_id)` |
| INC-03 `workouts_enforce_legacy_date_sync` trigger | present; linked workouts/wods divergences = 0 |
| Security Gate | GREEN |

---

## 27. ADR

- Path: `FORGE_ADR_FINANCIAL_TIMEZONE_POLICY.md`
- Status: **PROPOSED — OWNER APPROVAL REQUIRED**

---

## 28. Final Recommendation

Owner should decide **F-01 + F-02 together** (recommend APPROVE — one narrow
migration, `current_date` → `(now() AT TIME ZONE 'Europe/Bucharest')::date` in
`create_subscription` and `activate_queued_subscription`, business rules
byte-identical, full regression matrix + post-deploy verification, no historical
remediation). Decide **F-03** APPROVE-in-same-migration or DEFER-as-P3. **F-04**:
record the decision requirement for a future revenue-reporting feature; no action
now. If approved, the implementation is a separate, explicitly-authorized mission.
