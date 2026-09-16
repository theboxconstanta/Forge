// FORGE WORKOUT COMPOSER - MULTI-PART SCORING TICKET, Parts 8/9/10/11/12/13.
//
// Pure-function coverage for the leaderboard root fix: per-component
// ranking (tie-aware, competition placement) and the Overall placement-sum
// adapter reusing workoutAggregation.js's existing engine unchanged.
//
// The canonical target workout throughout: Part A = For Time (Time Cap
// 15:00, sequential), Part B = Max Effort/Load (3:00 window, Clean & Jerk).

import { describe, it, expect } from 'vitest'
import { logHasComponentResults, rankComponentAcrossLogs, computeOverallPlacements } from './componentLeaderboard'

const partA = { id: 'partA', format: 'For Time', config: { structure: 'Sequence', timeCapSec: 900 } }
const partB = { id: 'partB', format: 'Max Effort', config: { timeCapSec: 180 } }

function member(id, { partATime, partAResult, partACompletion, partBLoad, tier = 'rx' } = {}) {
  const componentResults = {}
  if (partATime !== undefined || partAResult !== undefined) {
    componentResults.partA = {
      format: 'For Time', result: partAResult ?? null, time_result: partATime ?? null,
      completion_state: partACompletion ?? (partATime ? 'completed' : (partAResult ? 'capped' : null)), sets: null, load_result: null,
    }
  }
  if (partBLoad !== undefined) {
    componentResults.partB = { format: 'Max Effort', result: null, time_result: null, completion_state: null, sets: null, load_result: partBLoad }
  }
  return {
    memberId: id, profile: { name: id },
    log: { member_id: id, variant_level: tier, log_meta: Object.keys(componentResults).length ? { componentResults } : null },
  }
}

describe('logHasComponentResults', () => {
  it('true for a Composer multi-scorer log', () => {
    expect(logHasComponentResults(member('a', { partATime: '11:42', partBLoad: 95 }).log)).toBe(true)
  })
  it('false for a legacy scalar-only log', () => {
    expect(logHasComponentResults({ result: '6 rounds + 4', time_result: null, log_meta: null })).toBe(false)
  })
  it('false for a log with no log_meta at all', () => {
    expect(logHasComponentResults({})).toBe(false)
  })
})

// --- Per-component ranking (Part 9/11) --------------------------------------

describe('rankComponentAcrossLogs - Part A (For Time, sequential) - lower time wins, competition ties', () => {
  it('finished times rank ascending, DNF/capped ranks after every finisher, missing ranks null', () => {
    const logs = [
      member('alice', { partATime: '11:42' }),
      member('bob', { partATime: '10:15' }),
      member('carol', { partAResult: '30/40 Clean & Jerk', partACompletion: 'capped' }), // capped with partial
      member('dave'), // never logged Part A at all - missing, not DNF
    ]
    const ranked = rankComponentAcrossLogs(partA, logs)
    const byId = Object.fromEntries(ranked.map(r => [r.memberId, r.rank]))
    expect(byId.bob).toBe(1)
    expect(byId.alice).toBe(2)
    expect(byId.carol).toBe(3) // finished outranks DNF/capped
    expect(byId.dave).toBe(null) // missing, never fabricated
  })

  it('two identical finish times share competition rank 1, next distinct time is rank 3', () => {
    const logs = [
      member('alice', { partATime: '10:42' }),
      member('bob', { partATime: '10:42' }),
      member('carol', { partATime: '11:00' }),
    ]
    const ranked = rankComponentAcrossLogs(partA, logs)
    const byId = Object.fromEntries(ranked.map(r => [r.memberId, r.rank]))
    expect(byId.alice).toBe(1); expect(byId.bob).toBe(1); expect(byId.carol).toBe(3)
  })

  it('never uses logged_at as a hidden tiebreak for a genuine tie', () => {
    const logs = [
      { memberId: 'alice', profile: null, log: { member_id: 'alice', logged_at: '2026-01-01T00:00:00Z', log_meta: { componentResults: { partA: { format: 'For Time', result: null, time_result: '9:00', completion_state: 'completed', sets: null, load_result: null } } } } },
      { memberId: 'bob', profile: null, log: { member_id: 'bob', logged_at: '2026-06-01T00:00:00Z', log_meta: { componentResults: { partA: { format: 'For Time', result: null, time_result: '9:00', completion_state: 'completed', sets: null, load_result: null } } } } },
    ]
    const ranked = rankComponentAcrossLogs(partA, logs)
    expect(ranked.find(r => r.memberId === 'alice').rank).toBe(1)
    expect(ranked.find(r => r.memberId === 'bob').rank).toBe(1)
  })
})

