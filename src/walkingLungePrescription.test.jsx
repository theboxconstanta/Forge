// WALKING LUNGE - REPS OR METERS (+ OPTIONAL LOAD).
//
// Data change: migration 20260925090000_walking_lunge_variants_distance_
// capability.sql adds 'distance' to Dumbbell Walking Lunge (reps+load,
// default load) and Overhead Walking Lunge (reps, default reps); the plain
// Walking Lunge row already had it (20260921110000). Defaults unchanged.
//
// Code change: exactly one guard in MovementRowPWA - Load's "remove" link on
// a load-DEFAULT movement is now offered whenever ANY quantity metric is
// present (was: only reps). Without it, "100 m Dumbbell Walking Lunge @ 15/10
// kg" could never drop its load, i.e. METERS-without-LOAD was unreachable
// once load had been added in METERS mode.
//
// Everything else (Reps|Distance toggle, load preserved across the switch,
// inactive quantity dropped, rendering, legacy/V2/snapshot serialization,
// scaling, AI-provenance diff) is existing metric-driven behavior, exercised
// here against the post-migration capability shape.

import { describe, it, expect, afterEach } from 'vitest'
import { useState } from 'react'
import { render, screen, cleanup, fireEvent } from '@testing-library/react'
import { MovementRowListPWA } from './App.jsx'
import { createSection, legacyPayloadFromSections, sectionsFromLegacyWod, validatePrescriptionCompleteness } from './wodSections.js'
import {
  resolveMovementCapability, resolveMovementInstance, validatePrescriptionsForPublish, buildMovementIndex,
  buildLegacyArtifactsForVariant, buildPrescriptionSnapshot, movementObjectsForV2, parsePastedMovementLine,
} from './prescriptionContract.js'
import { generateVariantInstancesFromRx } from './scalingEngine.js'
import { diffAiVsSaved } from './aiProvenanceDiff.js'

afterEach(cleanup)

// Post-migration catalog rows (real UUIDs and names from the live catalog).
const DBWL = 'c0b998ec-dca3-4f30-a5b4-d4cbdd4328d9'
const OHWL = 'aee1320c-13a5-4bae-b520-30de914c00ae'
const WL = 'c9248ce3-65d6-4262-95c3-70aaa69d77fe'
const CATALOG = [
  { id: DBWL, name: 'Dumbbell Walking Lunge', allowed_prescription_metrics: ['reps', 'load', 'distance'], default_prescription_metric: 'load' },
  { id: OHWL, name: 'Overhead Walking Lunge', allowed_prescription_metrics: ['reps', 'distance'], default_prescription_metric: 'reps' },
  { id: WL, name: 'Walking Lunge', allowed_prescription_metrics: ['distance', 'reps'], default_prescription_metric: 'reps' },
  { id: 'cm-snatch', name: 'Snatch', allowed_prescription_metrics: ['reps', 'load'], default_prescription_metric: 'load' },
  { id: 'cm-row', name: 'Row', allowed_prescription_metrics: ['calories', 'distance'], default_prescription_metric: 'calories' },
]
const movementIndex = buildMovementIndex(CATALOG)
const rowByName = (name) => CATALOG.find((r) => r.name.toLowerCase() === (name || '').toLowerCase()) || null
const catalog = {
  capabilityFor: (name) => resolveMovementCapability(rowByName(name)),
  capabilityForInstance: (inst) => resolveMovementCapability(movementIndex.byId.get(inst?.canonicalMovementId) || rowByName(inst?.name)),
  lookupForParse: rowByName,
  suggestions: () => [],
  index: movementIndex,
}

// Controlled harness around the REAL Composer row list; `state.current` is
// always the latest saved instance list.
function renderComposer(initial) {
  const state = { current: initial }
  function Harness() {
    const [instances, setInstances] = useState(initial)
    state.current = instances
    return <MovementRowListPWA instances={instances} onChange={(next) => { state.current = next; setInstances(next) }} catalog={catalog} />
  }
  render(<Harness />)
  return state
}
const blank = { instanceId: 'mi_wl', name: '' }
const inst = (state) => state.current[0]
const quantities = (i) => ['reps', 'distance', 'calories', 'seconds'].filter((k) => i[k])
const line = (i, gender = null) => resolveMovementInstance(i, gender).line
const setNum = (label, v) => fireEvent.change(screen.getByLabelText(label), { target: { value: String(v) } })

function selectDbWalkingLunge() {
  const state = renderComposer([blank])
  fireEvent.change(screen.getByLabelText('Movement name'), { target: { value: 'Dumbbell Walking Lunge' } })
  return state
}
function buildRepsWithLoad() {
  const state = selectDbWalkingLunge()
  setNum('Reps', 20)
  fireEvent.click(screen.getByText('+ Load'))
  setNum('Load men', 15)
  setNum('Load women', 10)
  return state
}

