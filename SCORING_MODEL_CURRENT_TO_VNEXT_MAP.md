# Forge — Scoring Model: Current-to-VNext Map

**Status:** Analysis only. No code, schema, or migration created.

Two distinct "current states" exist in this codebase and must not be conflated — every row below maps VNext against **both**:
- **LIVE** — what actually runs in production today (`wod_logs`, `workoutFormats.js`, `rxEngine.js`, `App.jsx`, `ranking.ts`), verified directly against code and a live database query this session.
- **PAPER** — the unfrozen, never-implemented `RESULTS_DOMAIN_ARCHITECTURE.md` v1.0 / `RESULTS_DOMAIN_V1_1.md` / `PROGRAMMING_DOMAIN_V1_2.md` / `SEGMENT_MODEL_SPEC_v1.md` / `RX_ENGINE_SPEC.md` stack.

**Classification** (per the mission's own required categories, applied against LIVE, since that's what an implementer would actually touch first): `ALREADY EXISTS` / `SEMANTICALLY EXISTS BUT UNNAMED` / `SMALL ADDITIVE EXTENSION` / `REQUIRES MIGRATION` / `REQUIRES STRUCTURAL CHANGE` / `NOT NEEDED`.

---

## Core entities

| VNext concept | LIVE state | PAPER state | Classification (vs LIVE) | Layers touched |
|---|---|---|---|---|
| **Workout / Section** | `wods` table + `format_config` JSON; no separate Section entity — one row per Workout, format applies to the whole row | Workout → WorkoutVersion → Section(s), fully specified, unbuilt | REQUIRES STRUCTURAL CHANGE (vs LIVE) / ALREADY EXISTS (vs PAPER) | DB, domain, both clients' builders |
| **Multiple scored Sections per Workout (R1a)** | Not representable — `wods` is one format per row | Named as PROGRAMMING_DOMAIN_V1_2.md §13's own still-open question; this document resolves it "yes, allow N" | REQUIRES STRUCTURAL CHANGE | DB (new table or relaxed cardinality), domain, both builders, AI parser (must recognize Part A/B structure — FCKB §11.1 already flags this exact gap) |
| **Result scoped to Section, not bare Workout (R1b)** | `wod_logs.wod_id` references a Workout row directly, 1:1 with the day's single format | Result references `(workout_version_id, section_id)`, unbuilt | REQUIRES STRUCTURAL CHANGE | DB (`wod_logs` needs a `section_id` or equivalent), domain, ranking.ts/sortLogs (partition key changes from wod_id to wod_id+section) |
| **Result Attempt** | Informal: `sets` jsonb field on `wod_logs` (family `'sets'` only), no structured entity for `'scored'` family | True entity, `RESULTS_DOMAIN_ARCHITECTURE.md` §4.1, unbuilt | SEMANTICALLY EXISTS BUT UNNAMED (for `sets` family) / REQUIRES STRUCTURAL CHANGE (for `scored`/`mixed`/`chained` families, which have no attempt-level structure today) | DB, domain |
| **ScoringSnapshot** | None — `wod_logs` has no frozen-interpretation-context field at all; a Workout edit today can retroactively change how old logs display (a live, disclosed risk, not this document's finding — already named in `RESULTS_DOMAIN_ARCHITECTURE.md` §5.2 as the central defect that document exists to fix) | True entity, fully specified, unbuilt | REQUIRES STRUCTURAL CHANGE | DB, domain |
| **ValidationRecord / classifiedTier** | `rxEngine.js`'s `classifyRxStatus` returns `'rx' \| 'not_rx' \| null` — a boolean-shaped result, single Load dimension only, computed at read time, never persisted | Full structured `ValidationRecord` (multi-dimension: movement/load/reps/equipment/order/time-cap), `RX_ENGINE_SPEC.md`, unbuilt | SMALL ADDITIVE EXTENSION for the Load dimension (already correct, per this session's competitive research finding — `SCORING_COMPETITIVE_LANDSCAPE.md` §11) / REQUIRES STRUCTURAL CHANGE for the other five dimensions | Domain (both PWA `rxEngine.js` and forge-admin-web `rxEngine.ts` — already a diff-verified port pair, per project memory) |

## VNext-specific additions (this document's own proposals)

