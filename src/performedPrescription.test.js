import { describe, it, expect } from 'vitest'
import {
  buildPerformedPrescriptionDraft,
  validatePerformedPrescription,
  performedMatchesProgrammed,
  performedIsModified,
  applyPerformedSubstitution,
  setPerformedMetricValue,
  resolveMovementCapability,
  PERFORMED_PRESCRIPTION_VERSION,
} from './prescriptionContract.js'
import { resultCompositionModified } from './workoutFormats.js'

// A programmed doc: RX variant, two movements — a loaded Thruster (sex-specific
// 43/30 kg) and a bodyweight Pull-up (reps only).
const programmed = () => ({
  version: 1,
  variants: {
    rx: {
      movements: [
        { instanceId: 'mi_thruster0000000000001', name: 'Thruster', canonicalMovementId: 'cm-thruster',
          reps: { mode: 'universal', value: 21 },
          load: { mode: 'sex_specific', male: 43, female: 30, unit: 'kg' } },
        { instanceId: 'mi_pullup00000000000001', name: 'Pull-up', canonicalMovementId: 'cm-pullup',
          reps: { mode: 'universal', value: 21 } },
      ],
    },
  },
})

describe('P9.5.2 — buildPerformedPrescriptionDraft', () => {
  it('clones the frozen programmed variant, tagged', () => {
    const d = buildPerformedPrescriptionDraft({ doc: programmed(), variantKey: 'rx', sectionId: 'sec-1' })
    expect(d.version).toBe(PERFORMED_PRESCRIPTION_VERSION)
    expect(d.variantKey).toBe('rx')
    expect(d.sectionId).toBe('sec-1')
    expect(d.source).toBe('performed')
    expect(d.movements.map(m => m.name)).toEqual(['Thruster', 'Pull-up'])
  })

  it('is a deep value clone — mutating the source doc never touches the draft', () => {
    const src = programmed()
    const d = buildPerformedPrescriptionDraft({ doc: src, variantKey: 'rx' })
    src.variants.rx.movements[0].load.female = 999
    src.variants.rx.movements.push({ instanceId: 'x', name: 'X' })
    expect(d.movements).toHaveLength(2)
    expect(d.movements[0].load.female).toBe(30)
  })

  it('returns null when the variant has no structured prescription (legacy)', () => {
    expect(buildPerformedPrescriptionDraft({ doc: { version: 1, variants: {} }, variantKey: 'rx' })).toBeNull()
    expect(buildPerformedPrescriptionDraft({ doc: null, variantKey: 'rx' })).toBeNull()
  })
})

describe('P9.5.2 — validatePerformedPrescription (mirrors the DB trigger)', () => {
  it('NULL / undefined are valid (= performed as programmed)', () => {
    expect(validatePerformedPrescription(null).valid).toBe(true)
    expect(validatePerformedPrescription(undefined).valid).toBe(true)
  })

  it('accepts a well-formed doc', () => {
    const d = buildPerformedPrescriptionDraft({ doc: programmed(), variantKey: 'rx' })
    expect(validatePerformedPrescription(d)).toEqual({ valid: true, errors: [] })
  })

  it('rejects bad version / non-array movements / missing instanceId / dup id', () => {
    expect(validatePerformedPrescription({ version: 2, movements: [] }).valid).toBe(false)
    expect(validatePerformedPrescription({ version: 1, movements: 'no' }).valid).toBe(false)
    expect(validatePerformedPrescription({ version: 1, movements: [{ name: 'x' }] }).valid).toBe(false)
    expect(validatePerformedPrescription({ version: 1, movements: [
      { instanceId: 'a', name: 'A' }, { instanceId: 'a', name: 'B' },
    ] }).valid).toBe(false)
  })

  it('rejects a bad load unit and a non-numeric value', () => {
    expect(validatePerformedPrescription({ version: 1, movements: [
      { instanceId: 'a', name: 'A', load: { mode: 'universal', value: 9, unit: 'stone' } },
    ] }).valid).toBe(false)
    expect(validatePerformedPrescription({ version: 1, movements: [
      { instanceId: 'a', name: 'A', load: { mode: 'universal', value: 'heavy', unit: 'kg' } },
    ] }).valid).toBe(false)
  })

  it('rejects an invalid variantKey', () => {
    expect(validatePerformedPrescription({ version: 1, variantKey: 'elite', movements: [] }).valid).toBe(false)
  })
})

describe('P9.5.2 — performedMatchesProgrammed / performedIsModified', () => {
  it('an untouched clone matches (female athlete)', () => {
    const d = buildPerformedPrescriptionDraft({ doc: programmed(), variantKey: 'rx' })
    expect(performedMatchesProgrammed(d, programmed(), 'rx', 'female')).toBe(true)
    expect(performedIsModified(d, programmed(), 'rx', 'female')).toBe(false)
  })

  it('a changed performed load no longer matches', () => {
    const d = buildPerformedPrescriptionDraft({ doc: programmed(), variantKey: 'rx' })
    d.movements[0] = setPerformedMetricValue(d.movements[0], 'load', 25, 'kg')
    expect(performedMatchesProgrammed(d, programmed(), 'rx', 'female')).toBe(false)
    expect(performedIsModified(d, programmed(), 'rx', 'female')).toBe(true)
  })

  it('setting the performed load to the athlete-resolved programmed value still matches (revert)', () => {
    const d = buildPerformedPrescriptionDraft({ doc: programmed(), variantKey: 'rx' })
    // female programmed load is 30 kg — writing 30 as a universal value resolves the same
    d.movements[0] = setPerformedMetricValue(d.movements[0], 'load', 30, 'kg')
    expect(performedMatchesProgrammed(d, programmed(), 'rx', 'female')).toBe(true)
  })

  it('a movement substitution never matches', () => {
    const d = buildPerformedPrescriptionDraft({ doc: programmed(), variantKey: 'rx' })
    d.movements[1] = applyPerformedSubstitution(d.movements[1], { id: 'cm-ringrow', name: 'Ring Row' }, { allowed: ['reps'], default: 'reps', unknown: false })
    expect(performedIsModified(d, programmed(), 'rx', 'female')).toBe(true)
  })

  it('NULL performed is always "matches" / "not modified"', () => {
    expect(performedMatchesProgrammed(null, programmed(), 'rx', 'male')).toBe(true)
    expect(performedIsModified(null, programmed(), 'rx', 'male')).toBe(false)
  })
})

