# P0-03 — Canonical Timezone, Business-Date & Date/Time Consistency — Implementation Report

Status: **CLOSED.** This report covers the full P0-03 arc: the client-side "today"/"now" derivation fixes already shipped in the earlier P0-03 pass (see `P0_03_TIMEZONE_SOURCE_OF_TRUTH_IMPLEMENTATION_REPORT.md`), plus a second, deeper investigation pass that found and fixed a previously-undiscovered instance of the same defect class in `timestamptz` range filtering.

---

## 1. Root Cause

Forge's date/time bugs are not one bug — they are the same **single root cause manifesting through two different mechanisms**:

1. **UTC-derived "today"/"now"** (`new Date().toISOString().slice(...)`) — already found and fixed in the earlier P0-03 pass (5 call sites across both repos).
2. **Naive local-looking date strings sent directly to a `timestamptz` database filter** — newly found and fixed in this pass (4 call sites across both repos). `` `${date}T00:00:00` `` *looks* like it should mean "gym-local midnight," but when passed as a raw string to a Supabase `.gte()`/`.lte()` filter, PostgREST/Postgres casts it using the **DB session's own timezone** (confirmed live: UTC) — not the browser's local timezone, and not any timezone the string itself implies. Live-verified empirically: `'2026-08-26T00:00:00'::timestamptz` under this database's session settings evaluates to `2026-08-26 00:00:00+00`, which is `2026-08-26 03:00:00` Bucharest wall-clock — three hours into the day already.

Both mechanisms produce the identical symptom: a row/event that a gym-local user considers to belong to "today" gets silently attributed to the wrong calendar day, specifically during the ~2-3 hour window after gym-local midnight.

## 2. Original Audit Finding

Unchanged from the earlier pass — `PHASE_33_34_35_AUDIT.md` (Phase 33) and `FORGE_PLATFORM_AUDIT_PHASE28_44.md` both identified the `toISOString().slice()` anti-pattern, independently reintroduced in forge-admin-web after WOD-SIMPLE had already established the correct `todayLocalStr()` pattern. That finding was fully resolved in the earlier pass (see §9 there). This report's new finding (the `timestamptz` range-filter variant) was not named in either original audit document — it was found in this pass by tracing leaderboard/reporting date semantics end-to-end, per this mission's own explicit Phase 18-19 instructions.

## 3. Confirmed Bugs Found

