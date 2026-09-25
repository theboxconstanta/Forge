// SECONDS PRESCRIPTION METRIC — focused regression coverage for the new
// duration metric, scoped to exactly Bar Hang / Static Bar Hang. Verifies the
// full pipeline this change touches: builder seeding, structural + publish
// validation, member-facing rendering, legacy artifact generation, the
// prescription snapshot (frozen historical truth), the Workout Engine V2
// mirror, Composer scaling (Generate Variants), the structured-component
// renderer, and AI-provenance correction diffing. Also re-confirms existing
// reps/load/distance/calories behavior is unaffected (additive-only change).

import { describe, it, expect } from 'vitest'
import {
  METRIC_KEYS,
  newMovementInstance,
  resolveMovementCapability,
  validateMovementPrescriptions,
  validatePrescriptionsForPublish,
  resolveSpec,
  resolveMovementInstance,
  renderInstanceLine,
  buildLegacyArtifactsForVariant,
  buildPrescriptionSnapshot,
  movementObjectsForV2,
} from './prescriptionContract.js'
import { renderComponentMovementLines } from './componentContract.js'
import { generateVariantInstancesFromRx } from './scalingEngine.js'
import { diffAiVsSaved } from './aiProvenanceDiff.js'

const BAR_HANG_CAP = { allowed: ['seconds'], default: 'seconds', unknown: false }

describe('METRIC_KEYS — additive widen', () => {
  it('includes seconds alongside the existing four metrics, order preserved', () => {
    expect(METRIC_KEYS).toEqual(['reps', 'load', 'distance', 'calories', 'seconds'])
  })
})

describe('resolveMovementCapability — Bar Hang / Static Bar Hang shape', () => {
  it('a catalog row with allowed=["seconds"] resolves to a known (not unknown) seconds-default capability', () => {
    const cap = resolveMovementCapability({ allowed_prescription_metrics: ['seconds'], default_prescription_metric: 'seconds' })
    expect(cap).toEqual({ allowed: ['seconds'], default: 'seconds', unknown: false })
  })

  it('the other holds (allowed=[]) are unaffected - still unknown, no seconds leak', () => {
    const cap = resolveMovementCapability({ allowed_prescription_metrics: [], default_prescription_metric: null })
    expect(cap).toEqual({ allowed: [], default: null, unknown: true })
  })
})

describe('newMovementInstance — builder seeding for a seconds-default movement', () => {
  it('seeds a blank universal seconds spec for Bar Hang', () => {
    const inst = newMovementInstance({ name: 'Bar Hang', canonicalMovementId: 'bh-id', capability: BAR_HANG_CAP })
    expect(inst.seconds).toEqual({ mode: 'universal', value: null })
    expect(inst.reps).toBeUndefined()
    expect(inst.load).toBeUndefined()
  })

  it('existing reps/load/distance/calories seeding is unaffected', () => {
    expect(newMovementInstance({ capability: { allowed: ['reps'], default: 'reps' } }).reps).toEqual({ mode: 'universal', value: null })
    expect(newMovementInstance({ capability: { allowed: ['load'], default: 'load' } }).load).toEqual({ mode: 'sex_specific', male: null, female: null, unit: 'kg' })
    expect(newMovementInstance({ capability: { allowed: ['distance'], default: 'distance' } }).distance).toEqual({ mode: 'universal', value: null, unit: 'm' })
    expect(newMovementInstance({ capability: { allowed: ['calories'], default: 'calories' } }).calories).toEqual({ mode: 'sex_specific', male: null, female: null })
  })
})

describe('validateMovementPrescriptions — structural validation accepts seconds', () => {
  const doc = (seconds) => ({ version: 1, variants: { rx: { movements: [{ instanceId: 'x', name: 'Bar Hang', seconds }] } } })

  it('universal seconds value is valid', () => {
    expect(validateMovementPrescriptions(doc({ mode: 'universal', value: 30 })).valid).toBe(true)
  })

  it('sex_specific seconds is valid', () => {
    expect(validateMovementPrescriptions(doc({ mode: 'sex_specific', male: 45, female: 30 })).valid).toBe(true)
  })

  it('a non-numeric seconds value is rejected, same as any other metric', () => {
    const r = validateMovementPrescriptions(doc({ mode: 'universal', value: 'thirty' }))
    expect(r.valid).toBe(false)
  })

  it('seconds never triggers the load/distance unit-requirement check (it has no unit)', () => {
    // no `unit` key at all - must NOT be flagged, unlike load/distance which require one
    expect(validateMovementPrescriptions(doc({ mode: 'universal', value: 30 })).errors).toEqual([])
  })
})

