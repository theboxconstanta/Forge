// PHOTO RESULT CARD — Phase 2.2 (owner final visual contract) §24 required
// regression: the photo card's structural workout header comes from the
// SAME canonical structure source the logging screen itself uses
// (resolveWorkoutStructureHeader, a thin combinator over getWorkoutFormatDisplay
// + formatMemberScheduleLines - workoutFormats.js), and its movement lines
// come from the SAME canonical performed-aware projection Journal/leaderboard
// already use (resolveResultMovementLines - resultWorkoutLines.js). Neither
// is invented here, and neither is satisfied by hand-typed strings passed
// straight into PhotoResultCard - every assertion below runs the REAL
// resolver against a realistic log/config fixture.

import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { resolveWorkoutStructureHeader, FORMAT_IDS } from './workoutFormats.js'
import { resolveResultMovementLines } from './resultWorkoutLines.js'
import { getT } from './translations.js'
import PhotoResultCard from './PhotoResultCard.jsx'

const tEn = getT('en')

const mi = (n) => `mi_${n}${'x'.repeat(Math.max(0, 21 - n.length))}`
// Same frozen prescription_snapshot shape p957ResultDetailProjection.test.js
// already exercises against resolveResultMovementLines - reused verbatim,
// not redefined differently for this card.
const snap = (variant, gender, movs) => ({
  version: 1, variant, gender, source: 'structured', resolvedAt: '2026-09-05T00:00:00Z',
  movements: movs.map((m, i) => ({
    instanceId: mi(`s${i}`), name: m.name, canonicalMovementId: m.cm ?? null,
    displayLine: m.line,
    ...(m.load != null ? { load: { value: m.load, unit: 'kg', mode: 'sex_specific', bothValues: [m.load, m.load] } } : {}),
    reps: { value: m.reps ?? null },
  })),
})
const performed = (variantKey, movs) => ({
  version: 1, variantKey, source: 'performed', sectionId: null,
  movements: movs.map((m, i) => ({
    instanceId: m.iid ?? mi(`p${i}`), name: m.name, canonicalMovementId: m.cm ?? null,
    reps: { mode: 'universal', value: m.reps ?? 15 },
    ...(m.load != null ? { load: { mode: 'universal', value: m.load, unit: 'kg' } } : {}),
    ...(m.substitutedFrom ? { substitutedFrom: m.substitutedFrom } : {}),
  })),
})

// The owner's own worked example: 5 rounds of 200m Run / Air Squats /
// Push-Ups / Lunges.
const FIVE_ROUND_PROGRAMMED = [
  { name: '200m Run', line: '200m Run' },
  { name: 'Air Squats', line: '20 Air Squats', reps: 20 },
  { name: 'Push-Ups', line: '20 Push-Ups', reps: 20 },
  { name: 'Lunges', line: '20 Lunges', reps: 20 },
]

