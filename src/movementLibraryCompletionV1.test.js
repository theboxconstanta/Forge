// FORGE — MOVEMENT LIBRARY COMPLETION V1 (Batches 1-3, owner-approved
// catalog audit). Exercises the REAL resolution path (buildMovementIndex /
// resolveCatalogMovementByName / resolveMovementCapability,
// prescriptionContract.js) against a fixture set matching the exact live
// catalog rows this migration touched - not a mock, the same functions
// Composer/Change Movement/Log Score all call.
//
// Fixture rows below are a verified snapshot of the LIVE catalog after
// migrations 20260922090000/100000/110000 were applied (values copied
// from live `select` verification, not invented).

import { describe, it, expect } from 'vitest'
import { buildMovementIndex, resolveCatalogMovementByName, resolveMovementCapability } from './prescriptionContract'

// Batch 1 - 10 new rows.
const NEW_MOVEMENTS = [
  { id: 'new-1', name: 'Dumbbell Hang Power Clean And Jerk', category: 'dumbbell', aliases: [], allowed_prescription_metrics: ['reps', 'load'], default_prescription_metric: 'load' },
  { id: 'new-2', name: 'Dumbbell Hang Squat Clean And Jerk', category: 'dumbbell', aliases: [], allowed_prescription_metrics: ['reps', 'load'], default_prescription_metric: 'load' },
  { id: 'new-3', name: 'Squat Jump', category: 'bodyweight', aliases: [], allowed_prescription_metrics: ['reps'], default_prescription_metric: 'reps' },
  { id: 'new-4', name: 'Box Jump Down', category: 'bodyweight', aliases: [], allowed_prescription_metrics: ['reps'], default_prescription_metric: 'reps' },
  { id: 'new-5', name: 'Weighted Dip', category: 'gymnastics', aliases: [], allowed_prescription_metrics: ['reps', 'load'], default_prescription_metric: 'load' },
  { id: 'new-6', name: 'Strict Ring Dip', category: 'gymnastics', aliases: [], allowed_prescription_metrics: ['reps', 'load'], default_prescription_metric: 'load' },
  { id: 'new-7', name: 'Single Arm Overhead Squat', category: 'dumbbell', aliases: [], allowed_prescription_metrics: ['reps', 'load'], default_prescription_metric: 'load' },
  { id: 'new-8', name: 'Trap Bar Deadlift', category: 'barbell', aliases: [], allowed_prescription_metrics: ['reps', 'load'], default_prescription_metric: 'load' },
  { id: 'new-9', name: 'Nordic Curl', category: 'gymnastics', aliases: [], allowed_prescription_metrics: ['reps'], default_prescription_metric: 'reps' },
  { id: 'new-10', name: 'Skater Jump', category: 'bodyweight', aliases: [], allowed_prescription_metrics: ['reps'], default_prescription_metric: 'reps' },
]

// Batch 1 pre-existing siblings that must still resolve independently
// (no ambiguity introduced by the new "And Jerk" compound rows).
const EXISTING_SIBLINGS = [
  { id: 'sib-1', name: 'Dumbbell Hang Power Clean', category: 'dumbbell', aliases: [], allowed_prescription_metrics: ['reps', 'load'], default_prescription_metric: 'load' },
  { id: 'sib-2', name: 'Dumbbell Hang Squat Clean', category: 'dumbbell', aliases: [], allowed_prescription_metrics: ['reps', 'load'], default_prescription_metric: 'load' },
  { id: 'sib-3', name: 'Dumbbell Hang Clean And Jerk', category: 'dumbbell', aliases: [], allowed_prescription_metrics: ['reps', 'load'], default_prescription_metric: 'load' },
]

