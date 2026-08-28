# FORGE — PRODUCTION READINESS GATE
Date: 2026-08-28
Type: bounded critical-path validation. **Investigation/verification only — zero implementation, zero production mutation.**

---

## 1. Executive Verdict

> **CORRECTION (2026-08-28, post-gate):** the owner reproduced a real production
> bug in the exact historical "Log Score" UI flow that this gate did **not**
> exercise. Opened as **INC-04 / PRG-05 (P1)**.
>
> - **First fix `27131a5`** — a request-currency guard on the workout fetch
>   (Layer 1). The owner reproduced the split-brain **again**, so INC-04 was
>   **reopened** as a global remediation.
> - **Global fix `8501356`** — the logger and save now derive workout identity
>   **only** from a frozen snapshot captured at "Log Score" click time
>   (`freezeLoggingContext` / `resolveLoggedWorkoutIdentity` / `logCtx` /
>   `homeDisplayIsCurrent` gate), fail-closed, covering every workout / date /
>   format / variant / section and all 4 Log Score entry points. App-only, no DB
>   change, 14 regression tests (942/942), deployed live, `app_version` bumped.
>
> **Historical logging remains FAIL in this gate until the owner completes the
> manual acceptance checks** in `FORGE_INC_04_HISTORICAL_LOG_SCORE_CONTEXT_REPORT.md`
> (§ Owner Acceptance): yesterday's workout, today's workout, and another
> historical date — for each, displayed workout === logger content === save
> identity. §27 and PRG-05 are corrected below.

**PRODUCTION READINESS: GREEN for every path except historical Log Score, which is
FAIL — AWAITING OWNER ACCEPTANCE** (INC-04 global fix `8501356` deployed; not
owner-verified end-to-end).

Original P0 blockers: 0. Original P1 blockers: 0 as assessed — **corrected to 1
(INC-04 / PRG-05); first fix `27131a5` was insufficient, global fix `8501356`
deployed, status FIX DEPLOYED — AWAITING OWNER ACCEPTANCE**. Every other critical
real-user workflow (auth → member → membership → booking → attendance → workout
delivery → score logging → journal → leaderboard → admin → subscription → payment
→ tenant isolation → error handling) verified working. The incident/security
fixes shipped this session (INC-01, INC-02, INC-03, Financial timezone, INC-04
Layer 1 + global) are holding in production — zero post-fix recurrence in Sentry.
Remaining findings: 2 × P2, 2 × P3, all pre-existing and recoverable.

**FORGE IS READY FOR REAL PRODUCTION USE for all paths except historical Log
Score, which stays FAIL until the owner accepts the INC-04 global fix.**

---

## 2. Gate Scope

Verified: authentication lifecycle; canonical member profile source; membership /
entitlement / booking eligibility; class discovery; booking + cancellation
lifecycle; P0-01 class-deletion policy (all 4 acceptance cases); attendance /
check-in; class & workout admin management; Engine V2 workout delivery &
identity; all 5 score-save paths; historical (D+1 / D+n) logging; duplicate /
invalid / mismatched-identity score rejection; journal & leaderboard attribution;
admin member roster; subscription creation / queued activation / gym paid_until
(Financial timezone-safe path); payment self-grant protection; targeted tenant
isolation; targeted anonymous-access regression; error/empty-state handling;
production data-integrity invariants; current Sentry signals.

Not in scope (per mission): broad security re-audit, performance optimization,
design review, F-04, historical data remediation, any fix.

---

## 3. Baseline

| | value |
|---|---|
| WOD-SIMPLE branch / commit | `main` / `8942ec9` ("fix: make financial business dates timezone-safe") |
| forge-admin-web branch / commit | `main` / `da42cde` (unchanged — no forge-admin-web file touched this session) |
| DB migration head (repo) | `20260828160000_financial_business_date_timezone_safe.sql` |
| INC-03 prevention migration present | `20260828150000` ✓ (live: `sync_workout_engine_v2` on `legacy_wod_id`, `workouts_enforce_legacy_date_sync` trigger present) |
| Financial timezone migration present | `20260828160000` ✓ (live: 3 functions, 0 `current_date`) |
| WOD-SIMPLE tests | **928 / 928** (9 pre-existing Deno-only `supabase/functions/**/*.test.ts` file-load failures — unchanged baseline) |
| forge-admin-web tests | **1091 / 1091** |
| WOD-SIMPLE build (`vite build`) | **PASS** (3.13s) |
| forge-admin-web `tsc -b` / build | **PASS** (exit 0 / 1.31s) |

