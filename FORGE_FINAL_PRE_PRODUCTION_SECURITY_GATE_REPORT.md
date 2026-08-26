# FORGE — Final Pre-Production Security Gate Report

Investigation-only. Read-only. No code, schema, RLS, grants, migrations, or production data were changed during this investigation. All live-reproduction tests used disposable rows inside transactions that were explicitly `ROLLBACK`'d — nothing persisted.

---

# EXECUTIVE SECURITY VERDICT

## RED — an unresolved, live-exploitable P0 exists.

---

## Active Supabase Security Advisor Findings

No Management API token was available in this environment to query the hosted Advisor UI directly. As in P0-SEC-01, its check logic was replicated via direct catalog inspection instead of inferred.

- `auth_users_exposed`: **confirmed still RESOLVED**. Re-verified live: `member_domain_consistency_detail` (the only view in the database with any dependency on `auth.users`) still has zero `anon`/`authenticated` grants, `security_invoker = true`.
- RLS-disabled public tables: **zero** (re-confirmed, all 49 public tables have `relrowsecurity = true`).
- Other API-exposed views with unsafe security mode: **zero** (all 14 other `anon`/`authenticated`-granted views retain `security_invoker = true`).
- No other advisor-class CRITICAL findings were identified by direct schema inspection. The genuinely new findings in this report (SEC-01, SEC-02) are **not** things Supabase's standard Advisor lints check for — they are RLS-policy/trigger-logic and function-authorization defects, a different class of finding that requires manual review, which is exactly what this gate was for.

## Public API Exposure Map

- **Tables**: all 49 `public` tables are `SELECT`-granted to `anon` by default-ACL (systemic, see Default ACL Assessment below), but actual visible rows are governed by RLS — verified correct for every sensitive table checked (see RLS Assessment).
- **Views**: 15 total in `public`; 14 use `security_invoker = true` (safe); the 15th (`member_domain_consistency_detail`) has zero `anon`/`authenticated` grant (fixed in P0-SEC-01).
- **RPC/functions**: ~90 `SECURITY DEFINER` functions + numerous plain functions; the large majority are correctly gated internally (`is_admin`/`is_coach_or_admin`/`is_platform_admin`/ownership checks) or are trigger-only (inert if called directly). Two exceptions found — see SEC-01 and SEC-02.

## Default ACL Assessment

**Unchanged since P0-SEC-01, re-confirmed live.** `pg_default_acl` shows role `postgres` has a standing `ALTER DEFAULT PRIVILEGES ... GRANT ALL ON TABLES/FUNCTIONS TO anon, authenticated, service_role` for the `public` schema. Answer to the mission's specific question:

> If a developer creates a new table/view/function tomorrow and forgets explicit REVOKE/GRANT statements, what access will anon/authenticated receive?

**Full privileges (SELECT/INSERT/UPDATE/DELETE for tables, EXECUTE for functions), automatically, silently, with no opt-in required.** This is safe for ordinary tables *only if* a correct RLS policy set is added in the same migration — it is not safe by default, and depends entirely on the developer remembering to add RLS policies (not just enabling RLS, but actually getting the policy conditions right, as SEC-01 below demonstrates even a *present* policy can still be wrong). This was the root cause of P0-SEC-01 and is a contributing structural factor in SEC-02. Classified **P2 (hardening)** — not fixed here — recommend a lightweight guardrail (documented convention: every new migration creating a table/view/function must include an explicit REVOKE or a deliberate comment confirming the default grant is intentional; optionally a CI/lint check grepping new migrations for `create table`/`create view`/`create function` without an adjacent grant/revoke/RLS block).

## RLS Assessment

