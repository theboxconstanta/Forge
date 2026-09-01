import { describe, it, expect } from 'vitest'
import {
  resolveIntervalStructure, isStructuredInterval, isRestLine,
  intervalStationKey, intervalTimelineLines,
  defaultRowsForFormat, computeSetsScore, estimateTotalDurationSec,
  formatMemberScheduleLines,
} from './workoutFormats'
import { legacyPayloadFromSections, createSection } from './wodSections'

// INC-07 - INTERVAL / STATION WORKOUT STRUCTURE
// roundCount × scoreableStationCount = scoreableIntervalCount, NEVER "N rounds".
// REST is timing structure, never a movement, never a score input.

const INCIDENT_STATIONS = ['Handstand Push-up', 'Renegade Row @ 17.5 kg', 'Shuttle Run']
const structuredCfg = (over = {}) => ({
  roundCount: 5, stationMode: 'per-interval', restPlacement: 'after-each-station',
  workSec: 40, restSec: 20, scoringMode: 'Total Reps', ...over,
})

describe('INC-07 · isRestLine', () => {
  it('matches rest lines, not movements', () => {
    for (const s of ['Rest', ':20 Rest', '2:00 Rest', '20s Rest', 'Rest 0:20', '  rest  ']) expect(isRestLine(s)).toBe(true)
    for (const s of ['Renegade Row @ 17.5 kg', 'Handstand Push-up', 'Rest Pause Bench', '', null]) expect(isRestLine(s)).toBe(false)
  })
})

describe('INC-07 · resolveIntervalStructure — structured', () => {
  const iv = resolveIntervalStructure('Intervals', structuredCfg(), INCIDENT_STATIONS)
  it('roundCount is the coach\'s real rounds, not the derived interval count', () => {
    expect(iv.structured).toBe(true)
    expect(iv.roundCount).toBe(5)
    expect(iv.stationCount).toBe(3)
    expect(iv.scoreableIntervalCount).toBe(15)
  })
  it('duration = roundCount × stationCount × (work + rest) = 900s', () => {
    expect(iv.totalDurationSec).toBe(900)
  })
  it('rest lines in the station list are excluded from stationCount', () => {
    const withRest = resolveIntervalStructure('Intervals', structuredCfg(), [...INCIDENT_STATIONS, ':20 Rest'])
    expect(withRest.stationCount).toBe(3)
  })
  it('accepts string or {name} stations', () => {
    const objs = resolveIntervalStructure('Intervals', structuredCfg(), INCIDENT_STATIONS.map((name) => ({ name })))
    expect(objs.stationCount).toBe(3)
  })
})

describe('INC-07 · resolveIntervalStructure — legacy stays legacy (INC-07 §21/§J)', () => {
  it('legacy Intervals (only format_config.rounds): flat, movements decorative', () => {
    // 2026-08-14 shape
    const iv = resolveIntervalStructure('Intervals', { rounds: 6 }, ['1:00 double-unders', '1:00 snatches'])
    expect(iv.structured).toBe(false)
    expect(iv.roundCount).toBe(6)
    expect(iv.scoreableIntervalCount).toBe(6)
    expect(iv.stationCount).toBe(0)
  })
  it('2026-08-21 shape (rounds:3, workSec:240, restSec:120): NOT reinterpreted', () => {
    const iv = resolveIntervalStructure('Intervals', { rounds: 3, workSec: 240, restSec: 120 }, Array(14).fill('x'))
    expect(iv.structured).toBe(false)
    expect(iv.scoreableIntervalCount).toBe(3)
  })
  it('Tabata never structured (no stationMode)', () => {
    expect(isStructuredInterval({ rounds: 8, workSec: 20, restSec: 10 })).toBe(false)
    const iv = resolveIntervalStructure('Tabata', { rounds: 8, workSec: 20, restSec: 10 }, ['Burpees'])
    expect(iv.structured).toBe(false)
    expect(iv.scoreableIntervalCount).toBe(8)
  })
  it('non-interval format → null', () => {
    expect(resolveIntervalStructure('AMRAP', {}, [])).toBe(null)
  })
})

