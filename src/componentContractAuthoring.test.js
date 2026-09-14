// FORGE WORKOUT COMPOSER - PHASE 3 domain-layer tests (PWA authoring UI
// support). Pure functions only - componentAuthoring.test.jsx covers the
// React ComposerEditor/ComponentCard/ComponentPicker rendering/interaction;
// wodSectionsComposer.test.js covers hydration/persistence round-trips.

import { describe, it, expect } from 'vitest'
import {
  addComponentToList, removeComponentFromList, moveComponent,
  setScoreOwner, candidateScorersFor, describeValidationError, validateComposerForSave,
  componentHeaderLabel, previewBlocksFromComponents, deriveLegacyFieldsFromComponents,
  hasComposerContent, isSimpleComposerGraph, applyGeneratedInstancesToComponent,
  allInstancesFromComponents, createEmptyComposerVariants, defaultConfigForFormat,
  createComponent, getScoreEnvelope, validateComponents, COMPOSER_FORMAT_GROUPS,
} from './componentContract'
import { newMovementInstance } from './prescriptionContract'

function inst(name) { return newMovementInstance({ name }) }

// --- 1. Component Picker catalog (ticket §7/§8) ----------------------------

describe('COMPOSER_FORMAT_GROUPS - curated picker catalog', () => {
  it('includes Buy-In/Cash-Out/For Time/RFT/AMRAP/EMOM/Rest, excludes Intervals', () => {
    const options = COMPOSER_FORMAT_GROUPS.flatMap(g => g.options)
    const formats = options.map(o => `${o.format}:${o.role || ''}`)
    expect(formats).toContain('Once:buy-in')
    expect(formats).toContain('Once:cash-out')
    expect(formats).toContain('For Time:')
    expect(formats).toContain('RFT:')
    expect(formats).toContain('AMRAP:')
    expect(formats).toContain('EMOM:')
    expect(formats).toContain('Rest:')
    expect(options.some(o => o.format === 'Intervals')).toBe(false)
  })
})

// --- 2. Add Component (ticket §9) ------------------------------------------

describe('addComponentToList', () => {
  it('appends a fresh, stably-identified AMRAP component with sensible defaults', () => {
    const next = addComponentToList([], 'AMRAP')
    expect(next).toHaveLength(1)
    expect(next[0].format).toBe('AMRAP')
    expect(next[0].producesScore).toBe(true)
    expect(next[0].config).toEqual(defaultConfigForFormat('AMRAP'))
    expect(next[0].order).toBe(0)
    expect(next[0].id).toMatch(/^cmp_/)
  })

  it('appends a Buy-In with producesScore:false and role set', () => {
    const next = addComponentToList([], 'Once', 'buy-in')
    expect(next[0].role).toBe('buy-in')
    expect(next[0].producesScore).toBe(false)
    expect(next[0].scoreOwnerId).toBe(null)
  })

  it('appending never mutates the input array', () => {
    const original = []
    addComponentToList(original, 'RFT')
    expect(original).toEqual([])
  })

  it('never produces a temporary/index-derived id - two consecutive adds get distinct ids', () => {
    const first = addComponentToList([], 'AMRAP')
    const second = addComponentToList(first, 'RFT')
    expect(second[0].id).not.toBe(second[1].id)
    expect(second[0].id).toBe(first[0].id) // the first component's identity survives the second add
  })
})

// --- 3. Remove Component + dangling ownership (ticket §22) -----------------

describe('removeComponentFromList', () => {
  it('removes the target and clears scoreOwnerId on anything that pointed to it', () => {
    const rft = createComponent({ id: 'rft', format: 'RFT', producesScore: true })
    const buyIn = createComponent({ id: 'buyin', format: 'Once', role: 'buy-in', producesScore: false, scoreOwnerId: 'rft' })
    const cashOut = createComponent({ id: 'cashout', format: 'Once', role: 'cash-out', producesScore: false, scoreOwnerId: 'rft' })
    const { components, removed, clearedOwnershipFor } = removeComponentFromList([buyIn, rft, cashOut], 'rft')
    expect(components.map(c => c.id)).toEqual(['buyin', 'cashout'])
    expect(components.every(c => c.scoreOwnerId === null)).toBe(true)
    expect(removed.id).toBe('rft')
    expect(clearedOwnershipFor.sort()).toEqual(['buyin', 'cashout'])
    expect(validateComponents(components).valid).toBe(true) // no dangling owner left behind
  })

  it('removing a component nobody depends on reports no cleared ownership', () => {
    const amrap = createComponent({ id: 'amrap', format: 'AMRAP', producesScore: true })
    const rest = createComponent({ id: 'rest', format: 'Rest', producesScore: false })
    const { components, clearedOwnershipFor } = removeComponentFromList([amrap, rest], 'rest')
    expect(components.map(c => c.id)).toEqual(['amrap'])
    expect(clearedOwnershipFor).toEqual([])
  })
})

