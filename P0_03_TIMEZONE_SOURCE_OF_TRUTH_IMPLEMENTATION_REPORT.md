# P0-03 — Timezone Source of Truth & Date/Time Consistency — Implementation Report

Status: **SHIPPED (client-side scope) + 4 SQL-side findings disclosed, not fixed, pending approval.** Both P0-01 and P0-02 confirmed unmodified.

---

## 1. Root Cause

Both `PHASE_33_34_35_AUDIT.md` (Phase 33) and `FORGE_PLATFORM_AUDIT_PHASE28_44.md` correctly identified the same underlying defect: several code paths compute "today" or "now" via `new Date().toISOString()` and slice it (`.slice(0, 10)` for date, `.slice(11, 19)` for time-of-day). `toISOString()` always renders in **UTC**, not the browser's local timezone. Romania (the platform's only real deployment today) runs at UTC+2/UTC+3 (DST), so for roughly 2-3 hours after local midnight, the UTC calendar date is still "yesterday" — and for time-of-day comparisons, the UTC clock reads 2-3 hours behind gym-local wall-clock, at *every* hour of the day, not only near midnight.

The DB session timezone is confirmed live as UTC (`current_setting('TimeZone')` = `'UTC'`). Any server-side SQL expression that implicitly casts a naive `date`/`time` value for comparison against `now()`/`current_date` inherits the identical gap, just expressed in Postgres instead of JS.

The platform already has the *correct* pattern in two places (`todayLocalStr()` in WOD-SIMPLE's `utils.js`, and `classTimeStatus`/`isInAttendanceGraceWindow` in forge-admin-web's `dashboard/components/countdown.ts`, ported to WOD-SIMPLE) — the bug was that this correct pattern was not applied consistently everywhere "today" or "now" needed to be computed.

## 2. Confirmed Bugs (vs Safe/Not-a-Bug)

| Site | Repo | Status |
|---|---|---|
| `forge-admin-web/src/features/waivers/api.ts` (`fetchWaivers`) | forge-admin-web | **CONFIRMED BUG — FIXED** |
| `forge-admin-web/src/features/subscriptions/api.ts` (`toDateStr`) | forge-admin-web | **CONFIRMED BUG — FIXED** |
| `forge-admin-web/src/features/dashboard/analytics.ts` (`getDashboardTodaySummary`, both `today` and `nowTime`) | forge-admin-web | **CONFIRMED BUG — FIXED** (`nowTime` was the more severe of the two: it skewed by the full UTC offset at every hour, not just near midnight) |
| `WOD-SIMPLE/src/App.jsx:4996` (Platform Admin gym list `paid_until` expiry) | WOD-SIMPLE | **CONFIRMED BUG — FIXED** |
| `WOD-SIMPLE/src/ActivationDashboard.jsx:104` (`gym_waivers` current-lookup) | WOD-SIMPLE | **CONFIRMED BUG — FIXED** |
| `enforce_class_deletion_policy()` trigger (P0-01) — `(OLD.date + OLD.end_time) < now()` | DB (SQL) | **CONFIRMED BUG — NOT FIXED, disclosed in §11** |
| `dashboard_resolve_window()` `'today'` branch — `date_trunc('day', now())` | DB (SQL) | **CONFIRMED BUG — NOT FIXED, disclosed in §12** |
| `m9_publish_waiver()` — `greatest(current_date, ...)` | DB (SQL) | **CONFIRMED BUG — NOT FIXED, disclosed in §12** |
| Financial `create_subscription`/related RPCs — `v_today date := current_date` (and ~20 further migration files matching `current_date`/`now()::date`/`date_trunc('day', now())`) | DB (SQL) | **POTENTIAL BUG, category-level only — NOT individually audited, disclosed in §12** |
| `todayLocalStr()` (WOD-SIMPLE `utils.js`) | WOD-SIMPLE | SAFE — already correct, the reference pattern |
| `classTimeStatus`/`isInAttendanceGraceWindow`/`countdown.ts` | Both | SAFE — already correct, the reference pattern |
| Every `timestamptz` column (`created_at`, `logged_at`, `occurred_at`, etc.) | DB (SQL) | SAFE/UNRELATED — absolute instants, no timezone ambiguity |
| `classes.date`/`start_time`/`end_time`, `subscriptions.start_date`/`end_date`, `gym_waivers.effective_date` column *types* | DB (SQL) | SAFE/UNRELATED — correctly modeled as naive `date`/`time`, the bug was only ever in how application code *derived the comparison value*, not the schema |

## 3. Previous Behavior — concrete Admin/Member disagreement examples

