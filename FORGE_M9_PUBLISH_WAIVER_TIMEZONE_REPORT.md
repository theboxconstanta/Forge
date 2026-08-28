# FORGE — M9_PUBLISH_WAIVER TIMEZONE FOLLOW-UP — IMPLEMENTATION REPORT
Date: 2026-08-28
Mission: narrow forensic investigation + conditional remediation of one server-side timezone finding (`m9_publish_waiver`). Single-function scope.

---

## 1. Executive Verdict

**M9_PUBLISH_WAIVER TIMEZONE FOLLOW-UP CLOSED**

No closed item (P0-01 / P0-01 SQL timezone / dashboard_resolve_window / P0-02 / P0-SEC-01..03 / P0-03 / INC-01 / INC-02 / Yesterday-WOD) was reopened or modified. No Financial RPC touched. `m9_write_audit_entry` not touched. Security Gate remains GREEN. Waiver/legal semantics not redefined.

---

## 2. Object Identity

- **Schema:** `public`
- **Name:** `m9_publish_waiver`
- **Type:** function (RPC — called by client via the `admin-manage-waiver` Edge Function; no SQL caller, no trigger)
- **Arguments:** `p_gym_id uuid, p_actor_admin_id uuid, p_title text, p_content_ref text`
- **Return:** `TABLE(id uuid, version text, effective_date date, immediate boolean)`
- **Security posture:** `LANGUAGE plpgsql`, `SECURITY DEFINER`, `SET search_path TO 'public'`, `VOLATILE`, owner `postgres` — all unchanged by the fix.

**Documented timezone pattern still present: YES** — `greatest(current_date, coalesce(v_max_effective + 1, current_date))` plus `(v_effective_date <= current_date)` were present in the live definition; reproduced deterministically (§10).

---

## 3. Original Finding

`P0_03_TIMEZONE_SOURCE_OF_TRUTH_IMPLEMENTATION_REPORT.md` (§11 table, §12) and the P0-03 continuation report flagged:

- `m9_publish_waiver()` effective-date assignment: `v_effective_date := greatest(current_date, ...)` in `20260729120000_m9_waiver_management.sql`.
- Severity: **P1**. Labeled "CONFIRMED BUG — NOT FIXED" in one report, "CONFIRMED/POTENTIAL BUG" in another — the pattern was identified but **not reproduced**, and **no concrete business impact or historical evidence was established**.
- Why it remained open: P0-03's explicit scope boundary (server-side SQL out of scope; "stop and report" before altering already-shipped business-critical SQL), compounded by this being a waiver/legal-semantics surface.
- Suspected behavior: `current_date` resolved under the DB session timezone (UTC) rather than gym-local, so a waiver `effective_date` could be off by one day near local midnight.

---

## 4. Actual Business Function

M9 = "Waiver / Gym Rules Management". `m9_publish_waiver` publishes a **new immutable version** of a gym's waiver / rules document:

- Validates non-empty `title` / `content_ref`.
- Computes `version` = `count(existing rows for this gym) + 1`.
- Computes `effective_date` = `greatest(business_today, previous_max_effective_date + 1)` — "effective today, unless a prior version is effective today or later, in which case the day after it" (keeps versions in strict chronological order, one effective date each).
- **INSERTs** one `gym_waivers` row (never UPDATEs — prior versions are immutable; member acceptances stay linked to the version they accepted).
- Writes an `admin_audit_log` entry (`gym_waiver_published`) via `m9_write_audit_entry`.
- Returns `(id, version, effective_date, immediate)` where `immediate = (effective_date <= business_today)`.

