// EMOM STRUCTURED RESULT INTEGRITY - Phase A: pure structure/scoring helpers.
// Covers the additive 'shared-interval' stationMode (multiple movements
// sharing ONE undivided EMOM interval, e.g. 3 movements all inside the same
// 1:00 minute) added to resolveIntervalStructure/defaultRowsForFormat, and
// proves it reuses computeSetsScore's existing generic rowsByKey summation
// (owner rule: never invent a parallel EMOM scorer).
//
// Regression boundary (owner-mandated, tested explicitly below):
//   - Intervals/Tabata's existing 'per-interval' structured mode must be
//     byte-identical (same fixtures/assertions as INC-07).
//   - A legacy/unconfigured EMOM (no stationMode - every EMOM authored
//     before this work, including the one real historical log) must keep
//     generating the exact same flat "Min N" rows and the exact same score.

import { describe, it, expect } from 'vitest'
import {
  isStructuredInterval,
  resolveIntervalStructure,
  emomStationKey,
  intervalStationKey,
  defaultRowsForFormat,
  computeSetsScore,
  isUnitHomogeneousAggregation,
} from './workoutFormats.js'

describe('Regression boundary - Intervals/Tabata per-interval untouched', () => {
  it('isStructuredInterval still gates per-interval on stationMode+roundCount only', () => {
    expect(isStructuredInterval({ stationMode: 'per-interval', roundCount: 5 })).toBe(true)
    expect(isStructuredInterval({ stationMode: 'per-interval', roundCount: 0 })).toBe(false)
    expect(isStructuredInterval({ rounds: 8 })).toBe(false) // legacy Tabata/Intervals config
    expect(isStructuredInterval(null)).toBe(false)
  })

  it('resolveIntervalStructure per-interval duration formula is unchanged (each station its own timed slot)', () => {
    const iv = resolveIntervalStructure('Intervals', {
      stationMode: 'per-interval', roundCount: 5, workSec: 40, restSec: 20, restPlacement: 'after-each-station',
    }, ['Handstand Push-up', 'Renegade Row'])
    expect(iv.structured).toBe(true)
    expect(iv.roundCount).toBe(5)
    expect(iv.stationCount).toBe(2)
    expect(iv.scoreableIntervalCount).toBe(10)
    expect(iv.totalDurationSec).toBe(5 * 2 * (40 + 20)) // 600 - per-station timed, untouched formula
  })

  it('legacy (non-structured) Tabata/Intervals still resolves via the old flat branch', () => {
    const iv = resolveIntervalStructure('Tabata', { rounds: 8 }, [])
    expect(iv.structured).toBe(false)
    expect(iv.roundCount).toBe(8)
    expect(iv.scoreableIntervalCount).toBe(8)
  })

  it('intervalStationKey (Intervals/Tabata label) is untouched', () => {
    expect(intervalStationKey(1, 2, 'Renegade Row')).toBe('Rundă 1 · 2. Renegade Row')
  })
})

describe('EMOM shared-interval structure resolution (owner worked example: 3 movements, 10 minutes)', () => {
  const cfg = { stationMode: 'shared-interval', totalRounds: 10, intervalSec: 60 }
  const movements = ['10 Push-ups', '10 Air Squats', '10 Pull-ups']

  it('isStructuredInterval recognizes shared-interval via totalRounds (EMOM never authors roundCount)', () => {
    expect(isStructuredInterval(cfg)).toBe(true)
    expect(isStructuredInterval({ stationMode: 'shared-interval', totalRounds: 0 })).toBe(false)
  })

  it('resolves roundCount/stationCount/scoreableIntervalCount correctly - 10 x 3 = 30, never 3 sequential timed blocks', () => {
    const iv = resolveIntervalStructure('EMOM', cfg, movements)
    expect(iv.structured).toBe(true)
    expect(iv.roundCount).toBe(10)
    expect(iv.stationCount).toBe(3)
    expect(iv.scoreableIntervalCount).toBe(30)
  })

  it('totalDurationSec is roundCount x ONE shared intervalSec (600s), NOT roundCount x stationCount x intervalSec (1800s)', () => {
    const iv = resolveIntervalStructure('EMOM', cfg, movements)
    expect(iv.totalDurationSec).toBe(600)
    expect(iv.totalDurationSec).not.toBe(1800)
  })

  it('excludes a Rest line from the station list, exactly like per-interval', () => {
    const iv = resolveIntervalStructure('EMOM', cfg, ['10 Push-ups', 'Rest', '10 Air Squats'])
    expect(iv.stationCount).toBe(2)
    expect(iv.stations.map(s => s.name)).toEqual(['10 Push-ups', '10 Air Squats'])
  })

  it('a legacy EMOM config (no stationMode) never resolves as structured', () => {
    const iv = resolveIntervalStructure('EMOM', { totalRounds: 10, intervalSec: 60 }, movements)
    expect(iv.structured).toBe(false)
    expect(iv.roundCount).toBe(0) // legacy flat branch reads cfg.rounds, which EMOM never sets
  })
})

describe('emomStationKey - EMOM keeps its own "Min" labeling, not Intervals/Tabata\'s "Rundă"', () => {
  it('formats Min {minute} · {station}. {name}', () => {
    expect(emomStationKey(1, 1, '10 Push-ups')).toBe('Min 1 · 1. 10 Push-ups')
    expect(emomStationKey(10, 3, '10 Pull-ups')).toBe('Min 10 · 3. 10 Pull-ups')
  })
})

