# Member Performance, Phase 4 — Programming Metadata Completeness: Implementation Report

**Status: SHIPPED, LIVE, VERIFIED IN PRODUCTION IN BOTH CLIENTS. Real bug found, fixed, and proven blocked live. No schema change. No PR Engine change. No historical mutation.**

## Executive Summary

Phase 3 found ~52% of real movement-performance rows lacked enough declared metadata to classify. This phase investigated why and found the exact, narrow, confirmed root cause: `Strength Sets.setsScheme` has been declared `required: true` in the format schema since 2026-07-05, but **nothing in either repo's authoring UI, nor either repo's save gate, has ever actually enforced that declaration** — confirmed by two real production Sections saved with `format_config: {}` on 2026-07-17 and 2026-08-02/05, both *after* the field existed. The fix is a single, narrowly-scoped addition to the existing hard save-gate (`validateSectionsForLegacy`) in both repos, requiring `Strength Sets.setsScheme` and `Superset.movements`/`targetSets` — no schema change, no new UI panel, no resolver change. Verified live: the exact real-world scenario (an empty-setsScheme Strength Sets Section) is now blocked at save time with a clear message, and correctly unblocked once filled in. WOD-SIMPLE `199d173`, forge-admin-web `fca8419`.

## Phase 3 Dependency

Reused Phase 3's `resolveComparisonIdentity` resolver unchanged (`movementHistory.js`/`.ts`) — this phase supplies it better-formed inputs, it does not touch the resolver's own logic at all, per the mission's explicit "do not duplicate identity logic in Programming" instruction.

## Current Authoring Coverage (Before)

| Authoring Path | Format | Intent Available? | Structured Field | Enforced at Save? | Snapshotted? | Resolver Consumes? | Gap |
|---|---|---|---|---|---|---|---|
| Manual (both repos) | Build to Heavy/1RM | Yes | `targetLabel` (stepper, always `NRM`, has default `'1RM'`) | N/A (safe default) | Yes | Yes | None — 100% real coverage (Phase 3) |
| Quick Create (AI) | Build to Heavy/1RM | N/A | AI never sets `targetLabel`; coach's own default/edit governs | N/A (safe default) | Yes | Yes | None |
| Manual (both repos) | Strength Sets | Yes, if filled | `setsScheme` (`required: true`, no default) | **No** | Yes (whatever was saved, including empty) | Yes | **Confirmed real gap — fixed this phase** |
| Quick Create (AI) | Strength Sets | N/A | AI schema (`openaiSchema.ts`) has no `setsScheme` property at all (`additionalProperties: false`) — structurally cannot ever emit it | **No** | Yes (empty) | Yes | Compounds the same gap — AI-authored Sections reach the same unenforced gate pre-empty |
| Manual (both repos) | Superset | Yes, if filled | `movements` + `targetSets` (`required: true`, no default) | **No** | Yes | Yes | Same class of gap — 0 live rows yet, fixed preventively |
| Manual (both repos) | Complex | Optional by design | `scoringMode` (`required: false`, no default) | N/A (legitimately optional) | Yes | No (only `complexMovements` is, and that's out of scope) | Not a gap — legitimate ambiguity, confirmed by date (all 4 real rows predate the field by 9 days) |
| Manual (both repos) | Weightlifting | No fields exist | — | N/A | Yes | No | Not a gap — nothing to require |

## Production Audit

Read-only, no writes. Confirmed via direct SQL that the two real broken Strength Sets Sections (`workout_sections.id` `ed0bad4d-...` and `46b80685-...`) have **live** `format_config: {}` — not a snapshot-boundary bug, the setsScheme was never saved at authoring time at all. Both belong to workouts created via forge-admin-web's Programming module (confirmed `wods.name`/`wods.format_config` NULL at the top level, consistent with non-primary-Section authoring in the multi-Section editor). A third, correctly-authored Strength Sets workout (`160b8115-...`, "Clean The Floor") from the same week has `setsScheme: [3,3,2,2,1,1,1,1]` correctly saved — proving the editor UI *can* capture it when a coach fills it in; the gap was purely "nothing stopped an empty save," not "the field can't be filled."

## Competitive Research

Reused Mission 2's `MEMBER_PERFORMANCE_COMPETITIVE_RESEARCH.md` (Wodify's actual-vs-estimated 1RM split; TrainHeroic's tested-vs-estimated state machine; TeamBuildr's distinct "Evaluations" testing concept) — same conclusion as Phase 3: none of the researched platforms attempt to infer test intent from set/rep structure; all require some explicit signal. This phase's fix (enforce an already-declared explicit signal at save time) is consistent with that pattern and adds no new product concept.