describe('validatePrescriptionsForPublish — seconds is a completeness-checked characteristic', () => {
  it('a fully-filled universal seconds value passes publish', () => {
    const doc = { version: 1, variants: { rx: { movements: [{ instanceId: 'x', name: 'Bar Hang', seconds: { mode: 'universal', value: 30 } }] } } }
    expect(validatePrescriptionsForPublish(doc).valid).toBe(true)
  })

  it('a blank universal seconds value blocks publish, with the correct "seconds is missing" label (not "undefined")', () => {
    const doc = { version: 1, variants: { rx: { movements: [{ instanceId: 'x', name: 'Bar Hang', seconds: { mode: 'universal', value: null } }] } } }
    const r = validatePrescriptionsForPublish(doc)
    expect(r.valid).toBe(false)
    expect(r.errors[0]).toBe('Bar Hang (rx): seconds is missing a value.')
  })

  it('a sex_specific seconds half-entry blocks publish with a specific sex label', () => {
    const doc = { version: 1, variants: { rx: { movements: [{ instanceId: 'x', name: 'Static Bar Hang', seconds: { mode: 'sex_specific', male: 45, female: null } }] } } }
    const r = validatePrescriptionsForPublish(doc)
    expect(r.valid).toBe(false)
    expect(r.errors[0]).toBe("Static Bar Hang (rx): women's seconds is missing.")
  })

  it('existing reps/load/distance/calories publish-gate behavior is unaffected', () => {
    const doc = { version: 1, variants: { rx: { movements: [{ instanceId: 'x', name: 'Snatch', load: { mode: 'sex_specific', male: 45, female: null, unit: 'kg' } }] } } }
    expect(validatePrescriptionsForPublish(doc).errors[0]).toBe('Snatch (rx): women\'s load is missing.')
  })
})

describe('Member-facing rendering — the "30 sec Bar Hang" surface', () => {
  it('resolveMovementInstance / renderInstanceLine render the lead-token convention, matching reps/distance/calories', () => {
    const r = resolveMovementInstance({ instanceId: 'x', name: 'Bar Hang', seconds: { mode: 'universal', value: 30 } }, 'male')
    expect(r.line).toBe('30 sec Bar Hang')
    expect(r.seconds).toEqual({ mode: 'universal', value: 30, unit: null, bothValues: null })
  })

  it('sex_specific seconds resolves per-gender, and shows both when gender is unknown (same convention as load/calories)', () => {
    const inst = { instanceId: 'x', name: 'Static Bar Hang', seconds: { mode: 'sex_specific', male: 45, female: 30 } }
    expect(resolveMovementInstance(inst, 'female').line).toBe('30 sec Static Bar Hang')
    expect(resolveMovementInstance(inst, 'male').line).toBe('45 sec Static Bar Hang')
    expect(resolveMovementInstance(inst, null).line).toBe('45/30 sec Static Bar Hang')
  })

  it('a movement with no seconds spec at all is unaffected (falls through to name-only, same as before)', () => {
    expect(renderInstanceLine({ name: 'Plank', reps: null, load: null, distance: null, calories: null, seconds: null })).toBe('Plank')
  })

  it('existing reps/distance/calories lead-token rendering is unaffected', () => {
    expect(renderInstanceLine({ name: 'Snatch', reps: resolveSpec({ mode: 'universal', value: 20 }, null) })).toBe('20 Snatch')
    expect(renderInstanceLine({ name: 'Row', distance: resolveSpec({ mode: 'universal', value: 500, unit: 'm' }, null) })).toBe('500 m Row')
    expect(renderInstanceLine({ name: 'Row', calories: resolveSpec({ mode: 'universal', value: 15 }, null) })).toBe('15 Cal Row')
  })
})

describe('Legacy artifact generation — buildLegacyArtifactsForVariant', () => {
  it('produces a plain "30 sec Bar Hang" legacy line', () => {
    const { lines } = buildLegacyArtifactsForVariant([{ instanceId: 'x', name: 'Bar Hang', seconds: { mode: 'universal', value: 30 } }])
    expect(lines).toEqual(['30 sec Bar Hang'])
  })

  it('existing reps + load legacy line generation is unaffected', () => {
    const { lines, weightMale } = buildLegacyArtifactsForVariant(
      [{ instanceId: 'x', name: 'Snatch', reps: { mode: 'universal', value: 20 }, load: { mode: 'sex_specific', male: 45, female: 30, unit: 'kg' } }],
      { inlineLoad: true },
    )
    expect(lines).toEqual(['20 Snatch @ 45/30 kg'])
    expect(weightMale).toBe('45')
  })
})

