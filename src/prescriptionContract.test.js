import { describe, it, expect } from 'vitest'
import {
  emptyPrescriptions,
  newInstanceId,
  newMovementInstance,
  resolveMovementCapability,
  validateMovementPrescriptions,
  validatePrescriptionsForPublish,
  resolveMovementInstance,
  resolveVariantForMember,
  renderInstanceLine,
  resolveSpec,
  buildLegacyArtifactsForVariant,
  buildPrescriptionSnapshot,
  variantHasStructuredPrescription,
  movementObjectsForV2,
  parsePastedMovementLine,
  parseWorkoutPaste,
  PRESCRIPTION_CONTRACT_VERSION,
} from './prescriptionContract.js'
import fixtures from './prescriptionFixtures.json'

describe('prescriptionContract — construction', () => {
  it('emptyPrescriptions is the v1 default shape', () => {
    expect(emptyPrescriptions()).toEqual({ version: 1, variants: {} })
    expect(PRESCRIPTION_CONTRACT_VERSION).toBe(1)
  })

  it('newInstanceId is unique, prefixed, url-safe', () => {
    const ids = new Set(Array.from({ length: 500 }, () => newInstanceId()))
    expect(ids.size).toBe(500)
    for (const id of ids) expect(id).toMatch(/^mi_[A-Za-z0-9_-]{21}$/)
  })

  it('newMovementInstance seeds the default metric control', () => {
    const load = newMovementInstance({ name: 'Snatch', capability: { allowed: ['reps', 'load'], default: 'load' } })
    expect(load.load).toEqual({ mode: 'sex_specific', male: null, female: null, unit: 'kg' })
    expect(load.reps).toEqual({ mode: 'universal', value: null })
    const bw = newMovementInstance({ name: 'Burpee', capability: { allowed: ['reps'], default: 'reps' } })
    expect(bw.reps).toEqual({ mode: 'universal', value: null })
    expect(bw.load).toBeUndefined()
    const unknown = newMovementInstance({ name: 'Weird', capability: { allowed: [], default: null, unknown: true } })
    expect(unknown.reps).toBeUndefined()
    expect(unknown.instanceId).toMatch(/^mi_/)
  })
})

describe('prescriptionContract — resolveMovementCapability', () => {
  it('resolves seeded rows', () => {
    expect(resolveMovementCapability({ allowed_prescription_metrics: ['reps', 'load'], default_prescription_metric: 'load' }))
      .toEqual({ allowed: ['reps', 'load'], default: 'load', unknown: false })
  })
  it('null / gym / never-seeded row -> unknown', () => {
    expect(resolveMovementCapability(null)).toEqual({ allowed: [], default: null, unknown: true })
    expect(resolveMovementCapability({ allowed_prescription_metrics: [] })).toEqual({ allowed: [], default: null, unknown: true })
  })
  it('drops a default that is not in allowed (defensive)', () => {
    expect(resolveMovementCapability({ allowed_prescription_metrics: ['reps'], default_prescription_metric: 'load' }).default).toBe(null)
  })
})

