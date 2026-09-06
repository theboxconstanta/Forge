// EMOM MINUTE-PATTERN AUTHORING - Phase B: pure model + resolver.
// stationMode:'minute-pattern' is a THIRD, additive EMOM structural mode -
// movements are assigned to SPECIFIC minutes (patternMinute), and the
// pattern cycles across totalRounds. Distinct from 'shared-interval' (ALL
// movements repeat EVERY interval - INC-07/EMOM-structured era) and from
// legacy flat/cycling. Storage reuses the existing flat RX `instances`
// array (no second competing workout model) - each instance carries one
// new field, `patternMinute`.

import { describe, it, expect } from 'vitest'
import {
  resolveEmomTimeline, isMinutePatternEmom, emomStationKey,
  defaultRowsForFormat, resolveStationUnitsByKey, computeSetsScore, setsScoreText,
  scoredMetricOf,
} from './workoutFormats.js'

const mv = (name, patternMinute, extra = {}) => ({ name, patternMinute, reps: { mode: 'universal', value: 10 }, ...extra })

describe('isMinutePatternEmom / resolveEmomTimeline - basic recognition', () => {
  it('recognizes stationMode:"minute-pattern"', () => {
    expect(isMinutePatternEmom({ stationMode: 'minute-pattern' })).toBe(true)
    expect(isMinutePatternEmom({ stationMode: 'shared-interval' })).toBe(false)
    expect(isMinutePatternEmom({})).toBe(false)
    expect(isMinutePatternEmom(null)).toBe(false)
  })
  it('returns null for any non-EMOM format, even with the field set', () => {
    expect(resolveEmomTimeline('Intervals', { stationMode: 'minute-pattern', totalRounds: 3 }, [mv('Row', 0)])).toBeNull()
  })
  it('returns null for a legacy/shared-interval EMOM config (regression-safe no-op)', () => {
    expect(resolveEmomTimeline('EMOM', { totalRounds: 3, intervalSec: 60 }, [mv('Row', 0)])).toBeNull()
    expect(resolveEmomTimeline('EMOM', { stationMode: 'shared-interval', totalRounds: 3 }, [mv('Row', 0)])).toBeNull()
  })
})

describe('Oracle A - single movement cycling (M1 Push, M2 Squat, M3 Pull, repeat)', () => {
  const config = { stationMode: 'minute-pattern', totalRounds: 6, intervalSec: 60 }
  const movements = [mv('Push-ups', 0), mv('Air Squats', 1), mv('Pull-ups', 2)]

  it('patternLength is derived as 3, cycling across 6 effective minutes', () => {
    const timeline = resolveEmomTimeline('EMOM', config, movements)
    expect(timeline.patternLength).toBe(3)
    expect(timeline.effectiveMinutes).toHaveLength(6)
    expect(timeline.effectiveMinutes.map((m) => m.movements[0].name)).toEqual([
      'Push-ups', 'Air Squats', 'Pull-ups', 'Push-ups', 'Air Squats', 'Pull-ups',
    ])
  })

  it('never renders all three movements inside every minute (the exact regression this incident fixes)', () => {
    const timeline = resolveEmomTimeline('EMOM', config, movements)
    timeline.effectiveMinutes.forEach((m) => expect(m.movements).toHaveLength(1))
  })
})

describe('Oracle B - multi-movement minute (M1: Push+Squat, M2: Pull)', () => {
  const config = { stationMode: 'minute-pattern', totalRounds: 4, intervalSec: 60 }
  const movements = [mv('Push-ups', 0), mv('Air Squats', 0), mv('Pull-ups', 1)]

  it('MIN 1/3 carry both Push-ups+Air Squats, MIN 2/4 carry only Pull-ups', () => {
    const timeline = resolveEmomTimeline('EMOM', config, movements)
    expect(timeline.effectiveMinutes.map((m) => m.movements.map((mm) => mm.name))).toEqual([
      ['Push-ups', 'Air Squats'], ['Pull-ups'], ['Push-ups', 'Air Squats'], ['Pull-ups'],
    ])
  })
})

describe('Oracle G - partial final cycle (10-minute EMOM, 3-minute pattern)', () => {
  it('stops exactly at totalRounds - MIN 10 = pattern MIN 1, never an 11th/12th minute', () => {
    const config = { stationMode: 'minute-pattern', totalRounds: 10, intervalSec: 60 }
    const movements = [mv('A', 0), mv('B', 1), mv('C', 2)]
    const timeline = resolveEmomTimeline('EMOM', config, movements)
    expect(timeline.effectiveMinutes).toHaveLength(10)
    expect(timeline.effectiveMinutes[9].movements[0].name).toBe('A') // minute 10 -> pattern index (10-1)%3=0 -> A
    expect(timeline.effectiveMinutes.map((m) => m.movements[0].name)).toEqual(['A', 'B', 'C', 'A', 'B', 'C', 'A', 'B', 'C', 'A'])
  })
})

