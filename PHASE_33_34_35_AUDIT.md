# Phase 33 — Date, Time & Timezone Audit

Scope covered: WOD-SIMPLE (member PWA, this repo) and forge-admin-web (coach/admin app, `C:\Users\Luci\Desktop\forge-admin-web`), plus `supabase/migrations/` and `supabase/functions/`.

## 1. No canonical gym timezone exists anywhere

**HIGH CONFIDENCE (directly verified).** Grepped every migration for a `timezone` column on `gyms` (or any table) — none exists. There is no `gyms.timezone`, no per-gym locale/offset setting, no server-side notion of "the gym's local day." Every "today" resolution in both clients depends entirely on **the calling browser's local timezone** (`new Date()` local getters, e.g. `d.getFullYear()/getMonth()/getDate()`).

Practical implication: a member traveling in a different timezone than the gym sees "today's WOD," bookable classes for "today," etc. based on **their device's** local calendar day, not the gym's. This is an architectural gap, not a bug per se — flagged because the phase explicitly asks whether a single source of truth exists. It does not.

## 2. WOD-SIMPLE has a documented, already-fixed timezone bug — and the fix is applied consistently there

**HIGH CONFIDENCE.** `src/utils.js:11-18`, `todayLocalStr()`:

```js
// Data de azi in fusul orar LOCAL, ca string YYYY-MM-DD. NU folosi
// new Date().toISOString().split('T')[0] pentru asta - e ora UTC, care in
// Romania (UTC+2/+3) e in urma cu ora locala intre miezul noptii si ~2-3
// dimineata, ducand la comparatii de data gresite exact in acel interval
// (abonamente/clase tratate ca "de maine" sau "expirate cu o zi in avans").
```

This is a precise description of the exact bug class Phase 33 asks about, already found and fixed here. `todayLocalStr()` and equivalent inline local-date constructions (`` `${d.getFullYear()}-${...}` ``) are used consistently through `src/App.jsx` for the member-facing "today's WOD"/home calendar flow (`dataAcasa` state, ~15 call sites checked: lines 2503, 3493, 3639, 3663, 3760, 6084, 6692-6693, 7444-7451, 9177-9186, 11058, 11162-11215, 11256). None of these use the UTC-anti-pattern.

A second, related already-fixed bug is documented at `src/utils.js:21-33` (`dateWithCurrentTime`): logging a WOD for a past date used to let `wod_logs.logged_at` default to `now()` on INSERT, so a backfilled log for "yesterday" appeared on "today" in the Journal/Leaderboard even though `wod_id` was correct. Fixed by explicitly combining the chosen local date with the current time before insert.

## 3. The same anti-pattern is still live, unfixed, in several other call sites — most significantly in forge-admin-web's coach dashboard

**HIGH CONFIDENCE (verified in code) that these use `new Date().toISOString().slice(0,10)` — the exact pattern WOD-SIMPLE's own code comment warns against:**

- `src/App.jsx:4951` (WOD-SIMPLE) — Platform Admin gym list, `paid_until` expiry display (`expired = g.paid_until && g.paid_until < todayISO`). Display-only, low impact.
- `src/ActivationDashboard.jsx:104` (WOD-SIMPLE) — `gym_waivers` "current waiver" lookup (`effective_date <= todayStr`).
- `forge-admin-web/src/features/waivers/api.ts:20` — same "current waiver" derivation, client-side.
- `forge-admin-web/src/features/subscriptions/api.ts:27-28,64-87` (`toDateStr()`) — used by `applyStatusFilter()` to build the **server-side PostgREST filters** for the Subscriptions list's `active`/`expiringSoon`/`scheduled`/`expired` tabs (`.gte('end_date', todayStr)`, `.lt('end_date', todayStr)`, etc.).
- `forge-admin-web/src/features/dashboard/analytics.ts:154-167` (`getDashboardTodaySummary`) — computes `today`/`nowTime` via UTC `toISOString()`, then uses it for **today's WOD** (`fetchWodForDate(gymId, today)`), the "next class today" query, filtering "recent PRs" down to today's events, and the attendance/class summary `window: 'today'` calls.

