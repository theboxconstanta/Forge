# ARCHITECTURE.md — Forge

> System architecture and component responsibilities. Updated only at meaningful architectural milestones — see `/docs/CHANGELOG.md` for when each section last changed, and `/docs/DECISIONS.md` for the reasoning behind frozen choices.
>
> Last updated: 2026-07-18.

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
- **Testing**: Vitest, 349 tests across 11 files — every extracted module is pure logic, testable with zero Supabase/React dependency.

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

### 3.6 Multi-tenancy — FROZEN (closed 2026-07-14)
Every one of 19 public tables carries `gym_id`; 64 RLS policies scoped to it. One gym per account. Owner signup requires a platform-admin-issued registration code; member signup requires a separate per-gym access code. A "Platform" Admin tab (platform-admin only) lists all gyms with activate/deactivate — today's entire payment-enforcement mechanism (no billing integration yet).

### 3.7 Authentication — STABLE
Supabase Auth, email + password. `profiles.gym_id` scopes a user to their gym. `admins`/`coaches` tables plus a platform-admin flag gate the Admin panel and its sub-tabs (Coach role: WOD + Classes only).

### 3.8 Database structure

19 public tables, all `gym_id`-scoped, RLS on every one:
- **Identity/tenancy**: `gyms`, `profiles`, `admins`, `coaches`, `gym_signup_codes`
- **Membership/billing**: `subscription_plans`, `subscriptions`
- **Scheduling**: `classes`, `bookings`, `class_waitlist`, `class_reminders`, `class_reminder_log`
- **Workouts (legacy + V2)**: `wods` (legacy, still dual-write target), `workouts`, `workout_sections`, `workout_section_types`, `workout_scaling_levels` (unused by any consumer)
- **Logging/results**: `wod_logs`, `skill_logs`, `personal_records`, `custom_hero_wods`
- **Social**: `feed_posts`, `feed_reactions`, `feed_comments`
- **Infra**: `app_settings`, `push_subscriptions`

**Important**: `supabase/migrations/*.sql` does **not** reliably reflect the live schema/RLS state — some changes were applied directly without a committed migration. Always confirm live (`pg_policies`), never assume from migration files alone.

### 3.9 Supabase Edge Functions (Deno)

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
| `supabase/functions/*` | Edge Functions, see §3.9 |
| `supabase/migrations/*` | 71 SQL migrations (incomplete history — see §3.8) |

Every module above (except `App.jsx`/`supabase.js`) has a co-located `*.test.js(x)` file.

---

## 5. Known gotchas (verify again before touching related code)

- **RLS + shared DB**: a Postgres DELETE/UPDATE that matches 0 rows due to RLS returns `{error: null}`, not an error — always check `data.length > 0` before reporting success.
- **RLS on new/changed tables**: "admin bypasses RLS" is not universal — only true where a policy explicitly has `OR is_admin()`. Verify per policy, per command (SELECT/INSERT/UPDATE/DELETE are separate policies).
- **4 real Postgres RLS behaviors** found during the multi-tenant conversion (all passed code review, failed live testing): SECURITY DEFINER recursion when an RLS helper function reads a table its own policy also uses; `INSERT ... ON CONFLICT DO UPDATE` evaluates the INSERT policy even when the real branch is UPDATE; UPDATE/DELETE requires the target row to already be SELECT-visible; `WITH CHECK` re-evaluates a same-table subquery that still sees the pre-update value mid-statement. Reproduce-then-fix any future RLS change involving SECURITY DEFINER helpers or nullable-then-populated columns.
- **OpenAI Structured Outputs strict mode**: a nullable array type (`type: ['array','null']`) combined with nested `items` is rejected outright. Always use `type: 'array'` with an empty array for "not applicable."
- **Migration files vs. live DB**: never assume schema/RLS state from `supabase/migrations/*.sql` alone — some changes were applied directly without a committed migration.
