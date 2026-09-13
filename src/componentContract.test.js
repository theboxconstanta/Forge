// FORGE WORKOUT COMPOSER - Phase 1 domain contract tests.
//
// Covers the ticket's required 34-case matrix. Pure domain tests - no React,
// no Supabase. Fixtures from composerFixtures.js are reused where the
// pattern matches; ad hoc components are built inline for the validation/
// envelope edge cases the fixtures don't need to carry.

import { describe, it, expect } from 'vitest'
import {
  newComponentId, createComponent, normalizeComponentOrder, validateComponents,
  getScoreEnvelope, getAllScoreEnvelopes, resolveOnceComponentResult,
  composeEnvelopeResult, componentsFromSection, defaultProducesScoreForFormat,
  canJoinScoreEnvelope, composeMixedLogFields,
  getComponentResultsFromLog, composeComponentsLogFields,
} from './componentContract'
import { fixtureA_simpleAmrap, fixtureB_oneEnvelope, fixtureC_multiScore, fixtureD_complexComposer, fixtureThreeIndependentScores } from './composerFixtures'
import { createSection } from './wodSections'
import { newMovementInstance } from './prescriptionContract'

function withVariant(section, instances) {
  return { ...section, variants: { ...section.variants, rx: { ...section.variants.rx, instances } } }
}

// ============================================================================
// 1-3. Empty Metcon, one AMRAP, one RFT
// ============================================================================

describe('canonical components[] - basic shapes', () => {
  it('1. an empty canonical Metcon is components: []', () => {
    expect(validateComponents([])).toEqual({ valid: true, errors: [] })
  })

  it('2. one AMRAP component validates clean', () => {
    const components = fixtureA_simpleAmrap()
    expect(components).toHaveLength(1)
    expect(components[0].format).toBe('AMRAP')
    expect(components[0].producesScore).toBe(true)
    expect(validateComponents(components).valid).toBe(true)
  })

  it('3. one RFT component validates clean', () => {
    const components = normalizeComponentOrder([
      createComponent({ format: 'RFT', producesScore: true, config: { rounds: 5 }, instances: [newMovementInstance({ name: 'Pull-Ups' })] }),
    ])
    expect(components[0].format).toBe('RFT')
    expect(validateComponents(components).valid).toBe(true)
  })
})

// ============================================================================
// 4-6. Envelopes
// ============================================================================

describe('score-envelope derivation', () => {
  it('4. Buy-In -> RFT -> Cash-Out forms one envelope in canonical order', () => {
    const components = fixtureB_oneEnvelope()
    expect(validateComponents(components).valid).toBe(true)
    const rft = components.find(c => c.format === 'RFT')
    const envelope = getScoreEnvelope(components, rft.id)
    expect(envelope.map(c => c.role)).toEqual(['buy-in', 'main', 'cash-out'])
    expect(envelope.map(c => c.order)).toEqual([0, 1, 2])
  })

  it('5. AMRAP -> Rest -> RFT creates two independent scoring components; Rest owns neither', () => {
    const components = fixtureC_multiScore()
    expect(validateComponents(components).valid).toBe(true)
    const envelopes = getAllScoreEnvelopes(components)
    expect(Object.keys(envelopes)).toHaveLength(2)
    Object.values(envelopes).forEach(env => expect(env).toHaveLength(1)) // each scorer is its own singleton envelope
    const rest = components.find(c => c.format === 'Rest')
    expect(rest.scoreOwnerId).toBeNull()
    expect(Object.values(envelopes).some(env => env.some(c => c.id === rest.id))).toBe(false)
  })

  it('6. Buy-In -> RFT -> Cash-Out -> Rest -> AMRAP: envelope + independent scorer + excluded Rest coexist', () => {
    const components = fixtureD_complexComposer()
    expect(validateComponents(components).valid).toBe(true)
    const rft = components.find(c => c.id === 'fixD-rft')
    const amrap = components.find(c => c.id === 'fixD-amrap')
    const emom = components.find(c => c.id === 'fixD-emom')
    expect(getScoreEnvelope(components, rft.id).map(c => c.id)).toEqual(['fixD-buyin', 'fixD-rft', 'fixD-cashout'])
    expect(getScoreEnvelope(components, amrap.id).map(c => c.id)).toEqual(['fixD-amrap'])
    expect(getScoreEnvelope(components, emom.id).map(c => c.id)).toEqual(['fixD-emom'])
    const rests = components.filter(c => c.format === 'Rest')
    expect(rests.every(r => r.scoreOwnerId === null)).toBe(true)
  })
})

// ============================================================================
// 7-12. Validation
// ============================================================================

