import { describe, expect, it } from 'vitest'
import { buildAggregateLeaderboard, COMBINE_FUNCTION_LABELS } from './aggregateLeaderboard'

const sectionA = { id: 'a', format: 'Weightlifting', format_config: {} }
const sectionB = { id: 'b', format: 'Weightlifting', format_config: {} }
const sectionsById = { a: sectionA, b: sectionB }

const log = (memberId, weight, overrides = {}) => ({
  id: `${memberId}-${JSON.stringify(overrides)}-${weight}`, member_id: memberId, variant_level: 'RX',
  sets: { Movement: [{ reps: '1', weight: String(weight) }] },
  logged_at: '2026-08-16T10:00:00Z', profile: { id: memberId, full_name: memberId, weight_unit: 'kg' },
  ...overrides,
})

describe('no-aggregate regression (S41)', () => {
  it('null aggregateDefinition returns null (no Aggregate leaderboard at all)', () => {
    expect(buildAggregateLeaderboard(null, sectionsById, {})).toBeNull()
  })
})

describe('value-combine leaderboard (S42)', () => {
  const def = { participantSectionIds: ['a', 'b'], combineFunction: 'sum' }

  it('ranks multiple members by summed value, higher wins', () => {
    const logsBySectionId = {
      a: [log('luci', 100), log('andrei', 105)],
      b: [log('luci', 130), log('andrei', 120)],
    }
    const board = buildAggregateLeaderboard(def, sectionsById, logsBySectionId)
    expect(board.label).toBe('Total')
    expect(board.comparator).toBe('higher')
    expect(board.entries.map(e => [e.memberId, e.result.value])).toEqual([['luci', 230], ['andrei', 225]])
  })

  it('a member missing one participant Section is excluded from the leaderboard, not shown with a partial value', () => {
    const logsBySectionId = { a: [log('luci', 100), log('andrei', 105)], b: [log('luci', 130)] }
    const board = buildAggregateLeaderboard(def, sectionsById, logsBySectionId)
    expect(board.entries.map(e => e.memberId)).toEqual(['luci'])
  })

  it('true tie: two members with equal aggregate values both appear, values equal', () => {
    const logsBySectionId = { a: [log('luci', 100), log('andrei', 100)], b: [log('luci', 130), log('andrei', 130)] }
    const board = buildAggregateLeaderboard(def, sectionsById, logsBySectionId)
    expect(board.entries[0].result.value).toBe(board.entries[1].result.value)
  })

  it('edit propagation: re-deriving with an updated Section log recomputes the leaderboard order', () => {
    const before = buildAggregateLeaderboard(def, sectionsById, {
      a: [log('luci', 100), log('andrei', 105)],
      b: [log('luci', 130), log('andrei', 120)],
    })
    expect(before.entries[0].memberId).toBe('luci')
    const after = buildAggregateLeaderboard(def, sectionsById, {
      a: [log('luci', 100), log('andrei', 105)],
      b: [log('luci', 130), log('andrei', 140)],
    })
    expect(after.entries[0].memberId).toBe('andrei')
    expect(after.entries[0].result.value).toBe(245)
  })

  it('delete propagation: removing a member\'s Section B log makes them unavailable/omitted', () => {
    const withBoth = buildAggregateLeaderboard(def, sectionsById, {
      a: [log('luci', 100), log('andrei', 105)],
      b: [log('luci', 130), log('andrei', 120)],
    })
    expect(withBoth.entries.map(e => e.memberId)).toContain('andrei')
    const afterDelete = buildAggregateLeaderboard(def, sectionsById, {
      a: [log('luci', 100), log('andrei', 105)],
      b: [log('luci', 130)],
    })
    expect(afterDelete.entries.map(e => e.memberId)).not.toContain('andrei')
    expect(afterDelete.entries.map(e => e.memberId)).toContain('luci')
  })

  it('restore propagation: re-adding the log brings the member back', () => {
    const restored = buildAggregateLeaderboard(def, sectionsById, {
      a: [log('luci', 100), log('andrei', 105)],
      b: [log('luci', 130), log('andrei', 120)],
    })
    expect(restored.entries.map(e => e.memberId)).toContain('andrei')
  })

  it('unit normalization: lb-entered Section value is canonical-kg-summed correctly', () => {
    const logsBySectionId = {
      a: [log('luci', 100)],
      b: [{ ...log('luci', 286.6), profile: { id: 'luci', full_name: 'luci', weight_unit: 'lbs' } }],
    }
    const board = buildAggregateLeaderboard(def, sectionsById, logsBySectionId)
    expect(board.entries[0].result.value).toBeCloseTo(230, 0)
  })

  it('deterministic: identical inputs produce identical output', () => {
    const inputs = { a: [log('luci', 100)], b: [log('luci', 130)] }
    const r1 = buildAggregateLeaderboard(def, sectionsById, inputs)
    const r2 = buildAggregateLeaderboard(def, sectionsById, inputs)
    expect(r1).toEqual(r2)
  })
})