**MEDIUM CONFIDENCE on real-world impact** (reasoned, not runtime-tested): for a Romania-based gym (UTC+2/+3), this creates a **daily ~2-3 hour window just after local midnight** (until UTC's own midnight) where these specific call sites compute "today" as *yesterday's* date. Concretely, in that window: forge-admin-web's Dashboard "today's WOD" card and "expiring today" count would show yesterday's data, and the Subscriptions list's active/expired/scheduled filter buckets would misclassify a membership that (by local calendar) already expired or already started. Note this is inconsistent with `subscriptions/subscriptionStatus.ts:39-53`'s own per-row `deriveSubscriptionStatus()`, which correctly compares full `Date` objects (`new Date(row.end_date + 'T23:59:59') < today` where `today = new Date()`, both local-time-aware) — so the coarse list-filter buckets and the per-row status badge can disagree with each other during that window.

This looks like a real gap in the "shared business logic across clients" discipline the project otherwise cares about (per project memory, "Forge Cross-Client Consistency Guard"): WOD-SIMPLE fixed this bug and left a detailed warning comment; forge-admin-web is a separate repo with no shared code path to WOD-SIMPLE's `utils.js`, and independently re-introduced the exact pattern the comment warns about.

## 4. Booking/membership-coverage enforcement itself is NOT timezone-sensitive (good)

**HIGH CONFIDENCE.** `supabase/migrations/20260816000000_enforce_membership_covers_class_date.sql` — the P0 fix for the "160 unauthorized bookings" incident — validates a booking against `classes.date` (a plain `date` column) directly, never against `current_date`/`now()`. Since both sides of the comparison are calendar dates with no time component, this check has no midnight-boundary ambiguity. Confirmed no timezone bug here.

## 5. Server-side cron/edge jobs use Postgres/Deno server time (effectively UTC), not gym-local time

**MEDIUM CONFIDENCE, largely theoretical today, flagged for awareness:**
- `gym-billing-block-daily` cron (`supabase/migrations/20260714190000_gym_paid_until.sql:61-65`), `'0 8 * * *'`, deactivates gyms where `paid_until < current_date`. `current_date` evaluates in the database session's default timezone (typically UTC on a managed Supabase project — **UNVERIFIED**, could not query the live DB's `timezone` GUC). Running at 8:00 (presumably UTC) is safely mid-morning for a Romania-based gym, so no practical bug today — but the mechanism has no gym-local-timezone awareness at all, which would matter if the platform ever serves gyms materially west of UTC (project memory notes a "global SaaS vision" was explored and closed, not actively pursued).
- `supabase/functions/check-subscriptions/index.ts:126` computes `today` via `new Date().toISOString().split("T")[0]` (Deno edge runtime, UTC) and does an **exact match** (`.eq('end_date', in3days)`) against `subscriptions.end_date` for 3-day/1-day expiry reminder emails/push. **UNVERIFIED**: could not find this function's own invocation schedule anywhere in the repo (no `cron.schedule` call references it) — it's presumably triggered by an external scheduler not visible in this codebase, so whether/when exactly-once-daily invocation could skip or double-fire a reminder near a UTC/local day boundary could not be confirmed from static code.

## What I could not verify (Phase 33)

- The live Postgres database session's `timezone` GUC / whether Supabase's managed project is configured to anything other than UTC — no runtime DB access.
- Whether members or coaches have ever actually experienced a wrong-day WOD or membership-status flip in production — would require production logs/support tickets, not available here.
- `check-subscriptions`'s actual invocation schedule/frequency (no cron definition found in-repo).
- Whether any timezone-related incident has occurred for forge-admin-web specifically (its bug, described in §3, is inferred from static code, not confirmed via a bug report).

---

# Phase 34 — Concurrency & Duplicate Action Audit

