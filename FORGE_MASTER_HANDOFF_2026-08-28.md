# FORGE MASTER HANDOFF
Date: 2026-08-28

This document is the single entry point for any new Claude session resuming Forge development. Read this before reading any other historical report or reopening any investigation.

---

## Current Overall State

- **Application operational status**: Both apps (WOD-SIMPLE member PWA, forge-admin-web Admin panel) are deployed and functional. No known P0/P1 blocker is currently open.
- **Production status**: WOD-SIMPLE `app_version.current` = `yesterday-wod-legacy-wod-id-fix-20260828` (last bumped `2026-08-28T07:55:00Z`). Latest deployed commit confirmed live via Vercel/Sentry release tracking: `2bb9202`.
- **Security gate status**: **GREEN** (Final Security Mini-Gate, confirmed exhaustive). No known P0/P1 authorization, data-exposure, privilege-escalation, or destructive-operation blocker exists as of this session.
- **Current incident status**: All three incidents opened/investigated this session (INC-01, INC-02, "Yesterday WOD Logging") are **CLOSED**, fixed, tested, and deployed.
- **Current test status**: WOD-SIMPLE 923/923 real tests passing (9 pre-existing, unrelated Deno-only test files fail to *load*, not a regression — see §19). forge-admin-web last confirmed baseline: 1091/1091 (not re-run this session; no forge-admin-web file was touched after that baseline was established).
- **Known P0 blockers remaining**: **NONE.** Several server-side (SQL) timezone findings and one systemic ACL-hardening item remain intentionally open at P1/P2 — none are blocking (see §16, §23).

**The platform is currently considered safe to continue development.**

---

## Repositories

### WOD-SIMPLE
- **Purpose**: Member-facing Progressive Web App (PWA). Also contains an embedded Admin/Owner panel (a separate `adminTab`/`isAdmin` code path within the same React app — not a separate deployment) used for gym-local Admin tasks (Clients roster, Class management, Reports, Platform Admin for multi-gym oversight).
- **Stack**: React (plain JS/JSX, no TypeScript), Vite, PWA (service worker via `vite-plugin-pwa`), Vitest for tests.
- **Key responsibilities**: WOD-of-the-day display and logging, Journal/history, Leaderboard, Feed (social posts/comments), booking/class scheduling (member side), membership/subscription self-service, Skill Work logging, own embedded Admin panel.

### forge-admin-web
- **Purpose**: Admin/Coach-facing web application for gym operations at scale (Members, Classes, Attendance, Results/Leaderboard, Subscriptions, Dashboard analytics, Programming).
- **Stack**: React + TypeScript, Vitest for tests.
- **Key responsibilities**: Member roster management, class scheduling (Admin side), attendance/check-in, results/leaderboard (Admin view), subscription/billing management, Dashboard 2.0 analytics.

### Shared backend
Both repositories connect to **one shared Supabase project** (production ref `sdfkvfbvgpuspnnnwqwk`). **No code is shared between the two repos** — identical business logic (e.g., gender resolution, local-date helpers) is deliberately *ported* (copied, with matching comments citing the port relationship), never imported across the repo boundary. This is a long-standing, deliberate architectural constraint — do not attempt to introduce a shared package/module.

---

## Canonical Data Architecture

**These are the authoritative, current source-of-truth decisions. Do not re-litigate without new evidence.**

```text
MEMBER DISPLAY NAME (full_name/email/avatar_url/first_name/last_name/birth_date):
  → profiles.full_name (and sibling profiles columns)

GENDER:
  → members.gender
```

