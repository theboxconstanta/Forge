// FORGE - CANONICAL STRENGTH RESULT INTELLIGENCE, Phase C
// Build to Heavy/1RM AI-generation structural fix.
//
// ROOT CAUSE (forensic, same class of gap already fixed once for Strength
// Sets - commit 12a5f02 - now traced and fixed for its sibling format):
//
//   openaiSchema.ts's FORMAT_CONFIG_DEF had NO field for an explicit
//   rep-max target ("build to a 3-rep max"), and a movement's `reps` is
//   meaningless for this format (the whole point is "build up", not a
//   fixed rep count). The model had no structured way to express "3-rep
//   max" at all, so it wrote the description straight into the movement's
//   name - confirmed directly against real production rows (live DB read,
//   read-only): `sets` keyed by the WHOLE SENTENCE "Build to a 3-rep-max
//   front squats", `sets_movement_ids: null` (the catalog resolver can't
//   match a sentence to "Front Squat"), `format_config_snapshot:
//   {targetLabel: '3RM'}` (so a human, using the Coach Builder's own
//   RepMaxStepperField, DID set targetLabel correctly - only the AI path
//   was structurally unable to). Manual Coach Builder authoring already
//   uses the correct canonical RX-instance architecture (MovementRowListPWA
//   + RepMaxStepperField) and needed NO change.
//
// FIX (mirrors 12a5f02 exactly):
//   1. supabase/functions/analyze-workout/openaiSchema.ts -
//      formatConfig.targetRepMax (integer 1-30, Build to Heavy/1RM only) -
//      translated CLIENT-SIDE to "<N>RM" (workoutFormats.js's own string
//      shape), not asked of the model directly, so there's no string format
//      for it to get wrong.
//   2. .../prompt.ts - instructs the model to populate it from an explicit,
//      resolvable rep-max count only (never guessed), and keep the movement
//      name clean (e.g. "Front Squat", never the whole sentence).
//   3. .../transform.ts - toFormatConfig passes formatConfig.targetRepMax
//      through, clamped to a real integer in [1,30] or null.
//   4. src/workoutIntelligence.js - FORMAT_CONFIG_TRANSLATORS gained a
//      'Build to Heavy/1RM' entry mapping targetRepMax -> targetLabel
//      ("<N>RM"); absent/unresolved falls through to the catalog's own
//      1RM default (targetLabel is required:false with a default - unlike
//      Strength Sets's setsScheme, this is NOT a needs-review case, since
//      that's the exact same default a coach gets authoring manually
//      without touching the stepper).
//
// This file proves the CLIENT half of the pipeline end to end (the real
// sectionFromAiSection function App.jsx's analyze-workout success handler
// calls), using a formatConfig shaped exactly like transform.ts's
// toWorkoutSections output (proven separately in transform.test.ts, Deno).

import { describe, it, expect, afterEach } from 'vitest'
import { useState } from 'react'
import { render, screen, cleanup, fireEvent } from '@testing-library/react'
import { sectionFromAiSection, deriveReviewFlags } from './workoutIntelligence.js'
import { legacyPayloadFromSections, validatePrescriptionCompleteness } from './wodSections.js'
import { resolveComparisonIdentity } from './movementHistory.js'
import FormatLogger from './FormatLogger'

afterEach(cleanup)

function frontSquatAiSection(overrides = {}) {
  return {
    type: 'strength',
    title: 'Strength',
    description: null,
    format: 'Build to Heavy/1RM',
    formatConfig: {
      timeCapMinutes: null, rounds: null, roundCount: null, stationMode: null, structure: null,
      intervalSeconds: null, workSeconds: null, restSeconds: null, startReps: null, incrementReps: null,
      setsScheme: [], targetRepMax: 3, stages: [],
    },
    movements: [
      { name: 'Front Squat', canonicalName: 'Front Squat', reps: null, weight: null, distance: null, calories: null, equipment: [], notes: null },
    ],
    equipment: [], scalingVersions: [], loggingMode: 'required', scoreType: 'Weight',
    durationMinutes: null, benchmarkMetadata: { name: null, isBenchmark: false, isHero: false },
    metadata: {},
    ...overrides,
  }
}

describe('A/B/C - sectionFromAiSection maps an explicit 3-rep-max Front Squat to a clean, valid section', () => {
  it('targetLabel = "3RM", movement name stays clean, no fake reps/load', () => {
    const section = sectionFromAiSection(frontSquatAiSection(), true, 'Build to a 3-rep-max front squats')
    expect(section.format).toBe('Build to Heavy/1RM')
    expect(section.formatConfig.targetLabel).toBe('3RM')
    const inst = section.variants.rx.instances[0]
    expect(inst.name).toBe('Front Squat') // never the whole "Build to a 3-rep-max..." sentence
    expect('load' in inst).toBe(false) // no fake prescribed load invented
  })

  it('the resulting targetLabel is real RM-comparison-eligible identity (resolveComparisonIdentity)', () => {
    const section = sectionFromAiSection(frontSquatAiSection(), true, '')
    const identity = resolveComparisonIdentity({ formatSnapshot: section.format, formatConfigSnapshot: section.formatConfig })
    expect(identity).toEqual({ mode: 'RM_TEST', repTarget: 3, comparable: true })
  })
})

