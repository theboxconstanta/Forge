// EMOM MINUTE-PATTERN AUTHORING - Phase D: real member logger (FormatLogger).
// Proves the logger renders the EFFECTIVE minute timeline (one block per
// minute with ONLY that minute's movement(s)) rather than every movement
// every minute - the exact production bug this incident fixes.

import { describe, it, expect, afterEach } from 'vitest'
import { render, screen, cleanup, fireEvent } from '@testing-library/react'
import FormatLogger from './FormatLogger'

afterEach(cleanup)

const mv = (name, patternMinute) => ({ name, instanceId: name, patternMinute, reps: { mode: 'universal', value: 10 } })

describe('Oracle A - single movement cycling (owner §11/§32)', () => {
  const config = { stationMode: 'minute-pattern', totalRounds: 6, intervalSec: 60 }
  const prescriptionMovements = [mv('Push-ups', 0), mv('Squats', 1), mv('Pull-ups', 2)]

  it('renders 6 MIN blocks, each with exactly ONE movement, cycling A/B/C/A/B/C', () => {
    render(<FormatLogger formatId="EMOM" config={config} movements={['Push-ups', 'Squats', 'Pull-ups']}
      prescriptionMovements={prescriptionMovements} value={{}} onChange={() => {}} t={{}} />)
    expect(screen.getByText('MIN 1')).toBeInTheDocument()
    expect(screen.getByText('MIN 6')).toBeInTheDocument()
    const repsInputs = screen.getAllByPlaceholderText('reps')
    expect(repsInputs).toHaveLength(6) // one input per minute - NEVER 18 (6 x 3)
  })

  it('does NOT render all three movements inside every minute (the exact production bug)', () => {
    render(<FormatLogger formatId="EMOM" config={config} movements={['Push-ups', 'Squats', 'Pull-ups']}
      prescriptionMovements={prescriptionMovements} value={{}} onChange={() => {}} t={{}} />)
    // "Push-ups" must appear exactly twice (minutes 1 and 4), never 6 times
    expect(screen.getAllByText('Push-ups')).toHaveLength(2)
    expect(screen.getAllByText('Squats')).toHaveLength(2)
    expect(screen.getAllByText('Pull-ups')).toHaveLength(2)
  })
})

describe('Oracle B - multi-movement minute (owner §12/§32)', () => {
  const config = { stationMode: 'minute-pattern', totalRounds: 4, intervalSec: 60 }
  const prescriptionMovements = [mv('Push-ups', 0), mv('Air Squats', 0), mv('Pull-ups', 1)]

  it('MIN 1/3 show Push-ups AND Air Squats; MIN 2/4 show only Pull-ups', () => {
    render(<FormatLogger formatId="EMOM" config={config} movements={['Push-ups', 'Air Squats', 'Pull-ups']}
      prescriptionMovements={prescriptionMovements} value={{}} onChange={() => {}} t={{}} />)
    expect(screen.getAllByText('Push-ups')).toHaveLength(2) // MIN 1, MIN 3
    expect(screen.getAllByText('Air Squats')).toHaveLength(2)
    expect(screen.getAllByText('Pull-ups')).toHaveLength(2) // MIN 2, MIN 4
    expect(screen.getAllByPlaceholderText('reps')).toHaveLength(6) // (2+1) x 2 cycles
  })
})

describe('Owner live fixture - writes land on the CORRECT minute-scoped key', () => {
  it('typing into MIN 2 writes to the Air Squats key for minute 2, not minute 1', () => {
    const config = { stationMode: 'minute-pattern', totalRounds: 3, intervalSec: 60 }
    const prescriptionMovements = [mv('Push-ups', 0), mv('Air Squats', 1), mv('Pull-ups', 2)]
    let lastPatch = null
    render(<FormatLogger formatId="EMOM" config={config} movements={['Push-ups', 'Air Squats', 'Pull-ups']}
      prescriptionMovements={prescriptionMovements} value={{}} onChange={(v) => { lastPatch = v }} t={{}} />)
    const repsInputs = screen.getAllByPlaceholderText('reps')
    fireEvent.change(repsInputs[1], { target: { value: '9' } })
    // rowsByKey is pre-seeded (empty) for every minute; the edit must land
    // on MIN 2's own key, never MIN 1's or MIN 3's.
    expect(lastPatch.sets['Min 2 · 1. Air Squats'][0].reps).toBe('9')
    expect(lastPatch.sets['Min 1 · 1. Push-ups'][0].reps).toBe('')
    expect(lastPatch.sets['Min 3 · 1. Pull-ups'][0].reps).toBe('')
  })

  it('live score box sums 10+9+7 = 26 as the member types', () => {
    const config = { stationMode: 'minute-pattern', totalRounds: 3, intervalSec: 60, scoringMode: 'Total Reps' }
    const prescriptionMovements = [mv('Push-ups', 0), mv('Air Squats', 1), mv('Pull-ups', 2)]
    const value = {
      sets: {
        'Min 1 · 1. Push-ups': [{ reps: '10' }],
        'Min 2 · 1. Air Squats': [{ reps: '9' }],
        'Min 3 · 1. Pull-ups': [{ reps: '7' }],
      },
    }
    render(<FormatLogger formatId="EMOM" config={config} movements={['Push-ups', 'Air Squats', 'Pull-ups']}
      prescriptionMovements={prescriptionMovements} value={value} onChange={() => {}} t={{}} />)
    expect(screen.getByText(/26/)).toBeInTheDocument()
  })
})

describe('REGRESSION - shared-interval and legacy flat EMOM logger rendering unaffected', () => {
  it('a shared-interval EMOM still shows every movement every round (unchanged)', () => {
    const config = { stationMode: 'shared-interval', totalRounds: 2, intervalSec: 60 }
    render(<FormatLogger formatId="EMOM" config={config} movements={['Push-ups', 'Air Squats', 'Pull-ups']}
      value={{}} onChange={() => {}} t={{}} />)
    expect(screen.getAllByText('Push-ups')).toHaveLength(2) // both rounds
    expect(screen.getAllByPlaceholderText('reps')).toHaveLength(6) // 2 rounds x 3 stations
  })

  it('a legacy flat EMOM (no stationMode) renders unchanged', () => {
    render(<FormatLogger formatId="EMOM" config={{ totalRounds: 3, intervalSec: 60 }} movements={['Burpees']}
      value={{}} onChange={() => {}} t={{}} />)
    expect(screen.queryByText('MIN 1')).not.toBeInTheDocument()
    expect(screen.getAllByPlaceholderText('reps')).toHaveLength(3)
  })
})
