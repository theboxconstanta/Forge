// FORGE - STRENGTH SETS LOGGER OBJECT LABEL REGRESSION
//
// ROOT CAUSE (forensic, traced through the real save/reload/render chain,
// not assumed to be "a stringification bug somewhere"):
//
//   Incident "EMOM PERFORMED LOGGER PARITY" fixed UniversalScoreInput.jsx to
//   forward `prescriptionMovements` (the canonical RX INSTANCE array -
//   {instanceId, name, canonicalMovementId, reps, load, ...} objects, never
//   plain strings) to FormatLogger, for EVERY SETS-family format - not just
//   EMOM. FormatLogger's SetsFields seeds its rows via
//   defaultRowsForFormat(formatId, config, prescriptionMovements ||
//   movements) - so Strength Sets (rowMode:'movement') now ALSO receives
//   the raw instance objects instead of plain display-line strings.
//
//   defaultRowsForFormat's Strength Sets branch (workoutFormats.js) grouped
//   rows with `movs.forEach(m => { out[m] = ... })` - using the movement
//   entry DIRECTLY as a JS object key. A string entry ("Snatch") stays
//   "Snatch"; an INSTANCE OBJECT silently coerces via its own toString(),
//   producing the literal key "[object Object]" - which FormatLogger's
//   SetsRows then renders verbatim as the row group's label. The generic
//   rowMode:'movement' fallback (Weightlifting/Build to Heavy/1RM/...) had
//   the identical pattern and the identical latent bug.
//
// FIX: both branches now read the movement's NAME via a small
// `movementNameOf(m)` helper (`typeof m === 'string' ? m : m?.name`) -
// literally the same typeof-string-vs-object normalization
// resolveIntervalStructure/resolveEmomTimeline already use for the same
// reason, reused rather than reinvented. No stringification workaround, no
// movement-name hardcoding, no scoring/persistence/prescription change.
//
// This test reproduces the EXACT owner scenario: a real AI-generated
// Strength Sets payload (Snatch, 5-5-4-4-4-3-3, no programmed load) through
// the real save serializer, a real reload, and the REAL primary-logger
// wrapper (UniversalScoreInput -> FormatLogger) - the same component chain
// the live Member Logger screen renders, not FormatLogger in isolation.

import { describe, it, expect, afterEach } from 'vitest'
import { render, screen, cleanup, within } from '@testing-library/react'
import UniversalScoreInput from './UniversalScoreInput'
import { sectionFromAiSection } from './workoutIntelligence.js'
import { legacyPayloadFromSections } from './wodSections.js'

afterEach(cleanup)

// Shaped exactly like the (fixed) analyze-workout Edge Function's real
// output for the owner's exact input - same fixture shape already proven
// correct end to end in strengthSetsGeneration.test.jsx.
function snatchAiSection() {
  return {
    type: 'strength', title: 'Strength', description: null, format: 'Strength Sets',
    formatConfig: {
      timeCapMinutes: null, rounds: null, roundCount: null, stationMode: null, structure: null,
      intervalSeconds: null, workSeconds: null, restSeconds: null, startReps: null, incrementReps: null,
      setsScheme: [5, 5, 4, 4, 4, 3, 3], stages: [],
    },
    movements: [
      { name: 'Snatch', canonicalName: 'Snatch', reps: null, weight: null, distance: null, calories: null, equipment: [], notes: null },
    ],
    equipment: [], scalingVersions: [], loggingMode: 'required', scoreType: 'Weight',
    durationMinutes: null, benchmarkMetadata: { name: null, isBenchmark: false, isHero: false }, metadata: {},
  }
}