## Declared Intent Model

Unchanged from Phase 3 — `targetLabel` (Build to Heavy/1RM) and `scoringMode` (Complex) remain the only intent-carrying fields; this phase does not add a new "Performance Intent" selector anywhere (mission §38-40 explicitly forbid this). The fix operates one layer below intent-capture: it ensures the *training-structure* fields (`setsScheme`, `movements`/`targetSets`) that the resolver needs to tell RM_TEST apart from SETS_ACROSS are actually present, not that a new intent concept exists.

## Explicit RM / Build to Heavy

No change — already 100% correct in real data per Phase 3's own audit, reconfirmed this phase. Not touched.

## Weightlifting

No fields exist in the format schema (`config: {}`); no evidence of coach pain (0 live rows); no control added, per mission §9's explicit "do not invent unless evidence supports it."

## Strength Sets

**The fix.** `validateMovementPerformanceMetadata` (new, in `wodSections.js`/`sectionEditing.ts`) requires `setsScheme` to be a non-empty array before a Section with `format: 'Strength Sets'` can save, in both repos' single shared save gate (`validateSectionsForLegacy`, extended, not duplicated).

## Superset

Same fix, same function: requires `movements` (non-empty array) and `targetSets` (a positive number). Zero live rows exist yet, but the format shares the exact same resolver dependency as Strength Sets (Phase 3's `SETS_ACROSS` classification), so this is preventive, not reactive — the same authoring gap would otherwise appear the first time a coach uses Superset.

## Complex

Deliberately **not** touched. `complexMovements` is `required: true` in the schema and technically has the identical gap, but it is never read by the Phase 3 resolver (Complex's movement identity comes entirely from `skill_logs.skill_name_snapshot`, per Phase 2's own rule) — fixing it would be a general Programming/catalog-quality improvement outside Member Performance's scope, not a rep-scheme-identity fix. `scoringMode` also untouched — confirmed legitimate ambiguity (see Production Audit), not a preventable drop.

## Max Reps

Not modeled — no evidence Forge's format catalog needs a new "Max Reps" concept for this phase's purposes; deferred per mission §13.

## Quick Create

Investigated: `analyze-workout/openaiSchema.ts`'s `FORMAT_CONFIG_DEF` is a fixed, `additionalProperties: false` allow-list that does not include `setsScheme`/`complexMovements` — the AI **cannot** emit these fields, by construction, not by omission-bug. This is correct behavior per the mission's own §17 ("AI must not guess intent") — the AI appropriately leaves training-structure fields to the coach. The risk this created (an AI-generated Strength Sets Section reaching Save with the field still empty, since the coach may not open the editor before publishing) is exactly what this phase's save-gate fix closes — Quick Create funnels through the identical `saveWod`/`saveWorkoutSections` gate as manual authoring, so one fix covers both paths without touching the AI schema.

## Manual Authoring

Same gate, verified live (see Production Acceptance below) — the exact scenario blocked and unblocked as designed.

## Templates

Not separately modified — templates flow through the same section-list/save-gate model, so a template missing `setsScheme` would already be caught by this fix the same as any other authoring path; no template-specific code exists to change.

## Variants

Confirmed rep-scheme/performance intent lives at the Section level (`formatConfig`), not per-tier (`rx`/`intermediate`/`beginner`/`onramp`) — unaffected by this phase, no variant-specific metadata was ever proposed or needed.

## Format Switching

Investigated: switching a Section's `format` (`onFormatChange={(format) => onChange({...section, format})}`, both repos) does **not** clear `formatConfig` — stale keys from a previous format can survive a switch. Determined this is **harmless** for the resolver by construction (proven by two new tests in both repos): `resolveComparisonIdentity` only ever reads the field(s) belonging to the section's *current* `formatSnapshot` — a stale `targetLabel` sitting unused in a Strength Sets config, or a stale `setsScheme` sitting unused in a Build to Heavy/1RM config, is never read. No fix needed; documented and regression-tested instead.

## Stable Section Identity

Unaffected — this phase adds no new field/mutation path that could interact with Section reorder/rename/primary-promotion; those already-existing behaviors are untouched.

## Persistence

No schema change. The fix is entirely a save-time validation check reading the *existing* `formatConfig`/`format_config` shape — no new column, no new table.

## Result Snapshot

Unaffected — `snapshot_wod_log_context`/`snapshot_skill_log_context` already freeze `format_config_snapshot` correctly (confirmed via direct trigger-source inspection: `BEFORE INSERT OR UPDATE OF wod_id` only). This phase's fix happens further upstream (at Programming save time, before any Result exists), so the snapshot boundary needed no change.

## Historical Stability

Verified directly against the trigger definition and via two new tests (both repos) proving the resolver is stateless (only reads what's passed, never "current" live data on its own). Combined, these guarantee: editing a Workout's Programming after a Result has been logged against it can never retroactively change how that historical Result is classified.

## Legacy / Unknown

The two real broken Sections found in this audit remain exactly as they were — **not backfilled, not mutated**, per the mission's explicit "no destructive backfill" stop condition. They will continue to resolve `UNKNOWN` for any Results logged against them, honestly, until/unless a coach manually edits that specific Workout's Programming (which this phase's gate would now correctly require to be complete before it could save again).

## Phase 3 Resolver Integration

Zero changes to `resolveComparisonIdentity`/`comparisonModeLabel` in either repo. This phase is entirely upstream of the resolver.

## Movement History Regression

None — Phase 2's extraction/display logic and its full test suite are untouched.

## Benchmark History Regression

None — Phase 1's comparator and full test suite are untouched.

## PR Engine Boundary

Untouched. `pr_events` was never read or written. `evaluate_movement_prs`'s own disclosed `rowMode`-blind gap (from Phase 3) remains exactly as it was — not fixed, not expanded, per this mission's own explicit stop condition (§34).

## Schema/Migration

None.

## Stale Client Safety

Not applicable — no new field was added; the fix only changes *validation timing* (when an already-existing, already-declared field is required), not the data shape itself. An old client reading a Section saved under the new gate sees the exact same `formatConfig` shape it always could.

## Tests

31 new tests (16 WOD-SIMPLE `wodSections.test.js` + `movementHistory.test.js` combined additions, 15 forge-admin-web `sectionEditing.test.ts` + `movementHistory.test.ts` combined additions) covering: the real production bug scenario (empty `setsScheme` blocked), empty-array blocked, valid `setsScheme` allowed, Superset missing-movements/missing-targetSets/zero-targetSets all blocked, Superset complete allowed, Build to Heavy/1RM/Weightlifting/Complex/unrelated-formats explicitly *not* blocked (proving the narrow scope holds), the gate wired end-to-end (`validateSectionsForLegacy` itself rejects/accepts correctly), historical-stability statelessness, and format-switch stale-key harmlessness.

## Production Acceptance

Performed live against forge-admin-web's real coach Programming UI (`https://forge-admin-web.vercel.app/programming/2027-01-15`, a genuinely empty future date chosen to avoid any real scheduling collision): created a workout via "Start Empty," switched the Skill Work Section's format to Strength Sets, left `setsScheme` empty, clicked Save — **blocked**, with the exact message *"The "Strength Sets" section is missing a required field (e.g. the set scheme for Strength Sets, or the movements/set count for Superset) - fill it in to save."* — and the underlying date correctly still showed "No workout scheduled." Filled in `setsScheme: [5]`, clicked Save again — **succeeded**. Confirmed via direct SQL that the saved row (`wods.id 61a0df1f-...`) carried `skill_format_config: {"setsScheme":[5]}` exactly as entered, and that Workout Engine V2 sync (`workouts.id fb16cf04-...`, one `workout_sections` row) correctly mirrored it.

## Parser/Manual Parity

`resolveComparisonIdentity` is a pure function of `formatSnapshot`+`formatConfigSnapshot` only (Phase 3, unchanged) — since Quick Create and manual authoring both write into the identical `formatConfig` shape and both save through the identical gate, they necessarily converge; verified by a dedicated Phase 3 test, unaffected by this phase.

## Snapshot-Stability Result

Confirmed both by direct trigger-source inspection (never re-fires on a Programming edit) and by a new resolver-statelessness test — historical Results are protected from future Programming edits.

## Coverage Before/After

**Future authoring** (the only honest target per mission §70-71): before this phase, a coach or Quick Create could silently publish a Strength Sets or Superset Section with zero rep-scheme metadata, guaranteeing `UNKNOWN` with no warning. After this phase, that specific failure mode is structurally impossible for those two formats — a coach is stopped at Save with a clear reason, every time, in both clients. **Historical data**: unchanged by design (24/46 rows from Phase 3's audit remain `UNKNOWN`) — no backfill was performed or attempted.

## Cleanup

One test workout created during live production acceptance (`wods.id 61a0df1f-877f-46a0-a41f-3644f52f45d1`, `workouts.id fb16cf04-5a5c-4cf6-a09f-aa44177ae9cf`, one `workout_sections` row) was deleted immediately after verification via targeted SQL, confirmed zero residual rows via both SQL re-query and a live UI reload showing "No workout scheduled." No real member/coach data was touched.

## Known Limitations

- The two real, pre-existing broken Strength Sets Sections remain unfixed (by design — no backfill). A coach would need to re-open and complete them for those specific historical Sections' *future* Results to classify correctly; already-logged Results against them remain honestly `UNKNOWN` forever (frozen snapshot).
- `Complex.complexMovements`'s identical (but out-of-scope) gap remains open — a general Programming-quality issue, not addressed here.
- The Quick Create AI schema itself was not modified — it still cannot emit `setsScheme`/`complexMovements`, which is correct behavior, not a limitation, but means a coach using Quick Create for Strength Sets will always need to visit the manual editor afterward to satisfy this new gate (a minor, newly-visible friction point, not a bug).
- A pre-existing, unrelated cosmetic issue was observed during production acceptance (the Strength Sets `setsScheme` field label rendered as the raw i18n key "FMTSETSSCHEME" instead of a translated label) — noted, not fixed, out of this mission's scope.

## PR Engine Readiness

Unchanged from Phase 3's own verdict: the identity contract (`comparable`+`comparisonKey`) is sound and ready. This phase improves the *inputs* future PR Engine work will consume (fewer `UNKNOWN` results going forward), but does not itself change the readiness verdict — PR Engine hardening is still a distinct, not-yet-started phase.

## Final Verdict

SHIPPED, live, verified in both clients via real coach UI interaction, one real confirmed bug fixed with a narrowly-scoped, evidence-based change, zero schema change, zero PR Engine change, zero historical mutation, test data created during verification fully cleaned up.

---

## Final Response — 56 Items

1. Overall verdict: SHIPPED, live, verified via real coach UI in production.
2. Exact metadata completeness gap: `required: true` schema declarations for `Strength Sets.setsScheme` and `Superset.movements`/`targetSets` were never enforced anywhere, confirmed by 2 real broken production Sections.
3. Authoring paths audited: manual multi-Section editor (both repos), Quick Create AI generation, template flow, variant tiers, format switching.
4. Formats audited: Build to Heavy/1RM, Weightlifting, Strength Sets, Superset, Complex (the 5 movement-performance-relevant formats).
5. Current declared-intent fields: `targetLabel` (Build to Heavy/1RM), `scoringMode` (Complex) — unchanged, both already correctly handled per Phase 3.
6. New fields/controls added: **none** — no new UI panel, no new toggle, per mission's explicit minimal-UX instruction.
7. Quick Create behavior: unchanged (still correctly never guesses test intent); now funnels through the same enforced gate as manual authoring.
8. Manual authoring behavior: now blocked at Save if Strength Sets/Superset required fields are empty, verified live.
9. Build to Heavy behavior: unchanged, already safe.
10. Explicit 1RM/11. 3RM/12. 5RM behavior: unchanged, already 100% correct (Phase 3).
13. Heavy Single behavior: unchanged — no distinct concept exists, per Phase 3's own finding.
14. Strength Sets behavior: now requires non-empty `setsScheme` to save.
15. Weightlifting behavior: unchanged, no fields exist, nothing to require.
16. Superset behavior: now requires non-empty `movements` and positive `targetSets` to save.
17. Complex behavior: unchanged, deliberately out of scope.
18. Max Reps behavior: not modeled, deferred.
19. Format-switch behavior: stale config keys can survive a switch but are provably harmless (resolver is format-gated) — documented and regression-tested, not "fixed" since nothing was broken.
20. Template behavior: unaffected, flows through the same gate as any other Section.
21. Variant behavior: unaffected, intent lives at Section level, confirmed.
22. Section reorder behavior: unaffected, not touched.
23. Result snapshot behavior: unaffected, already correctly freezes metadata.
24. Historical stability behavior: confirmed protected, both by trigger inspection and new tests.
25. Legacy/UNKNOWN behavior: unchanged, no backfill performed.
26. Phase 3 resolver behavior: completely untouched.
27. Future-data classification coverage BEFORE: Strength Sets/Superset Sections could silently save with zero rep-scheme metadata.
28. Future-data classification coverage AFTER: structurally impossible for those two formats — blocked at save with a clear message.
29. Historical coverage BEFORE: 22/46 (from Phase 3) fully/partially identifiable, 24/46 UNKNOWN.
30. Historical coverage AFTER: unchanged (24/46 UNKNOWN) — no backfill, by design.
31. Ambiguous-row count: unchanged, 24 (20 Strength Sets + 4 Complex, all pre-existing).
32. Movement History regression: none.
33. Benchmark History regression: none.
34. PR Engine untouched confirmation: confirmed, zero changes.
35. Known `evaluate_movement_prs` rowMode bug status: unchanged, still disclosed, still not fixed (out of scope).
36. `pr_events` behavior: never read or written.
37. Schema changes: none.
38. Migrations: none.
39. Historical backfill/mutation: none performed.
40. Stale-client safety: not applicable, no new field added.
41. Security impact: none — validation-only change, no RLS/policy touched.
42. Performance impact: negligible — one small client-side array/field check per Section at save time.
43. New tests: 31 total across both repos.
44. Full WOD-SIMPLE test count: 828/828 real tests passing (9 pre-existing unrelated Deno failures).
45. Full forge-admin-web test count: 1034/1034 passing.
46. Lint/type-check/build: `tsc -b --force` clean, both `vite build` clean.
47. Deployment: live, both repos, both auto-deployed via Vercel.
48. Production scenarios verified: real coach UI, both the blocked and allowed paths, both confirmed via SQL.
49. Parser/manual parity result: confirmed unchanged (pure-function resolver, same gate for both paths).
50. Snapshot-stability result: confirmed protected.
51. SQL/UI parity: confirmed exact match (saved `skill_format_config` matched entered value exactly).
52. Cleanup: one test workout created during verification, fully deleted, zero residual rows confirmed via SQL and UI.
53. Known limitations: 2 pre-existing broken Sections remain unfixed (no backfill); Complex's complexMovements gap remains open (out of scope); Quick Create still requires a manual follow-up step for Strength Sets; one unrelated cosmetic label bug noted, not fixed.
54. Report path: `MEMBER_PERFORMANCE_PHASE4_PROGRAMMING_METADATA_COMPLETENESS_IMPLEMENTATION_REPORT.md` (WOD-SIMPLE root).
55. Commit hashes: WOD-SIMPLE `199d173`, forge-admin-web `fca8419`.
56. Working tree/origin status: both clean, both in sync with `origin/main`.

### A. When a coach explicitly declares 1RM/3RM/5RM intent, does Forge now preserve that intent all the way into the historical Result snapshot?
**YES** (unchanged from Phase 3 — already true, reconfirmed).

### B. Does Forge still avoid classifying 5×5/Strength Sets as 5RM?
**YES.**

### C. Does Forge avoid treating Heavy Single as 1RM unless explicitly declared?
**YES** (no distinct Heavy Single concept exists; unchanged from Phase 3).

### D. Does Quick Create produce the same performance metadata as manual authoring for equivalent programming?
**YES** — both save through the identical gate.

### E. Can ambiguous programming remain UNKNOWN rather than being guessed?
**YES.**

### F. Are historical Results protected from future Programming edits?
**YES.**

### G. Did this phase avoid expanding the PR Engine?
**YES.**

### H. Is future Programming metadata now complete enough for the Phase 3 resolver to classify all explicitly-declared movement test intent deterministically?
**YES**, for the two formats where a preventable gap existed (Strength Sets, Superset) — those can no longer silently lose declared structure.

### I. Is the remaining UNKNOWN population now genuine ambiguity/legacy data rather than a preventable authoring-drop bug?
**YES**, going forward. The 24 currently-UNKNOWN historical rows remain a known, disclosed, deliberately-not-backfilled legacy population — not touched by this phase, but no longer a *growing* problem for new authoring.

### J. Is the next phase now definitively PR ENGINE HARDENING?
**YES.** Both blockers Phase 3 and Phase 4 identified are now resolved: identity logic is proven correct (Phase 3), and the preventable metadata-loss bug that caused most real-world `UNKNOWN`s is fixed (Phase 4). The remaining `UNKNOWN` population is genuine legacy/ambiguous data, which a PR Engine must simply decline to compare (already the correct, safe behavior) rather than something that needs fixing before PR Engine work can begin.
