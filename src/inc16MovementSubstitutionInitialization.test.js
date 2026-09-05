// INC-16 - MOVEMENT SUBSTITUTION: INITIALIZE VALID METRICS ON ZERO OVERLAP.
//
// Owner decision on top of INC-15 (4e37f5d): reconciliation on Change
// Movement has TWO responsibilities, not one.
//
//   A. RECONCILE EXISTING METRICS (INC-15, already shipped)
//      nextMetrics = existingMetrics ∩ newMovement.validMetrics
//      incompatible metrics are cleared, compatible ones may survive verbatim
//
//   B. INITIALIZE NEW VALID EDITOR STATE (this incident)
//      if (A) leaves NO metric at all (reps included), the athlete must not
//      be left with a movement that has no editable control whatsoever -
//      the new movement's own valid controls must be seeded, BLANK (never a
//      claimed value, never converted/derived from the incompatible metric
//      that was just cleared).
//
// Implementation: `initializePerformedMetrics(capability)` is extracted from
// what addPerformedMovement already did inline for load/distance/calories
// (including the distance+calories mutually-exclusive single-default rule) -
// ONE canonical fresh-movement initialization model, now shared by BOTH
// addPerformedMovement (a brand new movement) and applyPerformedSubstitution
// (a Change Movement that shares nothing with what came before). `reps` is
// NOT part of the shared helper (it stays governed by addPerformedMovement's
// own inheritReps mechanism there, unchanged) - applyPerformedSubstitution
// seeds a blank reps itself, only in its own zero-overlap branch, only when
// the new capability actually counts reps.

import { describe, it, expect } from 'vitest'
import {
  applyPerformedSubstitution, addPerformedMovement, initializePerformedMetrics,
  resolveMovementCapability, switchPerformedQuantityMetric,
} from './prescriptionContract.js'

const capRepsLoad = resolveMovementCapability({ allowed_prescription_metrics: ['reps', 'load'], default_prescription_metric: 'load' })
const capReps = resolveMovementCapability({ allowed_prescription_metrics: ['reps'], default_prescription_metric: 'reps' })
const capCalDist = resolveMovementCapability({ allowed_prescription_metrics: ['distance', 'calories'], default_prescription_metric: 'calories' })

describe('INC-16 §8 - required test matrix', () => {
  it('1. reps+load -> calories+distance: no stale reps/load, valid calories/distance editor state exists, value blank', () => {
    const instance = { instanceId: 'mi_1', name: 'Clean & Jerk', reps: { mode: 'universal', value: 21 }, load: { mode: 'universal', value: 43, unit: 'kg' } }
    const next = applyPerformedSubstitution(instance, { id: 'cm-row', name: 'Row' }, capCalDist)
    expect(next.reps).toBeUndefined()
    expect(next.load).toBeUndefined()
    expect(next.calories).toEqual({ mode: 'universal', value: null }) // capCalDist's default
    expect(next.distance).toBeUndefined() // the OTHER half of the exclusive pair stays absent
  })

  it('2. distance -> reps+load: no stale distance, valid reps/load editor state exists, values blank', () => {
    const instance = { instanceId: 'mi_2', name: 'Row', distance: { mode: 'universal', value: 250, unit: 'm' } }
    const next = applyPerformedSubstitution(instance, { id: 'cm-cj', name: 'Clean & Jerk' }, capRepsLoad)
    expect(next.distance).toBeUndefined()
    expect(next.reps).toEqual({ mode: 'universal', value: null })
    expect(next.load).toEqual({ mode: 'universal', value: null, unit: 'kg' })
  })

  it('3. calories -> calories+distance: calories preserved (compatible metric survives verbatim)', () => {
    const instance = { instanceId: 'mi_3', name: 'Air Bike', calories: { mode: 'universal', value: 21 } }
    const next = applyPerformedSubstitution(instance, { id: 'cm-row', name: 'Row' }, capCalDist)
    expect(next.calories).toEqual({ mode: 'universal', value: 21 })
    expect(next.distance).toBeUndefined()
  })

  it('4. distance -> calories+distance: distance preserved (compatible metric survives verbatim)', () => {
    const instance = { instanceId: 'mi_4', name: 'Row', distance: { mode: 'universal', value: 250, unit: 'm' } }
    const next = applyPerformedSubstitution(instance, { id: 'cm-ski', name: 'Ski' }, capCalDist)
    expect(next.distance).toEqual({ mode: 'universal', value: 250, unit: 'm' })
    expect(next.calories).toBeUndefined()
  })

  it('5. reps+load -> reps-only: compatible reps preserved, incompatible load cleared (no unnecessary reset)', () => {
    const instance = { instanceId: 'mi_5', reps: { mode: 'universal', value: 15 }, load: { mode: 'universal', value: 20, unit: 'kg' } }
    const next = applyPerformedSubstitution(instance, { id: 'cm-air-squat', name: 'Air Squat' }, capReps)
    expect(next.reps).toEqual({ mode: 'universal', value: 15 }) // NOT reset to null - a genuine survivor
    expect(next.load).toBeUndefined()
  })

  it('6. no-compatible-metrics does NOT produce a movement with zero input controls', () => {
    const instance = { instanceId: 'mi_6', reps: { mode: 'universal', value: 21 }, load: { mode: 'universal', value: 43, unit: 'kg' } }
    const next = applyPerformedSubstitution(instance, { id: 'cm-row', name: 'Row' }, capCalDist)
    const hasAnyControl = next.reps != null || next.load != null || next.distance != null || next.calories != null
    expect(hasAnyControl).toBe(true)
  })

  it('7. fresh initialized calories+distance state contains only ONE active quantity metric, never both', () => {
    const seeded = initializePerformedMetrics(capCalDist)
    const activeCount = ['distance', 'calories'].filter((k) => seeded[k] != null).length
    expect(activeCount).toBe(1)
    expect(seeded.calories).toEqual({ mode: 'universal', value: null }) // capCalDist's default is 'calories'
    expect(seeded.distance).toBeUndefined()
  })

  it('8. synthetic future movement with capabilities [calories, distance] works automatically, no editor code change', () => {
    const futureMovement = resolveMovementCapability({ allowed_prescription_metrics: ['calories', 'distance'], default_prescription_metric: 'distance' })
    const instance = { instanceId: 'mi_8', reps: { mode: 'universal', value: 10 } }
    const next = applyPerformedSubstitution(instance, { id: 'catalog-row-added-tomorrow', name: 'Machine Nobody Has Written Yet' }, futureMovement)
    expect(next.reps).toBeUndefined()
    expect(next.distance).toEqual({ mode: 'universal', value: null, unit: 'm' }) // this fixture's own default, distance
  })

  it('9. synthetic future movement with capabilities [reps, load] works automatically, no editor code change', () => {
    const futureMovement = resolveMovementCapability({ allowed_prescription_metrics: ['reps', 'load'], default_prescription_metric: 'reps' })
    const instance = { instanceId: 'mi_9', distance: { mode: 'universal', value: 500, unit: 'm' } }
    const next = applyPerformedSubstitution(instance, { id: 'catalog-row-added-next-year', name: 'Another Future Machine' }, futureMovement)
    expect(next.distance).toBeUndefined()
    expect(next.reps).toEqual({ mode: 'universal', value: null })
    expect(next.load).toEqual({ mode: 'universal', value: null, unit: 'kg' })
  })

  it('10. movement change -> quantity switch still clears the old mutually-exclusive metric and starts the new one blank', () => {
    const instance = { instanceId: 'mi_1', name: 'Clean & Jerk', reps: { mode: 'universal', value: 21 }, load: { mode: 'universal', value: 43, unit: 'kg' } }
    const afterChange = applyPerformedSubstitution(instance, { id: 'cm-row', name: 'Row' }, capCalDist)
    expect(afterChange.calories).toEqual({ mode: 'universal', value: null }) // freshly initialized
    const afterSwitch = switchPerformedQuantityMetric(afterChange, 'distance')
    expect(afterSwitch.calories).toBeUndefined()
    expect(afterSwitch.distance).toEqual({ mode: 'universal', value: null, unit: 'm' })
  })
})