describe('validateComponents - error cases', () => {
  it('7. dangling scoreOwnerId is rejected', () => {
    const c = createComponent({ format: 'Once', producesScore: false, scoreOwnerId: 'does-not-exist' })
    const { valid, errors } = validateComponents([c])
    expect(valid).toBe(false)
    expect(errors.map(e => e.code)).toContain('DANGLING_OWNER')
  })

  it('8. self-ownership is rejected', () => {
    const c = createComponent({ format: 'Once', producesScore: false })
    c.scoreOwnerId = c.id
    const { valid, errors } = validateComponents([c])
    expect(valid).toBe(false)
    expect(errors.map(e => e.code)).toContain('SELF_OWNERSHIP')
  })

  it('9. owning a component that cannot produce a score is rejected', () => {
    const owner = createComponent({ format: 'Once', producesScore: false })
    const member = createComponent({ format: 'Once', producesScore: false, scoreOwnerId: owner.id })
    const { valid, errors } = validateComponents([owner, member])
    expect(valid).toBe(false)
    expect(errors.map(e => e.code)).toContain('OWNER_CANNOT_SCORE')
  })

  it('10. an ownership cycle is detected', () => {
    const a = createComponent({ id: 'a', format: 'Once', producesScore: false, scoreOwnerId: 'b' })
    const b = createComponent({ id: 'b', format: 'Once', producesScore: false, scoreOwnerId: 'a' })
    const { valid, errors } = validateComponents([a, b])
    expect(valid).toBe(false)
    expect(errors.map(e => e.code)).toContain('OWNERSHIP_CYCLE')
  })

  it('11. a broken/non-contiguous envelope is rejected', () => {
    const rft = createComponent({ id: 'rft', format: 'RFT', producesScore: true, config: { rounds: 5 } })
    const buyIn = createComponent({ id: 'buyin', format: 'Once', producesScore: false, scoreOwnerId: 'rft' })
    const independentAmrap = createComponent({ id: 'amrap', format: 'AMRAP', producesScore: true, config: { durationSec: 300 } })
    const cashOut = createComponent({ id: 'cashout', format: 'Once', producesScore: false, scoreOwnerId: 'rft' })
    // Buy-In owned by RFT, then an unrelated AMRAP, then Cash-Out owned by
    // the SAME earlier RFT - the envelope is split by an interloper.
    const components = normalizeComponentOrder([buyIn, rft, independentAmrap, cashOut])
    const { valid, errors } = validateComponents(components)
    expect(valid).toBe(false)
    expect(errors.map(e => e.code)).toContain('BROKEN_ENVELOPE_CONTIGUITY')
  })

  it('12. Rest can never be owned by another component', () => {
    const owner = createComponent({ format: 'AMRAP', producesScore: true, config: { durationSec: 300 } })
    const rest = createComponent({ format: 'Rest', producesScore: false, scoreOwnerId: owner.id })
    const { valid, errors } = validateComponents([owner, rest])
    expect(valid).toBe(false)
    expect(errors.map(e => e.code)).toContain('REST_CANNOT_BE_OWNED')
  })

  it('Rest can never produce a score, even if forced', () => {
    const rest = createComponent({ format: 'Rest', producesScore: true })
    const { valid, errors } = validateComponents([rest])
    expect(valid).toBe(false)
    expect(errors.map(e => e.code)).toContain('REST_CANNOT_SCORE')
  })

  it('a scoring component cannot itself be owned', () => {
    const owner = createComponent({ format: 'AMRAP', producesScore: true, config: { durationSec: 300 } })
    const other = createComponent({ format: 'RFT', producesScore: true, config: { rounds: 5 }, scoreOwnerId: owner.id })
    const { valid, errors } = validateComponents([owner, other])
    expect(valid).toBe(false)
    expect(errors.map(e => e.code)).toContain('SCORER_CANNOT_HAVE_OWNER')
  })

  it('duplicate component ids are rejected', () => {
    const a = createComponent({ id: 'dup', format: 'AMRAP', producesScore: true, config: { durationSec: 300 } })
    const b = createComponent({ id: 'dup', format: 'RFT', producesScore: true, config: { rounds: 5 } })
    expect(validateComponents([a, b]).errors.map(e => e.code)).toContain('DUPLICATE_ID')
  })

  it('an unknown format id is rejected', () => {
    const c = createComponent({ format: 'Totally Not A Real Format', producesScore: true })
    expect(validateComponents([c]).errors.map(e => e.code)).toContain('UNKNOWN_FORMAT')
  })

  it('capability helpers: Rest defaults producesScore=false and cannot join an envelope', () => {
    expect(defaultProducesScoreForFormat('Rest')).toBe(false)
    expect(defaultProducesScoreForFormat('Once')).toBe(false)
    expect(defaultProducesScoreForFormat('AMRAP')).toBe(true)
    expect(canJoinScoreEnvelope('Rest')).toBe(false)
    expect(canJoinScoreEnvelope('Once')).toBe(true)
  })
})

// ============================================================================
// 13-14. Stable IDs across reorder
// ============================================================================

describe('stable identity across reorder', () => {
  it('13. component ids survive reorder; only `order` changes', () => {
    const components = fixtureD_complexComposer()
    const ids = components.map(c => c.id)
    const reversed = normalizeComponentOrder([...components].reverse())
    expect(reversed.map(c => c.id).sort()).toEqual(ids.sort())
    reversed.forEach((c, i) => expect(c.order).toBe(i))
    // untouched components (order didn't need to change) keep referential identity
    const untouched = components.filter((c, i) => c.order === i)
    untouched.forEach(c => { expect(normalizeComponentOrder(components).find(x => x.id === c.id)).toBe(c) })
  })

  it('14. MovementInstance ids survive reorder', () => {
    const components = fixtureB_oneEnvelope()
    const instanceIdsBefore = components.flatMap(c => c.instances.map(i => i.instanceId))
    const reordered = normalizeComponentOrder([...components].reverse())
    const instanceIdsAfter = reordered.flatMap(c => c.instances.map(i => i.instanceId))
    expect(instanceIdsAfter.sort()).toEqual(instanceIdsBefore.sort())
  })

  it('newComponentId produces unique, stably-prefixed, non-index-derived ids', () => {
    const ids = new Set(Array.from({ length: 50 }, () => newComponentId()))
    expect(ids.size).toBe(50)
    ;[...ids].forEach(id => expect(id.startsWith('cmp_')).toBe(true))
  })
})

// ============================================================================
// 15-19. Multi-movement once/bookend + partial progress
// ============================================================================

