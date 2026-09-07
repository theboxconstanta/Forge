// FORGE - STRENGTH SETS OPTIONAL LOAD - LIVE REGRESSION FORENSIC TRACE
//
// The prior fix (e24d9e6) added a "remove" link for a load-default
// movement's Load field, and proved (via a trace using that exact click)
// that the transition to a fully valid, load-absent prescription worked.
// That trace was real but incomplete: it never asked whether a coach who
// simply NEVER TOUCHES the Load field at all - the natural, most common
// flow, since you don't normally click into a field you don't want to fill -
// would ALSO reach that state. This file adds that missing stage and PROVES
// (not infers) the actual live-reproducible transition:
//
//   STAGE 1 (type "Snatch", load never touched) - BEFORE this fix:
//     changeName() saw a bare instance and a load-default capability, and
//     seed() auto-added BOTH `load: {male:null,female:null}` (present but
//     blank) AND `reps`. The coach never asked for a Load field, got one
//     anyway, and validatePrescriptionsForPublish's correct, UNCHANGED
//     "a present characteristic must be fully filled" rule blocked save -
//     with NO save action available to the coach that reaches a valid state
//     unless they separately discover and click the small "remove" link.
//     THIS is what the owner's live session reproduced: they likely never
//     needed to click "remove" mentally (why would you remove a field you
//     never asked to see?), so save kept failing even though the Preview
//     (which already tolerated a present-but-blank load spec gracefully)
//     looked correct.
//
//   STAGE 1, AFTER this fix: seed() (App.jsx) and newMovementInstance()
//   (prescriptionContract.js, the paste-workout path) no longer auto-add
//   `load` for a movement whose capability ALSO allows `reps` - only `reps`
//   is seeded. Load starts genuinely ABSENT, reachable via the existing
//   explicit "+ Load" opt-in button. The "remove" link (e24d9e6) remains as
//   a backstop for a coach who explicitly opted into Load and changes their
//   mind.
//
// Both real flows are traced end to end through the REAL production save
// call shape (App.jsx saveWod(): legacyPayloadFromSections(flushed,
// {movementIndex}) + validatePrescriptionCompleteness(flushed)).

import { describe, it, expect, afterEach } from 'vitest'
import { useState } from 'react'
import { render, screen, cleanup, fireEvent } from '@testing-library/react'
import { MovementRowListPWA } from './App.jsx'
import FormatLogger from './FormatLogger'
import { createSection, legacyPayloadFromSections, validatePrescriptionCompleteness } from './wodSections.js'
import { resolveMovementCapability, buildMovementIndex, parseWorkoutPaste } from './prescriptionContract.js'

afterEach(cleanup)

const CATALOG = [{ id: 'cm-snatch', name: 'Snatch', allowed_prescription_metrics: ['reps', 'load'], default_prescription_metric: 'load' }]
const movementIndex = buildMovementIndex(CATALOG)
const catalog = {
  capabilityFor: (name) => resolveMovementCapability(CATALOG.find((r) => r.name.toLowerCase() === (name || '').toLowerCase())),
  capabilityForInstance: (inst) => resolveMovementCapability(movementIndex.byId.get(inst?.canonicalMovementId)),
  lookupForParse: (name) => CATALOG.find((r) => r.name.toLowerCase() === (name || '').toLowerCase()) || null,
  suggestions: () => [],
  index: movementIndex,
}

function ControlledBuilder({ onLatest }) {
  const [instances, setInstances] = useState([])
  return (
    <MovementRowListPWA instances={instances} catalog={catalog}
      onChange={(next) => { setInstances(next); onLatest(next) }} />
  )
}

function traceStagesFor(latest, label) {
  const section = createSection('metcon', true)
  section.format = 'Strength Sets'
  section.formatConfig = { setsScheme: [5, 5, 4, 4, 4, 3, 3] }
  section.variants.rx.instances = latest
  const payload = legacyPayloadFromSections([section], { movementIndex })
  const serializedSnatch = payload.movement_prescriptions.variants.rx.movements[0]
  const errors = validatePrescriptionCompleteness([section])
  // eslint-disable-next-line no-console
  console.log(`[${label}] section instance:`, JSON.stringify(section.variants.rx.instances[0]))
  // eslint-disable-next-line no-console
  console.log(`[${label}] serialized (with movementIndex, matches production):`, JSON.stringify(serializedSnatch))
  // eslint-disable-next-line no-console
  console.log(`[${label}] validatePrescriptionCompleteness errors:`, JSON.stringify(errors))
  return { section, payload, serializedSnatch, errors }
}

describe('FORENSIC TRACE A - the NATURAL flow: type "Snatch", never touch Load at all', () => {
  it('THE ACTUAL LIVE-REPRODUCIBLE GAP: load is never auto-added, so nothing needs removing - save succeeds by default', () => {
    let latest = []
    render(<ControlledBuilder onLatest={(v) => { latest = v }} />)
    fireEvent.click(screen.getByText('+ Add movement'))
    console.log('STAGE 0 (bare, just added):', JSON.stringify(latest[0]))
    fireEvent.change(screen.getByLabelText('Movement name'), { target: { value: 'Snatch' } })
    console.log('STAGE 1 (after typing "Snatch", load NEVER touched):', JSON.stringify(latest[0]))

    // The fix under test: no `load` key at all, only `reps`.
    expect('load' in latest[0]).toBe(false)
    expect(latest[0].reps).toEqual({ mode: 'universal', value: null })
    // The Coach Builder shows an opt-in "+ Load" link, not a pre-filled field.
    expect(screen.getByText('+ Load')).toBeInTheDocument()
    expect(screen.queryByText('remove')).not.toBeInTheDocument()

    const { errors, serializedSnatch } = traceStagesFor(latest, 'natural flow')
    expect(errors).toEqual([]) // SAVE: SUCCESS
    expect('load' in serializedSnatch).toBe(false) // SERIALIZED: NO load key
  })
})

