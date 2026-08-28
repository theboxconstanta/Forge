# FORGE INC-01 — Member Name Fallback Investigation + Fix Report

Investigation-and-fix mission. No PII (names/emails) is printed anywhere in this report — only counts, booleans, and anonymized identifiers.

---

## 1. Executive Verdict

## INC-01 CLOSED

A HIGH-confidence, deterministically-reproducible root cause was found and fixed for every surface where it was actually reachable. One separate, lower-severity, pre-existing mechanism (Feed JWT-expiry) remains, explicitly disclosed as unresolved and out of scope for this mission (see §20).

## 2. Root Cause Classification

## MULTIPLE PROVEN ROOT CAUSES

Two genuinely distinct mechanisms were confirmed:
1. **Wrong-table read** (dominant, HIGH confidence, fixed this mission): 6 call sites across WOD-SIMPLE read display identity (`full_name`/`email`/`avatar_url`) from `members` instead of `profiles`.
2. **JWT-expiry query failure** (secondary, confirmed real but narrow, NOT fixed this mission — see §20): the Feed's own query can fail with `PGRST303` during a stale session, independently of which table it reads from.

These are not the same bug — mechanism 1 is deterministic and data-driven; mechanism 2 is transient and session-driven. Both can affect the Feed surface; only mechanism 1 affects the other 5 surfaces.

## 3. Confidence

```text
Feed:            HIGH (mechanism 1, fixed) + LOW-MEDIUM (mechanism 2, unresolved, narrow)
Admin (forge-admin-web): NOT APPLICABLE - re-investigated independently, found already correct,
                  zero occurrences of mechanism 1 anywhere in that repository
Admin (WOD-SIMPLE's own embedded panel - "Clienti"/Clients list): HIGH (mechanism 1, fixed) -
                  this surface was NOT identified in the original investigation and is a genuine
                  new finding of this mission
Leaderboard:      HIGH (mechanism 1, fixed)
Class roster (Home screen "who's booked" + Admin class-detail equivalent): HIGH (mechanism 1, fixed)
Journal, Profile, bookings/scheduling flows themselves: NOT AFFECTED - traced, do not read
                  member identity for other members at all (Journal shows only the logged-in
                  member's own data)
```

## 4. "Member" Fallback Inventory

| Repo | File | Function | Surface | Trigger Condition (pre-fix) | Data Source (pre-fix) | Classification |
|---|---|---|---|---|---|---|
| WOD-SIMPLE | `App.jsx` (`fetchAll`, ~line 2158) | Feed post authors | Feed | `members.full_name` empty for the post's author | `members` (batch `.in`) | **RELEVANT — FIXED** |
| WOD-SIMPLE | `App.jsx` (`fetchAll`, ~line 2196) | Feed comment authors | Feed | same | `members` (batch `.in`) | **RELEVANT — FIXED** |
| WOD-SIMPLE | `App.jsx` (~line 2220) | Community member list | Feed/Community tab | same | `members` (unfiltered, all gym) | **RELEVANT — FIXED** |
| WOD-SIMPLE | `App.jsx` (`fetchClienti`, ~line 2791) | Admin "Clienti" (Clients) roster | WOD-SIMPLE's own embedded Admin panel | same | `members` (batch `.in`) | **RELEVANT — FIXED (new finding)** |
| WOD-SIMPLE | `App.jsx` (`fetchRezervariClasa`, ~line 2844) | Admin class-detail roster | Admin | same | `members` (batch `.in`) | **RELEVANT — FIXED** |
| WOD-SIMPLE | `App.jsx` (`fetchRezervariZi`, ~line 7835) | Home screen "who's booked" roster | Member app | same | `members` (batch `.in`, **185 real live bookings affected**) | **RELEVANT — FIXED (highest-impact site)** |
| WOD-SIMPLE | `App.jsx` (`fetchClasament`, ~line 7900) | Leaderboard | Member app | same (partially masked by an email fallback, so displayed the email prefix rather than literal "Membru") | `members` (batch `.in`) | **RELEVANT — FIXED** |
| forge-admin-web | `LeaderboardView.tsx`, `ResultRow.tsx` | Leaderboard, results row | Admin | genuinely missing name+email (13 members with no name anywhere) | `profiles` via `fetchMemberRefsByIds` (already correct) | POSSIBLY RELEVANT — investigated, confirmed already correct, no fix needed |
| forge-admin-web | `MemberDetails.tsx`, `AttendanceList.tsx` | Member detail, attendance roster | Admin | genuinely missing name+email | `profiles` via `fetchMembersByIds` (already correct, explicitly documented as such) | POSSIBLY RELEVANT — investigated, confirmed already correct, no fix needed |
| WOD-SIMPLE | `translations.js`/`App.jsx` (self-profile read/write, `.eq('id', user.id)`) | Own profile screens | Member app | N/A — always the current user's own, always fresh | `members` (self-scoped) | UNRELATED — correct, canonical write target per P0-02, not part of INC-01 |

