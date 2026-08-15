# FORGE — Phase 1B, Layer 2A.5 — Section Identity Stability & Editor Integrity — Implementation Report

**Status: COMPLETE.** Root cause found and proven, fix implemented and committed, 58 regression tests passing (28 WOD-SIMPLE + 30 forge-admin-web), two adjacent architectural questions verified safe via direct database testing. **Live browser re-verification is now also complete** — the earlier-reported stale-deployment blocker was investigated with the `vercel` CLI and found to be a false alarm (premature checks during the build/promotion window, not a stuck pipeline); the correct commit (`cf2b3c2`) was confirmed live via `vercel inspect --logs` + direct bundle `curl`, the exact original bug scenario was re-reproduced against that confirmed-live build and now passes, and a result-safety + Layer 2a regression smoke test were run on top of it. See "Deployment Incident" onward for full detail. All test data created during this final verification pass was removed and confirmed via SQL.

---

## Executive Summary

Layer 2a's own verification pass reproduced a real, serious bug: `legacyPayloadFromSections` mapped non-primary Sections onto `wods.warmup`/`skill`/`skill2` **positionally** (by array index), a deliberate and harmless simplification from Faza 6, back when nothing downstream read `workout_sections` for scoring. Layer 2a made `workout_section_id` a scoring identity (`wod_logs.workout_section_id`), which turned that harmless simplification into a real semantic-corruption risk: adding or removing a Section could silently move an **existing, already-logged** Section's content into a different legacy column — and therefore effectively a different `workout_sections` row's content — while the row's own id (and any `wod_logs` rows already pointing at it) stayed the same. Root cause is proven, not guessed (traced through the exact destructuring/upsert mechanism, then reproduced live with real data before starting the fix). The fix — each Section now carries its own `legacySlot` (which legacy column it was loaded from), used instead of array position to decide where its content is written — is implemented in both repos, unit-tested exhaustively (append/insert/remove/reorder/edit/scored-priority, 9 new tests total), and verified via a production data audit to have caused zero real historical corruption. Two related architectural questions (does the Scoring Snapshot drift when an old result is edited after its Section's format changes; is removing a Section with results destructive) were independently investigated and confirmed already safe by existing, unmodified architecture — no fix needed for either.

## Severity

**P1 (data-integrity), not P0.** No real member data was found corrupted (production audit: 0/193 section-linked results, 0/6 non-empty warmup sections show any evidence of the bug ever having fired against real content). The bug requires a specific, uncommon coach action sequence (marking a Section scored, then adding another Section, in a workout whose Warm-up slot happens to be empty) that had a 0% historical occurrence rate — but it was real, reproducible, and would have corrupted real athletic-result meaning the first time a coach hit it after Layer 2a shipped.

## Reproduction

Reproduced twice, deliberately, with real production data (safe, clearly-named, fully-cleaned-up test workouts):
1. During Layer 2a's own verification: created a workout with a scored Skill section (Back Squat), then added a second scored Skill2 section (Deadlift) and saved. `wods.warmup` ended up containing `["5x5 Back Squat @ 60kg"]` and `wods.skill` ended up containing the Deadlift content — the `workout_sections` row my own already-created `wod_logs` row pointed at (`workout_section_id`, `slot_key='skill'`) silently started showing Deadlift instead of Back Squat.
2. At the start of this mission, before writing any fix: reproduced the identical mechanism cleanly in isolation via the unit test suite (see "Exact Root Cause" below) to confirm the mechanism precisely, independent of any UI timing/state quirks.

## Exact Root Cause

`legacyPayloadFromSections` (both `wodSections.js` and its `sectionEditing.ts` port):

```js
const nonPrimary = sections.filter(s => !s.isPrimary)
const [warmupS, skillS, skill2S] = nonPrimary  // ← positional, not identity-based
```

Combined with `sectionsFromLegacyWod`/`sectionsFromWodRow`'s **conditional reconstruction** — a Warm-up/Skill/Skill2 slot only becomes an editor section at all if it has real content or explicit `visible: false` (deliberate, to avoid showing empty "ghost" cards) — the two behaviors compose into a real bug:

1. A workout is saved with only a Skill section populated (Warm-up empty, so it never appears in the reconstructed editor list at all).
2. The coach adds a new section. The non-primary array is now `[existingSkillSection, newSection]` — position 0, not position 1, because there was never a Warm-up element to occupy position 0.
3. `legacyPayloadFromSections` positionally assigns position 0 → `wods.warmup`, position 1 → `wods.skill`. The **existing** Skill section's content (which the RPC previously upserted into `workout_sections` at `slot_key='skill'`) is now written into `wods.warmup` instead — and on the next Workout Engine V2 sync, that content lands in a **new** `workout_sections` row at `slot_key='warmup'` (since `warmup` was never in `wods` before), while the **new** section's content takes over `slot_key='skill'` — the very row the original `wod_logs.workout_section_id` still points to.

This was **documented, intentional behavior at Faza 6** ("mapare POZIȚIONALĂ, nu pe typeKey... continutul urmeaza pozitia, nu invers") — correct and harmless at the time, because nothing read `workout_sections` for anything binding. Layer 2a is what changed the stakes.

## Why Layer 2a Made This Critical

Before Layer 2a, `workout_section_id` was write-only/display-only. Layer 2a made it the actual join key between a member's persisted athletic result (`wod_logs`) and the Section that result is about. Once that's true, "which content currently lives at this `workout_sections` row" must stay stable for the row's identity to mean anything — otherwise a persisted `time_result` or `sets` value can end up permanently associated with unrelated content.

## Section Identity Model

Unchanged: `workout_sections.id` (real UUID) is stable, kept stable across ordinary edits via the `(workout_id, slot_key)` upsert in `sync_workout_engine_v2`. That part of Phase 1A's/Layer 1's identity model was always correct. The bug was entirely upstream of that — in which **content** the app decided to write to which `slot_key` in the first place.

## Identity vs Position

The fix draws exactly this line. Each `EditableSection` now carries `legacySlot: 'warmup' | 'skill' | 'skill2' | null` — the column it was originally loaded from, set once by `sectionsFromLegacyWod`/`sectionsFromWodRow` and carried through the section's lifetime in editor state. `legacyPayloadFromSections` uses this field, not the section's current array index, to decide which column it writes to. Order (`order_index`, reorder arrows) remains a purely separate, cosmetic concern — already correctly decoupled from identity elsewhere per Phase 1A.

## Sync Algorithm Before

```js
const [warmupS, skillS, skill2S] = nonPrimary
```

Purely positional — the Nth non-primary section in the array always mapped to the Nth legacy column, regardless of what it was or where it came from.

## Sync Algorithm After

```js
const bySlot = { warmup: null, skill: null, skill2: null }
const unassigned = []
for (const s of nonPrimary) {
  if (s.legacySlot && !bySlot[s.legacySlot]) bySlot[s.legacySlot] = s
  else unassigned.push(s)
}
// A new SCORED candidate gets priority on skill/skill2 - warmup has no
// format/scored column at all, so a scored new section landing there
// would silently lose its format and scored flag entirely.
const scored = unassigned.filter(s => s.scored)
const rest = unassigned.filter(s => !s.scored)
for (const slot of ['skill', 'skill2']) {
  if (!bySlot[slot] && scored.length > 0) bySlot[slot] = scored.shift()
}
for (const slot of ['warmup', 'skill', 'skill2']) {
  if (!bySlot[slot] && rest.length > 0) bySlot[slot] = rest.shift()
}
```

A section with an established `legacySlot` always keeps it, regardless of position. Only genuinely new sections (`legacySlot: null` — nothing to protect) fill whatever slots remain, positionally — unchanged behavior for the case that was never risky. The scored-priority pass is a second, independently-motivated correctness fix found while designing this: without it, a brand-new *scored* section could still land in `warmup` (whichever slot the general algorithm tries first), and since `nonPrimaryFields('warmup', ...)` only ever writes `{warmup, warmup_visible}` — no format, no scored flag — a scored new section landing there would silently lose both.

## React State / Key Findings

No React-key or local-state identity issue was found — `EditableSection.id` (the ephemeral `sec-${timestamp}-${seq}` client id used for React `key` props) was never the problem; it already uniquely identified each section object correctly across renders. The bug was entirely in the *value-level* mapping from section objects to legacy database columns, not in how React tracked the section objects themselves.

## Database Findings

- `workout_sections.id`/`slot_key` stability (the upsert-by-`(workout_id, slot_key)` mechanism) was already correct and required no changes.
- The `snapshot_wod_log_context` trigger is `BEFORE INSERT OR UPDATE OF wod_id` — **column-scoped**, confirmed live: editing an existing result's other fields (e.g. correcting a time) does **not** re-fire the snapshot logic, so a later coach edit to a Section's format cannot retroactively drift an already-frozen result's snapshot. No fix needed.
- `workout_sections` → `wod_logs.workout_section_id` is `ON DELETE SET NULL` (not CASCADE) — confirmed live: deleting a Section with results attached leaves the result and its full Scoring Snapshot completely intact, only nulling the live link, identical to the existing "workout deleted" precedent. No fix needed.
- The `workout_section_id` cross-workout integrity check added in Layer 2a (`snapshot_wod_log_context`'s validation branch) was left completely untouched and continues to function.

## Production Historical Audit

Read-only, no mutation:
- `select ... from wod_logs join workout_sections ... where format_snapshot is distinct from ws.format` → **0 of 193** section-linked results show any mismatch between what they were logged under and what their Section currently shows.
- All 6 production `workout_sections` rows with `slot_key='warmup'` that have any format/movement content have `format: null` and `0 logs_against_it` — no real Warm-up section has ever accidentally carried scoreable content that was actually logged against.

**No real member data required repair.** Stop condition A (§44) was not triggered.

## Add Section Behavior

Verified (unit tests + live reproduction before the fix, unit tests after): appending a new section never reassigns an existing section's column. A genuinely new section fills whatever legacy slot remains free.

## Remove Section Behavior

Verified (unit tests + live DB test): removing an existing section frees its column — cleanly, matching the pre-existing "clear the corresponding column" behavior — never inherited by a sibling section. Verified separately at the database level that removing a Section *with results attached* preserves those results and their snapshot completely intact (see Database Findings).

## Reorder Behavior

Verified (unit tests): reordering existing sections no longer changes which legacy column their content lands in — this is the core fix. A brand-new (never-saved) section's position among *other new* sections is still what determines its slot, matching pre-existing, harmless behavior.

## Edit Behavior

Unaffected by design — editing a section's own content in place never touches `legacySlot` or array position.

## Independently Scored Toggle

Verified: toggling `scored` never changes `legacySlot`/identity — only the `*_scored` column and downstream `logging_mode`. Additionally hardened: a newly-created scored section is now routed away from the `warmup` slot specifically (see Sync Algorithm After), since that slot cannot carry a format or scored flag at all.

## Primary Section Behavior

Not specially handled — a demoted former-primary section (no `legacySlot` of its own, since primaries don't have one) falls into the same "new/unassigned" bucket as a genuinely new section and claims whatever slot remains free. This is a reasonable default (there is no prior non-primary identity to protect for a section that was never non-primary before) and is disclosed as a known, low-priority edge case rather than specially engineered — promoting/demoting primary status is not a normal Faza 6 workflow today.

## Quick Create Behavior

Not modified — out of scope, and not implicated: Quick Create's AI-assisted section generation flows into the same `sectionsFromLegacyWod`/`legacyPayloadFromSections` pipeline as manual editing, so it is protected by the same fix without any parser-specific change.

## Variant Generation Behavior

Not modified — Generate Variants/Regenerate with AI operate on the primary section's `variants` field only, entirely orthogonal to `legacySlot`/non-primary column mapping. No interaction found or expected.

## Existing-Result Safety

Verified live at the database level (see Database Findings) for both of the two scenarios the mission specifically calls out: (1) editing an existing result after its Section's scoring format has since changed — safe, snapshot does not drift; (2) removing a Section that has results attached — safe, result and snapshot survive intact, only the live link is cleared.

## Published Workout / Version Semantics

No change to `PROGRAMMING_DOMAIN_ARCHITECTURE.md`'s existing content-stability contract (edits produce no formal "version," but the Scoring Snapshot already provides the practical safety net for logged results, confirmed above). No new versioning mechanism was invented — none was needed once the two adjacent questions were confirmed already safe.

## Scoring Snapshot Compatibility

Confirmed coherent: the snapshot is written once per result (at first INSERT, or on the rare `UPDATE OF wod_id`), never silently re-derived on ordinary edits. Combined with the `legacySlot` fix (which keeps the *underlying* `workout_sections` content from moving), this closes the loop Layer 2a's own report flagged as an open risk.

## Layer 2a Regression Verification

All Layer 2a functionality re-run and confirmed intact via the full test suites (below) — no Layer 2a test needed modification. The `workout_section_id` integrity check, section-scoped snapshot branch, and `wod_logs_with_context` view are all untouched by this mission's changes.

## Security / Integrity Constraints

Unchanged and unweakened. This mission added no new RLS/constraint — the fix is entirely in pure client-side mapping logic (`wodSections.js`/`sectionEditing.ts`), not in any security boundary.

## Tests Added

- WOD-SIMPLE (`wodSections.test.js`): 5 new tests — existing section keeps its column on reorder; inserting a new section doesn't steal an existing one's slot; removing an existing section frees (not reassigns) its column; a full add-then-verify cycle proving the exact originally-reproduced scenario stays correct; (plus the pre-existing positional-behavior tests for genuinely new sections re-verified unchanged).
- forge-admin-web (`sectionEditing.test.ts`): 4 new tests — same coverage, ported exactly, plus a dedicated test proving a new scored section never lands in `warmup` even when `warmup` is the only empty slot.
- One pre-existing WOD-SIMPLE test and one pre-existing Admin test needed their *expectations* updated (not their intent) — both were explicitly asserting the old, buggy positional-reorder behavior as "working as designed" (Admin's was even named "not a no-op," documenting the bug as accepted risk). Updated to assert the new, correct, identity-preserving behavior, with an explanatory comment linking to this report.

## Full Test Counts

- WOD-SIMPLE: 610/610 passing (606 pre-existing + 4 net new, since 5 added replaced/extended around 1 rewritten).
- forge-admin-web: 853/853 passing (846 baseline + 3 from Layer 2a's own snapshot-precedence tests + 4 net new here, one existing test rewritten).
- `tsc -b`: clean.
- ESLint on all touched files: 0 errors, 0 new warnings.

## Build/Lint/Type-check

WOD-SIMPLE `npm run build`: clean. forge-admin-web `tsc -b` + `npm run build`: clean. Both confirmed after the fix, before committing.

## Migration Status

**None required or made.** This mission's fix is entirely in application-layer mapping logic. No schema, RPC, or trigger change.

## Production Verification

**Complete.** Completed and verified live, with real production data, via direct SQL (not just UI):
- Production historical-corruption audit (0 evidence found).
- Scoring Snapshot does-not-drift-on-edit test (constructed a real test Section+result, changed the Section's format, edited the result, confirmed `format_snapshot` unchanged).
- Section-removal-with-results safety test (constructed a real test Section+result, deleted the Section, confirmed the result and its full snapshot survived intact with only `workout_section_id` nulled).
- (New, this pass) The exact original bug scenario, re-reproduced live in the browser against a confirmed-correct production build — see "Final Production Reproduction Test" below.
- (New, this pass) A result-attach-then-edit safety test and a Layer 2a regression smoke test — see the sections below.

## Deployment Incident

The previous session's report disclosed an apparent blocker: re-clicking the exact bug scenario against `forge-delta-ivory.vercel.app` still showed the old buggy behavior, and the served JS bundle appeared to be missing the `legacySlot` fix ~50+ minutes after the fix commit (`7ff15eb`) was pushed, with Vercel's `age`/`x-vercel-cache: HIT` headers growing rather than resetting across repeated checks.

This session investigated with the actual `vercel` CLI (found via `.vercel/repo.json` → project `prj_oTc3Wvts2QUGH0PcP7NsQIT07Gid`, team `team_wNJfFVA2pKB0PPG6CcC1DAxj`, project name `forge`; not available/considered in the prior session). `vercel project ls`, `vercel list forge`, and `vercel inspect <deployment-url> --logs` showed a deployment (`dpl_HwdY4pgyQVCd29HUwDt5JMvGUXQa`, created 11:45:03 UTC) built from exactly commit `cf2b3c2` (the Layer 2a.5 report commit, which includes the `7ff15eb` fix), that succeeded and is aliased to `forge-delta-ivory.vercel.app`. A direct `curl` of the alias (bypassing the browser entirely) confirmed the served bundle is `index-C_87K-wm.js`, containing the string `legacySlot` 4 times (`grep -c`), with a fresh, small `Age` header — not the large, growing one seen before.

**Conclusion: the deployment pipeline was never actually stuck.** The prior session's checks were made during the normal build/promotion window and happened to catch the CDN still serving the previous edge-cached response; by the time of this investigation the correct build was already live. No infrastructure fix was needed, and no fake/empty commit was created to force a redeploy — the existing `cf2b3c2` deployment was used as-is.

## Production Deployment Proof

Two independent signals, both pointing at the same commit:
1. **Vercel platform record**: `vercel inspect dpl_HwdY4pgyQVCd29HUwDt5JMvGUXQa --logs` — source commit `cf2b3c2`, status Ready, aliased to `forge-delta-ivory.vercel.app`.
2. **Served artifact**: direct `curl` of the production alias (not the extension's cached tab) served `index-C_87K-wm.js`, and `grep -c legacySlot` on that exact file returned `4` — the fix string is physically present in what members' browsers download.

Both were re-confirmed at the start of this pass by loading a fresh browser tab, clearing its service worker registrations and caches, and reloading — the tab loaded the same `index-C_87K-wm.js` bundle.

## Final Production Reproduction Test

Reproduced the exact canonical scenario from the mission spec, live, against the confirmed-correct build, as the Coach/Admin (Lucian's account), on `2026-08-15`:

1. Created a new test WOD (`"LAYER2A5 FINAL VERIFY DELETE ME"`, AMRAP 20:00 "10 Burpees") with **only** a Skill section populated: "Back Squat", content `5x5 Back Squat @ 60kg`, toggled **Scorată independent** ON. Saved.
   - Baseline recorded via SQL: `wods.id = 4a32fc15-e072-4888-a5dd-b7aa758759e4`, `skill_scored = true`, `skill = ["5x5 Back Squat @ 60kg"]`, `skill2 = []`, `warmup = []`.
   - Corresponding `workout_sections` row: `id = 0fe1f333-34e4-4d16-b204-0f1bf39b3020`, `slot_key = 'skill'`, `movements = ["5x5 Back Squat @ 60kg"]`.
2. Added a second Section, toggled it **Scorată independent** ON, set it to "Deadlift" / `5x3 Deadlift @ 100kg`. Saved.
3. Verified via SQL immediately after:
   - `wods.skill` **still** `["5x5 Back Squat @ 60kg"]` — unchanged. `wods.skill2` now `["5x3 Deadlift @ 100kg"]`. `wods.warmup` **still `[]`** — the Back Squat content did **not** move there this time.
   - `workout_sections`: the original Back Squat section kept the exact same `id` (`0fe1f333-...`) and `slot_key='skill'`; the new Deadlift section got its own new `id` (`4632c1e7-67f6-4b52-a621-0d653b5c8eb0`) at `slot_key='skill2'`. No row's content was overwritten by another's.

**Result: PASS.** This is the exact sequence that broke in both the Layer 2a and pre-fix Layer 2a.5 reproductions; against the confirmed-live fixed build it now behaves correctly.

## SQL Identity Verification

Before/after states for the reproduction above are captured in full in "Final Production Reproduction Test." Additionally, after performing a further editor operation (see "Layer 2a Integration Smoke Test" below — reordering the two scored Sections), a third SQL check confirmed `wods.skill`/`skill2`/`warmup` and both `workout_sections` rows' `id`/`slot_key`/`movements` were **still** unchanged — reordering alone, post-fix, has zero effect on legacy-column identity, matching the unit-test coverage.

## Layer 2a Integration Smoke Test

This surfaced one clarification worth recording precisely: logging a result against a Skill/Skill2 section (via the member-facing "Loghează Skill Work" UI) writes to the pre-existing **`skill_logs`** table (keyed by `member_id, wod_id, slot`), not `wod_logs` — `wod_logs.workout_section_id` is the path for genuinely new, non-legacy-mapped Sections (added via "+ Adaugă secțiune" with a non-warmup/skill/skill2 type). `skill_logs` was extended with its own `workout_section_id` column as part of the same Layer 2a work, so it carries the identical protection — this was verified directly rather than assumed:

1. Logged a real result against each of the two scored Sections from the reproduction above (Back Squat: "Loghează Skill Work" → note `LAYER2A5 TEST - skill result` → Salvează; Deadlift: same, note `LAYER2A5 TEST - skill2 result`). Both showed the correct, section-scoped "SKILL WORK DONE" / "Editează Skill Work" state (not the old bug where a top-level badge could be triggered by the wrong section — Layer 2a's `logZiWod` scoping fix is still intact).
2. SQL confirmed both `skill_logs` rows resolved to the correct `workout_section_id` and `skill_name_snapshot` (`slot=1` → `Back Squat` → `0fe1f333-...`; `slot=2` → `Deadlift` → `4632c1e7-...`).
3. **Result-safety test (§10):** with both results attached, performed a further editor operation — reordered the two Sections in the Admin UI (moved Deadlift above Back Squat) and saved. Re-ran the SQL check: both `skill_logs` rows **still** resolved to the same `workout_section_id`s with the same `skill_name_snapshot`s — no cross-contamination between the two results caused by the reorder.
4. **Reload/Edit regression check (§11):** hard-reloaded the page (full navigation, not SPA soft-nav) and re-expanded the WOD card. SKILL still showed "Back Squat" (with "Editează Skill Work", i.e. correctly recognized as already logged) and SKILL 2 still showed "Deadlift" — labels and edit-vs-log state survived the reload correctly, and the two results were not swapped despite the underlying Section order having changed.

**Result: PASS.** Both the new Layer 2a.5 identity fix and the pre-existing Layer 2a scoping/snapshot logic behave correctly together, under a real edit performed after real results were already attached.

## Cleanup Verification

All test data created during this final verification pass was deleted via direct SQL and confirmed with a follow-up SQL sweep returning zero rows:
- `skill_logs` (2 test rows, both `LAYER2A5 TEST`) — checked first for any `pr_events.source_skill_log_id` reference (none found, so no CHECK-constraint cleanup ordering issue this time) — deleted.
- `workouts` (1 row, `legacy_wod_id` pointing at the test WOD) — deleted, which cascaded `workout_sections`.
- `wods` (1 row, `"LAYER2A5 FINAL VERIFY DELETE ME"`) — deleted last (FK from `workouts.legacy_wod_id` required this order).
- Verified via SQL: `count(*) = 0` across `wods`, `workouts`, `workout_sections` (by the three specific section ids created), and `skill_logs` (by the two specific log ids created).
- Verified in the browser: after a hard reload, the Home screen shows "Niciun WOD azi" (No WOD today) for `2026-08-15` — the test workout is gone from the live UI, not just the database.

## Test Data Cleanup

Combined with the previous session's cleanup (also verified complete at the time, for the pre-fix reproduction data created against the then-stale bundle): all test data from every reproduction attempt across both sessions has been removed and confirmed via SQL. No test data remains in production.

## Known Limitations

- Primary-section promotion/demotion does not specially preserve a demoted section's identity (disclosed above, low-priority, not a normal workflow today).
- `skill_logs` vs `wod_logs` is a pre-existing architectural split (Skill/Skill2 legacy slots use one table, genuinely new Sections use the other) that predates this mission and was not introduced or changed by it — noted here only because the original report's "Layer 2a Regression Verification" section did not explicitly distinguish the two, and this pass's smoke test made the distinction concrete.

## Final Layer 2b Readiness Verdict

**Is Layer 2b now safe to begin: YES.**

All blocking items are closed:
- The Vercel deployment incident is resolved (was never actually a stuck pipeline — confirmed via CLI + direct bundle inspection).
- The exact original bug scenario has been re-reproduced live against the confirmed-correct production build and now passes.
- SQL identity verification confirms Section identity (`workout_sections.id`/`slot_key`) and legacy-column content stay stable across add, reorder, and save operations.
- A result-safety test with two real logged results attached, followed by a further editor operation (reorder), shows no cross-contamination in either `skill_logs` or the underlying `workout_sections`/`wods` state.
- A minimal Layer 2a regression smoke test (log → save → reload → edit) confirms the pre-existing scoping/snapshot logic still works correctly on top of the Layer 2a.5 fix.
- All test data from this pass and the prior session's reproduction has been removed and confirmed via SQL and live UI.

Per the mission's explicit instruction, Layer 2b (leaderboard regrouping, A+B aggregation, Segment/Attempt work) has **not** been started in this session and remains a separate, future mission.
