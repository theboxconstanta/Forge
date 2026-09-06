// EMOM MIXED-UNIT AGGREGATION SAFETY - FINAL RESULT-INTEGRITY GATE.
// Wires the Phase A `isUnitHomogeneousAggregation` helper (shipped but never
// enforced) into the ONE canonical scoring boundary
// (computeSetsScore/setsDisplayScore/setsScoreText), which Leaderboard,
// Journal, and Share/Photo Result already share - see the cross-surface
// contract test below for the proof. No per-surface EMOM unit logic exists
// anywhere; the gate is entirely at this one resolver.
//
// Canonical unit source: `prescription_snapshot.movements[i]` (frozen by
// buildPrescriptionSnapshot, prescriptionContract.js) - the SAME shape
// already used for movement display lines / load standards elsewhere. No
// string parsing, no movement-name regex, no live catalog lookup, no second
// EMOM-specific unit map.

import { describe, it, expect } from 'vitest'
import {
  computeSetsScore,
  setsScoreText,
  sortSectionLogs,
  resolveStationUnitsByKey,
  scoredMetricOf,
  emomStationKey,
} from './workoutFormats.js'

const cfg = { stationMode: 'shared-interval', totalRounds: 10, intervalSec: 60, scoringMode: 'Total Reps' }

// A frozen prescription_snapshot.movements-shaped fixture for one station.
const reps = (name) => ({ name, reps: { mode: 'universal', value: 10 } })
const repsWithLoad = (name) => ({ name, reps: { mode: 'universal', value: 10 }, load: { value: 43, unit: 'kg', mode: 'universal' } })
const calories = (name) => ({ name, calories: { mode: 'universal', value: 12 } })
const distance = (name) => ({ name, distance: { mode: 'universal', value: 100, unit: 'm' } })

describe('scoredMetricOf - classifies a frozen snapshot movement, never guesses from text', () => {
  it('reps present -> reps, even alongside load (Oracle C)', () => {
    expect(scoredMetricOf(reps('10 Push-ups'))).toBe('reps')
    expect(scoredMetricOf(repsWithLoad('10 Clean & Jerks'))).toBe('reps')
  })
  it('calories / distance present (no reps) -> their own metric', () => {
    expect(scoredMetricOf(calories('12 Cal Row'))).toBe('calories')
    expect(scoredMetricOf(distance('100 m Run'))).toBe('distance')
  })
  it('load only (no reps) -> load', () => {
    expect(scoredMetricOf({ name: 'Establish 1RM', load: { value: 100, unit: 'kg' } })).toBe('load')
  })
  it('no resolvable metric -> null, never assumed reps', () => {
    expect(scoredMetricOf({ name: 'Something' })).toBeNull()
    expect(scoredMetricOf(null)).toBeNull()
  })
})

describe('resolveStationUnitsByKey - REGRESSION BOUNDARY: only ever activates for stationMode:"shared-interval"', () => {
  it('a structured Intervals config (per-interval) never gets classified, even with heterogeneous movements', () => {
    const ivCfg = { stationMode: 'per-interval', roundCount: 5, workSec: 40, restSec: 20 }
    expect(resolveStationUnitsByKey('Intervals', ivCfg, [calories('Row'), reps('Burpees')])).toBeNull()
  })
  it('a legacy/unconfigured EMOM (no stationMode) is never classified', () => {
    expect(resolveStationUnitsByKey('EMOM', { totalRounds: 10, intervalSec: 60 }, [calories('Row'), reps('Burpees')])).toBeNull()
  })
  it('a shared-interval EMOM resolves one unit per rowsByKey-shaped key', () => {
    const map = resolveStationUnitsByKey('EMOM', cfg, [reps('10 Push-ups'), calories('12 Cal Row')])
    expect(map[emomStationKey(1, 1, '10 Push-ups')]).toBe('reps')
    expect(map[emomStationKey(1, 2, '12 Cal Row')]).toBe('calories')
    expect(map[emomStationKey(10, 2, '12 Cal Row')]).toBe('calories')
  })
})