describe('STRENGTH SETS LOGGER OBJECT LABEL REGRESSION', () => {
  it('the real primary-logger wrapper (UniversalScoreInput -> FormatLogger) shows "Snatch", never "[object Object]"', () => {
    // Real save + reload, exactly like the prior generation-fix reports.
    const section = sectionFromAiSection(snatchAiSection(), true, '')
    const payload = JSON.parse(JSON.stringify(legacyPayloadFromSections([section])))
    const reloadedInstances = payload.movement_prescriptions.variants.rx.movements // the RX instance OBJECTS, exactly what App.jsx's frozenProgrammedInstances holds
    const reloadedMovements = reloadedInstances.map((m) => m.name) // plain display-line strings, the `movements` prop's own shape

    // Same real wiring as App.jsx's primary logWodPrimaryPath call site:
    // <UniversalScoreInput def={{kind:'SETS'}} movements={...} prescriptionMovements={frozenProgrammedInstances} .../>
    render(
      <UniversalScoreInput def={{ kind: 'SETS' }} formatId="Strength Sets" config={payload.format_config}
        movements={reloadedMovements} prescriptionMovements={reloadedInstances}
        value={{}} onChange={() => {}} weightUnit="kg" t={{}} />
    )

    expect(screen.getByText('Snatch')).toBeInTheDocument()
    expect(screen.queryByText('[object Object]')).not.toBeInTheDocument()
    expect(screen.queryByText((content) => content.includes('[object Object]'))).not.toBeInTheDocument()
  })

  it('seven set rows remain unchanged, reps + kg inputs remain available, load stays absent', () => {
    const section = sectionFromAiSection(snatchAiSection(), true, '')
    const payload = JSON.parse(JSON.stringify(legacyPayloadFromSections([section])))
    const reloadedInstances = payload.movement_prescriptions.variants.rx.movements
    const reloadedMovements = reloadedInstances.map((m) => m.name)
    expect('load' in reloadedInstances[0]).toBe(false) // programmed load remains absent

    render(
      <UniversalScoreInput def={{ kind: 'SETS' }} formatId="Strength Sets" config={payload.format_config}
        movements={reloadedMovements} prescriptionMovements={reloadedInstances}
        value={{}} onChange={() => {}} weightUnit="kg" t={{}} />
    )
    expect(screen.getAllByPlaceholderText('reps')).toHaveLength(7)
    expect(screen.getAllByPlaceholderText('kg')).toHaveLength(7)
  })

  it('a coach-prescribed load still resolves to the clean movement name too (not object-coerced)', () => {
    const withLoad = snatchAiSection()
    withLoad.movements[0].weight = { male: 43, female: 30, unit: 'kg' }
    const section = sectionFromAiSection(withLoad, true, '')
    const payload = JSON.parse(JSON.stringify(legacyPayloadFromSections([section])))
    const reloadedInstances = payload.movement_prescriptions.variants.rx.movements
    const reloadedMovements = reloadedInstances.map((m) => m.name)

    render(
      <UniversalScoreInput def={{ kind: 'SETS' }} formatId="Strength Sets" config={payload.format_config}
        movements={reloadedMovements} prescriptionMovements={reloadedInstances}
        value={{}} onChange={() => {}} weightUnit="kg" t={{}} />
    )
    expect(screen.getByText('Snatch')).toBeInTheDocument()
    expect(screen.queryByText('[object Object]')).not.toBeInTheDocument()
  })

  it('a multi-movement Strength Sets section (each an instance object) labels every row correctly', () => {
    const twoMoves = snatchAiSection()
    twoMoves.movements.push({ name: 'Back Squat', canonicalName: 'Back Squat', reps: null, weight: null, distance: null, calories: null, equipment: [], notes: null })
    const section = sectionFromAiSection(twoMoves, true, '')
    const payload = JSON.parse(JSON.stringify(legacyPayloadFromSections([section])))
    const reloadedInstances = payload.movement_prescriptions.variants.rx.movements
    const reloadedMovements = reloadedInstances.map((m) => m.name)

    render(
      <UniversalScoreInput def={{ kind: 'SETS' }} formatId="Strength Sets" config={payload.format_config}
        movements={reloadedMovements} prescriptionMovements={reloadedInstances}
        value={{}} onChange={() => {}} weightUnit="kg" t={{}} />
    )
    expect(screen.getByText('Snatch')).toBeInTheDocument()
    expect(screen.getByText('Back Squat')).toBeInTheDocument()
    expect(screen.queryByText('[object Object]')).not.toBeInTheDocument()
  })

  it('REGRESSION - plain-string movements (the pre-existing, unfixed path) still label correctly', () => {
    render(
      <UniversalScoreInput def={{ kind: 'SETS' }} formatId="Strength Sets" config={{ setsScheme: [5, 5, 5] }}
        movements={['Snatch']} value={{}} onChange={() => {}} weightUnit="kg" t={{}} />
    )
    expect(screen.getByText('Snatch')).toBeInTheDocument()
  })
})
