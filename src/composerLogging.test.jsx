// FORGE WORKOUT COMPOSER - PHASE 4: React multi-scorer logger UI tests.
// Renders the REAL MultiScorerLogger/ScorerEnvelopeFields together with the
// REAL UniversalScoreInput/FormatLogger's MultiMovementPartialRows (not
// stubs) - native format engines are proven reused, not reimplemented.

import { useState } from 'react'
import { describe, it, expect, afterEach } from 'vitest'
import { render, screen, cleanup, fireEvent } from '@testing-library/react'
import MultiScorerLogger from './composerLogging'
import { createComponent, addComponentToList, setScoreOwner, getOrderedScoreEnvelopes, emptyScorerLoggerValue } from './componentContract'
import { newMovementInstance } from './prescriptionContract'

afterEach(cleanup)

function inst(name) { return newMovementInstance({ name }) }

const t = {}

function ownedEnvelope() {
  let c = addComponentToList([], 'Once', 'buy-in')
  c = c.map(x => ({ ...x, instances: [inst('1000m Row')] }))
  c = addComponentToList(c, 'RFT')
  c[1].config = { rounds: 5 }
  c[1].instances = [inst('Toes-to-Bar'), inst('Wall Balls')]
  c = addComponentToList(c, 'Once', 'cash-out')
  c[2].instances = [inst('800m Run')]
  c = setScoreOwner(c, c[0].id, c[1].id).components
  c = setScoreOwner(c, c[2].id, c[1].id).components
  return c
}

function twoScorers() {
  const amrap = createComponent({ id: 'amrap', format: 'AMRAP', producesScore: true, config: { durationSec: 480 }, instances: [inst('Pull-Ups')] })
  const rest = createComponent({ id: 'rest', format: 'Rest', producesScore: false, config: { durationSec: 120 } })
  const rft = createComponent({ id: 'rft', format: 'RFT', producesScore: true, config: { rounds: 5 }, instances: [inst('Wall Balls')] })
  return [amrap, rest, rft].map((c, i) => ({ ...c, order: i }))
}

function threeScorers() {
  const amrap = createComponent({ id: 'amrap', format: 'AMRAP', producesScore: true, config: { durationSec: 480 }, instances: [inst('Pull-Ups')] })
  const rest1 = createComponent({ id: 'rest1', format: 'Rest', producesScore: false, config: { durationSec: 120 } })
  const rft = createComponent({ id: 'rft', format: 'RFT', producesScore: true, config: { rounds: 5 }, instances: [inst('Wall Balls')] })
  const rest2 = createComponent({ id: 'rest2', format: 'Rest', producesScore: false, config: { durationSec: 60 } })
  const emom = createComponent({ id: 'emom', format: 'EMOM', producesScore: true, config: { totalRounds: 8, intervalSec: 60 }, instances: [inst('Bike Calories')] })
  return [amrap, rest1, rft, rest2, emom].map((c, i) => ({ ...c, order: i }))
}

function Harness({ components, initialStep = 0 }) {
  const envelopes = getOrderedScoreEnvelopes(components)
  const [values, setValues] = useState(Object.fromEntries(envelopes.map(e => [e.scorer.id, emptyScorerLoggerValue()])))
  const [step, setStep] = useState(initialStep)
  return (
    <MultiScorerLogger envelopes={envelopes} valuesByComponentId={values} step={step} onStepChange={setStep}
      onChangeComponent={(id, next) => setValues(v => ({ ...v, [id]: next }))}
      weightUnit="kg" t={t} gender={null} />
  )
}

// --- One-score parity (ticket §7) -------------------------------------------

describe('one-score parity - no stepper chrome for a single envelope', () => {
  it('a single AMRAP renders with no "Score 1 of 1" and no Back/Next', () => {
    const amrap = [createComponent({ id: 'amrap', format: 'AMRAP', producesScore: true, config: { durationSec: 600 }, instances: [inst('Burpees')] })]
    render(<Harness components={amrap} />)
    expect(screen.queryByText(/SCORE 1 OF/i)).not.toBeInTheDocument()
    expect(screen.queryByText('Back')).not.toBeInTheDocument()
    expect(screen.queryByText('Next')).not.toBeInTheDocument()
    expect(screen.getByText('AMRAP · 10:00')).toBeInTheDocument()
  })
})

// --- Owned envelope -> ONE logger (ticket §8) -------------------------------

describe('owned envelope renders as ONE logger, not separate Buy-In/Cash-Out scores', () => {
  it('Buy-In and Cash-Out rows render alongside the scorer\'s own native input, no stepper', () => {
    render(<Harness components={ownedEnvelope()} />)
    expect(screen.queryByText(/SCORE 1 OF/i)).not.toBeInTheDocument()
    expect(screen.getByText('BUY-IN')).toBeInTheDocument()
    expect(screen.getByText('1000m Row')).toBeInTheDocument()
    expect(screen.getByText('CASH-OUT')).toBeInTheDocument()
    expect(screen.getByText('800m Run')).toBeInTheDocument()
    expect(screen.getByText('5 ROUNDS FOR TIME')).toBeInTheDocument()
  })

  it('entering Buy-In reps writes into that component\'s own scorer draft (sets.__buyIn), and the input reflects it back', () => {
    render(<Harness components={ownedEnvelope()} />)
    const buyInInput = screen.getAllByPlaceholderText('reps')[0]
    fireEvent.change(buyInInput, { target: { value: '1000' } })
    // Controlled input round-trip through onChangeComponent -> setState ->
    // re-render proves the value landed in that scorer's own draft (the
    // ONLY thing MultiMovementPartialRows' row input reflects back).
    expect(buyInInput).toHaveValue(1000)
  })
})

