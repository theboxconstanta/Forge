# Coach Quick Create — Phase 1 (Automatic Variant Generation) — Implementation Report

## Summary

Phase 1 of Forge's flagship workout-authoring mission is complete and live in both `forge-admin-web` and WOD-SIMPLE (the shared backend + the PWA). A coach pastes or writes an RX workout, edits it, clicks **Generate Variants** and gets Intermediate/Beginner/OnRamp instantly (no network call — pure, synchronous, deterministic), can hand-edit any tab, and can optionally click **Regenerate with AI** on any non-RX tab for a single-LLM-call second opinion on that tier only. Members get a new **Usual Level** preference that soft-defaults their WOD-SIMPLE Home screen to their usual variant, without restricting them from switching before logging.

This report covers the full arc: the original brief, why it was deliberately narrowed before implementation, what was built, and what was verified live in production.

## Context: brief vs. built

The originally requested mission was large — AI-generated variants, gym-wide movement catalog with FK-based `wods` columns, member-locked variant routing, leaderboard auto-routing by level, all inside a 30-second create-to-publish budget. Ground-truth research (three parallel Explore passes) found several of the brief's "existing reality" assumptions false: no movement/format catalog existed anywhere, no member-level scaling field existed, variant selection was 100% manual and per-log (by design — it powers the already-shipped Mixed Categories leaderboard), and the AI parser was explicitly prompted to *never* invent variants.

Three decisions, made explicitly by the user after reviewing this research, scoped Phase 1:

1. **Catalog: additive only.** A new `movements` table for autocomplete/AI-grounding/new-movement-creation. `wods.movements_*` stay `text[]` — no Programming Domain data-model rewrite.
2. **Member routing: soft default, never a restriction.** `usual_level` pre-selects the Home-screen variant; the member can always switch before logging; the actual variant logged is recorded exactly as today (Mixed Categories unaffected).
3. **Scaling: deterministic default + optional AI regenerate.** The 30-second rule ruled out three LLM calls on the default path. A movement-substitution-table + load/volume/time-cap engine produces all three variants instantly; "Regenerate with AI" is an additive, single-tier, single-call enhancement.

Leaderboard auto-routing by level, gym-local→global movement promotion, and cross-gym movement deduplication are explicitly out of scope for this phase.

## What was built

### Database (WOD-SIMPLE `supabase/migrations/`, the shared backend)
- `movements` — multi-tenant content table (`gym_id` nullable, reserved for future platform-global rows), partial unique indexes for platform-vs-gym name uniqueness, `default_substitutions jsonb` override column, RLS mirroring the established `workout_section_types` pattern.
- `profiles.usual_level` — `text` with a `CHECK` constraint against the four tiers. Deliberately on `profiles` (gym-scoped), not `members` (deliberately gym-independent identity).
- `set_member_usual_level(p_member_id, p_usual_level)` — a narrow `SECURITY DEFINER` RPC (not a blanket admin-write policy) letting a coach/admin set another member's preference, since `profiles`' only UPDATE policy is own-row-only.

### Deterministic scaling engine
`scalingEngine.ts` (forge-admin-web) and its faithful port `scalingEngine.js` (WOD-SIMPLE) — pure, synchronous, no I/O. A `TIER_RULES` table (volume reduction / time-cap increase / default load ratio per tier) plus a curated `SCALING_SUBSTITUTIONS` table (movement-specific bodyweight/fixed-load/ratio strategies) drive `generateVariantsFromRx()`. Movements without a table entry gracefully fall through to ratio-based load scaling — disclosed in code, not silently indistinguishable from a real substitution. 37 tests total (20 + 17) cover rep-scheme scaling, substitution hit/miss, fixed/bodyweight strategies, override precedence, plural matching, and the worked example below.

**Worked example** (`21-15-9 Deadlifts @ 102/70kg`, For Time, 10:00 cap) — confirmed both in unit tests and live in production:

| Tier | Deadlift | Cap |
|---|---|---|
| Intermediate | `19-14-8 Deadlifts @ 82/56kg` | 11:30 |
| Beginner | `17-12-7 Deadlifts @ 61/42kg` | 13:00 |
| OnRamp | `14-10-6 Kettlebell Deadlifts @ 16/12kg` | 15:00 |

### "Regenerate with AI" — new edge function
`supabase/functions/regenerate-variant/` — one LLM call, one tier, narrower contract than `analyze-workout` (movements/weight/note only, no `formatConfig` — see the shared constraint below). Auth mirrors `analyze-workout` exactly. The shared OpenAI call/retry/timeout logic was extracted into `supabase/functions/_shared/openai.ts` so both functions use one implementation, not two hand-copies.

