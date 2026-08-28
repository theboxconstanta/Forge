# ADR — Financial Date/Time Semantics

## Status

**PROPOSED — OWNER APPROVAL REQUIRED.**
Not accepted. Not implemented. No production change has been or will be made under this mission.

---

## Context

P0-03 (canonical date/time consistency) fixed every client-side UTC-vs-gym-local
date bug and disclosed, but deliberately did **not** fix, a set of server-side SQL
`current_date` / `now()::date` uses — including some in the **Financial domain**,
which is FROZEN and requires an ADR before any change. The P0-01 trigger,
`dashboard_resolve_window`, and `m9_publish_waiver` timezone follow-ups have since
been fixed under their own approvals. This ADR covers the remaining, Financial ones.

The DB session timezone in production is **UTC** (`current_setting('TimeZone')` =
`'UTC'`, confirmed live). The single real gym is physically in Romania
(`Europe/Bucharest`: EET UTC+2 winter / EEST UTC+3 summer). For roughly the first
2 hours (winter) / 3 hours (summer) after gym-local midnight, `current_date` in
production returns the **previous** calendar day relative to the gym.

---

## Current Architecture

Financial RPCs (all `SECURITY DEFINER`, `search_path = public`, owner `postgres`,
`VOLATILE`):

| RPC | Purpose | Date/time it touches |
|---|---|---|
| `create_subscription(email, plan, start_date, end_date, amount, currency, method)` | Admin/self-service subscription creation; decides *queued* vs *active immediately* | `v_today date := current_date` — (a) "does the member already have coverage today?" check; (b) placeholder `start_date`/`end_date` for a *queued* row |
| `activate_queued_subscription(sub_id, end_date, method, amount)` | Activates a queued subscription (admin, self-service, or Stripe webhook) | `v_start_date date := current_date` — **persisted** to `subscriptions.start_date` |
| `set_gym_paid_until(gym_id, paid_until)` | Platform admin sets a gym's platform-billing coverage date | `current_date` — auto-reactivation gate on `gyms.is_active` |
| `create_order_for_subscription`, `register_payment`, `refund_payment`, `end_subscription`, `register_platform_payment`, `_change_platform_plan`, `cleanup_abandoned_queued_subscriptions`, `recompute_order_status`, … | orders / payments / refunds / platform billing | **no `current_date` / no `::date`**; use `now()` (`timestamptz`) and `now() ± interval` for absolute instants only — **already correct** |

Financial table date types:

| Column | Type | Semantic |
|---|---|---|
| `subscriptions.start_date`, `subscriptions.end_date` | `date` | subscription coverage window (business calendar dates) |
| `subscriptions.created_at` | `timestamptz` | absolute instant |
| `orders.created_at`, `payments.created_at` | `timestamptz` | absolute payment/order instant |
| `orders.total_amount`, `payments.amount` | `numeric` | **money — never derived from any date** |
| `gyms.paid_until` | `date` | platform-billing coverage date |
| `platform_subscriptions.started_at`, `renews_at` | `timestamptz` | absolute instants |

---

## Confirmed Findings

| ID | RPC | Root Cause | Impact | Severity | Confidence |
|---|---|---|---|---|---|
| **F-01** | `activate_queued_subscription` | `CURRENT_DATE SESSION-TIMEZONE BUG` — `v_start_date := current_date` persisted to `subscriptions.start_date` | An activation in the ~00:00–03:00 gym-local window stores `start_date` = *yesterday* (UTC) instead of *today* (gym-local): +1 nominal coverage day, at the **front, in the already-past (unbookable) direction**. `end_date` is caller-provided (browser-local) — unaffected. No money. | **P2** | HIGH |
| **F-02** | `create_subscription` | `CURRENT_DATE SESSION-TIMEZONE BUG` — `v_today := current_date` drives the "member already covered today?" branch | A renewal created in the ~00:00–03:00 gym-local window on the day *after* the old subscription lapsed can be mis-classified as "still covered" → new subscription is **queued instead of activated**. Recoverable (admin activates the queued row; or it resolves next day). Queued-row placeholder dates are transient (overwritten on activation). No money. | **P2** | HIGH |
| **F-03** | `set_gym_paid_until` | `CURRENT_DATE SESSION-TIMEZONE BUG` (latent) — `current_date` in the `gyms.is_active` auto-reactivation `CASE` | A platform-admin `paid_until` change in the gym-local danger window could flip `gyms.is_active` one day early/late. `gyms.paid_until` itself is the admin's explicit input — unaffected. Trivial recovery (re-save). **Zero gyms currently have `paid_until` set — never exercised.** No money. | **P3** | HIGH (that it is tz-dependent); impact LOW |

