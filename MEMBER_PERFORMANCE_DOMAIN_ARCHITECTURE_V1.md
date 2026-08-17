# Member Performance Domain — Architecture V1

**Status: Research + Architecture only. No code, schema, migration, or production data changed.**

# Executive Summary

Forge does not need a new Member Performance domain built from zero. It already has one — "Results Phase 2" (Slices 1-5), shipped 2026-08-05/06 — comprising a Benchmark Identity resolver, an append-only PR Event ledger, a generalized Performance Identity (which recognizes arbitrary repeated workouts, not just official benchmarks), three trend views, and seven analytics views, plus partial UI wiring on both clients. This document's job is therefore not to invent Performance from scratch but to: (1) formally define the comparison-identity concept that already implicitly exists across these five slices, (2) name and close the real gaps found in the Current-State Audit, (3) recommend the smallest V1 product surface that makes this existing backend visible and useful to a member, and (4) draw a hard line around what stays deferred.

The single most important finding: **the PR Event Ledger is currently empty in production**, not because of a bug, but because real gym activity in the 11 days since it shipped hasn't produced a log matching either detection path's data shape. Any V1 that includes a "Recent PRs" feature must treat this as the load-bearing risk it is.

# Goals

Answer, for a member, with data that is genuinely comparable and never fabricated: What are my current PRs? What's my history for a specific movement or benchmark? How am I trending? — using only what Results already knows, never a second scoring engine.

# Non-Goals (V1)

Estimated 1RM, training volume, training consistency, a composite fitness score, Aggregate-level PR tracking, coach-scheduled "Evaluations"/testing events, readiness/wellness surveys, velocity-based training, cross-gym/World leaderboards, historical backfill, movement-canonicalization backfill, rep-scheme-keyed PR detection (real gap, deferred to a named future phase, not V1).

# Existing Foundations (do not rebuild)

Per this mission's own §0, plus the Current-State Audit's headline finding: canonical scoring (22 formats), `wod_logs`/`skill_logs`, stable `workout_section_id`, Rx semantics, completion_state, Section Leaderboard Visibility, Workout Aggregation — **and, additionally, already-shipped**: `benchmarks`/`benchmark_aliases` + `resolve_benchmark_names`, `pr_events` + its two detection triggers, `personal_records`, `performance_identities` + Signature V1, three trend views, seven Slice-5 analytics views, and three UI components already reading them live.

# Domain Ownership

No new domain. Performance is a **derived layer inside the existing, already-live Results domain** — not a peer domain, not a separate source of truth. This matches Results Domain Architecture's own already-frozen entity classification (Result/PR Event/Performance Identity = true entities; Personal Record/Movement Performance/Leaderboard/trend = derived) almost exactly; V1's only job is to formalize the comparison-identity concept these entities already implicitly share, and build the missing UI/query surface on top.

# Performance vs Results

Results answers "what did the athlete do" (canonical score, Rx status, completion state — already fully audited and correct per the Universal Workout Scoring Audit). Performance answers "how is the athlete changing over time" by grouping only Results that share a **comparison identity** and never re-deriving or re-interpreting the canonical score itself. This boundary already holds in the live code (PR triggers read `time_result`/`result`/`sets` as already-computed facts, never re-parse raw log text) and must remain a hard invariant for any V1 addition.

# Comparison Identity

