// EVERY-N-MINUTES SUPPORTS MM:SS (owner addendum) - EMOM/E1:30MOM/E2MOM/
// E2:30MOM/E3MOM are ONE canonical Every-N-Minutes family, keyed entirely off
// the pre-existing canonical `intervalSec` field (already a 'duration'
// schema type, already read generically with no whole-minute assumption
// anywhere in the structure/scoring layer - confirmed by forensic read of
// resolveIntervalStructure's 'shared-interval' branch and resolveEmomTimeline
// before writing this file). This incident only adds:
//   1. a DISPLAY-layer human name derived from intervalSec (emomFamilyLabel,
//      wired into computeFormatPrimaryLabel/formatTypeLabel - the ONE
//      existing canonical "format display name" resolver, reused, not
//      duplicated)
//   2. a pattern-POSITION terminology switch ("MIN N" -> "INTERVAL N") once
//      a position no longer spans exactly one minute (emomPositionWord)
// No new format id, no `intervalMinutes`, no integer-minute rounding, no
// second canonical source of truth - intervalSec remains the only one.
import { describe, it, expect, afterEach } from 'vitest'
import { useState } from 'react'
import { render, screen, cleanup, fireEvent } from '@testing-library/react'
import {
  isWholeMinuteInterval, emomFamilyLabel, emomPositionWord,
  formatTypeLabel, estimateTotalDurationSec, resolveEmomTimeline,
  resolveIntervalStructure, computeSetsScore, emomStationKey,
} from './workoutFormats.js'
import FormatLogger from './FormatLogger'
import FormatConfigEditor from './FormatConfigEditor'
import { EmomMinutePatternEditor } from './App.jsx'
import { getT } from './translations'

afterEach(cleanup)

describe('isWholeMinuteInterval / emomFamilyLabel - pure display derivation from intervalSec', () => {
  it('60 sec -> EMOM (default/missing intervalSec also falls back to 60)', () => {
    expect(isWholeMinuteInterval(60)).toBe(true)
    expect(isWholeMinuteInterval(null)).toBe(true)
    expect(isWholeMinuteInterval(undefined)).toBe(true)
    expect(emomFamilyLabel(60)).toBe('EMOM')
    expect(emomFamilyLabel(null)).toBe('EMOM')
  })
  it('90 sec -> E1:30MOM', () => {
    expect(isWholeMinuteInterval(90)).toBe(false)
    expect(emomFamilyLabel(90)).toBe('E1:30MOM')
  })
  it('120 sec -> E2MOM (whole extra minute, no :00 suffix)', () => {
    expect(emomFamilyLabel(120)).toBe('E2MOM')
  })
  it('150 sec -> E2:30MOM', () => {
    expect(emomFamilyLabel(150)).toBe('E2:30MOM')
  })
  it('180 sec -> E3MOM', () => {
    expect(emomFamilyLabel(180)).toBe('E3MOM')
  })
  it('never string-parsed - arithmetic only, e.g. 45 sec -> E0:45MOM', () => {
    expect(emomFamilyLabel(45)).toBe('E0:45MOM')
  })
})

describe('emomPositionWord - MIN vs INTERVAL terminology switch', () => {
  it('MIN for a whole-minute interval (60s, or missing/default)', () => {
    expect(emomPositionWord(60)).toBe('MIN')
    expect(emomPositionWord(undefined)).toBe('MIN')
  })
  it('INTERVAL for anything else', () => {
    expect(emomPositionWord(90)).toBe('INTERVAL')
    expect(emomPositionWord(120)).toBe('INTERVAL')
    expect(emomPositionWord(150)).toBe('INTERVAL')
  })
})

