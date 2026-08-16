# Programming Domain Correctness Mission — Skill Section Format Inheritance

**Status:** Investigation complete, narrow hardening fix shipped live in both clients, production-verified, cleaned up.
**Date:** 2026-08-15/16
**Repos:** WOD-SIMPLE (`d173250`), forge-admin-web (`176e836`)
**Follows:** Phase 1B Layer 2b (Section-Aware Leaderboards), whose live verification is where the originally-reported symptom was first disclosed (but not investigated) as an out-of-scope P1.

## 1. The reported symptom

"A Skill Section can silently inherit the primary Section's workout format until the coach manually re-selects/touches the Skill Section's own Format control." Concretely: the Format dropdown visually shows "Weightlifting", but the actually-saved `skill_type` column silently ends up as the primary section's format (e.g. "RFT").

## 2. Investigation — reproduction attempts

Five separate, carefully constructed reproduction attempts were made against production, each verified two independent ways:

- **Direct network-payload interception**: `window.fetch` monkey-patched to capture the exact body of every `PATCH`/`POST` to `/rest/v1/wods` before it left the browser.
- **Direct SQL** against the live `wods` row after save.

Attempts covered: a clean from-scratch creation; the exact original name-injection interaction sequence as originally described; an in-session reorder of sections *before* any result was ever logged; an in-session reorder *after* a real result was logged; and a repeat of the first attempt on a second, independent workout.

**Result: the symptom did not reproduce in any of the five attempts.** In every case, the client sent the correct `skill_type`/`skill2_type` in the payload, and the database ended up correct. All test data from these attempts was deleted and verified via SQL (0 rows across `wods`, `workouts`, `workout_sections`, `skill_logs`, `pr_events`).

**Working theory, not proven**: the original observation session had recurring `Page.captureScreenshot timeout` / "renderer unresponsive" errors from the browser-automation extension, requiring retry-clicks and direct `element.click()` JS workarounds throughout. The most likely explanation is a session-specific browser/extension instability artifact (a stale re-render, a race between an in-flight save and a subsequent read) rather than a deterministic code defect. This is disclosed, not asserted as certain — no code path was ever found that would deterministically cause the reported symptom.

## 3. What the investigation found instead

Tracing the full format lifecycle end-to-end (Parser → Builder State → Format Dropdown → Save Payload → Legacy Sync → `workout_sections` → Reload → Member View → Log Score → Result Source Selection → Leaderboard Comparator) in both `wodSections.js`/`App.jsx` (WOD-SIMPLE) and `sectionEditing.ts`/`EditWorkoutDialog.tsx`/`mutations.ts` (forge-admin-web) surfaced one real, narrow, provable gap, adjacent to but distinct from the reported symptom:

`legacySlot` — the field Layer 2a.5 introduced so a section's legacy-column identity (`warmup`/`skill`/`skill2`) survives reordering — was previously set **only** by `sectionsFromLegacyWod`/`sectionsFromWodRow`, i.e. only on a fresh load of the editor from a saved row. It was **never** set by the save path itself. Concretely:

- WOD-SIMPLE: `saveWod`'s success handler, on the "stay in editor" path (`sectionLabel` truthy — the per-section "Salvează" button), only ever did `setEditWodId`. It never stamped `legacySlot` onto a newly-created section that had just received its first real `wods` column.
- forge-admin-web: `EditWorkoutDialog`'s "Save & Continue Editing" (`doSave(true)`) keeps `sections` React state alive across saves rather than reloading it from the saved row (by design — reloading would discard in-progress edits). Same gap.

**Consequence (unit-test-demonstrated, not observed live)**: a section created and saved once, then reordered relative to another non-primary section *in the same editing session, before the dialog/editor is closed and reopened*, could have its content silently reassigned to a different legacy column on the next save — because `assignNonPrimarySlots` falls back to positional assignment for any section whose `legacySlot` is still `null`.

**Production risk audit (read-only)**:
```sql
select ... from wods where skill_scored = true or skill2_scored = true;        -- 0 rows
select ... from workout_sections ws join workouts w ... 
  where ws.logging_mode = 'required' and ws.slot_key <> 'metcon';              -- 0 rows
```
Zero production workouts have ever used independently-scored Skill/Skill2 sections. **No historical result corruption exists or was possible** — the gap requires the independently-scored-Skill feature, which has zero real usage to date. No STOP-and-report condition was triggered.

## 4. The fix (smallest possible, no new architecture)

Extracted the existing `bySlot` assignment algorithm (unchanged) out of `legacyPayloadFromSections` into a standalone `assignNonPrimarySlots`, and added a companion `legacySlotAssignmentAfterSave` that computes only the *newly*-assigned slots (sections whose `legacySlot` was still `null`) for a section list a save just persisted. Both save paths now call it immediately after a successful save and stamp the returned slots onto in-memory state — exactly mirroring what a reload would have set, without reloading.