## 5. Surface Matrix

```text
Feed:      PROVEN LIVE (mechanism 1, deterministic) + THEORETICAL (mechanism 2, JWT-expiry,
           long-standing since 2026-07-06, not newly investigated further this mission)
Admin (forge-admin-web): NOT AFFECTED - independently re-traced, confirmed correct
Admin (WOD-SIMPLE embedded "Clienti"): PROVEN LIVE (new finding this mission)
Leaderboard (WOD-SIMPLE): PROVEN LIVE
Journal:   NOT AFFECTED - only ever displays the logged-in member's own data
Bookings/class roster: PROVEN LIVE (185 real bookings confirmed affected)
Other (Profile screens): NOT AFFECTED - self-scoped reads only
```

## 6. Production Data Integrity

```text
Total members (this gym):                        116
Members with members.full_name empty:              21
  - of those, recoverable from profiles.full_name:   8  (real name exists in profiles - THIS
                                                          is the confirmed, fixed root cause)
  - of those, genuinely no name anywhere:            13  (legitimate fallback still applies -
                                                          not touched, not a bug)
Stored literal "Member"/"Membru" anywhere:           0
Orphaned members/profiles rows:                      0
Real bookings belonging to the 8 recoverable members: 185 (confirms deterministic, high-volume
                                                          reproducibility, not a rare edge case)
```

**Stored data is correct.** No name was lost or corrupted. The defect was entirely in which table the display code chose to read (§7). The 8-vs-21 distinction itself (`members.full_name` empty while `profiles.full_name` has a value) is the platform's known, already-documented, unreconciled `member_field_drift` condition (tracked by `member_domain_consistency_report()`, established well before this session) — not new corruption, and not something this mission introduced or needs to repair, since the fix reads the correct table directly rather than requiring the drift to be reconciled first.

## 7. Feed Root Cause

Exact chain (mechanism 1, the dominant, fixed cause): `feed_posts`/`feed_comments` render → author id collected → author names batch-fetched via `supabase.from('members').select('id, full_name, email, avatar_url').in('id', authorIds)` → for any author among the 8 affected members, `full_name` returns empty → code falls through to `email?.split('@')[0]` → for these 8 members `members.email` also happens to differ in presence from `profiles.email`... **actually verified**: `members.email` is *not* empty for any of the 26 drift rows (checked in the original investigation), so the Feed's own three-way fallback (`full_name || email-prefix || 'Membru'`) should have shown at minimum an email-derived name, not literal "Membru", for pure mechanism-1 cases — meaning the literal `'Membru'`/`'Member'` string specifically requires *either* a null/undefined author lookup entirely (map-miss) *or* mechanism 2 (JWT-expiry causing the whole author-fetch query to fail, `authorsRes.data` ending up empty, so `authorsMap[p.member_id]` is `undefined` for *every* post that render cycle — matching the originally-confirmed `PGRST303` Sentry evidence). This refines the original investigation's finding precisely: the **wrong-table bug (mechanism 1) is real and fixed**, but for the Feed specifically, the literal fallback string is *more directly* explained by mechanism 2 (query failure) than by mechanism 1 alone (which, for the Feed's own fallback chain, would more often have produced an email-derived name than the literal string). Both are now correctly identified as distinct, and mechanism 1 is fixed regardless.

## 8. PGRST303

Not re-investigated further this mission beyond what the original investigation established (long-standing since 2026-07-06, 167 events, ongoing) — per this mission's explicit scope, mechanism 2 (session/auth lifecycle) is **not** part of the confirmed, HIGH-confidence, fixed root cause, and Phase 26's authorization gate ("implement ONLY IF the exact affected path reaches HIGH confidence") was not met for a session-refresh redesign. It remains an open, disclosed, lower-priority item (§20).

## 9. Admin Investigation

**forge-admin-web: NO — not reproduced, and independently confirmed unnecessary to fix.** Re-traced every relevant component (`MemberDetails.tsx`, `LeaderboardView.tsx`, `ResultRow.tsx`, `AttendanceList.tsx`) back to their actual data source — all resolve through `fetchMembersByIds`/`fetchMemberRefsByIds`, both of which query `profiles`, with `fetchMembersByIds` carrying its own explicit code comment: *"the live, authoritative table (never `members`, which the Attendance Domain Assessment found is a one-way, edit-blind mirror of it)"* — i.e., this exact lesson was already learned and correctly applied in forge-admin-web, just never carried over to WOD-SIMPLE. No speculative Admin fix was made in that repository — none was needed.

**WOD-SIMPLE's own embedded Admin panel ("Clienti"): YES — reproduced and fixed.** This is a genuine new finding of this mission (not identified in the original INC-01 investigation): `fetchClienti` exhibited the identical mechanism-1 bug.

## 10. Member/Profile Name Architecture

`profiles.full_name`/`email`/`avatar_url`/`first_name`/`last_name`/`birth_date` are the correct, canonical, already-precedented source for member *display* identity — confirmed by: (a) forge-admin-web's own documented Attendance Domain Assessment; (b) the actual foreign-key structure (`feed_posts.member_id`/`feed_comments.member_id` have real FKs to `profiles`, none to `members` — confirmed by reading the existing code comment at the Feed's own query site, which already stated this fact correctly even while the code itself queried the wrong table); (c) live data showing `profiles.full_name` correct where `members.full_name` was stale for 8 real members. `members.gender` remains the sole exception — the P0-02 canonical decision for gender specifically was not revisited, reinterpreted, or touched by this mission.