// --- 4. Reorder Components + stable ids + invalid-envelope block (ticket §11/§23/§48/§49) --

describe('moveComponent', () => {
  it('moves a component and renumbers order, preserving ids/instances/config', () => {
    const amrap = createComponent({ id: 'amrap', format: 'AMRAP', producesScore: true, instances: [inst('Burpees')] })
    const rest = createComponent({ id: 'rest', format: 'Rest', producesScore: false })
    const rft = createComponent({ id: 'rft', format: 'RFT', producesScore: true })
    const list = [amrap, rest, rft].map((c, i) => ({ ...c, order: i }))
    // move RFT up twice (via two single-step calls, matching the real ↑ button)
    const step1 = moveComponent(list, 'rft', -1)
    expect(step1.ok).toBe(true)
    const step2 = moveComponent(step1.components, 'rft', -1)
    expect(step2.ok).toBe(true)
    expect(step2.components.map(c => c.id)).toEqual(['rft', 'amrap', 'rest'])
    expect(step2.components.map(c => c.order)).toEqual([0, 1, 2])
    expect(step2.components.find(c => c.id === 'amrap').instances[0].name).toBe('Burpees')
  })

  it('a no-op move at either end succeeds without changing anything', () => {
    const list = [createComponent({ id: 'a', format: 'AMRAP' }), createComponent({ id: 'b', format: 'Rest' })].map((c, i) => ({ ...c, order: i }))
    const up = moveComponent(list, 'a', -1)
    expect(up.ok).toBe(true)
    expect(up.components).toBe(list)
    const down = moveComponent(list, 'b', 1)
    expect(down.ok).toBe(true)
  })

  it('rejects a reorder that would break an owned envelope\'s contiguity, leaving the array unchanged', () => {
    const rft = createComponent({ id: 'rft', format: 'RFT', producesScore: true })
    const buyIn = createComponent({ id: 'buyin', format: 'Once', role: 'buy-in', producesScore: false, scoreOwnerId: 'rft' })
    const cashOut = createComponent({ id: 'cashout', format: 'Once', role: 'cash-out', producesScore: false, scoreOwnerId: 'rft' })
    const amrap = createComponent({ id: 'amrap', format: 'AMRAP', producesScore: true })
    const clean = [buyIn, rft, cashOut, amrap].map((c, i) => ({ ...c, order: i }))
    const result = moveComponent(clean, 'amrap', -1) // amrap swaps with cashOut -> buyIn, rft, amrap, cashOut: broken
    expect(result.ok).toBe(false)
    expect(result.error).toBe('BROKEN_ENVELOPE_CONTIGUITY')
    expect(result.components).toBe(clean) // unchanged, never partially applied
  })
})

// --- 5. Score ownership authoring (ticket §10/§20/§21) ----------------------

