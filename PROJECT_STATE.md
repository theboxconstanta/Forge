# PROJECT_STATE.md — Forge (CrossFit gym management SaaS)

> Last rewritten: 2026-07-18. This document replaces a stale version dated 2026-06-25 — nearly everything below it described (RLS disabled, single-tenant, no Workout Engine, no AI, hardcoded "CrossFit C15") is no longer true. Treat this rewrite as authoritative; commit it every time a major milestone closes.
>
> **Purpose**: let another engineer (or a future session) pick up development with zero additional context. Read this top to bottom before touching code.

---

## 1. Project vision

**Forge** is a gym-management SaaS for CrossFit / functional-fitness boxes: athletes see the daily workout, log results and PRs, book classes, and track their subscription; coaches/owners run the whole gym (clients, subscriptions, plans, classes, workouts) from an Admin panel.

- **Origin**: built for CrossFit C15 (Constanța, Romania), a single real gym, as the first paying customer / design partner.
- **Current model**: converted from single-tenant to a genuine **multi-tenant SaaS** (2026-07-14) — any number of independent gyms can now run on the same deployment, each fully data-isolated. CrossFit C15 is tenant #1, not a hardcoded assumption anymore.
- **Business model**: monthly subscriptions (4/8/12/20/24 sessions + Open Gym), currently activated/renewed manually by each gym's own admin. Platform-level billing (charging gyms themselves) is still manual — see §7.
- **Long-term ambition**: sell to other boxes as a subscription SaaS product. Payments/Stripe integration is explicitly out of scope until a self-serve signup flow is built (see §7).
- **App shape**: mobile-first PWA (max width ~430px), installable to a phone home screen, no native app store presence yet.

---

## 2. Architecture

### 2.1 High-level stack

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

- **Frontend**: still substantially one large file, `src/App.jsx` (~8,200 lines) — no router, navigation via a `screen` state variable. Domain logic has been progressively extracted into pure, unit-tested modules alongside it (see §4). Styling is inline JS objects (no CSS framework in the UI itself, though Tailwind is a dependency).
- **Backend**: Supabase — Postgres 17, Row Level Security enforced on every table, 5 Deno Edge Functions, `pg_cron` for scheduled jobs.
- **Deploy**: push to `main` on GitHub → Vercel redeploys automatically (~1 min). Edge Functions deploy separately via `supabase functions deploy <name>`.
- **Testing**: Vitest, 349 tests across 11 files, all pure-logic modules (no Supabase/React needed to run them).

### 2.2 Critical operational fact — shared database

**Local dev (`localhost:5173`) and production (`forge-delta-ivory.vercel.app`) currently point at the exact same Supabase project and database.** There is no separate staging/dev database today. Any row created while testing locally is immediately live in production, visible to real gym members and staff. Always clean up test data created during local validation before ending a session. (A genuinely isolated `forge-demo` Supabase project was created 2026-07-18 for an external product-review demo — see §9 — but that is a *new, separate* project, not a fix to this shared-DB situation for day-to-day dev.)

### 2.3 Subsystems — status and stability

Each subsystem below is tagged **FROZEN** (stable, do not redesign without strong justification and explicit user go-ahead), **ACTIVE** (open to iteration), or **PLANNED** (not started).

#### Workout Engine V2 — **FROZEN** (closed 2026-07-16)
The core domain model: `workouts` + `workout_sections` tables replace the old fixed-column `wods` table for representing a day's training. A `WorkoutSection` carries format, config, movements, scaling variants, logging mode, score type, and (for the primary section) benchmark metadata. Migration ran in 8 phases (schema → backfill → AI-schema-only → pure data layer → dual-write → atomic RPC/`slot_key` → native section editor → Member View read-cutover → Logging read-cutover). Officially declared feature-complete and primary; `wods` stays as the legacy write target (dual-write keeps `workout_sections` in sync) until a future phase migrates Journal/Leaderboard/log-editing off the `wods` join too (not scheduled). See §8 for the one real bug this frozen status doesn't cover (WOD-deletion FK ordering — already fixed, `4eac2dc`).

