// FORGE — LEADERBOARD SOCIAL INTERACTIONS V1 (pure logic).
// docs/architecture/LEADERBOARD_SOCIAL_INTERACTIONS_V1_20260921.md
//
// Reactions/comments attach to a single stable wod_logs.id (never rank,
// row index, score text, component id, or tab). Pure functions only - no
// supabase calls here (those live in App.jsx's fetchClasament/mutation
// handlers, mirroring the Feed's own split). Nothing here touches the
// scoring surface (componentResults/prescription_snapshot/sortSectionLogs/
// isMixedCategory/dedupLatestPerMember/deriveWorkoutAggregate).

export const LEADERBOARD_REACTION_EMOJI = ['👍', '❤️', '🔥', '💪', '👏']

export const LEADERBOARD_COMMENT_MAX_LENGTH = 500

/** Reduces a flat rows array (`{wod_log_id, emoji, member_id}`) into
 * per-log summaries: `{ [logId]: { counts: {emoji: n}, mine: emoji|null } }`.
 * Mirrors the Feed's own rMap reduction (App.jsx toggleReactie/fetchAll)
 * exactly, just keyed by wod_log_id instead of post_id. */
export function reduceReactionRows(rows, myMemberId) {
  const map = {}
  ;(rows || []).forEach(r => {
    if (!map[r.wod_log_id]) map[r.wod_log_id] = { counts: {}, mine: null }
    const entry = map[r.wod_log_id]
    entry.counts[r.emoji] = (entry.counts[r.emoji] || 0) + 1
    if (myMemberId && r.member_id === myMemberId) entry.mine = r.emoji
  })
  return map
}

/** Reduces a flat rows array (`{wod_log_id}`, count-only select) into
 * `{ [logId]: count }`. */
export function reduceCommentCounts(rows) {
  const map = {}
  ;(rows || []).forEach(r => { map[r.wod_log_id] = (map[r.wod_log_id] || 0) + 1 })
  return map
}

/** One-reaction-per-member resolution (owner decision §4): tapping an emoji
 * while none is selected, or a DIFFERENT emoji than the current selection,
 * resolves to 'set' (insert or update to the new emoji); tapping the SAME
 * emoji again resolves to 'remove' (delete). Pure decision function - the
 * caller performs the actual supabase insert/update/delete. */
export function resolveReactionToggle(currentEmoji, tappedEmoji) {
  if (!LEADERBOARD_REACTION_EMOJI.includes(tappedEmoji)) {
    return { action: 'noop', emoji: null }
  }
  if (currentEmoji === tappedEmoji) return { action: 'remove', emoji: tappedEmoji }
  return { action: currentEmoji ? 'swap' : 'add', emoji: tappedEmoji }
}

/** Optimistic local reaction-summary update for a single log, applied
 * BEFORE the network call resolves (Feed's toggleReactie pattern). Returns
 * a NEW summary object (`{counts, mine}`), never mutates the input. */
export function applyOptimisticReaction(summary, myMemberId, resolution) {
  const base = summary || { counts: {}, mine: null }
  const counts = { ...base.counts }
  const prevMine = base.mine
  if (prevMine) counts[prevMine] = Math.max(0, (counts[prevMine] || 0) - 1)
  if (resolution.action === 'add' || resolution.action === 'swap') {
    counts[resolution.emoji] = (counts[resolution.emoji] || 0) + 1
    return { counts, mine: resolution.emoji }
  }
  if (resolution.action === 'remove') {
    return { counts, mine: null }
  }
  return base
}

/** Validates comment text against the DB's own CHECK constraint (1-500
 * chars, trimmed) - client-side mirror, not a substitute (the DB enforces
 * it regardless of what the client sends). */
export function validateCommentText(text) {
  const trimmed = (text || '').trim()
  if (trimmed.length === 0) return { valid: false, reason: 'empty' }
  if (trimmed.length > LEADERBOARD_COMMENT_MAX_LENGTH) return { valid: false, reason: 'too_long' }
  return { valid: true, text: trimmed }
}

/** Relative-time formatting for comment timestamps - same buckets as the
 * Feed's own relativeTime (App.jsx), reimplemented here as a pure function
 * (the Feed's version is a closure over `t`, not directly reusable). `t`
 * carries feedJustNow/feedDaysAgo, already loaded for every screen. */
export function relativeTimeLabel(ts, t, now = Date.now()) {
  const diff = now - new Date(ts).getTime()
  const min = Math.floor(diff / 60000)
  if (min < 1) return t?.feedJustNow || 'just now'
  if (min < 60) return `${min} min`
  const h = Math.floor(min / 60)
  if (h < 24) return `${h}h`
  const days = Math.floor(h / 24)
  return t?.feedDaysAgo ? t.feedDaysAgo(days) : `${days}d`
}

/** Whether a comment should show the "edited" indicator (owner decision:
 * edited_at NULL = never edited, no backfill ambiguity). */
export function commentIsEdited(comment) {
  return !!comment?.edited_at
}

/** Ownership/moderation UI-gating (the DB RLS policy is the real
 * boundary - this only decides whether to draw a control). Author always
 * gets edit+delete on their own comment; coach/admin gets delete-only on
 * anyone's (owner decision §1: moderation is remove-only, never silent
 * rewriting of another member's words). */
export function commentControlsFor(comment, myMemberId, isCoachOrAdmin) {
  const isMine = !!myMemberId && comment?.member_id === myMemberId
  return { canEdit: isMine, canDelete: isMine || !!isCoachOrAdmin }
}
