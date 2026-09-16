// FORGE WORKOUT COMPOSER - MULTI-PART SCORING TICKET (Parts 1-7, 15-16).
//
// Covers the Max Effort / For Load component end to end: Composer
// authoring (picker + config editor), scoreDefinitionFor's LOAD wiring
// (kg/lb), compose/hydrate round-trip, and the canonical target workout
// (For Time with a real Time Cap THEN an independent timed Max Effort/Load
// component) through the full multi-scorer log/save/reload/edit chain -
// including a DNF in one part never erasing the other part's valid result.
//
// This file never reimplements a native format's engine - it only proves
// the NEW additive wiring (COMPOSER_FORMAT_GROUPS entry, defaultConfigForFormat,
// composeEnvelopeNativeResult's single_value/Max Effort branch,
// hydrateScorerLoggerValueFromNativeResult's load_result branch,
// scoreDefinitionFor's singleValueUnit:'load' opt) reuses the EXISTING
// generic Composer/UniversalScoreInput/FormatConfigEditor machinery.

import { useState } from 'react'
import { describe, it, expect, afterEach } from 'vitest'
import { render, screen, cleanup, fireEvent } from '@testing-library/react'
import ComposerEditor from './composerAuthoring'
import MultiScorerLogger from './composerLogging'
import { MovementRowListPWA, EmomMinutePatternEditor } from './App.jsx'
import {
  createComponent, componentHeaderLabel,
  getOrderedScoreEnvelopes, emptyScorerLoggerValue, hydrateScorerLoggerValueFromNativeResult,
  buildComposeInputsById, hydrateAllScorerValuesFromLog,
  composeComponentsLogFields, composeEnvelopeNativeResult, getComponentResultsFromLog,
  defaultConfigForFormat, COMPOSER_FORMAT_GROUPS,
} from './componentContract'
import { scoreDefinitionFor } from './scoreDefinition'
import { newMovementInstance } from './prescriptionContract'

afterEach(cleanup)

function inst(name) { return newMovementInstance({ name }) }

// The owner's real canonical target workout (ticket's own "Mission"
// section): Part A = For Time, Time Cap 15:00, Shuttle Run/Clean & Jerk
// (irrelevant to this file's scoring focus, so simplified to one movement);
// Part B = Max Effort / For Load, 3:00 window, Clean & Jerk 1RM.
function canonicalTwoPartWorkout() {
  const partA = createComponent({
    id: 'partA', format: 'For Time', producesScore: true,
    config: { structure: 'Sequence', timeCapSec: 900 }, instances: [inst('Clean & Jerk')],
  })
  const partB = createComponent({
    id: 'partB', format: 'Max Effort', producesScore: true,
    config: { timeCapSec: 180 }, instances: [inst('Clean & Jerk')],
  })
  return [partA, partB].map((c, i) => ({ ...c, order: i }))
}

// --- Composer authoring (Parts 1-3, 15) -------------------------------------

describe('ComposerEditor - Max Effort / For Load authoring', () => {
  const t = { composerAddComponentButton: '+ Add Component', composerPickerTitle: 'Add Component' }

  function Harness({ initial = [] }) {
    const [components, setComponents] = useState(initial)
    return (
      <ComposerEditor components={components} onChange={setComponents} movementCatalog={null}
        MovementEditor={MovementRowListPWA} EmomEditor={EmomMinutePatternEditor} t={t} />
    )
  }

  it('is discoverable in the + Add Component picker, alongside every existing format (never replacing one)', () => {
    render(<Harness />)
    fireEvent.click(screen.getByText('+ Add Component'))
    expect(screen.getByText('Max Effort')).toBeInTheDocument()
    expect(screen.getByText('AMRAP')).toBeInTheDocument()
    expect(screen.getByText('Rest')).toBeInTheDocument()
  })

  it('picking it adds a real Component card defaulting to a 3:00 time window, and a real movement editor', () => {
    render(<Harness />)
    fireEvent.click(screen.getByText('+ Add Component'))
    fireEvent.click(screen.getByText('Max Effort'))
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(screen.getByText('MAX EFFORT')).toBeInTheDocument()
    // defaultConfigForFormat('Max Effort') -> { timeCapSec: 180 } -> DurationField shows 3 min / 0 sec.
    const minInputs = screen.getAllByPlaceholderText('0')
    expect(minInputs.some(el => el.value === '3')).toBe(true)
    // A real, structured MovementEditor renders (§24 reuse) - never a bare text field.
    expect(screen.getByText('+ Add movement')).toBeInTheDocument()
  })

  it('never shows the format\'s own legacy free-text movement field for a Composer-authored component (structured instances are the single source of movement identity)', () => {
    render(<Harness />)
    fireEvent.click(screen.getByText('+ Add Component'))
    fireEvent.click(screen.getByText('Max Effort'))
    // FormatConfigEditor renders unmapped labelKeys as their literal key string
    // when `t` has no translation - 'fmtMovementTest' is Max Effort's config.movement
    // field; its absence proves excludeConfigKeys hid it.
    expect(screen.queryByText('fmtMovementTest')).not.toBeInTheDocument()
    // The Time Cap field is NOT excluded - it's the component's real scoring window.
    expect(screen.queryByText('fmtTimeCapOptional')).toBeInTheDocument()
  })

  it('defaultConfigForFormat("Max Effort") returns a 180s window, generic (not hardcoded to any one movement/rep-max)', () => {
    expect(defaultConfigForFormat('Max Effort')).toEqual({ timeCapSec: 180 })
  })

  it('COMPOSER_FORMAT_GROUPS includes Max Effort exactly once, additive to every existing group', () => {
    const allFormats = COMPOSER_FORMAT_GROUPS.flatMap(g => g.options.map(o => o.format))
    expect(allFormats.filter(f => f === 'Max Effort')).toHaveLength(1)
    expect(allFormats).toContain('AMRAP')
    expect(allFormats).toContain('For Time')
    expect(allFormats).toContain('Rest')
  })
})

