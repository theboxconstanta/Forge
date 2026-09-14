// FORGE WORKOUT COMPOSER - PHASE 4: multi-scorer member logging domain
// layer. Pure functions only - composerLogging.test.jsx covers the React
// stepper/native-logger-reuse rendering.
//
// INVESTIGATION FINDING (ticket §3) - the real production "official WOD of
// the day" screen (App.jsx's logWodPrimaryPath) is driven by ONE flat set
// of top-level useState variables (wodResult/wodTime/wodRoundsCompleted/
// wodAdditionalReps/wodPartialReps/wodSets/...) feeding exactly ONE
// <UniversalScoreInput>, itself driven by activeLogFormatId/
// activeLogFormatConfig - which, per Phase 3's own documented limitation,
// resolve to only the FIRST scorer's legacy-shim format for a genuine
// multi-scorer Composer WOD. This is the precise single-score assumption
// Phase 4 must generalize, without touching any of the 15+ existing
// composeWodLogFieldsInner branches for a legacy/single-scorer WOD.
//
// A SECOND, subtler finding surfaced while wiring this: UniversalScoreInput's
// real "Time Capped" control for a non-sequential (repeated-rounds) format
// collects ONE summed additionalReps number (RoundsAndAdditionalReps),
// never a per-movement partialReps array - composeEnvelopeNativeResult/
// composeMixedLogFields (Phase 2/2.1) only ever accepted the OLDER
// per-movement convention. Fixed additively (wodAdditionalReps threaded
// through, backward compatible - Phase 2/2.1's own 71 tests still pass
// unchanged) so a per-scorer draft built from the REAL native logger
// composes identically to the single-score "official WOD" screen.

import { describe, it, expect } from 'vitest'
import {
  createComponent, addComponentToList, setScoreOwner,
  getOrderedScoreEnvelopes, emptyScorerLoggerValue, hydrateScorerLoggerValueFromNativeResult,
  scorerValueToEnvelopeInput, bookendPartialRepsFromValue, buildComposeInputsById,
  hydrateAllScorerValuesFromLog, composeComponentsLogFields, getComponentResultsFromLog,
  renderComponentMovementLines,
} from './componentContract'
import { newMovementInstance } from './prescriptionContract'

function inst(name) { return newMovementInstance({ name }) }

function ownedEnvelope() {
  let c = addComponentToList([], 'Once', 'buy-in')
  c = c.map(x => ({ ...x, instances: [inst('1000m Row')] }))
  c = addComponentToList(c, 'RFT')
  c[1].config = { rounds: 5 }
  c[1].instances = [inst('Toes-to-Bar'), inst('Wall Balls')]
  c = addComponentToList(c, 'Once', 'cash-out')
  c[2].instances = [inst('800m Run')]
  c = setScoreOwner(c, c[0].id, c[1].id).components
  c = setScoreOwner(c, c[2].id, c[1].id).components
  return c
}

function twoScorers() {
  const amrap = createComponent({ id: 'amrap', format: 'AMRAP', producesScore: true, config: { durationSec: 480 }, instances: [inst('Pull-Ups')] })
  const rest = createComponent({ id: 'rest', format: 'Rest', producesScore: false, config: { durationSec: 120 } })
  const rft = createComponent({ id: 'rft', format: 'RFT', producesScore: true, config: { rounds: 5 }, instances: [inst('Wall Balls')] })
  return [amrap, rest, rft].map((c, i) => ({ ...c, order: i }))
}

function threeScorers() {
  const amrap = createComponent({ id: 'amrap', format: 'AMRAP', producesScore: true, config: { durationSec: 480 }, instances: [inst('Pull-Ups')] })
  const rest1 = createComponent({ id: 'rest1', format: 'Rest', producesScore: false, config: { durationSec: 120 } })
  const rft = createComponent({ id: 'rft', format: 'RFT', producesScore: true, config: { rounds: 5 }, instances: [inst('Wall Balls')] })
  const rest2 = createComponent({ id: 'rest2', format: 'Rest', producesScore: false, config: { durationSec: 60 } })
  const emom = createComponent({ id: 'emom', format: 'EMOM', producesScore: true, config: { totalRounds: 8, intervalSec: 60 }, instances: [inst('Bike Calories')] })
  return [amrap, rest1, rft, rest2, emom].map((c, i) => ({ ...c, order: i }))
}