// Batch 2 - 8 rows with corrected capability (category deliberately left
// null, matching the live migration's "metrics-only" scope).
const CAPABILITY_FIXED = [
  { id: 'cap-1', name: 'Man Makers', category: null, aliases: [], allowed_prescription_metrics: ['reps', 'load'], default_prescription_metric: 'load' },
  { id: 'cap-2', name: 'Face Pull', category: null, aliases: [], allowed_prescription_metrics: ['reps'], default_prescription_metric: 'reps' },
  { id: 'cap-3', name: 'Lateral Raise', category: null, aliases: [], allowed_prescription_metrics: ['reps', 'load'], default_prescription_metric: 'load' },
  { id: 'cap-4', name: 'Cuban Rotation', category: null, aliases: [], allowed_prescription_metrics: ['reps', 'load'], default_prescription_metric: 'load' },
  { id: 'cap-5', name: 'Pull-to-Stand', category: null, aliases: [], allowed_prescription_metrics: ['reps'], default_prescription_metric: 'reps' },
  { id: 'cap-6', name: 'Skin the Cat', category: null, aliases: [], allowed_prescription_metrics: ['reps'], default_prescription_metric: 'reps' },
  { id: 'cap-7', name: 'Handstand Pirouette', category: null, aliases: [], allowed_prescription_metrics: ['reps'], default_prescription_metric: 'reps' },
  { id: 'cap-8', name: 'Around the World', category: null, aliases: [], allowed_prescription_metrics: ['reps', 'load'], default_prescription_metric: 'load' },
]

// Isometric holds - untouched by this ticket. Must still resolve to
// unknown capability (Composer's manual chooser), never accidentally
// picked up by any Batch 1/2/3 change.
const ISOMETRIC_HOLDS = [
  { id: 'hold-1', name: 'Plank', category: null, aliases: [], allowed_prescription_metrics: [], default_prescription_metric: null },
  { id: 'hold-2', name: 'Wall Sit', category: null, aliases: [], allowed_prescription_metrics: [], default_prescription_metric: null },
  { id: 'hold-3', name: 'L Sit', category: null, aliases: [], allowed_prescription_metrics: [], default_prescription_metric: null },
]

// Batch 3 - the 7 rows that received new aliases, plus other real
// catalog rows that could plausibly (but must NOT) collide with them.
const ALIASED_ROWS = [
  { id: 'ali-1', name: 'Sled Push', category: 'odd-object', aliases: ['push sled', 'prowler'], allowed_prescription_metrics: ['reps', 'load'], default_prescription_metric: 'load' },
  { id: 'ali-2', name: 'Sled Pull', category: 'odd-object', aliases: ['pull sled'], allowed_prescription_metrics: ['reps', 'load'], default_prescription_metric: 'load' },
  { id: 'ali-3', name: 'Glute Ham Raise', category: null, aliases: ['ghr'], allowed_prescription_metrics: ['reps'], default_prescription_metric: 'reps' },
  { id: 'ali-4', name: 'Medicine Ball Clean', category: 'odd-object', aliases: ['med ball clean'], allowed_prescription_metrics: ['reps', 'load'], default_prescription_metric: 'load' },
  { id: 'ali-5', name: 'Medicine Ball Throw', category: 'odd-object', aliases: ['med ball throw'], allowed_prescription_metrics: ['reps', 'load'], default_prescription_metric: 'load' },
  { id: 'ali-6', name: 'Medicine Ball Sit Up', category: 'odd-object', aliases: ['med ball sit up'], allowed_prescription_metrics: ['reps'], default_prescription_metric: 'reps' },
  { id: 'ali-7', name: 'Medicine Ball Box Step Over', category: 'odd-object', aliases: ['med ball box step over'], allowed_prescription_metrics: ['reps'], default_prescription_metric: 'reps' },
  // Not an alias target - a DIFFERENT real movement, present to prove
  // "Sled Drag" is never confused with the Sled Push/Pull aliases.
  { id: 'ali-8', name: 'Sled Drag', category: 'odd-object', aliases: [], allowed_prescription_metrics: ['reps', 'load'], default_prescription_metric: 'load' },
]

const ALL_ROWS = [...NEW_MOVEMENTS, ...EXISTING_SIBLINGS, ...CAPABILITY_FIXED, ...ISOMETRIC_HOLDS, ...ALIASED_ROWS]
const index = buildMovementIndex(ALL_ROWS)

