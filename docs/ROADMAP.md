# ROADMAP.md — Forge

> Product roadmap and upcoming milestones. Not a commitment or sequencing guarantee — reflects what's known to be next vs. deferred as of the last update. See `/docs/DECISIONS.md` for why postponed items were postponed.
>
> Last updated: 2026-07-27.

---

## Up next (roughly likely order, not committed)

1. **Wire the Composer into Home/Jurnal/Leaderboard**, retiring the older `describeFormatConfig()` field-summary renderer there. Explicitly blocked on gathering real Admin-usage feedback first (standing rule — see `/docs/DECISIONS.md`), not on any remaining implementation work.
2. **WI-2**: a real re-analysis policy for Workout Intelligence, replacing the current "always overwrite" placeholder for what happens when a coach re-clicks "Analizează" over an already-edited draft.
3. **Migrate Journal/Leaderboard/log-editing** to read Workout Engine V2 natively instead of the legacy `wods` join.
4. **Lift the `validateSectionsForLegacy` gate** (today caps a WOD at 1 primary + 3 non-primary sections) — blocked on fixing the section-`typeKey` persistence debt first (see `/docs/ARCHITECTURE.md` known gotchas / the Workout Engine V2 phase history).
5. **"Programming Advisor"** — the long-term Workout Intelligence vision: reasoning across a gym's structured training history (movement rotation, energy-system balance, benchmark cadence), not just parsing a pasted workout. The real differentiator vs. competitors (SugarWOD/PushPress/Wodify/BTWB) per the original product spec.
6. **Self-serve gym signup** — gym activation is still 100% manual via the Platform Admin tab. (Member-initiated **subscription renewal payment** is done — Stripe Checkout, closed M6, 2026-07-21 — this item is narrower than it used to read.)
7. **JS bundle code-splitting** — currently ~914KB minified / 242KB gzip in one chunk.

## Recently closed (see `/docs/CHANGELOG.md` for full detail)

- **Gym Transfer (M7)** — identity-based continuity when a member moves to a different gym: an admin ends a Membership as a Transfer (distinct from Removal), the member later joins any gym through the existing, unmodified self-service join, and Forge recognizes the continuity from Membership history alone. A Transfer Code (new entity, fallback-only, single-use, 72-hour) covers the case where the member cannot complete that join themselves. Full architecture cycle (Product Specification, Technical Architecture, Implementation/Execution Plans, Freeze Notice) preceded 11 independently-committed implementation steps. Closed 2026-07-27. `docs/architecture/M7_FREEZE_NOTICE.md`.
- **M8: Membership Catalog / First Purchase (Admin → Plans)** — member-facing browsing/selection of a gym's subscription plans, and a self-service first-time purchase path, unified with the existing Renew flow into one purchase entry point rather than kept separate. Scoped 2026-07-21 as new, deferred work (a brand-new member with zero subscription history had no way to buy a plan — "Renew Now" only renewed an existing one). Implemented and closed 2026-07-22 through 2026-07-24, including follow-on hardening (admin deletion of never-used plans, subscription-plan field validation, realtime publication for the catalog tables, subscription/plan action-terminology alignment). This closure went unrecorded in this document until now — see `/docs/PROJECT_STATE.md`.
- **Member Domain Migration (M1.1-M1.5.5)** — `members`/`memberships` introduced as a genuine Member Domain, migrated to incrementally (read paths, then write paths) rather than a hard cutover, then the now-dead `profiles`→`members` bridge fully retired. `members` is the sole Source of Truth for Member identity; `profiles.gym_id`/waiver fields remain, Membership-owned, unchanged. Closed 2026-07-27. `docs/architecture/MEMBER_DOMAIN_ARCHITECTURE.md`.
- **Online Payments (Stripe), M6** — member-initiated "Renew Now" → Checkout → webhook → automatic Subscription activation. Closed 2026-07-21 against the company's real production Stripe account, validated with one real end-to-end payment. `docs/2026-07-21_Financial_Domain_Production_Readiness_Report.md`.
- **P0-006 (Remove Member / Identity vs. Membership)** — closed 2026-07-21.

---

## Intentionally postponed (do not start without being explicitly asked again)

- **Segment domain model** — fully specified (`SEGMENT_MODEL_SPEC_v1.md`), frozen. Revisit triggers are listed in `/docs/DECISIONS.md`.
- **Automatic PR detection on repeated *named* WODs** (not just Skill Work) — deferred until after initial launch/stabilization. A rough implementation plan (~45-60 min, scoped to named Hero/custom WODs only) was already discussed and can be picked back up without re-deriving it.
- **JS bundle code-splitting** — valid idea, not prioritized.

---

## Explicitly out of scope (not on this roadmap at all, unless revisited)

- Native app store presence (React Native or similar) — long-term idea, no timeline.
- Google OAuth login.
- Member-facing automated scaling/coaching by AI — a distinct, much-later, separately-approved capability per Workout Intelligence's own design principles (crosses from "assisting a coach" into "coaching a member").

---

## In progress right now

Building an isolated demo environment (separate Supabase project + separate Vercel deployment, seeded with realistic fake data) for an external ChatGPT product review. See `/docs/PROJECT_STATE.md` for exact status and next steps, and `RESTART_CHECKPOINT.md` (repo root) for the immediate resume sequence — this task is currently paused on Docker Desktop installation.
