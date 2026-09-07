// FORGE - STRENGTH SETS OPTIONAL PROGRAMMED LOAD / REQUIRED PERFORMED LOAD
//
// ROOT CAUSE (forensic, confirmed by direct code trace, not guessed from the
// screenshot alone):
//
//   wodSections.js's `validatePrescriptionCompleteness` (the real SAVE gate,
//   called from every save path) delegates to prescriptionContract.js's
//   `validatePrescriptionsForPublish`, whose DELIBERATE, documented rule is:
//   "load / distance / calories the coach STARTED must be fully filled" - a
//   present-but-incomplete spec ({male:null, female:null}) blocks save with
//   "<name> (<variant>): load is missing." This rule is correct and untouched
//   by this fix - the actual bug is that a load-DEFAULT movement (Snatch,
//   Clean & Jerk, Back Squat - any lift whose catalog
//   default_prescription_metric IS 'load') had NO WAY to ever reach the
//   "never started" (key absent) state: newMovementInstance auto-seeds a
//   present-but-null load spec on creation, and MovementRowPWA's "remove"
//   affordance for the Load field was explicitly disabled whenever
//   `cap.default === 'load'` (App.jsx, PmpeMetricEditor's onRemove prop) -
//   exactly the movements this whole request is about. The coach was
//   permanently stuck once a load-primary movement was added: fill it in, or
//   never be able to save.
//
//   The DB trigger (validate_movement_prescriptions, supabase/migrations/
//   20260829090000_movement_prescription_engine_foundation.sql) already
//   skips absent metric keys entirely (`IF NOT (mv ? spec_key) THEN
//   CONTINUE`) and explicitly documents "Does NOT enforce completeness...
//   that is a client publish-gate" - so no DB/migration change was needed;
//   this was purely a client-side gap.
//
// FIX: App.jsx's one `onRemove` ternary now also allows removal whenever
// `instance.reps` is present (true for any movement, like Snatch, whose
// capability allows BOTH reps and load - real structure survives the
// removal). A movement whose capability is load-ONLY keeps the original
// guard (removing its one and only metric would leave zero prescription).
// No validator changed, no capability detection changed, no format-specific
// branch, nothing hardcoded to "Snatch".

import { describe, it, expect, afterEach } from 'vitest'
import { useState } from 'react'
import { render, screen, cleanup, fireEvent } from '@testing-library/react'
import { MovementRowListPWA } from './App.jsx'
import FormatLogger from './FormatLogger'
import { createSection, legacyPayloadFromSections, validatePrescriptionCompleteness } from './wodSections.js'
import {
  validatePrescriptionsForPublish, resolveMovementCapability, renderInstanceLine, resolveMovementInstance,
  buildMovementIndex,
} from './prescriptionContract.js'
import { defaultRowsForFormat, resultCompositionModified, isMixedCategory } from './workoutFormats.js'

afterEach(cleanup)

// Real catalog-shaped rows (same convention as inc15/16/17/18's own tests).
const CATALOG = [
  { id: 'cm-snatch', name: 'Snatch', allowed_prescription_metrics: ['reps', 'load'], default_prescription_metric: 'load' },
  { id: 'cm-pu', name: 'Push-up', allowed_prescription_metrics: ['reps'], default_prescription_metric: 'reps' },
]
const movementIndex = buildMovementIndex(CATALOG)
const catalog = {
  capabilityFor: (name) => resolveMovementCapability(CATALOG.find((r) => r.name.toLowerCase() === (name || '').toLowerCase())),
  capabilityForInstance: (inst) => resolveMovementCapability(movementIndex.byId.get(inst?.canonicalMovementId)),
  lookupForParse: (name) => CATALOG.find((r) => r.name.toLowerCase() === (name || '').toLowerCase()) || null,
  suggestions: () => [],
  index: movementIndex,
}