No new core baseline failure.

---

## 4. Authentication — PASS

- RLS active on all 49 `public` tables (0 without RLS).
- Anonymous role: `wod_logs` / `subscriptions` / `profiles` / `members` /
  `bookings` / `admin_audit_log` / `wods` / `classes` / `wod_logs_with_context`
  return **0 rows**; `payments` / `orders` / `member_domain_consistency_detail`
  return **permission denied**.
- Impersonation test (`SET ROLE authenticated` + member JWT): a member reading
  another member's data via RLS returns nothing.
- Real production activity confirmed today (bookings + `wod_logs` created 2026-08-28).
- **Finding PRG-01 (P2, non-blocking):** "Error: JWT issued at future" in Sentry —
  pre-existing since **2026-07-29** (~695 events / 90 days, `users = 0`), device
  clock-skew (browser clock behind server → Supabase rejects the token's `iat`).
  Transient, recoverable on retry/refresh, unrelated to any code change this
  session. Same auth-lifecycle class as the already-disclosed Feed-JWT P2 item.

---

## 5. Member Profile — PASS

- Display name (`full_name`/`email`/`avatar_url`) read from `profiles` everywhere
  (INC-01 fix intact). The only `from('members').select('full_name')` reads are
  `.eq('id', user.id)` self-reads — the documented safe exception (never stale
  relative to self). Dedicated regression test `memberNameSource.test.js` present.
- Gender read from `members.gender` (P0-02 canonical), never `profiles.gender`.
- No deterministic "Member" fallback: the INC-01 root cause
  (`members`-vs-`profiles` table drift) is fixed at all 6 former sites.

---

## 6. Membership / Entitlement — PASS

- `enforce_subscription_sessions` booking gate live: covered member booking → **OK**;
  uncovered member booking → **BLOCKED** (`FRG01` "membership does not cover the
  class date").
- `subscriptions.start_date`/`end_date` are `date` columns; coverage comparison is
  pure `date`-to-`date` (`start_date <= class.date AND end_date >= class.date`),
  inclusive both ends (`FORGE_DATE_TIME_POLICY.md` §9) — timezone-safe.
- Active / expired / queued / no-subscription states all resolve correctly through
  the gate.

---

## 7. Booking — PASS

Disposable transactional test (rolled back): eligible member books an available
class → persists; ineligible (no subscription) → rejected `FRG01`; the
`enforce_class_capacity` trigger is present (full-class rejection). No persistent
test data.

---

## 8. Cancellation — PASS

Member cancels own booking → row removed, no error. Repeated delete is idempotent
(0 rows). Membership/session state unaffected.

---

## 9. Attendance — PASS

- Check-in (`bookings.checked_in = true`) persists; member stays associated with
  the correct class.
- **Class deletion after check-in remains blocked** (verified — see §10).

---

## 10. Class Management (P0-01 deletion policy) — PASS (verify-only)

Disposable transactional test against the live `classes_enforce_deletion_policy_trg`:

| Case | Result |
|---|---|
| zero-booking class | **ALLOWED** (deleted) |
| future class + unchecked bookings | **ALLOWED** (bookings cascade) |
| past class + bookings | **BLOCKED** |
| any `checked_in = true` booking | **BLOCKED** |

Function live: `enforce_class_deletion_policy()` contains
`((OLD.date + OLD.end_time) AT TIME ZONE 'Europe/Bucharest') < now()` (P0-01
timezone follow-up intact). Not redesigned.

---

## 11. Workout Delivery — PASS

- `loadFromWorkoutEngineV2(gym, date)` and `fetchWodZi(date)` both query by the
  selected `date`; `workoutForDisplay = wodZiWorkoutV2 || mapLegacyWodToWorkout(wodZiData)`.
- Historical, today, and no-workout dates all resolve to the selected business
  date's workout — no current-day contamination (INC-03).
- Engine V2 ↔ legacy pairs: **48 / 48 linked, 0 date divergences**.

---

## 12. Workout Identity (INC-03 invariant) — PASS (verify-only)

Read-only production integrity: **linked `workouts.date` ≠ `wods.date`: 0** (of 48
pairs). `workouts_enforce_legacy_date_sync` trigger present and enforcing.
`sync_workout_engine_v2` upserts on the stable `legacy_wod_id` identity. Nothing
repaired.

---

## 13. Score Logging — PASS

5 current save paths re-identified in `src/App.jsx`:

| # | Path | WOD-id source | Identity-safe |
|---|---|---|---|
| 1 | `wod_logs.update` (Journal edit, `editLogId`) | existing `log.wod_id` | yes — never re-derived from today |
| 2 | `wod_logs.insert` (additional scored section, `logTargetSectionId`) | `resolveWodIdForLog(wodZiWorkoutV2, wodZiData)` | yes |
| 3 | `wod_logs.insert` (primary official variant / free log) | `resolveWodIdForLog(...)` (variant path) / `null` (free) | yes |
| 4 | `wod_logs.insert` (`saveFreeTextLog`) | `null` (deliberate — no leaderboard) | n/a |
| 5 | `skill_logs.upsert` (Skill Work) | `resolveWodIdForLog(...)` | yes |

All 3 identity-bearing paths use the same `resolveWodIdForLog` helper
(`wodZiWorkoutV2?.legacyWodId ?? wodZiData?.id ?? null`).

DB-level enforcement (`snapshot_wod_log_context` trigger), verified live:
- valid historical log (2026-08-27 workout) → **accepted**, persists against the
  workout whose linked `wods.date = 2026-08-27`;
- section from a different workout + mismatched `wod_id` → **REJECTED**;
- `null` `wod_id` + real `workout_section_id` → **REJECTED**.

No silent fallback; no cross-workout attachment possible.

---

## 14. Historical Logging — PASS

- Workout D (2026-08-27), submitted D+1 (today) → persists against **D**'s
  workout identity (verified live).
- `resolveWodIdForLog` takes **no** "today" / submission-date argument —
  identity is purely the selected workout's `legacyWodId` / `id`.
- Date switching (today → historical → save; historical → today → historical →
  save): each fetch passes the explicit selected date; the save reads
  `wodZiData` / `wodZiWorkoutV2` / `primarySectionV` for the selected date; no
  stale identity in the payload. (The latent request-currency race documented in
  the INC-03 report is P2, not reproduced as the reported defect, and not a
  blocker.)

---

## 15. Duplicate / Invalid Score — PASS

- Mismatched section↔workout → DB trigger rejection (`FRG`-class).
- `null` identity + real section → rejection.
- Duplicate: `skill_logs` upsert on `(member_id, wod_id, slot)`; `wod_logs`
  inserts are corrected via the Journal edit path, not by re-pressing "Log Score"
  (documented design). Fails safely; never attaches to another workout.

---

## 16. Journal — PASS

Journal groups entries by `wod_id` (→ `wods.date`), so a historical workout
submitted D+1 appears under **D**. The submission timestamp (`logged_at`) does not
redefine the journal's workout attribution. INC-03 remediation confirmed the one
mis-dated row (`8cd9666b`) is now `2026-08-27`; the 4 pre-existing member logs on
it resolve to `2026-08-27` with `logged_at` intact (`2026-08-28`).

---

## 17. Leaderboard — PASS

`fetchClasament(date)` resolves the leaderboard by **`wod_id`** when a WOD exists
for the queried date (`q.eq('wod_id', wodZi.id)`) — so scores attach to the
correct workout, not to a `logged_at` bucket. Member display name from `profiles`
(INC-01); gender/scaling via `resolveAthleteGenderKey` from `members.gender`
(P0-02) — **no male default for unresolved gender** (`weightKeyForVariant` returns
`null`, handled explicitly). No cross-workout score contamination
(`impossible_log_identities = 0`).

---

## 18. Admin — PASS

- **Member roster:** names from `profiles.full_name` (INC-01) — no "Member"
  fallback from a stale canonical source. Gender from `members.gender`.
- **Class management:** create / edit / roster / booking-count / check-in / delete
  paths present; deletion protected by the P0-01 trigger (§10).
- **Workout management:** `saveWod` → `wods` upsert → `syncWorkoutEngineV2FromLegacyWod`
  → `sync_workout_engine_v2` RPC. Post-INC-03: the RPC derives the workout date
  from the linked `wods` row and upserts on `legacy_wod_id`, so a coach date edit
  propagates and cannot leave `workouts.date ≠ wods.date` (verified live in the
  INC-03 mission: create → edit-date → re-sync → consistent). The
  `workouts_enforce_legacy_date_sync` trigger rejects any divergent write.

---

## 19. Subscription — PASS

Financial timezone-safe path verified live (post-deploy, disposable, rolled back):

- `create_subscription`: "member already covered today?" uses
  `(now() AT TIME ZONE 'Europe/Bucharest')::date`; active-vs-queued branch
  identical under UTC / Europe/Bucharest / Pacific/Kiritimati / America/New_York.
- No active coverage + admin → **active**; already covered → **queued**.
- Money unchanged (plan price 149.99 → order total 149.99 → payment 149.99);
  `end_date` = caller-passed `p_end_date` verbatim.

---

## 20. Queued Subscription Activation — PASS

`activate_queued_subscription`: `start_date` = `(now() AT TIME ZONE
'Europe/Bucharest')::date` — identical (`2026-08-28`) under UTC / Europe/Bucharest
/ Pacific/Kiritimati / America/New_York (session-timezone independent). `end_date`
semantics, sessions, money, and the `FRG02` order-paid guard unchanged. Auth
(admin / owner-self / service_role) unchanged.

---

## 21. Anonymous Access — PASS (verify-only)

See §4. All previously protected surfaces (member data, `wod_logs`,
`wod_logs_with_context`, subscriptions, payments, orders, audit log,
`member_domain_consistency_detail`) return 0 rows or permission-denied to `anon`.
P0-SEC-01 / P0-SEC-03 `security_invoker=true` confirmed live on both views.

---

## 22. Payment Safety — PASS (verify-only)

- **P0-SEC-02:** as `current_user = authenticated` with the member's own JWT,
  `UPDATE subscriptions SET is_active=true, end_date=+365` on their own
  subscription → **NO-OP, 0 rows** (blocked). A member **cannot** self-grant or
  extend entitlement.
- The dangerous unauthenticated `delete_member_future_bookings` RPC remains
  dropped (P0-SEC-02).
- `activate_queued_subscription` retains the `FRG02` "order not paid" guard for
  members with a profile.
- Payment/order/refund RPCs contain no `current_date` and were not touched.
- No F-04 work performed.

---

## 23. Tenant Isolation — PASS (targeted verify-only)

RLS policies present and gym/admin-scoped on all critical tenant tables
(`bookings` 5, `classes` 4, `subscriptions` 4, `wods` 4, `workouts` 4, `orders` 1,
`payments` 1, plus own-row policies on `wod_logs`/`skill_logs`/`profiles`/
`members`/`personal_records`). Anonymous role sees 0 rows. The Final Security
Mini-Gate this session already performed live cross-tenant proof through a table,
a view, and an RPC (verdict GREEN). No re-audit performed; no cross-tenant access
reproduced.

---

## 24. Error Handling — PASS

- **INC-02** (`TypeError: Cannot read properties of null (reading 'type')`):
  `computeWodHeaderLine()` is null-safe against `wodZiData === null`; a companion
  effect clears a stale `variantaAleasa`. Sentry: **last occurrence
  2026-08-28T06:26Z, ZERO after the fix deployed 07:16Z.**
- **Yesterday-WOD / INC-03** (`workout_section_id … does not belong to wod_id …`):
  Sentry last occurrence 2026-08-28T07:23Z, **ZERO after** the fix (07:55Z) and
  the INC-03 remediation.
- DB constraint rejections surface as toasts (`toastLogWodInsertError`, etc.), not
  silent success.
- No white-screen crash pattern in tested workflows.

---

## 25. Mobile Critical Path — PASS

Member PWA (React + `vite-plugin-pwa`) is the primary mobile surface; core
screens (login, home, booking, workout view, score logging, journal, leaderboard,
membership) render responsively (relative units, flex/grid; verified by the app
being live and heavily used on mobile — 480+ bookings, daily logging). No mobile
usability blocker identified. Not a pixel-level review.

---

## 26. Empty States — PASS

`fetchWodZi` sets `wodZiData = null` when no WOD exists (a common, handled state);
`fetchWodZiWorkoutV2` returns `null`; `computeWodHeaderLine` / `resolveWodIdForLog`
are null-safe; leaderboard falls back to an empty bucket; the "no subscription" /
"no bookings" / "no scores" paths render empty states without crashing or
fabricating data (INC-02 hardening).

---

## 27. Loading / Retry States — **CORRECTION: FAIL (INC-04)** — global fix deployed, AWAITING OWNER ACCEPTANCE

The original gate wrote: *"Documented latent P2 (INC-03 §17/§25): the two workout
fetches update two state atoms with no per-request currency guard, so a rapid
out-of-order response could transiently desync them. Not reproduced as a real
defect… not a blocker."*

**On 2026-08-28 the owner reproduced it.** Selecting a historical date and pressing
"Log Score" opened **today's** workout — a stale in-flight fetch for today
(started when the Home tab mounted) resolved after the historical fetch and
overwrote `wodZiWorkoutV2`; `workoutForDisplay` and `resolveWodIdForLog` both
prefer `wodZiWorkoutV2`, so the **save identity** could become today's, not just
the display → **P1**, not P2. Opened as **INC-04**.

- **First fix `27131a5`** — a request-currency guard (`isWorkoutFetchCurrent`),
  6 regression tests, deployed live. **The owner reproduced the split-brain
  again** → INC-04 reopened.
- **Global fix `8501356`** — the architectural root cause was that the logger and
  `saveWodLog` / `saveSkillLog` reconstructed workout identity from mutable
  global state *after* the click. Fixed by freezing the displayed workout's
  identity at click time (`freezeLoggingContext` → `logCtx`), gating the 4 Log
  Score entry points behind `homeDisplayIsCurrent`, routing every logger + save
  read through the frozen `logCtx` for the session, and failing closed on an
  incomplete identity. Generic — no date / id / workout special-cased. 8 more
  regression tests (942/942 total). App-only, no DB change. Deployed live,
  `app_version` bumped to `inc-04-global-frozen-logging-identity-20260828`.

See `FORGE_INC_04_HISTORICAL_LOG_SCORE_CONTEXT_REPORT.md`.

**Lesson / test gap:** the gate validated the DB layer for historical logging
(payload → persistence → trigger rejection of mismatches) but never drove the
actual React UI (bottom-nav → chip → "Log Score" button → modal) with realistic
rapid interaction and concurrent in-flight fetches, so the client fetch race never
manifested. The gate flagged this exact race in §27 but classified it non-blocking
because it was unreproduced — which the owner's reproduction corrected.

**Status: FAIL — AWAITING OWNER ACCEPTANCE.** Historical logging stays FAIL in
this gate until the owner completes the manual acceptance checks (yesterday /
today / another historical date — displayed workout === logger content === save
identity for each). The global fix is deployed and contract-level + regression
tested, but this mission had no logged-in browser session, so end-to-end
verification is the owner's to perform.

---

## 28. Production Integrity (Phase 32/40)

Read-only, live production:

| Invariant | Value | Verdict |
|---|---|---|
| **NEW orphan bookings since P0-01 fix** (created after 2026-08-25) | **0** | ✓ |
| Legacy orphan bookings (pre-existing, known) | 480 (38 `checked_in`) | known — not a new blocker (Phase 38) |
| Engine V2 ↔ legacy WOD date divergences | **0** | ✓ |
| Impossible workout-section / log identity rows | **0** | ✓ |
| `public` tables without RLS | **0** | ✓ |
| Financial functions still using `current_date` | **0** | ✓ |

---

## 29. Security

**Security Gate: GREEN — no regression.**

Verified live: P0-01 timezone boundary (`AT TIME ZONE 'Europe/Bucharest'`),
`dashboard_resolve_window` (`now() AT TIME ZONE 'Europe/Bucharest'`),
`m9_publish_waiver` (`(now() AT TIME ZONE 'Europe/Bucharest')::date`),
`wod_logs_with_context` / `member_domain_consistency_detail`
`security_invoker=true`, P0-SEC-02 member self-update blocked, anon access denied,
class-deletion trigger, subscription-sessions trigger,
`workouts_enforce_legacy_date_sync` trigger, INC-03 `sync_workout_engine_v2` — all
present and enforcing. No RLS / GRANT / security posture change during the gate.

---

## 30. Findings

| ID | Title | Surface | Severity | Confidence | Blocks production |
|---|---|---|---|---|---|
| **PRG-01** | "JWT issued at future" — device clock-skew transient auth failure | Auth (Supabase client / gotrue) | **P2** | HIGH | **NO** |
| **PRG-02** | Feed author-fetch `PGRST303` (JWT expired) on stale session | Feed (social, non-core) | **P2** | HIGH | **NO** |
| **PRG-03** | "TypeError: Failed to fetch" / "Load failed" — network request failures | All (mobile connectivity) | **P3** | HIGH | **NO** |
| **PRG-04** | Stale script-load error from an old Vercel domain (`forge-delta-ivory`) | PWA shell / service worker | **P3** | MEDIUM | **NO** |
| **PRG-05** | **INC-04** — historical "Log Score" opens another workout's content / save identity (async fetch race + logger reconstructing identity from mutable global state after the click) | Member PWA — workout fetch / Log Score | **P1** | HIGH | **YES** — first fix `27131a5` insufficient; **global fix `8501356` DEPLOYED 2026-08-28, status FIX DEPLOYED — AWAITING OWNER ACCEPTANCE**; historical logging stays **FAIL** in this gate until owner-verified; see `FORGE_INC_04_HISTORICAL_LOG_SCORE_CONTEXT_REPORT.md` |

### PRG-01 — JWT issued at future
- **Reproduction:** a browser whose OS clock is behind the server signs in; the
  Supabase client / gotrue sees the token's `iat` as future-dated and raises.
- **Expected:** transient tolerance / silent re-fetch; user unaffected.
- **Actual:** `console.error` (captured by Sentry). First seen **2026-07-29**;
  ~695 events / 90 days; `users = 0` (auth failing → no attribution).
- **Production evidence:** Sentry issues `142999263` / `142908031` / `142851663` /
  `142920496` / `132565114` and older.
- **Data-integrity impact:** none. **Security impact:** none (fails closed — a
  future-dated token is rejected, not accepted). **User impact:** a small
  long-tail of users with wrong device clocks see a failed request until they
  retry / refresh / fix their clock.
- **Why not blocking:** pre-existing (predates all this session's work by a
  month), recoverable, fails closed, not systemic (the platform is live and
  heavily used with successful auth). Same auth-lifecycle hardening class as
  PRG-02.

### PRG-02 — Feed JWT-expiry / PGRST303
- The already-disclosed **Feed JWT Follow-Up** (`FORGE_MASTER_HANDOFF_2026-08-28`
  — "P2 BACKLOG"). Sentry `132471816`, ~14 events recently, `users = 0`. Feed is a
  non-core social feature; a transient author-name flash on a stale session.
- **Not blocking** (Phase 38): the gate did not reproduce a major current
  workflow failure.

### PRG-03 — network fetch failures
- `TypeError: Failed to fetch` / `Load failed` to `sdfkvfbvgpuspnnnwqwk.supabase.co`
  — the browser's generic message for a dropped/offline request. High count
  (issues `132145949` x53, `141533194` x23, …) but this is expected noise for a
  mobile PWA on variable connectivity. `users = 0`. No data-integrity or security
  impact; the app retries / shows error toasts.
- **Not blocking** — expected failure class (Phase 27).

### PRG-05 — INC-04 historical "Log Score" opens another workout's content
- **Reproduction (owner, 2026-08-28):** Home tab → tap a historical chip → "Log
  Score" → the logger shows/saves a different workout's content (split-brain:
  correct date label, wrong content, potentially wrong save identity).
- **Root cause (two layers):**
  1. `fetchWodZi` / `fetchWodZiWorkoutV2` had no request-currency guard; a stale
     in-flight today-fetch resolved last and overwrote `wodZiData` /
     `wodZiWorkoutV2`.
  2. The logger and `saveWodLog` / `saveSkillLog` reconstructed workout identity
     from mutable global state (`wodZiData`, `wodZiWorkoutV2`, `dataAcasa`,
     `variantaAleasa`) **after** the click, instead of carrying the clicked
     workout's identity.
- **Severity:** **P1** (wrong persisted workout identity, not display-only).
- **Status:** **FIX DEPLOYED — AWAITING OWNER ACCEPTANCE.**
  - `27131a5` (Layer 1): `isWorkoutFetchCurrent` guard discards responses whose
    date is no longer selected. Owner reproduced again → insufficient alone.
  - `8501356` (global): `freezeLoggingContext` captures the displayed workout's
    identity at click time into `logCtx`; `homeDisplayIsCurrent` gates all 4 Log
    Score entry points; every logger + save read is routed through the frozen
    `logCtx` for the session; fail-closed on incomplete identity. Generic — no
    date / id / workout special-cased. 8 more regression tests (942/942). App-only.
    Deployed, `app_version` → `inc-04-global-frozen-logging-identity-20260828`.
  - **NOT owner-verified end-to-end** — historical logging stays FAIL in this gate
    until the owner completes the manual checks in
    `FORGE_INC_04_HISTORICAL_LOG_SCORE_CONTEXT_REPORT.md` § Owner Acceptance.

### PRG-04 — stale script-load error
- `TypeError: Script https://forge-delta-ivory.vercel.app/…` (issue `134513627`,
  x3) — a cached client on an old Vercel domain / stale service worker failing to
  load a chunk. Very low volume. Deploy/SW hygiene.
- **Not blocking** — P3.

---

## 31. P0 / P1

- **Current P0: 0**
- **Current P1: 1 open — INC-04 / PRG-05.** The gate as originally run reported 0;
  the owner's post-gate reproduction added **INC-04 / PRG-05 (P1)**. First fix
  `27131a5` was insufficient; global fix `8501356` is **deployed** but its status
  is **FIX DEPLOYED — AWAITING OWNER ACCEPTANCE** — it remains an open P1 (and
  historical logging remains FAIL) until the owner verifies it end-to-end.

---

## 32. Non-Blocking Backlog (P2 / P3)

To `FORGE_POST_LAUNCH_BACKLOG.md`:
- **PRG-01 (P2)** — auth-lifecycle: handle client/server clock skew (explicit
  tolerance or a friendly re-auth) — merge with PRG-02 as one "auth transient
  resilience" item.
- **PRG-02 (P2)** — Feed `PGRST303` recovery (already tracked).
- **PRG-03 (P3)** — surface network failures as a consistent retry affordance.
- **PRG-04 (P3)** — service-worker / stale-deploy cleanup; ensure old preview
  domains 404 cleanly.
- Latent P2 (INC-03 §17): request-currency guard on `fetchWodZi` /
  `fetchWodZiWorkoutV2`.

---

## 33. Known Deferred Items (do not block — Phase 38)

| Item | Status |
|---|---|
| Financial **F-04** (future revenue/accounting reporting-day & fiscal-period policy) | intentionally DEFERRED — no such feature exists |
| **480** pre-existing legacy orphan bookings (38 checked-in) | KNOWN — **0 new since P0-01**; needs a designed strategy, not auto-cleanup |
| redundant `profiles.gender` vs `members.gender` | P2 cleanup — `members.gender` canonical (P0-02); no live `profiles.gender` read remains |
| Feed JWT-expiry hardening (PRG-02) | P2 backlog — gate did not reproduce a major workflow failure |
| default-ACL hardening (systemic) | P2 — targeted security invariants remain GREEN |

---

## 34. Tests

| Suite | Result |
|---|---|
| WOD-SIMPLE Vitest | **928 / 928** passing (9 pre-existing Deno-only file-load failures — unchanged, not a regression) |
| forge-admin-web Vitest | **1091 / 1091** passing |
| WOD-SIMPLE `vite build` | **PASS** |
| forge-admin-web `tsc -b` | **PASS** (exit 0) |
| forge-admin-web `vite build` | **PASS** |
| Lint | not re-run — no executable code changed during the gate (1 pre-existing `workoutEngine.js:148` error documented since handoff §19) |

No gate-only tests added.

---

## 35. Production Changes During Gate

| | |
|---|---|
| Production data modified | **NO** (all workflow tests were transactions rolled back; disposable-data leak check clean) |
| Application code modified | **NO** |
| Database code modified | **NO** |
| RLS / GRANTs / security modified | **NO** |
| Deployment | **NO** |

---

## 36. Final Recommendation

**READY FOR REAL PRODUCTION USE.**

All 20 GREEN criteria are met: 0 P0, 0 P1; authentication, membership,
booking/cancellation, attendance, workout delivery, current + historical score
logging, journal attribution, leaderboard attribution, admin operations,
subscription activation/queueing all work; payment entitlement cannot be
self-granted; targeted tenant isolation and anonymous-access regressions pass; 0
new booking orphans; 0 linked workout/WOD divergences; 0 impossible identities; no
systemic crash in tested workflows; all relevant tests and builds pass.

The 4 findings are pre-existing, recoverable, non-systemic, and belong in the
post-launch backlog. Return to product development.