// --- scoreDefinitionFor wiring (Part 4) -------------------------------------

describe('scoreDefinitionFor - Max Effort resolves to native LOAD, respecting kg/lb', () => {
  it('kg member -> kind LOAD, unit kg', () => {
    const def = scoreDefinitionFor('Max Effort', { timeCapSec: 180 }, { singleValueUnit: 'load', unit: 'kg' })
    expect(def.kind).toBe('LOAD')
    expect(def.unit).toBe('kg')
  })

  it('lb member -> kind LOAD, unit lb (never hardcoded to kg)', () => {
    const def = scoreDefinitionFor('Max Effort', { timeCapSec: 180 }, { singleValueUnit: 'load', unit: 'lb' })
    expect(def.kind).toBe('LOAD')
    expect(def.unit).toBe('lb')
  })

  it('without singleValueUnit (every pre-existing caller), Max Effort never silently becomes LOAD - backward compatible', () => {
    const def = scoreDefinitionFor('Max Effort', { timeCapSec: 180 }, {})
    expect(def.kind).not.toBe('LOAD')
  })
})

// --- MultiScorerLogger renders the REAL LOAD input (Part 4/6) ---------------

describe('MultiScorerLogger - Max Effort scorer renders the real generic LOAD input', () => {
  function Harness({ components, weightUnit = 'kg' }) {
    const envelopes = getOrderedScoreEnvelopes(components)
    const [values, setValues] = useState(Object.fromEntries(envelopes.map(e => [e.scorer.id, emptyScorerLoggerValue()])))
    const [step, setStep] = useState(0)
    return (
      <MultiScorerLogger envelopes={envelopes} valuesByComponentId={values} step={step} onStepChange={setStep}
        onChangeComponent={(id, next) => setValues(v => ({ ...v, [id]: next }))}
        weightUnit={weightUnit} t={{}} gender={null} />
    )
  }

  it('a lone Max Effort component (one-score parity) renders a numeric Result field suffixed kg, no stepper chrome', () => {
    const partB = [createComponent({ id: 'partB', format: 'Max Effort', producesScore: true, config: { timeCapSec: 180 }, instances: [inst('Clean & Jerk')] })]
    render(<Harness components={partB} weightUnit="kg" />)
    expect(screen.queryByText(/SCORE 1 OF/i)).not.toBeInTheDocument()
    const resultInput = screen.getByLabelText('Result')
    fireEvent.change(resultInput, { target: { value: '95' } })
    fireEvent.blur(resultInput)
    expect(resultInput.value).toBe('95')
    expect(screen.getByText('kg')).toBeInTheDocument()
  })

  it('respects an lb member\'s weightUnit, never hardcoded kg', () => {
    const partB = [createComponent({ id: 'partB', format: 'Max Effort', producesScore: true, config: { timeCapSec: 180 }, instances: [inst('Back Squat')] })]
    render(<Harness components={partB} weightUnit="lbs" />)
    expect(screen.getByText('lb')).toBeInTheDocument()
  })
})

// --- Compose/hydrate round-trip, single component (Part 4/5) ---------------