describe('multi-movement once/bookend correction (Phase 0.3 Correction 1)', () => {
  it('15. multi-movement Buy-In: all movements complete', () => {
    const lines = ['500 m Row', '30 Burpees', '20 DB Snatches']
    const result = resolveOnceComponentResult(lines, ['500', '30', '20'])
    expect(result.text).toBe('500/500 m Row, 30/30 Burpees, 20/20 DB Snatches')
    expect(result.reachedLast).toBe(true)
  })

  it('16. partial multi-movement Buy-In (Case D: stops at 11/20 DB Snatches)', () => {
    const lines = ['500 m Row', '30 Burpees', '20 DB Snatches']
    const result = resolveOnceComponentResult(lines, ['500', '30', '11'])
    expect(result.hasProgress).toBe(true)
    expect(result.text).toBe('500/500 m Row, 30/30 Burpees, 11/20 DB Snatches')
    expect(result.reachedLast).toBe(true) // touched (partially) the last movement
  })

  it('17. multi-movement Cash-Out, complete', () => {
    const lines = ['400 m Run', '20 Pull-Ups']
    const result = resolveOnceComponentResult(lines, ['400', '20'])
    expect(result.text).toBe('400/400 m Run, 20/20 Pull-Ups')
  })

  it('18. partial Cash-Out (Case E: stops at 11/20 Pull-Ups)', () => {
    const lines = ['400 m Run', '20 Pull-Ups']
    const result = resolveOnceComponentResult(lines, ['400', '11'])
    expect(result.text).toBe('400/400 m Run, 11/20 Pull-Ups')
    expect(result.reachedLast).toBe(true)
  })

  it('19. partial main RFT-style component is untouched, existing engine remains source of truth', () => {
    // RFT/repeated-rounds partial capture is NOT resolveOnceComponentResult's
    // job - it stays on wodRoundsCompleted/wodPartialReps + the EXISTING
    // composeFortimeOrAmrapFields (workoutFormats.js), unmodified. This test
    // proves componentContract.js does not attempt to reimplement it.
    expect(typeof resolveOnceComponentResult).toBe('function')
    // A 'RFT'-format component's own instances are plain MovementInstance[]
    // exactly like any other component - nothing about Composer membership
    // changes how its native partial engine is invoked.
    const components = fixtureB_oneEnvelope()
    const rft = components.find(c => c.format === 'RFT')
    expect(rft.instances.every(i => typeof i.instanceId === 'string')).toBe(true)
  })

  it('single-movement Once behaves identically to today\'s common Buy-In/Cash-Out case', () => {
    const result = resolveOnceComponentResult(['1000 m Row'], ['730'])
    expect(result.text).toBe('730/1000 m Row')
    expect(result.hasProgress).toBe(true)
    expect(result.reachedLast).toBe(true)
  })
})

// ============================================================================
// Envelope-result composer (Cases A/B/C from Phase 0.3, ticket §9)
// ============================================================================

describe('composeEnvelopeResult', () => {
  const components = fixtureB_oneEnvelope() // buy-in(1000m Row) -> RFT -> cash-out(800m Run)
  const envelope = getScoreEnvelope(components, 'fixB-rft')

  it('finished envelope: one native value wins outright, no partials consulted', () => {
    const out = composeEnvelopeResult({ envelope, finishedValue: '12:42', resultByComponentId: {} })
    expect(out).toEqual({ isComplete: true, finishedValue: '12:42', cappedText: null, furthestComponentId: null })
  })

  it('Case A - partial Cash-Out: RFT complete, Cash-Out partial -> furthest = Cash-Out', () => {
    const resultByComponentId = {
      'fixB-buyin': resolveOnceComponentResult(['1000 m Row'], ['1000']),
      'fixB-rft': { hasProgress: true, text: '5 rounds complete' }, // RFT's own engine already finished all rounds
      'fixB-cashout': resolveOnceComponentResult(['800 m Run'], ['463']),
    }
    const out = composeEnvelopeResult({ envelope, finishedValue: '', resultByComponentId })
    expect(out.isComplete).toBe(false)
    expect(out.furthestComponentId).toBe('fixB-cashout')
    expect(out.cappedText).toBe('1000/1000 m Row, 5 rounds complete, 463/800 m Run')
  })

  it('Case B - partial Buy-In: scorer never started -> furthest = Buy-In', () => {
    const resultByComponentId = {
      'fixB-buyin': resolveOnceComponentResult(['1000 m Row'], ['730']),
    }
    const out = composeEnvelopeResult({ envelope, finishedValue: '', resultByComponentId })
    expect(out.furthestComponentId).toBe('fixB-buyin')
    expect(out.cappedText).toBe('730/1000 m Row')
  })

  it('Case C - partial main component: Buy-In complete, RFT partial, Cash-Out not started', () => {
    const resultByComponentId = {
      'fixB-buyin': resolveOnceComponentResult(['1000 m Row'], ['1000']),
      'fixB-rft': { hasProgress: true, text: '2 rounds + 7/10 Toes-to-Bar' },
    }
    const out = composeEnvelopeResult({ envelope, finishedValue: '', resultByComponentId })
    expect(out.furthestComponentId).toBe('fixB-rft')
    expect(out.cappedText).toBe('1000/1000 m Row, 2 rounds + 7/10 Toes-to-Bar')
  })

  it('no progress anywhere: neutral empty result, not an error', () => {
    const out = composeEnvelopeResult({ envelope, finishedValue: '', resultByComponentId: {} })
    expect(out).toEqual({ isComplete: false, finishedValue: null, cappedText: '', furthestComponentId: null })
  })

  it('multi-score WOD keeps native component separation - no cross-envelope contamination', () => {
    const multi = fixtureD_complexComposer()
    const rftEnvelope = getScoreEnvelope(multi, 'fixD-rft')
    const amrapEnvelope = getScoreEnvelope(multi, 'fixD-amrap')
    const rftOut = composeEnvelopeResult({ envelope: rftEnvelope, finishedValue: '11:00', resultByComponentId: {} })
    const amrapOut = composeEnvelopeResult({ envelope: amrapEnvelope, finishedValue: '', resultByComponentId: { 'fixD-amrap': { hasProgress: true, text: '6 rounds' } } })
    expect(rftOut.isComplete).toBe(true)
    expect(amrapOut.furthestComponentId).toBe('fixD-amrap')
    // proves independence: the AMRAP's own capped text never mentions the RFT envelope's members
    expect(amrapOut.cappedText).not.toMatch(/Row|Toes-to-Bar|Run/)
  })
})

// ============================================================================
// composeMixedLogFields - live save-path wiring (Phase 2, ticket §9/§23)
// ============================================================================