describe('every value-combine function, multi-member (S42)', () => {
  const logsBySectionId = { a: [log('luci', 100), log('andrei', 90)], b: [log('luci', 130), log('andrei', 150)] }

  it('best-of', () => {
    const def = { participantSectionIds: ['a', 'b'], combineFunction: 'best-of' }
    const board = buildAggregateLeaderboard(def, sectionsById, logsBySectionId)
    // luci: max(100,130)=130; andrei: max(90,150)=150 -> andrei wins
    expect(board.entries.map(e => [e.memberId, e.result.value])).toEqual([['andrei', 150], ['luci', 130]])
  })
  it('average', () => {
    const def = { participantSectionIds: ['a', 'b'], combineFunction: 'average' }
    const board = buildAggregateLeaderboard(def, sectionsById, logsBySectionId)
    expect(board.entries.find(e => e.memberId === 'luci').result.value).toBe(115)
    expect(board.entries.find(e => e.memberId === 'andrei').result.value).toBe(120)
  })
  it('max', () => {
    const def = { participantSectionIds: ['a', 'b'], combineFunction: 'max' }
    const board = buildAggregateLeaderboard(def, sectionsById, logsBySectionId)
    expect(board.entries.find(e => e.memberId === 'andrei').result.value).toBe(150)
  })
  it('min', () => {
    const def = { participantSectionIds: ['a', 'b'], combineFunction: 'min' }
    const board = buildAggregateLeaderboard(def, sectionsById, logsBySectionId)
    expect(board.entries.find(e => e.memberId === 'andrei').result.value).toBe(90)
  })
})

describe('points-sum, multi-member (S43)', () => {
  it('maps each member\'s Section ranks through the declared table before summing', () => {
    const def = { participantSectionIds: ['a', 'b'], combineFunction: 'points-sum', pointsTable: [{ rank: 1, points: 100 }, { rank: 2, points: 95 }] }
    const logsBySectionId = { a: [log('luci', 100), log('andrei', 90)], b: [log('luci', 40), log('andrei', 60)] }
    const board = buildAggregateLeaderboard(def, sectionsById, logsBySectionId)
    expect(board.comparator).toBe('higher')
    // luci: rank1(a)+rank2(b) = 100+95=195; andrei: rank2(a)+rank1(b) = 95+100=195 -> tie
    expect(board.entries[0].result.value).toBe(195)
    expect(board.entries[1].result.value).toBe(195)
  })
})

describe('stable Section identity - reorder invariance (S46)', () => {
  it('reordering participantSectionIds does not change the computed aggregate value', () => {
    const logsBySectionId = { a: [log('luci', 100)], b: [log('luci', 130)] }
    const forward = buildAggregateLeaderboard({ participantSectionIds: ['a', 'b'], combineFunction: 'sum' }, sectionsById, logsBySectionId)
    const reversed = buildAggregateLeaderboard({ participantSectionIds: ['b', 'a'], combineFunction: 'sum' }, sectionsById, logsBySectionId)
    expect(forward.entries[0].result.value).toBe(reversed.entries[0].result.value)
  })
})

describe('mixed-tier / variant (S45)', () => {
  const def = { participantSectionIds: ['a', 'b'], combineFunction: 'sum' }
  it('a member with mismatched tier across participant Sections is excluded (mixed-tier -> unavailable)', () => {
    const logsBySectionId = {
      a: [log('luci', 100, { variant_level: 'RX' })],
      b: [log('luci', 130, { variant_level: 'Intermediate' })],
    }
    const board = buildAggregateLeaderboard(def, sectionsById, logsBySectionId)
    expect(board.entries).toHaveLength(0)
  })
})

describe('mixed physical result sources (S44)', () => {
  it('does not care whether a normalized log originated from wod_logs or skill_logs (already merged upstream)', () => {
    const def = { participantSectionIds: ['a', 'b'], combineFunction: 'sum' }
    const logsBySectionId = {
      a: [log('luci', 100, { _source: 'wod_logs' })],
      b: [log('luci', 130, { _source: 'skill_logs' })],
    }
    const board = buildAggregateLeaderboard(def, sectionsById, logsBySectionId)
    expect(board.entries[0].result.value).toBe(230)
  })
})

describe('label mapping (S6)', () => {
  it('every approved combine function has a deterministic, non-content-derived label', () => {
    expect(Object.keys(COMBINE_FUNCTION_LABELS)).toHaveLength(7)
    expect(COMBINE_FUNCTION_LABELS.sum).toBe('Total')
    expect(COMBINE_FUNCTION_LABELS['placement-sum']).toBe('Overall (Placement)')
  })
})

describe('rank-combine leaderboard (S43)', () => {
  it('ranks members by summed Section rank, lower wins, using actual athletic rank (ties share a rank position)', () => {
    // Section A: two members tied for 1st (both 100kg), a third at 3rd (90kg).
    // Section B: distinct ranks.
    const def = { participantSectionIds: ['a', 'b'], combineFunction: 'placement-sum' }
    const logsBySectionId = {
      a: [
        log('m1', 100, { logged_at: '2026-08-16T10:00:00Z' }),
        log('m2', 100, { logged_at: '2026-08-16T10:00:01Z' }), // tiebroken by logged_at (later), matches existing sortSectionLogs behavior
        log('m3', 90),
      ],
      b: [log('m1', 50), log('m2', 60), log('m3', 40)],
    }
    const board = buildAggregateLeaderboard(def, sectionsById, logsBySectionId)
    expect(board.comparator).toBe('lower')
    // all three members present in both sections -> all available
    expect(board.entries).toHaveLength(3)
  })

  it('aggregate tie on rank-combine: two members can share the same summed placement', () => {
    const def = { participantSectionIds: ['a', 'b'], combineFunction: 'placement-sum' }
    const logsBySectionId = {
      a: [log('m1', 100), log('m2', 90)], // m1 rank1, m2 rank2
      b: [log('m1', 40), log('m2', 60)], // m1 rank2, m2 rank1
    }
    const board = buildAggregateLeaderboard(def, sectionsById, logsBySectionId)
    expect(board.entries[0].result.value).toBe(board.entries[1].result.value)
  })
})
