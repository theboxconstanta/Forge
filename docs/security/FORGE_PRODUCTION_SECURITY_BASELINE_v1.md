# Forge — Production Security Baseline v1

**Status:** Baseline document, first hardening cycle
**Date:** 2026-07-19
**Applies to:** Forge production environment (Supabase project `sdfkvfbvgpuspnnnwqwk`), auto-deployed frontend (Vercel, GitHub `main`), and Supabase Edge Functions deployed independently via the Supabase CLI.
**Audience:** Engineers working on Forge, present and future. Read this before touching authentication, authorization, Edge Functions running with `service_role`, or any code path in the production-critical areas defined in Section 2 ("Production review before deployment").

---

## 1. Executive Summary

Forge is a live, multi-tenant CrossFit gym management SaaS with real production data (~40 active members across multiple gyms at the time of this cycle) at the point this hardening cycle began. Prior to this cycle, no systematic security audit of the authentication, authorization, and multi-tenant isolation boundaries had been performed since the multi-tenant conversion.

**Why this cycle was performed:** the application had matured from a single-gym deployment to a multi-tenant platform (see `docs/DECISIONS.md`, 2026-07-14 entry) without a corresponding re-audit of code paths that predate multi-tenancy — in particular, Supabase Edge Functions running with `service_role`, which bypass Row-Level Security (RLS) entirely and are therefore solely responsible for reconstructing any tenant or authorization boundary themselves.

**Objectives:**
- Identify security issues meeting a strict P0 bar: security vulnerabilities, authentication/authorization failures, multi-tenant isolation issues, data corruption/loss, or production reliability failures blocking core usage. UX, refactoring, performance, code quality, and P1/P2 items were explicitly excluded from this cycle's scope.
- Investigate each candidate issue fully — request flow, authentication point, authorization point, exploitability, root cause — before any implementation began.
- Implement the smallest possible production-safe fix for each confirmed issue, preserving every legitimate workflow.
- Validate every fix in production via a live smoke test immediately after deployment, using disposable test data only.

**What this cycle covers:** four P0 issues were investigated and fixed: two pre-existing items (stale profile data on account switch; password recovery production-readiness) and two issues identified during a fresh, criteria-scoped security audit of the codebase (an authorization gap in the `admin-delete-client` Edge Function, and a missing authorization layer in the `send-notification` Edge Function). See Section 3 for the full list and Section 7 for what the audit found but this cycle did **not** yet fix.

**What was intentionally NOT changed:**
- No database schema changes.
- No migrations.
- No Row-Level Security (RLS) policy changes.
- No changes to the multi-tenancy model (`docs/DECISIONS.md`, 2026-07-14).
- No frontend API contract changes — every fix preserved the exact request/response shape existing client code already depends on.
- No architectural redesign of the notification system, the deletion flow, or any other subsystem touched during this cycle.
- No refactoring beyond the minimum structural change required to make a fix independently testable (see Section 2, "Minimal production-safe patches").

---

## 2. Security Engineering Principles

These principles were applied consistently across every P0 fix in this cycle and are intended to remain the working standard for future security work on Forge.

### Investigate before implementing
Every issue went through a dedicated investigation phase — producing a written root-cause analysis, exploitability assessment, and proposed fix — before any code was written, with explicit sign-off required before implementation began. **Why:** a fix designed against an incomplete understanding of the vulnerability risks solving the wrong problem, or solving the right problem in a way that breaks a legitimate workflow the investigation never surfaced. In this cycle, the P0-004 investigation specifically surfaced a legitimate non-staff caller path (`waitlist_booked`) that a naive "staff-only" fix would have silently broken in production — this was found *before* implementation, not discovered as a regression afterward.

### Minimal production-safe patches
Every fix was scoped to the smallest change that closed the identified gap, with explicit constraints against refactoring, architecture changes, schema changes, and RLS changes. **Why:** production is live with real user data; every additional line of changed code is additional surface area for a new regression. The one deliberate exception in both fixes was a small structural change (wrapping the request handler in a named, exported function guarded by `if (import.meta.main)`) made specifically to allow the authorization logic to be unit tested without a live backend — this was disclosed and justified in each investigation, not introduced silently.