**Callers:** the `admin-manage-waiver` Edge Function (admin-only; derives `gym_id` from the caller's own `admins` row; passes **no date**). **Member-visible:** yes — the "current" waiver version (the one members see / must accept) is derived as `the most recent gym_waivers row with effective_date <= today`. **Affects:** which waiver/rules text is legally in force; gym activation checklist (an admin must have a current waiver before inviting members). Does **not** affect: booking, attendance, membership entitlement, payments, eligibility scoring.

---

## 5. Date/Time Semantics

| Value | SQL type | Business meaning | Source | Destination |
|---|---|---|---|---|
| `current_date` (×3, pre-fix) | `date` | intended: "the gym's business today" | DB **session** date (UTC in prod) — **wrong source** | `greatest()` operands; `immediate` comparison |
| `v_max_effective` | `date` | latest existing waiver's effective date for this gym | `max(gym_waivers.effective_date)` | `+ 1` → `greatest()` operand |
| `v_max_effective + 1` | `date` | earliest date a new version may take without colliding with the prior one | derived | `greatest()` operand |
| `v_effective_date` (`greatest(...)` result) | `date` | **A — business calendar date**: the day this waiver version becomes the current one | computed | **persisted** to `gym_waivers.effective_date` (NOT NULL); returned |
| `gym_waivers.created_at` | `timestamptz` | B — absolute instant the row was inserted | `now()` default | audit / display only — **not** used in any date logic |
| `immediate` (return) | `boolean` | is this version in force right now (business today)? | `v_effective_date <= current_date` | returned to client (informational) |

The bug: the three `current_date` references are **class-A business calendar dates** that must be **gym-local**, but were sourced from the session date.

---

## 6. Callers

| Caller | Location | Auth context | Inputs | Output / side effect | Live consumer |
|---|---|---|---|---|---|
| `admin-manage-waiver` Edge Function | `WOD-SIMPLE/supabase/functions/admin-manage-waiver/index.ts` | admin JWT verified; `gym_id` from caller's own `admins` row (never client-trusted); calls via service-role client | `p_gym_id`, `p_actor_admin_id`, `p_title`, `p_content_ref` — **no date** | INSERT `gym_waivers` row; audit entry; returns `{id, version, effective_date, immediate}` | forge-admin-web `WaiverSettings` / `WaiverForm` (`publishWaiver`); WOD-SIMPLE `ActivationDashboard.jsx` (activation checklist) |
| — SQL callers | none | — | — | — | — |
| — triggers | none | — | — | — | — |

`gym_waivers.effective_date` consumers: forge-admin-web `fetchWaivers` (`current = all.find(w => w.effective_date <= todayLocalStr())` — already gym-local per P0-03); WOD-SIMPLE `ActivationDashboard` (`.lte('effective_date', todayLocalStr())`). Both compare against a **gym-local** "today", so a UTC-shifted stored `effective_date` desynchronises them from the client's own correct notion of "today".

**Production relevance:** actively reachable (the admin waiver-publish flow is live), but low-frequency (waivers are published rarely). Not dead.

---

## 7. Write Path

```
admin (forge-admin-web / WOD-SIMPLE ActivationDashboard)
  → supabase.functions.invoke('admin-manage-waiver', { action:'publish', title, content })
  → Edge Function: verify admin JWT → resolve caller's gym_id from admins row
  → admin.rpc('m9_publish_waiver', { p_gym_id, p_actor_admin_id, p_title, p_content_ref })
  → SECURITY DEFINER function:
       v_today / current_date  ← business-date derivation  ← THE DEFECT SITE
       v_effective_date := greatest(...)
       INSERT INTO gym_waivers (..., effective_date = v_effective_date, ...)   ← PERSISTENT STATE
       m9_write_audit_entry(...)                                               ← admin_audit_log INSERT
  → returns (id, version, effective_date, immediate)
  → client shows the new version; effective_date later drives "which waiver is current"
```

The calculated date **becomes persistent, immutable production state** (`gym_waivers.effective_date`). A timezone error therefore **stores a wrong legal effective date**, not merely a display glitch — this is why the finding warranted a HIGH-confidence bar and a legal-semantics gate.

---

## 8. CURRENT_DATE Semantics

- `current_date` type: `date`.
- Derivation: the date component of `now()` (transaction start) **expressed in the current session `TimeZone`** — equivalent to `(now() AT TIME ZONE current_setting('TimeZone'))::date`.
- Production/session timezone: **UTC** (confirmed live: `current_setting('TimeZone')` = `'UTC'`).
- Live test (right now, real clock): `current_date` = `2026-08-28` under `UTC`, `Europe/Bucharest`, `Pacific/Kiritimati`; `2026-08-27` under `Pacific/Honolulu` — i.e. `current_date` demonstrably follows the session timezone.

---

## 9. GREATEST Semantics

`v_effective_date := greatest(business_today, coalesce(v_max_effective + 1, business_today))`

Business invariant enforced: **a new waiver version's effective date is never earlier than today, and never on or before a prior version's effective date** (each version gets its own strictly-increasing effective date). `greatest()` picks whichever lower bound is more restrictive:
- No prior version → `coalesce(NULL, today)` = `today` → `greatest(today, today)` = **today**.
- Prior version already in the past → `prior + 1 <= today` → `greatest` = **today**.
- Prior version effective today or in the future → `prior + 1 > today` → `greatest` = **`prior + 1`** (`current_date` irrelevant here — bug inert).

This rule is **unchanged** by the fix. Only the value of "business_today" is corrected.

---

## 10. Reproduction

**End-to-end, live function, disposable data, transaction ROLLBACK'd** (real clock ~09:25 UTC / 12:25 Europe/Bucharest — a time when UTC and Bucharest agree, so a session one calendar day behind stands in for the Bucharest danger window):

| Session | `current_date` | persisted `gym_waivers.effective_date` (no prior waiver) |
|---|---|---|
| `UTC` | 2026-08-28 | 2026-08-28 |
| `Pacific/Honolulu` (UTC−10) | **2026-08-27** | **2026-08-27** ❌ (one day earlier than the gym-local day, which is 2026-08-28) |

**Bucharest-specific, expression-level**, synthetic instant `2026-08-28 00:30 Europe/Bucharest` (= `2026-08-27 21:30Z`), in the danger window:

| | `current_date` @ UTC session (production) | @ Europe/Bucharest |
|---|---|---|
| no prior waiver → `effective_date` | **2026-08-27** ❌ | 2026-08-28 |
| prior waiver 5 days old → `effective_date` | **2026-08-27** ❌ | 2026-08-28 |
| prior waiver 3 days in the future → `effective_date` | 2026-09-01 | 2026-09-01 (identical — `prior+1` dominates) |

At least one pre-fix scenario producing an incorrect business result: **satisfied** (a wrong, retroactive-by-one-day `effective_date` persisted).

---

## 11. Session-Timezone Dependence

**Pre-fix** (`current_date`): result **DEPENDS** on session timezone — same absolute instant, no prior waiver, persisted `effective_date` = `2026-08-28` under a UTC session but `2026-08-27` under a session one day behind.

**Post-fix** (`(now() AT TIME ZONE 'Europe/Bucharest')::date`), live post-deploy, no prior waiver:

| Session | `current_date` | persisted `effective_date` |
|---|---|---|
| `UTC` | 2026-08-28 | **2026-08-28** |
| `Europe/Bucharest` | 2026-08-28 | **2026-08-28** |
| `Pacific/Honolulu` | 2026-08-27 | **2026-08-28** |
| `America/New_York` | 2026-08-28 | **2026-08-28** |

Post-fix: **INDEPENDENT** of session timezone (identical, correct, in all four).

---

## 12. Business Impact

If the UTC date wins incorrectly (waiver published in the ~2 h [winter] / ~3 h [summer] window after gym-local midnight, and `current_date` is the winning `greatest()` operand):

- **One-day-early / retroactive effective date** persisted for an immutable legal document: the waiver row is created on gym-local day *N* but records `effective_date = N − 1`.
- Client "current waiver" resolution (`effective_date <= todayLocalStr()`) would treat the new version as in force from day *N − 1* — a day on which it did not yet exist (no member could have seen or accepted it then), so the retroactivity is **nominal, not operational** (no member-facing access or acceptance outcome actually changes, because nothing performs a "which waiver was in force on a past date" lookup).
- Admin-facing waiver history would display the wrong effective date.
- The `immediate` return flag is unaffected in practice (`N−1 <= N−1` and `N <= N` both true).

Net: a **data-integrity defect on a legal record's effective date**, with no proven operational/member-facing consequence, occurring only in a narrow nightly window and only in specific prior-waiver states.

---

## 13. Historical Production Evidence

Read-only, aggregate only:

- `gym_waivers` total rows: **2** (1 gym).
- Both created `2026-07-29` at ~`11:57`–`11:58` **Europe/Bucharest** (mid-day; UTC date == Bucharest date at that instant).
- Rows created in the UTC↔Bucharest danger window: **0**.
- Rows where `effective_date` = UTC-date-of-`created_at` AND UTC-date ≠ Bucharest-date-of-`created_at`: **0**.

**Classification: NO EVIDENCE** of historical impact. (Both existing rows were published mid-day and are unaffected; v1 → `2026-07-29`, v2 → `2026-07-30` via the normal `prior + 1` rule.) No historical data was modified (see §23).

---

## 14. Root Cause

**Classification: CURRENT_DATE SESSION-TIMEZONE BUG.** `current_date` resolves the calendar date in the DB session timezone (UTC in production); the function's business contract requires the gym's local ("business today") date, so a waiver published in the post-local-midnight window persists an `effective_date` one day early.

**Confidence: HIGH** — live definition read; end-to-end reproduction with the live function persisting a wrong `effective_date`; Bucharest-specific expression reproduction; mechanism (`current_date` follows session tz) proven live; the caller provides no date so server-side derivation is the correct place to fix.

---

## 15. Canonical Business Date

The function needs "today according to the current Forge gym". Derived as:

```sql
v_today date := (now() AT TIME ZONE 'Europe/Bucharest')::date;
```

`now() AT TIME ZONE 'Europe/Bucharest'` → `timestamp without time zone` (gym-local wall clock); `::date` → the gym-local calendar date (a `date`, the type the function needs — no timestamp is introduced). The IANA zone applies EET (UTC+2) / EEST (UTC+3) automatically per the actual date — no fixed offset hard-coded. `Europe/Bucharest` is the approved explicit single-gym (Romania) deployment constant, consistent with `20260828120000` (P0-01) and `20260828130000` (dashboard_resolve_window). No `gyms.timezone` column; none introduced.

---

## 16. Fix

- **Old expression:** `v_effective_date := greatest(current_date, coalesce(v_max_effective + 1, current_date));` and `... (v_effective_date <= current_date)` — 3× `current_date` (session/UTC date).
- **New expression:** `v_today date := (now() AT TIME ZONE 'Europe/Bucharest')::date;` declared once; `v_effective_date := greatest(v_today, coalesce(v_max_effective + 1, v_today));` and `... (v_effective_date <= v_today)`. All 3 `current_date` references replaced by `v_today`. `greatest()` (a max, not min), both operands, the `coalesce` NULL-guard, and the `<=` inclusivity of `immediate` are unchanged.
- **Migration:** `supabase/migrations/20260828140000_m9_publish_waiver_timezone_safe.sql` — sole change: `CREATE OR REPLACE FUNCTION public.m9_publish_waiver(uuid,uuid,text,text)` (same signature, same `RETURNS TABLE` shape) + refreshed `COMMENT ON FUNCTION`. Applied live directly from the file (established post-2026-08-18 workflow). `m9_write_audit_entry` untouched.

---

## 17. Regression Matrix

Harness: disposable gym (+ optional seeded prior `gym_waivers` row), call `m9_publish_waiver`, capture RPC return + persisted `gym_waivers.effective_date`, transaction aborted via terminal `RAISE` — nothing committed. "OLD" = pre-fix live logic; "NEW" = post-fix (also confirmed live post-deploy).

| # | Case | Session | OLD `effective_date` | NEW `effective_date` | Expected | Pass |
|---|---|---|---|---|---|---|
| 1 | Daytime, no prior (UTC/local agree) | UTC | 2026-08-28 | 2026-08-28 | gym-local today | ✓ (no regression) |
| 2 | Session one calendar day behind gym-local (danger-window stand-in), no prior | Pacific/Honolulu | **2026-08-27** ❌ | **2026-08-28** ✓ | gym-local today | ✓ |
| 3 | UTC session, no prior | UTC | — | 2026-08-28 | gym-local today | ✓ |
| 4 | Europe/Bucharest session, no prior | Europe/Bucharest | — | 2026-08-28 | gym-local today | ✓ |
| 5 | Just before local midnight (UTC/local agree) | UTC | 2026-08-28 | 2026-08-28 | gym-local today | ✓ |
| 6 | NEW identical across session TZs | UTC / Europe/Bucharest / Pacific/Honolulu / Pacific/Kiritimati / America/New_York | — | 2026-08-28 (all) | identical | ✓ |
| 7 | Winter date (EET UTC+2), 00:30 local | expression | n/a | `2026-01-15` from `2026-01-14 22:30Z` | local date | ✓ |
| 8 | Summer date (EEST UTC+3), 00:30 local | expression | n/a | `2026-07-15` from `2026-07-14 21:30Z` | local date | ✓ |
| 9 | Prior waiver effective `today − 5` (earlier) | UTC | 2026-08-28 (`ver 2`) | 2026-08-28 (`ver 2`) | `greatest` picks today | ✓ |
| 10 | Prior waiver effective `today − 1` (so `prior + 1` == today, tie) | UTC | — | 2026-08-28 (`ver 2`) | `greatest` tie → today | ✓ |
| 11 | Prior waiver effective `today + 3` (later) | UTC | 2026-09-01 (`imm f`) | 2026-09-01 (`imm f`) | `greatest` picks `prior + 1` | ✓ |
| 11b | Prior waiver `today + 3`, session behind | Pacific/Honolulu | 2026-09-01 | 2026-09-01 | `prior + 1` dominates → session-tz irrelevant | ✓ (OLD == NEW: bug inert) |
| 12 | No prior waiver: `version` = 1, `immediate` = true, return shape | UTC | — | `id`, `version='1'`, `effective_date=2026-08-28`, `immediate=t` | shape preserved | ✓ |

NULL behaviour: `v_max_effective` NULL (no prior waiver) → `coalesce(NULL + 1, v_today)` = `v_today` → unchanged. `p_custom_*`-style inputs: n/a (function takes no dates). `invalid_title` / `invalid_content` RAISE branches: unchanged.

Pre-fix shows the defect (Case 2). Post-fix: all cases correct, session-independent, no daytime regression.

---

## 18. DST

- **Winter (EET, UTC+2):** `2026-01-14 22:30Z` → `(… AT TIME ZONE 'Europe/Bucharest')::date` = `2026-01-15` (local 00:30). `2026-01-14 21:30Z` → `2026-01-14` (local 23:30). Local-midnight transition correct.
- **Summer (EEST, UTC+3):** `2026-07-14 21:30Z` → `2026-07-15` (local 00:30).
- No `+02` / `+03` hard-coded — the IANA zone applies the correct seasonal offset for the actual date.

---

## 19. Session-TZ Independence

**Confirmed: YES.** Live post-deploy, no prior waiver: persisted `effective_date` = `2026-08-28` under `UTC`, `Europe/Bucharest`, `Pacific/Honolulu`, and `America/New_York` (despite `current_date` = `2026-08-27` under Honolulu). Prior-future-waiver case identical across sessions.

---

## 20. Waiver / Legal Semantics

- **Redefined: NO.** The fix does not change what a waiver is, when legal acceptance becomes valid (members accept a specific version `id`; those links are untouched), version-acceptance requirements, retroactivity policy, or expiration (there is none). The `greatest(today, prior + 1)` rule and the `immediate` (`<=`) semantics are preserved verbatim. The only change: "today" is now the gym's real local calendar day instead of the UTC session date — which **removes** an accidental one-day retroactivity for waivers published in the small hours, rather than introducing any new retroactive behaviour. This is "making existing 'business today' semantics deterministic", the Phase 22 continue condition.
- **ADR required: NO.**

---

## 21. Financial Boundary

- **Financial behavior changed: NO.** `m9_publish_waiver`, `gym_waivers`, and `m9_write_audit_entry` touch no payment, revenue, order, subscription-entitlement, or accounting logic. No Financial RPC calls or is called by this function.
- **Financial RPCs touched: NO.**

---

## 22. Security

- RLS changed: **NO**
- GRANTs changed: **NO**
- Function security posture changed: **NO** — `SECURITY DEFINER` retained, `SET search_path TO 'public'` retained, `VOLATILE` retained, owner `postgres` unchanged. `CREATE OR REPLACE FUNCTION` preserves ownership/ACL; verified live post-deploy (`prosecdef = true`, `proconfig = {search_path=public}`).
- Auth / tenant validation: unchanged (all in the Edge Function + `p_gym_id` contract; not modified).
- **Security Gate: GREEN.** No security audit run.

---

## 23. Production Data

- Historical production rows modified: **NO.** (`gym_waivers` still 2 rows, unchanged; classification NO EVIDENCE per §13 — no remediation needed or performed.)
- Disposable test data remaining: **NO.** Every test ran inside a transaction aborted via a terminal `RAISE`; verified post-run (`gyms` where name `LIKE 'ZZZ_M9_%'` = 0; `gym_waivers` count = 2, unchanged). The only permanent write was the migration's `CREATE OR REPLACE FUNCTION` + `COMMENT`.

---

## 24. Application Code

**Modified: NO.** No file in `src/` of either repo, and no Edge Function, was changed. The caller (`admin-manage-waiver`) passes no date and needs no contract change; clients already compare `effective_date` against a gym-local `todayLocalStr()`.

---

## 25. Deployment

- **Production deployed: YES** — migration `20260828140000_m9_publish_waiver_timezone_safe.sql` applied to Forge Production (`sdfkvfbvgpuspnnnwqwk`) via `supabase db query --linked` as `postgres`, directly from the file. No error.
- **Live function re-read: YES** — `pg_get_functiondef()` post-deploy shows `v_today date := (now() AT TIME ZONE 'Europe/Bucharest')::date;`, all three former `current_date` uses replaced by `v_today`, no `current_date` remaining, `greatest()`/`coalesce()`/INSERT/`m9_write_audit_entry`/`RETURN QUERY` shape unchanged, `prosecdef = true`, `proconfig = {search_path=public}`, `provolatile = v`, owner `postgres`, `COMMENT` updated.
- Post-deploy live verification: §11, §19 (all pass).

---

## 26. Closed Invariants

| Invariant | State |
|---|---|
| P0-01 functional deletion integrity | CLOSED / unchanged |
| P0-01 SQL timezone fix (`enforce_class_deletion_policy`) | CLOSED / unchanged — verified live still contains `((OLD.date + OLD.end_time) AT TIME ZONE 'Europe/Bucharest') < now()` |
| `dashboard_resolve_window` timezone fix | CLOSED / unchanged — verified live still contains `now() AT TIME ZONE 'Europe/Bucharest'`, no `current_date` |
| P0-02 gender resolution | CLOSED / unchanged (not referenced) |
| P0-SEC-01 / 02 / 03 | CLOSED / unchanged (no grant/RLS/view touched) |
| INC-01 | CLOSED / unchanged |
| INC-02 | CLOSED / unchanged |
| Yesterday WOD logging | CLOSED / unchanged |
| Security Gate | GREEN |

---

## 27. Remaining Timezone Findings

- **Financial subscription RPCs' `current_date` usage:** OPEN / untouched / P1 — Financial domain FROZEN, ADR-gated. **Not started, no ADR created.**
- **~25-file `current_date` / `now()::date` / `date_trunc('day', now())` category flag:** P2 — untouched.
- P0-01 trigger and `dashboard_resolve_window`: already CLOSED (this session's two prior missions).

---

## 28. Remaining Severity

For **this** finding (`m9_publish_waiver` effective-date timezone): **NONE.** The persisted waiver effective date is now the gym-local publish day, DST-correct via the IANA zone, and independent of the DB session timezone; `greatest()` business rule and `immediate` semantics unchanged; no historical rows affected.

---

## 29. Final Verdict

**M9_PUBLISH_WAIVER TIMEZONE FOLLOW-UP CLOSED**