describe('D - the real publish validation gate passes', () => {
  it('validatePrescriptionCompleteness reports zero errors for the generated section', () => {
    const section = sectionFromAiSection(frontSquatAiSection(), true, '')
    expect(validatePrescriptionCompleteness([section])).toEqual([])
  })
})

describe('E - save/reload preserves targetLabel and the clean movement name', () => {
  it('legacyPayloadFromSections round trip', () => {
    const section = sectionFromAiSection(frontSquatAiSection(), true, '')
    const payload = JSON.parse(JSON.stringify(legacyPayloadFromSections([section])))
    expect(payload.format_config.targetLabel).toBe('3RM')
    const reloadedInst = payload.movement_prescriptions.variants.rx.movements[0]
    expect(reloadedInst.name).toBe('Front Squat')
  })
})

describe('F - Member Logger renders the clean movement name and a working "+ set" row for it, no sets-scheme UI', () => {
  it('real FormatLogger render (Weightlifting/Build to Heavy start at 0 rows - "+ set" adds one)', () => {
    const section = sectionFromAiSection(frontSquatAiSection(), true, '')
    const payload = JSON.parse(JSON.stringify(legacyPayloadFromSections([section])))
    const movements = payload.movement_prescriptions.variants.rx.movements.map((m) => m.name)
    function Wrapper() {
      const [value, setValue] = useState({})
      return <FormatLogger formatId="Build to Heavy/1RM" config={payload.format_config} movements={movements}
        value={value} onChange={setValue} weightUnit="kg" t={{}} />
    }
    render(<Wrapper />)
    expect(screen.getByText('Front Squat')).toBeInTheDocument() // clean name, never the whole sentence
    fireEvent.click(screen.getByText('+ set'))
    expect(screen.getAllByPlaceholderText('reps')).toHaveLength(1)
    expect(screen.getAllByPlaceholderText('kg')).toHaveLength(1)
  })
})

describe('H - text with no explicit/resolvable rep-max count leaves targetRepMax null, never guesses', () => {
  it('unresolved targetRepMax falls through to the catalog default (1RM) - NOT a fabricated "resolved" value, and not flagged needs-review (matches manual-authoring behavior for an untouched stepper)', () => {
    const ambiguous = frontSquatAiSection()
    ambiguous.formatConfig.targetRepMax = null // model instructed: leave null when "build to heavy" has no explicit count
    const analysis = { sections: [ambiguous], sourceText: 'Build to a heavy Front Squat' }
    const flags = deriveReviewFlags(analysis)
    expect(flags.some((f) => f.reason === 'needs_review' && f.detail?.includes('targetRepMax'))).toBe(false)

    const section = sectionFromAiSection(ambiguous, true, '')
    expect(section.formatConfig.targetLabel).toBeUndefined() // never fabricated by the translator
  })
})

describe('I - other targetRepMax values map correctly (single/double, and the full stepper range)', () => {
  it('targetRepMax=1 -> "1RM" (a heavy single)', () => {
    const single = frontSquatAiSection()
    single.formatConfig.targetRepMax = 1
    const section = sectionFromAiSection(single, true, '')
    expect(section.formatConfig.targetLabel).toBe('1RM')
  })
  it('targetRepMax=5 -> "5RM"', () => {
    const five = frontSquatAiSection()
    five.formatConfig.targetRepMax = 5
    const section = sectionFromAiSection(five, true, '')
    expect(section.formatConfig.targetLabel).toBe('5RM')
  })
  it('an out-of-range/non-integer targetRepMax (defensive - transform.ts should already have clamped it to null) is not trusted, falls through to nothing', () => {
    const bad = frontSquatAiSection()
    bad.formatConfig.targetRepMax = 31
    const section = sectionFromAiSection(bad, true, '')
    expect(section.formatConfig.targetLabel).toBeUndefined()
  })
})

describe('J - other workout formats/parser behavior remain regression-safe', () => {
  it('a Strength Sets AI section is unaffected by the Build to Heavy/1RM translator addition', () => {
    const strengthSets = {
      type: 'strength', title: 'Strength', description: null, format: 'Strength Sets',
      formatConfig: {
        timeCapMinutes: null, rounds: null, roundCount: null, stationMode: null, structure: null,
        intervalSeconds: null, workSeconds: null, restSeconds: null, startReps: null, incrementReps: null,
        setsScheme: [5, 5, 5], targetRepMax: null, stages: [],
      },
      movements: [{ name: 'Back Squat', canonicalName: 'Back Squat', reps: null, weight: null, distance: null, calories: null, equipment: [], notes: null }],
      equipment: [], scalingVersions: [], loggingMode: 'required', scoreType: 'Weight',
      durationMinutes: null, benchmarkMetadata: { name: null, isBenchmark: false, isHero: false }, metadata: {},
    }
    const section = sectionFromAiSection(strengthSets, true, '')
    expect(section.format).toBe('Strength Sets')
    expect(section.formatConfig.setsScheme).toEqual([5, 5, 5])
    expect(section.formatConfig.targetLabel).toBeUndefined()
  })
})
