# FORGE — P0-01 SQL TIMEZONE FOLLOW-UP — IMPLEMENTATION REPORT
Date: 2026-08-28
Mission: narrow remediation of the class-deletion time-boundary timezone interpretation.

---

## 1. Executive Verdict

**P0-01 SQL TIMEZONE FOLLOW-UP CLOSED**

---

## 2. Important Status

**P0-01 FUNCTIONAL INTEGRITY REMAINS CLOSED.** This mission addressed only its
previously disclosed timezone follow-up (FORGE_MASTER_HANDOFF_2026-08-28 §16 / §23,
FORGE_DATE_TIME_POLICY.md §7). The access-control / deletion-integrity policy of
`enforce_class_deletion_policy()` — unconditional `checked_in` protection, past-class
protection, future-class atomic cascade, zero-booking passthrough — is unchanged and
was re-verified end-to-end (see §11). The only behavioural change is *which timezone*
the "has this class already ended?" boundary is evaluated in.

---

## 3. Live Pre-Fix Definition

- **Function:** `public.enforce_class_deletion_policy()` — `LANGUAGE plpgsql`,
  `SECURITY DEFINER`, `SET search_path TO 'public'`, `RETURNS trigger`.
- **Trigger:** `classes_enforce_deletion_policy_trg` — `BEFORE DELETE ON public.classes
  FOR EACH ROW EXECUTE FUNCTION enforce_class_deletion_policy()` (enabled, `tgenabled='O'`).
- **Table:** `public.classes`.
- **Relevant expression (verbatim, live, pre-fix):**
  ```sql
  v_class_ended := (OLD.date + OLD.end_time) < now();
  ```
  Created by migration `20260825130000_p0_01_deletion_policy_time_and_checkin_guard.sql`.

**Timezone defect confirmed present: YES** (deterministically reproduced — §6, §7).

---

## 4. Canonical Business Timezone

- **Exact timezone used:** `Europe/Bucharest` (IANA), hard-coded in the trigger as an
  explicit single-gym-deployment constant.
- **Source / rationale:** `FORGE_DATE_TIME_POLICY.md` §1 / §12 defines the canonical
  business timezone as "the local timezone of the device rendering the UI" and
  explicitly declines to introduce a stored server-side/per-gym timezone. A Postgres
  `BEFORE DELETE` trigger has no device context, so a server-side fix must commit to a
  concrete zone. `FORGE_MASTER_HANDOFF_2026-08-28` (§"P0-03 Timezone Summary") and the
  P0-03 report both state the platform today runs **a single gym, physically in Romania**,
  and that the effective zone "coincides with Europe/Bucharest today by circumstance."
  Using `Europe/Bucharest` was explicitly **approved by the user for this mission**
  (Option A), on condition that it is documented as a current-product constraint and that
  no `gyms.timezone` column or broader timezone architecture is introduced here. Both
  conditions are met.
- This is **not** a claim that the platform is generically multi-timezone-safe. When
  Forge adds a gym outside Romania, a stored per-gym timezone (separate, ADR-gated work)
  will be required and this constant will need to become a lookup.

---

## 5. Field Semantics

| Field | Type (verified live) | Business meaning |
|---|---|---|
| `classes.date` | `date` | gym-local calendar date of the class |
| `classes.end_time` | `time without time zone` | gym-local wall-clock end time (`"HH:MM:SS"`), per FORGE_DATE_TIME_POLICY.md §3/§5 |
| `classes.date + classes.end_time` | `timestamp without time zone` | naive gym-local wall-clock instant of the class's scheduled end |

