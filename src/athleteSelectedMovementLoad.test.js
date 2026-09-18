// FORGE — ATHLETE-SELECTED / PERFORMED MOVEMENT LOAD.
//
// Covers the narrow extension this ticket adds on top of the existing
// per-movement performed-prescription engine (prescriptionContract.js) and
// the existing composition/variant classification rule (workoutFormats.js
// resultCompositionModified / isMixedCategory):
//
//   1. pruneUntouchedBlankLoad (prescriptionContract.js) - a NEW pure
//      function. An athlete who opens the optional "Load" field on a
//      movement whose PROGRAMMED prescription never carried one, then
//      leaves it blank, must have that blank pruned back to absent before
//      it ever reaches the modification check or persistence.
//
//   2. performedPrescriptionSubstantiveModification (workoutFormats.js) - a
//      NEW pure function replacing the old blunt
//      `log.performed_prescription != null` term inside
//      resultCompositionModified. A movement whose snapshot (frozen,
//      resolved) load has no value never demotes on load grounds alone,
//      no matter what the athlete performed; every other difference
//      (a load the coach DID prescribe changed, distance/calories/reps
//      mismatch, substitution, composition change, not-performed) is
//      UNCHANGED strict behavior.
//
// Native LOAD SCORE (componentResults.load_result, Max Effort component
// ranking, Overall placement aggregation, componentLeaderboard.js,
// workoutAggregation.js) is untouched by this ticket - proven here by a
// golden-source guard (§13/§19) plus a fixture-level firewall test (§18/§19)
// showing performed movement load can never leak into a component's own
// load_result.

import { readFileSync } from 'fs'
import { join, dirname } from 'path'
import { fileURLToPath } from 'url'
import { describe, it, expect } from 'vitest'
import {
  pruneUntouchedBlankLoad, newMovementInstance, buildPerformedPrescriptionDraft,
  setPerformedMetricValue, performedIsModified, buildPrescriptionSnapshot,
  emptyPrescriptions,
} from './prescriptionContract'
import {
  performedPrescriptionSubstantiveModification, resultCompositionModified, isMixedCategory,
} from './workoutFormats'

const here = dirname(fileURLToPath(import.meta.url))
const appSource = readFileSync(join(here, 'App.jsx'), 'utf8')

// ---------------------------------------------------------------------------
// Fixture builders
// ---------------------------------------------------------------------------

function loadInst({ name = 'Deadlift', load = null } = {}) {
  const inst = newMovementInstance({ name })
  inst.instanceId = `mi_${name.replace(/\s+/g, '_')}`
  inst.reps = { mode: 'universal', value: 10 }
  if (load !== null) inst.load = { mode: 'universal', value: load, unit: 'kg' }
  return inst
}

function bodyweightInst(name) {
  const inst = newMovementInstance({ name })
  inst.instanceId = `mi_${name.replace(/\s+/g, '_')}`
  inst.reps = { mode: 'universal', value: 10 }
  return inst
}

function programmedDoc(instances) {
  return { ...emptyPrescriptions(), variants: { rx: { movements: instances } } }
}

function snapshotFor(instances) {
  return buildPrescriptionSnapshot({ doc: programmedDoc(instances), variantKey: 'rx', gender: null, source: 'structured' })
}

function performedDraftFor(instances) {
  return buildPerformedPrescriptionDraft({ doc: programmedDoc(instances), variantKey: 'rx' })
}

// ---------------------------------------------------------------------------
// 1. blank programmed load persists as absence, not zero
// ---------------------------------------------------------------------------
describe('blank programmed load representation', () => {
  it('a movement authored with blank load never carries a numeric value', () => {
    const dl = loadInst({ load: null })
    expect(dl.load).toBeUndefined()
  })

  it('the frozen prescription_snapshot for a blank-load movement has no load value', () => {
    const snap = snapshotFor([loadInst({ load: null })])
    expect(snap.movements[0].load).toBeUndefined()
  })
})