describe('prescriptionContract — fixture parity: resolveLine', () => {
  for (const f of fixtures.resolveLine) {
    it(f.name, () => {
      const r = resolveMovementInstance(f.instance, f.gender)
      expect(r.line).toBe(f.expected)
    })
  }

  it('mission reference workout, MALE', () => {
    const inst = [
      { instanceId: '1', name: 'Snatch', reps: { mode: 'universal', value: 20 }, load: { mode: 'sex_specific', male: 45, female: 30, unit: 'kg' } },
      { instanceId: '2', name: 'Wall Ball', reps: { mode: 'universal', value: 20 }, load: { mode: 'sex_specific', male: 9, female: 6, unit: 'kg' } },
      { instanceId: '3', name: 'DB Snatch', reps: { mode: 'universal', value: 20 }, load: { mode: 'sex_specific', male: 22.5, female: 15, unit: 'kg' } },
      { instanceId: '4', name: 'Row', calories: { mode: 'sex_specific', male: 15, female: 12 } },
    ]
    expect(inst.map((i) => resolveMovementInstance(i, 'male').line)).toEqual([
      '20 Snatch @ 45 kg', '20 Wall Ball @ 9 kg', '20 DB Snatch @ 22.5 kg', '15 Cal Row',
    ])
  })

  it('mission reference workout, FEMALE', () => {
    const inst = [
      { instanceId: '1', name: 'Snatch', reps: { mode: 'universal', value: 20 }, load: { mode: 'sex_specific', male: 45, female: 30, unit: 'kg' } },
      { instanceId: '2', name: 'Wall Ball', reps: { mode: 'universal', value: 20 }, load: { mode: 'sex_specific', male: 9, female: 6, unit: 'kg' } },
      { instanceId: '3', name: 'DB Snatch', reps: { mode: 'universal', value: 20 }, load: { mode: 'sex_specific', male: 22.5, female: 15, unit: 'kg' } },
      { instanceId: '4', name: 'Row', calories: { mode: 'sex_specific', male: 15, female: 12 } },
    ]
    expect(inst.map((i) => resolveMovementInstance(i, 'female').line)).toEqual([
      '20 Snatch @ 30 kg', '20 Wall Ball @ 6 kg', '20 DB Snatch @ 15 kg', '12 Cal Row',
    ])
  })

  it('unknown gender never silently uses male (TEST 1 / TEST 14)', () => {
    const i = { instanceId: '1', name: 'Snatch', reps: { mode: 'universal', value: 20 }, load: { mode: 'sex_specific', male: 45, female: 30, unit: 'kg' } }
    const r = resolveMovementInstance(i, null)
    expect(r.load.value).toBe(null)
    expect(r.load.bothValues).toEqual([45, 30])
    expect(r.line).toBe('20 Snatch @ 45/30 kg')
  })

  it('universal distance !== sex_specific with female missing (TEST 13)', () => {
    const universal = resolveSpec({ mode: 'universal', value: 500, unit: 'm' }, null)
    const missingF = resolveSpec({ mode: 'sex_specific', male: 500, female: null, unit: 'm' }, null)
    expect(universal.mode).toBe('universal')
    expect(missingF.mode).toBe('sex_specific')
    expect(universal).not.toEqual(missingF)
  })

  it('each of 3 same-name Power Clean instances keeps its own load (TEST 2 / instance identity)', () => {
    const doc = {
      version: 1,
      variants: { rx: { movements: [
        { instanceId: 'a', name: 'Power Clean', reps: { mode: 'universal', value: 10 }, load: { mode: 'sex_specific', male: 60, female: 40, unit: 'kg' } },
        { instanceId: 'b', name: 'Power Clean', reps: { mode: 'universal', value: 10 }, load: { mode: 'sex_specific', male: 70, female: 47.5, unit: 'kg' } },
        { instanceId: 'c', name: 'Power Clean', reps: { mode: 'universal', value: 10 }, load: { mode: 'sex_specific', male: 80, female: 55, unit: 'kg' } },
      ] } },
    }
    expect(resolveVariantForMember(doc, 'rx', 'female').map((r) => r.line)).toEqual([
      '10 Power Clean @ 40 kg', '10 Power Clean @ 47.5 kg', '10 Power Clean @ 55 kg',
    ])
  })

  it('lb is displayed, never converted (D-6)', () => {
    const r = resolveMovementInstance({ instanceId: 'a', name: 'Deadlift', reps: { mode: 'universal', value: 5 }, load: { mode: 'sex_specific', male: 225, female: 155, unit: 'lb' } }, 'male')
    expect(r.line).toBe('5 Deadlift @ 225 lb')
  })
})

describe('prescriptionContract — fixture parity: validateStructure', () => {
  for (const f of fixtures.validateStructure) {
    it(f.name, () => {
      expect(validateMovementPrescriptions(f.doc).valid).toBe(f.valid)
    })
  }
})

