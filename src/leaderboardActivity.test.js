import { describe, it, expect, vi } from 'vitest'
import {
  LEADERBOARD_ACTIVITY_BADGE_CAP, formatBadgeCount, isUnread, countUnread,
  notificationMessage, resolveLeaderboardDateForLog,
} from './leaderboardActivity'

describe('formatBadgeCount — owner-specified "1 2 3 9+" format', () => {
  it('null/zero unread renders no badge', () => {
    expect(formatBadgeCount(0)).toBe(null)
    expect(formatBadgeCount(null)).toBe(null)
    expect(formatBadgeCount(undefined)).toBe(null)
  })
  it('renders the exact count under the cap', () => {
    expect(formatBadgeCount(1)).toBe('1')
    expect(formatBadgeCount(9)).toBe('9')
  })
  it(`caps at ${LEADERBOARD_ACTIVITY_BADGE_CAP}+ above the cap`, () => {
    expect(formatBadgeCount(10)).toBe('9+')
    expect(formatBadgeCount(200)).toBe('9+')
  })
})

describe('isUnread / countUnread', () => {
  it('null read_at = unread, a set read_at = read', () => {
    expect(isUnread({ read_at: null })).toBe(true)
    expect(isUnread({ read_at: '2026-09-21T08:00:00Z' })).toBe(false)
  })
  it('counts only unread notifications', () => {
    const list = [{ read_at: null }, { read_at: '2026-09-21T08:00:00Z' }, { read_at: null }]
    expect(countUnread(list)).toBe(2)
  })
})

describe('notificationMessage', () => {
  const t = {
    clasamentActivityReactionMessage: (name, emoji) => `${name} a reacționat ${emoji} la rezultatul tău.`,
    clasamentActivityCommentMessage: (name) => `${name} a comentat la rezultatul tău.`,
  }
  it('reaction message includes the actor name and current emoji', () => {
    expect(notificationMessage({ kind: 'reaction', emoji: '🔥' }, 'Lucian Rosca', t))
      .toBe('Lucian Rosca a reacționat 🔥 la rezultatul tău.')
  })
  it('comment message includes the actor name, no emoji', () => {
    expect(notificationMessage({ kind: 'comment' }, 'Iulia Rosca', t))
      .toBe('Iulia Rosca a comentat la rezultatul tău.')
  })
})

function chainableSingle(result) {
  const obj = { select: () => obj, eq: () => obj, maybeSingle: () => result }
  return obj
}

describe('resolveLeaderboardDateForLog — deep-link date resolution', () => {
  it('a WOD-linked log resolves via wods.date', async () => {
    const supabase = { from: vi.fn((table) => {
      if (table === 'wod_logs') return chainableSingle({ data: { id: 'log1', wod_id: 'wod1', logged_at: '2026-09-18T18:00:00Z' } })
      if (table === 'wods') return chainableSingle({ data: { date: '2026-09-18' } })
    }) }
    expect(await resolveLeaderboardDateForLog(supabase, 'log1')).toBe('2026-09-18')
  })

  it('an orphaned log (wod_id NULL) falls back to its own logged_at local day', async () => {
    const supabase = { from: vi.fn((table) => {
      if (table === 'wod_logs') return chainableSingle({ data: { id: 'log2', wod_id: null, logged_at: '2026-07-14T16:01:30Z' } })
    }) }
    const result = await resolveLeaderboardDateForLog(supabase, 'log2')
    expect(result).toMatch(/^\d{4}-\d{2}-\d{2}$/)
  })

  it('a WOD row that no longer exists falls back to logged_at, same as an orphaned log', async () => {
    const supabase = { from: vi.fn((table) => {
      if (table === 'wod_logs') return chainableSingle({ data: { id: 'log3', wod_id: 'deleted-wod', logged_at: '2026-08-01T10:00:00Z' } })
      if (table === 'wods') return chainableSingle({ data: null })
    }) }
    const result = await resolveLeaderboardDateForLog(supabase, 'log3')
    expect(result).toMatch(/^\d{4}-\d{2}-\d{2}$/)
  })

  it('a deleted result (wod_log itself gone) resolves to null - caller must fail gracefully, never guess', async () => {
    const supabase = { from: vi.fn(() => chainableSingle({ data: null })) }
    expect(await resolveLeaderboardDateForLog(supabase, 'gone')).toBe(null)
  })
})
