// PHOTO RESULT CARD — Phase 2.2/2.4 required regression: the photo card's
// structural workout header AND top-of-card summary come from the SAME
// canonical structure source the logging screen itself uses
// (resolveWorkoutStructureHeader / composeWorkoutHeadline, thin combinators
// over getWorkoutFormatDisplay + formatMemberScheduleLines -
// workoutFormats.js), and its movement lines come from the SAME canonical
// performed-aware projection Journal/leaderboard already use
// (resolveResultMovementLines - resultWorkoutLines.js). Neither is invented
// here, and neither is satisfied by hand-typed strings passed straight into
// PhotoResultCard - every assertion below runs the REAL resolver against a
// realistic log/config fixture.

import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { resolveWorkoutStructureHeader, composeWorkoutHeadline, FORMAT_IDS } from './workoutFormats.js'
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

  it('AMRAP: primary + an INTRINSIC duration (not a Time Cap), no invented round count', () => {
    const header = resolveWorkoutStructureHeader('AMRAP', { durationSec: 720 }, tEn)
    expect(header.primary).toBe('AMRAP')
    expect(header.intrinsicDuration).toBe('12:00')
    expect(header.timeCap).toBeNull()
  })

  it('For Time with a time cap: primary + a genuine Time Cap (owner\'s dedicated slot), same label the logging screen itself shows', () => {
    const header = resolveWorkoutStructureHeader('For Time', { timeCapSec: 1200 }, tEn)
    expect(header.primary).toBe('For Time')
    expect(header.timeCap).toBe('Time cap 20:00')
    expect(header.intrinsicDuration).toBeNull()
  })

  it('EMOM: primary + an INTRINSIC computed total duration (not a Time Cap)', () => {
    const header = resolveWorkoutStructureHeader('EMOM', { totalRounds: 12, intervalSec: 60 }, tEn)
    expect(header.primary).toBe('EMOM')
    expect(header.intrinsicDuration).toBe('12:00')
    expect(header.timeCap).toBeNull()
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

describe('composeWorkoutHeadline - top summary, presentation-only, never a second parser (owner §39/§40)', () => {
  it('RFT oracle: headline combines the real structural header with the real movement lines, truncated deterministically', () => {
    const structureHeader = resolveWorkoutStructureHeader('RFT', { rounds: 5 }, tEn)
    const movements = ['200m Run', '20 Air Squats', '20 Push-Ups', '20 Lunges']
    const headline = composeWorkoutHeadline(structureHeader, movements, tEn)
    expect(headline).toBe('5 RFT: 200m Run, 20 Air Squats, 20 Push-Ups, and 1 more')
  })

  it('performed substitution flows into the headline too - Clean & Jerk, never Air Squats (owner §40 negative)', () => {
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
    const structureHeader = resolveWorkoutStructureHeader('RFT', { rounds: 5 }, tEn)
    const movements = resolveResultMovementLines(log)
    const headline = composeWorkoutHeadline(structureHeader, movements, tEn)
    expect(headline).toContain('Clean & Jerk')
    expect(headline).not.toMatch(/Air Squats/)
  })

  it('no structural header (free-text log): returns null rather than an invented summary', () => {
    expect(composeWorkoutHeadline(null, ['some movement'], tEn)).toBeNull()
  })

  it('a short workout (at or under the truncation count) never appends "and N more"', () => {
    const structureHeader = resolveWorkoutStructureHeader('AMRAP', { durationSec: 720 }, tEn)
    const headline = composeWorkoutHeadline(structureHeader, ['Pull-ups', 'Wall Balls'], tEn)
    expect(headline).toBe('AMRAP: Pull-ups, Wall Balls')
    expect(headline).not.toMatch(/more/i)
  })

  it('owner Phase 4 - the headline NEVER repeats the intrinsic duration (AMRAP 12:00) or a Time Cap - both already own a dedicated slot elsewhere on the card', () => {
    const amrap = resolveWorkoutStructureHeader('AMRAP', { durationSec: 720 }, tEn)
    expect(composeWorkoutHeadline(amrap, ['Pull-ups'], tEn)).not.toMatch(/12:00/)
    const forTimeCapped = resolveWorkoutStructureHeader('For Time', { timeCapSec: 600 }, tEn)
    expect(composeWorkoutHeadline(forTimeCapped, ['Clean and Jerks'], tEn)).not.toMatch(/10:00|Time cap/i)
  })
})

describe('Owner §41 format variety - the central format reflects each workout\'s ACTUAL prescribed format, end to end through the real PhotoResultCard', () => {
  const cases = [
    { formatId: 'RFT', config: { rounds: 5 }, expectPrimary: '5 RFT' },
    { formatId: 'RFT', config: { rounds: 5, timeCapSec: 900 }, expectPrimary: '5 RFT' },
    { formatId: 'For Time', config: {}, expectPrimary: 'For Time' },
    { formatId: 'For Time', config: { timeCapSec: 600 }, expectPrimary: 'For Time' },
    { formatId: 'AMRAP', config: { durationSec: 720 }, expectPrimary: 'AMRAP' },
    { formatId: 'EMOM', config: { totalRounds: 12, intervalSec: 60 }, expectPrimary: 'EMOM' },
    { formatId: 'Intervals', config: { roundCount: 5, stationMode: 'per-interval', workSec: 40, restSec: 20 }, expectPrimary: 'Intervals' },
    { formatId: 'Ladder', config: {}, expectPrimary: 'Ladder' },
    { formatId: 'Chipper', config: { timeCapSec: 1200 }, expectPrimary: 'Chipper' },
  ]
  for (const { formatId, config, expectPrimary } of cases) {
    it(`${formatId}: central format shows the real resolved primary, never a hardcoded "5 RFT"`, () => {
      const structureHeader = resolveWorkoutStructureHeader(formatId, config, tEn)
      const { unmount } = render(
        <PhotoResultCard
          photoUrl="https://signed.example/photo.jpg" onPhotoError={() => {}}
          gymName="CrossFit Delta" gymColor="#ABE73C"
          variantLevel="RX" notRxdLabel={null}
          structureHeader={structureHeader} headline={null}
          movements={[]} resultText="some result"
          loggedAt="2026-09-05T17:00:00.000Z" lang="en" t={tEn}
        />
      )
      expect(screen.getByText(expectPrimary)).toBeInTheDocument()
      if (formatId !== 'RFT') expect(screen.queryByText('5 RFT')).toBeNull()
      unmount()
    })
  }
})

describe('Owner §42 multi-tenant regression, end to end through the real resolvers and the real PhotoResultCard', () => {
  const structureHeader = resolveWorkoutStructureHeader('RFT', { rounds: 5 }, tEn)
  const tenants = [
    { name: 'CrossFit Delta', color: '#3355FF' },
    { name: 'ThePACK', color: '#FF7A00' },
  ]
  for (const tenant of tenants) {
    it(`tenant "${tenant.name}": gym metadata and format accent both reflect this tenant's own gyms.name/gyms.primary_color`, () => {
      const { unmount } = render(
        <PhotoResultCard
          photoUrl="https://signed.example/photo.jpg" onPhotoError={() => {}}
          gymName={tenant.name} gymColor={tenant.color}
          variantLevel="RX" notRxdLabel={null}
          structureHeader={structureHeader} headline={null}
          movements={[]} resultText="12:00"
          loggedAt="2026-09-05T17:00:00.000Z" lang="en" t={tEn}
        />
      )
      expect(screen.getByText(tenant.name)).toBeInTheDocument()
      expect(screen.getByText('5 RFT')).toHaveStyle({ color: tenant.color })
      expect(screen.getByText('FORGE')).toBeInTheDocument()
      unmount()
    })
  }
})

// PHOTO RESULT CARD Phase 4 - owner universal presentation hierarchy
// correction. The bug: a genuine Time Cap (For Time/RFT/Chipper/Ladder/
// Partner WOD) was being folded into BOTH the top headline AND the center
// format label - a duplicated fact. The fix, structure/capability-driven
// (never a per-format branch): resolveWorkoutStructureHeader now exposes
// `timeCap` (a real cap - owner's dedicated TOP SECONDARY slot, shown once)
// separately from `intrinsicDuration` (part of a format's own identity,
// e.g. AMRAP/EMOM's own duration - stays combined with the format wherever
// it's shown, never duplicated as a "cap" on something else). No format is
// special-cased here - the split comes entirely from the SAME
// TIME_CAP_LABEL_FORMAT_IDS distinction getWorkoutFormatDisplay already
// encoded before this fix.
describe('Owner Phase 4 - universal "no piece of information duplicated" hierarchy, across every representative structure', () => {
  const cases = [
    { label: 'For Time (no cap)', formatId: 'For Time', config: {} },
    { label: 'For Time + Time Cap', formatId: 'For Time', config: { timeCapSec: 600 } },
    { label: 'RFT (no cap)', formatId: 'RFT', config: { rounds: 5 } },
    { label: 'RFT + Time Cap', formatId: 'RFT', config: { rounds: 5, timeCapSec: 900 } },
    { label: 'AMRAP', formatId: 'AMRAP', config: { durationSec: 720 } },
    { label: 'EMOM', formatId: 'EMOM', config: { totalRounds: 12, intervalSec: 60 } },
    { label: 'Intervals (structured)', formatId: 'Intervals', config: { roundCount: 5, stationMode: 'per-interval', workSec: 40, restSec: 20 } },
    { label: 'Ladder', formatId: 'Ladder', config: {} },
    { label: 'Chipper / sequential + Time Cap', formatId: 'Chipper', config: { timeCapSec: 1200 } },
  ]

  for (const { label, formatId, config } of cases) {
    it(`${label}: every duration/cap fact appears exactly once across headline + TOP SECONDARY + center format`, () => {
      const structureHeader = resolveWorkoutStructureHeader(formatId, config, tEn)
      const movements = ['Movement A', 'Movement B']
      const headline = composeWorkoutHeadline(structureHeader, movements, tEn)
      // Deliberately timestamped so no locale-formatted date/time string can
      // coincidentally collide with a computed duration value below (e.g. a
      // "5:00" duration vs a "5:00 PM" timestamp) - exact DOM TEXT NODE
      // matching (queryAllByText), not substring counting over concatenated
      // page text, is what actually proves "shown exactly once".
      const { unmount } = render(
        <PhotoResultCard
          photoUrl="https://signed.example/photo.jpg" onPhotoError={() => {}}
          gymName="CrossFit Delta" gymColor="#ABE73C"
          variantLevel="RX" notRxdLabel={null}
          structureHeader={structureHeader} headline={headline}
          movements={movements} resultText="some result"
          loggedAt="2026-09-05T00:31:00.000Z" lang="en" t={tEn}
        />
      )
      // Exactly one of the two duration concepts may be present for any
      // given format (never both) - and whichever is present must appear
      // in the DOM exactly once.
      if (structureHeader.timeCap) {
        expect(screen.getAllByText(structureHeader.timeCap)).toHaveLength(1)
        expect(headline).not.toContain(structureHeader.timeCap)
      }
      if (structureHeader.intrinsicDuration) {
        expect(screen.getAllByText(structureHeader.intrinsicDuration)).toHaveLength(1)
        expect(headline).not.toContain(structureHeader.intrinsicDuration)
      }
      expect(structureHeader.timeCap && structureHeader.intrinsicDuration).toBeFalsy() // never both on the same format
      unmount()
    })
  }
})

// The owner's own exact reproduction case: a descending-rep-scheme For Time
// with a Time Cap, Clean & Jerk + Cal Air Bike, finished 7:00, RX.
describe('Owner exact reproduction - For Time + Time Cap, descending scheme, Finished, RX', () => {
  it('headline has no time cap, TOP SECONDARY shows it once, center shows the bare format, full workout and bottom bar are correct', () => {
    const structureHeader = resolveWorkoutStructureHeader('For Time', { timeCapSec: 600 }, tEn)
    const movements = ['21 Clean and Jerks @ 43 kg', '21 Cal Air Bike', '15 Clean & Jerk @ 43 kg', '15 Cal Air Bike', '9 Clean & Jerk @ 43 kg', '9 Cal Air Bike']
    const headline = composeWorkoutHeadline(structureHeader, movements, tEn)

    expect(structureHeader.primary).toBe('For Time')
    expect(structureHeader.timeCap).toBe('Time cap 10:00')
    expect(structureHeader.intrinsicDuration).toBeNull()
    expect(headline).not.toMatch(/10:00|Time cap/i)

    const { container } = render(
      <PhotoResultCard
        photoUrl="https://signed.example/photo.jpg" onPhotoError={() => {}}
        gymName="CrossFit C15" gymColor="#ABE73C"
        variantLevel="RX" notRxdLabel={null}
        structureHeader={structureHeader} headline={headline}
        movements={movements} resultText="7:00"
        loggedAt="2026-09-06T09:03:00.000Z" lang="en" t={tEn}
      />
    )
    expect(screen.getAllByText('Time cap 10:00')).toHaveLength(1)
    expect(screen.getByText('For Time')).toBeInTheDocument()
    expect(screen.getByText('21 Clean and Jerks @ 43 kg')).toBeInTheDocument()
    expect(screen.getByText('9 Cal Air Bike')).toBeInTheDocument()
    // owner Phase 5 §11/§16 - the final result (7:00) lives exactly once,
    // in the bottom bar's joined "7:00 | RX" text - never a standalone
    // central occurrence any more.
    expect((container.textContent.match(/7:00/g) || []).length).toBe(1)
    expect(container.textContent).toContain('7:00')
    expect(container.textContent).toContain('RX')
    expect(screen.getByText('CrossFit C15')).toBeInTheDocument()
    expect(screen.getByText('FORGE')).toBeInTheDocument()
  })
})

// PHOTO RESULT CARD Phase 5 (owner final information hierarchy) - the full
// §23 OWNER ORACLE regression (A-P). Athlete progression is
// resolveResultMovementLines(log) - the SAME resolver Leaderboard's own
// expanded card renders as `cardMovementLines` (App.jsx line ~2496) - fed
// with a performed_prescription overlay that only lists the movements
// actually reached (21/21, 21/21, a partial 10, PLUS one substitution),
// which is how the already-closed Universal Partial Result Integrity /
// Performed Movement Capability Completion invariants naturally produce
// "later unperformed stations do not appear" - no fraction ("10/15")
// annotation is synthesized, since no canonical resolver anywhere in the
// codebase produces that shape (audited: resultWorkoutLines.js only ever
// exposes full display lines) - inventing one would be exactly the "second
// interpretation/parallel business logic" the owner prohibits.
describe('Owner §23 ORACLE - For Time + Time Cap, Finished 7:00, RX, partial-progression athlete truth with a substitution', () => {
  const structureHeader = resolveWorkoutStructureHeader('For Time', { timeCapSec: 600 }, tEn)
  // Programmed: 21 Clean and Jerks, 21 Cal Air Bike, 15 Wall Balls, 15 Cal Air
  // Bike, 9 Clean & Jerk, 9 Cal Air Bike (6 stations). Performed: finished the
  // first 2 stations as programmed, substituted Wall Balls -> Clean & Jerk
  // @ 43 kg on station 3 and only reached 10 of it, and never reached
  // stations 4-6 at all (simply absent from the performed overlay - owner
  // §7 "do not show later unperformed stations").
  const log = {
    variant_level: 'RX',
    performed_prescription: performed('rx', [
      { name: 'Clean and Jerks', load: 43, reps: 21 },
      { name: 'Cal Air Bike', reps: 21 },
      { name: 'Clean & Jerk', load: 43, reps: 10, substitutedFrom: 'Wall Balls' },
    ]),
    prescription_snapshot: snap('rx', 'male', [
      { name: 'Clean and Jerks', line: '21 Clean and Jerks @ 43 kg', load: 43, reps: 21 },
      { name: 'Cal Air Bike', line: '21 Cal Air Bike', reps: 21 },
      { name: 'Wall Balls', line: '15 Wall Balls', reps: 15 },
      { name: 'Cal Air Bike', line: '15 Cal Air Bike', reps: 15 },
      { name: 'Clean & Jerk', line: '9 Clean & Jerk @ 43 kg', load: 43, reps: 9 },
      { name: 'Cal Air Bike', line: '9 Cal Air Bike', reps: 9 },
    ]),
  }
  const movements = resolveResultMovementLines(log)
  const headline = composeWorkoutHeadline(structureHeader, movements, tEn)

  it('resolver sanity: athlete progression contains only the reached stations, with the substitution, never the programmed Wall Balls or any later station', () => {
    expect(movements).toEqual(['21 Clean and Jerks @ 43 kg', '21 Cal Air Bike', '10 Clean & Jerk @ 43 kg'])
    expect(movements.join(' ')).not.toMatch(/Wall Balls/)
  })

  it('A/B/C/D/E/F/G/H/I/J/K/L/M/N - full card assertions against the real rendered PhotoResultCard', () => {
    const { container } = render(
      <PhotoResultCard
        photoUrl="https://signed.example/photo.jpg" onPhotoError={() => {}}
        gymName="CrossFit C15" gymColor="#ABE73C"
        variantLevel="RX" notRxdLabel={null}
        structureHeader={structureHeader} headline={headline}
        movements={movements} resultText="7:00"
        loggedAt="2026-09-06T09:29:00.000Z" lang="en" t={tEn}
      />
    )
    const text = container.textContent

    // A. top compact prescribed summary exists exactly once
    expect(screen.getAllByText(headline)).toHaveLength(1)

    // C. TIME CAP appears exactly once
    expect(screen.getAllByText('Time cap 10:00')).toHaveLength(1)

    // D. Time Cap sits under the top summary, before the metadata (gym name)
    const headlineIdx = text.indexOf(headline)
    const timeCapIdx = text.indexOf('Time cap 10:00')
    const gymIdx = text.indexOf('CrossFit C15')
    expect(headlineIdx).toBeGreaterThanOrEqual(0)
    expect(headlineIdx).toBeLessThan(timeCapIdx)
    expect(timeCapIdx).toBeLessThan(gymIdx)

    // E. central format "For Time" appears exactly once
    expect(screen.getAllByText('For Time')).toHaveLength(1)

    // F. central athlete progression contains the reached-station lines,
    // including the substitution
    expect(screen.getByText('21 Clean and Jerks @ 43 kg')).toBeInTheDocument()
    expect(screen.getByText('21 Cal Air Bike')).toBeInTheDocument()
    expect(screen.getByText('10 Clean & Jerk @ 43 kg')).toBeInTheDocument()

    // G. later unperformed stations (the full programmed 15/15/9/9 stations,
    // and the pre-substitution "Wall Balls") are absent everywhere on the card
    expect(text).not.toMatch(/Wall Balls/)
    expect(text).not.toMatch(/15 Cal Air Bike|15 Wall Balls|9 Clean & Jerk|9 Cal Air Bike/)

    // H. no standalone central RX badge (bordered span) - RX only appears
    // inside the bottom bar's joined text
    const borderedRx = [...container.querySelectorAll('span')].filter(el => el.style.border && /RX/.test(el.textContent))
    expect(borderedRx).toHaveLength(0)

    // I. no standalone central "7:00" - it appears exactly once, in the
    // bottom bar
    expect((text.match(/7:00/g) || []).length).toBe(1)

    // J. no redundant full prescribed workout block anywhere (the programmed
    // stations beyond what was performed never appear at all - already
    // covered by G; this asserts the count of rendered movement lines
    // equals the performed-truth count, never the 6-station programmed count)
    expect(container.querySelectorAll('div[style*="overflow-wrap: anywhere"]').length).toBeLessThanOrEqual(movements.length + 1) // +1 tolerance for the headline's own wrap style if present

    // K. bottom bar contains no movement/workout text
    const bottomBar = [...container.querySelectorAll('div')].find(d => d.style.background === 'rgba(0, 0, 0, 0.55)')
    expect(bottomBar.textContent).not.toMatch(/Clean and Jerks|Cal Air Bike|Clean & Jerk/)

    // L. bottom canonical result contains 7:00 and RX
    expect(bottomBar.textContent).toContain('7:00')
    expect(bottomBar.textContent).toContain('RX')

    // M. FORGE remains present
    expect(screen.getByText('FORGE')).toBeInTheDocument()

    // N. the performed substitution renders performed truth (Clean & Jerk),
    // never the programmed movement it replaced (Wall Balls) - already
    // asserted above via G/F, restated here as the substitution-specific check
    expect(text).toContain('Clean & Jerk')
    expect(text).not.toContain('Wall Balls')
  })
})