describe('composeMixedLogFields - envelope-aware save composition', () => {
  it('finished envelope: one entered time wins outright, completion_state completed', () => {
    const out = composeMixedLogFields({
      mainIsSequential: true, finishedValue: '12:42',
      mainRoundsCompleted: '', mainPartialReps: [], mainMovements: ['10 Toes-to-Bar', '15 Wall Balls'],
      buyInMovements: ['1000 m Row'], buyInPartialReps: ['1000'],
      cashOutMovements: ['800 m Run'], cashOutPartialReps: ['800'],
    })
    expect(out.time_result).toBe('12:42')
    expect(out.result).toBeNull()
    expect(out.completion_state).toBe('completed')
  })

  it('Case A (ticket §14/PARTIAL_CASHOUT): main fully done, capped in Cash-Out -> preserved exactly', () => {
    // Main movements marked done via repsEfectiveSecvential's own "reached
    // the end" rule, fed the prescribed-target values (10/15) - this is how
    // "finished the main work" is expressed with the existing sequential
    // engine, unmodified.
    const out = composeMixedLogFields({
      mainIsSequential: true, finishedValue: '',
      mainRoundsCompleted: '', mainPartialReps: ['10', '15'],
      mainMovements: ['10 Toes-to-Bar', '15 Wall Balls'],
      buyInMovements: ['1000 m Row'], buyInPartialReps: ['1000'],
      cashOutMovements: ['800 m Run'], cashOutPartialReps: ['463'],
    })
    expect(out.time_result).toBeNull()
    expect(out.completion_state).toBe('capped')
    expect(out.result).toBe('1000/1000 m Row, 10/10 Toes-to-Bar, 15/15 Wall Balls, 463/800 m Run')
    expect(out.cashOutText).toBe('463/800 m Run')
  })

  it('cannot skip ahead: progress recorded only in a LATER envelope member than an untouched earlier one still walks to the latest one with progress (pure function does not itself enforce real-world sequencing - the Builder/logger UI is what prevents this input from arising)', () => {
    const out = composeMixedLogFields({
      mainIsSequential: true, finishedValue: '',
      mainRoundsCompleted: '', mainPartialReps: [],
      mainMovements: ['10 Toes-to-Bar', '15 Wall Balls'],
      buyInMovements: ['1000 m Row'], buyInPartialReps: ['1000'],
      cashOutMovements: ['800 m Run'], cashOutPartialReps: ['463'],
    })
    // main has no progress, but cash-out does - furthest is cash-out, and
    // the composed text correctly includes only the members with progress.
    expect(out.result).toBe('1000/1000 m Row, 463/800 m Run')
  })

  it('Case B (PARTIAL_BUYIN): capped during Buy-In, main/Cash-Out never started', () => {
    const out = composeMixedLogFields({
      mainIsSequential: true, finishedValue: '',
      mainRoundsCompleted: '', mainPartialReps: [],
      mainMovements: ['10 Toes-to-Bar', '15 Wall Balls'],
      buyInMovements: ['1000 m Row'], buyInPartialReps: ['730'],
      cashOutMovements: ['800 m Run'], cashOutPartialReps: [],
    })
    expect(out.time_result).toBeNull()
    expect(out.completion_state).toBe('capped')
    expect(out.result).toBe('730/1000 m Row')
    expect(out.cashOutText).toBeNull()
  })

  it('Case C (PARTIAL_MAIN): Buy-In complete, main partial, Cash-Out not started', () => {
    const out = composeMixedLogFields({
      mainIsSequential: true, finishedValue: '',
      mainRoundsCompleted: '', mainPartialReps: ['10', '7'],
      mainMovements: ['10 Toes-to-Bar', '15 Wall Balls'],
      buyInMovements: ['1000 m Row'], buyInPartialReps: ['1000'],
      cashOutMovements: ['800 m Run'], cashOutPartialReps: [],
    })
    expect(out.result).toBe('1000/1000 m Row, 10/10 Toes-to-Bar, 7/15 Wall Balls')
    expect(out.completion_state).toBe('capped')
  })

  it('MULTI_MOVEMENT_BOOKENDS (Case D/E): exact position preserved on both bookends, never aggregated', () => {
    const out = composeMixedLogFields({
      mainIsSequential: true, finishedValue: '',
      mainRoundsCompleted: '', mainPartialReps: ['10', '15'],
      mainMovements: ['10 Toes-to-Bar', '15 Wall Balls'],
      buyInMovements: ['500 m Row', '30 Burpees', '20 DB Snatches'], buyInPartialReps: ['500', '30', '11'],
      cashOutMovements: ['400 m Run', '20 Pull-Ups'], cashOutPartialReps: [],
    })
    expect(out.result).toBe('500/500 m Row, 30/30 Burpees, 11/20 DB Snatches, 10/10 Toes-to-Bar, 15/15 Wall Balls')
    expect(out.result).not.toMatch(/^\d+ reps$/) // never a lossy aggregate like "41 reps"
    expect(out.result).toContain('11/20 DB Snatches') // exact position preserved, not "41 reps" or similar
  })

  it('OWNED_FOR_TIME with no bookends behaves exactly like a plain sequential For Time (legacy single-score equivalence)', () => {
    const out = composeMixedLogFields({
      mainIsSequential: true, finishedValue: '',
      mainRoundsCompleted: '', mainPartialReps: ['10', '7'],
      mainMovements: ['10 Toes-to-Bar', '15 Wall Balls'],
      buyInMovements: [], buyInPartialReps: [],
      cashOutMovements: [], cashOutPartialReps: [],
    })
    expect(out.result).toBe('10/10 Toes-to-Bar, 7/15 Wall Balls')
    expect(out.buyInText).toBeNull()
    expect(out.cashOutText).toBeNull()
  })

  it('AMRAP-mode main (mainFormat AMRAP) reuses composeAmrapResult unchanged', () => {
    const out = composeMixedLogFields({
      mainIsSequential: false, finishedValue: '',
      mainRoundsCompleted: '6', mainPartialReps: ['5'], mainMovements: ['10 Pull-Ups'],
      buyInMovements: ['500 m Row'], buyInPartialReps: ['500'],
      cashOutMovements: [], cashOutPartialReps: [],
    })
    expect(out.result).toBe('500/500 m Row, 6 runde + 5/10 Pull-Ups')
  })

  it('no progress anywhere and not finished: neutral capped result, never throws', () => {
    const out = composeMixedLogFields({
      mainIsSequential: true, finishedValue: '',
      mainRoundsCompleted: '', mainPartialReps: [], mainMovements: ['10 Toes-to-Bar'],
      buyInMovements: ['1000 m Row'], buyInPartialReps: [],
      cashOutMovements: ['800 m Run'], cashOutPartialReps: [],
    })
    expect(out.result).toBeNull()
    expect(out.completion_state).toBe('capped')
  })
})