Adjacent (noted, **not** in this ADR's core Financial scope): `get_membership_summary`
uses `CURRENT_DATE` for `memberships_expiring_7d`/`_30d` counts — Dashboard-domain,
display-count only, same class as the resolved `dashboard_resolve_window` finding;
fold into a future dashboard-hardening pass, not this Financial ADR.

**No revenue / MRR / ARR / invoice / VAT / accounting-period RPC exists** in the
platform (confirmed — the revenue dashboard is a known unbuilt gap). No money amount
anywhere is derived from `current_date` or any date value.

---

## Date/Time Categories

| Category | Definition | Financial columns/values | Correct handling |
|---|---|---|---|
| **Absolute instant** | a moment money moved / a row was written / a renewal fires | `orders.created_at`, `payments.created_at`, `platform_*.created_at/started_at/renews_at`, `now()` in the payment/order/platform RPCs | `timestamptz` + `now()` — **already correct, no change** |
| **Subscription date** | the gym-local calendar day a subscription's coverage starts/ends | `subscriptions.start_date`, `subscriptions.end_date` | gym business calendar `date`; server-derived "today" should be gym-local |
| **Platform-billing date** | the gym-local calendar day the gym's Forge subscription is paid through | `gyms.paid_until` | gym business calendar `date` (admin-supplied); server-derived "today" should be gym-local |
| **Reporting period** | a day/week/month window used to bucket records for a report | *(none in Financial today)* | explicit gym business timezone **if/when built** |
| **Accounting period** | a fiscal/tax period boundary | *(none — no invoicing/accounting exists)* | **requires an explicit accounting/tax-policy decision — not a technical choice** |

---

## Current Timezone Behavior

`current_date` = the date component of `now()` **in the session timezone**
(`(now() AT TIME ZONE current_setting('TimeZone'))::date`). Production session
timezone is UTC, so `current_date` = the UTC calendar date, which trails the
gym-local date by one for ~2–3 hours after each gym-local midnight. The
comparisons that *consume* the resulting `date` values (`start_date <= class.date`,
`end_date >= class.date` — both `date`) are themselves timezone-safe
(`FORGE_DATE_TIME_POLICY.md` §9); only the **stored/derived "today" value** is wrong.

---

## Proposed Policy

1. **Absolute instants stay `timestamptz` + `now()`** — no change. Payment time,
   order time, renewal time, row-creation time are moments, not gym calendar days.
2. **A subscription's `start_date` / `end_date` and `gyms.paid_until` are gym
   business calendar dates.** Any server-side "today" used to set or compare them
   must be the **gym-local** date:
   `(now() AT TIME ZONE 'Europe/Bucharest')::date`
   — identical pattern to the approved P0-01 / `dashboard_resolve_window` /
   `m9_publish_waiver` fixes.
3. **Reporting-window and accounting-period bucketing of `timestamptz` columns is
   deferred.** No such reporting exists. When it is built, the "which gym-local day
   does a payment instant belong to?" question (and, separately, "which fiscal
   period?") must be answered explicitly by the owner/accountant — it is **not**
   settled by this ADR.

---

## Europe/Bucharest Scope

`Europe/Bucharest` here is the **current single-gym Romania deployment's business
timezone**, applied server-side exactly where a gym-local calendar day is meant —
the same explicit constant already approved for `enforce_class_deletion_policy`,
`dashboard_resolve_window`, and `m9_publish_waiver`. It is **not** a generic
multi-timezone architecture. **`gyms.timezone` is NOT introduced.** A second gym in
another country would require a stored per-gym timezone and a separate design; that
is out of scope here and explicitly deferred.

---

## Financial Decisions Required

### DECISION F-01 — `activate_queued_subscription` start date
- **Question:** When a queued subscription is activated, should its stored
  `start_date` be the **gym-local** calendar day of activation (rather than the
  UTC date)?
- **Why it matters:** In the ~00:00–03:00 gym-local window the current code stores
  *yesterday*. It is a persisted business date on a live entity that gates class
  booking.
- **Option A:** Change `v_start_date := current_date` →
  `v_start_date := (now() AT TIME ZONE 'Europe/Bucharest')::date`.
- **Option B:** Leave as-is (accept a ~2–3h/night off-by-one that only ever widens
  coverage backward into the unbookable past).
- **Recommended:** **Option A.** Consistent with every other approved server-side
  date fix; removes a genuine (if low-frequency, low-blast-radius) persisted-data
  defect.
- **Consequence of A:** For activations in the danger window, `start_date` becomes
  one day later than it would today. No money, no forward-entitlement change, no
  API-shape change. Zero historical rows are affected (see Historical Impact).

### DECISION F-02 — `create_subscription` "already covered today?" check
- **Question:** Should the check that decides *queued vs active immediately* use
  the **gym-local** today?
- **Why it matters:** A renewal at gym-local 00:00–03:00 the day after the old
  subscription lapsed can be wrongly seen as "still covered" and queued instead of
  activated.
- **Option A:** Change the two `current_date` uses (`v_today`) →
  `(now() AT TIME ZONE 'Europe/Bucharest')::date`.
- **Option B:** Leave as-is (recoverable UX quirk; admin can activate the queued
  row).
- **Recommended:** **Option A**, in the same change as F-01 (same function family,
  same one-line pattern).
- **Consequence of A:** Renewals created in the danger window on the post-lapse day
  now activate immediately instead of queuing. This can, in that window, cause an
  order to be created immediately (it would have been created on activation
  anyway). No money amount changes. The queued-placeholder dates also become
  gym-local (cosmetic; overwritten on activation).

### DECISION F-03 — `set_gym_paid_until` reactivation gate
- **Question:** Should the platform-billing auto-reactivation `CASE` use gym-local
  today?
- **Why it matters:** Low — platform-admin-only, `gyms.paid_until` is admin input,
  only `gyms.is_active` could flip a day early/late, trivially re-savable, and
  **no gym currently has `paid_until` set**.
- **Option A:** Change both `current_date` uses →
  `(now() AT TIME ZONE 'Europe/Bucharest')::date`.
- **Option B:** Leave as-is (P3, latent).
- **Recommended:** **Option A**, opportunistically bundled with F-01/F-02 (one
  migration, three tiny expression swaps) — or explicitly deferred as P3 if the
  owner prefers the smallest possible change.
- **Consequence of A:** None observable today (function's date branch has never
  had a persisted effect).

### DECISION F-04 — accounting-period / reporting-day policy (NOT NEEDED NOW)
- **Question:** If/when Forge builds revenue reporting that buckets
  `payments.created_at` by day, which calendar day does a payment made at, e.g.,
  `21:30 UTC` (= `00:30 Europe/Bucharest`) belong to — and, separately, which
  fiscal/VAT period?
- **Why it matters:** Only when such reporting is built. It is an
  **accounting/business decision**, not a technical one; Romanian tax-law
  treatment of period boundaries is explicitly out of scope for this ADR and
  must involve the owner and, if relevant, an accountant.
- **Recommended:** No action now. Flag as a prerequisite decision for any future
  revenue-reporting feature.

---

## Options Considered

For F-01/F-02/F-03 the only real alternative to the `AT TIME ZONE 'Europe/Bucharest'`
constant is a stored per-gym timezone (`gyms.timezone`) — rejected for this ADR
(single gym, out of scope, matches every prior approved fix's decision). A third
option — set the DB session/role timezone to `Europe/Bucharest` globally — is
rejected: it is a blunt instrument that would silently change every other
`current_date`/`now()::date`/`date_trunc` site at once (including ones not
audited), and it is exactly the "do not add `SET timezone` as a global workaround"
anti-pattern already rejected in the P0-01 fix.

---

## Recommended Decision

**Approve F-01 + F-02 together** (one migration, `create_subscription` +
`activate_queued_subscription`, `current_date` → `(now() AT TIME ZONE
'Europe/Bucharest')::date`, ~3 expression swaps, business rules otherwise
byte-identical). **Approve F-03 in the same migration** unless the owner wants the
minimal change, in which case defer F-03 as P3. **F-04: no action** (record the
decision requirement for a future reporting feature).

*Recommendation only. NOT AUTHORIZED. No implementation in this mission.*

---

## Proposed Technical Changes

*(Hypothetical — for owner review. NOT implemented.)*

### `create_subscription`
```
- v_today date := current_date;
+ v_today date := (now() AT TIME ZONE 'Europe/Bucharest')::date;
```
Everything else unchanged: the coverage lookup, the queued/active branch, the
placeholder insert, order/payment creation.

### `activate_queued_subscription`
```
- v_start_date date := current_date;
+ v_start_date date := (now() AT TIME ZONE 'Europe/Bucharest')::date;
```
`end_date` (`p_end_date`), the auth checks, the order-paid guard (`FRG02`), the
`is_active`/`queued` updates — all unchanged.

### `set_gym_paid_until` (if F-03 approved)
```
- when is_active = false and (paid_until is null or paid_until < current_date) and p_paid_until >= current_date
+ when is_active = false and (paid_until is null or paid_until < (now() AT TIME ZONE 'Europe/Bucharest')::date) and p_paid_until >= (now() AT TIME ZONE 'Europe/Bucharest')::date
```
(or a local `v_today` variable). `p_paid_until` and the `paid_until` assignment
unchanged.

Signatures, return shapes, `SECURITY DEFINER`, `search_path`, owner, all GRANTs,
all auth checks: **unchanged**.

---

## Type-Level Proof

| | old | new |
|---|---|---|
| expression | `current_date` | `(now() AT TIME ZONE 'Europe/Bucharest')::date` |
| PostgreSQL type | `date` | `date` |
| `now()` type | — | `timestamp with time zone` (absolute instant) |
| `now() AT TIME ZONE 'Europe/Bucharest'` | — | `timestamp without time zone` (gym-local wall-clock) |
| `(…)::date` | date-in-session-tz of the instant | date part of the gym-local wall-clock |
| session-timezone dependence | **yes** — `= (now() AT TIME ZONE current_setting('TimeZone'))::date` | **no** — the zone is pinned to `'Europe/Bucharest'` explicitly; `now()` is absolute; the session setting is never read |
| DST | n/a | IANA zone applies EET/EEST automatically for the instant's date; no fixed `+02`/`+03` |

Result type is unchanged (`date`), so no caller, cast, or comparison downstream
changes.

---

## Expected Result Changes

- **Money totals / amounts:** no change (never derived from these dates).
- **Active-member counts:** no change in the general case; in the danger window a
  renewal that today queues would instead activate (F-02) → `active` count +1 /
  `queued` count −1 for that member, for that window.
- **`subscriptions.start_date` stored value:** in the danger window, one day later
  than today's behaviour (F-01) — otherwise identical.
- **Historical dashboard reports:** no change (no report consumes these RPCs'
  `current_date`; `get_membership_summary` is separate and not in this change).
- **API return shape:** unchanged.
- **Cached values:** none.
- **Invoices / accounting exports:** none exist.
- **Subscription entitlement:** F-01 narrows a subscription's nominal window by the
  one (past, unbookable) day it currently over-grants in the danger window; F-02
  can move a renewal from `queued` to `active` sooner. Neither grants nor removes
  any *forward* class-booking right.

---

## Historical Impact

Read-only, aggregate, production, this mission:

- `subscriptions`: **229 rows** (218 active/ended, 11 queued). Rows created during
  a UTC-vs-`Europe/Bucharest` date-divergence window: **0**. Rows where
  `start_date` = the UTC creation date *and* that differs from the gym-local
  creation date: **0**.
- `gyms`: **3 rows, 0 with `paid_until` set** → `set_gym_paid_until`'s date branch
  has never had a persisted effect.

**Classification (all three findings): NO EVIDENCE** of historical impact.

---

## Historical Remediation

**Not required** — no evidence any historical row was affected. (If the owner
nonetheless wants a defensive sweep, it would be a read-only re-scan of
`subscriptions` for any `start_date` inconsistent with `created_at`'s gym-local
date; there are currently zero such rows, and no remediation SQL is produced by
this mission.)

---

## Accounting/Tax Considerations

- **No accounting, invoicing, VAT, or fiscal-period logic exists** in any Financial
  function today. Nothing in this ADR touches an accounting period.
- The **only** accounting/tax-flavoured question is **DECISION F-04**, which is
  **not needed now** and, when it becomes relevant, must be decided by the owner
  (and an accountant if appropriate) — this ADR makes **no** Romanian tax-law
  assumption and proposes **no** default for it.

---

## Security

Must remain **unchanged**: `SECURITY DEFINER` on all three RPCs, `search_path =
public`, owner `postgres`, every `is_admin(...)` / `is_platform_admin()` /
`auth.jwt() ->> 'role' = 'service_role'` / owner-self check, all function GRANTs,
all RLS on `subscriptions`/`orders`/`payments`/`gyms`. A hypothetical
implementation is a `CREATE OR REPLACE FUNCTION` with the same signature and
attributes; a focused security re-verification would confirm attributes post-deploy.
Security Gate remains **GREEN**.

---

## Testing Required

*(For a future implementation — designed here, not run.)*

| # | Case | Expectation |
|---|---|---|
| 1 | Normal daytime activation | `start_date` = today (unchanged) |
| 2 | Activation at 00:30 gym-local (UTC = prev day) | `start_date` = gym-local today (was: prev day) |
| 3 | Winter (EET) danger-window instant | correct gym-local date |
| 4 | Summer (EEST) danger-window instant | correct gym-local date |
| 5 | Month rollover in the danger window | correct gym-local month/day |
| 6 | Year rollover (Dec 31 23:30 UTC → Jan 1 gym-local) | `start_date` in the new year |
| 7 | `create_subscription`: existing sub `end_date` = yesterday-gym-local, renewal at 00:30 gym-local | new sub **active**, not queued |
| 8 | `create_subscription`: existing sub `end_date` = today-gym-local, renewal now | new sub **queued** (unchanged) |
| 9 | Subscription end-date boundary: class on `end_date` | still covered (inclusive — unchanged) |
| 10 | Same instant under `SET TIME ZONE 'UTC'` and `'Europe/Bucharest'` and `'America/New_York'` | identical `start_date` / branch outcome |
| 11 | `set_gym_paid_until` at 00:30 gym-local with `p_paid_until` = gym-local today | reactivates iff intended |
| 12 | Payment/order/refund RPCs | untouched — `created_at` still `now()`, amounts unchanged |
| 13 | Stripe-webhook activation path | `start_date` = gym-local today |
| 14 | Regression: WOD-SIMPLE full suite | green |

---

## Rollback Strategy

*(Conceptual.)* Each change is one `CREATE OR REPLACE FUNCTION` reverting the
expression to `current_date`. No schema change, no data migration, so rollback is
a single re-deploy of the prior function body. No historical backfill to undo.

---

## Risks

- **Technical:** minimal — a 1-token expression swap in 2–3 functions, same
  pattern proven 3× this cycle; the main risk is an incomplete swap (miss one
  `current_date`) — mitigated by the test matrix and a post-deploy `pg_get_functiondef`
  read.
- **Business:** F-02's queued-vs-active branch flips for danger-window renewals —
  desirable, but the owner should confirm they *want* those to activate
  immediately rather than queue.
- **Accounting:** none from this ADR (no accounting logic touched). The separate
  F-04 question must not be conflated with F-01/F-02/F-03.
- **Scope:** resist widening to `get_membership_summary` or any non-Financial
  `current_date` site in the same migration.

---

## Decision

**PENDING OWNER APPROVAL.**
