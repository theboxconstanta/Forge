import { beforeEach, describe, expect, it, vi } from 'vitest'
import { getAthletePerformanceSummary, getMovementProgressSummary, formatTrendLabel } from './performanceAnalytics'
import { supabase } from './supabase.js'

const state = { result: { data: null, error: null } }

function makeQueryBuilder() {
  const builder = {
    select: () => builder,
    eq: () => builder,
    maybeSingle: async () => state.result,
    then: (resolve, reject) => Promise.resolve(state.result).then(resolve, reject),
  }
  return builder
}

vi.mock('./supabase.js', () => ({
  supabase: { from: vi.fn() },
}))

beforeEach(() => {
  state.result = { data: null, error: null }
  supabase.from.mockReset().mockImplementation(() => makeQueryBuilder())
})

describe('getAthletePerformanceSummary (parity with forge-admin-web\'s own analytics.ts)', () => {
  it('returns null when the member has no summary row yet', async () => {
    expect(await getAthletePerformanceSummary('gym-1', 'member-1')).toBeNull()
  })

  it('returns the summary row', async () => {
    state.result = { data: { member_id: 'member-1', total_workouts_completed: 12 }, error: null }
    const result = await getAthletePerformanceSummary('gym-1', 'member-1')
    expect(result.total_workouts_completed).toBe(12)
  })

  it('throws on a query error', async () => {
    state.result = { data: null, error: new Error('boom') }
    await expect(getAthletePerformanceSummary('gym-1', 'member-1')).rejects.toThrow()
  })
})

describe('getMovementProgressSummary', () => {
  it('returns an empty array when there are no rows', async () => {
    expect(await getMovementProgressSummary('gym-1', 'member-1')).toEqual([])
  })

  it('returns rows as-is', async () => {
    state.result = { data: [{ movement: 'Back Squat', trend: 'improving' }], error: null }
    const result = await getMovementProgressSummary('gym-1', 'member-1')
    expect(result[0].movement).toBe('Back Squat')
  })
})

describe('formatTrendLabel', () => {
  it('returns a Romanian label for a known trend', () => {
    expect(formatTrendLabel('rapidly_improving')).toBe('Progres rapid')
    expect(formatTrendLabel('plateau')).toBe('Platou')
  })

  it('returns null for an unrecognized value', () => {
    expect(formatTrendLabel('unknown')).toBeNull()
    expect(formatTrendLabel(null)).toBeNull()
  })
})
