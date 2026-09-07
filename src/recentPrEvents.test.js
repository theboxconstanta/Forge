import { describe, expect, it } from 'vitest'
import { filterValidRecentPrEvents, sortRecentPrEvents, newPrEventsForSource } from './recentPrEvents'

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

// CANONICAL STRENGTH RESULT INTELLIGENCE, Phase D (sections 15-16) - inline
// "NEW PR" surfacing at save confirmation + Journal. Keys the ALREADY
// validated ledger (filterValidRecentPrEvents' own output - never a raw
// unfiltered prEvents array) by ONE specific source log's id, exactly as
// the ledger records provenance.
describe('newPrEventsForSource', () => {
  it('finds a wod_logs-sourced event by wodLogId', () => {
    const result = newPrEventsForSource([prEvent({ source_wod_log_id: 'w1' })], { wodLogId: 'w1' })
    expect(result).toHaveLength(1)
  })

  it('finds a skill_logs-sourced event by skillLogId', () => {
    const result = newPrEventsForSource([prEvent({ source_wod_log_id: null, source_skill_log_id: 's1' })], { skillLogId: 's1' })
    expect(result).toHaveLength(1)
  })

  it('returns [] for a log with no matching event (the overwhelming majority of saves)', () => {
    const result = newPrEventsForSource([prEvent({ source_wod_log_id: 'w1' })], { wodLogId: 'w2' })
    expect(result).toEqual([])
  })

  it('never cross-matches a wodLogId lookup against a source_skill_log_id event, or vice versa', () => {
    expect(newPrEventsForSource([prEvent({ source_wod_log_id: null, source_skill_log_id: 's1' })], { wodLogId: 's1' })).toEqual([])
    expect(newPrEventsForSource([prEvent({ source_wod_log_id: 'w1' })], { skillLogId: 'w1' })).toEqual([])
  })

  it('reconciliation: an event no longer present in the already-validated list (voided/reconciled by a downward edit, or its source deleted) is simply absent - the badge disappears automatically, no separate invalidation needed', () => {
    // Simulates the caller passing filterValidRecentPrEvents's output AFTER
    // the source's sets changed downward - void_stale_pr_events already
    // voided the row server-side, so a re-fetch excludes it entirely before
    // it ever reaches this function.
    const result = newPrEventsForSource([], { wodLogId: 'w1' })
    expect(result).toEqual([])
  })

  it('handles an empty/undefined validEvents list without throwing', () => {
    expect(newPrEventsForSource(undefined, { wodLogId: 'w1' })).toEqual([])
    expect(newPrEventsForSource(null, { wodLogId: 'w1' })).toEqual([])
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
