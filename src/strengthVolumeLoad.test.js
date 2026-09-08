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

// UNIVERSAL TOTAL WEIGHT LIFTED AGGREGATION FIX - owner-reported "only 100kg
// instead of 1025kg" ticket. FORENSIC FINDING (live, read-only DB query
// against wod_logs.id 2a121ef0-0cd7-459d-b86c-5d29c494ecaa, the exact row
// behind the report): computeVolumeLoad is NOT the bug - it already sums
// every row in the array (proven by "A" above, 7 rows -> 1100kg, and
// "the EXACT owner-reported live rows" above, 7 rows -> 1966kg). The real
// saved row for THIS report has reps genuinely blank ('') on 6 of its 7
// sets (only set 1 has reps:"5" - the other 6 only ever received a typed
// weight) - computeVolumeLoad correctly excludes those 6 rows per this
// file's own "B"/"C" oracles above, which is the exact rule the ticket's
// own §5 restates ("do not substitute programmed targets for blank
// performed values"). Sampling 7 other same-day Snatch logs (several
// logged AFTER this one) shows every row's reps filled in correctly - this
// looks like an isolated incomplete-entry artifact on one row, not a
// reproducible aggregation defect. Owner decision: leave the aggregation
// contract exactly as-is (no code change) - these tests lock that decision
// in as a permanent regression, and separately prove the formula itself
// produces the owner's expected 1025kg/1700kg totals whenever the
// underlying rows are actually complete.
describe('UNIVERSAL TOTAL WEIGHT LIFTED AGGREGATION FIX - owner ticket oracles (no code change - computeVolumeLoad already correct)', () => {
  const capSnatch = resolveMovementLoadCapabilityByKey([snatchInst])

  // NOTE - the ticket's own worked example states this sums to "1025kg";
  // the arithmetic is actually 975kg (100+100+125+125+150+187.5+187.5 =
  // 975, independently verified: `node -e
  // "console.log(100+100+125+125+150+187.5+187.5)"` -> 975). The ticket's
  // own individual per-row contributions (100,100,125,125,150,187.5,187.5)
  // are correct and asserted below unchanged - only the stated TOTAL was
  // off by 50. Flagged in the release report; this test asserts the
  // mathematically correct sum, not the ticket's stated one.
  it('owner §1/§11 exact oracle - 7 complete Snatch rows (5@20,5@20,5@25,5@25,5@30,5@37.5,5@37.5) sum to 975kg (the ticket states 1025kg - an arithmetic error, see note above) with the individual contributions the owner specified (100,100,125,125,150,187.5,187.5)', () => {
    const rowsByKey = { Snatch: [row('5', '20'), row('5', '20'), row('5', '25'), row('5', '25'), row('5', '30'), row('5', '37.5'), row('5', '37.5')] }
    const result = computeVolumeLoad(rowsByKey, capSnatch, 'kg')
    expect(result.byMovement[0].contributingRows.map((r) => r.contribution)).toEqual([100, 100, 125, 125, 150, 187.5, 187.5])
    expect(result.totalWeight).toBe(975)
  })

  it('owner §4 exact oracle - two different load-capable movements (Back Squat 5@100+5@100, Bench Press 5@70+5@70) -> per-movement AND overall totals of 1000/700/1700kg', () => {
    const benchInst = { instanceId: 'mi_bp', name: 'Bench Press', canonicalMovementId: 'cm-bp', reps: { mode: 'universal', value: null }, load: { mode: 'sex_specific', male: null, female: null, unit: 'kg' } }
    const cap = resolveMovementLoadCapabilityByKey([backSquatInst, benchInst])
    const rowsByKey = {
      'Back Squat': [row('5', '100'), row('5', '100')],
      'Bench Press': [row('5', '70'), row('5', '70')],
    }
    const result = computeVolumeLoad(rowsByKey, cap, 'kg')
    const byName = Object.fromEntries(result.byMovement.map((m) => [m.movementName, m.totalWeight]))
    expect(byName['Back Squat']).toBe(1000)
    expect(byName['Bench Press']).toBe(700)
    expect(result.totalWeight).toBe(1700)
  })

  it('owner §3 - repeated IDENTICAL load rows for the same movement all still accumulate (never collapsed/deduped by movement identity before summing)', () => {
    const rowsByKey = { Snatch: [row('5', '20'), row('5', '20'), row('5', '20'), row('5', '20')] }
    const result = computeVolumeLoad(rowsByKey, capSnatch, 'kg')
    expect(result.byMovement[0].contributingRows).toHaveLength(4) // all 4 rows retained, none merged away
    expect(result.totalWeight).toBe(400)
  })

  it('owner §10K - calling computeVolumeLoad twice with the identical input produces an identical result (pure function - no duplicate counting from a rerender/refetch)', () => {
    const rowsByKey = { Snatch: [row('5', '20'), row('5', '25'), row('5', '30')] }
    const first = computeVolumeLoad(rowsByKey, capSnatch, 'kg')
    const second = computeVolumeLoad(rowsByKey, capSnatch, 'kg')
    expect(second.totalWeight).toBe(first.totalWeight)
    expect(second.byMovement).toEqual(first.byMovement)
  })

  // FORENSIC REGRESSION - the EXACT real row shape behind this ticket
  // (wod_logs.id 2a121ef0-0cd7-459d-b86c-5d29c494ecaa, live-queried) -
  // reps genuinely blank on 6 of 7 sets. Locks in the owner's explicit
  // decision: this stays 100kg, not 1025kg, until/unless the underlying
  // saved data itself is ever corrected - computeVolumeLoad must never grow
  // an implicit "carry forward the last non-blank reps" fallback, which
  // would silently violate the owner's own §5 invariant for every OTHER
  // log with a genuinely, intentionally blank set.
  it('FORENSIC REGRESSION - the real production row (2a121ef0...) with reps blank on 6/7 rows correctly sums to 100kg, not 1025kg - this is a data-completeness fact, not an aggregation bug', () => {
    const rowsByKey = {
      Snatch: [
        row('5', '20'),
        row('', '20'), row('', '25'), row('', '25'), row('', '30'), row('', '37.5'), row('', '37.5'),
      ],
    }
    const result = computeVolumeLoad(rowsByKey, capSnatch, 'kg')
    expect(result.totalWeight).toBe(100)
    expect(result.byMovement[0].contributingRows).toHaveLength(1) // only set 1 is real, included evidence
  })
})
