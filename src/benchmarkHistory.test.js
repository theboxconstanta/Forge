import { describe, it, expect } from 'vitest'
import {
  groupLogsByBenchmark, groupLogsByTier, benchmarkScoreValue, benchmarkScoreDisplay,
  deriveBenchmarkTierSummary, deriveBenchmarkSummary, buildBenchmarkListEntries,
  buildCurrentBenchmarkBests, buildRecentBenchmarkProgress,
} from './benchmarkHistory'

// Member Performance, Phase 1 (Benchmark History) - adversarial case
// coverage mirrors MEMBER_PERFORMANCE_ADVERSARIAL_MATRIX.md cases 6-8,
// 12/13, 29, 41-44.

function log(overrides) {
  return {
    id: overrides.id || Math.random().toString(36),
    member_id: 'm1',
    benchmark_id: 'fran',
    variant_level: 'RX',
    format_snapshot: 'For Time',
    format_config_snapshot: {},
    time_result: null,
    result: null,
    sets: null,
    log_meta: null,
    completion_state: null,
    logged_at: '2026-01-01T10:00:00Z',
    profile: { weight_unit: 'kg' },
    ...overrides,
  }
}

describe('groupLogsByBenchmark', () => {
  it('groups only logs with a benchmark_id, ignores non-benchmark logs', () => {
    const logs = [log({ id: 'a', benchmark_id: 'fran' }), log({ id: 'b', benchmark_id: null }), log({ id: 'c', benchmark_id: 'fran' })]
    const groups = groupLogsByBenchmark(logs)
    expect(groups.size).toBe(1)
    expect(groups.get('fran')).toHaveLength(2)
  })
})

describe('groupLogsByTier (Rx/variant separation - Architecture V1 frozen invariant)', () => {
  it('keeps Rx and Intermediate as separate buckets, never pooled', () => {
    const logs = [log({ variant_level: 'RX' }), log({ variant_level: 'Intermediate' }), log({ variant_level: 'RX' })]
    const groups = groupLogsByTier(logs)
    expect(groups.size).toBe(2)
    expect(groups.get('RX')).toHaveLength(2)
    expect(groups.get('Intermediate')).toHaveLength(1)
  })
  it('a log with no variant_level defaults to its own RX bucket, not a separate "null" bucket', () => {
    const groups = groupLogsByTier([log({ variant_level: null })])
    expect(groups.has('RX')).toBe(true)
    expect(groups.has(null)).toBe(false)
  })
})

describe('Adversarial case 6: Fran Rx repeated - best is not always latest', () => {
  it('3 attempts, latest is worse than best - best/latest/previous all correctly distinct', () => {
    const logs = [
      log({ id: 'a', time_result: '5:00', logged_at: '2026-01-01' }),
      log({ id: 'b', time_result: '4:45', logged_at: '2026-02-01' }), // best
      log({ id: 'c', time_result: '5:10', logged_at: '2026-03-01' }), // latest, worse than best
    ]
    const summary = deriveBenchmarkTierSummary(logs)
    expect(summary.best.id).toBe('b')
    expect(summary.latest.id).toBe('c')
    expect(summary.previous.id).toBe('b')
    expect(summary.isLatestBest).toBe(false)
    expect(summary.change.direction).toBe('worse')
    expect(summary.change.magnitude).toBe(25) // 5:10 - 4:45 = 25s
    expect(summary.change.unit).toBe('seconds')
  })
})

describe('Adversarial case 7: Fran Scaled then Rx - tiers never pooled into one best', () => {
  it('Rx best is 4:55, not contaminated by a faster Intermediate result', () => {
    const logs = [
      log({ id: 'rx1', variant_level: 'RX', time_result: '5:12', logged_at: '2026-01-01' }),
      log({ id: 'int1', variant_level: 'Intermediate', time_result: '4:20', logged_at: '2026-02-01' }),
      log({ id: 'rx2', variant_level: 'RX', time_result: '4:55', logged_at: '2026-03-01' }),
    ]
    const summary = deriveBenchmarkSummary(logs)
    expect(summary.RX.best.id).toBe('rx2')
    expect(summary.RX.attemptCount).toBe(2)
    expect(summary.Intermediate.best.id).toBe('int1')
    expect(summary.Intermediate.attemptCount).toBe(1)
  })
})

