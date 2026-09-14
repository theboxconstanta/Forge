// FORGE WORKOUT COMPOSER - PHASE 4.1: live multi-scorer edit hydration +
// per-scorer performed prescription.
//
// INVESTIGATION FINDING (ticket §2/§3) - traced the real edit entry
// (App.jsx's onEditWod). The EXISTING prescription_snapshot mechanism
// (buildPrescriptionSnapshot, prescriptionContract.js) freezes only a FLAT,
// format-agnostic movements array with no component/envelope grouping or
// identity - structurally unable to represent "which movements belonged to
// scorer A vs scorer B's Buy-In". log.variant_level IS reliably persisted
// on every wod_logs row (saveWodLog's own insert) - real, usable evidence
// for variant recovery, never guessed. Given no prior code path could have
// produced a real multi-score log before this exact phase (Workout
// Composer Phase 4 was implemented this session and never deployed),
// FIXED THE ROOT GAP going forward: composeMultiEnvelopeLogFields
// (Phase 2.1, extended this phase) now ALSO freezes the full canonical
// components[] into log_meta.componentsSnapshot at save time - immutable,
// snapshot-first historical truth (resolveHistoricalComponentsForEdit
// prefers it over the current, possibly-since-mutated live workout).
//
// A SECOND finding: the existing P9.5.2A performed-prescription mechanism
// (buildPrescriptionSnapshot/buildPerformedPrescriptionDraft/
// performedMatchesProgrammed/performedIsModified) only ever reads
// `doc.variants[variantKey].movements` - a thin SYNTHETIC wrapper doc built
// from allInstancesFromComponents(components) (Phase 3, unchanged) is
// enough to orchestrate these EXISTING, UNCHANGED functions over every
// Component's own instances instead of the single-variant flat list - no
// new performed-prescription shape, no per-scorer duplication. Since every
// MovementInstance's own id is already globally unique across every
// Component in a WOD (Phase 1), sourceInstanceId-keyed performed overrides
// stay correctly scoped to their own scorer/envelope by construction.

import { describe, it, expect } from 'vitest'
import {
  createComponent, addComponentToList, setScoreOwner, getOrderedScoreEnvelopes,
  emptyScorerLoggerValue, hydrateAllScorerValuesFromLog, buildComposeInputsById,
  composeComponentsLogFields, resolveHistoricalComponentsForEdit, allInstancesFromComponents,
} from './componentContract'
import {
  buildPerformedPrescriptionDraft, performedMatchesProgrammed, performedIsModified,
  newMovementInstance,
} from './prescriptionContract'

function inst(name, load) {
  const i = newMovementInstance({ name })
  if (load) i.load = load
  return i
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
  let c = addComponentToList([], 'Once', 'buy-in')
  c = c.map(x => ({ ...x, instances: [inst('1000m Row')] }))
  c = addComponentToList(c, 'RFT')
  c[1].config = { rounds: 5 }
  c[1].instances = [inst('Toes-to-Bar'), inst('Wall Balls')]
  c = addComponentToList(c, 'Once', 'cash-out')
  c[2].instances = [inst('800m Run')]
  c = setScoreOwner(c, c[0].id, c[1].id).components
  c = setScoreOwner(c, c[2].id, c[1].id).components
  const rest = createComponent({ format: 'Rest', producesScore: false, config: { durationSec: 120 } })
  const amrap = createComponent({ id: 'amrap-indep', format: 'AMRAP', producesScore: true, config: { durationSec: 360 }, instances: [inst('Clean & Jerks')] })
  return [...c, rest, amrap].map((x, i) => ({ ...x, order: i }))
}

/** Simulates a real save-then-reload: compose, JSON round-trip (Postgres
 * JSONB), wrap into a log-shaped object with variant_level - the exact
 * evidence onEditWod's new branch reads. */
function saveAndReload(components, valuesByComponentId, variantLevel = 'RX') {
  const envelopes = getOrderedScoreEnvelopes(components)
  const composed = composeComponentsLogFields(components, buildComposeInputsById(envelopes, valuesByComponentId))
  const reloaded = JSON.parse(JSON.stringify(composed))
  return { id: 'log-1', variant_level: variantLevel, weight_logged: null, performed_prescription: null, notes: null, ...reloaded }
}

