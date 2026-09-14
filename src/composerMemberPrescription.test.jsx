// FORGE WORKOUT COMPOSER - PHASE 3.2: member full prescription rendering.
//
// ROOT CAUSE (traced, not assumed): the member Home WOD card
// (App.jsx ~L11939-12080, both the single-selected-variant branch and the
// admin/coach all-variants accordion) rendered EXCLUSIVELY from the legacy
// `primarySectionV.format`/`.formatConfig` scalar columns + `v.movements`
// (metconVariantsForDisplay) - it never read canonical components[] at
// all. For a Composer-authored owned envelope whose scorer has NO legacy
// 'mixed' equivalent (a repeated-rounds RFT/EMOM main - Phase 3's own
// documented limitation, componentContract.js's deriveLegacyFieldsFromComponents),
// the legacy scalar columns only ever contain the SCORER's own
// format/config/instances - Buy-In/Cash-Out/Rest/other independent scorers
// are never represented there at all. This is root cause A ("member
// renderer still reads legacy section.format + instances") COMBINED with
// the specific Phase 3 fallback gap - not B/C/D/E, since componentsFromSection
// itself was never involved in Home's read path prior to this phase.
//
// activePrescriptionDoc (App.jsx) is `wodZiData.movement_prescriptions` -
// the EXACT SAME JSONB document Phase 3 already writes `.variants[key]
// .components` into (legacyPayloadFromSections, wodSections.js) - already
// fetched for every WOD, zero new query, zero DB migration required.
//
// FIX: resolveMemberComposerPrescription (componentContract.js) decides,
// per variant, whether to use the canonical components[] path (a genuine
// multi-Component graph - 2+ entries) or keep the existing legacy path
// (0-1 components, ticket §19's exact-parity requirement) - both Home
// branches now call it. MemberComposerPrescription
// (composerMemberPrescription.jsx) renders the canonical path via
// previewBlocksFromComponents - the SAME pure projection the Builder
// Preview already uses (composerAuthoring.jsx), parameterized with the
// athlete's own gender instead of gender-neutral - guaranteeing semantic
// (not visual) parity between what the coach authors and what the member
// sees (ticket §20).

import { describe, it, expect, afterEach } from 'vitest'
import { render, screen, cleanup } from '@testing-library/react'
import MemberComposerPrescription from './composerMemberPrescription'
import {
  createComponent, previewBlocksFromComponents, resolveMemberComposerPrescription,
  componentSecondaryTiming, componentHeaderLabel,
} from './componentContract'
import { newMovementInstance } from './prescriptionContract'

afterEach(cleanup)

function inst(name) { return newMovementInstance({ name }) }

const t = { memberWodTimeCapLabel: 'Time cap' }

function envelope() {
  const rft = createComponent({ id: 'rft', format: 'RFT', role: 'main', producesScore: true, config: { rounds: 5, timeCapSec: 1200 }, instances: [inst('DB Floor Press')] })
  const buyIn = createComponent({ id: 'buyin', format: 'Once', role: 'buy-in', producesScore: false, scoreOwnerId: 'rft', instances: [inst('1000m Row')] })
  const cashOut = createComponent({ id: 'cashout', format: 'Once', role: 'cash-out', producesScore: false, scoreOwnerId: 'rft', instances: [inst('800m Run')] })
  return [buyIn, rft, cashOut].map((c, i) => ({ ...c, order: i }))
}

function restBetweenTwoScorers() {
  const amrap = createComponent({ id: 'amrap', format: 'AMRAP', producesScore: true, config: { durationSec: 480 }, instances: [inst('Pull-Ups')] })
  const rest = createComponent({ id: 'rest', format: 'Rest', producesScore: false, config: { durationSec: 120 }, instances: [] })
  const rft = createComponent({ id: 'rft', format: 'RFT', producesScore: true, config: { rounds: 5 }, instances: [inst('Wall Balls')] })
  return [amrap, rest, rft].map((c, i) => ({ ...c, order: i }))
}

