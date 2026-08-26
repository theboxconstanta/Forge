# P0-SEC-03 — `wod_logs_with_context` Anonymous Data Exposure — Implementation Report

Status: **CLOSED — anonymous exposure eliminated, cross-tenant isolation proven through the view itself, all 15 API-exposed views exhaustively re-verified.**

---

## 1. SEC-05 Root Cause

Traced through migration history, not guessed. `public.wod_logs_with_context` was originally created in `20260812090300_results_phase2_slice2_cascade_fix_and_views.sql` **with** `WITH (security_invoker = true)` — that migration's own comment explicitly explains the option is "required, explicitly, not [implied by default]," showing the original author understood the risk correctly. A later migration, `20260822096000_wod_logs_with_context_section_aware.sql`, fixed an unrelated bug (effective-format precedence for non-primary workout sections) via `create or replace view public.wod_logs_with_context as ...` — but did **not** repeat the `WITH (security_invoker = true)` clause. PostgreSQL's `CREATE OR REPLACE VIEW` does not preserve a prior version's storage options when the replacing statement doesn't restate them — the option was silently dropped, and the view has executed with owner (`postgres`) privileges, bypassing RLS on `wod_logs`/`wods` for any caller, ever since.

## 2. Exposure Before Fix

```text
anon access:              YES - unrestricted SELECT, no authentication required
rows exposed:             399 (100% of real production wod_logs rows, every gym)
categories of data exposed: workout results, finish times, personal notes, logged weights,
                           per-set structured data (log_meta/sets), gym affiliation,
                           member id, plus the view's own computed "effective format/name"
                           fields - no password/token/auth-secret data (this was a
                           table-RLS-bypass, not an auth.users exposure)
```

Re-reproduced fresh at the start of this mission (count-only, no row contents ever printed): `anon` role, zero JWT claims, `SELECT count(*) FROM wod_logs_with_context` → **399**.

## 3. View Consumers

Exhaustive repo-wide search (WOD-SIMPLE `src`/`supabase`, forge-admin-web `src`, all Edge Functions, all SQL functions via `pg_get_functiondef` text search): **zero** live consumers of this view. Two comment-only references exist in forge-admin-web (`results/types.ts`, `results/ScoreDisplay.tsx`) describing the view's "effective_*" field semantics defensively (in case a caller ever queries it), but every actual `wod_logs`-reading call site in `results/api.ts` (6 locations) queries the raw `wod_logs` table directly and computes the equivalent "effective" logic client-side instead. The view's own most recent migration comment ("consumed by forge-admin-web's results feature") is now stale relative to the live code. No SQL function or other view depends on it either (`pg_depend`, checked). This made the fix unusually low-risk: no legitimate flow could regress, because none currently uses this view's specific behavior.

## 4. Underlying RLS

`wod_logs` has 4 policies: `wod_logs_select_all` (`gym_id = my_gym_id()`), `wod_logs_insert_own`/`_update_own`/`_delete_own` (`member_id = auth.uid()`). `wods` has its own gym-scoped `SELECT` policy. Intended semantics, unchanged by this mission (already correct, pre-existing, and not part of SEC-05):

```text
ANON:                     no access - my_gym_id()/auth.uid() are NULL, every condition is false
MEMBER A, own gym:        full read of their gym's logs (not just their own row - this is the
                           existing, intentional "gym_id = my_gym_id()" design for wod_logs,
                           matching the product's own leaderboard/journal features - not
                           something this mission introduced or should narrow)
MEMBER A, another member: same as above - already the intended model (gym-wide visibility for
                           logging is a deliberate product choice, distinct from write access,
                           which correctly stays member_id = auth.uid()-scoped)
MEMBER A, another gym:    denied - gym_id = my_gym_id() excludes it
ADMIN:                    reads via the base table directly (forge-admin-web's actual code
                           path) - unaffected by this view either way
```

The view was meant to be a pure read-shape convenience over exactly this same policy set — the bug was never in the RLS itself (which was already correct and untouched), only in the view failing to route through it.

## 5. Chosen Fix

```sql
alter view public.wod_logs_with_context set (security_invoker = true);
```

`ALTER VIEW ... SET` was used directly rather than recreating the view via `CREATE OR REPLACE VIEW` — smaller, safer, cannot introduce any incidental column/definition drift, and PostgreSQL fully supports altering just the storage option in place. Migration: `supabase/migrations/20260826110000_p0_sec_03_wod_logs_with_context_security_invoker.sql`.

## 6. Live Post-Fix Results

```text
anon:                    0 rows (was 399)
authenticated, no matching profile: 0 rows
authenticated, own gym (real member): 399 rows - EXACT match against the base table's own
                         gym-scoped count for that gym, confirming full legitimate visibility
                         preserved, nothing over- or under-exposed
cross-tenant (disposable second gym + disposable row, same real member querying):
                         visible_total = 399, visible_from_other_gym = 0 - proven THROUGH
                         the view itself (not merely inferred from the base table), per this
                         mission's explicit Phase 10 instruction
Admin:                   N/A - forge-admin-web's Admin flows never queried this view (§3);
                         their actual wod_logs reads are unaffected since they never touched
                         this view
```

