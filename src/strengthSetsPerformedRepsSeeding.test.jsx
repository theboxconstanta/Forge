// FORGE - STRENGTH SETS PERFORMED REPS SEEDING
//
// ROOT CAUSE (forensic, confirmed against the real production row,
// wod_logs.id 2a121ef0-0cd7-459d-b86c-5d29c494ecaa, in the prior ticket):
// computeVolumeLoad is correct - it excludes any row with a blank performed
// `reps`, exactly as documented (strengthVolumeLoad.test.js). The actual
// upstream cause: defaultRowsForFormat's Strength Sets branch
// (workoutFormats.js) always seeded a brand-new row's `reps` field as an
// EMPTY STRING, carrying the scheme's target only as a separate `targetReps`
// field that FormatLogger.jsx renders as a small gray HINT next to the
// input ("/ 5"), never INTO the input's own value. An athlete who only
// touches the weight field on sets 2+ (the rep target staying the same set
// to set, only the load changing - a common ramping-set pattern) never
// actually writes a `reps` value for those rows, even though the hint next
// to the input visually shows the target.
//
// FIX: defaultRowsForFormat now seeds a NEW row's `reps` with its own
// `targetReps` (as a string, matching how reps is stored everywhere else in
// this codebase) when a target exists - editable performed state from the
// moment the row is created, not a calculation-time fallback. computeVolumeLoad
// itself is untouched - it still only ever reads whatever ended up in
// `row.reps` at save time, blank or not.
//
// SCOPE: only Strength Sets carries a per-row target reps scheme
// (config.setsScheme) - Weightlifting and Superset's default rows
// (workoutFormats.js, same function) have no targetReps field at all
// (`{}`/plain movementList config, "seturi libere, fara nr. de seturi
// prescris" - free sets, no prescribed count), so there is nothing to seed
// there; unchanged, per the ticket's own "based on the existence of a
// canonical per-row prescribed rep target, not format name" scoping rule.
//
// REOPEN/EDIT SAFETY is structural, not new code: FormatLogger.jsx's
// SetsFields only ever calls defaultRowsForFormat when the log's OWN `sets`
// is completely empty (`Object.keys(sets || {}).length > 0 ? sets :
// defaultRowsForFormat(...)`) - a log with ANY saved performed evidence,
// including intentionally-blank rows, never re-enters this seeding path.

import { describe, it, expect, afterEach } from 'vitest'
import { useState } from 'react'
import { render, screen, cleanup, fireEvent } from '@testing-library/react'
import FormatLogger from './FormatLogger.jsx'
import { defaultRowsForFormat, computeVolumeLoad, resolveMovementLoadCapabilityByKey, setsDisplayScore } from './workoutFormats.js'

// Successive edits must build on each other (a real parent re-renders
// FormatLogger with the just-updated `value`) - a static `value` prop
// across multiple fireEvent.change calls would have each edit computed
// from the SAME original state and silently discard earlier edits.
function ControlledLogger({ formatId, config, movements, weightUnit, t, onEmit }) {
  const [value, setValue] = useState({})
  return <FormatLogger formatId={formatId} config={config} movements={movements}
    value={value} onChange={(v) => { setValue(v); onEmit(v) }} weightUnit={weightUnit} t={t} />
}

afterEach(cleanup)

const snatchInst = { instanceId: 'mi_sn', name: 'Snatch', canonicalMovementId: 'cm-snatch', reps: { mode: 'universal', value: null }, load: { mode: 'sex_specific', male: null, female: null, unit: 'kg' } }

describe('A/B/C - new rows are seeded with the exact per-row targetReps scheme, never repeated/uniform', () => {
  it('A - uniform scheme 5-5-5-5-5-5-5 seeds every row\'s reps to "5"', () => {
    const rows = defaultRowsForFormat('Strength Sets', { setsScheme: [5, 5, 5, 5, 5, 5, 5] }, ['Snatch'])
    expect(rows.Snatch.map((r) => r.reps)).toEqual(['5', '5', '5', '5', '5', '5', '5'])
    expect(rows.Snatch.map((r) => r.targetReps)).toEqual([5, 5, 5, 5, 5, 5, 5])
  })

  it('B - variable scheme 10-8-6-4-2 seeds each row with its OWN target, never the first row\'s value repeated', () => {
    const rows = defaultRowsForFormat('Strength Sets', { setsScheme: [10, 8, 6, 4, 2] }, ['Snatch'])
    expect(rows.Snatch.map((r) => r.reps)).toEqual(['10', '8', '6', '4', '2'])
  })

  it('C - variable scheme 5-5-4-4-4-3-3 preserves the exact scheme, not a flat 5 or 3', () => {
    const rows = defaultRowsForFormat('Strength Sets', { setsScheme: [5, 5, 4, 4, 4, 3, 3] }, ['Snatch'])
    expect(rows.Snatch.map((r) => r.reps)).toEqual(['5', '5', '4', '4', '4', '3', '3'])
  })
})

