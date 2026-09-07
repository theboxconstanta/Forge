// FORGE - EMOM PERFORMED LOGGER PARITY
//
// ROOT CAUSE (forensic, confirmed via live read-only DB query + direct code
// trace, not screenshot-guessing):
//
//   UniversalScoreInput.jsx (the P9.5 "YOUR SCORE" wrapper used by the
//   PRIMARY member logging screen, logWodPrimaryPath) delegates SETS-family
//   formats to <FormatLogger> but never forwarded `prescriptionMovements` -
//   only `movements` (plain rendered display-LINE strings, e.g. "12
//   Push-up", carrying NO `patternMinute`/capability metadata). FormatLogger
//   already had a `prescriptionMovements || movements` fallback for ROW
//   SEEDING (defaultRowsForFormat), but `resolveEmomTimeline(formatId,
//   config, prescriptionMovements)` - the call that decides WHICH branch
//   renders - never had that fallback. Net effect for every EMOM logged
//   through the real primary screen:
//     - resolveEmomTimeline got a plain-string list -> every movement
//       defaulted to patternMinute 0 -> ONE pattern position -> ALL
//       movements repeated on EVERY interval (confirmed live: a real
//       2026-09-07 wod_log for the minute-pattern WOD 89ec60e7-...,
//       Push-up(0)/Air Squat(1)/Pull-up(2), was saved with sets keys
//       "Min 1 · 1..3", "Min 2 · 1..3", ... "Min 6 · 1..3" - all three
//       stations on every minute, the exact structural regression this
//       whole EMOM saga has repeatedly fixed and re-broken at this one
//       missing prop).
//     - resolveStationUnitsByKey(formatId, config, prescriptionMovements)
//       ALSO silently got `undefined` -> null -> EMOM MIXED-UNIT
//       AGGREGATION SAFETY's gate (computeSetsScore's `if (unitsByKey)`
//       branch) was bypassed entirely in the real app, even though every
//       unit test calling FormatLogger/computeSetsScore directly (with
//       prescriptionMovements explicitly supplied) stayed green.
//   Fix: UniversalScoreInput now accepts and forwards `prescriptionMovements`
//   (single added prop, no new logic), and App.jsx's one real call site now
//   passes `frozenProgrammedInstances` - IDENTICAL to what the direct
//   <FormatLogger> call sites (edit-log / non-primary flow) already did.
//
// SEPARATE, ADDITIVE FEATURE (the actual "performed logger parity" ask):
// EMOM's per-interval score cells were bare-reps-only regardless of
// movement capability (Air Squat and Clean & Jerk rendered identically).
// FormatLogger now derives which fields to render (reps/load/calories/
// distance) from the EFFECTIVE instance's OWN metric specs - the same
// specs prescriptionContract.js's newMovementInstance/
// applyPerformedSubstitution/addPerformedMovement/
// switchPerformedQuantityMetric already produce for the whole-workout
// PerformedEditPanel (For Time's reference UI, reused unmodified - zero
// changes to App.jsx's PerformedEditPanel/PerformedEditRow). Calories reuse
// the pre-existing `reps` row field (unchanged Incident 2/3 precedent);
// `distance` is one new, additive row field.

import { describe, it, expect, afterEach } from 'vitest'
import { useState } from 'react'
import { render, screen, cleanup, fireEvent } from '@testing-library/react'
import FormatLogger from './FormatLogger'
import UniversalScoreInput from './UniversalScoreInput'
import {
  emomStationKey, resolveEmomTimeline, defaultRowsForFormat, resolveStationUnitsByKey,
  computeSetsScore, setsScoreText, sortSectionLogs,
} from './workoutFormats.js'
import {
  resolveMovementCapability, applyPerformedSubstitution, addPerformedMovement,
  switchPerformedQuantityMetric, markSourceNotPerformed, initializePerformedMetrics,
  newMovementInstance,
} from './prescriptionContract.js'
import { createSection } from './wodSections.js'
import { legacyPayloadFromSections } from './wodSections.js'

afterEach(cleanup)

