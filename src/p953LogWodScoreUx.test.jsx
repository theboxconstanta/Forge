import { describe, it, expect, afterEach } from 'vitest'
import { render, screen, fireEvent, cleanup } from '@testing-library/react'
import { useState } from 'react'
import UniversalScoreInput from './UniversalScoreInput'
import { scoreDefinitionFor } from './scoreDefinition'

afterEach(cleanup)

// P9.5.3 — LOG WOD SCORE UX OWNER ACCEPTANCE FIX
//
// Owner's exact case (wod addce155, 2026-08-30):
//   RFT · duration "20:00" · format_config { rounds: 3 }
//   12 Wall Ball @ 9/6 · 21 Power Clean @ 61/43 · 32/43 Cal Row ·
//   Alternating Dumbbell Power Snatch @ 22.5/15 · 12 Push-up
//   -> structured movement_prescriptions (per-movement loads)
//
// Findings:
//  1. the global "Weight" field appeared inside YOUR SCORE (redundant — loads
//     are per-movement + editable via the P9.5.2 Edit flow)
//  2. no "Finished / Did not finish" choice — because the 20:00 cap lives in
//     wods.duration, NOT format_config.timeCapSec, so scoreDefinitionFor
//     returned TIME instead of TIME_CAPPED.

const OWNER_MOVEMENTS = ['12 Wall Ball', '21 Power Clean', '32 Cal Row', 'Alternating Dumbbell Power Snatch', '12 Push-up']

// The App.jsx logWodPrimaryPath call, reproduced: RFT + config { rounds: 3 } +
// the canonical stated time (timeToSec("20:00") = 1200).
const ownerDef = () => scoreDefinitionFor('RFT', { rounds: 3 }, { legacyDurationSec: 1200 })

function Harness({ def, movements = [], prescribedWeight = '', initial = {} }) {
  const [value, setValue] = useState({ result: '', time: '', roundsCompleted: '', additionalReps: '', partialReps: [], sets: {}, completed: false, weightLogged: '', stages: [], ...initial })
  return (
    <>
      <UniversalScoreInput def={def} formatId="RFT" config={{ rounds: 3 }} movements={movements}
        prescribedWeight={prescribedWeight} rxStatus={prescribedWeight ? 'not_rx' : null}
        value={value} onChange={setValue} weightUnit="kg" t={{}} />
      <pre data-testid="value">{JSON.stringify(value)}</pre>
    </>
  )
}
const val = () => JSON.parse(screen.getByTestId('value').textContent)

describe('P9.5.3 §11/§12 — the cap in wods.duration reaches scoreDefinition', () => {
  it("owner's RFT (cap only in wods.duration) resolves to TIME_CAPPED", () => {
    const d = ownerDef()
    expect(d.kind).toBe('TIME_CAPPED')
    expect(d.timeCapSec).toBe(1200)
    expect(d.roundsKnown).toBe(3)
    expect(d.sequential).toBe(false)
  })
})