### No unnecessary refactoring
Existing working code (notification templates, deletion cascade order, response shapes, variable names) was left untouched even where a stylistic improvement was possible. **Why:** refactoring and security-fixing are different activities with different risk profiles; mixing them makes it harder to reason about what a change actually did, and harder to isolate the cause if something breaks post-deploy.

### Authorization before side effects
In both Edge Function fixes, the authorization decision was placed before any database write, external API call (Brevo email, web-push), or cascading deletion — verified both by static code review and, post-deployment, by confirming rejected requests produced no side effects. **Why:** an authorization check that runs after a side effect has already occurred provides no real protection; the side effect has already happened by the time the rejection is returned.

### Production review before deployment
Every fix was reviewed and explicitly approved by the project owner before any deployment occurred, including a distinct approval step for "investigate" versus "implement" versus "deploy." **Why:** this project treats **subscriptions, membership expiration, billing/payments, and access control tied to subscriptions** as production-critical: any change reaching those areas requires the project owner to explicitly approve the specific implementation before it is written, in addition to approving deployment separately — an investigation or finding that merely *touches* one of these areas (e.g., a fix's deletion cascade includes the `subscriptions` table) is not itself a blocker, but no code change to that area proceeds without that explicit sign-off. This standing rule is stated here as the authoritative definition; it was not previously recorded elsewhere in the repository, and this document is now that record. Section 7 references this same definition for the two open items that fall within its scope.

### Deployment followed by smoke testing
Every deployment was immediately followed by a live production smoke test — covering both the regression case (legitimate workflows still work) and the security case (the fix actually blocks the exploit) — using disposable test data created and destroyed for that purpose, never real member data. **Why:** a fix that passes unit tests but has never been exercised against the real deployed artifact and real production configuration (API keys, RLS policies, triggers) is unverified in the environment that actually matters.

### Rollback must always be possible
Every fix in this cycle was a stateless Edge Function redeploy with no accompanying migration — meaning rollback is always "redeploy the previous commit," with nothing to reverse at the data layer. **Why:** an irreversible or hard-to-reverse deployment turns a bad fix into an incident; keeping fixes stateless keeps the cost of being wrong low.

---

## 3. P0 Security Audit Summary

| Issue ID | Issue Name | Severity | Root Cause | Status | Production Status | Deployment Status |
|---|---|---|---|---|---|---|
| P0-001 | Stale profile data across account switch | P0 (Data Integrity) | Profile edit buffer not reactively synchronized to the authenticated user; imperative initialization only, no `useEffect` resync on user change | Fixed | Live | Deployed (Vercel auto-deploy on push to `main`) |
| P0-002 | Password recovery not production-ready | P0 (Authentication) | Recovery flow lacked production-grade handling of expired/invalid links, rate-limit errors, and repeated-submission protection | Fixed | Live | Deployed (Vercel auto-deploy on push to `main`) |
| P0-003 | `admin-delete-client` cross-tenant deletion | P0 (Critical — Authorization / Multi-Tenant Isolation) | Edge Function runs with `service_role` (bypasses RLS) and verified caller was *an* admin, but never verified the admin's gym matched the target member's gym | Fixed | Live¹ | Deployed via `supabase functions deploy`, validated with production smoke test |
| P0-004 | `send-notification` missing authorization | P0 (Critical — Authorization) | Edge Function runs with `service_role`; platform-level `verify_jwt` only confirmed *a* valid session existed, but the function itself performed zero identity or authorization checks before sending real email/push notifications | Fixed | Live¹ | Deployed via `supabase functions deploy`, validated with production smoke test |

¹ "Live" reflects deployment status as of this document's date (2026-07-19), anchored to the deploying commit rather than the Supabase function version counter: P0-003 was deployed from commit `0f34163`, P0-004 from commit `b4f6bb0` (Supabase-reported versions 4 and 8 respectively at deployment time, recorded here only as a point-in-time historical note — the function version counter will increment on any future redeploy for any reason and is not a reliable indicator on its own). To confirm what is actually live at any later date, check the currently deployed commit against `supabase functions list --project-ref sdfkvfbvgpuspnnnwqwk`, not this table.

---

## 4. Detailed Technical Summary

### P0-001 — Stale profile data across account switch

**Problem:** the Profile edit form's local state could retain data from a previously authenticated user after switching accounts, rather than reflecting the newly authenticated user's actual profile.

**Impact:** a user could see stale profile data (potentially another account's data) briefly rendered in the edit buffer following an account switch.

**Root Cause:** the profile edit buffer was initialized imperatively (e.g., on an avatar click handler) rather than being reactively derived from the authenticated user's profile object. No effect existed to resynchronize the buffer when the underlying user changed.

**Technical Fix:** the edit buffer is synchronized from `userProfile` via a `useEffect` keyed on `userProfile.id` (not the whole object, to avoid unnecessary resyncs on every profile field update), replacing the imperative initialization previously done in the avatar click handler. `setUserProfile(null)` on logout was retained only as defense-in-depth, not as the primary mechanism.

**Regression Prevention:** keying the effect on `userProfile.id` rather than the full object ensures the resync fires exactly on identity change, not on every unrelated profile field edit — preventing both understync (stale data) and oversync (disruptive resets during normal editing).

**Deployment Notes:** frontend-only change; shipped via the existing Vercel auto-deploy pipeline on push to `main`.

---

### P0-002 — Password recovery production-readiness

**Problem:** the password recovery flow (forgot password → reset link → password update) had not been reviewed end-to-end for production readiness: error handling, invalid/expired link detection, and resilience against repeated submissions were unverified.

**Impact:** users following a broken, expired, or reused recovery link could hit unhandled or confusing error states; rate-limit and validation errors from Supabase Auth were not consistently translated into actionable UI feedback.

**Root Cause:** the flow had not been audited against the full set of error states the Supabase Auth SDK can return during recovery, and no dedicated detection existed for invalid/expired recovery links.

**Technical Fix:** invalid/expired recovery link detection uses the official Supabase Auth SDK mechanism — `supabase.auth.initialize()` surfaces link failures as SDK-returned error codes (`otp_expired`, `flow_state_not_found`, `flow_state_expired`) rather than a custom timeout-based heuristic. A dedicated error-code-to-translated-message mapping (`authErrorMessage()` in `src/utils.js`) was introduced, covering rate limits (`over_email_send_rate_limit`, `over_request_rate_limit`), invalid email, weak password, same-password rejection, and session-expiry variants (`session_expired`, `session_not_found`, `refresh_token_not_found`), falling back to the raw SDK message for any unrecognized code rather than hiding the error. Repeated-submission protection and an explicit exit/reset flow were added to the UI.

**Regression Prevention:** the fix explicitly avoided migrating the recovery flow to the PKCE auth flow (the existing implicit flow was verified working and out of scope), keeping the change confined to error detection and messaging rather than the underlying auth mechanism. Automated tests (`src/utils.test.js`) cover the error-code mapping and confirm unrelated error codes (e.g., `weak_password`) do not trigger the invalid-link UI path.

**Deployment Notes:** frontend-only change; shipped via the existing Vercel auto-deploy pipeline on push to `main`.

---

### P0-003 — `admin-delete-client` cross-tenant deletion

**Problem:** the `admin-delete-client` Edge Function allowed an admin of one gym to permanently delete a member belonging to a *different* gym.

**Impact:** any authenticated admin account could irreversibly delete another gym's member — cascading through bookings, waitlist entries, class reminders, WOD logs, personal records, custom hero WODs, feed content, push subscriptions, and the `subscriptions` table — and delete the member's Supabase Auth account entirely, ending their ability to log in.

**Root Cause:** the function runs with a `service_role` Supabase client, which bypasses RLS entirely. It correctly verified the caller was *an* admin (via a server-side JWT check, `anonClient.auth.getUser(token)`) and that the target existed and was not itself an admin, but never compared the caller's `gym_id` against the target's `gym_id`. Because service_role bypasses the RLS policies that would otherwise enforce this (e.g., `subscriptions_admin_delete`'s `USING (is_admin(gym_id))`), no boundary existed at any layer for this specific code path.

**Technical Fix:** the caller's `admins` row lookup and the target's `profiles` lookup were widened to also select `gym_id`. A new pure function, `authorizeClientDeletion()`, encodes the full authorization decision (caller must be an admin; target must exist *and* belong to the caller's gym — merged into a single check returning an identical response for both "not found" and "wrong gym," to avoid disclosing cross-tenant existence via response differences; target must not itself be an admin) and is called before the deletion sequence begins. The deletion sequence itself was not modified.

**Regression Prevention:** the fix was verified to not affect same-gym deletions, since `target.gym_id === callerAdminRow.gym_id` holds by definition for any legitimate same-gym call. Automated Deno tests cover same-gym success, cross-gym rejection, admin-target rejection, and confirm the cross-gym and non-existent-target responses are byte-identical.

**Deployment Notes:** deployed independently via `supabase functions deploy admin-delete-client` (Edge Functions are not part of the Vercel auto-deploy pipeline and must be deployed explicitly). Validated in production via a live smoke test using disposable auth users and a disposable gym, confirming same-gym deletion still succeeds (including Auth user removal) and cross-gym deletion is now rejected with no data touched.

---

### P0-004 — `send-notification` missing authorization

**Problem:** the `send-notification` Edge Function performed no authorization check of any kind. Any authenticated user — regardless of role or gym — could trigger a real, gym-branded email and push notification to any `member_email`, using any of the function's supported notification types.

**Impact:** the platform-level `verify_jwt = true` setting only guaranteed the caller held *a* valid session; it did not verify who that caller was or what relationship they had to the notification's target. This made the function usable as an authenticated open notification relay: a member could send another member (in the same gym or a different one) a fabricated notification, including subscription-status content (e.g., a false "subscription cancelled" notice), using the gym's real Brevo sender identity.

**Root Cause:** unlike `admin-delete-client` and `analyze-workout`, which both independently re-verify caller identity and role via `anonClient.auth.getUser(token)` before acting, `send-notification` never called `getUser` or performed any lookup of the caller at all — `member_email` and `type` were taken directly from the request body and used immediately.

**Technical Fix:** the same caller-identity pattern from `admin-delete-client` was applied (`anonClient.auth.getUser(token)`), followed by a new pure function, `authorizeNotification()`, implementing exactly three authorization branches: the caller is an admin of the target's gym; the caller is a coach of the target's gym; or the notification type is `waitlist_booked` and the caller and target share the same gym. This third branch exists because the legitimate waitlist-promotion flow (`checkAndBookFromWaitlist` in `src/App.jsx`, triggered when any ordinary member cancels their own booking) sends a notification to a *different* member — the one being auto-promoted off the waitlist — from a non-staff caller's session. This flow was identified during investigation, before implementation, by tracing every call site of the client-side `sendNotification()` helper.

**Regression Prevention:** all five real call sites of `sendNotification()` in `src/App.jsx` were enumerated and mapped against the three authorization branches before the fix was written, confirming each one remains authorized post-fix. Automated Deno tests cover all three allowed branches (including two additional cases covering the remaining staff-triggered notification types, for five allowed-path tests total) and eight distinct rejection scenarios: a member sending each of the three staff-only types, a member sending `waitlist_booked` cross-gym, an admin sending cross-gym, an unrecognized notification type, a `member_email` with no matching profile, and a target profile with no `gym_id`. The missing-JWT case is covered separately via a direct call to the exported request handler.

**Deployment Notes:** deployed independently via `supabase functions deploy send-notification`. Validated in production via a live smoke test covering all four required scenarios (admin flow, coach flow, full waitlist-promotion sequence including real Brevo acceptance confirmation, and four distinct unauthorized-attempt cases), using disposable test identities and a disposable gym, all removed immediately after with a verified zero-residue sweep.

---

## 5. Production Changes

### What changed
- `supabase/functions/admin-delete-client/index.ts` — added gym-boundary authorization check (P0-003).
- `supabase/functions/send-notification/index.ts` — added caller-identity verification and authorization check (P0-004).
- `supabase/functions/admin-delete-client/index.test.ts`, `supabase/functions/send-notification/index.test.ts` — new automated test suites (Deno test runner).
- `supabase/functions/admin-delete-client/deno.json`, `supabase/functions/send-notification/deno.json` — added `@std/assert` as a test-only dependency.
- Frontend changes for P0-001 and P0-002 (profile edit state synchronization; password recovery error handling), deployed via the existing Vercel pipeline.

### What explicitly did NOT change
- **No schema migrations.** No table, column, constraint, or index was added, removed, or altered.
- **No database structure changes.**
- **No RLS policy modifications.** All RLS policies remain exactly as they were before this cycle.
- **No frontend API changes.** Every fixed Edge Function preserves its exact request shape, response shape, and status code conventions for all legitimate callers — no client code required modification as a result of P0-003 or P0-004.
- **No breaking changes** to any existing, legitimate workflow — confirmed via both automated tests and live production smoke tests for both Edge Function fixes.
- **No architecture redesign.** The notification system's content templates, delivery channels (Brevo email, web-push), and the member-deletion cascade sequence are unchanged. Multi-tenancy model, authentication flow, and the RLS-based authorization model for all other code paths are unchanged.

---

## 6. Security Guarantees After Hardening

The following statements are scoped precisely to the fixes completed in this cycle. This section does not claim coverage beyond what was implemented and verified — see Section 7 for known gaps.

- `admin-delete-client` and `send-notification` now establish caller identity server-side via `anonClient.auth.getUser(token)` before performing any privileged action, matching the pattern already used correctly in `analyze-workout` prior to this cycle (verified directly against `analyze-workout`'s source, not assumed).
- In both `admin-delete-client` and `send-notification`, authorization is evaluated and enforced before any database write, cascading deletion, external API call, or notification send — verified by static code review of both functions. Production verification of "no side effect on rejection" was performed per function, against the side effects that actually apply to it:
  - `admin-delete-client`: a rejected (cross-gym) deletion attempt was confirmed in production to leave the target's profile, cascaded tables, and Auth account completely untouched.
  - `send-notification`: rejected attempts were confirmed in production to trigger no Brevo email call, no push send, and no `push_subscriptions` cleanup — the latter verified by planting a disposable subscription row and confirming it still existed after the rejected call.
- Cross-tenant member deletion via `admin-delete-client` is prevented for the specific attack demonstrated during investigation (an admin supplying a `client_id` belonging to a different gym): this exact request now returns a generic 404 in production instead of succeeding, confirmed via live smoke test.
- Unauthorized notification sends via `send-notification` are prevented for the specific attacks demonstrated during investigation (a non-staff caller targeting another member; any caller targeting a member of a different gym), with one narrowly-scoped, verified exception (`waitlist_booked`, same-gym only) required by an existing legitimate workflow: these requests now return 403 in production instead of succeeding, confirmed via live smoke test.
- The above two points describe what was demonstrated and re-tested, not a formal proof that no other path to the same outcome exists in either function; both fixes were reviewed for completeness against the function's full body (there is no unreviewed code path left in either file that could reach a side effect without passing through the new authorization check), which is the basis for confidence beyond the specific tested cases.
- The authorization logic for both fixes is implemented as pure, dependency-free functions (`authorizeClientDeletion`, `authorizeNotification`) and covered by automated Deno unit tests that exercise the decision logic directly, without requiring a live Supabase backend.
- Both production deployments in this cycle were validated immediately afterward with live smoke tests against the actual deployed artifact, using disposable data, before being considered complete.

**Not covered by this cycle** (see Section 7): the `check-subscriptions` Edge Function remains fully unauthenticated in production (`verify_jwt = false`, no in-function check). The `subscriptions` table's RLS SELECT policy gap identified during the audit remains unresolved. Neither should be assumed fixed by this document.

---

## 7. Remaining Security Backlog

The audit that produced P0-003 and P0-004 identified four candidate issues in the Edge Function layer, numbered Finding 1 through Finding 4 in the original investigation. **Finding 1** (the `admin-delete-client` cross-tenant deletion gap) and **Finding 3** (the `send-notification` missing-authorization gap) were investigated and fixed in this cycle as **P0-003** and **P0-004** respectively (Sections 3–4). **Finding 2** and **Finding 4**, listed below under their original numbering for traceability back to that audit, remain open.

### Critical

**`check-subscriptions` Edge Function is fully unauthenticated in production.**
- *Description:* `verify_jwt = false` is set for this function (`supabase/config.toml`), and the function itself performs no authentication or authorization check. It runs with `service_role`, queries subscription-expiry data across all gyms, and sends real email and push notifications for each match. It is callable by anyone on the internet with no credentials.
- *Reason it remains:* this cycle's implementation work was scoped to P0-003 and P0-004 (Finding 1 and Finding 3) only; a dedicated investigation-and-fix cycle for Finding 2 has not yet been requested or performed.
- *Recommended next step:* investigate how this function is actually intended to be invoked in production (scheduled/cron trigger vs. manual), then restrict invocation accordingly — likely `verify_jwt = true` combined with a service-to-service invocation mechanism (e.g., a shared secret or cron-only trigger), following the same investigate-first, minimal-patch discipline used for P0-003/P0-004.
- *Current priority:* Critical — highest-exposure remaining item, since it requires no authentication at all, unlike every other finding in this cycle.

**`subscriptions` table RLS SELECT policy allows unauthorized cross-tenant reads.**
- *Description:* the `subscriptions_select_own_or_admin` RLS policy includes fallback clauses (a `class_waitlist` existence check with no time bound, and a "recent booking" existence check) that verify a fact about the *target* member without verifying the *caller's* identity or relationship to that member. This allows any authenticated user who knows a target's email and gym to read that member's subscription details (plan, dates, session counts, notes) if the target has ever joined a class waitlist in that gym — with no gym restriction on the caller.
- *Reason it remains:* identified during the audit as "Finding 4" (see the numbering note at the start of this section), confirmed exploitable, but not yet investigated for a fix. It sits directly in the `subscriptions` table, which falls within the production-critical policy defined in Section 2 ("Production review before deployment") — implementation requires the project owner's explicit sign-off before it is written, following an investigation phase.
- *Recommended next step:* investigate whether the waitlist/recent-booking fallback clauses can be tightened to require a caller-identity tie (mirroring the fix pattern used for P0-003/P0-004) without breaking the legitimate feature(s) that motivated these clauses; this requires a full investigation phase before implementation, per Section 2.
- *Current priority:* Critical — confirmed cross-tenant read access to billing/subscription data.

### High

*(No items currently classified High that are not already covered under Critical or Medium.)*

### Medium

**`class_reminders` table RLS policies share the same structural pattern as the `subscriptions` gap.**
- *Description:* `class_reminders_insert_own_or_admin_or_recent_booking` (and its `select`/`update` counterparts) has the same "verifies a fact about the target, not the caller" structure as the `subscriptions` fallback clauses.
- *Reason it remains:* reviewed during the audit and explicitly assessed as not meeting the P0 bar — the table holds only `class_id`/`member_email`/`remind_at`/`sent`/`gym_id`, and the worst-case impact (a suppressed or mistimed class reminder for a target whose email is already known) has no financial, authentication, or data-corruption consequence.
- *Recommended next step:* if the `subscriptions` fallback-clause fix (above) establishes a reusable caller-identity-tie pattern, apply the same shape here opportunistically, since the fix would likely be structurally identical.
- *Current priority:* Medium — real gap, low impact, worth fixing alongside the `subscriptions` item rather than on its own.

**`send-class-reminders` Edge Function has no in-function authorization check.**
- *Description:* structurally similar to `check-subscriptions` (a parameterless `Deno.serve` handler with no internal identity check), but not listed in `supabase/config.toml`'s `[functions.*]` blocks, so it defaults to the platform's `verify_jwt = true` — meaning it is not publicly callable without a valid session, unlike `check-subscriptions`.
- *Reason it remains:* reviewed during the audit and assessed as not meeting the P0 bar — it only processes already-legitimately-queued `class_reminders` rows and accepts no attacker-controlled target input, giving it a much smaller blast radius than the confirmed P0 findings.
- *Recommended next step:* for defense-in-depth consistency with the pattern now established in `admin-delete-client` and `send-notification`, add caller-identity verification when this function is next touched for any reason; not urgent on its own.
- *Current priority:* Medium.

### Architectural

**Client-side privilege flags (`isAdmin`, `isCoach`, `isPlatformAdmin`) are not reset on logout.**
- *Description:* these React state flags are freshly recomputed on user change but not explicitly cleared in the logout handler, creating a brief window where a UI element could render based on a stale privilege flag from the previous session before the fresh check resolves.
- *Reason it remains:* reviewed during the audit and assessed as not exploitable for actual data access, since the real authorization boundary for all data access is RLS (keyed on `auth.uid()`, never derived from client state) — a stale UI render does not translate into a stale data-access grant. This is a UI-hygiene observation, not a confirmed vulnerability.
- *Recommended next step:* reset these flags explicitly in the logout handler as routine hardening, not urgent.
- *Current priority:* Architectural / low — noted for completeness, not a security gap by the criteria used in this cycle.

**Broader production-reliability sweep was not performed.**
- *Description:* this cycle's audit scope was authentication, authorization, and multi-tenant isolation. The fifth P0 criterion — "production reliability failures that could block core application usage" — was not systematically swept beyond what surfaced incidentally during the authorization-focused review.
- *Reason it remains:* out of scope for this cycle; no evidence of an active reliability failure was found, but the absence of evidence is not the same as a completed sweep.
- *Recommended next step:* a dedicated reliability-focused audit, scoped and investigated the same way this cycle's security audit was, if and when prioritized.
- *Current priority:* Architectural — a scoping gap in this cycle, not a known defect.

---

## 8. Future Development Rules

The following are permanent engineering standards for Forge, derived directly from this hardening cycle. They apply to every new Edge Function and to any modification of an existing one.

1. **Establish caller identity server-side.** Any Edge Function that acts on behalf of a specific user, or that makes a decision based on who is calling, must independently verify the caller via `anonClient.auth.getUser(token)` (or equivalent) — never infer identity from client-supplied data, and never assume the platform's `verify_jwt` setting alone is sufficient (it proves *a* valid session exists, not *who* holds it or what they're allowed to do).

2. **Perform authorization before any side effect.** Every check that can reject a request must run, and every rejection must be returned, before the function performs its first database write, external API call, or other side effect. If a function needs data to make its authorization decision, those reads must themselves be free of side effects.

3. **Minimize blast radius.** Design each function's authorization model around the narrowest set of resources the caller actually needs, scoped to a specific tenant (gym) wherever the underlying resource is tenant-scoped. Treat "any authenticated user" as an untrusted caller by default, not a trusted one.

4. **Avoid `service_role` abuse.** Any function using a `service_role` client is bypassing RLS entirely and is solely responsible for reconstructing whatever tenant/ownership boundary RLS would otherwise have enforced. Before writing such a function, identify the RLS policy that would apply to the equivalent direct-table operation, and replicate its logic explicitly in the function.

5. **Include automated authorization tests.** The authorization decision logic for any privileged function must be extractable as a pure, dependency-free function and covered by automated tests exercising both the allowed and rejected paths — including every distinct legitimate caller role and at least one cross-tenant rejection case.

6. **Include production smoke tests at deployment time.** Every deployment of a security-relevant Edge Function must be followed by a live production verification pass — confirming both that legitimate workflows still succeed and that the specific rejection case(s) the fix targets are actually rejected — using disposable test data, never real user data.

7. **Require review before deployment.** Security-relevant changes require explicit review and approval before implementation begins, and a separate explicit approval before deployment — these are not the same gate, and neither should be skipped or merged into a single approval.

---

## 9. Lessons Learned

**Authentication is not authorization.** `verify_jwt = true` at the platform level, and even a caller-identity check inside a function, only answers "is this a real, logged-in user." Every function in this cycle that had a security gap had authentication working correctly and authorization either missing (`send-notification`) or incomplete (`admin-delete-client`, checking role but not tenant). These are two separate questions and both must be answered explicitly.

**Service-role code must reconstruct tenant boundaries by hand.** RLS enforces tenant isolation for every normal client-side query in this codebase, correctly, in the policies that were reviewed. `service_role` clients bypass that enforcement entirely — which means every Edge Function using `service_role` is a place where the RLS-equivalent boundary must be re-implemented explicitly in code, and where its absence or incompleteness is invisible until specifically audited for.

**Minimal patches reduce production risk.** Both Edge Function fixes in this cycle preserved every existing line of business logic, changed only the code paths directly responsible for the vulnerability, and were small enough to review and reason about completely — the P0-003 fix added a single comparison to two already-existing queries; the P0-004 fix, while larger since no identity-checking code existed at all, still touched nothing outside the request-handling function itself.

**Investigation before implementation prevents regressions, not just prevents wasted work.** The P0-004 investigation phase specifically discovered the `waitlist_booked` non-staff legitimate flow by tracing every real call site of the vulnerable function *before* writing the fix. A fix designed only from the vulnerability description, without that trace, would very likely have implemented a "staff-only" rule that broke a real, currently-working production feature.

**Security fixes should be independently testable.** Extracting the authorization decision into a pure function (no I/O, no framework dependency) made it possible to write fast, deterministic, offline unit tests covering every branch of the decision — including branches that would be impractical to exercise reliably against a live network-dependent integration test (e.g., every distinct role/gym combination).

**A fix is not verified until it has run against the actual deployed artifact in production.** Passing unit tests confirms the logic is correct in isolation; it does not confirm the deployed bundle, the live database triggers, the actual RLS policies, and the real external services (Brevo, web-push) all behave as expected together. Both deployments in this cycle were followed by a live smoke test for exactly this reason, and both surfaced information (e.g., real Brevo acceptance confirmations, real response-latency differences between authorized and rejected calls) that a unit test alone could not have provided.

---

## 10. Security Baseline Declaration

This document, **Forge Production Security Baseline v1**, dated 2026-07-19, represents the official production security baseline for Forge following the first structured security hardening cycle. It reflects the actual state of the system as verified through investigation, implementation, automated testing, and live production validation — not an aspirational or planned state.

Four P0 issues were investigated and resolved in this cycle (Section 3, Section 4). A further two Critical and two Medium items were identified during the same audit process and remain open, documented in full in Section 7, pending their own investigation-first hardening cycles.

All future security work on Forge should be understood as building on this baseline, not replacing it. Any future hardening cycle should produce its own dated addendum or superseding version (e.g., `FORGE_PRODUCTION_SECURITY_BASELINE_v2.md`) that explicitly references which items from this document's Section 7 it addresses, and should append any newly discovered items to the backlog using the same format established here. This document should not be silently edited to mark backlog items as resolved without a corresponding investigation-and-fix cycle of the same rigor documented in Sections 2 and 4 above.
