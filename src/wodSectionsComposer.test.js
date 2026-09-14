// FORGE WORKOUT COMPOSER - PHASE 3: wodSections.js hydration/persistence
// tests - Start Empty, legacy-workout Composer projection, save/reopen
// round-trip (create -> save -> close -> reopen -> same Components/ids/
// order/config/instances/ownership, ticket §34), variant independence
// (ticket §30), and the save-gate wiring (ticket §35/§36).

import { describe, it, expect } from 'vitest'
import {
  createSection, sectionsFromLegacyWod, legacyPayloadFromSections,
  validateSectionsForLegacy, validateComposerSectionsForSave,
} from './wodSections'
import {
  addComponentToList, setScoreOwner, getScoreEnvelope,
} from './componentContract'

// --- Start Empty (ticket §5) ------------------------------------------------

describe('createSection - Start Empty produces true Composer empty state', () => {
  it('a new primary section has components: [] on every variant, no default Buy-In/AMRAP/Rest', () => {
    const section = createSection('metcon', true)
    for (const key of ['rx', 'intermediate', 'beginner', 'onramp']) {
      expect(section.variants[key].components).toEqual([])
    }
  })

  it('a new non-primary section is untouched - no components field involved', () => {
    const section = createSection('skill', false)
    expect(section.variants.rx.components).toBe(undefined)
  })
})

// --- Existing workout editing (ticket §32/§33) ------------------------------

describe('sectionsFromLegacyWod - legacy workouts project into Composer Components', () => {
  it('a legacy plain AMRAP row projects into ONE AMRAP component wrapping it verbatim', () => {
    const w = {
      id: 'w1', date: '2026-01-01', type: 'AMRAP', format_config: { durationSec: 600 },
      movements_rx: ['10 Pull-Ups', '10 Burpees'], name: 'Test',
    }
    const sections = sectionsFromLegacyWod(w)
    const primary = sections.find(s => s.isPrimary)
    const rx = primary.variants.rx.components
    expect(rx).toHaveLength(1)
    expect(rx[0].format).toBe('AMRAP')
    expect(rx[0].config).toEqual({ durationSec: 600 })
    expect(rx[0].instances.map(i => i.name)).toEqual(['Pull-Ups', 'Burpees'])
    expect(rx[0].producesScore).toBe(true)
  })

  it('a legacy Buy-In/Cash-Out row projects into a full owned envelope', () => {
    const w = {
      id: 'w2', date: '2026-01-01', type: 'Buy-In/Cash-Out',
      format_config: { mainFormat: 'For Time', buyIn: ['1000m Row'], cashOut: ['800m Run'] },
      movements_rx: ['5 Toes-to-Bar', '10 Wall Balls'],
    }
    const sections = sectionsFromLegacyWod(w)
    const rx = sections.find(s => s.isPrimary).variants.rx.components
    expect(rx).toHaveLength(3)
    const main = rx.find(c => c.role !== 'buy-in' && c.role !== 'cash-out')
    const buyIn = rx.find(c => c.role === 'buy-in')
    const cashOut = rx.find(c => c.role === 'cash-out')
    expect(main.format).toBe('For Time')
    expect(buyIn.scoreOwnerId).toBe(main.id)
    expect(cashOut.scoreOwnerId).toBe(main.id)
    expect(getScoreEnvelope(rx, main.id)).toHaveLength(3)
  })

  it('a WOD already saved through the Composer hydrates its persisted components[] VERBATIM, not re-derived', () => {
    const persisted = [
      { id: 'cmp_fixed_1', order: 0, format: 'AMRAP', role: null, label: null, producesScore: true, scoreOwnerId: null, config: { durationSec: 300 }, instances: [] },
    ]
    const w = { id: 'w3', date: '2026-01-01', type: 'AMRAP', format_config: { durationSec: 300 }, movement_prescriptions: { variants: { rx: { components: persisted } } } }
    const sections = sectionsFromLegacyWod(w)
    const rx = sections.find(s => s.isPrimary).variants.rx.components
    expect(rx).toHaveLength(1)
    expect(rx[0].id).toBe('cmp_fixed_1') // preserved verbatim, never re-derived
  })
})

// --- legacyPayloadFromSections write shim -----------------------------------