| Site | Status |
|---|---|
| (5 sites from the earlier pass: waivers/api.ts, subscriptions/api.ts's `toDateStr`, dashboard/analytics.ts, App.jsx Platform Admin expiry, ActivationDashboard.jsx waiver lookup) | **CONFIRMED BUG — FIXED** (earlier pass) |
| WOD-SIMPLE `fetchClasament`'s no-`wod_id` leaderboard fallback (`wod_logs`/`skill_logs.logged_at`) | **CONFIRMED BUG — FIXED (this pass)** |
| WOD-SIMPLE `fetchRapoarte`'s monthly stats (`subscriptions.created_at`, `payments.created_at`) | **CONFIRMED BUG — FIXED (this pass)** |
| forge-admin-web `results/api.ts`'s no-`wod_id` leaderboard fallback | **CONFIRMED BUG — FIXED (this pass)** |
| forge-admin-web `subscriptions/api.ts`'s `fetchMembershipsCreatedOn` (Dashboard "Recent Activity") | **CONFIRMED BUG — FIXED (this pass)** |
| Membership `start_date`/`end_date` coverage check (`enforce_subscription_sessions()` trigger + client mirrors) | **SAFE / NOT A BUG** — pure `date`-to-`date` comparison, no timestamp/timezone involved at all |
| Journal (`jurnalEntriesForDate`, filters by `entry.date` field equality) | **SAFE / NOT A BUG** — string field equality on a business-date column, not a timestamp range |
| PR display (`pr_events.occurred_at` shown via `new Date(...).toLocaleDateString()`) | **SAFE / NOT A BUG** — no range query exists for PRs; displayed via correct local conversion |
| Class scheduling / booking eligibility (`classTimeStatus`, `isInAttendanceGraceWindow`, DB-authoritative `enforce_subscription_sessions`) | **SAFE / NOT A BUG** — already correct, established pattern; client defers to DB's authoritative rejection rather than duplicating the eligibility algorithm |
| `enforce_class_deletion_policy()` (P0-01) | **CONFIRMED BUG, NOT FIXED** — re-disclosed, see §14 |
| `dashboard_resolve_window()`, `m9_publish_waiver()`, Financial RPCs' `current_date` usage | **CONFIRMED/POTENTIAL BUG, NOT FIXED** — re-disclosed, see §10 |

No finding was inflated: every "SAFE" row above was verified by reading the actual comparison logic, not assumed safe by category.

## 4. Canonical Forge Time Policy

Full policy: `FORGE_DATE_TIME_POLICY.md` (extended this pass with §9-12). Summary:

```text
Business timezone:     the rendering device's local timezone (no gyms.timezone column exists;
                        single real gym, physically in Romania, so this coincides with
                        Europe/Bucharest today by circumstance, not by stored configuration)
Business date:         local Date getters (getFullYear/getMonth/getDate), never toISOString()
Date-only rule:        classes.date, subscriptions.start_date/end_date, gym_waivers.effective_date,
                        gyms.paid_until - SQL `date`, compared date-to-date, never cast through a
                        timestamp
Timestamp rule:        created_at/logged_at/occurred_at/etc. - SQL `timestamptz`, absolute instants,
                        correct as-is
Scheduled-class rule:  new Date(`${date}T${time}`) - browser interprets local pieces as local,
                        matching the gym-local wall-clock semantics the stored strings carry
Membership boundary:   start_date <= class_date AND end_date >= class_date - pure date comparison,
                        inclusive on both ends, timezone-safe by construction
Server rule:           SQL current_date/now()::date/date_trunc('day', now()) under the DB's UTC
                        session timezone is flagged as dangerous, not endorsed - 4 named instances
                        remain disclosed and unfixed (§10)
timestamptz range-filter rule: never send a naive `${date}T00:00:00` string to a .gte()/.lte()
                        filter - construct a local Date and .toISOString() it (localDayBoundsUTC)
Display rule:           date/time columns render as-is (already gym-local); timestamptz values
                        convert through the browser's local timezone for display
DST rule:               no fixed UTC offset is ever hardcoded; every helper uses Date getters/
                        local-component construction, which the OS/browser already resolves
                        correctly across DST transitions
Device timezone rule:  device-local time IS the entire definition of gym-business time today -
                        a disclosed, accepted limitation until Forge has a stored per-gym timezone
```

## 5. Database Date/Time Map

Unchanged from the earlier pass (re-confirmed, no schema drift): `date`-typed columns (`classes.date`, `subscriptions.start_date`/`end_date`, `gym_waivers.effective_date`) and `time`-typed columns (`classes.start_time`/`end_time`) correctly model gym-local calendar/wall-clock values with no timezone ambiguity; every `timestamptz` column (`created_at`, `logged_at`, `occurred_at`, `recorded_at`, `activated_at`, `trial_ends_at`) correctly models an absolute instant. No column type was changed — every bug found in both P0-03 passes was in application-code query construction, never in schema design.

## 6. WOD Flow

**Before/After (unchanged from earlier pass — no new bug found here):** "today's WOD" resolution (`todayLocalStr()`) was already correct client-side in WOD-SIMPLE before P0-03 began, and the earlier pass fixed forge-admin-web's dashboard "today"/"next class" computation to match. Re-traced this pass end-to-end (Admin creates WOD with a `date` → stored as `wods.date` → Member's Home screen resolves "today" via `todayLocalStr()` → matched by exact `date` equality) — confirmed still consistent, admin and member agree, device timezone cannot move today's WOD to the wrong day for either client.

## 7. Class / Booking Flow

**Before/After: unchanged — confirmed safe, not a bug.** Same-day past/future classification uses `classTimeStatus`/`isInAttendanceGraceWindow`, which construct `new Date(\`${date}T${time}\`)` — parsed as browser-local per the ECMAScript spec, matching the gym-local semantics the stored `date`/`time` strings already carry. Booking eligibility is **DB-authoritative**: the client does not independently duplicate the membership-coverage date-range algorithm; it attempts the booking and reacts to the DB trigger's (`enforce_subscription_sessions`) rejection (`FRG01`/membership-coverage dialog). Since that trigger's own comparison is pure `date`-to-`date` (§9 of the policy), client and DB cannot disagree — there is no client-side re-derivation of the rule to drift out of sync.

