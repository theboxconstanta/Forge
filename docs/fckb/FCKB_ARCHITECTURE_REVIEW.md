# FCKB Architecture Review

A critical review of `FCKB_ARCHITECTURE_V1.md` (preserved verbatim in this same folder), informed by the full research package this review sits alongside (`WORKOUT_FORMATS.md`, `REP_PATTERNS.md`, `MOVEMENT_CATALOG.md`, `MOVEMENT_ALIASES.md`, `BENCHMARK_WORKOUTS.md`, `HERO_WORKOUTS.md`, `OPEN_WORKOUTS.md`, `PARSER_EDGE_CASES.md`) and by direct, first-hand knowledge of Forge's own already-shipped Programming domain in this codebase — something the source v1.0 document was written entirely without reference to.

## 0. What the Source Document Got Right

Before critiquing, it's worth stating plainly: the three design principles in `FCKB_ARCHITECTURE_V1.md` — **Canonical First**, **Alias Resolution** (never match user input directly to a canonical movement), and **Format-Aware Parsing** (a workout decomposes into Sections → Format → Movements → Rep Scheme → Load/Intensity) — are correct, well-chosen, and this review does not challenge any of them. Every recommendation below is about the SCHEMA and SCOPE built underneath those principles, not the principles themselves. The `movement_aliases` table's `is_abbreviation`/`priority`/`locale` fields are also genuinely good, forward-looking design choices already present in v1.0 that this review explicitly endorses keeping.

---

## 1. The Central Finding: FCKB Was Designed as if Forge's Programming Domain Doesn't Already Exist

This is the single most important finding in this review, and it changes several of the source document's assumptions.

Forge already has a live, production, **frozen** Programming domain (`PROGRAMMING_DOMAIN_ARCHITECTURE.md` v1.1, plus three completed implementation phases in `forge-admin-web`). Specifically:

- `wods` is the authoritative table — one row per `(gym_id, date)`, with movements stored as free-text arrays (`movements_rx`, `movements_intermediate`, `movements_beginner`, `movements_onramp`, plus `warmup`/`skill`/`skill2`).
- Workout Engine V2 (`workouts`/`workout_sections`, a best-effort derived mirror synced via `sync_workout_engine_v2`) maps each `wods` row into a structured `Workout` domain object via `mapLegacyWodToWorkout` (`workoutEngine.js` in WOD-SIMPLE, ported to `forge-admin-web/src/features/programming/workoutMapping.ts`).
- That structured object's `Movement` type **already has a `canonicalName: string | null` field**, populated `null` by every code path that currently constructs one (`legacyMovementText`, confirmed directly in both the source `workoutEngine.js` and the ported `workoutMapping.ts`). This field exists TODAY, in shipped production code, as a stub waiting for exactly what FCKB is supposed to provide, and nothing currently fills it.

The source v1.0 document was written as if FCKB is a greenfield concern feeding some future, unspecified Programming feature. It is not greenfield. It is the thing that finally populates a field Forge's own domain model has been carrying as `null` since Phase 1. This reframes several of the source document's open questions:

- **FCKB's primary integration point isn't a new UI feature — it's a backfill job.** Every `wods` row already in production (years of real, historical gym data) has its `movements_*` arrays sitting as unstructured text right now. FCKB parsing needs to run RETROACTIVELY over that existing data, not just prospectively on new input. The source document's "Initial Dataset Target" section frames FCKB purely as a static catalog to be built once; it says nothing about the migration/backfill workload of actually resolving years of existing free text against that catalog once it exists. **Recommendation**: add an explicit backfill/migration phase to FCKB's own rollout plan, and add a `wod_movement_resolutions` (or similarly-named) linking table — `(wod_id, section_slot_key, source_line_text, resolved_movement_id, confidence_score, resolved_at)` — capturing the OUTCOME of running the parser against existing text, separate from the catalog tables themselves. This also directly serves Section 6 below (confidence scoring).
- **FCKB should not invent its own scaling-level vocabulary.** `wods` already has a real, live, 4-level scaling model (`rx`/`intermediate`/`beginner`/`onramp`, per Programming Phase 2's own `sectionEditing.ts`). The source v1.0 document's `benchmark_workouts`/`hero_workouts`/`open_workouts` tables imply a single flat `canonical_definition` per workout with no scaling-variant structure. **Recommendation**: any named-workout table FCKB introduces should reuse the SAME 4-level (or a documented superset of it) scaling-variant shape `wods` already uses in production, not a new one — both for internal consistency and because Forge's existing `EditWorkoutDialog`/`sectionEditing.ts` UI conventions already know how to render and edit that exact shape.

---

## 2. Weakness: No Format Composition / Nesting Support

Documented extensively across `WORKOUT_FORMATS.md` (Section 17 especially) and surfaced again independently in `PARSER_EDGE_CASES.md` (Section 9, nested EMOMs). Restated as the schema-level finding: the source's `benchmark_workouts.workout_format_id` is a single foreign key, implying one workout maps to exactly one format. This holds for a genuine majority of simple RFT/AMRAP/For Time workouts (confirmed directly in `BENCHMARK_WORKOUTS.md`'s own structural-notes section — the Girls set overwhelmingly fits this shape) but breaks for:

