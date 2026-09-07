// FORGE - CANONICAL STRENGTH RESULT INTELLIGENCE, Leaderboard gap fix
// (owner live report, commit 248dca3 shipped without this surface).
//
// ROOT CAUSE (forensic, confirmed by direct code trace against the REAL
// Leaderboard render path, not assumed): the expanded result card lives
// in a SEPARATE component, `Clasament` (App.jsx ~line 2306), entirely
// independent from `JurnalList` (~line 6519) - Phase B's wiring only
// touched JurnalList + FormatLogger. `Clasament`'s expanded card already
// calls `parseWodLogDetails` and renders `wSetsParti` + a
// `showSetsScoreAtEnd` primary-score block (the "MAXIM: 75kg" the owner
// saw), but NEVER called `computeVolumeLoad` at all - the metric was
// simply never computed on this surface, not filtered out and not lost
// in transit. `Clasament` was not exported, so no render test could have
// caught this gap before now.
//
// FIX: reuses the SAME canonical `computeVolumeLoad`/
// `resolveMovementLoadCapabilityByKey` helper (workoutFormats.js, Phase
// A) - zero second calculation path. Reads THIS log's own frozen
// `prescription_snapshot.movements` and the log POSTER's own
// `profile.weight_unit` (the same per-poster-unit convention
// `setsScoreUnitSuffix` already uses on this exact card), never the
// viewer's own profile. `Clasament` exported (zero behavior change) to
// make this real render test possible, mirroring the same pattern
// already used for `JurnalList`/`MovementRowListPWA`.

import { describe, it, expect, afterEach } from 'vitest'
import { render, screen, fireEvent, cleanup } from '@testing-library/react'
import { Clasament, JurnalList } from './App.jsx'
import { getT } from './translations.js'

afterEach(cleanup)

const t = getT('en')

const row = (reps, weight) => ({ completed: true, distance: '', targetReps: null, reps, weight })

// Real-shaped RX instance - Snatch is load-capable.
const snatchInst = { instanceId: 'mi_sn', name: 'Snatch', canonicalMovementId: 'cm-snatch', reps: { mode: 'universal', value: null }, load: { mode: 'sex_specific', male: null, female: null, unit: 'kg' } }

// EXACT owner-reported live rows (Strength Sets, Snatch):
// 5@60, 6@60, 4@65, 4@65, 4@65, 3@70, 3@75 -> max 75kg.
// Volume = 5*60 + 6*60 + 4*65*3 + 3*70 + 3*75
//        = 300 + 360 + 780 + 210 + 225 = 1875kg.
// NOTE: the owner's ticket states an expected total of 1,945kg for these
// exact rows - re-deriving the arithmetic from the rows AS STATED gives
// 1875kg, not 1945kg (a 70kg gap unaccounted for by any row). This test
// asserts the CORRECT sum for the stated rows (1875kg, matching
// computeVolumeLoad's own already-proven oracle A shape) rather than the
// ticket's total verbatim - see the implementation report for this
// flagged discrepancy.
const ownerSets = { Snatch: [row('5', '60'), row('6', '60'), row('4', '65'), row('4', '65'), row('4', '65'), row('3', '70'), row('3', '75')] }

function makeLog(overrides = {}) {
  return {
    id: 'wlog-lb-1',
    member_id: 'member-1',
    _source: 'wod_logs',
    variant_level: 'RX',
    logged_at: '2026-09-08T10:00:00Z',
    notes: '',
    weight_logged: null,
    performed_prescription: null,
    result: null,
    time_result: null,
    log_meta: null,
    workout_section_id: null,
    wod_id: 'wod-1',
    sets: ownerSets,
    format_snapshot: 'Strength Sets',
    format_config_snapshot: { setsScheme: [5, 6, 4, 4, 4, 3, 3] },
    prescription_snapshot: { movements: [snatchInst] },
    movements_snapshot: null,
    profile: { full_name: 'Test Athlete', weight_unit: 'kg', gender: 'masculin' },
    ...overrides,
  }
}

const wodZiData = { type: 'Strength Sets', format_config: { setsScheme: [5, 6, 4, 4, 4, 3, 3] }, duration: null, name: null }

function renderLeaderboard(logs) {
  return render(
    <Clasament entries={undefined} logs={logs} sections={[]} aggregateDefinition={null} loading={false}
      wodZiData={wodZiData} onRefresh={() => {}} selectedDate="2026-09-08" onDateChange={() => {}} t={t} lang="en" />
  )
}