#### Workout Composer + rendering pipeline — **FROZEN** (closed 2026-07-17)
A pure presentation layer sitting between Workout Engine V2 and React: `src/workoutComposer.js` (`composeSection(section, variantKey)`) transforms a `WorkoutSection` into a `ComposedWorkout` — a small, closed vocabulary of content blocks (`role`/`weight`/`scheme`/`movements`/`transitionBefore`) — and `src/ComposedWorkoutView.jsx` renders it, branching only on `role`/`weight`, never on workout format. Movement rows carry only movement-specific facts; every structural fact (rep scheme, buy-in/cash-out framing, transitions, rounds) is carried by layout, never prose glued onto a movement. Verified end-to-end against 17 real production WODs; one genuine rendering bug found and fixed live (single-movement sections were duplicating the movement name as heading and body line). A later, deeper audit found and removed the last 3 places the Composer branched on literal format identity (`RFT`/`For Time`/`Partner WOD`/`EMOM`/`Tabata`/`Intervals`/`Death By`) — all 3 turned out expressible with fields the catalog already had (`rounds`, `baseFormat`, `totalRounds`, `startReps`+`incrementReps`/`startWeight`+`incrementWeight`); zero new catalog metadata was needed. Confirmed: the presentation layer is now **fully semantic-driven** — a new format with a known `family`/`scoreMode`/`rowMode` composes correctly automatically, with no Composer or React changes.
Currently wired in **only one place**: a live preview inside the Admin WOD editor (`ComposedWorkoutPreview` in `App.jsx`). Home, Jurnal, and Leaderboard still render the older per-field summary (`describeFormatConfig`) — unifying them was explicitly deferred; see §7. Standing rule going forward (user-set, 2026-07-17): **only recurring, evidence-based feedback from real usage justifies further Composer changes** — a single one-off observation gets logged, not acted on.

#### Workout Format Catalog — **FROZEN** (stable substrate under the above two)
`src/workoutFormats.js` — single source of truth for all 23 workout formats (AMRAP, For Time, RFT, EMOM, Tabata, Intervals, Ladder, Chipper, Complex, Strength Sets, Buy-In/Cash-Out, Chained AMRAP, Partner WOD, Death By, etc). Each format declares a `family` (`scored`/`sets`/`mixed`/`nft`/`chained`), optional `scoreMode`/`rowMode`/`ascending` tags, and a `config` schema (field name → `{type, required, labelKey, ...}`). This catalog drives the admin config editor (`FormatConfigEditor.jsx`), the member-facing logger (`FormatLogger.jsx`), the terse legacy summary (`describeFormatConfig`), and the Workout Composer — all generically, keyed by family/type, never by a hardcoded per-format branch list. `sharedRepScheme` (a `repsSchemeList`-typed field unifying "the shared rep count per round," e.g. "21-15-9") was added 2026-07-17 to For Time/RFT/Chipper/Ladder, migrating Ladder's older free-text `repsScheme`.

#### Workout Intelligence (AI parser) — **ACTIVE**, v1 shipped
`analyze-workout` Supabase Edge Function (Deno, real OpenAI `gpt-5-mini` via Structured Outputs) turns pasted free-text workouts into Workout Engine V2-shaped sections. `src/workoutIntelligence.js` maps the AI's response onto the native editor (`sectionsFromAiAnalysis`), derives lightweight non-blocking review flags (`deriveReviewFlags` — unknown movement, ambiguous format, missing weight/distance, unresolved benchmark — not a confidence-scoring system, deliberately), and normalizes titles/benchmark names/Buy-In-Cash-Out merges. Explicit design principle: **"Workout Intelligence exists to make coaches better, not to replace them"** — AI never auto-publishes, never silently overwrites a human edit, uncertainty is always shown not hidden. A 5-item real-world-exploration roadmap (title normalization, ambiguous_format scoping, benchmark-name backfill, Buy-In/Cash-Out merge, Chained AMRAP stage support) is fully shipped (2026-07-17). Next planned increment, **not started**: WI-2 (a real re-analysis policy — today re-clicking "Analizează" just overwrites, a known placeholder) and the longer-term "Programming Advisor" vision (reasoning across a gym's structured history) — see §6.