describe('Adversarial case 8: capped then completed', () => {
  it('a completed result always beats a capped result, inherited from sortSectionLogs', () => {
    const logs = [
      log({ id: 'capped', time_result: null, result: '18 rounds', completion_state: 'capped', logged_at: '2026-01-01' }),
      log({ id: 'completed', time_result: '7:50', result: null, completion_state: 'completed', logged_at: '2026-02-01' }),
    ]
    const summary = deriveBenchmarkTierSummary(logs)
    expect(summary.best.id).toBe('completed')
    expect(summary.attemptCount).toBe(2) // both remain in history
    expect(summary.history).toHaveLength(2)
  })
})

describe('One attempt (mission §41) - no fake improvement/0%', () => {
  it('single log: best=latest=that log, previous is null, no change object fabricated', () => {
    const only = log({ id: 'solo', time_result: '5:00' })
    const summary = deriveBenchmarkTierSummary([only])
    expect(summary.best.id).toBe('solo')
    expect(summary.latest.id).toBe('solo')
    expect(summary.previous).toBeNull()
    expect(summary.change).toBeNull()
    expect(summary.attemptCount).toBe(1)
  })
})

describe('Two attempts (mission §42) - best vs latest must never be confused', () => {
  it('latest attempt worse than an earlier best is never mislabeled as "Best"', () => {
    const logs = [
      log({ id: 'better', time_result: '4:45', logged_at: '2026-01-01' }),
      log({ id: 'worse', time_result: '5:10', logged_at: '2026-02-01' }),
    ]
    const summary = deriveBenchmarkTierSummary(logs)
    expect(summary.latest.id).toBe('worse')
    expect(summary.best.id).toBe('better')
    expect(summary.isLatestBest).toBe(false)
  })
})

describe('Equal best / tie (mission §29 and §69)', () => {
  it('two identical time results: change direction is "same", not a false "better"/"worse"', () => {
    const logs = [
      log({ id: 'a', time_result: '5:00', logged_at: '2026-01-01' }),
      log({ id: 'b', time_result: '5:00', logged_at: '2026-02-01' }),
    ]
    const summary = deriveBenchmarkTierSummary(logs)
    expect(summary.change.direction).toBe('same')
    expect(summary.change.magnitude).toBeNull()
  })
})

describe('TOTAL_REPS family (Tabata/Intervals/Death By) benchmark repeat', () => {
  it('606 reps beats 590 beats 620 correctly - reuses setsDisplayScore, never reimplemented', () => {
    const sets620 = { 'Min 1': [{ reps: '620', weight: '' }] }
    const sets590 = { 'Min 1': [{ reps: '590', weight: '' }] }
    const sets606 = { 'Min 1': [{ reps: '606', weight: '' }] }
    const logs = [
      log({ id: 'a', format_snapshot: 'Intervals', format_config_snapshot: { scoringMode: 'Total Reps' }, sets: sets606, logged_at: '2026-01-01' }),
      log({ id: 'b', format_snapshot: 'Intervals', format_config_snapshot: { scoringMode: 'Total Reps' }, sets: sets590, logged_at: '2026-02-01' }),
      log({ id: 'c', format_snapshot: 'Intervals', format_config_snapshot: { scoringMode: 'Total Reps' }, sets: sets620, logged_at: '2026-03-01' }),
    ]
    const summary = deriveBenchmarkTierSummary(logs)
    expect(summary.best.id).toBe('c')
    expect(benchmarkScoreValue(summary.best)).toBe(620)
    expect(benchmarkScoreDisplay(summary.best)).toBe('620 reps')
    expect(summary.change.direction).toBe('better') // 590 -> 620
    expect(summary.change.magnitude).toBe(30)
    expect(summary.change.unit).toBe('reps')
  })
})

