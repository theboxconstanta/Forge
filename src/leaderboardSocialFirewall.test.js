// FORGE — LEADERBOARD SOCIAL INTERACTIONS V1, scoring-firewall guard.
// docs/architecture/LEADERBOARD_SOCIAL_INTERACTIONS_V1_20260921.md §7/§19.
//
// The ticket's ONLY scoring-adjacent change is a logId passthrough in
// computeOverallPlacements (src/componentLeaderboard.js) - it must add a
// field and read none. These guards pin exactly that: comparators, rank
// assignment, and points math stay byte-identical to before the ticket:
// same rank/points for the same inputs, regardless of logId's presence.

import { describe, it, expect } from 'vitest'
import { computeOverallPlacements, rankComponentAcrossLogs } from './componentLeaderboard'

const partA = { id: 'partA', format: 'For Time', config: { structure: 'Sequence', timeCapSec: 900 } }
const partB = { id: 'partB', format: 'Max Effort', config: { timeCapSec: 180 } }

function member(id, logId, { partATime, partBLoad, tier = 'rx' } = {}) {
  const componentResults = {}
  if (partATime !== undefined) {
    componentResults.partA = { format: 'For Time', result: null, time_result: partATime, completion_state: 'completed', sets: null, load_result: null }
  }
  if (partBLoad !== undefined) {
    componentResults.partB = { format: 'Max Effort', result: null, time_result: null, completion_state: null, sets: null, load_result: partBLoad }
  }
  return {
    memberId: id, profile: { name: id },
    log: { id: logId, member_id: id, variant_level: tier, log_meta: Object.keys(componentResults).length ? { componentResults } : null },
  }
}

describe('computeOverallPlacements — logId passthrough does not perturb ranking (firewall guard)', () => {
  it('carries the frozen wod_logs.id through to both ranked and incomplete rows', () => {
    const logs = [
      member('alice', 'log-alice', { partATime: '10:00', partBLoad: 100 }),
      member('bob', 'log-bob', { partATime: '12:00' }), // missing Part B -> incomplete
    ]
    const { ranked, incomplete } = computeOverallPlacements([partA, partB], logs)
    expect(ranked.map(r => r.logId)).toEqual(['log-alice'])
    expect(incomplete.map(r => r.logId)).toEqual(['log-bob'])
  })

  it('a log with no id (never persisted) yields logId: null, never a fabricated value', () => {
    const logs = [member('alice', undefined, { partATime: '10:00', partBLoad: 100 })]
    const { ranked } = computeOverallPlacements([partA, partB], logs)
    expect(ranked[0].logId).toBe(null)
  })

  it('rank and points are IDENTICAL with and without logId present on the input log', () => {
    const withId = [
      member('alice', 'log-alice', { partATime: '10:00', partBLoad: 100 }),
      member('bob', 'log-bob', { partATime: '11:00', partBLoad: 90 }),
    ]
    const withoutId = withId.map(m => ({ ...m, log: { ...m.log, id: undefined } }))
    const a = computeOverallPlacements([partA, partB], withId)
    const b = computeOverallPlacements([partA, partB], withoutId)
    const strip = (arr) => arr.map(row => { const rest = { ...row }; delete rest.logId; return rest })
    expect(strip(a.ranked)).toEqual(strip(b.ranked))
    expect(strip(a.incomplete)).toEqual(strip(b.incomplete))
  })

  it('rankComponentAcrossLogs (per-part ranking) is completely untouched by this ticket — no logId field added', () => {
    const logs = [member('alice', 'log-alice', { partATime: '10:00' })]
    const ranked = rankComponentAcrossLogs(partA, logs)
    expect(ranked[0]).not.toHaveProperty('logId')
  })
})