// ---------------------------------------------------------------------------
// Real-shaped capability fixtures (resolveMovementCapability, the actual
// production resolver, fed catalog-shaped rows - the same convention used by
// inc15/16/17/18's own capability tests) - not ad hoc objects.
// ---------------------------------------------------------------------------
const capReps = resolveMovementCapability({ allowed_prescription_metrics: ['reps'], default_prescription_metric: 'reps' })
const capRepsLoad = resolveMovementCapability({ allowed_prescription_metrics: ['reps', 'load'], default_prescription_metric: 'load' })
const capCalDist = resolveMovementCapability({ allowed_prescription_metrics: ['distance', 'calories'], default_prescription_metric: 'calories' })
const capDistance = resolveMovementCapability({ allowed_prescription_metrics: ['distance'], default_prescription_metric: 'distance' })

// Controlled wrapper - a real athlete's FormatLogger is driven by App.jsx's
// own state, re-rendering with the updated `sets` after every keystroke.
// Tests entering MULTIPLE fields sequentially (e.g. reps then load) must
// mirror that, or the second edit reads a stale (still-empty) row and
// clobbers the first - a test-harness pitfall, not a component defect.
function ControlledFormatLogger({ formatId, config, movements, prescriptionMovements, intervalComposition, t, onLatest }) {
  const [value, setValue] = useState({})
  return (
    <FormatLogger formatId={formatId} config={config} movements={movements} prescriptionMovements={prescriptionMovements}
      intervalComposition={intervalComposition} value={value}
      onChange={(v) => { setValue(v); onLatest?.(v) }} t={t || {}} />
  )
}

const pushUp = { instanceId: 'mi_pu', name: 'Push-up', canonicalMovementId: 'cm-pu', patternMinute: 0, reps: { mode: 'universal', value: 12 } }
const airSquat = { instanceId: 'mi_as', name: 'Air Squat', canonicalMovementId: 'cm-as', patternMinute: 1, reps: { mode: 'universal', value: 12 } }
const pullUp = { instanceId: 'mi_pl', name: 'Pull-up', canonicalMovementId: 'cm-pl', patternMinute: 2, reps: { mode: 'universal', value: 8 } }
const cleanJerk = { instanceId: 'mi_cj', name: 'Clean & Jerk', canonicalMovementId: 'cm-cj', patternMinute: 0, reps: { mode: 'universal', value: 12 }, load: { mode: 'universal', value: 43, unit: 'kg' } }
const rowCal = { instanceId: 'mi_row', name: 'Row', canonicalMovementId: 'cm-row', patternMinute: 0, calories: { mode: 'universal', value: 12 } }
const run = { instanceId: 'mi_run', name: 'Run', canonicalMovementId: 'cm-run', patternMinute: 0, distance: { mode: 'universal', value: 200, unit: 'm' } }

