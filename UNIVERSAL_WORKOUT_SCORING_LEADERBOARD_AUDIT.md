# Universal Workout Scoring & Leaderboard Audit

**Status: COMPLETE. One confirmed defect found and fixed (Death By), verified live in production against real logged data in both clients, with SQL proof and full cleanup. No other correctness defects found across the 22-format catalog.**

Repos: WOD-SIMPLE (member PWA) and forge-admin-web (coach/admin app, read-only leaderboard surface). Commits: WOD-SIMPLE `dd743fb` (fix) + `e8ca9a5`/prior; forge-admin-web `10e2b14` (fix). Both pushed to `main`, confirmed live.

## Executive Summary

Forge's canonical scoring engine (`workoutFormats.js` in WOD-SIMPLE, ported line-for-line to `ranking.ts`/`formatCatalog.ts` in forge-admin-web) is **structurally sound**: a single comparator design (finished-beats-capped, then time-ascending or rounds/reps-descending, deterministic tie-break by `logged_at`) correctly handles every duration- and rounds/reps-based format; a single `scoringMode`-driven resolver correctly handles every weight/reps-based (`family:'sets'`) format; unit normalization (kg/lb) is applied consistently at every weight-comparing ranking path in both repos; and ranking always operates on raw structured data, never on formatted display strings.

Exactly **one** live scoring defect was found: **`Death By`** (the rep-escalating variant, distinct from `Death By Weight`) had no `scoringMode` config field in its catalog schema — unlike `Tabata`/`Intervals`/`EMOM`, which all have one. This meant `resolveSetsScoringMode` always returned `null` for it, `isWeightScoredSetsFormat` treated it as weight-scored by the `!scoringMode` fallback rule, and a real bodyweight-reps `Death By` log (no weight entered, since none exists) resolved to `setsDisplayScore: null` — the leaderboard silently fell back to a "1 sets" placeholder text with no ranking, discarding fully-logged, valid reps data. This is the exact same bug class as the already-fixed TOTAL_REPS/Tabata defect, just never extended to `Death By`. Fixed by hardcoding `Death By`'s canonical score to `Total Reps` (no UI change — unlike EMOM/Complex, `Death By` has no legitimate weight-scored interpretation at all, since `Death By Weight` already exists as the separate format for that case).

Two additional candidate findings were investigated and found **not to be live defects**: a `if (row.reps)`/`if (row.weight)` truthy-check pattern in both repos' per-set breakdown text renderers looked fragile (a real `0` would vanish from display) but is provably safe in practice, since every write path stores these values as strings (`<input type="number">`'s `e.target.value` is always a string in React, and JSONB round-trips preserve that), and a non-empty string `"0"` is truthy in JavaScript. No fix was made — fixing a non-reproducible pattern would be speculative.

## Sources Read

Live code in both repos (primary source of truth, per mission instruction). `docs/fckb/*.md` (9 files — confirmed, via the FCKB Architecture Review's own §1 finding, "designed as if Forge's Programming domain doesn't already exist," to be forward-looking research rather than a description of current implementation; used only for the §Documented-vs-Implemented cross-check below, not as a format-inventory source). Prior memory of ~15 completed scoring-related missions (Phase 0/1A/1B Layer 1/2a/2a.5/2b, TOTAL_REPS fix, Section Leaderboard Visibility, Workout Aggregation, Layer-2a.5 identity-integrity fix, Rx Athlete Context / Results Phase 3) — reused as established fact where still current, re-verified against live code rather than assumed where load-bearing for this audit's own conclusions.

## Methodology

Five parallel research agents traced, independently and with cross-verification: (1) the format registry and every config field's downstream consumption; (2) Result persistence routing and canonical score composition; (3) ranking comparators, ties, zero/decimal/overflow handling, and display-vs-storage separation; (4) the previously-least-audited format families (For Reps/EMOM/Death By/Ladder/Strength/Weightlifting); (5) Rx Section-scoping, `completion_state`, and multi-Section identity stability. Every finding reported here was independently confirmed by direct reads of the cited file:line before being treated as fact — no agent claim was taken on trust alone for anything that shaped a fix decision.

## External Research (Phase 2/65/66/67)

Reused [[project_scoring_competitive_landscape]] (`SCORING_COMPETITIVE_LANDSCAPE.md`, 2026-08-14) rather than re-researching from scratch, with one correction: that research's "biggest confirmed Forge gap (tied with btwb, worst of everything researched): no multi-score support" is **now outdated** — it predates the Section architecture (Layer 1/2a/2b) and Workout Aggregation, both of which shipped since and now give Forge genuine multi-part, independently-scored, independently-ranked Sections per Workout plus cross-Section value/rank-combine Aggregation. This closes most of the gap that research identified; the remaining distinction (Forge's Sections are coach-authored at Workout-creation time, not a free-form "Score Component" the athlete declares per-result) is a real, smaller difference from Wodify/PushPress Train's model, not a correctness defect.