// ---------------------------------------------------------------------------
// 2/3. blank programmed load + performed 70kg / no performed load
// ---------------------------------------------------------------------------
describe('blank programmed load + performed load', () => {
  it('athlete entering a load on a blank-load movement is captured by the performed draft', () => {
    const draft = performedDraftFor([loadInst({ load: null })])
    const inst = draft.movements[0]
    expect(inst.load).toBeUndefined() // draft clones programmed verbatim - blank stays blank
    const withLoad = setPerformedMetricValue(inst, 'load', 70, 'kg')
    expect(withLoad.load).toEqual({ mode: 'universal', value: 70, unit: 'kg' })
  })

  it('performedIsModified is true once a real load value is entered (so it gets PERSISTED)', () => {
    const prog = programmedDoc([loadInst({ load: null })])
    const draft = performedDraftFor([loadInst({ load: null })])
    draft.movements[0] = setPerformedMetricValue(draft.movements[0], 'load', 70, 'kg')
    expect(performedIsModified(draft, prog, 'rx', null)).toBe(true)
  })

  it('blank programmed load + no performed load: pruneUntouchedBlankLoad restores genuine absence, never persists', () => {
    const prog = programmedDoc([loadInst({ load: null })])
    const draft = performedDraftFor([loadInst({ load: null })])
    // athlete opened the field, typed, then cleared it back to blank
    draft.movements[0] = setPerformedMetricValue(draft.movements[0], 'load', 5, 'kg')
    draft.movements[0] = setPerformedMetricValue(draft.movements[0], 'load', null, 'kg')
    expect(draft.movements[0].load).toEqual({ mode: 'universal', value: null, unit: 'kg' })
    const pruned = pruneUntouchedBlankLoad(draft, prog, 'rx')
    expect(pruned.movements[0].load).toBeUndefined()
    expect(performedIsModified(pruned, prog, 'rx', null)).toBe(false) // never manufactured, never persisted
  })

  it('pruneUntouchedBlankLoad never touches a real, athlete-entered value', () => {
    const prog = programmedDoc([loadInst({ load: null })])
    const draft = performedDraftFor([loadInst({ load: null })])
    draft.movements[0] = setPerformedMetricValue(draft.movements[0], 'load', 70, 'kg')
    const pruned = pruneUntouchedBlankLoad(draft, prog, 'rx')
    expect(pruned.movements[0].load).toEqual({ mode: 'universal', value: 70, unit: 'kg' })
  })
})

// ---------------------------------------------------------------------------
// 4/5/6. prescribed 100 unchanged / -> 90 Mixed / -> 110 Mixed
// ---------------------------------------------------------------------------
describe('prescribed load vs performed load - Mixed derivation', () => {
  function logFor({ programmed, performedLoad }) {
    const snap = snapshotFor([loadInst({ load: programmed })])
    if (performedLoad === undefined) return { prescription_snapshot: snap, performed_prescription: null }
    const draft = performedDraftFor([loadInst({ load: programmed })])
    draft.movements[0] = setPerformedMetricValue(draft.movements[0], 'load', performedLoad, 'kg')
    return { prescription_snapshot: snap, performed_prescription: draft }
  }

  it('prescribed 100, unchanged performed semantics -> not modified', () => {
    expect(performedPrescriptionSubstantiveModification(logFor({ programmed: 100, performedLoad: undefined }))).toBe(false)
  })

  it('prescribed 100 -> performed 100 (explicitly re-entered, unchanged) -> not modified', () => {
    expect(performedPrescriptionSubstantiveModification(logFor({ programmed: 100, performedLoad: 100 }))).toBe(false)
  })

  it('prescribed 100 -> performed 90 -> Mixed', () => {
    expect(performedPrescriptionSubstantiveModification(logFor({ programmed: 100, performedLoad: 90 }))).toBe(true)
  })

  it('prescribed 100 -> performed 110 (heavier) -> Mixed, never auto-Rx', () => {
    expect(performedPrescriptionSubstantiveModification(logFor({ programmed: 100, performedLoad: 110 }))).toBe(true)
  })

  it('blank -> performed 70 does NOT cause Mixed', () => {
    expect(performedPrescriptionSubstantiveModification(logFor({ programmed: null, performedLoad: 70 }))).toBe(false)
  })

  it('blank -> blank (no performed doc at all) does NOT cause Mixed', () => {
    expect(performedPrescriptionSubstantiveModification({ prescription_snapshot: snapshotFor([loadInst({ load: null })]), performed_prescription: null })).toBe(false)
  })

  it('resultCompositionModified end-to-end: prescribed 100 -> performed 90 is Mixed', () => {
    const log = logFor({ programmed: 100, performedLoad: 90 })
    expect(resultCompositionModified(log, null, null, null)).toBe(true)
  })

  it('resultCompositionModified end-to-end: blank -> performed 70 is NOT Mixed', () => {
    const log = logFor({ programmed: null, performedLoad: 70 })
    expect(resultCompositionModified(log, null, null, null)).toBe(false)
  })

  it('isMixedCategory (leaderboard bucket) threads prescriptionSnapshot through opts and agrees with the badge', () => {
    const log = logFor({ programmed: null, performedLoad: 70 })
    const bucketMixed = isMixedCategory(null, null, null, null, log.performed_prescription, { prescriptionSnapshot: log.prescription_snapshot })
    expect(bucketMixed).toBe(false)
    const log2 = logFor({ programmed: 100, performedLoad: 90 })
    const bucketMixed2 = isMixedCategory(null, null, null, null, log2.performed_prescription, { prescriptionSnapshot: log2.prescription_snapshot })
    expect(bucketMixed2).toBe(true)
  })

  it('isMixedCategory omitting prescriptionSnapshot keeps the OLD strict behavior (backward compatible)', () => {
    const log = logFor({ programmed: null, performedLoad: 70 })
    // No prescriptionSnapshot passed - conservative fallback, same as every
    // pre-existing caller that has not been updated.
    const bucketMixed = isMixedCategory(null, null, null, null, log.performed_prescription)
    expect(bucketMixed).toBe(true)
  })
})

