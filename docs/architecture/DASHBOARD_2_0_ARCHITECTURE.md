# Forge Dashboard 2.0 — Command Center (Architecture & Implementation Plan)

Status: Proposed for Freeze. Planning only — no UI, no new tables, no new client code in this document. Every recommendation is grounded in a direct audit of what actually exists in production today (Section 6 names, per widget, exactly which existing service backs it and which require new work).

## 1. Executive Summary

Dashboard 2.0 is the single screen an owner, head coach, manager, or future multi-gym operator opens first. Its job is to compress "what's happening in my gym" into 5-10 seconds of scanning, then hand off to the existing detail screens (Attendance, Members, Subscriptions, Athlete Results, Leaderboard, Programming) for anything that needs a closer look or an action.

The core finding of this planning pass, established by direct audit (not assumption): **Results Phase 2 already has a complete, real, tested analytics layer** (9 canonical services, Slice 5) ready to power the entire Performance and most of the Coaching section today, with zero new backend work. **Every other domain — Attendance, Classes, Membership, Financial — has real base tables with the right columns, but zero summary-level services.** Every existing function in those four domains is a list, a detail fetch, or a mutation (`fetchClassesInRange`, `fetchSubscriptionsPage`, `setCheckedIn`, `addMember`, ...) — none of them answer "how many," "which ones," or "compared to when." This is not a Dashboard problem to solve inside a component; it is Section 15's own first, mandatory phase: build the missing summary services, in the domains that own them, before writing a single widget.

