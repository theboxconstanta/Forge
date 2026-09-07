// FORGE - STRENGTH SETS GENERATION STRUCTURAL FAILURE
//
// ROOT CAUSE (forensic, traced end to end - AI schema, transform, client
// mapping - not assumed to be "the AI's fault"):
//
//   openaiSchema.ts's FORMAT_CONFIG_DEF had NO field for a Strength Sets
//   set/rep scheme, and MOVEMENT_DEF.reps is a single nullable number - the
//   model had NO structured way to express "2 sets x5, 3 sets x4, 2 sets
//   x3". It (reasonably, given the schema) wrote the description into the
//   movement's `notes` field (a real, schema-supported free-text field).
//   workoutIntelligence.js's composeMovementLine then folded name+notes
//   into ONE display-line string ("Snatch (2 sets x 5 reps, ...)"), and
//   hydrateInstancesFromLegacy (-> parsePastedMovementLine) re-parsed that
//   flattened string with no pattern for "N sets x M reps" text, so the
//   WHOLE STRING became the movement's name. Separately,
//   FORMAT_CONFIG_TRANSLATORS had NO 'Strength Sets' entry at all, so
//   setsScheme could never reach the client even if the AI HAD produced one.
//
// FIX (this incident):
//   1. supabase/functions/analyze-workout/openaiSchema.ts - added
//      formatConfig.setsScheme (flat number array, same shape catalog
//      Strength Sets.config.setsScheme already uses).
//   2. .../prompt.ts - instructs the model to populate it (expanding
//      grouped notation), leave movement reps/notes clean, never restate
//      the scheme in the movement name, and leave weightMale/weightFemale
//      null when no fixed load is specified.
//   3. .../transform.ts - toFormatConfig passes formatConfig.setsScheme
//      through, filtering non-positive/non-numeric entries.
//   4. src/workoutIntelligence.js - FORMAT_CONFIG_TRANSLATORS gained a
//      'Strength Sets' entry mapping c.setsScheme 1:1 onto the catalog
//      field; absent/empty (unresolved) correctly falls through to the
//      EXISTING missingRequiredConfigFields review-flag mechanism, never a
//      guessed value.
//
// This file proves the CLIENT half of the pipeline (sectionFromAiSection,
// the real function App.jsx's analyzeWorkout success handler calls) end to
// end through the real save/validate/log chain, using an analysis payload
// shaped exactly like transform.ts's toWorkoutSections output (proven
// separately in transform.test.ts, Deno).

import { describe, it, expect, afterEach } from 'vitest'
import { render, screen, cleanup } from '@testing-library/react'
import { sectionFromAiSection, deriveReviewFlags } from './workoutIntelligence.js'
import { legacyPayloadFromSections, validatePrescriptionCompleteness } from './wodSections.js'
import FormatLogger from './FormatLogger'

afterEach(cleanup)

// Shaped exactly like transform.ts's toSection() output for the owner's
// exact input (verified separately, Deno, transform.test.ts).
function snatchAiSection(overrides = {}) {
  return {
    type: 'strength',
    title: 'Strength',
    description: null,
    format: 'Strength Sets',
    formatConfig: {
      timeCapMinutes: null, rounds: null, roundCount: null, stationMode: null, structure: null,
      intervalSeconds: null, workSeconds: null, restSeconds: null, startReps: null, incrementReps: null,
      setsScheme: [5, 5, 4, 4, 4, 3, 3], stages: [],
    },
    movements: [
      {
        name: 'Snatch', canonicalName: 'Snatch', reps: null,
        weight: null, distance: null, calories: null, equipment: [], notes: null,
      },
    ],
    equipment: [], scalingVersions: [], loggingMode: 'required', scoreType: 'Weight',
    durationMinutes: null, benchmarkMetadata: { name: null, isBenchmark: false, isHero: false },
    metadata: {},
    ...overrides,
  }
}

describe('A/B/C - sectionFromAiSection maps the owner exact input to a clean, valid Strength Sets section', () => {
  it('canonical Snatch, clean name, setsScheme mapped, load absent', () => {
    const section = sectionFromAiSection(snatchAiSection(), true, 'Snatch: 2x5, 3x4, 2x3')
    expect(section.format).toBe('Strength Sets')
    expect(section.formatConfig.setsScheme).toEqual([5, 5, 4, 4, 4, 3, 3])
    const inst = section.variants.rx.instances[0]
    expect(inst.name).toBe('Snatch') // B - not the full prescription sentence
    expect(inst.canonicalMovementId).toBeNull() // no live catalog wired in this test - identity resolution is a separate, already-tested concern
    expect('load' in inst).toBe(false) // C - programmed load absent
  })
})

describe('D - the real publish validation gate passes', () => {
  it('validatePrescriptionCompleteness reports zero errors for the generated section', () => {
    const section = sectionFromAiSection(snatchAiSection(), true, '')
    const errors = validatePrescriptionCompleteness([section])
    expect(errors).toEqual([])
  })
})

describe('E - save/reload preserves the scheme and absent load', () => {
  it('legacyPayloadFromSections round trip', () => {
    const section = sectionFromAiSection(snatchAiSection(), true, '')
    const payload = JSON.parse(JSON.stringify(legacyPayloadFromSections([section])))
    expect(payload.format_config.setsScheme).toEqual([5, 5, 4, 4, 4, 3, 3])
    const reloadedInst = payload.movement_prescriptions.variants.rx.movements[0]
    expect(reloadedInst.name).toBe('Snatch')
    expect('load' in reloadedInst).toBe(false)
  })
})