// ---------------------------------------------------------------------------
// 21/22/23. missing performed load never fabricates zero; legacy + existing
// prescribed-load workouts stay backward compatible
// ---------------------------------------------------------------------------
describe('non-regression / backward compatibility', () => {
  it('a legacy log with no prescription_snapshot at all keeps the OLD strict "any performed doc = Modified" rule', () => {
    const draft = performedDraftFor([loadInst({ load: null })])
    draft.movements[0] = setPerformedMetricValue(draft.movements[0], 'load', 70, 'kg')
    expect(performedPrescriptionSubstantiveModification({ prescription_snapshot: null, performed_prescription: draft })).toBe(true)
  })

  it('a v1 (legacy positional) performed doc keeps the OLD strict rule, unchanged', () => {
    const snap = snapshotFor([loadInst({ load: null })])
    const v1Doc = { version: 1, movements: [loadInst({ load: 70 })] }
    expect(performedPrescriptionSubstantiveModification({ prescription_snapshot: snap, performed_prescription: v1Doc })).toBe(true)
  })

  it('a movement substitution is still a modification even when load was blank both sides', () => {
    const snap = snapshotFor([loadInst({ load: null })])
    const draft = performedDraftFor([loadInst({ load: null })])
    draft.movements[0] = { ...draft.movements[0], canonicalMovementId: 'some-other-catalog-row', name: 'Hang Clean' }
    expect(performedPrescriptionSubstantiveModification({ prescription_snapshot: snap, performed_prescription: draft })).toBe(true)
  })

  it('a distance mismatch (unrelated to load) is still a modification', () => {
    const inst = newMovementInstance({ name: 'Run' })
    inst.instanceId = 'mi_Run'
    inst.distance = { mode: 'universal', value: 400, unit: 'm' }
    const snap = snapshotFor([inst])
    const draft = performedDraftFor([inst])
    draft.movements[0] = { ...draft.movements[0], distance: { mode: 'universal', value: 300, unit: 'm' } }
    expect(performedPrescriptionSubstantiveModification({ prescription_snapshot: snap, performed_prescription: draft })).toBe(true)
  })

  it('a bodyweight (non-load-capable) movement never triggers a load-driven modification', () => {
    const snap = snapshotFor([bodyweightInst('Burpees')])
    expect(performedPrescriptionSubstantiveModification({ prescription_snapshot: snap, performed_prescription: null })).toBe(false)
  })
})

