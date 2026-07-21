# ARCHITECTURE.md — Forge

> System architecture and component responsibilities. Updated only at meaningful architectural milestones — see `/docs/CHANGELOG.md` for when each section last changed, and `/docs/DECISIONS.md` for the reasoning behind frozen choices.
>
> Last updated: 2026-07-21.

---

## 1. Stack overview

```
┌──────────────────┐        ┌───────────────────────────┐
│  React 19 + Vite  │ ─────► │  Supabase (eu-central-1)  │
│  (Vercel, PWA)     │ ◄───── │  Postgres 17 + Auth + RLS  │
└──────────────────┘        │  + 5 Edge Functions (Deno) │
                             └───────────────────────────┘
                                        │
                          ┌─────────────┼──────────────┐
                          ▼             ▼              ▼
                    OpenAI API    Brevo (email)   Web Push (VAPID)
                  (analyze-workout)  (reminders,    (class reminders,
                                     expirations)    notifications)
```

- **Frontend**: `src/App.jsx` (~8,200 lines) is still the root of most screens, state, and Supabase I/O — no router, navigation via a `screen` state variable, inline-JS-object styling. Domain logic is progressively extracted into pure, unit-tested modules alongside it (see §7).
- **Backend**: Supabase — Postgres 17, RLS enforced on every table, 5 Deno Edge Functions, `pg_cron` for scheduled jobs.
- **Deploy**: push to `main` → Vercel redeploys automatically. Edge Functions deploy separately (`supabase functions deploy <name>`).
- **Testing**: Vitest, 356 tests across 11 files — every extracted module is pure logic, testable with zero Supabase/React dependency.

---

## 2. Critical operational fact — shared database

**Local dev (`localhost:5173`) and production (`forge-delta-ivory.vercel.app`) point at the same Supabase project and database.** No separate staging/dev database exists for day-to-day work. Any row created while testing locally is immediately live in production. Always clean up test data created during local validation.

(A genuinely separate `forge-demo` Supabase project was created 2026-07-18 for an isolated third-party product-review demo — see `/docs/PROJECT_STATE.md` for that in-progress task. It does not change this fact for normal development.)

---

## 3. Subsystems

Each tagged **FROZEN** (stable, do not redesign without strong justification + explicit go-ahead), **ACTIVE** (open to iteration), or **PLANNED** (not started). See `/docs/DECISIONS.md` for the reasoning behind each FROZEN status.

### 3.1 Workout Engine V2 — FROZEN (closed 2026-07-16)
Core domain model: `workouts` + `workout_sections` tables replace the old fixed-column `wods` table for representing a day's training. A `WorkoutSection` carries format, config, movements, scaling variants, logging mode, score type, and (primary section only) benchmark metadata. Migrated in 8 phases: schema → backfill → AI-schema prep → unified data layer → dual-write → atomic sync RPC (`slot_key`) → native section editor → Member View read-cutover → Logging read-cutover. `wods` remains the legacy dual-write target; Journal/Leaderboard/log-editing still read through it (not migrated — see `/docs/ROADMAP.md`).

### 3.2 Workout Composer + rendering pipeline — FROZEN (closed 2026-07-17)
Pure presentation layer between Workout Engine V2 and React:
- `src/workoutComposer.js` — `composeSection(section, variantKey)` transforms a `WorkoutSection` into a `ComposedWorkout`: `{ identity, primary: {text}, blocks: [{role, weight, scheme, movements, transitionBefore, restSeconds}], scoreNote }`.
- `src/ComposedWorkoutView.jsx` — renders `ComposedWorkout`, branching only on `block.role`/`block.weight`, never on workout format.

Core principle: movement rows carry only movement-specific facts; every structural fact (rep scheme, buy-in/cash-out framing, transitions, rounds) is carried by layout, never prose glued onto a movement. `scoreNote` is a closed code, not a pre-baked sentence — phrasing lives in `translations.js`, keeping the Composer language-free.

Genericity is total: every conditional in `workoutComposer.js` reads `family`/`scoreMode`/`rowMode`/config-field presence (e.g. `cfg.rounds`, `cfg.baseFormat`, `cfg.totalRounds`, a shared `hasEscalatingScheme()` check for `startReps`+`incrementReps`/`startWeight`+`incrementWeight`) — never a literal format name. Verified: zero `formatId === '<name>'` checks remain anywhere in the Composer or React layer. A new format with a known family/field shape composes correctly automatically.