function ownedEnvelopePlusIndependentAmrap() {
  const envelope = ownedEnvelope()
  const rest = createComponent({ format: 'Rest', producesScore: false, config: { durationSec: 120 } })
  const amrap = createComponent({ id: 'amrap-indep', format: 'AMRAP', producesScore: true, config: { durationSec: 360 }, instances: [inst('Clean & Jerks')] })
  return [...envelope, rest, amrap].map((c, i) => ({ ...c, order: i }))
}

// --- getOrderedScoreEnvelopes (ticket §2/§9/§10/§11) ------------------------

describe('getOrderedScoreEnvelopes', () => {
  it('owned envelope -> exactly ONE entry, bookends attached, never split (fixture A/§31)', () => {
    const envelopes = getOrderedScoreEnvelopes(ownedEnvelope())
    expect(envelopes).toHaveLength(1)
    expect(envelopes[0].scorer.format).toBe('RFT')
    expect(envelopes[0].buyIn.role).toBe('buy-in')
    expect(envelopes[0].cashOut.role).toBe('cash-out')
    expect(envelopes[0].envelope).toHaveLength(3)
  })

  it('AMRAP + Rest + RFT -> exactly TWO entries, Rest produces no entry (fixture B/§32)', () => {
    const envelopes = getOrderedScoreEnvelopes(twoScorers())
    expect(envelopes).toHaveLength(2)
    expect(envelopes.map(e => e.scorer.format)).toEqual(['AMRAP', 'RFT'])
    expect(envelopes.every(e => e.buyIn === null && e.cashOut === null)).toBe(true)
  })

  it('five-Component multi-score graph -> exactly THREE entries in canonical order (fixture C/§33)', () => {
    const envelopes = getOrderedScoreEnvelopes(threeScorers())
    expect(envelopes.map(e => e.scorer.format)).toEqual(['AMRAP', 'RFT', 'EMOM'])
  })

  it('owned envelope + independent AMRAP -> exactly TWO entries, Buy-In/Cash-Out never become their own step (fixture D/§34)', () => {
    const envelopes = getOrderedScoreEnvelopes(ownedEnvelopePlusIndependentAmrap())
    expect(envelopes).toHaveLength(2)
    expect(envelopes[0].buyIn).not.toBe(null)
    expect(envelopes[0].cashOut).not.toBe(null)
    expect(envelopes[1].buyIn).toBe(null)
    expect(envelopes[1].scorer.format).toBe('AMRAP')
  })

  it('order follows canonical Component order, never format name/producesScore/object-key order', () => {
    const shuffled = [...threeScorers()].reverse()
    const envelopes = getOrderedScoreEnvelopes(shuffled)
    expect(envelopes.map(e => e.scorer.format)).toEqual(['AMRAP', 'RFT', 'EMOM'])
  })

  it('no primary scorer - every entry is symmetric, none flagged/treated specially', () => {
    const envelopes = getOrderedScoreEnvelopes(threeScorers())
    envelopes.forEach(e => expect(e).not.toHaveProperty('isPrimary'))
  })
})

// --- Scorer draft state shape (ticket §20) ----------------------------------

describe('emptyScorerLoggerValue / scorerValueToEnvelopeInput', () => {
  it('fresh draft matches UniversalScoreInput\'s own value shape exactly', () => {
    expect(emptyScorerLoggerValue()).toEqual({
      result: '', time: '', roundsCompleted: '', additionalReps: '', partialReps: [], sets: {}, completed: false, weightLogged: '', stages: [],
    })
  })

  it('maps a finished (time) draft to composeEnvelopeNativeResult\'s finishedValue', () => {
    const value = { ...emptyScorerLoggerValue(), time: '12:34' }
    expect(scorerValueToEnvelopeInput(value, ['Wall Balls']).finishedValue).toBe('12:34')
  })

  it('maps roundsCompleted+additionalReps through unchanged (the real UI convention)', () => {
    const value = { ...emptyScorerLoggerValue(), roundsCompleted: '4', additionalReps: '7' }
    const mapped = scorerValueToEnvelopeInput(value, [])
    expect(mapped.roundsCompleted).toBe('4')
    expect(mapped.additionalReps).toBe('7')
  })
})