describe('composeEnvelopeNativeResult / hydrateScorerLoggerValueFromNativeResult - Max Effort load_result', () => {
  it('composes a numeric load_result from input.result, scalars all null, format-tagged', () => {
    const partB = createComponent({ id: 'partB', format: 'Max Effort', producesScore: true, config: { timeCapSec: 180 }, instances: [inst('Clean & Jerk')] })
    const components = [partB]
    const out = composeEnvelopeNativeResult(components, partB, { partB: { result: '95' } })
    expect(out).toEqual({ format: 'Max Effort', envelopeComponentIds: ['partB'], result: null, time_result: null, completion_state: null, sets: null, load_result: 95 })
  })

  it('an empty/unset result composes load_result:null, never 0 or a fabricated placement', () => {
    const partB = createComponent({ id: 'partB', format: 'Max Effort', producesScore: true, config: {}, instances: [inst('Snatch')] })
    const out = composeEnvelopeNativeResult([partB], partB, { partB: { result: '' } })
    expect(out.load_result).toBe(null)
  })

  it('hydrates a saved load_result back into the draft\'s result field, byte-identical string, before any time/rounds parser runs', () => {
    const partB = createComponent({ id: 'partB', format: 'Max Effort', producesScore: true, config: {}, instances: [] })
    const draft = hydrateScorerLoggerValueFromNativeResult(partB, { format: 'Max Effort', load_result: 95, result: null, time_result: null, sets: null }, [])
    expect(draft.result).toBe('95')
    expect(draft.time).toBe('')
    expect(draft.roundsCompleted).toBe('')
  })

  it('round-trips a decimal load with no precision loss (102.5 kg)', () => {
    const partB = createComponent({ id: 'partB', format: 'Max Effort', producesScore: true, config: {}, instances: [] })
    const out = composeEnvelopeNativeResult([partB], partB, { partB: { result: '102.5' } })
    expect(out.load_result).toBe(102.5)
    const draft = hydrateScorerLoggerValueFromNativeResult(partB, out, [])
    expect(draft.result).toBe('102.5')
  })

  it('getComponentResultsFromLog passes load_result through for a componentResults-map entry', () => {
    const log = { log_meta: { componentResults: { partB: { format: 'Max Effort', load_result: 95, result: null, time_result: null, completion_state: null, sets: null } } } }
    const entries = getComponentResultsFromLog(log)
    expect(entries).toEqual([{ componentId: 'partB', format: 'Max Effort', load_result: 95, result: null, time_result: null, completion_state: null, sets: null }])
  })
})

// --- Canonical target workout: For Time+TimeCap THEN Max Effort/Load -------
// (ticket §Mission, §Part2, §Part5-7, §16 - the owner's real workout)

describe('canonical target workout - Part A (For Time, Time Cap 15:00) + Part B (Max Effort/Load, 3:00 window)', () => {
  it('Time Cap 15:00 persists on the For Time component exactly as authored (Part 2)', () => {
    const components = canonicalTwoPartWorkout()
    expect(components[0].config.timeCapSec).toBe(900)
    expect(componentHeaderLabel(components[0])).toBe('FOR TIME')
  })

  it('two independent native scores (TIME + LOAD) compose, save, reload, and hydrate losslessly - never combined arithmetically', () => {
    const components = canonicalTwoPartWorkout()
    const envelopes = getOrderedScoreEnvelopes(components)
    expect(envelopes).toHaveLength(2)

    // Athlete finishes Part A in 11:42 (inside the 15:00 cap), then hits a 95kg Part B.
    const initial = {
      partA: { ...emptyScorerLoggerValue(), time: '11:42' },
      partB: { ...emptyScorerLoggerValue(), result: '95' },
    }
    const saved = composeComponentsLogFields(components, buildComposeInputsById(envelopes, initial))
    expect(saved.log_meta).not.toBe(null)
    expect(saved.result).toBe(null) // scalars never carry a multi-scorer value
    expect(saved.time_result).toBe(null)

    const results = getComponentResultsFromLog(saved)
    const a = results.find(r => r.componentId === 'partA')
    const b = results.find(r => r.componentId === 'partB')
    expect(a.time_result).toBe('11:42')
    expect(a.completion_state).toBe('completed')
    expect(b.load_result).toBe(95)
    expect(b.time_result).toBe(null) // 3:00 is a WINDOW, never mistaken for the score

    // Reload -> Journal edit -> hydrate both, unchanged.
    const reloaded = JSON.parse(JSON.stringify(saved))
    const hydrated = hydrateAllScorerValuesFromLog(envelopes, reloaded)
    expect(hydrated.partA.time).toBe('11:42')
    expect(hydrated.partB.result).toBe('95')

    // Re-save without editing anything -> byte-identical result (no mutation on unchanged resave).
    const resaved = composeComponentsLogFields(components, buildComposeInputsById(envelopes, hydrated))
    expect(getComponentResultsFromLog(resaved)).toEqual(getComponentResultsFromLog(saved))
  })

  it('a DNF (capped) Part A never erases a valid Part B load, and vice versa (Part 10)', () => {
    const components = canonicalTwoPartWorkout()
    const envelopes = getOrderedScoreEnvelopes(components)
    // Capped at the 15:00 time cap with a partial (sequential For Time -> partialReps).
    const initial = {
      partA: { ...emptyScorerLoggerValue(), partialReps: ['30'] },
      partB: { ...emptyScorerLoggerValue(), result: '90' },
    }
    const saved = composeComponentsLogFields(components, buildComposeInputsById(envelopes, initial))
    const results = getComponentResultsFromLog(saved)
    const a = results.find(r => r.componentId === 'partA')
    const b = results.find(r => r.componentId === 'partB')
    expect(a.completion_state).toBe('capped')
    expect(b.load_result).toBe(90) // Part B's valid load survives Part A's DNF/capped state untouched
  })

  it('Part B alone (no Part A logged yet) keeps its own load result independently addressable', () => {
    const components = canonicalTwoPartWorkout()
    const envelopes = getOrderedScoreEnvelopes(components)
    const initial = { partB: { ...emptyScorerLoggerValue(), result: '95' } }
    const saved = composeComponentsLogFields(components, buildComposeInputsById(envelopes, initial))
    const results = getComponentResultsFromLog(saved)
    const a = results.find(r => r.componentId === 'partA')
    const b = results.find(r => r.componentId === 'partB')
    expect(b.load_result).toBe(95)
    expect(a.time_result).toBe(null)
    expect(a.result).toBe(null)
  })
})