### forge-admin-web
- `VariantTabs.tsx` replaces the old flat 4-variant vertical stack in `PrimarySectionEditor` with an RX → Intermediate → Beginner → On-Ramp tab bar. "Generate Variants" (RX tab, gated on RX having content) and "Regenerate with AI" (per non-RX tab) sit above the reused, unmodified `ScalingVariantEditor`.
- `movements/` feature (`api.ts`, `types.ts`) — `fetchMovementsForGym`, `createMovement` (plain insert, catches Postgres `23505` as a friendly duplicate error).
- `MovementCatalogProvider` (React Context) threads the gym's movement catalog down to `FormatConfigEditor` without prop-drilling through 5 component levels; a "+ Create '<name>' as a new movement" affordance appears inline when a typed movement has no match.
- `usual_level` is now editable on `MemberDetails.tsx` (coach/admin only) via the new RPC.
- 834/834 tests passing, `tsc -b` clean, `eslint .` clean, production build succeeded (749.55 kB main bundle — pre-existing warning, not a regression).

### WOD-SIMPLE
- `PrimarySectionBody` converted from the same flat `VARIANT_LEVELS.map` stack to an RX-first tab bar, mirroring `VariantTabs.tsx`'s design exactly (Generate Variants / Regenerate with AI in the same positions, same gating). The per-variant editor body (movements/weight/quick-add/paste/notes) was factored into `VariantEditorBody` with zero behavior change.
- `regenerateVariantApi()` — thin `fetch` wrapper mirroring `analyzeWorkout`'s existing auth pattern (no `supabase.functions.invoke()` precedent in this file, so none was introduced).
- `fetchUserProfile` now reads `usual_level` from `profiles` (alongside `gym_id`/waiver fields) and merges it into `userProfile`, consistent with the identity-vs-relationship split already in place for `members`/`profiles`.
- A new effect defaults `variantaAleasa` (the Home screen's selected variant) from `userProfile.usual_level` the first time a WOD loads in a session, but only while the member hasn't picked anything manually yet (`variantaAleasa === null`) — the existing manual-switch and per-log reset behavior is completely untouched.
- Self-service **Usual Level** selector added to the Profile screen (`changeUsualLevel`, writing to `profiles` — not `members`, per the placement rule above).
- 523/523 vitest tests passing (17 of them `scalingEngine.test.js`; the only failing test *files* are 9 pre-existing Deno edge-function tests unrelated to this work, misdetected by the vitest config), `eslint .` clean of new errors, production build succeeded.

## A constraint that shaped the design

`wods.format_config` is a single value shared by all 4 scaling variants — not one per tier. The scaling engine's per-tier time-cap adjustment (`adjustFormatConfigForTier`) is still computed and unit-tested because it's independently correct and may back a future "suggested time cap" UI hint, but it is **not** applied to the section today, since there's no per-tier slot to write it into. This is disclosed in code comments at every call site (`VariantTabs.tsx`, `PrimarySectionBody`, `regenerateVariant.ts`/`regenerateVariantApi`) rather than silently dropped.

## Live verification

- **forge-admin-web** (`forge-admin-web.vercel.app/programming`): created a workout, typed the exact worked-example RX line, clicked Generate Variants — Intermediate/Beginner/OnRamp tabs matched the worked example exactly. Clicked Regenerate with AI on On-Ramp — got a distinct AI-authored line + coaching note; confirmed the Beginner tab was untouched (single-tier, single-call, as designed). Set a live member's Usual Level to "Rx" via the new RPC, reloaded the page cold, confirmed it persisted (proves the DB round-trip, not just optimistic UI), then reverted to "Not set."
- **WOD-SIMPLE** (`forge-delta-ivory.vercel.app`): production build deployed, `app_version` bumped (confirmed via a fresh `information_schema` query) so already-open PWA sessions pick up the update instead of waiting up to 30 minutes. The live site loads cleanly post-deploy with no white screen and the day's WOD renders normally. Full logged-in click-through of the Admin WOD editor's new tab bar was not performed live in this session (WOD-SIMPLE's coach editor requires a coach/admin session, and per this session's standing rule the assistant never logs in on the user's behalf) — confidence instead rests on: 523/523 passing tests (17 of them exercising the identical `scalingEngine.js` algorithm against the same worked example already confirmed live in forge-admin-web), a clean production build, and the fact that both `PrimarySectionBody` and `VariantTabs.tsx` share the same design and were built from the same reviewed plan.

## What's explicitly still open

- Leaderboard auto-routing by `usual_level` (deliberately out of scope for Phase 1 — `usual_level` today only affects Home-screen default selection, never leaderboard grouping).
- Gym-local → global movement promotion and cross-gym movement deduplication (the `movements.gym_id IS NULL` slot exists for this but is unused).
- No rate-limiting on `regenerate-variant` (matches the platform-wide status quo — flagged, not solved, in the original plan).
- A coach-facing click-through verification of WOD-SIMPLE's new tab bar, by a human with an actual coach/admin session, is recommended before calling this phase fully closed end-to-end.
