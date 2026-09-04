import { describe, it, expect } from 'vitest'
import {
  buildPerformedPrescriptionDraft,
  validatePerformedPrescription,
  performedMatchesProgrammed,
  performedIsModified,
  applyPerformedSubstitution,
  setPerformedMetricValue,
  switchPerformedQuantityMetric,
  resolveMovementCapability,
  resolveMovementInstance,
  composePerformedResultLines,
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
    expect(validatePerformedPrescription({ version: 3, movements: [] }).valid).toBe(false)
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

// ROW MOVEMENT PICKER (2026-09-04) - substitution-contract regression, real
// production identities. The forensic audit found the picker unable to
// SURFACE "Row" (a search/ranking bug, fixed in searchPerformedMovements);
// this protects the UNRELATED, already-correct applyPerformedSubstitution
// contract the fix depends on — Air Bike -> Row keeps the athlete's calorie
// value verbatim (both share allowed_prescription_metrics [distance,
// calories]), never reinterprets it as reps/distance, and never touches the
// programmed doc.
describe('ROW MOVEMENT PICKER — Air Bike -> Row substitution regression', () => {
  const airBikeDoc = () => ({
    version: 1,
    variants: { rx: { movements: [
      { instanceId: 'mi_airbike00000000000001', name: 'Air Bike', canonicalMovementId: '6fa1e269-3db4-4d52-b39d-242ffdcbf24c',
        calories: { mode: 'universal', value: 15 } },
    ] } },
  })
  // real catalog row (read-only forensic audit): id 2cfd0278-21a4-47c3-8ece-3a40b6a742b8
  const rowCapability = resolveMovementCapability({ allowed_prescription_metrics: ['distance', 'calories'], default_prescription_metric: 'calories' })

  it('15 Cal Air Bike -> Row keeps 15 calories verbatim, adopts Row identity, records substitutedFrom', () => {
    const d = buildPerformedPrescriptionDraft({ doc: airBikeDoc(), variantKey: 'rx' })
    const orig = d.movements[0]
    const sub = applyPerformedSubstitution(orig, { id: '2cfd0278-21a4-47c3-8ece-3a40b6a742b8', name: 'Row' }, rowCapability)
    expect(sub.instanceId).toBe(orig.instanceId) // stable instance
    expect(sub.name).toBe('Row')
    expect(sub.canonicalMovementId).toBe('2cfd0278-21a4-47c3-8ece-3a40b6a742b8')
    expect(sub.calories).toEqual({ mode: 'universal', value: 15 }) // verbatim, not reinterpreted
    expect(sub.substitutedFrom).toEqual({ canonicalMovementId: '6fa1e269-3db4-4d52-b39d-242ffdcbf24c', name: 'Air Bike' })
    // no metric invented
    expect(sub.reps).toBeUndefined()
    expect(sub.load).toBeUndefined()
    expect(sub.distance).toBeUndefined()
  })

  it('the PROGRAMMED doc is never mutated by the substitution (§14 invariant)', () => {
    const src = airBikeDoc()
    const d = buildPerformedPrescriptionDraft({ doc: src, variantKey: 'rx' })
    applyPerformedSubstitution(d.movements[0], { id: '2cfd0278-21a4-47c3-8ece-3a40b6a742b8', name: 'Row' }, rowCapability)
    expect(src.variants.rx.movements[0].name).toBe('Air Bike')
    expect(src.variants.rx.movements[0].calories).toEqual({ mode: 'universal', value: 15 })
  })

  it('the substitution reads as Modified against the programmed Air Bike (§15 classification untouched)', () => {
    const programmedAirBike = airBikeDoc()
    const d = buildPerformedPrescriptionDraft({ doc: programmedAirBike, variantKey: 'rx' })
    d.movements[0] = applyPerformedSubstitution(d.movements[0], { id: '2cfd0278-21a4-47c3-8ece-3a40b6a742b8', name: 'Row' }, rowCapability)
    expect(performedIsModified(d, programmedAirBike, 'rx', 'male')).toBe(true)
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

// PERFORMED METRIC SWITCHING (2026-09-04) - Row/Air Bike/Bike Erg/Ski Erg (and
// 4 more real catalog rows) allow BOTH distance and calories. The athlete-edit
// UI only ever exposed whichever metric was already on the instance
// (inherited from the programmed movement or a substitution); this adds the
// switch between the two. Scope: distance<->calories ONLY - reps+load
// (Clean & Jerk etc.) and load+distance carries are explicitly untouched.
describe('PERFORMED METRIC SWITCHING — switchPerformedQuantityMetric', () => {
  const rowCalories = () => ({
    instanceId: 'mi_row0000000000000001', sourceInstanceId: 'mi_airbike00000000000001',
    name: 'Row', canonicalMovementId: '2cfd0278-21a4-47c3-8ece-3a40b6a742b8',
    calories: { mode: 'universal', value: 21 },
    substitutedFrom: { canonicalMovementId: '6fa1e269-3db4-4d52-b39d-242ffdcbf24c', name: 'Air Bike' },
  })

  it('TEST A — Row calories 21 -> switch Distance: distance blank/m, calories key absent', () => {
    const next = switchPerformedQuantityMetric(rowCalories(), 'distance')
    expect(next.distance).toEqual({ mode: 'universal', value: null, unit: 'm' })
    expect(next.calories).toBeUndefined()
    expect('calories' in next).toBe(false) // removed, not merely hidden/nulled
  })

  it('TEST B — Row distance 250m -> switch Calories: calories blank, distance key absent', () => {
    const rowDistance = { ...rowCalories() }
    delete rowDistance.calories
    rowDistance.distance = { mode: 'universal', value: 250, unit: 'm' }
    const next = switchPerformedQuantityMetric(rowDistance, 'calories')
    expect(next.calories).toEqual({ mode: 'universal', value: null })
    expect(next.distance).toBeUndefined()
    expect('distance' in next).toBe(false)
  })

  it('TEST C — input instance is never mutated', () => {
    const orig = rowCalories()
    const snapshot = JSON.parse(JSON.stringify(orig))
    switchPerformedQuantityMetric(orig, 'distance')
    expect(orig).toEqual(snapshot)
  })

  it('TEST D — identity/provenance preserved: name, canonicalMovementId, instanceId, sourceInstanceId, substitutedFrom', () => {
    const next = switchPerformedQuantityMetric(rowCalories(), 'distance')
    expect(next.instanceId).toBe('mi_row0000000000000001')
    expect(next.sourceInstanceId).toBe('mi_airbike00000000000001')
    expect(next.name).toBe('Row')
    expect(next.canonicalMovementId).toBe('2cfd0278-21a4-47c3-8ece-3a40b6a742b8')
    expect(next.substitutedFrom).toEqual({ canonicalMovementId: '6fa1e269-3db4-4d52-b39d-242ffdcbf24c', name: 'Air Bike' })
  })

  it('TEST E/F — no numeric carry-over, no conversion: 21 calories never becomes 21 meters', () => {
    const next = switchPerformedQuantityMetric(rowCalories(), 'distance')
    expect(next.distance.value).toBe(null) // NOT 21
    expect(next.distance.value).not.toBe(21)
  })

  it('preserves reps and other unrelated fields verbatim across a switch', () => {
    const withReps = { ...rowCalories(), reps: { mode: 'universal', value: 10 }, notPerformed: false }
    const next = switchPerformedQuantityMetric(withReps, 'distance')
    expect(next.reps).toEqual({ mode: 'universal', value: 10 })
    expect(next.notPerformed).toBe(false)
  })

  it('an invalid target metric is a no-op (returns the instance unchanged)', () => {
    const orig = rowCalories()
    expect(switchPerformedQuantityMetric(orig, 'load')).toBe(orig)
    expect(switchPerformedQuantityMetric(orig, 'reps')).toBe(orig)
    expect(switchPerformedQuantityMetric(null, 'distance')).toBeNull()
  })
})

describe('PERFORMED METRIC SWITCHING — capability matrix (drives the UI selector eligibility)', () => {
  // eligibility === cap.allowed includes BOTH distance and calories - exactly
  // what PerformedEditRow's quantitySwitchEligible computes via
  // resolveInstanceCapability. Real catalog rows (forensic audit).
  const eligible = (row) => {
    const cap = resolveMovementCapability(row)
    return cap.allowed.includes('distance') && cap.allowed.includes('calories')
  }
  it('Row — allowed [distance, calories] -> selector eligible', () => {
    expect(eligible({ allowed_prescription_metrics: ['distance', 'calories'], default_prescription_metric: 'calories' })).toBe(true)
  })
  it('Air Bike — allowed [distance, calories] -> selector eligible', () => {
    expect(eligible({ allowed_prescription_metrics: ['distance', 'calories'], default_prescription_metric: 'calories' })).toBe(true)
  })
  it('Bike Erg — allowed [distance, calories] -> selector eligible', () => {
    expect(eligible({ allowed_prescription_metrics: ['distance', 'calories'], default_prescription_metric: 'calories' })).toBe(true)
  })
  it('Ski Erg — allowed [distance, calories] -> selector eligible', () => {
    expect(eligible({ allowed_prescription_metrics: ['distance', 'calories'], default_prescription_metric: 'calories' })).toBe(true)
  })
  it('Run — allowed [distance] only -> NO selector', () => {
    expect(eligible({ allowed_prescription_metrics: ['distance'], default_prescription_metric: 'distance' })).toBe(false)
  })
  it('Shuttle Run — allowed [distance] only -> NO selector', () => {
    expect(eligible({ allowed_prescription_metrics: ['distance'], default_prescription_metric: 'distance' })).toBe(false)
  })
  it('Clean & Jerk — allowed [reps, load] -> NO distance/calories selector (out of scope)', () => {
    expect(eligible({ allowed_prescription_metrics: ['reps', 'load'], default_prescription_metric: 'load' })).toBe(false)
  })
  it('a load+distance carry movement (e.g. Farmers Carry) -> NO selector in this incident (out of scope)', () => {
    expect(eligible({ allowed_prescription_metrics: ['load', 'distance'], default_prescription_metric: 'load' })).toBe(false)
  })
})

describe('PERFORMED METRIC SWITCHING — exact reported workflow: Air Bike 21 Cal -> Change Movement Row -> Distance -> 250', () => {
  const airBikeDoc = () => ({
    version: 1,
    variants: { rx: { movements: [
      { instanceId: 'mi_airbike00000000000001', name: 'Air Bike', canonicalMovementId: '6fa1e269-3db4-4d52-b39d-242ffdcbf24c',
        calories: { mode: 'universal', value: 21 } },
    ] } },
  })
  const rowCapability = resolveMovementCapability({ allowed_prescription_metrics: ['distance', 'calories'], default_prescription_metric: 'calories' })

  it('full workflow: substitute, verify initial state, switch, enter 250, verify final state + programmed untouched', () => {
    const programmed = airBikeDoc()
    const d = buildPerformedPrescriptionDraft({ doc: programmed, variantKey: 'rx' })

    // Change movement: Air Bike -> Row
    let inst = applyPerformedSubstitution(d.movements[0], { id: '2cfd0278-21a4-47c3-8ece-3a40b6a742b8', name: 'Row' }, rowCapability)
    expect(inst.name).toBe('Row')
    expect(inst.calories).toEqual({ mode: 'universal', value: 21 }) // initial state: Calories active (unchanged behavior, §9)
    expect(inst.distance).toBeUndefined()

    // Switch: Distance
    inst = switchPerformedQuantityMetric(inst, 'distance')
    expect(inst.distance).toEqual({ mode: 'universal', value: null, unit: 'm' })
    expect(inst.calories).toBeUndefined()

    // Enter 250
    inst = setPerformedMetricValue(inst, 'distance', 250, 'm')
    expect(inst.distance).toEqual({ mode: 'universal', value: 250, unit: 'm' })
    expect(inst.calories).toBeUndefined()
    expect(inst.name).toBe('Row')
    expect(inst.substitutedFrom).toEqual({ canonicalMovementId: '6fa1e269-3db4-4d52-b39d-242ffdcbf24c', name: 'Air Bike' })

    // Final performed rendering
    const resolved = resolveMovementInstance(inst, 'male')
    expect(resolved.line).toBe('250 m Row')

    // Programmed workout untouched throughout
    expect(programmed.variants.rx.movements[0].name).toBe('Air Bike')
    expect(programmed.variants.rx.movements[0].calories).toEqual({ mode: 'universal', value: 21 })

    // Save validation: a clean distance-only Row passes
    const finalDoc = { version: 2, variantKey: 'rx', sectionId: null, source: 'performed', movements: [{ ...inst, sourceInstanceId: 'mi_airbike00000000000001' }] }
    expect(validatePerformedPrescription(finalDoc)).toEqual({ valid: true, errors: [] })

    // Journal/result-card rendering (P9.5.5 shared engine) already supports it
    const lines = composePerformedResultLines(finalDoc, 'male')
    expect(lines).toEqual(['250 m Row'])

    // Modified classification unaffected by which metric, only by composition
    expect(performedIsModified({ ...d, movements: [inst] }, programmed, 'rx', 'male')).toBe(true)
  })
})

describe('PERFORMED METRIC SWITCHING — Add movement path (same PerformedEditRow, same selector)', () => {
  const rowCapability = resolveMovementCapability({ allowed_prescription_metrics: ['distance', 'calories'], default_prescription_metric: 'calories' })

  it('addPerformedMovement seeds a fresh Row entry (untouched, pre-existing behavior - not modified by this incident)', async () => {
    const { addPerformedMovement } = await import('./prescriptionContract.js')
    const doc = { version: 2, variantKey: 'rx', sectionId: null, source: 'performed', movements: [
      { instanceId: 'mi_src', sourceInstanceId: 'mi_src', name: 'Air Bike', calories: { mode: 'universal', value: 21 } },
    ] }
    const next = addPerformedMovement(doc, 'mi_src', { id: '2cfd0278-21a4-47c3-8ece-3a40b6a742b8', name: 'Row' }, rowCapability)
    const added = next.movements[1]
    expect(added.name).toBe('Row')
    // addPerformedMovement (unmodified) seeds EVERY allowed metric blank, not
    // only the default - so a freshly-added Row starts with BOTH distance and
    // calories present (both null). The selector below still correctly
    // reports "Calories" as active (inst.calories checked first) and BOTH
    // choices available; switching to either via switchPerformedQuantityMetric
    // immediately collapses to exactly one, per its own contract (TEST A/B).
    expect(added.calories).toEqual({ mode: 'universal', value: null })
    expect(added.distance).toEqual({ mode: 'universal', value: null, unit: 'm' })
  })

  it('the selector is eligible and reports Calories active for a freshly-added Row; switching Distance collapses to one metric', async () => {
    const { addPerformedMovement } = await import('./prescriptionContract.js')
    const doc = { version: 2, variantKey: 'rx', sectionId: null, source: 'performed', movements: [
      { instanceId: 'mi_src', sourceInstanceId: 'mi_src', name: 'Air Bike', calories: { mode: 'universal', value: 21 } },
    ] }
    const added = addPerformedMovement(doc, 'mi_src', { id: '2cfd0278-21a4-47c3-8ece-3a40b6a742b8', name: 'Row' }, rowCapability).movements[1]
    const eligible = rowCapability.allowed.includes('distance') && rowCapability.allowed.includes('calories')
    const activeMetric = added.calories ? 'calories' : added.distance ? 'distance' : null
    expect(eligible).toBe(true)
    expect(activeMetric).toBe('calories')
    const switched = switchPerformedQuantityMetric(added, 'distance')
    expect(switched.calories).toBeUndefined()
    expect(switched.distance).toEqual({ mode: 'universal', value: null, unit: 'm' })
  })
})

describe('PERFORMED METRIC SWITCHING — UI source guard (capability-driven, not name-driven)', () => {
  it('PerformedEditRow gates the selector on catalog capability via resolveInstanceCapability, never on movement name', async () => {
    const { readFileSync } = await import('node:fs')
    const { fileURLToPath } = await import('node:url')
    const { dirname, join } = await import('node:path')
    const app = readFileSync(join(dirname(fileURLToPath(import.meta.url)), 'App.jsx'), 'utf8')
    expect(app).toMatch(/const quantityCap = resolveInstanceCapability\(movementIndex, inst\)/)
    expect(app).toMatch(/const quantitySwitchEligible = quantityCap\.allowed\.includes\('distance'\) && quantityCap\.allowed\.includes\('calories'\)/)
    expect(app).toMatch(/const activeQuantityMetric = inst\.calories \? 'calories' : inst\.distance \? 'distance' : null/)
    expect(app).toMatch(/onClick=\{\(\) => onChange\(switchPerformedQuantityMetric\(inst, m\)\)\}/)
    // never a movement-name allowlist (e.g. inst.name === 'Row')
    expect(app).not.toMatch(/inst\.name === ['"]Row['"]/)
    // exactly one PerformedEditRow definition - the selector applies to both
    // its existing call sites (Change movement substitution + Add movement)
    expect((app.match(/function PerformedEditRow\(/g) || []).length).toBe(1)
  })
})

// SCORE / LEADERBOARD INVARIANCE - the forensic audit read composeWodLogFieldsInner
// (App.jsx) end to end: it derives result/time_result/weight_logged/sets/log_meta
// exclusively from athlete-typed score-input state (wodTime, wodRoundsCompleted,
// wodPartialReps, wodResult, wodWeightLogged, wodSets, wodChainedStages,
// wodAdditionalReps, wodCompleted) and never reads performedDraft/
// performedCommitted/performed_prescription. This incident adds no new score
// path - guard that composeWodLogFieldsInner still never references performed
// state, so a metric switch can never influence the score.
describe('PERFORMED METRIC SWITCHING — score/leaderboard independence (source guard)', () => {
  it('composeWodLogFieldsInner never reads performedDraft/performedCommitted', async () => {
    const { readFileSync } = await import('node:fs')
    const { fileURLToPath } = await import('node:url')
    const { dirname, join } = await import('node:path')
    const app = readFileSync(join(dirname(fileURLToPath(import.meta.url)), 'App.jsx'), 'utf8')
    const start = app.indexOf('const composeWodLogFieldsInner = () => {')
    expect(start).toBeGreaterThan(0)
    // isolate the function body up to its matching close (next top-level
    // "const saveWodLog = async () => {" marks the end, unchanged since the
    // forensic audit)
    const end = app.indexOf('const saveWodLog = async () => {', start)
    expect(end).toBeGreaterThan(start)
    const body = app.slice(start, end)
    expect(body).not.toMatch(/performedDraft|performedCommitted|performed_prescription/)
  })
})