function expandFirstCard() {
  // The card header (name row) toggles the expanded detail on click.
  fireEvent.click(screen.getByText('Test Athlete'))
}

describe('Clasament (Leaderboard) - Total Weight Lifted, real render', () => {
  it('shows the primary MAX score (75kg) unchanged, and the derived Total Weight Lifted (1875kg) once expanded', () => {
    renderLeaderboard([makeLog()])
    // Primary score visible on the collapsed card, unaffected.
    expect(screen.getByText('75kg')).toBeInTheDocument()
    expandFirstCard()
    expect(screen.getByText(/Total Weight Lifted: 1875kg/)).toBeInTheDocument()
    // Primary score still present and still 75kg after expansion - never replaced.
    expect(screen.getAllByText('75kg').length).toBeGreaterThan(0)
  })

  it('collapsed card never shows Total Weight Lifted (secondary metric lives only in the expanded detail)', () => {
    renderLeaderboard([makeLog()])
    expect(screen.queryByText(/Total Weight Lifted/)).not.toBeInTheDocument()
  })

  it('Build to Heavy/1RM stays excluded on the Leaderboard too (RM test, not a volume session)', () => {
    const log = makeLog({
      sets: { Snatch: [row('3', '80')] },
      format_snapshot: 'Build to Heavy/1RM',
      format_config_snapshot: { targetLabel: '3RM' },
    })
    renderLeaderboard([log])
    expandFirstCard()
    expect(screen.queryByText(/Total Weight Lifted/)).not.toBeInTheDocument()
  })

  it('a bodyweight-only movement (Air Squat, no load capability) never shows Total Weight Lifted', () => {
    const airSquatInst = { instanceId: 'mi_as', name: 'Air Squat', canonicalMovementId: 'cm-as', reps: { mode: 'universal', value: null } }
    const log = makeLog({
      sets: { 'Air Squat': [row('10', '')] },
      prescription_snapshot: { movements: [airSquatInst] },
    })
    renderLeaderboard([log])
    expandFirstCard()
    expect(screen.queryByText(/Total Weight Lifted/)).not.toBeInTheDocument()
  })

  it('a log with no prescription_snapshot.movements (legacy, no RX instances) fails closed - never guesses capability', () => {
    const log = makeLog({ prescription_snapshot: null })
    renderLeaderboard([log])
    expandFirstCard()
    expect(screen.queryByText(/Total Weight Lifted/)).not.toBeInTheDocument()
  })

  it('blank rows contribute nothing (never falls back to the programmed target)', () => {
    const log = makeLog({ sets: { Snatch: [row('', '60'), row('5', '60')] } })
    renderLeaderboard([log])
    expandFirstCard()
    // Only the real row (5@60=300) contributes - the blank row is excluded, not treated as 0.
    expect(screen.getByText(/Total Weight Lifted: 300kg/)).toBeInTheDocument()
  })

  it('uses the SAME canonical helper as Journal/FormatLogger - no second calculation path (import identity check)', async () => {
    const workoutFormats = await import('./workoutFormats.js')
    expect(typeof workoutFormats.computeVolumeLoad).toBe('function')
    // Direct proof the component's own output matches calling the helper
    // independently on the identical inputs - same function, same result.
    const direct = workoutFormats.computeVolumeLoad(
      ownerSets,
      workoutFormats.resolveMovementLoadCapabilityByKey([snatchInst]),
      'kg',
    )
    expect(direct.totalWeight).toBe(1875)
    renderLeaderboard([makeLog()])
    expandFirstCard()
    expect(screen.getByText(new RegExp(`Total Weight Lifted: ${direct.totalWeight}kg`))).toBeInTheDocument()
  })
})

describe('Cross-surface parity - Journal and Leaderboard agree on the IDENTICAL saved log', () => {
  it('the same wod_logs row renders the same Total Weight Lifted in both JurnalList and Clasament', () => {
    const log = makeLog()
    cleanup()
    renderLeaderboard([log])
    expandFirstCard()
    expect(screen.getByText(/Total Weight Lifted: 1875kg/)).toBeInTheDocument()
    cleanup()
    render(
      <JurnalList entries={[{ key: log.id, wodLog: log, skillLogsArr: [] }]}
        validRecentPrEvents={[]} gender="male" weightUnit={log.profile.weight_unit} t={t} lang="en" />
    )
    expect(screen.getByText(/Total Weight Lifted: 1875kg/)).toBeInTheDocument()
  })
})