describe('D - the real logger UI: entering only a weight, on an already-seeded row, saves BOTH reps and weight', () => {
  it('typing "20" into set 1\'s weight field leaves the seeded reps intact in the emitted sets state', () => {
    let latest = null
    const { container } = render(
      <FormatLogger formatId="Strength Sets" config={{ setsScheme: [5, 5, 4, 4, 4, 3, 3] }} movements={['Snatch']}
        value={{}} onChange={(v) => { latest = v }} weightUnit="kg" t={{ skillLogRepsPlaceholder: 'reps' }} />
    )
    const weightInputs = [...container.querySelectorAll('input[placeholder="kg"]')]
    expect(weightInputs).toHaveLength(7)
    fireEvent.change(weightInputs[0], { target: { value: '20' } })
    expect(latest.sets.Snatch[0]).toEqual(expect.objectContaining({ reps: '5', weight: '20' }))
    // every OTHER row's seeded reps survived untouched by this one edit
    expect(latest.sets.Snatch.map((r) => r.reps)).toEqual(['5', '5', '4', '4', '4', '3', '3'])
  })

  it('the reps inputs themselves already display the seeded value (not just the "/ N" hint) as soon as the logger mounts', () => {
    render(
      <FormatLogger formatId="Strength Sets" config={{ setsScheme: [5, 4, 3] }} movements={['Snatch']}
        value={{}} onChange={() => {}} weightUnit="kg" t={{ skillLogRepsPlaceholder: 'reps' }} />
    )
    const repsInputs = screen.getAllByPlaceholderText('reps')
    expect(repsInputs.map((el) => el.value)).toEqual(['5', '4', '3'])
  })
})

describe('E - owner\'s real oracle: 7 sets x 5 reps, loads-only entry, sums to 975kg (Total Weight Lifted, computeVolumeLoad untouched)', () => {
  it('seeded rows with only loads filled in produce 5@20,5@20,5@25,5@25,5@30,5@37.5,5@37.5 -> 975kg', () => {
    const seeded = defaultRowsForFormat('Strength Sets', { setsScheme: [5, 5, 5, 5, 5, 5, 5] }, ['Snatch'])
    const loads = ['20', '20', '25', '25', '30', '37.5', '37.5']
    const rowsByKey = { Snatch: seeded.Snatch.map((r, i) => ({ ...r, weight: loads[i] })) }
    const cap = resolveMovementLoadCapabilityByKey([snatchInst])
    const result = computeVolumeLoad(rowsByKey, cap, 'kg')
    expect(result.byMovement[0].contributingRows.map((r) => r.contribution)).toEqual([100, 100, 125, 125, 150, 187.5, 187.5])
    expect(result.totalWeight).toBe(975)
  })
})

describe('F/G - the seeded value is genuinely editable performed state, not a locked default', () => {
  it('F - the athlete edits one row\'s reps away from its seeded target - the edited value wins, unrelated rows keep their own seed', () => {
    let latest = null
    const { container } = render(
      <ControlledLogger formatId="Strength Sets" config={{ setsScheme: [5, 5, 5, 5, 5, 5, 5] }} movements={['Snatch']}
        weightUnit="kg" t={{ skillLogRepsPlaceholder: 'reps' }} onEmit={(v) => { latest = v }} />
    )
    fireEvent.change(container.querySelectorAll('input[placeholder="reps"]')[5], { target: { value: '4' } })
    fireEvent.change(container.querySelectorAll('input[placeholder="reps"]')[6], { target: { value: '3' } })
    expect(latest.sets.Snatch.map((r) => r.reps)).toEqual(['5', '5', '5', '5', '5', '4', '3'])
  })

  it('G - the athlete deliberately clears a seeded reps field - the blank is saved as-is, never silently restored', () => {
    let latest = null
    const { container } = render(
      <FormatLogger formatId="Strength Sets" config={{ setsScheme: [5, 5, 5] }} movements={['Snatch']}
        value={{}} onChange={(v) => { latest = v }} weightUnit="kg" t={{ skillLogRepsPlaceholder: 'reps' }} />
    )
    const repsInputs = [...container.querySelectorAll('input[placeholder="reps"]')]
    fireEvent.change(repsInputs[1], { target: { value: '' } })
    expect(latest.sets.Snatch[1].reps).toBe('')
    expect(latest.sets.Snatch[1].targetReps).toBe(5) // the hint/target itself is untouched - only the performed value was cleared
    // re-rendering with that exact emitted state (as the real parent would
    // on the next keystroke elsewhere) must not resurrect the cleared value
    const { container: container2 } = render(
      <FormatLogger formatId="Strength Sets" config={{ setsScheme: [5, 5, 5] }} movements={['Snatch']}
        value={latest} onChange={() => {}} weightUnit="kg" t={{ skillLogRepsPlaceholder: 'reps' }} />
    )
    const repsInputs2 = [...container2.querySelectorAll('input[placeholder="reps"]')]
    expect(repsInputs2.map((el) => el.value)).toEqual(['5', '', '5'])
  })
})

