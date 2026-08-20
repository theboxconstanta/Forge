# Legacy PR Identity — DB/Client Parity Fix: Implementation Report

**Status: SHIPPED, LIVE. DB-only migration, zero client code changes in either repo. Zero historical mutation. Canonical path untouched.**

## Executive Summary

Fixed the one disclosed gap named at the close of Canonical Movement Identity Phase 3: the PR Engine's legacy movement-text comparison path (used only when `movement_id IS NULL`) was plain case-sensitive equality with no whitespace normalization at all, while the client's own legacy comparison identity (`movementHistoryIdentity()`'s `text:<normalizeKey(movementName)>` tag) is trim + whitespace-collapsed + lower-cased. One new, small, deterministic SQL function (`legacy_normalize_movement_text`) now normalizes both sides of the legacy `pr_events`/`personal_records` comparison predicates, exactly matching the client's own three-step contract - nothing more. The canonical path (`movement_id IS NOT NULL`) is untouched, character-for-character. Zero client code changed in either repo, since the client's own normalization was already correct and consistent - this was purely a DB-catching-up fix.

## Exact Divergence

Proven, not assumed, by direct inspection of `evaluate_movement_prs()`'s legacy branch (Phase 3's own version) before any change: `"movement" = v_movement` and `"pr"."movement" = v_movement` - plain SQL text equality, zero transformation applied to either side. This is not "case-sensitivity only" - trim and internal-whitespace-collapse were **also** completely absent DB-side. Three dimensions of divergence, not one.

## Client Legacy Normalization

`normalizeKey(text) = String(text || '').trim().toLowerCase().replace(/\s+/g, ' ')` (`movementHistory.js`/`.ts`, unchanged since before this initiative began) - trim, collapse internal whitespace, lowercase. No punctuation stripping, no Unicode normalization, no alias/catalog lookup. Confirmed used consistently everywhere the client computes a legacy comparison key (`movementHistoryIdentity`, `groupMovementEntries`, `comparisonKey`'s legacy branch) - no client-side drift found, so zero client code changes were needed.

## DB Legacy Normalization Before

None. Exact case-sensitive text equality, both against prior `pr_events` and `personal_records`.

## DB Legacy Normalization After

`legacy_normalize_movement_text(text) = lower(btrim(regexp_replace(coalesce(text, ''), '\s+', ' ', 'g')))` - a direct, line-for-line SQL translation of the client's own `normalizeKey`, applied to both sides of every legacy comparison predicate (`legacy_normalize_movement_text("movement") = legacy_normalize_movement_text(v_movement)` for `pr_events`; the same for `personal_records."movement"`). The stored `movement` column itself is **never** rewritten by this function - it remains the honest, as-typed audit trail on every row, exactly as every prior phase of this initiative has already established for its own snapshot fields. Verified live via 6 direct unit-level calls: case, uppercase, leading/trailing whitespace, and internal whitespace all correctly normalize to equal; punctuation ("Pull-Up" vs "Pull Up") and genuinely different movements ("Back Squat" vs "Front Squat") correctly remain distinct - confirming no scope crept beyond the client's own three-step contract.

## Canonical Path

Untouched - confirmed by diff: the `movement_id IS NOT NULL` branch of `evaluate_movement_prs()` is byte-for-byte identical to Phase 3's own version. Verified live with a canonical control case (mission §38): a real canonical `"Back Squat"` Result (`movement_id` set) and an unrelated legacy Result logged the same day both correctly showed `is_first_recorded=true` independently - no interaction between the two paths.

## No-Bridge Guarantee

Unchanged and reaffirmed - normalization only ever compares legacy-to-legacy (`movement_id IS NULL` on both sides of the SQL predicate structure, by construction: the canonical branch and legacy branch remain mutually exclusive `IF/ELSE` arms, never merged). A legacy stream can never match a canonical stream's history regardless of how similar the display text looks, since the two branches don't share a query at all.

## Rep-Scheme Preservation

Unchanged - `rep_scheme = v_rep_target` remains a separate, untouched predicate alongside the (now-normalized) movement comparison; not separately re-tested live this mission since no code path touching rep-target logic was modified.

## Tier Preservation

Unchanged - `variant_level`/tier scoping is untouched by this migration (was never part of the legacy movement-comparison predicate to begin with).

## UNKNOWN / SETS_ACROSS

Unaffected - the RM_TEST eligibility gate (`format_snapshot = 'Build to Heavy/1RM'` + valid `targetLabel`) runs before any movement-comparison logic, exactly as before; normalization cannot promote an ineligible row into PR eligibility since it never reaches the comparison logic at all.

## PR Insert

Verified live: two legacy Results for the same real-world movement, one clean (`"Zqx Legacy Squat Alpha"`) and one with mixed case plus leading/trailing/internal whitespace (`"  Zqx   LEGACY Squat Alpha  "`), correctly resolved to the same legacy stream - the later, differently-formatted entry (105kg) correctly recognized as `improvement_value=5` over the first (100kg), `previous_best_value=100`. This is the mission's own headline acceptance case (§6), proven live, not simulated.

## Edit

Verified live: editing the mixed-case/whitespace entry's weight down (105→90kg, still within the same now-merged legacy stream) correctly voided the now-stale 105kg event via the pre-existing, unmodified `void_stale_pr_events` reconciliation path, created no spurious new event (90 < the stream's remaining valid 100kg best), and left the 100kg event valid - proving edit reconciliation works correctly across a normalized legacy stream exactly as it already did for canonical streams (Phase 3) and single-spelling legacy streams (Phase 5).