## 7. All-Views Verification

Exhaustive, **unfiltered** re-check of all 15 `public` views/materialized views (no `reloptions IS NOT NULL` filter — every view listed regardless of its option state):

| View | `security_invoker` |
|---|---|
| `athlete_performance_summary` | true |
| `benchmark_pr_events_current` | true |
| `benchmark_progress_summary` | true |
| `gym_performance_summary` | true |
| `member_domain_consistency_detail` | true (P0-SEC-01) |
| `movement_pr_events_current` | true |
| `movement_progress_gym_summary` | true |
| `movement_progress_summary` | true |
| `performance_identity_gym_summary` | true |
| `performance_progress_distribution` | true |
| `performance_progression_summary` | true |
| `performance_timeline` | true |
| `skill_logs_with_context` | true |
| `wod_logs_with_context` | **true (this fix)** |
| `workout_progress_summary` | true |

**Confirmed: no other view lacks the required security model.** All 15 are now uniform.

## 8. Audit Query Correction

The original Final Pre-Production Security Gate's view-security discovery query filtered `WHERE c.reloptions IS NOT NULL` before listing views. A view with a missing `security_invoker` option has `reloptions = NULL` — the filter excluded it from the result set entirely, so the report's "all 14 other views are safe" conclusion was drawn from a list that structurally could never contain the one unsafe case. This is not a database issue and nothing to fix in the schema — it is a methodology defect in how the audit was queried, now corrected and documented here: **any future view-security check must enumerate every `public` view/materialized view first (no `reloptions` filter in the `WHERE` clause), and only then inspect each one's `reloptions`/grants** — exactly the query used in §7 above. No dedicated tooling/script exists in this repository for this check (it has always been performed as an ad-hoc live query during each security mission), so this correction is captured here and in memory as the standing methodology, not as a new committed script (avoiding building unneeded audit-framework tooling per this mission's own scope discipline).

## 9. Security Advisor

No Management API token available in this environment; replicated via direct catalog inspection, as in every prior mission. Post-fix: zero views with `anon`/`authenticated` grants and a missing/unsafe security mode (§7). Zero RLS-disabled `public` tables (re-confirmed, 0/49). `auth_users_exposed`-class exposure: still resolved, still only `member_domain_consistency_detail` has any `auth.users` dependency, still correctly locked down (§10). No new CRITICAL/HIGH-class finding introduced by this fix.

## 10. Previous Security P0 Regression

```text
P0-SEC-01 (member_domain_consistency_detail): INTACT - anon SELECT re-tested live, still
           "permission denied for view member_domain_consistency_detail"
P0-SEC-02 SEC-01 (subscription entitlement):  INTACT - re-tested live, is_active update still
           raises "a non-privileged caller may only adjust sessions_used by 1 at a time"
P0-SEC-02 SEC-02 (delete_member_future_bookings): INTACT - re-confirmed absent (0 rows in
           pg_proc for that name)
P0-01 (class deletion / booking integrity):   not touched by this mission; unaffected
P0-02 (gender resolution):                    not touched by this mission; unaffected
```

## 11. Migration / Files Changed

- `supabase/migrations/20260826110000_p0_sec_03_wod_logs_with_context_security_invoker.sql` (new) — the sole database change: one `ALTER VIEW ... SET (security_invoker = true)` statement. Applied live to production directly from this file, so repository and production state match exactly.
- `P0_SEC_03_WOD_LOGS_ANONYMOUS_EXPOSURE_IMPLEMENTATION_REPORT.md` (this file, new).

No application code (JS/TS) in either repository was touched — zero live consumers existed to update.

## 12. Production Safety

> Real production wod_logs modified: **0**
> Real production member/subscription/booking data modified: **0**

Every verification test either read real data in count-only form (no row contents ever printed) or used disposable rows (synthetic ids, a disposable gym, one disposable `wod_logs` row referencing a real member id only as a valid FK target) inside a transaction explicitly `ROLLBACK`'d. The only statement that permanently altered production state was the migration's own `ALTER VIEW ... SET (security_invoker = true)` — no `INSERT`/`UPDATE`/`DELETE` against any data table was ever committed.

## 13. Final Invariants

> **A fully anonymous caller can no longer retrieve private Forge workout logs through `public.wod_logs_with_context`.** Proven: live-reproduced 0 rows for `anon` post-fix, versus 399 pre-fix.
>
> **`public.wod_logs_with_context` now respects the intended caller-level RLS authorization model.** Proven: a real member sees exactly their own gym's rows (399, matching the base table's own RLS-scoped count exactly — no under- or over-exposure), and a disposable other-gym row is confirmed invisible through the view itself, not merely inferred from the base table's own policies.

---

Both invariants hold. P0-SEC-03 is CLOSED. All three prior security missions (P0-SEC-01, P0-SEC-02) remain closed and unregressed, and all 15 API-exposed views are now uniformly and correctly secured. Stopping here per this mission's explicit instruction — no P0-03, no further security audit, no SEC-03 default-ACL work. Awaiting approval.