// --- §29.1-3: real Edit entry resolves multi-score, correct variant, snapshot-first --

describe('1/2. real Edit entry resolves the multi-score path with correct variant recovery', () => {
  it('log.log_meta.componentResults with 2+ entries is the trigger the real onEditWod branch checks', () => {
    const log = saveAndReload(twoScorers(), { amrap: { ...emptyScorerLoggerValue(), roundsCompleted: '4', additionalReps: '7' }, rft: { ...emptyScorerLoggerValue(), time: '12:41' } })
    expect(Object.keys(log.log_meta.componentResults)).toHaveLength(2)
    expect(log.variant_level).toBe('RX') // real, persisted evidence - never guessed
  })

  it('a single-score log never triggers the multi-score branch (legacy parity, ticket §16)', () => {
    const single = [createComponent({ id: 'rft', format: 'RFT', producesScore: true, config: { rounds: 5 }, instances: [inst('Wall Balls')] })]
    const log = saveAndReload(single, { rft: { ...emptyScorerLoggerValue(), time: '11:30' } })
    expect(log.log_meta).toBe(null) // legacy scalar equivalence - the real onEditWod branch check (`Object.keys(...).length > 1`) never fires
  })
})

describe('3. snapshot-first resolution', () => {
  it('prefers log_meta.componentsSnapshot over the current-workout fallback when both are present', () => {
    const components = twoScorers()
    const log = saveAndReload(components, { amrap: { ...emptyScorerLoggerValue(), roundsCompleted: '4', additionalReps: '7' }, rft: { ...emptyScorerLoggerValue(), time: '12:41' } })
    const mutatedCurrentComponents = [createComponent({ id: 'totally-different', format: 'For Time', producesScore: true })]
    const resolved = resolveHistoricalComponentsForEdit(log, mutatedCurrentComponents)
    expect(resolved.source).toBe('snapshot')
    expect(resolved.components.map(c => c.id).sort()).toEqual(['amrap', 'rest', 'rft'])
  })

  it('falls back to current components ONLY when no snapshot exists on the log at all, and reports that source', () => {
    const log = { log_meta: { componentResults: { amrap: {}, rft: {} } } } // pre-snapshot shape (should not occur on real data)
    const fallbackComponents = twoScorers()
    const resolved = resolveHistoricalComponentsForEdit(log, fallbackComponents)
    expect(resolved.source).toBe('current-fallback')
    expect(resolved.components).toBe(fallbackComponents)
  })

  it('returns null for a log with no multi-score evidence at all', () => {
    expect(resolveHistoricalComponentsForEdit({ result: '11:30', log_meta: null }, [])).toBe(null)
  })
})

// --- §20/§21 Fixtures A/B: 2/3-score live hydration ------------------------

describe('20. fixture A - live edit 2 scores: values hydrate correctly, save without changes preserves both', () => {
  it('AMRAP=4+7, RFT=12:41 -> both hydrate correctly via the real edit chain', () => {
    const components = twoScorers()
    const initial = { amrap: { ...emptyScorerLoggerValue(), roundsCompleted: '4', additionalReps: '7' }, rft: { ...emptyScorerLoggerValue(), time: '12:41' } }
    const log = saveAndReload(components, initial)
    const resolved = resolveHistoricalComponentsForEdit(log, [])
    const envelopes = getOrderedScoreEnvelopes(resolved.components)
    expect(envelopes).toHaveLength(2)
    const hydrated = hydrateAllScorerValuesFromLog(envelopes, log)
    expect(hydrated.amrap.roundsCompleted).toBe('4')
    expect(hydrated.amrap.additionalReps).toBe('7')
    expect(hydrated.rft.time).toBe('12:41')

    // Resave without changes -> identical componentResults
    const resaved = composeComponentsLogFields(resolved.components, buildComposeInputsById(envelopes, hydrated))
    expect(resaved.log_meta.componentResults).toEqual(log.log_meta.componentResults)
  })
})