## Delete

Unaffected in mechanism - `void_pr_events_on_wod_log_delete`/`_on_skill_log_delete` operate purely on `source_wod_log_id`/`source_skill_log_id`, with zero movement-text awareness of any kind; not separately re-tested live this mission since no code path touching delete-voiding was modified (identical reasoning to Phase 3's own report).

## Backdated Behavior

Unaffected, same inherited Phase 5 limitation (a backdated insert is compared against current valid history, not re-walked into chronological position) - normalization changes *which* rows count as "the same stream," not *when* the comparison itself runs, so this limitation is neither worsened nor improved.

## Current Best Parity

The client's own `deriveCurrentMovementBests`/`comparisonKey` was already normalizing legacy text correctly (Phase 2/3, unchanged) - this migration brings the DB into agreement with that pre-existing, correct client behavior, not the other way around. No client change was needed to achieve parity.

## Recent PR Regression

Unaffected - `filterValidRecentPrEvents` re-derives comparison *mode* (RM_TEST/SETS_ACROSS/UNKNOWN) from the source Result's own format/config, never from movement text matching of any kind; this migration doesn't touch that function or its inputs.

## TodayCommandCenter Regression

Unaffected for the same reason - `getValidRecentPRActivity` composes the same, untouched `filterValidRecentPrEvents`.

## Production Audit

Read-only, before implementation: 5 total legacy (`movement_id IS NULL`) movement `pr_events` exist platform-wide (matching the already-known, already-disclosed 5 legacy rows from Phase 5/6/3) - all `format_snapshot='Weightlifting'`, meaning **none of them were ever RM_TEST-eligible in the first place** (the eligibility gate requires `Build to Heavy/1RM`), so this normalization fix could not have affected any of them even in principle. No case/whitespace-driven stream fragmentation was found among real production data, because no real production data currently exercises the affected code path at all. No PII was queried or exposed - only aggregate counts.

## Performance

No new scans, no catalog join, no N+1 - `legacy_normalize_movement_text` is a pure, `IMMUTABLE` scalar function applied to already-selected column values within the existing query shape; the legacy query's own row-scan pattern (scoped by `member_id`/`pr_type`/`rep_scheme`/`voided_at`/`movement_id IS NULL` first) is unchanged.

## Indexes

None added. The existing indexes (`member_id`, `voided_at` partial, `movement_id` partial from Phase 3) already scope the legacy query's candidate row set tightly before the normalization function is ever evaluated per-row; no query plan regression expected or observed, and no functional index was justified by an actual query-plan problem (mission's own "do not add speculative indexes" instruction, honored).