// ===========================================================================
// A-G: CAPABILITY TESTS - real FormatLogger render, minute-pattern branch
// ===========================================================================
describe('CAPABILITY TESTS - EMOM minute-pattern station renders fields from the EFFECTIVE instance, never a generic Sets schema', () => {
  const config = { stationMode: 'minute-pattern', totalRounds: 3, intervalSec: 60, scoringMode: 'Total Reps' }
  const prescriptionMovements = [pushUp, airSquat, pullUp]

  it('A/B/C - Push-up/Air Squat/Pull-up render REPS only, no load field, target visible read-only', () => {
    render(<FormatLogger formatId="EMOM" config={config} movements={prescriptionMovements.map(m => m.name)}
      prescriptionMovements={prescriptionMovements} value={{}} onChange={() => {}} t={{}} />)
    expect(screen.getAllByPlaceholderText('reps')).toHaveLength(3)
    expect(screen.queryByPlaceholderText('kg')).not.toBeInTheDocument()
    expect(screen.getAllByText('/ 12')).toHaveLength(2) // Push-up AND Air Squat targets
    expect(screen.getByText('/ 8')).toBeInTheDocument() // Pull-up target
  })

  it('A - Push-up target 12, actual 8 -> reps 8 saved, no load field ever appears', () => {
    let lastPatch = null
    render(<FormatLogger formatId="EMOM" config={config} movements={prescriptionMovements.map(m => m.name)}
      prescriptionMovements={prescriptionMovements} value={{}} onChange={(v) => { lastPatch = v }} t={{}} />)
    fireEvent.change(screen.getAllByPlaceholderText('reps')[0], { target: { value: '8' } })
    expect(lastPatch.sets[emomStationKey(1, 1, 'Push-up')][0].reps).toBe('8')
    expect(screen.queryByPlaceholderText('kg')).not.toBeInTheDocument()
  })

  it('D - Clean & Jerk target 12@43, actual 8@40 -> reps 8 / load 40, both fields present', () => {
    const cfg = { stationMode: 'minute-pattern', totalRounds: 1, intervalSec: 60 }
    let lastPatch = null
    render(<ControlledFormatLogger formatId="EMOM" config={cfg} movements={['Clean & Jerk']}
      prescriptionMovements={[cleanJerk]} onLatest={(v) => { lastPatch = v }} />)
    fireEvent.change(screen.getByPlaceholderText('reps'), { target: { value: '8' } })
    fireEvent.change(screen.getByPlaceholderText('kg'), { target: { value: '40' } })
    const row = lastPatch.sets[emomStationKey(1, 1, 'Clean & Jerk')][0]
    expect(row.reps).toBe('8')
    expect(row.weight).toBe('40')
  })

  it('E - Row target 12cal, actual 10cal -> calories 10 (via the reps row field, no load field)', () => {
    const cfg = { stationMode: 'minute-pattern', totalRounds: 1, intervalSec: 60 }
    let lastPatch = null
    render(<FormatLogger formatId="EMOM" config={cfg} movements={['Row']}
      prescriptionMovements={[rowCal]} value={{}} onChange={(v) => { lastPatch = v }} t={{}} />)
    const calInput = screen.getByPlaceholderText('cal')
    fireEvent.change(calInput, { target: { value: '10' } })
    expect(lastPatch.sets[emomStationKey(1, 1, 'Row')][0].reps).toBe('10')
    expect(screen.queryByPlaceholderText('reps')).not.toBeInTheDocument()
    expect(screen.queryByPlaceholderText('kg')).not.toBeInTheDocument()
  })

  it('G - Run target 200m, actual 175m -> distance 175, on its own `distance` row field', () => {
    const cfg = { stationMode: 'minute-pattern', totalRounds: 1, intervalSec: 60 }
    let lastPatch = null
    render(<FormatLogger formatId="EMOM" config={cfg} movements={['Run']}
      prescriptionMovements={[run]} value={{}} onChange={(v) => { lastPatch = v }} t={{}} />)
    const distInput = screen.getByPlaceholderText('m')
    fireEvent.change(distInput, { target: { value: '175' } })
    expect(lastPatch.sets[emomStationKey(1, 1, 'Run')][0].distance).toBe('175')
  })

  it('unknown/unseeded capability (no metric spec at all) falls back to a bare reps input, never renders nothing', () => {
    const cfg = { stationMode: 'minute-pattern', totalRounds: 1, intervalSec: 60 }
    render(<FormatLogger formatId="EMOM" config={cfg} movements={['Mystery Move']}
      prescriptionMovements={[{ instanceId: 'mi_x', name: 'Mystery Move', patternMinute: 0 }]}
      value={{}} onChange={() => {}} t={{}} />)
    expect(screen.getAllByPlaceholderText('reps')).toHaveLength(1)
  })
})

// F - Row calories -> distance switch (pure helper, reused verbatim from
// prescriptionContract.js - the SAME function PerformedEditRow already uses)
describe('F - Row calories -> distance switch clears the incompatible value, no conversion', () => {
  it('switchPerformedQuantityMetric deletes calories, seeds distance blank', () => {
    const next = switchPerformedQuantityMetric(rowCal, 'distance')
    expect(next.calories).toBeUndefined()
    expect(next.distance).toEqual({ mode: 'universal', value: null, unit: 'm' })
  })
  it('the FormatLogger cell reflects the switched instance: distance field, no stale calories', () => {
    const switched = switchPerformedQuantityMetric(rowCal, 'distance')
    const cfg = { stationMode: 'minute-pattern', totalRounds: 1, intervalSec: 60 }
    render(<FormatLogger formatId="EMOM" config={cfg} movements={['Row']}
      prescriptionMovements={[switched]} value={{}} onChange={() => {}} t={{}} />)
    expect(screen.getByPlaceholderText('m')).toBeInTheDocument()
    expect(screen.queryByPlaceholderText('cal')).not.toBeInTheDocument()
  })
})