- **WOD-SIMPLE**: `src/wodSections.js` (+`assignNonPrimarySlots`, +`legacySlotAssignmentAfterSave`), `src/App.jsx` (`saveWod`'s `sectionLabel` success branch now stamps).
- **forge-admin-web**: `src/features/programming/sectionEditing.ts` (identical port), `src/features/programming/EditWorkoutDialog.tsx` (`doSave` now stamps `sections` state and folds the stamped version into `initialSnapshot` so `isDirty` doesn't spuriously flip true).

No new format model. No destructive migration. No new score-type dropdown. No change to the comparator engine, `skill_logs`/`wod_logs` routing, or leaderboard grouping (all Layer 2b, untouched).

## 5. Automated tests

6 new tests per repo (12 total), all targeting the actual gap found — not a synthetic matrix for the unreproduced symptom, which would have been busywork:

1. Single new scored section gets stamped with its assigned slot.
2. Two new sections get stamped with their two distinct slots.
3. A section that already has a `legacySlot` is never re-added to the stamp map (no-op on reload-seeded sections).
4. An unscored new section lands in `warmup` (first positional slot), not `skill` — documents the existing priority rule, doesn't change it.
5. **The regression test**: stamp after first save → reorder in-session → save again → content stays bound to identity, not position.
6. **The meaningfulness check**: same reorder *without* stamping (`legacySlot` left `null` on purpose) — proves test 5 isn't vacuous by showing the swap *would* happen without the fix.

Full suites: WOD-SIMPLE 636/636 (630 baseline + 6 new), forge-admin-web 874/874 (868 baseline + 6 new). `tsc -b` and `eslint` clean on all changed files in both repos.

## 6. Production verification — Primary Production Acceptance Workout

Built live via forge-admin-web's Programming module (exercising the exact fixed code path):

- **Skill A**: "1RM Clean", format Weightlifting, independently scored.
- **Primary B**: "Layer 2b.1 Acceptance Test", format AMRAP, 10:00 → edited live to 12:00 mid-verification.
- **Skill2 C**: "5RM Back Squat", format Build to Heavy/1RM, independently scored.

Verified via network-payload capture + direct SQL after each step:

1. **First save** (`Save & Continue Editing`): payload correct (`skill_type=Weightlifting/skill_name=1RM Clean`, `skill2_type=Build to Heavy/1RM/skill2_name=5RM Back Squat`).
2. **In-session reorder** (moved Skill A below Skill2 C, no reload) **→ second save**: payload and DB **still correct, not swapped** — this is the exact scenario the pre-fix code would have gotten wrong.
3. **Edit-primary** (duration 10:00 → 12:00) **→ third save**: `skill`/`skill2` columns confirmed untouched.
4. **Full page reload** (genuine re-fetch, not in-session state): read-back identical, Workout Engine V2 sync (`workout_sections`) confirmed correct — `skill`→Weightlifting/1RM Clean, `skill2`→Build to Heavy/1RM/5RM Back Squat, `metcon`→AMRAP.
5. **Member view (WOD-SIMPLE PWA)**: both Skill sections displayed with their own name and format-appropriate "Log Skill Work" UI, showing their own correct description text — no inheritance.
6. **Logged one real result per section** (1RM Clean 100kg, 5RM Back Squat 140kg, AMRAP 8 rounds) — all three routed correctly (`skill_logs` × 2 with correct `workout_section_id` per slot, `wod_logs` × 1).
7. **Leaderboard (both clients)**: three independently-labeled, independently-formatted blocks — "Metcon RX · AMRAP · 8 runde complete", "1RM Clean · 100kg", "5RM Back Squat · 140kg" — byte-identical between the WOD-SIMPLE PWA Leaderboard and forge-admin-web's day-view Results panel.

**Cross-client consistency**: confirmed identical at every step (create in admin → read in PWA required clearing a stale service-worker cache on the test device, unrelated to this fix — see §7).

**Cleanup**: all test rows deleted in FK-safe order (`pr_events` → `wod_logs`/`skill_logs` → `workout_sections` → `workouts` → `wods`). Verified via SQL (0 rows across all 6 touched tables) and live UI ("Niciun WOD azi" restored).

## 7. Incidental finding, disclosed

The WOD-SIMPLE PWA tab did not show the newly-created workout until the browser's stale service worker was unregistered and its caches cleared — a known, previously-documented behavior (`app_version` bump required after every deploy so already-open sessions pick up new code/data promptly; this session's deploy bumped it to `programming-layer2b1-legacyslot-20260815`). Not a regression from this fix; consistent with prior sessions' documented findings.

## 8. Out of scope, not touched

A+B section aggregation, Segment/Attempt architecture, historical result repair (none needed — zero real usage of the affected feature), any change to `skill_logs`/`wod_logs` routing or the leaderboard comparator engine (Layer 2b, unchanged), any expansion of the manual score-type dropdown.

## 9. Verdict

The originally-reported symptom could not be reproduced after five rigorous, evidence-based attempts and is disclosed as unconfirmed (with a working theory pointing at session-specific tooling instability, not a code defect). A real, narrow, adjacent gap in the same "Section identity → format ownership" area was found via code tracing, fixed with the smallest possible change (no new architecture), covered by 12 new regression tests proving both the fix and its necessity, and verified live in production end-to-end across both clients with a purpose-built acceptance workout exercising exactly the fixed code path. Zero production data was ever at risk (zero real usage of the independently-scored Skill/Skill2 feature). All test data cleaned up and verified.
