# Canonical Movement Identity — Architecture V1

**Status: Proposed for freeze. Research/architecture-only — nothing in this document has been implemented, migrated, or backfilled.**

Companion documents: `CANONICAL_MOVEMENT_IDENTITY_COMPETITIVE_RESEARCH.md`, `CANONICAL_MOVEMENT_IDENTITY_CURRENT_STATE_AUDIT.md`, `CANONICAL_MOVEMENT_IDENTITY_ADVERSARIAL_MATRIX.md`.

## 0. The one-sentence problem this document answers

Forge already has a real, correctly-scoped movement **catalog** (`movements`, 465 seeded rows, global+gym hybrid, aliases, RLS) — but it has **zero readers on the Results/Movement History/PR side**. Every downstream consumer (`movementHistory.js`/`.ts`, `pr_events`, Current Bests) still keys identity off raw, independently-normalized free text. This document specifies the smallest correct way to close that gap without touching Member Performance V1's frozen engine or corrupting historical identity.

## 1. Architectural invariants (MI-1 … MI-10)

Refined from the mission brief against the current-state audit's own findings:

- **MI-1 — Movement identity is semantic, not display text.** `movements.id` is identity; `name`/`aliases`/any snapshot are display.
- **MI-2 — Movement family is not movement identity.** No family/hierarchy concept exists today (audit §6) and none is introduced by this document (see §9).
- **MI-3 — Rep scheme is not movement identity.** Phase 3's `comparisonKey` (`movement::tier::mode::repTarget`) already enforces this correctly for RM tests; canonical identity replaces only the `movement` segment, nothing else.
- **MI-4 — PR eligibility is not movement identity.** Confirmed by the audit's own finding that the format catalog's legacy `prEligible` flag and the PR engine's `MOVEMENT_KEYED_FORMATS` gate already disagree for Death By Weight/Max Effort — canonical movement identity must not become a third, additional arbiter of PR eligibility. That question stays owned entirely by `resolveComparisonIdentity`.
- **MI-5 — Unknown identity is allowed.** `movement_id` must be nullable everywhere it's added. A `NULL` means "not yet resolved," never "invalid."
- **MI-6 — No fuzzy automatic identity.** Confirmed by competitive research: no verified competitor auto-assigns identity from a fuzzy match either. Fuzzy matching's only legitimate role is a coach-facing suggestion (already exists, as autocomplete).
- **MI-7 — Historical snapshots remain immutable.** `format_snapshot`/`format_config_snapshot`/`wod_name_snapshot` (Results Phase 2 Slice 2) are the established precedent; canonical identity adds one sibling field (`movement_id`) to that same snapshot contract, never mutates the existing display fields.
- **MI-8 — Canonical rename does not change identity.** `movements.id` is a UUID primary key; renaming `movements.name` never touches `id`, so nothing downstream that stored `movement_id` needs to change.
- **MI-9 — Custom movements cannot leak across tenants.** Already correctly enforced by the shipped `movements` RLS (audit §0) — this document adds nothing new here, only reuses it.
- **MI-10 — Stale clients cannot erase canonical identity.** Every new field this document proposes is additive and nullable; a client that only ever sends raw text continues to work exactly as today, and never has the power to null out a `movement_id` some other, newer client previously resolved (see §8, dual-write rule).

## 2. Identity vs. family vs. alias vs. performance identity — definitions

| Term | Definition | Owner |
|---|---|---|
| Canonical movement identity | `movements.id` (UUID), the semantic "what movement was this" | This initiative |
| Canonical display name | `movements.name` | This initiative |
| Alias | An entry in `movements.aliases[]` — a different string that resolves to the *same* `movements.id` | This initiative |
| Movement family | A grouping of *distinct* movement identities (e.g. all Snatch variants) | **Deferred** (§9) — not built, not needed for V1 |
| Performance test identity | Phase 3's `comparisonKey` (`movement::tier::mode::repTarget`) | Results domain (Phase 3), unchanged — canonical identity only replaces its `movement` segment |
| Comparison identity | Phase 3's full `{mode, repTarget, comparable}` resolution | Results domain (Phase 5/6), unchanged |
| Result snapshot | The frozen display truth on a `wod_logs`/`skill_logs` row | Results domain (Phase 2 Slice 2), extended additively (§5) |

`MOVEMENT IDENTITY + PERFORMANCE TEST IDENTITY = COMPARISON IDENTITY` (mission §10) is confirmed correct and is exactly how §5 below wires in — canonical identity becomes a strictly *better* input to the same, unchanged Phase 3 formula, not a competing one.