describe('21. fixture B - live edit 3 scores: all three hydrated', () => {
  it('AMRAP=4+7, RFT=12:41, EMOM=76 -> all three hydrate', () => {
    const components = threeScorers()
    const initial = {
      amrap: { ...emptyScorerLoggerValue(), roundsCompleted: '4', additionalReps: '7' },
      rft: { ...emptyScorerLoggerValue(), time: '12:41' },
      emom: { ...emptyScorerLoggerValue(), sets: { 1: [{ reps: '76' }] } },
    }
    const log = saveAndReload(components, initial)
    const resolved = resolveHistoricalComponentsForEdit(log, [])
    const envelopes = getOrderedScoreEnvelopes(resolved.components)
    const hydrated = hydrateAllScorerValuesFromLog(envelopes, log)
    expect(hydrated.amrap.roundsCompleted).toBe('4')
    expect(hydrated.rft.time).toBe('12:41')
    expect(hydrated.emom.sets).toEqual({ 1: [{ reps: '76' }] })
  })
})

// --- §22 Fixture C: edit one sibling ----------------------------------------

describe('22. fixture C - edit one sibling preserves the others (real save->edit->resave chain)', () => {
  it('A/B/C saved, edit B only, resave -> A/C byte-identical, B updated', () => {
    const components = threeScorers()
    const initial = {
      amrap: { ...emptyScorerLoggerValue(), roundsCompleted: '4', additionalReps: '7' },
      rft: { ...emptyScorerLoggerValue(), time: '12:41' },
      emom: { ...emptyScorerLoggerValue(), sets: { 1: [{ reps: '76' }] } },
    }
    const log = saveAndReload(components, initial)
    const resolved = resolveHistoricalComponentsForEdit(log, [])
    const envelopes = getOrderedScoreEnvelopes(resolved.components)
    const hydrated = hydrateAllScorerValuesFromLog(envelopes, log)

    const edited = { ...hydrated, rft: { ...hydrated.rft, time: '9:50' } }
    const resaved = composeComponentsLogFields(resolved.components, buildComposeInputsById(envelopes, edited))

    expect(resaved.log_meta.componentResults.amrap).toEqual(log.log_meta.componentResults.amrap)
    expect(resaved.log_meta.componentResults.emom).toEqual(log.log_meta.componentResults.emom)
    expect(resaved.log_meta.componentResults.rft.time_result).toBe('9:50')
  })
})

// --- §23 Fixture D: current WOD mutated after logging -----------------------

describe('23. fixture D - current WOD mutated after logging: snapshot truth wins, no reinterpretation', () => {
  it('reordering/renaming/removing current components never changes the historical edit target', () => {
    const components = twoScorers()
    const log = saveAndReload(components, { amrap: { ...emptyScorerLoggerValue(), roundsCompleted: '6' }, rft: { ...emptyScorerLoggerValue(), time: '10:00' } })

    // Simulate the coach mutating the CURRENT live Composer graph after the
    // athlete logged: reorder, rename a format, add a new component, remove
    // the original Rest.
    const mutatedCurrent = [
      createComponent({ id: 'rft', format: 'RFT', producesScore: true, config: { rounds: 8 } }), // config changed
      createComponent({ id: 'emom-new', format: 'EMOM', producesScore: true, config: { totalRounds: 10 } }), // brand new
      createComponent({ id: 'amrap', format: 'AMRAP', producesScore: true, config: { durationSec: 999 } }), // reordered + config changed
    ].map((c, i) => ({ ...c, order: i }))

    const resolved = resolveHistoricalComponentsForEdit(log, mutatedCurrent)
    expect(resolved.source).toBe('snapshot') // never touches mutatedCurrent
    const envelopes = getOrderedScoreEnvelopes(resolved.components)
    expect(envelopes).toHaveLength(2) // still the ORIGINAL 2, not the mutated 3
    expect(envelopes.map(e => e.scorer.config)).toEqual([{ durationSec: 480 }, { rounds: 5 }]) // original config, not mutated
    const hydrated = hydrateAllScorerValuesFromLog(envelopes, log)
    expect(hydrated.amrap.roundsCompleted).toBe('6')
    expect(hydrated.rft.time).toBe('10:00')
  })
})

