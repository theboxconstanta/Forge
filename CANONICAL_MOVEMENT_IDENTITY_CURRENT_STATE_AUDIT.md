# Canonical Movement Identity — Current-State Audit

**Status: Research-only, read-only. Zero writes to production this mission. Feeds `CANONICAL_MOVEMENT_IDENTITY_ARCHITECTURE_V1.md`.**

## Correction to the mission's own premise

The mission brief assumes Forge has no movement catalog and asks "whether Forge even needs one." **That premise is factually out of date.** A real, already-shipped, already-seeded movement catalog exists: the `movements` table (migration `20260819090000_movements_catalog.sql`, "Coach Quick Create Phase 1") plus its seed (`20260820090000_movements_catalog_seed.sql`, "Movement Catalog Consolidation" — see `MOVEMENT_CATALOG_CONSOLIDATION_REPORT.md`, dated before this mission and not in this mission's own reading list). It is global (`gym_id IS NULL`) + gym-scoped hybrid, has an `aliases text[]` column with a GIN index, RLS matching the platform's established multi-tenant content-table pattern, case-insensitive duplicate prevention via two partial unique indexes, and is already wired into both clients' movement autocomplete, the deterministic scaling engine's substitution overrides, and the AI workout parser's prompt context. **465 platform-global rows are live in production today** (verified via read-only SQL this session), 0 gym-custom rows yet.

This changes the mission's actual scope: the open question is **not** "does Forge need a catalog" (it has one) — it is **"why does the catalog stop at authoring/autocomplete, and does Forge need it to reach Results/Movement History/PR identity too."** The rest of this audit is organized around that corrected question.

## 1. Every place "movement" identity currently lives

| # | Representation | Location | What identifies the movement | Structured? |
|---|---|---|---|---|
| 1 | `movements` catalog table | Supabase `movements` (465 global rows) | `id` UUID, `name`, `aliases[]` | **Yes** — real FK-able identity, unused downstream |
| 2 | Static hardcoded lists | `WOD-SIMPLE/src/movements.js`, `forge-admin-web/src/features/programming/movements.ts` | plain display-name string list, ~250-300 names | No — offline/zero-latency autocomplete fallback only |
| 3 | Edge-function resolver | `supabase/functions/analyze-workout/movementCatalog.ts` (`CANONICAL_MOVEMENTS`, `MOVEMENT_ALIASES`, `resolveCanonicalMovement()`) | string → string (raw name → canonical **display text**, never an ID) | Partially — deterministic text normalization, no DB lookup, no ID |
| 4 | `wods.movements_rx` / `_intermediate` / `_beginner` / `_onramp` | Postgres `text[]` columns | free-text line, e.g. `"21-15-9 Thrusters"` | No — one array element can name 0, 1, or several movements |
| 5 | `workout_sections.movements` | Postgres `jsonb` array, per-section | `AiMovement`-shaped objects: `{name, canonicalName, reps, weight, distance, calories, notes, equipment}` | Structurally yes, semantically no — `canonicalName` exists but is **0/358 populated in production** (verified this session) |
| 6 | `wod_logs.sets` / `skill_logs.sets` (movement-keyed formats) | Postgres `jsonb` object | the **object key itself** is the movement name | No — raw string key, see §3 below for how noisy this actually is |
| 7 | `wod_logs.movements_snapshot` / `skill_logs.movements_snapshot` | Postgres `jsonb` array | a frozen copy of `sets`' own key ordering at logging time | No — ordering/rendering aid, not an identity mechanism |
| 8 | `movementHistory.js`/`.ts` `comparisonKey` | Client-side derived string | `` `${normalizeKey(movementName)}::${tier}::${mode}::${repTarget}` `` | No — `normalizeKey` is lowercase+trim+collapse-whitespace only |
| 9 | `pr_events.movement` | Postgres `text` | copy of the same raw string, frozen at PR-event creation | No |
| 10 | `AiMovement.name` / `AiMovement.canonicalName` | AI parser output (`workoutIntelligence.ts`) | raw AI-transcribed text / resolver-normalized text (#3 above) | Partially — `canonicalName` is discarded before `wods.movements_rx` (a flat string array) is ever written; see §4 |

**Ten representations, one real ID-bearing one (#1), and that one has zero readers on the Results/Movement History/PR side.**

## 2. End-to-end trace

```
COACH TYPES / PASTES               "5 Handstand Push-ups"
        │  (movements.js/.ts autocomplete suggests from #1+#2)
        ▼
AI PARSER (analyze-workout)        AiMovement{ name, canonicalName: resolveCanonicalMovement(name) }
        │  composeMovementLine() flattens back to a STRING before storage
        ▼
workout_sections.movements (jsonb) [{name:"5 Handstand Push-ups", canonicalName: null, reps: null, ...}]
        │  (verified: canonicalName is null for all 358 sampled objects in production)
        ▼
wods.movements_rx (text[])         "5 Handstand Push-ups"   -- flat string, structure lost entirely
        │
        ▼  snapshot_wod_log_context / snapshot_skill_log_context trigger (Results Phase 2 Slice 2)
wod_logs.format_snapshot / .format_config_snapshot / .movements_snapshot   -- frozen at logging time
        │
        ▼  member logs a Weightlifting/Strength Sets/Build to Heavy/Superset set
wod_logs.sets  (jsonb, keyed by whatever string the member typed as the row label)
        │
        ▼  extractMovementEntriesFromWodLogs / extractMovementEntriesFromSkillLogs (movementHistory.js/.ts)
        │  normalizeKey(movementName)  -- lowercase + trim + collapse whitespace ONLY
        ▼
comparisonKey = normalizedName::tier::mode::repTarget
        │
        ▼
Movement History (Phase 2) / Current Bests (Phase 6) grouping   -- keyed on raw normalized text
        │
        ▼  Postgres trigger evaluate_movement_prs (Phase 5)
pr_events.movement  -- ALSO raw text, independently derived server-side, never reads `movements` table
```

**Where identity can drift**: every arrow above is a **new, independent normalization of free text** — the coach's typed string, the AI's transcription, the section's `movements` array, the flattened `wods.movements_rx` string, the `sets` key the member (not always the coach!) types at logging time, and the client-side `normalizeKey` are six separate, uncoordinated opportunities for the "same" movement to end up spelled differently. None of them currently reference `movements.id`.

## 3. Production data audit (read-only, via `supabase db query --linked`)

### 3a. Movement-keyed Result data (`wod_logs.sets` / `skill_logs.sets`, movement-keyed formats only)

Very small real dataset: **62 `wod_logs` rows** and **8 `skill_logs` rows** across every movement-keyed format (`Weightlifting`, `Strength Sets`, `Build to Heavy/1RM`) plus the interval-keyed/round-keyed formats that also populate `sets` (`Intervals`, `Complex` — confirmed **not** movement-keyed, see §3c).

Distinct raw keys, `wod_logs`, restricted to rows with a real (non-legacy-null) `format_snapshot`:

| Raw key | Format | Occurrences | Classification |
|---|---|---|---|
| `Power Clean` | Strength Sets | 17 | **Exact catalog match** (`movements.name = 'Power Clean'`) |
| `1 Deadlift (Schema: 1-1-1-1-1-1-1 (seven singles))` | Strength Sets | 10 | Free-text sentence, real movement ("Deadlift") embedded, not extractable deterministically — **ambiguous** |
| `Build to a 3-rep-max front squats` | Build to Heavy/1RM | 10 | Same — real movement ("Front Squat") embedded in a sentence — **ambiguous** |
| `3-3-3-3-3` | Strength Sets | 6 | Not a movement at all — a rep scheme typed as a sets-row label — **unresolved (junk)** |
| `` (empty string) | Strength Sets | 3 | Not a movement — **unresolved (junk)** |
| `1 Clean-grip deadlift` / `1 Clean pull` / `1 Squat clean` | Weightlifting | 2 / 1 / 1 | Real movements, but with a `"1 "` numeral prefix that breaks an exact match against catalog rows `Clean Pull`/`Squat Clean` — **safe with a normalization rule** (strip leading `\d+\s`), not exact-match |
| `Build to a 3-rep-max front squats 100kg` | Build to Heavy/1RM | 1 | Near-duplicate of the row above, with a weight suffix appended | **ambiguous** |

**Result: of 8 distinct raw keys in "clean" (non-null-format) production data, 1 exact-matches the catalog (12.5%), 3 more would match with one additional safe normalization rule (37.5% total), 4 are free text or junk requiring human review or permanent exclusion (50%).**

`skill_logs` (movement-keyed rows only, `format_snapshot='Weightlifting'`): the exact same 3 real movement names (`1 Clean pull`, `1 Clean-grip deadlift`, `1 Squat clean`) appear as `sets` keys, but — this is the concrete, live instance of a real, already-disclosed (Phase 5) limitation — Phase 2/3's own movement-keying rule for `skill_logs` only trusts `format_snapshot='Superset'` for true per-key identity; every other format (including these) pools **all** of a row's sets-keys under the single `skill_name_snapshot` value, here `"Deadlift"`. So today, Movement History shows one fragmented "Deadlift" entry where the raw data actually names three distinct real movements. Canonical identity by itself would not fix this — it's a movement-**keying** rule gap in Phase 2, not a naming gap; noted here as directly relevant context, out of this mission's own scope to fix (§29 boundary).

### 3b. Legacy (`format_snapshot IS NULL`) `wod_logs.sets` data

45 distinct keys across only 14 rows — heavily fragmented, pre-dates the Results Phase 2 Slice 2 snapshot trigger. Representative real keys found: `"Min 2 · Front Squat"`, `"Rundă 1"`…`"Rundă 10"`, `"Min 10 · Bar Muscle-up"` — composite round/time-slot labels, sometimes combined with a movement name via a `" · "` separator, sometimes bare round numbers with no movement at all. **None of these are safely machine-resolvable to a single movement identity** — they are Tier 4 (unresolved) by construction, and this document does not attempt to further classify them. This legacy-null cohort is materially worse-quality than the tagged-format cohort in §3a and should never be treated the same way by any future backfill.

### 3c. Format matrix — which of the 22 formats carry movement identity, and how

| Format | Family / rowMode | Movement representation | PR-eligible today (`prEligible` flag) | Actually movement-keyed for PR/History (`MOVEMENT_KEYED_FORMATS`) |
|---|---|---|---|---|
| AMRAP, Ascending AMRAP, For Time, RFT, Chipper, Ladder, Partner WOD | `scored` | free text in `wods.movements_rx[...]` only, never structured per-log | No | No |
| Death By | `sets`/`interval` | none (round-number keyed) | No | No |
| Death By Weight | `sets`/`interval` | **none stored anywhere** — no movement field in its own config | **Yes** (`prEligible:true`) | **No** — real, pre-existing inconsistency: this format claims PR eligibility at the catalog level but has no movement-keyed data path to ever produce one |
| EMOM, Tabata, Intervals | `sets`/`interval` | round/interval-label keyed (confirmed live: `"Rundă 1"`..`"Rundă 6"`) | No | No |
| Weightlifting | `sets`/`movement` | `sets` object keys | Yes | **Yes** |
| Strength Sets | `sets`/`movement` | `sets` object keys (config also has `setsScheme`, a rep-scheme array, unrelated to movement identity) | Yes | **Yes** |
| Build to Heavy/1RM | `sets`/`movement` | `sets` object keys | Yes | **Yes** |
| Complex | `sets`/`round` | authored `complexMovements` (movementList, in config) exists, but **logged** `sets` is round-keyed (confirmed live: `"Rundă 1"`..`"Rundă 7"`) | Yes | **No** — deliberately deferred (Phase 5), consistent with this audit's own live finding |
| Superset | `sets`/`movement` | both authored `movements` (movementList, in config) **and** logged `sets` object keys | Yes | **Yes** |
| Buy-In/Cash-Out, AMRAP with Buy-In | `mixed` | authored `buyIn`/`cashOut` movementList only, never logged per-movement | No | No |
| Not For Time | `nft` | none (`config: {}`) | No | No |
| Chained AMRAP | `chained` | `stages[].movements` (unstructured `unknown[]` in the TS type — genuinely untyped today) | No | No |
| Max Effort | `scored`/`single_value` | **one** dedicated free-text field, `config.movement` (`movementText` type) | No (not flagged `prEligible`, despite naming exactly one movement) | No |

Two real, pre-existing inconsistencies surfaced by this matrix, both **out of scope to fix here**, both worth carrying into the architecture decision as evidence that `prEligible` (the legacy format-level flag, consumed only by `App.jsx`'s old direct-to-`personal_records` write path and `workoutIntelligence.js`'s scoring heuristic) and "is this format's data actually movement-keyed for the Phase 5 PR engine" (`MOVEMENT_KEYED_FORMATS`, consumed by `movementHistory.js`/`.ts`) are **two different, uncoordinated flags today** — Death By Weight and Max Effort each get one flag but not the other.

### 3d. Backfill simulation (read-only, `movements` catalog vs. real production keys)

Ran directly against production: joined every distinct clean-format `sets` key from §3a against `movements` by exact case-insensitive name and by alias. Result, restated as the mission's own Tier classification:

- **Tier 1 (deterministic exact match)**: `Power Clean` — 1 of 8 (12.5%).
- **Tier 2 (deterministic with one safe, generic normalization rule — strip a leading `"N "` numeral prefix)**: `1 Clean-grip deadlift`, `1 Clean pull`, `1 Squat clean` — 3 of 8 (37.5%), matching catalog rows `Clean-Grip Deadlift`-equivalent/`Clean Pull`/`Squat Clean` once the prefix is stripped. **Not yet run against the catalog in this form** — flagged as Tier 2 based on manual inspection, not an automated match, since implementing the stripping rule would be a (small) new deterministic function this mission does not build.
- **Tier 3 (ambiguous, human review required)**: `1 Deadlift (Schema: ...)`, `Build to a 3-rep-max front squats`, `Build to a 3-rep-max front squats 100kg` — 3 of 8 (37.5%). Each contains a real, identifiable movement substring, but extracting it deterministically (vs. guessing) is not safe.
- **Tier 4 (unresolved, leave as raw text forever)**: `3-3-3-3-3`, `""` — 2 of 8 (25%). Not movements. No future rule should ever attempt to resolve these to an identity.

(Percentages don't sum to 100 because Tier 2 items are also counted once, not double-counted with Tier 1.) **This is a genuinely small, real, already-mostly-tractable problem** — not evidence for a large taxonomy-building effort. The legacy-null cohort (§3b) is separately and permanently Tier 4 by this document's own recommendation.

### 3e. Catalog quality (465 seeded rows)

Spot-checked the seeded catalog itself for the mission's own §31 "movement merge" scenario, treating it as adversarial: **found two already-existing near-duplicate pairs**, `Sots Press` / `Sotts Press` and `Stiff Leg Deadlift` / `Stiff Legged Deadlift` — both spelling variants of the same real movement, both present as **separate rows with separate IDs** in the live catalog today, despite the consolidation migration's own documented dedup pass (which caught 34 similar cases before insert). This is concrete, present-day evidence that "movement merge" (mission §31) is not a hypothetical future scenario to design for abstractly — it already needs a real-world instance solved, non-destructively, whenever this initiative reaches implementation.

## 4. AI parser — actual current contract

`analyze-workout` (Supabase edge function) already outputs `AiMovement{ name, canonicalName, reps, weight, distance, calories, notes }` — structurally identical in shape to the mission's own §20 recommended `{movementId, displayName, confidence}` contract, **except it resolves to a display string (via the deterministic, DB-independent `resolveCanonicalMovement()`), never a `movements.id`, and has no confidence field.** Per `MOVEMENT_CATALOG_CONSOLIDATION_REPORT.md`'s own explicit scope decision, this resolver's "deterministic fallback was NOT extended with a DB-sourced alias parameter — the primary mechanism (prompt injection) already covers gym movement recognition." In other words: gym-specific/custom movement recognition already happens, but purely by **prompt-stuffing the AI model with gym movement names** (`gymMovementContext`) and trusting its free-text output, not by any deterministic post-hoc resolution against the `movements` table. Confirmed live: **0 of 358** `AiMovement`-shaped objects actually persisted in `workout_sections.movements` have a non-null `canonicalName` — whatever resolution exists in code is not reaching the database today, or reaches it and is stripped before persistence (both are consistent with the observed flattening in `composeMovementLine`/`wods.movements_rx` for the older, non-Section representation).

## 5. Existing lifecycle/management surface

`src/features/movements/api.ts` (forge-admin-web) exposes exactly two operations: `fetchMovementsForGym` (SELECT, global+gym-scoped) and `createMovement` (plain INSERT, duplicate-caught via the DB's own case-insensitive partial unique index → `DuplicateMovementError`). **No `updateMovement`, no merge, no deprecate, no alias-edit UI exists anywhere in either repo.** The catalog can grow; it cannot yet be corrected, merged, or retired. This is the direct, current-state confirmation that mission §30-33 (rename/merge/split/deprecation) describe genuinely unbuilt territory, not something to re-verify further.

## 6. What this audit does NOT find

- No `movement_id` foreign key on `wods`, `workout_sections`, `wod_logs`, `skill_logs`, or `pr_events` — confirmed via `information_schema.columns` query, zero `movement_id`-named or FK-typed columns exist referencing `movements.id` anywhere.
- No movement-family/hierarchy table or concept anywhere in either codebase.
- No admin/coach UI screen for browsing, editing, or curating the `movements` catalog directly (only the autocomplete-and-create flow embedded in workout authoring).
- No multilingual movement-name handling — `movements.name`/`aliases` are plain English text with no locale dimension; Forge's existing i18n system (`translations.js`) is UI-chrome-only and has never been applied to movement names.
