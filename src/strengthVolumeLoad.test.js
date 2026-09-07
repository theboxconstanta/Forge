// FORGE - CANONICAL STRENGTH RESULT INTELLIGENCE, Phase A
// Total Weight Lifted = Σ(actual performed reps × actual performed load).
// Pure, capability-driven (never movement-name parsing), never reads
// programmed targets as fallback. See workoutFormats.js's
// resolveMovementLoadCapabilityByKey / computeVolumeLoad for the full
// contract - this file proves every required oracle (section 20) against
// real production row shapes (confirmed live: {completed, distance, reps,
// targetReps, weight}, reps/weight as strings, blank = '').

import { describe, it, expect } from 'vitest'
import { computeVolumeLoad, resolveMovementLoadCapabilityByKey } from './workoutFormats.js'
import { buildMovementIndex } from './prescriptionContract.js'

const row = (reps, weight, extra = {}) => ({ completed: false, distance: '', targetReps: null, reps, weight, ...extra })

// Real-shaped RX instances (prescriptionMovements) - Snatch load-capable,
// Air Squat/Push-up bodyweight-only, Row erg (no load capability at all).
const snatchInst = { instanceId: 'mi_sn', name: 'Snatch', canonicalMovementId: 'cm-snatch', reps: { mode: 'universal', value: null }, load: { mode: 'sex_specific', male: null, female: null, unit: 'kg' } }
const airSquatInst = { instanceId: 'mi_as', name: 'Air Squat', canonicalMovementId: 'cm-as', reps: { mode: 'universal', value: null } }
const pushUpInst = { instanceId: 'mi_pu', name: 'Push-up', canonicalMovementId: 'cm-pu', reps: { mode: 'universal', value: null } }
const rowInst = { instanceId: 'mi_row', name: 'Row', canonicalMovementId: 'cm-row', calories: { mode: 'universal', value: null } }
const backSquatInst = { instanceId: 'mi_bs', name: 'Back Squat', canonicalMovementId: 'cm-bs', reps: { mode: 'universal', value: null }, load: { mode: 'sex_specific', male: null, female: null, unit: 'kg' } }

describe('resolveMovementLoadCapabilityByKey - capability-driven, never a name heuristic', () => {
  it('marks Snatch load-capable, Air Squat/Push-up NOT, Row NOT (no .load key)', () => {
    const cap = resolveMovementLoadCapabilityByKey([snatchInst, airSquatInst, pushUpInst, rowInst])
    expect(cap.Snatch).toEqual({ isLoadCapable: true, movementId: 'cm-snatch' })
    expect(cap['Air Squat']).toEqual({ isLoadCapable: false, movementId: 'cm-as' })
    expect(cap['Push-up']).toEqual({ isLoadCapable: false, movementId: 'cm-pu' })
    expect(cap.Row).toEqual({ isLoadCapable: false, movementId: 'cm-row' })
  })

  it('plain display-line strings (legacy/no prescriptionMovements) resolve to nothing - fails closed', () => {
    const cap = resolveMovementLoadCapabilityByKey(['Snatch', 'Air Squat'])
    expect(cap.Snatch).toBeUndefined()
  })
})

