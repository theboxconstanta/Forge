# P0-SEC-01 — CRITICAL Supabase `auth_users_exposed` Security Fix — Implementation Report

Status: **CLOSED — exposure confirmed eliminated via direct live reproduction.**

---

## 1. Exact Vulnerable Object

```text
schema: public
view:   member_domain_consistency_detail
type:   view (relkind 'v'), owner postgres
```

Confirmed via direct catalog inspection (`pg_depend`/`pg_rewrite` join against `auth.users`) as the **only** view or materialized view in the entire database — public or otherwise — with any dependency on `auth.users`. No indirect (view-on-view) dependents exist.

## 2. Root Cause

The view was created 2026-07-26 (`20260726150000_member_domain_consistency_reconciliation.sql`) with an explicit design comment: *"Not granted to anon/authenticated directly - reached only through `member_domain_consistency_report()`/`_summary()`, which enforce the authorization check."* That intent was never actually enforced with a `REVOKE`. This project's `public`-schema default ACL (confirmed live via `pg_default_acl`: `ALTER DEFAULT PRIVILEGES ... GRANT ALL ON TABLES TO anon, authenticated, service_role`, applied by role `postgres`) auto-grants full privileges — `SELECT` included — to `anon` and `authenticated` on **every new relation created in `public`, tables and views alike**. The view silently inherited that grant the moment it was created, with no application code, migration, or later commit ever revoking it. The view's owner is `postgres` and it had no `security_invoker` option set, so it always executed with the owner's (RLS-bypassing) privileges — meaning any role that could read the view at all read every row, unfiltered, regardless of caller identity or gym/tenant.

The one `auth.users` reference — an `NOT EXISTS` orphan-detection check (`members.id` with no matching `auth.users` row) — is itself a legitimate, narrowly-scoped integrity check appropriate for an internal, admin-gated diagnostic view. The defect was never the query logic; it was that the view was reachable at all outside its intended `is_platform_admin()`-gated RPC wrappers.

## 3. Data Previously Exposed (column names/categories only — no production values)

The view unions 15 data-consistency "issue types" across the Member Domain (`profiles`/`members`/`memberships`/`gyms`, plus the one `auth.users` existence check). Columns: `issue_type` (text enum), `severity` (text enum), `profile_id`/`member_id`/`membership_id` (UUIDs), `detail` (free-text). Categorized:

- **Cross-tenant identifying data**: `profile_id`/`member_id`/`membership_id` UUIDs for every gym on the platform, with zero tenant scoping — any caller saw every gym's data, not just their own.
- **PII risk in free text**: the `member_duplicate_email` issue branch's `detail` column embeds a real member email address (`format('profiles.email=%s is shared...', p.email)`) when triggered. No such row exists live today (confirmed below), but the code path is real and would have leaked an email the moment that condition occurred.
- **Auth existence signal**: the `member_invalid_auth_reference` branch reveals whether a specific member ID has zero matching `auth.users` row — not itself a secret, but an unnecessary probe surface into `auth.users` for unauthorized callers.
- **No password hashes, tokens, or other `auth.users` columns were ever selected by this view** — it never did `SELECT * FROM auth.users` or projected any auth.users column; the sole reference is a `WHERE NOT EXISTS` correlated subquery.

## 4. Who Could Access It (before the fix)

```text
anon:          YES — live-reproduced, 30 rows returned to a fully unauthenticated caller
authenticated: YES — live-reproduced, identical unrestricted access for any logged-in, non-admin member
Admin:         YES, but incidentally — the direct view bypass meant the is_platform_admin()
               gate on the 3 intended RPC wrappers was irrelevant; anyone, admin or not,
               could read the view directly
```

## 5. Application Consumers

Repo-wide search (WOD-SIMPLE `src/`, `supabase/functions/`, forge-admin-web `src/`) found **zero** JS/TS/Edge Function references to `member_domain_consistency_detail`. The only consumers are three SQL `SECURITY DEFINER` functions defined in the same origin migration: `member_domain_consistency_report()`, `member_domain_consistency_summary()`, `reconcile_member_domain(boolean)` — each checks `is_platform_admin()` and raises before touching the view. All three are `GRANT EXECUTE ... TO authenticated` (the function call itself is open to any logged-in user; the internal gate is what restricts actual data access) — this is the platform's existing, correct pattern for platform-wide admin operations (same as `set_gym_paid_until()`/`list_all_gyms_platform()`, per the origin migration's own comment). No end-user-facing feature (Admin UI, Member PWA, or public site) calls this view or its wrapper functions today.

## 6. Chosen Fix