const snatchNoLoad = { instanceId: 'mi_sn', name: 'Snatch', canonicalMovementId: 'cm-snatch', reps: { mode: 'universal', value: null } }
const snatchHalfLoad = { instanceId: 'mi_sn', name: 'Snatch', canonicalMovementId: 'cm-snatch', reps: { mode: 'universal', value: null }, load: { mode: 'sex_specific', male: null, female: null, unit: 'kg' } }
const snatchFullLoad = { instanceId: 'mi_sn', name: 'Snatch', canonicalMovementId: 'cm-snatch', reps: { mode: 'universal', value: 5 }, load: { mode: 'sex_specific', male: 43, female: 30, unit: 'kg' } }

// ===========================================================================
// COACH BUILDER - real MovementRowPWA (via MovementRowListPWA), real
// component, real "remove" interaction.
// ===========================================================================
describe('COACH BUILDER - a load-default movement (Snatch) can have its Load field removed', () => {
  it('the "remove" link is now present for Snatch (previously hidden because cap.default === "load")', () => {
    render(<MovementRowListPWA instances={[snatchHalfLoad]} onChange={() => {}} catalog={catalog} />)
    expect(screen.getByText('remove')).toBeInTheDocument()
  })

  it('clicking "remove" deletes the load key entirely (not just nulls its values)', () => {
    let latest = null
    render(<MovementRowListPWA instances={[snatchHalfLoad]} onChange={(next) => { latest = next }} catalog={catalog} />)
    fireEvent.click(screen.getByText('remove'))
    expect(latest[0].load).toBeUndefined()
    expect('load' in latest[0]).toBe(false)
  })

  it('J - a bodyweight-only movement (Push-up) never gains a Load field or a remove link (regression, untouched branch)', () => {
    const pushUp = { instanceId: 'mi_pu', name: 'Push-up', canonicalMovementId: 'cm-pu', reps: { mode: 'universal', value: 10 } }
    render(<MovementRowListPWA instances={[pushUp]} onChange={() => {}} catalog={catalog} />)
    expect(screen.queryByText('Load')).not.toBeInTheDocument()
    expect(screen.queryByText('+ Load')).not.toBeInTheDocument()
    expect(screen.queryByText('remove')).not.toBeInTheDocument()
  })

  it('a load-capable movement WITHOUT reps at all (edge case) keeps the original guard - no remove link, so it never ends up with zero prescription content', () => {
    const loadOnly = { instanceId: 'mi_lo', name: 'Load Only Move', canonicalMovementId: null, load: { mode: 'sex_specific', male: null, female: null, unit: 'kg' } }
    const capLoadOnly = { capabilityFor: () => resolveMovementCapability({ allowed_prescription_metrics: ['load'], default_prescription_metric: 'load' }), capabilityForInstance: () => resolveMovementCapability({ allowed_prescription_metrics: ['load'], default_prescription_metric: 'load' }), lookupForParse: () => null, suggestions: () => [] }
    render(<MovementRowListPWA instances={[loadOnly]} onChange={() => {}} catalog={capLoadOnly} />)
    expect(screen.queryByText('remove')).not.toBeInTheDocument()
  })
})

// ===========================================================================
// VALIDATION - the real save-gate function, unchanged, exercised against the
// new reachable "load absent" state.
// ===========================================================================
describe('VALIDATION - validatePrescriptionsForPublish (the real save gate)', () => {
  const docWith = (mv) => ({ version: 1, variants: { rx: { movements: [mv] } } })

  it('A/E/F - Snatch with load key ABSENT passes (blank programmed load is valid, never becomes 0, reps stays the only structure)', () => {
    const res = validatePrescriptionsForPublish(docWith(snatchNoLoad))
    expect(res.valid).toBe(true)
    expect(res.errors).toEqual([])
  })

  it('REGRESSION - Snatch with load PRESENT but half-filled (both M/F null) still correctly fails - the fix does not weaken the real "started but incomplete" rule', () => {
    const res = validatePrescriptionsForPublish(docWith(snatchHalfLoad))
    expect(res.valid).toBe(false)
    expect(res.errors).toEqual(['Snatch (rx): load is missing.'])
  })

  it('H - Snatch with load fully filled passes, and preserves the value (not touched by this fix)', () => {
    const res = validatePrescriptionsForPublish(docWith(snatchFullLoad))
    expect(res.valid).toBe(true)
  })

  it('a half-entered load (only one of M/F filled) still correctly fails - genuine mistake, distinct from a deliberately absent key', () => {
    const halfEntered = { ...snatchNoLoad, load: { mode: 'sex_specific', male: 43, female: null, unit: 'kg' } }
    const res = validatePrescriptionsForPublish(docWith(halfEntered))
    expect(res.valid).toBe(false)
    expect(res.errors).toEqual(["Snatch (rx): women's load is missing."])
  })
})