describe('formatTypeLabel(\'EMOM\', config) - single canonical display-name resolver, reused not duplicated', () => {
  it('defaults to EMOM with no intervalSec set (unchanged regression)', () => {
    expect(formatTypeLabel('EMOM', { totalRounds: 10 })).toBe('EMOM')
    expect(formatTypeLabel('EMOM', {})).toBe('EMOM')
    expect(formatTypeLabel('EMOM', null)).toBe('EMOM')
  })
  it('60s intervalSec still reads EMOM (unchanged regression)', () => {
    expect(formatTypeLabel('EMOM', { totalRounds: 10, intervalSec: 60 })).toBe('EMOM')
  })
  it('derives the family name for non-60s intervalSec', () => {
    expect(formatTypeLabel('EMOM', { totalRounds: 6, intervalSec: 90 })).toBe('E1:30MOM')
    expect(formatTypeLabel('EMOM', { totalRounds: 5, intervalSec: 120 })).toBe('E2MOM')
    expect(formatTypeLabel('EMOM', { totalRounds: 4, intervalSec: 150 })).toBe('E2:30MOM')
  })
})

describe('REQUIRED ORACLES A-D - interval count is coach-authored directly (totalRounds), never derived by dividing a total duration - estimateTotalDurationSec is the READOUT, confirmed correct for arbitrary intervalSec', () => {
  it('A - EMOM 10:00, intervalSec 60 -> 10 complete intervals', () => {
    expect(estimateTotalDurationSec('EMOM', { totalRounds: 10, intervalSec: 60 })).toBe(600)
  })
  it('B - E1:30MOM 9:00, intervalSec 90 -> 6 complete intervals', () => {
    expect(estimateTotalDurationSec('EMOM', { totalRounds: 6, intervalSec: 90 })).toBe(540)
  })
  it('C - E2MOM 10:00, intervalSec 120 -> 5 complete intervals', () => {
    expect(estimateTotalDurationSec('EMOM', { totalRounds: 5, intervalSec: 120 })).toBe(600)
  })
  it('D - E2:30MOM 10:00, intervalSec 150 -> 4 complete intervals', () => {
    expect(estimateTotalDurationSec('EMOM', { totalRounds: 4, intervalSec: 150 })).toBe(600)
  })
})

describe('NON-DIVISIBLE DURATION - traced, not guessed: FORGE has no "total duration" input for EMOM to divide', () => {
  // Forensic finding: EMOM's schema (workoutFormats.js WORKOUT_FORMATS.EMOM.config)
  // authors `totalRounds` (the interval COUNT itself, label "Number of
  // intervals") and `intervalSec` (duration per interval) as two INDEPENDENT
  // direct inputs. estimateTotalDurationSec only ever multiplies them for a
  // read-only "(auto)" total shown back to the coach - it never divides a
  // total by intervalSec to derive a count. A config like "E2:30MOM 11:00"
  // therefore never exists as raw input: the coach who wants that simply
  // authors totalRounds directly (4 complete + a 5th partial is the coach's
  // own explicit choice of totalRounds=4 or totalRounds=5, made BY them, not
  // guessed FOR them). No 660/150 remainder case can arise in this model, so
  // no HARD STOP is raised - this test documents that the architectural
  // invariant (no division, no rounding, no manufactured partial interval)
  // holds for an arbitrary non-60 intervalSec exactly as it already did for
  // intervalSec=60.
  it('the auto-duration readout is a straight product, never a quotient/remainder', () => {
    expect(estimateTotalDurationSec('EMOM', { totalRounds: 4, intervalSec: 150 })).toBe(600) // 10:00, not 11:00
    expect(estimateTotalDurationSec('EMOM', { totalRounds: 5, intervalSec: 150 })).toBe(750) // 12:30 if the coach explicitly picks 5
  })
})

describe('REQUIRED ORACLE E - 3-position pattern cycling with a non-60 intervalSec (E2:30MOM 15:00)', () => {
  it('A/B/C/A/B/C across 6 intervals', () => {
    const config = { stationMode: 'minute-pattern', totalRounds: 6, intervalSec: 150 }
    const movements = [
      { name: 'A', patternMinute: 0 }, { name: 'B', patternMinute: 1 }, { name: 'C', patternMinute: 2 },
    ]
    const timeline = resolveEmomTimeline('EMOM', config, movements)
    expect(timeline.effectiveMinutes.map((m) => m.movements.map((mv) => mv.name).join(''))).toEqual(['A', 'B', 'C', 'A', 'B', 'C'])
  })
})

