# Forge V1 Certification Sprint — Production Readiness Audit

**Scope:** forge-admin-web (coach/owner Admin client) + WOD-SIMPLE (member-facing PWA), both live on Vercel against one shared multi-tenant Supabase project. Re-verified directly against current code (both repos, HEAD of `main` as of 2026-08-06) and live production signals (Sentry telemetry, live RLS policies, live `supabase_realtime` publication membership) — not against prior phase reports. Where a finding is confirmed against live production state rather than code alone, it is marked **(live-verified)**.

No code was changed as part of this audit. No new features were implemented. No existing domain was redesigned.

**A note on provenance**: this document supersedes and incorporates a prior, narrower certification pass (archived at `WOD-SIMPLE/docs/architecture/FORGE_V1_CERTIFICATION_REPORT_2026-08-03_BILLING_ENGINE.md`, verdict **PRODUCTION BLOCKED**), scoped specifically to the Owner/Platform-Billing engine (Stripe checkout, webhook, subscription renewal, cancellation enforcement). Per this audit's own explicit instruction not to rely on previous reports, its claims were **not re-verified live in this pass** — this session neither attempted a real Stripe purchase nor inspected live webhook delivery logs, consistent with this platform's own standing policy against executing real financial transactions or logging in as a user. Its findings are carried forward in §16a below, clearly marked as **inherited, not independently re-confirmed**, because they materially affect the verdict and no evidence was found that they have since been resolved (no commit, migration, or memory record references Stripe webhook registration, a renewal mechanism, or cancellation-access-enforcement being built after 2026-08-03).

---

## 1. Executive Summary

Forge is a genuinely well-built platform in the areas its recent development has focused on: the Results/Performance/Dashboard work (Slices 1–5, Phase 0–2) is internally consistent, reuses its own services correctly, and is covered by real tests. The core CRUD domains (Members, Classes, Attendance, Programming) are solid, share a real design system (one `Dialog` primitive, one confirmation pattern, zero raw `window.confirm()` in Admin, consistent button/table/empty-state conventions), and show no N+1 query patterns anywhere.