// ===========================================================================
// SAVE / RELOAD - real wodSections serialization (A, B)
// ===========================================================================
describe('COACH SAVE/RELOAD - real legacyPayloadFromSections + validatePrescriptionCompleteness', () => {
  it('A - Strength Sets Snatch, load blank, 2x5/3x4/2x3 scheme -> save succeeds (validatePrescriptionCompleteness reports no errors)', () => {
    const s = createSection('metcon', true)
    s.format = 'Strength Sets'
    s.formatConfig = { setsScheme: [5, 5, 4, 4, 4, 3, 3] }
    s.variants.rx.instances = [snatchNoLoad]
    const errors = validatePrescriptionCompleteness([s])
    expect(errors).toEqual([])
  })

  it('B - reload preserves set/rep structure (setsScheme) and leaves load absent', () => {
    const s = createSection('metcon', true)
    s.format = 'Strength Sets'
    s.formatConfig = { setsScheme: [5, 5, 4, 4, 4, 3, 3] }
    s.variants.rx.instances = [snatchNoLoad]
    const payload = legacyPayloadFromSections([s])
    const reloaded = JSON.parse(JSON.stringify(payload))
    expect(reloaded.format_config.setsScheme).toEqual([5, 5, 4, 4, 4, 3, 3])
    const reloadedInst = reloaded.movement_prescriptions.variants.rx.movements[0]
    expect(reloadedInst.name).toBe('Snatch')
    expect(reloadedInst.load).toBeUndefined()
  })

  it('H - a coach-provided load (43kg) is preserved through the same save/reload round trip', () => {
    const s = createSection('metcon', true)
    s.format = 'Strength Sets'
    s.formatConfig = { setsScheme: [5] }
    s.variants.rx.instances = [snatchFullLoad]
    const payload = legacyPayloadFromSections([s])
    const reloadedInst = JSON.parse(JSON.stringify(payload)).movement_prescriptions.variants.rx.movements[0]
    expect(reloadedInst.load).toEqual({ mode: 'sex_specific', male: 43, female: 30, unit: 'kg' })
  })
})

// ===========================================================================
// DISPLAY - section 6, real renderInstanceLine
// ===========================================================================
describe('DISPLAY - clean prescription text, programmed vs performed truth kept separate', () => {
  it('F/section 6 - blank load renders "5 Snatch", never "@ blank kg" or "@ 0 kg" or "@ undefined kg"', () => {
    const withReps = { ...snatchNoLoad, reps: { mode: 'universal', value: 5 } }
    const resolved = resolveMovementInstance(withReps, 'male')
    expect(resolved.line).toBe('5 Snatch')
    expect(resolved.line).not.toContain('@')
  })

  it('H/section 6 - a filled load renders "5 Snatch @ 43 kg"', () => {
    const resolved = resolveMovementInstance(snatchFullLoad, 'male')
    expect(resolved.line).toBe('5 Snatch @ 43 kg')
  })

  it('the pre-fix half-filled state (present but null) ALSO never leaks "@ blank kg" - resolveSpec/measureToken already guard this, unaffected by the fix', () => {
    const resolved = resolveMovementInstance(snatchHalfLoad, null)
    expect(resolved.line).not.toContain('blank')
    expect(resolved.line).not.toContain('undefined')
  })
})

