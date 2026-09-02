// INC-11 - the Sequence AMRAP logger (SequentialAmrapFields) rendered through
// UniversalScoreInput, plus the classic-AMRAP no-regression check.

import { describe, it, expect, afterEach } from 'vitest'
import { render, screen, fireEvent, cleanup } from '@testing-library/react'
import { useState } from 'react'
import UniversalScoreInput from './UniversalScoreInput'
import { scoreDefinitionFor } from './scoreDefinition'
import { resolveSequentialAmrapStations } from './sequentialAmrap'

afterEach(cleanup)

const STATIONS = resolveSequentialAmrapStations({
  lines: ['50 Burpee Pull-ups', '75 Russian KB Swings', 'Max Reps Burpee Pull-ups'],
}).stations

function Harness({ def, movements = [], formatId = 'AMRAP', initial = {} }) {
  const [value, setValue] = useState({ result: '', time: '', roundsCompleted: '', additionalReps: '', partialReps: [], sets: {}, completed: false, weightLogged: '', stages: [], ...initial })
  return (
    <>
      <UniversalScoreInput def={def} formatId={formatId} config={{}} movements={movements}
        prescribedWeight={null} rxStatus={null} value={value} onChange={setValue} weightUnit="kg" t={{}} />
      <pre data-testid="value">{JSON.stringify(value)}</pre>
    </>
  )
}
const val = () => JSON.parse(screen.getByTestId('value').textContent)

describe('INC-11 - Sequence AMRAP logger', () => {
  const def = scoreDefinitionFor('AMRAP', { durationSec: 600, structure: 'Sequence' }, { sequentialAmrapStations: STATIONS })

  it('renders one input per ordered station - NOT "Rounds completed" / "Additional reps"', () => {
    render(<Harness def={def} />)
    expect(screen.queryByLabelText('Rounds completed')).not.toBeInTheDocument()
    expect(screen.queryByLabelText('Additional reps')).not.toBeInTheDocument()
    expect(screen.getByLabelText('Burpee Pull-ups reps')).toBeInTheDocument()
    expect(screen.getByLabelText('Russian KB Swings reps')).toBeInTheDocument()
    expect(screen.getByLabelText('Max reps Burpee Pull-ups reps')).toBeInTheDocument()
  })

  it('§101 - incident case: 50 / 63 / not reached -> partialReps kept, total 113 shown', () => {
    render(<Harness def={def} />)
    fireEvent.change(screen.getByLabelText('Burpee Pull-ups reps'), { target: { value: '50' } })
    fireEvent.change(screen.getByLabelText('Russian KB Swings reps'), { target: { value: '63' } })
    expect(val().partialReps).toEqual(['50', '63', ''])
    expect(screen.getByText(/TOTAL REPS: 113/)).toBeInTheDocument()
  })

  it('§71 - reaching the open station shows total 137', () => {
    render(<Harness def={def} initial={{ partialReps: ['50', '75', ''] }} />)
    fireEvent.change(screen.getByLabelText('Max reps Burpee Pull-ups reps'), { target: { value: '12' } })
    expect(screen.getByText(/TOTAL REPS: 137/)).toBeInTheDocument()
  })

  it('§15 - recording only the open station auto-completes prior fixed targets in the total', () => {
    render(<Harness def={def} />)
    fireEvent.change(screen.getByLabelText('Max reps Burpee Pull-ups reps'), { target: { value: '12' } })
    expect(screen.getByText(/TOTAL REPS: 137/)).toBeInTheDocument()
  })

  it('fixed station caps its input at the prescribed target', () => {
    render(<Harness def={def} />)
    expect(screen.getByLabelText('Burpee Pull-ups reps')).toHaveAttribute('max', '50')
    expect(screen.getByLabelText('Max reps Burpee Pull-ups reps')).not.toHaveAttribute('max')
  })
})

describe('INC-11 §74/§102 - classic repeated-round AMRAP is UNCHANGED', () => {
  it('classic AMRAP still shows Rounds completed + Additional reps', () => {
    const def = scoreDefinitionFor('AMRAP', { durationSec: 600 }, {})
    render(<Harness def={def} movements={['5 Pull-up', '10 Push-up', '15 Squat']} />)
    expect(screen.getByLabelText('Rounds completed')).toBeInTheDocument()
    expect(screen.getByLabelText('Additional reps')).toBeInTheDocument()
    expect(screen.queryByText(/TOTAL REPS/)).not.toBeInTheDocument()
  })
})