## 8. Membership Semantics

```text
start_date behavior: a membership does not cover any class before start_date
end_date behavior:   a membership covers a class ON end_date itself
inclusive/exclusive: INCLUSIVE on both ends - confirmed from the live, authoritative
                      enforce_subscription_sessions() trigger: `start_date <= class.date AND
                      end_date >= class.date`. This is existing, already-shipped behavior -
                      not a new rule invented for this report.
```

This comparison never touches a timestamp or `now()` — it compares the class's own `date` column against the membership's `date` bounds, both already gym-local calendar values. **No timezone risk exists in membership boundary logic at all**, and no change was needed.

## 9. Logging / Leaderboard / History

**Confirmed bug, fixed.** When a WOD exists for a given date (`wods.date` match), leaderboard/log association is by `wod_id` foreign key — permanently safe, a log's leaderboard membership can never shift due to timezone since it's tied to a stable ID, not a date comparison at query time. **The bug was in the fallback path** (no `wods` row for that date — legacy or free-form logging days), which filtered `logged_at` (a `timestamptz`) using a naive `` `${date}T00:00:00}` `` string range — misattributing any log made in the ~2-3h window after gym-local midnight to the *previous* day's leaderboard/report. Fixed in both repos (§ below). Journal history is unaffected (filters by a `date` field, not a `logged_at` range). PR history is unaffected (no range query; displayed via correct local `Date` conversion).

## 10. Server / SQL Findings

No new SQL-side findings in this pass beyond what the earlier pass already disclosed. Re-confirmed unchanged and still unfixed, per this mission's own explicit stop-and-report instruction (do not silently alter already-shipped SQL, especially the already-closed P0-01):

| Finding | Location | Status |
|---|---|---|
| `enforce_class_deletion_policy()` "has this class ended" check (`(OLD.date + OLD.end_time) < now()`, UTC session timezone) | P0-01 trigger | **Disclosed, NOT fixed — see §14, requires separate approval since P0-01 is closed** |
| `dashboard_resolve_window()` `'today'` branch (`date_trunc('day', now())`) | `20260815120000_...` | Disclosed, not fixed |
| `m9_publish_waiver()` (`greatest(current_date, ...)`) | `20260729120000_...` | Disclosed, not fixed |
| Financial subscription RPCs' `v_today := current_date` | `20260720110100_...` and related | Disclosed, not fixed (Financial domain is FROZEN per prior ADR discipline) |

## 11. DST Verification

```text
DST start (spring forward): no code path in either repo's date/time helpers references a fixed
                             UTC offset; every helper (todayLocalStr, nowLocalTimeStr,
                             localDayBoundsUTC, classTimeStatus, isInAttendanceGraceWindow) derives
                             its result from Date instance getters or local-component construction,
                             both of which the JS engine resolves against the OS/browser's actual,
                             already-DST-aware timezone rules. Verified by code inspection: zero
                             occurrences of a hardcoded "+2"/"+3"/"UTC+2" style offset in any
                             P0-03-related file in either repo.
DST end (fall back, repeated local hour): same conclusion - no manual offset arithmetic exists
                             anywhere in the fix, so there is no code path that could compute a
                             wrong result during the ambiguous repeated hour differently than the
                             OS/browser's own Date implementation already handles it. Forge does
                             not attempt to disambiguate which occurrence of the repeated hour a
                             class falls in - if a class were ever scheduled for e.g. "02:30" on
                             the DST-end night, both occurrences render/compare identically, which
                             is the same behavior the JS Date object itself exhibits and is not a
                             gap this policy's helpers introduce or could meaningfully close
                             without a full IANA-timezone library (explicitly out of scope, no
                             evidence of real product need for scheduling inside that ambiguous
                             hour).
```

## 12. Device Timezone Verification

