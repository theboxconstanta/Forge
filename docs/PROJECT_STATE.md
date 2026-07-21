# PROJECT_STATE.md — Forge Engineering Handover

**Status:** Authoritative engineering state snapshot.
**Date:** 2026-07-21.
**Scope:** Complete. A new engineer should be able to continue this project after reading only this file, though `docs/ARCHITECTURE.md`, `docs/DECISIONS.md`, `docs/ROADMAP.md`, `docs/CHANGELOG.md`, and `docs/security/FORGE_PRODUCTION_SECURITY_BASELINE_v1.md` hold deeper detail on their respective topics and should be treated as the extended reference, not duplicated here in full.

---

# Project

Forge is a gym-management SaaS for CrossFit/functional-fitness boxes. Athletes see the daily workout, log results and PRs, book classes, and track their subscription. Coaches and owners run the gym from an Admin panel: programming, class scheduling, member/subscription management, and coach provisioning.

**Purpose:** replace ad-hoc spreadsheets/paper/generic booking tools with a purpose-built system for CrossFit-style programming (varied daily workouts, benchmark/hero WODs, PRs, leaderboards) combined with class booking and membership management.

**Technology stack:**
- Frontend: React 19 + Vite, installable PWA, no router (a `screen` state variable drives navigation), inline JS-object styling. Root file `src/App.jsx` (~8,200 lines) still owns most screens, state, and Supabase I/O; domain logic is progressively extracted into pure, unit-tested modules alongside it.
- Backend: Supabase — Postgres 17, Row-Level Security enforced on every table, 7 Deno Edge Functions.
- Deploy: push to `main` → Vercel redeploys the frontend automatically. **Edge Functions do not deploy this way** — each requires an explicit `supabase functions deploy <name>`.
- Testing: Vitest for frontend pure-logic modules; Deno's built-in test runner for Edge Functions.
- Bilingual RO/EN (`src/translations.js`).
- External integrations: OpenAI (workout-text parsing), Brevo (transactional email, replaced Resend), Web Push/VAPID (push notifications).

**Current maturity:** live production SaaS, real users. Originated as a single-gym app for CrossFit C15 (Constanța, Romania); converted to genuine multi-tenant SaaS 2026-07-14. At the time of this document, approximately 40 active members across multiple gyms.

---

# Product Vision

**Long-term objective:** a multi-tenant SaaS product sellable to other gyms, not a bespoke single-gym tool. Multi-tenancy (one gym per account, full data isolation via RLS) is already implemented and closed as an initiative.

**Engineering philosophy**, established and repeatedly reaffirmed across this project's history:
- Investigate before implementing. Every non-trivial change — feature or fix — gets a dedicated investigation phase before code is written, with explicit sign-off as a separate step from "investigate" and from "deploy."
- Minimal, production-safe patches over broad refactors. Production is live with real user data; every additional changed line is additional regression surface.
- Never invent structure from unstructured data. A heuristic that guesses right most of the time but occasionally guesses wrong on real data is worse than an honest, visible gap.
- Evidence over assumption, especially for security and production-behavior claims. Documentation alone is treated as a lower tier of evidence than direct, live observation when the two are available to compare.

**Non-goals (deliberately not pursued):**
- Self-serve **gym** signup. Gym activation is still a manual Platform Admin action, by design. (Member-initiated **subscription renewal payment** is no longer a non-goal — see Online Payments below, closed 2026-07-21.)
- Native mobile app store presence — PWA only.
- A generic, framework-level "workout builder" — the domain model (Workout Engine V2) is CrossFit-specific by design, not a general-purpose fitness content system.

**Core priorities, in order, as evidenced by actual project history:** (1) production safety and multi-tenant data isolation, (2) core athlete/coach/admin workflows working correctly, (3) architectural investment only where real, repeated usage justifies it (several specced initiatives — Segment domain model, code-splitting — were deliberately deferred after cost/benefit review, not abandoned).

---

# Current Development Status

**Current phase:** production security hardening cycle (in progress), following completion of the multi-tenant conversion, Workout Engine V2, Workout Composer, and Workout Intelligence v1 initiatives (all closed/frozen — see Architecture Snapshot).

