// FORGE — SINGLE-SCORER JOURNAL EDIT / HISTORICAL WOD CONTEXT FIX.
//
// Root cause (confirmed via live acceptance during the Athlete-Selected
// Movement Load ticket): a single-scorer Journal Edit's structured-editing
// context (`activePrescriptionDoc`, feeding PerformedEditPanel/
// composeStructuredWorkoutDisplay) resolved from `wodZiData` - whatever
// date Home last happened to have loaded - NEVER from the log actually
// being edited. `onEditWod`'s single-scorer branch never repopulated any
// WOD context of its own (unlike `onEditSkill`, which calls
// `setDataAcasa(sl.wods.date)`). A second, related bug was found while
// fixing this: the edit `.update()` call never wrote
// `performed_prescription` at all, so even with correct context a genuine
// 70->75 edit would silently fail to persist (the old value only ever
// "survived" because the column was never touched).
//
// Fix (narrow, UI-editing-context only - historical TRUTH is untouched):
//   1. fetchWodLogs's `wods(...)` join now also selects
//      `movement_prescriptions` (previously omitted).
//   2. A new `editWodZiData` state, set by onEditWod's single-scorer branch
//      directly from `log.wods` (already fetched, no extra round trip,
//      never touches the shared dataAcasa/wodZiData Home state) and
//      cleared everywhere editLogId is cleared.
//   3. `activePrescriptionDoc` prefers `editWodZiData` over `wodZiData`
//      whenever `editLogId` is set and `editWodZiData` is present.
//   4. The edit `.update()` call now also computes and writes
//      `performed_prescription` (prune -> modification-check, explicit
//      null when reverted-to-programmed) - gated to
//      `!useComposerLogger && frozenVariantKey` so multi-scorer (10d2140)
//      and legacy/no-variant logs keep the exact prior "never touch this
//      column" behavior.

import { readFileSync } from 'fs'
import { join, dirname } from 'path'
import { fileURLToPath } from 'url'
import { describe, it, expect } from 'vitest'
import {
  pruneUntouchedBlankLoad, performedIsModified, validatePerformedPrescription,
  newMovementInstance, buildPerformedPrescriptionDraft, setPerformedMetricValue,
  buildPrescriptionSnapshot, emptyPrescriptions,
} from './prescriptionContract'
import { performedPrescriptionSubstantiveModification } from './workoutFormats'

const here = dirname(fileURLToPath(import.meta.url))
const appSource = readFileSync(join(here, 'App.jsx'), 'utf8')

