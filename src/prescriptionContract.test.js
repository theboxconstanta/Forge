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
  parsePrescriptionNumber,
  formatPrescriptionNumber,
  resolveNumericInput,
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
    expect(art.lines).toEqual(['20 Snatch', '15/12 Cal Row']) // P9 pre-guard: plain lines, load stays in movement_prescriptions
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

import { resolveVariantDisplayLines, variantKeyFromLevel } from './prescriptionContract.js'

describe('P9 — member resolution + snapshot from frozen doc', () => {
  const doc = {
    version: 1,
    variants: {
      rx: { movements: [
        { instanceId: 'mi_a', name: 'Snatch', canonicalMovementId: 'sn', reps: { mode: 'universal', value: 20 }, load: { mode: 'sex_specific', male: 45, female: 30, unit: 'kg' } },
        { instanceId: 'mi_b', name: 'Wall Ball', reps: { mode: 'universal', value: 20 }, load: { mode: 'sex_specific', male: 9, female: 6, unit: 'kg' } },
        { instanceId: 'mi_c', name: 'DB Snatch', reps: { mode: 'universal', value: 20 }, load: { mode: 'sex_specific', male: 22.5, female: 15, unit: 'kg' } },
        { instanceId: 'mi_d', name: 'Row', calories: { mode: 'sex_specific', male: 15, female: 12 } },
        { instanceId: 'mi_e', name: 'Run', distance: { mode: 'universal', value: 400, unit: 'm' } },
      ] },
    },
  }

  it('male / female / unknown display lines (never male fallback for unknown)', () => {
    expect(resolveVariantDisplayLines(doc, 'rx', 'male')).toEqual(['20 Snatch @ 45 kg', '20 Wall Ball @ 9 kg', '20 DB Snatch @ 22.5 kg', '15 Cal Row', '400 m Run'])
    expect(resolveVariantDisplayLines(doc, 'rx', 'female')).toEqual(['20 Snatch @ 30 kg', '20 Wall Ball @ 6 kg', '20 DB Snatch @ 15 kg', '12 Cal Row', '400 m Run'])
    expect(resolveVariantDisplayLines(doc, 'rx', null)).toEqual(['20 Snatch @ 45/30 kg', '20 Wall Ball @ 9/6 kg', '20 DB Snatch @ 22.5/15 kg', '15/12 Cal Row', '400 m Run'])
  })

  it('universal Row distance is the same for everyone; sex-specific Row calories differs', () => {
    expect(resolveVariantDisplayLines(doc, 'rx', 'male')[4]).toBe('400 m Run')
    expect(resolveVariantDisplayLines(doc, 'rx', 'female')[4]).toBe('400 m Run')
    expect(resolveVariantDisplayLines(doc, 'rx', 'male')[3]).toBe('15 Cal Row')
    expect(resolveVariantDisplayLines(doc, 'rx', 'female')[3]).toBe('12 Cal Row')
  })

  it('null for a variant with no structured prescription', () => {
    expect(resolveVariantDisplayLines(doc, 'beginner', 'male')).toBe(null)
    expect(resolveVariantDisplayLines(null, 'rx', 'male')).toBe(null)
  })

  it('variantKeyFromLevel normalises every display-side level spelling', () => {
    expect(variantKeyFromLevel('RX')).toBe('rx')
    expect(variantKeyFromLevel('OnRamp')).toBe('onramp')
    expect(variantKeyFromLevel('on_ramp')).toBe('onramp')
    expect(variantKeyFromLevel('Intermediate')).toBe('intermediate')
    expect(variantKeyFromLevel('nonsense')).toBe(null)
  })

  it('repeated same movement, different loads — female resolves 40 / 47.5 / 55, ids survive', () => {
    const laddDoc = { version: 1, variants: { rx: { movements: [
      { instanceId: 'p1', name: 'Power Clean', reps: { mode: 'universal', value: 10 }, load: { mode: 'sex_specific', male: 60, female: 40, unit: 'kg' } },
      { instanceId: 'p2', name: 'Power Clean', reps: { mode: 'universal', value: 10 }, load: { mode: 'sex_specific', male: 70, female: 47.5, unit: 'kg' } },
      { instanceId: 'p3', name: 'Power Clean', reps: { mode: 'universal', value: 10 }, load: { mode: 'sex_specific', male: 80, female: 55, unit: 'kg' } },
    ] } } }
    expect(resolveVariantDisplayLines(laddDoc, 'rx', 'female')).toEqual(['10 Power Clean @ 40 kg', '10 Power Clean @ 47.5 kg', '10 Power Clean @ 55 kg'])
    const snap = buildPrescriptionSnapshot({ doc: laddDoc, variantKey: 'rx', gender: 'female', resolvedAt: 't0' })
    expect(snap.movements.map((m) => m.instanceId)).toEqual(['p1', 'p2', 'p3'])
    expect(snap.movements.map((m) => m.load.value)).toEqual([40, 47.5, 55])
  })

  it('snapshot: RX variant identity + programmed-vs-resolved both recoverable, universal/sex-specific distinguishable', () => {
    const snap = buildPrescriptionSnapshot({ doc, variantKey: 'rx', gender: 'female', resolvedAt: 't0', source: 'structured' })
    expect(snap.variant).toBe('rx')
    expect(snap.gender).toBe('female')
    // "what applied to this athlete"
    expect(snap.movements[0].load.value).toBe(30)
    // "what the coach programmed" (both values)
    expect(snap.movements[0].load.bothValues).toEqual([45, 30])
    expect(snap.movements[0].load.mode).toBe('sex_specific')
    // universal distance did not become {male:400, female:null}
    expect(snap.movements[4].distance.mode).toBe('universal')
    expect(snap.movements[4].distance.value).toBe(400)
    // decimals survive
    expect(snap.movements[2].load.value).toBe(15)
    expect(snap.movements[2].displayLine).toBe('20 DB Snatch @ 15 kg')
  })

  it('snapshot P1->P2 race: built from a frozen doc, unaffected by a later mutation', () => {
    const frozen = JSON.parse(JSON.stringify(doc))
    const snap = buildPrescriptionSnapshot({ doc: frozen, variantKey: 'rx', gender: 'female', resolvedAt: 't0' })
    doc.variants.rx.movements[0].load = { mode: 'sex_specific', male: 60, female: 45, unit: 'kg' } // coach edit
    expect(snap.movements[0].load.value).toBe(30) // still P1
    expect(snap.movements[0].displayLine).toBe('20 Snatch @ 30 kg')
    // restore for other tests
    doc.variants.rx.movements[0].load = { mode: 'sex_specific', male: 45, female: 30, unit: 'kg' }
  })
})

