# RESTART_CHECKPOINT.md

> Written 2026-07-18, immediately before pausing work to install Docker Desktop. Read this first after restart — it's the single source of truth for "what was I doing and what's next." Full project context lives in `PROJECT_STATE.md`; this file is just the resume point.

---

## Current objective

Build a fully isolated demo environment of Forge (separate Supabase project + separate Vercel deployment, seeded with realistic fake data) so the user can hand it to ChatGPT for an external product/UX review. See `PROJECT_STATE.md` §9–10 for full background and reasoning.

---

## Why paused

Building the demo project's database schema requires a **schema-only** dump from the real production database (structure only, zero data rows) so the new isolated project has the same tables/columns/functions. The Supabase CLI's sanctioned tool for this (`supabase db dump`) requires **Docker Desktop**, which is not installed on this machine. A raw-`pg_dump` workaround was correctly blocked by a safety check given the public-demo/third-party-review context, and the user chose the official path instead: install Docker Desktop, then use `supabase db dump` properly.

---

## Next action after restart

1. Confirm Docker Desktop is installed and **running** (whale icon in the system tray, no "starting..." spinner). If you (the user) haven't done this yet, do it first: https://www.docker.com/products/docker-desktop/
2. Tell Claude "Docker is running, continue" (or equivalent) — that resumes exactly at step 3 below.
3. Claude will run, in order:
   ```bash
   cd "C:\Users\Luci\Desktop\WOD-SIMPLE"
   supabase link --project-ref sdfkvfbvgpuspnnnwqwk   # production, read-only schema access
   supabase db dump --linked --schema public -f ../forge_demo_schema.sql
   ```
   Then verify the dump file contains **only** `CREATE TABLE`/`CREATE POLICY`/`CREATE FUNCTION` statements — **no `INSERT`/`COPY` data** — before proceeding. This is a hard checkpoint: do not apply the dump to the new project without this check.
4. Apply that schema to the new demo project:
   ```bash
   supabase link --project-ref lxdpknfiyqzpqxtsotys   # forge-demo (already created, isolated)
   supabase db push --linked --db-url "<forge-demo connection string, via db-url or re-link>" -f ../forge_demo_schema.sql
   ```
   (Exact push mechanism to confirm at the time — may need `psql -f` directly against `forge-demo`'s own connection string instead, since `db push` expects a migrations-directory shape, not an arbitrary dump file. This detail was not resolved before pausing.)
5. Deploy the 5 Edge Functions (`analyze-workout`, `check-subscriptions`, `send-class-reminders`, `send-notification`, `admin-delete-client`) to `forge-demo` with their own secrets. **Ask the user** whether to reuse the production OpenAI key or use a separate demo-scoped one before spending it on seed-data AI calls.
6. Seed realistic fake data directly into `forge-demo` (safe — fully isolated project): members, classes, ≥2 weeks of workouts, attendance, scores, subscriptions, notifications.
7. Create demo Auth accounts: Owner/Admin, Coach, Athlete — scoped to the seeded gym in `forge-demo`.
8. New Vercel project pointing at `forge-demo`'s env vars (`VITE_SUPABASE_URL`, `VITE_SUPABASE_KEY` for the new project — **not** the production ones), deploy, get the public preview URL.
9. Report back: URL, one credential set per role, and a short list of anything intentionally incomplete. The user shares the URL/credentials with ChatGPT themselves — do not do that step.

---

## Important commands reference

```bash
# Supabase CLI — check current link / org / projects
supabase projects list
supabase orgs list
supabase link --project-ref <ref>

# The two projects involved
# Production (CrossFit C15, real data): sdfkvfbvgpuspnnnwqwk
# Demo (isolated, empty schema so far): lxdpknfiyqzpqxtsotys

# Standard app commands (unrelated to the demo work, for reference)
npm run dev          # local dev server, localhost:5173
npx vitest run        # full test suite (349 tests as of 2026-07-18)
npm run build          # production build
supabase functions deploy <name>   # deploy one edge function
```

---

## Environment requirements

- **Docker Desktop** — required for `supabase db dump`. Not installed as of this checkpoint. Must be running (not just installed) before resuming step 3 above.
- **Supabase CLI** — already installed and authenticated (`v2.107.0`), confirmed working (created the `forge-demo` project successfully).
- **Vercel** — CLI not installed on this machine; the Vercel MCP plugin tools (`deploy_to_vercel`, `list_projects`, etc.) are available instead and were used for prior deploy-status checks this session — use those rather than assuming a `vercel` CLI binary exists.
- No other new tooling needed.

---

## Pending setup steps (not yet done, blocking full completion)

- [ ] Docker Desktop installed + running (user action, blocking)
- [ ] Schema-only dump from production, verified data-free
- [ ] Schema applied to `forge-demo`
- [ ] Edge Functions deployed to `forge-demo` (needs a decision on which OpenAI key to use)
- [ ] Demo data seeded (members, classes, ≥2 weeks of workouts, attendance, scores, subscriptions, notifications)
- [ ] Demo Auth accounts created (Owner/Admin, Coach, Athlete)
- [ ] New Vercel project created and deployed, pointing at `forge-demo`
- [ ] Final credentials + URL + incomplete-features list handed to the user

---

## One unrelated thing worth knowing before any future screen-capture attempt

While investigating a way to get real (non-recreated) screenshots for an earlier UX documentation task, an OS-level screen capture picked up a **separate, already-open Chrome window on this machine that is logged into production Forge**, showing a real member's subscription/payment details. That captured image was deleted immediately and nothing was shared externally, but it means: **do not use OS-level screenshot capture on this machine** without first confirming exactly which window/tab is in focus — the automated browser tab used for testing is not reliably the one that ends up on screen.