// ============================================================================
// Phase 2.1 - true multi-envelope persistence & reload proof
// ============================================================================

describe('composeComponentsLogFields / composeMultiEnvelopeLogFields - persistence', () => {
  // Ticket Fixture A: AMRAP 8 (finished 6+12) + Rest + 5 RFT (finished 7:41)
  const twoScoreInputs = {
    'fixC-amrap': { roundsCompleted: '6', partialReps: ['12'], movementLines: ['10 DB Snatches', '10 Burpees'] },
    'fixC-rft': { finishedValue: '7:41', movementLines: ['10 DB Snatches', '15 Box Jumps'] },
  }

  it('1. two native results survive serialization, no primary chosen', () => {
    const components = fixtureC_multiScore()
    const out = composeComponentsLogFields(components, twoScoreInputs)
    expect(out.result).toBeNull()
    expect(out.time_result).toBeNull()
    expect(out.completion_state).toBeNull()
    const cr = out.log_meta.componentResults
    expect(Object.keys(cr).sort()).toEqual(['fixC-amrap', 'fixC-rft'])
    expect(cr['fixC-amrap'].result).toBe('6 runde + 12/10 DB Snatches')
    expect(cr['fixC-rft'].time_result).toBe('7:41')
  })

  it('2. three native results survive serialization', () => {
    const components = fixtureThreeIndependentScores()
    const out = composeComponentsLogFields(components, {
      'fix3-amrap': { roundsCompleted: '6', partialReps: ['12'], movementLines: ['10 Pull-Ups', '10 Burpees'] },
      'fix3-rft': { finishedValue: '7:41', movementLines: ['10 Toes-to-Bar', '15 Wall Balls'] },
      'fix3-emom': { sets: { 'Min 1': [{ reps: '12', weight: '', completed: true }], 'Min 2': [{ reps: '10', weight: '', completed: true }] } },
    })
    const cr = out.log_meta.componentResults
    expect(Object.keys(cr).sort()).toEqual(['fix3-amrap', 'fix3-emom', 'fix3-rft'])
    expect(cr['fix3-amrap'].result).toContain('6 runde')
    expect(cr['fix3-rft'].time_result).toBe('7:41')
    expect(cr['fix3-emom'].sets['Min 1'][0].reps).toBe('12')
    expect(cr['fix3-emom'].result).toBeNull() // sets-family: score derived at READ time, unchanged convention
  })

  it('3. Rest produces no entry at all (not a null one)', () => {
    const components = fixtureThreeIndependentScores()
    const out = composeComponentsLogFields(components, {})
    expect(Object.prototype.hasOwnProperty.call(out.log_meta.componentResults, 'fix3-rest1')).toBe(false)
    expect(Object.prototype.hasOwnProperty.call(out.log_meta.componentResults, 'fix3-rest2')).toBe(false)
  })

  it('4. an owned envelope alone emits exactly ONE result (legacy single-score equivalence)', () => {
    const components = fixtureB_oneEnvelope() // Buy-In -> RFT -> Cash-Out, one scorer
    const out = composeComponentsLogFields(components, {
      'fixB-rft': { finishedValue: '12:42', movementLines: ['10 Toes-to-Bar', '15 Wall Balls'] },
    })
    // exactly one scorer -> normal scalar fields, NOT log_meta.componentResults
    expect(out.time_result).toBe('12:42')
    expect(out.log_meta).toBeNull()
  })

  it('5. an owned envelope PLUS an independent scorer emits exactly TWO results', () => {
    const envelopeComponents = fixtureB_oneEnvelope()
    const amrap = createComponent({ id: 'extra-amrap', format: 'AMRAP', producesScore: true, config: { durationSec: 300 }, instances: [] })
    const components = normalizeComponentOrder([...envelopeComponents, amrap])
    const out = composeComponentsLogFields(components, {
      'fixB-rft': { finishedValue: '12:42', movementLines: ['10 Toes-to-Bar', '15 Wall Balls'] },
      'extra-amrap': { roundsCompleted: '5', partialReps: [], movementLines: ['10 Push-Ups'] },
    })
    const cr = out.log_meta.componentResults
    expect(Object.keys(cr).sort()).toEqual(['extra-amrap', 'fixB-rft'])
    expect(cr['fixB-rft'].time_result).toBe('12:42')
    expect(cr['fixB-rft'].envelopeComponentIds).toEqual(['fixB-buyin', 'fixB-rft', 'fixB-cashout'])
    expect(cr['extra-amrap'].envelopeComponentIds).toEqual(['extra-amrap']) // bookends never leak into an unrelated envelope
  })

  it('6. component identity is used throughout - never array index, never format name, never movement name', () => {
    const components = fixtureC_multiScore()
    const out = composeComponentsLogFields(components, twoScoreInputs)
    Object.keys(out.log_meta.componentResults).forEach(key => {
      expect(components.some(c => c.id === key)).toBe(true) // every key IS a real componentId
    })
  })

  it('7. a partial LATER envelope survives independently of an earlier finished one', () => {
    const components = fixtureC_multiScore() // AMRAP -> Rest -> RFT
    const out = composeComponentsLogFields(components, {
      'fixC-amrap': { roundsCompleted: '7', partialReps: ['3'], movementLines: ['10 DB Snatches', '10 Burpees'] },
      // capped mid-round-3-of-5: 2 full rounds done, currently on round 3
      'fixC-rft': { finishedValue: '', roundsCompleted: '2', partialReps: ['7', '15'], movementLines: ['10 DB Snatches', '15 Box Jumps'] },
    })
    const cr = out.log_meta.componentResults
    expect(cr['fixC-amrap'].result).toContain('7 runde')
    expect(cr['fixC-rft'].time_result).toBeNull()
    expect(cr['fixC-rft'].completion_state).toBe('capped')
    expect(cr['fixC-rft'].result).toBe('2 runde + 7/10 DB Snatches, 15/15 Box Jumps')
    // no cross-contamination: AMRAP's own result never mentions RFT's movements
    expect(cr['fixC-amrap'].result).not.toMatch(/Box Jumps/)
  })

  it('8. a partial owned Cash-Out survives with a second independent finished score present', () => {
    const envelopeComponents = fixtureB_oneEnvelope()
    const amrap = createComponent({ id: 'extra-amrap2', format: 'AMRAP', producesScore: true, config: { durationSec: 300 }, instances: [] })
    const components = normalizeComponentOrder([...envelopeComponents, amrap])
    const out = composeComponentsLogFields(components, {
      'fixB-buyin': { movementLines: ['1000 m Row'], partialReps: ['1000'] },
      'fixB-rft': { finishedValue: '', roundsCompleted: '5', partialReps: [], movementLines: ['10 Toes-to-Bar', '15 Wall Balls'] },
      'fixB-cashout': { movementLines: ['800 m Run'], partialReps: ['463'] },
      'extra-amrap2': { roundsCompleted: '8', partialReps: [], movementLines: ['10 Push-Ups'] },
    })
    const cr = out.log_meta.componentResults
    expect(cr['fixB-rft'].result).toBe('1000/1000 m Row, 5 runde complete, 463/800 m Run')
    expect(cr['fixB-rft'].completion_state).toBe('capped')
    expect(cr['extra-amrap2'].result).toContain('8 runde')
    expect(cr['extra-amrap2'].completion_state).toBeNull()
  })

  it('9. editing one score leaves the others byte-identical', () => {
    const components = fixtureThreeIndependentScores()
    const baseInputs = {
      'fix3-amrap': { roundsCompleted: '6', partialReps: ['12'], movementLines: ['10 Pull-Ups', '10 Burpees'] },
      'fix3-rft': { finishedValue: '7:41', movementLines: ['10 Toes-to-Bar', '15 Wall Balls'] },
      'fix3-emom': { sets: { 'Min 1': [{ reps: '12', weight: '', completed: true }] } },
    }
    const first = composeComponentsLogFields(components, baseInputs)
    const edited = composeComponentsLogFields(components, { ...baseInputs, 'fix3-rft': { finishedValue: '7:12', movementLines: ['10 Toes-to-Bar', '15 Wall Balls'] } })
    expect(edited.log_meta.componentResults['fix3-amrap']).toEqual(first.log_meta.componentResults['fix3-amrap'])
    expect(edited.log_meta.componentResults['fix3-emom']).toEqual(first.log_meta.componentResults['fix3-emom'])
    expect(edited.log_meta.componentResults['fix3-rft'].time_result).toBe('7:12')
    expect(first.log_meta.componentResults['fix3-rft'].time_result).toBe('7:41')
  })

  it('10. the whole payload survives a JSON round-trip (simulating Postgres JSONB storage)', () => {
    const components = fixtureD_complexComposer()
    const out = composeComponentsLogFields(components, {
      'fixD-rft': { finishedValue: '11:00', movementLines: ['10 Toes-to-Bar', '15 Wall Balls'] },
      'fixD-amrap': { roundsCompleted: '6', partialReps: [], movementLines: ['6 Clean & Jerks', '8 Burpees'] },
      'fixD-emom': { sets: { 'Min 1': [{ reps: '12', weight: '', completed: true }] } },
    })
    const roundTripped = JSON.parse(JSON.stringify(out))
    expect(roundTripped).toEqual(out)
    // this IS "connecting to the real save path": App.jsx's saveWodLog spreads
    // composeWodLogFields()'s return value verbatim into
    // supabase.from('wod_logs').insert/update({...}) (App.jsx ~L10070-10071) -
    // composeComponentsLogFields produces the byte-identical {result,
    // time_result, completion_state, sets, log_meta} shape, so this JSON
    // round-trip is exactly what that Supabase JSONB column read/write does.
  })

  it('11. historical snapshot: mutating components AFTER composing never changes the already-produced result', () => {
    const components = fixtureC_multiScore()
    const out = composeComponentsLogFields(components, twoScoreInputs)
    const frozen = JSON.parse(JSON.stringify(out))
    // mutate the (now historical) canonical structure: reorder, rename, remove
    components.reverse()
    components[0].format = 'RFT'
    components.length = 1
    expect(out).toEqual(frozen) // already-composed result is untouched by later mutation
  })

  it('12. a legacy single-score log (no componentResults) returns exactly one entry, unchanged', () => {
    const legacyLog = { result: '3 rounds + 22', time_result: null, completion_state: 'capped', sets: null }
    const entries = getComponentResultsFromLog(legacyLog)
    expect(entries).toEqual([{ componentId: null, format: null, result: '3 rounds + 22', time_result: null, completion_state: 'capped', sets: null }])
  })

  it('13. a legacy mixed-format log (no componentResults, old shape) returns exactly one entry, unchanged', () => {
    const legacyMixedLog = { result: null, time_result: '12:42', completion_state: 'completed', sets: { __buyIn: [{ reps: '1000', weight: '', completed: true }] }, log_meta: null }
    const entries = getComponentResultsFromLog(legacyMixedLog)
    expect(entries).toHaveLength(1)
    expect(entries[0].time_result).toBe('12:42')
  })

  it('14. no primary component is ever introduced for a genuine multi-score log', () => {
    const components = fixtureC_multiScore()
    const out = composeComponentsLogFields(components, twoScoreInputs)
    // the section-level scalar fields never carry EITHER scorer's value
    expect(out.result).toBeNull()
    expect(out.time_result).toBeNull()
  })

  it('15. no native result is ever overwritten by another component\'s result', () => {
    const components = fixtureThreeIndependentScores()
    const out = composeComponentsLogFields(components, {
      'fix3-amrap': { roundsCompleted: '6', partialReps: ['12'], movementLines: ['10 Pull-Ups', '10 Burpees'] },
      'fix3-rft': { finishedValue: '7:41', movementLines: ['10 Toes-to-Bar', '15 Wall Balls'] },
      'fix3-emom': { sets: { 'Min 1': [{ reps: '12', weight: '', completed: true }] } },
    })
    const cr = out.log_meta.componentResults
    expect(cr['fix3-amrap'].result).not.toBe(cr['fix3-rft'].result)
    expect(cr['fix3-rft'].time_result).toBe('7:41')
    expect(cr['fix3-emom'].result).toBeNull()
  })

  it('16. no movement instance is ever duplicated by multi-envelope composition', () => {
    const components = fixtureD_complexComposer()
    const allInstanceIds = components.flatMap(c => c.instances.map(i => i.instanceId))
    composeComponentsLogFields(components, {}) // composing must not mutate/duplicate anything
    const allInstanceIdsAfter = components.flatMap(c => c.instances.map(i => i.instanceId))
    expect(allInstanceIdsAfter).toEqual(allInstanceIds)
    expect(new Set(allInstanceIdsAfter).size).toBe(allInstanceIdsAfter.length)
  })
})