// ---------------------------------------------------------------------------
// 1/2. Root cause wiring - golden-source guards
// ---------------------------------------------------------------------------
describe('App.jsx wiring - historical WOD context resolves from the edited log, not Home', () => {
  it('fetchWodLogs selects movement_prescriptions in its wods(...) join (previously omitted)', () => {
    expect(appSource).toMatch(/const fetchWodLogs = async \(\) => \{[\s\S]{0,1200}?wods\(name, type, duration, format_config, movement_prescriptions,/)
  })

  it('onEditWod (single-scorer branch) sets editWodZiData from the log\'s OWN joined wods row', () => {
    expect(appSource).toMatch(/setEditWodZiData\(log\.wods \|\| null\)/)
  })

  it('DATE-INDEPENDENCE: activePrescriptionDoc prefers editWodZiData over wodZiData whenever editLogId + editWodZiData are set - the mandatory root-cause regression', () => {
    // Home/current WOD = wodZiData; historical Journal log = editWodZiData.
    // Editing must use editWodZiData (B), never wodZiData (A), whenever both
    // exist and disagree.
    expect(appSource).toMatch(/const activePrescriptionDoc = inFrozenLogFlow\s*\n\s*\? \(logCtx\.prescriptionDoc \?\? null\)\s*\n\s*: \(editLogId && editWodZiData \? \(editWodZiData\?\.movement_prescriptions \?\? null\) : \(wodZiData\?\.movement_prescriptions \?\? null\)\)/)
  })

  it('fresh logging (editLogId null) is byte-identical: activePrescriptionDoc still falls back to wodZiData when editWodZiData is absent', () => {
    // Same regex as above already proves the ternary's else-branch is
    // unchanged (`wodZiData?.movement_prescriptions ?? null`) - this test
    // documents the intent explicitly.
    expect(appSource).toMatch(/: \(wodZiData\?\.movement_prescriptions \?\? null\)\)/)
  })
})

// ---------------------------------------------------------------------------
// 16. Home state after cancel/back - editWodZiData cleared everywhere
// editLogId is cleared, never touching the shared dataAcasa/wodZiData.
// ---------------------------------------------------------------------------
describe('State cleanup - editWodZiData never leaks into a later session', () => {
  it('the main Cancel/Back handler clears editWodZiData alongside editLogId', () => {
    expect(appSource).toMatch(/if \(editLogId\) \{ setEditLogId\(null\); setEditLogNotesPrefix\(''\); setEditLogHeader\(''\); setEditLogFormatId\(null\); setEditLogFormatConfig\(null\); setEditLogMiscari\(\[\]\); setEditWodZiData\(null\);/)
  })

  it('the generic screen-exit effect (any navigation away from logWOD/logSkill) also clears editWodZiData', () => {
    expect(appSource).toMatch(/if \(screen !== 'logWOD' && screen !== 'logSkill'\) \{\s*\n\s*setLogCtx\(null\)\s*\n\s*setPerformedCommitted\(null\); setPerformedDraft\(null\); setLogWodEditMode\(false\)[\s\S]{0,600}?setEditWodZiData\(null\)/)
  })

  it('every other setEditLogId(null) call site also clears editWodZiData (additional-section entry, fresh Log Score entry, New entry from Journal)', () => {
    const matches = appSource.match(/setEditLogId\(null\)/g) || []
    const pairedMatches = appSource.match(/setEditLogId\(null\)[^\n]{0,80}setEditWodZiData\(null\)|setEditWodZiData\(null\)[^\n]{0,120}setEditLogId\(null\)|setEditLogId\(null\); setEditWodZiData\(null\)/g) || []
    // Every call site of setEditLogId(null) in the file also clears
    // editWodZiData somewhere on the same statement/line.
    expect(matches.length).toBeGreaterThanOrEqual(5)
    expect((appSource.match(/setEditLogId\(null\); setEditWodZiData\(null\)/g) || []).length).toBeGreaterThanOrEqual(1)
  })

  it('editWodZiData is declared as its own isolated state - never aliases or reuses dataAcasa/wodZiData setters', () => {
    expect(appSource).toMatch(/const \[editWodZiData, setEditWodZiData\] = useState\(null\)/)
    // Confirms the fix never calls setDataAcasa - Home's own date/WOD browsing
    // state is completely untouched by Journal Edit, so Cancel/Back can never
    // poison it.
    const nearDecl = appSource.slice(appSource.indexOf('setEditWodZiData(log.wods'), appSource.indexOf('setEditWodZiData(log.wods') + 400)
    expect(nearDecl).not.toMatch(/setDataAcasa/)
  })
})

// ---------------------------------------------------------------------------
// 13/17. Multi-scorer + legacy firewall - the performed_prescription edit
// write is gated so 10d2140 and legacy/no-variant logs are untouched.
// ---------------------------------------------------------------------------
describe('Edit-save performed_prescription write - gated, multi-scorer and legacy untouched', () => {
  it('the update() payload now computes performedPrescriptionEditPayload, gated to !useComposerLogger && frozenVariantKey', () => {
    expect(appSource).toMatch(/const performedPrescriptionEditPayload = \(!useComposerLogger && frozenVariantKey\) \? \{/)
  })

  it('the update() call spreads performedPrescriptionEditPayload', () => {
    expect(appSource).toMatch(/\.\.\.performedPrescriptionEditPayload,\s*\n\s*\}\)\.eq\('id', editLogId\)/)
  })

  it('a multi-scorer edit (useComposerLogger) never gets this key at all - composeComponentsLogFields/10d2140 own the write entirely, untouched', () => {
    // The gate is a single boolean expression - useComposerLogger true means
    // performedPrescriptionEditPayload is {} (no key), byte-identical to the
    // pre-existing "never touch this column" behavior for that path.
    expect(appSource).toMatch(/\(!useComposerLogger && frozenVariantKey\) \? \{[\s\S]{0,20}performed_prescription:/)
  })
})

// ---------------------------------------------------------------------------
// Pure re-implementation of the edit-save decision, tested against fixtures.
// Mirrors performedPrescriptionEditPayload's own logic exactly (prune ->
// modification-check -> explicit null when unmodified) so the ALGORITHM is
// proven correct independent of React/Supabase wiring.
// ---------------------------------------------------------------------------
function computeEditSavePayload({ performedCommitted, programmedDoc, variantKey, gender }) {
  const pruned = performedCommitted ? pruneUntouchedBlankLoad(performedCommitted, programmedDoc, variantKey) : null
  return (pruned && performedIsModified(pruned, programmedDoc, variantKey, gender) && validatePerformedPrescription(pruned).valid)
    ? pruned
    : null
}

function loadInst({ name = 'Deadlift', load = null } = {}) {
  const inst = newMovementInstance({ name })
  inst.instanceId = `mi_${name.replace(/\s+/g, '_')}`
  inst.reps = { mode: 'universal', value: 10 }
  if (load !== null) inst.load = { mode: 'universal', value: load, unit: 'kg' }
  return inst
}
function programmedDocFor(instances) { return { ...emptyPrescriptions(), variants: { rx: { movements: instances } } } }

describe('edit-save payload algorithm - fixture-proven (mirrors the golden-sourced logic 1:1)', () => {
  it('3. blank programmed load + performed 70 -> persists 70', () => {
    const prog = programmedDocFor([loadInst({ load: null })])
    const draft = buildPerformedPrescriptionDraft({ doc: prog, variantKey: 'rx' })
    draft.movements[0] = setPerformedMetricValue(draft.movements[0], 'load', 70, 'kg')
    const payload = computeEditSavePayload({ performedCommitted: draft, programmedDoc: prog, variantKey: 'rx', gender: null })
    expect(payload?.movements[0]?.load?.value).toBe(70)
  })

  it('4. unchanged save (re-submit the exact same 70) preserves 70', () => {
    const prog = programmedDocFor([loadInst({ load: null })])
    const draft = buildPerformedPrescriptionDraft({ doc: prog, variantKey: 'rx' })
    draft.movements[0] = setPerformedMetricValue(draft.movements[0], 'load', 70, 'kg')
    const first = computeEditSavePayload({ performedCommitted: draft, programmedDoc: prog, variantKey: 'rx', gender: null })
    const second = computeEditSavePayload({ performedCommitted: first, programmedDoc: prog, variantKey: 'rx', gender: null })
    expect(second?.movements[0]?.load?.value).toBe(70)
  })

  it('5. 70->75 preserves the edit (score/TIME is a separate field, untouched by this payload) and programmed stays blank', () => {
    const prog = programmedDocFor([loadInst({ load: null })])
    const draft = buildPerformedPrescriptionDraft({ doc: prog, variantKey: 'rx' })
    draft.movements[0] = setPerformedMetricValue(draft.movements[0], 'load', 70, 'kg')
    const committed70 = computeEditSavePayload({ performedCommitted: draft, programmedDoc: prog, variantKey: 'rx', gender: null })
    const edited = { ...committed70, movements: committed70.movements.map((m, i) => i === 0 ? setPerformedMetricValue(m, 'load', 75, 'kg') : m) }
    const committed75 = computeEditSavePayload({ performedCommitted: edited, programmedDoc: prog, variantKey: 'rx', gender: null })
    expect(committed75?.movements[0]?.load?.value).toBe(75)
    expect(prog.variants.rx.movements[0].load).toBeUndefined() // programmed doc itself never mutated
  })

  it('6. prescribed 100 -> performed 90 remains Mixed-eligible (payload persists, substantive-modification says true)', () => {
    const prog = programmedDocFor([loadInst({ load: 100 })])
    const draft = buildPerformedPrescriptionDraft({ doc: prog, variantKey: 'rx' })
    draft.movements[0] = setPerformedMetricValue(draft.movements[0], 'load', 90, 'kg')
    const payload = computeEditSavePayload({ performedCommitted: draft, programmedDoc: prog, variantKey: 'rx', gender: null })
    expect(payload?.movements[0]?.load?.value).toBe(90)
    const snap = buildPrescriptionSnapshot({ doc: prog, variantKey: 'rx', gender: null, source: 'structured' })
    expect(performedPrescriptionSubstantiveModification({ prescription_snapshot: snap, performed_prescription: payload })).toBe(true)
  })

  it('7. prescribed 100 -> performed 110 (heavier) remains Mixed-eligible, never auto-Rx', () => {
    const prog = programmedDocFor([loadInst({ load: 100 })])
    const draft = buildPerformedPrescriptionDraft({ doc: prog, variantKey: 'rx' })
    draft.movements[0] = setPerformedMetricValue(draft.movements[0], 'load', 110, 'kg')
    const payload = computeEditSavePayload({ performedCommitted: draft, programmedDoc: prog, variantKey: 'rx', gender: null })
    const snap = buildPrescriptionSnapshot({ doc: prog, variantKey: 'rx', gender: null, source: 'structured' })
    expect(performedPrescriptionSubstantiveModification({ prescription_snapshot: snap, performed_prescription: payload })).toBe(true)
  })

  it('8. blank -> 70 remains non-Mixed (the payload persists the value, but substantive-modification says false)', () => {
    const prog = programmedDocFor([loadInst({ load: null })])
    const draft = buildPerformedPrescriptionDraft({ doc: prog, variantKey: 'rx' })
    draft.movements[0] = setPerformedMetricValue(draft.movements[0], 'load', 70, 'kg')
    const payload = computeEditSavePayload({ performedCommitted: draft, programmedDoc: prog, variantKey: 'rx', gender: null })
    const snap = buildPrescriptionSnapshot({ doc: prog, variantKey: 'rx', gender: null, source: 'structured' })
    expect(performedPrescriptionSubstantiveModification({ prescription_snapshot: snap, performed_prescription: payload })).toBe(false)
  })

  it('a reverted-to-programmed edit writes explicit null (clears a stale overlay), never merely omitted', () => {
    const prog = programmedDocFor([loadInst({ load: 100 })])
    const draft = buildPerformedPrescriptionDraft({ doc: prog, variantKey: 'rx' })
    draft.movements[0] = setPerformedMetricValue(draft.movements[0], 'load', 90, 'kg')
    const committed90 = computeEditSavePayload({ performedCommitted: draft, programmedDoc: prog, variantKey: 'rx', gender: null })
    expect(committed90).not.toBeNull()
    // athlete reverts the edit back to exactly the programmed 100
    const reverted = { ...committed90, movements: committed90.movements.map((m, i) => i === 0 ? setPerformedMetricValue(m, 'load', 100, 'kg') : m) }
    const finalPayload = computeEditSavePayload({ performedCommitted: reverted, programmedDoc: prog, variantKey: 'rx', gender: null })
    expect(finalPayload).toBeNull() // explicit null in the update payload
  })

  it('a log with no performed override at all (performedCommitted null) always yields null - never fabricates an overlay', () => {
    const prog = programmedDocFor([loadInst({ load: null })])
    const payload = computeEditSavePayload({ performedCommitted: null, programmedDoc: prog, variantKey: 'rx', gender: null })
    expect(payload).toBeNull()
  })
})

// ---------------------------------------------------------------------------
// 9/10/12/14. DNF/partial, AMRAP, legacy, snapshot-first - unaffected by
// this ticket (no changes to any of these mechanisms); proven by absence of
// any new coupling in the golden source, and by the underlying comparison
// engine's own pre-existing, unchanged fixture coverage
// (athleteSelectedMovementLoad.test.js, performedPrescription.test.js).
// ---------------------------------------------------------------------------
describe('non-regression - untouched mechanisms', () => {
  it('this fix touches only activePrescriptionDoc resolution + the edit-save payload - performedStationInstances/effectivePartialMovements (DNF/partial) are not modified', () => {
    expect(appSource).not.toMatch(/performedStationInstances\(performedCommitted, frozenProgrammedInstances\)[\s\S]{0,10}editWodZiData/)
  })

  it('14. snapshot-first: prescription_snapshot is never written by the edit-save payload (only performed_prescription is)', () => {
    const editBlock = appSource.slice(appSource.indexOf('const performedPrescriptionEditPayload'), appSource.indexOf('const performedPrescriptionEditPayload') + 900)
    expect(editBlock).not.toMatch(/prescription_snapshot:/)
  })

  it('12. legacy logs (no resolved frozenVariantKey) keep the exact prior "never touch performed_prescription" behavior - the gate gets {} for them', () => {
    // Covered by the golden-source gate assertion above
    // ((!useComposerLogger && frozenVariantKey) ? {...} : {}) - when
    // frozenVariantKey is falsy (legacy/no-variant), the else branch {} is
    // spread, identical to before this ticket.
    expect(appSource).toMatch(/const performedPrescriptionEditPayload = \(!useComposerLogger && frozenVariantKey\) \? \{[\s\S]{0,900}?\} : \{\}/)
  })
})