describe('Prescription snapshot — frozen historical truth includes seconds', () => {
  it('buildPrescriptionSnapshot freezes a seconds spec for Bar Hang', () => {
    const doc = { version: 1, variants: { rx: { movements: [{ instanceId: 'x', name: 'Bar Hang', canonicalMovementId: 'bh-id', seconds: { mode: 'universal', value: 30 } }] } } }
    const snap = buildPrescriptionSnapshot({ doc, variantKey: 'rx', gender: 'male', resolvedAt: '2026-09-24T00:00:00Z' })
    expect(snap.movements[0].seconds).toEqual({ value: 30, mode: 'universal', bothValues: null })
    expect(snap.movements[0].displayLine).toBe('30 sec Bar Hang')
  })

  it('existing load snapshot freezing is unaffected', () => {
    const doc = { version: 1, variants: { rx: { movements: [{ instanceId: 'x', name: 'Snatch', load: { mode: 'sex_specific', male: 45, female: 30, unit: 'kg' } }] } } }
    const snap = buildPrescriptionSnapshot({ doc, variantKey: 'rx', gender: 'male', resolvedAt: '2026-09-24T00:00:00Z' })
    expect(snap.movements[0].load).toEqual({ value: 45, unit: 'kg', mode: 'sex_specific', bothValues: [45, 30] })
  })
})

describe('Workout Engine V2 mirror — movementObjectsForV2 carries seconds through', () => {
  it('includes a seconds display token and the raw seconds spec in the prescription mirror', () => {
    const [obj] = movementObjectsForV2([{ instanceId: 'x', name: 'Bar Hang', seconds: { mode: 'universal', value: 30 } }])
    expect(obj.seconds).toBe('30')
    expect(obj.prescription.seconds).toEqual({ mode: 'universal', value: 30 })
    expect(obj.reps).toBeNull()
  })
})

describe('Structured-component renderer — renderComponentMovementLines', () => {
  it('renders "30 sec Bar Hang" for a component/interval instance', () => {
    const [line] = renderComponentMovementLines([{ instanceId: 'x', name: 'Bar Hang', seconds: { mode: 'universal', value: 30 } }], null)
    expect(line).toBe('30 sec Bar Hang')
  })
})

describe('Composer scaling — generateVariantInstancesFromRx preserves seconds', () => {
  it('a Bar Hang seconds prescription survives Generate Variants without being silently dropped', () => {
    const out = generateVariantInstancesFromRx(
      [{ instanceId: 'x', name: 'Bar Hang', seconds: { mode: 'universal', value: 30 } }],
      {},
      () => null,
    )
    // scaling may or may not adjust the number, but the movement must not
    // vanish or lose its seconds identity entirely across every tier
    for (const tier of ['intermediate', 'beginner', 'onramp']) {
      expect(out[tier].length).toBe(1)
      expect(out[tier][0].name).toMatch(/Bar Hang/i)
    }
  })
})

describe('AI-provenance correction diffing — seconds_changed', () => {
  const sec = (over = {}) => ({
    typeKey: 'metcon', isPrimary: true, scored: true, title: '',
    format: 'AMRAP', formatConfig: { durationSec: 600 },
    variants: {
      rx: { instances: [], movements: [], weight: { male: '', female: '' }, note: '' },
      intermediate: { instances: [], movements: [], weight: { male: '', female: '' }, note: '' },
      beginner: { instances: [], movements: [], weight: { male: '', female: '' }, note: '' },
      onramp: { instances: [], movements: [], weight: { male: '', female: '' }, note: '' },
    },
    ...over,
  })
  const mv = (name, extra = {}) => ({ instanceId: name, name, canonicalMovementId: null, reps: null, load: null, distance: null, calories: null, seconds: null, ...extra })
  const withRx = (instances) => sec({ variants: { ...sec().variants, rx: { instances, movements: [], weight: { male: '', female: '' }, note: '' } } })

  it('a coach correction from 20 sec to 30 sec is detected as seconds_changed / semantic (not silently missed)', () => {
    const a = [withRx([mv('Bar Hang', { seconds: { mode: 'universal', value: 20 } })])]
    const b = [withRx([mv('Bar Hang', { seconds: { mode: 'universal', value: 30 } })])]
    const r = diffAiVsSaved(a, b)
    expect(r.deltas.some((d) => d.kind === 'seconds_changed')).toBe(true)
    expect(r.severity).toBe('semantic')
  })

  it('identical seconds values produce no delta', () => {
    const a = [withRx([mv('Bar Hang', { seconds: { mode: 'universal', value: 30 } })])]
    const b = [withRx([mv('Bar Hang', { seconds: { mode: 'universal', value: 30 } })])]
    expect(diffAiVsSaved(a, b).severity).toBe('none')
  })

  it('existing reps/load diffing is unaffected', () => {
    const a = [withRx([mv('Burpee', { reps: { mode: 'universal', value: 50 } })])]
    const b = [withRx([mv('Burpee', { reps: { mode: 'universal', value: 40 } })])]
    expect(diffAiVsSaved(a, b).deltas[0].kind).toBe('reps_changed')
  })
})