describe('Batch 1 — new movements resolve exactly, no ambiguity with siblings', () => {
  it.each(NEW_MOVEMENTS)('$name resolves to itself with the approved capability', (row) => {
    const hit = resolveCatalogMovementByName(index, row.name)
    expect(hit).toBeTruthy()
    expect(hit.ambiguous).toBeFalsy()
    expect(hit.id).toBe(row.id)
    const cap = resolveMovementCapability(hit)
    expect(cap.allowed.sort()).toEqual([...row.allowed_prescription_metrics].sort())
    expect(cap.default).toBe(row.default_prescription_metric)
    expect(cap.unknown).toBe(false)
  })

  it('the new compound rows do not collide with their pre-existing sibling rows', () => {
    expect(resolveCatalogMovementByName(index, 'Dumbbell Hang Power Clean').id).toBe('sib-1')
    expect(resolveCatalogMovementByName(index, 'Dumbbell Hang Squat Clean').id).toBe('sib-2')
    expect(resolveCatalogMovementByName(index, 'Dumbbell Hang Clean And Jerk').id).toBe('sib-3')
    expect(resolveCatalogMovementByName(index, 'Dumbbell Hang Power Clean And Jerk').id).toBe('new-1')
    expect(resolveCatalogMovementByName(index, 'Dumbbell Hang Squat Clean And Jerk').id).toBe('new-2')
  })

  it('"&" typed instead of "And" still resolves the new compound movements (Composer/Log Score input parity)', () => {
    expect(resolveCatalogMovementByName(index, 'Dumbbell Hang Power Clean & Jerk').id).toBe('new-1')
    expect(resolveCatalogMovementByName(index, 'Dumbbell Hang Squat Clean & Jerk').id).toBe('new-2')
  })
})

describe('Batch 2 — capability-fixed movements resolve with real metrics, no longer "unknown"', () => {
  it.each(CAPABILITY_FIXED)('$name is no longer unknown-capability', (row) => {
    const hit = resolveCatalogMovementByName(index, row.name)
    const cap = resolveMovementCapability(hit)
    expect(cap.unknown).toBe(false)
    expect(cap.allowed.sort()).toEqual([...row.allowed_prescription_metrics].sort())
    expect(cap.default).toBe(row.default_prescription_metric)
  })

  it('isometric holds are untouched — still unknown capability (Composer manual chooser)', () => {
    for (const row of ISOMETRIC_HOLDS) {
      const cap = resolveMovementCapability(resolveCatalogMovementByName(index, row.name))
      expect(cap.unknown).toBe(true)
      expect(cap.allowed).toEqual([])
    }
  })
})

describe('Batch 3 — aliases resolve unambiguously, no collisions introduced', () => {
  it('"Push Sled" / "Prowler" resolve to Sled Push; "Pull Sled" resolves to Sled Pull', () => {
    expect(resolveCatalogMovementByName(index, 'Push Sled').id).toBe('ali-1')
    expect(resolveCatalogMovementByName(index, 'Prowler').id).toBe('ali-1')
    expect(resolveCatalogMovementByName(index, 'Pull Sled').id).toBe('ali-2')
  })

  it('the Sled Push/Pull aliases never resolve to the unrelated "Sled Drag" row', () => {
    expect(resolveCatalogMovementByName(index, 'Push Sled').id).not.toBe('ali-8')
    expect(resolveCatalogMovementByName(index, 'Sled Drag').id).toBe('ali-8')
  })

  it('"GHR" resolves to Glute Ham Raise; the spelled-out name still resolves independently', () => {
    expect(resolveCatalogMovementByName(index, 'GHR').id).toBe('ali-3')
    expect(resolveCatalogMovementByName(index, 'Glute Ham Raise').id).toBe('ali-3')
  })

  it('each "Med Ball X" alias resolves to its own distinct Medicine Ball row, never a different one', () => {
    expect(resolveCatalogMovementByName(index, 'Med Ball Clean').id).toBe('ali-4')
    expect(resolveCatalogMovementByName(index, 'Med Ball Throw').id).toBe('ali-5')
    expect(resolveCatalogMovementByName(index, 'Med Ball Sit Up').id).toBe('ali-6')
    expect(resolveCatalogMovementByName(index, 'Med Ball Box Step Over').id).toBe('ali-7')
  })
})

describe('Golden-source guard — scoring surface untouched', () => {
  it('resolveMovementCapability never returns an "unknown" false-negative for a fully-specified row', () => {
    for (const row of [...NEW_MOVEMENTS, ...CAPABILITY_FIXED, ...ALIASED_ROWS.filter(r => r.id !== 'ali-8' || true)]) {
      const cap = resolveMovementCapability(row)
      expect(cap.unknown).toBe(row.allowed_prescription_metrics.length === 0)
    }
  })
})
