# CHANGELOG.md — Forge

> Major completed changes, most recent first. This is a milestone log, not a commit log — see `git log` for line-by-line history. Only significant, meaningful-milestone entries belong here.

---

## 2026-07-18 — Isolated demo environment shipped
Built a fully separate Supabase project (`forge-demo`) + Vercel deployment for external product/UX review, seeded with realistic fictional gym data. Schema-only `supabase db dump` from production applied to the new project; discovered and fixed a real gap in that process — `on_auth_user_created` lives in the `auth` schema and isn't captured by a `--schema public` dump, so it had to be recreated by hand (see `PROJECT_STATE.md` §6). Production was never written to (link + dump only, read-only). See `scripts/seed-forge-demo*.mjs` for the reusable seed script.

## 2026-07-18 — Documentation workflow adopted
Set up `/docs` (`PROJECT_STATE.md`, `ARCHITECTURE.md`, `ROADMAP.md`, `CHANGELOG.md`, `DECISIONS.md`) as the standing, lightweight documentation practice — updated only at meaningful milestones/decisions going forward, not every commit.

## 2026-07-17/18 — Workout Composer: formatId elimination audit
Full audit of the Composer + rendering pipeline confirmed zero remaining presentation decisions based on literal workout-format identity — the 3 that existed (RFT/For Time/Partner WOD "repeated rounds"; EMOM/Tabata/Intervals/Death By archetype word; Death By's score note) were all replaced with checks on fields the catalog already had, with zero new catalog metadata. Validated live (before/after byte-identical output on real production WODs) and via 6 new regression tests (349 total).

## 2026-07-17/18 — Workout Composer shipped
`workoutComposer.js` (pure `WorkoutSection → ComposedWorkout` transform) + `ComposedWorkoutView.jsx` (React rendering, role/weight-driven) implemented, tested, and wired into a live preview in the Admin WOD editor. Validated end-to-end against 17 real production WODs; one real rendering bug found and fixed (single-movement sections duplicating the movement name as heading and body line). A live before/after test proved the "structured data in → correct whiteboard layout out, zero code changes" hypothesis on a real legacy WOD.

## 2026-07-17 — `sharedRepScheme` unified
Migrated Ladder's free-text `repsScheme` and introduced the same structured field (`repsSchemeList` type) on For Time/RFT/Chipper — one consistent way to express "the shared rep count per round" (e.g. "21-15-9") across formats.

## 2026-07-17 — Segment domain model specified, then postponed
Full domain-model spec written (`SEGMENT_MODEL_SPEC_v1.md`) as a potential compositional replacement for the enumerative format catalog, then explicitly postponed after a cost/benefit review. See `/docs/DECISIONS.md`.

## 2026-07-16/17 — Workout Intelligence v1 shipped
AI-assisted "Paste-to-Draft": pasted free text → AI parse → native editor draft → lightweight review flags → coach edits → save. Wired the previously-built-but-unused `analyze-workout` Edge Function to the real editor. A follow-up 5-item real-world-exploration roadmap (title normalization, ambiguous_format scoping, benchmark-name backfill, Buy-In/Cash-Out merge, Chained AMRAP stage support) fully shipped.

## 2026-07-16 — Workout Engine V2 closed, declared primary architecture
All 8 migration phases complete (schema → backfill → AI-schema prep → unified data layer → dual-write → atomic sync RPC → native section editor → Member View + Logging read-cutover). Architecture-reviewed before closure; one real bug (WOD-deletion FK ordering) found and fixed during that review. AI-assisted workout creation explicitly split out as its own initiative (Workout Intelligence), not part of this migration.

## 2026-07-14 — Multi-tenant conversion
Converted from single-tenant (hardcoded "CrossFit C15") to genuine multi-tenant SaaS in one day: `gyms` table + `gym_id` on all 19 tables, 64 RLS policies rewritten, owner/member signup flows with registration/access codes, Platform Admin tab for manual gym activation. Four real Postgres RLS behaviors found and fixed live during the conversion (see `/docs/ARCHITECTURE.md` known gotchas).

## 2026-07-01 through 2026-07-16 — Progressive extraction and hardening
RLS enabled and audited across all core tables (multiple real gaps found and fixed: missing DELETE/UPDATE policies, an admin-writable-by-anyone settings table, a feed-delete policy missing its admin exception). Domain logic progressively extracted from `App.jsx` into pure, unit-tested modules (`workoutFormats.js`, `workoutEngine.js`, `wodSections.js`). i18n (RO/EN) completed across the entire app. Sentry error tracking added.

## Earlier (through late June 2026) — Initial build
Core single-tenant app: auth, profiles, subscriptions/plans, classes/bookings, WOD CRUD (fixed-column `wods` table), PR tracking, PWA packaging, initial i18n pass.