## 3. Global vs. gym-scoped vs. hybrid

**Already decided and shipped: hybrid.** `movements.gym_id` nullable, two partial unique indexes (platform vs. gym scope), RLS scoping reads to `gym_id IS NULL OR gym_id = my_gym_id()`. Competitive research corroborates this as the closest verified pattern to Wodify's own platform-library + gym-custom-components split. **No change recommended.** The one open question the current schema explicitly punts on (`prevent_gym_id_change`'s own comment: "gym_id null is reserved for a future platform-global promotion path... unbuilt") — promoting a gym-custom movement to platform-global — is real but not urgent: 0 gym-custom rows exist in production today (audit §0), so there is no live case to design against yet. Deferred until a real promotion candidate exists.

## 4. Deterministic resolution algorithm

Ordered, deterministic, no fuzzy step ever assigns identity automatically:

1. **Explicit `movement_id`** already attached to the input (e.g. a coach picked a catalog row from autocomplete — the UI already has the ID, no resolution needed).
2. **Exact canonical name match** (case-insensitive) against `movements.name`, scoped to `gym_id IS NULL OR gym_id = :gym`.
3. **Exact alias match** (case-insensitive) against `movements.aliases[]`, same scope.
4. **One safe, generic normalization pass**, then repeat steps 2-3: trim, collapse whitespace, strip a single leading `"N "` numeral-and-space prefix (the audit's own Tier 2 finding — e.g. `"1 Squat clean"` → `"Squat clean"`). This is the **only** transformation this document classifies as safe enough to run automatically before falling back to unresolved (see §11's SAFE/UNSAFE table).
5. **Unresolved.** Store `movement_id = NULL`, keep the raw text as the snapshot. Never guess further.

No confidence score. Per mission §56, deterministic states are preferred over an arbitrary percentage — a resolution is one of exactly `EXACT_ID | EXACT_CANONICAL | EXACT_ALIAS | NORMALIZED_MATCH | UNRESOLVED`, and only the first four ever attach a `movement_id`.

