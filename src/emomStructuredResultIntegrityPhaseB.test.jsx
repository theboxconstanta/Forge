// EMOM STRUCTURED RESULT INTEGRITY - Phase B: wiring pure Phase A helpers
// into the Admin save path (wodSections.js) and the member logger
// (FormatLogger.jsx's SetsFields). No new admin UI field: a coach-authored
// EMOM with 2+ real RX movements and no cycling `intervals` list has no
// other legitimate reading than "these movements share every interval" (the
// `intervals` field already owns "one movement, rotating"); this mirrors
// INC-07's own roundCount -> stationMode derivation, stamped at save time.

import { describe, it, expect, afterEach } from 'vitest'
import { render, screen, cleanup, fireEvent } from '@testing-library/react'
import { legacyPayloadFromSections, createSection } from './wodSections'
import FormatLogger from './FormatLogger'

afterEach(cleanup)

describe('EMOM save-path stamping (legacyPayloadFromSections) - additive, mirrors INC-07 Intervals', () => {
  const makeEmomSection = (formatConfig, stationNames) => {
    const s = createSection('metcon', true)
    s.format = 'EMOM'
    s.formatConfig = formatConfig
    s.variants = { rx: { instances: stationNames.map((name) => ({ name, instanceId: name })), movements: [], weight: { male: '', female: '' }, note: '' } }
    return s
  }

  it('owner reproduction WOD (3 RX movements, no intervals list) is stamped shared-interval + roundCount at save time', () => {
    const payload = legacyPayloadFromSections([makeEmomSection({ totalRounds: 10, intervalSec: 60 }, ['10 Push-ups', '10 Air Squats', '10 Pull-ups'])])
    expect(payload.type).toBe('EMOM')
    expect(payload.format_config.stationMode).toBe('shared-interval')
    expect(payload.format_config.roundCount).toBe(10)
    expect(payload.format_config.totalRounds).toBe(10) // preserved verbatim, duration math still reads it
  })

  it('a classic single-movement EMOM ("EMOM 10: 5 Burpees") is left untouched - not auto-structured', () => {
    const payload = legacyPayloadFromSections([makeEmomSection({ totalRounds: 10, intervalSec: 60 }, ['5 Burpees'])])
    expect(payload.format_config.stationMode).toBeUndefined()
    expect(payload.format_config.roundCount).toBeUndefined()
  })

  it('an EMOM with zero RX movements is left untouched', () => {
    const payload = legacyPayloadFromSections([makeEmomSection({ totalRounds: 10, intervalSec: 60 }, [])])
    expect(payload.format_config.stationMode).toBeUndefined()
  })

  it('a cycling EMOM (config.intervals set) is NEVER auto-upgraded, even with 2+ RX movements - intervals already owns that authoring intent', () => {
    const payload = legacyPayloadFromSections([makeEmomSection(
      { totalRounds: 10, intervalSec: 60, intervals: ['Burpees', 'Air Squats'] },
      ['Burpees', 'Air Squats'],
    )])
    expect(payload.format_config.stationMode).toBeUndefined()
    expect(payload.format_config.intervals).toEqual(['Burpees', 'Air Squats'])
  })

  it('REST is never counted as a station for the 2+ threshold (only 1 real movement here, stays legacy flat)', () => {
    const payload = legacyPayloadFromSections([makeEmomSection({ totalRounds: 10, intervalSec: 60 }, ['10 Push-ups', 'Rest'])])
    expect(payload.format_config.stationMode).toBeUndefined()
  })

  it('REGRESSION - Intervals\' own stamping (per-interval) is unaffected by the EMOM branch', () => {
    const s = createSection('metcon', true)
    s.format = 'Intervals'
    s.formatConfig = { roundCount: 5, workSec: 40, restSec: 20 }
    s.variants = { rx: { instances: ['Row', 'Wall Balls'].map((name) => ({ name, instanceId: name })), movements: [], weight: { male: '', female: '' }, note: '' } }
    const payload = legacyPayloadFromSections([s])
    expect(payload.format_config.stationMode).toBe('per-interval')
    expect(payload.format_config.rounds).toBe(10)
  })
})

describe('FormatLogger structured EMOM grid - "Min N" labeling, keys line up with defaultRowsForFormat', () => {
  const structuredConfig = { stationMode: 'shared-interval', totalRounds: 2, intervalSec: 60 }
  const movements = ['10 Push-ups', '10 Air Squats']

  it('renders MIN round headers, never Intervals/Tabata\'s "Rundă"', () => {
    render(<FormatLogger formatId="EMOM" config={structuredConfig} movements={movements} value={{}} onChange={() => {}} t={{}} />)
    expect(screen.getByText('MIN 1')).toBeInTheDocument()
    expect(screen.getByText('MIN 2')).toBeInTheDocument()
    expect(screen.queryByText(/RUNDĂ/i)).not.toBeInTheDocument()
  })

  it('renders one reps input per station per round, and writes back using the SAME "Min N · S. name" key defaultRowsForFormat seeds', () => {
    let lastPatch = null
    render(<FormatLogger formatId="EMOM" config={structuredConfig} movements={movements}
      value={{}} onChange={(v) => { lastPatch = v }} t={{}} />)
    const repsInputs = screen.getAllByPlaceholderText('reps')
    expect(repsInputs).toHaveLength(4) // 2 rounds x 2 stations
    fireEvent.change(repsInputs[0], { target: { value: '10' } })
    expect(lastPatch.sets['Min 1 · 1. 10 Push-ups'][0].reps).toBe('10')
  })

  it('a structured EMOM score sums across ALL station keys via the shared setsScoreLabel/computeSetsScore path (no parallel EMOM total)', () => {
    const value = {
      sets: {
        'Min 1 · 1. 10 Push-ups': [{ reps: '10' }], 'Min 1 · 2. 10 Air Squats': [{ reps: '10' }],
        'Min 2 · 1. 10 Push-ups': [{ reps: '10' }], 'Min 2 · 2. 10 Air Squats': [{ reps: '10' }],
      },
    }
    render(<FormatLogger formatId="EMOM" config={{ ...structuredConfig, scoringMode: 'Total Reps' }} movements={movements}
      value={value} onChange={() => {}} t={{}} />)
    expect(screen.getByText(/40/)).toBeInTheDocument()
  })

  it('REGRESSION - a legacy/unconfigured EMOM (no stationMode) still renders the flat single-input-per-minute rows, unchanged', () => {
    render(<FormatLogger formatId="EMOM" config={{ totalRounds: 2, intervalSec: 60 }} movements={movements} value={{}} onChange={() => {}} t={{}} />)
    expect(screen.queryByText('MIN 1')).not.toBeInTheDocument() // no round-grouped header in flat mode
    expect(screen.getAllByPlaceholderText('reps')).toHaveLength(2) // Min 1, Min 2 - one input each
  })
})