describe('P9.5.3 §35 — structured programmed metcon Log WOD score UX', () => {
  it('shows NO global Weight field (App passes prescribedWeight="" for a structured metcon)', () => {
    render(<Harness def={ownerDef()} movements={OWNER_MOVEMENTS} prescribedWeight="" />)
    expect(screen.queryByLabelText('Weight')).not.toBeInTheDocument()
    expect(screen.queryByText('Not Rx')).not.toBeInTheDocument()
  })

  it('shows the Finished / Did not finish selector', () => {
    render(<Harness def={ownerDef()} movements={OWNER_MOVEMENTS} prescribedWeight="" />)
    expect(screen.getByRole('radio', { name: /finished/i })).toBeInTheDocument()
    expect(screen.getByRole('radio', { name: /did not finish/i })).toBeInTheDocument()
    // "Time Capped" copy is gone from the selector (owner §5)
    expect(screen.queryByRole('radio', { name: /time capped/i })).not.toBeInTheDocument()
  })

  it('§36 Finished -> only the time input; rounds / additional reps hidden', () => {
    render(<Harness def={ownerDef()} movements={OWNER_MOVEMENTS} prescribedWeight="" />)
    expect(screen.getByRole('radio', { name: /finished/i })).toHaveAttribute('aria-checked', 'true')
    expect(screen.getByLabelText('Finish time minutes')).toBeInTheDocument()
    expect(screen.queryByLabelText('Rounds completed')).not.toBeInTheDocument()
    expect(screen.queryByLabelText('Additional reps')).not.toBeInTheDocument()
    fireEvent.change(screen.getByLabelText('Finish time minutes'), { target: { value: '17' } })
    fireEvent.change(screen.getByLabelText('Finish time seconds'), { target: { value: '42' } })
    expect(val().time).toBe('17:42')
    expect(val().roundsCompleted).toBe('')
    expect(val().additionalReps).toBe('')
  })

  it('§37 Did not finish -> rounds + additional reps + time-cap reminder; time input hidden', () => {
    render(<Harness def={ownerDef()} movements={OWNER_MOVEMENTS} prescribedWeight="" />)
    fireEvent.click(screen.getByRole('radio', { name: /did not finish/i }))
    expect(screen.queryByLabelText('Finish time minutes')).not.toBeInTheDocument()
    const rounds = screen.getByLabelText('Rounds completed')
    const add = screen.getByLabelText('Additional reps')
    expect(rounds).toBeInTheDocument()
    expect(add).toBeInTheDocument()
    expect(screen.getByText(/time cap: 20:00/i)).toBeInTheDocument()
    // no per-movement partial rows for a non-sequential RFT
    expect(screen.queryByLabelText('12 Wall Ball reps')).not.toBeInTheDocument()
    // no calculation / total-reps / formula text (owner §22)
    expect(screen.queryByText(/calculated automatically/i)).not.toBeInTheDocument()
    expect(screen.queryByText(/total work|total reps/i)).not.toBeInTheDocument()
    expect(screen.queryByText(/×/)).not.toBeInTheDocument()
    fireEvent.focus(rounds); fireEvent.change(rounds, { target: { value: '2' } }); fireEvent.blur(rounds)
    fireEvent.focus(add); fireEvent.change(add, { target: { value: '43' } }); fireEvent.blur(add)
    expect(val().roundsCompleted).toBe('2')
    expect(val().additionalReps).toBe('43')
    expect(val().time).toBe('')
  })

  it('§38 toggle both directions — no stale field leakage', () => {
    render(<Harness def={ownerDef()} movements={OWNER_MOVEMENTS} prescribedWeight="" />)
    fireEvent.change(screen.getByLabelText('Finish time minutes'), { target: { value: '17' } })
    fireEvent.change(screen.getByLabelText('Finish time seconds'), { target: { value: '42' } })
    expect(val().time).toBe('17:42')
    fireEvent.click(screen.getByRole('radio', { name: /did not finish/i }))
    expect(val().time).toBe('')
    const rounds = screen.getByLabelText('Rounds completed')
    fireEvent.focus(rounds); fireEvent.change(rounds, { target: { value: '2' } }); fireEvent.blur(rounds)
    const add = screen.getByLabelText('Additional reps')
    fireEvent.focus(add); fireEvent.change(add, { target: { value: '43' } }); fireEvent.blur(add)
    expect(val()).toMatchObject({ time: '', roundsCompleted: '2', additionalReps: '43' })
    fireEvent.click(screen.getByRole('radio', { name: /finished/i }))
    expect(val().roundsCompleted).toBe('')
    expect(val().additionalReps).toBe('')
  })
})

describe('P9.5.3 §9/§10/§42 — Weight is NOT globally removed', () => {
  it('a legacy workout (App passes the legacy weight value) still shows the Weight field', () => {
    render(<Harness def={scoreDefinitionFor('RFT', { rounds: 3 }, { legacyDurationSec: 1200 })} movements={['21 Thruster']} prescribedWeight="43" />)
    expect(screen.getByLabelText('Weight')).toBeInTheDocument()
    expect(screen.getByText('Not Rx')).toBeInTheDocument()
  })

  it('§41 a LOAD-scored workout keeps its kg Result input', () => {
    render(<Harness def={{ kind: 'LOAD', unit: 'kg' }} movements={['Back Squat']} prescribedWeight="" />)
    const input = screen.getByLabelText('Result')
    fireEvent.focus(input); fireEvent.change(input, { target: { value: '100' } }); fireEvent.blur(input)
    expect(val().result).toBe('100')
    expect(screen.getByText('kg')).toBeInTheDocument()
  })
})

describe('P9.5.3 §14 — For Time with no cap at all: no selector', () => {
  it('RFT with neither format cap nor stated duration stays a plain time input', () => {
    const d = scoreDefinitionFor('RFT', { rounds: 3 }, {})
    expect(d.kind).toBe('TIME')
    render(<Harness def={d} movements={OWNER_MOVEMENTS} prescribedWeight="" />)
    expect(screen.queryByRole('radio', { name: /finished/i })).not.toBeInTheDocument()
    expect(screen.getByLabelText('Time minutes')).toBeInTheDocument()
  })
})