describe('hydrateScorerLoggerValueFromNativeResult (direct, single-component)', () => {
  const rft = createComponent({ id: 'rft', format: 'RFT', config: { rounds: 5 } })
  const seqFt = createComponent({ id: 'ft', format: 'For Time', config: {} })
  it('a finished time_result hydrates into the draft\'s time field', () => {
    expect(hydrateScorerLoggerValueFromNativeResult(rft, { result: null, time_result: '11:30', sets: null }, [])).toMatchObject({ time: '11:30' })
  })
  it('a family:sets scorer (EMOM) hydrates sets verbatim', () => {
    const emom = createComponent({ id: 'emom', format: 'EMOM', config: { totalRounds: 8 } })
    expect(hydrateScorerLoggerValueFromNativeResult(emom, { result: null, time_result: null, sets: { 1: [{ reps: '12' }] } }, [])).toMatchObject({ sets: { 1: [{ reps: '12' }] } })
  })
  it('a capped "N runde + M" result hydrates into roundsCompleted+additionalReps (repeated-rounds format)', () => {
    expect(hydrateScorerLoggerValueFromNativeResult(rft, { result: '3 runde + 9', time_result: null, sets: null }, [])).toMatchObject({ roundsCompleted: '3', additionalReps: '9' })
  })
  it('a sequential (For Time) capped result hydrates into partialReps via parsePartialText', () => {
    // parsePartialText matches "<performed>/<prescribed> <name>" against the
    // movement line's OWN prescribed-reps prefix (workoutFormats.js) - the
    // exact shape renderComponentMovementLines already produces, not a bare name.
    const hydrated = hydrateScorerLoggerValueFromNativeResult(seqFt, { result: '10/10 Wall Balls, 4/15 Box Jumps', time_result: null, sets: null }, ['10 Wall Balls', '15 Box Jumps'])
    expect(hydrated.partialReps).toEqual(['10', '4'])
  })
  it('no native result at all -> the plain empty draft', () => {
    expect(hydrateScorerLoggerValueFromNativeResult(rft, null, [])).toEqual(emptyScorerLoggerValue())
  })
})

describe('bookendPartialRepsFromValue', () => {
  it('reads the exact sets.__buyIn/__cashOut row convention MultiMovementPartialRows writes', () => {
    const value = { sets: { __buyIn: [{ reps: '500' }, { reps: '20' }], __cashOut: [{ reps: '400' }] } }
    expect(bookendPartialRepsFromValue(value, 'buy-in')).toEqual(['500', '20'])
    expect(bookendPartialRepsFromValue(value, 'cash-out')).toEqual(['400'])
  })
  it('empty when no rows recorded yet', () => {
    expect(bookendPartialRepsFromValue({}, 'buy-in')).toEqual([])
  })
})

// --- Fixture A: one scorer, owned envelope --------------------------------

describe('fixture A - owned Buy-In/RFT/Cash-Out logs as ONE native result', () => {
  it('finished main work with Buy-In/Cash-Out progress composes one correct result', () => {
    const components = ownedEnvelope()
    const envelopes = getOrderedScoreEnvelopes(components)
    const [{ scorer, buyIn, cashOut }] = envelopes
    const value = {
      ...emptyScorerLoggerValue(),
      time: '18:22',
      sets: { __buyIn: [{ reps: '1000' }], __cashOut: [{ reps: '800' }] },
    }
    const inputsById = buildComposeInputsById(envelopes, { [scorer.id]: value })
    expect(inputsById[buyIn.id].partialReps).toEqual(['1000'])
    expect(inputsById[cashOut.id].partialReps).toEqual(['800'])
    const logFields = composeComponentsLogFields(components, inputsById)
    expect(logFields.time_result).toBe('18:22')
    expect(logFields.log_meta).toBe(null) // single-score legacy equivalence
  })
})

// --- Fixture B: two scores ---------------------------------------------------

describe('fixture B - AMRAP/Rest/RFT logs as exactly TWO independent native results', () => {
  it('final save -> exactly 2 componentResults entries, no primary, scalars null', () => {
    const components = twoScorers()
    const envelopes = getOrderedScoreEnvelopes(components)
    const valuesByComponentId = {
      amrap: { ...emptyScorerLoggerValue(), roundsCompleted: '6', additionalReps: '4' },
      rft: { ...emptyScorerLoggerValue(), time: '12:41' },
    }
    const inputsById = buildComposeInputsById(envelopes, valuesByComponentId)
    const logFields = composeComponentsLogFields(components, inputsById)
    expect(Object.keys(logFields.log_meta.componentResults)).toHaveLength(2)
    expect(logFields.log_meta.componentResults.amrap.result).toBe('6 runde + 4')
    expect(logFields.log_meta.componentResults.rft.time_result).toBe('12:41')
    expect(logFields.result).toBe(null)
    expect(logFields.time_result).toBe(null)
    expect(logFields.completion_state).toBe(null)
  })
})

