// INC-17 - PERFORMED-AWARE PARTIAL RESULT INTEGRITY (owner-narrowed scope).
//
// Root cause: the plain-sequential (For Time/Chipper/Ladder/Buy-In-Cash-Out -
// NOT Sequence AMRAP, which already resolves its own performed-aware
// stations) Did-not-finish partial/capped round editor built its movement
// list ONLY from the programmed prescription (composeStructuredWorkoutDisplay
// on activePrescriptionDoc) - with no path to performed_prescription at all.
// A sibling code path eleven lines below it (Sequence AMRAP / structured
// Intervals station resolution) already correctly consulted
// performedStationInstances - the canonical "effective performed
// composition" abstraction - but the plain-sequential branch was never
// wired to it.
//
// Owner-approved scope (STRICT):
//   A. no performed modification + Did not finish -> UNCHANGED, partial rows
//      stay programmed.
//   B. performed modification + Finished -> UNCHANGED, this function is
//      never even consulted (callers only reach it from the capped branch).
//   C. performed modification + Did not finish -> THIS is the fixed path:
//      partial rows use the effective performed composition.
//
// Fix: resolveEffectivePartialMovements(...) (prescriptionContract.js) - a
// pure function reusing performedIsModified (to detect "does anything
// actually differ" - conditions A vs C) and performedStationInstances +
// resolveMovementInstance/renderInstanceLine (the SAME generic,
// capability-agnostic rendering pipeline that already produces the
// programmed movement lines) for the override case. Nothing new was
// invented: no new scoring model, no movement-name branch, no schema change.
// App.jsx additionally gates this off for editLogId (editing an already-
// saved log - out of scope) and logTargetSection (an unrelated
// independently-scored section) and Sequence AMRAP (already correct) -
// those three guards live in App.jsx, not in this pure function, and are
// exercised only implicitly (App.jsx is not unit-testable here); this file
// tests the actual reconciliation logic the guards gate access to.

import { describe, it, expect } from 'vitest'
import {
  resolveEffectivePartialMovements, buildPerformedPrescriptionDraft, applyPerformedSubstitution,
  setPerformedMetricValue, resolveMovementCapability, performedIsModified,
} from './prescriptionContract.js'
import { composePartialText, partialRepsOfLog, sequentialProgressionDeparted, resultCompositionModified } from './workoutFormats.js'

const A = 'mi_a000000000000000000001'
const B = 'mi_b000000000000000000002'
const CJ_ROW = { id: '2cfd0278-21a4-47c3-8ece-3a40b6a742b8', name: 'Row' }
const rowCapability = resolveMovementCapability({ allowed_prescription_metrics: ['distance', 'calories'], default_prescription_metric: 'calories' })

const programmed = () => ({
  version: 1,
  variants: { rx: { movements: [
    { instanceId: A, name: 'Clean and jerks', canonicalMovementId: 'cm-cj', reps: { mode: 'universal', value: 21 }, load: { mode: 'universal', value: 43, unit: 'kg' } },
    { instanceId: B, name: 'Air Bike', canonicalMovementId: 'cm-airbike', calories: { mode: 'universal', value: 21 } },
  ] } },
})
const programmedInstances = () => programmed().variants.rx.movements
const programmedLines = () => ['21 Clean and jerks @ 43 kg', '21 Cal Air Bike']

describe('INC-17 - condition A: no performed modification -> unchanged, byte-identical', () => {
  it('null performed doc returns programmedLines verbatim (same reference, no transformation attempted)', () => {
    const lines = programmedLines()
    const result = resolveEffectivePartialMovements({
      performedDoc: null, programmedDoc: programmed(), variantKey: 'rx', gender: 'male',
      programmedInstances: programmedInstances(), programmedLines: lines,
    })
    expect(result).toBe(lines)
  })

  it('a v2 performed doc that resolves identically to programmed (never touched) returns programmedLines verbatim', () => {
    const draft = buildPerformedPrescriptionDraft({ doc: programmed(), variantKey: 'rx' })
    expect(performedIsModified(draft, programmed(), 'rx', 'male')).toBe(false) // sanity: draft == programmed
    const result = resolveEffectivePartialMovements({
      performedDoc: draft, programmedDoc: programmed(), variantKey: 'rx', gender: 'male',
      programmedInstances: programmedInstances(), programmedLines: programmedLines(),
    })
    expect(result).toEqual(programmedLines())
  })
})