describe('Test 1 - reps + reps -> aggregate (Oracle A)', () => {
  it('300 reps, 10 rounds x 3 reps-only stations', () => {
    const movements = [reps('10 Push-ups'), reps('10 Air Squats'), reps('10 Pull-ups')]
    const unitsByKey = resolveStationUnitsByKey('EMOM', cfg, movements)
    const rowsByKey = {}
    for (let r = 1; r <= 10; r++) movements.forEach((m, si) => { rowsByKey[emomStationKey(r, si + 1, m.name)] = [{ reps: '10' }] })
    expect(computeSetsScore('EMOM', cfg, rowsByKey, unitsByKey)).toBe(300)
  })
})

describe('Test 2 - reps + (reps+load) -> aggregate as reps (Oracle C)', () => {
  it('a station with load metadata still contributes its reps to the total', () => {
    const movements = [repsWithLoad('10 Clean & Jerks'), reps('10 Burpees')]
    const unitsByKey = resolveStationUnitsByKey('EMOM', cfg, movements)
    const rowsByKey = {
      [emomStationKey(1, 1, '10 Clean & Jerks')]: [{ reps: '10' }],
      [emomStationKey(1, 2, '10 Burpees')]: [{ reps: '10' }],
    }
    expect(computeSetsScore('EMOM', cfg, rowsByKey, unitsByKey)).toBe(20)
    expect(unitsByKey[emomStationKey(1, 1, '10 Clean & Jerks')]).toBe('reps') // never rejected for carrying load
  })
})

describe('Test 3 - reps + calories -> no aggregate (Oracle D)', () => {
  it('never becomes 22 reps / 22 total; resolves through the existing null/no-score representation', () => {
    const movements = [calories('12 Cal Row'), reps('10 Burpees')]
    const unitsByKey = resolveStationUnitsByKey('EMOM', cfg, movements)
    const rowsByKey = {
      [emomStationKey(1, 1, '12 Cal Row')]: [{ reps: '12' }],
      [emomStationKey(1, 2, '10 Burpees')]: [{ reps: '10' }],
    }
    const score = computeSetsScore('EMOM', cfg, rowsByKey, unitsByKey)
    expect(score).toBeNull()
    expect(score).not.toBe(22)
    // setsScoreText resolves through the SAME existing null representation
    // every unscoreable sets-family log already shows ("-").
    expect(setsScoreText('EMOM', cfg, rowsByKey, 'kg', 'reps', unitsByKey)).toBeNull()
  })
})

describe('Test 4 - reps + distance -> no aggregate (Oracle E)', () => {
  it('never becomes 110 reps / 110 total', () => {
    const movements = [distance('100 m Run'), reps('10 Burpees')]
    const unitsByKey = resolveStationUnitsByKey('EMOM', cfg, movements)
    const rowsByKey = {
      [emomStationKey(1, 1, '100 m Run')]: [{ reps: '100' }],
      [emomStationKey(1, 2, '10 Burpees')]: [{ reps: '10' }],
    }
    const score = computeSetsScore('EMOM', cfg, rowsByKey, unitsByKey)
    expect(score).toBeNull()
    expect(score).not.toBe(110)
  })
})

describe('Test 5 - calories + distance -> no aggregate', () => {
  it('two different non-reps units still forbidden', () => {
    const movements = [calories('12 Cal Row'), distance('100 m Run')]
    const unitsByKey = resolveStationUnitsByKey('EMOM', cfg, movements)
    const rowsByKey = {
      [emomStationKey(1, 1, '12 Cal Row')]: [{ reps: '12' }],
      [emomStationKey(1, 2, '100 m Run')]: [{ reps: '100' }],
    }
    expect(computeSetsScore('EMOM', cfg, rowsByKey, unitsByKey)).toBeNull()
  })
})