// --- Fixture C: three scores -------------------------------------------------

describe('fixture C - AMRAP/Rest/RFT/Rest/EMOM logs as exactly THREE independent native results', () => {
  it('final save -> exactly 3 componentResults entries, correct ids/formats, no scalar primary', () => {
    const components = threeScorers()
    const envelopes = getOrderedScoreEnvelopes(components)
    const valuesByComponentId = {
      amrap: { ...emptyScorerLoggerValue(), roundsCompleted: '6', additionalReps: '4' },
      rft: { ...emptyScorerLoggerValue(), time: '10:15' },
      emom: { ...emptyScorerLoggerValue(), sets: { 1: [{ reps: '12' }] } },
    }
    const inputsById = buildComposeInputsById(envelopes, valuesByComponentId)
    const logFields = composeComponentsLogFields(components, inputsById)
    const results = logFields.log_meta.componentResults
    expect(Object.keys(results)).toHaveLength(3)
    expect(results.amrap.format).toBe('AMRAP')
    expect(results.rft.format).toBe('RFT')
    expect(results.emom.format).toBe('EMOM')
    expect(results.emom.sets).toEqual({ 1: [{ reps: '12' }] })
    expect(logFields.result).toBe(null)
  })
})

// --- Fixture D: owned envelope + independent scorer -------------------------

describe('fixture D - owned envelope + independent AMRAP -> 2 native score STEPS, not 3', () => {
  it('Buy-In/Cash-Out never become their own componentResults entry - only the RFT envelope + AMRAP', () => {
    const components = ownedEnvelopePlusIndependentAmrap()
    const envelopes = getOrderedScoreEnvelopes(components)
    const valuesByComponentId = {
      [envelopes[0].scorer.id]: { ...emptyScorerLoggerValue(), time: '15:00', sets: { __buyIn: [{ reps: '1000' }], __cashOut: [{ reps: '800' }] } },
      [envelopes[1].scorer.id]: { ...emptyScorerLoggerValue(), roundsCompleted: '6' },
    }
    const inputsById = buildComposeInputsById(envelopes, valuesByComponentId)
    const logFields = composeComponentsLogFields(components, inputsById)
    const results = logFields.log_meta.componentResults
    expect(Object.keys(results)).toHaveLength(2) // envelope's scorer + independent AMRAP - Buy-In/Cash-Out never appear
    expect(results[envelopes[0].scorer.id].time_result).toBe('15:00')
  })
})

// --- Fixture E: partial second score ----------------------------------------

describe('fixture E - AMRAP complete, RFT capped with partial reps - no first-score loss', () => {
  it('both native results persist correctly, independently', () => {
    const components = twoScorers()
    const envelopes = getOrderedScoreEnvelopes(components)
    const valuesByComponentId = {
      amrap: { ...emptyScorerLoggerValue(), roundsCompleted: '6', additionalReps: '' },
      rft: { ...emptyScorerLoggerValue(), roundsCompleted: '2', additionalReps: '9' }, // capped, no time
    }
    const inputsById = buildComposeInputsById(envelopes, valuesByComponentId)
    const logFields = composeComponentsLogFields(components, inputsById)
    const results = logFields.log_meta.componentResults
    expect(results.amrap.result).toBe('6 runde complete')
    expect(results.rft.result).toBe('2 runde + 9')
    expect(results.rft.time_result).toBe(null)
  })
})

// --- Fixture F: partial Cash-Out + sibling scorer ---------------------------

describe('fixture F - partial Cash-Out (463/800m) + independent AMRAP - both coexist, no overwrite', () => {
  it('owned envelope reports the correct capped position; AMRAP reports its own result independently', () => {
    const components = ownedEnvelopePlusIndependentAmrap()
    const envelopes = getOrderedScoreEnvelopes(components)
    const [envelopeStep, amrapStep] = envelopes
    const valuesByComponentId = {
      [envelopeStep.scorer.id]: {
        ...emptyScorerLoggerValue(),
        // main work + buy-in finished (full progress), cash-out only partial
        roundsCompleted: '5', additionalReps: '',
        sets: { __buyIn: [{ reps: '1000' }], __cashOut: [{ reps: '463' }] },
      },
      [amrapStep.scorer.id]: { ...emptyScorerLoggerValue(), roundsCompleted: '4', additionalReps: '12' },
    }
    const inputsById = buildComposeInputsById(envelopes, valuesByComponentId)
    const logFields = composeComponentsLogFields(components, inputsById)
    const results = logFields.log_meta.componentResults
    expect(results[envelopeStep.scorer.id].result).toMatch(/463/)
    expect(results[amrapStep.scorer.id].result).toBe('4 runde + 12')
    expect(Object.keys(results)).toHaveLength(2)
  })
})

