import { describe, it, expect } from 'vitest'
import { rankEventLeaderboard, bestAttemptId, leaderboardDivisions } from './eventLeaderboard'
import { MAX_EFFORT_UNIT_KEY } from './eventScoring'

const event = (format, config = {}, divisions = ['rx', 'beginner']) => ({ workout_format: format, workout_format_config: config, divisions })
let n = 0
const att = (member_id, p = {}) => {
  n += 1
  return {
    id: `a${n}`, member_id, division: 'rx', result: null, time_result: null, completion_state: null, sets: null, log_meta: null,
    weight_unit: null, scored_at: `2026-10-15T10:${String(n).padStart(2, '0')}:00Z`, deleted_at: null,
    format_snapshot: p.format_snapshot || 'For Time', format_config_snapshot: p.format_config_snapshot ?? { timeCapSec: 600 }, ...p,
  }
}
const members = {
  ana: { full_name: 'Ana', gender: 'feminin' },
  bob: { full_name: 'Bob', gender: 'masculin' },
  cris: { full_name: 'Cris', gender: 'feminin' },
  dan: { full_name: 'Dan', gender: null },
}
const ids = (rows) => rows.map((r) => r.attempt.member_id)

describe('best-attempt model through sortSectionLogs', () => {
  const ft = event('For Time', { timeCapSec: 600 })

  it('one entry per member = their BEST non-deleted attempt (not the latest)', () => {
    const rows = rankEventLeaderboard(ft, [
      att('ana', { time_result: '9:00', completion_state: 'completed' }),
      att('ana', { time_result: '11:00', completion_state: 'completed' }),
      att('bob', { time_result: '10:00', completion_state: 'completed' }),
    ], members)
    expect(rows.map((r) => [r.rank, r.attempt.member_id, r.attempt.time_result, r.attemptCount])).toEqual([[1, 'ana', '9:00', 2], [2, 'bob', '10:00', 1]])
  })

  it('soft-deleted attempts never count (and do not inflate the count)', () => {
    const rows = rankEventLeaderboard(ft, [
      att('ana', { time_result: '5:00', completion_state: 'completed', deleted_at: '2026-10-15T11:00:00Z' }),
      att('ana', { time_result: '12:00', completion_state: 'completed' }),
    ], members)
    expect(rows).toHaveLength(1)
    expect(rows[0].attempt.time_result).toBe('12:00')
    expect(rows[0].attemptCount).toBe(1)
  })

  it('finished beats capped; capped ranks by reps', () => {
    const rows = rankEventLeaderboard(ft, [
      att('ana', { result: '150 reps', completion_state: 'capped' }),
      att('bob', { time_result: '9:59', completion_state: 'completed' }),
      att('cris', { result: '170 reps', completion_state: 'capped' }),
    ], members)
    expect(ids(rows)).toEqual(['bob', 'cris', 'ana'])
  })

  it('exact tie -> earlier scored_at first (an edited score moves scored_at)', () => {
    const rows = rankEventLeaderboard(ft, [
      att('ana', { time_result: '10:00', completion_state: 'completed', scored_at: '2026-10-15T12:00:00Z' }),
      att('bob', { time_result: '10:00', completion_state: 'completed', scored_at: '2026-10-15T09:00:00Z' }),
    ], members)
    expect(ids(rows)).toEqual(['bob', 'ana'])
  })

  it('AMRAP: rounds, then additional reps', () => {
    const snap = { format_snapshot: 'AMRAP', format_config_snapshot: {} }
    const rows = rankEventLeaderboard(event('AMRAP'), [
      att('ana', { ...snap, result: '7 runde + 12' }),
      att('bob', { ...snap, result: '8 runde complete' }),
      att('cris', { ...snap, result: '7 runde + 15' }),
    ], members)
    expect(ids(rows)).toEqual(['bob', 'cris', 'ana'])
  })

  it('uses the FROZEN attempt snapshot, not the live event config', () => {
    // live event says AMRAP, attempts were frozen as For Time
    const rows = rankEventLeaderboard(event('AMRAP'), [
      att('ana', { time_result: '8:00', completion_state: 'completed' }),
      att('bob', { result: '9 runde complete', completion_state: 'capped' }),
    ], members)
    expect(ids(rows)).toEqual(['ana', 'bob'])
  })
})