import {
  snapshotPrescriptionDoc, structuredVariantLoadStandard, structuredVariantHasLoad, MULTI_LOAD_STANDARD,
} from './prescriptionContract.js'

describe('P9.1 — deep snapshot, load standard, snapshot purity & retry', () => {
  const mk = () => ({ version: 1, variants: { rx: { movements: [
    { instanceId: 'a', name: 'Snatch', reps: { mode: 'universal', value: 20 }, load: { mode: 'sex_specific', male: 45, female: 30, unit: 'kg' } },
    { instanceId: 'b', name: 'Wall Ball', reps: { mode: 'universal', value: 20 }, load: { mode: 'sex_specific', male: 9, female: 6, unit: 'kg' } },
    { instanceId: 'c', name: 'Row', calories: { mode: 'sex_specific', male: 15, female: 12 } },
    { instanceId: 'd', name: 'Run', distance: { mode: 'universal', value: 500, unit: 'm' } },
  ] } } })

  it('snapshotPrescriptionDoc is a structurally independent deep clone', () => {
    const src = mk()
    const clone = snapshotPrescriptionDoc(src)
    expect(clone).toEqual(src)
    expect(clone).not.toBe(src)
    src.variants.rx.movements[0].load.female = 999
    src.variants.rx.movements.push({ instanceId: 'x', name: 'Y' })
    expect(clone.variants.rx.movements[0].load.female).toBe(30)
    expect(clone.variants.rx.movements).toHaveLength(4)
    expect(snapshotPrescriptionDoc(null)).toBe(null)
  })

  it('structuredVariantLoadStandard: null (bodyweight) | multi (>1 distinct) | number (one)', () => {
    // multi (45/9 for male)
    expect(structuredVariantLoadStandard(mk(), 'rx', 'male')).toBe(MULTI_LOAD_STANDARD)
    expect(structuredVariantLoadStandard(mk(), 'rx', 'female')).toBe(MULTI_LOAD_STANDARD)
    // one load
    const one = { version: 1, variants: { rx: { movements: [
      { instanceId: 'a', name: 'Thruster', load: { mode: 'sex_specific', male: 43, female: 30, unit: 'kg' } },
      { instanceId: 'b', name: 'Pull-up', reps: { mode: 'universal', value: 10 } },
    ] } } }
    expect(structuredVariantLoadStandard(one, 'rx', 'male')).toBe(43)
    expect(structuredVariantLoadStandard(one, 'rx', 'female')).toBe(30)
    // unknown gender -> no single resolved standard (member sees "43/30");
    // RX classification stays neutral, consistent with weightKeyForVariant(null)
    expect(structuredVariantLoadStandard(one, 'rx', null)).toBe(null)
    // bodyweight
    const bw = { version: 1, variants: { rx: { movements: [{ instanceId: 'a', name: 'Burpee', reps: { mode: 'universal', value: 20 } }] } } }
    expect(structuredVariantLoadStandard(bw, 'rx', 'male')).toBe(null)
    // repeated same load -> single
    const same = { version: 1, variants: { rx: { movements: [
      { instanceId: 'a', name: 'Clean', load: { mode: 'sex_specific', male: 60, female: 40, unit: 'kg' } },
      { instanceId: 'b', name: 'Clean', load: { mode: 'sex_specific', male: 60, female: 40, unit: 'kg' } },
    ] } } }
    expect(structuredVariantLoadStandard(same, 'rx', 'female')).toBe(40)
  })

  it('structuredVariantHasLoad', () => {
    expect(structuredVariantHasLoad(mk(), 'rx', 'male')).toBe(true)
    expect(structuredVariantHasLoad({ version: 1, variants: { rx: { movements: [{ instanceId: 'a', name: 'Burpee', reps: { mode: 'universal', value: 20 } }] } } }, 'rx', 'male')).toBe(false)
  })

  it('buildPrescriptionSnapshot does NOT mutate the frozen doc', () => {
    const frozen = mk()
    const before = JSON.stringify(frozen)
    buildPrescriptionSnapshot({ doc: frozen, variantKey: 'rx', gender: 'female', resolvedAt: 't0' })
    expect(JSON.stringify(frozen)).toBe(before)
  })

  it('retry idempotency: same frozen inputs -> deep-equal snapshot', () => {
    const frozen = mk()
    const s1 = buildPrescriptionSnapshot({ doc: frozen, variantKey: 'rx', gender: 'female', resolvedAt: 't0', source: 'structured' })
    const s2 = buildPrescriptionSnapshot({ doc: frozen, variantKey: 'rx', gender: 'female', resolvedAt: 't0', source: 'structured' })
    expect(s2).toEqual(s1)
  })

  it('snapshot is not load-centric: distance + calories carry mode + value + bothValues', () => {
    const snap = buildPrescriptionSnapshot({ doc: mk(), variantKey: 'rx', gender: 'female', resolvedAt: 't0' })
    // Row calories 15/12 -> female resolved 12, programmed both preserved
    const row = snap.movements.find((m) => m.name === 'Row')
    expect(row.calories).toEqual({ value: 12, mode: 'sex_specific', bothValues: [15, 12] })
    // Run 500m universal -> not {male:500, female:null}
    const run = snap.movements.find((m) => m.name === 'Run')
    expect(run.distance).toEqual({ value: 500, unit: 'm', mode: 'universal', bothValues: null })
  })
})

