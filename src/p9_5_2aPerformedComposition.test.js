import { describe, it, expect } from 'vitest'
import {
  buildPerformedPrescriptionDraft,
  validatePerformedPrescription,
  performedMatchesProgrammed,
  performedIsModified,
  performedCompositionGroups,
  performedEntriesForSource,
  addPerformedMovement,
  deletePerformedMovement,
  markSourceNotPerformed,
  restoreSourcePerformed,
  applyPerformedSubstitution,
  setPerformedMetricValue,
  composePerformedResultLines,
  resolveMovementCapability,
  PERFORMED_PRESCRIPTION_VERSION,
} from './prescriptionContract.js'

// Programmed RX: A (Burpee Pull-up, 10 reps), B (Row, 12 reps + cal cap), C repeated (Lunge x2).
const A = 'mi_a000000000000000000001'
const B = 'mi_b000000000000000000001'
const C1 = 'mi_c000000000000000000001'
const C2 = 'mi_c000000000000000000002'
const programmed = () => ({
  version: 1,
  variants: {
    rx: {
      movements: [
        { instanceId: A, name: 'Burpee Pull-up', canonicalMovementId: 'cm-bpu', reps: { mode: 'universal', value: 10 } },
        { instanceId: B, name: 'Row', canonicalMovementId: 'cm-row', reps: { mode: 'universal', value: 12 } },
        { instanceId: C1, name: 'Walking Lunge', canonicalMovementId: 'cm-lunge', reps: { mode: 'universal', value: 20 } },
        { instanceId: C2, name: 'Walking Lunge', canonicalMovementId: 'cm-lunge', reps: { mode: 'universal', value: 20 } },
      ],
    },
  },
})
const capReps = resolveMovementCapability({ allowed_prescription_metrics: ['reps'], default_prescription_metric: 'reps' })
const capLoad = resolveMovementCapability({ allowed_prescription_metrics: ['reps', 'load'], default_prescription_metric: 'load' })
const row = (id, name) => ({ id, name })

describe('P9.5.2A — v2 draft + validation', () => {
  it('draft is v2 and anchors every entry to its own programmed instanceId', () => {
    const d = buildPerformedPrescriptionDraft({ doc: programmed(), variantKey: 'rx' })
    expect(d.version).toBe(2)
    expect(PERFORMED_PRESCRIPTION_VERSION).toBe(2)
    expect(d.movements.map(m => m.sourceInstanceId)).toEqual([A, B, C1, C2])
    expect(validatePerformedPrescription(d)).toEqual({ valid: true, errors: [] })
  })

  it('rejects a v2 movement with no sourceInstanceId; accepts v1 without one', () => {
    expect(validatePerformedPrescription({ version: 2, movements: [{ instanceId: 'x', name: 'X' }] }).valid).toBe(false)
    expect(validatePerformedPrescription({ version: 1, movements: [{ instanceId: 'x', name: 'X' }] }).valid).toBe(true)
  })

  it('accepts a notPerformed sentinel with no metric specs', () => {
    const d = { version: 2, variantKey: 'rx', sectionId: null, source: 'performed', movements: [
      { instanceId: 'np1', sourceInstanceId: A, name: 'Burpee Pull-up', notPerformed: true },
    ] }
    expect(validatePerformedPrescription(d).valid).toBe(true)
  })
})

describe('P9.5.2A — T1/T7 normalization', () => {
  it('T1 untouched draft resolves equal to programmed → matches (store NULL)', () => {
    const d = buildPerformedPrescriptionDraft({ doc: programmed(), variantKey: 'rx' })
    expect(performedMatchesProgrammed(d, programmed(), 'rx', null)).toBe(true)
    expect(performedIsModified(d, programmed(), 'rx', null)).toBe(false)
  })

  it('T7 add then delete the added → back to programmed → matches', () => {
    let d = buildPerformedPrescriptionDraft({ doc: programmed(), variantKey: 'rx' })
    d = addPerformedMovement(d, A, row('cm-rr', 'Ring Row'), capReps, { inheritReps: true })
    expect(performedMatchesProgrammed(d, programmed(), 'rx', null)).toBe(false)
    const added = performedEntriesForSource(d, A).find(e => e.name === 'Ring Row')
    const res = deletePerformedMovement(d, added.instanceId)
    expect(res.blockedLastMovement).toBe(false)
    expect(performedMatchesProgrammed(res.doc, programmed(), 'rx', null)).toBe(true)
  })
})