// ===========================================================================
// H-M: SUBSTITUTION TESTS - pure helpers, real production functions
// ===========================================================================
describe('SUBSTITUTION TESTS', () => {
  it('H - Bodyweight -> weighted: compatible reps preserved, load initialized blank', () => {
    const next = applyPerformedSubstitution(pushUp, { id: 'cm-cj', name: 'Clean & Jerk' }, capRepsLoad)
    expect(next.reps).toEqual(pushUp.reps)
    expect(next.load).toEqual({ mode: 'universal', value: null, unit: 'kg' })
  })
  it('I - Weighted -> bodyweight: reps preserved, load removed entirely', () => {
    const next = applyPerformedSubstitution(cleanJerk, { id: 'cm-pu', name: 'Push-up' }, capReps)
    expect(next.reps).toEqual(cleanJerk.reps)
    expect(next.load).toBeUndefined()
  })
  it('J - Weighted -> Row: reps/load removed, quantity initialized blank (no conversion of 12 -> 12cal)', () => {
    const next = applyPerformedSubstitution(cleanJerk, { id: 'cm-row', name: 'Row' }, capCalDist)
    expect(next.reps).toBeUndefined()
    expect(next.load).toBeUndefined()
    expect(next.calories).toEqual({ mode: 'universal', value: null })
    expect(next.distance).toBeUndefined()
  })
  it('K - Row calories -> distance: no stale calories value survives', () => {
    const next = switchPerformedQuantityMetric(rowCal, 'distance')
    expect(next.calories).toBeUndefined()
    expect(next.distance.value).toBeNull()
  })
  it('L - Add movement: correct source identity, capability-seeded fields (reps inherited from the source as an editable starting value - PerformedEditPanel\'s own established D3 convention, not a manufactured target)', () => {
    const doc = { version: 2, movements: [{ instanceId: 'mi_as_perf', sourceInstanceId: 'mi_as', name: 'Air Squat', reps: { mode: 'universal', value: 10 } }] }
    const next = addPerformedMovement(doc, 'mi_as', { id: 'cm-burpee', name: 'Burpee' }, capReps, { inheritReps: true })
    const added = next.movements.find((m) => m.name === 'Burpee')
    expect(added.sourceInstanceId).toBe('mi_as')
    expect(added.reps).toEqual({ mode: 'universal', value: 10 })
    expect(added.load).toBeUndefined()
  })
  it('M - Skip movement: markSourceNotPerformed produces a sentinel, no metric specs, no target-derived score', () => {
    const doc = { version: 2, movements: [{ instanceId: 'mi_pl_perf', sourceInstanceId: 'mi_pl', name: 'Pull-up', reps: { mode: 'universal', value: 8 } }] }
    const next = markSourceNotPerformed(doc, 'mi_pl', 'Pull-up')
    const sentinel = next.movements.find((m) => m.sourceInstanceId === 'mi_pl')
    expect(sentinel.notPerformed).toBe(true)
    expect(sentinel.reps).toBeUndefined()
  })
})

// ===========================================================================
// N-R: SCORING TESTS - canonical computeSetsScore, unchanged semantics
// ===========================================================================
describe('SCORING TESTS - programmed targets never manufacture performed evidence', () => {
  it('N - targets 12/5/2, actual 8/5/blank -> 13 reps (blank contributes nothing)', () => {
    const rowsByKey = {
      [emomStationKey(1, 1, 'A')]: [{ reps: '8' }],
      [emomStationKey(2, 1, 'B')]: [{ reps: '5' }],
      [emomStationKey(3, 1, 'C')]: [{ reps: '' }],
    }
    expect(computeSetsScore('EMOM', { scoringMode: 'Total Reps' }, rowsByKey)).toBe(13)
  })
  it('O - targets 12/5/2, actual 8/0/blank -> 8 reps (explicit zero contributes zero, distinct from blank)', () => {
    const rowsByKey = {
      [emomStationKey(1, 1, 'A')]: [{ reps: '8' }],
      [emomStationKey(2, 1, 'B')]: [{ reps: '0' }],
      [emomStationKey(3, 1, 'C')]: [{ reps: '' }],
    }
    expect(computeSetsScore('EMOM', { scoringMode: 'Total Reps' }, rowsByKey)).toBe(8)
  })
  it('P - two cycles 8/5/2/10/4/1 -> 30 reps', () => {
    const values = [8, 5, 2, 10, 4, 1]
    const rowsByKey = {}
    values.forEach((v, i) => { rowsByKey[emomStationKey(i + 1, 1, 'A')] = [{ reps: String(v) }] })
    expect(computeSetsScore('EMOM', { scoringMode: 'Total Reps' }, rowsByKey)).toBe(30)
  })
  it('Q - weighted reps 8@40 -> score contribution 8, never 48 (load never folded into reps)', () => {
    const rowsByKey = { [emomStationKey(1, 1, 'Clean & Jerk')]: [{ reps: '8', weight: '40' }] }
    expect(computeSetsScore('EMOM', { scoringMode: 'Total Reps' }, rowsByKey)).toBe(8)
    expect(computeSetsScore('EMOM', { scoringMode: 'Total Reps' }, rowsByKey)).not.toBe(48)
  })
  it('R - mixed reps+calories: unit-homogeneity guard blocks a false Total Reps aggregation', () => {
    const config = { stationMode: 'minute-pattern', totalRounds: 1, intervalSec: 60, scoringMode: 'Total Reps' }
    const instances = [
      { instanceId: 'mi_a', name: 'Burpee', patternMinute: 0, reps: { mode: 'universal', value: 10 } },
      { instanceId: 'mi_b', name: 'Cal Row', patternMinute: 0, calories: { mode: 'universal', value: 12 } },
    ]
    const unitsByKey = resolveStationUnitsByKey('EMOM', config, instances)
    const rowsByKey = {
      [emomStationKey(1, 1, 'Burpee')]: [{ reps: '10' }],
      [emomStationKey(1, 2, 'Cal Row')]: [{ reps: '12' }],
    }
    expect(computeSetsScore('EMOM', config, rowsByKey, unitsByKey)).toBeNull()
  })
})