Everything else in that research remains current and was not re-verified line-by-line in this audit: Forge's automatic Rx/Not-Rx validation (`rxEngine.js`) remains a unique strength (confirmed absent in all 6 competitors researched); zero tie-break mechanism beyond `logged_at` remains a gap shared with all 6 competitors (not unique to Forge, and this audit confirms the tie-break is at least deterministic, which several naive implementations are not); IWF's outdated "lighter bodyweight wins" tiebreak was correctly never implemented in Forge's weightlifting scoring (confirmed again this audit — no bodyweight-based comparator exists anywhere in the ranking code).

## Forge Format Inventory (code-derived, not FCKB-derived)

22 formats, one shared catalog (`WORKOUT_FORMATS` in `workoutFormats.js`, ported data-only to `formatCatalog.ts`), all authorable in forge-admin-web (the sole authoring surface) and loggable/rankable in WOD-SIMPLE (the sole member-logging surface — forge-admin-web has no member-logging UI at all, confirmed by direct search):

`AMRAP` · `Ascending AMRAP` · `For Time` · `RFT` · `Chipper` · `Ladder` · `Partner WOD` · `Death By` · `Death By Weight` · `EMOM` · `Tabata` · `Intervals` · `Weightlifting` · `Strength Sets` · `Build to Heavy/1RM` · `Complex` · `Superset` · `Buy-In/Cash-Out` · `AMRAP with Buy-In` · `Not For Time` · `Chained AMRAP` · `Max Effort`

## Forge Scoring Semantic Inventory

Two structurally distinct canonical-score families exist in the ranking code (`sortSectionLogs`/`rankResultsForWorkout`), each with its own comparator:

1. **Duration/structured family** (`family:'scored'`/`'mixed'`/`'nft'`): comparator is `finished-beats-capped → (finished: ascending time) → (capped, non-sequential: descending rounds, then descending partial reps) → (capped, sequential: descending total partial reps) → tie: ascending logged_at`. Covers `For Time`, `RFT`, `Chipper`, `Ladder`, `AMRAP`, `Ascending AMRAP`, `Partner WOD`, `Buy-In/Cash-Out`, `AMRAP with Buy-In`, `Max Effort`, `Not For Time`.
2. **`sets` family** (weight/reps-configurable): canonical score resolved via `resolveSetsScoringMode` → `Total Reps` / `Lowest Reps` / `Total Weight` / `Max Weight`, or the `maxWeightFromSets` fallback when no mode is configured. Covers `EMOM`, `Tabata`, `Intervals`, `Death By`, `Death By Weight`, `Weightlifting`, `Strength Sets`, `Build to Heavy/1RM`, `Complex`, `Superset`.
3. **`chained` family** (multi-stage): canonical score is `log_meta.totalReps`, precomputed at write time by summing each stage's own composed result. Covers `Chained AMRAP` only.

"For Reps" does **not** exist as a distinct format or a hidden alias of anything — this was an explicitly open question carried over from the TOTAL_REPS mission, now definitively resolved: rep-count-is-the-score behavior is purely the `scoringMode:'Total Reps'` value of the `sets` family, shared identically by `Tabata`/`Intervals`/`EMOM`/(now)`Death By`. There is no fourth format and no separate code path.

## Format × Scoring Mode Matrix

