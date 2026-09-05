// INC-18 - PERFORMED MOVEMENT CAPABILITY COMPLETION (partial-overlap gap).
//
// Root cause (confirmed by evidence, not guessed): applyPerformedSubstitution
// (INC-15/16) only initialized missing target-capability metrics when the
// reps+load/distance/calories intersection was ENTIRELY empty
// (`survivedAnyMetric === false`). A PARTIAL overlap - e.g. reps-only ->
// reps+load - preserved the surviving `reps` and, because SOMETHING
// survived, never reached the initialization branch at all, so the NEWLY
// required `load` control was never seeded. Owner reproduction: "20 Air
// Squats" (reps only) -> Change Movement -> "Clean & Jerk" (reps+load) kept
// REPS 20 but rendered no LOAD field whatsoever.
//
// Fix: reconciliation now applies PER METRIC GROUP, independently, not
// gated on the overall intersection being empty:
//   - reps, load: each is preserved-if-compatible-else-seeded-blank
//     whenever the target capability counts it, regardless of what
//     happened to the other metrics.
//   - distance/calories: still the ONE mutually-exclusive pair - the
//     survivor (if any) is kept; the capability's own default is
//     initialized (blank) ONLY when neither survives.
// No new scoring/initialization model - the distance/calories branch still
// calls the exact same initializePerformedMetrics Add-movement uses.
//
// Universal scope: applyPerformedSubstitution has exactly ONE caller in the
// entire codebase - PerformedEditRow.pickSubstitute (App.jsx) - which is
// itself instantiated from exactly ONE place (PerformedEditPanel's render
// loop), shared by every workout format's performed-composition editor (WOD
// Log, Journal re-open, any section). There is no per-format branch to
// audit separately - fixing this one function fixes every surface by
// construction. This file also proves the helper itself is format/name-
// agnostic via synthetic capability fixtures never seen elsewhere in source.

import { describe, it, expect } from 'vitest'
import {
  applyPerformedSubstitution, addPerformedMovement, initializePerformedMetrics,
  resolveMovementCapability, switchPerformedQuantityMetric,
} from './prescriptionContract.js'

const capRepsLoad = resolveMovementCapability({ allowed_prescription_metrics: ['reps', 'load'], default_prescription_metric: 'load' })
const capReps = resolveMovementCapability({ allowed_prescription_metrics: ['reps'], default_prescription_metric: 'reps' })
const capCalDist = resolveMovementCapability({ allowed_prescription_metrics: ['distance', 'calories'], default_prescription_metric: 'calories' })

describe('INC-18 §6 - required case matrix', () => {
  it('A. reps-only -> reps+load (OWNER REPRODUCTION: 20 Air Squats -> Clean & Jerk): reps preserved, load newly initialized blank', () => {
    const instance = { instanceId: 'mi_1', name: 'Air Squats', reps: { mode: 'universal', value: 20 } }
    const next = applyPerformedSubstitution(instance, { id: 'cm-cj', name: 'Clean & Jerk' }, capRepsLoad)
    expect(next.reps).toEqual({ mode: 'universal', value: 20 })
    expect(next.load).toEqual({ mode: 'universal', value: null, unit: 'kg' })
  })

  it('B. reps+load -> reps-only (20 Clean & Jerk @ 43 -> Push-Ups): reps preserved, load removed entirely', () => {
    const instance = { instanceId: 'mi_2', name: 'Clean & Jerk', reps: { mode: 'universal', value: 20 }, load: { mode: 'universal', value: 43, unit: 'kg' } }
    const next = applyPerformedSubstitution(instance, { id: 'cm-pushup', name: 'Push-Ups' }, capReps)
    expect(next.reps).toEqual({ mode: 'universal', value: 20 })
    expect(next.load).toBeUndefined()
  })

  it('C. reps+load -> reps+load (another target): reps AND load both preserved verbatim (full overlap, no unnecessary reset)', () => {
    const instance = { instanceId: 'mi_3', reps: { mode: 'universal', value: 20 }, load: { mode: 'universal', value: 43, unit: 'kg' } }
    const next = applyPerformedSubstitution(instance, { id: 'cm-db-thruster', name: 'Dumbbell Thruster' }, capRepsLoad)
    expect(next.reps).toEqual({ mode: 'universal', value: 20 })
    expect(next.load).toEqual({ mode: 'universal', value: 43, unit: 'kg' })
  })

  it('D. reps-only -> reps-only: reps preserved, no extra metric introduced', () => {
    const instance = { instanceId: 'mi_4', reps: { mode: 'universal', value: 20 } }
    const next = applyPerformedSubstitution(instance, { id: 'cm-air-squat-2', name: 'Air Squats v2' }, capReps)
    expect(next.reps).toEqual({ mode: 'universal', value: 20 })
    expect(next.load).toBeUndefined()
    expect(next.distance).toBeUndefined()
    expect(next.calories).toBeUndefined()
  })

  it('E. reps+load -> distance/calories: unchanged existing zero-overlap reconciliation', () => {
    const instance = { instanceId: 'mi_5', name: 'Clean & Jerk', reps: { mode: 'universal', value: 20 }, load: { mode: 'universal', value: 43, unit: 'kg' } }
    const next = applyPerformedSubstitution(instance, { id: 'cm-row', name: 'Row' }, capCalDist)
    expect(next.reps).toBeUndefined()
    expect(next.load).toBeUndefined()
    expect(next.calories).toEqual({ mode: 'universal', value: null }) // capCalDist's own default
    expect(next.distance).toBeUndefined()
  })

  it('F. distance/calories -> reps+load: reps blank, load blank, no stale distance/calories', () => {
    const instance = { instanceId: 'mi_6', name: 'Row', distance: { mode: 'universal', value: 250, unit: 'm' } }
    const next = applyPerformedSubstitution(instance, { id: 'cm-cj', name: 'Clean & Jerk' }, capRepsLoad)
    expect(next.distance).toBeUndefined()
    expect(next.calories).toBeUndefined()
    expect(next.reps).toEqual({ mode: 'universal', value: null })
    expect(next.load).toEqual({ mode: 'universal', value: null, unit: 'kg' })
  })

  it('G. zero-overlap substitution remains GREEN (both metrics blank-initialized, never both quantity metrics at once)', () => {
    const instance = { instanceId: 'mi_7', reps: { mode: 'universal', value: 21 }, load: { mode: 'universal', value: 43, unit: 'kg' } }
    const next = applyPerformedSubstitution(instance, { id: 'cm-row', name: 'Row' }, capCalDist)
    const activeQuantity = ['distance', 'calories'].filter((k) => next[k] != null)
    expect(activeQuantity.length).toBe(1) // never both simultaneously
  })

  it('H. metric switch Calories <-> Distance remains GREEN after a substitution seeded the initial state', () => {
    const instance = { instanceId: 'mi_8', name: 'Clean & Jerk', reps: { mode: 'universal', value: 20 }, load: { mode: 'universal', value: 43, unit: 'kg' } }
    const afterSub = applyPerformedSubstitution(instance, { id: 'cm-row', name: 'Row' }, capCalDist)
    expect(afterSub.calories).toEqual({ mode: 'universal', value: null })
    const afterSwitch = switchPerformedQuantityMetric(afterSub, 'distance')
    expect(afterSwitch.calories).toBeUndefined()
    expect(afterSwitch.distance).toEqual({ mode: 'universal', value: null, unit: 'm' })
  })

  it('I. Add Movement uses the SAME initialization contract (byte-identical seed for the same capability)', () => {
    const target = { id: 'cm-cj', name: 'Clean & Jerk' }
    const doc = { version: 2, variantKey: 'rx', sectionId: null, source: 'performed', movements: [
      { instanceId: 'mi_src', sourceInstanceId: 'mi_src', name: 'Air Squats', reps: { mode: 'universal', value: 20 } },
    ] }
    const added = addPerformedMovement(doc, 'mi_src', target, capRepsLoad).movements[1]
    expect(added.load).toEqual({ mode: 'universal', value: null, unit: 'kg' })
    // Add-movement's own reps stays inheritance-gated (unchanged contract,
    // not this incident's concern) - only load's blank-seed is compared.
  })
})

