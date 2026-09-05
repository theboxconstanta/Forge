// INC-15 - UNIVERSAL CAPABILITY-DRIVEN PERFORMED-METRIC RECONCILIATION.
//
// Owner clarification on top of the Performed Metric Switching work
// (4e2cbc5/d3a8825): movement-change reconciliation must be driven ENTIRELY
// by the target movement's canonical capability (catalog
// allowed_prescription_metrics), never by movement name/id, and must
// generalize to EVERY metric (reps, load, distance, calories - not just the
// distance+calories pair) via one invariant:
//
//   nextMetrics = existingMetrics ∩ newMovement.validMetrics
//   (anything outside that intersection is cleared, never invented,
//    never converted)
//
// Forensic finding: `applyPerformedSubstitution` (prescriptionContract.js)
// already implemented exactly this intersection for load/distance/calories
// (via the PERFORMED_EDITABLE_METRICS loop, capability-gated) - but `reps`
// was carried over UNCONDITIONALLY, regardless of whether the target
// movement's capability included 'reps' at all. So "Clean & Jerk (reps 21,
// load 43) -> Row (calories+distance only)" incorrectly kept reps:21 on the
// Row instance - a stale, incompatible metric the athlete never entered for
// Row, exactly the class of bug the owner's invariant forbids. This is a
// pre-existing inconsistency with `addPerformedMovement`, which ALREADY
// gates its own reps-inheritance by capability (`allowed.includes('reps')`).
//
// Fix: one-line capability gate added to the existing reps line, matching
// the pattern already used one line below it for load/distance/calories -
// no new branch, no movement-name check, single shared function serving
// every surface that calls it (WOD Log, Journal edit/re-open, multi-section
// - PerformedEditRow.pickSubstitute is the ONLY caller of
// applyPerformedSubstitution in the entire codebase).

import { describe, it, expect } from 'vitest'
import { applyPerformedSubstitution, resolveMovementCapability } from './prescriptionContract.js'

describe('INC-15 - owner-named real-movement examples', () => {
  const capRepsLoad = resolveMovementCapability({ allowed_prescription_metrics: ['reps', 'load'], default_prescription_metric: 'load' })
  const capCalDist = resolveMovementCapability({ allowed_prescription_metrics: ['distance', 'calories'], default_prescription_metric: 'calories' })

  it('Clean & Jerk (reps 21, load 43) -> Row: reps AND load removed, nothing invented', () => {
    const instance = {
      instanceId: 'mi_1', name: 'Clean & Jerk', canonicalMovementId: 'cm-cj',
      reps: { mode: 'universal', value: 21 },
      load: { mode: 'universal', value: 43, unit: 'kg' },
    }
    const next = applyPerformedSubstitution(instance, { id: 'cm-row', name: 'Row' }, capCalDist)
    expect(next.reps).toBeUndefined()
    expect(next.load).toBeUndefined()
    // INC-15 follow-up: zero overlap -> initialize the new movement's own
    // valid (blank) state instead of leaving no editable control at all.
    // See inc16MovementSubstitutionInitialization.test.js for full coverage.
    expect(next.calories).toEqual({ mode: 'universal', value: null })
    expect(next.distance).toBeUndefined()
    expect(next.name).toBe('Row')
    expect(next.substitutedFrom).toEqual({ canonicalMovementId: 'cm-cj', name: 'Clean & Jerk' })
  })

  it('Clean & Jerk (reps 21, load 43) -> Bike / Ski: identical reconciliation, capability-driven not name-driven', () => {
    const instance = { instanceId: 'mi_1', name: 'Clean & Jerk', reps: { mode: 'universal', value: 21 }, load: { mode: 'universal', value: 43, unit: 'kg' } }
    for (const targetName of ['Bike', 'Ski', 'Air Bike', 'Ski Erg']) {
      const next = applyPerformedSubstitution(instance, { id: `cm-${targetName}`, name: targetName }, capCalDist)
      expect(next.reps).toBeUndefined()
      expect(next.load).toBeUndefined()
    }
  })

  it('Bike (21 calories) -> Row: calories preserved verbatim (both share the metric), no conversion', () => {
    const instance = { instanceId: 'mi_1', name: 'Bike', calories: { mode: 'universal', value: 21 } }
    const next = applyPerformedSubstitution(instance, { id: 'cm-row', name: 'Row' }, capCalDist)
    expect(next.calories).toEqual({ mode: 'universal', value: 21 })
    expect(next.distance).toBeUndefined()
  })

  it('Row (250 m) -> Ski (same distance capability): distance preserved verbatim, no unit conversion', () => {
    const instance = { instanceId: 'mi_1', name: 'Row', distance: { mode: 'universal', value: 250, unit: 'm' } }
    const next = applyPerformedSubstitution(instance, { id: 'cm-ski', name: 'Ski' }, capCalDist)
    expect(next.distance).toEqual({ mode: 'universal', value: 250, unit: 'm' })
  })

  it('Row (250 m) -> Clean & Jerk: distance removed; zero overlap -> fresh blank reps+load controls initialized, no value carried/converted', () => {
    const instance = { instanceId: 'mi_1', name: 'Row', distance: { mode: 'universal', value: 250, unit: 'm' } }
    const next = applyPerformedSubstitution(instance, { id: 'cm-cj', name: 'Clean & Jerk' }, capRepsLoad)
    expect(next.distance).toBeUndefined()
    expect(next.reps).toEqual({ mode: 'universal', value: null })
    expect(next.load).toEqual({ mode: 'universal', value: null, unit: 'kg' })
  })
})