**Completed milestones** (chronological, high-level — see `docs/CHANGELOG.md` for the dated ledger):
1. Multi-tenant SaaS conversion (Phases 0–4 + platform admin) — closed 2026-07-14.
2. Workout Engine V2 (core domain model, dual-write architecture) — closed 2026-07-16.
3. Workout Composer + rendering pipeline — closed as an architectural initiative 2026-07-17/18; live only in Admin preview, not yet the default renderer for Home/Journal/Leaderboard.
4. Workout Intelligence v1 (AI-assisted workout parsing, 5-item hardening roadmap) — shipped 2026-07-16/17.
5. RO/EN internationalization — complete.
6. Isolated demo environment (`forge-demo`) for external product review — shipped 2026-07-18.
7. First structured security hardening cycle — P0-001 through P0-004 complete and live in production. P0-005 investigation ongoing (see Incident Tracker; unrelated to and does not block anything below).
8. Financial Domain (`Subscription → Order → Payment → Refund → Reporting`) — closed and frozen 2026-07-20. See `docs/2026-07-20_Financial_Domain_Architecture_Working_Session.md`.
9. **Online Payments (Stripe) — M6 and M7 CLOSED, 2026-07-21.** Member-initiated "Renew Now" → Stripe Checkout → webhook → automatic Subscription activation, running against the company's real production Stripe account. Validated end-to-end with one real live payment (isolated sandbox gym), including a proven idempotent duplicate-webhook-delivery test. CrossFit C15's `online_payments_enabled = true` is confirmed intentional production configuration, not a carried-forward risk. Full evidence: `docs/2026-07-21_Financial_Domain_Production_Readiness_Report.md`.
10. **P0-006 (Remove Member / Identity vs. Membership clarification) — CLOSED, 2026-07-21.** All 13 regression checks verified with real data. See `docs/DECISIONS.md`.

**Branch status:** all work lands directly on `main`; no long-lived feature branches. Working tree is clean as of this document (all P0-005-related changes are committed and pushed).

**Deployment status:**
- Frontend: current `main` is live via Vercel auto-deploy. Confirmed 2026-07-21: production deployment SHA matches local `HEAD` exactly (`74d3b2b`).
- Edge Functions: `send-notification` (v8), `check-subscriptions` (v12) reflect their latest committed code from the security cycle. `analyze-workout` (v15) and `send-class-reminders` were not touched by it. `admin-remove-member`, `create-checkout-session`, and `stripe-webhook` deployed source confirmed byte-for-byte identical to local source as of 2026-07-21.

**Production status:** live, serving real gyms and members. One open incident affects `check-subscriptions` specifically (see Incident Tracker) — it is currently non-functional for its intended purpose (subscription-expiry reminders) but poses no security risk, and was already non-functional (zero invocations) before this cycle began.

---

# Architecture Snapshot

Only implemented components are listed.

**Frontend:** React 19 + Vite PWA. `src/App.jsx` is the root of most UI and Supabase I/O. Domain logic progressively extracted into pure modules (`src/utils.js` and others) that are independently unit-tested with zero React/Supabase dependency.

**Backend:** Supabase project (`sdfkvfbvgpuspnnnwqwk`, `eu-central-1`). Postgres 17. RLS enabled and enforced on every table (dozens of policies). SECURITY DEFINER helper functions (`is_admin`, `is_coach_or_admin`, `my_gym_id`, `is_platform_admin`, and others) provide the reusable RLS building blocks.

**Database:** every tenant-scoped table carries a `gym_id` column; a `prevent_gym_id_change` trigger blocks mutating an already-set `gym_id`. Multi-tenant isolation is RLS-first — any Edge Function using `service_role` (which bypasses RLS entirely) is individually responsible for reconstructing whatever tenant boundary RLS would otherwise enforce.

**Authentication:** Supabase Auth. Password recovery uses the implicit flow deliberately (not PKCE — see Decisions Log); invalid/expired recovery links are detected via the official SDK mechanism (`supabase.auth.initialize()` returning specific error codes), not a custom timeout heuristic.