describe('setScoreOwner', () => {
  it('establishes ownership on a Buy-In toward a valid scorer', () => {
    const rft = createComponent({ id: 'rft', format: 'RFT', producesScore: true })
    const buyIn = createComponent({ id: 'buyin', format: 'Once', role: 'buy-in', producesScore: false })
    const result = setScoreOwner([buyIn, rft], 'buyin', 'rft')
    expect(result.ok).toBe(true)
    expect(result.components.find(c => c.id === 'buyin').scoreOwnerId).toBe('rft')
  })

  it('clears ownership (detach) when scorerId is null', () => {
    const rft = createComponent({ id: 'rft', format: 'RFT', producesScore: true })
    const buyIn = createComponent({ id: 'buyin', format: 'Once', role: 'buy-in', producesScore: false, scoreOwnerId: 'rft' })
    const result = setScoreOwner([buyIn, rft], 'buyin', null)
    expect(result.ok).toBe(true)
    expect(result.components.find(c => c.id === 'buyin').scoreOwnerId).toBe(null)
  })

  it('rejects Rest ever becoming owned (ticket §12/§21)', () => {
    const rft = createComponent({ id: 'rft', format: 'RFT', producesScore: true })
    const rest = createComponent({ id: 'rest', format: 'Rest', producesScore: false })
    const result = setScoreOwner([rest, rft], 'rest', 'rft')
    expect(result.ok).toBe(false)
    expect(result.error).toBe('REST_CANNOT_BE_OWNED')
    expect(rest.scoreOwnerId).toBe(null) // original untouched
  })

  it('rejects attaching to a non-scoring component', () => {
    const rest = createComponent({ id: 'rest', format: 'Rest', producesScore: false })
    const buyIn = createComponent({ id: 'buyin', format: 'Once', role: 'buy-in', producesScore: false })
    const result = setScoreOwner([buyIn, rest], 'buyin', 'rest')
    expect(result.ok).toBe(false)
  })
})

describe('candidateScorersFor', () => {
  it('lists every OTHER producesScore:true component, never the bookend itself', () => {
    const amrap = createComponent({ id: 'amrap', format: 'AMRAP', producesScore: true })
    const rft = createComponent({ id: 'rft', format: 'RFT', producesScore: true })
    const buyIn = createComponent({ id: 'buyin', format: 'Once', role: 'buy-in', producesScore: false })
    const candidates = candidateScorersFor([amrap, rft, buyIn], 'buyin')
    expect(candidates.map(c => c.id).sort()).toEqual(['amrap', 'rft'])
  })
})

// --- 6. Human-readable validation copy (ticket §35) - never an internal code/id --

describe('describeValidationError', () => {
  it('translates every domain error code to plain text with no code/id leakage', () => {
    const codes = [
      'DUPLICATE_ID', 'UNKNOWN_FORMAT', 'REST_CANNOT_SCORE', 'SCORER_CANNOT_HAVE_OWNER',
      'SELF_OWNERSHIP', 'REST_CANNOT_BE_OWNED', 'DANGLING_OWNER', 'OWNER_CANNOT_SCORE',
      'OWNERSHIP_CYCLE', 'BROKEN_ENVELOPE_CONTIGUITY', 'SOMETHING_UNKNOWN',
    ]
    for (const code of codes) {
      const msg = describeValidationError({ code, componentId: 'cmp_should_never_appear' })
      expect(typeof msg).toBe('string')
      expect(msg.length).toBeGreaterThan(0)
      expect(msg).not.toContain('cmp_should_never_appear')
      expect(msg).not.toBe(code)
    }
  })

  it('accepts a bare code string too', () => {
    expect(describeValidationError('REST_CANNOT_SCORE')).toMatch(/rest/i)
  })
})

// --- 7. Save gate (ticket §35/§36) ------------------------------------------

describe('validateComposerForSave', () => {
  it('blocks a movement-requiring component with zero movements', () => {
    const amrap = createComponent({ id: 'amrap', format: 'AMRAP', producesScore: true, instances: [] })
    const { valid, issues } = validateComposerForSave([amrap])
    expect(valid).toBe(false)
    expect(issues.length).toBeGreaterThan(0)
  })

  it('Rest is exempt from the "needs a movement" rule', () => {
    const rest = createComponent({ id: 'rest', format: 'Rest', producesScore: false, instances: [] })
    const { valid } = validateComposerForSave([rest])
    expect(valid).toBe(true)
  })

  it('a fully valid graph passes with no issues', () => {
    const amrap = createComponent({ id: 'amrap', format: 'AMRAP', producesScore: true, instances: [inst('Burpees')] })
    const { valid, issues } = validateComposerForSave([amrap])
    expect(valid).toBe(true)
    expect(issues).toEqual([])
  })

  it('surfaces a domain validation error as coach-facing copy', () => {
    const rft = createComponent({ id: 'rft', format: 'RFT', producesScore: true, instances: [inst('Wall Balls')] })
    const rest = createComponent({ id: 'rest', format: 'Rest', producesScore: false, scoreOwnerId: 'rft' })
    const { valid, issues } = validateComposerForSave([rft, rest])
    expect(valid).toBe(false)
    expect(issues.some(i => /rest/i.test(i.message))).toBe(true)
  })

  it('each issue carries a stable componentId + code, never relying on message text as identity (ticket §Phase 3.1.1)', () => {
    const amrapA = createComponent({ id: 'a', format: 'AMRAP', producesScore: true, instances: [] })
    const amrapB = createComponent({ id: 'b', format: 'AMRAP', producesScore: true, instances: [] })
    const { issues } = validateComposerForSave([amrapA, amrapB])
    expect(issues).toHaveLength(2)
    expect(issues.map(i => i.componentId).sort()).toEqual(['a', 'b'])
    expect(issues.every(i => i.code === 'EMPTY_MOVEMENTS')).toBe(true)
    // byte-identical display text, but each issue is independently identified
    expect(issues[0].message).toBe(issues[1].message)
    expect(issues[0].componentId).not.toBe(issues[1].componentId)
  })
})