describe('Row generation (defaultRowsForFormat) - one row per movement per EFFECTIVE minute', () => {
  it('single-movement cycling: 6 rows total, keyed by effective minute, never 18 (6 minutes x 3 movements)', () => {
    const config = { stationMode: 'minute-pattern', totalRounds: 6, intervalSec: 60 }
    const movements = [mv('Push-ups', 0), mv('Air Squats', 1), mv('Pull-ups', 2)]
    const rows = defaultRowsForFormat('EMOM', config, movements)
    const keys = Object.keys(rows)
    expect(keys).toHaveLength(6)
    expect(keys[0]).toBe(emomStationKey(1, 1, 'Push-ups'))
    expect(keys[1]).toBe(emomStationKey(2, 1, 'Air Squats'))
    expect(keys[5]).toBe(emomStationKey(6, 1, 'Pull-ups'))
  })

  it('multi-movement minute: MIN 1 gets 2 rows, MIN 2 gets 1 row, per cycle', () => {
    const config = { stationMode: 'minute-pattern', totalRounds: 4, intervalSec: 60 }
    const movements = [mv('Push-ups', 0), mv('Air Squats', 0), mv('Pull-ups', 1)]
    const rows = defaultRowsForFormat('EMOM', config, movements)
    const keys = Object.keys(rows)
    expect(keys).toHaveLength(6) // (2+1) x 2 cycles
    expect(keys).toContain(emomStationKey(1, 1, 'Push-ups'))
    expect(keys).toContain(emomStationKey(1, 2, 'Air Squats'))
    expect(keys).toContain(emomStationKey(2, 1, 'Pull-ups'))
    expect(keys).toContain(emomStationKey(3, 1, 'Push-ups'))
  })

  it('REGRESSION - a shared-interval EMOM config is completely unaffected by the new branch', () => {
    const config = { stationMode: 'shared-interval', totalRounds: 3, intervalSec: 60 }
    const movements = [mv('Push-ups', undefined), mv('Air Squats', undefined), mv('Pull-ups', undefined)]
    const rows = defaultRowsForFormat('EMOM', config, movements)
    expect(Object.keys(rows)).toHaveLength(9) // 3 rounds x 3 stations, untouched
  })

  it('REGRESSION - legacy flat EMOM (no stationMode) is completely unaffected', () => {
    const rows = defaultRowsForFormat('EMOM', { totalRounds: 3 }, ['Burpees'])
    expect(Object.keys(rows)).toEqual(['Min 1', 'Min 2', 'Min 3'])
  })
})