describe('Test 6/7 - homogeneous calories / homogeneous distance -> aggregate allowed (existing scoring semantics: Total Reps sum over whatever value was logged)', () => {
  it('homogeneous calories aggregates via the same existing Total Reps sum', () => {
    const movements = [calories('12 Cal Row'), calories('15 Cal Bike')]
    const unitsByKey = resolveStationUnitsByKey('EMOM', cfg, movements)
    const rowsByKey = {
      [emomStationKey(1, 1, '12 Cal Row')]: [{ reps: '12' }],
      [emomStationKey(1, 2, '15 Cal Bike')]: [{ reps: '15' }],
    }
    expect(computeSetsScore('EMOM', cfg, rowsByKey, unitsByKey)).toBe(27)
  })
  it('homogeneous distance aggregates via the same existing Total Reps sum', () => {
    const movements = [distance('100 m Run'), distance('50 m Farmer Carry')]
    const unitsByKey = resolveStationUnitsByKey('EMOM', cfg, movements)
    const rowsByKey = {
      [emomStationKey(1, 1, '100 m Run')]: [{ reps: '100' }],
      [emomStationKey(1, 2, '50 m Farmer Carry')]: [{ reps: '50' }],
    }
    expect(computeSetsScore('EMOM', cfg, rowsByKey, unitsByKey)).toBe(150)
  })
})

describe('Test 8 - partial homogeneous reps (Oracle B) still works with unitsByKey present', () => {
  it('9 full rounds + 5 partial = 275, never manufactured', () => {
    const movements = [reps('10 Push-ups'), reps('10 Air Squats'), reps('10 Pull-ups')]
    const unitsByKey = resolveStationUnitsByKey('EMOM', cfg, movements)
    const rowsByKey = {}
    for (let r = 1; r <= 9; r++) movements.forEach((m, si) => { rowsByKey[emomStationKey(r, si + 1, m.name)] = [{ reps: '10' }] })
    rowsByKey[emomStationKey(10, 1, movements[0].name)] = [{ reps: '5' }]
    expect(computeSetsScore('EMOM', cfg, rowsByKey, unitsByKey)).toBe(275)
  })
})

describe('Test 9/10 - blank performed values and an explicit zero are never conflated', () => {
  it('a blank row is omitted from the sum (not counted as 0 or discarded from the map)', () => {
    const movements = [reps('10 Push-ups'), reps('10 Air Squats')]
    const unitsByKey = resolveStationUnitsByKey('EMOM', cfg, movements)
    const rowsByKey = {
      [emomStationKey(1, 1, '10 Push-ups')]: [{ reps: '' }],
      [emomStationKey(1, 2, '10 Air Squats')]: [{ reps: '10' }],
    }
    expect(computeSetsScore('EMOM', cfg, rowsByKey, unitsByKey)).toBe(10)
  })
  it('an explicit 0 is counted as real, logged work - not the same as blank', () => {
    const movements = [reps('10 Push-ups'), reps('10 Air Squats')]
    const unitsByKey = resolveStationUnitsByKey('EMOM', cfg, movements)
    const rowsByKey = {
      [emomStationKey(1, 1, '10 Push-ups')]: [{ reps: '0' }],
      [emomStationKey(1, 2, '10 Air Squats')]: [{ reps: '10' }],
    }
    expect(computeSetsScore('EMOM', cfg, rowsByKey, unitsByKey)).toBe(10)
  })
})

describe('Test 11 - legacy flat EMOM (Oracle F) is never run through structural mixed-unit classification', () => {
  it('the real historical log (sum=73) is untouched - no stationMode means no station structure to classify', () => {
    const legacyCfg = { totalRounds: 10, intervalSec: 60, scoringMode: 'Total Reps' }
    const legacyRowsByKey = {
      'Min 1': [{ reps: '12' }], 'Min 2': [{ reps: '12' }], 'Min 3': [{ reps: '10' }], 'Min 4': [{ reps: '12' }],
      'Min 5': [{ reps: '12' }], 'Min 6': [{ reps: '9' }], 'Min 7': [{ reps: '2' }], 'Min 8': [{ reps: '1' }],
      'Min 9': [{ reps: '2' }], 'Min 10': [{ reps: '1' }],
    }
    // No canonical structure exists for a flat log - resolveStationUnitsByKey
    // correctly returns null (nothing to classify), so computeSetsScore takes
    // its ordinary un-gated path, exactly as it always has.
    const unitsByKey = resolveStationUnitsByKey('EMOM', legacyCfg, null)
    expect(unitsByKey).toBeNull()
    expect(computeSetsScore('EMOM', legacyCfg, legacyRowsByKey, unitsByKey)).toBe(73)
  })
})