The one true gap with no existing computation logic anywhere is revenue/MRR: `orders` and `payments` (the Financial Domain's own frozen tables, per `FINANCIAL_DOMAIN_ARCHITECTURE.md`) exist and are correct, but no reporting view, no MRR calculation, and no revenue-snapshot concept has ever been designed, in this repo or WOD-SIMPLE. This is named explicitly, not glossed over, and scoped out of Dashboard 2.0's first shippable version.

## 2. Dashboard Philosophy

Dashboard is a decision surface, not a report. Every widget answers a question that leads to an action, per the mission's own framing:

- **Not**: "Total members: 62" (a fact with no next step).
- **Instead**: "3 members plateaued this week → View athlete activity" (a fact that names who and offers where to go next).

This mirrors a pattern already proven in this codebase: Attendance Phase 3's own coach workflow (`AttendanceList.tsx`) doesn't just show a roster, it surfaces No-Shows and lets a coach act on them inline. Dashboard 2.0 applies the same principle at the whole-gym level instead of one class at a time.

Vanity metrics (total lifetime members, total workouts ever logged) are excluded unless paired with a trend or a comparison that makes them actionable ("62 active members, +4 this month" is fine; "62 active members" alone is not).

## 3. User Personas

| Persona | Primary question | Primary section |
|---|---|---|
| **Gym Owner** (single gym) | Is the business healthy? Is programming working? | Business, then Performance |
| **Head Coach** | Who needs my attention today and this week? | Coaching, then Today |
| **Manager** (front desk / operations) | What's happening right now? | Today |
| **Future multi-gym operator** | Which of my gyms needs attention? | Out of scope for this version — Dashboard 2.0 is single-gym (`gym_id`-scoped, matching every existing view in this platform); a multi-gym rollup is a named future extension (Section 15), not designed here |

## 4. Information Hierarchy

Per the mission's own required order, and matching how the layout (Section 5) is structured top-to-bottom:

1. **What needs attention right now?** → Coaching alerts + Today's operational facts (hero row)
2. **What changed recently?** → Performance section's own recent-activity widgets (PRs this week, repeated workouts this week)
3. **Who is improving?** → Performance section's own athlete-level widgets (most improved, rapidly improving, plateauing)
4. **Is the gym healthy?** → Business section
5. **Is programming working?** → Performance section's own workout/benchmark-level widgets (strongest movement trend, most effective workout, benchmark activity)

## 5. Layout System

**Desktop (≥1280px)**: 4-column CSS grid, no vertical scroll for the hero + secondary rows (the "5-10 second" requirement is a layout constraint, not just a data one — if a widget needs scrolling to read its own number, it has failed). Below that, the Operational/Performance/Business/Coaching rows scroll normally; they are the "look deeper" content, not the glance content.

**Tablet (768-1279px)**: 2-column grid, same row grouping, hero row's 4 cards become 2×2.

**Mobile (<768px)**: prioritized vertical stack, per the mission's own instruction — not a naive reflow of the desktop grid. Order: hero row first (as 4 stacked cards), then Coaching alerts (the single most action-oriented section), then Today, then Performance, then Business. This ordering is a deliberate product decision (coaches are the most frequent mobile users of this screen, mid-class, between clients) and should be validated with the user before Phase 1 ships, not treated as settled by this document alone.

**Row assignment**:

| Row | Widgets | Rationale |
|---|---|---|
| Hero | PRs this week, Athletes improving, Classes today, Members needing attention (count only) | The 4 numbers that answer "attention/change/improving/health" fastest |
| Secondary | Next class, Live check-ins, Recent PR activity (feed), Attendance today | Today's operational detail |
| Operational | Trials scheduled, No-shows today, Expiring memberships | Time-sensitive but not glance-critical |
| Performance | Most improved athletes, Repeated workouts this week, Benchmark activity, Strength/Conditioning trend | Results Slice 5, 100% ready |
| Business | Active members, New members, Attendance trend, Membership trend | Membership Domain, needs new summary services |
| Coaching | Members without recent PRs, Low-attendance athletes, Plateau alerts, Classes with low participation | Mixed readiness — see Section 10 |

## 6. Widget Catalog

Every widget below follows the mission's own required shape (title, primary metric, trend indicator, comparison period, action target). The **Source** column is the load-bearing fact this document adds: it states plainly whether the widget is backed by something that exists in production today, or requires new backend work first — no widget in this catalog is placeholder, and none invents a metric with no defined computation.

| Widget | Metric | Comparison | Action target | Source |
|---|---|---|---|---|
| PRs this week | `gym_performance_summary.prs_this_week` | vs prior 7d (needs a 2nd call with a date-shifted window — see Section 13) | Recent PR Activity feed | ✅ Existing (`getGymPerformanceSummary`) |
| Athletes improving | `gym_performance_summary.athletes_improving` | vs `athletes_plateauing`/`athletes_declining` (same row) | Top Improving Athletes | ✅ Existing |
| Most improved athletes | `getTopImprovingAthletes(gymId)` | — | Athlete Results | ✅ Existing |
| Athletes plateauing | `athlete_performance_summary` filtered `current_performance_trend='plateau'` | — | Coaching section | ✅ Existing (needs a new thin list query, same view) |
| Repeated workouts this week | `getRepeatedWorkoutInsights(gymId)`, filtered to `latest_attempt_at` in the last 7 days | — | Workout Progress detail | ✅ Existing (client-side date filter over an existing list) |
| Average improvement | `gym_performance_summary.average_athlete_improvement` | — | Performance detail | ✅ Existing |
| Benchmark activity | `getBenchmarkProgressSummary`/`benchmark_progress_summary`, most-attempted this week | — | Benchmark Detail | ✅ Existing |
| Strength / Conditioning trend | `gym_performance_summary.strength_trend_pct` / `.conditioning_trend_pct` | — | Performance detail | ✅ Existing |
| Recent PR activity (feed) | `getRecentPRActivity(gymId)` | — | Athlete Results | ✅ Existing |
| Classes today | count of `classes` where `date = today AND gym_id = gymId` | vs yesterday's count | Classes list | 🔶 New (trivial — one COUNT over an existing, correctly-shaped table, matching `classes.date`/`gym_id`) |
| Next class | `classes` ordered by `start_time`, first row `≥ now()` today | — | Class Detail | 🔶 New (trivial) |
| Attendance today | count of `bookings` where `checked_in = true` and the joined class's `date = today` | vs same weekday last week | Attendance | 🔶 New (needs the `bookings ⋈ classes` join `AttendanceList.tsx` already performs per-class — generalizing it gym-wide is new, small work) |
| Live check-ins | same as above, real-time via `useRealtimeSync` on `bookings` (already an established pattern, Slice 4/5's own `WorkoutHistoryView` reload-token convention) | — | Attendance (today) | 🔶 New (query is small; realtime wiring reuses an existing hook) |
| No-shows today | count of `bookings.no_show = true` for today's classes | vs same weekday last week | Attendance | 🔶 New (trivial, same shape as attendance today) |
| Trials scheduled | requires a "trial" concept — **not confirmed to exist as a distinct booking/subscription state**; needs a Membership Domain audit before this widget can be scoped, not assumed to exist | — | — | ❌ Undesigned — requires Membership Domain research this document does not perform |
| Today's workout | `wods` where `date = today AND gym_id = gymId` | — | Workout Detail (Programming) | ✅ Existing (Programming's own `fetchWodsInRange`-equivalent, a one-row lookup) |
| Active members | count of `subscriptions.is_active = true` | vs last month same count | Members list | 🔶 New (trivial — `subscriptions` already has `is_active`/`gym_id`) |
| New members | count of `subscriptions.start_date` in the current period | vs prior period | Members list | 🔶 New (trivial) |
| Expiring memberships | count of `subscriptions.end_date` within N days, `is_active = true` | — | Subscriptions list (`expiringSoon` filter, which already exists client-side per row — this widget is the missing gym-wide COUNT of that same, already-defined status) | 🔶 New (the per-row status already exists in `subscriptionStatus.ts`; only the aggregate count is missing) |
| Trial conversions | depends on the same undesigned "trial" concept as "Trials scheduled" | — | — | ❌ Undesigned |
| Revenue snapshot / MRR trend | none — `orders`/`payments` exist (Financial Domain, frozen) but **no reporting view, no MRR formula, and no revenue-recognition period logic exists anywhere in this platform** | — | — | ❌ Undesigned — the single largest gap this document found |
| Attendance trend | rolling weekly/monthly attendance count, same shape as "attendance today" generalized over time | — | Attendance | 🔶 New |
| Membership trend | rolling active-member count over time | — | Members list | 🔶 New |
| Members without recent PRs | `athlete_performance_summary` where `last_pr_date` is null or older than N days, gym-wide | — | Athlete Results | ✅ Existing (needs a new thin list query, same view — no new aggregation logic) |
| Low-attendance athletes | requires a per-athlete attendance-frequency computation — **Attendance has no per-member rollup today**, only per-class rosters | — | Attendance | 🔶 New, and structurally the same shape as `athlete_performance_summary` (a new `athlete_attendance_summary`, Attendance's own analytics-foundation equivalent) |
| Plateau alerts | `athlete_performance_summary` where `plateau_indicators > 0`, or `workout_progress_summary` where `trend_distribution.plateau` is large relative to `unique_athletes` | — | Athlete Results / Workout detail | ✅ Existing |
| Classes with low participation | booking count vs `max_spots` per class, below a threshold | — | Class Detail | 🔶 New (trivial — `classes.max_spots` and a booking count already exist) |
| Workouts with low completion | `workout_progress_summary.unique_athletes` relative to active member count, or PR-rate as a completion proxy | — | Workout Progress detail | ✅ Existing, imperfect proxy — a real "completion rate" needs Attendance data, already named as a disclosed gap in every Results Phase 2 Slice 3/4/5 report; this widget reuses that same disclosed limitation rather than inventing a new one |
| Workouts generating the strongest improvement | `getRepeatedWorkoutInsights`, sorted by `avg_improvement_pct` | — | Workout Progress detail | ✅ Existing |

Legend: ✅ existing canonical service, zero new backend work. 🔶 new service required, but straightforward (existing base tables already have the right columns; the work is writing one new `security_invoker` view + a thin typed client function, the exact pattern Results Slice 5 already established twice). ❌ undesigned — needs its own scoping/research pass before any implementation, named here so it is never silently assumed solved.

## 7. Today Section

Purpose: operational awareness, the "walk in and know what's happening" section. Every widget here is time-boxed to the current day, `gym_id`-scoped, matching the pattern every Results view already uses.

Widgets: Classes today, Next class, Attendance today, Live check-ins, No-shows today, Trials scheduled (❌, see Section 6), Today's workout, Recent PRs (today) — the last one is `getRecentPRActivity(gymId)` filtered/limited to today, an existing service, zero new work.

Realtime: `bookings`/`classes` changes should reflect live (mirroring `AttendanceList.tsx`'s own existing realtime wiring and the `useRealtimeSync` hook Results Slice 4/5 already reused for progression data) — Today is the one section where staleness is actually costly (a coach acting on a live check-in count that's 10 minutes old is a real, not cosmetic, problem).

## 8. Performance Section

Purpose: the Performance Engine surface — this section is fully backed by Results Phase 2 Slice 5 today, requiring zero new backend work.

Widgets: PRs this week, PRs this month (`gym_performance_summary.prs_this_month`), Most improved athletes, Athletes improving rapidly (`current_performance_trend='rapidly_improving'`), Athletes plateauing, Repeated workouts this week, Average improvement, Benchmark activity, Strength trend, Conditioning trend.

This is the section to ship first (Section 15) — not because it's most important to the user, but because it's the only section where "Dashboard 2.0 is primarily a UX and visualization project" (the mission's own stated goal) is already true.

## 9. Business Section

Purpose: business health — active/new members, attendance and membership trends, expiring memberships. Revenue/MRR is named here explicitly as **not included in the first shippable version** (Section 6, Section 15) — every other widget in this section needs a new, but straightforward, Membership Domain summary view (`subscriptions`/`profiles` already have every column needed: `is_active`, `start_date`, `end_date`, `gym_id`).

Recommendation: a single new `membership_summary` view (mirroring `gym_performance_summary`'s own shape) covering active/new/expiring counts and the rolling trend data, built once, in the Membership Domain, following the exact same `security_invoker`/gym-scoped/thin-client-wrapper pattern Results Slice 5 already proved twice. This is Section 15 Phase 0's own second deliverable, after Attendance's equivalent.

## 10. Coaching Section

Purpose: intervention surface — where a coach's attention actually changes an outcome. Mixed readiness, disclosed per widget rather than treated uniformly:

- **Members without recent PRs**, **Plateau alerts**, **Workouts generating the strongest improvement** — ✅ fully backed by Results Phase 2 Slice 5 today.
- **Low-attendance athletes** — 🔶 needs a new `athlete_attendance_summary` (Attendance's own Slice-5-equivalent — per-member attendance frequency/recency, a real, scoped, buildable piece of work, not a redesign).
- **Classes with low participation** — 🔶 trivial new aggregate (`classes.max_spots` vs booking count already exist).
- **Workouts with low completion** — ✅ existing, but an honestly-disclosed proxy (PR rate / relative attempt count, not true completion — true completion needs the same Attendance join every Results Phase 2 report has already named as out of domain boundary).

## 11. Navigation Integration

Dashboard becomes the landing route (replacing whatever currently loads first in `App.tsx`'s router — not specified further here, since that is an implementation decision for Phase 1, not an architecture one). Every widget's action target (Section 6's own rightmost column) routes to an *existing* screen — Members, Subscriptions, Attendance, Athlete Results, Leaderboard, Workout Detail, Benchmark Detail, Class Detail. Dashboard introduces zero new destination screens; it is a front door to what already exists, per the mission's own "primarily a UX and visualization project" framing.

## 12. Responsive Strategy

Covered in Section 5 (Layout System) per the mission's own combined "Layout principles" framing — repeated here only to satisfy the requested 17-section structure: the three breakpoints (desktop 4-col / tablet 2-col / mobile stacked) are one system, not three designs, so the row groupings (hero/secondary/operational/performance/business/coaching) stay identical across breakpoints; only column count and stack order change.

## 13. Data Contracts

Every ✅ widget's contract is already frozen by its own Results Phase 2 report (Slice 5's `AthletePerformanceSummary`/`WorkoutProgressSummary`/`BenchmarkProgressSummary`/`GymPerformanceSummary`/`MovementProgressSummary`/`ProgressDistributionRow` TypeScript interfaces, `src/features/results/analytics.ts`) — Dashboard consumes these unchanged, per the mission's own "no duplicated business logic" constraint. This document does not restate those types.

For 🔶 widgets, the contract shape each new service must follow (not implemented here, specified so Phase 0 has an unambiguous target):

```ts
// Example: the Attendance-domain equivalent of gym_performance_summary
interface AttendanceGymSummary {
  gym_id: string
  classes_today: number
  attendance_today: number
  no_shows_today: number
  live_checked_in: number
  attendance_trend_7d: number | null   // % change vs prior 7 days
}

// Example: the Membership-domain equivalent
interface MembershipGymSummary {
  gym_id: string
  active_members: number
  new_members_30d: number
  expiring_within_14d: number
  membership_trend_30d: number | null  // % change vs prior 30 days
}
```

Both mirror `gym_performance_summary`'s own established shape (one row per gym, pre-computed comparison fields, not raw data the client would have to reduce) — the same architectural decision Results Slice 5 already made and validated against real production data.

**Comparison periods** (the mission's own required widget field, "+18% vs last week"): none of the existing Results Slice 5 views currently expose a prior-period comparison value directly — `prs_this_week`/`prs_this_month` are point-in-time counts. Computing "vs last week" requires either (a) a second read of the same view with a date-shifted window (not currently parameterizable — `gym_performance_summary`'s windows are hardcoded to `now()`), or (b) a small, additive extension adding `prs_last_week`/`prs_prior_month` columns. Recommendation: (b), since it keeps the comparison computed once, server-side, identically for every client — consistent with this entire session's own repeated architectural principle (never compute a comparable business fact twice, in two places, that could silently diverge). This is a small, additive migration to an already-shipped, frozen view — not a redesign — and belongs in Section 15 Phase 0.

## 14. Refresh & Realtime Strategy

Three tiers, matching real staleness cost per section (not a uniform policy applied blindly):

- **Today section**: realtime (Postgres changes on `bookings`/`classes`, reusing the exact `useRealtimeSync` hook already proven in Results Slice 4/5 and Attendance Phase 2). Staleness here is directly, visibly wrong ("3 checked in" while a 4th person is standing at the desk).
- **Performance/Coaching sections**: poll-on-mount + manual refresh, matching how `AthleteResultsPage`/`WorkoutHistoryView` already behave (a `reloadToken` bumped on a relevant realtime event, not a raw live subscription on every PR event gym-wide — Slice 3/4/5's own precedent, since a coach doesn't need sub-second PR-count updates, just "not from yesterday").
- **Business section**: refresh on mount only, no realtime. Membership/revenue-shaped numbers change on the scale of days, not seconds; realtime here would be cost without benefit.

## 15. Implementation Phases

**Phase 0 — Backend Foundation (no UI).** Build the missing 🔶 summary services this document names, following the Results Slice 5 pattern exactly (one `security_invoker` Postgres view per domain-summary, one thin typed client wrapper per repo where needed): `attendance_gym_summary` (+ `athlete_attendance_summary` for Coaching's low-attendance widget), `membership_gym_summary`, the small comparison-period extension to `gym_performance_summary` (Section 13). Explicitly excludes revenue/MRR (Section 6, ❌) and the undesigned "trial" concept — both need their own scoping pass, not a Phase 0 side-effect.

**Phase 1 — Performance Section.** 100% backed by existing services today (Section 8) — the first shippable slice of the actual Dashboard UI, and the one that proves the "primarily UX" framing true fastest.

**Phase 2 — Today Section.** Depends on Phase 0's Attendance summary; otherwise straightforward, realtime-wired per Section 14.

**Phase 3 — Coaching Section.** Depends on Phase 0's `athlete_attendance_summary`; the Results-backed widgets (members without recent PRs, plateau alerts) could ship alongside Phase 1 if sequencing needs to move faster.

**Phase 4 — Business Section (partial).** Active/new/expiring member widgets ship once Phase 0's Membership summary exists. Revenue/MRR is explicitly out of this phase — its own research/design pass is a prerequisite, not a Phase 4 task.

**Phase 5 (future, unscoped) — Multi-gym rollup**, revenue/MRR, trial-conversion tracking. Named so they are not forgotten, not designed here.

## 16. Estimated Components

Kept intentionally small — Dashboard 2.0's own value is composition, not novel UI:

- `DashboardPage.tsx` (route + layout grid + section ordering per breakpoint)
- `HeroMetricCard.tsx` (the one reusable widget primitive — title/metric/trend/comparison/action, per Section "Widget principles" — every widget in Section 6 is a configuration of this one component, not a bespoke one)
- `WidgetSection.tsx` (a titled row wrapper — Today/Performance/Business/Coaching)
- `RecentActivityFeed.tsx` (the one non-metric-card widget shape, for Recent PR Activity)
- Data hooks: one per new Phase 0 service (`useAttendanceGymSummary`, `useMembershipGymSummary`), reusing the existing `getGymPerformanceSummary`/etc. from `analytics.ts` directly for everything already covered

Five to seven components total across all phases — not a new large surface area, consistent with "primarily a UX and visualization project."

## 17. Recommendation

Ship in the phase order Section 15 defines, starting with **Phase 0 (backend) immediately followed by Phase 1 (Performance UI)** — this sequencing lets the very first version of Dashboard 2.0 ship with zero placeholder widgets and zero invented metrics, entirely on top of Results Phase 2's own already-proven analytics layer, while Phase 0's remaining Attendance/Membership summaries are built in parallel for Phases 2-4.

Do **not** attempt Business section's revenue/MRR widgets in this milestone. This is the one recommendation in this document that constrains scope rather than sequences it: no existing computation logic, no existing reporting view, and no frozen architectural decision about revenue-recognition periods exists anywhere in this platform today (Section 1, Section 6). Building it inside a Dashboard widget would mean designing a real piece of Financial Domain business logic under UI-project time pressure — exactly the "duplicated business logic calculated independently" failure mode this document's own constraints forbid. It deserves its own scoping pass, the same discipline every other domain gap found this session (Slice 4's Signature V1, Slice 5's `members.gym_id`) was given before being built.

---

**DASHBOARD 2.0 ARCHITECTURE — PROPOSED FOR FREEZE**