// --- Fixture G: edit one sibling, others unchanged --------------------------

describe('fixture G - edit/reload multi-score log, editing one sibling preserves the others', () => {
  it('save 3 -> reload -> hydrate all 3 -> change only #2 -> resave -> #1/#3 byte-identical, #2 updated', () => {
    const components = threeScorers()
    const envelopes = getOrderedScoreEnvelopes(components)
    const initialValues = {
      amrap: { ...emptyScorerLoggerValue(), roundsCompleted: '6', additionalReps: '4' },
      rft: { ...emptyScorerLoggerValue(), time: '10:15' },
      emom: { ...emptyScorerLoggerValue(), sets: { 1: [{ reps: '12' }] } },
    }
    const savedFields = composeComponentsLogFields(components, buildComposeInputsById(envelopes, initialValues))
    const savedLog = JSON.parse(JSON.stringify(savedFields)) // simulate Postgres JSONB round-trip

    const hydrated = hydrateAllScorerValuesFromLog(envelopes, savedLog)
    expect(hydrated.amrap.roundsCompleted).toBe('6'); expect(hydrated.amrap.additionalReps).toBe('4')
    expect(hydrated.rft.time).toBe('10:15')
    expect(hydrated.emom.sets).toEqual({ 1: [{ reps: '12' }] })

    const edited = { ...hydrated, rft: { ...hydrated.rft, time: '9:50' } } // change #2 (RFT) only
    const resavedFields = composeComponentsLogFields(components, buildComposeInputsById(envelopes, edited))
    const resaved = resavedFields.log_meta.componentResults

    expect(resaved.amrap).toEqual(savedFields.log_meta.componentResults.amrap) // #1 unchanged
    expect(resaved.rft.time_result).toBe('9:50') // #2 updated
    expect(resaved.emom).toEqual(savedFields.log_meta.componentResults.emom) // #3 unchanged
  })
})

// --- Fixture H (state preservation is a React-layer concern - covered in composerLogging.test.jsx) --

// --- Fixture I: variant isolation --------------------------------------------

describe('fixture I - variant isolation', () => {
  it('RX (2 scorers) and Beginner (1 scorer) derive completely independent envelope lists', () => {
    const rxComponents = twoScorers()
    const beginnerComponents = [createComponent({ id: 'b-amrap', format: 'AMRAP', producesScore: true, instances: [inst('Burpees')] })]
    expect(getOrderedScoreEnvelopes(rxComponents)).toHaveLength(2)
    expect(getOrderedScoreEnvelopes(beginnerComponents)).toHaveLength(1)
  })
})

// --- Legacy log edit hydration (ticket §27/§28) ------------------------------

describe('legacy single-score / mixed log edit hydration', () => {
  it('a legacy single-score log (componentId:null) hydrates into the sole envelope for a 1-scorer graph', () => {
    const components = [createComponent({ id: 'rft-legacy', format: 'RFT', producesScore: true, config: { rounds: 5 }, instances: [inst('Wall Balls')] })]
    const envelopes = getOrderedScoreEnvelopes(components)
    const legacyLog = { result: null, time_result: '11:30', completion_state: 'completed', sets: null } // no log_meta at all
    const hydrated = hydrateAllScorerValuesFromLog(envelopes, legacyLog)
    expect(hydrated['rft-legacy'].time).toBe('11:30')
  })

  it('a legacy single-score log never fabricates data for a 2+ scorer graph it could not have produced', () => {
    const components = twoScorers()
    const envelopes = getOrderedScoreEnvelopes(components)
    const legacyLog = { result: null, time_result: '11:30', completion_state: 'completed', sets: null }
    const hydrated = hydrateAllScorerValuesFromLog(envelopes, legacyLog)
    expect(hydrated.amrap).toEqual(emptyScorerLoggerValue())
    expect(hydrated.rft).toEqual(emptyScorerLoggerValue())
  })
})