describe('INC-16 - distance shape correction check (fixture 8 unit expectation)', () => {
  it('a fresh distance init always carries its canonical unit', () => {
    const futureMovement = resolveMovementCapability({ allowed_prescription_metrics: ['calories', 'distance'], default_prescription_metric: 'distance' })
    const seeded = initializePerformedMetrics(futureMovement)
    expect(seeded.distance).toEqual({ mode: 'universal', value: null, unit: 'm' })
  })
})

describe('INC-16 - Add Movement and Change Movement converge on ONE initialization model', () => {
  it('a brand-new Add-movement entry and a zero-overlap Change-Movement substitution seed byte-identical blank state for the same capability', () => {
    const target = { id: 'cm-row', name: 'Row' }
    const doc = { version: 2, variantKey: 'rx', sectionId: null, source: 'performed', movements: [
      { instanceId: 'mi_src', sourceInstanceId: 'mi_src', name: 'Clean & Jerk', reps: { mode: 'universal', value: 21 } },
    ] }
    const added = addPerformedMovement(doc, 'mi_src', target, capCalDist).movements[1]
    const substituted = applyPerformedSubstitution(
      { instanceId: 'mi_other', name: 'Clean & Jerk', reps: { mode: 'universal', value: 15 }, load: { mode: 'universal', value: 43, unit: 'kg' } },
      target, capCalDist,
    )
    expect(added.calories).toEqual(substituted.calories)
    expect(added.distance).toEqual(substituted.distance)
    expect(added.calories).toEqual({ mode: 'universal', value: null })
  })

  it('Add Movement reps behavior is unchanged by the shared helper - still inheritance-only, never freshly blanked', () => {
    const doc = { version: 2, variantKey: 'rx', sectionId: null, source: 'performed', movements: [
      { instanceId: 'mi_src', sourceInstanceId: 'mi_src', name: 'Air Squat', reps: { mode: 'universal', value: 15 } },
    ] }
    // inheritReps: false -> no reps carried, and none freshly seeded either
    const addedNoInherit = addPerformedMovement(doc, 'mi_src', { id: 'cm-cj', name: 'Clean & Jerk' }, capRepsLoad, { inheritReps: false }).movements[1]
    expect(addedNoInherit.reps).toBeUndefined()
    // inheritReps: true -> the source's own reps value carries over (not a blank re-init)
    const addedInherit = addPerformedMovement(doc, 'mi_src', { id: 'cm-cj', name: 'Clean & Jerk' }, capRepsLoad, { inheritReps: true }).movements[1]
    expect(addedInherit.reps).toEqual({ mode: 'universal', value: 15 })
  })
})