function fiveComponentGraph() {
  const amrap = createComponent({ id: 'amrap', format: 'AMRAP', producesScore: true, config: { durationSec: 480 }, instances: [inst('Pull-Ups')] })
  const rest1 = createComponent({ id: 'rest1', format: 'Rest', producesScore: false, config: { durationSec: 120 }, instances: [] })
  const rft = createComponent({ id: 'rft', format: 'RFT', producesScore: true, config: { rounds: 5 }, instances: [inst('Wall Balls')] })
  const rest2 = createComponent({ id: 'rest2', format: 'Rest', producesScore: false, config: { durationSec: 60 }, instances: [] })
  const emom = createComponent({ id: 'emom', format: 'EMOM', producesScore: true, config: { totalRounds: 8, intervalSec: 60 }, instances: [inst('Bike Calories')] })
  return [amrap, rest1, rft, rest2, emom].map((c, i) => ({ ...c, order: i }))
}

// --- 22/1. The exact owner reproduction -------------------------------------

describe('22. required real repro - Buy-In + 5 RFT with time cap', () => {
  it('renders BUY-IN with its movement AND 5 ROUNDS FOR TIME with the movement and time cap', () => {
    const buyIn = createComponent({ id: 'buyin', format: 'Once', role: 'buy-in', producesScore: false, scoreOwnerId: 'rft', instances: [inst('Assault Bike Calories')] })
    const rft = createComponent({ id: 'rft', format: 'RFT', role: 'main', producesScore: true, config: { rounds: 5, timeCapSec: 1200 }, instances: [inst('DB Floor Press')] })
    const components = [buyIn, rft].map((c, i) => ({ ...c, order: i }))
    render(<MemberComposerPrescription components={components} gender={null} t={t} />)

    expect(screen.getByText('BUY-IN')).toBeInTheDocument()
    expect(screen.getByText(/Assault Bike Calories/)).toBeInTheDocument()
    expect(screen.getByText('5 ROUNDS FOR TIME')).toBeInTheDocument()
    expect(screen.getByText(/DB Floor Press/)).toBeInTheDocument()
    expect(screen.getByText('Time cap 20:00')).toBeInTheDocument()
  })
})

// --- 23. owned envelope (Buy-In + RFT + Cash-Out) ---------------------------

describe('23. required owned envelope test', () => {
  it('all three Components visible, correct order, no duplicates, no internal terminology', () => {
    render(<MemberComposerPrescription components={envelope()} gender={null} t={t} />)
    const headers = screen.getAllByText(/^BUY-IN$|ROUNDS FOR TIME|^CASH-OUT$/)
    expect(headers.map(h => h.textContent)).toEqual(['BUY-IN', '5 ROUNDS FOR TIME', 'CASH-OUT'])
    expect(screen.getByText(/1000m Row/)).toBeInTheDocument()
    expect(screen.getByText(/DB Floor Press/)).toBeInTheDocument()
    expect(screen.getByText(/800m Run/)).toBeInTheDocument()
    // no duplicates - each movement appears exactly once
    expect(screen.getAllByText(/1000m Row/)).toHaveLength(1)
    expect(screen.getAllByText(/800m Run/)).toHaveLength(1)
    // no internal score terminology anywhere on the card
    expect(screen.queryByText(/scoreOwnerId|producesScore|scorer|envelope|cmp_/i)).not.toBeInTheDocument()
  })
})

// --- 24. Rest between two scorers -------------------------------------------

describe('24. required Rest test', () => {
  it('all three visible, Rest in correct position, no movement row for Rest, no primary-component filtering', () => {
    render(<MemberComposerPrescription components={restBetweenTwoScorers()} gender={null} t={t} />)
    const headers = screen.getAllByText(/^AMRAP|^REST|ROUNDS FOR TIME/)
    expect(headers.map(h => h.textContent)).toEqual(['AMRAP · 8:00', 'REST · 2:00', '5 ROUNDS FOR TIME'])
    expect(screen.getByText(/Pull-Ups/)).toBeInTheDocument()
    expect(screen.getByText(/Wall Balls/)).toBeInTheDocument()
    // Rest renders no movement line at all
    expect(screen.queryByText('Rest')).not.toBeInTheDocument()
  })
})