describe('Load benchmark (sets family, weight-scored)', () => {
  it('105kg beats 100kg, displayed with kg suffix, magnitude in kg', () => {
    const logs = [
      log({ id: 'a', format_snapshot: 'Weightlifting', format_config_snapshot: {}, sets: { Snatch: [{ reps: '1', weight: '100' }] }, logged_at: '2026-01-01' }),
      log({ id: 'b', format_snapshot: 'Weightlifting', format_config_snapshot: {}, sets: { Snatch: [{ reps: '1', weight: '105' }] }, logged_at: '2026-02-01' }),
    ]
    const summary = deriveBenchmarkTierSummary(logs)
    expect(summary.best.id).toBe('b')
    expect(benchmarkScoreDisplay(summary.best)).toBe('105kg')
    expect(summary.change.direction).toBe('better')
    expect(summary.change.magnitude).toBe(5)
    expect(summary.change.unit).toBe('kg')
  })
})

describe('AMRAP (ROUNDS_REPS) - no fabricated numeric delta, direction only', () => {
  it('8+2 beats 7+15: direction "better", magnitude intentionally null (mission #12/#13)', () => {
    const logs = [
      log({ id: 'a', format_snapshot: 'AMRAP', result: '7 rounds + 15 reps', logged_at: '2026-01-01' }),
      log({ id: 'b', format_snapshot: 'AMRAP', result: '8 rounds + 2 reps', logged_at: '2026-02-01' }),
    ]
    const summary = deriveBenchmarkTierSummary(logs)
    expect(summary.best.id).toBe('b')
    expect(summary.change.direction).toBe('better')
    expect(summary.change.magnitude).toBeNull()
    expect(summary.change.unit).toBeNull()
  })
})

describe('Track-only / hidden-leaderboard Results (mission §16-17, Adversarial cases 12-13)', () => {
  it('a log has no leaderboard_visible field referenced anywhere in this module - included unconditionally', () => {
    // No workout_sections join, no leaderboard_visible field on the log fixture at all -
    // proves inclusion is unconditional by construction, not by an explicit bypass check.
    const logs = [log({ id: 'hidden-section-log' })]
    const summary = deriveBenchmarkTierSummary(logs)
    expect(summary.attemptCount).toBe(1)
    expect(summary.best.id).toBe('hidden-section-log')
  })
})

describe('buildBenchmarkListEntries', () => {
  it('one row per benchmark, sorted by most-recently-performed, with display metadata joined', () => {
    const logs = [
      log({ id: 'a', benchmark_id: 'fran', logged_at: '2026-01-01' }),
      log({ id: 'b', benchmark_id: 'fran', logged_at: '2026-03-01' }),
      log({ id: 'c', benchmark_id: 'cindy', logged_at: '2026-02-01' }),
    ]
    const benchmarksById = new Map([
      ['fran', { canonical_name: 'Fran', category: 'girl' }],
      ['cindy', { canonical_name: 'Cindy', category: 'girl' }],
    ])
    const entries = buildBenchmarkListEntries(logs, benchmarksById)
    expect(entries.map((e) => e.benchmarkId)).toEqual(['fran', 'cindy'])
    expect(entries[0].displayName).toBe('Fran')
    expect(entries[0].attemptCount).toBe(2)
    expect(entries[1].attemptCount).toBe(1)
  })
  it('falls back to the log\'s own workout name when benchmark metadata failed to load', () => {
    const logs = [log({ id: 'a', benchmark_id: 'unknown-id', wods: { name: 'Fran' } })]
    const entries = buildBenchmarkListEntries(logs, new Map())
    expect(entries[0].displayName).toBe('Fran')
  })
})