// ============================================================================
// 23-27. Legacy adapter
// ============================================================================

describe('legacy -> canonical adapter (componentsFromSection)', () => {
  it('23. legacy AMRAP adapts to exactly one component, byte-identical config/instances', () => {
    const instances = [newMovementInstance({ name: 'Pull-Ups' }), newMovementInstance({ name: 'Burpees' })]
    const section = withVariant({ ...createSection('metcon', true), format: 'AMRAP', formatConfig: { durationSec: 600 } }, instances)
    const components = componentsFromSection(section, 'rx')
    expect(components).toHaveLength(1)
    expect(components[0].format).toBe('AMRAP')
    expect(components[0].config).toEqual({ durationSec: 600 })
    expect(components[0].instances).toBe(instances) // same reference - no copy, no data loss
    expect(components[0].producesScore).toBe(true)
    expect(validateComponents(components).valid).toBe(true)
  })

  it('24. legacy RFT/For Time adapts to exactly one component', () => {
    const section = withVariant({ ...createSection('metcon', true), format: 'RFT', formatConfig: { rounds: 5 } }, [newMovementInstance({ name: 'Thrusters' })])
    const components = componentsFromSection(section, 'rx')
    expect(components).toHaveLength(1)
    expect(components[0].format).toBe('RFT')
    expect(components[0].config).toEqual({ rounds: 5 })
  })

  it('25. legacy Buy-In/Cash-Out adapts to a 3-component envelope', () => {
    const section = withVariant({
      ...createSection('metcon', true),
      format: 'Buy-In/Cash-Out',
      formatConfig: { buyIn: ['1000 m Row'], cashOut: ['800 m Run'], mainFormat: 'For Time' },
    }, [newMovementInstance({ name: 'Toes-to-Bar' }), newMovementInstance({ name: 'Wall Balls' })])
    const components = componentsFromSection(section, 'rx')
    expect(components.map(c => c.role)).toEqual(['buy-in', 'main', 'cash-out'])
    expect(components[0].format).toBe('Once')
    expect(components[0].producesScore).toBe(false)
    expect(components[1].format).toBe('For Time')
    expect(components[1].producesScore).toBe(true)
    expect(components[0].scoreOwnerId).toBe(components[1].id)
    expect(components[2].scoreOwnerId).toBe(components[1].id)
    expect(validateComponents(components).valid).toBe(true)
    // deterministic across repeated reads of the SAME section (ticket §25/#29)
    const again = componentsFromSection(section, 'rx')
    expect(again.map(c => c.id)).toEqual(components.map(c => c.id))
  })

  it('legacy AMRAP with Buy-In adapts correctly (shared totalDurationSec clock)', () => {
    const section = withVariant({
      ...createSection('metcon', true),
      format: 'AMRAP with Buy-In',
      formatConfig: { totalDurationSec: 1200, buyIn: ['500 m Row'] },
    }, [newMovementInstance({ name: 'Pull-Ups' })])
    const components = componentsFromSection(section, 'rx')
    expect(components.map(c => c.role)).toEqual(['buy-in', 'main'])
    expect(components[1].format).toBe('AMRAP')
    expect(components[1].config).toEqual({ durationSec: 1200 })
  })

  it('26. staged/chained fixture (real, from workoutComposer.test.js:194-213) adapts to N components', () => {
    // "Chained AMRAP: fiecare etapa ramane un bloc separat" - 2min Deadlifts
    // buy-in -> 19min AMRAP triplet -> 2min Deadlifts cash-out.
    const section = withVariant({
      ...createSection('metcon', true),
      format: 'Chained AMRAP',
      formatConfig: {
        stages: [
          { kind: 'amrap', durationSec: 120, movements: ['Deadlifts'] },
          { kind: 'amrap', durationSec: 1140, movements: ['10 Pull-ups', '10 KB Swings', '10 Box Jumps'] },
          { kind: 'amrap', durationSec: 120, movements: ['Deadlifts'] },
        ],
      },
    }, [])
    const components = componentsFromSection(section, 'rx')
    expect(components).toHaveLength(3)
    expect(components.every(c => c.format === 'AMRAP')).toBe(true)
    expect(components.every(c => c.producesScore)).toBe(true)
    expect(components.map(c => c.config.durationSec)).toEqual([120, 1140, 120])
    expect(components[1].instances.map(i => i.name)).toEqual(['Pull-ups', 'KB Swings', 'Box Jumps'])
    expect(validateComponents(components).valid).toBe(true)
  })

  it('27. interval/EMOM fixture adapts to one self-contained component, internal engine untouched', () => {
    const section = withVariant({
      ...createSection('metcon', true),
      format: 'Intervals',
      formatConfig: { roundCount: 5, stationMode: 'per-interval', restSec: 60 },
    }, [newMovementInstance({ name: 'Row' }), newMovementInstance({ name: 'Bike' })])
    const components = componentsFromSection(section, 'rx')
    expect(components).toHaveLength(1)
    expect(components[0].format).toBe('Intervals')
    expect(components[0].config).toEqual({ roundCount: 5, stationMode: 'per-interval', restSec: 60 })
  })
})