// --- 25. multi-score (5 components, 3 scorers) ------------------------------

describe('25. required multi-score test', () => {
  it('all five Components visible in canonical order, neither Rest suppressed, no primary display source', () => {
    render(<MemberComposerPrescription components={fiveComponentGraph()} gender={null} t={t} />)
    const headers = screen.getAllByText(/^AMRAP|^REST|ROUNDS FOR TIME|^EMOM/)
    expect(headers.map(h => h.textContent)).toEqual(['AMRAP · 8:00', 'REST · 2:00', '5 ROUNDS FOR TIME', 'REST · 1:00', 'EMOM 8'])
    expect(screen.getByText(/Pull-Ups/)).toBeInTheDocument()
    expect(screen.getByText(/Wall Balls/)).toBeInTheDocument()
    expect(screen.getByText(/Bike Calories/)).toBeInTheDocument()
  })
})

// --- Ticket §30's 22-item required list -------------------------------------

describe('30.1/30.2/30.3 - Buy-In+RFT / RFT+Cash-Out / Buy-In+RFT+Cash-Out', () => {
  it('Buy-In + RFT renders both', () => {
    const rft = createComponent({ id: 'rft', format: 'RFT', producesScore: true, config: { rounds: 5 }, instances: [inst('Wall Balls')] })
    const buyIn = createComponent({ id: 'buyin', format: 'Once', role: 'buy-in', producesScore: false, scoreOwnerId: 'rft', instances: [inst('Row')] })
    render(<MemberComposerPrescription components={[buyIn, rft].map((c, i) => ({ ...c, order: i }))} gender={null} t={t} />)
    expect(screen.getByText('BUY-IN')).toBeInTheDocument()
    expect(screen.getByText('5 ROUNDS FOR TIME')).toBeInTheDocument()
  })

  it('RFT + Cash-Out renders both', () => {
    const rft = createComponent({ id: 'rft', format: 'RFT', producesScore: true, config: { rounds: 5 }, instances: [inst('Wall Balls')] })
    const cashOut = createComponent({ id: 'cashout', format: 'Once', role: 'cash-out', producesScore: false, scoreOwnerId: 'rft', instances: [inst('Run')] })
    render(<MemberComposerPrescription components={[rft, cashOut].map((c, i) => ({ ...c, order: i }))} gender={null} t={t} />)
    expect(screen.getByText('5 ROUNDS FOR TIME')).toBeInTheDocument()
    expect(screen.getByText('CASH-OUT')).toBeInTheDocument()
  })

  it('Buy-In + RFT + Cash-Out renders all three', () => {
    render(<MemberComposerPrescription components={envelope()} gender={null} t={t} />)
    expect(screen.getByText('BUY-IN')).toBeInTheDocument()
    expect(screen.getByText('5 ROUNDS FOR TIME')).toBeInTheDocument()
    expect(screen.getByText('CASH-OUT')).toBeInTheDocument()
  })
})

describe('30.4/30.5 - AMRAP+Rest+RFT / five-Component multi-score', () => {
  it('AMRAP + Rest + RFT renders all three', () => {
    render(<MemberComposerPrescription components={restBetweenTwoScorers()} gender={null} t={t} />)
    expect(screen.getAllByText(/^AMRAP|^REST|ROUNDS FOR TIME/)).toHaveLength(3)
  })
  it('AMRAP + Rest + RFT + Rest + EMOM renders all five', () => {
    render(<MemberComposerPrescription components={fiveComponentGraph()} gender={null} t={t} />)
    expect(screen.getAllByText(/^AMRAP|^REST|ROUNDS FOR TIME|^EMOM/)).toHaveLength(5)
  })
})

describe('30.6 - canonical order preserved regardless of input array order', () => {
  it('components passed out of order still render sorted by `order`', () => {
    const shuffled = [...fiveComponentGraph()].reverse() // deliberately scrambled
    render(<MemberComposerPrescription components={shuffled} gender={null} t={t} />)
    const headers = screen.getAllByText(/^AMRAP|^REST|ROUNDS FOR TIME|^EMOM/)
    expect(headers.map(h => h.textContent)).toEqual(['AMRAP · 8:00', 'REST · 2:00', '5 ROUNDS FOR TIME', 'REST · 1:00', 'EMOM 8'])
  })
})

