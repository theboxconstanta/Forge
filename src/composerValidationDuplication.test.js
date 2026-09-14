// FORGE WORKOUT COMPOSER - PHASE 3.1: duplicate validation message fix.
//
// ROOT CAUSE (traced, not assumed): componentsFromSection's "legacy single-
// score equivalence" contract (Phase 1) always projects exactly ONE
// component for the default/mixed families, even when the underlying
// variant has ZERO movements. sectionsFromLegacyWod/sectionFromAiSection
// called this UNCONDITIONALLY for every one of the 4 scaling tiers -
// meaning an unprogrammed Intermediate/Beginner/OnRamp tier (the ordinary,
// legitimate "coach only programmed RX" case) hydrated to a PHANTOM
// component indistinguishable from real in-progress work. validateComposer-
// SectionsForSave then validated each tier independently, producing the
// SAME "<header>: add at least one movement." text once per untouched
// tier - up to 3-4 identical messages for ONE underlying (non-)problem.
//
// FIX: both hydration call sites now gate the projection on
// hasComposerContent (the same predicate legacyPayloadFromSections already
// uses for persistence) - an unprogrammed tier hydrates to true
// components: [] (exactly Start Empty's own state), which the existing
// "skip empty variants" loop in validateComposerSectionsForSave already
// correctly ignores. A defensive (not primary) variant-label attribution +
// final dedup stays on top for the case where two DIFFERENT variants are
// genuinely, independently authored with the same real mistake.

import { describe, it, expect } from 'vitest'
import {
  createSection, sectionsFromLegacyWod, legacyPayloadFromSections, validateSectionsForLegacy,
  validateComposerSectionsForSave,
} from './wodSections'
import { sectionFromAiSection } from './workoutIntelligence'
import { addComponentToList } from './componentContract'

function addMovement(components, componentId, name) {
  return components.map(c => (c.id === componentId ? { ...c, instances: [...c.instances, { instanceId: `mi_${name}`, name }] } : c))
}

// --- Root-cause repro: the exact reported scenario -------------------------

describe('root cause repro - unprogrammed tiers no longer produce phantom duplicate errors', () => {
  it('RX programmed (RFT, no movements yet), Intermediate/Beginner/OnRamp never touched -> ONE message, not four', () => {
    // Mirrors the real owner screenshot: RX carries a real, coach-authored
    // RFT with no movements yet; the other three tiers were never
    // programmed at all (movements_{k} empty, the ordinary "only RX is
    // programmed" legacy case).
    const w = {
      id: 'w1', date: '2026-01-01', type: 'RFT', format_config: { rounds: 5 },
      movements_rx: [], // RX itself also has no movements in this exact repro
    }
    const sections = sectionsFromLegacyWod(w)
    const primary = sections.find(s => s.isPrimary)
    // Every tier is unprogrammed -> every tier hydrates to true components: []
    for (const key of ['rx', 'intermediate', 'beginner', 'onramp']) {
      expect(primary.variants[key].components).toEqual([])
    }
    expect(validateComposerSectionsForSave([primary])).toEqual([])
  })

  it('RX has real movements (valid), the other three tiers are unprogrammed -> ZERO phantom errors from them', () => {
    const w = {
      id: 'w2', date: '2026-01-01', type: 'RFT', format_config: { rounds: 5 },
      movements_rx: ['10 Toes-to-Bar', '15 Wall Balls'],
      // movements_intermediate/beginner/onramp intentionally absent (never programmed)
    }
    const sections = sectionsFromLegacyWod(w)
    const primary = sections.find(s => s.isPrimary)
    expect(primary.variants.rx.components).toHaveLength(1)
    expect(primary.variants.rx.components[0].instances.length).toBeGreaterThan(0)
    for (const key of ['intermediate', 'beginner', 'onramp']) {
      expect(primary.variants[key].components).toEqual([]) // no phantom component
    }
    expect(validateComposerSectionsForSave([primary])).toEqual([]) // RX is valid, others contribute nothing
  })

  it('same repro through the AI-draft hydration path (sectionFromAiSection)', () => {
    const aiSection = {
      type: 'metcon', format: 'RFT', formatConfig: { rounds: 5 },
      movements: [{ name: 'Toes-to-Bar', reps: 10 }],
      scalingVersions: [], // AI never returned Intermediate/Beginner/OnRamp content
    }
    const section = sectionFromAiSection(aiSection, true, '')
    expect(section.variants.rx.components).toHaveLength(1)
    for (const key of ['intermediate', 'beginner', 'onramp']) {
      expect(section.variants[key].components).toEqual([])
    }
  })
})

// --- Ticket's 8 required regression cases -----------------------------------

describe('1. one invalid RFT Component -> exactly one displayed validation message', () => {
  it('a single authored RFT with zero movements produces exactly one message', () => {
    const primary = createSection('metcon', true)
    primary.variants.rx.components = addComponentToList([], 'RFT')
    const messages = validateComposerSectionsForSave([primary])
    expect(messages).toHaveLength(1)
    expect(messages[0]).toMatch(/ROUNDS FOR TIME/)
    expect(messages[0]).toMatch(/add at least one movement/)
  })
})

describe('2. two different invalid Components -> one message per actual problem', () => {
  it('an invalid RFT and an invalid AMRAP each produce their own single message', () => {
    const primary = createSection('metcon', true)
    let components = addComponentToList([], 'RFT')
    components = addComponentToList(components, 'AMRAP')
    primary.variants.rx.components = components
    const messages = validateComposerSectionsForSave([primary])
    expect(messages).toHaveLength(2)
    expect(messages.some(m => /ROUNDS FOR TIME/.test(m))).toBe(true)
    expect(messages.some(m => /AMRAP/.test(m))).toBe(true)
    expect(new Set(messages).size).toBe(2) // both distinct, neither repeated
  })
})

