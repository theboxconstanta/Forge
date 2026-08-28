# FORGE — DASHBOARD_RESOLVE_WINDOW TIMEZONE FOLLOW-UP — IMPLEMENTATION REPORT
Date: 2026-08-28
Mission: narrow investigation + remediation of one server-side timezone finding (`dashboard_resolve_window`). Single-function scope.

---

## 1. Executive Verdict

**DASHBOARD_RESOLVE_WINDOW TIMEZONE FOLLOW-UP CLOSED**

No closed item (P0-01 / P0-02 / P0-03 / P0-SEC-01..03 / INC-01 / INC-02 / Yesterday-WOD) was reopened or modified. `m9_publish_waiver` and the Financial RPCs were not touched. Security Gate remains GREEN.

---

## 2. Live Function

- **Name:** `public.dashboard_resolve_window`
- **Arguments:** `p_window text, p_custom_start date DEFAULT NULL, p_custom_end date DEFAULT NULL`
- **Return type:** `public.dashboard_window_bounds` (composite: `period_start`, `period_end`, `prior_period_start`, `prior_period_end` — all `timestamp with time zone`)
- **Security:** `SECURITY INVOKER` (`prosecdef = false`), `LANGUAGE plpgsql`, `STABLE`, no `SET search_path`, owner `postgres`
- **Pre-fix definition summary:** each window preset (`today` / `thisWeek` / `thisMonth` / `last30Days`) derived its boundaries from `now()` and `date_trunc('day'|'week'|'month', now())`. `now()` is `timestamptz`; `date_trunc(unit, timestamptz)` truncates in the **DB session timezone** (UTC in production). `custom` used `p_custom_start::timestamptz` / `(p_custom_end + 1)::timestamptz`. The prior/comparison window was `period_start - (period_end - period_start)` (or `- interval '1 month'` for `thisMonth`), `prior_period_end := period_start`.

**Documented timezone defect still present: YES** — confirmed by direct read of the live definition and reproduced deterministically (§7, §8, §12).

---

## 3. Original Finding