- Buy-In/Cash-Out and AMRAP-with-Buy-In (a nested main block)
- Multi-part competition events (2+ fully independent nested formats under one event)
- Partner/Team formats (a structural modifier layered on a base format, not a separate format in its own right)
- Nested EMOMs (an interval slot containing another interval structure)
- The Bear Complex, cataloged in `BENCHMARK_WORKOUTS.md` — simultaneously a named benchmark, a Wave Ladder format, AND a Complex rep-structure, all three at once, on a movement long, long predating any of the "modern hybrid programming" framing that might otherwise be used to dismiss composition as a new/rare concern.

**Recommendation**: `workout_formats` needs a recursive/nestable shape — either a `parent_format_id` self-reference with a `slot_role` (main | buy_in | cash_out | part_a | part_b...) column, or a JSONB `composition` column on the workout itself describing the nesting explicitly, rather than a single flat FK. This is a real, non-optional schema change, not a nice-to-have — a large fraction of real-world workouts (not just competition-tier ones) need it.

---

## 3. Weakness: No Controlled Scoring-Method Vocabulary

`workout_formats.scoring_type` is specified as a bare field with no enumeration in the source document. `WORKOUT_FORMATS.md` Section 16 proposes a concrete 15-value enumeration (`time_ascending`, `rounds_and_reps`, `reps_completed` with its own sequential-partial semantics, `max_weight`, `points`, etc.) derived directly from every format cataloged in that document. **Recommendation**: adopt that enumeration (or a reviewed variant of it) as a hard `CHECK` constraint or a proper reference table, not a free-text field — scoring-method values are exactly the kind of thing that MUST be a closed set for any leaderboard/PR-comparison feature to work correctly, and a free-text field invites silent drift (two workouts meaning the same scoring concept but stored under slightly different strings).

---

## 4. Weakness: The Mechanical-vs-Stored Alias Conflation

`MOVEMENT_ALIASES.md`'s central argument, restated here as the formal schema recommendation: the source document's own worked example (Power Clean → PC, power clean, power cleans, pwr clean, clean power) treats a MECHANICALLY-DERIVABLE plural/spelling variant ("power clean" vs "power cleans") identically to a genuinely IRREGULAR alias ("PC") that cannot be derived by any rule. Storing every mechanically-derivable form as its own `movement_aliases` row is how the source document arrives at an 8,000–12,000 row target for ~1,200-1,500 movements (roughly 6-10 stored aliases per movement on average) — a number that becomes far less necessary once pluralization/hyphenation/case-folding/spacing are handled as a NORMALIZATION step (applied identically to input text and to canonical names before comparison) rather than enumerated per-movement.

**Recommendation**: split the alias system into two layers, matching `MOVEMENT_ALIASES.md` Section 1's proposal exactly:
1. A small, fixed, code-level (not database-row) set of normalization rules (case-fold, de-pluralize, de-hyphenate/de-space, strip diacritics) applied to BOTH sides of every comparison.
2. A `movement_aliases` table storing ONLY genuinely irregular forms — abbreviations, nicknames, misspellings, cross-community naming, reordered/dropped-word variants — which `MOVEMENT_ALIASES.md` catalogs at ~310 real entries for the ~540-movement catalog this research package produced.

This isn't a smaller or less capable alias system — normalization + ~310 irregular rows covers MORE surface-string variation than 8,000-12,000 individually-authored rows would (a normalization rule generalizes across every movement automatically; an enumerated row only covers the one specific string it was written for), while being dramatically cheaper to build, review, and maintain correctly.