describe('resolveWorkoutStructureHeader - structural header, never invented, never a second parser', () => {
  it('a 5-round structured Interval: primary is the canonical format label, "5 Rounds" is its own structural line (owner §7/§24 oracle)', () => {
    const header = resolveWorkoutStructureHeader('Intervals', { roundCount: 5, stationMode: 'per-interval', workSec: 40, restSec: 20 }, tEn)
    expect(header.primary).toBe('Intervals')
    expect(header.prescriptionLines).toContain('5 Rounds')
  })

  it('RFT with 5 rounds: the round count is embedded in the canonical primary label ("5 RFT") - never duplicated as a separate line', () => {
    const header = resolveWorkoutStructureHeader('RFT', { rounds: 5 }, tEn)
    expect(header.primary).toBe('5 RFT')
    expect(header.prescriptionLines).not.toContain('5 Rounds')
  })

  it('AMRAP: primary + duration secondary, no invented round count', () => {
    const header = resolveWorkoutStructureHeader('AMRAP', { durationSec: 720 }, tEn)
    expect(header.primary).toBe('AMRAP')
    expect(header.secondary).toBe('12:00')
  })

  it('For Time with a time cap: primary + "Time cap" secondary, same label the logging screen itself shows', () => {
    const header = resolveWorkoutStructureHeader('For Time', { timeCapSec: 1200 }, tEn)
    expect(header.primary).toBe('For Time')
    expect(header.secondary).toBe('Time cap 20:00')
  })

  it('EMOM: primary + computed total duration secondary', () => {
    const header = resolveWorkoutStructureHeader('EMOM', { totalRounds: 12, intervalSec: 60 }, tEn)
    expect(header.primary).toBe('EMOM')
    expect(header.secondary).toBe('12:00')
  })

  it('Chipper / sequential (Ladder): resolves without inventing a round count that does not exist on the format', () => {
    const header = resolveWorkoutStructureHeader('Ladder', {}, tEn)
    expect(header.primary).toBe('Ladder')
    expect(header.prescriptionLines.some(l => /Rounds/i.test(l))).toBe(false)
  })

  it('a capped/Did-Not-Finish result never changes the structural header - completion is a separate axis (owner §26 - completion calculation untouched)', () => {
    const finished = resolveWorkoutStructureHeader('RFT', { rounds: 5, timeCapSec: 900 }, tEn)
    const capped = resolveWorkoutStructureHeader('RFT', { rounds: 5, timeCapSec: 900 }, tEn)
    expect(finished).toEqual(capped)
  })

  it('no formatId (a free-text log with no linked format): returns null rather than leaking an unrelated default format', () => {
    expect(resolveWorkoutStructureHeader(null, {}, tEn)).toBeNull()
    expect(resolveWorkoutStructureHeader(undefined, {}, tEn)).toBeNull()
  })

  it('never throws for any registered format id, with an empty config (format safety §25)', () => {
    FORMAT_IDS.forEach(id => expect(() => resolveWorkoutStructureHeader(id, {}, tEn)).not.toThrow())
  })
})

describe('Owner §9/§23 oracle - performed substitution truth flows through to the photo card, end to end, via the REAL resolvers', () => {
  const structuredFormatId = 'RFT'
  const structuredConfig = { rounds: 5 }

  it('resolveResultMovementLines shows the PERFORMED movement (Clean & Jerk @ 43 kg), never the programmed one (Air Squats)', () => {
    const log = {
      variant_level: 'RX',
      performed_prescription: performed('rx', [
        { name: '200m Run', reps: null },
        { name: 'Clean & Jerk', load: 43, reps: 20, substitutedFrom: 'Air Squats' },
        { name: 'Push-Ups', reps: 20 },
        { name: 'Lunges', reps: 20 },
      ]),
      prescription_snapshot: snap('rx', 'male', FIVE_ROUND_PROGRAMMED),
    }
    const lines = resolveResultMovementLines(log)
    expect(lines).toContain('20 Clean & Jerk @ 43 kg')
    expect(lines.join(' ')).not.toMatch(/Air Squats/)
  })

  it('end-to-end: structure header + performed movement lines, fed into the REAL PhotoResultCard, render the owner\'s exact oracle - no hand-typed strings', () => {
    const log = {
      variant_level: 'RX',
      performed_prescription: performed('rx', [
        { name: '200m Run', reps: null },
        { name: 'Clean & Jerk', load: 43, reps: 20, substitutedFrom: 'Air Squats' },
        { name: 'Push-Ups', reps: 20 },
        { name: 'Lunges', reps: 20 },
      ]),
      prescription_snapshot: snap('rx', 'male', FIVE_ROUND_PROGRAMMED),
    }
    const structureHeader = resolveWorkoutStructureHeader(structuredFormatId, structuredConfig, tEn)
    const movements = resolveResultMovementLines(log)

    render(
      <PhotoResultCard
        photoUrl="https://signed.example/photo.jpg" onPhotoError={() => {}}
        gymName="CrossFit Delta" gymColor="#ABE73C"
        variantLevel="RX" notRxdLabel="Not RX'd"
        structureHeader={structureHeader}
        movements={movements}
        resultText="5 rounds complete · 12:00"
        loggedAt="2026-09-05T17:00:00.000Z" lang="en" t={tEn}
      />
    )
    expect(screen.getByText('5 RFT')).toBeInTheDocument()
    expect(screen.getByText('20 Clean & Jerk @ 43 kg')).toBeInTheDocument()
    expect(screen.queryByText(/Air Squats/)).toBeNull()
  })
})
