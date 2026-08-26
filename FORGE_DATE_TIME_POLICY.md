# FORGE DATE & TIME POLICY

Canonical, platform-wide. Written 2026-08-26 as part of P0-03. Applies to WOD-SIMPLE (Member PWA) and forge-admin-web (Admin/Coach) equally — the two repos share no code, so this policy is enforced by *matching pattern*, not by a shared import.

## 1. Business timezone

Forge has no `gyms.timezone` column. Today the platform runs a single gym in Romania, so "the browser/session's local timezone" and "the gym's business timezone" are the same thing by coincidence, not by design. **The canonical business timezone is: the local timezone of the device rendering the UI.** This policy does not introduce a stored per-gym timezone — doing so is out of scope for P0-03 (would require schema change + multi-tenant scheduling rework) and is not needed until Forge has a gym outside Romania.

## 2. Date-only values ("today", `paid_until`, `effective_date`, class `date`)

Never derive with `new Date().toISOString().slice(0, 10)` (UTC calendar date). Always derive with local getters (`getFullYear()`/`getMonth()`/`getDate()`), via:
- WOD-SIMPLE: `todayLocalStr()` in `src/utils.js`
- forge-admin-web: `todayLocalStr()` in `src/lib/dateLocal.ts`

Both have the identical signature `(now: Date = new Date()) => "YYYY-MM-DD"`, accepting an injectable `now` for testability.

## 3. Time-of-day values (comparing against `classes.start_time`/`end_time`)

Never derive with `new Date().toISOString().slice(11, 19)` (UTC time-of-day). `classes.start_time`/`end_time` are stored as naive `time` — gym-local wall-clock strings (e.g. `"18:30:00"`). Always derive the comparison value with local getters, via `nowLocalTimeStr()` (forge-admin-web `lib/dateLocal.ts`) or the equivalent local-time construction already used by `isInAttendanceGraceWindow`/`classTimeStatus` (WOD-SIMPLE `utils.js` / forge-admin-web `dashboard/components/countdown.ts`).

## 4. Scheduled class date+time comparisons ("has this class started/ended")

Construct a real `Date` from the local pieces — `new Date(\`${date}T${time}\`)` — which the JS engine interprets in the *browser's* local timezone, matching the gym-local semantics the stored strings already carry. This is the established pattern in `classTimeStatus`/`isInAttendanceGraceWindow`. Never compare the naive `date`/`time` SQL columns directly against `now()` inside Postgres (session timezone is UTC, not gym-local) — see §7.

## 5. Storage rule

- A calendar date with no time component (`classes.date`, `subscriptions.start_date`/`end_date`, `gym_waivers.effective_date`, `gyms.paid_until`) is stored as SQL `date`. Correct, unambiguous, timezone-free — do not change.
- A wall-clock time with no date (`classes.start_time`/`end_time`) is stored as SQL `time without time zone`, representing gym-local time. Correct — do not change.
- Any actual instant (an event that happened at a specific moment — `created_at`, `logged_at`, `occurred_at`, `recorded_at`, `activated_at`, `trial_ends_at`) is stored as `timestamptz`. Correct — do not change. `timestamptz` columns need no policy change; they are absolute and compare correctly regardless of session timezone.

## 6. Display rule

Any date-only or time-of-day value read from the DB (a `date`/`time` column) is already gym-local by construction — render it as-is, with no timezone conversion. Any `timestamptz` value is an absolute instant — when displayed to a human, format it through the browser's local timezone (the default behavior of `new Date(isoString)` + `toLocaleString`/`toLocaleDateString`), never left as a raw UTC ISO string.

## 7. Comparison rule (client vs server)

- **Client-side** (JS/TS in either repo): use §2/§3's local-getter helpers. This is the fix applied in P0-03.
- **Server-side** (Postgres functions/triggers): the DB session timezone is UTC (confirmed live: `current_setting('TimeZone')` = `'UTC'`). Any SQL expression that implicitly casts a naive `date`/`time`/`timestamp` value for comparison against `now()`, `current_date`, or `date_trunc('day', now())` is evaluated in UTC, not gym-local time — the same class of bug as the client-side anti-pattern, just expressed in SQL. **This policy identifies the pattern as dangerous but does not mandate a server-side fix in P0-03** — see the P0-03 implementation report's "Remaining Risks" for the specific confirmed instances, deliberately left unfixed pending explicit approval (per this mission's own Phase 7 instruction not to silently alter already-shipped, business-critical SQL without a stop-and-report step).

## 8. Server-authoritative rule

Where a value must be authoritative and audit-safe (an actual point-in-time event: PR occurred, class deletion timestamp, waiver acceptance), the server assigns it via `timestamptz`/`now()` — correct as-is, because `timestamptz` has no ambiguity to introduce. This rule does **not** extend to business *dates* computed server-side via `current_date`/`now()::date`/`date_trunc('day', now())` — those inherit the UTC-vs-gym-local gap and are flagged, not endorsed, by this policy (§7).