## 11. ID Mapping

No identity/join mismatch was found. Every affected query correctly used `member_id`/`id` values consistent with `profiles.id` (`= auth.users.id` = `members.id`, the same UUID across all three, as established in prior missions) — the defect was exclusively about *which table* was queried for a *given, correct* id, never about using the wrong id.

## 12. Race / Cache Findings

Not implicated for the confirmed, fixed root cause (mechanism 1) — the bug is fully deterministic given the stored data, independent of render timing, request ordering, or cache state. Not separately investigated for mechanism 2 (JWT-expiry), consistent with this mission's scope (mechanism 2 was not promoted to HIGH confidence and was not the target of implementation).

## 13. Git History

All 6 fixed call sites significantly predate this session's P0 work — confirmed via the code's own long-standing comments (e.g., the Feed's own "members supplies identity display fields" framing, and the class-roster's parallel comment) describing `members` as the intended source, indicating this was a considered-but-incorrect architectural choice made well before P0-01 through P0-03, not a recent regression. None of P0-01/P0-02/P0-SEC-01/P0-SEC-02/P0-SEC-03/P0-03/INC-02 touched any of these 6 call sites (confirmed via `git diff`/`git log` scoping in each of those missions' own reports).

## 14. Fix

Implemented — HIGH confidence for the exact affected code paths, per Phase 26's gate:

- **`src/App.jsx`, 6 call sites**: `.from('members')` → `.from('profiles')` for display-identity fields (`full_name`/`email`/`avatar_url`/`first_name`/`last_name`/`birth_date`). Two sites (`fetchClienti`, `fetchClasament`) also select `gender` — split into a parallel `profiles` (identity) + `members` (gender-only) query pair, merged client-side, matching forge-admin-web's own established `fetchMemberRefsByIds` pattern exactly. `fetchRezervariZi`'s fallback chain was also extended to try the member's email before falling back to `'Membru'`, matching the Feed's own already-correct three-tier fallback pattern (`full_name || email-prefix || fallback`), for consistency.
- **`src/memberNameSource.test.js`** (new): a source-scanning regression test (same philosophy as the pre-existing `configIntegrity.test.js`) asserting no future `.from('members').select(...)` containing `full_name` can be a batch (`.in`) lookup — only a self-scoped (`.eq('id', user.id)`) read is permitted. Verified against the pre-fix commit to confirm it correctly flags all 6 real violations that existed.

No forge-admin-web changes were made — none were needed.

## 15. Security Boundary

```text
RLS unchanged:            YES - zero policies touched; re-verified live that an ordinary member
                           (not just an admin) correctly sees 100% of their gym's profiles rows
                           (74/74), confirming the fix requires no RLS change at all
auth protections unchanged: YES - no session/JWT/auth code touched
service role not exposed: YES - all fixed queries use the existing client-side anon/authenticated
                           Supabase client, exactly as the original (buggy) queries did
tenant isolation unchanged: YES - every fixed query retains its existing `.in('id', ids)`/
                           `.eq(...)` scoping; profiles' own RLS (`gym_id = my_gym_id()`) applies
                           identically to the new query as it did to the old one
```

## 16. Regression Tests

`src/memberNameSource.test.js`, 4 tests: (1) zero violations in the current, fixed `App.jsx`; (2) the scanner correctly flags the exact historically-buggy shape when given a synthetic example; (3) the scanner correctly does NOT flag a legitimate self-scoped read; (4) the scanner correctly does NOT flag a gender-only query. Additionally, independently verified (read-only, not part of the committed test suite) that running the scanner's logic against the pre-fix commit (`1f02754`) flags exactly the 6 real violations that existed — direct proof this test would have caught the incident before it shipped.

## 17. Full Test Results

```text
WOD-SIMPLE: 916/916 real tests passing (was 912 before this fix; +4 new regression tests).
            Same 9 pre-existing, unrelated Deno-only supabase/functions/**/*.test.ts files still
            fail to LOAD (@std/assert import - confirmed pre-existing baseline, unchanged).
build:      PASS, 0 errors.
lint:       PASS, 0 errors (11 pre-existing warnings, unrelated lines, unchanged count).
forge-admin-web: not affected, not modified, not re-run (no changes made to that repository).
```

## 18. INC-02 Regression

**Confirmed intact.** `git diff` of this fix contains zero references to `wodHeaderLine`, `computeWodHeaderLine`, `saveWodLog`, or `variantaAleasa` — the INC-02 fix (score logging) is completely untouched by this change. Both fixes live in the same file (`App.jsx`) but in entirely disjoint functions.

## 19. Production Data

```text
Production member/profile/auth data modified: NO
```

No `INSERT`/`UPDATE`/`DELETE` was executed against `members`, `profiles`, or any auth table. The only production-affecting action was bumping `app_version` (`inc-01-member-name-source-fix-20260828`), the platform's standard PWA-refresh signal — not a data change. The fix is deployed to production (commit `6cd7b0b`, Vercel deploy confirmed via Sentry release tracking at `2026-08-28T07:38:23Z`).

## 20. Remaining Uncertainty

Be explicit, per this mission's own instruction:

1. **Mechanism 2 (Feed JWT-expiry/PGRST303) remains unresolved.** This is a real, live, long-standing (since 2026-07-06) but narrow and session-transient issue, distinct from the fixed mechanism 1. It was not promoted to HIGH confidence for a specific, safe, minimal fix within this mission's scope, and per Phase 26's explicit gate, was therefore not implemented. It could still cause an occasional, temporary "Member" flash on the Feed specifically, unrelated to the now-fixed data-source bug.
2. **The underlying `member_field_drift` (21 members, 8 recoverable + 13 genuinely nameless) remains unreconciled** — this is pre-existing, known, disclosed, database-level drift, not something this mission was asked to or should silently backfill (Phase 31's explicit prohibition). The code fix means the drift no longer causes wrong *display*, but the drift itself (as a data-quality matter) persists and was not touched.

## 21. Remaining Severity

**P2** — for the unresolved mechanism 2 (Feed JWT-expiry). Narrow, long-standing, session-transient, does not affect the deterministic, high-volume surfaces this mission fixed. **P3** — for the unreconciled `member_field_drift` itself, now a cosmetic data-quality item rather than a display-correctness one, since the fix reads the correct table regardless of drift.

## 22. Final Recommendation

**INC-01, as originally reported ("some users are displayed as 'Member' instead of their actual name"), can be considered closed.** The dominant, deterministic, highest-volume root cause (6 call sites reading the wrong table, confirmed affecting 8 real members and 185 real live bookings) is fixed, tested, and deployed. A separate, narrower, pre-existing session-lifecycle issue (Feed/JWT-expiry) remains and is explicitly disclosed as a distinct, lower-severity (P2) follow-up candidate — recommend a dedicated, narrowly-scoped future mission if it continues to be observed in production, rather than folding it into this already-closed incident.

---

Stopping here per this mission's explicit instruction. No further security/timezone audit, no INC-02 rework, no unrelated work performed.