All 49 public tables: RLS enabled, all with at least 1 policy (re-confirmed live). Full policy definitions were pulled and read for every domain judged sensitive: `members`, `profiles`, `memberships`, `bookings`, `classes`, `wods`, `skill_logs`, `wod_logs`, `personal_records`, `pr_events`, `subscriptions`, `subscription_plans`, `orders`, `payments`, `platform_orders`, `platform_payments`, `admins`, `platform_admins`, `gyms`, `gym_waivers`, `member_waiver_acceptances`, `transfer_codes`, `custom_hero_wods`, `class_waitlist`, `coaches`, `gym_invitations`, `admin_invitations`, `app_settings`.

Every one of these correctly scopes rows via `auth.uid()` ownership (`member_id = auth.uid()`, `id = auth.uid()`) or `is_admin(gym_id)`/`is_coach_or_admin(gym_id)`/`is_platform_admin()`/`is_platform_billing_owner()` gym-scoped checks, **except**:

- **`subscriptions`**: has a correctly-gym-scoped `UPDATE` policy, but the policy's *own-member* branch (`member_email` matches JWT email) combines with a companion trigger to produce an unrestricted write path — this is **SEC-01**, the headline P0 finding below. The RLS policy itself isn't wrong in isolation; the trigger that was supposed to be the safety net for that exact branch has a logic inversion.

No RLS-disabled table, no missing-policy table for anything write-capable was found (tables with only a `SELECT` policy, e.g. `memberships`, `pr_events` — correctly have **no** `INSERT`/`UPDATE`/`DELETE` policy at all, meaning those operations are denied by default for any non-bypassing role; confirmed this is intentional, not an oversight, by tracing that both are written exclusively through `SECURITY DEFINER` RPCs).

## Cross-Tenant Test Results

Tested `profiles.gym_id` self-modification (the mechanism `my_gym_id()` is directly derived from, and thus the single highest-leverage cross-tenant vector on the platform): a dedicated trigger (`prevent_profiles_gym_id_change`) unconditionally blocks changing a non-null `gym_id` to a different non-null value, for any caller, no role-based exemption. **SAFE, verified by reading the trigger logic** (no live write test needed — the block is unconditional, live-testing it would only reproduce a known-safe rejection).

`gym_id`-scoped `SELECT` policies (`bookings_select_all`, `classes_select_all`, `wods_select_all`, `skill_logs_select_all`, `wod_logs_select_all`, `pr_events_select_all`, `personal_records_select_gym`, `subscription_plans_select_all`, `app_settings_select_all`) all key off `my_gym_id()` — since that value cannot be tenant-hopped (above), these are all transitively safe. **No cross-tenant read/write path found.**

## Horizontal Privilege Test Results

`personal_records`/`skill_logs`/`wod_logs`/`custom_hero_wods`: `INSERT`/`UPDATE`/`DELETE` all require `member_id = auth.uid()` in both `USING` and `WITH CHECK` — Member A cannot write Member B's rows (would need to forge `auth.uid()`, not possible without a valid JWT for Member B). `bookings`: no member-facing `UPDATE` policy exists at all (only `is_coach_or_admin`); `DELETE` requires `member_id = auth.uid()` OR admin. **SAFE.**

**Exception**: `subscriptions` — see SEC-01. This is horizontal-privilege-adjacent too (a member modifying *their own* record in an unauthorized *way*, i.e. escalating its financial state rather than touching someone else's row), which is why it's classified under Payment Security primarily but is relevant here too.

## Vertical Privilege Test Results

`classes`/`wods`: `INSERT`/`UPDATE`/`DELETE` all require `is_coach_or_admin(gym_id)` — a plain member cannot create/edit/delete a class or WOD via a direct Supabase call, verified at the RLS level (not merely a hidden UI button). `coaches`/`admins`/`subscription_plans`: same pattern, admin-gated. `cancel_class()` RPC: internally re-derives the class's `gym_id` and checks `is_coach_or_admin` before doing anything — **SAFE**, verified by reading the function body (a member cannot pass an arbitrary `p_class_id` to escalate, since authorization is re-checked against the row's *actual* gym, not client-supplied). `set_member_usual_level()`: requires `is_coach_or_admin` even for the target member's *own* record — fails closed, not a vulnerability (just means self-service isn't wired through this particular RPC, a product-behavior question, not a security one).

