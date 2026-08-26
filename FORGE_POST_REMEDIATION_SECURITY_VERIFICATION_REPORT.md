# FORGE — Post-Remediation Security Verification Report

Investigation-only, read-only. No code, schema, RLS, grants, functions, migrations, or production data were changed. All live tests used disposable rows inside `BEGIN`/`ROLLBACK` transactions, or count-only reads of real data (never printing PII values).

---

## 1. Executive Verdict

## RED — one new, live, unauthenticated P0 was discovered during this verification.

SEC-01 and SEC-02 are both confirmed fixed and holding. However, this verification surfaced a **new** finding — `wod_logs_with_context`, a view not touched by any prior mission, is missing `security_invoker` and is fully readable by a completely anonymous caller: **399/399 real production `wod_logs` rows** (every member's workout results, times, notes, weights) are live-exposed with no authentication at all. This is not a regression from SEC-01/SEC-02 — it is a pre-existing condition this verification's more exhaustive view sweep caught that the original gate's narrower query missed.

---

## 2. SEC-01 Post-Fix Verification

`subscriptions_restrict_member_update()` re-read live: matches the committed migration byte-for-byte. Fresh live attack tests (disposable row, rolled back, distinct from the prior mission's own tests) against **every** column in the Subscription Authority Matrix:

| Field attacked (as the row's own member, direct client call) | Result |
|---|---|
| `is_active = true` | DENIED |
| `end_date = '2099-12-31'` | DENIED |
| `sessions_total = 999` | DENIED |
| `plan_id = <random>` | DENIED |
| `queued = true` | DENIED |
| `start_date = '2020-01-01'` | DENIED |
| `member_email = 'attacker@...'` | DENIED |
| `notes = 'pwned'` | DENIED |
| `gym_id = <random>` | DENIED (separate `prevent_gym_id_change` trigger, unconditional for all callers) |
| `sessions_used` moved by 2 (semantic attack — not is_active, but still trying to gain something via a different column) | DENIED — `sessions_used may only change by 1 at a time` |
| `sessions_used` +1 (own booking) | **ALLOWED** — the one intended member mutation |
| `sessions_used` -1 (own cancellation) | **ALLOWED** — the one intended member mutation |

No equivalent-entitlement path was found reachable through any other column. **SEC-01 holds.**

## 3. SEC-02 Post-Fix Verification

`delete_member_future_bookings` (any signature) — confirmed **zero matches** in `pg_proc` by name pattern (`%delete_member%booking%`, `%future_booking%`), ruling out an alias, overload, or renamed replacement. Live call attempt as `anon`: `ERROR 42883: function delete_member_future_bookings(...) does not exist`. **SEC-02 holds**, unconditionally (not dependent on any grant state — the function is gone).

## 4. P0-SEC-01 Regression

`member_domain_consistency_detail`: zero `anon`/`authenticated` grants (re-queried fresh), `security_invoker = true` retained. Live `anon` SELECT attempt: `ERROR 42501: permission denied for view member_domain_consistency_detail`. `auth_users_exposed` re-confirmed not live-exploitable — this remains the only view in the database with any `auth.users` dependency (re-ran the full `pg_depend` catalog scan). **P0-SEC-01 holds.**

## 5. Subscription Trust-Boundary Verification

`activate_queued_subscription` re-tested live post-fix (admin-authorized branch, exercising the same internal `UPDATE` the self-service branch also performs): **succeeded**, `is_active`/`queued`/`end_date` all updated correctly through the `current_user = 'postgres'` trust path. This trust boundary **cannot be obtained by an ordinary API caller**: PostgREST always connects as `anon`, `authenticated`, or `service_role` depending on the presented key/JWT — never as `postgres` — and `current_user` only becomes `postgres` for the duration of executing a `SECURITY DEFINER` function owned by `postgres` (a Postgres language guarantee, not a policy choice an attacker can influence). A client cannot set `current_user` via any request header, JWT claim, or RPC argument; the only way to cause `current_user = 'postgres'` during a `subscriptions` write is to actually invoke one of the platform's own already-authorization-checked `SECURITY DEFINER` functions, at which point that function's own internal checks (payment/admin/ownership) have already run first.

## 6. RLS / Tenant-Isolation Verification

Policy counts for every representative table re-checked and found **identical** to the original gate's baseline (no drift): `bookings`=5, `classes`=4, `members`=2, `personal_records`=5, `pr_events`=1, `profiles`=3, `skill_logs`=4, `subscriptions`=4, `wod_logs`=4, `workouts`=4. All 49 public tables still have RLS enabled (0 without). `profiles.gym_id` tenant-hop protection (`prevent_profiles_gym_id_change`) not touched by either SEC fix, still the sole cross-tenant chokepoint, still unconditional.

**However**, RLS on `wod_logs` itself is currently **moot for one specific access path**: see §14 — the `wod_logs_with_context` view bypasses it entirely for `anon`/`authenticated` readers, regardless of how correct the underlying table's own RLS policies are.

## 7. SECURITY DEFINER Re-Check

91 `SECURITY DEFINER` functions in `public` today (function-count queries between sessions aren't directly comparable due to overload-counting differences in how each query was phrased; the reliable comparison is the **full anon-granted function list**, re-pulled fresh and compared name-for-name against the original gate's list). Result: **identical**, except `delete_member_future_bookings` is now absent, as expected. No new anon/authenticated-granted `SECURITY DEFINER` function has appeared. No second SEC-02-class problem (missing authorization + destructive/financial capability + broad grant) was found among any function.

## 8. Anonymous Attack Surface

Re-confirmed the previously-safe surface is still safe (the `gyms` public-directory policy, join-code/signup-code RPCs, etc. — unchanged). **New finding**: `wod_logs_with_context` is now known to give a fully anonymous caller (public URL + anon key, zero login) unrestricted read access to **every** row of `wod_logs` platform-wide — member workout results, times, notes, weights, `log_meta`. Live-verified: `anon` SELECT returned all 399 real rows (count-only check; no row contents printed). This is a genuine, unexpected, private-data exposure — flagged per this mission's explicit item 7 instruction ("flag any unexpected private data").

## 9. Authenticated Member Attack Surface

No ability to modify paid entitlement (§2), no ability to modify another member's data (unchanged from the original gate — `member_id = auth.uid()` scoping intact everywhere else checked), no Admin-operation bypass found, no destructive-operation bypass beyond what's already fixed. Cross-gym data access: the same `wod_logs_with_context` gap applies equally (or worse) to `authenticated` — an ordinary member can read every other gym's WOD logs through this view, not just their own gym's.

## 10. Current Security Advisor Findings

No Management API token available in this environment; replicated via direct catalog inspection as in both prior missions.

- `auth_users_exposed`: **RESOLVED**, re-confirmed (§4).
- RLS-disabled public tables: **zero**.
- Views with unsafe security mode reachable by `anon`/`authenticated`: **one — `wod_logs_with_context`** (newly surfaced by this verification's exhaustive, unfiltered sweep of all 15 views; the original gate's query filtered on `reloptions IS NOT NULL`, which structurally cannot surface a view whose `reloptions` is `NULL` — an analysis gap in that report, not a new regression in the database).

## 11. SEC-03 Status

Re-evaluated, not fixed (per explicit instruction). Still classified **P2**. It is not itself currently exploited against any object with a correct RLS/security_invoker configuration — every other checked table/view remains correctly protected by RLS or `security_invoker` despite the broad default grant. It does **not** independently create a P0/P1 blocker on its own. (It is, however, the same root-cause class of defect that made `wod_logs_with_context`'s gap actually reachable by `anon` at all — without the broad default `SELECT` grant, a missing `security_invoker` on an otherwise-correct view would be far less consequential. This connection is noted, not acted on.)

## 12. Closed-P0 Regression

```text
P0-01     = intact (trigger re-read live, byte-for-byte identical)
P0-02     = intact (pure client-side work, no DB objects to regress; not touched by any SEC mission)
P0-SEC-01 = intact (§4)
P0-SEC-02 = intact (§2, §3)
```

## 13. Production-Data Safety Confirmation

```text
Real production subscriptions modified: 0
Real production bookings deleted: 0
Real production auth/member data modified: 0
```

All tests used disposable rows (synthetic ids/emails, real `gym_id`/profile-`id` referenced only as valid FK targets) inside transactions explicitly `ROLLBACK`'d, or count-only reads of real data with zero row contents ever printed or logged.

## 14. Newly Discovered Finding

### SEC-05 — `wod_logs_with_context` view lacks `security_invoker`, exposing all member workout logs to fully anonymous callers

**Severity: P0**

**Evidence**: `public.wod_logs_with_context` (owner `postgres`, a plain join of `wod_logs` and `wods` with no filtering) has `reloptions = NULL` — no `security_invoker` — and is granted `SELECT` (and inert DML privileges) to both `anon` and `authenticated`. Since it lacks `security_invoker`, it executes with the view owner's privileges, bypassing every RLS policy on the underlying `wod_logs`/`wods` tables. **Live-reproduced**: a fully anonymous `SET LOCAL ROLE anon` session was able to `SELECT count(*) FROM wod_logs_with_context` and receive **399**, matching the real, total, unfiltered row count of `wod_logs` (confirmed separately as `postgres`) — i.e., every single real workout log row in production, across every gym, is readable with no authentication.

**Realistic exploit scenario**: anyone with only the public Supabase project URL and the public anon/publishable key (both intentionally public, per this platform's own stated model) can query `GET /rest/v1/wod_logs_with_context` directly and retrieve every member's workout results, finish times, personal notes, and logged weights — a full, unauthenticated PII/fitness-data exposure. Its sibling view, `skill_logs_with_context`, was checked and correctly has `security_invoker = true` — this is an isolated gap on this one view, not a systemic pattern (all 14 other `anon`-granted views were individually re-confirmed to have `security_invoker = true` in this same verification pass).

**Not caused by any prior mission**: not referenced or touched by any P0-01/P0-02/P0-SEC-01/P0-SEC-02 migration. A pre-existing condition, newly surfaced only because this verification re-queried all 15 views without the filter that hid it in the original gate report.

**Recommended fix** (not applied — investigation only): `ALTER VIEW wod_logs_with_context SET (security_invoker = true);`, matching the pattern already correctly used on all 14 sibling views including `skill_logs_with_context`. Should be verified against real member-facing consumers before applying (the view is presumably used by legitimate `authenticated` reads today — `security_invoker` should make it correctly RLS-filtered for them, not break it, since `wod_logs`'s own RLS already correctly scopes to `member_id = auth.uid()`/gym — but this needs its own confirm-before-fix pass, same discipline as P0-SEC-01/02).

**Confidence: HIGH** — live-reproduced against production (count-only, no PII), not inferred.

---

## 15. Final Answer

> "Is Forge now safe enough from an authorization, data-exposure and financial-integrity perspective to resume P0-03 timezone work?"

## NO

SEC-01 and SEC-02 are both genuinely and thoroughly fixed — every test in this independent re-verification passed. But this same verification pass surfaced a new, live, unauthenticated P0 (SEC-05: `wod_logs_with_context`) that was not part of either prior fix mission and was not caught by the original gate's narrower query. The exact blocker: **a fully anonymous caller can currently read all 399 real `wod_logs` rows (every member's workout results, notes, and weights, platform-wide) through `public.wod_logs_with_context`, which lacks `security_invoker` unlike every one of its 14 sibling views.** Recommend a narrowly-scoped fix mission for SEC-05 (verify the one-line `security_invoker` fix against real consumers, apply, live-test anon denial + legitimate member access preserved) before resuming P0-03.