## 1. Class capacity race — REAL DB-level guard (well-designed)

**HIGH CONFIDENCE.** `supabase/migrations/20260701080200_enforce_class_capacity.sql`: `enforce_class_capacity()` is a `BEFORE INSERT ON bookings` trigger that does `SELECT max_spots FROM classes WHERE id::text = NEW.class_id FOR UPDATE`, locking the class row, then counts existing bookings and rejects the insert if full. This correctly serializes two concurrent booking attempts for the last spot in a class — not an app-level count-then-insert race, a genuine DB-level guard. The migration's own comment documents that this replaced a purely client-side check (a stale cached count) after a real overfill bug.

## 2. Double-booking the SAME class by the SAME member — no DB-level protection found

**MEDIUM-HIGH CONFIDENCE.** No unique constraint on `bookings(class_id, member_id)` exists anywhere in `supabase/migrations/` (compare: `class_waitlist` has `unique(class_id, member_id)`, `class_reminders` has `unique(class_id, member_email)` — `bookings` has no equivalent). The booking toggle in `src/App.jsx:8569-8595` decides insert-vs-delete purely from client-held state (`esteRezervat`); the insert call itself has no visible in-flight/disabled guard on the button at that call site. A double-tap or a retried request could plausibly insert two `bookings` rows for the same member+class — each individually passes `enforce_class_capacity()` (which only checks the aggregate count, not per-member uniqueness), consuming two capacity slots and (via `adjustSessionsUsedAtomic`) potentially two session credits. Exploitability under real network/UI conditions is inferred, not runtime-tested.

## 3. Log Workout double-submit — confirmed frontend-only protection, explicitly by design

**HIGH CONFIDENCE.** `src/App.jsx:8228-8232` code comment: *"Mereu INSERT (nu upsert)... o corectare ulterioara se face prin editare din Jurnal... nu prin re-apasarea 'Log Score'"* — i.e., the team deliberately chose always-INSERT semantics. No unique constraint exists on `wod_logs` for `(member_id, wod_id)` or `(member_id, wod_id, workout_section_id)` (confirmed via grep across all migrations). Contrast: `skill_logs` DOES have `unique(member_id, wod_id, slot)` (`supabase/migrations/20260705220200_skill_logs_slot.sql:8`) — this protection was added for skill logging but never for the main `wod_logs` table. The only guard against a double-click is the frontend `wodSaving` state disabling the Save button (`src/App.jsx:6331, 10284-10286`). A double-submit (slow network, double-tap before the button visually disables) can create duplicate score rows that would double-count on leaderboards and feed into PR detection (`evaluate_movement_prs`/`evaluate_benchmark_pr` triggers fire per-row, with no dedup).

## 4. Stripe webhook idempotency — REAL, well-engineered DB-level protection

**HIGH CONFIDENCE.** Both `supabase/functions/stripe-webhook/index.ts` and `supabase/functions/platform-billing-webhook/index.ts` register payments via RPCs (`register_payment`/`register_platform_payment`) that write to tables backed by `unique(provider, provider_reference)` (`payments_provider_reference_unique`, `platform_payments_provider_reference_unique` — `supabase/migrations/20260720090400_financial_constraints.sql:18`, `20260804100000_m10_5_platform_billing_schema.sql:104`). `stripe-webhook/index.ts:112-157` explicitly treats "already paid"/"already active" as expected idempotent duplicate delivery and returns `200` without reprocessing, rather than erroring.

A genuinely-reproduced race was found and fixed in `supabase/migrations/20260805100100_m10_5a_fix_activation_race.sql`: two simultaneously-paid Platform Orders for the same gym would hit `platform_subscriptions_one_active_idx`'s `unique_violation` — originally unhandled, which rolled back the already-succeeded Payment insert in the same transaction ("money taken, nothing recorded"). Fixed with a nested `BEGIN/EXCEPTION` block (PL/pgSQL implicit savepoint) so the Payment record always survives even when the activation side loses the race. This is the strongest-engineered concurrency handling found anywhere in the platform.