**Exception**: `subscriptions` — SEC-01 is a vertical escalation in effect (an ordinary member obtaining the practical outcome of an Admin-only action — activating/extending a membership).

## SECURITY DEFINER RPC Assessment

86 functions total. Classified:

- **SAFE** (~83): internally gated via `is_admin`/`is_coach_or_admin`/`is_platform_admin`/ownership re-derivation, or trigger-only (not meaningfully callable outside trigger context), or pure/read-only with no side effects. Includes the previously-fixed `activate_queued_subscription` — **re-verified live**, its uniform paid-order check (`if v_order_status is distinct from 'paid' and ... raise exception 'order not paid'`) is still intact and still applies to both admin and self-service callers.
- **VULNERABLE** (1): `delete_member_future_bookings` — see SEC-02.
- **NEEDS HARDENING** (1): `subscriptions_restrict_member_update` (the trigger function underlying SEC-01).
- **UNVERIFIED** (0): none — every function judged security-relevant by name/grant was read in full.

All but one `SECURITY DEFINER` function pins `search_path` explicitly (`delete_member_future_bookings` does not — a secondary, minor hygiene gap on top of its primary defect).

## View Assessment

Re-confirmed: 15 views total in `public`, all either `security_invoker = true` (14) or fully revoked from `anon`/`authenticated` (the 1 fixed in P0-SEC-01). No new `auth.users` dependency found. No cross-tenant leakage found in any of the 14 (they all key off `my_gym_id()`-scoped or `member_id = auth.uid()`-scoped underlying tables, inherited correctly via `security_invoker`).

## Storage Assessment

One bucket: `avatars`, `public = true` (intentional — profile pictures are meant to be publicly viewable, standard product pattern). `INSERT`/`UPDATE`/`DELETE` policies all require `(storage.foldername(name))[1] = auth.uid()::text` — a user can only write inside their own UID-named folder, using Supabase's own path-segment helper (not naive string matching), so path traversal to another user's folder is not possible. **SAFE.** Minor: duplicate policy pairs exist (e.g. "Avatar delete own" and "avatars_delete_own" — same effect, likely leftover from a rename) — cosmetic only, **P3**.

## Edge Function Assessment

Spot-checked the four most privileged: `admin-remove-member`, `admin-transfer-member`, `admin-add-member`, `admin-invite-member`. All four follow the same correct pattern: extract the bearer token, call `anonClient.auth.getUser(token)` to independently verify the caller's real identity server-side (not trusting any client-supplied user id), then look up that caller's row in `admins` (via a `service_role` client, since the lookup itself needs to bypass RLS) to confirm admin status **and derive their own `gym_id` from that row** — every subsequent operation is scoped to `callerGymId`, never a client-supplied one. **SAFE** — a valid JWT alone is correctly not treated as sufficient; admin status and gym scope are both independently re-derived server-side.

## Secrets Assessment

Unchanged since P0-SEC-01 (re-confirmed): no hardcoded `service_role`/Stripe-secret/OpenAI-secret patterns in tracked application code in either repo; all `SUPABASE_SERVICE_ROLE_KEY` usage confined to Edge Functions (server-side, correct location); the one committed `.env` in WOD-SIMPLE git history holds only the public `VITE_SUPABASE_URL`/`VITE_SUPABASE_KEY` (anon key, intentionally public by Vite convention). **No P0 credential exposure.**

## Authentication / Authorization Source of Truth