describe('LOAD - kg/lb normalisation via toKgForRanking', () => {
  const load = event('Max Effort', { [MAX_EFFORT_UNIT_KEY]: 'load' })
  const snap = { format_snapshot: 'Max Effort', format_config_snapshot: { [MAX_EFFORT_UNIT_KEY]: 'load' } }
  it('220 lb (99.8 kg) ranks below 100 kg; 225 lb (102.1 kg) above it', () => {
    const rows = rankEventLeaderboard(load, [
      att('ana', { ...snap, result: '100', weight_unit: 'kg' }),
      att('bob', { ...snap, result: '220', weight_unit: 'lb' }),
      att('cris', { ...snap, result: '225', weight_unit: 'lb' }),
    ], members)
    expect(ids(rows)).toEqual(['cris', 'ana', 'bob'])
    // display keeps the member's own value
    expect(rows[0].attempt.result).toBe('225')
  })
  it('best of a member’s own mixed-unit attempts', () => {
    const rows = rankEventLeaderboard(load, [
      att('ana', { ...snap, result: '100', weight_unit: 'kg' }),
      att('ana', { ...snap, result: '230', weight_unit: 'lb' }),
    ], members)
    expect(rows[0].attempt.result).toBe('230')
  })
  it('without the unit key Max Effort is ranked on the raw number (existing behaviour)', () => {
    const snapFree = { format_snapshot: 'Max Effort', format_config_snapshot: {} }
    const rows = rankEventLeaderboard(event('Max Effort'), [
      att('ana', { ...snapFree, result: '100' }), att('bob', { ...snapFree, result: '220' }),
    ], members)
    expect(ids(rows)).toEqual(['bob', 'ana'])
  })
})

describe('filters', () => {
  const ft = event('For Time', { timeCapSec: 600 })
  const all = [
    att('ana', { time_result: '9:00', completion_state: 'completed' }),
    att('bob', { time_result: '8:00', completion_state: 'completed' }),
    att('cris', { time_result: '7:00', completion_state: 'completed', division: 'beginner' }),
    att('dan', { time_result: '6:00', completion_state: 'completed' }),
  ]
  it('division', () => {
    expect(ids(rankEventLeaderboard(ft, all, members, { division: 'rx' }))).toEqual(['dan', 'bob', 'ana'])
    expect(ids(rankEventLeaderboard(ft, all, members, { division: 'beginner' }))).toEqual(['cris'])
  })
  it('men / women via members.gender; unknown gender is never guessed (All only)', () => {
    expect(ids(rankEventLeaderboard(ft, all, members, { division: 'rx', gender: 'female' }))).toEqual(['ana'])
    expect(ids(rankEventLeaderboard(ft, all, members, { division: 'rx', gender: 'male' }))).toEqual(['bob'])
    expect(ids(rankEventLeaderboard(ft, all, members, { division: 'rx', gender: 'all' }))).toContain('dan')
  })
  it('ranks restart at 1 within each filter', () => {
    expect(rankEventLeaderboard(ft, all, members, { division: 'beginner' })[0].rank).toBe(1)
  })
})

describe('helpers', () => {
  it('bestAttemptId picks the best live attempt', () => {
    const ft = event('For Time', { timeCapSec: 600 })
    const mine = [att('ana', { time_result: '10:00', completion_state: 'completed' }), att('ana', { time_result: '9:30', completion_state: 'completed' })]
    expect(bestAttemptId(ft, mine)).toBe(mine[1].id)
    expect(bestAttemptId(ft, [])).toBeNull()
  })
  it('leaderboardDivisions in canonical order', () => {
    expect(leaderboardDivisions({ divisions: ['beginner', 'rx'] })).toEqual(['rx', 'beginner'])
  })
})

describe('DISTANCE - explicit unit, normalised to metres', () => {
  it('km event ranks by metres, highest first; display keeps the entered value', () => {
    const cfg = { [MAX_EFFORT_UNIT_KEY]: 'distance_km' }
    const snap = { format_snapshot: 'Max Effort', format_config_snapshot: cfg }
    const rows = rankEventLeaderboard(event('Max Effort', cfg), [
      att('ana', { ...snap, result: '5.2' }), att('bob', { ...snap, result: '5.25' }), att('cris', { ...snap, result: '4.9' }),
    ], members)
    expect(ids(rows)).toEqual(['bob', 'ana', 'cris'])
    expect(rows[0].attempt.result).toBe('5.25')
  })
  it('m event: best of a member\'s attempts', () => {
    const cfg = { [MAX_EFFORT_UNIT_KEY]: 'distance_m' }
    const snap = { format_snapshot: 'Max Effort', format_config_snapshot: cfg }
    const rows = rankEventLeaderboard(event('Max Effort', cfg), [att('ana', { ...snap, result: '400' }), att('ana', { ...snap, result: '420' })], members)
    expect(rows[0].attempt.result).toBe('420')
  })
})