describe('30.7/30.8 - producesScore:false and scoreOwnerId never hide a Component', () => {
  it('Buy-In (producesScore:false, scoreOwnerId set) still renders', () => {
    const buyIn = createComponent({ format: 'Once', role: 'buy-in', producesScore: false, scoreOwnerId: 'rft-1', instances: [inst('Row')] })
    const blocks = previewBlocksFromComponents([buyIn])
    expect(blocks).toHaveLength(1)
    expect(blocks[0].header).toBe('BUY-IN')
  })
})

describe('30.9 - Rest renders structurally, never as a movement', () => {
  it('a Rest component produces a header block with zero movement lines', () => {
    const rest = createComponent({ format: 'Rest', producesScore: false, config: { durationSec: 120 } })
    const blocks = previewBlocksFromComponents([rest])
    expect(blocks[0].header).toBe('REST · 2:00')
    expect(blocks[0].movementLines).toEqual([])
  })
})

describe('30.10 - no movement duplication', () => {
  it('each movement appears in exactly one Component block, never twice across the whole projection', () => {
    const blocks = previewBlocksFromComponents(envelope())
    const allLines = blocks.flatMap(b => b.movementLines)
    expect(new Set(allLines).size).toBe(allLines.length) // no repeats
    expect(allLines).toHaveLength(3) // Row, DB Floor Press, Run - one each
  })
})

describe('30.11/30.26 - selected variant only, no cross-variant leakage', () => {
  it('resolveMemberComposerPrescription reads ONLY the requested variant, never another', () => {
    const doc = {
      variants: {
        rx: { components: envelope() },
        beginner: { components: [createComponent({ format: 'AMRAP', producesScore: true, instances: [inst('Burpees')] })] },
      },
    }
    const rxResult = resolveMemberComposerPrescription(doc, 'rx')
    const beginnerResult = resolveMemberComposerPrescription(doc, 'beginner')
    expect(rxResult).toHaveLength(3) // full envelope
    // beginner has only 1 component -> not a "Composer path" case (ticket §19 parity)
    expect(beginnerResult).toBe(null)
    expect(resolveMemberComposerPrescription(doc, 'intermediate')).toBe(null) // never programmed, never leaks rx/beginner data
  })
})

describe('30.12 - empty variants produce no phantom blocks', () => {
  it('an unprogrammed variant (components: []) resolves to null - the legacy path renders instead, nothing phantom', () => {
    const doc = { variants: { rx: { components: [] } } }
    expect(resolveMemberComposerPrescription(doc, 'rx')).toBe(null)
  })
  it('MemberComposerPrescription itself renders nothing for an empty array', () => {
    const { container } = render(<MemberComposerPrescription components={[]} gender={null} t={t} />)
    expect(container.firstChild).toBeNull()
  })
})

describe('30.13-30.17 - legacy/single-component parity (resolveMemberComposerPrescription returns null)', () => {
  it('a single legacy-projected AMRAP component keeps the existing legacy path (not the Composer one)', () => {
    const doc = { variants: { rx: { components: [createComponent({ format: 'AMRAP', producesScore: true, instances: [inst('Burpees')] })] } } }
    expect(resolveMemberComposerPrescription(doc, 'rx')).toBe(null)
  })
  it('a single legacy-projected RFT component keeps the existing legacy path', () => {
    const doc = { variants: { rx: { components: [createComponent({ format: 'RFT', producesScore: true, config: { rounds: 5 }, instances: [inst('Wall Balls')] })] } } }
    expect(resolveMemberComposerPrescription(doc, 'rx')).toBe(null)
  })
  it('a single legacy-projected EMOM component keeps the existing legacy path', () => {
    const doc = { variants: { rx: { components: [createComponent({ format: 'EMOM', producesScore: true, config: { totalRounds: 8 }, instances: [inst('Burpees')] })] } } }
    expect(resolveMemberComposerPrescription(doc, 'rx')).toBe(null)
  })
  it('no components field at all (a legacy WOD never touched by the Composer) keeps the existing legacy path', () => {
    expect(resolveMemberComposerPrescription({ variants: { rx: {} } }, 'rx')).toBe(null)
    expect(resolveMemberComposerPrescription(null, 'rx')).toBe(null)
  })
  it('a legacy Buy-In/Cash-Out mixed WOD (3 real components) DOES use the Composer path - full parity, no regression', () => {
    const doc = { variants: { rx: { components: envelope() } } }
    expect(resolveMemberComposerPrescription(doc, 'rx')).toHaveLength(3)
  })
})