describe('REQUIRED ORACLE F - 2-position pattern with a multi-movement position, non-60 intervalSec (E2:30MOM 10:00)', () => {
  it('I1 A+B, I2 C, I3 A+B, I4 C', () => {
    const config = { stationMode: 'minute-pattern', totalRounds: 4, intervalSec: 150 }
    const movements = [
      { name: 'A', patternMinute: 0 }, { name: 'B', patternMinute: 0 }, { name: 'C', patternMinute: 1 },
    ]
    const timeline = resolveEmomTimeline('EMOM', config, movements)
    expect(timeline.effectiveMinutes.map((m) => m.movements.map((mv) => mv.name))).toEqual([
      ['A', 'B'], ['C'], ['A', 'B'], ['C'],
    ])
  })
})

describe('SCORING - interval duration has no authority over performed quantity (owner spec), proven with a non-60 intervalSec', () => {
  it('programmed 10, athlete performs 8 -> score contribution 8, never 10', () => {
    const config = { stationMode: 'minute-pattern', totalRounds: 2, intervalSec: 150, scoringMode: 'Total Reps' }
    const rowsByKey = { [emomStationKey(1, 1, 'Clean & Jerk')]: [{ reps: '8' }], [emomStationKey(2, 1, 'Clean & Jerk')]: [{ reps: '8' }] }
    expect(computeSetsScore('EMOM', config, rowsByKey)).toBe(16)
    expect(computeSetsScore('EMOM', config, rowsByKey)).not.toBe(20) // never the prescribed 10x2
  })
})

describe('shared-interval EMOM (INC-01 model) - resolveIntervalStructure already reads intervalSec generically, no whole-minute assumption (regression-confirming, not a new code path)', () => {
  it('roundCount x intervalSec, arbitrary intervalSec, all-seconds math', () => {
    const iv = resolveIntervalStructure('EMOM', { stationMode: 'shared-interval', roundCount: 4, intervalSec: 150 }, ['A', 'B'])
    expect(iv.totalDurationSec).toBe(600)
    expect(iv.workSec).toBe(150)
  })
})

function ControlledEmomConfigEditor({ t }) {
  const [config, setConfig] = useState({})
  return (
    <>
      <FormatConfigEditor formatId="EMOM" onFormatChange={() => {}} config={config} onConfigChange={setConfig} t={t} />
      <div data-testid="debug-interval-sec">{config.intervalSec ?? ''}</div>
    </>
  )
}

describe('COACH BUILDER - the existing generic DurationField already gives minute+second precision (EMOM intervalSec is type:"duration", not a new input)', () => {
  it('setting 1 min 30 sec on the Interval duration field persists intervalSec:90', () => {
    const t = getT('en')
    render(<ControlledEmomConfigEditor t={t} />)
    const spinbuttons = screen.getAllByRole('spinbutton')
    // [0] totalRounds, [1] intervalSec-min, [2] intervalSec-sec
    fireEvent.change(spinbuttons[1], { target: { value: '1' } })
    fireEvent.change(spinbuttons[2], { target: { value: '30' } })
    expect(screen.getByTestId('debug-interval-sec').textContent).toBe('90')
  })

  it('seconds are not restricted to :00 (e.g. 2:30 persists as 150, not rounded)', () => {
    const t = getT('en')
    render(<ControlledEmomConfigEditor t={t} />)
    const spinbuttons = screen.getAllByRole('spinbutton')
    fireEvent.change(spinbuttons[1], { target: { value: '2' } })
    fireEvent.change(spinbuttons[2], { target: { value: '30' } })
    expect(screen.getByTestId('debug-interval-sec').textContent).toBe('150')
  })
})

