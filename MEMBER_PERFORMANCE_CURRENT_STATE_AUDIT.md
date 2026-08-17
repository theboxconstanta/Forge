# Member Performance — Current-State Audit

**Status: Research only. No code, schema, or production data changed. All queries below are read-only (SELECT/COUNT/aggregate only), run against production via `supabase db query --linked`.**

## Headline Finding

This mission's own "existing infrastructure, do not rebuild" list (§0) does not mention it, but Forge **already has a substantial, live, shipped Member Performance backend** — built as "Results Phase 2," Slices 1 through 5, roughly 2026-08-05 to 08-06, well before this mission was issued. This audit's primary job is therefore not "does Performance infrastructure exist" but **"is it correct, is it firing in production, and what's the smallest gap-closing V1."**

What exists, live, verified today:
- **Benchmark Identity** (Slice 1): `benchmarks`/`benchmark_aliases` tables (224 seeded), `resolve_benchmark_names(text[])` — the one canonical resolver both clients call.
- **PR Event Ledger** (Slice 3): append-only `pr_events` table, two SECURITY DEFINER triggers (`evaluate_benchmark_pr`, `evaluate_movement_prs`), two "current PR" views unioning the ledger with the older `personal_records` table.
- **Performance Identity / Signature V1** (Slice 4): `performance_identities` table generalizing Benchmark Identity to also recognize **repeated custom (non-official) workouts** via a structural/textual signature (`slice4_compute_performance_signature`) — proven on real data (a "PARTNER MARY" and an untitled workout independently resolved to the identical signature). Three layered trend views with explicit trend classification.
- **Analytics Foundation** (Slice 5): 7 Postgres views built on Slices 1-4 with zero new aggregation logic, validated against ground truth (`sum(athlete_performance_summary.total_workouts_completed)` exactly matched `wod_logs`' row count at ship time).
- **UI, already wired, not hypothetical**: `PerformanceOverviewPanel` (WOD-SIMPLE, mounted on the PR tab), `AthletePerformanceOverview` (forge-admin-web, mounted on the athlete results page), `ProgressionNote` (forge-admin-web, inline on result rows), and a gym-wide `PerformanceCommandCenter` (forge-admin-web `/` dashboard route, Dashboard 2.0 Phase 1) — all reading live views, zero client-side computation.

## Current-State Questions (§5), Answered Precisely

1. **What does Forge currently consider a PR?** Three types, per `pr_events.pr_type` CHECK constraint: `movement` and `benchmark` (a `benchmark_id` XOR a `movement` text value, enforced by a CHECK constraint) — no "workout PR" for arbitrary non-benchmark WODs (deliberately not modeled, per Results Domain Architecture).
2. **Where are PRs stored?** Two places, explicitly reconciled: the append-only `pr_events` ledger (the authoritative event history) and the older `personal_records` table (pre-ledger, still live, 223 rows) — both read together via `movement_pr_events_current`/`benchmark_pr_events_current`, "the better value governs."
3. **Are PRs derived or persisted?** Both, deliberately: `pr_events` rows are **persisted, true entities**, written once by a trigger, never rewritten (Results Domain Architecture Invariant #6). "Current PR" is **derived** (a view over the ledger + `personal_records`), never separately stored.
4. **What creates `pr_events`?** Exactly two `AFTER INSERT` SECURITY DEFINER triggers on `wod_logs`/`skill_logs`: `evaluate_benchmark_pr` (wod_logs only) and `evaluate_movement_prs` (both tables).
5. **What Result types can currently create a PR?** Benchmark PRs: **only `For Time` and `AMRAP`** format_snapshot (confirmed directly from live `pg_proc.prosrc` — two branches, `RETURN NEW` otherwise). Movement PRs: any `wod_logs`/`skill_logs` row whose `sets` JSON has at least one row where `reps` and `weight` both match `^\d+(\.\d+)?$`.
6. **Which formats cannot create PRs?** All 20 of the other 22 audited formats cannot create a **Benchmark** PR (Ladder, RFT, Chipper, Tabata, Intervals, EMOM, Death By, Weightlifting, Strength Sets, Build to Heavy/1RM, Complex, Superset, Partner WOD, Buy-In/Cash-Out, AMRAP with Buy-In, Not For Time, Chained AMRAP, Max Effort, Death By Weight, Ascending AMRAP) — though any of them CAN create a **Movement** PR if their logged `sets` rows happen to carry valid numeric reps+weight.
7. **Does PR logic use movement identity?** **No** — it uses the raw movement/text value directly (the `movement` column on `pr_events` is text, not a foreign key to any canonical Movement table), because canonical movement identity is 0% populated in production (see §13 below). This means "Back Squat" and "back squat" and any alias variant would currently be tracked as **separate** PR histories.
8. **Does it use workout identity?** No formal `WorkoutVersion` entity exists in the live schema (confirmed via direct `information_schema` query) — "Workout" identity is mutable in place.
9. **Does it use benchmark identity?** Yes, for the Benchmark PR path — `pr_events.benchmark_id` is a real FK, populated from `resolve_benchmark_names`.
10. **Does it use rep scheme?** **No.** `pr_events.rep_scheme` is a text column that exists in the schema but the live trigger's actual PR-comparison logic (per Slice 3's port of `computeSetsPrCandidates`) does not key comparisons by target rep count — meaning a 1RM and a 3RM on the same movement are not currently guaranteed to be tracked as distinct records at the detection-rule level (this matches the "Scoring Model VNext" paper's own flagged requirement — `(movementId, targetRepMax)` — which was written explicitly because this gap was already known, and remains unresolved in the live-shipped Slice 3/4 work).
11. **Does it understand 1RM vs 3RM vs 5RM?** Partially — the column exists to eventually carry this distinction, but detection-time keying does not yet enforce it.
12. **Does it understand same movement under different loads?** Yes, trivially — every valid `(reps, weight)` pair is a comparison candidate.
13. **Does it distinguish Snatch from Power Snatch?** Only if the raw logged movement TEXT differs (it will, since these are typed as different words), but there is no canonical identity guaranteeing "Snatch" and "snatch" and "Squat Snatch" are correctly unified or correctly kept separate — it is purely a function of what text was typed, which is exactly the movement-alias-collision risk the mission's §13 warns about.
14. **Does it distinguish Clean from Clean & Jerk?** Same answer as #13 — text-dependent, not identity-guaranteed.
15. **Can one Result create multiple movement-level records?** Yes — `evaluate_movement_prs` evaluates every row across every movement key in a log's `sets` JSON.
16. **Can repeated benchmark workouts be recognized as the same benchmark?** Yes, live and correct (Benchmark Identity, Slice 1).
17. **Can a member currently open a movement and see its history?** Only indirectly — `movement_progress_summary`/`movement_progress_gym_summary` (Slice 5) provide the data, but no dedicated "movement detail page" UI exists in either client (confirmed: no such route/screen found beyond the two summary panels).
18. **Can a member currently open a benchmark and see past attempts?** Same answer as #17 — `benchmark_progress_summary` exists, no dedicated benchmark-detail UI screen exists yet.
19. **Is there any trend calculation already present?** Yes, live: `performance_timeline` → `performance_progression_summary` → `performance_identity_gym_summary`, with explicit classification (`rapidly_improving`/`improving`/`stable`/`plateau`/`declining`/`insufficient_data`), scoped to For Time/AMRAP only (same boundary as Benchmark PR detection).
20. **Are results stored with enough historical semantic context to build progress safely?** Mostly yes for the Benchmark/Performance-Identity path (Scoring Snapshot pattern freezes format+config+movements at logging time, survives later Workout edits/deletion) — but **not fully** for Movement-level history, since there is no canonical movement identity to safely group by (see #7/13/14).

## THE Critical Live Finding: The PR Event Ledger Is Empty

Directly verified against production (not from memory, not from the implementation reports' own ship-time snapshots):

| Metric | Value |
|---|---|
| `pr_events` total rows | **0** |
| `wod_logs` total | 349 (65 more than at Slice 3's ship-time count of 284) |
| `personal_records` total | 223 |
| `performance_identities` total | 20 |
| `wod_logs` with `benchmark_id` set | 13, all `logged_at ≤ 2026-07-02` — **predating** the Aug 6 trigger install |
| `wod_logs` with non-empty `sets` logged after Aug 6 | 4, all `format_snapshot='Intervals'` with every `weight:""` |

**Root cause, traced directly**: the ledger's triggers are correctly installed and enabled (`pg_trigger.tgenabled='O'`), and its constraints/RLS are exactly as documented (append-only by construction, zero write policy). But in the ~65 real `wod_logs` rows created since the triggers went live, **not one** has satisfied either detection path: no new For Time/AMRAP-scored log has occurred at all since before the triggers existed, and the only new `sets`-bearing logs are Intervals-format rows with an empty weight string on every row, which fails `evaluate_movement_prs`'s numeric-regex filter. This is **not** a constraint bug (the mission's own §20 speculated "constraint issue" — that framing is not what's actually happening) — it is a real, live gap between what the ledger was designed to catch and what real gym activity has actually produced in 11 days of production logging. A "Recent PRs" feature built on this data today would show **empty**, which is a real product risk this mission's V1 recommendation must account for.

## Movement & Benchmark Identity Quality

- **Movement identity**: confirmed still 0% populated (`Movement.canonicalName`/reps/weight/etc. across all `workout_sections.movements` elements) as of this audit — the exact same finding Slice 4 made on 2026-08-05/06, unchanged 11+ days later. FCKB's ~540-movement research catalog (`docs/fckb/MOVEMENT_CATALOG.md`) exists but is not wired into any live data path. **Movement identity is not sufficient for reliable movement-level Performance history today** — it works only as well as raw-text consistency, which is not guaranteed.
- **Benchmark identity**: sufficient and live — 224 seeded Platform benchmarks, `resolve_benchmark_names` in use by both clients, 5 gym-tier aliases seeded, gym-tier custom benchmarks fully supported at the SQL level but with **no product UI yet** for a gym to create one (a real, disclosed, still-open gap from Slice 1's own report).
- **Performance Identity (Signature V1)**: the honest middle ground — recognizes a repeated *structure* (format + config + normalized movement-line text, order-preserving) without needing canonical movement identity at all. This is why Signature V1 exists: it was explicitly built because canonical movement data wasn't ready, and deliberately isolated behind one function so a future Signature V2 (true canonical-movement-keyed) can replace it without touching callers.

## Result Edit/Delete Effect on PR (§21)

Not independently re-tested live this audit (would require mutating production `wod_logs`, out of this mission's read-only scope) — verified by direct code/schema read instead:
- `pr_events.source_wod_log_id`/`source_skill_log_id` are `ON DELETE SET NULL`, never CASCADE — a PR event **survives** deletion of the Result that created it (by design, Results Domain Architecture Invariant #6: a PR Event, once recorded, is never rewritten).
- There is **no reconciliation trigger** that fires on `UPDATE` or `DELETE` of `wod_logs`/`skill_logs` to recompute or invalidate a `pr_events` row — the ledger only ever grows via `INSERT`. This means: if a member logs 120kg (creating a PR event), then **edits** that same row down to 110kg, the PR event row remains, unchanged, now describing a Result that no longer exists in that form. The "current best" derivation (`movement_pr_events_current`) would need to re-scan and could show a stale/wrong current-best depending on exactly how that view is written — this specific interaction was not verified this audit and is flagged as a real open question for V1 architecture to resolve explicitly, not assume.
- `skill_logs`' own `upsert(...onConflict:'member_id,wod_id,slot')` semantics mean an **edit** to an existing slot never re-fires the PR trigger at all (only the first-ever save per slot is a true INSERT) — a disclosed Slice 3 limitation, confirmed still accurate.

## Historical Data Readiness (§60)

| Concern | Status |
|---|---|
| Movement history | **PARTIALLY READY** — data exists (`sets` JSON on wod_logs/skill_logs), but no canonical movement identity means grouping is text-fragile |
| Rep-max (1/3/5RM) history | **NOT READY** — `rep_scheme` column exists but isn't populated/keyed by detection logic |
| Benchmark history | **READY** — Benchmark Identity is live, correct, verified on real data |
| Workout history (arbitrary repeats) | **READY** — Performance Identity Signature V1 covers this, proven on real production collision data |
| PR timeline / "Recent PRs" | **NOT READY TODAY** — ledger is empty in production (see above); would need either a fix to close the production-firing gap, or an explicit V1 decision to launch with an honestly-empty feature that fills in going forward |
| Training consistency | **NOT READY** — no consistency/frequency computation exists anywhere in Results; Attendance domain is a separate, unjoined system (Results Domain Architecture explicitly has zero FK/join to Attendance) |
| Training volume | **NOT READY** — no volume/tonnage computation exists anywhere |

## Track-Only & Hidden-Leaderboard Compatibility

Verified directly against the Section Leaderboard Visibility implementation: the PR triggers fire on raw `wod_logs`/`skill_logs` INSERT, with **zero dependency** on `workout_sections.leaderboard_visible`, `logging_mode`, Section rendering, or any leaderboard-grouping concept. A Track-only or hidden-leaderboard Result is exactly as PR/Performance-Identity-eligible as a fully-visible one — this invariant already holds structurally today, confirmed by reading the trigger source (it only ever reads the inserted row + a `workout_sections`/`wods` lookup for format/config, never `leaderboard_visible`).

## Workout Aggregates

Confirmed: `workouts.aggregate_definition` combines are **always derived at read time, never persisted as a Result row** — there is no `wod_logs`/`skill_logs` row corresponding to an Aggregate Total, so the existing PR/Performance-Identity triggers structurally cannot and do not fire on Aggregate values. Aggregate-level PR tracking is explicitly named as deferred, not-started future work in the Workout Aggregation architecture itself (§41) — this audit found no evidence that decision has been revisited since.

## Queryability (§40)

The 7 Slice 5 views already answer most of the mission's example queries directly or with a trivial `WHERE member_id=... AND movement=...` filter: total workouts, PRs, benchmark bests, movement bests, recent activity. Two example queries are **not** efficiently answerable today without new work: "all 5RM Back Squat Results" (no rep-scheme keying, see above) and "sessions per week" (no consistency computation, needs Attendance join). No index-level gaps were found in the views inspected — this is a logic/data-model gap, not a performance-tuning gap.

## Production Read-Only Audit — Full Numbers

All counts are aggregate-only, zero PII, gathered via `supabase db query --linked` SELECT/COUNT statements:

| Table/View | Count |
|---|---|
| `wod_logs` | 349 |
| `skill_logs` | 10 |
| `pr_events` | 0 |
| `personal_records` | 223 |
| `performance_identities` | 20 |
| `benchmarks` | 224 |
| `benchmark_aliases` | 5 |
| `wod_logs` with `performance_identity_id` set | 59 |
| `skill_logs` with `performance_identity_id` set | 0 |
| `wod_logs` with `benchmark_id` set | 13 |

`skill_logs` never populating `performance_identity_id` is a real, if narrow, gap — legacy Skill/Skill2-slot logs (still 10 rows, still live per the Universal Scoring Audit's own Result Source Matrix) get zero Performance Identity coverage.

## Gaps & Risks Summary

1. **P0-equivalent product risk**: PR Event Ledger empty in live production — a "Recent PRs" V1 feature would launch visibly broken/empty unless this is explicitly addressed (either a data-shape/trigger-scope fix, which is implementation work out of this mission's scope, or a deliberate "starts empty, fills going forward" product decision, explicitly communicated).
2. Movement identity is 0% populated — movement-level history/PRs are text-fragile, not identity-safe, today.
3. Rep-scheme (1RM vs 3RM vs 5RM) is not keyed at detection time — a real correctness gap relative to what the (unapproved) Scoring Model VNext paper already flagged as necessary.
4. No reconciliation on Result edit/delete for already-recorded PR events — stale-ledger risk not yet resolved.
5. Benchmark-PR detection is scoped to 2 of 22 formats (For Time/AMRAP) — most workout types cannot produce a Benchmark PR at all today.
6. No backfill anywhere in the chain (deliberate, disclosed, consistently — not a new finding, but relevant to V1 scope: a member with 6 months of pre-Aug-6 history would see none of it in Performance).
7. `skill_logs` gets zero Performance Identity coverage.
8. No dedicated movement-detail or benchmark-detail UI screen exists in either client, despite the underlying views being ready.
9. Gym-tier custom benchmark creation has no UI (SQL-level support only).
10. Open, unresolved **policy** question inherited from Member Domain Architecture: does workout history/PRs move with a Member across a Gym transfer? Not decided.