The documented assumption (these represent scheduled **local wall-clock** date/time in
Forge's business timezone) holds — confirmed against schema, `FORGE_DATE_TIME_POLICY.md`
§3/§5, and the sibling function `enforce_subscription_sessions()` which treats
`classes.date` the same way.

---

## 6. Reproduction (deterministic, pre-fix)

**Trigger-level, live, real `now()`** (test data disposable, transaction aborted via a
terminal `RAISE` — nothing committed):

Scenario: a class scheduled to end **90 minutes ago in gym-local time**, with **one
non-checked-in booking**. Correct business classification: the class has ended →
deletion must be **BLOCKED** (past class with bookings).

| Function | Session TZ | Result |
|---|---|---|
| **pre-fix (live)** | `UTC` (production's actual setting) | `blocked=f`, `deleted=1`, booking cascade-removed — **class WAS deleted** ❌ |
| post-fix | `UTC` | `blocked=t` — correctly rejected ✓ |

**Expression-level, fixed synthetic `now()`** (isolates the exact changed line):
class date `2026-01-15`, `end_time 19:00` (Bucharest winter, EET = UTC+2 → actual end
instant `17:00Z`); synthetic now `2026-01-15 18:00:00Z` (one hour after the class ended):

| Expression | Value |
|---|---|
| `(date + end_time) < now()` under UTC session (pre-fix) | `false` ❌ (class ended an hour earlier) |
| `((date + end_time) AT TIME ZONE 'Europe/Bucharest') < now()` (post-fix) | `true` ✓ |

At least one pre-fix test fails under the existing implementation — satisfied
(trigger-level UTC case + all four "…_ended" expression cases in §11 CASE 10/11).

---

## 7. Session-Timezone Dependence

Same class, same instant, same fixed synthetic `now = 2026-01-15 18:00:00Z`, only the
DB session timezone changed:

| Session TZ | pre-fix `(date+end_time) < now()` | post-fix `((date+end_time) AT TIME ZONE 'Europe/Bucharest') < now()` |
|---|---|---|
| `UTC` | **`false`** (class treated as not-ended) | `true` |
| `Europe/Bucharest` | `true` (class treated as ended) | `true` |

Trigger-level confirmation (live, post-deploy), divergence scenario (ended 90 min ago,
1 unchecked booking):

| Session TZ | post-fix trigger result |
|---|---|
| `UTC` | `BLOCKED` |
| `Europe/Bucharest` | `BLOCKED` (identical) |

- **Pre-fix implementation: session-timezone-DEPENDENT** (result flips UTC ↔ Bucharest).
- **Post-fix implementation: session-timezone-INDEPENDENT** (identical result in both).

---

## 8. Root Cause

`classes.date` is `date`; `classes.end_time` is `time without time zone`. Their sum is
`timestamp without time zone` — a *naive* value with no zone attached, semantically a
gym-local wall-clock reading.

`now()` returns `timestamp with time zone`.

PostgreSQL has no `timestamp < timestamptz` operator. To evaluate `naive < now()` it
**implicitly coerces the naive `timestamp` to `timestamptz`**, and that coercion
interprets the naive value as being in the **current session's `TimeZone` setting**
(equivalent to `naive AT TIME ZONE current_setting('TimeZone')`).

Production's session timezone is `UTC` (confirmed live: `current_setting('TimeZone')` =
`'UTC'`). Romania is `UTC+2` (EET, winter) / `UTC+3` (EEST, summer). So a class whose
gym-local end was `19:00` was coerced to `19:00Z` and only counted as "ended" once
`19:00 UTC` passed — i.e. `21:00`–`22:00` gym-local. For that **2-hour (winter) / 3-hour
(summer) window** after a class genuinely ended, the trigger classified it as "not yet
ended", so a real past class with non-checked-in bookings could still be hard-deleted
(its bookings cascade-removed), violating P0-01's past-class invariant. The result also
depended on the caller's session timezone, which a correctness-critical trigger must not.

---

## 9. Fix

- **Old conceptual expression:** `(date + end_time) < now()` — naive value coerced using
  the DB **session** timezone (UTC in production).
- **New conceptual expression:** `((date + end_time) AT TIME ZONE 'Europe/Bucharest') < now()`
  — the naive local wall-clock value is explicitly anchored to the gym's business
  timezone, yielding an absolute instant (`timestamptz`), then compared instant-to-instant.

- **Exact migration:** `supabase/migrations/20260828120000_p0_01_class_deletion_boundary_timezone_safe.sql`
  (new; the sole change is `CREATE OR REPLACE FUNCTION public.enforce_class_deletion_policy()`
  with the one boundary line changed + expanded comment, plus a refreshed
  `COMMENT ON FUNCTION`). Applied live to production directly from this file (the
  established post-2026-08-18 workflow — direct apply + committed file, not `db push`;
  the remote `supabase_migrations.schema_migrations` table has not tracked migrations
  since `20260818090200` and was intentionally left as-is), so repository and production
  match exactly.
- **Exact function changed:** `public.enforce_class_deletion_policy()` — one line
  (`v_class_ended := …`). Operator (`<`), both `RAISE` branches, the `checked_in` guard,
  the zero-booking early return, the atomic `DELETE FROM bookings`, `SECURITY DEFINER`,
  and `SET search_path` are byte-for-byte unchanged.
- **No trigger change** — `classes_enforce_deletion_policy_trg` already targets this
  function.

---

## 10. Type Semantics (verified live)

| Element | Type |
|---|---|
| `classes.date` | `date` |
| `classes.end_time` | `time without time zone` |
| `date + time` → | `timestamp without time zone` (naive) |
| `AT TIME ZONE 'Europe/Bucharest'` input | `timestamp without time zone` |
| `AT TIME ZONE 'Europe/Bucharest'` result | `timestamp with time zone` (`timestamptz`) |
| `now()` | `timestamp with time zone` |
| final comparison | `timestamptz < timestamptz` (no implicit coercion, session-independent) |

Direction confirmed correct: `timestamp (naive local wall-clock) AT TIME ZONE zone →
timestamptz (absolute instant)`. This is the **local-wall-clock → instant** direction,
not the inverse (`timestamptz AT TIME ZONE zone → timestamp`), which would have been wrong.

DST handling confirmed live via the IANA zone (no fixed offset hard-coded anywhere):

| Class local end | Zone rule | Resulting instant |
|---|---|---|
| `2026-01-15 19:00` | EET (UTC+2), winter | `2026-01-15 17:00:00+00` |
| `2026-07-15 19:00` | EEST (UTC+3), summer | `2026-07-15 16:00:00+00` |

---

## 11. Regression Matrix

Two harnesses:
- **Trigger-level (T):** disposable gym + class + booking(s) seeded inside a transaction,
  real `DELETE FROM classes` attempted so the live `BEFORE DELETE` trigger fires, outcome
  captured, transaction aborted via a terminal `RAISE` — **zero rows committed**. Uses the
  real `now()`.
- **Expression-level (E):** the exact changed boolean expression evaluated against a
  fixed synthetic `now()` literal — required for DST cases (cannot wait until January) and
  for precise near-midnight boundaries.

Post-deploy, "pre-fix" = the expression as it was; "post-fix" = the now-live function.

| # | Scenario | Harness | Pre-fix (UTC session) | Post-fix | Expected | Pass |
|---|---|---|---|---|---|---|
| 1 | Past class (yesterday) + unchecked booking | T | BLOCKED | BLOCKED | BLOCKED | ✓ |
| 2 | Future class (tomorrow) + unchecked booking | T | ALLOWED, `deleted=1`, `bookings_left=0` | ALLOWED, `deleted=1`, `bookings_left=0` | ALLOWED + atomic booking removal | ✓ |
| 3 | Future class + `checked_in=true` booking | T | BLOCKED | BLOCKED | BLOCKED | ✓ |
| 4 | Past class + `checked_in=true` booking | T | BLOCKED | BLOCKED | BLOCKED | ✓ |
| 5 | Earlier **today**, ended 90 min ago (gym-local) + unchecked booking | T | **ALLOWED** ❌ (bug) | **BLOCKED** | BLOCKED (class is past) | ✓ |
| 6 | Later **today**, ends in 90 min (gym-local) + unchecked booking | T | ALLOWED, atomic | ALLOWED, atomic | ALLOWED (class is future) | ✓ |
| 7 | Near-midnight: class `00:30` local, `now` just before → not ended | E | not-ended (coincidentally) | not-ended | not-ended | ✓ |
| 7b | Near-midnight: class `00:30` local, `now` = `01:00` local → ended | E | **not-ended** ❌ | ended | ended | ✓ |
| 8 | Divergence scenario (#5) under `SET TIME ZONE 'UTC'` | T | — | BLOCKED | BLOCKED | ✓ |
| 9 | Divergence scenario (#5) under `SET TIME ZONE 'Europe/Bucharest'` | T | — | BLOCKED (identical to #8) | BLOCKED | ✓ |
| 9b | Future scenario (#2) under `Europe/Bucharest` session | T | — | ALLOWED (identical to #2) | ALLOWED | ✓ |
| 10 | **Summer** date `2026-07-15 19:00` local, `now` = end+1h (`17:00Z`) → ended | E | **not-ended** ❌ | ended (instant `16:00Z`, UTC+3) | ended | ✓ |
| 10b | Summer date, `now` = `15:00Z` (`18:00` local) → not ended | E | not-ended | not-ended | not-ended | ✓ |
| 11 | **Winter** date `2026-01-15 19:00` local, `now` = end+1h (`18:00Z`) → ended | E | **not-ended** ❌ | ended (instant `17:00Z`, UTC+2) | ended | ✓ |
| 11b | Winter date, `now` = `16:00Z` (`18:00` local) → not ended | E | not-ended | not-ended | not-ended | ✓ |
| 12 | Near-midnight: class `23:30` local `08-27`, `now` = `00:30Z 08-28` → ended | E | ended | ended | ended | ✓ |
| — | Zero bookings, past class | T | ALLOWED (`deleted=1`) | ALLOWED (`deleted=1`) | ALLOWED (early return) | ✓ |

All 11 mandated cases (1–11) plus 7b/10b/11b/12/zero-booking supplementary cases pass.
The pre-fix implementation is wrong in cases 5, 7b, 10, 11 (all "class has ended locally
but not yet in UTC"); the post-fix implementation is correct in every case.

---

## 12. Session-Timezone Independence

**Confirmed: YES.**

Post-fix, the trigger produces an identical deletion decision under `SET TIME ZONE 'UTC'`
and `SET TIME ZONE 'Europe/Bucharest'` for both the "ended" divergence scenario (#8 vs #9:
both BLOCKED) and the "future" scenario (#2 vs #9b: both ALLOWED). Expression-level: the
post-fix expression's value is independent of session timezone by construction
(`timestamptz < timestamptz`).

---

## 13. Checked-In Protection

**Preserved: YES.** Cases 3 (future + checked_in) and 4 (past + checked_in) → BLOCKED,
pre- and post-fix identically. The `checked_in` guard is evaluated before, and
independently of, the timezone branch; it was not touched.

---

## 14. Past-Class Protection

**Preserved: YES** — and *strengthened* by correcting the boundary. Cases 1, 5, 8, 9, 12
→ BLOCKED. The pre-fix gap (case 5: a class ended 90 min ago locally was still deletable)
is now closed.

---

## 15. Future Deletion / Cascade

**Preserved: YES.** Cases 2, 6, 9b, and the zero-booking case → ALLOWED, with
`deleted=1` and `bookings_left=0` (bookings removed atomically in the same transaction as
the class). Unchanged from pre-fix behaviour.

---

## 16. Production Deployment

- **Migration:** `supabase/migrations/20260828120000_p0_01_class_deletion_boundary_timezone_safe.sql`
- **Deployment result:** applied successfully to Forge Production (`sdfkvfbvgpuspnnnwqwk`)
  via `supabase db query --linked` as role `postgres`, directly from the migration file
  (established workflow, §9). No error.
- **Live definition verified: YES** — `pg_get_functiondef()` re-read post-deploy shows
  `v_class_ended := ((OLD.date + OLD.end_time) AT TIME ZONE 'Europe/Bucharest') < now();`,
  `prosecdef = true`, `proconfig = {search_path=public}`, `LANGUAGE plpgsql`, all policy
  branches intact, `COMMENT ON FUNCTION` updated. Trigger `classes_enforce_deletion_policy_trg`
  still bound, still enabled (`tgenabled='O'`).
- **Post-deploy live verification:** the full trigger-level matrix (§11) was re-run
  against the deployed function — all pass.
- No client/PWA `app_version` bump was made: this is a DB-trigger-only change with zero
  client-bundle impact and no Vercel deployment, so there is nothing for open PWA
  sessions to pick up.

---

## 17. Production Data

- Historical production data modified: **NO**
- Real classes modified: **NO**
- Real bookings modified: **NO**

Every regression test used disposable synthetic rows (a disposable gym referencing one
real `auth.users.id` only as a valid FK target, a disposable class, disposable bookings
with `member_id = NULL`) inside a transaction that was always aborted via a terminal
`RAISE` — nothing was ever committed. The only permanent production write in this mission
was the migration's own `CREATE OR REPLACE FUNCTION` + `COMMENT ON FUNCTION`. No
`INSERT`/`UPDATE`/`DELETE` against any data table was committed.

---

## 18. Legacy Orphans

- Observed count (read-only, post-deploy):
  `bookings` with a `class_id` having no matching `classes.id` = **480**
- Checked-in subset (`checked_in = true`): **38**
- **Action taken: NONE.** Both counts exactly match `FORGE_MASTER_HANDOFF_2026-08-28`
  (§"Legacy Orphan Bookings"). Not touched, not rewritten, not deleted.

---

## 19. Security

- RLS changed: **NO**
- GRANTs changed: **NO**
- Function security posture changed: **NO** — `SECURITY DEFINER` retained, `SET
  search_path = public` retained, function owner unchanged (`postgres`), `EXECUTE` grants
  unchanged. `CREATE OR REPLACE FUNCTION` on an existing function preserves ownership and
  ACL; verified via `pg_get_functiondef` + `prosecdef` + `proconfig` post-deploy.
- View security / default ACLs / `auth` behaviour: untouched.
- Security Gate posture: **GREEN** (unchanged). No broad security audit was run. No
  security-relevant object other than this one trigger function was modified.

---

## 20. Application Code

**Modified: NO.** No file in `src/` of either repo (WOD-SIMPLE or forge-admin-web) was
changed. This is a database-trigger-only mission. `FORGE_DATE_TIME_POLICY.md` §4 already
prescribes the correct client-side pattern (`new Date(\`${date}T${time}\`)`, browser-local)
and the client was already compliant (P0-03).

---

## 21. Tests

- **WOD-SIMPLE Vitest suite:** `923 passed (923)`. 9 test *files* fail to load
  (`supabase/functions/**/*.test.ts` — Deno-only `@std/assert` import specifier, cannot
  be resolved by Vitest/Node). This is the exact pre-existing condition documented in
  `FORGE_MASTER_HANDOFF_2026-08-28` §19 — re-verified unchanged, **not a regression** and
  unrelated to this change (no client code touched).
- **forge-admin-web:** not run — no forge-admin-web file was touched (last established
  baseline `1091/1091` at `da42cde` stands).
- **DB regression matrix:** 16 cases (§11), all pass, run both pre- and post-deploy.
- **`git diff`:** only the one new migration file (§23).

---

## 22. Out-of-Scope Findings — confirmed untouched

| Object | Status |
|---|---|
| `dashboard_resolve_window()` | **NOT touched.** `pg_get_functiondef` md5 unchanged; no statement in this mission referenced it. Its own `date_trunc('day', now())` timezone finding remains OPEN / disclosed / P1 (handoff §23). |
| `m9_publish_waiver()` | **NOT touched.** md5 unchanged; not referenced. `greatest(current_date, …)` finding remains OPEN / disclosed / P1. |
| Financial subscription RPCs (`current_date` usage) | **NOT touched.** Financial domain remains FROZEN; any change there requires a separate ADR. Finding remains OPEN / disclosed / P1. |

The migration's only DDL is `CREATE OR REPLACE FUNCTION public.enforce_class_deletion_policy()`
and its `COMMENT ON FUNCTION` — it is structurally incapable of affecting any other object.

---

## 23. Remaining Severity

For **this** timezone follow-up (the P0-01 class-deletion boundary): **NONE.** The
finding is fully resolved — the boundary is now evaluated in the gym's business timezone,
DST-correct via the IANA zone, and independent of the DB session timezone.

`git diff` for this mission contains exactly one file:
```
supabase/migrations/20260828120000_p0_01_class_deletion_boundary_timezone_safe.sql  (new)
```
plus this report. No application changes. (Pre-existing untracked files —
`docs/architecture/*`, `docs/fckb/`, `supabase/migrations/20260809090000_attendance_phase3_no_show.sql`
— are unrelated in-progress work, present before this session, left untouched.)

The three other disclosed server-side timezone findings (§22) remain OPEN at P1, each to
be handled as its own narrowly-scoped, separately-authorized mission — exactly as before.

---

## 24. Final Verdict

**P0-01 SQL TIMEZONE FOLLOW-UP CLOSED**