describe('F - Member Logger expands to seven rows with reps + load', () => {
  it('real FormatLogger render', () => {
    const section = sectionFromAiSection(snatchAiSection(), true, '')
    const payload = JSON.parse(JSON.stringify(legacyPayloadFromSections([section])))
    const movements = payload.movement_prescriptions.variants.rx.movements.map((m) => m.name)
    render(<FormatLogger formatId="Strength Sets" config={payload.format_config} movements={movements}
      value={{}} onChange={() => {}} weightUnit="kg" t={{}} />)
    expect(screen.getAllByPlaceholderText('reps')).toHaveLength(7)
    expect(screen.getAllByPlaceholderText('kg')).toHaveLength(7)
  })
})

describe('G - an explicitly coach-prescribed load remains preserved', () => {
  it('weight passes through unaffected by the setsScheme fix', () => {
    const withLoad = snatchAiSection()
    withLoad.movements[0].weight = { male: 43, female: 30, unit: 'kg' }
    const section = sectionFromAiSection(withLoad, true, '')
    const inst = section.variants.rx.instances[0]
    expect(inst.load).toEqual({ mode: 'sex_specific', male: 43, female: 30, unit: 'kg' })
    expect(validatePrescriptionCompleteness([section])).toEqual([])
  })
})

describe('H - a genuinely ambiguous prescription does not silently become a fake valid structure', () => {
  it('an unresolved setsScheme ([]) surfaces a real needs_review flag, never a guessed scheme', () => {
    const ambiguous = snatchAiSection()
    ambiguous.formatConfig.setsScheme = [] // the model could not resolve the scheme - documented instruction: leave it empty, never invent
    const analysis = { sections: [ambiguous], sourceText: 'Snatch: some sets of some reps' }
    const flags = deriveReviewFlags(analysis)
    expect(flags.some((f) => f.reason === 'needs_review' && f.detail?.includes('setsScheme'))).toBe(true)

    const section = sectionFromAiSection(ambiguous, true, '')
    expect(section.formatConfig.setsScheme).toBeUndefined() // never fabricated
  })

  it('even if a movement name STILL ends up carrying leftover prose (e.g. an older/un-migrated AI response), the section-level review flag catches the missing scheme rather than silently publishing', () => {
    const legacyShapeNoScheme = snatchAiSection({
      formatConfig: {
        timeCapMinutes: null, rounds: null, roundCount: null, stationMode: null, structure: null,
        intervalSeconds: null, workSeconds: null, restSeconds: null, startReps: null, incrementReps: null,
        setsScheme: [], stages: [],
      },
      movements: [{
        name: 'Snatch (2 sets x 5 reps, 3 sets x 4 reps, 2 sets x 3 reps)', canonicalName: null, reps: null,
        weight: null, distance: null, calories: null, equipment: [], notes: null,
      }],
    })
    const analysis = { sections: [legacyShapeNoScheme], sourceText: '' }
    const flags = deriveReviewFlags(analysis)
    // BOTH signals fire: unknown movement (garbled name never resolves canonically) AND missing setsScheme.
    expect(flags.some((f) => f.reason === 'unknown_movement')).toBe(true)
    expect(flags.some((f) => f.reason === 'needs_review' && f.detail?.includes('setsScheme'))).toBe(true)
  })
})

describe('I - existing generation of other Strength Sets schemes remains correct', () => {
  it('a plain 5x5 scheme maps identically', () => {
    const fiveByFive = snatchAiSection()
    fiveByFive.formatConfig.setsScheme = [5, 5, 5, 5, 5]
    fiveByFive.movements[0].name = 'Back Squat'
    fiveByFive.movements[0].canonicalName = 'Back Squat'
    const section = sectionFromAiSection(fiveByFive, true, '')
    expect(section.formatConfig.setsScheme).toEqual([5, 5, 5, 5, 5])
    expect(section.variants.rx.instances[0].name).toBe('Back Squat')
    expect(validatePrescriptionCompleteness([section])).toEqual([])
  })
})

describe('J - other workout formats/parser behavior remain regression-safe', () => {
  it('an EMOM AI section is unaffected by the Strength Sets translator addition', () => {
    const emom = {
      type: 'metcon', title: 'EMOM', description: null, format: 'EMOM',
      formatConfig: {
        timeCapMinutes: null, rounds: null, roundCount: null, stationMode: null, structure: null,
        intervalSeconds: 60, workSeconds: null, restSeconds: null, startReps: null, incrementReps: null,
        setsScheme: [], stages: [],
      },
      movements: [{ name: 'Burpees', canonicalName: 'Burpee', reps: 10, weight: null, distance: null, calories: null, equipment: [], notes: null }],
      equipment: [], scalingVersions: [], loggingMode: 'required', scoreType: 'Reps',
      durationMinutes: null, benchmarkMetadata: { name: null, isBenchmark: false, isHero: false }, metadata: {},
    }
    const section = sectionFromAiSection(emom, true, '')
    expect(section.format).toBe('EMOM')
    expect(section.formatConfig.intervalSec).toBe(60)
    expect(section.formatConfig.setsScheme).toBeUndefined()
  })
})