Currently wired into **only** the Admin WOD editor's live preview (`ComposedWorkoutPreview` in `App.jsx`). Home/Jurnal/Leaderboard still use the older `describeFormatConfig()` field-summary renderer.

### 3.3 Workout Format Catalog — FROZEN (stable substrate)
`src/workoutFormats.js` — single source of truth for 23 workout formats (AMRAP, For Time, RFT, EMOM, Tabata, Intervals, Ladder, Chipper, Complex, Strength Sets, Buy-In/Cash-Out, Chained AMRAP, Partner WOD, Death By, etc). Each format declares `family` (`scored`/`sets`/`mixed`/`nft`/`chained`), optional `scoreMode`/`rowMode`/`ascending`, and a `config` schema (`{type, required, labelKey, ...}` per field). Drives the admin config editor, member logger, legacy summary, and the Composer — all generically by family/type, never by per-format branch lists. `sharedRepScheme` (`repsSchemeList` type, unifying "shared rep count per round") added 2026-07-17 to For Time/RFT/Chipper/Ladder.

### 3.4 Workout Intelligence (AI parser) — ACTIVE, v1 shipped
`analyze-workout` Edge Function (Deno, OpenAI `gpt-5-mini`, Structured Outputs) parses free-text workouts into Workout Engine V2 section shape. `src/workoutIntelligence.js` maps the AI response onto the native editor, derives lightweight non-blocking review flags (not a confidence-scoring system), normalizes titles/benchmark names, merges Buy-In/Cash-Out triples. See `/docs/DECISIONS.md` for the guiding principle ("make coaches better, not replace them").

### 3.5 Segment domain model — SPECIFIED, POSTPONED
A fuller compositional replacement for the enumerative format catalog (`Workout → WorkoutSection → Segment tree → Movements`), fully designed in `SEGMENT_MODEL_SPEC_v1.md`, then explicitly postponed. See `/docs/DECISIONS.md` for the full reasoning and revisit triggers.

