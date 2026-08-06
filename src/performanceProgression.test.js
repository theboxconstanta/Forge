import { beforeEach, describe, expect, it, vi } from 'vitest'
import { fetchProgressionForMember, formatProgressionNote } from './performanceProgression'
import { supabase } from './supabase.js'

const state = { result: { data: [], error: null } }

function makeQueryBuilder() {
  const builder = {
    select: () => builder,
    eq: () => builder,
    then: (resolve, reject) => Promise.resolve(state.result).then(resolve, reject),
  }
  return builder
}

vi.mock('./supabase.js', () => ({
  supabase: { from: vi.fn() },
}))

beforeEach(() => {
  state.result = { data: [], error: null }
  supabase.from.mockReset().mockImplementation(() => makeQueryBuilder())
})

describe('fetchProgressionForMember (parity with forge-admin-web\'s own fetchProgressionForMember)', () => {
  it('returns an empty map when the member has no repeated workouts', async () => {
    const result = await fetchProgressionForMember('gym-1', 'member-1')
    expect(result.size).toBe(0)
  })

  it('keys the returned map by performance_identity_id', async () => {
    state.result = { data: [{ performance_identity_id: 'id-1', trend: 'improving' }], error: null }
    const result = await fetchProgressionForMember('gym-1', 'member-1')
    expect(result.get('id-1').trend).toBe('improving')
  })

  it('throws when the query errors', async () => {
    state.result = { data: null, error: new Error('network down') }
    await expect(fetchProgressionForMember('gym-1', 'member-1')).rejects.toThrow()
  })
})

function row(overrides = {}) {
  return {
    total_attempts: 3,
    trend: 'improving',
    previous_result_value: 300,
    previous_result_unit: 'seconds',
    current_is_pr: false,
    pct_change_since_previous: 5,
    ...overrides,
  }
}

describe('formatProgressionNote', () => {
  it('returns null for a first-ever attempt (insufficient_data)', () => {
    expect(formatProgressionNote(row({ trend: 'insufficient_data', total_attempts: 1 }))).toBeNull()
  })

  it('returns null when there is no row at all', () => {
    expect(formatProgressionNote(undefined)).toBeNull()
  })

  it('formats a seconds-based improvement with the up arrow', () => {
    expect(formatProgressionNote(row())).toBe('vs data trecuta (5:00) · ▲ 5%')
  })

  it('formats a decline with the down arrow', () => {
    expect(formatProgressionNote(row({ pct_change_since_previous: -8 }))).toBe('vs data trecuta (5:00) · ▼ 8%')
  })

  it('shows "PR nou" instead of a percentage when the latest attempt was a PR', () => {
    expect(formatProgressionNote(row({ current_is_pr: true }))).toBe('vs data trecuta (5:00) · PR nou')
  })

  it('formats a rounds-based previous result', () => {
    expect(formatProgressionNote(row({ previous_result_value: 12, previous_result_unit: 'rounds' }))).toBe('vs data trecuta (12 runde) · ▲ 5%')
  })
})