describe('REQUIRED ORACLES (section 20)', () => {
  const capSnatch = resolveMovementLoadCapabilityByKey([snatchInst])

  it('A - 5@35 + 5@35 + 4@40 + 4@40 + 4@40 + 3@45 + 3@45 -> 1100 kg', () => {
    const rowsByKey = { Snatch: [row('5', '35'), row('5', '35'), row('4', '40'), row('4', '40'), row('4', '40'), row('3', '45'), row('3', '45')] }
    const result = computeVolumeLoad(rowsByKey, capSnatch, 'kg')
    expect(result.totalWeight).toBe(1100)
    expect(result.weightUnit).toBe('kg')
    expect(result.byMovement).toHaveLength(1)
    expect(result.byMovement[0].movementName).toBe('Snatch')
    expect(result.byMovement[0].movementIdentity).toBe('id:cm-snatch')
    expect(result.byMovement[0].contributingRows).toHaveLength(7)
  })

  it('B - blank reps + 40kg -> contributes 0 (row excluded, not a 0-contribution row)', () => {
    const rowsByKey = { Snatch: [row('', '40')] }
    const result = computeVolumeLoad(rowsByKey, capSnatch, 'kg')
    expect(result.totalWeight).toBe(0)
    expect(result.byMovement).toHaveLength(0) // nothing logged at all -> movement omitted entirely
  })

  it('C - 5 reps + blank load -> contributes 0 (row excluded)', () => {
    const rowsByKey = { Snatch: [row('5', '')] }
    const result = computeVolumeLoad(rowsByKey, capSnatch, 'kg')
    expect(result.totalWeight).toBe(0)
    expect(result.byMovement).toHaveLength(0)
  })

  it('D - 0 reps @40 -> contributes 0, but is REAL evidence (row included, distinct from blank)', () => {
    const rowsByKey = { Snatch: [row('0', '40')] }
    const result = computeVolumeLoad(rowsByKey, capSnatch, 'kg')
    expect(result.totalWeight).toBe(0)
    expect(result.byMovement).toHaveLength(1) // the movement DID get logged evidence
    expect(result.byMovement[0].contributingRows).toEqual([{ rowIndex: 0, reps: 0, weight: 40, contribution: 0 }])
  })

  it('D2 - blank vs explicit zero are distinguishable in the SAME set of rows', () => {
    const rowsByKey = { Snatch: [row('', '40'), row('0', '40'), row('5', '40')] }
    const result = computeVolumeLoad(rowsByKey, capSnatch, 'kg')
    // blank row (index 0) excluded; explicit-zero row (index 1) included at 0; real row (index 2) included at 200.
    expect(result.byMovement[0].contributingRows.map((r) => r.rowIndex)).toEqual([1, 2])
    expect(result.totalWeight).toBe(200)
  })

  it('E - 5@40 + 5@45 -> 425 kg', () => {
    const rowsByKey = { Snatch: [row('5', '40'), row('5', '45')] }
    const result = computeVolumeLoad(rowsByKey, capSnatch, 'kg')
    expect(result.totalWeight).toBe(425)
  })

  it('F - a bodyweight-only movement surfaces NO Total Weight Lifted entry, even if a stray weight value exists in its rows', () => {
    const capAirSquat = resolveMovementLoadCapabilityByKey([airSquatInst])
    const rowsByKey = { 'Air Squat': [row('10', '5')] } // e.g. a band-assist number a member mistakenly typed
    const result = computeVolumeLoad(rowsByKey, capAirSquat, 'kg')
    expect(result.byMovement).toHaveLength(0)
    expect(result.totalWeight).toBe(0)
  })

  it('G - a weighted movement substituted to Row (erg, no load capability) stops contributing volume', () => {
    // effective performed instance after substitution is Row, not Snatch -
    // the caller resolves capability from the EFFECTIVE instance.
    const capAfterSub = resolveMovementLoadCapabilityByKey([rowInst])
    const rowsByKey = { Row: [row('12', '')] } // erg movements never populate `weight` in the first place
    const result = computeVolumeLoad(rowsByKey, capAfterSub, 'kg')
    expect(result.byMovement).toHaveLength(0)
  })

  it('H - a bodyweight movement substituted to a weighted movement, with actual reps/load entered, DOES contribute', () => {
    // e.g. Air Squat -> Back Squat, athlete performs 5@60
    const capAfterSub = resolveMovementLoadCapabilityByKey([backSquatInst])
    const rowsByKey = { 'Back Squat': [row('5', '60')] }
    const result = computeVolumeLoad(rowsByKey, capAfterSub, 'kg')
    expect(result.totalWeight).toBe(300)
    expect(result.byMovement[0].movementName).toBe('Back Squat')
  })

  it('I - the result is unit-honest, never hardcoded to kg: an lbs-context log produces an lbs-labeled total, no silent reinterpretation', () => {
    const rowsByKey = { Snatch: [row('5', '80')] } // 80 in whatever unit this log's own frozen context was
    const resultLbs = computeVolumeLoad(rowsByKey, capSnatch, 'lbs')
    expect(resultLbs.weightUnit).toBe('lbs')
    expect(resultLbs.totalWeight).toBe(400) // no conversion attempted - same arithmetic, honestly labeled
    const resultKg = computeVolumeLoad(rowsByKey, capSnatch, 'kg')
    expect(resultKg.weightUnit).toBe('kg')
    expect(resultKg.totalWeight).toBe(400) // identical number - this function NEVER converts, only labels
  })

  it('J - multiple loaded movements: correct per-movement totals AND a safe aggregate', () => {
    const cap = resolveMovementLoadCapabilityByKey([snatchInst, backSquatInst])
    const rowsByKey = {
      Snatch: [row('5', '35'), row('3', '45')],
      'Back Squat': [row('5', '60'), row('5', '65')],
    }
    const result = computeVolumeLoad(rowsByKey, cap, 'kg')
    const byName = Object.fromEntries(result.byMovement.map((m) => [m.movementName, m.totalWeight]))
    expect(byName.Snatch).toBe(310) // 175 + 135
    expect(byName['Back Squat']).toBe(625) // 300 + 325
    expect(result.totalWeight).toBe(935) // safe aggregate = sum of the two, never independently computed
  })
})