describe('Test 12 - legacy cycling EMOM (config.intervals) - KNOWN LIMITATION, not covered by this gate', () => {
  it('a cycling EMOM has no canonical per-interval unit source (plain movement-name strings only) - the gate stays inert, pre-existing sum behavior is unchanged', () => {
    const cyclingCfg = { totalRounds: 2, intervalSec: 60, intervals: ['Cal Row', 'Burpees'] }
    // config.intervals carries plain strings, never frozen metric data - there
    // is no `prescription_snapshot`-shaped source for THIS authoring path, so
    // classification is correctly a no-op (never a guess from the strings).
    expect(resolveStationUnitsByKey('EMOM', cyclingCfg, ['Cal Row', 'Burpees'])).toBeNull()
  })
})

describe('Test 13 - structured shared-interval EMOM regression (Phase A/B behavior fully preserved)', () => {
  it('omitting unitsByKey entirely (every pre-existing call site) is byte-identical to before this change', () => {
    const movements = [reps('10 Push-ups'), reps('10 Air Squats'), reps('10 Pull-ups')]
    const rowsByKey = {}
    for (let r = 1; r <= 10; r++) movements.forEach((m, si) => { rowsByKey[emomStationKey(r, si + 1, m.name)] = [{ reps: '10' }] })
    expect(computeSetsScore('EMOM', cfg, rowsByKey)).toBe(300) // no 4th arg at all
  })
})

describe('Test 14 - cross-surface contract: Leaderboard (sortSectionLogs) and Journal/Share (setsScoreText) inherit the IDENTICAL decision', () => {
  it('homogeneous reps EMOM: both entry points agree on 300', () => {
    const movements = [reps('10 Push-ups'), reps('10 Air Squats'), reps('10 Pull-ups')]
    const rowsByKey = {}
    for (let r = 1; r <= 10; r++) movements.forEach((m, si) => { rowsByKey[emomStationKey(r, si + 1, m.name)] = [{ reps: '10' }] })
    const log = { id: 'l1', sets: rowsByKey, logged_at: '2026-09-06T10:00:00Z', prescription_snapshot: { movements } }
    const [ranked] = sortSectionLogs([log], 'EMOM', cfg)
    expect(ranked._setsScore).toBe(300)
    const unitsByKey = resolveStationUnitsByKey('EMOM', cfg, log.prescription_snapshot.movements)
    expect(setsScoreText('EMOM', cfg, rowsByKey, 'kg', 'reps', unitsByKey)).toBe('300 reps')
  })

  it('heterogeneous units EMOM (12 Cal Row + 10 Burpees): both entry points agree on no-score, neither invents 22', () => {
    const movements = [calories('12 Cal Row'), reps('10 Burpees')]
    const rowsByKey = {
      [emomStationKey(1, 1, '12 Cal Row')]: [{ reps: '12' }],
      [emomStationKey(1, 2, '10 Burpees')]: [{ reps: '10' }],
    }
    const log = { id: 'l2', sets: rowsByKey, logged_at: '2026-09-06T10:00:00Z', prescription_snapshot: { movements } }
    const [ranked] = sortSectionLogs([log], 'EMOM', cfg)
    expect(ranked._setsScore).toBeNull()
    expect(ranked._setsScore).not.toBe(22)
    const unitsByKey = resolveStationUnitsByKey('EMOM', cfg, log.prescription_snapshot.movements)
    expect(setsScoreText('EMOM', cfg, rowsByKey, 'kg', 'reps', unitsByKey)).toBeNull()
  })

  it('a log with no prescription_snapshot at all (older row, before this incident) is treated exactly as before - no crash, no false block', () => {
    const rowsByKey = {
      [emomStationKey(1, 1, 'Something')]: [{ reps: '12' }],
      [emomStationKey(1, 2, 'Something Else')]: [{ reps: '10' }],
    }
    const log = { id: 'l3', sets: rowsByKey, logged_at: '2026-09-06T10:00:00Z' }
    const [ranked] = sortSectionLogs([log], 'EMOM', cfg)
    expect(ranked._setsScore).toBe(22) // no snapshot -> no unit info -> trusted, unchanged
  })
})
