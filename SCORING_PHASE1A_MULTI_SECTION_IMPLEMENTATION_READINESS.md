# FORGE — Phase 1A: Multi-Section / Multi-Score Implementation Readiness Audit

**Status:** Investigation complete. Documentation only — no code, schema, migration, deploy, RLS, parser, or UI changes were made to produce this document.
**Scope:** WOD-SIMPLE (PWA) + forge-admin-web (Admin) + live production database (read-only queries only, no mutation).
**Labeling convention** (carried forward from `SCORING_COMPETITIVE_LANDSCAPE.md` / `SCORING_MODEL_ARCHITECTURE_VNEXT.md`): every non-obvious claim is tagged **OBSERVED FACT** (verified directly against live code, live schema, or live production data this session), **INFERENCE** (a reasoned conclusion from observed facts, not itself directly observed), **ANECDOTAL** (a single data point or comment, not a verified pattern), or **UNKNOWN** (genuinely not determined).

---

## 1. Executive Verdict

**Section (`workout_sections`) can become the universal multi-score boundary — YES, WITH ADDITIVE CHANGES.**

This is not a green-field question. Forge already built, shipped, and is running in production a section-based data model — Workout Engine V2 — with real UUID identity, edit-stable IDs, gym-scoped RLS, an atomic sync RPC, a derived `score_type`, and a three-state `logging_mode`. A native, multi-section authoring editor ("Faza 6") already exists in both clients, ported line-for-line between them, and already lets a coach add/remove/reorder an arbitrary number of sections. What is missing is not Section's identity or persistence — it is three specific, well-understood, contained changes to the *read/write boundary that scores flow through*: the write path currently assumes exactly one scored Section per Workout, and enforces this with a hard, structural single-`isPrimary` constraint at three independent layers (UI state, save-time validation, and RLS-adjacent `skill_logs.slot` cardinality). Removing that assumption is real work, but it is additive work on top of infrastructure that already exists and is already load-bearing in production.

The Programming Domain Architecture's own frozen document already names this exact question as an open, deliberately deferred item (§7 DEFER: *"Whether 'exactly one primary, scored Section' per Workout remains correct... If real usage shows gyms need independently scored, non-metcon elements in the same Day... this should be revisited directly"*). This audit is that revisit.

Full verdict block: §37.

---

## 2. Documents and Code Read For This Audit