- **User identity**: `auth.uid()`, derived server-side from the JWT's `sub` claim (`request.jwt.claims`/`request.jwt.claim.sub` GUCs set by PostgREST from the verified JWT) — never trusts a client-supplied id.
- **Gym identity**: `my_gym_id()`, a `SECURITY DEFINER` SQL function reading `profiles.gym_id where id = auth.uid()` — cannot be spoofed by a client-supplied `gym_id` parameter, since it's always re-derived server-side from the caller's own authenticated identity. `profiles.gym_id` itself is protected against tenant-hopping once set (verified, above).
- **Admin status**: `is_admin(gym_id)`/`is_admin()`, checking the `admins` table for `id = auth.uid()` — cannot be forged by editing a client-side "role" field, since it's a real table lookup keyed to the server-verified identity.
- **Platform-admin status**: `is_platform_admin()`, same pattern against `platform_admins`.

None of these can be obtained by modifying frontend state, localStorage, request payload fields, or client-editable profile fields — all are re-derived from server-verified identity on every check. **This is the correct model, confirmed consistently applied**, with the one exception being SEC-01, where the *trigger* meant to enforce narrow write scope for the "self" branch fails to actually restrict anything.

## IDOR Assessment

Representative IDs tested by direct policy/function inspection: booking ids, member ids, score/log ids (`wod_logs`/`skill_logs`), workout/class ids, membership ids. All write paths independently re-verify ownership or admin status server-side against the *actual* row, not a client-supplied assumption — **except** `delete_member_future_bookings` (SEC-02, currently non-functional so not live-exploitable) and the `subscriptions` update path (SEC-01, live-exploitable, though the "IDOR" here is closer to "unauthorized self-service state escalation" than cross-victim tampering, since the trigger's bypass condition is scoped to the row's *own* declared owner-by-email, not an arbitrary other member).

## Stripe / Membership Security Assessment

`orders`/`payments`/`platform_orders`/`platform_payments`: **no client-writable RLS policy exists at all** (SELECT-only) — a client cannot forge an order or payment record directly; this must go through `register_payment`/`create_order_for_subscription`/the Stripe webhook (`service_role`). `activate_queued_subscription`: re-verified, paid-order check intact and uniform. **However**, this entire, correctly-secured RPC path can be **bypassed entirely** by a member who instead issues a direct `supabase.from('subscriptions').update(...)` call against their own row — see **SEC-01**, the central finding of this report.

## Anonymous Attack Surface

> What can a person with only Forge's public Supabase URL + anon key read or execute?

Table-level `SELECT` grants are broad (default-ACL, see above) but RLS reduces actual anonymous-readable data to effectively: `gyms` where `is_active = true` (the intentional public gym directory used at signup) — every other sensitive table's policies evaluate to zero rows for a true `anon` caller (verified: every policy either requires `auth.uid()` matching, which is `NULL` for anon, or `is_admin()`/`is_coach_or_admin()`, which resolve `false` for a `NULL` `auth.uid()`). **Anonymous execution surface**: the RPCs granted to `anon` are, with one exception, either safely gated or genuinely public-purpose (join-code verification, signup-code consumption, movement-name resolution, etc.). The one exception is **SEC-02** — currently non-functional, but grantable and callable by a fully anonymous caller with zero identity at all.

## Authenticated Member Attack Surface

Beyond their own gym-scoped, own-owned rows (by design), an ordinary authenticated member can additionally: **directly escalate their own subscription's `is_active`/`end_date`/`sessions_total`/`plan_id` fields with no payment verification (SEC-01)**. No other INSERT/UPDATE/DELETE capability beyond documented product permissions was found.

---

## Findings

### SEC-01 — Member can self-activate/extend their own subscription with zero payment verification, bypassing the entire RPC-based financial control path

**Severity: P0**