describe('P9.5.2 — applyPerformedSubstitution', () => {
  it('keeps instanceId, adopts the new identity, records substitutedFrom once', () => {
    const d = buildPerformedPrescriptionDraft({ doc: programmed(), variantKey: 'rx' })
    const orig = d.movements[0]
    const sub1 = applyPerformedSubstitution(orig, { id: 'cm-db-thruster', name: 'Dumbbell Thruster' }, resolveMovementCapability({ allowed_prescription_metrics: ['reps', 'load'], default_prescription_metric: 'load' }))
    expect(sub1.instanceId).toBe(orig.instanceId)
    expect(sub1.canonicalMovementId).toBe('cm-db-thruster')
    expect(sub1.name).toBe('Dumbbell Thruster')
    expect(sub1.substitutedFrom).toEqual({ canonicalMovementId: 'cm-thruster', name: 'Thruster' })
    // reps (structure) carries over
    expect(sub1.reps).toEqual({ mode: 'universal', value: 21 })
    // load allowed -> retained
    expect(sub1.load).toEqual({ mode: 'sex_specific', male: 43, female: 30, unit: 'kg' })
    // a SECOND substitution keeps the ORIGINAL substitutedFrom
    const sub2 = applyPerformedSubstitution(sub1, { id: 'cm-kb-thruster', name: 'KB Thruster' }, { allowed: ['reps', 'load'], default: 'load', unknown: false })
    expect(sub2.substitutedFrom).toEqual({ canonicalMovementId: 'cm-thruster', name: 'Thruster' })
  })

  it('clears a metric the target movement no longer allows (§16)', () => {
    const d = buildPerformedPrescriptionDraft({ doc: programmed(), variantKey: 'rx' })
    const sub = applyPerformedSubstitution(d.movements[0], { id: 'cm-airsquat', name: 'Air Squat' }, { allowed: ['reps'], default: 'reps', unknown: false })
    expect(sub.load).toBeUndefined()
    expect(sub.reps).toEqual({ mode: 'universal', value: 21 })
  })

  it('an unknown-capability target (empty allowed) retains what the athlete had (no data loss)', () => {
    const d = buildPerformedPrescriptionDraft({ doc: programmed(), variantKey: 'rx' })
    const sub = applyPerformedSubstitution(d.movements[0], { id: 'cm-x', name: 'Mystery' }, { allowed: [], default: null, unknown: true })
    expect(sub.load).toBeTruthy()
  })
})

describe('P9.5.2 — repeated movements: no cross-contamination (§32)', () => {
  const twoRuns = () => ({
    version: 1,
    variants: { rx: { movements: [
      { instanceId: 'mi_run00000000000000001', name: 'Run', canonicalMovementId: 'cm-run', distance: { mode: 'universal', value: 400, unit: 'm' } },
      { instanceId: 'mi_run00000000000000002', name: 'Run', canonicalMovementId: 'cm-run', distance: { mode: 'universal', value: 400, unit: 'm' } },
    ] } },
  })
  it('editing one instance leaves the other identical to programmed', () => {
    const d = buildPerformedPrescriptionDraft({ doc: twoRuns(), variantKey: 'rx' })
    d.movements[0] = setPerformedMetricValue(d.movements[0], 'distance', 200, 'm')
    expect(d.movements[0].distance.value).toBe(200)
    expect(d.movements[1].distance.value).toBe(400)
    expect(performedIsModified(d, twoRuns(), 'rx', 'male')).toBe(true)
  })
  it('a distance value out of the m/km/ft/mi enum is rejected', () => {
    expect(validatePerformedPrescription({ version: 1, movements: [
      { instanceId: 'a', name: 'Run', distance: { mode: 'universal', value: 400, unit: 'yards' } },
    ] }).valid).toBe(false)
  })
})

describe('P9.5.2 / P9.5.6 — resultCompositionModified reads performed_prescription', () => {
  it('a log with a non-null performed_prescription is Modified regardless of weight', () => {
    const log = { weight_logged: '43', time_result: '10:00', performed_prescription: { version: 1, movements: [] } }
    expect(resultCompositionModified(log, '43', ['Thruster'], ['Thruster'])).toBe(true)
  })
  it('a log with NULL performed_prescription is unaffected (As Prescribed when weight matches)', () => {
    const log = { weight_logged: '43', time_result: '10:00', performed_prescription: null }
    expect(resultCompositionModified(log, '43', ['Thruster'], ['Thruster'])).toBe(false)
  })
})
