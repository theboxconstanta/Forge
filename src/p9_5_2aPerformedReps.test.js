import { describe, it, expect } from 'vitest'
import {
  buildPerformedPrescriptionDraft, addPerformedMovement, setPerformedMetricValue,
  performedMatchesProgrammed, performedIsModified, performedEntriesForSource,
  performedStationInstances, composePerformedResultLines, resolveMovementCapability,
  applyPerformedSubstitution,
} from './prescriptionContract.js'
import { resolveSequentialAmrapStations, sequentialAmrapTotalReps, autoCompleteSequentialProgress } from './sequentialAmrap.js'

const A = 'mi_a000000000000000000001'
const capReps = resolveMovementCapability({ allowed_prescription_metrics: ['reps'], default_prescription_metric: 'reps' })
const capRepsLoad = resolveMovementCapability({ allowed_prescription_metrics: ['reps', 'load'], default_prescription_metric: 'load' })
const capDist = resolveMovementCapability({ allowed_prescription_metrics: ['distance'], default_prescription_metric: 'distance' })
const row = (id, name) => ({ id, name })
const programmed = () => ({
  version: 1,
  variants: { rx: { movements: [
    { instanceId: A, name: 'Burpee Pull-up', canonicalMovementId: 'cm-bpu', reps: { mode: 'universal', value: 50 } },
  ] } },
})
const setReps = (doc, instanceId, n) => ({
  ...doc, movements: doc.movements.map(m => m.instanceId === instanceId ? setPerformedMetricValue(m, 'reps', n) : m),
})

describe('P9.5.2A — performed reps are an editable default, not locked (R1-R11)', () => {
  it('R1 50 A → 50 B + 50 C: default inheritance', () => {
    let d = buildPerformedPrescriptionDraft({ doc: programmed(), variantKey: 'rx' })
    d = { ...d, movements: d.movements.map(m => m.instanceId === A ? { ...m, name: 'Burpee' } : m) }
    d = addPerformedMovement(d, A, row('cm-rr', 'Ring Row'), capReps, { inheritReps: true })
    expect(performedEntriesForSource(d, A).map(e => e.reps?.value)).toEqual([50, 50])
  })

  it('R2/R3 change B and C reps → persisted', () => {
    let d = buildPerformedPrescriptionDraft({ doc: programmed(), variantKey: 'rx' })
    d = { ...d, movements: d.movements.map(m => m.instanceId === A ? { ...m, name: 'Burpee' } : m) }
    d = addPerformedMovement(d, A, row('cm-rr', 'Ring Row'), capReps, { inheritReps: true })
    const [b, c] = performedEntriesForSource(d, A)
    d = setReps(d, b.instanceId, 40)
    d = setReps(d, c.instanceId, 35)
    expect(performedEntriesForSource(d, A).map(e => e.reps.value)).toEqual([40, 35])
  })

  it('R4/R9 50 A → 40 B + 35 C: performed movements 40/35, programmed A still 50', () => {
    let d = buildPerformedPrescriptionDraft({ doc: programmed(), variantKey: 'rx' })
    d = { ...d, movements: d.movements.map(m => m.instanceId === A ? { ...m, name: 'Burpee' } : m) }
    d = addPerformedMovement(d, A, row('cm-rr', 'Ring Row'), capReps, { inheritReps: true })
    const [b, c] = performedEntriesForSource(d, A)
    d = setReps(setReps(d, b.instanceId, 40), c.instanceId, 35)
    expect(performedEntriesForSource(d, A).map(e => `${e.name}:${e.reps.value}`)).toEqual(['Burpee:40', 'Ring Row:35'])
    expect(programmed().variants.rx.movements[0].reps.value).toBe(50) // untouched
  })

  it('R6/R7 Journal / Leaderboard projection shows 40 / 35', () => {
    let d = buildPerformedPrescriptionDraft({ doc: programmed(), variantKey: 'rx' })
    d = { ...d, movements: d.movements.map(m => m.instanceId === A ? { ...m, name: 'Burpee' } : m) }
    d = addPerformedMovement(d, A, row('cm-rr', 'Ring Row'), capReps, { inheritReps: true })
    const [b, c] = performedEntriesForSource(d, A)
    d = setReps(setReps(d, b.instanceId, 40), c.instanceId, 35)
    const lines = composePerformedResultLines(d, null)
    expect(lines).toEqual(['40 Burpee', '35 Ring Row'])
  })

  it('R10 reps-only change 50 A → 40 A is Modified (not normalized to NULL)', () => {
    let d = buildPerformedPrescriptionDraft({ doc: programmed(), variantKey: 'rx' })
    d = setReps(d, A, 40)
    expect(performedMatchesProgrammed(d, programmed(), 'rx', null)).toBe(false)
    expect(performedIsModified(d, programmed(), 'rx', null)).toBe(true)
  })

  it('R11 restore 40 A → 50 A, identity unchanged → matches programmed (As Prescribed)', () => {
    let d = buildPerformedPrescriptionDraft({ doc: programmed(), variantKey: 'rx' })
    d = setReps(d, A, 40)
    d = setReps(d, A, 50)
    expect(performedMatchesProgrammed(d, programmed(), 'rx', null)).toBe(true)
  })
})