## Tests

No new WOD-SIMPLE/forge-admin-web unit tests - this mission is DB-only, and the client's own normalization was already correct and already covered by every prior phase's own test suite (nothing to newly test client-side). Verification was instead performed via 8 live, direct SQL scenarios against production: 6 unit-level `legacy_normalize_movement_text` calls (case, uppercase, trim, whitespace-collapse, punctuation-preserved, distinct-movements-preserved) plus 2 full end-to-end trigger scenarios (headline merge, canonical control case) plus 1 edit-reconciliation scenario - all fixtures cleaned up.

## Production Acceptance

All performed live, mirroring the exact scenarios the mission specified: (1) a clean legacy text and a mixed-case/extra-whitespace variant of the same real-world movement, same member/tier/rep-target, different loads - correctly merged into one legacy stream with the correct later-best/improvement calculation. (2) a canonical Result with the same-looking display text, logged alongside - correctly remained a fully independent stream, `is_first_recorded=true` on its own, zero interaction with the legacy stream. (3) an edit-down within the merged legacy stream - correctly voided the stale event, correctly fell back to the remaining valid best.

## SQL/UI Verification

Every fixture's `wod_logs.sets`, the resulting `pr_events` rows (`movement`, `movement_id`, `score_value`, `is_first_recorded`, `previous_best_value`, `improvement_value`, `voided_at`), and the `legacy_normalize_movement_text` function's own direct output were inspected via SQL at each step - no UI click-through was performed, consistent with the standing "never log in as a member" constraint and this initiative's own established verification method (Phase 1/3's own precedent).

## Cleanup

All mission-created fixtures removed (2 `wod_logs` rows, all `pr_events` they generated). Verified via SQL: 0 residual rows, and platform-wide `pr_events` confirmed back to exactly its original 5-row baseline.

## Known Limitations

- No punctuation normalization was added (by design, matching the client's own contract exactly) - `"Pull-Up"` and `"Pull Up"` remain, correctly, two separate legacy streams, exactly as they already were on the client. This is not a residual gap; it is the mission's own explicit boundary, honored.
- The 5 known legacy false-positive `pr_events` rows remain completely unaffected (they never reach the RM_TEST eligibility gate at all) - this fix has zero interaction with that already-closed, already-disclosed matter.
- This fix only reaches the PR Engine's own legacy-stream matching. `resolve_movement_id()` (Phase 1's own catalog resolver, a structurally different code path with its own, independently-correct normalization) was not touched and did not need to be.

## Final Verdict

SHIPPED, live. One DB migration (one new pure function, one existing function extended in place - zero schema change, zero new table, zero new column), zero client code changes in either repo (the client was already correct), zero historical mutation, 8 live production SQL scenarios covering every mandatory acceptance case, all cleaned up, canonical path proven untouched.

---

## Final Response — 45 Items