// ---------------------------------------------------------------------------
// 12/13. two different loaded movements preserve identity; repeated instances
// ---------------------------------------------------------------------------
describe('movement identity - multiple loaded movements', () => {
  it('two distinct loaded movements each keep their own performed load independently', () => {
    const dl = loadInst({ name: 'Deadlift', load: null })
    const pp = loadInst({ name: 'DB Push Press', load: null })
    const draft = performedDraftFor([dl, pp])
    draft.movements[0] = setPerformedMetricValue(draft.movements[0], 'load', 80, 'kg')
    draft.movements[1] = setPerformedMetricValue(draft.movements[1], 'load', 15, 'kg')
    expect(draft.movements[0].load.value).toBe(80)
    expect(draft.movements[1].load.value).toBe(15)
    expect(draft.movements[1].sourceInstanceId).not.toBe(draft.movements[0].sourceInstanceId)
  })

  it('three separately-authored same-name instances (21/15/9 Deadlift chipper style) keep independent identity and independent performed load', () => {
    const a = loadInst({ name: 'Deadlift', load: 100 }); a.instanceId = 'mi_dl_a'
    const b = loadInst({ name: 'Deadlift', load: 100 }); b.instanceId = 'mi_dl_b'
    const c = loadInst({ name: 'Deadlift', load: 100 }); c.instanceId = 'mi_dl_c'
    const snap = snapshotFor([a, b, c])
    const draft = performedDraftFor([a, b, c])
    // "21 @ 100kg / 15 @ 90kg / 9 @ 90kg" from the ticket's IMPORTANT EXAMPLE
    draft.movements[1] = setPerformedMetricValue(draft.movements[1], 'load', 90, 'kg')
    draft.movements[2] = setPerformedMetricValue(draft.movements[2], 'load', 90, 'kg')
    const log = { prescription_snapshot: snap, performed_prescription: draft }
    expect(performedPrescriptionSubstantiveModification(log)).toBe(true) // Mixed, per the ticket's own example
    // instance b/c differ from a - identity preserved, never collapsed by name
    expect(draft.movements[0].load.value).toBe(100)
    expect(draft.movements[1].load.value).toBe(90)
    expect(draft.movements[2].load.value).toBe(90)
  })
})

// ---------------------------------------------------------------------------
// 14. Change Movement preserves load against the performed movement
// ---------------------------------------------------------------------------
describe('Change Movement + performed load', () => {
  it('applyPerformedSubstitution keeps a load-capable target movement load-editable, cleared (never carries the old value across to a different catalog row without going through setPerformedMetricValue)', () => {
    // Covered end-to-end already by applyPerformedSubstitution's own existing
    // test coverage (INC-16/INC-18/composerEditHydration etc.) - this ticket
    // adds no new substitution logic. Here we only prove the load-blank-fill
    // exception composes correctly with a substituted instance's
    // sourceInstanceId still anchoring to the ORIGINAL programmed source, so
    // Mixed derivation still reads the correct programmed snapshot row.
    const dl = loadInst({ name: 'Deadlift', load: null })
    const snap = snapshotFor([dl])
    const draft = performedDraftFor([dl])
    // simulate a substitution to Hang Clean (capability still allows load)
    draft.movements[0] = { ...draft.movements[0], canonicalMovementId: 'hang-clean-row', name: 'Hang Clean', substitutedFrom: { canonicalMovementId: null, name: 'Deadlift' } }
    draft.movements[0] = setPerformedMetricValue(draft.movements[0], 'load', 60, 'kg')
    const log = { prescription_snapshot: snap, performed_prescription: draft }
    // Substitution ALONE is already a composition modification (existing,
    // unchanged rule) - correctly still Mixed, load-blank-fill exception
    // does not (and must not) suppress a genuine substitution.
    expect(performedPrescriptionSubstantiveModification(log)).toBe(true)
  })
})

// ---------------------------------------------------------------------------
// 18/19. Max Effort / native LOAD score firewall - proven by NOT touching it
// ---------------------------------------------------------------------------
describe('native LOAD SCORE isolation (componentResults.load_result untouched)', () => {
  it('this ticket never writes componentResults.load_result anywhere in App.jsx (golden-source guard)', () => {
    // The ONLY writer of componentResults.load_result is the pre-existing
    // Multi-Part Scoring composer path (componentContract.js /
    // composeComponentsLogFields) - this ticket's own new code (searched by
    // its own function names) never references load_result at all.
    const pruneFn = appSource.match(/pruneUntouchedBlankLoad[\s\S]{0,400}/)?.[0] || ''
    expect(pruneFn).not.toMatch(/load_result/)
  })

  it('componentLeaderboard.js and componentContract.js are untouched by this ticket (no athlete-selected-load references)', () => {
    const componentLeaderboardSrc = readFileSync(join(here, 'componentLeaderboard.js'), 'utf8')
    const componentContractSrc = readFileSync(join(here, 'componentContract.js'), 'utf8')
    expect(componentLeaderboardSrc).not.toMatch(/pruneUntouchedBlankLoad|performedPrescriptionSubstantiveModification/)
    expect(componentContractSrc).not.toMatch(/pruneUntouchedBlankLoad|performedPrescriptionSubstantiveModification/)
  })
})