// --- Two/three-score stepper (ticket §9/§10) --------------------------------

describe('two-score WOD exposes exactly two steps, Rest produces no step', () => {
  it('AMRAP/Rest/RFT -> "SCORE 1 OF 2" then "SCORE 2 OF 2", never a Rest step', () => {
    render(<Harness components={twoScorers()} />)
    expect(screen.getByText('SCORE 1 OF 2')).toBeInTheDocument()
    expect(screen.getByText('AMRAP · 8:00')).toBeInTheDocument()
    expect(screen.queryByText(/REST/)).not.toBeInTheDocument()
    fireEvent.click(screen.getByText('Next'))
    expect(screen.getByText('SCORE 2 OF 2')).toBeInTheDocument()
    expect(screen.getByText('5 ROUNDS FOR TIME')).toBeInTheDocument()
  })
})

describe('three-score WOD exposes exactly three steps, no fourth "overall" step', () => {
  it('AMRAP/Rest/RFT/Rest/EMOM -> steps 1-3 only, never a 4th', () => {
    render(<Harness components={threeScorers()} />)
    expect(screen.getByText('SCORE 1 OF 3')).toBeInTheDocument()
    fireEvent.click(screen.getByText('Next'))
    expect(screen.getByText('SCORE 2 OF 3')).toBeInTheDocument()
    expect(screen.getByText('5 ROUNDS FOR TIME')).toBeInTheDocument()
    fireEvent.click(screen.getByText('Next'))
    expect(screen.getByText('SCORE 3 OF 3')).toBeInTheDocument()
    expect(screen.getByText('EMOM 8')).toBeInTheDocument()
    expect(screen.queryByText('Next')).not.toBeInTheDocument() // last step, no further Next
  })
})

// --- Fixture H: Back/Next state preservation (ticket §21/§38) --------------

describe('fixture H - Back/Next preserves entered state, no remount/reset loss', () => {
  it('enter score 1 -> Next -> enter score 2 -> Back -> score 1 still present -> Next -> score 2 still present', () => {
    render(<Harness components={twoScorers()} />)
    // Step 1: AMRAP - enter rounds completed
    fireEvent.change(screen.getByLabelText('Rounds completed'), { target: { value: '6' } })
    fireEvent.click(screen.getByText('Next'))
    // Step 2: RFT (no time cap configured -> plain Time input, not the
    // Finished/Did-not-finish toggle's "Finish time" variant)
    expect(screen.getByText('SCORE 2 OF 2')).toBeInTheDocument()
    fireEvent.change(screen.getByLabelText('Time minutes'), { target: { value: '12' } })
    fireEvent.change(screen.getByLabelText('Time seconds'), { target: { value: '41' } })
    // Back to step 1 - AMRAP's rounds must still be there
    fireEvent.click(screen.getByText('Back'))
    expect(screen.getByText('SCORE 1 OF 2')).toBeInTheDocument()
    expect(screen.getByLabelText('Rounds completed').value).toBe('6')
    // Forward again - RFT's time must still be there
    fireEvent.click(screen.getByText('Next'))
    expect(screen.getByLabelText('Time minutes').value).toBe('12')
    expect(screen.getByLabelText('Time seconds').value).toBe('41')
  })
})

// --- Fixture D: owned envelope + independent scorer -------------------------

describe('fixture D - owned envelope + independent AMRAP -> 2 steps, not 3', () => {
  it('Buy-In/Cash-Out never become their own step', () => {
    const envelope = ownedEnvelope()
    const rest = createComponent({ format: 'Rest', producesScore: false, config: { durationSec: 120 } })
    const amrap = createComponent({ id: 'amrap-indep', format: 'AMRAP', producesScore: true, config: { durationSec: 360 }, instances: [inst('Clean & Jerks')] })
    const components = [...envelope, rest, amrap].map((c, i) => ({ ...c, order: i }))
    render(<Harness components={components} />)
    expect(screen.getByText('SCORE 1 OF 2')).toBeInTheDocument()
    expect(screen.getByText('BUY-IN')).toBeInTheDocument()
    fireEvent.click(screen.getByText('Next'))
    expect(screen.getByText('SCORE 2 OF 2')).toBeInTheDocument()
    expect(screen.queryByText('BUY-IN')).not.toBeInTheDocument()
    expect(screen.getByText('AMRAP · 6:00')).toBeInTheDocument()
  })
})

// --- No component -----------------------------------------------------------

describe('no envelopes at all', () => {
  it('renders nothing for an empty envelope list', () => {
    const { container } = render(<Harness components={[createComponent({ format: 'Rest', producesScore: false })]} />)
    expect(container.firstChild).toBeNull()
  })
})