// --- 8. Preview projection (ticket §21/§28/§29) -----------------------------

describe('componentHeaderLabel', () => {
  it('labels Buy-In/Cash-Out by role, never by the shared "Once" format', () => {
    expect(componentHeaderLabel(createComponent({ format: 'Once', role: 'buy-in' }))).toBe('BUY-IN')
    expect(componentHeaderLabel(createComponent({ format: 'Once', role: 'cash-out' }))).toBe('CASH-OUT')
  })
  it('labels AMRAP/RFT/Rest/EMOM with their config-derived numbers (ticket §21 - full M:SS with a middle dot)', () => {
    expect(componentHeaderLabel(createComponent({ format: 'AMRAP', config: { durationSec: 360 } }))).toBe('AMRAP · 6:00')
    expect(componentHeaderLabel(createComponent({ format: 'RFT', config: { rounds: 5 } }))).toBe('5 ROUNDS FOR TIME')
    expect(componentHeaderLabel(createComponent({ format: 'Rest', config: { durationSec: 120 } }))).toBe('REST · 2:00')
    expect(componentHeaderLabel(createComponent({ format: 'EMOM', config: { totalRounds: 8 } }))).toBe('EMOM 8')
    expect(componentHeaderLabel(createComponent({ format: 'For Time' }))).toBe('FOR TIME')
  })
})

describe('previewBlocksFromComponents', () => {
  it('one block per component, in canonical order, no envelope/scorer jargon', () => {
    const rft = createComponent({ id: 'rft', format: 'RFT', role: 'main', producesScore: true, config: { rounds: 5 }, instances: [inst('Toes-to-Bar')] })
    const buyIn = createComponent({ id: 'buyin', format: 'Once', role: 'buy-in', producesScore: false, scoreOwnerId: 'rft', instances: [inst('Row')] })
    const cashOut = createComponent({ id: 'cashout', format: 'Once', role: 'cash-out', producesScore: false, scoreOwnerId: 'rft', instances: [inst('Run')] })
    const components = [buyIn, rft, cashOut].map((c, i) => ({ ...c, order: i }))
    const blocks = previewBlocksFromComponents(components)
    expect(blocks.map(b => b.header)).toEqual(['BUY-IN', '5 ROUNDS FOR TIME', 'CASH-OUT'])
    expect(blocks.every(b => !/scorer|envelope|component/i.test(b.header)))
    expect(blocks[0].movementLines[0]).toMatch(/Row/)
  })

  it('a single-component workout previews as just that block - no numbering/labeling as "the only" one', () => {
    const amrap = createComponent({ format: 'AMRAP', config: { durationSec: 600 }, instances: [inst('Pull-Ups'), inst('Burpees')] })
    const blocks = previewBlocksFromComponents([amrap])
    expect(blocks).toHaveLength(1)
    expect(blocks[0].header).toBe('AMRAP · 10:00')
    expect(blocks[0].movementLines).toHaveLength(2)
  })

  it('a multi-score workout previews every scorer and Rest, in order', () => {
    const amrap = createComponent({ id: 'a', format: 'AMRAP', producesScore: true, config: { durationSec: 480 } })
    const rest = createComponent({ id: 'r', format: 'Rest', producesScore: false, config: { durationSec: 120 } })
    const rft = createComponent({ id: 'f', format: 'RFT', producesScore: true, config: { rounds: 5 } })
    const components = [amrap, rest, rft].map((c, i) => ({ ...c, order: i }))
    const blocks = previewBlocksFromComponents(components)
    expect(blocks.map(b => b.header)).toEqual(['AMRAP · 8:00', 'REST · 2:00', '5 ROUNDS FOR TIME'])
  })
})

