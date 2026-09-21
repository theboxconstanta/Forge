// FORGE — LEADERBOARD ACTIVITY V1 (personal social notifications, pure
// logic + data-access helpers). New Results Indicator explicitly DEFERRED
// to V2 (owner decision) - nothing here tracks "new results," only
// reactions/comments directed at the viewer's own results.
//
// Notification rows are created EXCLUSIVELY by server-side triggers
// (see migration 20260921100000) - nothing here ever INSERTs/DELETEs a
// leaderboard_notifications row; only SELECT (list/count) and a
// read_at-only UPDATE (mark read), matching the DB's own column-level
// grant restriction exactly.

/** Owner-specified badge format ("1 2 3 9+"), deliberately a tighter cap
 * than NavBar's existing Feed badge (which caps at 99) - reuses the SAME
 * badge rendering, just a smaller cap for this tab. */
export const LEADERBOARD_ACTIVITY_BADGE_CAP = 9

export function formatBadgeCount(n) {
  if (!n || n <= 0) return null
  return n > LEADERBOARD_ACTIVITY_BADGE_CAP ? `${LEADERBOARD_ACTIVITY_BADGE_CAP}+` : String(n)
}

export function isUnread(notification) {
  return !notification?.read_at
}

export function countUnread(notifications) {
  return (notifications || []).filter(isUnread).length
}

/** "Lucian Rosca a reacționat 🔥 la rezultatul tău." /
 * "Iulia Rosca a comentat la rezultatul tău." - actor name is resolved by
 * the caller (resolveIdentities, leaderboardSocialUI.jsx - reused, not
 * duplicated) and passed in already-formatted. */
export function notificationMessage(notification, actorName, t) {
  if (notification?.kind === 'reaction') {
    return t?.clasamentActivityReactionMessage
      ? t.clasamentActivityReactionMessage(actorName, notification.emoji)
      : `${actorName} reacted ${notification.emoji} to your result.`
  }
  return t?.clasamentActivityCommentMessage
    ? t.clasamentActivityCommentMessage(actorName)
    : `${actorName} commented on your result.`
}

/** Local-day string (YYYY-MM-DD) for an arbitrary timestamp, in the
 * BROWSER's own timezone - deliberately the exact same convention
 * todayLocalStr() (utils.js) already uses for "now" (this app's
 * established Europe/Bucharest-via-client-locale approach), just applied
 * to an arbitrary past timestamp instead of the current moment. */
function localDateStrFromTimestamp(iso) {
  const d = new Date(iso)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

/** Deep-link navigation target resolution (owner Navigation spec, points
 * 1-2): given a notification's stable wod_logs.id, find which historical
 * Leaderboard DATE it belongs to. Mirrors fetchClasament's own two-path
 * resolution exactly: a WOD-linked log resolves via wods.date; an
 * orphaned log (wod_id IS NULL - the 94 pre-existing rows, or a WOD
 * deleted after this log existed) falls back to the log's own logged_at
 * local day, the SAME fallback fetchClasament already uses to still show
 * those rows. Returns null when the log itself no longer exists (deleted
 * result) - the caller must fail gracefully (no navigation), never guess
 * an unrelated target. `supabase` is passed in for testability (DI),
 * matching resolveMonotonicLoggedAt's own convention (App.jsx). */
export async function resolveLeaderboardDateForLog(supabase, wodLogId) {
  const { data: log } = await supabase.from('wod_logs').select('id, wod_id, logged_at').eq('id', wodLogId).maybeSingle()
  if (!log) return null
  if (log.wod_id) {
    const { data: wod } = await supabase.from('wods').select('date').eq('id', log.wod_id).maybeSingle()
    if (wod?.date) return wod.date
  }
  if (!log.logged_at) return null
  return localDateStrFromTimestamp(log.logged_at)
}