describe('legacyPayloadFromSections - Composer write shim', () => {
  it('an untouched Start Empty section persists no movement_prescriptions entry for any variant (no false-positive "authored")', () => {
    const primary = createSection('metcon', true)
    const payload = legacyPayloadFromSections([primary])
    expect(payload.movement_prescriptions.variants.rx).toBeUndefined()
    expect(payload.movements_rx).toEqual([])
  })

  it('single AMRAP component -> byte-identical legacy scalar fields (Phase 1 equivalence)', () => {
    const primary = createSection('metcon', true)
    primary.variants.rx.components = addComponentToList([], 'AMRAP')
    primary.variants.rx.components[0].config = { durationSec: 600 }
    primary.variants.rx.components = addComponentInstance(primary.variants.rx.components, 'Burpees')
    const payload = legacyPayloadFromSections([primary])
    expect(payload.type).toBe('AMRAP')
    expect(payload.format_config).toEqual({ durationSec: 600 })
    expect(payload.movements_rx).toEqual(['Burpees'])
    expect(payload.movement_prescriptions.variants.rx.components).toHaveLength(1)
  })

  it('Buy-In -> AMRAP -> Cash-Out envelope persists as legacy "AMRAP with Buy-In" (full production round-trip, zero gap)', () => {
    const primary = createSection('metcon', true)
    let components = addComponentToList([], 'Once', 'buy-in')
    components = addComponentInstance(components, 'Row', components[0].id)
    components = addComponentToList(components, 'AMRAP')
    components[1].config = { durationSec: 360 }
    components = addComponentInstance(components, 'Wall Balls', components[1].id)
    components = addComponentToList(components, 'Once', 'cash-out')
    components = addComponentInstance(components, 'Run', components[2].id)
    components = setScoreOwner(components, components[0].id, components[1].id).components
    components = setScoreOwner(components, components[2].id, components[1].id).components
    primary.variants.rx.components = components

    const payload = legacyPayloadFromSections([primary])
    expect(payload.type).toBe('AMRAP with Buy-In')
    expect(payload.format_config.buyIn).toEqual(['Row'])
    expect(payload.format_config.cashOut).toEqual(['Run'])
    expect(payload.movements_rx).toEqual(['Wall Balls'])
  })

  it('Buy-In -> RFT -> Cash-Out (no legacy equivalent) persists the FULL graph additively; legacy scalars fall back to RFT alone', () => {
    const primary = createSection('metcon', true)
    let components = addComponentToList([], 'Once', 'buy-in')
    components = addComponentInstance(components, '1000m Row', components[0].id)
    components = addComponentToList(components, 'RFT')
    components[1].config = { rounds: 5 }
    components = addComponentInstance(components, 'Toes-to-Bar', components[1].id)
    components = addComponentToList(components, 'Once', 'cash-out')
    components = addComponentInstance(components, '800m Run', components[2].id)
    components = setScoreOwner(components, components[0].id, components[1].id).components
    components = setScoreOwner(components, components[2].id, components[1].id).components
    primary.variants.rx.components = components

    const payload = legacyPayloadFromSections([primary])
    expect(payload.type).toBe('RFT') // documented limitation - no legacy mixed shape for a repeated-rounds envelope
    expect(payload.movements_rx).toEqual(['Toes-to-Bar']) // Buy-In/Cash-Out not in the legacy scalar view
    // ...but the FULL 3-component graph is always additionally persisted verbatim
    const storedComponents = payload.movement_prescriptions.variants.rx.components
    expect(storedComponents).toHaveLength(3)
    const storedScorer = storedComponents.find(c => c.role !== 'buy-in' && c.role !== 'cash-out')
    expect(storedScorer.format).toBe('RFT')
    expect(storedComponents.find(c => c.role === 'buy-in').scoreOwnerId).toBe(storedScorer.id)
    expect(storedComponents.find(c => c.role === 'cash-out').scoreOwnerId).toBe(storedScorer.id)
  })

  it('a genuinely empty component list (Rest only, or nothing scored yet) never crashes the save shim', () => {
    const primary = createSection('metcon', true)
    primary.variants.rx.components = addComponentToList([], 'Rest')
    expect(() => legacyPayloadFromSections([primary])).not.toThrow()
  })
})

// --- Save -> reopen round-trip (ticket §34, the complex fixture) -----------