describe('PATTERN TERMINOLOGY - member logger (FormatLogger) switches MIN -> INTERVAL only when intervalSec !== 60', () => {
  const mv = (name, patternMinute) => ({ name, instanceId: name, patternMinute, reps: { mode: 'universal', value: 10 } })

  it('minute-pattern branch: intervalSec=60 still shows MIN N (regression)', () => {
    const config = { stationMode: 'minute-pattern', totalRounds: 2, intervalSec: 60 }
    render(<FormatLogger formatId="EMOM" config={config} movements={['A', 'B']}
      prescriptionMovements={[mv('A', 0), mv('B', 1)]} value={{}} onChange={() => {}} t={{}} />)
    expect(screen.getByText('MIN 1')).toBeInTheDocument()
    expect(screen.queryByText('INTERVAL 1')).not.toBeInTheDocument()
  })

  it('minute-pattern branch: intervalSec=150 shows INTERVAL N, never MIN N', () => {
    const config = { stationMode: 'minute-pattern', totalRounds: 2, intervalSec: 150 }
    render(<FormatLogger formatId="EMOM" config={config} movements={['A', 'B']}
      prescriptionMovements={[mv('A', 0), mv('B', 1)]} value={{}} onChange={() => {}} t={{}} />)
    expect(screen.getByText('INTERVAL 1')).toBeInTheDocument()
    expect(screen.getByText('INTERVAL 2')).toBeInTheDocument()
    expect(screen.queryByText('MIN 1')).not.toBeInTheDocument()
  })

  it('shared-interval branch: intervalSec=150 shows "INTERVAL N" (uppercased at render, like the pre-existing "MIN N"), never "MIN N"', () => {
    const config = { stationMode: 'shared-interval', totalRounds: 2, intervalSec: 150 }
    render(<FormatLogger formatId="EMOM" config={config} movements={['A', 'B']}
      value={{}} onChange={() => {}} t={{}} />)
    expect(screen.getByText('INTERVAL 1')).toBeInTheDocument()
    expect(screen.queryByText('MIN 1')).not.toBeInTheDocument()
  })

  it('shared-interval branch: intervalSec=60 still shows "MIN N" (regression)', () => {
    const config = { stationMode: 'shared-interval', totalRounds: 2, intervalSec: 60 }
    render(<FormatLogger formatId="EMOM" config={config} movements={['A', 'B']}
      value={{}} onChange={() => {}} t={{}} />)
    expect(screen.getByText('MIN 1')).toBeInTheDocument()
  })

  it('writes still land on the emomStationKey "Min N" key even when displayed as INTERVAL N (persistence key format is unchanged/backward-compatible)', () => {
    const config = { stationMode: 'minute-pattern', totalRounds: 2, intervalSec: 150 }
    let lastPatch = null
    render(<FormatLogger formatId="EMOM" config={config} movements={['A', 'B']}
      prescriptionMovements={[mv('A', 0), mv('B', 1)]} value={{}} onChange={(v) => { lastPatch = v }} t={{}} />)
    fireEvent.change(screen.getAllByPlaceholderText('reps')[0], { target: { value: '9' } })
    expect(lastPatch.sets['Min 1 · 1. A'][0].reps).toBe('9')
  })
})

describe('PATTERN TERMINOLOGY - Coach Builder (EmomMinutePatternEditor) switches MIN -> INTERVAL only when intervalSec !== 60', () => {
  it('defaults to MIN N with no intervalSec prop (regression)', () => {
    render(<EmomMinutePatternEditor instances={[]} onChange={() => {}} catalog={null} />)
    expect(screen.getByText('MIN 1')).toBeInTheDocument()
  })
  it('shows INTERVAL N when intervalSec=150', () => {
    render(<EmomMinutePatternEditor instances={[]} onChange={() => {}} catalog={null} intervalSec={150} />)
    expect(screen.getByText('INTERVAL 1')).toBeInTheDocument()
    expect(screen.queryByText('MIN 1')).not.toBeInTheDocument()
  })
})
