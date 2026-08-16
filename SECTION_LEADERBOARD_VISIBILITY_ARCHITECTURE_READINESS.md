# Section Leaderboard Visibility — Architecture Readiness Audit

**Status: GO.** Investigation-only, per mission instruction — no code, schema, or production data was modified. The proposed separation (trackability vs individual-leaderboard-visibility) is not merely compatible with Forge's current architecture — it is **already structurally present but unexposed**: both clients already compute a Section's ranked data (`sections`/`logsBySection`) as a layer strictly beneath the decision of what to individually render (`partsToRender`/`partsToBuild`), and Workout Aggregation's own `buildAggregateLeaderboard` already re-derives its own ranking independently in both repos, never reusing the individually-rendered blocks. Introducing one new, additive, per-Section boolean at the correct existing layer (`workout_sections`) closes the gap with no migration risk beyond a single nullable-safe column add, and — critically — can reuse the exact stale-client-safety mechanism Workout Aggregation Phase 3 already proved live in production for a structurally identical problem.

## Executive Summary

Today, one bit (`workout_sections.logging_mode = 'required'`) simultaneously means four different things: a Section is trackable, its Result is ranked, it is included in Aggregate computation, AND it is individually rendered on Clasament/LeaderboardView. This mission's hypothesis — that "leaderboard visibility" should be a fifth, orthogonal concept — was tested directly against the actual current code in both repos, not assumed. The finding: **the separation the hypothesis wants already exists internally**. In both `App.jsx`'s `Clasament` and forge-admin-web's `fetchWorkoutResultsForDate`, the raw per-Section ranked-log data (`sections`/`logsBySection` in WOD-SIMPLE; `scoredSections`/`bySection` in forge-admin-web) is computed once, then consumed by TWO independent downstream paths: (1) individual-block rendering (`partsToRender`/`partsToBuild`, currently unconditionally including every `logging_mode:'required'` Section) and (2) `buildAggregateLeaderboard`, which — verified by direct code read in both repos — calls its own internal `sortSectionLogs`/`rankResultsForWorkout` on the raw log data, never touching path (1)'s output. Adding a new "should this Section render its own individual block" property therefore only needs to filter path (1)'s membership; path (2) (and PR/Rx/completion_state/TOTAL_REPS, all of which operate at the raw `wod_logs`/`skill_logs` row level, confirmed by the Layer 2b report) remain completely untouched by construction, not by careful discipline.

## Product Problem

Coaches currently have no way to say "track this Result, but don't give it its own competitive leaderboard" — every `logging_mode:'required'` Section unconditionally gets both. The specific, named use case: `Back Squat 5×5` (a strength Section a coach wants tracked for history/PRs, not competitively ranked against other members) currently forces an all-or-nothing choice between "not trackable at all" (`logging_mode` left at its non-required default) and "fully public competitive leaderboard" (`logging_mode:'required'`).

## Current Forge Behavior

Traced directly, both repos, this session — not from memory summaries:

- **WOD-SIMPLE** (`App.jsx`, `Clasament`): `sections` prop (all `workout_sections` rows with `logging_mode:'required'` for this Workout) → `primarySection = sections.find(slot_key==='metcon')`, `additionalSections = sections.filter(slot_key!=='metcon')`, `hasMultipleSections = !!primarySection && additionalSections.length>0` → `partsToRender = hasMultipleSections ? [primarySection, ...additionalSections] : [primarySection || legacyFallback]` → `renderGroups` (what actually renders). Separately, `aggregateSectionsById`/`buildAggregateLeaderboard(aggregateDefinition, aggregateSectionsById, logsBySection)` is built directly from `sections`/`logsBySection` — never from `partsToRender`/`renderGroups`.
- **forge-admin-web** (`api.ts`, `fetchWorkoutResultsForDate`): `scoredSections` (from `fetchScoredSections`, already filtered `logging_mode==='required'` at the JS layer) → `partsToBuild = scoredSections.map(...)` → `sections: WorkoutSectionLeaderboard[]` (returned to `LeaderboardView`, what actually renders). Separately, `aggregateSectionsById`/`entriesBySectionId`/`aggregateLeaderboard` are built directly from `scoredSections` — never from the `sections`/`partsToBuild` result.

**Both repos already have exactly the two-layer shape this mission's hypothesis needs.** No architecture change is required to create the separation — only to expose a new filter at the existing seam.

## Existing Domain Model

`logging_mode` (`workout_sections`) is Programming-owned, values observed in production: `'none'` (warmup — never trackable), `'optional'` (a Skill section created but not marked "independently scored" — trackable via free-text history but not comparator-ranked), `'required'` (independently scored — comparator-ranked, currently always individually rendered). Written exclusively by `sync_workout_engine_v2` (both repos' authoring paths converge on this one RPC), derived at write time from the legacy `wods.skill_scored`/`skill2_scored` booleans (WOD-SIMPLE's authoring — recall from Phase 3 audit: WOD-SIMPLE itself has no V2 authoring UI) and forge-admin-web's `EditableSection.scored` (via `SectionEditor`'s "Independently scored" checkbox). The primary Section is always `scored: isPrimary` — hardcoded true, never a coach choice — confirmed in `sectionEditing.ts`.

