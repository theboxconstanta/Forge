// FORGE — JOURNAL MULTI-SCORER EDIT INTEGRITY (targeted follow-up ticket).
//
// PRODUCTION BUG (confirmed live, this ticket's own root cause): Journal ->
// Edit on a genuine multi-scorer Composer log (log_meta.componentResults
// with 2+ entries) opened the LEGACY single-format editor instead of
// MultiScorerLogger. Root cause traced to App.jsx's screen==='logWOD' JSX:
// onEditWod (App.jsx) already correctly resolved the historical snapshot,
// built the right envelopes, and hydrated wodScorerValues - but the render
// branch for editLogId sessions never once checked useComposerLogger, so it
// unconditionally rendered the legacy movements-editor card + FormatLogger,
// fed entirely EMPTY legacy scalar state (onEditWod explicitly clears
// wodResult/wodTime/... for a Composer log, since the real data lives in
// wodScorerValues instead) - explaining both symptoms: no Max Effort field
// at all, and Part A's sequential partial-round inputs showing full
// prescribed reps (FormatLogger/UniversalScoreInput's own empty-draft
// default) despite the log being a FINISHED 11:42 result.
//
// Fix (App.jsx, two JSX branches): route on useComposerLogger, exactly like
// the fresh-logging Composer path already does - reusing MultiScorerLogger
// verbatim, never a second scoring engine. This file cannot exercise
// App.jsx's own JSX (a single non-exported component) directly, so it
// proves correctness at two levels instead:
//   1. A golden-source guard (same convention as performedPrescription.test.js's
//      own "UI source guard") - proves the fix's routing condition is
//      actually present in App.jsx's source, not just here in isolation.
//   2. The exact pure-function chain onEditWod -> [user edits
//      wodScorerValues via MultiScorerLogger] -> saveWodLog already
//      orchestrates (resolveHistoricalComponentsForEdit ->
//      getOrderedScoreEnvelopes -> hydrateAllScorerValuesFromLog ->
//      buildComposeInputsById -> composeComponentsLogFields), run
//      end-to-end exactly as the fixed screen now does. Every one of these
//      helpers is pre-existing and untouched by this ticket - this proves
//      the DATA path is (and always was) correct; only the UI routing to
//      reach it was broken.

import { readFileSync } from 'fs'
import { fileURLToPath } from 'url'
import path from 'path'
import { describe, it, expect } from 'vitest'
import {
  createComponent, getOrderedScoreEnvelopes, hydrateAllScorerValuesFromLog,
  resolveHistoricalComponentsForEdit, buildComposeInputsById, composeComponentsLogFields,
  getComponentResultsFromLog,
} from './componentContract'
import { newMovementInstance } from './prescriptionContract'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

function inst(name) { return newMovementInstance({ name }) }
// A prescribed instance carrying a real reps count, so a capped/partial
// result's "<performed>/<prescribed> <name>" text has something to match
// against (renderComponentMovementLines/parsePartialText, unchanged).
function instWithReps(name, reps) { return { ...newMovementInstance({ name }), reps: { mode: 'universal', value: reps } } }

// The owner's canonical target workout: Part A = For Time (Time Cap 15:00,
// sequential), Part B = Max Effort/Load (3:00 window, Clean & Jerk).
function canonicalComponents() {
  const partA = createComponent({
    id: 'partA', format: 'For Time', producesScore: true,
    config: { structure: 'Sequence', timeCapSec: 900 }, instances: [instWithReps('Clean & Jerk', 1)],
  })
  const partB = createComponent({
    id: 'partB', format: 'Max Effort', producesScore: true,
    config: { timeCapSec: 180 }, instances: [inst('Clean & Jerk')],
  })
  return [partA, partB].map((c, i) => ({ ...c, order: i }))
}

// A real, saved wod_logs row shaped exactly like composeMultiEnvelopeLogFields
// produces (the exact shape confirmed live in production for this bug).
// `includePartB: false` genuinely omits Part B's componentResults entry
// (simulating a member who never touched that scorer) - distinct from
// `loadResult` (the value Part B DOES carry when included).
function canonicalLog({ timeResult = '11:42', completionState = 'completed', resultText = null, loadResult = 95, includePartB = true, notes = 'FOR TIME\n1 Clean & Jerk' } = {}) {
  const components = canonicalComponents()
  const componentResults = {
    partA: { format: 'For Time', result: resultText, time_result: timeResult, completion_state: completionState, sets: null, load_result: null },
  }
  if (includePartB) {
    componentResults.partB = { format: 'Max Effort', result: null, time_result: null, completion_state: null, sets: null, load_result: loadResult }
  }
  return {
    id: 'log-1', member_id: 'member-1', wod_id: 'wod-1', variant_level: 'RX',
    result: null, time_result: null, completion_state: null, sets: null, weight_logged: null,
    notes,
    log_meta: { composerVersion: 1, componentResults, componentsSnapshot: components },
    wods: null,
  }
}