From `P0_03_TIMEZONE_DATE_TIME_CONSISTENCY_IMPLEMENTATION_REPORT.md` (§10, §20) and `FORGE_DATE_TIME_POLICY.md` (§7), carried into `FORGE_MASTER_HANDOFF_2026-08-28` (§16 #2, §23):

- **Finding:** `dashboard_resolve_window()` `'today'` branch uses `date_trunc('day', now())`, evaluated under the DB session timezone (UTC), not gym-local — "the same class of bug as the client-side anti-pattern, just expressed in SQL." Feeds 3 platform-wide Dashboard RPCs.
- **Severity:** P1 (disclosed, unfixed).
- **Why left open:** P0-03's explicit stop-and-report rule — "do not silently alter already-shipped, business-critical SQL without explicit approval." Server-side SQL was out of P0-03's scope.
- **Exact expression considered unsafe:** `date_trunc('day', now())` (the `'today'` branch was named specifically; the identical pattern is present in the `'thisWeek'` / `'thisMonth'` branches and the `now()` endpoints of `'thisWeek'` / `'thisMonth'` / `'last30Days'`).

The live code still matches this description — the finding is valid.

---

## 4. Business Semantics

`dashboard_resolve_window` resolves a **gym-local calendar-date window** (plus a same-shape prior window for delta/trend comparison) from a preset label.

| Element | Class | Meaning |
|---|---|---|
| `p_window` | E (label) | one of `today`, `thisWeek`, `thisMonth`, `last30Days`, `custom` |
| `p_custom_start` / `p_custom_end` | **A — date-only** | gym-local calendar dates (only for `custom`) |
| `period_start` / `period_end` | declared B (timestamptz), **semantically A** | the window's gym-local date span; every consumer reads them as `::date` |
| `prior_period_start` / `prior_period_end` | same | the comparison window's gym-local date span |

- "today" = the gym's Romanian local calendar day.
- Edges: **inclusive start, exclusive end** (`col >= start::date AND col < end::date`). `today` includes the current day; `thisWeek`/`thisMonth`/`last30Days` end at the current local time so, at the `::date` level, they cover up to but **not including** the current day (pre-existing, preserved). `custom` end is `p_custom_end + 1` (inclusive of `p_custom_end`).
- `thisWeek` uses ISO weeks (Monday start), matching `date_trunc('week', …)`.
- Used for: **attendance, classes, membership** counts (not revenue — see §5, §15).
- Output type is `timestamptz` but the values are a **gym-local-DATE contract** — consumed only via `::date`. They are not true absolute instants.

---

## 5. Callers

Exhaustive (all normal functions whose body references `dashboard_resolve_window`, via `pg_get_functiondef` scan; plus a repo-wide client grep):

| Caller | Repo/SQL | Input | Output use | Production-relevant |
|---|---|---|---|---|
| `public.get_attendance_summary(uuid,text,date,date)` | Postgres (SECURITY INVOKER, STABLE) | passes `p_window`, `p_custom_start/end` straight through | `v_bounds.period_start::date` / `period_end::date` / `prior_period_*::date` to filter **`classes.date`** (a `date` column) | RPC deployed; **no live UI consumer** (see below) |
| `public.get_class_summary(uuid,text,date,date)` | Postgres (same) | same | same, filtering **`classes.date`** | same |
| `public.get_membership_summary(uuid,text,date,date)` | Postgres (same) | same | same, filtering **`subscriptions.start_date` / `subscriptions.end_date`** (both `date` columns) | same |
| forge-admin-web `getAttendanceSummary` / `getClassSummary` / `getMembershipSummary` | `src/features/dashboard/analytics.ts` | thin typed `supabase.rpc()` wrappers | return the row to the caller | **referenced only in `analytics.test.ts` (mock tests); no live component imports them** |
| forge-admin-web `TodayCommandCenter` | — | — | uses `getDashboardTodaySummary` → a **different** SQL function that does **not** call `dashboard_resolve_window` | n/a |

**Every SQL caller consumes the bounds exclusively as `::date`.** No caller uses the raw `timestamptz`. No caller passes a timestamp; all inputs are labels or `date`s. **No Financial/revenue RPC calls `dashboard_resolve_window`.**

**Current production exposure:** the 3 summary RPCs are deployed and callable but have no live UI consumer today (Dashboard 2.0 wired `TodayCommandCenter`/`PerformanceCommandCenter` to other functions). The defect is therefore a real but **latent** production defect in the analytics layer — fixed here so it is correct whenever those RPCs are wired up.

---

## 6. Canonical Timezone

**`Europe/Bucharest`** (IANA), hard-coded in the function as an explicit single-gym-deployment constant.

The function's business semantics genuinely require **gym-local calendar boundaries** ("today", "this week/month" for a Romanian gym). `FORGE_DATE_TIME_POLICY.md` §1/§12 makes the canonical business timezone "device-local" and declines a stored server timezone; a Postgres function has no device context, so the server-side resolution must commit to a concrete zone, and the only defensible one is the single physical gym's zone (Romania → `Europe/Bucharest`), consistent with the user-approved P0-01 SQL timezone fix (`20260828120000`) and the P0-03 report's "coincides with Europe/Bucharest by circumstance" framing. `gyms.timezone` was **not** introduced; no broader timezone architecture was added. This is not a claim of generic multi-timezone support.

---

## 7. Reproduction (deterministic, pre-fix)

Expression-level, synthetic `now = 2026-08-27 21:30:00Z` = **00:30 Europe/Bucharest on 2026-08-28** (just after gym-local midnight; correct gym-local "today" = 2026-08-28). Values are the `::date`-consumed window bounds a caller would compute:

| Window | pre-fix @ UTC session (production) | pre-fix @ Europe/Bucharest (reference-correct) |
|---|---|---|
| `today` | **[2026-08-27 .. 2026-08-28)** ❌ (the whole of *yesterday*) | [2026-08-28 .. 2026-08-29) |
| `thisWeek` | **[2026-08-24 .. 2026-08-27)** ❌ | [2026-08-24 .. 2026-08-28) |
| `thisMonth` | **[2026-08-01 .. 2026-08-27)** ❌ | [2026-08-01 .. 2026-08-28) |
| `last30Days` | **[2026-07-28 .. 2026-08-27)** ❌ | [2026-07-29 .. 2026-08-28) |

Every window is wrong under the production UTC session for ~2–3 hours after gym-local midnight (`today` is wrong by a full day). At least one pre-fix failing case: satisfied (all four windows, and again at every DST/rollover boundary in §12).

---

## 8. Session-TZ Dependence

Same synthetic instant, `'today'` window, `::date`-consumed start:

| Session TZ | pre-fix | post-fix |
|---|---|---|
| `UTC` (production) | `2026-08-27` ❌ | `2026-08-28` ✓ |
| `Europe/Bucharest` | `2026-08-28` ✓ | `2026-08-28` ✓ |
| `America/New_York` | `2026-08-27` ❌ | `2026-08-28` ✓ |

- **Pre-fix: session-timezone-DEPENDENT** (UTC and America/New_York wrong; only Europe/Bucharest correct).
- **Post-fix: session-timezone-INDEPENDENT** (identical, correct, in all three).

Live post-deploy confirmation — `dashboard_resolve_window` called for all four windows under `SET TIME ZONE 'UTC'`, `'Europe/Bucharest'`, and `'America/New_York'`: **byte-identical results in all three.**

---

## 9. Type Semantics

Pre-fix conversion chain (the bug):
```
now()                       -> timestamptz
date_trunc('day', now())    -> timestamptz, truncated at midnight OF THE SESSION TIMEZONE  ← implicit tz dependence
  ... assigned to period_start (timestamptz) ...
caller: period_start::date  -> date, extracted IN THE SESSION TIMEZONE                      ← second implicit tz dependence
```
Under a UTC session both steps use UTC, so a gym-local time of 00:30 (an instant at 21:30Z the previous day) truncates/extracts to the previous calendar day.

Post-fix chain:
```
now() AT TIME ZONE 'Europe/Bucharest'          -> timestamp without time zone (naive gym-local wall clock)
date_trunc('day', <that naive value>)          -> timestamp without time zone (naive gym-local midnight)
  ::timestamptz                                -> timestamptz (re-stamped in session tz — value is nominal, not a true instant)
caller: period_start::date                     -> date
```
Key identity (verified live under UTC, Europe/Bucharest, America/New_York): for any naive timestamp `N` and any session timezone `S`, `N::timestamptz::date == date(N)`. So the caller's `::date` recovers the gym-local calendar date regardless of `S`.

`custom`: `p_custom_start::timestamptz` — `date -> timestamptz -> ::date` is identity for any session tz, so `custom` was never affected and is unchanged.

---

## 10. Root Cause

**Classification: SESSION-TIMEZONE DEPENDENT DATE BOUNDARY.**

`date_trunc(unit, now())` and `now()` / `now() - interval` were used to derive calendar boundaries; both the truncation and the caller's subsequent `::date` extraction are evaluated in the DB session timezone (UTC in production) rather than the gym's business timezone, shifting every window by the UTC↔Bucharest offset for the hours around gym-local midnight.

**Confidence: HIGH** (live definition read; deterministic reproduction across day/week/month/year and both DST regimes; faithful-transposition equivalence proof; live post-deploy multi-session verification).

---

## 11. Fix

- **Old conceptual behaviour:** window boundaries = `date_trunc(unit, now())` / `now()` / `now() - interval '30 days'`, resolved in the DB session timezone.
- **New conceptual behaviour:** compute `v_local_now := now() AT TIME ZONE 'Europe/Bucharest'` (naive gym-local wall clock); run the identical `date_trunc` / interval math on that naive value; re-stamp each boundary `::timestamptz`. The sub-day time component of `thisWeek`/`thisMonth`/`last30Days` `period_end` is preserved exactly as `v_local_now::timestamptz`, so the prior-period arithmetic yields identical `::date` results. `custom` unchanged. Window presets, inclusive/exclusive edges, the prior-period formula, and both `RAISE` branches are unchanged — only the timezone of resolution.
- **Equivalence proof:** `pre-fix @ Europe/Bucharest session` (the always-correct reference) `===` `post-fix @ UTC session` for **all 4 windows × all 4 bound fields**, verified at a normal daytime instant and at 5 boundary instants (post-midnight, summer DST, winter DST, year rollover, week rollover). The fix changes production (UTC) behaviour to exactly what the correct (Bucharest) behaviour always should have been — nothing else.
- **Migration:** `supabase/migrations/20260828130000_dashboard_resolve_window_timezone_safe.sql` (new). Sole change: `CREATE OR REPLACE FUNCTION public.dashboard_resolve_window(text,date,date)` + refreshed `COMMENT ON FUNCTION`. Applied live directly from this file (established post-2026-08-18 workflow).

---

## 12. Regression Matrix

`'today'` window, `::date`-consumed start, vs the correct gym-local date, under 3 session timezones. `[ok]`/`[ERR]` = matches / does not match the correct gym-local date.

| # | Case (synthetic `now`) | UTC OLD | UTC NEW | Europe/Bucharest OLD | Europe/Bucharest NEW | America/New_York OLD | America/New_York NEW |
|---|---|---|---|---|---|---|---|
| 1 | Daytime (`14:00` Bucharest) | ok | ok | ok | ok | ok | ok |
| 2 | Just after local midnight (`00:30`) | **ERR** | ok | ok | ok | **ERR** | ok |
| 3 | (session = UTC) — see columns | — | — | — | — | — | — |
| 4 | (session = Europe/Bucharest) — see columns | — | — | — | — | — | — |
| 5 | Identical result across session TZs (post-fix) | — | **YES** (UTC = Bucharest = NY, live) | — | — | — | — |
| 6 | Summer DST (`00:30` local, 2026-07-15, EEST +3) | **ERR** | ok | ok | ok | **ERR** | ok |
| 7 | Winter DST (`00:30` local, 2026-01-15, EET +2) | **ERR** | ok | ok | ok | **ERR** | ok |
| 8a | Month rollover (`00:30` local, 2026-09-01) | **ERR** | ok | ok | ok | **ERR** | ok |
| 8b | Year rollover (`00:30` local, 2026-01-01) | **ERR** | ok | ok | ok | **ERR** | ok |
| 8c | Week rollover (`00:30` local Monday) `thisWeek` start | **ERR** (prev Monday) | ok | ok | ok | **ERR** | ok |
| 9 | Inclusive/exclusive edges preserved | pre-fix @ Bucharest `===` post-fix @ any session, all 4 windows × 4 fields (5 boundary instants) → **PASS** |
| 10 | Production callers: `get_attendance_summary` / `get_class_summary` / `get_membership_summary` × {today, thisWeek, thisMonth, last30Days} + one `custom` = 13 invocations against the real gym, under UTC and Europe/Bucharest sessions | **all execute, no error, pre- and post-deploy** → **PASS** |

Pre-fix shows the real defect (every near-midnight case wrong under the production UTC session and under NY). Post-fix: all cases correct under all sessions. Daytime: no regression (OLD == NEW).

- **`custom` window** (live, post-deploy): `[2026-08-01 .. 2026-08-08)` — inclusive `p_custom_start`, exclusive `p_custom_end + 1`, session-independent. Unchanged.
- **`unknown window` / missing `custom` args**: both `RAISE EXCEPTION` branches unchanged.

---

## 13. DST

- **Summer** (2026-07-15, EEST = UTC+3): pre-fix @ UTC resolved `'today'` to 2026-07-14 (wrong); post-fix resolves 2026-07-15 under any session. IANA zone applied automatically.
- **Winter** (2026-01-15, EET = UTC+2): pre-fix @ UTC resolved 2026-01-14 (wrong); post-fix resolves 2026-01-15 under any session.
- No fixed `+02` / `+03` offset appears anywhere — `AT TIME ZONE 'Europe/Bucharest'` handles the seasonal offset per the window's own date.

---

## 14. Boundary Semantics

- **Midnight:** post-fix, a class/subscription at gym-local 00:00–02:59 is correctly attributed to the current local day (pre-fix it fell into the previous day for ~2–3h nightly under the UTC session).
- **Week/month/year:** `date_trunc('week'|'month', v_local_now)` computes the correct local Monday / 1st-of-month / and rolls the year correctly (verified at 2026-01-01 00:30 local → January, 2026). ISO-week (Monday) semantics unchanged.
- **Inclusive/exclusive unchanged:** verified — `pre-fix @ Bucharest === post-fix @ any session` for every field; `custom` still `[start, end+1)`; `thisWeek`/`thisMonth`/`last30Days` still end at "now" (so exclude the current day at `::date` granularity); `today` still includes the current day.

---

## 15. Financial Boundary

- **Financial semantics changed: NO.** `dashboard_resolve_window` has exactly three callers (`get_attendance_summary`, `get_class_summary`, `get_membership_summary`). Verified live: none references `orders`, `payments`, or any revenue table (`get_membership_summary` reads only `subscriptions` — count of active / new / cancelled by `start_date`/`end_date`, a Membership-domain concern, not Financial). No Financial/revenue RPC calls `dashboard_resolve_window`.
- **ADR required: NO.**

---

## 16. Security

- RLS changed: **NO**
- GRANTs changed: **NO**
- Function security posture changed: **NO** — `SECURITY INVOKER` retained (`prosecdef = false`), no `SET search_path` (none existed, none added), `STABLE` retained, owner `postgres` unchanged. `CREATE OR REPLACE FUNCTION` preserves ownership and ACL; verified live post-deploy.
- Views / default ACLs / auth: untouched. Security Gate remains **GREEN**. No security audit was run.

---

## 17. Production Data

- Historical production data modified: **NO**

All tests were `SELECT`-only or executed inside a transaction that was `ROLLBACK`'d (the end-to-end caller smoke test). The only permanent production write was the migration's `CREATE OR REPLACE FUNCTION` + `COMMENT ON FUNCTION`. No `INSERT`/`UPDATE`/`DELETE` on any data table.

---

## 18. Application Code

**Modified: NO.** No file in `src/` of either repo was changed. `forge-admin-web/src/features/dashboard/analytics.ts` already types the fields as `string` and consumes them opaquely; no contract adaptation was needed.

---

## 19. Deployment

- **Production deployed: YES** — migration `20260828130000_dashboard_resolve_window_timezone_safe.sql` applied to Forge Production (`sdfkvfbvgpuspnnnwqwk`) via `supabase db query --linked` as `postgres`, directly from the migration file. No error.
- **Live definition re-read: YES** — `pg_get_functiondef()` post-deploy shows `v_local_now := now() AT TIME ZONE 'Europe/Bucharest'`, all four preset branches using `v_local_now`, `custom` unchanged, prior-period block unchanged, `prosecdef = false`, `proconfig = null`, `provolatile = 's'`, owner `postgres`, `COMMENT` updated.
- **Post-deploy live verification:** resolver identical across UTC / Europe/Bucharest / America/New_York sessions; all 3 summary RPCs + `custom` execute cleanly against the real gym.

---

## 20. Out-of-Scope Findings

- **`m9_publish_waiver`: UNTOUCHED** — verified live still contains its disclosed `greatest(current_date, …)` pattern, unchanged. Remains OPEN / P1.
- **Financial RPCs: UNTOUCHED** — Financial domain remains FROZEN; `current_date` usage remains OPEN / P1, ADR-gated.
- **P0-01 trigger (`enforce_class_deletion_policy`): UNTOUCHED** — verified live still contains the `20260828120000` `AT TIME ZONE 'Europe/Bucharest'` fix, unchanged.
- **`get_dashboard_today_summary` and other dashboard functions:** not in scope; `dashboard_resolve_window`'s only callers are the 3 named summary RPCs.
- RLS / security views / INC-01 / INC-02 / workout logging: not referenced by this mission.

Only one function (`dashboard_resolve_window`) + its `COMMENT` were altered.

---

## 21. Remaining Severity

For **this** finding (`dashboard_resolve_window` timezone): **NONE.** The window boundaries are now resolved in the gym business timezone, DST-correct via the IANA zone, and independent of the DB session timezone; the fix is a verified faithful transposition (no range/edge/comparison-semantics change).

The other disclosed server-side timezone findings remain OPEN at **P1**, each its own separately-authorized mission: `m9_publish_waiver()`, Financial subscription RPCs' `current_date` (ADR-gated). The ~25-file category-level flag remains **P2**.

---

## 22. Final Verdict

**DASHBOARD_RESOLVE_WINDOW TIMEZONE FOLLOW-UP CLOSED**