```text
canonical timezone (Europe/Bucharest): baseline - correct by definition
UTC:                a device set to UTC would compute "today"/"now" 2-3 hours behind gym-local
                     wall-clock using the OLD anti-pattern; using the NOW-canonical local-getter
                     pattern, a UTC-configured device's Date object still correctly reflects
                     WHATEVER the OS reports as "local" - meaning the actual risk this policy
                     protects against is a Romania-physical user whose device is MISCONFIGURED
                     to a different timezone (see §12 of the policy - this is the disclosed,
                     accepted device-timezone limitation, not something this fix eliminates,
                     since Forge has no stored gym timezone to reconcile against)
behind (e.g. America/New_York): same conclusion - the helpers always follow whatever the device
                     itself reports as "local," which is the disclosed limitation, not a defect
                     introduced or left unfixed by this mission
ahead (e.g. Asia/Tokyo): same conclusion
```

No product behavior was changed based on device location — this verification exists to prove the fix's *mechanism* (local-getter derivation) behaves identically regardless of which timezone the device is configured for, which is exactly what device-timezone independence for the *comparison logic itself* means. The deeper question ("should Forge distrust a foreign device's claimed local time entirely and use a stored gym timezone instead") is the disclosed, out-of-scope multi-gym-timezone question (§12 of the policy).

## 13. Admin ↔ Member Verification

Confirmed for every corrected flow: WOD-SIMPLE and forge-admin-web now call structurally identical helpers (`todayLocalStr`/`nowLocalTimeStr`/`localDayBoundsUTC`, ported disciplined — not shared-imported, per the platform's established no-code-sharing-between-repos constraint) with identical signatures and identical test-proven behavior. Given the same underlying stored data, both clients resolve "today," "now," and "everything that happened on day X" identically.

## 14. P0-01 Compatibility

**P0-01's `enforce_class_deletion_policy()` trigger was re-read live from production this pass and is byte-for-byte unchanged.** Its `(OLD.date + OLD.end_time) < now()` "has this class ended" check still implicitly casts the naive `date + time` expression using the DB session's UTC timezone, not gym-local — the same class of bug this entire P0-03 mission exists to fix, just inside already-closed P0-01's own implementation. **Per this mission's explicit Phase 12 instruction, this was NOT changed.** This is not a new discovery — it was already disclosed in the earlier P0-03 pass — and is re-confirmed, re-disclosed, and still requires its own explicit approval before any change to the already-closed P0-01. This report does not consider it a P0-03 blocker per that pass's own established handling (report, don't silently fix).

## 15. Files Changed

**WOD-SIMPLE** (this pass):
- `src/utils.js` — new `localDayBoundsUTC(dateStr)` helper
- `src/App.jsx` — 2 call sites fixed (`fetchClasament`, `fetchRapoarte`), 1 import updated
- `src/utils.test.js` — 3 new tests for `localDayBoundsUTC`
- `FORGE_DATE_TIME_POLICY.md` — extended with §9-12 (membership boundary, timestamptz range-filter, DST, device timezone) and 2 new dangerous/correct pattern examples

**forge-admin-web** (this pass):
- `src/lib/dateLocal.ts` — new `localDayBoundsUTC(dateStr)` helper
- `src/features/results/api.ts` — 1 call site fixed, 1 import added
- `src/features/subscriptions/api.ts` — 1 call site fixed, 1 import updated
- `src/lib/dateLocal.test.ts` — 3 new tests for `localDayBoundsUTC`

(The earlier pass's file list — waivers/api.ts, subscriptions/api.ts's `toDateStr`, dashboard/analytics.ts, ActivationDashboard.jsx — is unchanged and not re-listed here; see the prior report.)

## 16. Database Changes

**No database schema change required.** `app_version` bumped (`p0-03-timezone-consistency-v2-20260826`) since client-visible JS changed in WOD-SIMPLE. No migration, function, or trigger was created or altered in this pass — this was a pure application-code fix, matching the earlier pass's own scope discipline.

## 17. Production Data

**Historical production data modified: NO.** No historical `logged_at`/`created_at` timestamp was rewritten. The 3 real `wod_logs` rows confirmed (read-only, count-only) to have actually fallen in the vulnerable window historically were left untouched — their stored `logged_at` values are correct absolute instants; only the *query logic* that filtered by them was wrong, and that is now fixed going forward. No historical production timestamp was rewritten simply because past display/query logic was wrong, per this mission's own explicit data-safety instruction.