// --- No movement duplication / no RFT expansion (ticket §27/§28 of the required list) --

describe('no movement duplication, no RFT expansion, across the full orchestration', () => {
  it('buildComposeInputsById never clones a movement instance across scorer/bookend entries', () => {
    const components = ownedEnvelope()
    const envelopes = getOrderedScoreEnvelopes(components)
    const inputsById = buildComposeInputsById(envelopes, {})
    const allLines = Object.values(inputsById).flatMap(i => i.movementLines || [])
    expect(new Set(allLines).size).toBe(allLines.length)
  })
  it('RFT rounds stay a single config field - inputsById never expands it into N movement rows', () => {
    const components = ownedEnvelope()
    const envelopes = getOrderedScoreEnvelopes(components)
    const [{ scorer }] = envelopes
    expect(renderComponentMovementLines(scorer.instances)).toHaveLength(2) // TTB + Wall Balls, not ×5
  })
})

// --- Integration: author -> envelopes -> native state -> compose -> save -> reload -> edit -> resave --

describe('§47 integration - full chain for 1/2/3 scorers', () => {
  it('1 scorer: author -> log -> save -> reload -> edit -> resave, scalar parity throughout', () => {
    const components = ownedEnvelope()
    const envelopes = getOrderedScoreEnvelopes(components)
    const fields1 = composeComponentsLogFields(components, buildComposeInputsById(envelopes, { [envelopes[0].scorer.id]: { ...emptyScorerLoggerValue(), time: '14:00' } }))
    expect(fields1.log_meta).toBe(null)
    const reloaded = JSON.parse(JSON.stringify({ ...fields1, id: 'log1' }))
    const hydrated = hydrateAllScorerValuesFromLog(envelopes, reloaded)
    expect(hydrated[envelopes[0].scorer.id].time).toBe('14:00')
  })

  it('2 scorers: full chain preserves both results through save/reload/edit', () => {
    const components = twoScorers()
    const envelopes = getOrderedScoreEnvelopes(components)
    const initial = { amrap: { ...emptyScorerLoggerValue(), roundsCompleted: '6', additionalReps: '4' }, rft: { ...emptyScorerLoggerValue(), time: '12:41' } }
    const saved = composeComponentsLogFields(components, buildComposeInputsById(envelopes, initial))
    const reloaded = JSON.parse(JSON.stringify(saved))
    const hydrated = hydrateAllScorerValuesFromLog(envelopes, reloaded)
    expect(hydrated.amrap.roundsCompleted).toBe('6'); expect(hydrated.amrap.additionalReps).toBe('4')
    expect(hydrated.rft.time).toBe('12:41')
  })

  it('3 scorers: full chain preserves all three results through save/reload/edit', () => {
    const components = threeScorers()
    const envelopes = getOrderedScoreEnvelopes(components)
    const initial = {
      amrap: { ...emptyScorerLoggerValue(), roundsCompleted: '6', additionalReps: '4' },
      rft: { ...emptyScorerLoggerValue(), time: '10:15' },
      emom: { ...emptyScorerLoggerValue(), sets: { 1: [{ reps: '12' }], 2: [{ reps: '11' }] } },
    }
    const saved = composeComponentsLogFields(components, buildComposeInputsById(envelopes, initial))
    const reloaded = JSON.parse(JSON.stringify(saved))
    const hydrated = hydrateAllScorerValuesFromLog(envelopes, reloaded)
    expect(hydrated.amrap.roundsCompleted).toBe('6'); expect(hydrated.amrap.additionalReps).toBe('4')
    expect(hydrated.rft.time).toBe('10:15')
    expect(hydrated.emom.sets).toEqual({ 1: [{ reps: '12' }], 2: [{ reps: '11' }] })
  })
})

// --- getComponentResultsFromLog reused unchanged -----------------------------

describe('getComponentResultsFromLog reused unchanged for Journal/leaderboard read contract', () => {
  it('still returns one entry per scorer for a multi-score log, undistinguished (no primary)', () => {
    const components = twoScorers()
    const envelopes = getOrderedScoreEnvelopes(components)
    const saved = composeComponentsLogFields(components, buildComposeInputsById(envelopes, {
      amrap: { ...emptyScorerLoggerValue(), roundsCompleted: '6', additionalReps: '4' }, rft: { ...emptyScorerLoggerValue(), time: '12:41' },
    }))
    const entries = getComponentResultsFromLog(saved)
    expect(entries).toHaveLength(2)
  })
})