**Paper architecture (read in full or in relevant part this pass):**
- `docs/architecture/PROGRAMMING_DOMAIN_ARCHITECTURE.md` v1.1, "Proposed for Freeze" — §3 (Section defined, exactly-one-primary named explicitly), §7 (ADOPT/REJECT/DEFER — the exactly-one-primary question is an explicit DEFER item), §9–11.
- `SCORING_MODEL_ARCHITECTURE_VNEXT.md`, `SCORING_MODEL_ADVERSARIAL_MATRIX.md`, `SCORING_MODEL_CURRENT_TO_VNEXT_MAP.md` (this session, prior phase) — the paper Score Component / Completion State / Tiebreak / Rx-split model.
- `SCORING_PHASE0_COMPLETION_STATE_IMPLEMENTATION_REPORT.md` (this session, prior phase) — confirms `completion_state` already lives at per-Result-row granularity and was already answered "Phase 1 ready: YES" for that specific field.
- `RESULTS_DOMAIN_ARCHITECTURE.md` v1.0, `RESULTS_DOMAIN_V1_1.md` — read in earlier phases of this session, not re-read this pass; content already reflected in the VNext documents above.
- `ERD.md` (repo root) — located (`./ERD.md`), not opened this pass; superseded in practice by the direct schema reads below, which are more current (ERD.md's freshness relative to the Faza 5B/6/8 migrations is **UNKNOWN**).

**Live code (read in full this pass):**
- `src/workoutEngine.js` (343 lines) — the V2 domain-mapping service (`mapLegacyWodToWorkout`, `mapV2WorkoutRow`, `mapV2SectionRow`, `loadWorkout`, `syncWorkoutEngineV2FromLegacyWod`, `legacySectionFromArray`, `legacyMetconSection`, `metconScalingVariantsForDisplay`, `SCORE_TYPE_BY_FORMAT`).
- `src/wodSections.js` (219 lines) — the "Faza 6" native multi-section editor's pure functions (`createSection`, `sectionsFromLegacyWod`, `legacyPayloadFromSections`, `validateSectionsForLegacy`).
- `src/App.jsx` — targeted reads: the write-path section-linking code (~L7185–7237, ~L7860–7868), the read-path display wiring (~L8159–8168, ~L9106–9184), the editor's `PrimarySectionBody`/`SectionCard`/`makePrimarySection` components (~L1017–1250, ~L3375–3390), `fetchWodZiWorkoutV2` (~L7456–7468).
- `src/workoutEngine.test.js` — fixture structure confirmed (real production WOD "NED" used as the V2-vs-legacy comparison fixture).
- `forge-admin-web/src/features/programming/{types.ts, sectionEditing.ts, mutations.ts, workoutMapping.ts, api.ts}` — confirmed this is a **deliberate, documented port** of WOD-SIMPLE's Faza 6 editor and Faza 4 read-mapping service into Admin, not an independent implementation.
- `forge-admin-web/src/features/results/{types.ts, ranking.ts, ranking.test.ts}` — confirmed read-only consumption of `wod_logs`/`workout_section_id`.

**Live schema (read in full this pass):**
- `supabase/migrations/20260716090000_workout_engine_v2_schema.sql` — `workouts`, `workout_sections`, `workout_section_types` tables, RLS, triggers, indexes.
- `supabase/migrations/20260716110000_workout_engine_v2_stabilization.sql` — "Faza 5B": `slot_key` column, its partial unique index, backfill, and the `sync_workout_engine_v2` RPC (SECURITY DEFINER, sole write path for V2 sync).
- `supabase/migrations/20260716120000_logs_workout_section_link.sql` — "Faza 8": `wod_logs.workout_section_id` / `skill_logs.workout_section_id`, `on delete set null`, no backfill by design.
- `supabase/migrations/20260820100000_wod_logs_completion_state.sql` — Phase 0 (this session).

**Live production data (read-only queries this pass, no mutation):**
- `workouts`: 40 rows. `workout_sections`: 54 rows. `workout_section_types`: 11 platform-level rows (`warmup, skill, strength, weightlifting, conditioning, gymnastics, metcon, cooldown, mobility, recovery, coach_notes`), 0 gym-specific rows observed.
- `wod_logs`: 349 rows total, 193 (~55%) with `workout_section_id` populated (consistent with "new logs only, no backfill" as documented).
- `skill_logs`: 10 rows total, **0** with `workout_section_id` populated — see §12 for this discrepancy.
- Section-count distribution per workout (top 8 by count): the observed maximum is **3 sections per workout** (`warmup, skill, metcon` or `warmup, metcon`), every section's `slot_key` non-null (no purely "native," slot_key-less sections observed in production yet).

**Discrepancy disclosure (mission-required):** No conflict was found between the paper architecture and the live implementation on the central question — both agree "exactly one primary/scored Section" is the current, deliberately temporary state. The one real doc/implementation gap found: `PROGRAMMING_DOMAIN_ARCHITECTURE.md` §3 describes Section only at the conceptual level ("warmup, skill work, the primary metcon") and does not mention `slot_key`, `loggingMode`, or the native-editor generalization (Faza 6) at all — the paper document predates or was never updated to reflect that authoring already outgrew the fixed four-slot model it describes. This is a documentation lag, not a behavioral conflict.

---

## 3. What "Section" Actually Is Today — Two Layers, Not One

The mission's framing ("the existing Forge Section") undersells the real situation: there are **two distinct live representations**, kept in sync by best-effort dual-write, and consumed differently:

1. **Legacy `wods` row** (authoritative for Member View content + all logging today): four fixed columns/column-groups — `warmup`, `skill`(+`skill_name`/`skill_type`/`skill_format_config`), `skill2` (same shape), and the base row itself (name/type/format_config/movements_rx.../notes_rx...) representing the single "primary" metcon.
2. **`workout_sections` rows** (Workout Engine V2): an ordered, arbitrary-length list of sections with real UUID identity, each carrying its own `format`, `format_config`, `movements` (structured), `scaling_versions`, `logging_mode`, `score_type`, `duration_minutes`, `benchmark_metadata`, `metadata`.

**OBSERVED FACT:** (1) is written directly by the coach-facing forms and read by Member View, FormatLogger (the logging UI), and all ranking/leaderboard code, in both clients. (2) is written by a best-effort, never-throwing sync (`syncWorkoutEngineV2FromLegacyWod` → `sync_workout_engine_v2` RPC) triggered whenever (1) is saved, and is read *only* for Member View's display/header rendering (`fetchWodZiWorkoutV2` → `workoutForDisplay = wodZiWorkoutV2 || mapLegacyWodToWorkout(...)`) and for computing the `workout_section_id` backlink written onto new `wod_logs`/`skill_logs` rows. **No ranking, leaderboard, or analytics code anywhere in either repo reads `workout_sections` or `workout_section_id` today** — confirmed by grep; the only appearances of `workout_section_id` across `src/App.jsx` are the two write-path assignments already cited, and its two appearances in `forge-admin-web/src/features/results/types.ts` are typed but never filtered/grouped on.

**INFERENCE:** This means Section-as-scoring-boundary is not "proposing new infrastructure" — it is "starting to read infrastructure that already exists and has already been populated on ~55% of the last two months of logs, but has never yet been the source of truth for anything a member or coach sees as a *score*."

---

## 4. Section Identity

**OBSERVED FACT — stable, real, but bridged.** `workout_sections.id` is a genuine `uuid` primary key (not synthetic, unlike the legacy in-memory `legacy:${wodId}:${slotKey}` IDs `workoutEngine.js` uses for un-synced WODs). Once a WOD has been saved at least once post-Faza-5B, its sections have real, permanent UUIDs.

Stability across ordinary edits is guaranteed by `slot_key`, not by `order_index` or content hash — this is explicit and deliberate (migration comment: *"pozitia se schimba la reordonare, continutul se schimba la orice editare normala — niciuna nu descrie identitatea reala a sectiunii, doar rolul ei o face"*). `sync_workout_engine_v2` upserts on `(workout_id, slot_key)`, so re-saving the same WOD with the same slots preserves the same section IDs, which is exactly what makes `wod_logs.workout_section_id` a safe, non-dangling FK to attach to at logging time.

**The important nuance the mission needs:** `slot_key` is **explicitly documented as a transitional bridge, not a permanent identity mechanism** (migration comment: *"punte DELIBERAT limitata la sincronizarea legacy... NU un concept permanent. Odata ce editorul va gestiona sectiuni nativ... acelea vor purta slot_key = null si vor folosi id-ul lor real direct, fara nicio potrivire necesara"*). The schema and RPC already anticipate a future where sections are added/removed/reordered natively (not derived from four fixed legacy columns) and carry `slot_key = null`, using `id` alone as identity. **In production today, this future has not arrived**: every one of the 54 observed `workout_sections` rows has a non-null `slot_key` from the fixed vocabulary (`warmup`/`skill`/`skill2`/`metcon`). The Faza 6 editor already *allows* a coach to add an arbitrary 5th, 6th, Nth section — but the save gate (§5) currently forces every such attempt back into ≤3 non-primary + exactly 1 primary before it will persist, so no "genuinely native, slot_key-null" section has ever been created in production. **This is the single most load-bearing fact for the mission's Part A/Part B/Part C generalization question: the extensibility mechanism already exists in the schema and RPC, but has never been exercised, because the editor's own validation gate prevents it.**

---

## 5. Section Ordering

**OBSERVED FACT.** `order_index integer default 0` is a column fully independent from `id`/`slot_key` — confirmed in the schema and in `sync_workout_engine_v2` (`(v_section ->> 'order')::int`). Reordering in the Faza 6 editor changes `order_index` on save without touching `id`. `mapV2WorkoutRow`/`loadFromWorkoutEngineV2` sort by `order_index` when assembling the domain `Workout.sections` array. This is a clean, already-correct separation — no gap found here.

---

## 6. Section Versioning / Edit Behavior

**OBSERVED FACT.** There is no explicit revision/version entity for a Section — an edit is an in-place `UPDATE ... on conflict (workout_id, slot_key) do update` via the RPC; the old content is not retained anywhere. This matches `wods`' own behavior (in-place edit, no history table) and matches `PROGRAMMING_DOMAIN_ARCHITECTURE.md`'s own stated content-stability contract for *Draft* workouts (free mutation) — the stronger "detectable revision on Published content" contract described in that document (§3) is **not implemented** for either `wods` or `workout_sections` today (**INFERENCE**, not directly tested this pass, but no revision table or `updated_at`-diffing consumer was found in either repo). This is a pre-existing gap orthogonal to the multi-section question — noted for completeness, not a Phase 1A blocker, since single-primary-section workouts have exactly the same gap today.

The Scoring Snapshot mechanism (`wod_name_snapshot`/`format_snapshot`/`format_config_snapshot` on `wod_logs`, from Results Phase 2 Slice 2) is the platform's actual answer to "what if the Workout changes after I logged against it" — and it snapshots off the *legacy `wods` row*, not off `workout_sections`. **This is a real, concrete Phase 1 dependency**: if scoring becomes genuinely Section-scoped, the snapshot mechanism needs to snapshot the specific Section's content (format/format_config/movements at logging time), not the whole legacy row — otherwise a member who logged against "Part B" before a coach edited "Part A" would have their snapshot silently include the unrelated Part A change if the snapshot naively keys off `wod_id` alone. This is additive (new snapshot columns or a `format_config_snapshot` sourced from the section instead of the WOD) but must be scoped into Phase 1, not treated as already solved.

---

## 7. Cardinality Assumptions — the Real Constraint, Found at Three Independent Layers

This is the core finding. "Exactly one scored Section per Workout" is not a single check that can be relaxed in one place — it is independently enforced at **three separate layers**, each of which must be addressed for Phase 1:

1. **Authoring UI state** (`wodSections.js`/`sectionEditing.ts`, ported identically to both clients): `makePrimarySection(id)` is a *mutual-exclusion setter* — `setWodSections(prev => prev.map(s => ({...s, isPrimary: s.id === id})))` — marking one section primary un-marks every other section in the same action. It is structurally impossible in the current UI to have two `isPrimary: true` sections simultaneously, even transiently in client state.
2. **Save-time validation** (`validateSectionsForLegacy`): hard-blocks the save entirely (no partial-publish, no warning-and-proceed — a deliberate prior product decision, per the file's own comment) unless `primaryCount === 1 && nonPrimaryCount <= 3`.
3. **`skill_logs.slot` column**: a **hardcoded two-value slot** (`1` or `2`, `esteSlot2 = skillLogSlot === 2`), completely independent of and *tighter than* constraint #2. Even if #1 and #2 were relaxed to allow 3 non-primary sections, only the first 2 of them have any logging path at all today (skill_logs has no `slot: 3`) — the 3rd non-primary section, if it existed, would render in Member View but be **structurally unloggable**. This was not previously documented as a known gap; it is a new finding of this audit, surfaced by tracing the actual write path rather than the count-based validation function alone.

**INFERENCE:** Layers 1 and 2 are pure application/validation logic — cheap to relax. Layer 3 is a schema-level cardinality cap on a table (`skill_logs`) that Phase 1 must either widen (`slot` becomes unbounded / section-keyed) or bypass entirely (route all non-primary Section logging through `wod_logs` + `workout_section_id` instead of `skill_logs`, retiring the special-cased 2-slot table as the *legacy* path rather than extending it). §36 recommends the latter.

**Multiple sections do already accumulate correctly at the storage layer** — production data confirms up to 3 `workout_sections` rows per `workout_id` exist today (via the non-primary warmup/skill/skill2 slots), so the RPC's own upsert-by-slot_key and multi-row insert loop are already proven correct under real multi-row conditions. The cap is entirely in the application layers above, not in `workout_sections`/`workouts`/the RPC itself.

---

## 8. Natural Keys / Uniqueness Constraints (Live, Verified)

- `workouts`: `unique(gym_id, date)` — one Workout per Gym per Day, confirmed live. This is unaffected by anything in this mission; Section multiplicity is entirely below this level.
- `workout_sections`: `unique index (workout_id, slot_key) where slot_key is not null` — a **partial** unique index, meaning native (slot_key-null) sections are explicitly exempted from any uniqueness constraint today, by design (each NULL is distinct in Postgres). **This means the schema currently has NO uniqueness/collision protection at all for native sections** — a future native-section creation path (Phase 1+) will need its own identity discipline (e.g., always insert with a fresh UUID, never rely on a natural key), which the RPC's current `insert ... on conflict (workout_id, slot_key) where slot_key is not null` clause does not provide for `slot_key = null` rows (a plain insert, no conflict target). Not a blocker — but a gap to design explicitly, not assume.
- `wod_logs`: **no** uniqueness constraint on `(member_id, wod_id)` was found or previously documented (**INFERENCE from schema read**: a member could in principle have >1 `wod_logs` row for the same WOD today, e.g. a correction-by-insert pattern) — confirmed the app currently mostly relies on ranking logic picking the right one rather than a DB-level uniqueness guarantee. This is actually **favorable** for Phase 1: extending "one log per member per WOD" to "one log per member per scored Section" does not need to fight an existing unique constraint; it needs the *opposite* — to add a scoping key (`workout_section_id`) to what ranking already groups by, not to relax a constraint that was never there.
- `skill_logs`: **OBSERVED FACT** — `.upsert({member_id, gym_id, wod_id, slot, ...})` in the write path implies an upsert target of `(member_id, wod_id, slot)` (the natural key the app code assumes, not independently re-verified against a DB constraint definition this pass — flagged **UNKNOWN** whether a formal unique constraint enforces this or the app simply relies on correct upsert-key selection; worth confirming with a direct `\d skill_logs` read before Phase 1 implementation, not required for this readiness verdict).

---

## 9. Rx / Variant / Mixed Categories Granularity

**OBSERVED FACT.** `variant_level` (RX/Intermediate/Beginner/OnRamp) lives on `wod_logs`, one value per log row — already independent of Section identity; nothing here needs to change. `scaling_versions` (jsonb) already lives *per-section* on `workout_sections` (confirmed in schema + `metconScalingVariantsForDisplay`), meaning **the prescription side of Rx classification is already Section-scoped today** — only the primary section currently carries variants because only the primary section is ever marked `isPrimary`, but the column itself imposes no such limit; a second `loggingMode:'required'` section could carry its own independent `scaling_versions` with zero schema change.

**Mixed Categories (Results Phase 3, rxEngine.ts/rxEngine.js):** classification resolves a per-log Rx/Not-Rx status against the WOD's prescribed standard, keyed by movement text + weight, sourced from the primary section's variant data today. **INFERENCE:** generalizing to multi-section scoring requires `resolveSectionStandardKg` (Admin) / the equivalent PWA logic to be parameterized by *which* section's `scaling_versions` a given log's `workout_section_id` points to, rather than assuming "the WOD's" (singular) standard — a real but mechanical change (swap an implicit "the primary section" lookup for an explicit "the log's linked section" lookup), not a new capability.

**Leaderboard:** `sortLogs` (PWA) / `ranking.ts` (Admin) key a leaderboard's row set by `(wod_id, variant_level)` today — grouping every log for a WOD+tier into one ranked list, implicitly assuming one score per member. **This is the one piece of ranking logic that must change non-additively for genuine multi-score support** (§18/§34): with >1 independently scored Section per Workout, a leaderboard must key by `(wod_id, workout_section_id, variant_level)`, or present N separate leaderboards (one per scored Section) rather than one. Neither client does this today; neither client is broken by it not existing yet, since no workout has ever had >1 required section in production.

---

## 10. Analytics Impact

Results Phase 2 Slice 5's 7 analytics views, Performance Identity (Slice 4), and the PR Event Ledger (Slice 3) all key off `wod_logs` rows directly (member, movement, benchmark, signature) — **none of them currently group by `workout_section_id`** (confirmed: none of these views/triggers reference the column, per the migrations read in earlier phases of this session and re-confirmed by absence in this pass's grep of `workout_section_id` usage). **INFERENCE:** this is *safe*, not broken, under multi-section scoring precisely because these systems operate at the (member, movement) or (member, workout-identity) grain, which is orthogonal to how many Sections a single Workout has — a second independently-scored Section just becomes more `wod_logs` rows feeding the same aggregate machinery, exactly as Phase 0's `completion_state` already proved for a different additive column. Performance Identity's Signature V1 resolution (movements+format+duration) would need to be computed per-Section rather than per-Workout once multi-score exists (two Sections of the same Workout should not collide into one Signature) — an additive parameterization, not a redesign.

---

## 11. RLS / Security Impact

**OBSERVED FACT.** `workout_sections` already has full gym-scoped RLS (published-only SELECT for non-coach, all for coach/admin; INSERT/UPDATE/DELETE restricted to `is_coach_or_admin(gym_id)`) and a trigger (`enforce_workout_section_gym_id_trg`) that hard-enforces a section's `gym_id` matches its parent workout's `gym_id`, preventing cross-tenant section attachment even via a crafted direct insert. `sync_workout_engine_v2` re-checks `is_coach_or_admin(p_gym_id)` itself (SECURITY DEFINER, matching the project's established pattern for other privileged RPCs). **No RLS gap was found for the multi-section case** — the existing policies are already written in terms of "any number of sections for this workout," not "the one section," so allowing more `loggingMode:'required'` rows through the RPC introduces no new authorization surface. This is a genuine, verified strength of the existing design, not an assumption.

---

## 12. Known Discrepancy: `skill_logs.workout_section_id` is 0% Populated

**OBSERVED FACT, disclosed per the mission's explicit instruction to surface doc/implementation disagreements.** The write-path code at `App.jsx` ~L7229–7234 computes `skillSectionIdV2` and writes it on every `skill_logs` upsert. Production data shows 0 of 10 `skill_logs` rows have a non-null `workout_section_id`, versus 193 of 349 `wod_logs` rows (~55%) for the equivalent primary-section link. Two explanations are consistent with the evidence and were not further distinguished (read-only investigation, no code changes made): (a) all 10 existing `skill_logs` rows predate this code path's deployment and no member has logged Skill Work since — plausible given the very small row count and that Skill Work logging is a lower-traffic feature than main WOD logging; or (b) a real, live bug in the `skillSectionIdV2` lookup (e.g. `supportingSectionsV` not being populated at the time `logSkill` fires, or a `slotKey` mismatch). **This is flagged as an open item for whoever picks up Phase 1 implementation to verify with one fresh test log before relying on the skill-logs section link — it does not affect this audit's verdict**, since Phase 1's recommended path (§36) does not extend `skill_logs` further regardless.

---

## 13–17. Twenty-Plus Workout Stress Tests

Each workout below is run against the hypothesis: *"the Workout's set of `loggingMode:'required'` Sections, each producing its own `wod_logs` row keyed by `workout_section_id`, correctly and unambiguously captures every independently-meaningful score."* Format follows the earlier Adversarial Matrix's convention: Workout → Correct scoring shape → Verdict under the Section model.

1. **"Fran"** (21-15-9 Thrusters/Pull-ups, For Time) — 1 score. → 1 required Section. **PASS.**
2. **AMRAP 20 (Cindy-style)** — 1 score (rounds+reps). → 1 required Section. **PASS.**
3. **EMOM 12 (alternating movements)** — 1 score (completion or last-round load). → 1 required Section. **PASS.**
4. **Weightlifting: Back Squat 5×5** — 1 score (heaviest set or total). → 1 required Section. **PASS.**
5. **"DT" (Hero WOD, 5 rounds For Time)** — 1 score, Benchmark Identity. → 1 required Section with `benchmark_metadata`. **PASS**, unaffected by multi-section work.
6. **Buy-in + Metcon + Cash-out, ONE score** (e.g., 400m run buy-in, 15 min AMRAP, 400m run cash-out, ranked purely on AMRAP rounds+reps) — **the mission's first flagged critical case.** Correct shape: buy-in/cash-out are *coaching structure inside the scored block*, not independent scores. → Author as ONE required Section whose `movements` field lists all three blocks in sequence (exactly how `legacyMetconSection` already represents multi-line WODs today) OR as 3 sections where only the metcon one is `loggingMode:'required'` and the buy-in/cash-out are `loggingMode:'none'` (display-only, exactly analogous to today's `warmup` slot). **PASS** — this case is **already fully supported today**, requires zero Phase 1 work, and — importantly — **today's hard "exactly one `isPrimary`" cap is an accidental safety rail against the opposite mistake** (a coach marking buy-in and cash-out each independently required by mistake). Phase 1 must replace that accidental protection with explicit UI guidance once >1 required section becomes possible (§19).
7. **Time-capped buy-in, untimed cash-out, but leaderboard should rank on total time including cash-out** — same as #6, one score, the cap/completion semantics live on the one required Section's `completion_state` (Phase 0, unaffected). **PASS.**
8. **"Buy-in for time, THEN max-load lift, ranked on BOTH independently"** (e.g., 800m run for time, then 1RM Clean, both posted on the board) — genuinely 2 independent scores, 2 different score types (Duration vs Load), on the same Day. → 2 required Sections, 2 `wod_logs` rows (one per section), 2 leaderboards (keyed by `workout_section_id`). **Requires Phase 1** (multi-required-section support) — this is exactly the case `PROGRAMMING_DOMAIN_ARCHITECTURE.md` §7 DEFER names verbatim ("a separately logged strength lift"). **Correctly identified as needing Phase 1, not already solved.**
9. **Partner WOD, one combined score** — 1 required Section, `format_config` already carries partner semantics (pre-existing `fortime_or_amrap`/Partner WOD format family). **PASS**, unaffected.
10. **Team WOD, 3 independently-scored legs (Leg 1 Member A, Leg 2 Member B, Leg 3 both)** — plausibly 3 required Sections if each leg is individually ranked; **UNKNOWN / not currently supported by either format** — this is a genuinely new product surface (per-Section *attribution* to a sub-team, not just per-Section scoring), correctly out of scope for Phase 1 as scoped in this document (Phase 1 = multiple required Sections per Workout scored by the same full log-in member/team, not sub-team splitting). Flagged, not solved.
11. **5×500m Row, each interval independently logged/ranked** — **the mission's second flagged critical case.** This is NOT solved by Section generalization. Five independently-ranked splits inside what a coach authors and displays as *one* visual block require decomposition *below* the Section boundary — this is precisely the `SEGMENT_MODEL_SPEC_v1.md`'s domain (leaf/composite tree, `resultCombination`), which is Programming-owned and explicitly describes prescribed structure only, deliberately deferred, not built. **Section is the wrong tool for this case; Segment is the right one, and Segment remains out of scope for Phase 1.** This is the single most important negative finding of this audit: **Phase 1 (multi-Section) must not be sold or scoped as solving interval-split scoring — it doesn't, and shouldn't try to.**
12. **Interval workout, best single interval counted (not all 5)** — same as #11, a `resultCombination: best-of` case at the Segment level, not Section level. Out of scope, correctly.
13. **Chipper (single long list, one score)** — 1 required Section. **PASS.**
14. **Ladder (ascending/descending reps, one score)** — 1 required Section. **PASS**, Phase 0 `completion_state` already handles capped-mid-ladder correctly.
15. **"Murph" (Hero WOD with embedded weighted-vest strength component inside a For Time)** — a real CrossFit case with an internal structure (1 mile run / 100 pull-ups+200 push-ups+300 squats / 1 mile run) ranked as ONE time. Same shape and same answer as #6 — 1 required Section, internal structure lives in `movements` text, not in extra Sections. **PASS**, already supported.
16. **A WOD with a genuinely optional, separately-logged accessory lift** (e.g., "3×Max Rep Strict Pull-ups, log if you want, not ranked with the main WOD") — → a Section with `loggingMode: 'optional'`, distinct from `'required'`. **Already representable today** exactly as the current "Skill" slot is used — the `loggingMode` tri-state already anticipates this and requires no Phase 1 change *except* that (per §7 finding #3) only the first 2 optional sections have a logging path (`skill_logs.slot` 1/2 cap). A 3rd optional accessory section: **partially supported today, fully supported only after §36's recommended `skill_logs` retirement.**
17. **Benchmark WOD re-run months later (Performance Identity / progression tracking)** — unaffected by Section count as long as Signature/Benchmark resolution is scoped per required-Section (§10). **PASS with the noted parameterization.**
18. **A Workout with zero required Sections** (e.g., a pure mobility/rest day, "Recovery" type already exists in `workout_section_types`) — → 0 required sections, 0 `wod_logs` rows expected, nothing to rank. Already representable (`loggingMode:'none'` on every section), matches existing Rest Day handling referenced in Performance Identity's own "null when the Workout/movements were too sparse to sign" comment. **PASS.**
19. **Coach edits a Published Workout's Part B after Members have already logged against Part A** — per §6, the Scoring Snapshot must be sourced per-Section, not per-Workout, or a Part-A logger's snapshot would spuriously reflect an unrelated Part B edit if implemented naively. **Requires explicit Phase 1 design, not automatically correct.**
20. **A legacy WOD logged before `workout_section_id` existed, viewed on today's per-Section leaderboard** — `workout_section_id IS NULL` for all pre-Faza-8 rows (no backfill, by design). → Must fall back to "ungrouped / legacy single-score" leaderboard behavior for that WOD, exactly as Phase 0's `completion_state` dual-path (`?? !!time_result`) already established as the accepted pattern for graceful degradation on old rows. **PASS, with the same dual-path discipline Phase 0 already proved out.**
21. **Two workouts on the same Day with the same movements (a coach copy-paste mistake)** — orthogonal to Section count; Signature/Performance-Identity collision risk already exists today (documented in Results Phase 2 Slice 4's own known "Mary/PARTNER MARY" collision) and is unaffected by this mission. **N/A, not a Section-model risk.**
22. **A gym-custom Section type (e.g., "Mindset Talk," a `workout_section_types` row with non-null `gym_id`)** — schema already supports gym-scoped custom types (confirmed: `workout_section_types` has both platform (`gym_id is null`) and, per its own unique index name `workout_section_types_platform_key_uidx`, an anticipated gym-scoped tier) — 0 such rows exist in production today (**OBSERVED FACT**), but nothing about multi-required-Section scoring depends on or is blocked by this. **PASS, orthogonal.**

**Stress-test conclusion:** Of the cases actually inside Phase 1's honest scope (multiple independently-scored, whole-Section results per Workout), every one either already works today (buy-in/cash-out, single-score formats) or requires only the three contained, additive-to-mostly-additive changes named in §7/§9/§34. Of the cases that fail, the failures are **correctly out of scope** (sub-Section Segment splits, sub-team attribution) — they are not gaps in the Section model, they are evidence that Section and Segment are, correctly, two different concepts solving two different problems, exactly as `SEGMENT_MODEL_SPEC_v1.md` already concluded when it was written and deliberately not built.

---

## 18. Red-Team: Trying to Break the Section-as-Boundary Hypothesis

**Attempt 1 — "Section identity isn't real, it's just a legacy bridge (`slot_key`)."** Refuted by §4: `id` is a real UUID independent of `slot_key`; `slot_key` is the *stability mechanism* for legacy-derived sections, not the identity itself. A native section (post-Phase-1) uses `id` directly with `slot_key = null`, already anticipated by the partial unique index.

**Attempt 2 — "Nothing actually reads workout_sections for scoring, so claiming it's 'production-proven' is overstating it."** Partially valid — see §3: read-usage today is display-only + backlink-writing, never scoring/ranking. The verdict in §1 is calibrated to this: GO is for *building the read path*, not a claim that the read path already works end-to-end for scoring. This is disclosed, not hidden.

**Attempt 3 — "The `isPrimary` single-boolean is a UI convenience, not proof the domain model actually generalizes — maybe it's `isPrimary` because the schema genuinely can't support 2, not because the UI arbitrarily forbids it."** Refuted by §7/production data: the schema, RPC, and RLS impose no such 1-row cap — 3-row-per-workout `workout_sections` groups already exist in production. The cap is proven to be application-layer only.

**Attempt 4 — "Rx/variant classification is fundamentally single-WOD-scoped (one set of prescribed weights), so multi-Section scoring would need to duplicate the whole Rx engine per Section."** Refuted by §9: `scaling_versions` already lives per-`workout_sections`-row today; the Rx engine's *lookup* needs to key off the log's `workout_section_id` instead of "the WOD," which is a parameter change, not a duplicated engine.

**Attempt 5 — "The leaderboard key change (`wod_id` → `wod_id`+`workout_section_id`) is bigger than it sounds — it touches two independently-maintained ranking implementations (PWA `sortLogs`, Admin `ranking.ts`) that have already drifted in subtle ways once this session (the `finished()` dual-path fix)."** This is the strongest surviving objection and is **not refuted** — it is accepted as real, scoped work, named explicitly in §9/§34/§37(E), and is exactly why the final verdict is "GO" rather than "trivial" — cross-client ranking-key changes are the kind of change that has already, in this same session, produced a real cross-repo consistency bug (Phase 0's `finished()` logic) when done carelessly. Phase 1 must treat this as the highest-risk single change in the whole effort and test it with the same rigor Phase 0's `ranking.test.ts` dual-path tests used.

**Attempt 6 — "Maybe the real answer is: don't generalize Section at all, build a separate `score_components` table instead, exactly as VNext originally proposed."** This is the mission's own B question. Rejected in §19 below — Section already carries everything a ScoreComponent would, and introducing a parallel entity purely to avoid touching the constraints in §7 would create two competing identities for the same real-world thing, which is a worse outcome than doing the (contained) work of relaxing those three constraints.

**Net result of red-teaming: the hypothesis survives.** Every genuine weak point found (Attempt 5 in particular) is a scoped, named implementation risk, not a structural reason Section is the wrong boundary.

---

## 19. Precise Semantic Boundary (One Sentence, As Required)

**A Section is the smallest unit of a Workout that a coach can independently mark as "this produces one ranked score" — everything within it (movements, sub-blocks, buy-ins, cash-outs) is that one score's internal structure and is never itself independently rankable; anything that must be independently rankable gets its own Section, and anything that must be independently rankable *within* what is otherwise displayed as one block belongs to a Segment (not built), not to a second Section.**

This single sentence is what resolves both flagged critical cases from §13–17 identically to how they were resolved there: multi-block-one-score stays one Section (the sentence's first clause); one-block-multi-score is explicitly excluded from Section's job (the sentence's last clause) and correctly routed to the not-yet-built Segment concept instead of being forced into a second Section it doesn't semantically deserve.

---

## 20. Does Forge Need a New `ScoreComponent` Entity? (Mission Question B, Argued)

**NO.** The VNext architecture package's proposed "Score Component" primitive (a first-class object representing "one scoreable thing") is, functionally, exactly `workout_sections` (the authored, identity-stable, scoreable unit) joined to `wod_logs` filtered by `workout_section_id` (the logged fact against it). Inventing a separate `score_components` table would mean maintaining two identities for the same real-world concept — a coach authoring "Part B, ranked independently" would need to create both a Section (for content/scaling/display) and a ScoreComponent (for scoring semantics) and keep them in lockstep, which is strictly worse than extending the one entity that already has the identity, RLS, and sync infrastructure. The only genuinely new *primitive-level* concept the mission's evidence supports is **Segment**, for sub-Section decomposition — already specified, correctly still not built.

---

## 21. Does Phase 0 `completion_state` Survive Unchanged? (Mission Question C, Argued)

**YES.** `completion_state` is a column on `wod_logs`, one value per logged row. Under Phase 1, "one logged row per member per Workout" becomes "one logged row per member per required Section" — this is a change in *how many* `wod_logs` rows exist per Workout, not a change to what any individual row means. Each row keeps its own independently correct `completion_state`, exactly as the Phase 0 report already concluded (*"Phase 1 readiness answer: YES — completion_state already lives at the per-Result-row granularity Phase 1's Section-scoped Result will use"*) — this audit directly confirms that prior conclusion against the real, now-fully-traced Section infrastructure, rather than against the paper architecture alone.

---

## 22. Can Legacy Single-Score Workouts Remain Fully Backward Compatible? (Mission Question D, Argued)

**YES.** Every one of the 40 production `workouts` rows today has exactly one `loggingMode:'required'` section, mapping to exactly one `wod_logs` row shape, exactly as today. `mapLegacyWodToWorkout` is untouched by anything Phase 1 needs. Ranking's existing dual-path discipline (`completion_state ?? !!time_result`, and the equivalent needed for `workout_section_id ?? wod_id`-only grouping) is the same pattern Phase 0 already validated works correctly across 345 pre-existing rows with zero ranking change. A single-required-Section Workout under a Phase-1-generalized codebase is byte-identical in behavior to today — the generalization only activates different code paths when a second required Section is actually created, which cannot happen until the §7 constraints are deliberately relaxed.

---

## 23. Cross-Client Consistency

**OBSERVED FACT, strong positive finding.** Unlike some earlier audits this session that found drift between clients, the Faza 6 editor and Faza 4 read-mapping are **deliberately, explicitly ported** between WOD-SIMPLE and forge-admin-web (confirmed by the header comments of `sectionEditing.ts` and `workoutMapping.ts`, which name the exact source files and explain *why* they're separate files rather than a shared package, and flag even a naming inconsistency — `'onramp'` vs `'on_ramp'` — as knowingly preserved rather than silently drifted). Both clients share: the same `isPrimary` single-boolean semantics, the same `validateSectionsForLegacy` gate, the same section shape. **forge-admin-web never writes `wod_logs`/`skill_logs` scores** (confirmed in earlier phases of this session) — it is a pure Programming-side (authoring) participant in Section, and a pure Results-side (read-only) consumer of `workout_section_id`. This means Phase 1's write-path changes (composeWodLogFields-equivalent, ranking keying) are **WOD-SIMPLE-only** for the write side, while the section-authoring UI changes (relaxing `validateSectionsForLegacy`, allowing >1 `isPrimary`-equivalent) must be made **identically in both repos' ported copies**, exactly as Faza 6 itself was.

---

## 24. Legacy Data Compatibility

Already covered in depth (§20, §17 case 20). Summary: no backfill needed or possible (consistent with the explicit, deliberate no-backfill decision already made at Faza 8 and reaffirmed at Phase 0) — `workout_section_id IS NULL` and `completion_state IS NULL` are both permanent, correct, first-class states for historical rows, not a migration debt to pay down.

---

## 25–33. Additional Required Sub-Sections (Consolidated)

To keep this document navigable, the remaining required analytical angles are consolidated here rather than repeated at full length, since each is already substantively answered by a cross-reference:

- **Parser/Quick-Create output shape impact:** Quick Create (Coach Quick Create, shipped feature per memory) generates the legacy `wods` shape today (single primary metcon + optional warmup/skill), consistent with §7's finding — it produces content the existing gate already accepts. Extending Quick Create to *author* multiple required Sections (e.g., detecting "this WOD has 2 independently-scored parts" from a pasted whiteboard) is a real, separate, future product decision, **not required for Phase 1 to be architecturally ready** — Phase 1 only needs to allow a coach to *manually* mark a 2nd section required; AI-assisted authoring of that shape is additive on top.
- **Movement Catalog impact:** none — `movements` jsonb per-section already exists independent of Section count; the Movement Catalog work (`movementCatalog` referenced in `App.jsx`) operates per-movement, orthogonal to how many Sections a Workout has.
- **Format/format_config impact:** none new — `format`/`format_config` already live per-`workout_sections`-row; a 2nd required Section simply carries its own independently, exactly as the primary does today.
- **Time Cap / Tiebreak (RESULTS_DOMAIN_V1_1.md) impact:** these already live at the per-Result granularity (matching completion_state's own placement) — unaffected, same reasoning as §21.
- **Attendance/Classes domain impact:** none — Programming's calendar spine (Day, Gym) is untouched; Sections are entirely below the Class/Attendance boundary.
- **Financial/Membership domain impact:** none.
- **AI parser (`analyze-workout` Edge Function) impact:** `SCORE_TYPE_BY_FORMAT`/`deriveScoreType` already exists independently in `prompt.ts` (Edge Function), `workoutEngine.js` (client), and the schema migration — a pre-existing, already-disclosed duplication (three places, three languages) unrelated to and not worsened by Phase 1.
- **Testing impact:** `workoutEngine.test.js` already uses a real production WOD fixture for V2-vs-legacy comparison — the established pattern to extend for Phase 1 (add a 2nd-required-section fixture), not a new testing strategy to invent.
- **Performance/scale impact:** 40 workouts / 54 sections / 349 logs today — multi-section adoption is opt-in per-Workout; no volume concern at current or 10x scale.

---

## 34. Implementation Options

**Option 1 — Full Section-scoped rewrite of the write path (recommended, see §36).** Relax the three §7 constraints; `composeWodLogFields`-equivalent iterates required Sections instead of assuming one; `wod_logs.workout_section_id` becomes a required (not just backlink) discriminator; ranking keys by `(wod_id, workout_section_id, variant_level)`, falling back to `(wod_id, variant_level)` only when `workout_section_id` is null (legacy rows). Contained, additive to schema, non-additive to 3 named application layers.

**Option 2 — New parallel `results` table keyed natively by `workout_section_id`, leave `wod_logs` untouched for legacy.** Rejected: recreates the exact "two identities for one concept" problem named in §20, and would require every downstream consumer (PR ledger, Performance Identity, analytics views) to be taught to read from two tables instead of one, multiplying the Phase 1 surface area for no benefit over Option 1's dual-path pattern (already proven safe by Phase 0).

**Option 3 — Do nothing; keep "exactly one scored Section" permanently, solve the deferred need (independently-scored strength lift, etc.) as a special-cased 2nd top-level Workout on the same Day instead of a 2nd Section.** Viable as a *product* alternative (not ruled out by this audit, which is architecture-only) but reintroduces exactly the problems `PROGRAMMING_DOMAIN_ARCHITECTURE.md` already rejected Track/multi-program for (§7 REJECT/DEFER) — two Workouts on one Day for one Gym would collide with the `workouts(gym_id, date)` unique constraint and the Day-as-spine principle. Not recommended, but noted as the "do not build Phase 1" alternative the mission's GO/NO-GO framing requires acknowledging.

**Recommendation: Option 1.**

---

## 35. Migration Strategy

No destructive migration is required (§37F). Recommended sequencing, additive at every step:
1. Relax `validateSectionsForLegacy` to allow >1 `isPrimary`-equivalent (rename concept to `loggingMode: 'required'` count, already the real discriminator) — both repos' ported editor copies, same PR pattern as Faza 6 originally used.
2. Generalize the write path: iterate required Sections, one `wod_logs` insert per Section, `workout_section_id` populated on every insert (not just when `variantaAleasa !== null`, current special case).
3. Generalize ranking (`sortLogs`, `ranking.ts`): group by `(wod_id, workout_section_id ?? 'legacy', variant_level)` — the `?? 'legacy'` fallback preserves every existing WOD's exact current single-group behavior.
4. Scope the Scoring Snapshot (§6) and Performance Identity signature (§10) per required-Section rather than per-Workout.
5. Retire `skill_logs`'s 2-slot cap as the growth path (§7 layer 3) — route any 3rd+ non-primary loggable section through the same generalized `wod_logs` write path as required sections, distinguished by `loggingMode` (`'optional'` vs `'required'`) rather than by table.

Each step ships independently and is individually backward-compatible — none requires the next to be complete to be safe to deploy, matching this platform's established additive-migration discipline (Phase 0, Faza 8, Results Phase 2 slices all shipped this way).

---

## 36. Recommendation Summary

Build Phase 1 as Option 1, sequenced per §35. Do not build Segment/interval-split scoring as part of Phase 1 — it is a different, correctly-deferred concept (§13–17 case 11/12). Do not build a new ScoreComponent entity (§20). Treat the leaderboard re-keying (§9, §18 Attempt 5, §35 step 3) as the highest-risk single change and give it the same dual-repo, dual-path test discipline Phase 0's `ranking.test.ts` already established as this platform's working pattern for this exact class of risk.

---

## 37. Final Verdict Block

**A. Can Section be the universal scoring boundary?**
**YES WITH ADDITIVE CHANGES.**

**B. Does Forge need a new ScoreComponent entity?**
**NO.**

**C. Does Phase 0 completion_state survive unchanged?**
**YES.**

**D. Can legacy single-score workouts remain fully backward compatible?**
**YES.**

**E. Can Phase 1 be implemented additively?**
**PARTIALLY.** Schema and RLS: fully additive (nothing dropped, nothing rewritten). Application layer: 3 named non-additive changes required — (1) relax `validateSectionsForLegacy`'s single-primary cap in both repos, (2) rewrite the logging write path from one-implicit-section to iterate-required-sections, (3) re-key both clients' ranking/leaderboard grouping from `wod_id` alone to `(wod_id, workout_section_id)`. All three are contained, well-understood, and individually shippable — "partially additive" describes their nature accurately without overstating the risk.

**F. Is a destructive migration required?**
**NO.**

**G. Is the architecture ready for implementation?**
**GO** — scoped explicitly to "allow more than one independently-scored (`loggingMode:'required'`) Section per Workout." **NOT a GO** for sub-Section Segment/interval-split scoring (§13–17 case 11/12), which remains correctly out of scope and requires its own separate readiness audit if and when it is prioritized.