describe('P9.5.2A — capability awareness (R12/R13)', () => {
  it('R12 a REPS + LOAD movement seeds both specs on add', () => {
    let d = buildPerformedPrescriptionDraft({ doc: programmed(), variantKey: 'rx' })
    d = addPerformedMovement(d, A, row('cm-kbs', 'KB Swing'), capRepsLoad, { inheritReps: true })
    const kbs = performedEntriesForSource(d, A)[1]
    expect(kbs.reps?.value).toBe(50)
    expect(kbs.load).toEqual({ mode: 'universal', value: null, unit: 'kg' })
  })

  it('R13 a DISTANCE-only movement added under a rep source does NOT inherit reps', () => {
    let d = buildPerformedPrescriptionDraft({ doc: programmed(), variantKey: 'rx' })
    d = addPerformedMovement(d, A, row('cm-run', 'Run'), capDist, { inheritReps: true })
    const run = performedEntriesForSource(d, A)[1]
    expect('reps' in run).toBe(false)
    expect(run.distance).toEqual({ mode: 'universal', value: null, unit: 'm' })
  })
})

describe('P9.5.2A — edited reps flow into structured score (R14/R16)', () => {
  const Q_A = 'mi_seqA0000000000000001'
  const Q_B = 'mi_seqB0000000000000001'
  const seqProgrammed = () => ({
    version: 1,
    variants: { rx: { movements: [
      { instanceId: Q_A, name: 'Burpee Pull-up', reps: { mode: 'universal', value: 50 } },
      { instanceId: Q_B, name: 'KB Swing', reps: { mode: 'universal', value: 75 } },
    ] } },
  })

  it('R14 Sequential AMRAP: split A into Burpee 50 + Ring Row 35 → station targets follow the edit', () => {
    let d = buildPerformedPrescriptionDraft({ doc: seqProgrammed(), variantKey: 'rx' })
    d = { ...d, movements: d.movements.map(m => m.instanceId === Q_A ? { ...m, name: 'Burpee' } : m) }
    d = addPerformedMovement(d, Q_A, row('cm-rr', 'Ring Row'), capReps, { inheritReps: true })
    const [, c] = performedEntriesForSource(d, Q_A)
    d = setReps(d, c.instanceId, 35)
    const inst = performedStationInstances(d, seqProgrammed().variants.rx.movements)
    const { stations } = resolveSequentialAmrapStations({ instances: inst })
    expect(stations.map(s => `${s.name}:${s.target}`)).toEqual(['Burpee:50', 'Ring Row:35', 'KB Swing:75'])
    // reached KB Swing, did 10 → prior fixed stations auto-complete to their (edited) targets
    expect(autoCompleteSequentialProgress(stations, ['', '', '10'])).toEqual(['50', '35', '10'])
    expect(sequentialAmrapTotalReps(stations, ['', '', '10'])).toBe(95) // 50 + 35 + 10, NOT 50+50
  })

  it('R16 notPerformed stays distinct from reps 0', () => {
    let d = buildPerformedPrescriptionDraft({ doc: programmed(), variantKey: 'rx' })
    const zero = setReps(d, A, 0)
    expect(performedMatchesProgrammed(zero, programmed(), 'rx', null)).toBe(false)
    expect(zero.movements[0].notPerformed).toBeUndefined()
    expect(zero.movements[0].reps.value).toBe(0)
  })
})