#### Segment domain model — **SPECIFIED, DELIBERATELY POSTPONED**
A fuller compositional replacement for the enumerative format catalog (`Workout → WorkoutSection → Segment tree → Movements`) was fully designed (`SEGMENT_MODEL_SPEC_v1.md`) after two real parser gaps (Chained AMRAP, Buy-In/Cash-Out) suggested the enum model might be hitting its limits. After an explicit cost/benefit review, the user chose to postpone: both motivating bugs turned out to have cheap point-fixes inside the current architecture (now shipped), no concrete blocked feature was found, and the estimated migration cost rivaled the entire 8-phase Workout Engine V2 migration. The spec is frozen as a reference. Revisit only if: 3+ genuinely new formats are needed in a short window, a concrete feature is actually blocked by the enum, the format-config-translator tables visibly become a maintenance bottleneck, or V2 has run stable in production for a meaningful stretch.

#### Multi-tenancy — **FROZEN** (closed 2026-07-14)
Every one of 19 public tables carries a `gym_id`; all RLS policies (64 of them) are scoped to it. One gym per account (not multi-gym-per-login, modeled after BeyondTheWhiteboard). Owner signup ("Start a new gym") requires a registration code the platform admin issues manually after an offline payment conversation; member signup ("Join a gym") requires a separate, per-gym access code the gym's own admin can view/regenerate. A "Platform" Admin tab (visible only to the platform admin) lists all gyms with activate/deactivate (deactivating a gym blocks all admin+member access for it — today's entire mechanism for enforcing payment, since there is no billing integration yet).