// ===========================================================================
// SECTION 8 - the owner's exact structured scheme, 7 concrete rows
// ===========================================================================
describe('STRUCTURED SCHEME - 2x5/3x4/2x3 expands to exactly 7 rows, unaffected by blank load', () => {
  it('defaultRowsForFormat produces 7 target-reps rows for the Snatch movement', () => {
    const rows = defaultRowsForFormat('Strength Sets', { setsScheme: [5, 5, 4, 4, 4, 3, 3] }, ['Snatch'])
    expect(rows.Snatch).toHaveLength(7)
    expect(rows.Snatch.map((r) => r.targetReps)).toEqual([5, 5, 4, 4, 4, 3, 3])
  })
})

// ===========================================================================
// MEMBER LOGGER - section 4 / oracle C. Strength Sets' SetsRows already
// unconditionally renders reps+weight for every non-cardio movement
// (capability-agnostic, pre-existing, untouched by this fix) - confirmed
// still true regardless of whether programmed load is present or blank.
// ===========================================================================
describe('MEMBER LOGGER - reps + load inputs remain present for Snatch regardless of programmed load', () => {
  it('C - real FormatLogger renders a reps AND a weight input for Snatch with blank programmed load', () => {
    render(<FormatLogger formatId="Strength Sets" config={{ setsScheme: [5, 4, 3] }} movements={['Snatch']}
      value={{}} onChange={() => {}} weightUnit="kg" t={{}} />)
    expect(screen.getAllByPlaceholderText('reps')).toHaveLength(3)
    expect(screen.getAllByPlaceholderText('kg')).toHaveLength(3)
  })

  it('D - athlete-entered performed loads (35/35/40) save and reopen correctly, independent of the blank prescription', () => {
    let saved = null
    function ControlledLogger() {
      const [value, setValue] = useState({})
      return <FormatLogger formatId="Strength Sets" config={{ setsScheme: [5, 5, 4] }} movements={['Snatch']}
        value={value} onChange={(v) => { setValue(v); saved = v }} weightUnit="kg" t={{}} />
    }
    render(<ControlledLogger />)
    const reps = screen.getAllByPlaceholderText('reps')
    const loads = screen.getAllByPlaceholderText('kg')
    fireEvent.change(reps[0], { target: { value: '5' } })
    fireEvent.change(loads[0], { target: { value: '35' } })
    expect(saved.sets.Snatch[0].reps).toBe('5')
    expect(saved.sets.Snatch[0].weight).toBe('35')
    // Reopen: feed the saved sets back and confirm redisplay.
    render(<FormatLogger formatId="Strength Sets" config={{ setsScheme: [5, 5, 4] }} movements={['Snatch']}
      value={saved} onChange={() => {}} weightUnit="kg" t={{}} />)
    expect(screen.getAllByPlaceholderText('reps')[0].value).toBe('5')
    expect(screen.getAllByPlaceholderText('kg')[0].value).toBe('35')
  })
})

// ===========================================================================
// CLASSIFICATION - section 5 / oracle G. Real resultCompositionModified /
// isMixedCategory, proving a blank programmed load never manufactures a
// false "Modified" classification, and that the existing sub-standard-weight
// comparison logic (when a coach DOES prescribe a load) is untouched.
// ===========================================================================
describe('CLASSIFICATION - blank programmed load never forces Modified', () => {
  it('G - performed_prescription null, movements unchanged, no global weight_logged comparison (structured display path) -> not modified', () => {
    const log = { weight_logged: '', performed_prescription: null }
    const modified = resultCompositionModified(log, '', ['5 Snatch'], ['5 Snatch'], 'Strength Sets', { setsScheme: [5] })
    expect(modified).toBe(false)
  })

  it('section 5 - existing sub-standard-weight comparison for a COACH-PRESCRIBED weight is untouched by this fix', () => {
    const isMixed = isMixedCategory('35', '43', ['5 Snatch @43 kg'], ['5 Snatch @43 kg'])
    expect(isMixed).toBe(true) // 35 < 43 prescribed standard -> still correctly flagged, unchanged logic
  })
})