describe('P9.5.2A — T3/T4/T5/T6 composition', () => {
  it('T3 add one → B appears directly under A, inherits A reps', () => {
    let d = buildPerformedPrescriptionDraft({ doc: programmed(), variantKey: 'rx' })
    d = addPerformedMovement(d, A, row('cm-rr', 'Ring Row'), capReps, { inheritReps: true })
    expect(d.movements.map(m => m.name)).toEqual(['Burpee Pull-up', 'Ring Row', 'Row', 'Walking Lunge', 'Walking Lunge'])
    const rr = d.movements[1]
    expect(rr.sourceInstanceId).toBe(A)
    expect(rr.reps).toEqual({ mode: 'universal', value: 10 })
  })

  it('T4 add two keeps insertion order A,X,Y', () => {
    let d = buildPerformedPrescriptionDraft({ doc: programmed(), variantKey: 'rx' })
    d = addPerformedMovement(d, A, row('x', 'X'), capReps, { inheritReps: true })
    d = addPerformedMovement(d, A, row('y', 'Y'), capReps, { inheritReps: true })
    expect(performedEntriesForSource(d, A).map(e => e.name)).toEqual(['Burpee Pull-up', 'X', 'Y'])
  })

  it('T6 add B + add C then delete original A → group is [Ring Row, Sit-up], provenance A kept', () => {
    let d = buildPerformedPrescriptionDraft({ doc: programmed(), variantKey: 'rx' })
    d = addPerformedMovement(d, A, row('cm-rr', 'Ring Row'), capReps, { inheritReps: true })
    d = addPerformedMovement(d, A, row('cm-su', 'Sit-up'), capReps, { inheritReps: true })
    const del = deletePerformedMovement(d, A)
    expect(del.blockedLastMovement).toBe(false)
    const g = performedCompositionGroups(del.doc).find(x => x.sourceInstanceId === A)
    expect(g.entries.map(e => e.name)).toEqual(['Ring Row', 'Sit-up'])
    expect(g.entries.every(e => e.sourceInstanceId === A)).toBe(true)
  })
})

describe('P9.5.2A — T9/T10 repeated programmed movements stay distinct', () => {
  it('add X under the FIRST Walking Lunge only', () => {
    let d = buildPerformedPrescriptionDraft({ doc: programmed(), variantKey: 'rx' })
    d = addPerformedMovement(d, C1, row('x', 'Reverse Lunge'), capReps, { inheritReps: true })
    expect(d.movements.map(m => m.name)).toEqual(['Burpee Pull-up', 'Row', 'Walking Lunge', 'Reverse Lunge', 'Walking Lunge'])
    expect(performedEntriesForSource(d, C1).map(e => e.name)).toEqual(['Walking Lunge', 'Reverse Lunge'])
    expect(performedEntriesForSource(d, C2).map(e => e.name)).toEqual(['Walking Lunge'])
  })

  it('add X under the SECOND Walking Lunge only', () => {
    let d = buildPerformedPrescriptionDraft({ doc: programmed(), variantKey: 'rx' })
    d = addPerformedMovement(d, C2, row('x', 'Reverse Lunge'), capReps, { inheritReps: true })
    expect(d.movements.map(m => m.name)).toEqual(['Burpee Pull-up', 'Row', 'Walking Lunge', 'Walking Lunge', 'Reverse Lunge'])
  })
})

