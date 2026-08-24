# P0-02 — Unify Gender Resolution & Prescription Logic — Implementation Report

P0-01 is unmodified — no class-deletion/booking-integrity code was touched by this mission.

## 1. Root Cause

Two competing gender-resolution implementations existed for the identical question ("what gender does this member have?"), with **opposite null-handling philosophy**:

- `weightKeyForVariant(nivel, gender)` (`workoutFormats.js`) — inline ternary `gender === 'feminin' ? 'female' : 'male'`. Any non-`'feminin'` value — including `null`, `undefined`, an empty string, or a genuinely invalid value — silently resolved to **male**.
- `resolveAthleteGenderKey(rawGender)` (`rxEngine.js`, added later, Results Phase 3) — explicit `if ('feminin') return 'female'; if ('masculin') return 'male'; return null`. Deliberately returns `null` for anything unresolved, with its own code comment explicitly naming the older helper's behavior as "a real, disclosed bias this engine deliberately does not carry forward."

Both existed because they were built at different times for different purposes (`weightKeyForVariant` builds a DB column name for reading a structured `wods.*_weight_male/female` value; `resolveAthleteGenderKey` feeds a newer engine that substitutes gender-specific weight text embedded directly inside movement descriptions) — but they never converged on one shared "resolve this raw value" step, so the same member's profile could be interpreted differently by two different display surfaces in the same app.