// --- 1/2. Routing: the fixed condition exists in App.jsx's own source -----

describe('App.jsx routing guard - useComposerLogger drives BOTH editLogId JSX branches', () => {
  const appSource = readFileSync(path.join(__dirname, 'App.jsx'), 'utf8')

  it('the editLogId movements-editor branch checks useComposerLogger (skips the legacy free-text editor for a Composer log)', () => {
    expect(appSource).toMatch(/\{editLogId \? \([\s\S]{0,1500}?useComposerLogger \? \(/)
  })

  it('the editLogId/logWodStep score-section branch renders MultiScorerLogger when useComposerLogger, FormatLogger otherwise', () => {
    // ATHLETE-SELECTED MOVEMENT LOAD - this branch was restructured from a
    // plain ternary into an IIFE with an early `if (useComposerLogger) return
    // (<MultiScorerLogger .../>)` so the FormatLogger side could also gain a
    // logWodEditMode interception (PerformedEditPanel) + an Edit/Adjust
    // affordance for single-scorer historical edits - the same routing
    // decision (useComposerLogger), same MultiScorerLogger usage, same props.
    expect(appSource).toMatch(/if \(useComposerLogger\) \{\s*return \(\s*<MultiScorerLogger/)
    expect(appSource).toMatch(/<MultiScorerLogger[\s\S]{0,30}envelopes=\{logScoreEnvelopes\}[\s\S]{0,40}valuesByComponentId=\{wodScorerValues\}[\s\S]{0,40}step=\{wodScorerStep\}/)
  })

  it('reuses the SAME MultiScorerLogger component for both fresh logging and historical edit - never a second scoring engine', () => {
    // Exactly 2 JSX call sites are expected and correct: the pre-existing
    // fresh-logging (logWodPrimaryPath) usage, and this ticket's new
    // edit-path usage - both invoking the one component composerLogging.jsx
    // defines, never a Journal-specific reimplementation.
    const matches = appSource.match(/<MultiScorerLogger\b/g) || []
    expect(matches).toHaveLength(2)
    // Only one distinct component definition exists anywhere in the source tree.
    const definitionMatches = appSource.match(/function MultiScorerLogger\b/g) || []
    expect(definitionMatches).toHaveLength(0) // it's imported, never (re)defined in App.jsx
  })
})

// --- 3/4. TIME + LOAD hydrate correctly through the fixed edit chain ------

describe('onEditWod -> MultiScorerLogger -> saveWodLog chain (the exact pure-function path the fix now reaches)', () => {
  it('resolves the historical snapshot (2 components), builds 2 envelopes, hydrates TIME=11:42 and LOAD=95', () => {
    const log = canonicalLog()
    const resolved = resolveHistoricalComponentsForEdit(log, [])
    expect(resolved.source).toBe('snapshot')
    expect(resolved.components).toHaveLength(2)
    const envelopes = getOrderedScoreEnvelopes(resolved.components)
    expect(envelopes).toHaveLength(2) // useComposerLogger's own formula: length > 1 -> true
    const wodScorerValues = hydrateAllScorerValuesFromLog(envelopes, log)
    expect(wodScorerValues.partA.time).toBe('11:42')
    expect(wodScorerValues.partB.result).toBe('95') // LOAD kind reads/writes v.result, per UniversalScoreInput
  })

  it('LOAD hydrates as a plain numeric string, never reps/seconds/legacy sets', () => {
    const log = canonicalLog({ loadResult: 102.5 })
    const envelopes = getOrderedScoreEnvelopes(resolveHistoricalComponentsForEdit(log, []).components)
    const values = hydrateAllScorerValuesFromLog(envelopes, log)
    expect(values.partB.result).toBe('102.5')
    expect(values.partB.sets).toEqual({})
    expect(values.partB.roundsCompleted).toBe('')
  })
})

// --- 5. Unchanged save round-trips identically -----------------------------

describe('unchanged save round-trip integrity', () => {
  it('reopen -> change nothing -> resave -> byte-identical componentResults', () => {
    const log = canonicalLog()
    const components = resolveHistoricalComponentsForEdit(log, []).components
    const envelopes = getOrderedScoreEnvelopes(components)
    const hydrated = hydrateAllScorerValuesFromLog(envelopes, log)
    const resaved = composeComponentsLogFields(components, buildComposeInputsById(envelopes, hydrated))
    expect(getComponentResultsFromLog(resaved)).toEqual(getComponentResultsFromLog({ log_meta: log.log_meta }))
    expect(resaved.log_meta.componentsSnapshot).toEqual(components)
  })
})

// --- 6/7. Independent per-scorer edit --------------------------------------

describe('independent scorer edit integrity', () => {
  it('editing ONLY Part B (95 -> 100) leaves Part A (11:42) exactly untouched', () => {
    const log = canonicalLog()
    const components = resolveHistoricalComponentsForEdit(log, []).components
    const envelopes = getOrderedScoreEnvelopes(components)
    const hydrated = hydrateAllScorerValuesFromLog(envelopes, log)
    const edited = { ...hydrated, partB: { ...hydrated.partB, result: '100' } }
    const saved = composeComponentsLogFields(components, buildComposeInputsById(envelopes, edited))
    const results = getComponentResultsFromLog(saved)
    expect(results.find(r => r.componentId === 'partA').time_result).toBe('11:42')
    expect(results.find(r => r.componentId === 'partB').load_result).toBe(100)
  })

  it('editing ONLY Part A (11:42 -> 11:30) leaves Part B (100) exactly untouched', () => {
    const log = canonicalLog({ loadResult: 100 })
    const components = resolveHistoricalComponentsForEdit(log, []).components
    const envelopes = getOrderedScoreEnvelopes(components)
    const hydrated = hydrateAllScorerValuesFromLog(envelopes, log)
    const edited = { ...hydrated, partA: { ...hydrated.partA, time: '11:30' } }
    const saved = composeComponentsLogFields(components, buildComposeInputsById(envelopes, edited))
    const results = getComponentResultsFromLog(saved)
    expect(results.find(r => r.componentId === 'partA').time_result).toBe('11:30')
    expect(results.find(r => r.componentId === 'partB').load_result).toBe(100)
  })
})

// --- 8. DNF/partial + LOAD hydrate independently ---------------------------

describe('DNF/partial historical edit, independent of Part B', () => {
  it('a capped (DNF) Part A hydrates its exact partial progress; Part B (LOAD) hydrates independently, untouched', () => {
    const log = canonicalLog({ timeResult: null, completionState: 'capped', resultText: '0/1 Clean & Jerk', loadResult: 95 })
    const components = resolveHistoricalComponentsForEdit(log, []).components
    const envelopes = getOrderedScoreEnvelopes(components)
    const hydrated = hydrateAllScorerValuesFromLog(envelopes, log)
    expect(hydrated.partA.time).toBe('')
    expect(hydrated.partA.partialReps).toEqual(['0'])
    expect(hydrated.partB.result).toBe('95')
    // resave unchanged - both parts survive the round trip
    const saved = composeComponentsLogFields(components, buildComposeInputsById(envelopes, hydrated))
    const results = getComponentResultsFromLog(saved)
    expect(results.find(r => r.componentId === 'partA').completion_state).toBe('capped')
    expect(results.find(r => r.componentId === 'partB').load_result).toBe(95)
  })
})

// --- 9. Missing scorer never fabricates a score ----------------------------

describe('missing scorer handling', () => {
  it('a log with Part A logged but Part B never touched hydrates Part B as a genuinely empty draft, never a fabricated 0/time', () => {
    const log = canonicalLog({ includePartB: false })
    const components = resolveHistoricalComponentsForEdit(log, []).components
    const envelopes = getOrderedScoreEnvelopes(components)
    const hydrated = hydrateAllScorerValuesFromLog(envelopes, log)
    expect(hydrated.partA.time).toBe('11:42')
    expect(hydrated.partB.result).toBe('') // empty draft, not '0'
    // resaving this unchanged must not manufacture a load_result
    const saved = composeComponentsLogFields(components, buildComposeInputsById(envelopes, hydrated))
    const partBResult = getComponentResultsFromLog(saved).find(r => r.componentId === 'partB')
    expect(partBResult.load_result).toBe(null)
  })
})

// --- 10. N-scorer (never hardcoded to exactly two) -------------------------

describe('N-scorer historical edit - generic over component count', () => {
  it('a 3-part historical log (TIME, LOAD, AMRAP) hydrates all three envelopes', () => {
    const partA = createComponent({ id: 'partA', format: 'For Time', producesScore: true, config: { structure: 'Sequence' }, instances: [inst('Clean & Jerk')] })
    const partB = createComponent({ id: 'partB', format: 'Max Effort', producesScore: true, config: {}, instances: [inst('Clean & Jerk')] })
    const partC = createComponent({ id: 'partC', format: 'AMRAP', producesScore: true, config: { durationSec: 300 }, instances: [inst('Wall Balls')] })
    const components = [partA, partB, partC].map((c, i) => ({ ...c, order: i }))
    const log = {
      id: 'log-3', log_meta: {
        componentsSnapshot: components,
        componentResults: {
          partA: { format: 'For Time', result: null, time_result: '9:10', completion_state: 'completed', sets: null, load_result: null },
          partB: { format: 'Max Effort', result: null, time_result: null, completion_state: null, sets: null, load_result: 90 },
          partC: { format: 'AMRAP', result: '6 runde + 4', time_result: null, completion_state: null, sets: null, load_result: null },
        },
      },
    }
    const resolved = resolveHistoricalComponentsForEdit(log, [])
    const envelopes = getOrderedScoreEnvelopes(resolved.components)
    expect(envelopes).toHaveLength(3)
    const hydrated = hydrateAllScorerValuesFromLog(envelopes, log)
    expect(hydrated.partA.time).toBe('9:10')
    expect(hydrated.partB.result).toBe('90')
    expect(hydrated.partC.roundsCompleted).toBe('6'); expect(hydrated.partC.additionalReps).toBe('4')
  })
})

// --- 11. Single-scorer Composer log keeps the existing (non-Multi) path ---

describe('single-scorer regression firewall - a lone Composer scorer never routes through the "multi-scorer" (length > 1) branch', () => {
  it('exactly 1 envelope -> useComposerLogger\'s own formula (length > 1) evaluates false for an edit session', () => {
    const solo = createComponent({ id: 'solo', format: 'AMRAP', producesScore: true, config: { durationSec: 600 }, instances: [inst('Burpees')] })
    const envelopes = getOrderedScoreEnvelopes([solo])
    expect(envelopes.length > 1).toBe(false)
  })
})

// --- 12. Legacy scalar-only historical log keeps the legacy editor --------

describe('legacy historical log firewall - no componentsSnapshot/componentResults at all', () => {
  it('resolveHistoricalComponentsForEdit returns null for a pre-Composer legacy log (no migration, no synthetic snapshot)', () => {
    const legacyLog = { id: 'legacy-1', result: '6 rounds + 4', time_result: null, completion_state: 'capped', sets: null, log_meta: null }
    expect(resolveHistoricalComponentsForEdit(legacyLog, [])).toBe(null)
  })
})

// --- 13. Snapshot-first: a later live-workout edit never reinterprets history --

describe('snapshot-first historical truth - independent of the current live workout', () => {
  it('componentsSnapshot is used even when a different currentComponentsFallback is supplied (simulating the workout being edited since)', () => {
    const log = canonicalLog()
    const mutatedLiveComponents = [createComponent({ id: 'newPart', format: 'EMOM', producesScore: true, config: { totalRounds: 10 }, instances: [inst('Row')] })]
    const resolved = resolveHistoricalComponentsForEdit(log, mutatedLiveComponents)
    expect(resolved.source).toBe('snapshot')
    expect(resolved.components.map(c => c.id)).toEqual(['partA', 'partB']) // never the mutated live components
  })

  it('falls back to currentComponentsFallback ONLY when a log genuinely predates componentsSnapshot (componentResults present, no snapshot)', () => {
    const preSnapshotLog = {
      id: 'pre-snap', log_meta: {
        componentResults: { partA: { format: 'For Time', time_result: '11:42', result: null, completion_state: 'completed', sets: null, load_result: null } },
      },
    }
    const fallback = [createComponent({ id: 'fallbackComp', format: 'For Time', producesScore: true, config: {}, instances: [] })]
    const resolved = resolveHistoricalComponentsForEdit(preSnapshotLog, fallback)
    expect(resolved.source).toBe('current-fallback')
    expect(resolved.components).toBe(fallback)
  })
})

// --- Solo Max Effort edit (Part 5's own additive log_meta shape) ----------

describe('solo Max Effort historical edit (componentContract.js\'s own additive single-scorer shape)', () => {
  it('a lone Max Effort log (log_meta.componentResults with exactly 1 entry, no componentsSnapshot) still resolves via the current-fallback path', () => {
    const soloLog = {
      id: 'solo-log', log_meta: { componentResults: { solo: { format: 'Max Effort', result: null, time_result: null, completion_state: null, sets: null, load_result: 95 } } },
    }
    const fallback = [createComponent({ id: 'solo', format: 'Max Effort', producesScore: true, config: {}, instances: [] })]
    const resolved = resolveHistoricalComponentsForEdit(soloLog, fallback)
    expect(resolved).not.toBe(null)
    expect(resolved.source).toBe('current-fallback')
    const envelopes = getOrderedScoreEnvelopes(resolved.components)
    expect(envelopes).toHaveLength(1) // -> useComposerLogger's editLogId formula (length > 1) is false, matches componentContract.js's own single-scorer log_meta exception being disclosed, not routed through MultiScorerLogger by this ticket
    const hydrated = hydrateAllScorerValuesFromLog(envelopes, soloLog)
    expect(hydrated.solo.result).toBe('95')
  })
})