The central concept this mission asks for (§45) already exists, split across three cases, not one abstraction — and should **stay** three cases rather than being collapsed into one new "PerformanceKey" entity (challenging §46/§67's suggestion: an additional abstraction layer here would duplicate, not clarify, what `pr_events.pr_type` + `benchmark_id`/`movement` already encode):

1. **Movement comparability** = `movement` (raw text today, canonical `movement_id` once/if populated) + `rep_scheme` (column exists, not yet keyed — see Risks). Two Results are comparable only if both dimensions match.
2. **Benchmark comparability** = `benchmark_id` (canonical, live) + **Scaling Context** (Rx vs Scaled — never pooled, a frozen invariant already enforced structurally by keeping tiers as distinct `variant_level` values).
3. **Arbitrary-workout comparability** = `performance_identity_id` (Signature V1: format + format_config + normalized movement-line text) — the general case, subsuming #2 when a Benchmark match resolves.

No new "Score Component" or generic comparison-key table is needed. The three cases above are precisely the three PR types (`movement`, `benchmark`) plus the Performance Identity signature relationship (`benchmark`⊂`performance_identity`) already encoded in the live schema's own CHECK constraints.

# Movement Performance Identity

Sufficient in principle (the `movement` text column, `performance_identity_id`), **insufficient in practice** today: canonical `Movement.canonicalName` is 0% populated in production (re-confirmed this audit, unchanged since Slice 4's own finding 11+ days ago). V1 must not assume movement identity is reliable — see V1 Scope.

# Rep-Scheme Identity

The smallest formal representation needed (per §11's own instruction not to hardcode every strength program) is exactly what the `pr_events.rep_scheme` column and the unapproved Scoring Model VNext paper already independently converged on: a movement PR's true identity is `(movement, target_rep_max)`, not `movement` alone. This is **not built** at the detection-rule level today (a real, confirmed gap) — V1 should either close it (requires touching `evaluate_movement_prs`, which is implementation, out of this mission's scope) or explicitly launch V1's Movement History screen scoped to "all logged sets for this movement, unfiltered by rep scheme" (a lower-value but honestly-labeled V1, not silently claiming a false 5RM PR).

# Benchmark Identity

Sufficient and live (Slice 1). No new work needed for V1 beyond UI (a Benchmark Detail screen). Gym-tier custom benchmark creation has SQL support but no UI — out of V1 scope (a Programming-side authoring gap, not a Performance gap).

# Personal Best

**Derived**, not persisted, matching the existing `movement_pr_events_current`/`benchmark_pr_events_current` view pattern exactly ("higher value governs" between the ledger and `personal_records`). V1 adds no new persisted "current best" table.

# PR Event

Already a true, persisted, append-only entity (`pr_events`). V1's only required decision here is **not architectural but operational**: given the ledger is empty in production, does V1 (a) ship as-is and let it fill in from today forward (matches every competitor's own "no backfill" norm, and matches Forge's own established no-backfill precedent across Slices 3-5), or (b) treat the empty-ledger finding as a blocking prerequisite. This document recommends (a) — ship with an honest "PRs will appear here as you log them" empty state, exactly the same posture already used successfully elsewhere in Forge (Dashboard 2.0's own disclosed "grows from real activity going forward, not retroactively"). This is a product-copy decision, not a schema change.

# Movement History

**V1 scope, with an explicit caveat.** Per Hevy/Strong's cleanest-of-all-researched pattern (a per-movement organizing page, confirmed in Competitive Research), a Movement Detail view is high-value and the data already exists (`movement_progress_summary`). Caveat: since rep-scheme isn't keyed and canonical movement identity is text-only, V1's Movement History must show **all logged sets for that movement text, chronologically**, never claim a specific-rep-scheme "PR" unless/until the rep-scheme gap is closed. This is the correct, honest scoping — not "do everything," not "do nothing."

# Benchmark History

**V1 scope, no caveats** — Benchmark Identity is fully correct and live. A Benchmark Detail view (best Rx result, chronological history, kept separate from Scaled) is directly supported by `benchmark_progress_summary` with zero new backend work.

# Workout History

Stays as Journal (existing, per this mission's own Non-Goal framing in §17: don't repackage Journal as Performance). Performance's Movement/Benchmark/Overview views are new, derived summaries — not a re-skin of the log list.

# Track-only Results

**Fully participate**, confirmed structurally (PR triggers have zero dependency on `leaderboard_visible`). No special-casing needed in V1 — this invariant already holds without any new code.

# Rx / Variant

**Never pooled.** Already a frozen Results Domain Architecture invariant, already enforced (Scaling Context is part of Benchmark comparability, above). V1's Benchmark Detail view must show Rx and Scaled as separate, clearly labeled history lines — mirrors every competitor researched (btwb/SugarWOD/Wodify all keep these explicitly separate).

# Completion / Capped

A capped benchmark attempt is real history and must appear in Benchmark History (a member should see "Aug 10: capped at 8:00" alongside "Mar 3: completed 7:50"). Whether a capped result can itself be a NEW PR depends on the existing ranking rule already audited (a completed result always outranks any capped result) — this is inherited from Results, not re-decided by Performance. No new logic needed.

# Units

Already correctly handled — `personal_records` has documented real+converted unit storage; `pr_events.score_unit` exists per-event. V1 needs no new unit-conversion work.

# Result Edit/Delete

**Real, confirmed gap, not resolved today.** `pr_events` rows have no reconciliation trigger on `UPDATE`/`DELETE` of the source log — an edited-down Result leaves a stale PR event in the ledger. This is a genuine risk for V1's PR feed (a member could see a PR claim that no longer matches their edited history). V1 architecture decision: the "current best" derivation, being a fresh SELECT/view rather than a cached value, will correctly reflect an edited-down Result the next time it's queried — but the **historical PR Event entry itself** will remain, describing a fact that's no longer true. Recommend V1 display PR Events as historical facts ("you set a PR of X on this date," true at the time) rather than implying the value still stands — the "current best" view is the only thing that should ever claim present-tense truth. This resolves the tension without requiring new reconciliation code.

# Historical Stability

Sound. The Scoring Snapshot pattern (format+config+movements frozen at logging time) already protects Performance Identity resolution from later Workout edits — confirmed by Slice 4's own "Duplicate-to-Date auto-resolves to the same identity" verification and the real "PARTNER MARY" collision proof.

# Aggregates

**Deferred, correctly.** Workout Aggregation's own architecture already named aggregate-level PR tracking as future/unstarted work (§41), and this audit found no reason to revisit that. V1 does not show Aggregate Totals in Performance history — a member's Snatch+C&J Total is visible on the workout's own leaderboard/results view (already live, Section Leaderboard Visibility mission), not duplicated into Performance.

# Data Model

**No new tables required for V1.** Every entity V1 needs already exists: `pr_events`, `performance_identities`, `benchmarks`/`benchmark_aliases`, `personal_records`, and the 7 Slice-5 views. If the rep-scheme gap (above) is closed in a later phase, that's a change to `evaluate_movement_prs`' existing logic, not a new table.

# Persisted vs Derived

| Concept | Classification |
|---|---|
| Result (wod_logs/skill_logs) | Persisted |
| PR Event | Persisted, append-only |
| Performance Identity | Persisted (resolved once at logging time) |
| Current Best / Personal Record view | Derived |
| Movement History | Derived |
| Benchmark History | Derived |
| Trend / Progression | Derived (already 3 layered views) |
| Consistency / Volume | N/A — not built, V1 non-goal |

# Query Contracts (illustrative, not implementation)

`getMovementHistory(member, movementText)`, `getBenchmarkHistory(member, benchmarkId, variant)`, `getBenchmarkBest(member, benchmarkId, variant)`, `getRecentPRs(member, sinceDate)`, `getPerformanceOverview(member)` — all map directly onto existing Slice 5 views with a `WHERE member_id = ...` filter; none require new aggregation logic.

# Member UX

**Highest-value 3 elements, not 20 widgets** (per §33's own instruction):
1. **Overview** (already exists as `PerformanceOverviewPanel` — extend, don't replace): recent PRs (with honest empty state), current streak of logged activity is explicitly OUT per Non-Goals, so: totals + trend chip only.
2. **Movement Detail** (new UI, existing data): search a movement, see chronological history.
3. **Benchmark Detail** (new UI, existing data): search/select a benchmark, see Rx/Scaled-separated history + best.

Reject a 4th+ tab for V1 (consistency, volume) — no data exists yet, and building UI ahead of data is exactly the "flashy dashboard, not meaningful intelligence" anti-pattern this mission's own Central Product Question warns against.

# Coach UX

**V1 scope, minimal**: forge-admin-web's existing `AthletePerformanceOverview` (already live, mounted on the athlete results page) is sufficient for V1 — extend it with links into the same Movement/Benchmark Detail views, scoped to that member, no separate coach-only data model. Do not build gym-wide cohort analytics in this V1 — that already exists separately (Dashboard 2.0's `PerformanceCommandCenter`, a distinct, already-shipped surface).

# Security

No new privacy model needed. Existing RLS already scopes `pr_events`/`performance_identities`/results tables by `gym_id` and (implicitly, via existing Member-vs-Coach patterns already used elsewhere in Results) member ownership. V1's only requirement is to confirm (not redesign) that a member's Performance views are scoped to `member_id = auth.uid()`-equivalent and a coach's view is scoped to their own gym's members — both patterns already exist elsewhere in the codebase and should be reused, not reinvented.

# Performance/Indexes

No index gaps found in the 7 views inspected. Not re-verified via `EXPLAIN` this audit (would require more invasive production access) — flagged as a standard pre-launch check for whichever future implementation phase builds the UI, not a blocking architectural concern.

# Migration Strategy

**None required for V1** if the recommended scope (UI on existing views) is followed. If a future phase closes the rep-scheme gap, that's a function-body change to `evaluate_movement_prs`, additive and backward-compatible (existing `pr_events` rows are unaffected; new detections going forward gain rep-scheme keying).

# Legacy Data

No backfill in V1 (consistent with the mission's own §61 instruction and Forge's own established no-backfill precedent across every Results Phase 2 slice). A member's pre-Aug-6 history is visible in Journal/Workout History as always, just not reflected in PR Events/Performance trend views — an honest, disclosed limitation, not a defect.

# V1 Scope

**A. PR Overview** (extend existing panel; honest empty state for the currently-empty ledger).
**B. Movement History** (new UI; scoped to raw movement text, not rep-scheme-specific PRs, until that gap is closed).
**C. Benchmark History** (new UI; Rx/Scaled separated, capped results included).

Ranked: Benchmark History (highest data-readiness, zero caveats) > PR Overview extension (highest member-visible value, but inherits the empty-ledger risk — ship with clear messaging) > Movement History (real value, but must be honestly scoped around the rep-scheme gap).

# Deferred Scope

Training consistency, training volume, estimated 1RM, Aggregate-level PR tracking, rep-scheme-keyed PR detection (real gap — recommend as the first NEXT phase, not V1), gym-tier custom benchmark authoring UI, a composite fitness score (rejected, not merely deferred — see Risks), coach-scheduled Evaluations/testing events, readiness surveys, velocity-based training, cross-gym leaderboards, historical backfill, Gym-transfer PR/history portability policy (genuinely undecided at the Member Domain level — flag to the user as an open product-policy question, do not assume an answer).

# Evolution Plan

V1's narrow scope (UI on existing views, zero new tables) is deliberately chosen so that closing the rep-scheme gap, adding estimated 1RM (with TrainHeroic's tested-vs-estimated state-machine pattern), or adding volume/consistency later are all **additive** changes — none require touching Results' canonical scoring, none require a V1 UI rewrite, matching this mission's own §64 five-year-architecture requirement.

# Risks

| Risk | Severity | Mitigation |
|---|---|---|
| PR Event Ledger is empty in production | **High** — directly undermines the most visible V1 feature | Ship with honest empty-state copy; treat as a known, disclosed limitation, not hidden |
| Movement identity is text-only, alias collisions possible | Medium | Scope Movement History to raw text in V1; do not claim canonical-movement correctness Forge doesn't have |
| Rep-scheme not keyed at detection time | Medium | Explicit V1 labeling (no false 1RM/3RM/5RM PR claims); real gap named for next phase |
| Stale PR Event after Result edit | Medium | Display PR Events as historical, past-tense facts; only "current best" views claim present-tense truth |
| `skill_logs` gets zero Performance Identity coverage | Low (only 10 live rows, legacy-only per Universal Scoring Audit) | Disclose, defer — low real-world impact today |
| Composite fitness score temptation | Low if avoided, High if built without evidence | Explicitly rejected this document, re-litigate only with real evidence of member demand |
| Gym-transfer PR/history portability undecided | Low near-term, High long-term if ignored | Flag as open policy question to the user; do not silently assume an answer in any future implementation |

# Final Decisions A–Z

**A.** Distinct Performance Domain? **DERIVED LAYER ONLY**, inside the existing Results domain — no new peer domain.
**B.** Authoritative truth remains: `wod_logs`/`skill_logs` (canonical Results), `pr_events` (PR history), `performance_identities` (comparison identity resolution) — all already-shipped Results-domain entities.
**C.** PR Events are **authoritative, persisted, append-only** — never derived, never rewritten.
**D.** A comparable Movement Result is identified by `movement` (text today) + `rep_scheme` (not yet keyed — real gap).
**E.** A comparable Benchmark Result is identified by `benchmark_id` + Scaling Context (Rx/Scaled, never pooled).
**F.** Rep schemes are represented by the existing `rep_scheme` column — sufficient as a data model, not yet enforced at detection time.
**G.** Track-only Results **fully participate** — already true structurally, verified.
**H.** Hidden-leaderboard Results **fully participate** — same mechanism as G.
**I.** Rx/variant histories are **always separated**, never pooled, a frozen invariant.
**J.** Capped benchmark Results **appear in history**; PR eligibility inherits Results' own already-audited capped-vs-completed ranking rule, not re-decided here.
**K.** Current bests are **derived**, never separately persisted.
**L.** Trends are **derived** (already 3 layered views) — not newly persisted.
**M.** Movement history **is V1**, scoped honestly around the rep-scheme gap.
**N.** Benchmark history **is V1**, no caveats.
**O.** Training consistency is **NOT V1** — no infrastructure exists.
**P.** Training volume is **NOT V1** — no infrastructure exists.
**Q.** Estimated 1RM is **NOT V1** — deferred, evidence-based future decision, adopt TrainHeroic's tested-vs-estimated pattern if/when built.
**R.** Aggregate history is **NOT V1** — matches Workout Aggregation's own existing deferral.
**S.** Current historical data **partially supports V1** — Benchmark path ready, Movement path honestly-scoped-ready, PR-feed path is real-but-empty (disclose, don't hide).
**T.** V1 requires **no schema changes**.
**U.** Architecture is **fully additive** — confirmed, no rework of any existing frozen/shipped Results-domain work.
**V.** A comparison-identity **abstraction** is not needed as a new entity — the existing 3-case split (Movement/Benchmark/Performance-Identity) is sufficient and should not be collapsed into one generic table.
**W.** **No new table** is required for V1.
**X.** Smallest V1 = **PR Overview (extended) + Movement History + Benchmark History**, built entirely as read-only UI over existing views.
**Y.** Deferred = everything in the Deferred Scope section above.
**Z.** **GO** for V1 UI implementation as scoped — with the explicit, disclosed caveat that the empty PR ledger and the un-keyed rep-scheme gap are known, named risks to be communicated honestly in product copy, not silently hidden or falsely fixed by this document.