describe('Oracle C/D/E/F - scoring over the effective minute-pattern timeline', () => {
  it('Oracle C - Total Reps: 10 + 9 + 7 = 26, not 3 sets, not 30', () => {
    const config = { stationMode: 'minute-pattern', totalRounds: 3, intervalSec: 60, scoringMode: 'Total Reps' }
    const movements = [mv('Push-ups', 0), mv('Air Squats', 1), mv('Pull-ups', 2)]
    const rowsByKey = {
      [emomStationKey(1, 1, 'Push-ups')]: [{ reps: '10' }],
      [emomStationKey(2, 1, 'Air Squats')]: [{ reps: '9' }],
      [emomStationKey(3, 1, 'Pull-ups')]: [{ reps: '7' }],
    }
    const unitsByKey = resolveStationUnitsByKey('EMOM', config, movements)
    expect(computeSetsScore('EMOM', config, rowsByKey, unitsByKey)).toBe(26)
    expect(setsScoreText('EMOM', config, rowsByKey, 'kg', 'reps', unitsByKey)).toBe('26 reps')
  })

  it('Oracle D - multi-movement minute contribution: MIN 1 Push=10, Squat=7 -> 17', () => {
    const config = { stationMode: 'minute-pattern', totalRounds: 1, intervalSec: 60, scoringMode: 'Total Reps' }
    const movements = [mv('Push-ups', 0), mv('Air Squats', 0)]
    const rowsByKey = {
      [emomStationKey(1, 1, 'Push-ups')]: [{ reps: '10' }],
      [emomStationKey(1, 2, 'Air Squats')]: [{ reps: '7' }],
    }
    const unitsByKey = resolveStationUnitsByKey('EMOM', config, movements)
    expect(computeSetsScore('EMOM', config, rowsByKey, unitsByKey)).toBe(17)
  })

  it('Oracle E - blank contributes nothing, never the programmed target: 10 + blank + 7 = 17', () => {
    const config = { stationMode: 'minute-pattern', totalRounds: 3, intervalSec: 60, scoringMode: 'Total Reps' }
    const movements = [mv('Push-ups', 0), mv('Air Squats', 1), mv('Pull-ups', 2)]
    const rowsByKey = {
      [emomStationKey(1, 1, 'Push-ups')]: [{ reps: '10' }],
      [emomStationKey(2, 1, 'Air Squats')]: [{ reps: '' }],
      [emomStationKey(3, 1, 'Pull-ups')]: [{ reps: '7' }],
    }
    const unitsByKey = resolveStationUnitsByKey('EMOM', config, movements)
    expect(computeSetsScore('EMOM', config, rowsByKey, unitsByKey)).toBe(17)
  })

  it('Oracle F - mixed unit (12 Cal Row + 10 Burpees) refuses an unsafe Total Reps aggregate', () => {
    const config = { stationMode: 'minute-pattern', totalRounds: 2, intervalSec: 60, scoringMode: 'Total Reps' }
    const movements = [
      { name: '12 Cal Row', patternMinute: 0, calories: { value: 12 } },
      { name: '10 Burpees', patternMinute: 1, reps: { value: 10 } },
    ]
    const rowsByKey = {
      [emomStationKey(1, 1, '12 Cal Row')]: [{ reps: '12' }],
      [emomStationKey(2, 1, '10 Burpees')]: [{ reps: '10' }],
    }
    const unitsByKey = resolveStationUnitsByKey('EMOM', config, movements)
    const score = computeSetsScore('EMOM', config, rowsByKey, unitsByKey)
    expect(score).toBeNull()
    expect(score).not.toBe(22)
  })

  it('Reps + load remains valid: scored quantity of a load-bearing movement is still reps', () => {
    expect(scoredMetricOf({ name: 'Clean & Jerk', reps: { value: 10 }, load: { value: 43 } })).toBe('reps')
    const config = { stationMode: 'minute-pattern', totalRounds: 2, intervalSec: 60, scoringMode: 'Total Reps' }
    const movements = [
      { name: '10 Clean & Jerks', patternMinute: 0, reps: { value: 10 }, load: { value: 43, unit: 'kg' } },
      mv('Burpees', 1),
    ]
    const rowsByKey = {
      [emomStationKey(1, 1, '10 Clean & Jerks')]: [{ reps: '10' }],
      [emomStationKey(2, 1, 'Burpees')]: [{ reps: '10' }],
    }
    const unitsByKey = resolveStationUnitsByKey('EMOM', config, movements)
    expect(computeSetsScore('EMOM', config, rowsByKey, unitsByKey)).toBe(20)
  })

  it('Total Calories: homogeneous calories across minutes sums correctly, labeled "cal" not "reps"', () => {
    const config = { stationMode: 'minute-pattern', totalRounds: 2, intervalSec: 60, scoringMode: 'Total Calories' }
    const movements = [
      { name: 'Row', patternMinute: 0, calories: { value: 12 } },
      { name: 'Bike', patternMinute: 1, calories: { value: 9 } },
    ]
    const rowsByKey = {
      [emomStationKey(1, 1, 'Row')]: [{ reps: '12' }],
      [emomStationKey(2, 1, 'Bike')]: [{ reps: '9' }],
    }
    const unitsByKey = resolveStationUnitsByKey('EMOM', config, movements)
    expect(setsScoreText('EMOM', config, rowsByKey, 'kg', 'reps', unitsByKey)).toBe('21 cal')
  })
})

describe('REGRESSION - Intervals/Tabata and the prior shared-interval EMOM incident are unaffected', () => {
  it('resolveStationUnitsByKey never activates minute-pattern logic for Intervals', () => {
    expect(resolveStationUnitsByKey('Intervals', { stationMode: 'minute-pattern', totalRounds: 3 }, [mv('Row', 0)])).toBeNull()
  })
  it('a shared-interval EMOM (prior incident) keeps its own unit resolution untouched', () => {
    const config = { stationMode: 'shared-interval', totalRounds: 2, intervalSec: 60, scoringMode: 'Total Reps' }
    const movements = [mv('Push-ups'), mv('Air Squats'), mv('Pull-ups')]
    const unitsByKey = resolveStationUnitsByKey('EMOM', config, movements)
    expect(Object.keys(unitsByKey).length).toBe(6) // 2 rounds x 3 stations, untouched shape
  })
})