---

## 5. Weakness: No Ambiguous-Alias / Multi-Resolution Support

The source schema's `movement_aliases.movement_id` is a single foreign key, implying every alias resolves to exactly one movement. `MOVEMENT_ALIASES.md` Section 6 and `PARSER_EDGE_CASES.md` Section 2 document real, common abbreviations that do NOT resolve uniquely — "DB" (Dumbbell/Death By), "SC" (Squat Clean/Scaled), "SDL" (Sumo Deadlift/Stiff Leg Deadlift, genuinely unresolvable from the string alone in many cases), "SB" (Sandbag/Snatch Balance), "AB" (Air Bike/Assault Bike/abdominal). A single-FK design cannot represent this at all — it forces an arbitrary, silently-wrong choice of ONE resolution baked into the row.

**Recommendation**: either (a) allow `movement_aliases` to be genuinely many-to-many (an alias row referencing a SET of candidate movements, each with a resolution-context hint — e.g. "preceded by a movement-name-shaped token → Dumbbell; standalone before a colon → Death By"), or (b) introduce a distinct `ambiguous_aliases` table specifically for the collision cases, separate from the clean 1:1 `movement_aliases` table, with an explicit `disambiguation_rule` field describing what surrounding-context signal resolves the ambiguity. Both are viable; either is materially better than silently picking one resolution.

---

## 6. Weakness: No Confidence-Scoring Model Anywhere in the Schema

A cross-cutting gap surfaced by nearly every document in this research package: the loading-pyramid-vs-rep-pyramid collision (`REP_PATTERNS.md` 3.4, flagged as the single highest-consequence ambiguity in the whole rep-pattern catalog), the sets×reps reversed-order risk (`REP_PATTERNS.md` 5.2), the SDL/DB/SC/AB/SB abbreviation collisions (Section 5 above), the "8-10" range-vs-ladder collision (`PARSER_EDGE_CASES.md` 17), OCR/PDF/messaging-app corruption generally (`PARSER_EDGE_CASES.md` Sections 5-7) — the research package as a whole surfaces a genuinely large number of cases where the CORRECT parser behavior is "resolve this with a stated confidence level, and flag low-confidence resolutions for human review" rather than "always produce one clean, certain answer." The source v1.0 schema has no field anywhere — not on `movements`, not on any parsed-workout representation — to carry this information.

**Recommendation**: any table that stores the OUTPUT of running the FCKB parser against real text (the `wod_movement_resolutions` table proposed in Section 1, and equivalently for resolved formats/rep-patterns) needs a `confidence_score` (a normalized 0-1 or similar) and a `requires_review` boolean derived from a threshold. This is not optional polish — it's the difference between FCKB being honest about its own limits (which this whole research package has tried hard to be) and FCKB silently presenting guesses as certainties once it's actually running in production.

---

## 7. Weakness: Missing Format Categories (Summary Cross-Reference)

`WORKOUT_FORMATS.md` Section 18 already lists these in detail; restated here as the architecture-level finding: **five entire format families are absent from the source v1.0 architecture** — Strength & Loading Programming (Straight Sets, Percentage-Based, Wave Loading, named systems like 5/3/1 and Westside, Complexes, Supersets), Partner/Team/Relay/Stations (present only as 3 bare, undefined names), Sport-of-Fitness competition event formats, HYROX-specific formats, Tactical/Military fitness formats, and Endurance programming formats. Given CompTrain/HWPO/PRVN-style programming (all four explicitly named in the mission brief) runs substantial strength and hybrid-endurance content as PRIMARY daily programming, not secondary/rare content, these are not edge-case additions — they're core coverage gaps that would cause FCKB to fail on a large fraction of real modern coach-written programming from day one.

**Recommendation**: treat `WORKOUT_FORMATS.md`'s 55-format catalog (vs. the source's 35-40 bare names) as the actual v1.1 format list, not an optional future expansion.

---

## 8. Weakness: Missing Movement Categories (Summary Cross-Reference)

`MOVEMENT_CATALOG.md` Section 24 lists ten identified gaps; the single largest is **Functional Bodybuilding / Accessory / Isolation** (curls, lateral raises, face pulls, tricep work, calf raises, rotator-cuff work) — entirely absent from the source's taxonomy despite being daily-programmed content in exactly the programming traditions (CompTrain, HWPO, PRVN) the mission names explicitly. Also absent: Plyometric/Agility/Explosive as its own family, Horizontal Pull/Rowing as its own family (barbell rows, cable rows — genuinely different pattern from the vertical bodyweight pulling the source's "Pull Family" actually describes), Sled Work split out from Strongman, Warm-up/Activation drills distinct from static Mobility, Tactical/Rehab/Carries, and Powerlifting-specific equipment variations (bands, chains, specialty bars).

