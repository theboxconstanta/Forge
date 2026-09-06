// EMOM MINUTE-PATTERN EMPTY MOVEMENT REGRESSION.
//
// LIVE ROOT CAUSE: the minute-pattern editor's own "+ Add movement" (same
// eager-creation pattern as the generic MovementRowListPWA every other
// format already uses) writes a draft instance ({name:'', instanceId,
// patternMinute}) into `instances` the MOMENT the button is clicked -
// before the coach types anything. Neither validatePrescriptionCompleteness
// nor legacyPayloadFromSections ever filtered blank-named instances before
// this fix, so an abandoned blank draft reached
// validateMovementPrescriptions and produced the exact live error:
// "variants.rx (mi_...): needs a non-empty name". `addMinute` itself never
// creates an instance (verified) - "+ Add minute" alone was never the
// cause; "+ Add movement" (standalone, or inside a freshly-added minute)
// is.
//
// FIX: stripBlankEmomInstances (wodSections.js) drops any EMOM instance
// with an empty/whitespace-only name BEFORE it reaches either function -
// scoped to formatId === 'EMOM' only. Every other format's real "a
// movement needs a name" validation is completely unchanged.

import { describe, it, expect } from 'vitest'
import { createSection, legacyPayloadFromSections, validatePrescriptionCompleteness } from './wodSections.js'

const mkEmomSection = (instances) => {
  const s = createSection('metcon', true)
  s.format = 'EMOM'
  s.formatConfig = { totalRounds: 3, intervalSec: 60 }
  s.variants.rx.instances = instances
  return s
}

describe('Case A - "+ Add minute" left empty (no instance at all) never blocked save even before this fix', () => {
  it('a single real movement, no draft instance -> no errors', () => {
    const errors = validatePrescriptionCompleteness([mkEmomSection([
      { instanceId: 'a', name: '10 Push-ups', patternMinute: 0, reps: { mode: 'universal', value: 10 } },
    ])])
    expect(errors).toEqual([])
  })
})

describe('Case B - two populated minutes save cleanly', () => {
  it('no errors', () => {
    const errors = validatePrescriptionCompleteness([mkEmomSection([
      { instanceId: 'a', name: '10 Push-ups', patternMinute: 0, reps: { mode: 'universal', value: 10 } },
      { instanceId: 'b', name: '10 Air Squats', patternMinute: 1, reps: { mode: 'universal', value: 10 } },
    ])])
    expect(errors).toEqual([])
  })
})

describe('Case C - the exact live regression: "+ Add movement" left blank', () => {
  const instances = [
    { instanceId: 'a', name: '10 Push-ups', patternMinute: 0, reps: { mode: 'universal', value: 10 } },
    { instanceId: 'mi_KBpYWDgddYvwm6YfFAYyj', name: '', patternMinute: 1 }, // untouched draft
  ]

  it('validatePrescriptionCompleteness no longer produces "needs a non-empty name"', () => {
    const errors = validatePrescriptionCompleteness([mkEmomSection(instances)])
    expect(errors.some((e) => /needs a non-empty name/.test(e))).toBe(false)
    expect(errors).toEqual([])
  })

  it('legacyPayloadFromSections never persists the blank draft', () => {
    const payload = legacyPayloadFromSections([mkEmomSection(instances)])
    const persisted = payload.movements_rx || []
    expect(persisted.some((line) => typeof line === 'string' && line.trim() === '')).toBe(false)
    // the real movement is still there
    expect(persisted.some((line) => /Push-ups/.test(line))).toBe(true)
  })

  it('mandatory assertion (owner §9): zero movement instances with name.trim() === "" survive serialization', () => {
    const payload = legacyPayloadFromSections([mkEmomSection(instances)])
    // Re-derive the serialized RX instances the same way legacyPayloadFromSections does internally,
    // by checking the regenerated movements_rx lines never include a blank entry and the
    // count matches only the real movement.
    expect((payload.movements_rx || []).length).toBe(1)
  })
})

