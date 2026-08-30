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
  const [value, setValue] = useState({ result: '', time: '', roundsCompleted: '', additionalReps: '', partialReps: [], sets: {}, completed: false, weightLogged: '', stages: [], ...initial })
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

  it('§13 — only one mode is shown at a time (never time AND rounds/reps together)', () => {
    render(<Harness def={def} movements={['12 Wall Ball']} />)
    expect(screen.getByLabelText('Finish time minutes')).toBeInTheDocument()
    expect(screen.queryByLabelText('Rounds completed')).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('radio', { name: /time capped/i }))
    expect(screen.queryByLabelText('Finish time minutes')).not.toBeInTheDocument()
    expect(screen.getByLabelText('Rounds completed')).toBeInTheDocument()
    expect(screen.getByLabelText('Additional reps')).toBeInTheDocument()
  })

  it('§14 — Finished -> Time Capped CLEARS the finish time (no stale time in payload)', () => {
    render(<Harness def={def} movements={['12 Wall Ball']} />)
    fireEvent.change(screen.getByLabelText('Finish time minutes'), { target: { value: '17' } })
    fireEvent.change(screen.getByLabelText('Finish time seconds'), { target: { value: '42' } })
    expect(val().time).toBe('17:42')
    fireEvent.click(screen.getByRole('radio', { name: /time capped/i }))
    expect(val().time).toBe('')
    const rounds = screen.getByLabelText('Rounds completed')
    fireEvent.focus(rounds); fireEvent.change(rounds, { target: { value: '2' } }); fireEvent.blur(rounds)
    const add = screen.getByLabelText('Additional reps')
    fireEvent.focus(add); fireEvent.change(add, { target: { value: '43' } }); fireEvent.blur(add)
    expect(val().roundsCompleted).toBe('2')
    expect(val().additionalReps).toBe('43')
    expect(val().time).toBe('')
  })

  it('§14 — Time Capped -> Finished CLEARS rounds + additional reps (no stale capped work)', () => {
    render(<Harness def={def} movements={['12 Wall Ball']} />)
    fireEvent.click(screen.getByRole('radio', { name: /time capped/i }))
    const rounds = screen.getByLabelText('Rounds completed')
    fireEvent.focus(rounds); fireEvent.change(rounds, { target: { value: '2' } }); fireEvent.blur(rounds)
    const add = screen.getByLabelText('Additional reps')
    fireEvent.focus(add); fireEvent.change(add, { target: { value: '43' } }); fireEvent.blur(add)
    expect(val().roundsCompleted).toBe('2')
    fireEvent.click(screen.getByRole('radio', { name: /finished/i }))
    expect(val().roundsCompleted).toBe('')
    expect(val().additionalReps).toBe('')
    fireEvent.change(screen.getByLabelText('Finish time minutes'), { target: { value: '18' } })
    expect(val().time).toBe('18:00')
  })

  it('shows the time-cap value, no calculation/formula/leaderboard text (§4)', () => {
    render(<Harness def={{ ...def }} movements={['12 Wall Ball', '32 Cal Row']} />)
    fireEvent.click(screen.getByRole('radio', { name: /time capped/i }))
    expect(screen.getByText(/time cap: 20:00/i)).toBeInTheDocument()
    expect(screen.queryByText(/calculated automatically/i)).not.toBeInTheDocument()
    expect(screen.queryByText(/total work/i)).not.toBeInTheDocument()
    expect(screen.queryByText(/×|leaderboard/i)).not.toBeInTheDocument()
    // no per-movement partial-reps rows
    expect(screen.queryByLabelText('12 Wall Ball reps')).not.toBeInTheDocument()
  })

  it('a capped-shaped edit draft opens on Time Capped', () => {
    render(<Harness def={def} movements={['12 Wall Ball']} initial={{ roundsCompleted: '2', additionalReps: '43' }} />)
    expect(screen.getByRole('radio', { name: /time capped/i })).toHaveAttribute('aria-checked', 'true')
  })
})

describe('P9.5 — UniversalScoreInput · other kinds', () => {
  it('ROUNDS_REPS (AMRAP): rounds completed + a single additional-reps field, no per-movement rows', () => {
    render(<Harness def={scoreDefinitionFor('AMRAP', { durationSec: 900 })} movements={['10 Pull-up', '15 Push-up']} />)
    const rounds = screen.getByLabelText('Rounds completed')
    fireEvent.focus(rounds); fireEvent.change(rounds, { target: { value: '7' } }); fireEvent.blur(rounds)
    const add = screen.getByLabelText('Additional reps')
    fireEvent.focus(add); fireEvent.change(add, { target: { value: '12' } }); fireEvent.blur(add)
    expect(val().roundsCompleted).toBe('7')
    expect(val().additionalReps).toBe('12')
    expect(screen.queryByLabelText('10 Pull-up reps')).not.toBeInTheDocument()
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
