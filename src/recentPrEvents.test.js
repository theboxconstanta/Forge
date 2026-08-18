import { describe, expect, it } from 'vitest'
import { filterValidRecentPrEvents, sortRecentPrEvents } from './recentPrEvents'

// Member Performance, Phase 6 (Performance Overview) - Recent PRs
// validity filter. Mandatory: Caveat A (Phase 5) - legacy semantically-
// invalid pr_events must never leak into the UI, filtered by SEMANTICS
// (re-running resolveComparisonIdentity against the source Result), never
// by hardcoded event IDs.

function prEvent(overrides) {
  return {
    id: 'e1', gym_id: 'g1', member_id: 'm1', pr_type: 'movement',
    movement: 'Back Squat', rep_scheme: 5, benchmark_id: null, scaling_context: null,
    score_value: 100, score_unit: 'kg', voided_at: null,
    source_wod_log_id: 'w1', source_skill_log_id: null,
    occurred_at: '2026-08-17T10:00:00Z', created_at: '2026-08-17T10:00:00Z',
    ...overrides,
  }
}

function wodLog(overrides) {
  return { id: 'w1', format_snapshot: 'Build to Heavy/1RM', format_config_snapshot: { targetLabel: '5RM' }, ...overrides }
}

describe('filterValidRecentPrEvents', () => {
  it('includes a valid RM_TEST movement event whose source is Build to Heavy/1RM with a real targetLabel', () => {
    const wodLogsById = new Map([['w1', wodLog()]])
    const result = filterValidRecentPrEvents([prEvent()], wodLogsById, new Map())
    expect(result).toHaveLength(1)
  })

  it('excludes a voided event regardless of source validity', () => {
    const wodLogsById = new Map([['w1', wodLog()]])
    const result = filterValidRecentPrEvents([prEvent({ voided_at: '2026-08-18T00:00:00Z' })], wodLogsById, new Map())
    expect(result).toHaveLength(0)
  })

  it('excludes the REAL Phase-5-disclosed false-positive pattern: source format_snapshot=Weightlifting (always UNKNOWN) - filtered by semantics, not by ID', () => {
    const wodLogsById = new Map([['w1', wodLog({ format_snapshot: 'Weightlifting', format_config_snapshot: {} })]])
    const result = filterValidRecentPrEvents([prEvent()], wodLogsById, new Map())
    expect(result).toHaveLength(0)
  })

  it('excludes a movement event whose source is Strength Sets (SETS_ACROSS, not RM_TEST)', () => {
    const wodLogsById = new Map([['w1', wodLog({ format_snapshot: 'Strength Sets', format_config_snapshot: { setsScheme: [5, 5, 5] } })]])
    const result = filterValidRecentPrEvents([prEvent()], wodLogsById, new Map())
    expect(result).toHaveLength(0)
  })

  it('excludes an event whose source Result cannot be found (deleted, or outside the loaded set) - never assumed valid', () => {
    const result = filterValidRecentPrEvents([prEvent()], new Map(), new Map())
    expect(result).toHaveLength(0)
  })

  it('includes a benchmark event without re-deriving comparison identity (Benchmark Identity already proven strong) as long as its source exists', () => {
    const wodLogsById = new Map([['w1', wodLog({ format_snapshot: 'For Time' })]])
    const result = filterValidRecentPrEvents(
      [prEvent({ pr_type: 'benchmark', movement: null, benchmark_id: 'fran', scaling_context: 'RX', score_unit: 'seconds' })],
      wodLogsById, new Map(),
    )
    expect(result).toHaveLength(1)
  })

  it('excludes a benchmark event whose source cannot be found', () => {
    const result = filterValidRecentPrEvents(
      [prEvent({ pr_type: 'benchmark', movement: null, benchmark_id: 'fran', scaling_context: 'RX' })],
      new Map(), new Map(),
    )
    expect(result).toHaveLength(0)
  })

  it('resolves a skill_logs-sourced movement event via source_skill_log_id', () => {
    const skillLogsById = new Map([['s1', { id: 's1', format_snapshot: 'Build to Heavy/1RM', format_config_snapshot: { targetLabel: '3RM' } }]])
    const result = filterValidRecentPrEvents(
      [prEvent({ source_wod_log_id: null, source_skill_log_id: 's1' })],
      new Map(), skillLogsById,
    )
    expect(result).toHaveLength(1)
  })
})

describe('sortRecentPrEvents', () => {
  it('sorts by occurred_at (athletic performance date), newest first', () => {
    const events = [
      prEvent({ id: 'old', occurred_at: '2026-01-01T00:00:00Z' }),
      prEvent({ id: 'new', occurred_at: '2026-08-01T00:00:00Z' }),
    ]
    const sorted = sortRecentPrEvents(events)
    expect(sorted.map((e) => e.id)).toEqual(['new', 'old'])
  })

  it('does not mutate the input array', () => {
    const events = [prEvent({ id: 'a', occurred_at: '2026-01-01' }), prEvent({ id: 'b', occurred_at: '2026-02-01' })]
    const original = [...events]
    sortRecentPrEvents(events)
    expect(events).toEqual(original)
  })
})
