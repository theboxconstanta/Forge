# PROJECT_STATE.md — Forge (CrossFit gym management SaaS)

> Current state snapshot. For deep architecture detail see `ARCHITECTURE.md`; for what's next see `ROADMAP.md`; for why things are the way they are see `DECISIONS.md`; for the history of how we got here see `CHANGELOG.md`.
>
> Updated only at meaningful milestones — not every commit. Last updated: 2026-07-18.

---

## 1. Vision

**Forge** is a gym-management SaaS for CrossFit/functional-fitness boxes: athletes see the daily workout, log results and PRs, book classes, and track their subscription; coaches/owners run the whole gym from an Admin panel.

- Originated as a single-gym app for CrossFit C15 (Constanța, Romania); converted to genuine multi-tenant SaaS 2026-07-14 — any number of gyms can now run on one deployment, fully data-isolated.
- Business model: monthly subscriptions, currently renewed manually per-gym; platform-level gym activation is also manual (no payment integration yet).
- Long-term ambition: sell to other boxes as a subscription SaaS product.
- Mobile-first installable PWA, no native app store presence yet.

---

## 2. Subsystem status at a glance

*(full detail in `ARCHITECTURE.md`; reasoning behind each frozen status in `DECISIONS.md`)*

| Subsystem | Status |
|---|---|
| Workout Engine V2 (core domain model) | **FROZEN** — closed 2026-07-16, primary architecture |
| Workout Composer + rendering pipeline | **FROZEN** — closed 2026-07-17/18, live only in Admin preview |
| Workout Format Catalog | **FROZEN** — stable substrate under the above two |
| Workout Intelligence (AI parser) | **ACTIVE** — v1 shipped, WI-2 (re-analysis policy) not started |
| Segment domain model | **SPECIFIED, POSTPONED** — see `DECISIONS.md` for revisit triggers |
| Multi-tenancy | **FROZEN** — closed 2026-07-14 |
| Authentication | **STABLE** |

**Critical operational fact**: local dev and production share the same live Supabase database — no separate staging environment for normal work. See `ARCHITECTURE.md` §2.

---

## 3. Implementation status

### Fully completed
Auth, multi-tenant gym isolation, subscriptions/plans/classes/bookings/waitlist, RLS everywhere, Workout Engine V2 (all 8 phases), Workout Composer + rendering pipeline (validated against real data, formatId-free), Workout Format Catalog (23 formats), Workout Intelligence v1 + its 5-item hardening roadmap, PWA packaging, RO/EN i18n, Sentry.

### Partially completed
- **Composer rollout**: correct and proven, but wired only into the Admin editor preview — Home/Jurnal/Leaderboard still use the older field-summary renderer (see `ROADMAP.md` item 1).
- **Workout Intelligence**: v1 (parsing quality) done; re-analysis safety policy (WI-2) still a placeholder; the long-term "Programming Advisor" not started.
- **`App.jsx` decomposition**: substantial modules extracted (formats/engine/sections/intelligence/composer), but `App.jsx` remains the largest file and still owns most Supabase I/O.

### Planned, not started / intentionally postponed
See `ROADMAP.md` for the full list and ordering.

---

## 4. Current task in progress

None — the isolated demo environment (previous entry here) shipped 2026-07-18. See §6 and `CHANGELOG.md`.

---

## 5. How to keep this documentation useful

Update the relevant file(s) in `/docs` — not necessarily all five — whenever a significant milestone closes or an important architecture/product decision is made:
- **This file** (`PROJECT_STATE.md`) — current snapshot, subsystem status table, what's actively in progress.
- **`ARCHITECTURE.md`** — system structure, component responsibilities, gotchas. Update when a subsystem's design or status (FROZEN/ACTIVE/PLANNED) changes.
- **`ROADMAP.md`** — what's next/deferred/out of scope. Update when priorities shift or something is explicitly postponed.
- **`CHANGELOG.md`** — append a dated entry when a milestone closes. Never edit past entries except to fix factual errors.
- **`DECISIONS.md`** — append when a decision is made that future work should not silently relitigate, especially anything that looks "obviously improvable" but was deliberately chosen otherwise.

Do not update these after routine commits or small bug fixes — only at the granularity of "another engineer would want to know this happened."

---

## 6. Demo environment (forge-demo)

A fully isolated demo instance exists for external product/UX review (e.g. handing to ChatGPT), shipped 2026-07-18:

- **Supabase project**: `forge-demo` (ref `lxdpknfiyqzpqxtsotys`) — separate project from production (`sdfkvfbvgpuspnnnwqwk`), same schema (structure-only dump, zero prod data ever copied over).
- **Vercel project**: `forge-demo` (team `forgewod`), deployed from a one-off scratch copy of the repo (not git-connected) — live at `https://forge-demo-five.vercel.app`.
- **Seed data**: `scripts/seed-forge-demo.mjs` (+ `scripts/seed-forge-demo-repair.mjs`, a one-time backfill for a missing `on_auth_user_created` trigger that a schema-only dump doesn't carry over from the `auth` schema — re-run that trigger-creation step first if the demo project is ever rebuilt from scratch). One gym ("Forge Demo Box"), 10 demo accounts (owner/coach/8 athletes, all `@forgedemo.test`), 21 days of WODs/classes/bookings, PRs, logs, feed activity.
- **Edge Functions**: all 5 deployed to forge-demo with no OpenAI/Brevo/VAPID secrets set (by design) — `analyze-workout`/notification functions exist but no-op safely rather than call real external services.
- Demo credentials are not stored in this repo or in `/docs` — ask the user if they need to be resurfaced.
