import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolveStructuredIntervalResult, parseIntervalStationKey } from './resultIntervalStructure'
import { intervalStationKey } from './workoutFormats'

// INC-08 - STRUCTURED INTERVAL RESULT DETAIL PROJECTION
// R × S score entries -> R semantic round groups × S station rows.
// FROZEN log evidence only (format_config_snapshot / sets), never the live WOD.
// No workout-id / date / movement-name / count hardcode.

const STRUCTURED_CFG = { workSec: 40, restSec: 20, rounds: 15, roundCount: 5, stationMode: 'per-interval', restPlacement: 'after-each-station' }

// build `sets` the way INC-07's structured logger does (intervalStationKey, round-major)
function structuredSets(roundCount, stationNames, valuesByRound) {
  const sets = {}
  for (let r = 1; r <= roundCount; r++) {
    stationNames.forEach((name, si) => {
      const v = valuesByRound?.[r - 1]?.[si]
      sets[intervalStationKey(r, si + 1, name)] = [{ reps: v == null ? '' : String(v), weight: '', completed: false }]
    })
  }
  return sets
}

const log = (over = {}) => ({
  format_snapshot: 'Intervals',
  format_config_snapshot: STRUCTURED_CFG,
  movements_snapshot: ['HSPU', 'Renegade Row', 'Shuttle Run'],
  sets: structuredSets(5, ['HSPU', 'Renegade Row', 'Shuttle Run']),
  ...over,
})

describe('INC-08 · parseIntervalStationKey', () => {
  it('round-trips intervalStationKey', () => {
    const k = intervalStationKey(3, 2, 'Renegade Row @ 17.5 kg')
    expect(parseIntervalStationKey(k)).toEqual({ roundIndex: 3, stationIndex: 2, name: 'Renegade Row @ 17.5 kg' })
  })
  it('null for a legacy flat key', () => {
    expect(parseIntervalStationKey('Rundă 7')).toBe(null)
    expect(parseIntervalStationKey('Min 3')).toBe(null)
    expect(parseIntervalStationKey('')).toBe(null)
  })
})

describe('INC-08 · resolveStructuredIntervalResult — structured', () => {
  it('5×3: 5 semantic rounds, 3 stations each, 15 entries (NOT 15 rounds)', () => {
    const r = resolveStructuredIntervalResult(log())
    expect(r.structured).toBe(true)
    expect(r.roundCount).toBe(5)
    expect(r.stationCount).toBe(3)
    expect(r.rounds).toHaveLength(5)
    expect(r.rounds.every((rd) => rd.stations.length === 3)).toBe(true)
    expect(r.expectedScoreEntryCount).toBe(15)
    expect(r.rounds.map((rd) => rd.roundIndex)).toEqual([1, 2, 3, 4, 5])
  })

  it('round-major mapping: values land in the exact round × station slot', () => {
    const vals = [[23, 4, 3], [5, 6, 23], [2, 3, 4], [5, 4, 32], [43, 43, 3]]
    const r = resolveStructuredIntervalResult(log({ sets: structuredSets(5, ['HSPU', 'Renegade Row', 'Shuttle Run'], vals) }))
    r.rounds.forEach((rd, ri) => rd.stations.forEach((st, si) => {
      expect(st.reps).toBe(String(vals[ri][si]))
    }))
    // sum matches the arithmetic total (mirrors INC-06 Total Reps aggregation)
    const total = vals.flat().reduce((a, b) => a + b, 0)
    const sum = r.rounds.flatMap((rd) => rd.stations).reduce((a, s) => a + Number(s.reps), 0)
    expect(sum).toBe(total)
  })

  it('station labels come from the frozen key names, positionally', () => {
    const r = resolveStructuredIntervalResult(log())
    expect(r.stationLabels).toEqual(['HSPU', 'Renegade Row', 'Shuttle Run'])
    expect(r.rounds[0].stations.map((s) => s.label)).toEqual(['HSPU', 'Renegade Row', 'Shuttle Run'])
  })

  it('4×2', () => {
    const cfg = { ...STRUCTURED_CFG, roundCount: 4, rounds: 8 }
    const r = resolveStructuredIntervalResult(log({ format_config_snapshot: cfg, sets: structuredSets(4, ['Bike', 'Burpees']) }))
    expect(r.rounds).toHaveLength(4)
    expect(r.stationCount).toBe(2)
    expect(r.expectedScoreEntryCount).toBe(8)
  })

  it('6×4', () => {
    const cfg = { ...STRUCTURED_CFG, roundCount: 6, rounds: 24 }
    const r = resolveStructuredIntervalResult(log({ format_config_snapshot: cfg, sets: structuredSets(6, ['Row', 'WB', 'T2B', 'Bike']) }))
    expect(r.rounds).toHaveLength(6)
    expect(r.stationCount).toBe(4)
    expect(r.expectedScoreEntryCount).toBe(24)
  })

  it('5×1 (single station, no double multiply)', () => {
    const cfg = { ...STRUCTURED_CFG, roundCount: 5, rounds: 5 }
    const r = resolveStructuredIntervalResult(log({ format_config_snapshot: cfg, sets: structuredSets(5, ['Bike']) }))
    expect(r.rounds).toHaveLength(5)
    expect(r.stationCount).toBe(1)
  })

  it('repeated movement: two "Bike" stations stay distinct by station index', () => {
    const cfg = { ...STRUCTURED_CFG, roundCount: 4, rounds: 8 }
    const vals = [[10, 20], [11, 21], [12, 22], [13, 23]]
    const r = resolveStructuredIntervalResult(log({ format_config_snapshot: cfg, sets: structuredSets(4, ['Bike', 'Bike'], vals) }))
    expect(r.stationCount).toBe(2)
    r.rounds.forEach((rd, ri) => {
      expect(rd.stations[0].reps).toBe(String(vals[ri][0]))
      expect(rd.stations[1].reps).toBe(String(vals[ri][1]))
      expect(rd.stations[0].reps).not.toBe(rd.stations[1].reps)
    })
  })

  it('partial: unlogged stations are null, never fabricated 0', () => {
    const sets = structuredSets(5, ['HSPU', 'Renegade Row', 'Shuttle Run'])
    // keep only the first 7 entries populated
    const keys = Object.keys(sets)
    keys.forEach((k, i) => { sets[k] = [{ reps: i < 7 ? String(i + 1) : '' }] })
    const r = resolveStructuredIntervalResult(log({ sets }))
    const flat = r.rounds.flatMap((rd) => rd.stations)
    expect(flat.filter((s) => s.reps != null)).toHaveLength(7)
    expect(flat.filter((s) => s.reps == null)).toHaveLength(8)
    expect(flat.some((s) => s.reps === '0')).toBe(false)
  })

  it('0 reps is a real value, not "missing"', () => {
    const vals = [[0, 5, 5], [5, 0, 5], [5, 5, 5], [5, 5, 5], [5, 5, 0]]
    const r = resolveStructuredIntervalResult(log({ sets: structuredSets(5, ['A', 'B', 'C'], vals) }))
    expect(r.rounds[0].stations[0].reps).toBe('0')
    expect(r.rounds[1].stations[1].reps).toBe('0')
    expect(r.rounds[4].stations[2].reps).toBe('0')
  })

  it('extra entries beyond R×S are surfaced, never rendered as rounds', () => {
    const sets = structuredSets(5, ['A', 'B', 'C'])
    sets[intervalStationKey(6, 1, 'A')] = [{ reps: '99' }] // round 6 - outside roundCount 5
    const r = resolveStructuredIntervalResult(log({ sets }))
    expect(r.rounds).toHaveLength(5)
    expect(r.extraEntries).toHaveLength(1)
    expect(r.extraEntries[0].roundIndex).toBe(6)
  })
})

