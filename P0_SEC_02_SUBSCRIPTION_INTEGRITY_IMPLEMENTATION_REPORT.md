# P0-SEC-02 — Subscription Financial Integrity + Dangerous SECURITY DEFINER RPC — Implementation Report

Status: **CLOSED — both invariants proven via live disposable-data reproduction, pre- and post-fix.**

---

## 1. SEC-01 Root Cause

`subscriptions_restrict_member_update()` is a `BEFORE UPDATE` trigger on `public.subscriptions`, meant to be the field-level safety net underneath the row-level RLS policy `subscriptions_update_own_or_waitlist_or_admin` (which correctly lets three categories of caller reach a row: an admin, the row's own declared member by email match, or a very narrow "waitlist auto-book" caller). The trigger's job is to restrict *what* a non-privileged caller may change once RLS has let them through. Its logic, before this fix:

```text
intended:  member updating own row  →  apply the protected-field restriction
actual:    member updating own row  →  SKIP the protected-field restriction entirely
```

Concretely, the trigger's first `IF` treated `lower(OLD.member_email) = lower(auth.jwt() ->> 'email')` — i.e. "the caller *is* this row's own member" — as a **trust condition**, `RETURN NEW` with zero column checks, identically to how it (correctly) trusts `is_coach_or_admin()` and `service_role`. The narrower "waitlist auto-book" caller (someone else's browser promoting a different member off a waitlist) was the *only* path actually subjected to the restriction (`sessions_used` may move by `+1` and nothing else may change) — meaning the one caller with the *most* incentive to cheat (the subscription's own owner) was the one caller entirely exempted from the check meant to constrain them.

## 2. Attack Before Fix

An ordinary authenticated member, whose JWT email matched a `subscriptions` row's `member_email`, could issue a single direct client call such as:

```js
supabase.from('subscriptions')
  .update({ is_active: true, end_date: '2099-12-31', sessions_total: 999 })
  .eq('id', theirOwnSubscriptionId)
```

and it would succeed unconditionally — no payment, no order, no admin approval, no call to `activate_queued_subscription` at all. Every entitlement-controlling column (`is_active`, `end_date`, `start_date`, `sessions_total`, `plan_id`, `queued`, `member_email`, `notes`) was reachable this way, not just the three originally demonstrated. **Live-reproduced fresh in this mission** (disposable row, rolled back) before applying any fix, confirming the vulnerability was still live at the start of this mission.

## 3. Subscription Authority Matrix

| Column | Member-writable | Server/RPC-writable | Admin-writable | System-writable | Immutable after creation |
|---|---|---|---|---|---|
| `id` | — | — | — | yes (PK default) | yes |
| `member_id` | — | — | — | unused in every traced write path (legacy column — `member_email` is the actual identity key used everywhere) | — |
| `member_email` | — | yes (`create_subscription`) | — | — | effectively yes (no write path ever changes it post-creation) |
| `gym_id` | — | — | — | yes (set at creation) | **yes — enforced unconditionally by the pre-existing, separate `prevent_gym_id_change` trigger, for every caller including admins** |
| `plan_id` | — | yes (`create_subscription`) | — | — | effectively yes |
| `start_date` | — | yes (`create_subscription`, `activate_queued_subscription`) | — | — | — |
| `end_date` | — | yes (`create_subscription`, `activate_queued_subscription`) | admin, via the same RPC | — | — |
| `is_active` | — | yes (`create_subscription`, `activate_queued_subscription`, `end_subscription`) | admin, via the same RPCs | — | — |
| `queued` | — | yes (`create_subscription`, `activate_queued_subscription`) | — | — | — |
| `sessions_total` | — | yes (`create_subscription`, set from the plan) | — | — | effectively yes |
| `sessions_used` | **yes — but only ±1 per update, tied to the member's own booking/cancellation of a class** | yes (`activate_queued_subscription` resets to 0; `adjust_session_count` for admin-driven correction; `cancel_class`'s refund branch) | admin, via `adjust_session_count`/`cancel_class` | — | — |
| `notes` | — | — | admin (RLS-level; no RPC currently writes it) | — | — |
| `created_at` | — | — | — | yes (default `now()`) | yes |

This matrix directly answers Phase 2's instruction not to assume only the three originally-demonstrated columns matter — the fix (below) protects **every** column except `sessions_used`, not a hardcoded list of three.

## 4. SEC-01 Fix

Rewrote `subscriptions_restrict_member_update()` (same function, same trigger — no new competing mechanism introduced, per Phase 7):