describe('INC-07 · defaultRowsForFormat — logger inputs', () => {
  it('incident: 5 rounds × 3 stations = 15 inputs, round-major, ZERO rest inputs', () => {
    const rows = defaultRowsForFormat('Intervals', structuredCfg(), INCIDENT_STATIONS)
    const keys = Object.keys(rows)
    expect(keys).toHaveLength(15)
    expect(keys.every((k) => !isRestLine(k))).toBe(true)
    expect(keys[0]).toBe(intervalStationKey(1, 1, 'Handstand Push-up'))
    expect(keys[1]).toBe(intervalStationKey(1, 2, 'Renegade Row @ 17.5 kg'))
    expect(keys[3]).toBe(intervalStationKey(2, 1, 'Handstand Push-up')) // round-major
    expect(keys[14]).toBe(intervalStationKey(5, 3, 'Shuttle Run'))
  })
  it('4 rounds × 2 stations = 8 inputs', () => {
    const rows = defaultRowsForFormat('Intervals', structuredCfg({ roundCount: 4 }), ['Bike', 'Burpees'])
    expect(Object.keys(rows)).toHaveLength(8)
  })
  it('6 rounds × 4 stations = 24 inputs', () => {
    const rows = defaultRowsForFormat('Intervals', structuredCfg({ roundCount: 6 }), ['Row', 'Wall Balls', 'Toes-to-Bar', 'Bike'])
    expect(Object.keys(rows)).toHaveLength(24)
  })
  it('5 rounds × 1 station = 5 inputs (no double multiply)', () => {
    const rows = defaultRowsForFormat('Intervals', structuredCfg(), ['Bike'])
    expect(Object.keys(rows)).toHaveLength(5)
  })
  it('repeated movement in a round stays two distinct inputs', () => {
    const rows = defaultRowsForFormat('Intervals', structuredCfg({ roundCount: 5 }), ['Bike', 'Bike'])
    const keys = Object.keys(rows)
    expect(keys).toHaveLength(10)
    expect(keys[0]).toBe(intervalStationKey(1, 1, 'Bike'))
    expect(keys[1]).toBe(intervalStationKey(1, 2, 'Bike'))
    expect(keys[0]).not.toBe(keys[1])
  })
  it('legacy Intervals: flat "Rundă i" (unchanged)', () => {
    const rows = defaultRowsForFormat('Intervals', { rounds: 15 }, INCIDENT_STATIONS)
    expect(Object.keys(rows)).toEqual(Array.from({ length: 15 }, (_, i) => `Rundă ${i + 1}`))
  })
})

describe('INC-07 · score aggregation (INC-06 preserved)', () => {
  it('Total Reps = sum of all station values; test values computed not hardcoded', () => {
    const rows = defaultRowsForFormat('Intervals', structuredCfg(), INCIDENT_STATIONS)
    const vals = [
      [12, 14, 18], [11, 15, 19], [10, 14, 17], [10, 13, 18], [9, 13, 16],
    ]
    const keys = Object.keys(rows)
    keys.forEach((k, i) => { rows[k] = [{ reps: String(vals[Math.floor(i / 3)][i % 3]), weight: '', completed: false }] })
    const expectedSum = vals.flat().reduce((a, b) => a + b, 0)
    expect(computeSetsScore('Intervals', structuredCfg(), rows)).toBe(expectedSum)
  })
  it('save/reload: every value maps back to its exact round/station slot', () => {
    const rows = defaultRowsForFormat('Intervals', structuredCfg(), INCIDENT_STATIONS)
    const keys = Object.keys(rows)
    keys.forEach((k, i) => { rows[k] = [{ reps: String(i + 1) }] }) // 1..15
    // simulate reload: same keys regenerated, values re-read
    const regen = defaultRowsForFormat('Intervals', structuredCfg(), INCIDENT_STATIONS)
    Object.keys(regen).forEach((k, i) => { expect(rows[k][0].reps).toBe(String(i + 1)) })
  })
  it('a Lowest Reps interval is unchanged (ranking contract not touched)', () => {
    const rows = defaultRowsForFormat('Intervals', structuredCfg({ scoringMode: 'Lowest Reps' }), INCIDENT_STATIONS)
    Object.keys(rows).forEach((k, i) => { rows[k] = [{ reps: String(i + 5) }] })
    expect(computeSetsScore('Intervals', structuredCfg({ scoringMode: 'Lowest Reps' }), rows)).toBe(5)
  })
})

describe('INC-07 · duration', () => {
  it('estimateTotalDurationSec incident = 900 (15:00) via roundCount + stations', () => {
    expect(estimateTotalDurationSec('Intervals', structuredCfg(), INCIDENT_STATIONS)).toBe(900)
  })
  it('estimateTotalDurationSec off a stored row (rounds already derived) = 900 with 2 args', () => {
    expect(estimateTotalDurationSec('Intervals', { ...structuredCfg(), rounds: 15 })).toBe(900)
  })
  it('zero rest: roundCount × stations × work', () => {
    expect(estimateTotalDurationSec('Intervals', structuredCfg({ restSec: 0 }), INCIDENT_STATIONS)).toBe(600)
  })
})