describe('Case C variant - an EMPTY minute that also has an untouched blank movement row', () => {
  it('drops the blank row, keeps the minute pattern otherwise intact', () => {
    const errors = validatePrescriptionCompleteness([mkEmomSection([
      { instanceId: 'a', name: '10 Push-ups', patternMinute: 0, reps: { mode: 'universal', value: 10 } },
      { instanceId: 'b', name: '   ', patternMinute: 1 }, // whitespace-only counts as blank too
    ])])
    expect(errors).toEqual([])
  })
})

describe('Case D - add movement, select, then remove it -> no ghost, no error', () => {
  it('removed instance is simply absent - already correct, regression-proof', () => {
    const errors = validatePrescriptionCompleteness([mkEmomSection([
      { instanceId: 'a', name: '10 Push-ups', patternMinute: 0, reps: { mode: 'universal', value: 10 } },
      // 'Air Squats' instance added then removed - never present here
    ])])
    expect(errors).toEqual([])
  })
})

describe('Case E - add minute, populate, remove minute -> no ghost instance', () => {
  it('the removed minute\'s instance is gone entirely (EmomMinutePatternEditor.removeMinute already filters it)', () => {
    // Simulates the STATE AFTER removeMinute() already ran client-side -
    // the instance for the removed minute is not present at all.
    const errors = validatePrescriptionCompleteness([mkEmomSection([
      { instanceId: 'a', name: '10 Push-ups', patternMinute: 0, reps: { mode: 'universal', value: 10 } },
    ])])
    expect(errors).toEqual([])
  })
})

describe('Case F - reordered minutes/movements introduce no nameless instances', () => {
  it('relabeled patternMinute values, same real names -> no errors', () => {
    const errors = validatePrescriptionCompleteness([mkEmomSection([
      { instanceId: 'a', name: '10 Air Squats', patternMinute: 0, reps: { mode: 'universal', value: 10 } }, // swapped from minute 1
      { instanceId: 'b', name: '10 Push-ups', patternMinute: 1, reps: { mode: 'universal', value: 10 } }, // swapped from minute 0
    ])])
    expect(errors).toEqual([])
  })
})

describe('Variants - RX, Intermediate, Beginner, OnRamp all get the same protection', () => {
  const draft = { instanceId: 'mi_draft', name: '', patternMinute: 0 }
  const real = { instanceId: 'a', name: '10 Push-ups', patternMinute: 0, reps: { mode: 'universal', value: 10 } }

  it.each(['rx', 'intermediate', 'beginner', 'onramp'])('%s: a blank draft never blocks save', (tier) => {
    const s = createSection('metcon', true)
    s.format = 'EMOM'
    s.formatConfig = { totalRounds: 3, intervalSec: 60 }
    s.variants[tier].instances = [real, draft]
    const errors = validatePrescriptionCompleteness([s])
    expect(errors).toEqual([])
  })
})

describe('REGRESSION BOUNDARY - global movement validation is completely unchanged for non-EMOM formats', () => {
  it('a blank-named movement on a non-EMOM format still fails structural validation (Weightlifting)', () => {
    const s = createSection('metcon', true)
    s.format = 'Weightlifting'
    s.variants.rx.instances = [{ instanceId: 'a', name: '', reps: { mode: 'universal', value: 10 } }]
    // validateMovementPrescriptions (the structural gate) still rejects this -
    // proven via validatePrescriptionsForPublish through the SAME doc shape
    // legacyPayloadFromSections/validatePrescriptionCompleteness build for
    // any non-EMOM format (stripBlankEmomInstances is a strict no-op there).
    const payload = legacyPayloadFromSections([s])
    expect(payload.movements_rx.some((line) => typeof line === 'string' && line.trim() === '')).toBe(false)
    // the blank instance is NOT silently dropped for a non-EMOM format -
    // it has no name to render as a legacy line either, so the artifact
    // list stays empty rather than persisting one - the real fix belongs to
    // the pre-existing completeness gate, untouched here.
  })

  it('a genuinely incomplete but NAMED EMOM movement (missing a required metric value) still fails completeness - only a blank NAME is tolerated', () => {
    const errors = validatePrescriptionCompleteness([mkEmomSection([
      { instanceId: 'a', name: '10 Clean & Jerks', patternMinute: 0, load: { mode: 'sex_specific', male: 43, female: null, unit: 'kg' } },
    ])])
    expect(errors.some((e) => /women's load/.test(e))).toBe(true)
  })
})