**Recommendation**: treat `MOVEMENT_CATALOG.md`'s 23-category, ~540-movement catalog as the v1.1 baseline.

---

## 9. Open Question: Movement Variants/Modifiers vs. Separate Canonical Movements

Raised explicitly in `MOVEMENT_CATALOG.md` Section 25 and not resolved unilaterally there — resolved here with a recommendation. The question: should "Wide-Stance Front Squat" or "3010-Tempo Back Squat" be their OWN canonical `movements` rows, or should `movements` hold ~540 BASE movements with a separate `movement_modifiers` (stance | tempo | grip | range-of-motion | equipment-variant) layer applied on top?

**Recommendation**: modifiers layer, not separate base movements, for two concrete reasons grounded in this research package's own findings:
1. `WORKOUT_FORMATS.md` Section 7.9 already establishes Tempo as a MODIFIER applicable to any strength format, not a format of its own — the same logic applies at the movement level. A tempo code, a stance width, or a grip width changes HOW a movement is performed, not WHAT movement it is; conflating them would mean the same underlying pattern-recognition/PR-tracking logic has to know about hundreds of near-duplicate movement rows differing only by a modifier, rather than one movement row plus a small, shared modifier vocabulary reusable across every movement that supports it.
2. This mirrors a design choice Forge's OWN production code has already made successfully: `wodSections.js`'s section-editor model treats `format`/`formatConfig` as separate from the movement text itself (Programming Phase 2's own `sectionEditing.ts`, confirmed directly this session) — modifiers-as-a-separate-layer-from-the-base-thing is already Forge's own established pattern, not a novel proposal.

---

## 10. Weakness: `benchmark_workouts` / `hero_workouts` / `open_workouts` as Three Near-Identical Parallel Tables

A real normalization smell: all three tables share almost the same shape (`id`, `name`, `canonical_definition`, a source/origin field), differing only in a couple of category-specific fields (`open_workouts.season`/`workout_code`; implicitly, hero workouts carry tribute/memorial information the other two don't). `BENCHMARK_WORKOUTS.md` Section 4 already flags that the source's own "100+" benchmark target likely conflates all three categories rather than being cleanly scoped to non-Hero non-Open benchmarks alone, itself a symptom of this structural redundancy.

**Recommendation**: consolidate into a single `named_workouts` table with a `workout_category` enum (`benchmark` | `hero` | `open` | `community` — the last added to support gym-scoped custom named benchmarks, mirroring WOD-SIMPLE's own existing `custom_hero_wods` pattern already live in production, per `BENCHMARK_WORKOUTS.md` Section 2's closing note), plus a JSONB or nullable category-specific extension for the handful of fields that genuinely differ (Open's `season`/`division_scaling`, Hero's tribute/memorial fields). This also naturally solves Section 1's scaling-variant recommendation and the multi-part-event nesting from Section 2 for exactly this table family, rather than needing three separate fixes.

---

## 11. Weakness: No Support for Formula-Based Load Prescriptions

`BENCHMARK_WORKOUTS.md` Section 1's note on Linda (`1.5 × bodyweight` deadlift, `1 × bodyweight` bench, `0.75 × bodyweight` clean) is a real, concrete example the source schema's implied flat `canonical_definition` field cannot represent without an undocumented ad-hoc convention. This connects directly to `REP_PATTERNS.md` Section 4.2's bodyweight-percentage notation and is not a one-off oddity — it's a real, if less common, class of prescription (formula-based load, resolved against athlete-specific data at read time, not a fixed literal number) that the schema needs an explicit representation for.

**Recommendation**: `canonical_definition`'s load-prescription shape needs a documented distinction between LITERAL loads (a fixed kg/lb number, the overwhelming majority case) and FORMULA loads (a multiplier against a referenced athlete attribute — bodyweight being the only one this research package found evidence for, but the shape should be general enough not to hardcode "bodyweight" as the only possible reference).

---

## 12. Weakness: No Named-Protocol / External-Standard Reference Data Strategy

A pattern that recurs across three independent documents in this research package, each surfacing it from a different angle: `REP_PATTERNS.md` Section 9 (sprint/HIIT protocols like Norwegian 4x4 and Wingate, referenced by name with no numbers spelled out, requiring a lookup against a known structure); `WORKOUT_FORMATS.md` Section 12.1 (HYROX's fixed 8-station race sequence, with division/gender-specific official loads); `WORKOUT_FORMATS.md` Section 13.2 (military PT tests like ACFT, a fixed named battery with an externally-defined points table). All three are the SAME underlying need — a bare NAME resolving to a full, externally-authoritative structural/scoring definition, exactly analogous to how "Murph" already resolves to a full movement list without the coach needing to restate it (which the source architecture already handles correctly via `hero_workouts`).

**Recommendation**: generalize this pattern into a genuinely reusable capability rather than solving it three separate times — a `named_protocols` reference table (or extending the `named_workouts` consolidation from Section 10 to cover non-CrossFit-native named structures too) covering interval protocols, HYROX's official structure, and PT-test batteries under one mechanism. Explicitly flag that HYROX division-weights and PT-test scoring tables are DATA-MAINTENANCE dependencies on an external authority (not something FCKB derives itself), matching the same honest-sourcing posture `OPEN_WORKOUTS.md` and `HERO_WORKOUTS.md` both took in this research package for content Forge doesn't have verified authoritative access to.

---

## 13. Architectural Recommendation: A Hybrid Static-Asset / Relational-Table Design, Not "Everything Is a Postgres Table"

The most significant STRUCTURAL recommendation in this review, grounded in something the source document's authors could not have known without deep familiarity with this specific codebase: **WOD-SIMPLE already has a working, production precedent for exactly this kind of large reference catalog, and it is NOT a set of Postgres tables.**

`workoutFormats.js`'s `WORKOUT_FORMATS` constant (the 22-format catalog `FormatConfigEditor.jsx` renders from, ported to `forge-admin-web` in Programming Phase 2 as `formatCatalog.ts`), `HERO_WODS_INFO` (the hardcoded benchmark/hero reference dictionary, confirmed directly in `App.jsx` this session and preserved verbatim in this review's own supporting research), and the `MISCARI` movement-name array all live as versioned, code-reviewed, type-checked JavaScript/TypeScript constants — not database rows requiring a migration and an admin UI to add a new movement. This has worked correctly in production for a real, live gym's software for a substantial period of time.

The source v1.0 architecture proposes making the ENTIRE catalog — movements, aliases, formats, rep patterns — into Postgres tables (`movements`, `movement_aliases`, `workout_formats`, `rep_patterns`). For content that changes RARELY, is authored by developers (not end-users) via reviewed pull requests, and needs to be read constantly at parse time with zero latency, this is very possibly the wrong tool, not the obviously-correct default the source document assumes it to be.

**Recommendation, stated as a genuine open question for a follow-up decision rather than something this review resolves unilaterally** (consistent with this whole research package's stated discipline of flagging rather than silently deciding on the user's behalf): a hybrid split, where

- `movements`, `movement_aliases`/`ambiguous_aliases`, `workout_formats`, `rep_patterns`, and `named_protocols` (the pure PARSING-TIME lookup catalogs — high read volume, low write frequency, benefit enormously from compile-time type safety and zero DB round-trip during parsing) ship as versioned TypeScript/JSON assets, following the EXACT pattern `formatCatalog.ts` already establishes in this very codebase, and
- `named_workouts` (Section 10's consolidated benchmark/hero/open/community table) and the backfill-tracking `wod_movement_resolutions` table (Section 1) remain genuine Postgres tables, because they need real relational behavior Forge's UI will actually use — linking a logged PR to a specific named workout, querying "show me every Hero WOD", tracking parse-confidence over time for review workflows.

This isn't a smaller-scope proposal than the source document's — it's the same coverage, split along the axis (read-heavy static reference vs. genuinely relational/queryable data) that actually matters for a system meant to serve production parsing for the next 10 years, and it directly reuses a pattern this codebase has already proven works rather than introducing an entirely new, unproven all-Postgres approach for content this codebase already has a better answer for.

---

## 14. Scalability Risks

- **Regex-based rep-pattern matching performance**: `rep_patterns.regex_pattern` implies running potentially dozens of regexes against every incoming line of text. Not a schema risk, but an implementation risk worth flagging: regex matching should be compiled/cached once, not recompiled per parse call, and pattern ORDER matters (more specific patterns — e.g. the loading-pyramid detector, `REP_PATTERNS.md` 3.4 — need to run before more general ones, like the plain descending-ladder detector, 1.1, to avoid the exact collision that section documents as the highest-consequence ambiguity in the whole rep-pattern catalog).
- **Ambiguous-alias table growth**: bounded by real movement/alias count (Section 5's proposal), not a genuine risk at the scale this research package's catalog implies (~540 movements, ~310 irregular aliases) — flagged only to note it should stay reviewed/curated rather than becoming a dumping ground for every conceivable string variant, which WOULD reintroduce the unbounded-growth risk Section 4's normalization-first design specifically avoids.
- **Historical backfill volume**: Section 1's retroactive-parsing recommendation, applied to years of real production `wods` data, is a genuinely large one-time (or periodic re-run, as the catalog itself improves) batch workload — worth sizing and planning as its own project phase, not assumed to be trivial just because the parsing LOGIC itself is well-specified by this research package.

---

## 15. Parser Limitations (Synthesis)

Every individual limitation is already documented in `PARSER_EDGE_CASES.md`; synthesized here to the handful that matter most for an implementation team prioritizing what to build first:

1. **Format composition (Section 2 above) is the single largest blocker** — without it, a large fraction of real workouts (anything with a buy-in, a partner structure, or a multi-part competition shape) cannot be represented at all, not just parsed imperfectly.
2. **The loading-pyramid vs. rep-pyramid collision** (`REP_PATTERNS.md` 3.4) is the highest-CONSEQUENCE single ambiguity — a misread here doesn't just mislabel a workout, it silently discards the load information entirely, producing a structurally plausible but factually wrong "workout."
3. **Bilingual Romanian/English parsing with decimal-comma numbers** (`PARSER_EDGE_CASES.md` Section 15) is the most PRODUCT-RELEVANT gap specifically for Forge, since it's non-hypothetical for Forge's actual deployment today, unlike most of the mission's own suggested edge-case examples.
4. **No pre-processing/normalization layer for corrupted input sources** (OCR, messaging-app, PDF-extraction artifacts, `PARSER_EDGE_CASES.md` Sections 5-7) is a real gap upstream of FCKB's own alias-resolution pipeline — FCKB's own "Input → Normalize" pipeline step (per the source v1.0 document's own diagram) needs to be understood as including THESE corrections, not just the case/hyphenation normalization this review's Section 4 discusses; the source document's "Normalize" step is underspecified in exactly this direction.

---

## 16. Final Verdict

**APPROVED AS FOUNDATION, WITH REQUIRED REVISIONS BEFORE IMPLEMENTATION.**

The three core design principles (Canonical First, Alias Resolution, Format-Aware Parsing) are sound and this review recommends keeping them unchanged. The specific schema and scope in `FCKB_ARCHITECTURE_V1.md` require the following before implementation begins, in priority order:

1. Format composition/nesting support (Section 2) — without this, the schema cannot represent a large fraction of real-world workouts at all.
2. The mechanical-vs-stored alias split (Section 4) and ambiguous-alias support (Section 5) — without these, the alias system either balloons unmanageably or silently produces wrong resolutions for real, common abbreviations.
3. A confidence-scoring model (Section 6) — without this, the system cannot honestly represent its own, real, well-documented uncertainty on a meaningful fraction of real input.
4. Adoption of this research package's expanded format (`WORKOUT_FORMATS.md`, 55 formats) and movement (`MOVEMENT_CATALOG.md`, ~540 movements, 23 categories) catalogs as the actual v1.1 baseline, given the source's own lists undercounted five entire format families and at least ten movement categories present in real, mainstream modern programming.
5. Explicit connection to Forge's existing, live Programming domain (Section 1) — the `canonicalName` stub, the existing 4-level scaling model, and the historical-backfill requirement are not optional integration details, they are the actual reason FCKB is being built at all in this codebase specifically.
6. A decision (Section 13) on the hybrid static-asset/relational-table question before any table is actually created, given this codebase already has a proven, working alternative to an all-Postgres design for exactly this kind of content.

None of these findings invalidate the mission's ambition or the source document's starting point — they are exactly the kind of gaps a genuine research-and-critique pass is supposed to surface before a decade of production data gets built on top of an under-specified foundation.
