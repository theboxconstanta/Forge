// FORGE - CANONICAL STRENGTH RESULT INTELLIGENCE, Phase D
//
// Proves the Journal card wiring that surfaces "NEW PR" inline (sections
// 15-16's minimum required surface, alongside save confirmation - see
// WorkoutSharePopup's own equivalent wiring in App.jsx, not covered by a
// render test here since it isn't exported/isolatable the way JurnalList
// is, but reads the identical shape and helper). Reuses App.jsx's
// `validRecentPrEvents` memo (filterValidRecentPrEvents' output - the
// SAME validated ledger Performance Overview's Recent PRs section reads)
// and recentPrEvents.js's `newPrEventsForSource` (proven separately in
// recentPrEvents.test.js) - this file proves the two are wired together
// correctly in the real JurnalList render, for BOTH wod_logs and
// skill_logs cards, and that a log with no matching event renders no
// badge at all (the overwhelming majority case).

import { describe, it, expect, afterEach } from 'vitest'
import { render, screen, cleanup } from '@testing-library/react'
import { JurnalList } from './App.jsx'
import { getT } from './translations.js'

afterEach(cleanup)

const t = getT('en')

function prEvent(overrides) {
  return {
    id: 'e1', gym_id: 'g1', member_id: 'm1', pr_type: 'movement',
    movement: 'Front Squat', rep_scheme: 3, benchmark_id: null, scaling_context: null,
    score_value: 100, score_unit: 'kg', voided_at: null,
    previous_best_value: 95, previous_best_unit: 'kg',
    improvement_value: 5, improvement_percentage: 5.26, is_first_recorded: false,
    source_wod_log_id: null, source_skill_log_id: null,
    occurred_at: '2026-09-01T10:00:00Z', created_at: '2026-09-01T10:00:00Z',
    ...overrides,
  }
}

const wodLogBase = {
  id: 'wlog-1',
  logged_at: '2026-09-01T10:00:00Z',
  variant_level: 'rx',
  notes: '',
  sets: { 'Front Squat': [{ completed: false, distance: '', targetReps: null, reps: '3', weight: '100' }] },
  format_snapshot: 'Build to Heavy/1RM',
  format_config_snapshot: { targetLabel: '3RM' },
  prescription_snapshot: null,
  workout_section_id: null,
  wods: null,
  wod_name_snapshot: null,
  movements_snapshot: null,
  performance_identity_id: null,
  wod_log_media: null,
}

describe('JurnalList - inline "NEW PR" (canonical, wod_logs)', () => {
  it('a wod_log with a matching validated pr_events row shows the NEW PR badge and improvement detail', () => {
    const events = [prEvent({ source_wod_log_id: 'wlog-1' })]
    render(
      <JurnalList entries={[{ key: 'wlog-1', wodLog: wodLogBase, skillLogsArr: [] }]}
        validRecentPrEvents={events} gender="male" weightUnit="kg" t={t} lang="en" />
    )
    expect(screen.getAllByText('NEW PR').length).toBeGreaterThan(0)
    expect(screen.getByText(/Front Squat 3RM: 100kg/)).toBeInTheDocument()
    expect(screen.getByText(/\+5kg/)).toBeInTheDocument()
  })

  it('a first-ever PR (is_first_recorded) never shows a fabricated improvement delta', () => {
    const events = [prEvent({ source_wod_log_id: 'wlog-1', is_first_recorded: true, previous_best_value: null, previous_best_unit: null, improvement_value: null, improvement_percentage: null })]
    render(
      <JurnalList entries={[{ key: 'wlog-1', wodLog: wodLogBase, skillLogsArr: [] }]}
        validRecentPrEvents={events} gender="male" weightUnit="kg" t={t} lang="en" />
    )
    expect(screen.getByText(/Front Squat 3RM: 100kg/)).toBeInTheDocument()
    expect(screen.queryByText(/\+/)).not.toBeInTheDocument()
  })

  it('a wod_log with NO matching event (the overwhelming majority) shows no badge at all', () => {
    const events = [prEvent({ source_wod_log_id: 'some-other-log' })]
    render(
      <JurnalList entries={[{ key: 'wlog-1', wodLog: wodLogBase, skillLogsArr: [] }]}
        validRecentPrEvents={events} gender="male" weightUnit="kg" t={t} lang="en" />
    )
    expect(screen.queryByText('NEW PR')).not.toBeInTheDocument()
  })

  it('reconciliation: an event reconciled away (absent from validRecentPrEvents, e.g. voided by a downward edit) leaves no badge, even though it existed before', () => {
    // First render WITH the event present...
    const events = [prEvent({ source_wod_log_id: 'wlog-1' })]
    const { rerender } = render(
      <JurnalList entries={[{ key: 'wlog-1', wodLog: wodLogBase, skillLogsArr: [] }]}
        validRecentPrEvents={events} gender="male" weightUnit="kg" t={t} lang="en" />
    )
    expect(screen.getAllByText('NEW PR').length).toBeGreaterThan(0)
    // ...then re-render as the caller would after a refetch post-edit, where
    // void_stale_pr_events has already voided the row server-side and the
    // refetched validRecentPrEvents no longer contains it.
    rerender(
      <JurnalList entries={[{ key: 'wlog-1', wodLog: wodLogBase, skillLogsArr: [] }]}
        validRecentPrEvents={[]} gender="male" weightUnit="kg" t={t} lang="en" />
    )
    expect(screen.queryByText('NEW PR')).not.toBeInTheDocument()
  })

  it('respects the RO translation for the badge label', () => {
    const tRo = getT('ro')
    const events = [prEvent({ source_wod_log_id: 'wlog-1' })]
    render(
      <JurnalList entries={[{ key: 'wlog-1', wodLog: wodLogBase, skillLogsArr: [] }]}
        validRecentPrEvents={events} gender="male" weightUnit="kg" t={tRo} lang="ro" />
    )
    expect(screen.getAllByText('RECORD NOU').length).toBeGreaterThan(0)
  })
})

describe('JurnalList - inline "NEW PR" (canonical, skill_logs)', () => {
  const skillLogBase = {
    id: 'slog-1',
    logged_at: '2026-09-01T10:00:00Z',
    notes: null,
    sets: { 'Rundă 1': [{ reps: '', weight: '100' }] },
    result: null,
    slot: 1,
    wods: { skill_name: 'Front Squat Complex', skill_type: 'Complex', skill_format_config: { scoringMode: 'Max Weight' } },
  }

  it('a skill_log with a matching validated pr_events row shows the NEW PR badge', () => {
    const events = [prEvent({ source_skill_log_id: 'slog-1', movement: 'Front Squat Complex', rep_scheme: null })]
    render(
      <JurnalList entries={[{ key: 'slog-1', wodLog: null, skillLogsArr: [skillLogBase] }]}
        validRecentPrEvents={events} gender="male" weightUnit="kg" t={t} lang="en" />
    )
    expect(screen.getAllByText('NEW PR').length).toBeGreaterThan(0)
    expect(screen.getByText(/Front Squat Complex: 100kg/)).toBeInTheDocument()
  })

  it('a skill_log with no matching event shows no badge', () => {
    render(
      <JurnalList entries={[{ key: 'slog-1', wodLog: null, skillLogsArr: [skillLogBase] }]}
        validRecentPrEvents={[]} gender="male" weightUnit="kg" t={t} lang="en" />
    )
    expect(screen.queryByText('NEW PR')).not.toBeInTheDocument()
  })
})