// Member Performance, Phase 6 (Performance Overview) - Current Benchmark
// Bests + Recent Benchmark Progress.

describe('buildCurrentBenchmarkBests (mission §14/§21/§59)', () => {
  it('one best per (benchmark, tier), reusing deriveBenchmarkSummary - Rx and Intermediate never pooled', () => {
    const logs = [
      log({ id: 'a', benchmark_id: 'fran', variant_level: 'RX', time_result: '5:12', logged_at: '2026-01-01' }),
      log({ id: 'b', benchmark_id: 'fran', variant_level: 'RX', time_result: '4:47', logged_at: '2026-02-01' }),
      log({ id: 'c', benchmark_id: 'fran', variant_level: 'Intermediate', time_result: '4:20', logged_at: '2026-01-15' }),
    ]
    const benchmarksById = new Map([['fran', { canonical_name: 'Fran', category: 'girl' }]])
    const bests = buildCurrentBenchmarkBests(logs, benchmarksById)
    expect(bests).toHaveLength(2)
    const rx = bests.find((b) => b.tier === 'RX')
    const im = bests.find((b) => b.tier === 'Intermediate')
    expect(rx.best.id).toBe('b')
    expect(im.best.id).toBe('c')
    expect(rx.displayName).toBe('Fran')
  })

  it('across multiple benchmarks, one best entry per benchmark+tier', () => {
    const logs = [
      log({ id: 'a', benchmark_id: 'fran', time_result: '5:00' }),
      log({ id: 'b', benchmark_id: 'cindy', format_snapshot: 'AMRAP', result: '10 rounds + 5 reps' }),
    ]
    const bests = buildCurrentBenchmarkBests(logs, new Map())
    expect(bests.map((b) => b.benchmarkId).sort()).toEqual(['cindy', 'fran'])
  })
})

describe('buildRecentBenchmarkProgress (mission §29-31/§60-61)', () => {
  it('includes a benchmark+tier only when latest beats previous', () => {
    const logs = [
      log({ id: 'a', benchmark_id: 'fran', time_result: '5:12', logged_at: '2026-01-01' }),
      log({ id: 'b', benchmark_id: 'fran', time_result: '4:47', logged_at: '2026-02-01' }),
    ]
    const progress = buildRecentBenchmarkProgress(logs, new Map([['fran', { canonical_name: 'Fran', category: 'girl' }]]))
    expect(progress).toHaveLength(1)
    expect(progress[0].change.direction).toBe('better')
    expect(progress[0].displayName).toBe('Fran')
  })

  it('excludes a benchmark+tier when latest is WORSE than previous - never mislabels worsening as progress', () => {
    const logs = [
      log({ id: 'a', benchmark_id: 'fran', time_result: '4:47', logged_at: '2026-01-01' }),
      log({ id: 'b', benchmark_id: 'fran', time_result: '5:02', logged_at: '2026-02-01' }),
    ]
    const progress = buildRecentBenchmarkProgress(logs, new Map())
    expect(progress).toHaveLength(0)
  })

  it('excludes a one-attempt benchmark - no previous to compare against', () => {
    const logs = [log({ id: 'a', benchmark_id: 'fran', time_result: '5:00' })]
    const progress = buildRecentBenchmarkProgress(logs, new Map())
    expect(progress).toHaveLength(0)
  })

  it('excludes a benchmark+tier when latest EQUALS previous - "same" is not progress', () => {
    const logs = [
      log({ id: 'a', benchmark_id: 'fran', time_result: '5:00', logged_at: '2026-01-01' }),
      log({ id: 'b', benchmark_id: 'fran', time_result: '5:00', logged_at: '2026-02-01' }),
    ]
    const progress = buildRecentBenchmarkProgress(logs, new Map())
    expect(progress).toHaveLength(0)
  })
})