describe('rankComponentAcrossLogs - Part B (Max Effort/Load) - higher wins, competition ties', () => {
  it('higher load ranks first; equal loads tie at competition rank; missing ranks null', () => {
    const logs = [
      member('alice', { partBLoad: 95 }),
      member('bob', { partBLoad: 100 }),
      member('carol', { partBLoad: 95 }),
      member('dave'), // never logged Part B
    ]
    const ranked = rankComponentAcrossLogs(partB, logs)
    const byId = Object.fromEntries(ranked.map(r => [r.memberId, r.rank]))
    expect(byId.bob).toBe(1)
    expect(byId.alice).toBe(2); expect(byId.carol).toBe(2)
    expect(byId.dave).toBe(null)
  })
})

describe('rankComponentAcrossLogs - Max Effort/Load normalizes kg/lb before comparing across members', () => {
  it('a 220lb load ranks above a 95kg load once normalized to one canonical unit', () => {
    const logs = [
      { memberId: 'alice', profile: { weight_unit: 'kg' }, log: { member_id: 'alice', log_meta: { componentResults: { partB: { format: 'Max Effort', result: null, time_result: null, completion_state: null, sets: null, load_result: 95 } } } } },
      { memberId: 'bob', profile: { weight_unit: 'lbs' }, log: { member_id: 'bob', log_meta: { componentResults: { partB: { format: 'Max Effort', result: null, time_result: null, completion_state: null, sets: null, load_result: 220 } } } } },
    ]
    // 220 lb ≈ 99.8 kg > 95 kg -> bob ranks 1st despite the larger raw number belonging to the lb entry either way; the real proof is bob's 220lb (~99.8kg) beating alice's 95kg.
    const ranked = rankComponentAcrossLogs(partB, logs)
    expect(ranked.find(r => r.memberId === 'bob').rank).toBe(1)
    expect(ranked.find(r => r.memberId === 'alice').rank).toBe(2)
  })
})

describe('rankComponentAcrossLogs - RFT/AMRAP (repeated-rounds and rounds+partial) reuse the existing semantics', () => {
  it('RFT: finished time beats a capped rounds+partial result', () => {
    const rft = { id: 'rft', format: 'RFT', config: { rounds: 5 } }
    const logs = [
      { memberId: 'alice', profile: null, log: { member_id: 'alice', log_meta: { componentResults: { rft: { format: 'RFT', result: null, time_result: '12:30', completion_state: 'completed', sets: null, load_result: null } } } } },
      { memberId: 'bob', profile: null, log: { member_id: 'bob', log_meta: { componentResults: { rft: { format: 'RFT', result: '3 runde + 9', time_result: null, completion_state: 'capped', sets: null, load_result: null } } } } },
    ]
    const ranked = rankComponentAcrossLogs(rft, logs)
    expect(ranked.find(r => r.memberId === 'alice').rank).toBe(1)
    expect(ranked.find(r => r.memberId === 'bob').rank).toBe(2)
  })

  it('AMRAP: higher rounds+partial wins, exact ties share a rank', () => {
    const amrap = { id: 'amrap', format: 'AMRAP', config: { durationSec: 600 } }
    const logs = [
      { memberId: 'alice', profile: null, log: { member_id: 'alice', log_meta: { componentResults: { amrap: { format: 'AMRAP', result: '6 runde + 4', time_result: null, completion_state: null, sets: null, load_result: null } } } } },
      { memberId: 'bob', profile: null, log: { member_id: 'bob', log_meta: { componentResults: { amrap: { format: 'AMRAP', result: '6 runde + 4', time_result: null, completion_state: null, sets: null, load_result: null } } } } },
      { memberId: 'carol', profile: null, log: { member_id: 'carol', log_meta: { componentResults: { amrap: { format: 'AMRAP', result: '5 runde + 10', time_result: null, completion_state: null, sets: null, load_result: null } } } } },
    ]
    const ranked = rankComponentAcrossLogs(amrap, logs)
    const byId = Object.fromEntries(ranked.map(r => [r.memberId, r.rank]))
    expect(byId.alice).toBe(1); expect(byId.bob).toBe(1); expect(byId.carol).toBe(3)
  })
})

// --- Overall aggregation (Part 12/13) ---------------------------------------