describe('INC-15 - future-proof: synthetic catalog fixtures, capability-driven not name-driven', () => {
  // Movement A: reps + load. Movement B: calories + distance. Neither name
  // means anything to applyPerformedSubstitution - only `capability.allowed`
  // (derived from resolveMovementCapability, itself reading ONLY
  // allowed_prescription_metrics) drives the outcome.
  const movementA = resolveMovementCapability({ allowed_prescription_metrics: ['reps', 'load'], default_prescription_metric: 'reps' })
  const movementB = resolveMovementCapability({ allowed_prescription_metrics: ['calories', 'distance'], default_prescription_metric: 'calories' })

  it('A (reps+load) -> B (calories+distance): both A-only metrics cleared, B fresh state initialized blank', () => {
    const instance = { instanceId: 'mi_x', name: 'Synthetic Movement A', reps: { mode: 'universal', value: 15 }, load: { mode: 'universal', value: 20, unit: 'kg' } }
    const next = applyPerformedSubstitution(instance, { id: 'synthetic-b', name: 'Synthetic Movement B' }, movementB)
    expect(next.reps).toBeUndefined()
    expect(next.load).toBeUndefined()
    expect(next.calories).toEqual({ mode: 'universal', value: null }) // movementB's own default
    expect(next.distance).toBeUndefined()
  })

  it('B (calories+distance) -> A (reps+load): both B-only metrics cleared, A fresh state initialized blank', () => {
    const instance = { instanceId: 'mi_x', name: 'Synthetic Movement B', calories: { mode: 'universal', value: 30 } }
    const next = applyPerformedSubstitution(instance, { id: 'synthetic-a', name: 'Synthetic Movement A' }, movementA)
    expect(next.calories).toBeUndefined()
    expect(next.reps).toEqual({ mode: 'universal', value: null })
    expect(next.load).toEqual({ mode: 'universal', value: null, unit: 'kg' }) // movementA's capability includes load too
  })

  it('a movement NEVER SEEN BEFORE (arbitrary id/name) still reconciles correctly from its capability alone - no editor/source change required for a new catalog entry', () => {
    // Simulates a brand-new catalog row added tomorrow with
    // allowed_prescription_metrics: [calories, distance] - proves the
    // reconciliation logic needs zero code changes to support it, because it
    // was never keyed on id or name in the first place.
    const brandNewMovement = resolveMovementCapability({ allowed_prescription_metrics: ['calories', 'distance'], default_prescription_metric: 'distance' })
    const instance = { instanceId: 'mi_y', name: 'Some Old Movement', reps: { mode: 'universal', value: 12 } }
    const next = applyPerformedSubstitution(instance, { id: 'brand-new-uuid-not-in-any-branch', name: 'Totally New Machine 3000' }, brandNewMovement)
    expect(next.reps).toBeUndefined() // reps incompatible with the new movement's capability
    expect(next.name).toBe('Totally New Machine 3000')
  })

  it('a movement sharing BOTH reps and load with the source keeps both (full overlap, no loss)', () => {
    const instance = { instanceId: 'mi_z', reps: { mode: 'universal', value: 15 }, load: { mode: 'universal', value: 20, unit: 'kg' } }
    const sameCapability = resolveMovementCapability({ allowed_prescription_metrics: ['reps', 'load'], default_prescription_metric: 'load' })
    const next = applyPerformedSubstitution(instance, { id: 'synthetic-a2', name: 'Synthetic Movement A2' }, sameCapability)
    expect(next.reps).toEqual({ mode: 'universal', value: 15 })
    expect(next.load).toEqual({ mode: 'universal', value: 20, unit: 'kg' })
  })

  it('partial overlap: only the shared metric survives (reps+load -> reps-only)', () => {
    const instance = { instanceId: 'mi_w', reps: { mode: 'universal', value: 15 }, load: { mode: 'universal', value: 20, unit: 'kg' } }
    const repsOnly = resolveMovementCapability({ allowed_prescription_metrics: ['reps'], default_prescription_metric: 'reps' })
    const next = applyPerformedSubstitution(instance, { id: 'synthetic-reps-only', name: 'Synthetic Reps-Only Movement' }, repsOnly)
    expect(next.reps).toEqual({ mode: 'universal', value: 15 })
    expect(next.load).toBeUndefined()
  })

  it('unknown/unseeded catalog capability fails OPEN (retains everything) - never guesses a clearance', () => {
    const instance = { instanceId: 'mi_v', reps: { mode: 'universal', value: 15 }, load: { mode: 'universal', value: 20, unit: 'kg' }, distance: { mode: 'universal', value: 100, unit: 'm' } }
    const unknownCapability = resolveMovementCapability({ allowed_prescription_metrics: [], default_prescription_metric: null })
    expect(unknownCapability.unknown).toBe(true)
    const next = applyPerformedSubstitution(instance, { id: 'never-seeded', name: 'Never Seeded Movement' }, unknownCapability)
    expect(next.reps).toEqual({ mode: 'universal', value: 15 })
    expect(next.load).toEqual({ mode: 'universal', value: 20, unit: 'kg' })
    expect(next.distance).toEqual({ mode: 'universal', value: 100, unit: 'm' })
  })
})