describe('INC-17 - condition C: performed modification -> effective performed composition', () => {
  it('OWNER REPRODUCTION: Clean & Jerk -> Row/Distance/250m replaces station 1, station 2 (untouched) stays programmed', () => {
    let draft = buildPerformedPrescriptionDraft({ doc: programmed(), variantKey: 'rx' })
    draft.movements[0] = applyPerformedSubstitution(draft.movements[0], CJ_ROW, rowCapability)
    draft.movements[0] = setPerformedMetricValue(draft.movements[0], 'distance', 250, 'm')
    expect(performedIsModified(draft, programmed(), 'rx', 'male')).toBe(true)

    const result = resolveEffectivePartialMovements({
      performedDoc: draft, programmedDoc: programmed(), variantKey: 'rx', gender: 'male',
      programmedInstances: programmedInstances(), programmedLines: programmedLines(),
    })
    expect(result).toEqual(['250 m Row', '21 Cal Air Bike'])
    expect(result).not.toContain('21 Clean and jerks @ 43 kg') // never asks progress against a movement the athlete said they didn't do

    // Feed straight into the unmodified composePartialText/partialRepsOfLog
    // pipeline exactly as composeWodLogFieldsInner does - no new arithmetic.
    const partialText = composePartialText(['150', '21'], result)
    expect(partialText).toBe('150/250 m Row, 21/21 Cal Air Bike')
    expect(partialRepsOfLog({ result: partialText }, true)).toBe(171)
  })

  it('same-metric substitution (Air Bike -> Row, both calories): effective line uses Row, not stale Air Bike', () => {
    let draft = buildPerformedPrescriptionDraft({ doc: programmed(), variantKey: 'rx' })
    draft.movements[1] = applyPerformedSubstitution(draft.movements[1], CJ_ROW, rowCapability)
    draft.movements[1] = setPerformedMetricValue(draft.movements[1], 'calories', 21, null)

    const result = resolveEffectivePartialMovements({
      performedDoc: draft, programmedDoc: programmed(), variantKey: 'rx', gender: 'male',
      programmedInstances: programmedInstances(), programmedLines: programmedLines(),
    })
    expect(result).toEqual(['21 Clean and jerks @ 43 kg', '21 Cal Row'])
  })

  it('reps+load -> reps+load substitution: effective line carries the new movement + its own reconciled metrics', () => {
    const dbThruster = { id: 'cm-db-thruster', name: 'Dumbbell Thruster' }
    const capRepsLoad = resolveMovementCapability({ allowed_prescription_metrics: ['reps', 'load'], default_prescription_metric: 'load' })
    let draft = buildPerformedPrescriptionDraft({ doc: programmed(), variantKey: 'rx' })
    draft.movements[0] = applyPerformedSubstitution(draft.movements[0], dbThruster, capRepsLoad)
    draft.movements[0] = setPerformedMetricValue(draft.movements[0], 'load', 30, 'kg')

    const result = resolveEffectivePartialMovements({
      performedDoc: draft, programmedDoc: programmed(), variantKey: 'rx', gender: 'male',
      programmedInstances: programmedInstances(), programmedLines: programmedLines(),
    })
    expect(result[0]).toBe('21 Dumbbell Thruster @ 30 kg') // reps carried (compatible), load updated, name/id changed
    expect(result[1]).toBe('21 Cal Air Bike')
  })

  it('skipped movement ("I didn\'t do this one") never reappears as a completed performed row', () => {
    let draft = buildPerformedPrescriptionDraft({ doc: programmed(), variantKey: 'rx' })
    draft.movements[0] = { ...draft.movements[0], notPerformed: true }
    const result = resolveEffectivePartialMovements({
      performedDoc: draft, programmedDoc: programmed(), variantKey: 'rx', gender: 'male',
      programmedInstances: programmedInstances(), programmedLines: programmedLines(),
    })
    // bare name, no leading target number -> composePartialText can never
    // attach entered progress to it as a false "target N" claim
    expect(result[0]).toBe('Clean and jerks')
    expect(result[0]).not.toMatch(/^\d/)
    const partialText = composePartialText(['', '21'], result)
    expect(partialText).toBe('21/21 Cal Air Bike') // the skipped station contributes nothing
    expect(partialRepsOfLog({ result: partialText }, true)).toBe(21)
  })

  it('multiple substitutions: each station resolves independently and correctly', () => {
    let draft = buildPerformedPrescriptionDraft({ doc: programmed(), variantKey: 'rx' })
    draft.movements[0] = applyPerformedSubstitution(draft.movements[0], CJ_ROW, rowCapability)
    draft.movements[0] = setPerformedMetricValue(draft.movements[0], 'distance', 250, 'm')
    const ski = { id: 'cm-ski', name: 'Ski' }
    draft.movements[1] = applyPerformedSubstitution(draft.movements[1], ski, rowCapability)
    draft.movements[1] = setPerformedMetricValue(draft.movements[1], 'calories', 15, null)

    const result = resolveEffectivePartialMovements({
      performedDoc: draft, programmedDoc: programmed(), variantKey: 'rx', gender: 'male',
      programmedInstances: programmedInstances(), programmedLines: programmedLines(),
    })
    expect(result).toEqual(['250 m Row', '15 Cal Ski'])
  })

  it('mixed modified + unmodified: unchanged programmed station combines with the performed override, not all-or-nothing', () => {
    let draft = buildPerformedPrescriptionDraft({ doc: programmed(), variantKey: 'rx' })
    draft.movements[0] = applyPerformedSubstitution(draft.movements[0], CJ_ROW, rowCapability)
    draft.movements[0] = setPerformedMetricValue(draft.movements[0], 'distance', 250, 'm')
    // movements[1] (Air Bike) is left completely untouched
    const result = resolveEffectivePartialMovements({
      performedDoc: draft, programmedDoc: programmed(), variantKey: 'rx', gender: 'male',
      programmedInstances: programmedInstances(), programmedLines: programmedLines(),
    })
    expect(result[0]).toBe('250 m Row') // overridden
    expect(result[1]).toBe('21 Cal Air Bike') // programmed, untouched - proves no all-or-nothing replacement
  })
})