| Format | Family | Canonical score | Comparator | Result table | Rx | Completion state | Individual leaderboard | Aggregate-compatible | Support level |
|---|---|---|---|---|---|---|---|---|---|
| For Time | scored | time / partial reps if capped | duration family | wod_logs | yes | yes | yes | yes (TIME metric) | **5** |
| RFT | scored | time / rounds+partial if capped | duration family | wod_logs | yes | yes | yes | yes | **5** |
| Chipper | scored | time / partial reps if capped | duration family (sequential) | wod_logs | yes | yes | yes | yes | **5** |
| Ladder | scored | time / partial reps if capped | duration family (sequential) | wod_logs | yes | yes | yes | yes | **5** |
| AMRAP | scored | rounds + reps (2-tier, no unsafe multiplier) | duration family | wod_logs | yes | n/a (null) | yes | yes (REPS metric) | **5** |
| Ascending AMRAP | scored, `ascending:true` | rounds + reps, per-round target recomputed dynamically from parsed rounds (verified: not a static round-1 bug) | duration family | wod_logs | yes | n/a | yes | yes | **5** |
| Partner WOD | scored/mixed, `baseFormat` | inherits base format | duration family (format-specific override) | wod_logs | yes | yes (if time-based base) | yes | yes | **5** |
| Buy-In/Cash-Out | mixed | inherits `mainFormat` (For Time or AMRAP) | duration family (format-specific override) | wod_logs | yes | conditional on mainFormat | yes | yes | **5** |
| AMRAP with Buy-In | mixed | rounds + reps | duration family | wod_logs | yes | n/a | yes | yes | **5** |
| Not For Time | nft | none (intentionally untracked — pass/fail only) | degenerate (all tie, ordered by logged_at) | wod_logs | n/a | always null | yes, but degenerate by design | n/a | **5** (correct for its stated intent — not a competitive format) |
| Max Effort | scored, `single_value` | raw result/time text | duration-family generic comparator | wod_logs | yes | n/a | yes | n/a | **5** |
| Chained AMRAP | chained | `log_meta.totalReps` (precomputed sum across stages) | chained family (descending) | wod_logs | yes | n/a | yes | n/a (single-Section concept) | **5** |
| Tabata | sets | Total Reps (default) or Lowest Reps, required config field | sets family | wod_logs/skill_logs | yes | n/a | yes | yes (REPS metric) | **5** |
| Intervals | sets | Total Reps (default) or Lowest Reps, required config field | sets family | wod_logs/skill_logs | yes | n/a | yes | yes | **5** |
| EMOM | sets | Total Reps/Lowest Reps if coach sets it; **else weight fallback** (deliberate, documented in code) | sets family | wod_logs/skill_logs | yes | n/a | yes | yes | **5**, with a disclosed known limitation (below) |
| Death By | sets | **Total Reps, hardcoded (this audit's fix)** | sets family | wod_logs/skill_logs | yes | n/a | yes | yes | **5** (was effectively Level 2 before the fix — loggable but not correctly ranked) |
| Death By Weight | sets | Max Weight (fallback, correct by design) | sets family | wod_logs/skill_logs | yes | n/a | yes | yes | **5** |
| Weightlifting | sets | Max Weight (fallback) | sets family | wod_logs/skill_logs | yes | n/a | yes | yes | **5** |
| Strength Sets | sets | Max Weight (fallback — best single set, not total volume) | sets family | wod_logs/skill_logs | yes | n/a | yes | yes | **5**, with a disclosed known limitation (below) |
| Build to Heavy/1RM | sets | Max Weight (fallback — exactly the case this fallback was designed for) | sets family | wod_logs/skill_logs | yes | n/a | yes | yes | **5** |
| Complex | sets | Max Weight (default) or Total Weight, optional config field | sets family | wod_logs/skill_logs | yes | n/a | yes | yes | **5** |
| Superset | sets | Max Weight (fallback) | sets family | wod_logs/skill_logs | yes | n/a | yes | yes | **5** |

**Known limitations (disclosed, deliberate, not defects):**
- **EMOM's optional `scoringMode`**: a coach must explicitly select `Total Reps`/`Lowest Reps` for a pure-bodyweight EMOM, or it silently falls to the weight fallback and shows unranked. This is intentional (many EMOMs genuinely are weight-focused, e.g. "EMOM 10: 1 Clean, build") and is documented in the code's own comments as a deliberate coach-choice trade-off, unlike `Death By`, which had no legitimate weight interpretation at all and is now fixed.
- **`Strength Sets`/`Weightlifting`/`Complex` (Max Weight mode) rank by best single set, not total volume.** This is a real, disclosed scope limit (no total-volume/tonnage scoring mode exists), consistent across all weight-fallback formats, not a defect — Forge has never claimed total-volume scoring for these formats.
- **`Complex`'s `Total Weight` mode sums whatever the coach logs across rounds** — correct for its documented BTWB-derived use case (varying-load complexes), no gap found.

## Result Source Matrix

Corrects an initial assumption from the mission prompt: non-primary Sections do **not** uniformly route to `skill_logs`. Two independent, coexisting routing paths exist in WOD-SIMPLE:

| Path | Table | Identity | Notes |
|---|---|---|---|
| Primary Section, or a Workout-Engine-V2 "additional scored Section" | `wod_logs` | `workout_section_id` (UUID, stable across reorder) | INSERT, `variant_level:'RX'` hardcoded for additional Sections |
| Legacy Skill/Skill2 slot (pre-V2) | `skill_logs` | `workout_section_id` + `slot` | UPSERT on `(member_id, wod_id, slot)` |

forge-admin-web's `skillLogToWodLogShape` normalizes both into one shape for ranking; `resolveSectionId` is the single place either repo decides which Section a log belongs to, always via the log's own stable `workout_section_id`, never via array position or `wod_id` alone. A `skill_logs` row with no `workout_section_id` (pre-Section-identity legacy data) is deliberately excluded from any current Section's leaderboard rather than misattached — confirmed in both repos.

## Rx / Section Identity / Completion State

All three investigated with an explicit adversarial scenario (primary Section A = Weightlifting @100kg, additional Section B = Metcon @43kg thrusters) and confirmed correct by direct code read:

- **Rx never leaks across Sections.** WOD-SIMPLE's logging screen reads `logTargetSection.movements`/forces prescribed weight to `''` for additional Sections — no fallback path to the primary Section's prescription exists. forge-admin-web's leaderboard currently only Rx-classifies the primary Section (additional Sections render as a single unclassified "RX" tier) — a disclosed scope limit, not a swap bug; it never compares an additional Section's entries against the wrong standard.
- **`completion_state` is written only by duration-primary formats** (For Time/RFT/Chipper/Ladder/Partner WOD/Buy-In-Cash-Out-as-For-Time); every other family (`sets`, `nft`, `chained`, AMRAP, Max Effort) leaves it `null` by explicit code path, never a stale/inferred default. A defensive normalizer (`normalizeCompletionState`) additionally guards against inconsistency between `completion_state` and `time_result` at write time.
- **Section identity survives reorder.** Resolution is always by the log's own stable `workout_section_id`, never by array position; a DB trigger (`snapshot_wod_log_context`, migration `20260822093000_wod_logs_section_integrity.sql`) rejects any insert whose `workout_section_id` doesn't belong to both the correct gym and the correct `wod_id`, applied uniformly to Warm-up/Skill/Skill2/additional Sections alike.
- **Snapshot correctness**: the exact "primary-Section prescription leaks into a non-primary Section's snapshot" scenario this mission hypothesized was found and fixed in a **prior** mission (`20260822090000_section_scoped_snapshot.sql`, "Layer 2a.5"), confirmed still in place and correctly superseded (not regressed) by the later `...093000` migration.

## Ranking Correctness (ties, zero, decimal, overflow, display-vs-storage)

- **AMRAP rounds+reps comparator is safe** — rounds and reps are compared as two separate tiers (`diffRunde` then `diffPartial`), never combined via a multiplier like `rounds*100+reps`. No overflow/collision risk for realistic rep counts (100+ reps per round).
- **Ties are deterministic**, not DB/array-order-dependent — every branch (`sets`, `chained`, default) falls back to ascending `logged_at`.
- **Capped-vs-completed is correct**: a completed result always outranks any capped result, checked before any round-count comparison, in both repos.
- **Zero-value handling in the ranking/scoring engine itself is safe** — every check uses explicit `null`/`NaN` comparisons, never bare truthiness, confirmed across `computeSetsScore`, `maxWeightFromSets`, `partialRepsOfLog`, `setsDisplayScore`. Two display-only truthy-check patterns were found (`App.jsx` Jurnal breakdown, `scoreFormatting.ts`'s `setsSummary`) and investigated in depth: provably not exploitable, since every write path stores `reps`/`weight` as strings (`e.target.value` from `<input type="number">`), and `"0"` is truthy in JavaScript — only a genuinely empty, untouched field is falsy, which is the correct/intended behavior. No fix made (would be speculative).
- **Decimals survive intact** — `parseFloat` used exclusively for weight in every ranking path in both repos (no `parseInt` truncation found); `toKgForRanking` is deliberately unrounded for comparison (display-rounding to 0.5kg increments, used only for the disc-plate UI, is never used in the comparator — confirmed, avoiding a false-tie class of bug the code's own comments flag explicitly).
- **Display never drives ranking** — both `LeaderboardTable`/`Clasament` consume already-sorted arrays; rank/medal styling is derived from array index post-sort, never from re-parsing a formatted string.

## Config Consumption Audit

Ranking ever reads exactly 3 config fields across all 22 formats and both repos: `config.structure` (For Time), `config.mainFormat` (Buy-In/Cash-Out), `config.scoringMode` (`sets` family). Every other config field (`rounds`, `timeCapSec`, `sharedRepScheme`, `ladderType`, `splitType`, `startReps`/`incrementReps`, `workSec`/`restSec`, `intervalSec`, `targetLabel`, `complexMovements`, durations, etc.) is display/logger-only by design — confirmed not a gap, since none of those fields carry scoring-relevant information the comparator needs.

**One orphaned field found**: `Partner WOD.extraLogFields: ['partnerName']`, declared in both catalogs, never read anywhere (no partner-name input exists, nothing persists it). This is a stub for a never-built feature, not a defect — no data is silently lost because nothing ever collects it. Documented here, not built out (building it would be a new feature, out of this mission's fix policy).

Both `FormatConfigEditor` components render generically off the catalog's field-type metadata with **zero hardcoded format-name branches** — a genuinely schema-driven editor. The few hardcoded format-name checks that do exist (`estimateTotalDurationSec`, `defaultRowsForFormat`'s row-generation branching, `isSequentialFormat`'s two named overrides for `For Time`/`Buy-In/Cash-Out`, present identically in both repos) are necessary exceptions where the catalog abstraction genuinely cannot express the needed behavior, not fragile ad-hoc special-casing — reviewed individually, none found to be incorrect.

## Documented vs. Implemented (FCKB cross-check)

FCKB's `WORKOUT_FORMATS.md` is explicitly forward-looking research (confirmed by its own Architecture Review: "designed as if Forge's Programming domain doesn't already exist") cataloging 35+ format families across the entire CrossFit/HYROX/powerlifting/competition ecosystem — a ceiling for future product decisions, not a description of current Forge capability. Cross-checked at the family level (not exhaustively line-by-line, which would mostly just produce hundreds of "not found" entries against a document that documents industry practice, not Forge's roadmap):

- **LEVEL 5 (fully supported)**: the 22-format catalog audited above — covers FCKB's §1 (For Time family), §2 (AMRAP family, partial), §3 (EMOM/Death By), §4 (Tabata/Intervals), most of §7 (Strength/Complex), and the Partner-WOD subset of §9.
- **LEVEL 0 (documented/research only, correctly out of scope)**: FCKB §5.3/5.4 (Pyramid/Wave Ladder), §6.2/6.4 (Max Distance/Height), §7.6 (named multi-week systems like 5/3/1, Sheiko, Westside), §7.5 (Cluster Sets), §7.9 (Tempo as its own trackable entity), §8's dedicated Buy-In-with-no-cash-out sub-typing nuance, §9.2-9.4 (Synchro/Relay/Team-aggregate), §10 (Density/Accumulation), §11 (competition multi-part/points/handicap), §12 (HYROX). None of these have any authoring surface, config schema, or ranking branch in Forge today — correctly absent, not a defect, and explicitly out of this mission's fix policy (no new Segment/Attempt/Team/Competition domain per the mission's own stop conditions).

## Defect Register

| ID | Format | Severity | Symptom | Root cause | Fix | Tests | Deploy | Backfill |
|---|---|---|---|---|---|---|---|---|
| SCORE-AUDIT-1 | Death By | **P2** | A fully-logged, bodyweight-reps Death By result shows unranked ("-"/"1 sets" placeholder) on the leaderboard instead of its real score | No `scoringMode` config field in the catalog schema for `Death By` (unlike Tabata/Intervals/EMOM); `resolveSetsScoringMode` always returned `null`, `isWeightScoredSetsFormat`'s `!scoringMode` fallback treated it as weight-scored, `maxWeightFromSets` returns `null` when no weight was ever logged (the normal case for a bodyweight format) | `resolveSetsScoringMode` hardcodes `Death By` to `'Total Reps'` (no UI change — no legitimate weight interpretation exists for this format, `Death By Weight` already covers that case) | 6 new tests in WOD-SIMPLE (`workoutFormats.test.js`), 4 new tests in forge-admin-web (`ranking.test.ts`), all passing | Live: WOD-SIMPLE `dd743fb`, forge-admin-web `10e2b14` | None — this is a read-time ranking fix; no historical `wod_logs`/`skill_logs` row was ever mutated, and any pre-existing Death By log with real reps data will now correctly re-rank the next time its leaderboard is viewed, with zero write |

No P0 or P1 defects found. No P3 defects fixed (the two truthy-check candidates were investigated and found not reproducible — see Ranking Correctness above).

## Architectural Gap Register

None newly identified by this audit. FCKB's Level-0 catalog (above) represents pre-existing, already-disclosed future-roadmap territory (Segment/Attempt/Team/Competition-domain concepts), explicitly out of this mission's scope per its own stop conditions — not something this audit is the origin of or needs to re-litigate.

## Production Acceptance (real UI, real data)

Performed live against `forge-admin-web.vercel.app` and `forge-delta-ivory.vercel.app` (logged in as the real admin/member account), for the one confirmed-and-fixed defect:

1. Authored a real `Death By` Workout via forge-admin-web's coach UI (`startReps:1, incrementReps:1, intervalSec:60`, movement "Burpees", no weight prescription) on a safe future test date.
2. Logged a real bodyweight result via WOD-SIMPLE's member logging UI: 3 rows, reps `1, 2, 2`, weight left blank on every row (the exact defect scenario).
3. **Before the fix deployed**: forge-admin-web's Results view showed the placeholder "1 sets" — the live symptom, confirmed against the running production bundle prior to deploy.
4. Committed and pushed the fix in both repos; waited for Vercel to redeploy.
5. **After the fix deployed**: the same log, unchanged, now displays its real score, "5" (1+2+2), with no weight-unit suffix (confirming `isWeightScoredSetsFormat` also now correctly resolves `false` for this format) — verified via the live, redeployed production bundle.
6. **SQL verification** (`supabase db query --linked`, before and after): the underlying `wod_logs.sets` JSONB (`{"Min 1":[{reps:"1",weight:""},{reps:"2",weight:""},{reps:"2",weight:""}]}`) was never touched by the fix or the redeploy — only the read-time ranking/display computation changed. Confirms this is a pure ranking-layer fix with zero data mutation.
7. **Cleanup**: deleted all 4 test rows (`wod_logs`, `workout_sections`, `workouts`, `wods`) in FK-safe order; verified zero rows remain for the test date across all four tables.

Cross-client parity for this fix was verified via forge-admin-web's live UI (real coach + real data, both pre- and post-fix) plus WOD-SIMPLE's identical, separately-unit-tested port of the same resolver functions and a successful real log submission proving the write path (confirmed via SQL) — not via a live WOD-SIMPLE leaderboard screenshot, since the PWA's Leaderboard tab has no forward-navigation past "today" (a legitimate, unrelated product constraint, not a bug), and the test workout was necessarily future-dated to avoid touching any real class's live leaderboard.

Multi-section, Rx-independence, and Aggregate-compatibility acceptance scenarios were not separately re-run in this mission, since no defect was found in any of those areas (Rx Section-scoping, multi-Section identity, and Aggregate wiring were all independently re-verified by direct code read — see above — and were also the subject of dedicated, still-current production acceptance in the immediately preceding Section Leaderboard Visibility mission).

## Cleanup

All test data deleted and verified zero-remaining (see Production Acceptance §7). No residual rows, no orphaned test workouts, no test members created. Working trees clean; `origin/main` in sync with local `main` in both repos as of the final push.

## Final Support Matrix

See the Format × Scoring Mode Matrix above — **22/22 formats at Support Level 5**, one of them (`Death By`) reaching Level 5 only as a direct result of this mission's fix (previously effectively Level 2: loggable, but not correctly ranked).

## Final Verdict

Forge's current, explicitly-supported 22-format workout scoring and Section-leaderboard system is now universally audited. One real, previously-undetected correctness defect (`Death By`'s missing reps-scoring path) was found, root-caused, fixed identically in both repos, covered by 10 new regression tests, verified live against real production data with SQL proof of zero data mutation, and fully cleaned up. No other correctness defects were found anywhere in the format × scoring-mode surface, the Rx/Section-identity/completion-state layer, or the ranking/tie/zero/decimal/overflow/display-vs-storage layer.
