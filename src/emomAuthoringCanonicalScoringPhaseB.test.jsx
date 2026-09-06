// EMOM AUTHORING + CANONICAL SCORING INTEGRITY - Phase B: the real Coach WOD
// Builder's Scoring control. FormatConfigEditor's EMOM-specific branch
// (EmomScoringField) - unit-aware option filtering, a smart default that is
// ACTUALLY PERSISTED (not the generic SelectField's cosmetic-only options[0]
// fallback, the exact bug class the live root cause traced back to), and
// movement-change invalidation. Tabata/Intervals/Complex keep the generic
// SelectField untouched (regression).

import { describe, it, expect, afterEach, vi } from 'vitest'
import { render, screen, cleanup, fireEvent } from '@testing-library/react'
import { useState } from 'react'
import FormatConfigEditor from './FormatConfigEditor'
import { getT } from './translations'

afterEach(cleanup)
const t = getT('en')

const reps = (name) => ({ name, reps: { mode: 'universal', value: 10 } })
const calories = (name) => ({ name, calories: { mode: 'universal', value: 12 } })

// A minimal controlled wrapper so the component's own useEffect-driven
// smart-default/invalidation writes are visible across a re-render, exactly
// as they are in the real PrimarySectionBody (config/instances are state,
// not fixed props).
function Controlled({ initialConfig, movementInstances, onConfigChange }) {
  const [config, setConfig] = useState(initialConfig)
  return (
    <FormatConfigEditor formatId="EMOM" onFormatChange={() => {}} config={config}
      onConfigChange={(c) => { setConfig(c); onConfigChange(c) }}
      movementInstances={movementInstances} t={t} />
  )
}

describe('EMOM Scoring control - rendering', () => {
  it('renders a Scoring control (not the generic 2-option select) for EMOM', () => {
    render(<FormatConfigEditor formatId="EMOM" onFormatChange={() => {}} config={{}} onConfigChange={() => {}}
      movementInstances={[reps('10 Push-ups')]} t={t} />)
    expect(screen.getByText(t.fmtIntervalScoring)).toBeInTheDocument()
  })
})

describe('Owner §4 smart default - reps-only EMOM auto-suggests AND persists Total Reps (not just cosmetic)', () => {
  it('homogeneous multi-movement reps-only (owner worked example) - Total Reps written to config on mount', () => {
    const onConfigChange = vi.fn()
    render(<Controlled initialConfig={{}} movementInstances={[reps('10 Push-ups'), reps('10 Air Squats'), reps('10 Pull-ups')]} onConfigChange={onConfigChange} />)
    expect(onConfigChange).toHaveBeenCalledWith(expect.objectContaining({ scoringMode: 'Total Reps' }))
  })

  it('the select shows Total Reps as an already-selected, editable value (not just visually via a fallback that never saves)', () => {
    render(<Controlled initialConfig={{}} movementInstances={[reps('10 Push-ups'), reps('10 Air Squats')]} onConfigChange={() => {}} />)
    expect(screen.getByDisplayValue('Total Reps')).toBeInTheDocument()
  })

  it('homogeneous calories auto-suggests Total Calories', () => {
    const onConfigChange = vi.fn()
    render(<Controlled initialConfig={{}} movementInstances={[calories('12 Cal Row'), calories('15 Cal Bike')]} onConfigChange={onConfigChange} />)
    expect(onConfigChange).toHaveBeenCalledWith(expect.objectContaining({ scoringMode: 'Total Calories' }))
  })
})

describe('Owner §5 unit-aware option filtering', () => {
  it('Case A - reps-only, single movement: Total Reps, Lowest Reps, No Score all offered', () => {
    render(<FormatConfigEditor formatId="EMOM" onFormatChange={() => {}} config={{ scoringMode: 'Lowest Reps' }} onConfigChange={() => {}}
      movementInstances={[reps('10 Burpees')]} t={t} />)
    const select = screen.getByDisplayValue('Lowest Reps')
    const optionValues = [...select.querySelectorAll('option')].map(o => o.value)
    expect(optionValues).toEqual(expect.arrayContaining(['Total Reps', 'Lowest Reps', 'No Score']))
  })

  it('Case C - reps + calories mixed: Total Reps is never an option (never silently produces 22)', () => {
    render(<FormatConfigEditor formatId="EMOM" onFormatChange={() => {}} config={{}} onConfigChange={() => {}}
      movementInstances={[calories('12 Cal Row'), reps('10 Burpees')]} t={t} />)
    const select = screen.getByDisplayValue(t.fmtScoringChoosePlaceholder)
    const optionValues = [...select.querySelectorAll('option')].map(o => o.value)
    expect(optionValues).not.toContain('Total Reps')
    expect(optionValues).toContain('No Score')
  })

  it('Case D - reps + load: Total Reps remains valid', () => {
    const onConfigChange = vi.fn()
    render(<Controlled initialConfig={{}} movementInstances={[
      { name: '10 Clean & Jerks', reps: { value: 10 }, load: { value: 43, unit: 'kg' } },
      reps('10 Burpees'),
    ]} onConfigChange={onConfigChange} />)
    expect(onConfigChange).toHaveBeenCalledWith(expect.objectContaining({ scoringMode: 'Total Reps' }))
  })
})