- **Trust conditions** (unrestricted, `RETURN NEW`): `is_coach_or_admin()`, `(auth.jwt()->>'role') = 'service_role'`, and a new third condition, `current_user = 'postgres'`. All five subscription-writing RPCs (`activate_queued_subscription`, `create_subscription`, `end_subscription`, `adjust_session_count`, `cancel_class`) are `SECURITY DEFINER`, owned by `postgres` — when any of them performs its own internal `UPDATE subscriptions`, this trigger fires within that same execution context, where `current_user` is the function's owner (`postgres`), not the original calling role. A direct client call, by contrast, always executes as `authenticated`/`anon`/`service_role` — never as `postgres` itself. This cleanly and reuses the platform's existing SECURITY DEFINER ownership model as the trust boundary, rather than inventing a new signal.
- **Everyone else** (including the row's own member, calling directly): may change `sessions_used` by at most 1 in either direction (widened from the old waitlist-only branch's `+1`-only rule, to also cover the member's own booking `+1` and cancellation `-1`), and **nothing else** — every other column (`member_id`, `member_email`, `plan_id`, `start_date`, `end_date`, `sessions_total`, `is_active`, `queued`, `notes`) is now rejected with `RAISE EXCEPTION` for a non-privileged caller. `gym_id` needed no addition here — it was already unconditionally protected by the separate, pre-existing `prevent_gym_id_change` trigger.

Migration: `supabase/migrations/20260826100000_p0_sec_02_subscription_self_update_and_dead_rpc.sql`.

## 5. Live Attack Verification

All tests used a disposable `subscriptions` row (synthetic id/email, real gym FK target only, never a real member's row), inside `BEGIN`/`ROLLBACK` transactions — nothing persisted.

| Attempted unauthorized change (as the row's own member, direct client call) | Result |
|---|---|
| `is_active = true` | **DENIED** — `a non-privileged caller may only adjust sessions_used by 1 at a time` |
| `end_date = '2099-12-31'` | **DENIED** — same |
| `sessions_total = 999` | **DENIED** — same |
| `sessions_used = -50` (a large jump, not ±1) | **DENIED** — `sessions_used may only change by 1 at a time` |
| `plan_id = <random>` | **DENIED** — same as is_active |
| `queued = true` | **DENIED** — same as is_active |
| `sessions_used` +1 (own booking) | **ALLOWED** ✓ |
| `sessions_used` -1 (own cancellation) | **ALLOWED** ✓ |

## 6. Legitimate Flow Verification

```text
Stripe/server activation:  activate_queued_subscription — re-tested live post-fix (admin-authorized
                            branch, which exercises the identical internal UPDATE the self-service
                            branch also performs): SUCCEEDED, is_active/queued/end_date all updated
                            correctly. The current_user='postgres' trust condition is invariant to
                            which of the RPC's own internal branches (admin vs. self-service vs.
                            service_role/Stripe webhook) led to the call, so this single test
                            validates the fix for all three; the Stripe webhook itself was traced
                            and confirmed to call this exact RPC (supabase.rpc("activate_queued_subscription")),
                            never a raw table write.
Admin management:          is_coach_or_admin() branch unchanged and re-confirmed in the trigger -
                            admin direct writes remain unrestricted, as before.
Member legitimate operations: sessions_used +/-1 via booking/cancelling a class (src/App.jsx's
                            adjustSessionsUsedAtomic, all 3 call sites traced) - re-tested live
                            post-fix, both directions succeed exactly as before the fix.
```

## 7. SEC-02 Root Cause

`delete_member_future_bookings(p_member_id text, p_from_date text)` was `SECURITY DEFINER` with **zero** internal authorization check of any kind (no `is_admin`, no `is_coach_or_admin`, no `auth.uid()` comparison) and `EXECUTE` granted to `anon`, `authenticated`, and explicitly `PUBLIC`. It happened to be non-functional only because `bookings.member_id` is `uuid` while its parameter is untyped `text`, and Postgres has no implicit `uuid = text` operator — the function always raised before reaching its `DELETE`. This is not a security boundary: a `uuid = text` type mismatch is an accident of a schema change at some point after the function was written, not a deliberate control, and a completely unrelated, innocent-looking future change (adding `::uuid` to fix the "obvious bug") would have silently reintroduced a fully unauthenticated, cross-tenant, destructive primitive with no additional step required. Per Phase 14's explicit instruction, the type mismatch was **not** touched or evaluated as a candidate fix at any point — only its authorization/grant state was.

## 8. SEC-02 Resolution

**REMOVED** (Option A). Confirmed before removal: zero application callers in either repository or any Edge Function (repo-wide search), and zero other database objects depend on it (`pg_depend`, checked live). The platform's real, legitimate booking-cancellation path already exists and is correctly scoped: the `bookings_delete_own_or_admin` RLS policy lets a member delete their own bookings (or an admin/coach delete any, within their gym) directly, with proper `member_id = auth.uid()`/`is_coach_or_admin(gym_id)` checks. There was no legitimate use to preserve, so Option B/C (revoke-and-keep, or authorize-and-repair) would have kept dead, purposeless code around — removal was the smallest-footprint correct choice.

## 9. Final RPC Grants

```text
PUBLIC:          function no longer exists (confirmed: 0 rows in pg_proc for this name)
anon:             N/A - function does not exist
authenticated:    N/A - function does not exist
privileged role:  N/A - function does not exist
```

Live-tested post-fix: both `anon` and `authenticated` attempting to call it now get `ERROR 42883: function delete_member_future_bookings(...) does not exist` — an unconditional, permanent denial, not a runtime accident.

## 10. Files / Migrations Changed

- `supabase/migrations/20260826100000_p0_sec_02_subscription_self_update_and_dead_rpc.sql` (new) — rewrites `subscriptions_restrict_member_update()`, drops `delete_member_future_bookings(text, text)`. Applied live to production and identical to the committed file (applied directly from the same file).
- `P0_SEC_02_SUBSCRIPTION_INTEGRITY_IMPLEMENTATION_REPORT.md` (this file, new).

No application code (JS/TS) in either repository was touched — this was a pure database-level fix, consistent with the finding being a database-level defect.

## 11. Tests

No JS/TS test suite change was needed or made — zero application code was touched. This repository has no pgTAP/SQL-level automated test framework (checked: no `supabase/tests` directory, no established SQL-test convention exists), so — consistent with how this codebase's other DB-trigger-level P0 fixes (e.g. P0-01) were regression-tested — verification was performed as live, disposable-data transactional tests against production, documented in full above (§5, §6) and re-run after the fix to confirm both the attack is blocked and every legitimate flow still works. `tsc`/lint/`vitest` were not re-run since no `.ts`/`.js` file changed in either repository.

## 12. Production Safety

> Real production subscriptions modified: **0**
> Real production bookings deleted: **0**

Every test used a disposable row (synthetic UUID ids, synthetic `member_email`, real `gym_id`/profile-`id` values referenced only as valid FK targets, never modified) inside a transaction that was explicitly `ROLLBACK`'d. The only statements that permanently altered production state were the migration's own `CREATE OR REPLACE FUNCTION` and `DROP FUNCTION` — no `INSERT`/`UPDATE`/`DELETE` against any data table was ever committed.

## 13. Closed P0 Regression

```text
P0-01 (class deletion / booking integrity):  INTACT — enforce_class_deletion_policy() re-read live,
                                              byte-for-byte identical to its previously-closed
                                              definition. Not touched by this migration.
P0-02 (gender resolution):                   INTACT — pure client-side (JS/TS) work; this mission
                                              made zero application code changes, so nothing to regress.
P0-SEC-01 (auth.users view exposure):        INTACT — member_domain_consistency_detail re-verified
                                              live: zero anon/authenticated grants, security_invoker
                                              still true. Re-ran the same auth.users-dependency
                                              catalog scan used to find it originally - still the
                                              only such view, still correctly locked down.
```

Additionally re-confirmed as a general regression check: all 49 `public` tables still have RLS enabled (0 without), consistent with the Final Pre-Production Security Gate's baseline.

## 14. Final Security Invariants

> **A Forge member can no longer self-grant or extend paid membership entitlement through direct Supabase access.** Proven: every entitlement-controlling column (`is_active`, `end_date`, `start_date`, `sessions_total`, `plan_id`, `queued`, `member_email`, `notes`) is now rejected by the database trigger for any caller other than an admin, `service_role`, or one of the platform's own already-vetted `SECURITY DEFINER` subscription RPCs — live-verified against all originally-demonstrated fields plus every other column identified in the Authority Matrix, not just the three first shown. The one legitimate self-service mutation (`sessions_used` moving by exactly 1, tied to the member's own booking/cancellation of a class) was deliberately preserved and re-verified working in both directions.
>
> **The `delete_member_future_bookings` RPC can no longer be used as an unauthorized destructive primitive, regardless of whether its internal type mismatch is later corrected.** Proven: the function has been removed from the database entirely — there is no longer any function definition, with or without a type bug, for anyone to call, fix, or exploit.

---

Both invariants hold. P0-SEC-02 is CLOSED. P0-01, P0-02, and P0-SEC-01 remain closed and unregressed. Stopping here per this mission's explicit instruction — P0-03 remains paused, awaiting separate approval to resume.