// --- 9. Legacy write shim (ticket §32/§33/§34) ------------------------------

describe('deriveLegacyFieldsFromComponents', () => {
  it('single scorer, no envelope -> byte-identical legacy single-score equivalence', () => {
    const amrap = createComponent({ format: 'AMRAP', producesScore: true, config: { durationSec: 600 }, instances: [inst('Burpees')] })
    const out = deriveLegacyFieldsFromComponents([amrap])
    expect(out).toEqual({ type: 'AMRAP', formatConfig: { durationSec: 600 }, instances: [amrap.instances[0]] })
  })

  it('single AMRAP scorer with an owned envelope -> legacy "AMRAP with Buy-In" (full production round-trip)', () => {
    const amrap = createComponent({ id: 'amrap', format: 'AMRAP', producesScore: true, config: { durationSec: 360 }, instances: [inst('Wall Balls')] })
    const buyIn = createComponent({ id: 'buyin', format: 'Once', role: 'buy-in', producesScore: false, scoreOwnerId: 'amrap', instances: [inst('Row')] })
    const components = [buyIn, amrap].map((c, i) => ({ ...c, order: i }))
    const out = deriveLegacyFieldsFromComponents(components)
    expect(out.type).toBe('AMRAP with Buy-In')
    expect(out.formatConfig.totalDurationSec).toBe(360)
    expect(out.formatConfig.buyIn).toEqual(['Row'])
  })

  it('single For Time scorer with an owned envelope -> legacy "Buy-In/Cash-Out"', () => {
    const ft = createComponent({ id: 'ft', format: 'For Time', producesScore: true, config: { timeCapSec: 900 }, instances: [inst('Thrusters')] })
    const cashOut = createComponent({ id: 'cashout', format: 'Once', role: 'cash-out', producesScore: false, scoreOwnerId: 'ft', instances: [inst('Run')] })
    const components = [ft, cashOut].map((c, i) => ({ ...c, order: i }))
    const out = deriveLegacyFieldsFromComponents(components)
    expect(out.type).toBe('Buy-In/Cash-Out')
    expect(out.formatConfig.mainFormat).toBe('For Time')
    expect(out.formatConfig.cashOut).toEqual(['Run'])
  })

  it('RFT-scored owned envelope (the Composer\'s own primary pattern) has NO legacy mixed equivalent - falls back to the scorer alone, documented limitation', () => {
    const rft = createComponent({ id: 'rft', format: 'RFT', producesScore: true, config: { rounds: 5 }, instances: [inst('Toes-to-Bar')] })
    const buyIn = createComponent({ id: 'buyin', format: 'Once', role: 'buy-in', producesScore: false, scoreOwnerId: 'rft', instances: [inst('Row')] })
    const components = [buyIn, rft].map((c, i) => ({ ...c, order: i }))
    const out = deriveLegacyFieldsFromComponents(components)
    expect(out.type).toBe('RFT') // not a legacy mixed type - none exists for this shape
    expect(out.formatConfig).toEqual({ rounds: 5 })
    expect(out.instances).toEqual(rft.instances) // Buy-In dropped from the legacy view only
  })

  it('2+ independent scorers falls back to the first scorer alone, never a DB migration', () => {
    const amrap = createComponent({ id: 'a', format: 'AMRAP', producesScore: true, config: { durationSec: 480 }, instances: [inst('Burpees')] })
    const rft = createComponent({ id: 'f', format: 'RFT', producesScore: true, config: { rounds: 5 }, instances: [inst('Wall Balls')] })
    const components = [amrap, rft].map((c, i) => ({ ...c, order: i }))
    const out = deriveLegacyFieldsFromComponents(components)
    expect(out.type).toBe('AMRAP')
    expect(out.instances).toEqual(amrap.instances)
  })

  it('no scorers at all -> null (nothing meaningful to derive yet)', () => {
    expect(deriveLegacyFieldsFromComponents([createComponent({ format: 'Rest', producesScore: false })])).toBe(null)
    expect(deriveLegacyFieldsFromComponents([])).toBe(null)
  })
})