## 5. Duplicate gym-membership activation — no DB-level uniqueness, unlike the platform tier

**HIGH CONFIDENCE the constraint is absent; MEDIUM CONFIDENCE on exploitability (inferred, not runtime-tested).** No unique constraint/partial index exists for "at most one active `subscriptions` row per (member, gym)" — contrast with `platform_subscriptions_one_active_idx` (`supabase/migrations/20260804100000_m10_5_platform_billing_schema.sql:60`), which enforces exactly this at the platform-billing tier. At the gym-membership tier, `activate_queued_subscription()` (`supabase/migrations/20260818090000_...sql:141-147`) instead does an application-level two-step: `UPDATE subscriptions SET is_active=false WHERE ... is_active=true AND id<>p_subscription_id` followed by `UPDATE ... SET is_active=true WHERE id=p_subscription_id`, with **no `FOR UPDATE` row lock** on the member's active-subscription set beforehand. Under READ COMMITTED (Postgres default) isolation, two concurrent calls activating two *different* queued subscriptions for the *same* member could each fail to see the other's not-yet-committed "deactivate others" update, and both could end up `is_active = true`. This is exactly the class of bug that WAS found and fixed at the platform tier (§4 above, migration `20260805100100`) but does not appear to have been backported to the gym-membership tier.

## 6. AI analysis (`analyze-workout`) — no dedup, by design

**HIGH CONFIDENCE.** `supabase/functions/analyze-workout/index.ts` has no caching, memoization, or duplicate-request detection. Client-side, the "Generate"/"Analyze" button is guarded only by `disabled={aiAnalyzing || !aiParseText.trim()}` (`src/App.jsx:4627`) — an in-flight guard, not a dedup mechanism. Every distinct click after a response returns triggers a fresh LLM call, with no cost control. Low severity (cost/UX only, no data-integrity impact).

## What I could not verify (Phase 34)

- Actual runtime race outcomes (whether the theorized `bookings` double-insert or `subscriptions` double-activation races have ever occurred in production) — would require load-testing or production incident data, neither available here.
- Whether Postgres's actual isolation level for these RPC calls (as invoked via PostgREST/Supabase) is READ COMMITTED (the Postgres default, assumed) or something stricter configured elsewhere — not found in migrations, UNVERIFIED.
- Whether `check-subscriptions`'s `cleanup_abandoned_queued_subscriptions` RPC (called from the same edge function, §Phase 33) has its own concurrency protection — out of this audit's direct scope, not deeply investigated.

---

# Phase 35 — Destructive Actions & Recovery

## 1. Movements catalog: "no-hard-delete" is a documented *convention*, not an *enforced* invariant

**MEDIUM-HIGH CONFIDENCE.** A migration comment states: *"deleting a movements catalog row (should never happen per the catalog's own no-hard-delete convention)"* (`supabase/migrations/20260824090000_canonical_movement_identity_phase3_pr_engine.sql:46`). However, `movements` (`supabase/migrations/20260819090000_movements_catalog.sql:91-96`) has a real `movements_delete` RLS policy permitting any coach/admin to hard-DELETE their gym's own movement rows, and the table has **no** `is_active`/archived column at all — nothing in the schema itself blocks a real DELETE. Checked both clients: no `.from('movements').delete()` call exists anywhere in `WOD-SIMPLE/src` or `forge-admin-web/src` today, so in practice this capability is unused (no UI exposes it) — but it is not actually prevented at the database layer, only by the current absence of a "Delete Movement" button.

## 2. If a movement WERE deleted — verified blast radius

**HIGH CONFIDENCE.** Grepped every migration for a FK referencing `movements(id)`. Exactly one exists:
- `pr_events.movement_id REFERENCES movements(id) ON DELETE SET NULL` (`supabase/migrations/20260824090000_canonical_movement_identity_phase3_pr_engine.sql:44`) — a deleted movement would `SET NULL` on any PR event that referenced it canonically; the PR event row itself, and its `movement` free-text field, survive untouched.