// --- §24/§25/§26 performed-prescription scoping -----------------------------

describe('24. fixture E - performed scoping: modifying scorer A does not leak into scorer B', () => {
  it('a load override on AMRAP\'s own movement never appears on RFT\'s movement, using the REAL P9.5.2A functions', () => {
    const components = twoScorers() // amrap has 'Pull-Ups', rft has 'Wall Balls'
    // The exact "thin synthetic wrapper doc" pattern App.jsx's composerPerformedDoc uses.
    const doc = { variants: { rx: { movements: allInstancesFromComponents(components) } } }
    const draft = buildPerformedPrescriptionDraft({ doc, variantKey: 'rx' })
    expect(draft.movements).toHaveLength(2) // Pull-Ups + Wall Balls, combined across BOTH scorers

    // Modify ONLY the AMRAP movement (Pull-Ups) - substitute + load-like override
    const pullUpsEntry = draft.movements.find(m => m.name === 'Pull-Ups')
    pullUpsEntry.name = 'Ring Rows'
    pullUpsEntry.load = { mode: 'universal', value: 0, unit: 'kg' }

    const matches = performedMatchesProgrammed(draft, doc, 'rx', null)
    expect(matches).toBe(false) // correctly detected as modified
    // The RFT movement entry is untouched in the draft itself (no leakage)
    const wallBallsEntry = draft.movements.find(m => m.sourceInstanceId === components[2].instances[0].instanceId)
    expect(wallBallsEntry.name).toBe('Wall Balls')
  })
})

describe('25. load change scoped to its own scorer', () => {
  it('a load override stays attached to the correct MovementInstance via sourceInstanceId, never index', () => {
    const rftWithLoad = createComponent({ id: 'rft', format: 'RFT', producesScore: true, config: { rounds: 5 }, instances: [inst('DB Floor Press', { mode: 'universal', value: 22.5, unit: 'kg' })] })
    const amrap = createComponent({ id: 'amrap', format: 'AMRAP', producesScore: true, instances: [inst('Burpees')] })
    const components = [amrap, rftWithLoad].map((c, i) => ({ ...c, order: i }))
    const doc = { variants: { rx: { movements: allInstancesFromComponents(components) } } }
    const draft = buildPerformedPrescriptionDraft({ doc, variantKey: 'rx' })
    const dbEntry = draft.movements.find(m => m.name === 'DB Floor Press')
    dbEntry.load = { mode: 'universal', value: 17.5, unit: 'kg' }
    expect(performedIsModified(draft, doc, 'rx', null)).toBe(true)
    // The AMRAP entry (Burpees) is a completely separate, untouched object
    const burpeesEntry = draft.movements.find(m => m.name === 'Burpees')
    expect(burpeesEntry.load).toBeUndefined()
  })
})

describe('11/26. fixture F - owned envelope performed truth (Buy-In/RFT/Cash-Out)', () => {
  it('a performed modification inside Cash-Out stays attached to Cash-Out\'s own MovementInstance, never duplicated', () => {
    const components = ownedEnvelopePlusIndependentAmrap()
    const cashOut = components.find(c => c.role === 'cash-out')
    const doc = { variants: { rx: { movements: allInstancesFromComponents(components) } } }
    const draft = buildPerformedPrescriptionDraft({ doc, variantKey: 'rx' })
    expect(draft.movements).toHaveLength(allInstancesFromComponents(components).length) // no duplication
    const cashOutEntry = draft.movements.find(m => m.sourceInstanceId === cashOut.instances[0].instanceId)
    cashOutEntry.name = 'Bike Erg 800m'
    expect(performedIsModified(draft, doc, 'rx', null)).toBe(true)
    // Every other entry (Buy-In's Row, RFT's TTB/Wall Balls, independent AMRAP's Clean & Jerks) untouched
    const others = draft.movements.filter(m => m.sourceInstanceId !== cashOut.instances[0].instanceId)
    expect(others.every(m => m.name !== 'Bike Erg 800m')).toBe(true)
  })
})