These are **intentionally different sources** for different fields on what is otherwise the same logical identity. `members` and `profiles` are two tables mirroring overlapping identity fields; **`members` is a one-way, edit-blind mirror of `profiles` for display fields** (confirmed both by forge-admin-web's own documented Attendance Domain Assessment, and by live production evidence this session: 8 real members had `members.full_name` empty while `profiles.full_name` had the correct value — see INC-01, §12). `members.gender` is the sole exception — established canonical by P0-02, and **not** revisited by any later mission.

**Do not read `full_name`/`email`/`avatar_url` for *display* purposes from `members`.** Always use `profiles` for those fields; use `members` only for `gender` (and for a user's own self-profile read/write via `.eq('id', user.id)`, which is always safe since it's never stale relative to itself).

### Confirmed ID relationships
```text
auth.users.id  =  profiles.id  =  members.id                (same UUID across all three)
profiles.gym_id  →  gyms.id                                  (a member's tenant)
workouts.legacy_wod_id  →  wods.id                            (Engine V2 workout ↔ legacy WOD)
workout_sections.workout_id  →  workouts.id
wod_logs.wod_id  →  wods.id                                   (ALWAYS wods.id, never workouts.id)
wod_logs.workout_section_id  →  workout_sections.id
wod_logs.member_id  →  profiles.id  (=auth.users.id)
subscriptions.member_email  (text, not a member_id FK — matched by lowercased email)
bookings.class_id  (text — no FK to classes.id, a known, disclosed, pre-existing gap; classes.id is uuid)
```

---

## Workout Architecture

Forge has **two parallel workout representations** for the same logical WOD-of-the-day:
- **`wods`** — the legacy table, still the primary write target from the Admin WOD editor ("editorul continua sa scrie in `wods` ca sursa de adevar").
- **`workouts`** (+ `workout_sections`) — "Workout Engine V2", kept in sync as a **best-effort side effect** of the legacy save (`sync_workout_engine_v2` RPC). A V2 sync failure is designed to never break the real (legacy) save.

**`workouts.legacy_wod_id`** is the authoritative link between the two. The member-facing UI always prefers V2 when available (`workoutForDisplay = wodZiWorkoutV2 || mapLegacyWodToWorkout(wodZiData)`), completely independent of whether the legacy `wods` row for that date was found.

### Established logging invariant (new this session — see §14-15)
**When logging against an Engine V2 workout, `wod_id` must be resolved from that workout's own `legacy_wod_id` field — never independently re-derived from a separate, date-keyed lookup against `wods`.** These two derivations can disagree if `workouts.date` and the linked `wods.date` ever desync (confirmed to happen at least once in production — a one-off, non-systemic anomaly, see §16).

`resolveWodIdForLog(wodZiWorkoutV2, wodZiData)` (WOD-SIMPLE `src/utils.js`) implements this: `wodZiWorkoutV2?.legacyWodId ?? wodZiData?.id ?? null`. It is used at all 3 places `wod_logs`/`skill_logs` are written from the member's Save flow: the primary official-variant save, the additional-scored-section save, and the Skill Work save (`saveWodLog`/skill-log handler, `App.jsx`). `mapV2WorkoutRow` (`src/workoutEngine.js`) exposes `legacyWodId` (from `workouts.legacy_wod_id`, already fetched via `select('*')` but not previously surfaced to callers) for this purpose.

---

## Score Logging Architecture

```text
member opens workout (dataAcasa state, local-date-derived via todayLocalStr()-equivalent)
→ fetchWodZi(date) - legacy `wods` lookup by date → wodZiData (may be null)
→ fetchWodZiWorkoutV2(date) - V2 `workouts`+sections lookup by date → wodZiWorkoutV2 (may be null,
  independent of wodZiData)
→ workoutForDisplay = wodZiWorkoutV2 || mapLegacyWodToWorkout(wodZiData) - UI always renders from
  whichever loaded; a member can interact fully even if wodZiData is null, as long as V2 loaded
→ member selects official variant (variantaAleasa) and/or enters a free-form score
→ saveWodLog() / skill-log save handler:
    - computeWodHeaderLine(...) - builds display header text, NULL-SAFE (see INC-02 below)
    - resolveWodIdForLog(wodZiWorkoutV2, wodZiData) - resolves the correct wod_id (see
      "Yesterday WOD" fix below)
    - constructs the wod_logs/skill_logs insert payload
→ Supabase INSERT
→ DB triggers validate (snapshot_wod_log_context() cross-checks workout_section_id against the
  section's own parent workout's legacy_wod_id, rejecting a mismatched wod_id)
→ wod_logs / skill_logs row persisted
```

### Defensive behaviors introduced this session

- **`computeWodHeaderLine()`** (INC-02 fix, `src/utils.js`): the header-text construction is now null-safe against `wodZiData === null` (a legitimate state — `fetchWodZi()` sets it to `null` whenever no legacy WOD exists for the displayed date, which is common and expected). Falls back to the selected variant's own level name (e.g. `"RX"`) instead of crashing.
- **Stale `variantaAleasa` auto-clear** (INC-02 fix, `App.jsx`, a `useEffect` keyed on `wodZiData`): when `wodZiData` transitions to `null`, any previously-auto-selected official variant is cleared, preventing an invalid "variant selected but no WOD data backing it" state from lingering across a date change.
- **`resolveWodIdForLog()`** ("Yesterday WOD" fix, `src/utils.js`): see Workout Architecture above — prevents `wod_id` from being incorrectly derived when `workouts.date`/`wods.date` disagree.
- **Skill Work save-path fix** (discovered during the "Yesterday WOD" mission, same commit): the Skill Work save handler had an **unguarded** `wodZiData.id`/`wodZiData.date` access — the same crash class as INC-02, in a function INC-02 never touched. Fixed in the same pass (null-safe, uses `resolveWodIdForLog`).

---

## Closed Work

| ID | Status | Root Cause | Resolution | Report |
|---|---|---|---|---|
| P0-01 | **CLOSED** | Class deletion could orphan bookings, including checked-in (attended) ones | Trigger-based hybrid policy: unconditional checked-in protection, past-class protection via datetime boundary | (original P0-01 report, not re-listed in this session's file set) |
| P0-02 | **CLOSED** | `weightKeyForVariant` silently defaulted unresolved gender to male; forge-admin-web read stale `profiles.gender` instead of canonical `members.gender` | Unified gender resolution via `resolveAthleteGenderKey`; `members.gender` established canonical, `profiles.gender` never bridged | (original P0-02 report) |
| P0-SEC-01 | **CLOSED** | `member_domain_consistency_detail` view was reachable by `anon`/`authenticated`, bypassing its intended admin-only gate | Grants revoked, `security_invoker=true` set | `P0_SEC_01_AUTH_USERS_EXPOSED_IMPLEMENTATION_REPORT.md` |
| P0-SEC-02 | **CLOSED** | Subscription trigger logic inversion let a member self-activate/extend their own entitlement; a dead, unauthenticated destructive RPC (`delete_member_future_bookings`) existed | Trigger fixed (unified restriction, trusted-caller detection via `current_user = 'postgres'`); dangerous RPC dropped entirely | `P0_SEC_02_SUBSCRIPTION_INTEGRITY_IMPLEMENTATION_REPORT.md` |
| P0-SEC-03 | **CLOSED** | `wod_logs_with_context` view was missing `security_invoker` (silently dropped by an unrelated `CREATE OR REPLACE VIEW`), exposing all workout logs to anonymous callers | `security_invoker=true` restored | `P0_SEC_03_WOD_LOGS_ANONYMOUS_EXPOSURE_IMPLEMENTATION_REPORT.md` |
| P0-03 | **CLOSED** (client-side scope) | UTC-derived "today"/"now" (`toISOString()`) and naive-string `timestamptz` range filters caused date/time skew around local midnight | Canonical local-date/time helpers (`todayLocalStr`, `localDayBoundsUTC`, etc.) applied across both repos | `P0_03_TIMEZONE_DATE_TIME_CONSISTENCY_IMPLEMENTATION_REPORT.md` |
| INC-01 | **CLOSED** | 6 call sites read member display names from `members` instead of `profiles` (stale for 8 real members) | Swapped to `profiles`; `gender` still correctly sourced from `members` where needed | `FORGE_INC_01_MEMBER_NAME_FALLBACK_REPORT.md` |
| INC-02 | **CLOSED** | Unguarded `wodZiData.type` access crashed the score-save handler before any DB request | `computeWodHeaderLine()` null-safe fix + stale-selection auto-clear | `FORGE_INC_02_SCORE_LOGGING_FIX_REPORT.md` |
| Yesterday WOD Logging Issue | **CLOSED** | `workouts.date`/`wods.date` desync for one real WOD caused `wod_id` to resolve incorrectly, rejected by DB trigger | `resolveWodIdForLog()` prefers the explicit `legacy_wod_id` link | `FORGE_YESTERDAY_WOD_LOGGING_FORENSIC_REPORT.md` |

---

## P0-01 Detail

Class deletion previously could silently orphan real bookings, including ones with recorded attendance (`checked_in = true`). Fixed with a DB trigger (`enforce_class_deletion_policy`) implementing a **hybrid policy**:
- Any class with **any** `checked_in = true` booking can **never** be hard-deleted (unconditional protection, regardless of date).
- A **past** class (by actual scheduled end, `date + end_time`, not just calendar date) with any bookings cannot be deleted.
- A **future**, not-yet-checked-in class's bookings are deleted atomically with the class (`CASCADE`).

**Historical data, intentionally not touched**: **480 pre-existing orphaned bookings** (of which **38 had `checked_in = true`**) predate this fix and were deliberately left alone — deleting or rewriting them was explicitly out of scope; this is disclosed, known legacy data, not a bug requiring action (see §17).

**Functional integrity of P0-01 = CLOSED.** Separately: the trigger's own "has this class ended" check (`(OLD.date + OLD.end_time) < now()`) implicitly casts under the DB session's UTC timezone, not gym-local — a genuine, disclosed, **still-open** SQL timezone follow-up (see §16, §23). This does **not** reopen P0-01's functional-integrity closure; it is a separate, named, deliberately-unfixed finding.

## P0-02 Detail

Canonical gender resolution unified: `resolveAthleteGenderKey()`/`weightKeyForVariant()` never silently default an unresolved gender to male (return `null` instead, which downstream code handles explicitly — no crash, no incorrect prescription). `members.gender` established as the platform's sole canonical gender source; `profiles.gender` is stale/legacy and is **never** read for gender anywhere post-fix (Admin member queries, leaderboard RX classification, etc. all corrected). **CLOSED.**

---

## Security Remediation Summary

- **P0-SEC-01**: `member_domain_consistency_detail` (an internal Member Domain diagnostic view) was reachable by `anon`/`authenticated` due to the project's default-ACL auto-granting privileges to every new object — bypassing its intended `is_platform_admin()`-gated RPC wrappers. Fixed by revoking those grants and setting `security_invoker=true`.
- **P0-SEC-02**: Two findings. (a) `subscriptions_restrict_member_update` trigger had a logic inversion letting a member self-activate/extend their own subscription entitlement directly, bypassing the correctly-hardened `activate_queued_subscription` RPC entirely — fixed by unifying the restriction and adding a `current_user = 'postgres'` trusted-caller check. (b) `delete_member_future_bookings` was a `SECURITY DEFINER` function with zero authorization, granted to `anon`, only inert due to an unrelated type bug — dropped entirely (zero live callers, zero dependents).
- **P0-SEC-03**: `wod_logs_with_context` view was missing `security_invoker` (a later, unrelated `CREATE OR REPLACE VIEW` silently dropped the option a prior migration had set) — anonymous callers could read all real `wod_logs` rows platform-wide. Fixed via `ALTER VIEW ... SET (security_invoker = true)`.

**FINAL SECURITY MINI-GATE = GREEN** (exhaustive re-check: all 15 views, all 91 `SECURITY DEFINER` functions, full RLS re-inventory, live cross-tenant proof through a table + a view + an RPC, zero new P0/P1 findings).

**Important audit methodology lesson, established this session**: a view-security discovery query must **never** filter on `reloptions IS NOT NULL` (or equivalent) as its primary enumeration — a view with a *missing* `security_invoker` option has `reloptions = NULL`, which is exactly the unsafe case, and such a filter structurally cannot surface it. Any future security check must enumerate **all** views/objects unfiltered first, then inspect their properties. (This is precisely how P0-SEC-03 was missed by the original gate and only found in the follow-up pass.)

**Do not rerun the security audit** without new evidence or an explicit request.

---

## P0-03 Timezone Summary

**Canonical business timezone**: the rendering device's local timezone (no `gyms.timezone` column exists; single real gym, physically in Romania, so this coincides with Europe/Bucharest today by circumstance, not stored configuration). Full policy: `FORGE_DATE_TIME_POLICY.md`.

- **Date-only values** ("today", `paid_until`, class `date`): local `Date` getters, never `toISOString()`. Helper: `todayLocalStr()`.
- **Instants** (`created_at`, `logged_at`, etc.): `timestamptz`, correct as-is.
- **Scheduled local events** (class date+time): `new Date(`${date}T${time}`)`, browser-local by ECMAScript spec.
- **`timestamptz` range filters** ("everything on gym-local day X"): `localDayBoundsUTC(dateStr)` — never send a naive `${date}T00:00:00` string directly to a Supabase `.gte()`/`.lte()` filter.
- **Membership boundaries**: pure `date`-to-`date` comparison (`start_date <= class.date AND end_date >= class.date`), inclusive both ends — inherently timezone-safe, no special handling needed.
- **DST/device timezone**: no fixed UTC offset is ever hardcoded anywhere; native `Date` getters/construction handle DST correctly by construction. Device-local time IS the platform's only timezone signal today — a disclosed, accepted limitation, not a defect.

**P0-03 is CLOSED** for all client-side scope. **Server-side (SQL) findings remain open, disclosed, NOT fixed** (see §23 for priority):
1. `enforce_class_deletion_policy()` (P0-01 trigger) — `(OLD.date + OLD.end_time) < now()` under UTC session timezone.
2. `dashboard_resolve_window()` — `date_trunc('day', now())`, feeds 3 platform-wide Dashboard RPCs.
3. `m9_publish_waiver()` — `greatest(current_date, ...)`.
4. Financial subscription RPCs' `v_today := current_date` (and a ~25-file category-level flag, not individually audited).

None of these were fixed this session. None block current development.

---

## INC-02 Detail

Score logging crashed with `TypeError: Cannot read properties of null (reading 'type')` when a member had an official variant selected but `wodZiData` was `null` — a **legitimate** state (`fetchWodZi()` returns `null` whenever no legacy WOD exists for the displayed date, which is common). The crash occurred **before** any Supabase request was sent — proven by successful direct-DB reproduction during investigation. Fixed via `computeWodHeaderLine()` (null-safe fallback) + a companion effect clearing the stale variant selection when `wodZiData` disappears. Deployed: commit `2dd8dde`. **CLOSED.**

## INC-01 Detail

The *actual* proven root cause (distinct from the original, lower-confidence JWT-expiry hypothesis): 6 call sites in WOD-SIMPLE read member display names from `members.full_name` instead of `profiles.full_name`. Live evidence: **8 real production members** had `members.full_name` empty while `profiles.full_name` had their correct name (a pre-existing, unreconciled data-drift condition — `member_field_drift`, not new corruption); **185 real bookings** belonged to those members at investigation time, confirming deterministic, high-volume reproducibility (not theoretical). Fixed by swapping all 6 sites to `profiles`; `members.gender` untouched at the 2 sites still needing it. forge-admin-web independently re-checked and found already correct (no changes needed there). Deployed: commit `6cd7b0b`. **CLOSED.**

---

## Feed JWT Follow-Up (Separate From INC-01)

A **genuinely separate**, narrower, pre-existing mechanism: the Feed's own author-fetch query can fail with Postgres/PostgREST code `PGRST303` (JWT expired) during a stale session — long-standing since ~2026-07-06, confirmed via Sentry (167 events over ~7 weeks). This is **not** what caused the deterministic, high-volume INC-01 symptom (that was the `members`-vs-`profiles` table bug, now fixed) — it is a distinct, session-lifecycle-driven, transient issue that could still occasionally cause a brief "Member" flash on the Feed specifically.

**Status: P2 BACKLOG.** Not fixed. Not reproduced/promoted to HIGH confidence for a specific safe remediation within any mission this session. **Do not fix without new evidence or an explicit request** — a session-refresh/auth-lifecycle change is a different risk category than the data-source-table fixes made this session and deserves its own dedicated, narrowly-scoped investigation.

---

## Yesterday WOD Logging Incident Detail

**Business date investigated**: 2026-08-27 (per canonical local-date semantics, `FORGE_DATE_TIME_POLICY.md`).

**Finding**: for the real production workout that date, `workouts.date` (Engine V2) = `2026-08-27` (correct), but the linked legacy `wods.date` (via `workouts.legacy_wod_id`) = `2026-08-28` — a one-day mismatch. **Confirmed unique** across all 45 workouts checked (2026-06-29 through 2026-08-27) — not systemic, a one-off anomaly (plausibly a dual-write timing artifact between the legacy save and the best-effort V2 sync; the exact creation mechanism was not further reverse-engineered).

**Failure chain**: member UI correctly rendered the workout from Engine V2 (independent of the legacy lookup) → member selected an official variant → the client independently re-derived `wod_id` via a date-keyed `wods` lookup, which found nothing for that date → `wod_id` resolved to `null` while `workout_section_id` was a real, valid V2 section id → save request **did reach Supabase** → the `snapshot_wod_log_context()` trigger correctly rejected the payload: `"workout_section_id X does not belong to wod_id <NULL>"`.

**This was NOT INC-02.** `computeWodHeaderLine()` was confirmed to execute its null-safe branch correctly, with zero crash — INC-02 remained fixed throughout this entire investigation. The failure was a distinct field (`wod_id` value correctness), traced to a completely different function-level defect, in the same file.

---

## Yesterday WOD Fix Detail

`resolveWodIdForLog(wodZiWorkoutV2, wodZiData)` (`src/utils.js`): `wodZiWorkoutV2?.legacyWodId ?? wodZiData?.id ?? null`. Prefers the Engine V2 workout's own, already-known-correct `legacy_wod_id` — the same value the database trigger validates against — over an independently-derived, potentially-mismatched legacy lookup. Applied at all 3 relevant save sites in `App.jsx`. Also fixed, in the same pass: an unguarded `wodZiData.id`/`wodZiData.date` crash in the Skill Work save path (same class of bug as INC-02, in a function INC-02 never touched — not reachable for yesterday's specific metcon-only workout, but a real, confirmed latent crash for any workout with a Skill section encountering the same date-mismatch condition).

Deployed: commit `2bb9202`. **CLOSED.**

---

## FOLLOW-UP: Engine V2 ↔ Legacy WOD Date Divergence

**Status: OPEN / NOT BLOCKING.**

**Known evidence**: one confirmed mismatch (`workouts.date = 2026-08-27` vs linked `wods.date = 2026-08-28`), unique across the 45 workouts checked. Production data was **intentionally left unchanged** — no rewrite of either row was performed or approved. The client is now resilient to this class of anomaly regardless (logging always follows the explicit `legacy_wod_id` link, never re-derives it by date), so this follow-up is **not blocking** any current work.

**Recommended future investigation** (not started, not authorized to start automatically): trace the WOD creation → `sync_workout_engine_v2` synchronization → publish flow to determine exactly how the one-day divergence was created and whether it can recur, and if so, whether a preventive fix (e.g., a DB constraint or consistency check) is warranted. This is a genuinely different question from "is the client resilient to it" (already answered: yes) — it is about whether the *creation-side* anomaly itself should also be prevented.

---

## Legacy Orphan Bookings

**480 historical orphaned bookings** (of which **38 have `checked_in = true`**) predate the P0-01 fix and were **never automatically deleted or rewritten** — this is known, disclosed, historical legacy data, explicitly left untouched by every mission this session that encountered it.

**Status: KNOWN LEGACY DATA, BACKLOG.** Any future remediation must preserve historical attendance semantics (the 38 checked-in rows in particular represent real attendance history and must not be silently discarded). Do not delete or rewrite automatically — requires explicit, separate approval and a designed remediation strategy.

---

## Default ACL Hardening

The Supabase project's `public`-schema default ACL auto-grants full privileges to `anon`/`authenticated`/`service_role` on every newly-created table/view/function (`pg_default_acl`, confirmed live, unchanged throughout this session). This was the root-cause mechanism behind P0-SEC-01 and a contributing factor in P0-SEC-03.

**Status: P2 HARDENING, still applicable, not fixed.** The Final Security Mini-Gate was GREEN despite this **because every currently-exposed object was individually, exhaustively verified safe** (correct RLS, correct `security_invoker`, correct internal authorization) — the default ACL itself is a structural risk multiplier for *future* mistakes, not a currently-live exploit. **Do not change the default ACL now** — narrowing it retroactively would require auditing every existing table's reliance on the default grant first, a much larger, separate undertaking.

---

## Current Test Baselines

### WOD-SIMPLE
```text
tests:  923/923 real tests passing (as of commit 2bb9202 / bebc2c1)
        9 pre-existing, unrelated Deno-only supabase/functions/**/*.test.ts files fail to LOAD
        (@std/assert import — Vitest/Node cannot resolve a Deno-only import specifier). This is
        a confirmed pre-existing condition, re-verified unchanged across every mission this
        session (purchase-platform-plan, stripe-webhook, send-notification — none ever edited).
        NOT a regression. Do not attempt to "fix" this without being asked — it requires either
        a Deno-specific test runner config or excluding these files from the Vitest run.
build:  PASS (vite build, 0 errors)
lint:   0 errors introduced by any of this session's changes. 4 pre-existing errors exist in
        src/workoutEngine.js / src/workoutEngine.test.js (unrelated to this session's fixes —
        confirmed byte-for-byte identical against the pre-session baseline via git stash
        comparison) plus 11 pre-existing warnings elsewhere (unrelated lines). Do not fix these
        opportunistically without being asked.
type-check: N/A — WOD-SIMPLE is a plain JS/JSX project, no separate tsc step configured; `build`
        is the applicable equivalent.
```

### forge-admin-web
```text
tests:  1091/1091 (last full-suite run, established during the P0-03 continuation mission,
        commit da42cde). NOT re-run this session after that point — no file in forge-admin-web
        was modified by any of INC-01/INC-02/"Yesterday WOD" (all three were WOD-SIMPLE-only
        fixes). Re-run before trusting this number if significant time has passed or if any
        forge-admin-web file is about to be touched.
build:  tsc -b PASS, 0 errors (as of the same commit)
lint:   0 errors, 0 warnings (as of the same commit)
```

---

## Production Deployment State

Confirmed via Sentry release/deploy tracking (`vercel-production` environment) at the time each mission concluded:

```text
P0-03 (continued):        da42cde  →  deployed 2026-08-26 (forge-admin-web); WOD-SIMPLE side
                            also deployed same day (see P0-03 report for its own commit refs)
INC-02:                    2dd8dde  →  deployed 2026-08-28T07:16:23Z
INC-01:                    6cd7b0b  →  deployed 2026-08-28T07:38:23Z
Yesterday WOD Logging fix: 2bb9202  →  deployed 2026-08-28T07:55:05Z
```

All confirmed via the Sentry organization's `latestDeploys.vercel-production` field matching the exact commit SHA — not merely inferred from `git push` succeeding.

---

## Production Data Modifications (This Session)

**All incident remediation this session (INC-01, INC-02, Yesterday WOD Logging) made ZERO production data changes:**
- Zero member/profile backfills (the underlying `member_field_drift` data condition behind INC-01 was left unreconciled — the code fix reads the correct table regardless).
- Zero historical WOD rewrite (the `workouts.date`/`wods.date` mismatch behind the Yesterday WOD issue was left as-is — the code fix is resilient to it regardless).
- Zero historical booking cleanup.
- Zero schema change for any of INC-01/INC-02/Yesterday-WOD (all three were pure application-code fixes).
- Zero RLS weakening anywhere this session.

This is distinct from the **earlier** P0-SEC-01/02/03 missions, which **did** legitimately change database objects (grants, `security_invoker`, one trigger rewrite, one function drop) as their own explicit, approved remediation — those changes remain in place and are part of the CLOSED state, not something to revert.

The only production-database writes made by any incident-remediation mission this session were `app_version` bumps (the platform's standard PWA-refresh signal) — never a data-table write.

---

# DO NOT REOPEN WITHOUT NEW EVIDENCE

- P0-01 functional deletion integrity
- P0-02 gender resolution
- P0-SEC-01
- P0-SEC-02
- P0-SEC-03
- P0-03 client-side timezone work
- INC-01
- INC-02
- Yesterday WOD logging issue

**A future Claude session must not initiate another broad audit of any of these areas merely because they are mentioned here.** Only reopen with new, reproducible production evidence, or an explicit, authorized follow-up request from the user.

---

## Known Open Follow-Ups

| Priority | Follow-up | Status | Blocking? | Recommended Action |
|---|---|---|---|---|
| P1 (disclosed, unfixed) | P0-01 trigger's own SQL timezone gap (`(date+end_time)<now()` under UTC session tz) | OPEN | No | Narrow, isolated SQL fix; requires its own approval since P0-01 is closed |
| P1 (disclosed, unfixed) | `dashboard_resolve_window()` timezone (`date_trunc('day', now())`) | OPEN | No | Same class as above; affects 3 Dashboard RPCs |
| P1 (disclosed, unfixed) | `m9_publish_waiver()` timezone (`greatest(current_date, ...)`) | OPEN | No | Same class |
| P1 (disclosed, unfixed) | Financial subscription RPCs' `current_date` usage (+ ~25-file category flag, not individually audited) | OPEN | No | Same class; Financial domain is FROZEN, requires an ADR |
| P2 | Feed JWT-expiry/PGRST303 recovery behavior | OPEN | No | Dedicated session-lifecycle investigation, distinct risk category from this session's fixes |
| P2 | Default ACL hardening (systemic) | OPEN | No | Large, separate undertaking — audit every table's reliance on the default grant first |
| Backlog | 480 legacy orphan bookings (38 checked-in) remediation | OPEN | No | Requires a designed strategy preserving attendance history; do not auto-delete |
| Follow-up | Engine V2 ↔ legacy WOD date divergence (creation-side root cause) | OPEN | No | Trace creation → sync → publish flow; client-side resilience already shipped |

No P0/blocking item remains.

---

## Recommended Next Development Step

**Recommended**: pick ONE of the four disclosed server-side (SQL) timezone follow-ups (P0-01 trigger, `dashboard_resolve_window`, `m9_publish_waiver`, or the Financial RPCs) as a narrowly-scoped, single-item mission — **not** a re-audit of all four at once.

**Why**: these are the only *disclosed, evidence-backed* findings with real (if low-frequency) business impact remaining in the codebase; everything else open is either P2/backlog or requires its own separate investigation phase (Feed JWT, orphan bookings, V2/legacy divergence root cause).

**What it should investigate**: for whichever item is chosen, re-verify the finding is still live (schema/trigger definitions can be re-read directly — see this document's own commit/report references for exact function names), determine the smallest safe fix (matching this session's own established discipline: reproduce → root-cause → minimal fix → regression test → deploy → verify), and follow the same "smallest safe fix + regression test" pattern used throughout this session.

**What it must not change without approval**: P0-01's closed functional-integrity semantics (only the timezone *calculation* inside the trigger, never its access-control logic); the Financial domain's frozen architecture (requires an ADR per existing project convention); any RLS/grant/security posture (Security Gate is GREEN — do not touch without a new, separate security finding).

---

## Current Git State

### WOD-SIMPLE
```text
branch:        main
HEAD:          (after this handoff's own commit — see final commit hash in the response below)
working tree:  CLEAN except pre-existing, unrelated untracked files present since before this
               session began (docs/architecture/FORGE_PROGRAMMING_COMPETITIVE_SYNTHESIS.md,
               docs/architecture/PROGRAMMING_DOMAIN_ARCHITECTURE.md, docs/fckb/,
               supabase/migrations/20260809090000_attendance_phase3_no_show.sql) — these were
               NOT created or modified by this session and are intentionally left untouched;
               they appear to be separate, unrelated in-progress work.
unpushed commits: none (this handoff itself will be committed and pushed)
```

### forge-admin-web
```text
branch:        main
HEAD:          da42cde (unchanged this session — no forge-admin-web file was touched after the
               P0-03 continuation mission)
working tree:  CLEAN except pre-existing, unrelated untracked files
               (PROGRAMMING_DOMAIN_ASSESSMENT.md, supabase/) — not created by this session
unpushed commits: none
```

---

## Document Index

| Filename | Purpose | Status | When to read |
|---|---|---|---|
| `FORGE_DATE_TIME_POLICY.md` | Canonical Forge date/time policy (business timezone, storage/comparison/display rules, dangerous patterns) | Living reference | Before touching ANY date/time logic in either repo |
| `P0_03_TIMEZONE_DATE_TIME_CONSISTENCY_IMPLEMENTATION_REPORT.md` | Full P0-03 report (both passes) | CLOSED | Only if resuming server-side timezone follow-up work |
| `P0_SEC_01_AUTH_USERS_EXPOSED_IMPLEMENTATION_REPORT.md` | P0-SEC-01 fix report | CLOSED | Only if a NEW `auth.users`-exposure-class finding appears |
| `P0_SEC_02_SUBSCRIPTION_INTEGRITY_IMPLEMENTATION_REPORT.md` | P0-SEC-02 fix report | CLOSED | Only if a NEW subscription-entitlement or destructive-RPC finding appears |
| `P0_SEC_03_WOD_LOGS_ANONYMOUS_EXPOSURE_IMPLEMENTATION_REPORT.md` | P0-SEC-03 fix report | CLOSED | Only if a NEW view-security finding appears |
| `FORGE_POST_REMEDIATION_SECURITY_VERIFICATION_REPORT.md` | Post-SEC-01/02 re-verification that surfaced SEC-03 | Historical | Only for methodology reference (the `reloptions IS NOT NULL` lesson) |
| `FORGE_FINAL_SECURITY_MINI_GATE_REPORT.md` | Final exhaustive security re-check, GREEN verdict | CLOSED | Only before/if a new security audit is explicitly requested |
| `FORGE_PRODUCTION_INCIDENT_MEMBER_NAMES_SCORE_LOGGING_INVESTIGATION.md` | Original INC-01+INC-02 joint investigation (lower-confidence Feed/JWT hypothesis for INC-01) | Superseded by INC-01's own fix report for root cause; still useful for INC-02's original trace | Background only — prefer the fix reports below for current facts |
| `FORGE_INC_02_SCORE_LOGGING_FIX_REPORT.md` | INC-02 fix report | CLOSED | Only if a NEW score-save crash is reported |
| `FORGE_INC_01_MEMBER_NAME_FALLBACK_REPORT.md` | INC-01 fix report (actual, proven root cause) | CLOSED | Only if a NEW "wrong name displayed" report appears on a surface not already covered |
| `FORGE_YESTERDAY_WOD_LOGGING_FORENSIC_REPORT.md` | Yesterday-WOD forensic investigation + fix | CLOSED | Only if a NEW "specific workout cannot be logged" report appears |
| `FORGE_MASTER_HANDOFF_2026-08-28.md` (this file) | Session checkpoint / bootstrap for the next Claude session | **Current** | **Always read first** |

Older platform audit documents (`FORGE_PLATFORM_AUDIT_PHASE28_44.md`, `PHASE_33_34_35_AUDIT.md`, etc.) were the **original source** for several findings addressed this session (P0-01 through P0-03) — their findings are now either CLOSED (see table above) or explicitly carried forward into this handoff's "Known Open Follow-Ups" table. **Do not re-read them as if they represent current state** — this handoff supersedes them for status purposes; they remain useful only as historical root-cause narrative if deeper context is ever needed.

---

# INSTRUCTIONS FOR THE NEXT CLAUDE SESSION

1. **Read this handoff first**, in full, before touching code or reading any other report.
2. **Do not rerun closed audits** (security, timezone, or otherwise) — the "DO NOT REOPEN" list above is authoritative unless new evidence exists.
3. **Inspect current git status** for both repos before making any change, to confirm this handoff's recorded state still matches reality.
4. **Read only the report relevant to the task being resumed** — the Document Index above tells you which one, and when.
5. **Confirm the production/test baseline** (§19) before modifying code — re-run the relevant suite if meaningful time has passed or if you're unsure.
6. **Preserve all CLOSED invariants** — every fix listed in this document is deliberate and evidence-based; do not "clean up" or "simplify" them without being asked.
7. **Investigate before implementing** when dealing with any new production incident report — this session's own discipline (reproduce → root-cause with live evidence → minimal fix → regression test → deploy → verify) is the established, expected pattern.
8. **Never mutate production historical data** (member records, WOD records, booking records, timestamps) without explicit, separate approval — every fix this session was deliberately code-only for exactly this reason.
9. **Prefer explicit canonical relationships over reconstructed/date-derived identity** — the Yesterday-WOD lesson generalizes: if an explicit foreign-key/link exists (like `workouts.legacy_wod_id`), use it; do not independently re-derive the same relationship via a secondary lookup (like a date match) that can silently disagree.
10. **Stop and report** if a task would require reopening a closed P0/security invariant — surface the conflict to the user rather than silently deciding.