describe('FORENSIC TRACE B - explicit opt-in then change of mind: "+ Load" then "remove" (the e24d9e6 backstop, still works)', () => {
  it('a coach who explicitly adds Load then removes it also lands on a valid, load-absent prescription', () => {
    let latest = []
    render(<ControlledBuilder onLatest={(v) => { latest = v }} />)
    fireEvent.click(screen.getByText('+ Add movement'))
    fireEvent.change(screen.getByLabelText('Movement name'), { target: { value: 'Snatch' } })
    fireEvent.click(screen.getByText('+ Load')) // explicit opt-in
    console.log('STAGE (after clicking "+ Load"):', JSON.stringify(latest[0]))
    expect(latest[0].load).toEqual({ mode: 'sex_specific', male: null, female: null, unit: 'kg' })

    fireEvent.click(screen.getByText('remove'))
    console.log('STAGE (after clicking "remove"):', JSON.stringify(latest[0]))
    expect('load' in latest[0]).toBe(false)

    const { errors, serializedSnatch } = traceStagesFor(latest, 'opt-in then remove')
    expect(errors).toEqual([])
    expect('load' in serializedSnatch).toBe(false)
  })
})

describe('OWNER ORACLE - full round trip through the natural flow', () => {
  it('save succeeds, reload keeps load absent, Member Logger still exposes reps + load per movement capability', () => {
    let latest = []
    render(<ControlledBuilder onLatest={(v) => { latest = v }} />)
    fireEvent.click(screen.getByText('+ Add movement'))
    fireEvent.change(screen.getByLabelText('Movement name'), { target: { value: 'Snatch' } })
    // Load is never touched - the realistic flow.

    const section = createSection('metcon', true)
    section.format = 'Strength Sets'
    section.formatConfig = { setsScheme: [5, 5, 4, 4, 4, 3, 3] }
    section.variants.rx.instances = latest

    expect(validatePrescriptionCompleteness([section])).toEqual([]) // SAVE: SUCCESS

    const payload = JSON.parse(JSON.stringify(legacyPayloadFromSections([section], { movementIndex })))
    expect('load' in payload.movement_prescriptions.variants.rx.movements[0]).toBe(false) // RELOAD: NO load key
    expect(payload.format_config.setsScheme).toEqual([5, 5, 4, 4, 4, 3, 3])

    cleanup()
    const reloadedMovements = payload.movement_prescriptions.variants.rx.movements.map((m) => m.name)
    render(<FormatLogger formatId="Strength Sets" config={payload.format_config} movements={reloadedMovements}
      value={{}} onChange={() => {}} weightUnit="kg" t={{}} />)
    // MEMBER LOGGER: 7 rows, REPS + LOAD (capability, not programmed presence).
    expect(screen.getAllByPlaceholderText('reps')).toHaveLength(7)
    expect(screen.getAllByPlaceholderText('kg')).toHaveLength(7)
  })
})

describe('PASTE WORKOUT PATH - the same fix in newMovementInstance (prescriptionContract.js), used by parseWorkoutPaste', () => {
  it('pasting "5 Snatch" (no @load) also produces a load-absent, reps-only instance', () => {
    const { movements } = parseWorkoutPaste('5 Snatch', { lookupCanonical: (name) => catalog.lookupForParse(name) })
    expect(movements).toHaveLength(1)
    const inst = movements[0].instance
    console.log('pasted instance:', JSON.stringify(inst))
    expect('load' in inst).toBe(false)
  })
})

describe('REGRESSION - a load-only capability (no reps allowed) still auto-seeds load, since nothing else would be shown', () => {
  it('a movement whose capability is load-ONLY keeps the original auto-seed behavior', () => {
    const loadOnlyCatalog = {
      capabilityFor: () => resolveMovementCapability({ allowed_prescription_metrics: ['load'], default_prescription_metric: 'load' }),
      capabilityForInstance: () => resolveMovementCapability({ allowed_prescription_metrics: ['load'], default_prescription_metric: 'load' }),
      lookupForParse: () => null,
      suggestions: () => [],
    }
    let latest = []
    function Wrap() {
      const [instances, setInstances] = useState([])
      return <MovementRowListPWA instances={instances} catalog={loadOnlyCatalog} onChange={(n) => { setInstances(n); latest = n }} />
    }
    render(<Wrap />)
    fireEvent.click(screen.getByText('+ Add movement'))
    fireEvent.change(screen.getByLabelText('Movement name'), { target: { value: 'Max Effort Move' } })
    expect(latest[0].load).toEqual({ mode: 'sex_specific', male: null, female: null, unit: 'kg' })
    // no "remove" for a load-only capability - removing it would leave nothing.
    expect(screen.queryByText('remove')).not.toBeInTheDocument()
  })
})
