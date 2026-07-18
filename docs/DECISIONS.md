# DECISIONS.md — Forge

> Important product and architecture decisions, with the reasoning behind them. Read this before proposing to change something that looks frozen or "obviously" improvable — the reasoning here is usually the answer to "why didn't they just...".
>
> Last updated: 2026-07-18.

---

## Multi-tenancy: one gym per account, manual activation (2026-07-14)

**Decision**: one gym per account (not multi-gym-per-login), modeled after BeyondTheWhiteboard. Owner signup requires a registration code the platform admin issues manually after an offline payment conversation. Gym activation/deactivation (the entire payment-enforcement mechanism) is a manual toggle in a Platform Admin tab — no billing integration.

**Why**: converting to multi-tenant was already a large architectural change (19 tables, 64 RLS policies); adding real payments/Stripe at the same time would have stacked two major risks at once. Payments were explicitly scoped out until a self-serve signup flow is separately justified.

**Revisit when**: the manual activation workflow becomes a real bottleneck (more than a handful of gyms), or self-serve signup becomes a business priority.

---

## Workout Engine V2: dual-write, not a hard cutover (2026-07-16)

**Decision**: `workout_sections`/`workouts` (V2) are kept in sync with the legacy `wods` table via dual-write, rather than cutting reads over everywhere at once. Journal, Leaderboard, and log-editing still read through `wods`; only Member View and Logging were migrated to read V2 natively.

**Why**: each read-path migration was its own phase with its own live-validation pass; cutting everything over simultaneously would have made it much harder to isolate what broke if something did. The remaining `wods`-reading surfaces are a known, explicit scope boundary, not an oversight.

**Revisit when**: a new phase is explicitly requested to migrate Journal/Leaderboard/log-editing to V2 natively (see `/docs/ROADMAP.md`).

---

## Workout Composer: never infer structure from unstructured text (2026-07-17, reaffirmed 2026-07-18)

**Decision**: the Composer only reads structured fields (`family`, `scoreMode`, `rowMode`, config field presence/type). It never parses prose to reconstruct missing structure (e.g. it will not try to extract "21-15-9" out of a movement's free-text notes if `sharedRepScheme` wasn't populated).

**Why**: this is the same "never invent" discipline established during Workout Intelligence — a heuristic that guesses right most of the time but occasionally guesses wrong on real user data is worse than an honest gap that's visibly a data-authoring problem. Verified directly: a legacy WOD authored before `sharedRepScheme` existed renders its raw, un-ideal text until someone re-enters it through the Admin form — confirmed as the *correct*, intended behavior, not a bug, via a live before/after test (re-entering the same WOD's fields produced the exact desired output with zero code changes).

**Standing rule (2026-07-17)**: going forward, only *recurring, evidence-based* feedback from real Admin usage justifies changing the Composer. A single one-off observation ("this looks slightly off") gets logged as product feedback, not acted on immediately. The architecture is considered validated; iteration from here is product polish, not architecture work.

---

## Workout Composer: presentation logic must be semantic-driven, never format-identity-driven (2026-07-18)

**Decision**: after closing the Composer as an architecture initiative, an explicit audit found 3 remaining places where output phrasing was decided by checking a literal format name (`formatId === 'RFT'`, etc.) rather than a semantic field. All 3 were removed — each turned out expressible using fields the catalog already had, with **zero new catalog metadata**.

**Why this matters going forward**: it proves the "add a new format, touch only the Workout Engine catalog, never the Composer or React" claim is actually true today, not aspirational. Before adding a new format-name check to `workoutComposer.js` in the future, actively look for an existing semantic field/tag that already expresses the distinction — the pattern established here (check `rounds`/`baseFormat`/`totalRounds`/`hasEscalatingScheme()` field presence, not names) is the bar to clear.

---

## Segment domain model: specified, then postponed (2026-07-17)

**Decision**: a fuller compositional replacement for the enumerative Workout Format Catalog (`Workout → WorkoutSection → Segment tree → Movements`) was fully designed (`SEGMENT_MODEL_SPEC_v1.md`) after two real Workout Intelligence parser gaps (Chained AMRAP, Buy-In/Cash-Out) suggested the enum model might be hitting its limits. After an explicit cost/benefit review, the decision was to **postpone**, not build.

**Why**: neither motivating bug was actually a Workout Engine V2/format-catalog limitation — both had cheap point-fixes inside the current architecture (now shipped). No concrete planned feature was found to be blocked without it. The estimated migration cost (schema + AI schema + editor + renderer + logger rewrite, plus a genuinely unresolved logging-model question) was comparable to or larger than the entire 8-phase Workout Engine V2 migration that had just closed.

**Revisit when** (any one of):
- 3+ genuinely new formats are needed in a short window (not one-off).
- A concrete feature is actually blocked by the enum model (not just inconvenienced).
- `FORMAT_CONFIG_TRANSLATORS`/`FormatConfigEditor.jsx` visibly becomes a maintenance bottleneck.
- Workout Engine V2 has run stable in production for a meaningful stretch, freeing up appetite for another foundational change.

`SEGMENT_MODEL_SPEC_v1.md` stays in the repo root as a frozen, dated reference — do not treat its absence from `/docs` as it being abandoned.

---

## Workout Intelligence: AI assists, never replaces or auto-publishes (2026-07-16)

**Decision** (principle #0, the north star every other Workout Intelligence decision serves): **"Workout Intelligence exists to make coaches better, not to replace them."** Concretely: AI never auto-publishes a workout; AI never silently overwrites a human edit once made; uncertainty is always shown, never hidden behind a confident-looking guess; the manual editor path never becomes second-class; no permanent "AI-assisted" mark survives on a published workout; member-facing automated scaling/coaching is a distinct, separately-approved future capability, not an assumed roadmap item.

**Why**: this is a trust-and-liability-sensitive feature (a wrong AI guess on a workout's structure reaches real athletes' training) — the product bet is that coach confidence in the tool depends on it never taking silent, unreviewable action.

**Also decided**: re-analysis policy (what happens when a coach re-clicks "Analizează" over an already-edited draft) is currently a **placeholder** ("always overwrite"), explicitly not a decided policy — see `/docs/ROADMAP.md` (WI-2).

---

## Demo environment for external review: full isolation over shared-DB reuse (2026-07-18)

**Decision**: when asked to prepare a public demo environment for an external AI product review (ChatGPT), the demo was built on a **new, fully isolated Supabase project** rather than reusing the existing (shared local/prod) database with seeded fake data.

**Why**: local dev and production already share one live database — seeding realistic fake members/subscriptions/payments into it would have polluted real CrossFit C15 data visible to real staff/members, and handing an Owner/Admin login connected to that data to an external third-party service is a real security/privacy exposure. Explicitly the user's own call after being presented the trade-off, not assumed unilaterally.

**Also decided during the same task**: a raw `pg_dump`/`psql` workaround (to get a schema-only copy without installing Docker Desktop) was declined even though it was technically feasible, because an automated safety check flagged the specific combination (touching the production connection right after, in service of a public-facing demo) as risky — the official, Docker-Desktop-dependent path was chosen instead. General principle worth keeping: when a safety check flags a workaround as risky in a context involving real user data and external/public exposure, stop and ask rather than find a different technical path around it.