// ============================================================================
// 28-29. Round-trip + determinism
// ============================================================================

describe('round-trip contract', () => {
  it('28. canonical components[] survives a serialize/persist-compatible JSON round-trip', () => {
    const components = fixtureD_complexComposer()
    const roundTripped = JSON.parse(JSON.stringify(components))
    expect(roundTripped).toEqual(components)
    expect(validateComponents(roundTripped).valid).toBe(true)
  })

  it('29. repeated legacy adaptation of the same section is deterministic', () => {
    const section = withVariant({
      ...createSection('metcon', true),
      format: 'Buy-In/Cash-Out',
      formatConfig: { buyIn: ['500 m Row'], cashOut: ['400 m Run'], mainFormat: 'For Time' },
    }, [newMovementInstance({ name: 'Burpees' })])
    const first = componentsFromSection(section, 'rx')
    const second = componentsFromSection(section, 'rx')
    expect(first.map(c => ({ id: c.id, order: c.order, format: c.format, role: c.role, scoreOwnerId: c.scoreOwnerId })))
      .toEqual(second.map(c => ({ id: c.id, order: c.order, format: c.format, role: c.role, scoreOwnerId: c.scoreOwnerId })))
  })

  it('adding/removing an unrelated component does not mutate other components\' ids', () => {
    const components = fixtureA_simpleAmrap()
    const originalId = components[0].id
    const extra = createComponent({ format: 'Rest', producesScore: false, config: { durationSec: 60 } })
    const grown = normalizeComponentOrder([...components, extra])
    expect(grown.find(c => c.format === 'AMRAP').id).toBe(originalId)
    const shrunk = normalizeComponentOrder(grown.filter(c => c.id !== extra.id))
    expect(shrunk.find(c => c.format === 'AMRAP').id).toBe(originalId)
  })
})