describe('save -> reopen round-trip preserves the full canonical graph', () => {
  it('create -> save -> reopen -> same Components/ids/order/config/instances/ownership', () => {
    const primary = createSection('metcon', true)
    let components = addComponentToList([], 'Once', 'buy-in')
    components = addComponentInstance(components, 'Row', components[0].id)
    components = addComponentToList(components, 'RFT')
    components[1].config = { rounds: 5 }
    components = addComponentInstance(components, 'Toes-to-Bar', components[1].id)
    components = addComponentToList(components, 'Once', 'cash-out')
    components = addComponentInstance(components, 'Run', components[2].id)
    components = setScoreOwner(components, components[0].id, components[1].id).components
    components = setScoreOwner(components, components[2].id, components[1].id).components
    primary.variants.rx.components = components
    primary.name = 'Test Composer WOD'

    const payload = legacyPayloadFromSections([primary])
    // Simulate a real Postgres JSONB store/retrieve round-trip (same
    // technique Phase 2.1 used for wod_logs.log_meta) rather than a live
    // Supabase write.
    const roundTripped = JSON.parse(JSON.stringify(payload))
    const w = { id: 'w-roundtrip', date: '2026-01-01', name: 'Test Composer WOD', ...roundTripped }

    const reopened = sectionsFromLegacyWod(w)
    const reopenedComponents = reopened.find(s => s.isPrimary).variants.rx.components

    expect(reopenedComponents).toHaveLength(3)
    expect(reopenedComponents.map(c => c.id)).toEqual(components.map(c => c.id))
    expect(reopenedComponents.map(c => c.order)).toEqual([0, 1, 2])
    expect(reopenedComponents.find(c => c.role === 'buy-in').scoreOwnerId).toBe(components[1].id)
    expect(reopenedComponents.find(c => c.role === 'cash-out').scoreOwnerId).toBe(components[1].id)
    expect(reopenedComponents.find(c => c.format === 'RFT').config).toEqual({ rounds: 5 })
    expect(reopenedComponents.find(c => c.role === 'buy-in').instances[0].name).toBe('Row')
  })
})

// --- Variant independence (ticket §30) --------------------------------------

describe('variant independence - each variant\'s components[] persists/reloads on its own', () => {
  it('RX carries a full envelope while Beginner carries just one plain component', () => {
    const primary = createSection('metcon', true)
    let rxComponents = addComponentToList([], 'Once', 'buy-in')
    rxComponents = addComponentInstance(rxComponents, 'Row', rxComponents[0].id)
    rxComponents = addComponentToList(rxComponents, 'RFT')
    rxComponents[1].config = { rounds: 5 }
    rxComponents = addComponentInstance(rxComponents, 'Toes-to-Bar', rxComponents[1].id)
    rxComponents = setScoreOwner(rxComponents, rxComponents[0].id, rxComponents[1].id).components
    primary.variants.rx.components = rxComponents

    let beginnerComponents = addComponentToList([], 'RFT')
    beginnerComponents[0].config = { rounds: 3 }
    beginnerComponents = addComponentInstance(beginnerComponents, 'Ring Rows', beginnerComponents[0].id)
    primary.variants.beginner.components = beginnerComponents

    const payload = legacyPayloadFromSections([primary])
    expect(payload.movement_prescriptions.variants.rx.components).toHaveLength(2)
    expect(payload.movement_prescriptions.variants.beginner.components).toHaveLength(1)
    expect(payload.movements_beginner).toEqual(['Ring Rows'])

    const w = { id: 'w-variants', date: '2026-01-01', ...JSON.parse(JSON.stringify(payload)) }
    const reopened = sectionsFromLegacyWod(w)
    const reopenedPrimary = reopened.find(s => s.isPrimary)
    expect(reopenedPrimary.variants.rx.components).toHaveLength(2)
    expect(reopenedPrimary.variants.beginner.components).toHaveLength(1)
    expect(reopenedPrimary.variants.beginner.components[0].format).toBe('RFT')
    expect(reopenedPrimary.variants.beginner.components[0].config).toEqual({ rounds: 3 })
  })
})

// --- Save gate wiring (ticket §35/§36) ---------------------------------------

describe('validateSectionsForLegacy / validateComposerSectionsForSave - Composer save gate', () => {
  it('an invalid Composer graph (Rest scoring) blocks save with coach-facing copy', () => {
    const primary = createSection('metcon', true)
    const rest = addComponentToList([], 'Rest')
    rest[0].producesScore = true // invalid - Rest can never score
    primary.variants.rx.components = rest
    const messages = validateComposerSectionsForSave([primary])
    expect(messages.length).toBeGreaterThan(0)
    expect(validateSectionsForLegacy([primary], {}).valid).toBe(false)
  })

  it('a valid Composer graph does not block save', () => {
    const primary = createSection('metcon', true)
    let components = addComponentToList([], 'AMRAP')
    components = addComponentInstance(components, 'Burpees', components[0].id)
    primary.variants.rx.components = components
    expect(validateComposerSectionsForSave([primary])).toEqual([])
  })

  it('an untouched empty composer never blocks save on its own (parity with pre-Composer empty WOD)', () => {
    const primary = createSection('metcon', true)
    expect(validateComposerSectionsForSave([primary])).toEqual([])
  })
})

// --- helpers -----------------------------------------------------------------

function addComponentInstance(components, name, componentId) {
  const targetId = componentId || components[components.length - 1].id
  return components.map(c => (c.id === targetId ? { ...c, instances: [...c.instances, { instanceId: `mi_${name}`, name }] } : c))
}
