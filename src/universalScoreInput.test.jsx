import { describe, it, expect } from 'vitest'
import { render, screen, fireEvent, cleanup } from '@testing-library/react'
import { afterEach } from 'vitest'
import { useState } from 'react'
import UniversalScoreInput from './UniversalScoreInput'
import { scoreDefinitionFor } from './scoreDefinition'

afterEach(cleanup)

// A harness that mirrors App.jsx: it holds the score value and exposes it so a
// test can assert the SUBMITTED payload shape after interactions.
function Harness({ def, movements = [], prescribedWeight = null, initial = {}, formatId = 'RFT' }) {
  const [value, setValue] = useState({ result: '', time: '', roundsCompleted: '', partialReps: [], sets: {}, completed: false, weightLogged: '', stages: [], ...initial })
  return (
    <>
      <UniversalScoreInput def={def} formatId={formatId} config={{}} movements={movements}
        prescribedWeight={prescribedWeight} rxStatus={prescribedWeight ? 'not_rx' : null}
        value={value} onChange={setValue} weightUnit="kg" t={{}} />
      <pre data-testid="value">{JSON.stringify(value)}</pre>
    </>
  )
}
const val = () => JSON.parse(screen.getByTestId('value').textContent)

describe('P9.5 — UniversalScoreInput · TIME (no cap)', () => {
  it('shows a single time field, no Finished/Capped toggle', () => {
    render(<Harness def={{ kind: 'TIME' }} />)
    expect(screen.queryByRole('radio', { name: /finished/i })).not.toBeInTheDocument()
    fireEvent.change(screen.getByLabelText('Time minutes'), { target: { value: '17' } })
    fireEvent.change(screen.getByLabelText('Time seconds'), { target: { value: '42' } })
    expect(val().time).toBe('17:42')
  })
})

describe('P9.5 — UniversalScoreInput · TIME_CAPPED · toggle payload correctness (§3)', () => {
  const def = scoreDefinitionFor('RFT', { rounds: 3, timeCapSec: 1200 })

  it('defaults to Finished; a finish time commits', () => {
    render(<Harness def={def} movements={['12 Wall Ball', '21 Power Clean']} />)
    expect(screen.getByRole('radio', { name: /finished/i })).toHaveAttribute('aria-checked', 'true')
    fireEvent.change(screen.getByLabelText('Finish time minutes'), { target: { value: '17' } })
    fireEvent.change(screen.getByLabelText('Finish time seconds'), { target: { value: '42' } })
    expect(val().time).toBe('17:42')
  })

  it('Finished -> Time Capped CLEARS the finish time from the payload (no stale time)', () => {
    render(<Harness def={def} movements={['12 Wall Ball']} />)
    fireEvent.change(screen.getByLabelText('Finish time minutes'), { target: { value: '17' } })
    fireEvent.change(screen.getByLabelText('Finish time seconds'), { target: { value: '42' } })
    expect(val().time).toBe('17:42')
    fireEvent.click(screen.getByRole('radio', { name: /time capped/i }))
    expect(val().time).toBe('')            // stale finish time dropped
    fireEvent.change(screen.getByLabelText('Rounds completed'), { target: { value: '2' } })
    expect(val().roundsCompleted).toBe('2')
    expect(val().time).toBe('')            // still no time in the capped payload
  })

  it('Time Capped -> Finished CLEARS rounds + partial reps (no stale capped work)', () => {
    render(<Harness def={def} movements={['12 Wall Ball', '21 Power Clean']} />)
    fireEvent.click(screen.getByRole('radio', { name: /time capped/i }))
    fireEvent.change(screen.getByLabelText('Rounds completed'), { target: { value: '2' } })
    fireEvent.change(screen.getByLabelText('12 Wall Ball reps'), { target: { value: '9' } })
    expect(val().roundsCompleted).toBe('2')
    fireEvent.click(screen.getByRole('radio', { name: /finished/i }))
    expect(val().roundsCompleted).toBe('')
    expect(val().partialReps).toEqual([])
    fireEvent.change(screen.getByLabelText('Finish time minutes'), { target: { value: '18' } })
    expect(val().time).toBe('18:00')
  })

  it('shows the time-cap value and per-movement partial rows in capped mode', () => {
    render(<Harness def={{ ...def }} movements={['12 Wall Ball', '32 Cal Row']} />)
    fireEvent.click(screen.getByRole('radio', { name: /time capped/i }))
    expect(screen.getByText(/time cap: 20:00/i)).toBeInTheDocument()
    expect(screen.getByLabelText('12 Wall Ball reps')).toBeInTheDocument()
    expect(screen.getByLabelText('32 Cal Row reps')).toBeInTheDocument()
  })

  it('a capped-shaped edit opens on Time Capped', () => {
    render(<Harness def={def} movements={['12 Wall Ball']} initial={{ roundsCompleted: '2', partialReps: ['43'] }} />)
    expect(screen.getByRole('radio', { name: /time capped/i })).toHaveAttribute('aria-checked', 'true')
  })
})