#### Authentication — **STABLE**
Supabase Auth, email + password. Role resolution: `profiles.gym_id` scopes a user to their gym; an `admins`/`coaches` distinction plus a platform-admin flag (checked against Lucian's own account) gates the Admin panel and its sub-tabs (Coach role sees only WOD + Classes tabs, no Clients/Subscriptions/Plans/Settings).

#### Database structure — see §2.4 below.

#### Edge Functions — see §2.5 below.

### 2.4 Database structure (summary — not exhaustive)

19 public tables, all `gym_id`-scoped, RLS enforced on every one (re-verify live via `pg_policies`, not just migration files — see the important caveat at the end of this subsection). Core groups:

- **Identity/tenancy**: `gyms`, `profiles`, `admins`, `coaches`, `gym_signup_codes`
- **Membership/billing**: `subscription_plans`, `subscriptions`
- **Scheduling**: `classes`, `bookings`, `class_waitlist`, `class_reminders`, `class_reminder_log`
- **Workouts (legacy + V2)**: `wods` (legacy fixed-column table, still the dual-write target), `workouts`, `workout_sections`, `workout_section_types`, `workout_scaling_levels` (created, seeded, currently unused by any consumer)
- **Logging/results**: `wod_logs`, `skill_logs`, `personal_records`, `custom_hero_wods`
- **Social**: `feed_posts`, `feed_reactions`, `feed_comments`
- **Infra**: `app_settings`, `push_subscriptions`

**Important, easy to get wrong**: the migration files under `supabase/migrations/` do **not** reliably reflect the live schema/RLS state — some changes were applied directly (SQL Editor or one-off scripts) without a corresponding committed migration file. `supabase db push` can fail with "remote migration versions not found locally" for exactly this reason. Always confirm current RLS policy state by querying the live database (`pg_policies`), never by reading migration files alone, before asserting what a table's security posture is.

### 2.5 Supabase Edge Functions (Deno)

| Function | Purpose |
|---|---|
| `analyze-workout` | AI parsing of pasted workout text → Workout Engine V2 section shape (OpenAI `gpt-5-mini`, Structured Outputs) |
| `check-subscriptions` | Daily cron (`pg_cron`, 08:00) — finds expiring subscriptions, emails members via Brevo at 3/1/0 days remaining |
| `send-class-reminders` | Push notifications ahead of booked classes |
| `send-notification` | Generic web-push sender (VAPID) |
| `admin-delete-client` | Server-side client deletion (bypasses client-side RLS constraints safely, `service_role`) |

Required Edge Function secrets (names only — see repo `.env.local`/Supabase dashboard for values, never commit values): `OPENAI_API_KEY`, `OPENAI_MODEL`, `BREVO_API_KEY`, `FROM_EMAIL`, `FROM_NAME`, `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, `VAPID_SUBJECT`, plus the auto-injected `SUPABASE_URL`/`SUPABASE_ANON_KEY`/`SUPABASE_SERVICE_ROLE_KEY`.

Required frontend env vars (Vercel + local `.env`, not `.env.local` which is Vercel-CLI-pulled metadata only): `VITE_SUPABASE_URL`, `VITE_SUPABASE_KEY` (anon key). Optional: `VITE_SENTRY_DSN` (error tracking is wired via `@sentry/react`).

---

## 3. Components and responsibilities

| File | Responsibility |
|---|---|
| `src/App.jsx` (~8,200 lines) | Root component, all screens (Home/Log/PR/Leaderboard/Feed/Admin), auth, most Supabase I/O, still the biggest single file — extraction into pure modules is ongoing, not complete |
| `src/workoutFormats.js` | Format catalog (23 formats), scoring/duration/PR-detection pure functions |
| `src/workoutEngine.js` | Workout Engine V2 domain mapping (legacy row ↔ Workout/Section domain shape), load/sync functions |
| `src/wodSections.js` | Native Workout Section editor's pure logic (legacy row ↔ editable section list, legacy-compat validation) |
| `src/workoutIntelligence.js` | AI-draft → editor section mapping, review-flag derivation, title/benchmark normalization |
| `src/workoutComposer.js` | `WorkoutSection` → `ComposedWorkout` pure transform (the "Composer") |
| `src/ComposedWorkoutView.jsx` | React rendering of `ComposedWorkout` — role/weight-driven, zero format awareness |
| `src/FormatConfigEditor.jsx` | Admin's per-format config input widgets, generic by field `type` |
| `src/FormatLogger.jsx` | Member-facing logging UI, generic by format `family`/`rowMode` |
| `src/translations.js` | RO/EN string table (`getT(lang)`), ~1,750 lines |
| `src/movements.js` | Movement name catalog/autocomplete + canonicalization helpers |
| `src/utils.js` | Small pure helpers (time formatting, date math, weight conversion) |
| `src/components.jsx` | Small shared UI atoms (`AvatarCircle`, `LevelDot`, `MovementSuggestions`) |
| `src/supabase.js` | Supabase client init from `VITE_SUPABASE_URL`/`VITE_SUPABASE_KEY` |
| `supabase/functions/*` | Edge Functions, see §2.5 |
| `supabase/migrations/*` | 71 SQL migrations (incomplete history — see §2.4 caveat) |

Every `.js`/`.jsx` module above (except `App.jsx` itself and `supabase.js`) has a co-located `*.test.js(x)` file; 349 tests total, all runnable with zero network/Supabase dependency.

---

## 4. Implementation status

### Fully completed
- Auth, multi-tenant gym isolation, subscriptions/plans/classes/bookings/waitlist, RLS on every table.
- Workout Engine V2 (all 8 phases) — primary architecture for representing a day's training.
- Workout Composer + rendering pipeline — fully semantic-driven, validated against real production data, live only in the Admin preview so far.
- Workout Format Catalog — 23 formats, generic editor/logger/summary/composer support.
- Workout Intelligence v1 (Transcription Assistant, "Paste-to-Draft") — 5-item post-launch roadmap fully shipped.
- PWA packaging, installable to phone home screen.
- i18n (RO/EN) across the entire app.
- Sentry error tracking.

### Partially completed
- **Composer rollout**: implemented and proven correct, but only wired into the Admin editor preview — Home/Jurnal/Leaderboard still use the older field-summary renderer. Unifying them is a real, not-yet-scheduled next step.
- **Workout Intelligence**: v1 (parsing quality) done; re-analysis safety policy (WI-2) still a placeholder ("always overwrite"); the long-term "Programming Advisor" (reasoning across a gym's history) not started at all.
- **Extraction of `App.jsx` domain logic into pure modules**: substantial (workoutFormats/workoutEngine/wodSections/workoutIntelligence/workoutComposer all extracted), but `App.jsx` itself remains the single largest file and still owns most Supabase I/O and screen composition.

### Planned but not started
- Migrating Journal/Leaderboard/log-editing reads off the legacy `wods` join onto Workout Engine V2 natively.
- Lifting the `validateSectionsForLegacy` gate (today caps a WOD at 1 primary + 3 non-primary sections) — blocked on resolving the section-`typeKey` persistence debt first (see §8).
- WI-2 (real re-analysis policy for Workout Intelligence).
- Self-serve gym signup + real payment integration (Stripe or similar) — today gym activation is 100% manual via the Platform Admin tab.
- Code-splitting the JS bundle (currently ~914KB minified / 242KB gzip, one chunk).

### Intentionally postponed (explicit user decision, do not start without being asked again)
- **Segment domain model** — fully specified, frozen, revisit only on the trigger conditions in §2.3.
- **Automatic PR detection on repeated *named* WODs** (not just Skill Work) — deferred until after initial launch/stabilization.
- **JS bundle code-splitting** — valid idea, deferred, not prioritized.

---

## 5. Completed milestones (chronological)

1. **Early build** (through late June 2026): core single-tenant app — auth, profiles, subscriptions, classes/bookings, WOD CRUD, PR tracking, PWA, i18n, Sentry, RLS enabled and audited (multiple real gaps found and fixed — see §8).
2. **Workout Engine V2** (Phases 0–8, closed 2026-07-16): `workouts`/`workout_sections` schema, backfill, AI-schema prep, unified data layer, dual-write, atomic sync RPC, native section editor, Member View read-cutover, Logging read-cutover. Architecture-reviewed before closure; one real bug (WOD-deletion FK ordering) found and fixed during that review.
3. **Multi-tenant conversion** (2026-07-14, same-day): `gyms` table + `gym_id` everywhere, 64 RLS policies rewritten, owner/member signup flows, Platform Admin tab. Four real Postgres RLS gotchas found and fixed live (SECURITY DEFINER recursion, upsert-vs-RLS, UPDATE needing SELECT visibility, WITH CHECK seeing stale subquery values during the same statement) — see §8, reusable lessons for any future RLS work.
4. **Workout Intelligence v1** ("Paste-to-Draft", 2026-07-16/17): AI parser wired to the real editor (previously only `console.log`'d), lightweight review flags, then a 5-item real-world-exploration roadmap (title normalization, ambiguous_format scoping, benchmark-name backfill, Buy-In/Cash-Out merge, Chained AMRAP stages) fully shipped.
5. **Segment domain model** — specified, reviewed, explicitly postponed (2026-07-17).
6. **`sharedRepScheme`** (2026-07-17): unified rep-scheme field across For Time/RFT/Chipper/Ladder, migrating Ladder's old free-text field.
7. **Workout Composer** (2026-07-17): architecture + implementation + React rendering layer + live validation against 17 real WODs + a full audit removing every remaining format-identity-based presentation decision. Declared the new rendering foundation; frozen pending real-usage feedback.

---

## 6. Remaining roadmap (not yet started, roughly in likely-next order — not a commitment)

1. Wire the Composer/`ComposedWorkoutView` into Home/Jurnal/Leaderboard, retiring the older field-summary renderer there — blocked on gathering real Admin-usage feedback first (explicit user instruction).
2. WI-2: a real re-analysis policy for Workout Intelligence (replacing the "always overwrite" placeholder).
3. Migrate Journal/Leaderboard/log-editing to read Workout Engine V2 natively instead of the `wods` join.
4. Lift the legacy-compatibility section-count gate once section `typeKey` persistence is fixed.
5. "Programming Advisor" — the long-term Workout Intelligence vision (reasoning across a gym's structured history, movement rotation, energy-system balance).
6. Self-serve gym signup + real payment/billing integration.
7. JS bundle code-splitting.

---

## 7. Known issues and technical debt

- **`app_settings`, historical RLS gaps**: multiple real RLS holes were found and fixed over time (missing DELETE policy on `personal_records`, missing UPDATE on `wods`, an admin-writable-by-anyone `app_settings` policy, a feed-delete policy missing the `is_admin()` exception). Lesson generalized in memory: a Postgres DELETE/UPDATE that matches 0 rows due to RLS returns `{error: null}`, not an error — always check `data.length > 0` after a delete before reporting success to the user.
- **Section `title` field is dead**: typed into the Admin section editor's "Titlu (opțional)" field but never read/written by any save/load path — silently discarded on next save+reload.
- **`workout_scaling_levels` table**: created, seeded, RLS-protected, zero real consumers — `scalingVersions[].level` stays a free string everywhere.
- **Format→scoreType mapping duplicated** in three places (a one-time SQL backfill CASE, `workoutEngine.js`'s `SCORE_TYPE_BY_FORMAT`, and the AI prompt text) — no single source of truth; drifts silently if a new format is added without updating all three.
- **Migration files don't reliably reflect live DB state** (see §2.4) — always verify schema/RLS live, not from migration files alone.
- **JS bundle**: ~914KB minified / 242KB gzip in a single chunk — code-splitting deferred (see §6).
- **Composer/legacy renderer divergence**: Home/Jurnal/Leaderboard visually diverge from the Admin preview's whiteboard-style output until the rollout in §6 happens.
- **Legacy WODs with prose-embedded structure**: WODs authored before `sharedRepScheme`/Chained AMRAP existed still carry rep schemes and stage structure as narrated text inside movement names (e.g. "Thrusters (21-15-9 rep scheme...)") — the Composer correctly declines to parse this (matches the "never invent structure" principle), so these render as their raw, un-ideal data until manually re-authored through the Admin form. Not a bug; a data-authoring gap.

---

## 8. Notable past bugs (reusable lessons, not open issues — all fixed)

- **WOD-deletion FK ordering** (`4eac2dc`): legacy `wods` row was deleted before its linked `workouts` row, violating a foreign key with no `ON DELETE CASCADE`, silently failing (error never checked) while the UI still reported success. Fixed by reordering the deletes and checking the error.
- **Silent-sync clobbering an AI draft** (`465f6bb`): an effect that keeps the edit form in sync with the selected date's saved WOD was re-triggered by `analyzeWorkout()` resetting `editWodId`, silently overwriting a freshly-generated AI draft on any date that already had a saved WOD. Fixed by not touching `editWodId` in `analyzeWorkout()` at all.
- **Chained AMRAP OpenAI schema rejection**: a nullable array type (`type: ['array', 'null']`) combined with nested `items` is rejected by OpenAI Structured Outputs' strict mode — broke every non-fast-path AI call with a generic 502 for a time. Fixed by always using `type: 'array'` with an empty array for "not applicable," matching the schema's own existing convention.
- **4 real Postgres RLS gotchas** (multi-tenant conversion day): SECURITY DEFINER recursion in an RLS helper function; `INSERT ... ON CONFLICT DO UPDATE` evaluating the INSERT policy even when the real branch taken is UPDATE; UPDATE/DELETE requiring the target row to already be SELECT-visible; and `WITH CHECK` re-evaluating a same-table subquery that still sees the pre-update value mid-statement. All four passed code review but failed live testing — reproduce-then-fix, not review-then-assume, for any future RLS work.
- **Single-movement Composer duplication**: `rowMode:'movement'` sections with exactly one movement (Strength Sets, Build to Heavy/1RM) were rendering the movement name twice (heading + body line) — fixed by omitting the body line when it's identical to the heading text.

---

## 9. Current task in progress

**Goal**: prepare an isolated demo environment of Forge so ChatGPT can perform an external product review (UX, navigation, workflows, IA, visual consistency, onboarding, feature discoverability — not a code review) from the perspective of a gym owner, coach, and athlete.

**Why isolated**: local dev and production share one live database (§2.2) — seeding realistic demo data (fake members, subscriptions, payments) into it would pollute real CrossFit C15 data, and handing an Owner/Admin login connected to that data to an external AI service is a real security/privacy exposure. The user explicitly chose full isolation over reusing the shared database.

**Done so far**:
- New, fully isolated Supabase project created: `forge-demo` (ref `lxdpknfiyqzpqxtsotys`, `eu-central-1`), completely separate from the production project (`sdfkvfbvgpuspnnnwqwk`) used by CrossFit C15.
- Attempted to build its schema from `supabase/migrations/*.sql` directly — **failed**: the migration history assumes a base schema (tables like `bookings`) that predates migration tracking; there is no `CREATE TABLE` for it anywhere in the repo's migration files. Replaying migrations alone does not produce a working database.
- Attempted a schema-only dump from production via `supabase db dump --linked` — failed technically (requires Docker Desktop, not installed on this machine).
- A follow-up attempt to fall back to raw `pg_dump`/`psql` tooling was correctly blocked by an automated safety check, given the public-demo/third-party-review context — the user was asked directly and chose the official path: install Docker Desktop, then use `supabase db dump` (schema-only, zero data rows) properly.
- Separately, an attempt to get real (not recreated) screenshots of the Admin UI via OS-level screen capture surfaced a real, unrelated risk: a separate, already-open Chrome window on this machine is logged into **production** Forge and was showing a real member's subscription/payment details on screen. That capture was deleted immediately; the technique was abandoned as unsafe/unreliable for this task (also confirmed unreliable a second time — window focus didn't stick). This is unrelated to the demo-environment work but worth knowing before any future screen-capture attempt on this machine.

**Blocked on**: the user installing Docker Desktop (https://www.docker.com/products/docker-desktop/) and confirming it's running. See `RESTART_CHECKPOINT.md` for the exact resume sequence.

---

## 10. Immediate next steps (after Docker Desktop is confirmed running)

1. `supabase link --project-ref sdfkvfbvgpuspnnnwqwk` (back to production, read-only schema dump — no data).
2. `supabase db dump --linked --schema public -f <path>/forge_demo_schema.sql` (schema only — verify the output file contains **no `INSERT`/`COPY` data statements** before proceeding).
3. `supabase link --project-ref lxdpknfiyqzpqxtsotys` (the new `forge-demo` project) and apply that schema dump to it.
4. Deploy the 5 Edge Functions to `forge-demo` with their own secrets (reuse the OpenAI key or ask the user for a demo-scoped one — confirm which before spending it on seed-data AI calls).
5. Seed realistic fake data directly into `forge-demo` (members, classes, ≥2 weeks of workouts, attendance, scores, subscriptions, notifications) — safe here, since this project is fully isolated from production.
6. Create demo Auth accounts (Owner/Admin, Coach, Athlete) scoped to the seeded gym.
7. Create a new Vercel project pointing at `forge-demo`'s env vars, deploy, get the public preview URL.
8. Hand back: URL + credentials per role + a short list of anything intentionally incomplete (per the user's original checklist) — no ChatGPT access is granted by me directly; the user shares the URL/credentials themselves.