## 9. Membership boundary rule

`subscriptions.start_date`/`end_date` are pure `date` columns (no time-of-day, no timezone). Coverage is **inclusive on both ends**: a membership with `end_date = 2026-08-26` covers a class scheduled on `2026-08-26` (confirmed by the authoritative DB rule, `enforce_subscription_sessions()`: `start_date <= class.date AND end_date >= class.date`, and mirrored client-side identically). Because this is a pure `date`-to-`date` comparison — never cast through a timestamp or compared against `now()` — it is inherently timezone-safe and requires no special handling. Do not introduce a timestamp-based membership-validity check; the date-only comparison is correct and simpler.

## 10. `timestamptz` range-filter rule ("everything that happened on gym-local day X")

Never send a naive string like `` `${dateStr}T00:00:00` `` directly to a Supabase `.gte()`/`.lte()` filter against a `timestamptz` column (`logged_at`, `created_at`). PostgREST/Postgres interprets a naive timestamp string using the **DB session's own timezone** (confirmed live: UTC), not local — so a row created between gym-local midnight and ~2-3am silently falls under the *previous* day's range instead of the correct one. This is a distinct manifestation of the same root defect as §2/§3 — confirmed live in 4 real call sites during P0-03 (leaderboard-by-date in both repos, WOD-SIMPLE's Admin monthly reports, forge-admin-web's Dashboard "membership created on X" feed) — and fixed the same way: construct a real local `Date` (no `Z`/offset suffix — parsed as local per the ECMAScript spec) for the day's start/end, then call `.toISOString()` on it before sending to Supabase. Use `localDayBoundsUTC(dateStr)` (WOD-SIMPLE `utils.js` / forge-admin-web `lib/dateLocal.ts`), which returns `{ startUTC, endUTC }` ready for `.gte()`/`.lte()`.

## 11. DST rule

Never hardcode a fixed UTC offset (`UTC+2`/`UTC+3`) for Romania. Every helper in this policy (`todayLocalStr`, `nowLocalTimeStr`, `localDayBoundsUTC`, `classTimeStatus`/`isInAttendanceGraceWindow`) derives its result exclusively from `Date` instance getters (`getFullYear`/`getMonth`/`getDate`/`getHours`/etc.) or from constructing a `Date` via local date/time components — never manual arithmetic on a UTC offset constant. The OS/browser's `Date` implementation already resolves DST transitions correctly for the runtime's configured timezone, so no DST-specific code path exists or is needed anywhere in this policy's helpers.

## 12. Device timezone rule

A user's device/browser timezone is, today, the sole and entire definition of "the gym's business timezone" (§1) — there is no separate, stored, canonical gym timezone to fall back to or reconcile against. This is a deliberate, disclosed product limitation, not an oversight: **Forge currently operates with a single real gym, physically in Romania, so device-local time and gym-business time coincide for every real user today.** If a user's device is misconfigured, or a user is physically traveling outside Romania while using the app, their device timezone would incorrectly become the timezone Forge treats as authoritative for "today's WOD"/class scheduling — this is a known, accepted limitation of the current single-tenant-timezone model, not something this policy's helpers can detect or correct, and is out of scope to fix until Forge introduces a stored, per-gym canonical timezone (not planned as part of P0-03).

## Dangerous patterns — do not reintroduce

```js
// WRONG - UTC calendar date, skews ~2-3h after Romania midnight
const today = new Date().toISOString().slice(0, 10)

// WRONG - UTC time-of-day, off by the gym's UTC offset at every hour
const nowTime = new Date().toISOString().slice(11, 19)

// WRONG - naive string sent directly to a timestamptz range filter;
// PostgREST/Postgres interprets it as UTC, not local (see §10)
supabase.from('wod_logs').gte('logged_at', `${date}T00:00:00`).lte('logged_at', `${date}T23:59:59`)
```
```sql
-- WRONG (in a function/trigger comparing against gym-local date/time columns)
current_date
now()::date
date_trunc('day', now())
(some_naive_date_column + some_naive_time_column) < now()
```

## Correct patterns

```js
// WOD-SIMPLE
import { todayLocalStr } from './utils'
const today = todayLocalStr()

// forge-admin-web
import { todayLocalStr, nowLocalTimeStr } from '../../lib/dateLocal'
const today = todayLocalStr()
const nowTime = nowLocalTimeStr()

// scheduled class date+time comparison (either repo)
const classStart = new Date(`${classDate}T${startTime}`)

// "everything that happened on gym-local day X" range filter (either repo)
import { localDayBoundsUTC } from './utils' // or '../../lib/dateLocal'
const { startUTC, endUTC } = localDayBoundsUTC(date)
supabase.from('wod_logs').gte('logged_at', startUTC).lte('logged_at', endUTC)
```