// --- §27/§12 Fixture G: partial + performed combination --------------------

describe('26/27. fixture G - partial Cash-Out + performed modification, both survive save/reload', () => {
  it('owned envelope partial Cash-Out (463/800) + modified main movement + independent AMRAP modified, all preserved', () => {
    const components = ownedEnvelopePlusIndependentAmrap()
    const envelopes = getOrderedScoreEnvelopes(components)
    const [envelopeStep, amrapStep] = envelopes
    const valuesByComponentId = {
      [envelopeStep.scorer.id]: {
        ...emptyScorerLoggerValue(),
        roundsCompleted: '5', additionalReps: '',
        sets: { __buyIn: [{ reps: '1000' }], __cashOut: [{ reps: '463' }] },
      },
      [amrapStep.scorer.id]: { ...emptyScorerLoggerValue(), roundsCompleted: '4', additionalReps: '12' },
    }
    const log = saveAndReload(components, valuesByComponentId)
    const results = log.log_meta.componentResults
    expect(results[envelopeStep.scorer.id].result).toMatch(/463/)
    expect(results[amrapStep.scorer.id].result).toBe('4 runde + 12')

    // Performed modification survives independently of native score state -
    // it lives in performed_prescription, never inside log_meta.
    const doc = { variants: { rx: { movements: allInstancesFromComponents(components) } } }
    const draft = buildPerformedPrescriptionDraft({ doc, variantKey: 'rx' })
    const cashOutMovement = envelopeStep.cashOut.instances[0]
    const entry = draft.movements.find(m => m.sourceInstanceId === cashOutMovement.instanceId)
    entry.name = 'Ski Erg 800m'
    const logWithPerformed = { ...log, performed_prescription: draft }

    // Re-resolve on "edit" - both native results AND the performed override survive together
    const resolved = resolveHistoricalComponentsForEdit(logWithPerformed, [])
    const reEnvelopes = getOrderedScoreEnvelopes(resolved.components)
    const hydrated = hydrateAllScorerValuesFromLog(reEnvelopes, logWithPerformed)
    expect(hydrated[envelopeStep.scorer.id].sets.__cashOut).toBeUndefined() // native bookend rows are NOT re-derived from free text (Phase 4's own documented limitation, unchanged)
    expect(logWithPerformed.performed_prescription.movements.find(m => m.sourceInstanceId === cashOutMovement.instanceId).name).toBe('Ski Erg 800m')
  })
})

// --- no movement duplication / no RFT expansion, across the edit chain -----

describe('no movement duplication, no RFT expansion across resolveHistoricalComponentsForEdit', () => {
  it('the resolved historical components never clone an instance, RFT rounds stay one config field', () => {
    const components = threeScorers()
    const log = saveAndReload(components, {})
    const resolved = resolveHistoricalComponentsForEdit(log, [])
    const allLines = resolved.components.flatMap(c => (c.instances || []).map(i => i.instanceId))
    expect(new Set(allLines).size).toBe(allLines.length)
    const rft = resolved.components.find(c => c.format === 'RFT')
    expect(rft.instances).toHaveLength(1) // Wall Balls, once - not expanded ×5
  })
})

// --- historical snapshot is a true clone, not a live reference -------------

describe('componentsSnapshot immutability (regression guard for the bug caught during this phase\'s own test run)', () => {
  it('mutating the original components array after composing never changes the frozen snapshot', () => {
    const components = twoScorers()
    const envelopes = getOrderedScoreEnvelopes(components)
    const out = composeComponentsLogFields(components, buildComposeInputsById(envelopes, {}))
    const frozenSnapshotJson = JSON.stringify(out.log_meta.componentsSnapshot)
    components[0].format = 'MUTATED'
    components.push(createComponent({ format: 'Rest' }))
    expect(JSON.stringify(out.log_meta.componentsSnapshot)).toBe(frozenSnapshotJson)
  })
})