describe('Capability - post-migration Walking Lunge rows', () => {
  it('Dumbbell Walking Lunge offers reps|distance + load, default stays load', () => {
    expect(resolveMovementCapability(CATALOG[0])).toEqual({ allowed: ['reps', 'load', 'distance'], default: 'load', unknown: false })
  })
  it('Overhead Walking Lunge offers reps|distance, no load, default stays reps', () => {
    expect(resolveMovementCapability(CATALOG[1])).toEqual({ allowed: ['reps', 'distance'], default: 'reps', unknown: false })
  })
})

describe('Composer - REPS / METERS alternatives with independent optional LOAD', () => {
  it('selecting the movement defaults to REPS with no load, and a Reps|Distance toggle is offered', () => {
    const state = selectDbWalkingLunge()
    expect(inst(state).canonicalMovementId).toBe(DBWL)
    expect(quantities(inst(state))).toEqual(['reps'])
    expect(inst(state).load).toBeUndefined()
    expect(screen.getByRole('button', { name: 'Reps' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Distance' })).toBeInTheDocument()
    expect(screen.getByText('+ Load')).toBeInTheDocument()
  })

  it('1 - REPS without LOAD: "20 Dumbbell Walking Lunge", publish-valid', () => {
    const state = selectDbWalkingLunge()
    setNum('Reps', 20)
    expect(line(inst(state))).toBe('20 Dumbbell Walking Lunge')
    expect(validatePrescriptionsForPublish({ version: 1, variants: { rx: { movements: state.current } } }).valid).toBe(true)
  })

  it('2 - REPS with LOAD: "20 Dumbbell Walking Lunge @ 15/10 kg"', () => {
    const state = buildRepsWithLoad()
    expect(line(inst(state))).toBe('20 Dumbbell Walking Lunge @ 15/10 kg')
    expect(line(inst(state), 'female')).toBe('20 Dumbbell Walking Lunge @ 10 kg')
  })

  it('5 + 7 - switching REPS -> METERS drops reps, keeps the load, and renders "100 m Dumbbell Walking Lunge @ 15/10 kg"', () => {
    const state = buildRepsWithLoad()
    fireEvent.click(screen.getByRole('button', { name: 'Distance' }))
    expect(inst(state).reps).toBeUndefined()
    expect(inst(state).distance).toEqual({ mode: 'universal', value: null, unit: 'm' })
    expect(inst(state).load).toEqual({ mode: 'sex_specific', male: 15, female: 10, unit: 'kg' })
    setNum('Distance', 100)
    expect(line(inst(state))).toBe('100 m Dumbbell Walking Lunge @ 15/10 kg')
  })

  it('4 - METERS without LOAD: load stays removable in Meters mode (no reps present)', () => {
    const state = buildRepsWithLoad()
    fireEvent.click(screen.getByRole('button', { name: 'Distance' }))
    setNum('Distance', 100)
    fireEvent.click(screen.getByText('remove'))
    expect('load' in inst(state)).toBe(false)
    expect(line(inst(state))).toBe('100 m Dumbbell Walking Lunge')
    expect(validatePrescriptionsForPublish({ version: 1, variants: { rx: { movements: state.current } } }).valid).toBe(true)
  })

  it('3 - METERS without LOAD straight from selection (never added load)', () => {
    const state = selectDbWalkingLunge()
    fireEvent.click(screen.getByRole('button', { name: 'Distance' }))
    setNum('Distance', 100)
    expect(inst(state).load).toBeUndefined()
    expect(line(inst(state))).toBe('100 m Dumbbell Walking Lunge')
  })

  it('6 + 7 - switching METERS -> REPS drops distance and keeps the load', () => {
    const state = buildRepsWithLoad()
    fireEvent.click(screen.getByRole('button', { name: 'Distance' }))
    setNum('Distance', 100)
    fireEvent.click(screen.getByRole('button', { name: 'Reps' }))
    expect(inst(state).distance).toBeUndefined()
    expect(inst(state).reps).toEqual({ mode: 'universal', value: null })
    expect(inst(state).load).toEqual({ mode: 'sex_specific', male: 15, female: 10, unit: 'kg' })
    setNum('Reps', 20)
    expect(line(inst(state))).toBe('20 Dumbbell Walking Lunge @ 15/10 kg')
  })

  it('8 - REPS and METERS are never active together, across repeated switching', () => {
    const state = buildRepsWithLoad()
    for (const target of ['Distance', 'Reps', 'Distance', 'Reps', 'Distance']) {
      fireEvent.click(screen.getByRole('button', { name: target }))
      expect(quantities(inst(state))).toEqual([target === 'Reps' ? 'reps' : 'distance'])
      expect(inst(state).load).toBeDefined()
    }
  })

  it('Overhead Walking Lunge gets the same Reps|Distance toggle but no Load control (no load capability)', () => {
    const state = renderComposer([blank])
    fireEvent.change(screen.getByLabelText('Movement name'), { target: { value: 'Overhead Walking Lunge' } })
    fireEvent.click(screen.getByRole('button', { name: 'Distance' }))
    setNum('Distance', 50)
    expect(line(inst(state))).toBe('50 m Overhead Walking Lunge')
    expect(screen.queryByText('+ Load')).not.toBeInTheDocument()
  })
})

describe('9 - save / edit round trip (real wodSections serialization + hydration)', () => {
  const roundTrip = (instances) => {
    const s = createSection('metcon', true)
    s.format = 'AMRAP'
    s.formatConfig = { durationSec: 600 }
    s.variants.rx.instances = instances
    expect(validatePrescriptionCompleteness([s])).toEqual([])
    const payload = JSON.parse(JSON.stringify(legacyPayloadFromSections([s])))
    const saved = payload.movement_prescriptions.variants.rx.movements[0]
    const reopened = sectionsFromLegacyWod({ id: 'w1', date: '2026-01-01', ...payload }).find((x) => x.isPrimary)
    return { payload, saved, reopenedInst: reopened.variants.rx.instances[0] }
  }

  it('METERS + LOAD persists only distance + load, and reopens identically', () => {
    const mv = { instanceId: 'mi_1', name: 'Dumbbell Walking Lunge', canonicalMovementId: DBWL, distance: { mode: 'universal', value: 100, unit: 'm' }, load: { mode: 'sex_specific', male: 15, female: 10, unit: 'kg' } }
    const { saved, reopenedInst } = roundTrip([mv])
    expect(saved.reps).toBeUndefined()
    expect(saved.distance).toEqual(mv.distance)
    expect(saved.load).toEqual(mv.load)
    expect(reopenedInst.distance).toEqual(mv.distance)
    expect(reopenedInst.load).toEqual(mv.load)
    expect(reopenedInst.reps).toBeUndefined()
    expect(line(reopenedInst)).toBe('100 m Dumbbell Walking Lunge @ 15/10 kg')
  })

  it('REPS + LOAD persists only reps + load, and reopens identically', () => {
    const mv = { instanceId: 'mi_2', name: 'Dumbbell Walking Lunge', canonicalMovementId: DBWL, reps: { mode: 'universal', value: 20 }, load: { mode: 'sex_specific', male: 15, female: 10, unit: 'kg' } }
    const { saved, reopenedInst } = roundTrip([mv])
    expect(saved.distance).toBeUndefined()
    expect(reopenedInst.reps).toEqual(mv.reps)
    expect(line(reopenedInst)).toBe('20 Dumbbell Walking Lunge @ 15/10 kg')
  })

  it('a reopened METERS instance shows the Distance editor with its value and the load (edit hydration)', () => {
    const mv = { instanceId: 'mi_3', name: 'Dumbbell Walking Lunge', canonicalMovementId: DBWL, distance: { mode: 'universal', value: 100, unit: 'm' }, load: { mode: 'sex_specific', male: 15, female: 10, unit: 'kg' } }
    const { reopenedInst } = roundTrip([mv])
    renderComposer([reopenedInst])
    expect(screen.getByLabelText('Distance')).toHaveValue('100')
    expect(screen.getByLabelText('Load men')).toHaveValue('15')
    expect(screen.queryByLabelText('Reps')).not.toBeInTheDocument()
  })
})

describe('Downstream serialization - legacy artifacts, frozen snapshot, V2, scaling, AI provenance', () => {
  const meters = { instanceId: 'mi_m', name: 'Dumbbell Walking Lunge', canonicalMovementId: DBWL, distance: { mode: 'universal', value: 100, unit: 'm' }, load: { mode: 'sex_specific', male: 15, female: 10, unit: 'kg' } }
  const reps = { instanceId: 'mi_m', name: 'Dumbbell Walking Lunge', canonicalMovementId: DBWL, reps: { mode: 'universal', value: 20 }, load: { mode: 'sex_specific', male: 15, female: 10, unit: 'kg' } }

  it('legacy lines carry the distance lead token', () => {
    expect(buildLegacyArtifactsForVariant([meters], { inlineLoad: true }).lines).toEqual(['100 m Dumbbell Walking Lunge @ 15/10 kg'])
  })

  it('frozen prescription snapshot stores distance + load, no reps', () => {
    const snap = buildPrescriptionSnapshot({ doc: { version: 1, variants: { rx: { movements: [meters] } } }, variantKey: 'rx', gender: 'male', resolvedAt: 't', source: 'test' })
    const m = snap.movements[0]
    expect(m.distance).toMatchObject({ value: 100, unit: 'm' })
    expect(m.load).toMatchObject({ value: 15, unit: 'kg' })
    expect(m.reps).toBeUndefined()
  })

  it('V2 movement object mirrors distance + weight and nulls reps', () => {
    const [v2] = movementObjectsForV2([meters])
    expect(v2.distance).toBe('100m')
    expect(v2.weight).toBe('15/10kg')
    expect(v2.prescription.reps).toBeNull()
    expect(v2.prescription.distance).toEqual(meters.distance)
  })

  it('Generate Variants keeps the METERS mode (never converts to reps) for every tier', () => {
    const out = generateVariantInstancesFromRx([meters], {}, (n) => rowByName(n))
    for (const tier of ['intermediate', 'beginner', 'onramp']) {
      expect(out[tier][0].name).toMatch(/Dumbbell Walking Lunge/)
      expect(out[tier][0].distance).toBeTruthy()
      expect(out[tier][0].reps).toBeUndefined()
    }
  })

  it('AI provenance: a coach switching REPS -> METERS is recorded as semantic reps + distance changes', () => {
    const sec = (instances) => ({
      typeKey: 'metcon', isPrimary: true, scored: true, title: '', format: 'AMRAP', formatConfig: { durationSec: 600 },
      variants: { rx: { instances, movements: [], weight: { male: '', female: '' }, note: '' } },
    })
    const r = diffAiVsSaved([sec([reps])], [sec([meters])])
    const kinds = r.deltas.map((d) => d.kind)
    expect(kinds).toContain('reps_changed')
    expect(kinds).toContain('distance_changed')
    expect(r.severity).toBe('semantic')
  })

  it('paste parsing resolves both prescription forms to the same catalog movement with one quantity each', () => {
    const lookupCanonical = (n) => {
      const row = rowByName(n) || rowByName(String(n).replace(/s$/i, ''))
      return row ? { id: row.id, capability: resolveMovementCapability(row) } : null
    }
    const a = parsePastedMovementLine('20 Dumbbell Walking Lunges @ 15/10 kg', { lookupCanonical }).instance
    const b = parsePastedMovementLine('100 m Dumbbell Walking Lunge @ 15/10 kg', { lookupCanonical }).instance
    expect(a.canonicalMovementId).toBe(DBWL)
    expect(b.canonicalMovementId).toBe(DBWL)
    expect(quantities(a)).toEqual(['reps'])
    expect(quantities(b)).toEqual(['distance'])
    expect(a.load).toEqual(b.load)
  })
})

describe('10 - existing movement prescriptions are unchanged', () => {
  it('Snatch (load-default, reps+load) still seeds reps, still renders "5 Snatch @ 60/40 kg", load still removable with reps', () => {
    const state = renderComposer([blank])
    fireEvent.change(screen.getByLabelText('Movement name'), { target: { value: 'Snatch' } })
    expect(quantities(inst(state))).toEqual(['reps'])
    expect(screen.queryByRole('button', { name: 'Distance' })).not.toBeInTheDocument()
    setNum('Reps', 5)
    fireEvent.click(screen.getByText('+ Load'))
    setNum('Load men', 60)
    setNum('Load women', 40)
    expect(line(inst(state))).toBe('5 Snatch @ 60/40 kg')
    expect(screen.getByText('remove')).toBeInTheDocument()
  })

  it('a load-ONLY movement still cannot drop its only metric (guard unchanged)', () => {
    const loadOnly = { instanceId: 'mi_lo', name: 'Load Only Move', canonicalMovementId: null, load: { mode: 'sex_specific', male: null, female: null, unit: 'kg' } }
    const cap = () => resolveMovementCapability({ allowed_prescription_metrics: ['load'], default_prescription_metric: 'load' })
    render(<MovementRowListPWA instances={[loadOnly]} onChange={() => {}} catalog={{ capabilityFor: cap, capabilityForInstance: cap, lookupForParse: () => null, suggestions: () => [] }} />)
    expect(screen.queryByText('remove')).not.toBeInTheDocument()
  })

  it('Row keeps its Distance|Calories toggle and "500 m Row" / "15 Cal Row" rendering', () => {
    expect(line({ instanceId: 'r', name: 'Row', distance: { mode: 'universal', value: 500, unit: 'm' } })).toBe('500 m Row')
    expect(line({ instanceId: 'r', name: 'Row', calories: { mode: 'universal', value: 15 } })).toBe('15 Cal Row')
  })

  it('plain Walking Lunge (already reps|distance since 20260921110000) is unchanged', () => {
    expect(line({ instanceId: 'w', name: 'Walking Lunge', reps: { mode: 'universal', value: 20 } })).toBe('20 Walking Lunge')
    expect(line({ instanceId: 'w', name: 'Walking Lunge', distance: { mode: 'universal', value: 100, unit: 'm' } })).toBe('100 m Walking Lunge')
  })
})
