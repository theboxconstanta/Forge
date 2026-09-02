import { describe, it, expect } from 'vitest'
import { resolveStructuredIntervalResult } from './resultIntervalStructure.js'
import { computeSetsScore, intervalStationKey } from './workoutFormats.js'
import {
  buildPerformedPrescriptionDraft, addPerformedMovement, markSourceNotPerformed,
  performedStationInstances, resolveMovementCapability,
} from './prescriptionContract.js'
import {
  resolveSequentialAmrapStations, sequentialAmrapTotalReps, composeSequentialAmrapResult,
  parseSequentialAmrapResult, autoCompleteSequentialProgress,
} from './sequentialAmrap.js'

const capReps = resolveMovementCapability({ allowed_prescription_metrics: ['reps'], default_prescription_metric: 'reps' })
const row = (id, name) => ({ id, name })

// ---- Structured Intervals: 2 rounds x 2 stations (A=Thruster 10, B=Row 12) ----
const S_A = 'mi_intA0000000000000001'
const S_B = 'mi_intB0000000000000001'
const intervalProgrammed = () => ({
  version: 1,
  variants: { rx: { movements: [
    { instanceId: S_A, name: 'Thruster', canonicalMovementId: 'cm-t', reps: { mode: 'universal', value: 10 } },
    { instanceId: S_B, name: 'Row', canonicalMovementId: 'cm-r', reps: { mode: 'universal', value: 12 } },
  ] } },
})
const intervalLog = (sets) => ({
  format_snapshot: 'Intervals',
  format_config_snapshot: { stationMode: 'per-interval', roundCount: 2, scoringMode: 'Total Reps' },
  sets,
})

describe('P9.5.2A — S1/S2/S3/S4 structured interval per-cell composition', () => {
  it('S1 legacy interval (no pm) — 2x2 stays 2x2, single entry per cell, INC-08 shape', () => {
    const sets = {
      [intervalStationKey(1, 1, 'Thruster')]: [{ reps: '10' }],
      [intervalStationKey(1, 2, 'Row')]: [{ reps: '12' }],
      [intervalStationKey(2, 1, 'Thruster')]: [{ reps: '9' }],
      [intervalStationKey(2, 2, 'Row')]: [{ reps: '11' }],
    }
    const r = resolveStructuredIntervalResult(intervalLog(sets))
    expect(r.roundCount).toBe(2)
    expect(r.stationCount).toBe(2)
    expect(r.hasComposition).toBe(false)
    expect(r.rounds[0].stations[0].reps).toBe('10')
    expect(computeSetsScore('Intervals', { scoringMode: 'Total Reps' }, sets)).toBe(42)
  })

  it('S2/S3 station 1 split into Burpee + Ring Row, 10 + 10 each round — 2x2 preserved, cell reps summed', () => {
    const pm = (src, name) => ({ pm: { instanceId: `${name}-${src}`, sourceInstanceId: S_A, name, canonicalMovementId: null } })
    const sets = {
      [intervalStationKey(1, 1, 'Thruster')]: [{ reps: '10', ...pm(1, 'Burpee') }, { reps: '10', ...pm(1, 'Ring Row') }],
      [intervalStationKey(1, 2, 'Row')]: [{ reps: '12' }],
      [intervalStationKey(2, 1, 'Thruster')]: [{ reps: '10', ...pm(2, 'Burpee') }, { reps: '10', ...pm(2, 'Ring Row') }],
      [intervalStationKey(2, 2, 'Row')]: [{ reps: '12' }],
    }
    const r = resolveStructuredIntervalResult(intervalLog(sets))
    expect(r.roundCount).toBe(2)
    expect(r.stationCount).toBe(2)
    expect(r.hasComposition).toBe(true)
    const cell = r.rounds[0].stations[0]
    expect(cell.performedEntries.map(e => `${e.name}:${e.reps}`)).toEqual(['Burpee:10', 'Ring Row:10'])
    expect(cell.reps).toBe('20') // display aggregate
    // S4 — NO double count: score = (10+10 + 12) x2 = 64, not 84 (no programmed "10" row)
    expect(computeSetsScore('Intervals', { scoringMode: 'Total Reps' }, sets)).toBe(64)
  })

  it('S5 delete one performed child → cell total drops', () => {
    const pm = (name) => ({ pm: { instanceId: name, sourceInstanceId: S_A, name } })
    const sets = {
      [intervalStationKey(1, 1, 'Thruster')]: [{ reps: '10', ...pm('Burpee') }],
      [intervalStationKey(1, 2, 'Row')]: [{ reps: '12' }],
      [intervalStationKey(2, 1, 'Thruster')]: [{ reps: '10', ...pm('Burpee') }],
      [intervalStationKey(2, 2, 'Row')]: [{ reps: '12' }],
    }
    expect(computeSetsScore('Intervals', { scoringMode: 'Total Reps' }, sets)).toBe(44)
  })

  it('S6 Mark Not Performed station → structurally present, 0 contribution', () => {
    const sets = {
      [intervalStationKey(1, 1, 'Thruster')]: [{ reps: '', pm: { instanceId: 'np', sourceInstanceId: S_A, name: 'Thruster', notPerformed: true } }],
      [intervalStationKey(1, 2, 'Row')]: [{ reps: '12' }],
      [intervalStationKey(2, 1, 'Thruster')]: [{ reps: '', pm: { instanceId: 'np', sourceInstanceId: S_A, name: 'Thruster', notPerformed: true } }],
      [intervalStationKey(2, 2, 'Row')]: [{ reps: '12' }],
    }
    const r = resolveStructuredIntervalResult(intervalLog(sets))
    expect(r.roundCount).toBe(2)
    expect(r.stationCount).toBe(2)
    expect(r.rounds[0].stations[0].notPerformed).toBe(true)
    expect(r.rounds[0].stations[0].reps).toBe(null)
    expect(computeSetsScore('Intervals', { scoringMode: 'Total Reps' }, sets)).toBe(24)
  })

  it('S8/S9 repeated station names in different rounds stay distinct', () => {
    const sets = {
      [intervalStationKey(1, 1, 'Thruster')]: [{ reps: '10' }],
      [intervalStationKey(1, 2, 'Row')]: [{ reps: '12' }],
      [intervalStationKey(2, 1, 'Thruster')]: [{ reps: '8' }],
      [intervalStationKey(2, 2, 'Row')]: [{ reps: '11' }],
    }
    const r = resolveStructuredIntervalResult(intervalLog(sets))
    expect(r.rounds[0].stations[0].reps).toBe('10')
    expect(r.rounds[1].stations[0].reps).toBe('8')
  })

  it('S15/S16 backward compat — a legacy log renders unchanged; a new log carries composition', () => {
    const legacy = resolveStructuredIntervalResult(intervalLog({ [intervalStationKey(1, 1, 'Thruster')]: [{ reps: '10' }], [intervalStationKey(1, 2, 'Row')]: [{ reps: '12' }] }))
    expect(legacy.hasComposition).toBe(false)
    const withComp = resolveStructuredIntervalResult(intervalLog({ [intervalStationKey(1, 1, 'Thruster')]: [{ reps: '5', pm: { instanceId: 'x', sourceInstanceId: S_A, name: 'Burpee' } }] }))
    expect(withComp.hasComposition).toBe(true)
  })
})