describe('30.18 - time cap preserved', () => {
  it('componentSecondaryTiming surfaces "Time cap 20:00" for an RFT scorer with timeCapSec set', () => {
    const rft = createComponent({ format: 'RFT', config: { rounds: 5, timeCapSec: 1200 } })
    expect(componentSecondaryTiming(rft, t)).toEqual({ label: 'Time cap', value: '20:00' })
  })
  it('never attaches a time cap to Buy-In/Cash-Out/Rest, even if config carried one', () => {
    expect(componentSecondaryTiming(createComponent({ format: 'Once', role: 'buy-in', config: { timeCapSec: 999 } }))).toBe(null)
    expect(componentSecondaryTiming(createComponent({ format: 'Once', role: 'cash-out' }))).toBe(null)
    expect(componentSecondaryTiming(createComponent({ format: 'Rest', config: { durationSec: 120 } }))).toBe(null)
  })
  it('a scorer with no time cap configured shows no secondary value (never invented)', () => {
    expect(componentSecondaryTiming(createComponent({ format: 'AMRAP', config: {} }))).toBe(null)
  })
  it('AMRAP/EMOM never duplicate their own duration/rounds as an unlabeled secondary value (found live via QA harness)', () => {
    // AMRAP's duration is already embedded in componentHeaderLabel ("AMRAP
    // · 8:00") - getWorkoutFormatDisplay would otherwise also return that
    // same duration as a bare, UNLABELED secondaryValue (AMRAP/EMOM are not
    // in TIME_CAP_LABEL_FORMAT_IDS), rendering the same number twice.
    expect(componentSecondaryTiming(createComponent({ format: 'AMRAP', config: { durationSec: 480 } }))).toBe(null)
    expect(componentSecondaryTiming(createComponent({ format: 'EMOM', config: { totalRounds: 8, intervalSec: 60 } }))).toBe(null)
  })
})

describe('30.19 - movement metrics preserved (reps/load/M-F/distance/calories reuse renderInstanceLine unchanged)', () => {
  it('a load-bearing movement renders its full prescription text, gender-resolved', () => {
    const withLoad = { ...inst('DB Floor Press'), load: { mode: 'universal', value: 22.5, unit: 'kg' } }
    const rft = createComponent({ format: 'RFT', config: { rounds: 5 }, instances: [withLoad] })
    const blocks = previewBlocksFromComponents([rft])
    expect(blocks[0].movementLines[0]).toMatch(/22\.5/)
    expect(blocks[0].movementLines[0]).toMatch(/kg/)
  })
})

describe('30.20 - Builder Preview and member projection share the same canonical sequence', () => {
  it('previewBlocksFromComponents with gender=null (Builder) and a real gender (member) produce identical header order/ids', () => {
    const components = fiveComponentGraph()
    const builderBlocks = previewBlocksFromComponents(components) // Builder Preview's own call, unchanged
    const memberBlocks = previewBlocksFromComponents(components, { gender: 'male', t })
    expect(memberBlocks.map(b => b.id)).toEqual(builderBlocks.map(b => b.id))
    expect(memberBlocks.map(b => b.header)).toEqual(builderBlocks.map(b => b.header))
  })
})

describe('componentHeaderLabel sanity (no internal terminology anywhere in Composer headers)', () => {
  it('every header in a complex graph reads as human copy only', () => {
    const headers = envelope().map(c => componentHeaderLabel(c))
    headers.forEach(h => expect(h).not.toMatch(/scoreOwnerId|producesScore|scorer|envelope|cmp_|component/i))
  })
})