// ============================================================================
// P9.2 — generic decimal numeric input (comma OR dot), canonical stays numeric
// ============================================================================

describe('P9.2 — parsePrescriptionNumber (generic, no whitelist)', () => {
  // table-driven: prove the parser is GENERIC, not built around gym weights
  const VALID = [
    ['45', 45], ['0', 0], ['0,5', 0.5], ['0.5', 0.5],
    ['7,5', 7.5], ['7.5', 7.5], ['12,5', 12.5], ['17,5', 17.5], ['22,5', 22.5], ['22.5', 22.5],
    ['27,5', 27.5], ['32,5', 32.5], ['42,5', 42.5], ['47,5', 47.5], ['52,5', 52.5], ['62,5', 62.5],
    ['100,5', 100.5], ['22,25', 22.25], ['22.25', 22.25], ['17,75', 17.75], ['17.75', 17.75],
    ['7,125', 7.125], ['7.125', 7.125], ['100,125', 100.125],
    ['1,25', 1.25], ['2,75', 2.75], ['11,25', 11.25], ['37,25', 37.25], ['62,75', 62.75],
  ]
  for (const [raw, expected] of VALID) {
    it(`"${raw}" -> ${expected}`, () => {
      expect(parsePrescriptionNumber(raw)).toEqual({ value: expected, ok: true })
    })
  }

  it('number passthrough (finite) / rejects non-finite', () => {
    expect(parsePrescriptionNumber(45)).toEqual({ value: 45, ok: true })
    expect(parsePrescriptionNumber(22.5)).toEqual({ value: 22.5, ok: true })
    expect(parsePrescriptionNumber(NaN)).toEqual({ value: null, ok: false })
    expect(parsePrescriptionNumber(Infinity)).toEqual({ value: null, ok: false })
  })

  it('empty / null / whitespace -> no value (never 0)', () => {
    expect(parsePrescriptionNumber('')).toEqual({ value: null, ok: true })
    expect(parsePrescriptionNumber('   ')).toEqual({ value: null, ok: true })
    expect(parsePrescriptionNumber(null)).toEqual({ value: null, ok: true })
    expect(parsePrescriptionNumber(undefined)).toEqual({ value: null, ok: true })
  })

  const INVALID = ['22,5,5', '22..5', '22,,5', '2.2.5', '12abc', 'abc12', '22abc', '--5', '5-', ',,', '..', 'NaN', 'Infinity', '-5', '.5', '5.', ' 5 5 ', '1e3', '1 000']
  for (const raw of INVALID) {
    it(`rejects "${raw}" (not silently coerced)`, () => {
      expect(parsePrescriptionNumber(raw)).toEqual({ value: null, ok: false })
    })
  }

  it('formatPrescriptionNumber is the canonical dot string', () => {
    expect(formatPrescriptionNumber(22.5)).toBe('22.5')
    expect(formatPrescriptionNumber(45)).toBe('45')
    expect(formatPrescriptionNumber(null)).toBe('')
    expect(formatPrescriptionNumber(undefined)).toBe('')
  })
})