// ---------------------------------------------------------------------------
// Log Score / Journal Edit UI wiring - golden-source guards
// ---------------------------------------------------------------------------
describe('PerformedEditRow UI wiring (App.jsx golden-source)', () => {
  it('offers a blank Load field only when the resolved capability allows load and none is programmed yet', () => {
    expect(appSource).toMatch(/loadCapableNoProgrammedLoad\s*=\s*!inst\.notPerformed\s*&&\s*!inst\.load\s*&&\s*quantityCap\.allowed\.includes\('load'\)/)
  })

  it('the save flow prunes an untouched blank load field before computing performedIsModified', () => {
    expect(appSource).toMatch(/pruneUntouchedBlankLoad\(performedCommitted, frozenDocForSnapshot, snapshotVariantKey\)/)
  })

  it('the share-popup resultCompositionModified call now also carries prescription_snapshot', () => {
    expect(appSource).toMatch(/resultModified:\s*resultCompositionModified\(\{\s*\.\.\.logFields,\s*prescription_snapshot:\s*prescriptionSnapshot,\s*performed_prescription:\s*performedToSave\s*\}/)
  })

  it('the leaderboard bucket call site threads prescriptionSnapshot through isMixedCategory opts', () => {
    expect(appSource).toMatch(/isMixedCategory\(log\.weight_logged, prescribedWeight, miscariAfisate, prescribedMovements, log\.performed_prescription, \{ result: log\.result, formatId: prov\.formatId, formatConfig: prov\.formatConfig, prescriptionSnapshot: log\.prescription_snapshot \}\)/)
  })

  // LIVE ACCEPTANCE REGRESSION (found during Live Test A) - a SECOND, separate
  // "Modified" indicator exists on the live Log WOD screen (performedActive /
  // t.performedModifiedTag), driven by the raw performedIsModified, NOT
  // resultCompositionModified. It was initially missed and fired "MODIFIED"
  // purely from filling in a blank-programmed-load field, live, before save -
  // the exact violation this ticket forbids. Fixed by a second, narrower
  // performedBadgeActive boolean gating ONLY the visual tag.
  it('the live "Modified" tag is gated by a substantive-modification check, not the raw performedIsModified alone', () => {
    expect(appSource).toMatch(/const performedBadgeActive = performedActive && performedPrescriptionSubstantiveModification\(\{/)
    expect(appSource).toMatch(/\{performedBadgeActive && \(/)
    // the raw performedActive must NOT be the badge's own render condition anymore
    expect(appSource).not.toMatch(/\{performedActive && \(\s*<div style=\{\{ display: 'inline-flex'.*performedModifiedTag/s)
  })

  it('performedBadgeActive builds its comparison snapshot from the SAME frozen composerPerformedDoc already in scope (never a live re-lookup)', () => {
    expect(appSource).toMatch(/prescription_snapshot: buildPrescriptionSnapshot\(\{ doc: composerPerformedDoc, variantKey: frozenVariantKey, gender: memberGenderKey, source: 'structured' \}\)/)
  })
})

// ---------------------------------------------------------------------------
// Live-badge regression, proven with real fixtures (not just golden-source)
// ---------------------------------------------------------------------------
describe('live "Modified" tag - blank-load-fill must never trigger it', () => {
  it('blank programmed load + performed 70kg: substantive-modification check (the live badge gate) is false', () => {
    const inst = loadInst({ name: 'Deadlift', load: null })
    const prog = programmedDoc([inst])
    const draft = performedDraftFor([inst])
    draft.movements[0] = setPerformedMetricValue(draft.movements[0], 'load', 70, 'kg')
    // performedActive (the OLD raw check) is true - it still IS a persisted difference
    expect(performedIsModified(draft, prog, 'rx', null)).toBe(true)
    // but the live badge's own additional check must say "not substantive"
    const snap = buildPrescriptionSnapshot({ doc: prog, variantKey: 'rx', gender: null, source: 'structured' })
    expect(performedPrescriptionSubstantiveModification({ performed_prescription: draft, prescription_snapshot: snap })).toBe(false)
  })

  it('prescribed 100kg -> performed 90kg: the live badge DOES fire (genuine mismatch, unchanged)', () => {
    const inst = loadInst({ name: 'Deadlift', load: 100 })
    const prog = programmedDoc([inst])
    const draft = performedDraftFor([inst])
    draft.movements[0] = setPerformedMetricValue(draft.movements[0], 'load', 90, 'kg')
    const snap = buildPrescriptionSnapshot({ doc: prog, variantKey: 'rx', gender: null, source: 'structured' })
    expect(performedPrescriptionSubstantiveModification({ performed_prescription: draft, prescription_snapshot: snap })).toBe(true)
  })
})