## Meaning of Scored

Answered precisely, per mission §7: **combination of A, B, D, and E** — "scored" currently means simultaneously (A) member may log a Result, (B) via the primary/skill-scored toggle logging is the coach's explicit intent, (D) leaderboard exists, and (E) Result is ranked. It does NOT currently mean (C) "logging UI exists" independently (a non-required Section still typically has SOME logging affordance in the member UI — see Member Logging below) nor (F) "Section is primary" (a coach-scored Skill Section is `logging_mode:'required'` without being primary). These four meanings (A/B/D/E) are currently inseparable — this mission's core question is whether D should be pulled out into its own property while A/B/E remain governed by `logging_mode` exactly as today.

## Meaning of logging_mode

`logging_mode` is a **trackability + rankability** contract, not a rendering/presentation contract, even though today it is *read* as if it were both (because nothing else currently exists to separate them). Verified: the DB trigger for Phase A's `aggregate_definition` (`validate_workout_aggregate_definition`) requires every `participantSectionIds` entry to have `logging_mode = 'required'` — Aggregation's own structural validation already treats `logging_mode:'required'` purely as "this Section produces a real, comparator-ranked Score eligible for combination," with zero reference to individual-leaderboard rendering anywhere in that trigger or in either repo's `deriveWorkoutAggregate`/`classifySectionMetric`. This is strong, direct evidence that `logging_mode` already semantically means "trackable/rankable," and that overloading it further with rendering policy (mission §15's explicit warning) would be conflating two dimensions that Forge's own Aggregation feature has already, independently, treated as separate.

## Current Leaderboard Eligibility