Everything else that appears to "reference" a movement does **not** do so via a real foreign key:
- `wod_logs.sets_movement_ids` / `skill_logs.sets_movement_ids` (`supabase/migrations/20260823090000_canonical_movement_identity_phase1_result_resolution.sql:22-23`) are plain `jsonb` maps (set-key → `movements.id`), with **no FK constraint at all**. Deleting a movement would leave these JSON values silently pointing at a non-existent id — no cascade, no error, no `SET NULL`; any downstream code that resolves these ids would simply fail to find a match. This is an unenforced, silent-orphaning risk, currently low-probability only because the delete path is unused (see §1).
- `personal_records.movement` is free text with **no** structured reference to `movements` at all (confirmed by the migration's own comment: "no structured Movement Library"). A deleted movement has zero effect on `personal_records`.

## 3. Deleting a `wods` row (WOD-SIMPLE admin) — hard delete, no confirmation, but well-contained blast radius

**HIGH CONFIDENCE.** `stergeWod()` → `supabase.from('wods').delete().eq('id', id)` (`src/App.jsx:3681`), wired to the trash-can button on `PastWodCard` with **no confirmation dialog** — `onClick={onDelete}` fires immediately (`src/App.jsx:1401`, `4712`). `wod_logs.wod_id` has `ON DELETE SET NULL` (`supabase/migrations/20260812090300_results_phase2_slice2_cascade_fix_and_views.sql:22-24`), so existing member scores are **not** deleted — they lose their `wod_id` link but keep displaying correctly because `wod_logs` snapshots the workout's name/format/movements onto the log row at write time (`wod_name_snapshot`, `format_snapshot`, etc. — see `snapshot_wod_log_context()`, `supabase/migrations/20260822093000_wod_logs_section_integrity.sql:56-71`). Net: the delete action itself is unguarded, but its effect on historical member data is deliberately non-destructive by design.

## 4. Deleting a class (WOD-SIMPLE admin) — hard delete, no confirmation

**HIGH CONFIDENCE.** `stergeClasa()` (`src/App.jsx:3303-3334`), wired at `src/App.jsx:4509` with a bare `onClick={() => stergeClasa(c.id)}` — no confirmation. It does correctly refund session credits for future bookings before deleting (lines 3308-3331). Compare to `stergeSeria()` (delete an entire recurring series), which **does** have a `window.confirm(...)` guard at its call site (`src/App.jsx:4510`) — the single-class delete path is the one left unguarded.

## 5. "Delete past classes" bulk action — confirmed still-live, one-click, unconfirmed, irreversible

**HIGH CONFIDENCE — this matches an already-known, still-unresolved bug in project history.** `stergeClaseleTrecute()` (`src/App.jsx:3254-3259`):
```js
const stergeClaseleTrecute = async () => {
  const azi = new Date()
  const aziS = `${azi.getFullYear()}-${String(azi.getMonth()+1).padStart(2,'0')}-${String(azi.getDate()).padStart(2,'0')}`
  await supabase.from('classes').delete().lt('date', aziS)
  fetchClase()
}
```
Wired at `src/App.jsx:4475` with `onClick={stergeClaseleTrecute}` directly — **no `window.confirm`, no undo, no soft-delete.** Every click permanently deletes every class dated before today, gym-wide. `bookings` tied to those classes were not found to have any `ON DELETE CASCADE`/`SET NULL` in the migrations directory for the base `bookings` table (only `class_reminder_log`, `class_reminders`, and `class_waitlist` have `references classes(id) on delete cascade` — no equivalent clause for `bookings` was found anywhere). `bookings.class_id` appears to be compared as `id::text = new.class_id` in two trigger functions (`enforce_class_capacity`, `enforce_subscription_sessions`), suggesting it may be stored as `text` rather than a `uuid` FK — if so, there is likely **no DB-level referential integrity at all** protecting `bookings` when a class is deleted (orphaned rows, not cascade-deleted, not restricted). This last point is **MEDIUM CONFIDENCE** — the base `bookings`/`classes` tables predate this repo's migration history (consistent with project memory noting some base-table DDL isn't reflected in `supabase/migrations/`), so their exact live FK definitions could not be read directly from static code.