describe('prescriptionContract — fixture parity: validatePublish', () => {
  for (const f of fixtures.validatePublish) {
    it(f.name, () => {
      expect(validatePrescriptionsForPublish(f.doc).valid).toBe(f.valid)
    })
  }
  it('publish errors name the movement and the missing side', () => {
    const doc = { version: 1, variants: { rx: { movements: [{ instanceId: 'x', name: 'Snatch', load: { mode: 'sex_specific', male: 45, female: null, unit: 'kg' } }] } } }
    const r = validatePrescriptionsForPublish(doc)
    expect(r.errors[0]).toMatch(/Snatch.*women's load/)
  })
})

describe('prescriptionContract — fixture parity: parse', () => {
  for (const f of fixtures.parse) {
    it(f.name, () => {
      const parsed = parsePastedMovementLine(f.line)
      expect(parsed).toBeTruthy()
      for (const [k, v] of Object.entries(f.expect)) {
        expect(parsed.instance[k]).toEqual(v)
      }
    })
  }

  it('parseWorkoutPaste over a multi-line chipper', () => {
    const text = `3 RFT
20 Snatches @ 45/30kg
20 Wall Balls @ 9/6kg
20 DB Snatches @ 22.5/15kg
15/12 Cal Row`
    const { movements } = parseWorkoutPaste(text)
    // "3 RFT" is not a movement line but the parser is line-based; it produces a
    // low-confidence row. The 4 real movements parse with structure.
    const real = movements.filter((m) => m.confident)
    expect(real.map((m) => m.instance.load || m.instance.calories)).toEqual([
      { mode: 'sex_specific', male: 45, female: 30, unit: 'kg' },
      { mode: 'sex_specific', male: 9, female: 6, unit: 'kg' },
      { mode: 'sex_specific', male: 22.5, female: 15, unit: 'kg' },
      { mode: 'sex_specific', male: 15, female: 12 },
    ])
  })

  it('uncertain line keeps raw text and is not confident, no invented values', () => {
    const parsed = parsePastedMovementLine('some nonsense freestyle thing')
    expect(parsed.confident).toBe(false)
    expect(parsed.instance.load).toBeUndefined()
    expect(parsed.instance.distance).toBeUndefined()
    expect(parsed.raw).toBe('some nonsense freestyle thing')
  })

  it('never promotes a per-line load to a global / variant weight', () => {
    const parsed = parsePastedMovementLine('21 Power Clean @ 61/43kg')
    expect(parsed.instance.load).toEqual({ mode: 'sex_specific', male: 61, female: 43, unit: 'kg' })
    // structure lives ON the instance, nowhere else
  })
})

describe('prescriptionContract — legacy artifacts (regenerated, never truth)', () => {
  it('produces gender-neutral text lines + lossy first-load global mirror', () => {
    const movements = [
      { name: 'Snatch', reps: { mode: 'universal', value: 20 }, load: { mode: 'sex_specific', male: 45, female: 30, unit: 'kg' } },
      { name: 'Row', calories: { mode: 'sex_specific', male: 15, female: 12 } },
    ]
    const art = buildLegacyArtifactsForVariant(movements)
    expect(art.lines).toEqual(['20 Snatch @ 45/30 kg', '15/12 Cal Row'])
    expect(art.weightMale).toBe('45')
    expect(art.weightFemale).toBe('30')
  })

  it('no load-bearing movement -> null global weights', () => {
    const art = buildLegacyArtifactsForVariant([{ name: 'Burpee', reps: { mode: 'universal', value: 20 } }])
    expect(art).toEqual({ lines: ['20 Burpee'], weightMale: null, weightFemale: null })
  })
})

describe('prescriptionContract — snapshot (immutable, from frozen doc)', () => {
  const doc = {
    version: 1,
    variants: { rx: { movements: [
      { instanceId: 'a', name: 'Power Clean', canonicalMovementId: 'pc', reps: { mode: 'universal', value: 10 }, load: { mode: 'sex_specific', male: 60, female: 40, unit: 'kg' } },
      { instanceId: 'b', name: 'Row', calories: { mode: 'sex_specific', male: 15, female: 12 } },
    ] } },
  }

  it('resolves to the member and records displayLine + source', () => {
    const snap = buildPrescriptionSnapshot({ doc, variantKey: 'rx', gender: 'female', resolvedAt: 't0' })
    expect(snap.version).toBe(1)
    expect(snap.variant).toBe('rx')
    expect(snap.gender).toBe('female')
    expect(snap.source).toBe('structured')
    expect(snap.movements[0]).toMatchObject({ instanceId: 'a', name: 'Power Clean', canonicalMovementId: 'pc', displayLine: '10 Power Clean @ 40 kg', load: { value: 40, unit: 'kg' } })
    expect(snap.movements[1].displayLine).toBe('12 Cal Row')
  })

  it('P1 -> P2 race: a snapshot built from the FROZEN P1 doc is unaffected by a later P2 doc', () => {
    const p1 = JSON.parse(JSON.stringify(doc))
    const snap = buildPrescriptionSnapshot({ doc: p1, variantKey: 'rx', gender: 'male', resolvedAt: 't0' })
    // admin edits the live doc to P2 AFTER the freeze
    doc.variants.rx.movements[0].load = { mode: 'sex_specific', male: 100, female: 70, unit: 'kg' }
    expect(snap.movements[0].load.value).toBe(60) // still P1
    expect(snap.movements[0].displayLine).toBe('10 Power Clean @ 60 kg')
  })

  it('variantHasStructuredPrescription drives the fallback decision', () => {
    expect(variantHasStructuredPrescription(doc, 'rx')).toBe(true)
    expect(variantHasStructuredPrescription(doc, 'beginner')).toBe(false)
    expect(variantHasStructuredPrescription(emptyPrescriptions(), 'rx')).toBe(false)
  })
})

describe('prescriptionContract — render matches resolve (single engine, I-14)', () => {
  it('renderInstanceLine over pre-resolved specs === resolveMovementInstance.line', () => {
    const inst = { instanceId: 'a', name: 'Thruster', reps: { mode: 'text', text: '21-15-9' }, load: { mode: 'sex_specific', male: 43, female: 30, unit: 'kg' } }
    const resolved = resolveMovementInstance(inst, 'female')
    const manual = renderInstanceLine({
      name: 'Thruster',
      reps: resolveSpec(inst.reps, 'female'),
      load: resolveSpec(inst.load, 'female'),
      distance: null, calories: null,
    })
    expect(manual).toBe(resolved.line)
    expect(manual).toBe('21-15-9 Thruster @ 30 kg')
  })
})

describe('movementObjectsForV2 — P8 one-way mirror', () => {
  it('maps structured instances to the V2 movements shape + carries instanceId + prescription', () => {
    const objs = movementObjectsForV2([
      { instanceId: 'mi_a', name: 'Power Clean', canonicalMovementId: 'pc', reps: { mode: 'universal', value: 10 }, load: { mode: 'sex_specific', male: 60, female: 40, unit: 'kg' } },
      { instanceId: 'mi_b', name: 'Row', calories: { mode: 'sex_specific', male: 15, female: 12 } },
    ])
    expect(objs[0]).toMatchObject({ name: 'Power Clean', instanceId: 'mi_a', canonicalName: 'pc', reps: '10', weight: '60/40kg', equipment: [] })
    expect(objs[0].prescription.load).toEqual({ mode: 'sex_specific', male: 60, female: 40, unit: 'kg' })
    expect(objs[1]).toMatchObject({ name: 'Row', calories: '15/12', weight: null, distance: null })
  })
  it('empty -> []', () => {
    expect(movementObjectsForV2([])).toEqual([])
    expect(movementObjectsForV2(null)).toEqual([])
  })
})