**Edge Functions (7, Deno):**
| Function | Purpose | Auth model |
|---|---|---|
| `analyze-workout` | AI parsing of pasted workout text → Workout Engine V2 section shape | Caller identity verified server-side (admin or coach) |
| `check-subscriptions` | Intended: daily job sending expiring-subscription emails/push | `verify_jwt=false` + in-function check against `SUPABASE_SECRET_KEYS["default"]` via the `apikey` header — **currently non-functional, see Incident Tracker** |
| `send-class-reminders` | Push notifications ahead of booked classes | Platform default (`verify_jwt=true`), no in-function check — reviewed, not P0 (limited blast radius) |
| `send-notification` | Generic web-push/email sender | Caller must be admin/coach of the target's gym, or the specific `waitlist_booked`-same-gym case |
| `admin-remove-member` | Ends a member's relationship with a gym (`profiles.gym_id → NULL`, ends any active subscription) — replaces the retired `admin-delete-client`, which deleted identity outright | Caller must be an admin of the target's own gym; cannot target another admin |
| `create-checkout-session` | Creates a Stripe Checkout Session for member-initiated subscription renewal | Caller's own Supabase session token; `online_payments_enabled` gym flag required |
| `stripe-webhook` | Receives `checkout.session.completed`, activates the paid Subscription | `--no-verify-jwt` + Stripe signature verification (`constructEventAsync`) |

**AI components:** `analyze-workout` uses OpenAI to parse free-text workout descriptions into the structured Workout Engine V2 section format. Deliberately never infers structure the input doesn't actually contain.