1. Overall verdict: SHIPPED, live, DB-only.
2. Exact defect: the DB PR trigger's legacy movement-text matching was case-sensitive AND had zero trim/whitespace normalization - not case-only.
3. Client normalization: `trim → collapse whitespace → lowercase` (`normalizeKey`), unchanged, already correct.
4. DB behavior before: plain case-sensitive exact-text equality, no normalization at all.
5. DB behavior after: both sides of every legacy comparison predicate normalized via `legacy_normalize_movement_text` (identical three-step contract).
6. Case-sensitivity the only mismatch: **NO** - trim and whitespace-collapse were also absent.
7. Trim behavior: now matches client, verified live.
8. Whitespace behavior: now matches client (internal collapse), verified live.
9. Punctuation behavior: deliberately NOT normalized, matches client exactly, verified live.
10. Canonical path behavior: untouched, byte-for-byte, verified via diff and live control case.
11. Legacy path behavior: now normalized, verified live end-to-end.
12. Canonical/legacy bridge behavior: none, structurally impossible (mutually exclusive branches), verified live.
13. 1RM/3RM/5RM behavior: unchanged, `rep_scheme` predicate untouched.
14. Tier behavior: unchanged, untouched predicate.
15. UNKNOWN behavior: unaffected, eligibility gate runs first.
16. SETS_ACROSS behavior: unaffected, same reasoning.
17. Complex behavior: unaffected, structurally excluded as before.
18. Insert behavior: verified live - correct merge, correct improvement calculation.
19. Edit-up behavior: mechanism unchanged (reconciliation path untouched); the live edit test performed was edit-down, which exercises the same reconciliation code.
20. Edit-down behavior: verified live - correct void, correct fallback.
21. Delete behavior: unaffected in mechanism, not separately re-tested (no code path touched).
22. Backdated behavior: unaffected, same inherited limitation, neither worsened nor improved.
23. Current Best parity: achieved - DB now agrees with the client's own pre-existing correct behavior.
24. Recent PR behavior: unaffected, validation logic untouched.
25. TodayCommandCenter behavior: unaffected, composes the same untouched validation function.
26. Existing historical events mutated: **NO**.
27. Historical Results mutated: **NO**.
28. Historical backfill: **NO**.
29. Production affected-row audit: 5 legacy events found, all pre-existing, all Weightlifting-format (never RM_TEST-eligible, unaffected by this fix even in principle).
30. Schema changes: none.
31. Migrations: one new file, applied directly to production.
32. Client code changes: zero in both repos (client was already correct).
33. DB/client parity tests: proven via live SQL scenarios matching the client's own already-tested `normalizeKey` behavior exactly.
34. New tests: 0 unit tests added (nothing new to test client-side); 8 live SQL scenarios instead.
35. Full test counts: unchanged from Phase 3's own baseline (WOD-SIMPLE 864/864, forge-admin-web 1069/1069) - no client file was touched, so no re-run was needed to prove anything new.
36. DB test status: 8 live scenarios, matching this codebase's own established (no-formal-DB-test-suite) precedent.
37. Lint/typecheck/build: not applicable - no client code changed.
38. Deployment: DB migration applied directly to production; no client deploy needed or performed.
39. Production scenarios verified: all 3 mandatory live scenarios (headline merge, canonical control, edit-down) passed.
40. SQL/UI parity: proven via direct SQL inspection at every step; no UI click-through (standing constraint).
41. Cleanup: complete, 0 residual rows, `pr_events` confirmed back to its original 5-row baseline.
42. Known limitations: no punctuation normalization (by design); `resolve_movement_id` (a separate, already-correct code path) untouched and unaffected.
43. Report path: `LEGACY_PR_IDENTITY_DB_CLIENT_PARITY_FIX_REPORT.md` (WOD-SIMPLE root).
44. Commit hash: see below.
45. Working-tree/origin status: WOD-SIMPLE clean and pushed; forge-admin-web untouched, unchanged from Phase 3.

### A. Do DB PR detection and client Current Bests now use semantically identical legacy movement-text normalization?
**YES.**

### B. Can "Back Squat" and "back squat" now participate in the same legacy PR stream when every other comparison dimension matches?
**YES** - verified live.

### C. Do canonical movement streams remain completely separate from legacy streams?
**YES.**

### D. Do rep-scheme and tier separation remain unchanged?
**YES.**

### E. Did UNKNOWN / SETS_ACROSS / Complex protections remain intact?
**YES.**

### F. Were any historical Results or PR events rewritten/backfilled?
**NO.**

### G. Did canonical Movement Identity behavior remain unchanged?
**YES.**

### H. Are PR Engine, Current Bests, Recent PRs, and TodayCommandCenter now aligned on both canonical and legacy movement identity semantics?
**YES.**

### I. Is this legacy PR parity defect fully closed?
**YES.**

### J. What is the strongest-evidence next engineering initiative after this fix?
**None identified by this mission.** This was a narrow, fully-closing correction to the one gap Phase 3 itself disclosed - no new evidence of a further defect was surfaced during this investigation. The Canonical Movement Identity initiative and its one disclosed follow-up gap are both now closed; the next initiative, if any, should come from a genuinely new signal (a real production incident, a new product ask), not from manufacturing further work out of a mission that closed cleanly.