**A second, independently-discovered root cause, found during this investigation's mandatory repo-wide inventory (not part of the original audit finding, but squarely the same class of bug)**: forge-admin-web reads member `gender` from the `profiles` table in two places (`members/api.ts`, `results/api.ts`), while every member-editable write path across the whole platform — confirmed by tracing all three (WOD-SIMPLE onboarding, WOD-SIMPLE profile edit, and the `invitation-final-commit` Edge Function) — writes gender exclusively to `members`. `profiles.gender` is a stale historical column matching the Member Domain migration's own frozen 2026-07-26 decision that identity fields canonically moved to `members` (a risk the prior platform audit's schema-drift pass had already flagged as a looming possibility — this investigation confirms it is not hypothetical, it is live).

## 2. Risk Before Fix — Concrete Examples

- A member with `gender = null` (no gender set — ~12% of members) opens the Log WOD screen: `prescribedWeightPentruLog` (via the buggy `weightKeyForVariant`) resolved to the **male** prescribed weight and fed it into the live RX/Not-RX classification shown while typing their result — while `resolveMovementDisplayText` (via the correct `resolveAthleteGenderKey`) showed **no** gender-specific movement text substitution at all for the exact same member on the exact same screen. Two different silent decisions about the same unresolved profile, on the same page.
- A member who correctly set their gender via WOD-SIMPLE (written to `members.gender`) could be shown as "Gender: —" on their own Admin-visible detail page in forge-admin-web (which read the stale, still-null `profiles.gender`) — and worse, forge-admin-web's leaderboard RX/Not-RX badge for that member's results would have silently used the **male** standard by default in the one code path (`ranking.ts`'s `resolveEntryRxStatus`) that had an unguarded `genderKey === 'female' ? ... : ...` ternary, exactly the anti-pattern this mission's Phase 18/24 explicitly names.
- 11 real members in production (see §3) are demonstrably affected by the `profiles`/`members` table divergence today, independent of any specific ternary bug.

## 3. Production Data

All figures are aggregate counts only, read-only queries, no PII exposed, no data modified.

**Canonical gender distribution (`members.gender`, the confirmed sole write target across all 3 write paths):**
```
male (masculin):   67
female (feminin):  34
null:               14
invalid/legacy:      0
total:             115
```
Zero invalid/legacy values exist — every write path (WOD-SIMPLE onboarding, WOD-SIMPLE profile edit, `invitation-final-commit` Edge Function) independently validates against exactly `{'masculin', 'feminin'}` before writing.

**`profiles.gender` vs `members.gender` divergence (the second root cause, §1):**
```
Total members compared: 115
Diverged rows:            11
  members has a value, profiles is null:  10
  profiles has a value, members is null:   1
  both set but genuinely different value:  0
```
Zero cases of a flatly contradictory value on both sides — the divergence is entirely presence/absence, consistent with `members` being the actively-written table post-migration while `profiles.gender` is a frozen snapshot.

## 4. Canonical Source of Truth

```
Database source:                  members.gender (text, nullable, no DB CHECK constraint - validated
                                   at the application/Edge-Function layer instead, confirmed identical
                                   validation set {'masculin','feminin'} in all 3 write paths)
Canonical TypeScript/JS representation:  'male' | 'female' | null
Canonical resolver:               resolveAthleteGenderKey(rawGender) - rxEngine.js (WOD-SIMPLE),
                                   rxEngine.ts (forge-admin-web, already an existing, correct port)
Null/unknown policy:              Option A - Explicit unknown. null in, null out. Every consumer of
                                   an unresolved gender falls back to its own already-established
                                   "no assumption" behavior (no movement-text substitution, no
                                   prescribed-weight column, no RX/Not-RX classification) rather than
                                   guessing male or female.
```

`profiles.gender` still physically exists (no column was dropped - no destructive schema change was in scope or attempted) but is no longer read by any code path touched by this fix; `members.gender` is the sole source used everywhere gender-dependent behavior occurs.

## 5. Prescription Semantics

Forge represents male/female prescriptions two distinct, already-well-designed ways, neither positional/fragile, both confirmed via direct code reading (not assumed):

1. **Structured columns** (`wods.rx_weight_male`/`rx_weight_female`, and the equivalent per-tier columns for Intermediate/Beginner/OnRamp) — a dedicated column per gender, selected by explicit column-name construction (`weightKeyForVariant`, now delegating to the canonical resolver). Never positional, never array-indexed.
2. **Embedded movement text** (e.g. `"21 Thrusters @ 38/61kg"`) — parsed by `rxEngine.js`/`.ts`'s own regex-based extractor into a structured `{maleKg, femaleKg}` pair, with the male/female positions determined by explicit pattern matching against the text's own `/` separator convention (male first, matching the platform-wide display convention confirmed throughout this session's prior work, e.g. `"43/61 kg"` = male/female) — not a blind `weights[0]`/`weights[1]` array read. No fragile positional logic was found in either repo's critical prescription path; the one place a plain array-splitting risk could have existed (`"35/50".split("/")`-style code) does not exist anywhere gender-relevant in either codebase.

No ambiguous positional interpretation remains in any critical path touched by this fix.

## 6. Consumers Updated

## GENDER CONSUMER MAP

| Consumer | Before | After | Canonical source used |
|---|---|---|---|
| Signup/Onboarding (WOD-SIMPLE) | Writes `members.gender`, validated `{'masculin','feminin'}` client-side only | Unchanged - already correct, not in scope | `members` (write) |
| Profile edit (WOD-SIMPLE) | Writes `members.gender` | Unchanged - already correct | `members` (write) |
| Invitation acceptance (`invitation-final-commit`, Edge Function) | Writes `members.gender`, server-side validated `{'masculin','feminin'}` | Unchanged - already correct | `members` (write) |
| Prescribed-weight lookup / live RX classification while logging (WOD-SIMPLE, `weightKeyForVariant`) | Own inline ternary, silently defaulted unresolved gender to male | Delegates to `resolveAthleteGenderKey`; unresolved gender → `null` (no column, no weight shown/used) | `members` (read, via `userProfile`/`log.profile`, already sourced from `members` - confirmed unchanged) |
| Movement-text gender substitution (WOD-SIMPLE, `resolveMovementDisplayText`) | Already used `resolveAthleteGenderKey` | Unchanged - already correct | `members` |
| Journal / history prescribed-weight display (WOD-SIMPLE) | Via the same buggy `weightKeyForVariant` | Fixed automatically (same function, now correct) | `members` |
| Leaderboard tier filter (WOD-SIMPLE, raw `profile.gender === genderTab` equality) | Raw string equality, not a resolver | **Reviewed, left unchanged** - a null-gender member simply matches neither filter tab, already deterministic and safe (see §10) | `members`, already |
| Admin client gender label (WOD-SIMPLE, `c.gender === 'masculin' ? ... : ...`) | Binary ternary, but gated by `{c.gender && (...)}` | **Reviewed, left unchanged** - never reached for null gender, guard makes it safe today (see §10) | `members`, already |
| Member list / detail (forge-admin-web, `members/api.ts`) | Read `gender` from `profiles` (stale) | Overlays canonical `members.gender` onto the `profiles`-driven row | `members` (new) |
| Leaderboard RX/Not-RX classification (forge-admin-web, `results/api.ts` + `ranking.ts`) | Read `gender` from `profiles` (stale); unguarded `genderKey === 'female' ? femaleValue : maleValue` ternary | Overlays canonical `members.gender`; ternary now explicit-null-first | `members` (new) |
| AI parser (`analyze-workout`) | Never reads/infers member gender at all - confirmed via repo-wide search (zero references) | Unchanged - already correct, out of scope | N/A - parser output is gender-neutral, per-movement `weightMale`/`weightFemale` structured fields only |
| PR system (`movementHistory.js`/`.ts`, PR Engine) | Never references gender at all - confirmed via repo-wide search | Unchanged - already correct, out of scope | N/A |

## 7. Files Changed

| File | Why |
|---|---|
| `src/workoutFormats.js` (WOD-SIMPLE) | `weightKeyForVariant` now delegates to `resolveAthleteGenderKey` instead of its own inline ternary; returns `null` (no column) for unresolved gender instead of silently defaulting to male. |
| `src/workoutFormats.test.js` (WOD-SIMPLE) | Updated the one test that encoded the old buggy "undefined → male" behavior as expected; added explicit null/undefined/empty/invalid coverage and a test proving `weightKeyForVariant` now uses the exact canonical resolver's semantics, not a parallel copy. |
| `src/features/results/api.ts` (forge-admin-web) | `fetchMemberRefsByIds` now overlays canonical `members.gender` onto the `profiles`-driven row it already fetches; every other field (name/email/avatar/weight_unit) is untouched, per the documented precedent for those specific fields. |
| `src/features/results/ranking.ts` (forge-admin-web) | `resolveEntryRxStatus`'s `legacyWeightText` ternary now explicit-null-first, so an unresolved gender can never silently select the male (or female) branch - even though the downstream `resolveSectionStandardKg` guard already made this specific case non-observable today, the ternary itself no longer contains the anti-pattern. |
| `src/features/results/ranking.test.ts` (forge-admin-web) | Added a test that isolates exactly the code path the ternary fix targets (no movement-embedded weight text, forcing fallback to the legacy per-gender columns, unresolved gender) - proves the result stays `null`, never `'rx'`. |
| `src/features/results/fetchMemberRefsByIds.test.ts` (forge-admin-web, new file) | New test file for `fetchMemberRefsByIds`'s canonical-gender-overlay behavior - didn't exist before. |
| `src/features/members/api.ts` (forge-admin-web) | `PROFILE_COLUMNS` no longer selects `gender` from `profiles`; both `fetchMembersPage` and `fetchMemberById` now overlay canonical `members.gender` via a new shared `overlayCanonicalGender` helper. |
| `src/features/members/api.test.ts` (forge-admin-web) | Extended the existing (previously RPC-only) mock to also support `.from()` chains for both `profiles` and `members`; added coverage for both functions' overlay behavior. |

**Explicitly not touched**: P0-01 (class deletion), the movement/PR canonical identity system, the AI parser, scoring/leaderboard ranking logic unrelated to gender, `profiles.gender`'s own column (not dropped, not migrated), name/avatar/email source-table decisions in forge-admin-web (left on `profiles`, per the documented Attendance-module precedent), onboarding/signup UX (not redesigned).

## 8. Database Changes

**No database schema change required.** No migration was written or applied. `profiles.gender` remains physically present (out of scope to drop or migrate its historical data - see §10) but is simply no longer read by any code path this fix touches. No `CHECK` constraint was added, since every real write path already independently validates against the same two values and zero invalid values were found in production.

## 9. Tests

**Added:**
- WOD-SIMPLE `workoutFormats.test.js`: 2 new/rewritten test cases (`weightKeyForVariant` null/undefined/empty/invalid → `null`; confirms delegation to the canonical resolver for the known-value cases).
- forge-admin-web `results/ranking.test.ts`: 1 new test (unresolved gender + legacy per-gender weight column stays `null`, the exact case the fixed ternary protects).
- forge-admin-web `results/fetchMemberRefsByIds.test.ts` (new file): 5 tests covering the overlay in both directions (stale-null overridden, stale-different-value overridden, no-members-row → null, empty-id-list short-circuit, and that only `gender` is overlaid while every other field stays sourced from `profiles`).
- forge-admin-web `members/api.test.ts`: 7 new tests across `fetchMembersPage` (4 cases: stale-null override, stale-different override, missing-row → null, correct id-scoping of the overlay query, empty-page short-circuit) and `fetchMemberById` (2 cases: override, not-found short-circuit).

**Modified:** the one pre-existing `weightKeyForVariant` test that asserted the old buggy behavior.

**Suite results:**
- WOD-SIMPLE: 903/903 real tests pass (same 9 pre-existing, unrelated Deno/`@std/assert` file-level import failures present before this change). Lint: 0 errors. Production build: clean.
- forge-admin-web: 1082/1082 tests pass (1069 pre-existing + 13 new, zero failures, zero regressions). Lint: 0 errors/warnings on every changed file. `tsc -b`: 0 errors. Production build: clean.

## 10. Remaining Gender Logic — Reviewed, Not Modified, Why Each Is Not a Competing Resolver

- **WOD-SIMPLE leaderboard tier filter** (`genderTab === 'masculin' ? ... : genderTab === 'feminin' ? ... : allResults`, and the parallel `l.profile?.gender === 'masculin'`/`'feminin'` row filters): raw equality against an explicit UI tab selection, not a "resolve this member's gender" decision. A member with unresolved gender simply never matches either specific tab (correctly absent from both filtered views, present in the unfiltered "all" view) - deterministic, null-safe by construction, not a fallback that could disagree with any other surface about the same member.
- **WOD-SIMPLE Admin client gender label** (`c.gender === 'masculin' ? MaleLabel : FemaleLabel`): binary ternary, but unreachable for a null/unresolved gender - the entire block is gated by `{c.gender && (...)}` one level up, confirmed by direct reading. Not modified because it is not currently unsafe, not because it was overlooked; flagged here explicitly per this mission's own instruction to review every remaining ternary, not to silently leave anything unexamined.
- **`resolveSectionStandardKg`/`resolveMovementDisplayText`'s own internal `genderKey === 'female' ? ... : ...` ternaries** (both repos' `rxEngine`): each is preceded by its own `if (!genderKey) return null` guard at the top of the same function - the ternary only ever executes once `genderKey` is already guaranteed non-null. Not a competing resolver; this is the canonical resolver's own downstream consumer, correctly gated.
- **`profiles.gender` column itself**: still physically present in the schema, still selected by a handful of other, unrelated forge-admin-web queries that don't use it for anything gender-decision-relevant (confirmed via repo-wide search - no other consumer beyond the two fixed in this mission reads `profiles.gender` for a real decision). Left in place - dropping or migrating it is a schema-level decision out of this P0's narrow scope and was not required to close the confirmed inconsistency.

## 11. Final Invariant

> Given the same stored profile data, Forge now resolves member gender identically across all relevant systems.

**Confirmed**: exactly one function (`resolveAthleteGenderKey`, already existing, already correctly designed, ported identically in both repos) is now the sole gender-resolution logic anywhere in either codebase. `weightKeyForVariant` (WOD-SIMPLE) delegates to it directly. `ranking.ts` (forge-admin-web) already called it directly and now also reads from the same canonical table it's fed from. No other competing implementation was found in the mandatory repo-wide re-search (Phase 24) beyond the two fixed here.

> Missing/invalid gender can no longer silently select opposite male/female prescriptions depending on the code path.

**Confirmed**: every path that resolves a member's gender for a prescription/display/classification decision now either (a) calls `resolveAthleteGenderKey` directly and receives `null` for anything unresolved, with every downstream consumer already correctly treating `null` as "show/assume nothing," or (b) reads its raw gender value from `members` (the confirmed sole write target across all 3 real write paths), never from the stale `profiles` copy. Both are live-verified: `weightKeyForVariant`'s own regression tests, `ranking.ts`'s new isolated test, and the overlay tests in both `members/api.test.ts` and `fetchMemberRefsByIds.test.ts` all directly assert the null-safe / non-diverging outcome.

---

Stopping here per this task's own instruction. P0-03 or any further audit item has not been started.