describe('INC-08 · legacy / non-interval -> null (caller keeps flat rendering)', () => {
  it('legacy Intervals snapshot (rounds:15, no stationMode) -> null', () => {
    const r = resolveStructuredIntervalResult({
      format_snapshot: 'Intervals',
      format_config_snapshot: { rounds: 15, workSec: 40, restSec: 20 },
      sets: { 'Rundă 1': [{ reps: '10' }], 'Rundă 2': [{ reps: '12' }] },
    })
    expect(r).toBe(null)
  })

  it('legacy Tabata -> null', () => {
    expect(resolveStructuredIntervalResult({
      format_snapshot: 'Tabata',
      format_config_snapshot: { rounds: 8, workSec: 20, restSec: 10 },
      sets: { 'Rundă 1': [{ reps: '5' }] },
    })).toBe(null)
  })

  it('non-interval format (For Time) -> null', () => {
    expect(resolveStructuredIntervalResult({ format_snapshot: 'For Time', format_config_snapshot: {}, sets: {} })).toBe(null)
  })

  it('snapshot claims structured but sets keys are the flat legacy form -> null', () => {
    const r = resolveStructuredIntervalResult({
      format_snapshot: 'Intervals',
      format_config_snapshot: STRUCTURED_CFG,
      sets: { 'Rundă 1': [{ reps: '10' }], 'Rundă 15': [{ reps: '1' }] },
    })
    expect(r).toBe(null)
  })

  it('null / undefined log -> null', () => {
    expect(resolveStructuredIntervalResult(null)).toBe(null)
    expect(resolveStructuredIntervalResult(undefined)).toBe(null)
  })
})

describe('INC-08 · P10 - frozen snapshot wins over the live workout', () => {
  it('the resolver reads ONLY the log; there is no workout argument', () => {
    // frozen roundCount 4 - even if "today's" workout says 6, the projection is 4
    const cfg = { ...STRUCTURED_CFG, roundCount: 4, rounds: 8 }
    const r = resolveStructuredIntervalResult(log({ format_config_snapshot: cfg, sets: structuredSets(4, ['Bike', 'Row']) }))
    expect(r.roundCount).toBe(4)
    expect(resolveStructuredIntervalResult.length).toBe(1) // arity 1 - log only
  })

  it('frozen station name survives a later WOD movement change', () => {
    const r = resolveStructuredIntervalResult(log({
      format_config_snapshot: { ...STRUCTURED_CFG, roundCount: 2, rounds: 6 },
      sets: structuredSets(2, ['Bike', 'Renegade Row', 'Shuttle Run']),
    }))
    expect(r.stationLabels[0]).toBe('Bike')
  })
})

describe('INC-08 · variant', () => {
  it('an Intermediate structured log projects its own frozen stations', () => {
    const r = resolveStructuredIntervalResult({
      ...log(),
      variant_level: 'Intermediate',
      sets: structuredSets(5, ['HSPU', 'DB Row', '100m Shuttle Run']),
    })
    expect(r.stationLabels).toEqual(['HSPU', 'DB Row', '100m Shuttle Run'])
  })
})

describe('INC-08 · no hardcode', () => {
  it('module source contains no workout-id / incident-movement / fixed-count literals', () => {
    const src = readFileSync('src/resultIntervalStructure.js', 'utf8').replace(/\/\/.*$/gm, '')
    expect(src).not.toMatch(/2ed71d47/)
    expect(src).not.toMatch(/Handstand Push-up|Renegade Row|Shuttle run/)
    expect(src).not.toMatch(/roundCount\s*===?\s*5|stationCount\s*===?\s*3/)
  })
})