describe('INC-17 - INC-12 sequential departure still evaluates correctly on the effective composition', () => {
  it('incomplete predecessor (performed Row, partial) + later positive still departs (Modified)', () => {
    let draft = buildPerformedPrescriptionDraft({ doc: programmed(), variantKey: 'rx' })
    draft.movements[0] = applyPerformedSubstitution(draft.movements[0], CJ_ROW, rowCapability)
    draft.movements[0] = setPerformedMetricValue(draft.movements[0], 'distance', 250, 'm')
    const effective = resolveEffectivePartialMovements({
      performedDoc: draft, programmedDoc: programmed(), variantKey: 'rx', gender: 'male',
      programmedInstances: programmedInstances(), programmedLines: programmedLines(),
    })
    const partialText = composePartialText(['150', '21'], effective) // 150/250 Row (incomplete) then a later positive
    expect(sequentialProgressionDeparted(partialText)).toBe(true)
  })

  it('capping alone (no independent modification) never creates Modified - result axes stay independent', () => {
    const partialText = composePartialText(['21', '5'], programmedLines())
    const modified = resultCompositionModified(
      { weight_logged: null, performed_prescription: null, result: partialText },
      null, programmedLines().map((l) => l), programmedLines(), 'For Time', {},
    )
    expect(modified).toBe(false)
  })

  it('a genuine performed override DOES classify Modified, independent of completion/score', () => {
    let draft = buildPerformedPrescriptionDraft({ doc: programmed(), variantKey: 'rx' })
    draft.movements[0] = applyPerformedSubstitution(draft.movements[0], CJ_ROW, rowCapability)
    draft.movements[0] = setPerformedMetricValue(draft.movements[0], 'distance', 250, 'm')
    expect(performedIsModified(draft, programmed(), 'rx', 'male')).toBe(true)
  })
})

describe('INC-17 - future-proof: synthetic catalog fixtures, capability-driven not name-driven', () => {
  it('a substitution target never seen anywhere in source still renders and reconciles from capability alone', () => {
    const futureMovement = { id: 'catalog-row-added-tomorrow', name: 'Totally New Machine 3000' }
    const futureCapability = resolveMovementCapability({ allowed_prescription_metrics: ['calories', 'distance'], default_prescription_metric: 'distance' })
    let draft = buildPerformedPrescriptionDraft({ doc: programmed(), variantKey: 'rx' })
    draft.movements[0] = applyPerformedSubstitution(draft.movements[0], futureMovement, futureCapability)
    draft.movements[0] = setPerformedMetricValue(draft.movements[0], 'distance', 400, 'm')
    const result = resolveEffectivePartialMovements({
      performedDoc: draft, programmedDoc: programmed(), variantKey: 'rx', gender: 'male',
      programmedInstances: programmedInstances(), programmedLines: programmedLines(),
    })
    expect(result[0]).toBe('400 m Totally New Machine 3000')
  })
})