- **Waiver "current version" lookup**: at 00:30 Romania time on the day a new waiver version's `effective_date` began, `forge-admin-web`'s `fetchWaivers` (UTC-based `today`) would still resolve to the *previous* day, showing the old waiver as current, while the Member PWA (already using the correct `todayLocalStr()`) would correctly show the new one — visible disagreement between the two clients for the same `gym_waivers` data, for ~2-3 hours after every version's local midnight rollover.
- **Dashboard "next class today"**: `getDashboardTodaySummary`'s `nowTime` bug was worse than a midnight edge case — at any time of day, a UTC-derived "now" is 2-3 hours behind gym-local wall-clock, so `.gte('start_time', nowTime)` could return a class that had *already started* (or already ended) in real gym-local time, silently at every hour, not just near midnight.
- **Platform Admin gym expiry (`paid_until`)**: for ~2-3 hours after local midnight on a gym's actual expiry day, the Platform Admin list would still classify it as *not yet* expired (using yesterday's UTC date), one day later than the Member/Owner-facing surfaces that already used the correct local date.

## 4. Canonical Timezone Policy

See `FORGE_DATE_TIME_POLICY.md` (new file, WOD-SIMPLE root) for the full policy, answering all 8 mandated sub-questions. Summary: business timezone = the rendering device's local timezone (no `gyms.timezone` column exists or is introduced); date-only and time-of-day values are always derived via local `Date` getters, never `toISOString()`; `timestamptz` columns need no change (already correct); server-side SQL `current_date`/`now()::date`/`date_trunc('day', now())` usage is flagged as the same class of risk but explicitly not remediated in this mission (see §11-12).

## 5. Source-of-Truth Implementation

New canonical local-date/time helpers, one per repo (no shared module boundary exists between the two, consistent with every other ported utility on this platform):

- **WOD-SIMPLE**: `todayLocalStr()` already existed in `src/utils.js` — reused, not reimplemented.
- **forge-admin-web**: new file `src/lib/dateLocal.ts`, exporting `todayLocalStr(now = new Date())` and `nowLocalTimeStr(now = new Date())`, ported from WOD-SIMPLE's own pattern, both accepting an injectable `now` for testability.

## 6. Files Changed

**forge-admin-web** (new commit, to be pushed):
- `src/lib/dateLocal.ts` (new)
- `src/lib/dateLocal.test.ts` (new, 6 tests)
- `src/features/waivers/api.ts` (fixed)
- `src/features/subscriptions/api.ts` (fixed)
- `src/features/dashboard/analytics.ts` (fixed)

**WOD-SIMPLE** (new commit, to be pushed):
- `src/App.jsx` (fixed, 1 call site, line ~4996)
- `src/ActivationDashboard.jsx` (fixed, 1 call site + import, line ~104)
- `FORGE_DATE_TIME_POLICY.md` (new)
- `P0_03_TIMEZONE_SOURCE_OF_TRUTH_IMPLEMENTATION_REPORT.md` (this file, new)

## 7. Database Changes

**No database schema change made.** The 5 confirmed client-side JS/TS bugs required no migration — all affected columns (`date`, `time`, `timestamptz`) were already correctly typed; the bug was entirely in how client code derived the comparison value. The 4 SQL-side findings (§11-12) are explicitly **not fixed** in this mission, per its own Phase 7 stop-and-report instruction for exactly this class of discovery.

## 8. Production Data

**No historical production data was modified, read-written, or backfilled.** This mission touched only application source code (5 files across 2 repos) and 2 new documentation/utility files. No `UPDATE`/`DELETE` statement was run against any table.

## 9. Tests

| Suite | Result |
|---|---|
| forge-admin-web `tsc -b` | **PASS**, 0 errors |
| forge-admin-web `vitest run` (full suite) | **PASS**, 88 test files / 1088 tests, 0 failures |
| forge-admin-web `eslint` (5 changed/new files) | **PASS**, 0 errors, 0 warnings |
| forge-admin-web `dateLocal.test.ts` (new) | **PASS**, 6/6 — local-date formatting, padding, the "00:30 local, still same day" case, default-`new Date()` behavior, `nowLocalTimeStr` formatting |
| WOD-SIMPLE `vitest run` (full suite) | 903/903 real tests **PASS**; 9 pre-existing `.test.ts` files under `supabase/functions/**` fail to *load* (`@std/assert` is a Deno-only import specifier Vitest/Node cannot resolve) — confirmed pre-existing, unrelated to any file this mission touched (`purchase-platform-plan`, `stripe-webhook`, `send-notification` — none edited) |
| WOD-SIMPLE `eslint` (2 changed files) | **PASS**, 0 errors (11 pre-existing warnings, all on unrelated lines) |
| `todayLocalStr` unit test (WOD-SIMPLE `utils.test.js`, pre-existing) | **PASS** — already proves the exact "00:30 local, no UTC skew" invariant both newly-fixed call sites now depend on |

No existing test in either repo asserted the old (buggy) UTC-based behavior, so nothing needed to be rewritten — only the new `dateLocal.test.ts` was added.

## 10. Boundary Verification