// --- 10. Composer-content / simple-graph / Generate Variants shim ----------

describe('hasComposerContent', () => {
  it('false for an empty array', () => { expect(hasComposerContent([])).toBe(false) })
  it('false for a single trivial component with no movements/role/ownership', () => {
    expect(hasComposerContent([createComponent({ format: 'AMRAP', instances: [] })])).toBe(false)
  })
  it('true for a single component with real movements', () => {
    expect(hasComposerContent([createComponent({ format: 'AMRAP', instances: [inst('Burpees')] })])).toBe(true)
  })
  it('true for a lone Rest (real authored intent even with zero movements)', () => {
    expect(hasComposerContent([createComponent({ format: 'Rest', producesScore: false })])).toBe(true)
  })
  it('true whenever there is more than one component', () => {
    expect(hasComposerContent([createComponent({ format: 'AMRAP' }), createComponent({ format: 'Rest' })])).toBe(true)
  })
})

describe('isSimpleComposerGraph / applyGeneratedInstancesToComponent', () => {
  it('0 or 1 component is simple; 2+ is not', () => {
    expect(isSimpleComposerGraph([])).toBe(true)
    expect(isSimpleComposerGraph([createComponent({ format: 'AMRAP' })])).toBe(true)
    expect(isSimpleComposerGraph([createComponent({ format: 'AMRAP' }), createComponent({ format: 'Rest' })])).toBe(false)
  })

  it('mirrors the reference component\'s format/role/config with fresh instances and a NEW id', () => {
    const rft = createComponent({ id: 'rft', format: 'RFT', config: { rounds: 5 }, instances: [inst('Old')] })
    const generated = [inst('New')]
    const out = applyGeneratedInstancesToComponent(rft, generated)
    expect(out).toHaveLength(1)
    expect(out[0].format).toBe('RFT')
    expect(out[0].config).toEqual({ rounds: 5 })
    expect(out[0].instances).toEqual(generated)
    expect(out[0].id).not.toBe('rft')
  })

  it('no reference component (empty RX) -> empty result, never invents a component', () => {
    expect(applyGeneratedInstancesToComponent(null, [inst('X')])).toEqual([])
  })
})

describe('allInstancesFromComponents', () => {
  it('flattens every component\'s instances in order, for save-time validation only', () => {
    const buyIn = createComponent({ format: 'Once', role: 'buy-in', instances: [inst('Row')] })
    const rft = createComponent({ format: 'RFT', instances: [inst('TTB'), inst('Wall Balls')] })
    expect(allInstancesFromComponents([buyIn, rft]).map(i => i.name)).toEqual(['Row', 'TTB', 'Wall Balls'])
  })
})

describe('createEmptyComposerVariants', () => {
  it('every variant starts with an independent empty components[] array (ticket §5/§30)', () => {
    const variants = createEmptyComposerVariants()
    expect(Object.keys(variants).sort()).toEqual(['beginner', 'intermediate', 'onramp', 'rx'])
    for (const key of Object.keys(variants)) {
      expect(variants[key].components).toEqual([])
    }
    // independence - mutating one variant's array must never affect another's
    variants.rx.components.push(createComponent({ format: 'AMRAP' }))
    expect(variants.beginner.components).toEqual([])
  })
})

// --- 11. Score envelope stays correct through authoring helpers ------------

describe('authoring helpers never corrupt the score envelope contract', () => {
  it('add Buy-In, add RFT, add Cash-Out, attach both -> one clean 3-member envelope', () => {
    let components = addComponentToList([], 'Once', 'buy-in')
    components = addComponentToList(components, 'RFT')
    components = addComponentToList(components, 'Once', 'cash-out')
    const rftId = components[1].id
    let result = setScoreOwner(components, components[0].id, rftId)
    expect(result.ok).toBe(true)
    result = setScoreOwner(result.components, components[2].id, rftId)
    expect(result.ok).toBe(true)
    expect(validateComponents(result.components).valid).toBe(true)
    expect(getScoreEnvelope(result.components, rftId)).toHaveLength(3)
  })
})