**Ambiguous alias** (mission §54, e.g. an alias string that legitimately matches two different `movements` rows — not observed in production today, but the schema doesn't prevent it): resolution must return `UNRESOLVED`, never pick arbitrarily. This is a real, if currently theoretical, edge case worth a unique constraint consideration at implementation time (`UNIQUE(lower(alias))` scoped per tier), not solved further here.

## 5. Result snapshot contract

Reuses, does not replace, the existing Phase 2 Slice 2 snapshot pattern exactly:

```
wod_logs / skill_logs gain (additive, nullable):
  sets_movement_ids   jsonb   -- { "<original sets key>": "<movements.id> | null" }
```

Not a new top-level `movement_id` column (a `wod_logs` row can carry *multiple* movements in `sets`, one per key) — a **parallel jsonb map, keyed identically to `sets` itself**, populated by the same snapshot trigger family (`snapshot_wod_log_context`/`snapshot_skill_log_context`) at logging time, using the resolver in §4 against that row's own `format_snapshot`-gated movement-keyed status (reuses `MOVEMENT_KEYED_FORMATS`, never runs the resolver against round/interval-labeled `sets` keys like `"Rundă 1"`). The **existing `sets` keys remain the permanent, immutable display truth** (MI-7) — `sets_movement_ids` is purely an enrichment lookup a reader consults *in addition to*, never instead of, the raw key. A legacy row (or an unresolved key) simply has that key missing from the map, which reads identically to `movement_id: null` at every call site (§6).

## 6. Movement History / Current Bests migration path

`comparisonKey` (Phase 3) changes from `` `${normalizeKey(movementName)}::${tier}::${mode}::${repTarget}` `` to:

```
`${entry.movementId ?? `text:${normalizeKey(movementName)}`}::${tier}::${mode}::${repTarget}`
```

i.e. **prefer the resolved ID when present, fall back to the exact same normalized-text key used today when absent.** This is a strictly additive, backward-compatible change to one string template — every existing test, every existing grouping behavior for already-resolved-identically-by-text movements is unchanged; only newly-logged, newly-resolved movements gain the (strictly stronger) ID-based grouping. **No forced migration, no dual grouping displayed side-by-side, no re-derivation of historical `comparisonKey` values** — a member's history simply gets more accurately grouped going forward, at the exact moment enough of their own history has a resolved `movement_id`. `deriveCurrentMovementBests`/`buildCurrentBenchmarkBests` (Phase 6) need zero changes beyond consuming the updated `comparisonKey`.

## 7. PR Engine migration path (Phase 5 — not touched by this mission)

`pr_events.movement` (text) is **not** replaced. Add one additive, nullable column, `pr_events.movement_id`, populated by the same trigger-time resolver call the snapshot in §5 already made (the trigger can read `sets_movement_ids` off the row it's firing on — no second resolution). `evaluate_movement_prs`'s own PR-eligibility/comparison-identity logic is **completely untouched** — `movement_id` is carried alongside `movement` purely so a future Recent-PRs/Current-Bests reader can group by ID instead of text, exactly mirroring §6. This is explicitly **not** part of this mission's own recommended first implementation (§13) — named here only so the eventual PR Engine touch-point is pre-specified and small when its turn comes.

## 8. Stale-client / dual-write safety

Every field this document proposes (`movements.*` already shipped; `wod_logs.sets_movement_ids`, `pr_events.movement_id`) is additive and nullable, populated **server-side, at snapshot/trigger time**, never expected from the client. A stale WOD-SIMPLE build that has never heard of this initiative keeps sending exactly the same `sets` payload it does today; the snapshot trigger resolves `sets_movement_ids` independently of what the client knows, with zero client-side coordination required — reusing the exact additive-schema precedent this codebase already trusts for `aggregate_definition`/`leaderboard_visible` (mission §62's own named precedent, confirmed real by the current-state audit). Legacy sync (`sync_workout_engine_v2`) must be audited **at implementation time** to confirm it never overwrites `sets_movement_ids` with `NULL` on an unrelated field update — flagged as a required implementation-phase check, not solved in this research document.

## 9. What this document deliberately rejects

- **Movement families / hierarchy (mission §8, §49).** Zero competitive evidence found for a member-visible family concept (research doc); zero current Forge consumer would read one. Defer indefinitely; revisit only if a real product need names itself (e.g. an analytics feature that explicitly wants "all Snatch variants" as one bucket).
- **Structured modifier/variant parameters (mission §47-48, e.g. tempo/deficit/pause as first-class fields).** The 465-row seed already encodes some of this as **separate named rows** (`Pause Squat`, `Tempo Squat`, `Sumo Deadlift` vs. `Deadlift`) rather than a modifier system — i.e., Forge's own catalog has already implicitly chosen "distinct row per meaningfully-different variant" over "base movement + structured modifier," for the ~465 cases it covers. This document ratifies that existing choice rather than proposing a parallel modifier system; a genuinely unforeseen modifier (e.g. a load-percentage tempo scheme no catalog row anticipates) falls through to Tier 3/4 (ambiguous/unresolved) exactly like any other un-cataloged text, which is the correct, safe outcome per MI-6.
- **Movement library admin UI (mission §58).** `createMovement` (autocomplete's own "+ Create New Movement") already exists; a dedicated browse/search/manage screen has zero requesters today and would be pure speculative surface area.
- **Confidence scores (mission §56-57).** Deterministic states only (§4). An AI-suggested `canonicalName` remains a suggestion surfaced in the coach-authoring UI, never a stored identity value, matching the audit's own finding that this exact discipline is *already* the codebase's stated intent (`resolveCanonicalMovement`'s design) even though the persistence wiring to prove it in production doesn't exist yet.
- **Immediate PR Engine / Movement History rewrite.** Both migration paths (§6, §7) are additive and lazy — no forced backfill-then-cutover event, no dual-read/dual-write permanent state (mission §64 asks to avoid this; the `?? text:...` fallback in §6 is temporary only in the sense that its need shrinks over time as more history resolves, never a permanently-maintained second code path).
- **Multilingual movement names (mission §42).** Zero present need (audit §6: no locale dimension exists on `movements` at all today, and Forge's translation system has never touched movement text). If it ever becomes necessary, the correct shape is a `movements_i18n` table or a `jsonb` locale map on top of the *existing* identity, never a second identity per language — noted for future-proofing only, not designed further here.

## 10. Deprecation / merge / split — minimal lifecycle

No `status` column exists on `movements` today. This document recommends (not implements) the smallest addition when this becomes real work:

- **Rename**: no schema change needed at all — `id` is stable, `name` is mutable, done (MI-8).
- **Deprecate**: add `movements.deprecated_at timestamptz null` + optional `redirect_to_movement_id uuid null references movements(id)`. A deprecated row is never deleted (Results may reference it via `sets_movement_ids`/`pr_events.movement_id`); reads that need "the current name for this identity" follow `redirect_to_movement_id` once, never a chain (enforce single-hop at write time).
- **Merge** (the audit's own concrete `Sots Press`/`Sotts Press` case): mark the losing row deprecated with `redirect_to_movement_id` pointing at the surviving row. **Never rewrite existing `movement_id` references** — a read-time redirect achieves the same user-visible outcome (both spellings now group together going forward) without a single UPDATE against `wod_logs`/`pr_events`.
- **Split** (mission §32, e.g. "Snatch" turns out to have secretly meant two different things historically): explicitly **not safely automatable**. The correct outcome is: the old, too-broad identity stays exactly as-is for all *existing* references (nothing retroactively reinterpreted, per MI-7/mission §93), and a coach going forward simply starts using the two new, more specific catalog rows. No migration tool for this should ever be built that guesses which historical row meant which split.

## 11. Safe / unsafe transformation classification

| Transformation | Classification |
|---|---|
| trim, collapse internal whitespace | SAFE AUTOMATIC |
| Unicode normalization (NFC) | SAFE AUTOMATIC |
| case-insensitive exact match | SAFE AUTOMATIC |
| exact alias match | SAFE AUTOMATIC |
| strip a single leading `"N "` numeral prefix (§4 step 4) | SAFE AUTOMATIC — one narrow, generic, already-observed-necessary rule |
| strip trailing punctuation (e.g. a stray `.`) | SAFE WITH REVIEW — not observed as necessary in current data, low risk, not included in §4 to keep the resolver minimal |
| remove all punctuation generally | UNSAFE — would silently merge e.g. `"Clean & Jerk"` toward something a plain "Clean Jerk" string could also collide with; not implemented |
| singularize (`"Pull-Ups"` → `"Pull-up"`) | UNSAFE as a generic rule (English plural rules have exceptions relevant to movement names — e.g. "Sit-ups" vs. a hypothetical distinctly-named single-rep variant); handled instead via explicit `aliases[]` entries, which is what the seed data already does |
| expand abbreviations not in the explicit `aliases[]`/`MOVEMENT_ALIASES` list | UNSAFE — exactly mission §17/§18's own instruction; no generic abbreviation-guessing |
| fuzzy/edit-distance matching | UNSAFE for identity assignment (MI-6); SAFE as a UI-only "did you mean" suggestion (already exists via autocomplete) |

## 12. Decision table (mission §50, §99)

| Option | Correctness | Simplicity | Migration safety | SaaS scalability | Custom-movement support | Parser integration | PR compat | Movement History compat | Authoring speed | Future analytics | **Total** |
|---|---|---|---|---|---|---|---|---|---|---|---|
| A. Normalized text only | 3 | 9 | 10 | 3 | 2 | 3 | 4 | 4 | 8 | 2 | 48 |
| B. Catalog table + FK, no aliases | 6 | 7 | 8 | 7 | 5 | 5 | 7 | 7 | 6 | 5 | 63 |
| C. Catalog + aliases (**= what already exists, extended per §5-7**) | 9 | 8 | 9 | 8 | 8 | 8 | 8 | 8 | 8 | 7 | **79** |
| D. Global + gym custom + aliases, fully wired everywhere incl. admin UI/lifecycle | 9 | 5 | 7 | 8 | 9 | 8 | 8 | 8 | 6 | 8 | 76 |
| E. Structured ontology/variant graph (families, modifiers, dimensions) | 9 | 2 | 4 | 6 | 6 | 5 | 6 | 6 | 3 | 9 | 56 |

**Recommendation: Option C** — the catalog + aliases model **already built**, extended only as far as §5-7 specify (Result snapshot map, comparisonKey preference, PR event ID). Option D loses on simplicity/authoring-speed for zero additional correctness this mission's own evidence justifies today (no gym-custom rows exist yet; no lifecycle UI has a real requester). Option E is rejected outright by both the competitive research (no verified competitor builds this) and the audit's own production-volume finding (a handful of real, resolvable movement strings does not justify an ontology).

## 13. Rollout phasing

| Phase | Purpose | Schema | Code | Repos | Backfill policy | Acceptance |
|---|---|---|---|---|---|---|
| **0 (this document)** | Research, decision, freeze | none | none | none | none | This freeze itself |
| **1** | Result-side resolver + snapshot wiring | `wod_logs.sets_movement_ids`, `skill_logs.sets_movement_ids` (additive, nullable jsonb) | Server-side resolver (§4) added to `snapshot_wod_log_context`/`snapshot_skill_log_context`; no client change required | WOD-SIMPLE (migration only, both share one Supabase project) | **None** — new logs only resolve going forward; historical rows keep `sets_movement_ids = NULL` forever unless a future, separately-authorized phase backfills them | New Weightlifting/Strength Sets/Build to Heavy/Superset logs against catalog-matching movement names produce a non-null `sets_movement_ids` entry; legacy rows unaffected; full regression suite green |
| **2** | Movement History / Current Bests prefer ID | `comparisonKey` template change (§6) | `movementHistory.js`/`.ts` | Both | None | Two members logging the same catalog movement with different casing/spelling-alias now group into one Movement History entry going forward; existing groupings for un-resolved text unchanged |
| **3** | PR Engine carries `movement_id` alongside text | `pr_events.movement_id` (additive, nullable) | `evaluate_movement_prs` trigger reads `sets_movement_ids` (already computed in Phase 1, no new resolution) | WOD-SIMPLE (DB) | None | `pr_events.movement_id` populated for new events with a resolved source; zero change to PR eligibility/comparison-identity logic (Phase 5 untouched) |
| **4 (not yet justified)** | Deterministic historical backfill of Tier 1/2 rows only | none (data-only) | one-off script | n/a | Tier 1 exact + Tier 2 normalized-prefix matches ONLY (audit §3d: ~4 real rows platform-wide today) | Explicitly re-authorized separately — current volume (single-digit rows) does not justify a dedicated mission on its own; likely folds into whatever mission next needs it |

Phases 1-3 are each independently shippable, additive, and reversible (drop the new nullable column/field, zero data loss, since nothing else ever depends on it being present). Phase 4 is intentionally listed but **not recommended to schedule** given current real volume.

## 14. Decision Record (mission §98, A–O)

- **A. Does Forge need Canonical Movement Identity now?** **YES** — narrowly, as the Result-side wiring in §5-7, not as a new catalog (already exists).
- **B. Should canonical identity be first-class?** **YES**, via `movements.id`, already the case for authoring; extended to Results per §5.
- **C. Global, gym-scoped, or hybrid?** **Hybrid** — already shipped, unchanged.
- **D. Do we need aliases?** **YES** — already shipped (`aliases[]`, GIN-indexed), unchanged.
- **E. Do we need movement families in V1?** **NO** — deferred (§9).
- **F. Do we need structured variants in V1?** **NO** — the catalog's existing "separate row per variant" pattern is sufficient (§9).
- **G. Should Result store movement_id?** **YES** — via the `sets_movement_ids` map (§5), not a single top-level column (a Result can carry multiple movements).
- **H. Should Result retain movement-name snapshot?** **YES** — already does (`sets` keys themselves); unchanged, remains the permanent display truth.
- **I. Should movement_id be nullable?** **YES** — everywhere, always (MI-5).
- **J. Should fuzzy matching ever automatically assign identity?** **NO** (MI-6).
- **K. Should AI own movement identity?** **NO** — AI suggests (`canonicalName`), the deterministic resolver (§4) decides; this is already the codebase's own stated intent, just not yet wired to persist.
- **L. Can historical data be safely backfilled?** **PARTIALLY** — Tier 1/2 only (~4 real rows today), everything else must remain unresolved forever, per the audit's own live simulation.
- **M. Does PR Engine need immediate migration?** **NO** — Phase 3 in the rollout (§13), not urgent, not part of this mission's own recommended next step.
- **N. Does Movement History need immediate migration?** **NO** — Phase 2 in the rollout, same reasoning.
- **O. Is architecture ready for implementation?** **GO** — narrowly scoped to Phase 1 of §13.

## 15. First implementation mission (mission §101)

**Not** "Canonical Movement Catalog + Alias Resolver Foundation" (the mission's own guess) — that foundation is **already built and live**. The correct, smallest next mission is:

> **"Result-Side Movement Identity Resolution"** — add `sets_movement_ids` (additive, nullable jsonb) to `wod_logs`/`skill_logs`, implement the §4 deterministic resolver server-side inside the existing snapshot triggers (reusing `MOVEMENT_KEYED_FORMATS` to know which `sets` keys are even eligible to attempt resolution against), zero client changes, zero backfill, zero PR Engine/Movement History changes yet (those are Phases 2-3, separately justified once Phase 1 is live and its own resolution rate against real new logs can be measured).