describe('INC-18 §J / universal scope - synthetic capability fixtures, never name-driven', () => {
  it('J1. a never-before-seen reps-only movement substituted to a never-before-seen reps+load movement completes correctly', () => {
    const sourceCapability = resolveMovementCapability({ allowed_prescription_metrics: ['reps'], default_prescription_metric: 'reps' })
    const targetCapability = resolveMovementCapability({ allowed_prescription_metrics: ['reps', 'load'], default_prescription_metric: 'load' })
    const instance = { instanceId: 'mi_x', name: 'Synthetic Bodyweight Movement Z', reps: { mode: 'universal', value: 12 } }
    const next = applyPerformedSubstitution(instance, { id: 'synthetic-loaded-z', name: 'Synthetic Loaded Movement Z' }, targetCapability)
    expect(next.reps).toEqual({ mode: 'universal', value: 12 })
    expect(next.load).toEqual({ mode: 'universal', value: null, unit: 'kg' })
    void sourceCapability // capability is derived from the TARGET only, by design - source capability never participates
  })

  it('J2. a synthetic movement carrying an unrelated pre-existing metric (calories) loses it and gains reps+load blank', () => {
    const targetCapability = resolveMovementCapability({ allowed_prescription_metrics: ['reps', 'load'], default_prescription_metric: 'reps' })
    const instance = { instanceId: 'mi_y', calories: { mode: 'universal', value: 30 } }
    const next = applyPerformedSubstitution(instance, { id: 'synthetic-w', name: 'Synthetic Movement W' }, targetCapability)
    expect(next.calories).toBeUndefined()
    expect(next.reps).toEqual({ mode: 'universal', value: null })
    expect(next.load).toEqual({ mode: 'universal', value: null, unit: 'kg' })
  })

  it('J3. initializePerformedMetrics itself never seeds both halves of the distance/calories pair, for any synthetic capability', () => {
    const cap = resolveMovementCapability({ allowed_prescription_metrics: ['distance', 'calories'], default_prescription_metric: 'distance' })
    const seeded = initializePerformedMetrics(cap)
    const activeQuantity = ['distance', 'calories'].filter((k) => seeded[k] != null)
    expect(activeQuantity).toEqual(['distance'])
  })

  it('J4. unknown/unseeded capability (allowed: []) still fails open for the partial-overlap path, never seeds a guess', () => {
    const unknown = resolveMovementCapability({ allowed_prescription_metrics: [], default_prescription_metric: null })
    const instance = { instanceId: 'mi_z', reps: { mode: 'universal', value: 9 }, load: { mode: 'universal', value: 15, unit: 'kg' } }
    const next = applyPerformedSubstitution(instance, { id: 'never-seeded', name: 'Never Seeded Movement' }, unknown)
    expect(next.reps).toEqual({ mode: 'universal', value: 9 })
    expect(next.load).toEqual({ mode: 'universal', value: 15, unit: 'kg' })
  })
})