**Option C — restrict grants** (per the mission's own menu), matching the view's own original, undelivered design intent exactly: `REVOKE ALL ... FROM anon, authenticated`. This is the smallest safe correction because:
- It requires zero application code changes (zero consumers exist).
- It has zero effect on the three legitimate RPC wrappers — they are `SECURITY DEFINER`, owned by `postgres`, so they read the view under `postgres`'s own privileges regardless of what is granted to the *calling* role. Re-verified live, post-fix (§11).
- Option A (remove the `auth.users` dependency) was rejected — the orphan-detection check is a legitimate, intentional integrity check for an internal admin diagnostic; removing it would defeat the view's actual purpose.
- Option D (`security_invoker`) alone, without the grant revoke, would not have closed the exposure — `anon`/`authenticated` would still read the view, just now filtered through RLS on `profiles`/`members`/`memberships`/`gyms`, which was never the intended access model for this platform-wide, cross-tenant diagnostic tool. **Applied anyway, as defense in depth on top of the grant revoke** (see §7) — harmless for the view's only real callers (`postgres`/`service_role`, both RLS-bypassing), but a second line of defense if the view is ever accidentally re-granted in the future.

## 7. SQL / Migration Changes

New migration, applied live and committed identically (`supabase/migrations/20260826090000_p0_sec_01_revoke_member_domain_consistency_detail_exposure.sql`):

```sql
revoke all on member_domain_consistency_detail from anon, authenticated;

alter view member_domain_consistency_detail set (security_invoker = true);
```

## 8. Final Access Matrix

```text
anon:                  NO access — live-reproduced: "permission denied for view
                       member_domain_consistency_detail"
authenticated member:  NO access — live-reproduced, identical permission denied
Admin:                 access unchanged — reached only via member_domain_consistency_report()/
                       _summary()/reconcile_member_domain(), all re-verified functionally
                       intact post-fix; is_platform_admin() gate confirmed still enforced
server/service role:   unchanged (SELECT retained, as required for the RPC wrappers'
                       internal SECURITY DEFINER execution context)
```

| Object | anon | authenticated | privileged/server | Sensitive auth data exposed? |
|---|---|---|---|---|
| `member_domain_consistency_detail` (view) | **NO** (was YES) | **NO** (was YES) | YES (`postgres`/`service_role`, as designed) | **NO** |
| `member_domain_consistency_report()` (RPC) | N/A (SQL function, not directly `auth.users`) | callable, gated by `is_platform_admin()` | full | NO |
| `member_domain_consistency_summary()` (RPC) | N/A | callable, gated by `is_platform_admin()` | full | NO |
| `reconcile_member_domain()` (RPC) | N/A | callable, gated by `is_platform_admin()` | full | NO |

## 9. Security Advisor

**`auth_users_exposed` is confirmed RESOLVED against the actual live database state** — verified by directly reproducing Supabase's own check logic (catalog dependency of API-exposed-schema views on `auth.users`, cross-referenced against live grants) both before (exposed) and after (denied) the fix, not merely inferred. No Management API/Advisor UI token was available in this environment to trigger the hosted linter's own "Rerun linter" action directly — **recommend confirming via the Supabase Dashboard → Advisors → Security page** as a final visual confirmation, but the underlying condition the linter checks for (an API-role-accessible view referencing `auth.users`) is proven eliminated by direct query.

## 10. Other Critical/High Findings

Checked, not fixed (none found requiring action):
- **RLS-disabled public tables**: zero. Every table in `public` has `relrowsecurity = true`.
- **Other API-exposed views with unsafe security mode**: zero. All 14 other `public` views granted to `anon`/`authenticated` (`athlete_performance_summary`, `benchmark_pr_events_current`, `benchmark_progress_summary`, `gym_performance_summary`, `movement_pr_events_current`, `movement_progress_gym_summary`, `movement_progress_summary`, `performance_identity_gym_summary`, `performance_progress_distribution`, `performance_progression_summary`, `performance_timeline`, `skill_logs_with_context`, `wod_logs_with_context`, `workout_progress_summary`) **already had `security_invoker = true` set from their own original creation migrations** — `member_domain_consistency_detail` was the sole outlier missing it. This was not an individually-audited guarantee that each of the 14 is fully correct in every other respect (RLS policy correctness on their underlying tables was not re-verified here — out of scope for this mission), only that the specific `security_invoker` mechanism this finding hinges on is already applied uniformly elsewhere.
- **Committed secrets**: none found. A `.env` file is present in WOD-SIMPLE's git history but contains only `VITE_SUPABASE_URL`/`VITE_SUPABASE_KEY` (Vite's `VITE_`-prefix convention means these are intentionally bundled into the client and are the public anon key + project URL, not a service-role secret). Repo-wide grep for `service_role`/`sk_live`/`sk_test`/`STRIPE_SECRET`/`OPENAI_API_KEY=sk-` patterns found zero hardcoded secrets in tracked application code; all `SERVICE_ROLE_KEY` references are confined to server-side Edge Functions (the correct, expected location).

## 11. Regression Tests

```text
tests:            No application test suite touched or required to change — zero JS/TS/Edge
                   Function consumers of the affected view exist (confirmed via repo-wide
                   search, §5). WOD-SIMPLE/forge-admin-web test suites unaffected by this
                   DB-only, zero-application-code change.
build/type-check:  N/A — no application source file was modified in this fix.
auth smoke test:   is_platform_admin()-gated RPC path re-verified live and unaffected
                   (member_domain_consistency_summary() still correctly raises "not
                   authorized" for a non-admin caller, and the view's own internal query
                   still succeeds for the postgres/SECURITY DEFINER execution context -
                   both re-tested live, post-fix).
Admin smoke test:  Wrapper function internals confirmed intact (§6/§8) - the actual
                   admin-facing capability (viewing/reconciling Member Domain drift) is
                   unchanged, since it was never reached through the now-revoked direct
                   view grant in the first place.
```

## 12. Production Data

**No production `auth.users` records, or any other user/member/profile row, were modified.** This fix changed only object-level PostgreSQL privileges (`REVOKE`) and one view's storage option (`security_invoker`) — no `INSERT`/`UPDATE`/`DELETE` was executed against any table.

## 13. Final Invariant

> Ordinary Forge API users (`anon`, and any ordinary `authenticated` member) can no longer retrieve sensitive `auth.users`-adjacent information through `member_domain_consistency_detail` or any other API-exposed view — live-reproduced both before (30 rows readable, unauthenticated) and after (`permission denied`, both `anon` and `authenticated`) the fix. This is proven, not assumed.

---

Stopping here per this mission's explicit instruction. P0-03 remains not started, pending approval to resume.
