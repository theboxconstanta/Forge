// FORGE WORKOUT COMPOSER - MULTI-PART SCORING TICKET, Part 14. Renders the
// REAL ComposerPartLeaderboard (dynamic OVERALL/PART A/PART B tabs) against
// the canonical target workout (For Time + Time Cap, THEN Max Effort/Load).

import { describe, it, expect, afterEach } from 'vitest'
import { render, screen, cleanup, fireEvent } from '@testing-library/react'
import ComposerPartLeaderboard from './composerLeaderboardUI'
import { partTabLabel } from './componentLeaderboard'

afterEach(cleanup)

const t = { clasamentOverallLabel: 'OVERALL', clasamentIncompleteLabel: 'Incomplete', clasamentAnonymous: 'Anonymous', clasamentPointsLabel: (n) => `${n} pts` }

const NIVELE = [
  { id: 'RX', culoare: '#791F1F', bg: '#FCEBEB' },
  { id: 'Intermediate', culoare: '#633806', bg: '#FAEEDA' },
  { id: 'Beginner', culoare: '#0E0E0E', bg: '#f0f0f0' },
  { id: 'OnRamp', culoare: '#0C447C', bg: '#E6F1FB' },
]

const partA = { id: 'partA', format: 'For Time', config: { structure: 'Sequence', timeCapSec: 900 } }
const partB = { id: 'partB', format: 'Max Effort', config: { timeCapSec: 180 } }

function logFor(memberId, name, { partATime, partAResult, partACompletion, partBLoad, tier = 'RX', weightUnit = 'kg' } = {}) {
  const componentResults = {}
  if (partATime !== undefined || partAResult !== undefined) {
    componentResults.partA = {
      format: 'For Time', result: partAResult ?? null, time_result: partATime ?? null,
      completion_state: partACompletion ?? (partATime ? 'completed' : (partAResult ? 'capped' : null)), sets: null, load_result: null,
    }
  }
  if (partBLoad !== undefined) {
    componentResults.partB = { format: 'Max Effort', result: null, time_result: null, completion_state: null, sets: null, load_result: partBLoad }
  }
  return {
    member_id: memberId, variant_level: tier, profile: { full_name: name, weight_unit: weightUnit },
    log_meta: Object.keys(componentResults).length ? { componentResults } : null,
  }
}

describe('partTabLabel', () => {
  it('uses the component\'s own label when the coach set one', () => {
    expect(partTabLabel({ label: 'Strength Test' }, 0)).toBe('Strength Test')
  })
  it('falls back to "Part A"/"Part B" by order when no label exists - never a hardcoded 2-part assumption', () => {
    expect(partTabLabel({}, 0)).toBe('Part A')
    expect(partTabLabel({}, 1)).toBe('Part B')
    expect(partTabLabel({}, 2)).toBe('Part C')
  })
})

describe('ComposerPartLeaderboard - dynamic tabs', () => {
  it('renders OVERALL + one tab per scored component, in canonical order', () => {
    const logs = [logFor('alice', 'Alice', { partATime: '11:42', partBLoad: 95 })]
    render(<ComposerPartLeaderboard scorers={[partA, partB]} nivele={NIVELE} logsUnicePerMembru={logs} t={t} />)
    expect(screen.getByText('OVERALL')).toBeInTheDocument()
    expect(screen.getByText('Part A')).toBeInTheDocument()
    expect(screen.getByText('Part B')).toBeInTheDocument()
  })

  it('defaults to the OVERALL tab, showing rank/name/points', () => {
    const logs = [
      logFor('alice', 'Alice', { partATime: '11:42', partBLoad: 90 }),
      logFor('bob', 'Bob', { partATime: '10:15', partBLoad: 80 }),
    ]
    render(<ComposerPartLeaderboard scorers={[partA, partB]} nivele={NIVELE} logsUnicePerMembru={logs} t={t} />)
    expect(screen.getByText('Alice')).toBeInTheDocument()
    expect(screen.getByText('Bob')).toBeInTheDocument()
    expect(screen.getAllByText(/pts/).length).toBeGreaterThan(0)
  })

  it('a member missing a required component shows as "— Name Incomplete" on OVERALL, never a fake rank', () => {
    const logs = [
      logFor('alice', 'Alice', { partATime: '11:42', partBLoad: 95 }),
      logFor('bob', 'Bob', { partATime: '10:15' }), // never logged Part B
    ]
    render(<ComposerPartLeaderboard scorers={[partA, partB]} nivele={NIVELE} logsUnicePerMembru={logs} t={t} />)
    expect(screen.getByText('Bob')).toBeInTheDocument()
    expect(screen.getByText('Incomplete')).toBeInTheDocument()
  })

  it('clicking a Part tab shows that component\'s own leaderboard with its own native score text (time for Part A)', () => {
    const logs = [
      logFor('alice', 'Alice', { partATime: '11:42', partBLoad: 95 }),
      logFor('bob', 'Bob', { partATime: '10:15', partBLoad: 80 }),
    ]
    render(<ComposerPartLeaderboard scorers={[partA, partB]} nivele={NIVELE} logsUnicePerMembru={logs} t={t} />)
    fireEvent.click(screen.getByText('Part A'))
    expect(screen.getByText('10:15')).toBeInTheDocument()
    expect(screen.getByText('11:42')).toBeInTheDocument()
  })

  it('clicking Part B shows LOAD results with the poster\'s own kg/lb suffix - 3:00 window never shown as a score', () => {
    const logs = [logFor('alice', 'Alice', { partATime: '11:42', partBLoad: 95, weightUnit: 'kg' })]
    render(<ComposerPartLeaderboard scorers={[partA, partB]} nivele={NIVELE} logsUnicePerMembru={logs} t={t} />)
    fireEvent.click(screen.getByText('Part B'))
    expect(screen.getByText('95 kg')).toBeInTheDocument()
    expect(screen.queryByText('3:00')).not.toBeInTheDocument()
  })

  it('never mixes RX and Beginner tiers into one ranking pool (tier isolation, ticket §13)', () => {
    const logs = [
      logFor('alice', 'Alice', { partATime: '10:00', partBLoad: 100, tier: 'RX' }),
      logFor('bob', 'Bob', { partATime: '20:00', partBLoad: 40, tier: 'Beginner' }),
    ]
    render(<ComposerPartLeaderboard scorers={[partA, partB]} nivele={NIVELE} logsUnicePerMembru={logs} t={t} />)
    expect(screen.getByText('RX')).toBeInTheDocument()
    expect(screen.getByText('Beginner')).toBeInTheDocument()
    // Both alice (RX) and bob (Beginner) appear - each ranked within their OWN
    // tier only (verified precisely at the pure-function level in
    // componentLeaderboard.test.js's own tier-isolation test).
    expect(screen.getByText('Alice')).toBeInTheDocument()
    expect(screen.getByText('Bob')).toBeInTheDocument()
  })
})
