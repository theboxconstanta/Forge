import { describe, it, expect } from 'vitest'
import {
  LEADERBOARD_REACTION_EMOJI, LEADERBOARD_COMMENT_MAX_LENGTH,
  reduceReactionRows, reduceCommentCounts, resolveReactionToggle,
  applyOptimisticReaction, validateCommentText, relativeTimeLabel,
  commentIsEdited, commentControlsFor,
} from './leaderboardSocial'

describe('reduceReactionRows', () => {
  it('buckets counts per log and flags the viewer\'s own reaction', () => {
    const rows = [
      { wod_log_id: 'log1', emoji: '👍', member_id: 'me' },
      { wod_log_id: 'log1', emoji: '👍', member_id: 'other' },
      { wod_log_id: 'log1', emoji: '🔥', member_id: 'third' },
      { wod_log_id: 'log2', emoji: '💪', member_id: 'other' },
    ]
    const map = reduceReactionRows(rows, 'me')
    expect(map.log1.counts).toEqual({ '👍': 2, '🔥': 1 })
    expect(map.log1.mine).toBe('👍')
    expect(map.log2.counts).toEqual({ '💪': 1 })
    expect(map.log2.mine).toBe(null)
  })

  it('empty/undefined rows produce an empty map, never throws', () => {
    expect(reduceReactionRows(null, 'me')).toEqual({})
    expect(reduceReactionRows([], 'me')).toEqual({})
  })
})

describe('reduceCommentCounts', () => {
  it('counts comments per log', () => {
    const rows = [{ wod_log_id: 'a' }, { wod_log_id: 'a' }, { wod_log_id: 'b' }]
    expect(reduceCommentCounts(rows)).toEqual({ a: 2, b: 1 })
  })
})

describe('resolveReactionToggle — one reaction per member (owner decision §4)', () => {
  it('no current reaction + tap = add', () => {
    expect(resolveReactionToggle(null, '👍')).toEqual({ action: 'add', emoji: '👍' })
  })
  it('different current reaction + tap a new emoji = swap', () => {
    expect(resolveReactionToggle('🔥', '👍')).toEqual({ action: 'swap', emoji: '👍' })
  })
  it('same emoji tapped again = remove', () => {
    expect(resolveReactionToggle('👍', '👍')).toEqual({ action: 'remove', emoji: '👍' })
  })
  it('rejects an emoji outside the approved set', () => {
    expect(resolveReactionToggle(null, '😀')).toEqual({ action: 'noop', emoji: null })
  })
  it('every approved emoji round-trips through add', () => {
    LEADERBOARD_REACTION_EMOJI.forEach(e => {
      expect(resolveReactionToggle(null, e).action).toBe('add')
    })
  })
})

describe('applyOptimisticReaction', () => {
  it('add: increments the new emoji, mine becomes it', () => {
    const next = applyOptimisticReaction({ counts: {}, mine: null }, 'me', { action: 'add', emoji: '👍' })
    expect(next).toEqual({ counts: { '👍': 1 }, mine: '👍' })
  })
  it('swap: decrements the old emoji, increments the new one', () => {
    const next = applyOptimisticReaction({ counts: { '🔥': 1, '👍': 2 }, mine: '🔥' }, 'me', { action: 'swap', emoji: '👍' })
    expect(next).toEqual({ counts: { '🔥': 0, '👍': 3 }, mine: '👍' })
  })
  it('remove: decrements own emoji, mine becomes null', () => {
    const next = applyOptimisticReaction({ counts: { '👍': 1 }, mine: '👍' }, 'me', { action: 'remove', emoji: '👍' })
    expect(next).toEqual({ counts: { '👍': 0 }, mine: null })
  })
  it('never mutates the input summary object', () => {
    const original = { counts: { '👍': 1 }, mine: '👍' }
    const snapshot = JSON.parse(JSON.stringify(original))
    applyOptimisticReaction(original, 'me', { action: 'remove', emoji: '👍' })
    expect(original).toEqual(snapshot)
  })
})

describe('validateCommentText', () => {
  it('rejects empty/whitespace-only text', () => {
    expect(validateCommentText('').valid).toBe(false)
    expect(validateCommentText('   ').valid).toBe(false)
  })
  it('accepts and trims valid text', () => {
    const r = validateCommentText('  nice work  ')
    expect(r.valid).toBe(true)
    expect(r.text).toBe('nice work')
  })
  it(`rejects text over ${LEADERBOARD_COMMENT_MAX_LENGTH} chars (matches the DB CHECK)`, () => {
    expect(validateCommentText('a'.repeat(LEADERBOARD_COMMENT_MAX_LENGTH + 1)).valid).toBe(false)
  })
  it(`accepts exactly ${LEADERBOARD_COMMENT_MAX_LENGTH} chars`, () => {
    expect(validateCommentText('a'.repeat(LEADERBOARD_COMMENT_MAX_LENGTH)).valid).toBe(true)
  })
})

describe('relativeTimeLabel', () => {
  const t = { feedJustNow: 'just now', feedDaysAgo: (d) => `${d}d` }
  const now = new Date('2026-09-21T12:00:00Z').getTime()
  it('< 1 min = just now', () => {
    expect(relativeTimeLabel(new Date(now - 10000).toISOString(), t, now)).toBe('just now')
  })
  it('minutes', () => {
    expect(relativeTimeLabel(new Date(now - 5 * 60000).toISOString(), t, now)).toBe('5 min')
  })
  it('hours', () => {
    expect(relativeTimeLabel(new Date(now - 3 * 3600000).toISOString(), t, now)).toBe('3h')
  })
  it('days', () => {
    expect(relativeTimeLabel(new Date(now - 2 * 86400000).toISOString(), t, now)).toBe('2d')
  })
})

describe('commentIsEdited', () => {
  it('null edited_at = never edited', () => {
    expect(commentIsEdited({ edited_at: null })).toBe(false)
    expect(commentIsEdited({})).toBe(false)
  })
  it('a set edited_at = edited', () => {
    expect(commentIsEdited({ edited_at: '2026-09-21T12:00:00Z' })).toBe(true)
  })
})

describe('commentControlsFor — moderation is remove-only (owner decision §1)', () => {
  it('author gets edit + delete on their own comment', () => {
    expect(commentControlsFor({ member_id: 'me' }, 'me', false)).toEqual({ canEdit: true, canDelete: true })
  })
  it('coach/admin gets delete-only on someone else\'s comment, never edit', () => {
    expect(commentControlsFor({ member_id: 'other' }, 'me', true)).toEqual({ canEdit: false, canDelete: true })
  })
  it('a plain member gets neither on someone else\'s comment', () => {
    expect(commentControlsFor({ member_id: 'other' }, 'me', false)).toEqual({ canEdit: false, canDelete: false })
  })
})