### 3.6 Financial Domain — FROZEN (closed 2026-07-20)
`orders` + `payments` tables replace regex-parsing `subscriptions.notes` (e.g. `"Plătit: 379 RON"`) as the source of truth for revenue. Model: `Subscription → Order (1:1, every Subscription has one, even comp/pending) → Payment(s) (0..n, direction charge/refund, method/provider/provider_reference) → Reporting`. All writes go through SECURITY DEFINER RPCs — `create_subscription`, `activate_queued_subscription`, `delete_queued_subscription`, `end_subscription` (subscription lifecycle, admin-only except `activate_queued_subscription` which also accepts the subscription's own owner), `create_order_for_subscription` (admin-or-owner), `register_payment`/`refund_payment` (admin-only, never self-service — a caller-attested money-movement claim is a fraud vector self-service Order creation is not, since Order amounts are always server-derived from `subscription_plans.price`). `payments.method` is a closed, CHECK-constrained vocabulary (`cash`/`card`/`bank_transfer`/`comp` — no `'other'`; Apple/Google Pay are `method='card'` with a `provider`, not distinct channels); `provider`/`provider_reference` exist (with a `UNIQUE` idempotency guard for future webhook delivery) but are reserved, unpopulated — no real payment-provider integration exists yet. `payments` is append-only by design (no UPDATE/DELETE policy for any role); refunds are new `direction='refund'` rows, never mutations. Migrated in 5 phases (schema → core RPCs → subscription-lifecycle RPCs → application cutover → reporting migration) plus one post-closure extension (payment methods) — see `/docs/DECISIONS.md` and `docs/2026-07-20_Financial_Domain_Architecture_Working_Session.md` (the frozen ADR record, ADR-001 through ADR-013) for the full reasoning.

### 3.6a Online Payments (Stripe) — LIVE in production, validated end-to-end (2026-07-21)

Building on the frozen Financial Domain (§3.6), not reopening it. Goal: a member-initiated "Renew Now" Stripe Checkout flow where the commercial intent (Order) is created **before** payment, and the webhook only confirms it — not the deferred/create-on-webhook model originally proposed, which was explicitly rejected in favor of strengthening activation rules instead (see `/docs/DECISIONS.md`).

**Phase 5a (shipped)** is the RPC-layer authorization groundwork only — no Stripe SDK, Checkout Session, or webhook Edge Function exists yet:
- `create_order_for_subscription`, `register_payment`, `create_subscription`, `activate_queued_subscription` each gained a `service_role`-authorized path (detected via `(auth.jwt() ->> 'role') = 'service_role'`, since `auth.uid()`/`my_gym_id()` are null under that role — tenant is resolved from the target row instead).
- `register_payment` gained idempotent retry on `(provider, provider_reference)` — the mechanism a duplicate webhook delivery relies on.
- `create_subscription` gained a **self-service** path: a member may create their own pending subscription, but never with a caller-attested `p_amount_paid` (same fraud-vector line ADR-012 already drew), and always via the queued/pending branch — self-service creation never goes live before payment.
- `activate_queued_subscription` gained a **paid-Order activation guard**: any non-admin caller (member self-service or `service_role`) is blocked from activating a subscription whose Order exists and isn't `status = 'paid'`. If no Order exists at all (the pre-existing admin-scheduled-renewal path), behavior is unchanged — the guard only fires when there's something to check. Admin retains an unconditional override.
- A **pre-existing, unrelated defect** was found during Phase 5a's mandated validation (not introduced by this work): `subscriptions_restrict_member_update()` (a trigger from the waitlist auto-booking system, 2026-07-01/07-04) rejected *any* `service_role` update to `subscriptions` — including the new `activate_queued_subscription` service_role path above — because its bypass condition only recognized `is_coach_or_admin()` or a matching `auth.jwt() ->> 'email'`, and a real service-role JWT has neither. Fixed with a single added `OR (auth.jwt() ->> 'role') = 'service_role'` clause; every other caller class re-verified unaffected (see `/docs/DECISIONS.md`).

**Validated, not assumed** (mandated before Phase 5a could be considered approved):
- **Idempotency**: the same webhook event (same `provider_reference`) delivered twice via `register_payment`, followed by `activate_queued_subscription` called twice, produces exactly one Payment row, one Order transition to `paid`, and one active Subscription — verified via a rolled-back DB-level test suite.
- **Concurrency**: two genuinely parallel sessions (real lock-forced overlap, not sequential calls — confirmed via `clock_timestamp()` showing the second call blocked for the full duration and resumed within ~15ms of the first's commit) calling `register_payment` with the same `provider_reference`, and separately calling `activate_queued_subscription` on the same subscription, both end in exactly one Payment/Order/active-Subscription each. Worth stating precisely: the second `activate_queued_subscription` call isn't rejected by a guard, it serializes behind the first's row lock and reapplies the same idempotent end state — outcome-safe, not literally exactly-once execution.

**Phases 5b-5e (shipped 2026-07-21)**: `create-checkout-session` Edge Function (hosted Checkout, inline `price_data`, deterministic Idempotency-Key, reuse-window logic for pending Orders); `stripe-webhook` Edge Function (`--no-verify-jwt`, raw-body signature verification via `constructEventAsync`, re-validates the Order server-side before acting, idempotent on duplicate delivery); frontend "Renew Now" button + waiting-state screen (`App.jsx`); `online_payments_enabled` per-gym `app_settings` flag gating the entry point.

**Stripe configuration**: the integration runs against the company's real production Stripe account (confirmed intentional, not test mode — see `/docs/DECISIONS.md`). `isGymAllowedForKey()`/`TEST_MODE_GYM_ID` exist to sandbox a `sk_test_...` key to one gym, but this guard has **no effect at all under a live key** — every gym with `online_payments_enabled = true` is equally exposed to real charges; that flag alone is what currently gates each gym's access to this flow.

**M6 status: CLOSED (2026-07-21)**. All 13 original success criteria (authenticated click → `create-checkout-session` → one Order → Stripe Checkout → payment → webhook delivery → signature verified → processed exactly once → one Payment → RPC activation → Order paid → Subscription active → UI reflects it) verified with a real, live Stripe payment against an isolated sandbox gym (CrossFit Tester), including a genuine duplicate-webhook-delivery replay proving idempotency. Full evidence: `docs/2026-07-21_Financial_Domain_Production_Readiness_Report.md`.

### 3.7 Multi-tenancy — FROZEN (closed 2026-07-14)
Every one of 19 public tables carries `gym_id`; 64 RLS policies scoped to it. One gym per account. Owner signup requires a platform-admin-issued registration code; member signup requires a separate per-gym access code. A "Platform" Admin tab (platform-admin only) lists all gyms with activate/deactivate — today's entire payment-enforcement mechanism (no billing integration yet).

### 3.8 Authentication — STABLE
Supabase Auth, email + password. `profiles.gym_id` scopes a user to their gym. `admins`/`coaches` tables plus a platform-admin flag gate the Admin panel and its sub-tabs (Coach role: WOD + Classes only).

**A deleted-user session is not automatically invalidated by Supabase** — an already-issued JWT stays cryptographically valid until its own expiry regardless of whether the underlying `auth.users`/`profiles` rows still exist; only future token refreshes fail. `fetchUserProfile()` (`App.jsx`) is the app's own detection layer: a profile lookup returning zero rows (and not the owner-bootstrap transient window) forces a client-side sign-out (P0-005, 2026-07-21) rather than silently falling through to an unrelated screen.

### 3.8a Member Identity vs. Gym Membership — clarified, not re-architected (2026-07-21)
Officially: **User** (`auth.users` + `profiles`, global identity) and **Membership** (`profiles.gym_id`, the relationship to one gym) are distinct concepts, deliberately *not* split into separate tables — no Membership table, no RLS rewrite, no auth redesign (see `/docs/DECISIONS.md`). `profiles.gym_id = NULL` is membership having ended; the profile row, `auth.users`, financial history (Orders/Payments), and training/social history (`wod_logs`/`personal_records`/`custom_hero_wods`/`feed_*`) all survive it untouched.

**Remove Member** (`admin-remove-member` Edge Function, replaces the retired `admin-delete-client`) implements this: clears `profiles.gym_id`, ends any active subscription through `end_subscription` (never a raw table write), and deletes only genuinely operational/transient data (`bookings`, `class_waitlist`, `class_reminders`, `push_subscriptions`) — never `auth.users`, `profiles`, `orders`, `payments`, or training/social history.

A dedicated **"No Gym" application state** (`noGymMembership` in `App.jsx`) renders when a profile exists with `gym_id = NULL` outside the owner-bootstrap window — this same condition also covers a genuinely-interrupted owner bootstrap (no data signal distinguishes the two today; documented, not resolved).

**Delete User** (true identity deletion) remains unbuilt, deliberately postponed — see `/docs/DECISIONS.md`.

**P0-006 status: CLOSED (2026-07-21)**. All 13 original regression checks verified with real data, including the two that required an actual subscription lifecycle (expired/exhausted subscription still shows the Renew screen; a completed purchase restores access) — both exercised for real as part of the M6 live-payment validation (§3.6a). Full evidence: `docs/2026-07-21_Financial_Domain_Production_Readiness_Report.md`.

### 3.9 Database structure

21 public tables, all `gym_id`-scoped, RLS on every one:
- **Identity/tenancy**: `gyms`, `profiles`, `admins`, `coaches`, `gym_signup_codes`
- **Membership/billing**: `subscription_plans`, `subscriptions`
- **Financial Domain**: `orders`, `payments` (see §3.6)
- **Scheduling**: `classes`, `bookings`, `class_waitlist`, `class_reminders`, `class_reminder_log`
- **Workouts (legacy + V2)**: `wods` (legacy, still dual-write target), `workouts`, `workout_sections`, `workout_section_types`, `workout_scaling_levels` (unused by any consumer)
- **Logging/results**: `wod_logs`, `skill_logs`, `personal_records`, `custom_hero_wods`
- **Social**: `feed_posts`, `feed_reactions`, `feed_comments`
- **Infra**: `app_settings`, `push_subscriptions`

**Important**: `supabase/migrations/*.sql` does **not** reliably reflect the live schema/RLS state — some changes were applied directly without a committed migration. Always confirm live (`pg_policies`), never assume from migration files alone. **Exception**: the Financial Domain (`orders`/`payments` and all related RPCs, §3.6) plus the Phase 5a payments-authorization layer (§3.6a) were built entirely through committed, verified migrations (`supabase/migrations/20260720*.sql`, 32 files) — that subsystem's migration history is complete and authoritative.

### 3.10 Supabase Edge Functions (Deno)

| Function | Purpose |
|---|---|
| `analyze-workout` | AI parsing of pasted workout text → Workout Engine V2 section shape |
| `check-subscriptions` | Daily cron (08:00) — expiring-subscription emails via Brevo |
| `send-class-reminders` | Push notifications ahead of booked classes |
| `send-notification` | Generic web-push sender (VAPID) |
| `admin-delete-client` | Server-side client deletion (`service_role`) |

Required secrets (names only): `OPENAI_API_KEY`, `OPENAI_MODEL`, `BREVO_API_KEY`, `FROM_EMAIL`, `FROM_NAME`, `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, `VAPID_SUBJECT` (+ auto-injected `SUPABASE_URL`/`SUPABASE_ANON_KEY`/`SUPABASE_SERVICE_ROLE_KEY`).

Required frontend env vars: `VITE_SUPABASE_URL`, `VITE_SUPABASE_KEY` (anon key). Optional: `VITE_SENTRY_DSN`.

---

## 4. Components and responsibilities

| File | Responsibility |
|---|---|
| `src/App.jsx` (~8,200 lines) | Root component, all screens, auth, most Supabase I/O |
| `src/workoutFormats.js` | Format catalog (23 formats), scoring/duration/PR-detection pure functions |
| `src/workoutEngine.js` | Workout Engine V2 domain mapping, load/sync functions |
| `src/wodSections.js` | Native Workout Section editor's pure logic |
| `src/workoutIntelligence.js` | AI-draft → editor mapping, review-flag derivation, normalization |
| `src/workoutComposer.js` | `WorkoutSection` → `ComposedWorkout` pure transform |
| `src/ComposedWorkoutView.jsx` | React rendering of `ComposedWorkout` |
| `src/FormatConfigEditor.jsx` | Admin's per-format config widgets, generic by field `type` |
| `src/FormatLogger.jsx` | Member-facing logging UI, generic by `family`/`rowMode` |
| `src/translations.js` | RO/EN string table (~1,750 lines) |
| `src/movements.js` | Movement name catalog/autocomplete/canonicalization |
| `src/utils.js` | Small pure helpers (time, date, weight conversion) |
| `src/components.jsx` | Shared UI atoms |
| `src/supabase.js` | Supabase client init |
| `supabase/functions/*` | Edge Functions, see §3.10 |
| `supabase/migrations/*` | 103 SQL migrations — 71 pre-Financial-Domain (incomplete history) + 32 complete, verified Financial Domain/Payments migrations (see §3.9) |

Every module above (except `App.jsx`/`supabase.js`) has a co-located `*.test.js(x)` file.

---

## 5. Known gotchas (verify again before touching related code)

- **RLS + shared DB**: a Postgres DELETE/UPDATE that matches 0 rows due to RLS returns `{error: null}`, not an error — always check `data.length > 0` before reporting success.
- **RLS on new/changed tables**: "admin bypasses RLS" is not universal — only true where a policy explicitly has `OR is_admin()`. Verify per policy, per command (SELECT/INSERT/UPDATE/DELETE are separate policies).
- **4 real Postgres RLS behaviors** found during the multi-tenant conversion (all passed code review, failed live testing): SECURITY DEFINER recursion when an RLS helper function reads a table its own policy also uses; `INSERT ... ON CONFLICT DO UPDATE` evaluates the INSERT policy even when the real branch is UPDATE; UPDATE/DELETE requires the target row to already be SELECT-visible; `WITH CHECK` re-evaluates a same-table subquery that still sees the pre-update value mid-statement. Reproduce-then-fix any future RLS change involving SECURITY DEFINER helpers or nullable-then-populated columns.
- **OpenAI Structured Outputs strict mode**: a nullable array type (`type: ['array','null']`) combined with nested `items` is rejected outright. Always use `type: 'array'` with an empty array for "not applicable."
- **Migration files vs. live DB**: never assume schema/RLS state from `supabase/migrations/*.sql` alone — some changes were applied directly without a committed migration.
- **`SECURITY DEFINER` does not bypass table triggers**: only RLS and column/table grants are affected by a function's owner privileges — a `BEFORE UPDATE` trigger on the target table still fires and still evaluates `auth.jwt()`/`auth.uid()` exactly as it would for a direct client call. Found during Phase 5a: extending an RPC's own `if not (is_admin(...) or ...)` check to accept `service_role` is not sufficient by itself if the RPC's internal `UPDATE` touches a table with its own independent trigger-based restriction — check every trigger on every table a new caller class' code path writes to, not just the RPC's own authorization logic.
- **A column-level `BEFORE UPDATE` trigger can block a design that RLS review alone wouldn't catch**: `prevent_gym_id_change()` (shared across 24 tables since the 2026-07-14 multi-tenant rewrite) unconditionally blocks any change to `gym_id` once set — found only when P0-006's Remove Member (`profiles.gym_id → NULL`) actually hit it live; an RLS-only design review (checking `USING`/`WITH CHECK`) missed it entirely. `profiles` now has its own narrower trigger/function (`prevent_profiles_gym_id_change`) permitting exactly `<a gym> → NULL`; the shared function is untouched, still governs the other tables.
- **A deleted `auth.users`/`profiles` row does not invalidate an already-issued JWT** — the access token stays valid until its own expiry; only a future refresh-token exchange fails. Any "does this account still exist" check has to happen in application code against the current row state, not by trusting that a stale-but-unexpired session implies the account is real (P0-005).
