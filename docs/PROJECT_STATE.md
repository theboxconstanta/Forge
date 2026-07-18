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

**Goal**: prepare an isolated demo environment of Forge (separate Supabase project + separate Vercel deployment, seeded with realistic fake data) so the user can hand it to ChatGPT for an external product/UX review.

**Status**: paused, blocked on Docker Desktop installation (needed for a schema-only `supabase db dump` from production). A new, fully isolated Supabase project (`forge-demo`) already exists. See `RESTART_CHECKPOINT.md` (repo root) for the exact resume sequence and pending steps — that file is a one-off resume checkpoint, not part of this standing `/docs` set, and can be deleted once the task completes.

---

## 5. How to keep this documentation useful

Update the relevant file(s) in `/docs` — not necessarily all five — whenever a significant milestone closes or an important architecture/product decision is made:
- **This file** (`PROJECT_STATE.md`) — current snapshot, subsystem status table, what's actively in progress.
- **`ARCHITECTURE.md`** — system structure, component responsibilities, gotchas. Update when a subsystem's design or status (FROZEN/ACTIVE/PLANNED) changes.
- **`ROADMAP.md`** — what's next/deferred/out of scope. Update when priorities shift or something is explicitly postponed.
- **`CHANGELOG.md`** — append a dated entry when a milestone closes. Never edit past entries except to fix factual errors.
- **`DECISIONS.md`** — append when a decision is made that future work should not silently relitigate, especially anything that looks "obviously improvable" but was deliberately chosen otherwise.

Do not update these after routine commits or small bug fixes — only at the granularity of "another engineer would want to know this happened."