describe('P9.2 — resolveNumericInput (draft->commit lifecycle)', () => {
  it('a fully valid value commits (comma or dot)', () => {
    expect(resolveNumericInput('22,5', { previous: null })).toEqual({ value: 22.5, commit: true })
    expect(resolveNumericInput('22.5', { previous: null })).toEqual({ value: 22.5, commit: true })
  })

  it('empty commits null (not zero, not previous)', () => {
    expect(resolveNumericInput('', { previous: 45 })).toEqual({ value: null, commit: true })
  })

  it('a partial "22," / "22." is HELD while typing (no commit, canonical untouched)', () => {
    expect(resolveNumericInput('22,', { previous: 22, final: false })).toEqual({ value: 22, commit: false })
    expect(resolveNumericInput('22.', { previous: null, final: false })).toEqual({ value: null, commit: false })
  })

  it('typing "2" -> "22" -> "22," -> "22,5" ends at 22.5 without losing the comma', () => {
    let canonical = null
    for (const [raw, expectCommit] of [['2', true], ['22', true], ['22,', false], ['22,5', true]]) {
      const r = resolveNumericInput(raw, { previous: canonical, final: false })
      expect(r.commit).toBe(expectCommit)
      if (r.commit) canonical = r.value
    }
    expect(canonical).toBe(22.5)
  })

  it('on blur (final): invalid reverts to previous, never a silent 0', () => {
    expect(resolveNumericInput('22abc', { previous: 45, final: true })).toEqual({ value: 45, commit: true })
    expect(resolveNumericInput('22,,5', { previous: null, final: true })).toEqual({ value: null, commit: true })
    expect(resolveNumericInput('22,', { previous: 22, final: true })).toEqual({ value: 22, commit: true })
  })

  it('integer mode (reps / calories): rejects a decimal, keeps integers', () => {
    expect(resolveNumericInput('20', { integer: true, previous: null })).toEqual({ value: 20, commit: true })
    expect(resolveNumericInput('20,5', { integer: true, previous: 20, final: false })).toEqual({ value: 20, commit: false })
    expect(resolveNumericInput('20.5', { integer: true, previous: 20, final: true })).toEqual({ value: 20, commit: true })
  })

  it('decimal mode (load / distance): accepts arbitrary precision', () => {
    expect(resolveNumericInput('22,25', { previous: null })).toEqual({ value: 22.25, commit: true })
    expect(resolveNumericInput('1,5', { previous: null })).toEqual({ value: 1.5, commit: true })
  })
})