describe('defaultRowsForFormat("EMOM", ...) - structured rows additive, legacy flat rows untouched', () => {
  it('REGRESSION: a legacy/unconfigured EMOM still generates flat "Min N" rows exactly as before (totalRounds only)', () => {
    const rows = defaultRowsForFormat('EMOM', { totalRounds: 3 }, ['10 Push-ups', '10 Air Squats'])
    expect(Object.keys(rows)).toEqual(['Min 1', 'Min 2', 'Min 3'])
  })

  it('REGRESSION: a legacy cycling-movement EMOM (config.intervals) still generates "Min N · movement" exactly as before', () => {
    const rows = defaultRowsForFormat('EMOM', { totalRounds: 4, intervals: ['Burpees', 'Air Squats'] }, [])
    expect(Object.keys(rows)).toEqual(['Min 1 · Burpees', 'Min 2 · Air Squats', 'Min 3 · Burpees', 'Min 4 · Air Squats'])
  })

  it('a shared-interval EMOM generates roundCount x stationCount rows, round-major, one per movement per minute', () => {
    const rows = defaultRowsForFormat(
      'EMOM',
      { stationMode: 'shared-interval', totalRounds: 10, intervalSec: 60 },
      ['10 Push-ups', '10 Air Squats', '10 Pull-ups'],
    )
    const keys = Object.keys(rows)
    expect(keys).toHaveLength(30)
    expect(keys[0]).toBe('Min 1 · 1. 10 Push-ups')
    expect(keys[1]).toBe('Min 1 · 2. 10 Air Squats')
    expect(keys[2]).toBe('Min 1 · 3. 10 Pull-ups')
    expect(keys[29]).toBe('Min 10 · 3. 10 Pull-ups')
    Object.values(rows).forEach(r => expect(r).toEqual([{ weight: '', reps: '', completed: false }]))
  })
})

describe('Owner oracles A/B/E - computeSetsScore reused verbatim, never a parallel EMOM scorer', () => {
  const cfg = { stationMode: 'shared-interval', totalRounds: 10, intervalSec: 60, scoringMode: 'Total Reps' }
  const movements = ['10 Push-ups', '10 Air Squats', '10 Pull-ups']

  it('Oracle A - 10 rounds fully completed (10 reps x 3 stations x 10 rounds) = 300, aggregatable', () => {
    const rowsByKey = {}
    for (let r = 1; r <= 10; r++) {
      movements.forEach((m, si) => { rowsByKey[emomStationKey(r, si + 1, m)] = [{ reps: '10', weight: '', completed: true }] })
    }
    expect(computeSetsScore('EMOM', cfg, rowsByKey)).toBe(300)
  })

  it('Oracle B - 9 full rounds + 5 reps into round 10 (partial, not manufactured) = 275', () => {
    const rowsByKey = {}
    for (let r = 1; r <= 9; r++) {
      movements.forEach((m, si) => { rowsByKey[emomStationKey(r, si + 1, m)] = [{ reps: '10', weight: '', completed: true }] })
    }
    // round 10: only the first station touched, 5 reps in; the other two
    // stations are genuinely blank (untouched), never backfilled with 10s.
    rowsByKey[emomStationKey(10, 1, movements[0])] = [{ reps: '5', weight: '', completed: false }]
    expect(computeSetsScore('EMOM', cfg, rowsByKey)).toBe(9 * 30 + 5) // 275
  })

  it('Oracle E - the exact real historical flat log (sum=73) is read identically, never reinterpreted as 300 or redistributed', () => {
    const legacyRowsByKey = {
      'Min 1': [{ reps: '12' }], 'Min 2': [{ reps: '12' }], 'Min 3': [{ reps: '10' }], 'Min 4': [{ reps: '12' }],
      'Min 5': [{ reps: '12' }], 'Min 6': [{ reps: '9' }], 'Min 7': [{ reps: '2' }], 'Min 8': [{ reps: '1' }],
      'Min 9': [{ reps: '2' }], 'Min 10': [{ reps: '1' }],
    }
    expect(computeSetsScore('EMOM', { totalRounds: 10, intervalSec: 60, scoringMode: 'Total Reps' }, legacyRowsByKey)).toBe(73)
    expect(computeSetsScore('EMOM', { totalRounds: 10, intervalSec: 60, scoringMode: 'Total Reps' }, legacyRowsByKey)).not.toBe(300)
  })
})

describe('Owner Oracle D - isUnitHomogeneousAggregation guards against a meaningless mixed-unit sum', () => {
  it('all-reps stations are homogeneous - a Total Reps sum is meaningful', () => {
    expect(isUnitHomogeneousAggregation(['reps', 'reps', 'reps'])).toBe(true)
  })

  it('real live risk (Calorie Row 12 cal + 10 Burpee): reps + calories is NOT homogeneous - a raw sum would be meaningless', () => {
    expect(isUnitHomogeneousAggregation(['calories', 'reps'])).toBe(false)
  })

  it('a single station, or no resolved metrics at all, is trivially homogeneous (nothing to conflict)', () => {
    expect(isUnitHomogeneousAggregation(['reps'])).toBe(true)
    expect(isUnitHomogeneousAggregation([])).toBe(true)
    expect(isUnitHomogeneousAggregation(null)).toBe(true)
  })

  it('never guesses from movement text - operates only on caller-resolved metrics (distance vs calories also flagged)', () => {
    expect(isUnitHomogeneousAggregation(['distance', 'calories'])).toBe(false)
    expect(isUnitHomogeneousAggregation(['distance', 'distance'])).toBe(true)
  })
})