describe('INC-07 · Home / Preview lines', () => {
  it('formatMemberScheduleLines: exactly "5 Rounds", not "15 Rounds", no Work/Rest schedule lines', () => {
    const { prescriptionLines } = formatMemberScheduleLines('Intervals', structuredCfg(), {})
    expect(prescriptionLines).toEqual(['5 Rounds'])
  })
  it('legacy Intervals still shows its own round count', () => {
    const { prescriptionLines } = formatMemberScheduleLines('Intervals', { rounds: 6 }, {})
    expect(prescriptionLines).toContain('6 Rounds')
  })
  it('intervalTimelineLines: 0:40 station / 0:20 Rest interleaved, incl. after last station', () => {
    const lines = intervalTimelineLines('Intervals', structuredCfg(), INCIDENT_STATIONS)
    expect(lines).toEqual([
      '0:40  Handstand Push-up', '0:20  Rest',
      '0:40  Renegade Row @ 17.5 kg', '0:20  Rest',
      '0:40  Shuttle Run', '0:20  Rest',
    ])
  })
  it('intervalTimelineLines: null for legacy (caller keeps existing rendering)', () => {
    expect(intervalTimelineLines('Intervals', { rounds: 15, workSec: 40, restSec: 20 }, INCIDENT_STATIONS)).toBe(null)
  })
  it('intervalTimelineLines: no Rest line when restSec is 0', () => {
    const lines = intervalTimelineLines('Intervals', structuredCfg({ restSec: 0 }), ['Bike'])
    expect(lines).toEqual(['0:40  Bike'])
  })
})

describe('INC-07 · Builder save path (legacyPayloadFromSections)', () => {
  const makeSection = (formatConfig, stationNames) => {
    const s = createSection('metcon', true)
    s.format = 'Intervals'
    s.formatConfig = formatConfig
    s.variants = { rx: { instances: stationNames.map((name) => ({ name, instanceId: name })), movements: [], weight: { male: '', female: '' }, note: '' } }
    return s
  }

  it('structured: derives rounds = roundCount × stations, stamps discriminators, duration 15:00', () => {
    const payload = legacyPayloadFromSections([makeSection({ roundCount: 5, workSec: 40, restSec: 20, scoringMode: 'Total Reps' }, INCIDENT_STATIONS)])
    expect(payload.type).toBe('Intervals')
    expect(payload.format_config.roundCount).toBe(5)
    expect(payload.format_config.stationMode).toBe('per-interval')
    expect(payload.format_config.restPlacement).toBe('after-each-station')
    expect(payload.format_config.rounds).toBe(15)
    expect(payload.duration).toBe('15:00')
  })

  it('save/reload invariant: roundCount stays 5, never 15', () => {
    const payload = legacyPayloadFromSections([makeSection({ roundCount: 5, workSec: 40, restSec: 20 }, INCIDENT_STATIONS)])
    // reload -> editor reads roundCount
    expect(payload.format_config.roundCount).toBe(5)
  })

  it('4×2 and 6×4', () => {
    const p42 = legacyPayloadFromSections([makeSection({ roundCount: 4, workSec: 30, restSec: 30 }, ['Bike', 'Burpees'])])
    expect(p42.format_config.rounds).toBe(8)
    const p64 = legacyPayloadFromSections([makeSection({ roundCount: 6, workSec: 60, restSec: 30 }, ['Row', 'WB', 'T2B', 'Bike'])])
    expect(p64.format_config.rounds).toBe(24)
  })

  it('legacy Intervals section (no roundCount) is left flat - NOT auto-structured', () => {
    const payload = legacyPayloadFromSections([makeSection({ rounds: 3, workSec: 240, restSec: 120 }, Array(14).fill('x'))])
    expect(payload.format_config.stationMode).toBeUndefined()
    expect(payload.format_config.roundCount).toBeUndefined()
    expect(payload.format_config.rounds).toBe(3)
  })

  it('REST is never a movement in the payload', () => {
    const payload = legacyPayloadFromSections([makeSection({ roundCount: 5, workSec: 40, restSec: 20 }, INCIDENT_STATIONS)])
    expect(payload.movements_rx.some((m) => isRestLine(m))).toBe(false)
  })
})

describe('INC-07 · fail-safe', () => {
  it('roundCount 0 / no stations → not structured, no crash', () => {
    expect(resolveIntervalStructure('Intervals', { stationMode: 'per-interval', roundCount: 0 }, []).structured).toBe(false)
    expect(defaultRowsForFormat('Intervals', structuredCfg({ roundCount: 5 }), [])).toBeTypeOf('object')
  })
})