describe('P9.2 — Quick Paste comma/dot decimal equivalence', () => {
  it('"@ 22,5/15kg" and "@ 22.5/15kg" produce the identical numeric load', () => {
    const comma = parsePastedMovementLine('20 Dumbbell Snatches @ 22,5/15kg')
    const dot = parsePastedMovementLine('20 Dumbbell Snatches @ 22.5/15kg')
    expect(comma.instance.load).toEqual({ mode: 'sex_specific', male: 22.5, female: 15, unit: 'kg' })
    expect(dot.instance.load).toEqual(comma.instance.load)
  })

  it('arbitrary precision "@ 22,25/17,75kg"', () => {
    const parsed = parsePastedMovementLine('20 Dumbbell Snatches @ 22,25/17,75kg')
    expect(parsed.instance.load).toEqual({ mode: 'sex_specific', male: 22.25, female: 17.75, unit: 'kg' })
  })

  it('universal comma load "@ 22,5kg"', () => {
    const parsed = parsePastedMovementLine('20 Thrusters @ 22,5kg')
    expect(parsed.instance.load).toEqual({ mode: 'universal', value: 22.5, unit: 'kg' })
  })

  it('comma distance "1,5 km Run"', () => {
    const parsed = parsePastedMovementLine('1,5 km Run')
    expect(parsed.instance.distance).toEqual({ mode: 'universal', value: 1.5, unit: 'km' })
  })

  it('a doubled-separator token is NOT coerced — the line stays unparsed for that metric', () => {
    const parsed = parsePastedMovementLine('20 Thrusters @ 22,,5kg')
    // "22,,5kg" doesn't match the load grammar -> no load extracted, not "22"
    expect(parsed?.instance.load).toBeUndefined()
  })
})

describe('P9.2 — decimals survive the structured round-trip', () => {
  const doc = {
    version: 1,
    variants: {
      rx: { movements: [
        { instanceId: 'mi_a', name: 'DB Snatch', reps: { mode: 'universal', value: 20 }, load: { mode: 'sex_specific', male: 22.5, female: 15, unit: 'kg' } },
        { instanceId: 'mi_b', name: 'Row', distance: { mode: 'universal', value: 1.5, unit: 'km' } },
      ] },
    },
  }

  it('member display keeps the decimal (male / female / unknown), no rounding', () => {
    expect(resolveVariantForMember(doc, 'rx', 'male').map((r) => r.line))
      .toEqual(['20 DB Snatch @ 22.5 kg', '1.5 km Row'])
    expect(resolveVariantForMember(doc, 'rx', 'female').map((r) => r.line))
      .toEqual(['20 DB Snatch @ 15 kg', '1.5 km Row'])
    expect(resolveVariantForMember(doc, 'rx', null).map((r) => r.line))
      .toEqual(['20 DB Snatch @ 22.5/15 kg', '1.5 km Row'])
  })

  it('prescription snapshot keeps decimals as numbers (never localized strings)', () => {
    const snap = buildPrescriptionSnapshot({ doc, variantKey: 'rx', gender: 'female', resolvedAt: 't0' })
    const dbs = snap.movements.find((m) => m.name === 'DB Snatch')
    expect(dbs.load).toEqual({ value: 15, unit: 'kg', mode: 'sex_specific', bothValues: [22.5, 15] })
    expect(typeof dbs.load.value).toBe('number')
    expect(typeof dbs.load.bothValues[0]).toBe('number')
  })

  it('V2 mirror carries the numeric decimal in prescription (not "22,5")', () => {
    const [m] = movementObjectsForV2(doc.variants.rx.movements)
    expect(m.prescription.load).toEqual({ mode: 'sex_specific', male: 22.5, female: 15, unit: 'kg' })
  })

  it('legacy weight mirror renders the decimal with a dot', () => {
    const art = buildLegacyArtifactsForVariant(doc.variants.rx.movements)
    expect(art.weightMale).toBe('22.5')
    expect(art.weightFemale).toBe('15')
  })
})