But this audit found a **hard functional gap in the Financial/Membership workflow** — the one thing every gym owner does every week (renewing or extending a member's subscription) **has no implementation anywhere in forge-admin-web**. It found **zero error monitoring on the Admin client** while the PWA's own monitoring shows **91 unresolved production issues today**, several of them real, currently-occurring bugs (a `ReferenceError` in production, three separate Postgres "stack depth limit exceeded" recursion errors, thousands of "order not paid"/subscription-activation errors). It found that the **Coach role has no UI-level gating at all** (mitigated, but not eliminated, by RLS). It found the Admin app is **effectively desktop-only** (6 responsive-class occurrences across ~65 feature files), with the one screen most likely to be used on a phone at the gym floor (the check-in roster) having no horizontal-scroll handling at all. And it found a real, current **i18n regression**: the newest member-facing Results/Progress screens render hardcoded Romanian text to English-language users, on primary-navigation tabs.

None of these are exotic edge cases. They are exactly the things a real external gym owner would hit in their first week.

Separately, and more severely: the inherited 2026-08-03 audit (see §16a) found that the **Platform Billing engine itself — the mechanism by which Forge charges a gym owner for using Forge — has never processed a real payment.** The Stripe webhook has no real endpoint registered against it, there is no code path anywhere that can produce a second charge for an already-converted gym, a cancelled subscription never actually revokes access, and no human being has ever clicked through the purchase flow in a real browser. This was not re-verified live in this pass, but no evidence was found that it has changed, and it is severe enough that it must weigh on this audit's own verdict rather than be treated as someone else's already-closed finding.

## 2. Overall Certification Verdict

**NOT YET CERTIFIED**

Two independent audits, six weeks apart in project time but only three days apart on the calendar, both reach the same conclusion from different angles: this session's own findings block certification on **product usability and operational grounds** (no renewal workflow in the Admin UI, no error monitoring, live production bugs, desktop-only responsive coverage); the inherited 2026-08-03 audit blocks it on **commercial/financial grounds** (the billing engine itself cannot yet reliably collect or enforce payment). Either audit alone would be sufficient to withhold certification. Together, they describe the same underlying gap — Forge's subscription/billing lifecycle, on both the platform-charges-the-gym side and the gym-charges-its-members side, is the least mature part of an otherwise solid product — from two independent directions.

Fixing the Critical items is bounded and concrete (see §18–19), not a redesign — this is a certification gate, not a verdict on the architecture.

---

## 3. Navigation Audit

**forge-admin-web:**
- Routing (`src/App.tsx:35-70`) and `NAV_ITEMS` (`src/shell/navConfig.ts:27-40`) are 1:1 for 9 of 12 nav entries. **Payments, Reports, and Staff are live, clickable sidebar links that lead to an identical generic "This module hasn't been built yet" `PlaceholderPage`** — visually indistinguishable from a real module until clicked. **Major.**
- No dead ends found. Every detail page (`MemberDetails`, `SubscriptionDetails`, `ClassDetails`, `PlanDetails`, `WorkoutDayPage`) has a working back-link; `NotFound` links home.
- Back-link markup is byte-identical across 4 of 5 detail pages; `WorkoutDayPage.tsx:245-247` is a visual outlier (inline placement, different size/color token). Polish.
- Cross-module links exist where expected (Subscriptions↔Member, Member→Progress tab, Programming day→Classes) but are **missing on the two highest-traffic list contexts**: `ResultRow.tsx:60` (Leaderboard, Workout History) and the `ClassDetails`/`AttendanceList` roster tables render an athlete's name as plain text, never a link to their Member profile. A coach mid-class cannot tap a name on the Leaderboard to reach that athlete's file. **Major** (Leaderboard) / **Minor** (rosters).
- No duplicate/conflicting navigation paths found — Leaderboard's dual reachability (standalone + embedded in Programming) is a documented, intentional PWA-parity decision.
- Dashboard's own in-page `<h2>Dashboard</h2>` (`DashboardPage.tsx:17`) duplicates the app-wide `<h1>` the shared `Header` already renders for that route; same pattern on Leaderboard. `WaiverSettings.tsx:79` goes further and renders **its own second `<h1>`** alongside Header's `<h1>Settings</h1>` — an actual heading-hierarchy/semantic-HTML defect, not just visual redundancy. Minor-to-Polish.

**WOD-SIMPLE (PWA):** No dead ends found across any sampled screen. `PerformanceOverviewPanel` (newest Results analytics summary) and `benchmarkDetail` are both properly wired into primary navigation (PR tab), not orphaned.

## 4. Information Architecture Audit

Dashboard / Members / Classes / Attendance / Programming / Results / Settings form a coherent structure with clear, mostly-non-overlapping responsibilities. Two real IA gaps:

- **Subscriptions module is functionally incomplete as information architecture, not just as a feature**: `SubscriptionDetails.tsx` advertises tabs including "Renewals" (line 12) but every tab except Overview falls through to a generic `PlaceholderPage` (lines 175-178) — the IA promises a capability the product doesn't have. See §15 (Workflow) for the full severity discussion.
- **Payments/Reports/Staff exist as IA slots with no content** (§3) — three "modules" that are structurally present but empty, which misrepresents the product's actual current surface area to anyone reading the nav as a feature list (which a new gym owner will).

No genuinely misplaced screens or redundant entry points were found beyond the missing cross-links already noted in §3.

## 5. UX Consistency Audit

**Genuine strengths** (worth stating plainly, not just cataloguing defects):
- One shared `Dialog` component (`src/components/Dialog.tsx`) — focus trap, Escape-to-close, `aria-modal` — used for every modal in the app, zero ad-hoc modals found.
- **Zero `window.confirm()`/`alert()` usage anywhere in forge-admin-web.** Every destructive action (remove member, cancel class, delete/archive plan, bulk attendance actions) routes through the same styled two-button confirmation dialog (`border-neutral-300` Cancel + `bg-red-600` destructive confirm).
- Consistent button hierarchy (primary `bg-neutral-900`, secondary `border-neutral-300`, destructive `bg-red-600`) sampled across 5+ files with no invented alternatives.
- Every list/detail page follows the identical loading→ready/not-found→error state machine backed by a real `ErrorScreen` with retry — no screen was found silently swallowing a primary-data load error.

**Real inconsistencies found:**
- **Loading states have 3 coexisting implementations**: a full-viewport `LoadingScreen` component, 7+ hand-written per-page inline strings ("Loading members…", "Loading classes…", etc., each its own literal), and a dashboard-only `LoadingState` card component whose exact visual is separately re-implemented inline in `AthletePerformanceOverview.tsx:47` instead of reused. Functionally fine (all `aria-live="polite"`), architecturally duplicated. Minor.
- **Empty states**: `dashboard/components/EmptyState.tsx` exists but is used only inside the dashboard module; every other list page hand-rolls the same visual shape locally, and **two different modules independently define a local component literally named `EmptyState`** (`ClassesList.tsx:104-116`, `AttendanceList.tsx:470-478`) rather than sharing one. Minor.
- **Dialog sizing**: only 2 of ~8 dialog call sites use `size="xl"` with `max-h-[85vh] overflow-y-auto`; every other form dialog (`ClassForm`, `AddMemberForm`, `PlanForm`) has no max-height/scroll handling — a tall form on a short viewport has no way to reach its own submit button. Minor.
- **PWA**: one raw `window.confirm()` found for deleting a recurring class series (`App.jsx:3864`) — inconsistent with the rest of the PWA's own styled "tap-again-to-confirm" delete pattern used everywhere else (e.g. PR delete, `App.jsx:8882-8892`). Isolated, coach/admin-facing action. Minor.

## 6. Design System Audit

**The single most systemic design-system finding**: **the Dashboard module uses a completely different color vocabulary than the rest of the app for identical semantic meaning.** Every other module (Members, Subscriptions, Classes, Attendance, Plans, Waivers, Login) uses Tailwind's standard `green`/`red`/`amber`/`blue` family for success/error/warning/info. The Dashboard's `StatusBadge.tsx`/`TrendBadge.tsx`/`OccupancyBar.tsx` (built in Phase 1–2) instead use `emerald`/`rose`/`sky`/`amber` — a non-overlapping token set, at a different text size (`text-[10px]` vs the rest of the app's `text-xs`). This isn't a one-off inconsistency; it's two parallel, non-interoperable color systems, and it sits on the highest-traffic page in the app (`/`). **Major.**

Secondary: `blue` itself is overloaded even within the "standard" palette — "scheduled/future" in Subscriptions vs. "Completed/done" in Attendance. Minor.

**Genuine strengths**: icon usage is one-icon-per-concept throughout with no duplicates found (`ArrowLeft` for back-nav, `Search`, `ChevronLeft/Right`, `Plus` all singular and consistent); border-radius convention (`rounded-xl` cards, `rounded-lg` buttons/inputs, `rounded-full` pills) holds cleanly everywhere sampled; hover states are uniform (`hover:bg-neutral-50` on rows); destructive/edit actions consistently use text labels rather than icon-only buttons (a real accessibility win); `aria-label` coverage on the icon-only controls that do exist (pagination, dialog close, search) is present in every sampled case.

## 7. Copy & Terminology Audit

**forge-admin-web:**
- "Member" is the consistent primary noun everywhere except one place: `PerformanceCommandCenter.tsx:244` ("Athletes needing attention") — "Athlete" leaks into user-visible Dashboard copy on an app that otherwise never says "Athlete" in UI text. Minor.
- **"WOD" vs "workout" — a literal accessible-name mismatch**, not just stylistic drift: `DateMultiPicker.tsx:80` shows a visible badge reading "has WOD" while its own `aria-label` (line 74) reads "already has a workout" — the visible label and the accessible name disagree within one component. Minor but certification-grade (an automated a11y audit would flag this).
- Role labels (`ROLE_LABEL` in `MemberDetails.tsx:20`/`MembersList.tsx:19`) are consistent (`Admin`/`Coach`/`Member`). "Owner" as a distinct label does not appear anywhere in the UI — noted as absent, not necessarily a defect.

**WOD-SIMPLE (PWA):**
- **"Membership" vs "Subscription" — a genuine, high-impact inconsistency in core commerce copy.** The purchase/catalog flow calls it "Membership" (`noMembershipTitle`, `chooseMembershipButton`, `catalogTitle: 'Available Memberships'`), while the home/profile/paywall screens showing the *identical underlying object* call it "Subscription" (`homeDefaultSubscriptionName`, `subScheduled`, `paywallNoSubscription`). A member who taps "Choose Membership" ends up owning something every other screen calls their "Subscription." This is Financial Domain copy — the exact place a certification audit should be strictest. **Major.**
- "Booking" vs "Reservation" — same action, both used ("Book spot" button → "Booking confirmed" toast → "✓ Reserved" state → "MY RESERVATIONS" section header). Lower-severity synonym drift, same root cause. Minor.
- "PR"/"Personal Record" and "Benchmark" are used consistently with no leakage of internal terms.

## 8. Translation Audit

- **Key parity is genuinely solid**: 981 keys on each of RO/EN, 0 missing either direction, 0 duplicates (programmatically diffed). A dev-only proxy renders a visible `⚠️MISSING:key⚠️` marker for any accessed-but-undefined key — a real live guard against regression. ~16/981 keys (1.6%) are defined but never referenced — harmless, Polish.
- **A real, confirmed regression exists in the newest code, exactly where the audit's own hypothesis predicted it would**: `PerformanceOverviewPanel` (`App.jsx:4497-4529`) — the Results Phase 2 Slice 5 analytics summary rendered unconditionally at the top of the PR tab for every member — **does not accept a `t`/`lang` prop at all** and renders hardcoded Romanian literals ('WOD-uri logate', 'Benchmark-uri', 'PR-uri totale', 'PR-uri (30z)', 'Trend:') directly in JSX. `src/performanceAnalytics.js:33-44`'s `formatTrendLabel()` has a Romanian-only lookup table with no English variant. `src/performanceProgression.js:26-47`'s `formatProgressionNote()` returns hardcoded Romanian ("runde", "PR nou", "vs data trecuta") — called from `JurnalList`, which is otherwise correctly `t`-threaded for everything else on that same screen. **An English-language member sees Romanian text on two primary-nav tabs (PR, Log).** This is isolated to exactly the two Slice 4/5 analytics helper files — `benchmarkDetail`, also newly added, is correctly translated — so the gap is narrow and specific, not systemic. **Major.**

## 9. Empty State Audit

Every screen sampled across both apps answers "what is this" (via its title) but coverage of "why is it empty / what do I do next" is inconsistent:
- Admin's shared `dashboard/components/EmptyState.tsx` is well-formed but confined to the dashboard module; other modules' locally-duplicated empty states are visually fine but text-only, no consistent "what to do next" CTA pattern across all of them.
- PWA: `jurnalEmpty`/`prEmpty`/`benchmarkDetailEmpty` are single-line, descriptive-only, no next-action copy; `clasamentEmptySubtitle`/`feedEmpty` do include a "be the first" nudge. Inconsistent depth, low practical impact since add-buttons are visible on the same screens regardless. Minor.
- `PerformanceOverviewPanel` (PWA) returns `null` entirely on fetch failure or missing summary row (`App.jsx:4507` — `if (!summary) return null`) — a genuinely silent empty state with zero explanation, on a panel now unconditionally mounted for every member. Minor-Major (silent, but low-stakes content).

## 10. Error-State Audit

- **forge-admin-web has a real per-route error boundary** (`RouteErrorBoundary.tsx:18-53`) scoped so a crash doesn't take down the whole shell — but `componentDidCatch` only calls `console.error`; nothing is reported anywhere (see §16, no Sentry). A production crash is invisible to the team unless a user reports it.
- WOD-SIMPLE has a real `Sentry.ErrorBoundary` with a styled user-facing fallback (`main.jsx:64-73,219`) and `captureConsoleIntegration`, so console errors are actually captured — genuinely stronger than Admin's equivalent.
- **Live production error telemetry (Sentry, live-verified, 91 unresolved issues, last-14-days)** — this is the most concrete evidence this audit could gather, and it should weigh heavily on the verdict:

| Count | Issue | Culprit | Last seen |
|---|---|---|---|
| 2000 | `activateQueuedSubscription error: [object Object]` | production frontend | 2026-08-04 |
| 1542 | `Error: order not paid` | `Ub(src/App)` | 2026-08-04 |
| 418 | `TypeError: Load failed (supabase.co)` | Sentry/Supabase integration | **2026-08-06 (today)** |
| 245 | `Error: order not paid` | `async activateQueuedSubscription` | 2026-07-22 |
| 156 | **`ReferenceError: postTransferPanel is not defined`** | `Xb(src/App)` | 2026-07-29 |
| 110/104/103/64/29 | `TypeError: Failed to fetch (supabase.co)` | multiple call sites | **2026-08-06 (today)** |
| 65 | `TypeError: Load failed (supabase.co)` | `@supabase/auth-js` fetch | **2026-08-06 (today)** |
| 47 | `TypeError: Cannot read properties of null (reading 'gym_id')` | `Xi(src/App)` | 2026-07-15 |
| 37/35 | Service worker load/update failures | production | 2026-08-03/06 |
| 30/29/24 | **`Error: stack depth limit exceeded`** (`fetchRezervari`/`fetchWaitlistMea`/`recalcFeedUnread`) | async fetch functions | 2026-07-14 |
| 20 | `Error: permission denied for table gyms` | `qa(src/App)` | 2026-07-15 |

Three of these deserve explicit attention beyond raw count:
1. **`ReferenceError: postTransferPanel is not defined` (156 occurrences)** is a genuine, currently-live JavaScript bug — a broken code path, not a transient network blip, likely related to the Gym Transfer (M7) feature.
2. **"stack depth limit exceeded" is a Postgres error message, not a JS one** — its appearance in three unrelated client functions (`fetchRezervari`, `fetchWaitlistMea`, `recalcFeedUnread`) suggests a server-side recursive query/RLS policy issue, not three independent client bugs. This is exactly the class of bug the project's own memory already documents finding once before ("recursie SECURITY DEFINER" in RLS work) — worth checking whether this is that same class of issue recurring elsewhere.
3. **"order not paid" + "activateQueuedSubscription error" together account for ~3,800 of the ~91 issues' combined volume** — by far the highest-frequency errors in the whole system, in the Financial/Membership activation path, still occurring as of the most recent deploy. Combined with §15's finding that renewal has no UI at all, this paints a consistent picture: **the subscription lifecycle (activate → renew) is the weakest-tested part of the live product**, not an isolated gap.

**forge-admin-web has zero equivalent visibility** — no Sentry, no error aggregation of any kind, confirmed by an empty grep for `@sentry`/`Sentry.init` across the entire repo and its `package.json`. Whatever the Admin-side error rate actually is today, **nobody at Forge can currently see it.**

## 11. Responsive Audit

**forge-admin-web is effectively desktop-only, confirmed, not merely assumed**: grepping every responsive Tailwind prefix (`sm:`/`md:`/`lg:`/`xl:`) across all ~65 non-test feature files returns **6 total occurrences across 5 files**. Members, Subscriptions, Plans, ClassesList, and all of Programming's editor components (`ProgrammingCalendar`, `EditWorkoutDialog`, `FormatConfigEditor`, `SectionEditor`) have **zero** responsive classes; `ProgrammingCalendar.tsx:30,37` hard-codes `grid-cols-7` with no mobile collapse. **Major** — if this is intentional (Admin used at a desk), it should be a stated product decision, not an artifact nobody verified; if not intentional, it's a real gap.

Within that context, two specific findings matter more than the overall pattern:
- **`AttendanceList.tsx`'s check-in roster table has no `overflow-*` wrapper at all** — and this is, by the product's own description, the single screen most likely to be opened on a phone at the gym floor mid-class. It will force page-level horizontal scroll or visually break on a narrow viewport. **Major.**
- `PersonalRecordsView.tsx:57` wraps its table in `overflow-hidden` rather than `overflow-auto` — on a narrow viewport this **clips columns instead of allowing scroll**, actively hiding data rather than just looking unpolished. **Minor-Major.**

Six other tables (`PlansList`, `SubscriptionsList`, `MembersList`, `MemberDetails`, `ClassesList`, `ClassDetails`) do correctly wrap in `overflow-auto`. Dialogs are width-safe (`w-full` + overlay padding) but most lack height/scroll handling on short viewports (§5).

**WOD-SIMPLE (PWA)**: no mobile-first concerns found — the newest Results screens (`pr`, `benchmarkDetail`, `PerformanceOverviewPanel`) all use flex/grid/percentage layouts with no fixed pixel widths beyond two harmless logo images. The PWA is consistently mobile-first, as expected for its purpose.

## 12. Permission & Security Audit

- **No route-level or nav-level role gating exists for the Coach role.** `ProtectedRoute.tsx:11-26` grants `authorized` status to any admin *or* coach with no further per-route check; `App.tsx:30-72` wraps every route in the same single `ProtectedRoute`; `Sidebar.tsx:23-40` renders `NAV_ITEMS` unconditionally with no role filter. Of 18 files consuming `useAuth()`, exactly one component (`MemberDetails.tsx:39,159`) reads `isAdmin` for a UI decision (hiding the "Remove Member" button). Coach and Admin are, at the UI layer, the same user.
- **This is materially mitigated by RLS, verified live, not assumed**: `subscriptions` and `subscription_plans` INSERT/UPDATE/DELETE policies both require `is_admin(gym_id)` **(live-verified)** — a Coach's write attempt through the UI would be rejected server-side. The `subscriptions` SELECT policy (`is_admin(gym_id) OR own-email-match OR recent-booking/waitlist-proximity`) **(live-verified)** does **not** include a plain "any gym staff" branch, meaning a Coach opening `/subscriptions` would see an **empty list**, not other members' financial data — not a leak, but a confusing, unexplained empty screen with no messaging about *why* it's empty. **Net reclassification: this is a Major UX/trust defect (a Coach sees fully-enabled Subscriptions/Plans/Payments/Settings UI that either silently fails or silently shows nothing), not a Critical security breach** — but it should still be fixed before external gyms provision their own Coach accounts, since "the UI lies about what you can do" is exactly the kind of thing that erodes trust fast.
- Numerous detail/mutation functions across `plans/api.ts`, `subscriptions/api.ts`, `members/api.ts`, `attendance/api.ts`, `classes/api.ts` filter by row `id` only with no client-side `gym_id` check, relying entirely on RLS as the sole isolation boundary (standard defense-in-depth gap, not confirmed exploitable — flagged for awareness, consistent with this project's own standing memory that migration files don't always reflect live RLS state).
- Destructive member-removal (`admin-remove-member` Edge Function) independently re-checks admin role server-side — genuine defense-in-depth done correctly.
- **`profile.gym_id === null` (or a missing profile row) produces an infinite, unlabeled "Loading…" spinner** across at least 10 Admin screens (`MembersList`, `SubscriptionsList`, `PlansList`, `ClassesList`, `AttendanceList`, `ProgrammingCalendar`, `ClassDetails`, `WaiverSettings`, `TodayCommandCenter`, `PerformanceCommandCenter`) — every one follows the identical `if (!gymId) return` guard before ever setting an error/empty status. A real, reachable state (any staging inconsistency between `admins`/`coaches` and `profiles.gym_id`) with zero recovery messaging anywhere. **Major.**
- **No client-side awareness of gym-level trial/access blocking was found anywhere in forge-admin-web** — if `is_gym_access_blocked()` is ever toggled on (currently off platform-wide per code inspection of the M10.8 migration), a blocked gym's Admin staff would hit the generic error/empty/infinite-loading states above rather than a clear "your trial ended, contact support" message. Major, currently latent (enforcement flag is off).
- Session-expiry and network-failure-during-auth-check are both handled well, with clear user-facing messaging and a retry action — genuine strength.

## 13. Realtime Audit

Live publication membership was re-verified directly **(live-verified)**: `bookings`, `class_waitlist`, `classes`, `profiles`, `skill_logs`, `subscription_plans`, `subscriptions`, `wod_logs`, `wods`, plus platform tables (`gyms`, `gym_waivers`, `admin_audit_log`, etc.) **are** in `supabase_realtime`. `pr_events` and `performance_identities` are **not** — confirming the finding already established during Dashboard Phase 1/2.

- forge-admin-web's `useRealtimeSync` (15 call sites, real exponential-backoff reconnect logic, `src/lib/realtime.ts:139-166`) correctly avoids subscribing to `pr_events`/`performance_identities` everywhere. One genuine gap found and live-confirmed: **`AthleteResultsPage.tsx:27-33` subscribes to `personal_records`, which is not in the publication** — this channel subscribes successfully and will silently never fire. **Major** (a coach watching an athlete's PR page live will not see it update without a manual refresh).
- `WaiverSettings.tsx` has no realtime subscription at all — static until reload. Minor, low-frequency data.
- **WOD-SIMPLE's realtime has no reconnect/backoff logic at all, confirmed by code, not inferred**: all three `.channel().on().subscribe()` calls in `App.jsx:5731-5799` call bare `.subscribe()` with zero status callback, zero handling of `CHANNEL_ERROR`/`TIMED_OUT`. If a member's socket drops (backgrounded tab, phone sleep/wake, network blip — the normal operating condition for a phone at a gym), there is no code path to detect or recover it; the app silently stops receiving live updates until a full remount. Two specific polling fallbacks exist (8s bookings poll, 15s feed poll) but cover only those two things — `wods`, `profiles`, `wod_logs`, `skill_logs`, `class_waitlist`, `app_settings`, `gyms` have zero fallback of any kind. **Major**, and this is the single most consequential platform-consistency gap found in this audit's realtime section, since Admin already solved this problem and the PWA (the client actually used on unreliable mobile networks) did not inherit the fix.

## 14. Performance Audit

- **No N+1 patterns found anywhere in forge-admin-web** — every list-of-related-rows fetch is a single batched query joined client-side. Genuine strength.
- **No refetch-loop risk found** — every `useEffect` dependency array across the app uses primitives or properly-memoized values; zero object/array literals in dependency arrays.
- Results' own query caps (`WORKOUT_HISTORY_LIMIT`, `PERSONAL_RECORDS_LIMIT`, `LEADERBOARD_LIMIT`, etc.) hold as the established baseline. A small number of narrow-column, low-risk queries remain unbounded (`fetchRosterContext`, `fetchCoachOptions`, `fetchLogsForWod`) — same category of issue already fixed once in Results Phase 1.1, left open in a few newer spots. Minor, worth a follow-up pass, not urgent at current data volumes.
- **The Dashboard route (`/`) costs roughly 30 sequential Supabase round trips across ~5 dependency-gated waves to reach first meaningful paint** — `TodayCommandCenter`'s own load function is a 6-call `Promise.all` where one of those 6 calls is *itself* another 6-call `Promise.all`, chained after by 3 more sequential waves (waitlist/logs → benchmark resolution → progress summary → member names); `PerformanceCommandCenter` adds a further 2-wave, 10-call sequence in parallel. No individual query is slow, but the **critical path depth** (5+ sequential network round-trips before the page is fully populated) will be clearly felt on any connection with real latency (mobile data, an overseas gym, a bad Wi-Fi day) — and this is the page every owner/coach opens first, multiple times a day, by the mission's own description. **Major**, and a genuinely new finding not previously flagged in any Phase report.
- Known, already-disclosed baseline unaffected by this audit: forge-admin-web ships as a single ~709KB JS chunk; code-splitting remains a deliberately deferred, separately-tracked item.

## 15. Workflow Audit

**Owner** (traced end to end through real files/routes):
1. `/` → Dashboard, Today + Performance sections — works, but see §14 for load cost.
2. Today's operations → 2 clicks to any class via `ClassTimelineRow`. Works.
3. Attendance for a specific class → `NextClassCard` links to generic `/attendance` (no class-scoped deep link), but `AttendanceList` pre-expands today's rosters by default, so the target class is already visible with no re-search. Minor friction, not a real gap.
4. A specific athlete's results → Members → Member detail → Progress tab. Direct, 2 clicks. Works.
5. **Renew or extend a member's subscription → does not exist.** `SubscriptionDetails.tsx:12` lists a "Renewals" tab; every non-Overview tab (including it) falls through to `<PlaceholderPage title={section} />` (lines 175-178). A full read of `subscriptions/api.ts` confirms it contains **only fetch functions** — no `createSubscription`, no `renewSubscription`, no subscription insert/update path anywhere in forge-admin-web. **This is the terminal step of the most basic recurring owner workflow, and it dead-ends at a stub screen. Critical.**

**Coach**: identical path to Owner for next-class/attendance/athlete-progression/benchmark-check (no gating means no detour, ironically) — all four steps traced and confirmed direct, including the benchmark indicator already rendered inline on the Dashboard's Today's Workout card. One real gap: `ClassDetails.tsx`'s own booking table is read-only with no check-in toggle and no forward link into Attendance for that same class — a coach who reaches a class via its own detail page (rather than the Dashboard shortcut) must manually re-find it in the separate Attendance module. Minor.

**Member** (PWA): all four traced steps (today's workout → log result → progress/PR history → repeated-workout comparison) are directly supported with no dead ends. The Journal's inline "vs last time" progression note means the repeated-workout comparison surfaces automatically after logging, not as a separate lookup — a genuinely good piece of UX. The only soft gap: "how did I do last time" is only visible retroactively (after logging), not while the workout is in progress that day.

## 16. Operational Readiness Audit

- **Build configuration is clean in both repos** — TypeScript errors fail the Admin build (not ignored), Vite configs are unremarkable, `vercel.json` in both repos is a minimal SPA rewrite with nothing unusual.
- **forge-admin-web has a tracked, accurate `.env.example`.** **WOD-SIMPLE has none** — the actual runtime requires at least 8 undocumented variables beyond Supabase (Sentry DSN/tokens, VAPID push keys, Brevo email API key) that only exist as tribal knowledge in source code (`supabase/functions/check-subscriptions/index.ts:4-9`). This directly compounds the already-open P0-005 incident (that same function's secret-key rejection from the Supabase gateway) — nobody rebuilding this environment from scratch today has a canonical list of what it needs. **Major.**
- Dependency versions (React 19.2, Vite 8, Tailwind 4, Supabase JS 2.10x) are current and consistent across both repos — no stale/deprecated majors found.
- **196 migrations in WOD-SIMPLE/supabase/migrations/**, consistently timestamp-named, no evidence of conflicting/duplicate-purpose files — heavy same-day churn on complex features reads as genuine iterative hardening (each file's own header documents why), not disorganization. The standing, previously-established risk remains real and unresolved: **migration files in this repo do not reliably reflect live DB state** — any future disaster-recovery or fresh-environment rebuild must verify against live state first, not trust `supabase db push` from this folder alone.
- **Error monitoring is asymmetric across the platform**: WOD-SIMPLE has real Sentry coverage (init, console-capture, error boundary with a styled fallback). **forge-admin-web has none — zero `@sentry/*` dependency, zero `Sentry.init` calls anywhere.** Its own `RouteErrorBoundary` catches render crashes but only `console.error`s them — invisible in production. Given Admin is the tool gym staff use to run billing, memberships, and classes, this is the more operationally consequential of the two apps to have unmonitored. **Major.**
- **A real, atomic, self-service gym-signup path exists** (`bootstrap_owner_gym` RPC, one transaction, idempotent, 14-day trial) — but it's WOD-SIMPLE that owns it, not forge-admin-web; a new owner's very first action happens on the member app, not the admin tool. Trial-expiry enforcement (`is_gym_access_blocked`) is fully wired end-to-end but **deliberately shipped disabled platform-wide** (an explicit, documented staged-rollout decision, not a bug) — worth the certifier knowing this is currently inert.
- Admin's own empty-state coverage (13+ feature areas with matching tests) suggests a brand-new tenant's screens degrade gracefully rather than assuming pre-existing data — a genuine strength for onboarding, even without a guided first-run checklist.
- No custom backup scripts exist in either repo (expected — relies on Supabase's own PITR, standard for this stack, not itself a finding).
- **Two independent, unmerged gym-suspension mechanisms exist** — the new trial-clock-driven one (currently off) and a separate, pre-existing, platform-admin-managed `gyms.is_active`/`paid_until` mechanism (currently the one actually doing enforcement work). Functional today, but a real source of future confusion for whoever next touches gym-access logic. Minor.
- P0-005 (`check-subscriptions` Edge Function, subscription-expiry notifications) is confirmed present in code and confirmed as an already-known, still-open incident — not newly discovered here, but re-flagged as still relevant to launch readiness since it directly affects whether expiring memberships get any automated notification at all today.

## 16a. Inherited Financial/Billing Engine Findings (2026-08-03 audit — carried forward, not re-verified this pass)

The predecessor certification (archived at `WOD-SIMPLE/docs/architecture/FORGE_V1_CERTIFICATION_REPORT_2026-08-03_BILLING_ENGINE.md`) audited the Platform Billing engine specifically — how Forge itself charges a gym owner for using the platform (distinct from §15's finding, which is how a gym charges *its own members*). Its verdict was **PRODUCTION BLOCKED** on four grounds, none of which this session independently re-tested (this session neither attempted a real Stripe purchase nor inspected live webhook delivery, consistent with this project's own standing prohibition on executing real financial transactions):

1. **The Platform Billing webhook has no real Stripe endpoint registered against it.** The signing secret in use was self-generated for a synthetic test event, never connected to a real Stripe account. A real Checkout completion today would produce a real charge on Stripe's side and nothing on Forge's — the subscription would stay `pending_payment` forever, silently.
2. **No code path exists anywhere that can produce a second Payment for an already-converted gym.** Stripe Checkout Sessions are created in one-time-charge mode (`mode: 'payment'`) by deliberate design, on the premise that Forge's own scheduled jobs would drive renewal — but that job (M10.7) was never built. The commercial model this system is meant to run (recurring monthly billing) cannot currently recur.
3. **A cancelled Platform Subscription never blocks product access.** The Cancel button is live, reachable, and does nothing to actual access — the opposite of the paywall's own documented promise.
4. **The entire Owner-facing billing UI (Buy CTA, Stripe redirect, plan-change, cancel flow, trial-expired paywall) has been verified only by mocked component tests, never by a human clicking through it in a real browser against the real, deployed Edge Functions.**

Secondary findings from that audit, also unverified since: audit-trail gaps for gym-bootstrap and admin-invitation events (`admin_audit_log`), no monitoring on any financially-critical code path (webhook failures, stuck payments, cron health), no support/impersonation tooling for troubleshooting a confused paying customer, and a recurring pattern (found 4 separate times in that audit) of a new table/function shipping with an unintended default `anon`/`PUBLIC` grant, caught only by manual review each time — i.e. no automated CI gate exists against that specific bug class.

**Why this belongs in this report rather than staying a separate document**: §15 of this audit independently found, from the opposite direction and via a different codebase (forge-admin-web, not the Stripe/webhook layer), that the subscription lifecycle has no write path at all in the Admin UI. Both audits, run days apart by different investigative approaches, converge on the same conclusion: **the subscription/billing lifecycle — on both the platform-to-gym and gym-to-member sides — is the least-verified, least-complete part of an otherwise solid platform.** That convergence is itself evidence, not coincidence.

## 17. Launch Readiness Assessment

| Severity | Definition | Count found |
|---|---|---|
| **Critical** | Blocks external beta | 5 (1 this session + 4 inherited from §16a, carried forward not re-verified) |
| **Major** | Significantly damages trust or usability | 17 |
| **Minor** | Noticeable but acceptable | 14 |
| **Polish** | Improves perceived quality | 6 |

**Beta readiness: Not ready.** Even setting the inherited §16a findings aside entirely, this session's own Critical finding (§15 — no subscription renewal path in forge-admin-web) is disqualifying for a paying/beta gym on its own. Including §16a, the case is stronger still: a beta gym's *own* subscription-renewal workflow is unbuilt, and *Forge's own ability to charge that gym* has never processed a real payment. Recommend the inherited §16a items be re-verified live (register a real Stripe webhook, attempt one real test-mode purchase end-to-end) as the very first step of acting on this report, since their true current status directly determines how large the total Critical list actually is.

**Launch readiness: Further out than Beta.** Beyond the Critical fixes, launch readiness additionally requires closing the monitoring gap (§10/§16 — you cannot responsibly onboard external customers, paying or not, into a system you can't see errors from, on either the product or the billing side) and addressing the live, currently-recurring production error volume already visible in Sentry (§10) — some of which (the `ReferenceError`, the Postgres recursion errors, the ~3,800 combined subscription-activation/payment errors) look like real, fixable bugs already affecting the existing live gym today, not hypothetical future risk, and plausibly connect directly to the inherited §16a webhook/renewal gaps.

**Production confidence today**: **High for the core operational domains** (Classes, Attendance, Programming, Results/Performance/Dashboard) — these are well-tested, internally consistent, and show no structural red flags. **Low for the Financial/Membership/Billing lifecycle specifically, on every side of it that was checked** — gym-to-member renewal (§15), platform-to-gym billing (§16a), and the highest-volume live error signal in the whole system (§10) all point at the same place. This is the platform's actual weakest point today, and it happens to be the part every external gym owner will touch first when they think about *paying* for the product.

## 18. Prioritized Action List

**P0 — blocks certification:**
1. Build the subscription renewal/extension workflow in forge-admin-web (§15). This is a real, bounded feature gap, not a redesign — the read side (`SubscriptionDetails`, `subscriptions/api.ts`) already exists; the write side does not.
2. Wire Sentry (or equivalent) into forge-admin-web, matching WOD-SIMPLE's existing pattern (§10, §16) — this is the fastest, cheapest fix on this entire list and directly unblocks safely monitoring everything else post-launch.
3. Triage the live Sentry backlog on WOD-SIMPLE, specifically: the `postTransferPanel` `ReferenceError` (§10), the three "stack depth limit exceeded" Postgres recursion errors (§10 — worth checking against the platform's own prior RLS-recursion bug class), and the ~3,800 combined "order not paid"/`activateQueuedSubscription` errors (§10) given their direct overlap with Finding #1 and #4.
4. **Re-verify §16a live, first, before anything else on this list**: register a real Stripe webhook endpoint and confirm the signing secret, then run one real reconciled test-mode purchase end-to-end. This determines whether items 5–7 below are still open or already fixed since 2026-08-03 — the rest of this list should not be re-prioritized until this is known.
5. If still open per item 4: build a real renewal mechanism for Platform Subscriptions (Forge charging the gym) — the counterpart, one layer up, to item 1.
6. If still open per item 4: implement cancellation-access-enforcement so a cancelled Platform Subscription actually blocks product access, matching the paywall's own documented promise.
7. Have a human being click through the entire Owner-facing billing UI in a real browser at least once, end to end, regardless of items 4–6's outcome.

**P1 — required before external beta:**
8. Gate the Coach role at the route/nav level in forge-admin-web to match its actual RLS-enforced permissions (§12) — the UI should not offer controls a Coach cannot use, even though RLS currently prevents real harm.
9. Fix `personal_records` realtime (either add it to the publication or remove the dead subscription) (§13).
10. Add reconnect/backoff to WOD-SIMPLE's realtime subscriptions, mirroring Admin's existing `useRealtimeSync` pattern (§13).
11. Fix the hardcoded-Romanian regression in `PerformanceOverviewPanel`/`performanceAnalytics.js`/`performanceProgression.js` (§8).
12. Add horizontal-scroll handling to `AttendanceList`'s roster table and fix `PersonalRecordsView`'s `overflow-hidden` clipping (§11).
13. Handle the `profile.gym_id === null` state with a real error message instead of an infinite spinner, across all 10 affected screens (§12).
14. Reconcile "Membership" vs "Subscription" copy in WOD-SIMPLE's commerce flow to one term (§7).
15. Reduce the Dashboard's initial round-trip count / parallelize its dependency waves (§14).

**P2 — should fix before general launch:**
16. Unify the Dashboard module's color tokens with the rest of the app's palette (§6).
17. Link athlete names on Leaderboard/roster/booking tables to their Member profile (§3).
18. Distinguish built vs. not-built modules in the sidebar (Payments/Reports/Staff) (§3/§4).
19. Consolidate the duplicated Loading/Empty state implementations into the existing shared `dashboard/components/{LoadingState,EmptyState}` primitives, generalized for app-wide use (§5).
20. Document WOD-SIMPLE's required environment variables (§16) — directly unblocks re-investigating P0-005.
21. Add client-side messaging for a trial-blocked/deactivated gym, even while the flag is off, so it's ready when enabled (§12).
22. Close the §16a secondary gaps: audit-trail completeness for gym-bootstrap/admin-invitation events, monitoring on financially-critical code paths, and a CI gate against the recurring unintended-`anon`/`PUBLIC`-grant bug class.

**P3 — polish backlog:** heading-hierarchy cleanup (WaiverSettings' duplicate `<h1>`, Dashboard/Leaderboard's redundant `<h2>`), dialog max-height/scroll for non-`xl` dialogs, "has WOD"/"has a workout" accessible-name mismatch, standardize page-wrapper `gap-*` values, cap the remaining unbounded narrow queries, merge the two independent gym-suspension mechanisms' documentation.

## 19. Estimated Effort

*(Rough, directional — not a committed estimate; assumes one focused engineer familiar with this codebase's own established patterns, per file, not per finding.)*

| Item | Estimate |
|---|---|
| P0-1: Subscription renewal workflow (Admin, gym→member) | 3–5 days (UI + write API + tests, reusing existing read-side patterns) |
| P0-2: Wire Sentry into Admin | 0.5 day |
| P0-3: Triage live Sentry backlog | 2–4 days (investigation-heavy; the recursion bugs may be a shared root cause) |
| P0-4: Live re-verification of §16a (Stripe webhook + one real test purchase) | 0.5–1 day — do this first, it determines the true size of P0-5/6 |
| P0-5/6: Platform renewal + cancellation-enforcement (Forge→gym), *if still needed per P0-4* | 4–7 days |
| P0-7: Human QA pass on the Owner billing UI | 0.5 day |
| P1 items (8–15), combined | 6–9 days |
| P2 items (16–22), combined | 5–7 days |
| P3 polish backlog | 2–3 days |
| **Total to Beta-ready (P0 only)** | **~2–3 weeks** (dominated by the §16a Platform Billing gaps, if confirmed still open) |
| **Total to Launch-ready (P0+P1)** | **~4–6 weeks** |

## 20. Recommendation

Start by live-verifying §16a (P0-4) — it's a half-day task that determines whether this report's own P0 list is 7 items or effectively 3, since items 5–7 may already be moot if the Stripe webhook was quietly connected since 2026-08-03. Then fix the remaining P0 list, re-run Sections 10 (Error-State), 15 (Workflow), and 16a of this audit specifically against the fix, and re-certify. Everything else on this list is real but does not need to gate a first external beta cohort with a small, forgiving group of gyms — it does need to gate a public launch. Do not treat this report as validation to redesign anything it didn't flag: the core domains (Classes, Attendance, Programming, Results, Performance/Today Dashboards) are genuinely solid and should be left alone.

---

**NOT YET CERTIFIED**