## 6. Deleting a member's own log entry — hard delete, but with a real two-tap confirm

**HIGH CONFIDENCE.** `stergeWodLog()`/`stergeSkillLog()` (`src/App.jsx:8073-8083`) are plain hard deletes with no soft-delete flag, but the UI (`JurnalList`, `src/App.jsx:5491` onward, `confirmDelete`/`confirmDeleteSkill` state at lines 5498-5499, 5617, 5732) requires two taps: the first arms an inline confirm state, the second actually calls delete. This is a real (if frontend-only) confirmation step — better UX-safety than the admin flows in §4-5 above, though still no server-side undo window.

## 7. `subscription_plans` delete (forge-admin-web) — the best-protected destructive flow found

**HIGH CONFIDENCE.** `forge-admin-web/src/features/plans/api.ts:132-144`: `countPlanUsage()` pre-checks how many `subscriptions` reference the plan (to drive a differentiated confirmation dialog), and the delete itself is explicitly documented as "backstopped unconditionally by `subscriptions_plan_id_fkey` regardless of what [the count] returns" — i.e., even if the app-level pre-check were wrong or bypassed, the database FK constraint prevents deleting a plan that's actually in use. This is the one clearly best-practice destructive-action pattern found across both codebases (pre-check UI + unconditional DB-level enforcement), worth using as the template for the gaps above.

## 8. Remove Member — soft identity-detach, hard-delete only forward-looking rows

**HIGH CONFIDENCE.** `supabase/functions/admin-remove-member/index.ts:112-115,152-153`: hard-deletes only `bookings`, `class_waitlist`, `class_reminders`, and `push_subscriptions` scoped to that member, then sets `profiles.gym_id = null` (a soft detach, not a profile delete). Historical `wod_logs`, `skill_logs`, `subscriptions`, `pr_events`, etc. are left intact — orphaned from gym-scoped RLS visibility, not destroyed. Matches project memory (Remove Member initiative closed as "Ready for Production").

## 9. Cancel/end a membership — soft delete

**HIGH CONFIDENCE.** `subscriptions.is_active` flips to `false`; the row is never removed (`forge-admin-web/src/features/subscriptions/subscriptionStatus.ts:1-53` documents the resulting `'ended'` status explicitly). No data loss.

## 10. forge-admin-web exposes almost no destructive-delete UI at all

**MEDIUM CONFIDENCE this is complete** (a `.delete()` grep could miss an RPC-based delete not using that exact call shape). A repo-wide search of `forge-admin-web/src/features/*` found exactly one `.delete()` call in the entire app — `subscription_plans` (§7). Deleting workouts, classes, or logs is only possible from WOD-SIMPLE's admin surfaces (audited in §3-6); forge-admin-web, the dedicated coach/admin tool, currently has no equivalent delete-workout/delete-class UI. This is a scope/architecture observation, not itself a defect.

## What I could not verify (Phase 35)

- The live/actual FK definition (if any) on `bookings.class_id` — the base `bookings`/`classes` tables predate `supabase/migrations/`'s history; only ALTERs on top of them are visible in-repo. Direct DB introspection (not available here) would settle §5's cascade question definitively.
- Whether the `movements_delete` RLS policy has ever been exercised outside the app (e.g., via direct SQL by an operator) — no audit log evidence checked for this specific table.
- Whether any non-`.from(x).delete()` destructive RPCs exist in forge-admin-web that a plain grep would miss.
- Actual user-facing recovery/undo tooling (e.g., can a platform admin restore a deleted class from a backup?) — infrastructure-level, outside static code.