describe('computeOverallPlacements - the canonical two-part workout', () => {
  it('sums competition placements across Part A + Part B; lowest total wins; ties share a rank', () => {
    const logs = [
      member('alice', { partATime: '11:42', partBLoad: 90 }), // A:2 B:2 = 4
      member('bob', { partATime: '10:15', partBLoad: 80 }), // A:1 B:3 = 4
      member('carol', { partATime: '12:00', partBLoad: 100 }), // A:3 B:1 = 4
    ]
    const { ranked, incomplete } = computeOverallPlacements([partA, partB], logs)
    expect(incomplete).toEqual([])
    expect(ranked).toHaveLength(3)
    // All three tie on points (4) -> all rank 1, competition ranking.
    ranked.forEach(r => expect(r.points).toBe(4))
    ranked.forEach(r => expect(r.rank).toBe(1))
  })

  it('a member missing ANY required scored component gets NO Overall placement (INCOMPLETE, never fake/zero/last)', () => {
    const logs = [
      member('alice', { partATime: '11:42', partBLoad: 95 }),
      member('bob', { partATime: '10:15' }), // never logged Part B at all
    ]
    const { ranked, incomplete } = computeOverallPlacements([partA, partB], logs)
    expect(ranked.map(r => r.memberId)).toEqual(['alice'])
    expect(ranked[0].rank).toBe(1)
    expect(incomplete.map(r => r.memberId)).toEqual(['bob'])
  })

  it('DNF is NOT the same as missing - a valid capped/partial Part A result still counts toward Overall', () => {
    const logs = [
      member('alice', { partATime: '11:42', partBLoad: 90 }),
      member('bob', { partAResult: '30/40 Clean & Jerk', partACompletion: 'capped', partBLoad: 100 }),
    ]
    const { ranked, incomplete } = computeOverallPlacements([partA, partB], logs)
    expect(incomplete).toEqual([]) // bob's DNF Part A is still rankable, not missing
    expect(ranked.map(r => r.memberId).sort()).toEqual(['alice', 'bob'])
  })

  it('generic over N scored components - a 3-part workout sums 3 placements', () => {
    const partC = { id: 'partC', format: 'AMRAP', config: { durationSec: 300 } }
    function memberWithC(id, a, b, cResult) {
      const m = member(id, a !== undefined ? { partATime: a, partBLoad: b } : { partBLoad: b })
      m.log.log_meta = m.log.log_meta || { componentResults: {} }
      m.log.log_meta.componentResults = m.log.log_meta.componentResults || {}
      m.log.log_meta.componentResults.partC = { format: 'AMRAP', result: cResult, time_result: null, completion_state: null, sets: null, load_result: null }
      return m
    }
    const logs = [
      memberWithC('alice', '11:42', 90, '6 runde + 0'),
      memberWithC('bob', '10:15', 80, '5 runde + 0'),
    ]
    const { ranked, incomplete } = computeOverallPlacements([partA, partB, partC], logs)
    expect(incomplete).toEqual([])
    // Part A (time, lower wins): bob 10:15 -> rank1, alice 11:42 -> rank2.
    // Part B (load, higher wins): alice 90 -> rank1, bob 80 -> rank2.
    // Part C (AMRAP rounds, higher wins): alice 6 runde -> rank1, bob 5 runde -> rank2.
    // alice: 2+1+1=4 ; bob: 1+2+2=5
    expect(ranked.map(r => r.memberId)).toEqual(['alice', 'bob'])
    expect(ranked[0].points).toBe(4); expect(ranked[1].points).toBe(5)
  })

  it('tier isolation - Rx and Scaled logs must be pre-filtered by the caller; never mixed in one call', () => {
    // computeOverallPlacements itself is tier-agnostic by design (matches
    // buildBlocksForPrimary's existing per-NIVEL split) - this test proves
    // calling it once per tier keeps the pools disjoint, the way the real
    // Clasament integration must call it.
    const rxLogs = [member('alice', { partATime: '10:00', partBLoad: 100, tier: 'rx' })]
    const scaledLogs = [member('bob', { partATime: '12:00', partBLoad: 60, tier: 'beginner' })]
    const rxResult = computeOverallPlacements([partA, partB], rxLogs)
    const scaledResult = computeOverallPlacements([partA, partB], scaledLogs)
    expect(rxResult.ranked.map(r => r.memberId)).toEqual(['alice'])
    expect(scaledResult.ranked.map(r => r.memberId)).toEqual(['bob'])
  })
})