| VNext concept | LIVE state | PAPER state | Classification (vs LIVE) | Layers touched |
|---|---|---|---|---|
| **`completionState` explicit field (§11)** | 100% implicit — `finished(log) = !!log.time_result`, the exact anti-pattern this session's own production bug lived inside (`LEADERBOARD_FINISH_TIME_INVESTIGATION.md`) | Implicit as a *rule* (Time Cap Declaration's `cappedScoringRule`), not yet a persisted field — same gap, smaller because the rule itself is at least named on paper | SMALL ADDITIVE EXTENSION vs LIVE (a new, computed, backfillable column) / SMALL ADDITIVE EXTENSION vs PAPER (fills an already-open slot) | DB (new column), domain (write-path — directly builds on this session's own `composeFortimeOrAmrapFields` fix), leaderboard (badge/label rendering), tests |
| **`Interval.aggregation: 'list'`** | N/A — Forge's `sets` family already supports per-row display (`SetsRows` component shows each set), so the *UI capability* partially exists; the *Score Model concept* of a declared, named aggregation mode does not | Interval primitive already has a declared-aggregation slot (`RESULTS_DOMAIN_ARCHITECTURE.md` §6.2), just missing this one enum value | SEMANTICALLY EXISTS BUT UNNAMED (vs LIVE, at the UI level only) / SMALL ADDITIVE EXTENSION (vs PAPER) | Domain, both clients' Log Score UI |
| **`ResultAttempt.outcome: SUCCESS \| FAIL`** | None — no attempt-level success/fail concept anywhere in `wod_logs`/`skill_logs`/`personal_records` | None — Result Attempt exists but has no outcome field either | REQUIRES STRUCTURAL CHANGE (net-new field on a net-new entity) | DB, domain, both clients (a new, narrow attempt-logging UI, gated behind `attemptTracking`) |
| **`attemptTracking` Score Model flag** | None | None | NOT NEEDED until Phase 4 (§30 of VNext doc) — no current demand signal, per this session's own competitive research finding that zero researched competitors have solved this either | Domain only, if/when built |

## Already-correct, confirmed strengths (no change needed)

| VNext concept | LIVE state | Classification | Notes |
|---|---|---|---|
| **Canonical unit storage + display conversion** | `toKgForRanking`, member `weight_unit` preference, already live and correct | ALREADY EXISTS | Confirmed this session as a genuine, competitively-unique Forge strength (`SCORING_COMPETITIVE_LANDSCAPE.md` §9) |
| **Direction derived from primitive type, not persisted** | Implicit in `workoutFormats.js`'s per-format comparator logic (`ranking.ts`/`sortLogs`) — never a stored "higher/lower is better" flag | ALREADY EXISTS | Matches VNext §15's own requirement exactly, no work needed |
| **Prescription variant vs. result validity, two independent signals** | `variant_level` (declared) vs. `rxEngine.js`'s `classifyRxStatus` output (computed) — already two separate fields on `wod_logs`, live in production (Results Phase 3, shipped 2026-08-07) | ALREADY EXISTS | Confirmed uniquely strong vs. every competitor researched (`SCORING_COMPETITIVE_LANDSCAPE.md` §11) |
| **Tie-break** | None — `sortLogs`/`ranking.ts` break ties by `logged_at` only, an operational, non-performance tiebreak | REQUIRES STRUCTURAL CHANGE (vs LIVE) / SEMANTICALLY EXISTS BUT UNNAMED... no — genuinely absent (vs PAPER, Tie-Break Key is specified but unbuilt) | Domain, both clients' Log Score UI + leaderboard comparator |
| **Multi-score / multi-part workouts** | `mixed` family (Buy-In/Cash-Out) captures multiple stages but collapses to ONE ranked score; `chained` family (Chained AMRAP) same. Confirmed this session as tied-with-btwb, worst-researched capability (`SCORING_COMPETITIVE_LANDSCAPE.md` §8) | REQUIRES STRUCTURAL CHANGE | The headline gap this whole document exists to close (§9 of VNext doc) |
| **PR keying by `(movementId, targetRepMax)`** | `personal_records` table keys by `movement` (text) + implicit unit; no explicit rep-max dimension distinguishing a 1RM from a 3RM for the same movement | SMALL ADDITIVE EXTENSION | Found via adversarial workout #19, not previously named as a live gap |

## Test coverage implications

| Area | LIVE coverage | What VNext Phase 0–1 would need |
|---|---|---|
| Write-path precedence (time vs. rounds) | 15 new unit tests + 4 component tests, shipped this session (`workoutFormats.test.js`, `FormatLogger.test.jsx`) | Extend the same suite to assert `completionState` derivation, once Phase 0 lands — the test *pattern* already exists and is proven, per this session's own fix |
| Multi-Section ranking | None (no multi-Section concept exists) | New: two-Section Workout, two independent Results, two independent leaderboard partitions, no cross-contamination — a genuinely new test surface, not an extension of an existing one |
| Rx classification (Load dimension) | `rxEngine.test.js` (PWA) + `rxEngine.test.ts` (Admin), both real, both passing, diff-verified port pair per project memory | No change needed at Phase 0–1; only relevant if/when the other five ValidationRecord dimensions are built (out of this document's scope) |
| Cross-Section aggregate (Total, combined sum) | N/A | New: a pure Leaderboard-layer derivation test, no write-path test needed (per I-19, never persisted) |

---

**Summary for the implementer, at a glance:** Phase 0 (`completionState`) is the only VNext capability classified `SMALL ADDITIVE EXTENSION` against live code — everything else in Phase 1+ is `REQUIRES STRUCTURAL CHANGE`, honestly, because the live `wod_logs` schema was never designed for more than one score per Workout. This is not a surprise finding — it is the exact reason `RESULTS_DOMAIN_ARCHITECTURE.md` was proposed for freeze in the first place, and this document changes nothing about that document's own migration strategy (`RESULTS_DOMAIN_ARCHITECTURE.md` §14) beyond adding §9's multi-Section refinement as one more thing that migration would need to carry.