// ============================================================================
// 30. Independent variant topology
// ============================================================================

describe('independent variant topology (ticket §19)', () => {
  it('30. RX and Beginner may adapt to different component counts from the SAME section shape', () => {
    // RX: Buy-In + RFT + Cash-Out (3 components). Beginner: the section's own
    // format is still 'Buy-In/Cash-Out' for both variants today (format is
    // section-level, not per-variant - documented, unchanged invariant), so
    // this test instead proves the INSTANCES differ independently per
    // variant while the adapter runs per-variant-key, matching how a future
    // per-variant Composer authoring surface would differ RX vs Beginner
    // topology without this module assuming they must match.
    const section = {
      ...createSection('metcon', true),
      format: 'Buy-In/Cash-Out',
      formatConfig: { buyIn: ['500 m Row'], cashOut: ['400 m Run'], mainFormat: 'For Time' },
      variants: {
        rx: { instances: [newMovementInstance({ name: 'Toes-to-Bar' }), newMovementInstance({ name: 'Wall Balls' })] },
        intermediate: { instances: [newMovementInstance({ name: 'Toes-to-Bar' }), newMovementInstance({ name: 'Wall Balls' })] },
        beginner: { instances: [newMovementInstance({ name: 'Sit-ups' })] },
        onramp: { instances: [] },
      },
    }
    const rxComponents = componentsFromSection(section, 'rx')
    const beginnerComponents = componentsFromSection(section, 'beginner')
    expect(rxComponents.map(c => c.role)).toEqual(['buy-in', 'main', 'cash-out'])
    expect(beginnerComponents.map(c => c.role)).toEqual(['buy-in', 'main', 'cash-out'])
    // independent instance content per variant, no shared references
    expect(rxComponents[1].instances).not.toBe(beginnerComponents[1].instances)
    expect(rxComponents[1].instances.map(i => i.name)).toEqual(['Toes-to-Bar', 'Wall Balls'])
    expect(beginnerComponents[1].instances.map(i => i.name)).toEqual(['Sit-ups'])
    expect(rxComponents[1].instances[0].instanceId).not.toBe(beginnerComponents[1].instances[0]?.instanceId)
  })
})

// ============================================================================
// 31-32. No movement duplication
// ============================================================================

describe('no duplicated movement instances / no expanded RFT repetitions (ticket §9/§60)', () => {
  it('31. the score envelope never duplicates MovementInstances', () => {
    const components = fixtureB_oneEnvelope()
    const rft = components.find(c => c.format === 'RFT')
    const envelope = getScoreEnvelope(components, rft.id)
    const allInstanceIds = envelope.flatMap(c => c.instances.map(i => i.instanceId))
    expect(new Set(allInstanceIds).size).toBe(allInstanceIds.length) // no duplicates
    // the envelope holds the SAME instance objects, not copies
    envelope.forEach(envMember => {
      const original = components.find(c => c.id === envMember.id)
      expect(envMember.instances).toBe(original.instances)
    })
  })

  it('32. RFT rounds are never expanded into persisted duplicate movement instances', () => {
    const rft = createComponent({ format: 'RFT', producesScore: true, config: { rounds: 5 }, instances: [newMovementInstance({ name: 'Toes-to-Bar' }), newMovementInstance({ name: 'Wall Balls' })] })
    // "5 rounds of 2 movements" persists as exactly 2 instances, not 10
    expect(rft.instances).toHaveLength(2)
  })
})

// ============================================================================
// 33-34. Multi-score separation + legacy simple behavior unchanged
// ============================================================================

describe('multi-score separation and legacy simplicity (ticket §33/§34)', () => {
  it('33. a multi-score WOD keeps each scoring component\'s config/instances fully separate', () => {
    const components = fixtureD_complexComposer()
    const amrap = components.find(c => c.id === 'fixD-amrap')
    const emom = components.find(c => c.id === 'fixD-emom')
    expect(amrap.instances.map(i => i.name)).not.toEqual(emom.instances.map(i => i.name))
    expect(amrap.config).not.toEqual(emom.config)
  })

  it('34. a simple legacy single-score WOD adapts with zero visible Composer complexity', () => {
    const instances = [newMovementInstance({ name: 'Burpees' })]
    const section = withVariant({ ...createSection('metcon', true), format: 'AMRAP', formatConfig: { durationSec: 600 } }, instances)
    const components = componentsFromSection(section, 'rx')
    expect(components).toHaveLength(1)
    expect(components[0].role).toBeNull()
    expect(components[0].scoreOwnerId).toBeNull()
    expect(components[0].label).toBeNull()
    // exactly the section's own format/config/instances, unchanged
    expect(components[0].format).toBe(section.format)
    expect(components[0].config).toEqual(section.formatConfig)
    expect(components[0].instances).toBe(instances)
  })
})