| Test | Scenario | Result |
|---|---|---|
| **Midnight boundary** | `00:30` local (Romania, UTC+2/+3) — the exact window where `toISOString().slice(0,10)` previously returned "yesterday" | Covered directly by `dateLocal.test.ts` ("00:30 local, still same day") and the pre-existing WOD-SIMPLE `utils.test.js` `todayLocalStr` test — both assert the local date, not the UTC-shifted one |
| **Same-day past class** | A class today whose `end_time` has already passed | Governed by the *pre-existing, untouched* `classTimeStatus`/`isInAttendanceGraceWindow` pattern (already correct) — not touched by this mission, re-confirmed unmodified |
| **Same-day future class** | A class today not yet started | Same as above — pre-existing correct pattern, unmodified |
| **DST transition** | Local getters (`getFullYear`/`getMonth`/`getDate`/`getHours`) always reflect the OS/browser's already-DST-adjusted local time — no manual offset math is used anywhere in the fix, so DST requires no special-casing | Verified by code inspection: `dateLocal.ts`/`utils.js` never reference a fixed UTC offset, only `Date` instance getters |
| **Browser timezone independence** | Since `todayLocalStr`/`nowLocalTimeStr` take an injectable `Date`, tests construct explicit local times (`new Date(2026, 7, 24, 0, 30, 0)`) rather than depending on the test runner's own OS timezone | Confirmed via `dateLocal.test.ts` construction style |
| **Admin↔Member consistency** | Waiver "current version" resolution | Both clients now call the identically-behaved `todayLocalStr()` pattern (WOD-SIMPLE's pre-existing one, forge-admin-web's new port) — same input, same output, by construction |

## 11. P0-01 Regression

**P0-01's `enforce_class_deletion_policy()` trigger was re-read live from production and is byte-for-byte unchanged** from the version it was closed with (verified via `pg_get_functiondef` against the linked production DB, 2026-08-26). Its two closed invariants (unconditional `checked_in` guard; datetime-boundary "past" check) remain intact and were not touched by this mission, per the mission's own explicit "do not modify P0-01 booking integrity logic" instruction.

**Flagged conflict (not resolved, reported per Phase 7's explicit instruction):** the trigger's own "has this class ended" check —

```sql
v_class_ended := (OLD.date + OLD.end_time) < now();
```

— implicitly casts the naive `date + time` expression using the DB session timezone (confirmed UTC), not gym-local time. This means the trigger's past/future classification is itself skewed by Romania's UTC offset (2-3h), the same root-cause class of bug this entire P0-03 mission exists to fix — just found in already-closed P0-01's own implementation rather than in a new site. **Per this mission's explicit instruction, this was NOT changed.** It is disclosed here as a discovered conflict requiring its own explicit approval before any change to the already-closed P0-01.

## 12. Remaining Risks (out of scope, explicitly disclosed, not fixed)

| Finding | Location | Evidence |
|---|---|---|
| `enforce_class_deletion_policy()` "has this class ended" check | DB trigger (P0-01) | `(OLD.date + OLD.end_time) < now()`, confirmed live — see §11 |
| `dashboard_resolve_window()` `'today'` window resolution | `20260815120000_dashboard_phase0_resolve_window.sql` | `date_trunc('day', now())` — feeds `get_attendance_summary`/`get_class_summary`/`get_membership_summary`, all 3 platform-wide dashboard RPCs |
| `m9_publish_waiver()` effective-date assignment | `20260729120000_m9_waiver_management.sql` | `v_effective_date := greatest(current_date, ...)` |
| Financial subscription RPCs' `v_today` | `20260720110100_financial_rpc_create_subscription.sql` (and related create/activate-subscription migrations) | `v_today date := current_date` — same class of risk in the Financial domain (FROZEN, per memory — changes require an explicit ADR) |
| Broader category: `current_date`/`now()::date`/`date_trunc('day', now())` usage | ~25 migration files across Financial, Dashboard, Waivers, and Class-deletion domains (grep-confirmed, not individually line-audited) | Not claimed as 25 confirmed bugs — only the 4 rows above were traced to an actual business-date comparison; the remainder is flagged as a category worth a dedicated follow-up pass, not inflated into confirmed findings here |

All four SQL-side findings above share the identical root cause as the fixed client-side bugs (DB session timezone = UTC ≠ gym-local time), but fixing them touches shared, already-shipped, in some cases FROZEN (Financial) SQL — explicitly out of this mission's scope per its own "do not rewrite scheduling/booking/membership architecture" and "stop and report" instructions. Recommend a dedicated follow-up P0/P1 item, scoped narrowly to server-side date derivation, with the same "smallest safe fix + regression test" discipline.

## 13. Final Invariant

1. **For every client-side date/time site touched in this mission** (waiver current-version, dashboard "next class today"/"now", Platform Admin gym expiry, gym-waiver current-lookup): given the same underlying stored data, WOD-SIMPLE and forge-admin-web now resolve "today" and "now" identically, using the device's local timezone, with no UTC-shift window of disagreement.
2. **This invariant does not yet extend to server-side (SQL) date derivation** — 4 named, evidence-backed SQL sites (§11-12) still compute "today"/"now" under the DB's UTC session timezone, a residual gap explicitly disclosed rather than silently left undocumented.

---

Both repos: `tsc`/lint/full test suite green. Ready to commit, push, bump WOD-SIMPLE `app_version`, and update memory. Stopping here per this mission's explicit instruction — no P0-04, no further work, pending approval.