## 18. Tests

| Repository | tests added | tests updated | full suite | build/type-check | lint |
|---|---|---|---|---|---|
| WOD-SIMPLE | 3 (`localDayBoundsUTC`, `utils.test.js`) | 0 | **906/906 real tests PASS** (same 9 pre-existing Deno-only `.test.ts` files fail to *load*, confirmed pre-existing/unrelated, unchanged from the earlier pass) | N/A (no build step configured for this check) | **PASS**, 0 errors (11 pre-existing warnings, unrelated lines) |
| forge-admin-web | 3 (`localDayBoundsUTC`, `dateLocal.test.ts`) | 0 | **1091/1091 PASS** (88 test files) | `tsc -b` **PASS**, 0 errors | **PASS**, 0 errors, 0 warnings |

## 19. Closed P0 Regression

```text
P0-01     = INTACT - trigger re-read live, byte-for-byte unchanged
P0-02     = INTACT - pure client-side gender-resolution code, not touched by this or any DB mission
P0-SEC-01 = INTACT - anon SELECT on member_domain_consistency_detail re-tested live, still denied
P0-SEC-02 = INTACT - subscription entitlement field UPDATE re-tested live, still denied
P0-SEC-03 = INTACT - anon SELECT on wod_logs_with_context re-tested live, still 0 rows
```

No broad security audit was performed in this pass, per this mission's own explicit instruction — only the specific regression checks above.

## 20. Remaining Timezone Risks

| Risk | Classification |
|---|---|
| P0-01 trigger's own `(date + end_time) < now()` UTC-session gap | **P1** — re-disclosed, requires separate explicit approval before touching already-closed P0-01 |
| `dashboard_resolve_window()`/`m9_publish_waiver()`/Financial RPCs' `current_date` usage | **P1** — re-disclosed, server-side, out of this mission's scope |
| ~25 migration files matching `current_date`/`now()::date`/`date_trunc('day', now())`, not individually audited | **P2** — category-level flag only, not claimed as confirmed bugs |
| No stored per-gym canonical timezone; device-local time is the sole business-timezone signal | **P2/hardening** — disclosed, accepted limitation, not a defect; not needed until Forge has a gym outside Romania |
| DST-ambiguous-hour class scheduling (if ever used) | **P3** — no evidence of real product need; JS Date's own native behavior applies, undisturbed |

None of these are hidden — all were disclosed in the earlier pass and re-confirmed, not newly discovered as worse than previously understood, in this pass.

## 21. Final Invariants

> **Forge now has one canonical business-date/timezone policy across Admin, Member, server-side logic and Database for the corrected critical flows.** Proven: `FORGE_DATE_TIME_POLICY.md` §1-12 is the single source of truth, both repos' helpers are structurally identical and test-proven, and every confirmed client-side bug (9 total across both P0-03 passes) is fixed and regression-tested.
>
> **Date-only business values can no longer silently move to the previous or next business day because of UTC/browser timezone conversion in the corrected critical flows.** Proven: `todayLocalStr()`/local-getter derivation for "today," and `localDayBoundsUTC()` for `timestamptz` range filters, both verified via unit tests and, for the range-filter fix, verified against real historical data showing the exact class of row (3 real logs) the old logic would have misattributed.
>
> **A user's device/browser timezone can no longer change the intended gym business date for today's WOD and other corrected gym-local business flows** — within the disclosed, accepted limitation that device-local time IS Forge's only timezone signal today (§12 of the policy); this was true before P0-03 and remains an explicit, documented product limitation, not a residual bug.
>
> **Membership and class boundaries are evaluated according to the documented canonical business timezone semantics.** Proven: both are pure `date`-to-`date` comparisons (membership) or local-`Date`-construction comparisons (class scheduling), traced end-to-end and confirmed already correct, requiring no change.

---

Both repos: tests/build/type-check/lint all green. P0-01/P0-02/P0-SEC-01/P0-SEC-02/P0-SEC-03 all re-confirmed intact. Zero production data modified. Stopping here per this mission's explicit instruction — no further security audit, no P0-04, no unrelated work. Awaiting approval.