describe('Owner §8 movement-change invalidation - never silently keep a stale unsafe selection', () => {
  it('Total Reps selected for reps-only, then a movement becomes calorie-scored -> selection cleared, never kept', () => {
    const onConfigChange = vi.fn()
    const { rerender } = render(
      <FormatConfigEditor formatId="EMOM" onFormatChange={() => {}} config={{ scoringMode: 'Total Reps' }} onConfigChange={onConfigChange}
        movementInstances={[reps('10 Push-ups'), reps('10 Air Squats')]} t={t} />,
    )
    onConfigChange.mockClear()
    rerender(
      <FormatConfigEditor formatId="EMOM" onFormatChange={() => {}} config={{ scoringMode: 'Total Reps' }} onConfigChange={onConfigChange}
        movementInstances={[reps('10 Push-ups'), calories('12 Cal Row')]} t={t} />,
    )
    expect(onConfigChange).toHaveBeenCalledWith(expect.objectContaining({ scoringMode: null }))
  })
})

describe('Owner §7/§23 authoring persistence - save/reopen fidelity', () => {
  it('an already-saved scoringMode reloads correctly selected, untouched', () => {
    render(<FormatConfigEditor formatId="EMOM" onFormatChange={() => {}} config={{ scoringMode: 'Total Calories' }} onConfigChange={() => {}}
      movementInstances={[calories('12 Cal Row'), calories('15 Cal Bike')]} t={t} />)
    expect(screen.getByDisplayValue('Total Calories')).toBeInTheDocument()
  })

  it('an explicit No Score choice reloads correctly selected (not re-suggested away)', () => {
    const onConfigChange = vi.fn()
    render(<Controlled initialConfig={{ scoringMode: 'No Score' }} movementInstances={[reps('10 Push-ups'), reps('10 Air Squats')]} onConfigChange={onConfigChange} />)
    expect(screen.getByDisplayValue('No Score')).toBeInTheDocument()
    expect(onConfigChange).not.toHaveBeenCalled() // never silently overridden away from an explicit choice
  })

  it('the coach can change the selection and it persists via onConfigChange', () => {
    const onConfigChange = vi.fn()
    render(<Controlled initialConfig={{ scoringMode: 'Total Reps' }} movementInstances={[reps('10 Push-ups')]} onConfigChange={onConfigChange} />)
    fireEvent.change(screen.getByDisplayValue('Total Reps'), { target: { value: 'Lowest Reps' } })
    expect(onConfigChange).toHaveBeenCalledWith(expect.objectContaining({ scoringMode: 'Lowest Reps' }))
  })
})

describe('REGRESSION - Tabata/Intervals/Complex keep the generic SelectField, unaffected', () => {
  it('Tabata scoringMode is still the plain 2-option select, no unit filtering applied', () => {
    render(<FormatConfigEditor formatId="Tabata" onFormatChange={() => {}} config={{}} onConfigChange={() => {}} t={t} />)
    expect(screen.getByDisplayValue('Lowest Reps')).toBeInTheDocument() // schema default, unchanged
  })
  it('Intervals scoringMode is still the plain 2-option select, unaffected', () => {
    render(<FormatConfigEditor formatId="Intervals" onFormatChange={() => {}} config={{}} onConfigChange={() => {}} t={t} />)
    expect(screen.getByDisplayValue('Total Reps')).toBeInTheDocument() // schema default, unchanged
  })
  it('Complex scoringMode is still the plain select (no movementInstances-based filtering)', () => {
    render(<FormatConfigEditor formatId="Complex" onFormatChange={() => {}} config={{}} onConfigChange={() => {}} t={t} />)
    expect(screen.getByText(t.fmtComplexScoring)).toBeInTheDocument()
  })
})