describe('P9.5 — UniversalScoreInput · other kinds', () => {
  it('ROUNDS_REPS: rounds + per-movement partial reps', () => {
    render(<Harness def={scoreDefinitionFor('AMRAP', { durationSec: 900 })} movements={['10 Pull-up', '15 Push-up']} />)
    fireEvent.change(screen.getByLabelText('Rounds'), { target: { value: '7' } })
    fireEvent.change(screen.getByLabelText('10 Pull-up reps'), { target: { value: '6' } })
    expect(val().roundsCompleted).toBe('7')
    expect(val().partialReps).toEqual(['6'])
  })

  it('REPS: integer only', () => {
    render(<Harness def={{ kind: 'REPS', integer: true }} />)
    const input = screen.getByLabelText('Result')
    fireEvent.focus(input)
    fireEvent.change(input, { target: { value: '87' } })
    fireEvent.blur(input)
    expect(val().result).toBe('87')
    fireEvent.focus(input)
    fireEvent.change(input, { target: { value: '87,5' } })
    fireEvent.blur(input)
    expect(val().result).toBe('87')          // decimal rejected for reps
  })

  it('LOAD: comma decimal 102,5 -> 102.5 (P9.2 preserved)', () => {
    render(<Harness def={{ kind: 'LOAD', unit: 'kg' }} />)
    const input = screen.getByLabelText('Result')
    fireEvent.focus(input)
    fireEvent.change(input, { target: { value: '102,5' } })
    fireEvent.blur(input)
    expect(val().result).toBe('102.5')
  })

  it('CALORIES: integer + "Cal" suffix', () => {
    render(<Harness def={{ kind: 'CALORIES', unit: 'cal', integer: true }} />)
    expect(screen.getByText('Cal')).toBeInTheDocument()
    const input = screen.getByLabelText('Result')
    fireEvent.focus(input); fireEvent.change(input, { target: { value: '142' } }); fireEvent.blur(input)
    expect(val().result).toBe('142')
  })

  it('NONE: a completion checkbox, no score fields', () => {
    render(<Harness def={{ kind: 'NONE' }} />)
    expect(screen.queryByLabelText('Result')).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('checkbox'))
    expect(val().completed).toBe(true)
  })

  it('SETS delegates to FormatLogger (existing tested component) without crashing', () => {
    render(<Harness def={{ kind: 'SETS' }} formatId="Weightlifting" movements={['Snatch']} />)
    // FormatLogger's sets-family renders "+ set" affordances.
    expect(screen.getByText(/\+ ?set/i)).toBeInTheDocument()
  })

  it('prescribed weight -> a Weight field with an RX badge appears', () => {
    render(<Harness def={{ kind: 'REPS', integer: true }} prescribedWeight="60" />)
    expect(screen.getByLabelText('Weight')).toBeInTheDocument()
    expect(screen.getByText('Not Rx')).toBeInTheDocument()
  })
})