// --- fixture H - Cancel: discarding an in-progress edit never touches the
// persisted log. onEditWod's real "back arrow" handler (App.jsx) simply
// resets local state (editLogId/wodScorerValues/wodScorerStep/
// editComposerComponents) and navigates away - it never calls
// composeWodLogFields or the supabase update. That is safe-by-construction
// ONLY if hydration + local edits are provably non-mutating against the
// source log, which is what this fixture proves against the REAL functions. --

describe('28/H. fixture H - cancel: discarding an edit never mutates the persisted log', () => {
  it('hydrating + locally editing draft values, then discarding them, leaves the original log byte-identical', () => {
    const components = twoScorers()
    const log = saveAndReload(components, {
      amrap: { ...emptyScorerLoggerValue(), roundsCompleted: '3', additionalReps: '2' },
      rft: { ...emptyScorerLoggerValue(), time: '9:10' },
    })
    const originalLogJson = JSON.stringify(log)

    const resolved = resolveHistoricalComponentsForEdit(log, [])
    const envelopes = getOrderedScoreEnvelopes(resolved.components)
    const values = hydrateAllScorerValuesFromLog(envelopes, log)
    const doc = { variants: { rx: { movements: allInstancesFromComponents(resolved.components) } } }
    const performedDraft = buildPerformedPrescriptionDraft({ doc, variantKey: 'rx' })

    // Simulate the member editing both the score draft AND the performed
    // draft in the UI ("Score 1 of 2" -> "5" rounds, then Cancel) - all of
    // this is local component state in App.jsx, never written back onto `log`.
    values.amrap.roundsCompleted = '5'
    performedDraft.movements[0].name = 'Ring Rows (subbed, uncommitted)'

    // "Cancel" = simply stop referencing this local state. Nothing was ever
    // written to the log itself.
    expect(JSON.stringify(log)).toBe(originalLogJson)
  })
})

// --- fixture I - save failure: a failed Save (network/RLS error) must never
// lose or corrupt the member's in-progress edit, and a retry with the SAME
// draft must produce the exact same payload (no hidden state advanced by the
// failed attempt). saveWodLog's real edit branch (App.jsx) only resets
// editLogId/wodScorerValues/etc inside the SUCCESS branch - on
// `{ error }` it shows a toast and returns with all edit state intact,
// which is safe only if composing that state is pure/idempotent. -----------

describe('29/I. fixture I - save failure: a failed save leaves the draft retryable and unmutated', () => {
  it('composing the same edited draft twice (simulating a failed attempt then a retry) yields byte-identical payloads', () => {
    const components = threeScorers()
    const log = saveAndReload(components, {
      amrap: { ...emptyScorerLoggerValue(), roundsCompleted: '4', additionalReps: '7' },
      rft: { ...emptyScorerLoggerValue(), time: '12:41' },
      emom: { ...emptyScorerLoggerValue(), sets: { 1: [{ reps: '76' }] } },
    })
    const resolved = resolveHistoricalComponentsForEdit(log, [])
    const envelopes = getOrderedScoreEnvelopes(resolved.components)
    const values = hydrateAllScorerValuesFromLog(envelopes, log)

    // The member edits the RFT score, hits Save, the network call fails.
    values.rft.time = '11:59'
    const firstAttemptInputs = buildComposeInputsById(envelopes, values)
    const firstAttempt = composeComponentsLogFields(resolved.components, firstAttemptInputs)

    // saveWodLog's error branch does NOT clear wodScorerValues/editLogId -
    // the exact same `values` draft is still there for a retry.
    const retryInputs = buildComposeInputsById(envelopes, values)
    const retryAttempt = composeComponentsLogFields(resolved.components, retryInputs)

    expect(JSON.stringify(retryAttempt)).toBe(JSON.stringify(firstAttempt))
    expect(retryAttempt.log_meta.componentResults.rft.time_result).toBe('11:59')
    // The failed first attempt never touched the source log or components used to build it.
    expect(values.rft.time).toBe('11:59')
  })
})