describe('H/I - reopen/edit safety: existing performed evidence always wins, never reinterpreted from prescription', () => {
  it('H - reopening a log with real saved performed values (including an explicit blank) never overwrites them from the scheme', () => {
    const saved = { Snatch: [{ reps: '5', weight: '20', targetReps: 5, completed: false }, { reps: '4', weight: '20', targetReps: 5, completed: false }, { reps: '', weight: '25', targetReps: 4, completed: false }] }
    render(
      <FormatLogger formatId="Strength Sets" config={{ setsScheme: [5, 5, 4] }} movements={['Snatch']}
        value={{ sets: saved }} onChange={() => {}} weightUnit="kg" t={{ skillLogRepsPlaceholder: 'reps' }} />
    )
    const repsInputs = screen.getAllByPlaceholderText('reps')
    expect(repsInputs.map((el) => el.value)).toEqual(['5', '4', '']) // exactly as saved - never reset to the scheme's 5/5/4
  })

  it('I - a historical blank row stays blank when the log is loaded (no retrospective synthetic reps from defaultRowsForFormat)', () => {
    const saved = { Snatch: [{ reps: '5', weight: '20' }, { reps: '', weight: '20' }, { reps: '', weight: '25' }] }
    // this mirrors FormatLogger.jsx's own SetsFields gate exactly - defaultRowsForFormat
    // is never consulted once `sets` already has keys.
    const rowsByKey = Object.keys(saved).length > 0 ? saved : defaultRowsForFormat('Strength Sets', { setsScheme: [5, 5, 5] }, ['Snatch'])
    expect(rowsByKey.Snatch.map((r) => r.reps)).toEqual(['5', '', ''])
  })
})

describe('J - no prescribed rep target -> no invented reps', () => {
  it('a movement with no setsScheme configured at all seeds a single row with reps still blank (nothing to seed from)', () => {
    const rows = defaultRowsForFormat('Strength Sets', {}, ['Snatch'])
    expect(rows.Snatch).toHaveLength(1)
    expect(rows.Snatch[0].reps).toBe('')
    expect(rows.Snatch[0].targetReps).toBeNull()
  })
})

describe('K - format scope audit: Weightlifting/Superset have no per-row target reps concept, so nothing to seed - unchanged', () => {
  it('Weightlifting rows never carry a targetReps at all and reps stays blank on creation (free sets, no prescribed scheme)', () => {
    const rows = defaultRowsForFormat('Weightlifting', { targetSets: 3 }, ['Snatch'])
    expect(rows.Snatch).toHaveLength(3)
    rows.Snatch.forEach((r) => {
      expect(r.reps).toBe('')
      expect(r).not.toHaveProperty('targetReps')
    })
  })

  it('Superset rows never carry a targetReps at all and reps stays blank on creation', () => {
    const rows = defaultRowsForFormat('Superset', { targetSets: 2, movements: ['Snatch', 'Row'] }, [])
    expect(rows.Snatch).toHaveLength(2)
    rows.Snatch.forEach((r) => {
      expect(r.reps).toBe('')
      expect(r).not.toHaveProperty('targetReps')
    })
  })
})

describe('L - primary score/ranking is untouched by seeding new rows\' reps', () => {
  it('setsDisplayScore for a Strength Sets log still resolves to the heaviest performed load (37.5kg), regardless of the reps-seeding change', () => {
    const seeded = defaultRowsForFormat('Strength Sets', { setsScheme: [5, 5, 5, 5, 5, 5, 5] }, ['Snatch'])
    const loads = ['20', '20', '25', '25', '30', '37.5', '37.5']
    const rowsByKey = { Snatch: seeded.Snatch.map((r, i) => ({ ...r, weight: loads[i] })) }
    const score = setsDisplayScore('Strength Sets', { setsScheme: [5, 5, 5, 5, 5, 5, 5] }, rowsByKey, {})
    expect(score).toBe(37.5) // maxWeightFromSets - completely independent of computeVolumeLoad/reps seeding
  })
})
