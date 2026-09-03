// INC-09 - representative-log selection for the leaderboard. THE ONE rule:
// a member's leaderboard row = their LATEST submission for the workout/section
// (logged_at, then id tie-break; NEVER score). Score only ORDERS the already-
// selected member rows. Pure + unit-tested (leaderboardSelection.test.js);
// App.jsx wires the DB query around monotonicLoggedAt.

import { logIsMoreRecent } from './utils'

/** One canonical row per member = the latest submission. Deterministic
 * regardless of input order. Feeds BOTH the primary metcon leaderboard and
 * every additional scored section, BEFORE any score ranking (P9.5.2A LB
 * blocker: the additional-section path previously skipped this and let a
 * score-first per-member reducer keep the best result instead of the latest). */
export function dedupLatestPerMember(arr) {
  const byMember = {}
  ;(arr || []).forEach((log) => {
    if (log && log.member_id != null && logIsMoreRecent(log, byMember[log.member_id])) {
      byMember[log.member_id] = log
    }
  })
  return Object.values(byMember)
}

/** INC-09 hardening - `wod_logs.logged_at` is business-date (for Journal
 * day-grouping) + wall-clock; there is no separate created_at. A member
 * re-logging / editing a PAST-dated workout earlier in the day than an existing
 * submission for it would otherwise get a SMALLER logged_at than that earlier
 * submission and lose the latest-log selection.
 *
 * This computes the logged_at for the row BEING SAVED so it sorts at/after the
 * member's own prior submissions for the same workout/section:
 *   clamp( max(base, latestSibling + 1s), [base, now] )
 * - no later sibling  -> returns `base` unchanged (first log / genuine latest)
 * - a later sibling   -> bumps forward just past it, never beyond `now`
 * Never rewrites any OTHER row. Never consults score. Pure.
 *
 * @param base            ISO string - the business-date stamp (INSERT) or the
 *                        row's current logged_at (edit).
 * @param siblingLoggedAts ISO strings of the member's OTHER logs for this
 *                        workout/section (exclude the row being edited).
 * @param now             ms epoch (defaults to Date.now()).
 * @returns ISO string (=== base when no bump is needed).
 */
export function monotonicLoggedAt({ base, siblingLoggedAts = [], now = Date.now() }) {
  const baseMs = base ? new Date(base).getTime() : now
  if (!Number.isFinite(baseMs)) return base
  const maxSibling = (siblingLoggedAts || []).reduce((mx, s) => {
    const t = new Date(s || 0).getTime()
    return Number.isFinite(t) && t > mx ? t : mx
  }, 0)
  if (maxSibling === 0) return base
  const bumped = Math.max(baseMs, maxSibling + 1000)
  if (bumped === baseMs) return base
  return new Date(Math.min(bumped, Math.max(baseMs, now))).toISOString()
}