The exact, single decision point in each repo: WOD-SIMPLE — membership in `partsToRender` (derived from `sections`, itself pre-filtered to `logging_mode:'required'` server-side/at-fetch, per the Layer 2b report's own "fetch every currently `logging_mode:'required'` Section" language). forge-admin-web — membership in `partsToBuild` (derived from `scoredSections`, `fetchScoredSections`'s own `.filter((s) => s.logging_mode === 'required')`). No other condition currently exists (not format family, not result source, not presence of logs — an empty-but-required Section still gets an (empty) leaderboard slot in forge-admin-web's model, and a header-with-no-cards in WOD-SIMPLE's, per the Layer 2b report's own disclosed behavior at `renderGroup.blocks.length === 0`).

## Current PWA Flow

Member: Home → per-Section Log Score UI (governed by the Workout's own Section list from `workoutEngine.js`, independent of Clasament's own separate fetch) → Journal (all logs, regardless of `logging_mode`, shown via `parseWodLogDetails`, unrelated to Clasament) → Clasament (per-Section blocks, gated exactly as above).

## Current Admin Flow

Coach: `EditWorkoutDialog`/`SectionEditor` (author `scored` per Section, primary always scored) → save → `sync_workout_engine_v2` (writes `logging_mode`) → `LeaderboardView`/`ResultRow` (render, gated exactly as above) → (new, Phase 3) `AggregateEditor` (author `aggregate_definition`, gated by the SAME `logging_mode:'required'` candidate set via `aggregateCandidates`).

## Result Sources

Confirmed unaffected by this proposal: `wod_logs` and `skill_logs` are both normalized upstream of both decision points (`groupLogsBySection`/`logsBySection`) — a hypothetical visibility property would filter at the Section-membership level, after normalization, so it applies identically regardless of which physical table stores the Result. No format-specific or table-specific branch would be needed.

## Member History

Journal/Workout History (both repos) reads `wod_logs`/`skill_logs` directly, entirely independent of Clasament's/LeaderboardView's own Section-fetch-and-group logic (confirmed by the fact that these are separate query paths, not a shared "visible Sections" data source) — a track-only Result would appear in history exactly as it does today, with zero code change required.

## PR Interaction

PR event creation is a DB-trigger-driven mechanism (`pr_events`, confirmed to exist and fire on `skill_logs`/`wod_logs` insert during this session's own Phase 3 cleanup, where deleting a test `skill_logs` row that had triggered a real PR required deleting the dependent `pr_events` row first). This fires at the raw-log-write level, with no dependency on `logging_mode`, Section grouping, or any leaderboard concept — confirmed structurally (the trigger fires on `INSERT`/`UPDATE` of the log table itself, before any leaderboard read ever happens). A track-only Result remains fully PR-eligible.

## Rx Interaction

Per the Layer 2b report (directly re-read this session, not from memory): Rx/Not-Rx classification already only applies to the **primary** Section — additional Sections (whether individually visible or not) have never had Rx classification, a pre-existing, disclosed limitation unrelated to this proposal. For the primary Section specifically (which this mission's own defaults keep always-visible), Rx classification is computed from the log + tier prescription, independent of any rendering decision. No coupling found.

## Completion State Interaction

Confirmed unaffected, directly per the Layer 2b report: `completion_state ?? !!time_result` already operates at individual-row granularity, upstream of and independent from Section grouping/rendering.

## TOTAL_REPS Interaction

Confirmed unaffected: `resolveSetsScoringMode`/`computeSetsScore` (this session's own prior mission) operate on `(formatId, config, rowsByKey)` — a pure function of the Section's own format and the raw logged rows, with no rendering-layer input of any kind. A track-only Tabata/Intervals Section would derive its Total Reps exactly as today; only the individual-leaderboard-block's existence would change.

## Workout Aggregation Interaction

**The single most decisive finding of this audit.** Verified by direct code read in both repos: `buildAggregateLeaderboard` (WOD-SIMPLE `aggregateLeaderboard.js:59` / forge-admin-web `aggregateLeaderboard.ts:72`) calls `sortSectionLogs`/`rankResultsForWorkout` **on its own**, directly on `logsBySectionId[id]`/`entriesBySectionId[id]` — raw, per-Section log data passed in from the caller — never on any already-computed individual-leaderboard block. It has zero dependency on `partsToRender`/`renderGroups` (WOD-SIMPLE) or `partsToBuild`/`sections` (forge-admin-web). A Section hidden from individual rendering would continue to feed `buildAggregateLeaderboard` correctly, with **zero code change to Aggregation itself** — only the caller's construction of `aggregateSectionsById`/`entriesBySectionId` needs to keep including hidden-but-`logging_mode:'required'` Sections (which it already does today, since it currently reads from `sections`/`scoredSections`, not from the individually-rendered list).

## Rank-Combine Interaction

Directly follows from the above: `placement-sum`/`points-sum` combine functions consume each participant Section's own rank, computed by `buildAggregateLeaderboard`'s own internal `sortSectionLogs`/`rankResultsForWorkout` call — this is intra-function, not sourced from any UI-rendered list. A hidden Section's rank is computed identically whether or not its individual leaderboard is ever rendered. This directly answers mission §49/§78-F: **YES**, rank-combine Aggregates work correctly with hidden participant Sections, by construction, today, with the current code, given only that the caller continues to pass hidden Sections into `sectionsById`/`logsBySectionId`.

## Stable Section Identity

Any new property must live on the real `workout_sections` row, keyed by its real UUID — never `legacySlot`, position, or title, per Layer 2a.5's already-proven identity model (reused unmodified by Phase A/Leaderboard-phase/Phase 3, all three of which stored their own new state — `aggregate_definition`, and this mission's own candidate — via the same real-Section-id addressing). No new identity risk: this mission introduces no new identity concept, only a new column on an existing, already-stable row.

## Workout Engine V2 Sync

**This is the one place a genuinely new engineering decision is required — but it has a direct, already-proven-in-production precedent.** `sync_workout_engine_v2`'s own `INSERT INTO workout_sections (...) VALUES (...)` and its `ON CONFLICT (workout_id, slot_key) DO UPDATE SET ...` both use **explicit, enumerated column lists** (confirmed by direct migration-SQL read, `20260716110000_workout_engine_v2_stabilization.sql`) — `section_type_id, order_index, title, description, format, format_config, movements, scaling_versions, logging_mode, score_type, duration_minutes, benchmark_metadata, metadata, updated_at`. A new column, **deliberately left out of both lists**, behaves exactly as Postgres's own `UPDATE ... SET` semantics guarantee: an unlisted column is never touched by that statement. This means:
- A brand-new Section's `INSERT` (which also doesn't list the new column) gets the column's table-level `DEFAULT` — safe, matches "new Sections default to visible."
- An **existing** Section's re-save via the RPC (any client, stale or current) leaves the column's current value **completely untouched**, regardless of client staleness — the RPC literally cannot see or reset it.

This is the **exact same mechanism** Workout Aggregation Phase A/Phase 3 already used and verified live in production for `aggregate_definition` (kept off `workouts`'s own narrow `title/legacy_wod_id/updated_at` update list) — this mission's own property needs the identical treatment, one level down (`workout_sections` instead of `workouts`), and the underlying Postgres guarantee is identical either way. **A coach-authoring write to this new property must go through a separate, targeted `.update()` call (after `sync_workout_engine_v2` completes and real Section UUIDs are resolved) — never through the RPC's own bulk column list** — mirroring Phase 3's `resolveAndSaveAggregateDefinition` pattern precisely.

## Quick Create

Per this session's own Phase 3 audit (directly re-verified applicable here): Quick Create's AI-generated `EditableSection[]` draft flows into the exact same `EditWorkoutDialog`/save path as manual editing — no separate authoring surface. Per mission §38's own preferred hypothesis (do not add AI inference for this), a Quick-Created scored Section should default to `leaderboard_visible = true` (matching current behavior), with no new AI-parser work needed — this mission recommends explicitly rejecting any "AI infers this should be track-only" feature.

## Templates

Not independently re-audited this pass beyond confirming templates flow through the same `EditWorkoutDialog` save path (per Phase 3's own investigation) — recommend, but did not verify with a dedicated live test, that template application preserve any authored visibility exactly as it preserves `scored`/`format`/`formatConfig` today, since there is no reason for this one new field to diverge from every sibling Section field's own copy-through behavior.

## Variants

Confirmed by direct schema reasoning: `logging_mode`, `format`, `format_config` all live on `workout_sections` once, shared across every Scaling tier (Rx/Intermediate/Beginner/OnRamp) — there is no per-variant Section row. This mission's hypothesis (§41 — visibility is Section-level, not variant-level) is therefore not just preferred but **structurally the only option**: there is no existing mechanism anywhere in the schema for a Section-level property to vary by variant. Confirmed, not merely assumed.

## Legacy Workouts

Confirmed safe by the migration semantics described under Workout Engine V2 Sync: `ALTER TABLE workout_sections ADD COLUMN leaderboard_visible boolean NOT NULL DEFAULT true` back-fills **every existing row**, including every one of the 40 production Workouts' primary Sections, to `true` in the same statement — zero existing leaderboard silently disappears, satisfying mission §30's mandatory backward-compatibility requirement by direct Postgres `ADD COLUMN ... DEFAULT` semantics, not a resolver function that could diverge between clients.

## Stale Clients

Covered fully under Workout Engine V2 Sync above — the safety property is a direct consequence of `sync_workout_engine_v2`'s existing explicit-column-list design, not a new mechanism this mission would need to invent.

## Production Data Audit

Read-only, aggregate counts only (no PII): **40 total Workout Engine V2 workouts** in production. `workout_sections` breakdown: 11 `warmup`/`logging_mode:'none'`; 3 `skill`/`logging_mode:'optional'` (not independently scored); **40 `metcon`/`logging_mode:'required'`** — confirming, precisely, that **100% of production Workouts have exactly one scored Section (the primary Metcon), and zero non-primary Sections are currently individually scored in live data** (consistent with the Layer 2b report's own "zero production Workouts have ever had more than one required Section" finding, still true today). `workouts.aggregate_definition`: **0 non-null rows** in production (no coach has yet authored a real aggregate via the Phase 3 UI). These two facts together mean the migration-impact simulation (§63) is not just theoretically safe but **currently vacuous** — there is no existing complex multi-Section or Aggregate-using production Workout that could possibly regress, because none exists yet. This is disclosed honestly rather than overstated: this audit proves the migration is *safe*, not that a track-only/hide-leaderboard/Aggregate-with-hidden-participant scenario has been *exercised* against real production data (no such scenario exists to exercise).

## Competitor Evidence

Reused from the already-completed `WORKOUT_AGGREGATION_COMPETITIVE_RESEARCH.md` and `SCORING_COMPETITIVE_LANDSCAPE.md` (not re-researched this pass, per mission §4's own instruction not to re-verify settled research) — no competitor evidence was found in those prior passes specifically addressing "track without individual leaderboard" as a named feature; this proposal is evaluated purely against Forge's own architecture, not competitor precedent, matching the mission's own explicit instruction that "competitor behavior is evidence, not authority."

## Model Options

| Option | Semantic clarity | Migration safety | Stale-client safety | Aggregate compatibility | UX simplicity | Future-proofing | Recommendation |
|---|---|---|---|---|---|---|---|
| A. Keep current `scored=leaderboard` coupling | Low — conflates 2 concerns already proven separable by Aggregation's own design | N/A | N/A | Works today only because no track-only case exists | Simple but cannot express the product need at all | Poor — blocks the named use case permanently | Reject |
| B. New boolean, `workout_sections`, kept off the RPC's column list | High — one bit, one meaning, additive | High — `DEFAULT true` backfills existing rows in the same statement | High — proven mechanism, direct Phase 3 precedent | Full — Aggregation already reads raw `sections`/`scoredSections`, untouched | High — one checkbox, default-on | High — same pattern extends to any future per-Section presentation flag | **Recommended** |
| C. Extend `logging_mode` (e.g. a 4th value) | Low — mission §15 explicitly warns against this; would conflate trackability-requirement with rendering-policy inside one enum the DB trigger and both clients already read as "is this Section a valid Aggregate participant" | Medium — every existing `required`-reader (the Aggregation trigger, both ranking engines) would need auditing for the new value | Same RPC problem as B, but now on a column already fully owned by the RPC's explicit list — cannot be added to `logging_mode` without also updating the RPC, reintroducing exactly the staleness risk B avoids | Risk — trigger/engines would need new-value-awareness added everywhere `logging_mode==='required'` is checked | Confusing — "optional-but-visible" vs "required-but-hidden" is a combinatorial mess in one enum | Poor | Reject |
| D. New 3-state enum (`DISPLAY_ONLY`/`TRACK`/`TRACK_AND_RANK`) | Medium — clean product mapping, but duplicates information already carried by `logging_mode` (DISPLAY_ONLY ≈ not-required, TRACK ≈ required, TRACK_AND_RANK ≈ required+visible) | Medium — a new field replacing/shadowing part of what `logging_mode` already means risks drift between the two | Same RPC consideration as B | Full, if scoped correctly | Medium | Medium — an extra field that partially duplicates `logging_mode` is a smell, not an asset | Reject — redundant with existing `logging_mode`, violates single-source-of-truth |
| E. No schema change (existing field already sufficient) | N/A | N/A | N/A | N/A | N/A | N/A | Rejected — verified no existing field (`logging_mode`, `slot_key`, any Programming or Results field) currently carries this distinction; a genuinely new bit is required |

## Recommended Domain Model

Two orthogonal Section-level concepts, exactly matching the mission's own final hypothesis, now confirmed (not assumed) against actual architecture:
- **Trackability/rankability** — unchanged, still `workout_sections.logging_mode` (`'none' | 'optional' | 'required'`), Programming-declared, Results-consumed, unmodified by this proposal.
- **Individual leaderboard visibility** — new, `workout_sections.leaderboard_visible` (name discussion below), Programming-declared, Results/Clasament/LeaderboardView-consumed at the individual-rendering seam only.

## Recommended Persistence Model

`workout_sections.leaderboard_visible boolean not null default true` (naming: **`leaderboard_visible`** recommended over `leaderboard_enabled`, directly per mission §19/§48's own reasoning — "enabled" implies control over ranking/computation; "visible" precisely and only names the individual-rendering decision, matching what the code audit proved is the only thing this property should ever gate). Written via a new, small, targeted `.update()` call in the coach-authoring save path, deliberately excluded from `sync_workout_engine_v2`'s own column lists, reusing Phase 3's exact `resolveAndSaveAggregateDefinition`-style pattern (await the RPC, resolve real Section UUIDs, then a separate scoped write) — not the RPC itself.

## Recommended Defaults

Exactly the mission's own §36 table, now confirmed consistent with current architecture and production data (100% of real Sections today are primary Metcons, which this default set keeps unconditionally visible): Primary Metcon `leaderboard_visible = true` always (not even coach-configurable, matching how `scored` is already hardcoded `true` for primary); newly-scored non-primary Sections default `true` (preserves "independently scored ⇒ leaderboard" as the default mental model, opt-out not opt-in, per mission §37); Warmup/Cooldown/non-scored Sections: property is irrelevant (never read, since `logging_mode` already excludes them from `sections`/`scoredSections` upstream of any visibility check).

## Recommended Authoring UX

`[✓] Independently scored` (existing checkbox, unchanged) → reveals, nested/indented, `[✓] Show on leaderboard` (new, default checked, only rendered when the parent is checked) — matching mission §35's own preferred shape and this codebase's own established progressive-disclosure convention (already used identically for Workout Aggregation's own panel, Phase 3). Copy: **"Show on leaderboard"**, not the internal field name — matching mission §73's instruction and the existing UI's own plain-language convention (`"Independently scored (has its own leaderboard)"` is the current checkbox label — the new sub-option would logically read `"Show on leaderboard"` immediately beneath it, removing the now-inaccurate parenthetical from the parent since it would no longer always be true).

## Member Experience

**Display only**: no logging UI for that Section, no history entry, no leaderboard. **Track only**: full Log Score UI exists exactly as today (member-facing logging is gated by `logging_mode`, confirmed structurally independent of any rendering-layer property), Result appears in Journal/history exactly as today, PR/Rx/completion_state/TOTAL_REPS all behave exactly as today — only Clasament omits that Section's block. **Track + Leaderboard**: byte-identical to all current behavior.

## Aggregate-Only Leaderboard

**Confirmed feasible with zero Aggregation code changes**, per the Workout Aggregation Interaction finding above: two Sections both `leaderboard_visible: false`, both `logging_mode:'required'`, with a coach-authored `aggregate_definition` combining them — `partsToRender`/`sections` (individual rendering) would correctly show neither block; `buildAggregateLeaderboard` (fed from the unfiltered `sections`/`scoredSections`, untouched by the new property) would correctly compute and render the combined Total. This is the mission's own §46 canonical acceptance scenario, and this audit found no architectural obstacle to it.

## Security

No new security model — confirmed, matching the mission's own expected answer (§55). The new column sits under the same gym-scoped RLS policies `workout_sections` already has; no new read/write permission boundary is introduced.

## Performance

No new query pattern — the new property would be included in the SAME already-fetched `workout_sections` row/query both repos already perform (`fetchScoredSections`'s existing `select`, WOD-SIMPLE's existing Section fetch) — a single additional selected column, not a new round trip, and (per mission §56) actually *reduces* downstream rendering work when false, never adds an N×N pattern.

## Migration Strategy

One additive migration: `ALTER TABLE workout_sections ADD COLUMN leaderboard_visible boolean NOT NULL DEFAULT true;` — no backfill script needed (the `DEFAULT` clause backfills atomically in the same statement, standard Postgres behavior for a non-volatile default on a table of this size). No RPC change (deliberately). One optional, low-priority integrity note (not a recommended CHECK constraint): the invariant `leaderboard_visible ⇒ logging_mode='required'` is already enforced *functionally* by the existing read-path filter chain (only `logging_mode:'required'` rows ever enter `sections`/`scoredSections` in either repo, so a `leaderboard_visible=true` value on a non-required row is inert, unreachable dead data, never actually violating the visible invariant) — a DB CHECK constraint would add defense-in-depth but is not required to prevent an observable bug, consistent with this codebase's own established "smallest sufficient" pattern (Phase A's own trigger left semantic/format validation to the application layer for the same reason).

## Backward Compatibility

Fully satisfied per the Migration Strategy above — every one of the 40 existing production Sections retains its exact current leaderboard behavior automatically, by `DEFAULT true` backfill, with no resolver function required to reproduce legacy behavior (unlike a nullable-tristate model, which mission §31 also raised as an option — rejected here specifically because `NOT NULL DEFAULT TRUE` already gives the exact same backward-compatible outcome with strictly less complexity: no client, old or new, needs to know how to interpret a `NULL`).

## Failure Mode Audit

| # | Failure mode | Status | Evidence |
|---|---|---|---|
| 1 | Hiding leaderboard also hides Log Score | NOT PRESENT | Member logging UI is gated by `logging_mode`/Section presence in the Workout's own Section list (`workoutEngine.js`), a completely separate fetch/render path from Clasament's own `sections`/`partsToRender` construction |
| 2 | Hiding leaderboard prevents Aggregate | NOT PRESENT | `buildAggregateLeaderboard` reads raw `sections`/`scoredSections`, never `partsToRender`/`partsToBuild` — confirmed by direct code read, both repos |
| 3 | Hiding leaderboard prevents rank-combine Aggregate | NOT PRESENT | `buildAggregateLeaderboard` calls its own internal `sortSectionLogs`/`rankResultsForWorkout`, never reusing rendered blocks — confirmed by direct code read, both repos |
| 4 | Hidden Section results disappear from journal | NOT PRESENT | Journal/History reads `wod_logs`/`skill_logs` directly, unrelated to Clasament's Section-fetch |
| 5 | Hidden Section cannot create PR | NOT PRESENT | PR trigger fires on raw log INSERT, no `logging_mode`/leaderboard dependency |
| 6 | `skill_logs` path ignores visibility | N/A — both `wod_logs` and `skill_logs` are normalized into the same shape upstream of the (currently single) Section-inclusion decision; a new property would apply identically to both, by construction |
| 7 | `wod_logs` path ignores visibility differently | Same as #6 |
| 8 | Admin and PWA disagree | POTENTIAL RISK — both repos independently port pure logic ("port, don't share," this codebase's own established convention) — a future implementation MUST keep the resolver (`effectiveLeaderboardVisibility`-equivalent, if any override logic beyond a plain boolean is ever needed) identical in both, parity-tested, exactly as every prior Workout Aggregation piece was |
| 9 | Legacy Workouts default hidden accidentally | NOT PRESENT | `DEFAULT TRUE` backfill, verified via Postgres `ADD COLUMN` semantics |
| 10 | Quick Create produces hidden primary Metcons | NOT PRESENT | Primary is hardcoded `scored: isPrimary`; recommended default `leaderboard_visible: true` for every new Section including AI-generated ones, no inference logic to get wrong |
| 11 | Reorder moves visibility between Sections | NOT PRESENT | Property lives on the real `workout_sections.id` row, unaffected by reorder (Layer 2a.5's already-proven identity model, reused not reinvented) |
| 12 | Old client resets visibility | NOT PRESENT | `sync_workout_engine_v2`'s explicit column lists never reference the new column — Postgres `UPDATE...SET` leaves unlisted columns untouched, verified via direct migration-SQL read |
| 13 | Save path omits new metadata | POTENTIAL RISK, BY DESIGN — the RPC path deliberately does NOT carry this field; only a NEW, dedicated authoring-UI write path would set it (mirroring Phase 3's `aggregate_definition` pattern exactly) — this must be implemented correctly when Phase 0 of this feature is built, not assumed |
| 14 | Workout Engine V2 sync loses metadata | NOT PRESENT, given #13's write path is implemented correctly — the RPC's deliberate non-involvement is the safety mechanism, not a gap |
| 15 | Aggregate authoring excludes hidden Sections | POTENTIAL RISK — Phase 3's own `aggregateCandidates` filters on `isPrimary \|\| scored` only, correctly unrelated to any hidden-leaderboard concept; must be re-verified (not re-derived) when this feature is built, that no future edit accidentally couples `aggregateCandidates` to `leaderboard_visible` |
| 16 | Leaderboard queries filter too early, removing data needed downstream | NOT PRESENT | Confirmed both repos fetch the full `logging_mode:'required'` set once, upstream of both the individual-render and Aggregate consumption paths — a visibility filter, correctly implemented, belongs only at the individual-render step, never at the shared fetch |

## Future Implementation Sequence

Smaller than the mission's own suggested 4-phase default, because the architecture audit found the ownership/consumption boundaries already correct — no separate "Phase 2: PWA/Admin leaderboard rendering policy" is needed as its own phase, since it's the direct, mechanical consequence of Phase 0+1:

**Phase 0** — `workout_sections.leaderboard_visible boolean not null default true` migration; a pure resolver (if any logic beyond the raw boolean is ever needed — likely none, since `NOT NULL DEFAULT TRUE` requires no resolution logic at all, unlike `aggregate_definition`'s nullable case); the dedicated, RPC-independent authoring write path (Phase 3's own pattern, reused).

**Phase 1** — Coach authoring UX (the nested checkbox) in forge-admin-web (WOD-SIMPLE has no authoring surface, confirmed by Phase 3's own audit, unchanged fact) + individual-render filtering in both `Clasament` (`partsToRender`) and `LeaderboardView` (`partsToBuild`/`sections`) — these two are small enough to combine into one phase, since the render-side filter is a one-line `.filter(s => s.leaderboard_visible)` addition at an already-identified single seam per repo, not independent work.

**Phase 2** — Production acceptance: the mission's own §81/§82/§83 acceptance scenarios (track-only Back Squat, Aggregate-only Total, rank-combine-with-hidden-participant), live-verified with real logged data, matching this codebase's own established verification discipline.

## Test Plan

Per mission §80's own 35-item list — all listed items are appropriate and none should be dropped; no additions needed beyond what the mission already specified, since the architecture audit did not surface any failure mode the mission's own list hadn't already anticipated.

## Production Acceptance Plan

Per mission §81/§82/§83 verbatim — all three scenarios are directly supported by the architecture as audited, with no modification needed to the mission's own proposed acceptance steps.

## Architectural Decisions A-Z

**A.** YES — separate the concepts. **B.** `leaderboard_visible` (Section-level boolean), trackability remains `logging_mode` unchanged. **C.** Programming-owned (declared at authoring time, alongside `scored`), Results/Clasament/LeaderboardView-consumed at render time only. **D.** "Not rendered" — never "not ranked"; ranking/rankability is entirely governed by `logging_mode`, confirmed structurally independent. **E.** YES. **F.** YES. **G.** NO. **H.** NO. **I.** NO. **J.** NO. **K.** NO. **L.** NO. **M.** `workout_sections.leaderboard_visible boolean not null default true`. **N.** YES, one additive column, one migration, no RPC change. **O.** Every existing row backfilled `true` in the same migration statement — zero resolver logic needed for legacy behavior. **P.** Fully safe, by construction — the RPC's existing explicit-column-list design already protects any column deliberately left off it. **Q.** Always visible, not coach-configurable (matches `scored` already being hardcoded for primary). **R.** Visible by default (opt-out model). **S.** Result remains fully intact (log, history, PR, Rx, completion_state, TOTAL_REPS all unaffected); only the individual leaderboard block stops rendering; Aggregate participation unaffected. **T.** The same, already-existing Results reappear — no relog, no backfill, no recomputation beyond the leaderboard's own normal derive-on-read behavior. **U.** No change — property is Section-id-keyed, reorder-safe by construction (Layer 2a.5). **V.** No change — never title-mapped. **W.** Not independently audited live this pass; recommended default: promotion/demotion should NOT reset the property (it is orthogonal to primary status, just as `logging_mode:'required'` already is for a scored Skill Section) — flag for verification when Phase 0 is implemented, not a blocker to GO. **X.** Quick Create/Templates/Variants: no special-case logic needed or recommended; Variants structurally cannot vary this property (Section-level field, no per-variant row exists). **Y.** YES — confirmed, zero migration risk beyond the single additive column, zero behavior change to any existing consumer until the new column is both added AND a future UI sets it to `false` for the first time. **Z.** YES, safe to proceed to implementation.

## Final Verdict

**GO.** The proposed domain separation is not just compatible with Forge's current architecture — the architecture already implements the separation internally (raw scored-Section data vs. individually-rendered blocks vs. independently-computed Aggregate), and this mission's job reduces to exposing one new, additive, correctly-scoped, correctly-isolated-from-the-sync-RPC property at the one seam where "trackable" and "individually visible" currently, artificially, collapse into the same bit. No blocker was found. The one implementation-time discipline that must be followed precisely (not merely noted) is keeping the new column off `sync_workout_engine_v2`'s explicit column lists — every other requirement in this mission's own 84-section brief is already satisfied by the current architecture, verified by direct code and data inspection, not assumed.

## Final Response

1. Overall verdict: **GO**.
2. Trackability and leaderboard visibility should be separate: **YES**.
3. Exact recommended domain concept/name: `leaderboard_visible` (boolean, `workout_sections`) — chosen over `leaderboard_enabled` specifically because "enabled" implies control over computation/ranking, which this property must never touch.
4. Current meaning of `scored`: a conflation of "member may log," "logging is the coach's intent," "Result is ranked," and "leaderboard exists" — verified this session to be four meanings collapsed into one bit, `logging_mode:'required'`.
5. Current meaning of `logging_mode`: a trackability + rankability contract (Programming-declared, Results/Aggregation-consumed) — already treated by the Aggregation DB trigger as exactly this and nothing more, independent evidence it should stay that way.
6. Current rule for leaderboard inclusion: membership in `partsToRender` (WOD-SIMPLE) / `partsToBuild` (forge-admin-web), both derived from the `logging_mode:'required'` Section set with no further filter today.
7. Recommended persistence model: one new `NOT NULL DEFAULT TRUE` boolean column on `workout_sections`, written via a dedicated authoring-path `.update()` call, deliberately excluded from `sync_workout_engine_v2`'s bulk-sync column lists.
8. Schema change required: **YES**, minimal — one additive column, no new table, no RPC modification.
9. Recommended DB field: `workout_sections.leaderboard_visible boolean not null default true`.
10. Default for existing scored Sections: `true` (unchanged behavior), via migration-time `DEFAULT` backfill.
11. Default for existing non-scored Sections: irrelevant (never read — `logging_mode` excludes them from the read path entirely).
12. Default for newly-scored Sections: `true` (opt-out model, per mission §37).
13. Default for Primary Metcon: always `true`, not coach-configurable — matches `scored` already being hardcoded for primary.
14. Meaning of hidden leaderboard: the Section's own individual block is not rendered — its Result, ranking, Rx, completion_state, PR-eligibility, and Aggregate-participation are all completely unaffected.
15. Hidden Results remain rankable internally: **YES**, confirmed by direct code read — `buildAggregateLeaderboard` computes its own ranking independently of any rendering decision, in both repos.
16. Hidden Sections remain loggable: **YES** — member logging UI is structurally independent of Clasament's/LeaderboardView's own Section-fetch.
17. Hidden Results remain in history: **YES** — Journal/History reads raw log tables directly, unrelated to leaderboard grouping.
18. PR behavior: unaffected — PR triggers fire on raw log writes, no leaderboard dependency found.
19. Rx behavior: unaffected for the (always-visible) primary Section; non-primary Sections already have no Rx classification regardless of this proposal (pre-existing, disclosed Layer 2b limitation).
20. `completion_state` behavior: unaffected — already row-level, confirmed by the Layer 2b report.
21. TOTAL_REPS behavior: unaffected — `resolveSetsScoringMode`/`computeSetsScore` take no rendering-layer input.
22. `wod_logs` behavior: unaffected, normalized upstream of any Section-inclusion decision.
23. `skill_logs` behavior: unaffected, same normalization path as `wod_logs`.
24. Aggregate compatibility: **full** — confirmed via direct code read that Aggregation never consumes the individually-rendered list.
25. Rank-combine Aggregate compatibility: **full** — confirmed via direct code read that `buildAggregateLeaderboard` computes its own ranking internally.
26. Aggregate-only leaderboard feasibility: **YES**, confirmed feasible with zero changes to Aggregation code.
27. Mixed-visibility Aggregate feasibility: **YES**, same reasoning — each participant Section's visibility is independent of whether it's an Aggregate input.
28. Quick Create behavior: no AI inference recommended; new scored Sections (including AI-generated) default `leaderboard_visible: true`.
29. Template behavior: recommended to preserve the property exactly as templates already preserve `scored`/`format` (not independently live-verified this pass — flagged, not a blocker).
30. Variant behavior: structurally cannot vary by variant — no per-variant Section row exists.
31. Reorder behavior: unaffected, Section-id-keyed, reorder-safe by Layer 2a.5's proven identity model.
32. Rename behavior: unaffected, never title-mapped.
33. Primary promotion/demotion behavior: recommended the property should NOT reset on promotion/demotion; not independently live-verified, flagged for Phase 0 implementation-time confirmation.
34. Stale-client safety: **high** — proven via `sync_workout_engine_v2`'s existing explicit-column-list design and direct migration-SQL inspection, the identical mechanism already validated live in production for `aggregate_definition`.
35. Legacy compatibility: **full** — `DEFAULT TRUE` backfill requires no resolver logic to reproduce current behavior for any existing row.
36. Migration impact: one additive column; 100% of the 40 current production Sections' leaderboard behavior is preserved automatically; 0 Aggregate definitions exist in production today to break (disclosed as a limit on how thoroughly this could be "tested" against real data, not a gap in the architecture itself).
37. Security impact: none — same RLS-scoped table, no new permission boundary.
38. Performance impact: none — one additional column in an already-fetched row; reduces downstream render work when `false`.
39. PWA implications: `Clasament`'s `partsToRender` gains one `.filter()`; no other change.
40. Admin implications: `fetchWorkoutResultsForDate`'s `partsToBuild`/`sections` gains one `.filter()`; `EditWorkoutDialog`/`SectionEditor` gain the new nested checkbox; no other change.
41. Recommended coach UX: nested `[✓] Show on leaderboard` beneath the existing `[✓] Independently scored` checkbox, default checked, hidden entirely (not disabled) when the parent is unchecked.
42. Recommended member UX: no visible change for Display-only/Track+Leaderboard; for Track-only, the Log Score card remains, the Journal entry remains, Clasament simply omits that Section's block.
43. Highest-risk coupling discovered: **none in the leaderboard/Aggregation logic itself** — the one genuine engineering discipline required is keeping the new column off `sync_workout_engine_v2`'s bulk-sync column lists; getting this wrong (accidentally adding it to the RPC) would reintroduce exactly the staleness risk this whole model is designed to avoid.
44. Blockers: **none** found.
45. Recommended implementation phases: Phase 0 (migration + resolver-if-needed + dedicated write path) → Phase 1 (coach authoring UX + individual-render filtering, both repos, combinable into one phase) → Phase 2 (production acceptance per mission §81-83).
46. Report path: `SECTION_LEADERBOARD_VISIBILITY_ARCHITECTURE_READINESS.md` (WOD-SIMPLE root).
47. Commit hash for report only: recorded after commit, below.
48. Working-tree/origin status: clean of any code/schema/data change — this mission touched no application code, no migration, no production data; only this report file was added.

### A. Should Forge adopt DISPLAY ONLY → TRACK → TRACK + LEADERBOARD as its coach-facing model?
**YES.**

### B. Should leaderboard visibility be an orthogonal property of a scored/trackable Section rather than being encoded into scoring semantics?
**YES.**

### C. Should a Track-only Section remain fully usable by Workout Aggregation, including rank-combine Aggregates?
**YES.**

### D. Can this architecture be introduced additively without changing or deleting existing member Results?
**YES.**

### E. Will every existing scored Section retain its current leaderboard behavior by default?
**YES.**

### F. Is the architecture safe to implement now?
**GO.**