// --- Single-scorer / legacy regression firewall (Part 15-16) ---------------

describe('single-scorer regression firewall - existing formats still use the legacy scalar path when they are the ONLY scorer', () => {
  it('an EXISTING format (AMRAP) alone still composes legacy scalar fields, log_meta stays null - byte-identical to before', () => {
    const solo = createComponent({ id: 'solo', format: 'AMRAP', producesScore: true, config: { durationSec: 600 }, instances: [inst('Burpees')] })
    const components = [solo]
    const envelopes = getOrderedScoreEnvelopes(components)
    const saved = composeComponentsLogFields(components, buildComposeInputsById(envelopes, { solo: { ...emptyScorerLoggerValue(), roundsCompleted: '6', additionalReps: '4' } }))
    expect(saved.log_meta).toBe(null)
    expect(saved.result).toContain('6')
  })

  it('a SOLE Max Effort/Load scorer (no pre-existing working legacy callers - Part 5 has no scalar slot for load) routes through the same additive componentResults shape instead of silently dropping the value, and round-trips losslessly', () => {
    const solo = createComponent({ id: 'solo', format: 'Max Effort', producesScore: true, config: { timeCapSec: 180 }, instances: [inst('Deadlift')] })
    const components = [solo]
    const envelopes = getOrderedScoreEnvelopes(components)
    const saved = composeComponentsLogFields(components, buildComposeInputsById(envelopes, { solo: { ...emptyScorerLoggerValue(), result: '180' } }))
    expect(saved.result).toBe(null); expect(saved.time_result).toBe(null) // never a scalar - no slot exists for load
    const results = getComponentResultsFromLog(saved)
    expect(results).toEqual([{ componentId: 'solo', format: 'Max Effort', load_result: 180, result: null, time_result: null, completion_state: null, sets: null }])
    const reloaded = JSON.parse(JSON.stringify(saved))
    const hydrated = hydrateAllScorerValuesFromLog(envelopes, reloaded)
    expect(hydrated.solo.result).toBe('180')
  })

  it('an unlogged/empty solo Max Effort component stays on the plain legacy scalar path (no load yet -> no log_meta)', () => {
    const solo = createComponent({ id: 'solo', format: 'Max Effort', producesScore: true, config: {}, instances: [] })
    const components = [solo]
    const envelopes = getOrderedScoreEnvelopes(components)
    const saved = composeComponentsLogFields(components, buildComposeInputsById(envelopes, { solo: emptyScorerLoggerValue() }))
    expect(saved.log_meta).toBe(null)
  })

  it('an old componentResults entry with no load_result key still reads back as load_result:null (purely additive)', () => {
    const oldEntry = { componentId: 'x', format: 'AMRAP', result: '6 rounds + 4', time_result: null, completion_state: 'capped', sets: null }
    const log = { log_meta: { componentResults: { x: oldEntry } } }
    const entries = getComponentResultsFromLog(log)
    expect(entries[0].load_result).toBe(null)
  })
})