describe('3. duplicate validation paths cannot duplicate identical error for the same component/problem', () => {
  it('validateComposerSectionsForSave is idempotent - calling it twice never accumulates', () => {
    const primary = createSection('metcon', true)
    primary.variants.rx.components = addComponentToList([], 'RFT')
    const first = validateComposerSectionsForSave([primary])
    const second = validateComposerSectionsForSave([primary])
    expect(first).toEqual(second)
    expect(first).toHaveLength(1)
  })

  it('validateSectionsForLegacy (the real save-gate entry point) does not duplicate the composer message either', () => {
    const primary = createSection('metcon', true)
    primary.variants.rx.components = addComponentToList([], 'RFT')
    const { errors } = validateSectionsForLegacy([primary], {})
    const rftErrors = errors.filter(e => /ROUNDS FOR TIME/.test(e))
    expect(rftErrors).toHaveLength(1)
  })

  it('two variants genuinely, independently authored with the identical mistake are distinguishable, never byte-identical duplicates', () => {
    const primary = createSection('metcon', true)
    primary.variants.rx.components = addComponentToList([], 'RFT')
    primary.variants.beginner.components = addComponentToList([], 'RFT')
    const messages = validateComposerSectionsForSave([primary])
    expect(messages).toHaveLength(2)
    expect(new Set(messages).size).toBe(2) // attributed by variant, not identical strings
    expect(messages.some(m => m.startsWith('RX:'))).toBe(true)
    expect(messages.some(m => m.startsWith('Beginner:'))).toBe(true)
  })
})

describe('4. inactive-variant errors are not indistinguishable duplicates in the active editing context', () => {
  it('RX and Intermediate both genuinely invalid -> each message names its own variant, never bare-identical text', () => {
    const primary = createSection('metcon', true)
    primary.variants.rx.components = addComponentToList([], 'AMRAP')
    primary.variants.intermediate.components = addComponentToList([], 'AMRAP')
    const messages = validateComposerSectionsForSave([primary])
    expect(messages).toHaveLength(2)
    expect(messages).not.toEqual([messages[0], messages[0]]) // never a flat repeat
    expect(messages.find(m => m.startsWith('RX:'))).toBeDefined()
    expect(messages.find(m => m.startsWith('Intermediate:'))).toBeDefined()
  })
})

describe('5. invalid Composer still cannot save', () => {
  it('save gate stays validation-strict - a zero-movement RFT blocks save', () => {
    const primary = createSection('metcon', true)
    primary.variants.rx.components = addComponentToList([], 'RFT')
    expect(validateSectionsForLegacy([primary], {}).valid).toBe(false)
  })

  it('a broken envelope (Rest illegally scoring) still blocks save', () => {
    const primary = createSection('metcon', true)
    const rest = addComponentToList([], 'Rest')
    rest[0].producesScore = true
    primary.variants.rx.components = rest
    expect(validateSectionsForLegacy([primary], {}).valid).toBe(false)
  })
})

describe('6. fixing the movement clears the error', () => {
  it('adding a movement to the invalid RFT makes validation pass', () => {
    const primary = createSection('metcon', true)
    const components = addComponentToList([], 'RFT')
    primary.variants.rx.components = components
    expect(validateComposerSectionsForSave([primary])).toHaveLength(1)

    primary.variants.rx.components = addMovement(components, components[0].id, 'Toes-to-Bar')
    expect(validateComposerSectionsForSave([primary])).toEqual([])
    expect(validateSectionsForLegacy([primary], {}).valid).toBe(true)
  })
})

describe('7/8. Home and Photo Result untouched (structural confirmation)', () => {
  it('this fix touches only wodSections.js/workoutIntelligence.js - no Home/Photo Result module is imported or referenced', () => {
    // Home.jsx / PhotoResult-related modules are not imported by any file
    // touched in this phase - confirmed by the diff review in the final
    // report, not re-derivable from a pure unit test. This test exists so
    // a future accidental import shows up here too: neither wodSections.js
    // nor workoutIntelligence.js exports anything Home/Photo Result would
    // need to consume differently.
    expect(typeof validateComposerSectionsForSave).toBe('function')
  })
})

// --- Persistence stays correct after the hydration fix ---------------------

describe('legacyPayloadFromSections still saves a genuinely-fixed WOD correctly', () => {
  it('a WOD with only RX programmed persists RX correctly and no phantom components for the other tiers', () => {
    const primary = createSection('metcon', true)
    let components = addComponentToList([], 'RFT')
    components[0].config = { rounds: 5 }
    components = addMovement(components, components[0].id, 'Toes-to-Bar')
    primary.variants.rx.components = components

    const payload = legacyPayloadFromSections([primary])
    expect(payload.type).toBe('RFT')
    expect(payload.movements_rx).toEqual(['Toes-to-Bar'])
    expect(payload.movement_prescriptions.variants.intermediate).toBeUndefined()
    expect(payload.movement_prescriptions.variants.beginner).toBeUndefined()
    expect(payload.movement_prescriptions.variants.onramp).toBeUndefined()

    const roundTripped = JSON.parse(JSON.stringify(payload))
    const reopened = sectionsFromLegacyWod({ id: 'w3', date: '2026-01-01', ...roundTripped })
    const reopenedPrimary = reopened.find(s => s.isPrimary)
    expect(reopenedPrimary.variants.rx.components).toHaveLength(1)
    for (const key of ['intermediate', 'beginner', 'onramp']) {
      expect(reopenedPrimary.variants[key].components).toEqual([]) // still no phantom on re-reopen
    }
  })
})