describe('REGRESSION - a movement absent from loadCapabilityByKey (legacy log, no prescriptionMovements) fails closed, never assumes load', () => {
  it('no capability map entry -> movement omitted, never treated as load-capable by default', () => {
    const result = computeVolumeLoad({ Snatch: [row('5', '40')] }, {}, 'kg')
    expect(result.byMovement).toHaveLength(0)
    expect(result.totalWeight).toBe(0)
  })
})

// LIVE PRODUCTION BUG (owner report) - a real saved Strength Sets Snatch log
// had `sets` keyed by "snatch" (lowercase) with real performed weight in
// every row, but its FROZEN prescription_snapshot instance carried ONLY
// `reps: {value: null}` - no `.load` key at all (confirmed via a live,
// read-only DB query: the coach removed the Load field, a legitimate,
// common Strength Sets authoring choice - "each athlete picks their own
// weight" - already supported by the pre-existing strengthSetsOptionalLoad
// fix). The original resolver's `isLoadCapable: !!m.load` signal treated
// "no load PRESCRIBED" as "not load CAPABLE" and silently excluded Snatch
// from volume entirely - the metric was correctly computed as zero
// candidates, not a rendering/wiring bug. This is the actual root cause of
// the Leaderboard live-acceptance failure.
describe('LIVE BUG REGRESSION - a load-capable movement whose prescribed Load was removed (real production shape) still contributes volume when a catalog movementIndex is supplied', () => {
  // Real catalog shape (movements table) - Snatch allows both reps and load;
  // Air Squat allows only reps (never load, at the catalog level).
  const catalog = [
    { id: 'cm-snatch', name: 'Snatch', allowed_prescription_metrics: ['reps', 'load'], default_prescription_metric: 'load' },
    { id: 'cm-as', name: 'Air Squat', allowed_prescription_metrics: ['reps'], default_prescription_metric: 'reps' },
  ]
  const movementIndex = buildMovementIndex(catalog)
  // The EXACT frozen instance shape confirmed live - reps only, no `.load`
  // key, load deliberately removed by the coach.
  const snatchNoLoadInst = { instanceId: 'mi_sn', name: 'snatch', canonicalMovementId: 'cm-snatch', reps: { value: null } }
  const airSquatInst2 = { instanceId: 'mi_as2', name: 'Air Squat', canonicalMovementId: 'cm-as', reps: { value: null } }

  it('WITHOUT a movementIndex (old/legacy call sites, or a pure unit test), falls back to the original !!m.load signal - Snatch is (incorrectly, but unchanged) excluded', () => {
    const cap = resolveMovementLoadCapabilityByKey([snatchNoLoadInst])
    expect(cap.snatch.isLoadCapable).toBe(false)
  })

  it('WITH a movementIndex, Snatch resolves to genuinely load-capable via its catalog row (canonicalMovementId lookup, never movement-name parsing) even though `.load` is absent from the instance', () => {
    const cap = resolveMovementLoadCapabilityByKey([snatchNoLoadInst], movementIndex)
    expect(cap.snatch).toEqual({ isLoadCapable: true, movementId: 'cm-snatch' })
  })

  it('Air Squat stays correctly excluded even WITH a movementIndex - bodyweight-only at the catalog level, not just "unprescribed"', () => {
    const cap = resolveMovementLoadCapabilityByKey([airSquatInst2], movementIndex)
    expect(cap['Air Squat']).toEqual({ isLoadCapable: false, movementId: 'cm-as' })
  })

  it('the EXACT owner-reported live rows (Strength Sets, Snatch: 5@65,5@65,4@70,4@70,4@75,3@75,3@77) now correctly sum to 1966kg', () => {
    const cap = resolveMovementLoadCapabilityByKey([snatchNoLoadInst], movementIndex)
    const rowsByKey = { snatch: [row('5', '65'), row('5', '65'), row('4', '70'), row('4', '70'), row('4', '75'), row('3', '75'), row('3', '77')] }
    const result = computeVolumeLoad(rowsByKey, cap, 'kg')
    expect(result.totalWeight).toBe(1966)
    expect(result.byMovement).toHaveLength(1)
  })

  it('a movementIndex with no entry for this canonicalMovementId (movement deleted/never seeded) falls back to the instance-shape signal, never crashes', () => {
    const emptyIndex = buildMovementIndex([])
    const cap = resolveMovementLoadCapabilityByKey([snatchNoLoadInst], emptyIndex)
    expect(cap.snatch.isLoadCapable).toBe(false) // falls back to !!m.load = false, same as no-movementIndex case
  })
})