**Third-party integrations:** OpenAI (workout parsing), Brevo (transactional email — replaced Resend), Web Push/VAPID (push notifications), Stripe (member subscription renewal payments — the company's real production account, confirmed intentional, not test mode; see `docs/DECISIONS.md`).

**Critical operational fact:** local development and production point at the **same live Supabase project and database** — there is no separate staging environment. Any data created while testing locally is immediately live in production and must be cleaned up.

---

# Current Open Work

| Workstream | Status | Priority | Blocked? | Notes |
|---|---|---|---|---|
| INCIDENT-001 — `check-subscriptions` gateway rejection | Open, investigation paused pending new evidence | High (blocks P0-005 closure) | Yes — awaiting Dashboard-level evidence only obtainable by a human with Supabase Dashboard access | See Incident Tracker |
| `subscriptions` RLS cross-tenant read gap | Identified, not yet investigated for a fix | Critical (security) | No, but touches a production-critical area requiring explicit approval before implementation | See Decisions Log — standing production-critical policy |
| `class_reminders` RLS same structural gap | Identified, not yet fixed | Medium | No — deferred to fix opportunistically alongside the subscriptions item | Low individual impact |
| `send-class-reminders` no in-function auth | Identified, reviewed, does not meet the P0 bar | Medium | No | Low blast radius (only processes pre-queued rows) |
| Client-side privilege flags not reset on logout | Identified, reviewed, not exploitable | Low | No | UI hygiene, not a security gap (RLS is the real boundary) |
| Composer rollout to Home/Journal/Leaderboard | Specified and validated, not yet wired in | Product polish, not architecture | No | Composer itself is closed as an initiative |
| Workout Intelligence WI-2 (re-analysis safety policy) | Placeholder only | Not started | No | — |
| Membership Catalog / Plan Selection (Admin → Plans, member-facing plan browsing/selection) | Not started | New, separate milestone | No | Explicitly out of scope for M6/M7 — do not fold into Online Payments' closed scope |

No workstream currently has a named individual owner in this document — assign based on who picks up each item.

---

# Incident Tracker

## INCIDENT-001 — `check-subscriptions` rejected at the Supabase API gateway

**Status:** Open. Investigation paused, not abandoned — resuming requires new evidence, not further analysis of what's already been gathered.

**Summary:** `check-subscriptions` was rewritten to require a valid `apikey` credential (Supabase's official "Option 1" migration pattern — `verify_jwt=false`, credential compared against `SUPABASE_SECRET_KEYS["default"]`) and deployed to production (v12). Post-deployment testing shows the function correctly rejects every unauthorized case (no credential, wrong credential, credential on the wrong header). However, the *legitimate* credential — the project's real `"default"` secret key, freshly fetched via the Supabase Management API — is also rejected, and the rejection happens **before** the deployed function code ever runs. A separate, unrelated PostgREST call (`GET /rest/v1/gyms`) using the identical secret key fails identically, proving this is not specific to this Edge Function or to any code in this repository.

**Current evidence:**
- The secret key and the project's publishable key (`sb_publishable_...`) share an identical creation timestamp (`2026-06-23T07:09:20.001812+00:00`), matching the project's own creation time — both keys have existed since project creation, not recently provisioned.
- The publishable key and the legacy `anon` key both succeed against the same PostgREST endpoint the secret key fails against.
- The secret key's Management API record contains a `secret_jwt_template: {"role": "service_role"}` field; the publishable key's record has `secret_jwt_template: null` — a structural difference between the two key types.
- A known methodological gap exists in the evidence: the one side-by-side comparison test (secret key vs. publishable key against `/rest/v1`) sent different header sets — the secret-key request included both `apikey` and `Authorization`, the publishable-key request included only `apikey`. A separate, single-header (`apikey`-only) test of the secret key against the Edge Function itself also failed identically, which partially — not fully — offsets this gap for the Edge Function context specifically, but the PostgREST comparison itself remains uncontrolled.

**Remaining unknowns:**
- Whether Supabase secret keys require an activation/enablement step beyond mere creation, as a real, documented platform concept — not established anywhere consulted.
- What the `secret_jwt_template` field mechanically does, or whether its state is implicated in the failure.
- Whether a clean, `apikey`-only secret-key request against `/rest/v1` (removing the header-combination confound entirely) would still fail.
- What the Supabase Dashboard shows for the secret key's status, compared side-by-side with the publishable key's entry — this has never been checked, since it requires Dashboard access not available via CLI/API.

**Next action:** a human with Supabase Dashboard access should check Project Settings → API Keys, compare the `"default"` secret key's entry against the publishable key's entry (which is confirmed working), and report any status, warning, or difference shown. This is the single piece of evidence identified as most likely to resolve the investigation; nothing else has been identified as higher-value.

**Explicitly not yet established:** a root cause. Two hypotheses remain live and mutually exclusive-or-compatible (see Hypotheses section) — neither has been proven or eliminated.

**Security impact of the current state:** none negative. The function fails closed for every tested case, including the "real" credential — strictly safer than its pre-fix fully-public state. It was not functioning (zero invocations) before this cycle began either, so no working capability was lost.

---

# Decisions Log

| Decision | Reason | Alternatives considered | Why rejected | Impact |
|---|---|---|---|---|
| Multi-tenancy: one gym per account, manual activation, no self-serve signup or payments | Converting to multi-tenant was already a large architectural change; adding real payments simultaneously would stack two major risks at once | Self-serve signup with Stripe integration | Deferred, not rejected outright — revisit when manual activation becomes a real bottleneck or self-serve becomes a business priority | Registration requires a manually-issued code; gym activation is a manual toggle |
| Workout Engine V2: dual-write, not a hard cutover | Migrating every read path simultaneously would make it much harder to isolate what broke if something did | Cut all reads over to V2 at once | Higher risk, harder rollback | Journal, Leaderboard, and log-editing still read the legacy `wods` table by design, not oversight |
| Workout Composer: never infer structure from unstructured text | A heuristic that's usually right but occasionally wrong on real data is worse than a visible, honest gap | Parse free-text to reconstruct missing structured fields | Same reasoning as Workout Intelligence's design | Legacy WODs authored before certain structured fields existed render their raw text until re-entered |
| Password recovery: stay on the implicit auth flow, do not migrate to PKCE | The existing implicit flow was verified working; migrating flows was out of scope for a production-readiness fix | Migrate to PKCE while fixing recovery | Would have expanded scope beyond what was needed to close the actual gap | Recovery flow unchanged at the protocol level; only error detection/messaging was hardened |
| P0-003 fix: merge "target not found" and "target in another gym" into an identical 404 response | A differentiated response would let an attacker confirm a `client_id` exists in a different gym | Return distinct 403/404 for each case | Information disclosure risk | Both cases are indistinguishable to the caller |
| P0-004 fix: three-branch authorization model (admin-of-target-gym, coach-of-target-gym, or `waitlist_booked`-same-gym), not a blanket staff-only rule | Investigation found one legitimate non-staff caller (`checkAndBookFromWaitlist`, triggered when any member cancels their own booking) that a naive staff-only fix would have silently broken | Staff-only authorization | Would have broken a real, currently-working production feature | The narrower rule was implemented and confirmed via production smoke test to preserve every legitimate call site |
| P0-005 architecture: official Supabase "Option 1" (manual `verify_jwt=false` + `apikey` + `SUPABASE_SECRET_KEYS`), not `@supabase/server` | Actively researched both officially-documented paths; `@supabase/server` is confirmed public beta with no official production-readiness statement found either way; Option 1 requires no new dependency and matches the codebase's established minimal-patch pattern | `@supabase/server` SDK (`auth: 'secret'` mode) | Introduces an unvetted beta dependency for a task that doesn't require it; no official guidance found recommending beta production use | Authorization logic is hand-written and unit-tested, matching P0-003/P0-004's pattern |
| Security baseline is a versioned, append-only document | Prevents silent redefinition of "what's already fixed" as new cycles occur | Continuously edit one living document | Loses the historical record of what was true when | `docs/security/FORGE_PRODUCTION_SECURITY_BASELINE_v1.md` is frozen; future cycles produce v2, v3, etc., referencing what v1 left open |
| Production-critical areas (subscriptions, membership expiration, billing, access control tied to subscriptions) require explicit approval before any implementation, even for confirmed bugs found during investigation | Explicit standing rule for this project, given real subscription/billing data is at stake | Allow the same investigate-then-implement cycle used elsewhere | Higher stakes area, deliberately given an extra approval gate | Investigation into these areas may proceed and be reported; implementation may not begin without separate, explicit sign-off |
| Segment domain model: spec complete, implementation deliberately postponed | Critical cost/benefit review after the spec was finished | Implement immediately following the spec | No real usage signal yet justifying the investment | `SEGMENT_MODEL_SPEC_v1.md` remains a frozen reference, not actioned without a new, real signal |

---

# Technical Debt

**Accepted debt** (known, deliberately not addressed now):
- `src/App.jsx` remains ~8,200 lines and still owns most Supabase I/O directly. Extraction into pure modules is ongoing but incremental, not a scheduled rewrite.
- Journal, Leaderboard, and log-editing still read the legacy `wods` table rather than Workout Engine V2 natively — a direct consequence of the deliberate dual-write decision, not an oversight.
- The Composer rendering pipeline is validated and correct but wired only into the Admin preview — not yet the production renderer for member-facing screens.
- Three pre-existing TypeScript type errors in `supabase/functions/check-subscriptions/index.ts` (a `SupabaseClient` generic-parameter mismatch and a `row.subscription` typing issue) — confirmed present in the version already live in production before the P0-005 cycle began, independently reproduced against the pre-change commit, non-blocking for deployment. Not introduced or fixed by this cycle.
- No monitoring or alerting exists on `check-subscriptions` (or, more broadly, no systematic Edge Function failure alerting) — a real, disclosed gap that predates and is not addressed by this cycle.
- `class_reminders` table RLS policies share the same structural authorization gap as `subscriptions` (see Current Open Work) — deferred as low-impact.

**Deferred improvements** (specified or considered, explicitly not started, revisit only on new signal):
- Segment domain model (full spec exists, frozen).
- Bundle code-splitting (~914KB single JS chunk) — deferred at user's explicit choice.
- PR workflow for repeated WODs — deferred until after a stated launch milestone.
- Workout Intelligence WI-2 (re-analysis safety policy) and the longer-term "Programming Advisor" concept — not started.

**Known risks:**
- Shared dev/production database (see Architecture Snapshot) — any local testing mistake is immediately live.
- `check-subscriptions` currently cannot fulfill its intended purpose at all (see Incident Tracker) — subscription-expiry reminders are not being sent to any member, though this predates the current cycle.

---

# Completed Reviews

| Review | Scope | Outcome |
|---|---|---|
| Fresh security audit (criteria-scoped: security vulnerabilities, auth/authz failures, multi-tenant isolation, data corruption, production reliability) | Full codebase, Edge Functions, RLS policy set | **Completed** — produced the P0-003 through P0-005 finding set plus the remaining backlog; **no action required** on this review itself, findings tracked separately |
| Architecture review (P0-005: Option 1 vs. `@supabase/server`) | Official Supabase migration documentation, both paths | **Completed, no action required** — Option 1 selected with documented rationale |
| Security review (P0-003, P0-004, P0-005 implementations) | Each fix's authorization logic, injection/bypass attempts | **Completed, no action required** for all three — no bypass found in any, after adversarial attempts |
| Regression review (P0-003, P0-004, P0-005) | Business logic, query, notification/email/push preservation | **Completed, no action required** — confirmed unchanged via diff review for all three |
| Release/gate review (P0-005, multiple rounds) | Deployment readiness, findings severity classification | **Completed** — approved for controlled deployment; **requires revisit** only in the sense that the post-deployment incident (INCIDENT-001) is a separate, still-open matter, not a defect in the reviewed code itself |
| Forensic/scientific-evidence review (INCIDENT-001) | Every conclusion in the incident investigation, classified by evidentiary strength | **Completed** — explicitly concluded root cause **NOT established**; **requires revisit** once new evidence (Dashboard check or a clean confound-free test) is available |
| M6 milestone close-out (Stripe Checkout → webhook → activation, all 13 original criteria) | Real live payment against production Stripe account, isolated sandbox gym; genuine duplicate-webhook-delivery idempotency test | **CLOSED, 2026-07-21** — all 13 criteria PASS with direct evidence; no action required. Full report: `docs/2026-07-21_Financial_Domain_Production_Readiness_Report.md` |
| P0-006 milestone close-out (Remove Member, all 13 regression checks) | Real data validation, including the two subscription-lifecycle checks previously blocked on "no real subscription ever exercised" | **CLOSED, 2026-07-21** — all 13 checks PASS; no action required |

---

# Known Facts

Only directly proven statements, no interpretation:

- The multi-tenant conversion, Workout Engine V2, Workout Composer (as an architecture, not full rollout), Workout Intelligence v1, and RO/EN i18n are complete and live in production.
- P0-001 through P0-004 security fixes are deployed, live, and were each independently smoke-tested against production with disposable data, confirming both the fix's effectiveness and zero regression to legitimate workflows.
- `check-subscriptions` v12 is live in production with `verify_jwt=false` and the new authorization code; it correctly rejects every unauthorized test case (no credential, wrong credential, wrong header).
- The same `check-subscriptions` deployment rejects the project's real `"default"` secret key, with the rejection occurring before the deployed application code executes (proven by the response body format not existing anywhere in the deployed source file).
- The identical secret key is also rejected by an unrelated PostgREST endpoint (`GET /rest/v1/gyms`), with the identical error text.
- The project's publishable key and legacy `anon` key both succeed against that same PostgREST endpoint.
- The secret key and publishable key share an identical creation timestamp, matching the project's own creation timestamp.
- `send-notification` and `admin-delete-client` construct their outbound service-role Supabase clients using `SUPABASE_SERVICE_ROLE_KEY` and are confirmed working in production after the same platform event that is implicated in INCIDENT-001 — this credential remains functional for that purpose.
- Local development and production share one live Supabase database (no separate staging).
- Edge Functions require a separate, explicit deploy step (`supabase functions deploy <name>`) — pushing to `main` does not deploy them.
- `STRIPE_SECRET_KEY` is a live (`sk_live_...`) key against the company's real, pre-existing Stripe account — confirmed directly (not assumed from docs) and confirmed intentional by explicit product-owner decision, 2026-07-21.
- `isGymAllowedForKey()`/`TEST_MODE_GYM_ID` provide no gym-level isolation under a live key — only the per-gym `online_payments_enabled` flag currently gates exposure to real Stripe charges.
- One real, live Stripe payment was completed end-to-end on 2026-07-21 (CrossFit Tester, isolated sandbox gym) and independently confirmed via Stripe's own event log, the database, and the rendered UI.
- CrossFit C15 is Forge's production gym; its `online_payments_enabled = true` is a confirmed, intentional production configuration (product-owner decision, 2026-07-21) — not a validation artifact, not accidental.

# Known Unknowns

Explicitly not yet proven, kept separate from the above:

- The root cause of INCIDENT-001.
- Whether Supabase secret keys require an activation step distinct from publishable keys, as a real platform mechanism.
- What the `secret_jwt_template` field controls, or whether it is implicated in the failure.
- Whether the header-combination confound (see Incident Tracker) fully or partially explains the observed secret-key failure.
- What the Supabase Dashboard shows for either key's status.
- Whether `check-subscriptions` has ever had a working, legitimate scheduler at any point in this project's history — confirmed to have zero invocations as of the investigation, but the historical question of "was it ever configured and later broken" versus "was it never configured" was not conclusively settled.

# Hypotheses

Both remain open; neither eliminated:

**H-A: The secret key requires a Supabase-side activation/enablement step, distinct from publishable keys, not yet completed for this project.**
- Supporting: publishable key (identical age, identical project) works; secret key doesn't, on two independent endpoints; secret key has a structural field (`secret_jwt_template`) the publishable key lacks.
- Contradicting: none directly, but the comparison test has an uncontrolled confound (see below), which prevents this hypothesis from being the sole surviving explanation.
- Confidence: best current hypothesis, not proven.
- Required evidence to confirm: Dashboard-level status confirmation, or official Supabase documentation/support statement naming this mechanism explicitly.

**H-B: The observed secret-key failure is an artifact of the specific header combination used in the one side-by-side comparison test, not a property of the key or key type itself.**
- Supporting: the failing secret-key/PostgREST test sent both `apikey` and `Authorization` headers; the succeeding publishable-key test sent only `apikey` — a genuine, uneliminated confound.
- Contradicting: a separate, single-header (`apikey`-only) test of the secret key against the Edge Function itself also failed — this weakens but does not eliminate H-B, since that was a different endpoint, not the controlled comparison itself.
- Confidence: cannot currently be distinguished from H-A.
- Required evidence to confirm or eliminate: a clean, `apikey`-only secret-key request against `/rest/v1`, exactly mirroring the successful publishable-key test's header set.

---

# Safe Next Steps

In priority order:

1. Resolve INCIDENT-001 via the single identified diagnostic action: check the Supabase Dashboard (Project Settings → API Keys) for the `"default"` secret key's status, compared against the publishable key's entry.
2. If Dashboard access isn't immediately available, run the one identified confound-free test instead: a clean, `apikey`-only request to `/rest/v1` using the secret key, matching the publishable-key test's header set exactly — this is read-only, safe, and directly discriminates between H-A and H-B.
3. Once INCIDENT-001 is resolved (either the key issue is fixed via a Dashboard action, or a code-level cause is discovered with real evidence), re-run the existing production smoke-test checklist already defined for P0-005 before considering it closed.
4. After P0-005 closes, begin investigation (not implementation) of the `subscriptions` RLS cross-tenant read gap, following the same investigate-first discipline — remembering this touches a production-critical area requiring explicit approval before any implementation.

# Unsafe Next Steps

Explicitly do not, without new evidence or explicit direction:

- Do not redeploy `check-subscriptions` again with a different guessed authentication mechanism. The deployed code is correct; the failure is upstream of it.
- Do not migrate to `@supabase/server` as a reaction to INCIDENT-001 — it would not address a gateway-level credential rejection, and the beta-status concern that ruled it out originally still applies.
- Do not declare INCIDENT-001's root cause resolved without either the Dashboard evidence or the confound-free test result — the forensic review specifically and deliberately stopped short of this.
- Do not implement a fix for the `subscriptions` or `class_reminders` RLS gaps without a dedicated investigation phase and, for `subscriptions` specifically, explicit approval given its production-critical classification.
- Do not modify any other Edge Function while investigating `check-subscriptions` — none of the others are implicated in INCIDENT-001.
- Do not re-run the same CLI/Management-API-only diagnostic loop already exhausted for INCIDENT-001 — it has reached its evidence ceiling; only Dashboard access or a specifically-designed confound-free test adds new information.
- Do not roll back the P0-005 deployment as an incident response — it introduced no regression; rolling back would only restore the prior, fully-public, unauthenticated state.

---

# Resume Checklist

1. Read this file in full before taking any action.
2. Check whether INCIDENT-001 has new evidence (Dashboard status, or a fresh diagnostic result) — if not, the highest-priority action is obtaining it via the two options listed under Safe Next Steps.
3. Confirm current production state before assuming anything: `supabase functions list --project-ref sdfkvfbvgpuspnnnwqwk` for Edge Function versions, `git log` / `git status` on `main` for source state — do not assume the state described here is still current without re-checking, since this document is a snapshot, not a live feed.
4. If resuming security work generally, read `docs/security/FORGE_PRODUCTION_SECURITY_BASELINE_v1.md` for the full first-cycle writeup and its own backlog section before starting anything new.
5. If resuming any other subsystem (Composer rollout, Workout Intelligence WI-2, etc.), read the relevant section of `docs/ROADMAP.md` and `docs/ARCHITECTURE.md` first.
6. Never create test data against production without cleaning it up immediately afterward (shared dev/prod database — see Architecture Snapshot).
7. Never log in as a real user, and never handle real user credentials directly, even with permission — this is a standing constraint for this project regardless of task.

---

# Context That Must Never Be Lost

- **Authentication is not authorization.** Every confirmed security finding in this project's history involved a function that correctly verified "is this caller real/logged in" while failing to verify "is this caller allowed to do *this specific thing*." This distinction must be checked explicitly for every new privileged code path, not assumed from the presence of any authentication check.
- **`service_role` code must reconstruct tenant boundaries by hand.** Any Edge Function using `service_role` bypasses RLS entirely and is solely responsible for re-implementing whatever gym-boundary check RLS would otherwise provide. This is the root cause pattern behind every confirmed P0 finding in this project.
- **Minimal patches are a deliberate, load-bearing engineering value here, not a stylistic preference.** Every fix in the security cycle was scoped to the smallest change that closed the identified gap, with refactoring, architecture changes, and new dependencies explicitly avoided unless strictly necessary for the fix itself.
- **Documentation is not the same tier of evidence as direct observation**, especially for platform/infrastructure behavior. This project's own history includes a case (P0-005) where a fix based on correct documentation-derived reasoning failed in production for reasons the documentation didn't cover — always prefer a live check over an assumption when the two could plausibly diverge, and say so explicitly when only documentation is available.
- **Multi-tenancy is one-gym-per-account, RLS-first**, not a shared-schema-with-application-level-filtering model. Any new table or query must be checked against this model, not assumed compatible.
- **Production-critical areas** (subscriptions, membership expiration, billing/payments, access control tied to subscriptions) carry a standing, explicit approval requirement before implementation, independent of how the bug or feature was discovered.
- **Never invent structure from unstructured input.** This principle governs both the AI-parsing components (`analyze-workout`) and general data-handling: a visible gap that requires a human to fix is preferred over a heuristic that's usually right.
- **Code comments in this codebase are written in Romanian**, explaining *why*, not *what* — a non-obvious constraint, a past bug, or a subtle invariant. This convention is established and should be followed for consistency, not silently changed to English or removed.
- **The demo environment (`forge-demo`) is fully isolated** — separate Supabase project, separate Vercel deployment, no production data ever copied over, no real third-party API secrets configured. It exists specifically so external review never touches real gym/member data.