describe('P9.5.2A — T11 duplicate performed movements survive', () => {
  it('A → B + B, both kept', () => {
    let d = buildPerformedPrescriptionDraft({ doc: programmed(), variantKey: 'rx' })
    d = { ...d, movements: d.movements.map(m => m.instanceId === A ? applyPerformedSubstitution(m, row('cm-rr', 'Ring Row'), capReps) : m) }
    d = addPerformedMovement(d, A, row('cm-rr', 'Ring Row'), capReps, { inheritReps: true })
    expect(performedEntriesForSource(d, A).map(e => e.name)).toEqual(['Ring Row', 'Ring Row'])
    expect(validatePerformedPrescription(d).valid).toBe(true)
  })
})

describe('P9.5.2A — T21/T22/T23/T24 Not Performed (D2=B)', () => {
  it('deleting the only entry for a source is BLOCKED', () => {
    const d = buildPerformedPrescriptionDraft({ doc: programmed(), variantKey: 'rx' })
    const res = deletePerformedMovement(d, B)
    expect(res.blockedLastMovement).toBe(true)
    expect(res.doc).toBe(d)
  })

  it('markSourceNotPerformed → one sentinel, never [] / 0 reps; never normalizes to NULL', () => {
    let d = buildPerformedPrescriptionDraft({ doc: programmed(), variantKey: 'rx' })
    d = markSourceNotPerformed(d, A, 'Burpee Pull-up')
    const g = performedCompositionGroups(d).find(x => x.sourceInstanceId === A)
    expect(g.notPerformed).toBe(true)
    expect(g.entries).toHaveLength(1)
    expect(g.entries[0].notPerformed).toBe(true)
    expect('reps' in g.entries[0]).toBe(false)
    expect(performedMatchesProgrammed(d, programmed(), 'rx', null)).toBe(false)
    expect(validatePerformedPrescription(d).valid).toBe(true)
  })

  it('restoreSourcePerformed → back to a single cloned entry → matches programmed', () => {
    let d = buildPerformedPrescriptionDraft({ doc: programmed(), variantKey: 'rx' })
    d = markSourceNotPerformed(d, A, 'Burpee Pull-up')
    d = restoreSourcePerformed(d, A, programmed().variants.rx.movements[0])
    expect(performedMatchesProgrammed(d, programmed(), 'rx', null)).toBe(true)
  })
})

describe('P9.5.2A — T12/T13 capability-gated fields on an added movement', () => {
  it('load-capable add seeds an empty universal load spec', () => {
    let d = buildPerformedPrescriptionDraft({ doc: programmed(), variantKey: 'rx' })
    d = addPerformedMovement(d, A, row('cm-db', 'DB Snatch'), capLoad, { inheritReps: true })
    const added = d.movements[1]
    expect(added.load).toEqual({ mode: 'universal', value: null, unit: 'kg' })
  })

  it('reps-only add has no load spec', () => {
    let d = buildPerformedPrescriptionDraft({ doc: programmed(), variantKey: 'rx' })
    d = addPerformedMovement(d, A, row('cm-su', 'Sit-up'), capReps, { inheritReps: true })
    expect('load' in d.movements[1]).toBe(false)
  })
})

describe('P9.5.2A — composePerformedResultLines with composition + notPerformed', () => {
  it('renders each performed child + a "not performed" line for a marked source', () => {
    let d = buildPerformedPrescriptionDraft({ doc: programmed(), variantKey: 'rx' })
    d = { ...d, movements: d.movements.map(m => m.instanceId === A ? applyPerformedSubstitution(m, row('cm-b', 'Burpee'), capReps) : m) }
    d = addPerformedMovement(d, A, row('cm-rr', 'Ring Row'), capReps, { inheritReps: true })
    d = markSourceNotPerformed(d, B, 'Row')
    const lines = composePerformedResultLines(d, null, { notPerformedSuffix: '— not performed' })
    expect(lines.some(l => /Burpee/.test(l))).toBe(true)
    expect(lines.some(l => /Ring Row/.test(l))).toBe(true)
    expect(lines).toContain('Row — not performed')
  })
})