// ===========================================================================
// S-W: PERSISTENCE TESTS
// ===========================================================================
describe('PERSISTENCE TESTS', () => {
  it('S - save/reopen preserves actual quantities, units, station identities (round-trip through real rowsByKey shape)', () => {
    const config = { stationMode: 'minute-pattern', totalRounds: 1, intervalSec: 60 }
    let saved = null
    const { unmount } = render(<ControlledFormatLogger formatId="EMOM" config={config} movements={['Clean & Jerk']}
      prescriptionMovements={[cleanJerk]} onLatest={(v) => { saved = v }} />)
    fireEvent.change(screen.getByPlaceholderText('reps'), { target: { value: '8' } })
    fireEvent.change(screen.getByPlaceholderText('kg'), { target: { value: '40' } })
    unmount()
    // Reopen: feed the saved sets back in as `value.sets` (exactly what an
    // edit-existing-log reopen does) and confirm the SAME values redisplay.
    render(<FormatLogger formatId="EMOM" config={config} movements={['Clean & Jerk']}
      prescriptionMovements={[cleanJerk]} value={saved} onChange={() => {}} t={{}} />)
    expect(screen.getByPlaceholderText('reps').value).toBe('8')
    expect(screen.getByPlaceholderText('kg').value).toBe('40')
  })

  it('T - a substitution in one pattern position does not alter another position\'s cells', () => {
    const config = { stationMode: 'minute-pattern', totalRounds: 3, intervalSec: 60 }
    const intervalComposition = {
      bySource: { mi_row_source: [{ instanceId: 'mi_row_perf', sourceInstanceId: 'mi_row_source', name: 'Row', calories: { mode: 'universal', value: null } }] },
    }
    const prescriptionMovements = [
      { instanceId: 'mi_row_source', name: 'Burpee', patternMinute: 0, reps: { mode: 'universal', value: 10 } },
      airSquat,
    ]
    let lastPatch = null
    render(<FormatLogger formatId="EMOM" config={config} movements={prescriptionMovements.map(m => m.name)}
      prescriptionMovements={prescriptionMovements} intervalComposition={intervalComposition}
      value={{}} onChange={(v) => { lastPatch = v }} t={{}} />)
    // Position 0 (Burpee, substituted to Row) shows a calories field now;
    // position 1 (Air Squat, untouched) still shows a plain reps field.
    const calInputs = screen.getAllByPlaceholderText('cal')
    expect(calInputs).toHaveLength(2) // position 0 (patternLength 2) recurs at minutes 1 and 3 only
    fireEvent.change(calInputs[0], { target: { value: '9' } })
    // The OTHER position's own (pre-seeded, empty) row stays completely
    // untouched by an edit made to a DIFFERENT position's cell.
    expect(lastPatch.sets[emomStationKey(2, 1, 'Air Squat')]).toEqual([{ weight: '', reps: '', distance: '', completed: false }])
  })

  it('U - the frozen programmed prescription instance objects are never mutated by rendering/interacting', () => {
    const config = { stationMode: 'minute-pattern', totalRounds: 1, intervalSec: 60 }
    const frozen = JSON.parse(JSON.stringify(cleanJerk))
    const snapshotBefore = JSON.stringify(frozen)
    render(<FormatLogger formatId="EMOM" config={config} movements={['Clean & Jerk']}
      prescriptionMovements={[frozen]} value={{}} onChange={() => {}} t={{}} />)
    fireEvent.change(screen.getByPlaceholderText('reps'), { target: { value: '8' } })
    fireEvent.change(screen.getByPlaceholderText('kg'), { target: { value: '40' } })
    expect(JSON.stringify(frozen)).toBe(snapshotBefore)
  })

  it('V - Leaderboard/Journal/Photo read the SAME canonical score via sortSectionLogs/setsScoreText (no separate scorer)', () => {
    const config = { stationMode: 'minute-pattern', totalRounds: 2, intervalSec: 60, scoringMode: 'Total Reps' }
    const instances = [pushUp, airSquat]
    const rowsByKey = { [emomStationKey(1, 1, 'Push-up')]: [{ reps: '8' }], [emomStationKey(2, 1, 'Air Squat')]: [{ reps: '9' }] }
    const [ranked] = sortSectionLogs([{ id: 'l1', sets: rowsByKey, logged_at: '2026-09-07T10:00:00Z', prescription_snapshot: { movements: instances } }], 'EMOM', config)
    const unitsByKey = resolveStationUnitsByKey('EMOM', config, instances)
    const journalText = setsScoreText('EMOM', config, rowsByKey, 'kg', 'reps', unitsByKey)
    expect(ranked._setsScore).toBe(17)
    expect(journalText).toBe('17 reps')
  })

  it('W - real WOD save round-trip through wodSections keeps EMOM minute-pattern authoring/serialization green (existing regression boundary untouched)', () => {
    const s = createSection('metcon', true)
    s.format = 'EMOM'
    s.formatConfig = { totalRounds: 3, intervalSec: 60 }
    s.variants.rx.instances = [pushUp, airSquat, pullUp]
    const payload = legacyPayloadFromSections([s])
    expect(payload.format_config.stationMode).toBe('minute-pattern')
    expect(payload.movement_prescriptions.variants.rx.movements.map((m) => m.name)).toEqual(['Push-up', 'Air Squat', 'Pull-up'])
  })
})