**Evidence**: `subscriptions_update_own_or_waitlist_or_admin` (RLS UPDATE policy) permits an `UPDATE` on any `subscriptions` row where `lower(member_email) = lower(auth.jwt()->>'email')` (i.e., the caller is the row's own declared member, matched by email) `AND gym_id = my_gym_id()`. The companion trigger `subscriptions_restrict_member_update()`, whose entire purpose is to restrict what a non-privileged caller can change (it correctly limits the narrower "waitlist auto-book" path to incrementing `sessions_used` by exactly 1), contains this branch:
```sql
IF is_coach_or_admin() OR lower(OLD.member_email) = lower(auth.jwt() ->> 'email')
   OR (auth.jwt() ->> 'role') = 'service_role' THEN
  RETURN NEW;  -- no restriction applied
END IF;
```
The same "is this the row's own member" condition that RLS uses to *allow* the update is *also* used by the trigger to *exempt* that exact caller from the column-restriction logic meant to police non-privileged updates. **Live-reproduced** (disposable row, `BEGIN`/`ROLLBACK`, no production data touched): as `authenticated` role with a simulated JWT whose email matched a disposable row's `member_email`, `UPDATE subscriptions SET is_active = true, end_date = '2099-12-31', sessions_total = 999 WHERE id = ...` **succeeded**, returning the fully-escalated row.

**Realistic exploit scenario**: any real member, using only their own already-valid login session and the public anon/publishable key (no elevated access needed), calls `supabase.from('subscriptions').update({ is_active: true, end_date: '2099-12-31', sessions_total: 999 }).eq('id', theirOwnSubscriptionId)` directly from the browser console or a modified client build. This entirely bypasses `activate_queued_subscription`'s paid-order check (confirmed still correctly enforced on *that* path) because the member never has to call that RPC at all.

**Affected system**: WOD-SIMPLE Supabase Production, `public.subscriptions` table, RLS policy `subscriptions_update_own_or_waitlist_or_admin` + trigger `subscriptions_restrict_member_update`.

**Recommended fix**: Tighten `subscriptions_restrict_member_update()` so the "own member" branch is restricted the same way the waitlist branch already is (e.g., only permit `sessions_used` changes there too, or explicitly enumerate the columns a self-service member may ever touch — likely none, if all legitimate membership-state changes are meant to flow exclusively through `activate_queued_subscription`/admin RPCs). Alternatively, narrow the RLS `UPDATE` policy itself so the "own member" branch no longer grants row-level UPDATE access at all (if there's no legitimate reason for a member to directly update their own subscription row client-side). Add a regression test proving a member cannot set `is_active`/`end_date`/`sessions_total`/`plan_id` via direct table update, only via the gated RPC.

**Confidence: HIGH** — live-reproduced against production schema/policies/triggers (disposable data, fully rolled back), not inferred from static reading alone.

---

### SEC-02 — `delete_member_future_bookings` RPC has zero internal authorization and is granted to `anon`/`authenticated`/`PUBLIC`; currently broken (not live-exploitable), but one incidental type-cast fix away from becoming an unauthenticated, cross-tenant, destructive vulnerability

**Severity: P1** *(would be P0 if functional — downgraded strictly because live-reproduction proves it currently cannot execute)*

**Evidence**: `delete_member_future_bookings(p_member_id text, p_from_date text)` is `SECURITY DEFINER` (no `search_path` pinned — a secondary hygiene gap), performs `DELETE FROM bookings WHERE member_id = p_member_id AND class_id IN (SELECT id FROM classes WHERE date >= p_from_date::date)` with **no** `is_admin`/`is_coach_or_admin`/`auth.uid()` check of any kind, and is `GRANT EXECUTE`'d to `anon`, `authenticated`, `service_role`, and explicitly `PUBLIC`. **Live-reproduced** (disposable class + disposable booking, `BEGIN`/`ROLLBACK`): calling it as a fully anonymous `anon` role (no JWT claims set at all) raises `operator does not exist: uuid = text` — because `bookings.member_id` is `uuid` while the function's parameter is untyped `text`, and Postgres has no implicit cast between them in a bare `=`. **The function currently cannot execute successfully for anyone, including a legitimate caller** — confirmed dead/non-functional. Repo-wide search found **zero** application callers in either frontend or any Edge Function — this RPC is not wired into any live product flow.

**Realistic exploit scenario (today)**: none — the function always errors before reaching the `DELETE`. **Realistic exploit scenario (the moment someone "fixes" the type bug)**: a developer notices the error, casts `p_member_id::uuid` to make it work again (a natural, innocent-looking one-line fix), and instantly reintroduces a fully unauthenticated, zero-ownership-check, platform-wide "delete any member's future bookings" primitive — exploitable with only the public anon key, no login at all.

**Affected system**: WOD-SIMPLE Supabase Production, function `public.delete_member_future_bookings`.

**Recommended fix**: either delete the function entirely (it is dead code with no current consumer, and the platform's actual booking-cancellation path already goes through the correctly-scoped `bookings_delete_own_or_admin` RLS policy for direct deletes), or, if it must be kept, fix it together — add `p_member_id = auth.uid()::text OR is_coach_or_admin(<the booking's gym_id>)` authorization AND the type cast in the same change, plus `REVOKE` from `anon`/`PUBLIC` and pin `search_path`, so it can never again exist in an unauthenticated-and-unauthorized state even transiently.

**Confidence: HIGH** — function definition and grants read directly from live production catalogs; non-functionality confirmed by live reproduction (safe, rolled back), not assumed.

---

### SEC-03 — Public-schema default ACL grants full privileges to `anon`/`authenticated` on every new table/view/function by default, with RLS as the only defense layer

**Severity: P2 (hardening)**

**Evidence**: `pg_default_acl` confirms a standing default-privilege grant from `postgres` covering all future `public`-schema tables, views, and functions to `anon`/`authenticated`/`service_role`. Currently **safe in practice** — every table checked has correct RLS; this is the same underlying mechanism that caused P0-SEC-01 and is a contributing factor to why SEC-02's dangerous grant exists at all (nobody had to think to grant it — it happened automatically).

**Realistic exploit scenario**: not itself exploitable — it's a structural risk multiplier. The next RLS-policy mistake, or the next "forgot to add REVOKE" internal-only object, is immediately and fully exposed the moment it's created, with no additional step required by whoever made the mistake.

**Affected system**: WOD-SIMPLE Supabase Production, schema-level default ACL for `public`.

**Recommended fix**: not a P0/P1 action. Document the convention explicitly (this report + a short note in the migrations README) that any new internal-only table/view/function must include an explicit `REVOKE`/RLS-policy-absence-by-design in the same migration; consider narrowing the default ACL itself as a longer-term, carefully-planned change (out of scope for a quick fix, since it would require auditing every existing table's reliance on the default grant before safely narrowing it).

**Confidence: HIGH**.

---

### SEC-04 — Duplicate/redundant Storage RLS policies on the `avatars` bucket

**Severity: P3 (informational)**

**Evidence**: Two functionally-identical policy pairs exist per operation (e.g. `"Avatar delete own"` and `"avatars_delete_own"`, same `qual`), apparently left over from a naming migration. No security effect — both express the same restriction.

**Realistic exploit scenario**: none.

**Affected system**: `storage.objects` policies for the `avatars` bucket.

**Recommended fix**: cleanup only, whenever convenient — drop the older-named duplicates.

**Confidence: HIGH**.

---

# FINAL QUESTION

> Is Forge safe enough from an authorization/data-exposure perspective to continue with P0-03 timezone work?

## NO

SEC-01 is a live, production-exploitable, financial-impact vulnerability — any real member can grant themselves an active/extended membership with zero payment, entirely bypassing the RPC path that was already correctly hardened for exactly this purpose. This is squarely a P0 by the same standard P0-SEC-01 was judged against, and it directly undermines the integrity of the same Financial Domain that a prior P0 (the `activate_queued_subscription` bypass) already had to fix once. SEC-02, while not currently live-exploitable, sits one careless fix away from becoming a second, worse P0 and should be closed in the same pass. P0-03 is pure timezone/date-consistency work with no security dimension, but continuing normal feature work while a real financial-integrity hole is open and undocumented in code (only now discovered) is not advisable — recommend authorizing a narrowly-scoped P0-SEC-02 fix mission for these two findings before resuming P0-03.