// ---- Sequential AMRAP: chipper A(50 Burpee PU) → B(75 KBS) ----
const Q_A = 'mi_seqA0000000000000001'
const Q_B = 'mi_seqB0000000000000001'
const seqProgrammed = () => ({
  version: 1,
  variants: { rx: { movements: [
    { instanceId: Q_A, name: 'Burpee Pull-up', canonicalMovementId: 'cm-bpu', reps: { mode: 'universal', value: 50 } },
    { instanceId: Q_B, name: 'KB Swing', canonicalMovementId: 'cm-kbs', reps: { mode: 'universal', value: 75 } },
  ] } },
})

describe('P9.5.2A — S19/S22/S23 Sequential AMRAP from performed composition', () => {
  it('S19 split fixed station → each child contributes; total = actual work, no double count', () => {
    let d = buildPerformedPrescriptionDraft({ doc: seqProgrammed(), variantKey: 'rx' })
    // A performed as Burpee (50) + Ring Row (50)
    d = { ...d, movements: d.movements.map(m => m.instanceId === Q_A ? { ...m, name: 'Burpee', canonicalMovementId: 'cm-b' } : m) }
    d = addPerformedMovement(d, Q_A, row('cm-rr', 'Ring Row'), capReps, { inheritReps: true })
    const inst = performedStationInstances(d, seqProgrammed().variants.rx.movements)
    const { supported, stations } = resolveSequentialAmrapStations({ instances: inst })
    expect(supported).toBe(true)
    expect(stations.map(s => s.name)).toEqual(['Burpee', 'Ring Row', 'KB Swing'])
    // athlete reached KB Swing and did 30 there → prior fixed stations auto-complete
    const raw = ['', '', '30']
    const auto = autoCompleteSequentialProgress(stations, raw)
    expect(auto).toEqual(['50', '50', '30'])
    // S22 — total = 50 + 50 + 30 = 130, NOT 50 (programmed A) + 50 + 50 + 30
    expect(sequentialAmrapTotalReps(stations, raw)).toBe(130)
  })

  it('S23 save then reopen round-trips the split composition', () => {
    let d = buildPerformedPrescriptionDraft({ doc: seqProgrammed(), variantKey: 'rx' })
    d = { ...d, movements: d.movements.map(m => m.instanceId === Q_A ? { ...m, name: 'Burpee' } : m) }
    d = addPerformedMovement(d, Q_A, row('cm-rr', 'Ring Row'), capReps, { inheritReps: true })
    const inst = performedStationInstances(d, seqProgrammed().variants.rx.movements)
    const { stations } = resolveSequentialAmrapStations({ instances: inst })
    const result = composeSequentialAmrapResult(stations, ['50', '20', ''])
    const reopened = parseSequentialAmrapResult(result, stations)
    expect(reopened).toEqual(['50', '20', ''])
  })

  it('S21 not-reached station stays omitted; explicit 0 distinct', () => {
    let d = buildPerformedPrescriptionDraft({ doc: seqProgrammed(), variantKey: 'rx' })
    d = addPerformedMovement(d, Q_A, row('cm-rr', 'Ring Row'), capReps, { inheritReps: true })
    const inst = performedStationInstances(d, seqProgrammed().variants.rx.movements)
    const { stations } = resolveSequentialAmrapStations({ instances: inst })
    const result = composeSequentialAmrapResult(stations, ['50', '10', ''])
    expect(result).not.toMatch(/KB Swing/) // not reached → omitted
  })

  it('S20/S6 a NOT-PERFORMED sequential source → one station, contributes 0', () => {
    let d = buildPerformedPrescriptionDraft({ doc: seqProgrammed(), variantKey: 'rx' })
    d = markSourceNotPerformed(d, Q_A, 'Burpee Pull-up')
    const inst = performedStationInstances(d, seqProgrammed().variants.rx.movements)
    expect(inst[0].notPerformed).toBe(true)
    const { stations } = resolveSequentialAmrapStations({ instances: inst })
    expect(stations).toHaveLength(2)
    expect(sequentialAmrapTotalReps(stations, ['0', '40'])).toBe(40)
  })
})