// ===========================================================================
// UniversalScoreInput regression - the actual root-cause fix, exercised
// through the REAL wrapper the primary logging screen renders (not
// FormatLogger directly - that's exactly what let this regress unnoticed).
// ===========================================================================
describe('ROOT CAUSE REGRESSION - UniversalScoreInput forwards prescriptionMovements to FormatLogger', () => {
  const config = { stationMode: 'minute-pattern', totalRounds: 6, intervalSec: 150 }
  const prescriptionMovements = [pushUp, airSquat, pullUp]

  it('minute-pattern EMOM renders correctly (one movement per interval) through UniversalScoreInput, not the "all 3 every interval" collapse', () => {
    render(<UniversalScoreInput def={{ kind: 'SETS' }} formatId="EMOM" config={config}
      movements={prescriptionMovements.map(m => `${m.reps.value} ${m.name}`)}
      prescriptionMovements={prescriptionMovements} value={{}} onChange={() => {}} t={{}} weightUnit="kg" />)
    // 6 intervals x 1 movement each = 6 reps inputs, NEVER 18 (6 x 3).
    expect(screen.getAllByPlaceholderText('reps')).toHaveLength(6)
    expect(screen.getAllByText('Push-up')).toHaveLength(2) // intervals 1 and 4 only
  })

  it('WITHOUT the fix (prescriptionMovements omitted), the pre-existing fallback bug is reproduced - documents the exact regression this fix closes', () => {
    render(<UniversalScoreInput def={{ kind: 'SETS' }} formatId="EMOM" config={config}
      movements={prescriptionMovements.map(m => `${m.reps.value} ${m.name}`)}
      value={{}} onChange={() => {}} t={{}} weightUnit="kg" />)
    // Falls back to plain movements (no patternMinute) - every movement
    // collapses to position 0 and repeats on all 6 intervals: 18 inputs.
    expect(screen.getAllByPlaceholderText('reps')).toHaveLength(18)
  })
})
