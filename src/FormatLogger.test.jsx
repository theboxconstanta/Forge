import { describe, it, expect, afterEach, vi } from 'vitest'
import { render, screen, cleanup, fireEvent } from '@testing-library/react'
import FormatLogger, { PrCandidatesConfirm } from './FormatLogger'

afterEach(() => {
  cleanup()
})

describe('FormatLogger - family sets (EMOM)', () => {
  it('editarea reps pe un rând păstrează celelalte rânduri neatinse (nu le suprascrie cu index-uri)', () => {
    const onChange = vi.fn()
    render(
      <FormatLogger formatId="EMOM" config={{ totalRounds: 2, intervalSec: 60 }} movements={[]}
        value={{}} onChange={onChange} weightUnit="kg" t={{}} />
    )
    const repsInputs = screen.getAllByPlaceholderText('reps')
    expect(repsInputs).toHaveLength(2)
    fireEvent.change(repsInputs[0], { target: { value: '12' } })

    expect(onChange).toHaveBeenCalledTimes(1)
    const patch = onChange.mock.calls[0][0]
    expect(patch.sets['Min 1'][0].reps).toBe('12')
    expect(patch.sets['Min 2']).toEqual([{ weight: '', reps: '', completed: false }])
  })

  it('adaugă un rând nou fără să șteargă rândurile existente ale altei chei', () => {
    const onChange = vi.fn()
    render(
      <FormatLogger formatId="EMOM" config={{ totalRounds: 2, intervalSec: 60 }} movements={[]}
        value={{}} onChange={onChange} weightUnit="kg" t={{}} />
    )
    const addButtons = screen.getAllByText('+ set')
    fireEvent.click(addButtons[0])
    const patch = onChange.mock.calls[0][0]
    expect(patch.sets['Min 1']).toHaveLength(2)
    expect(patch.sets['Min 2']).toHaveLength(1)
  })
})

describe('FormatLogger - Tabata (simpleReps: un singur input de reps per rundă)', () => {
  it('nu are câmp de greutate și nu are buton de adăugat set', () => {
    render(
      <FormatLogger formatId="Tabata" config={{ rounds: 2 }} movements={[]}
        value={{}} onChange={() => {}} weightUnit="kg" t={{}} />
    )
    expect(screen.getAllByPlaceholderText('reps')).toHaveLength(2)
    expect(screen.queryByPlaceholderText('kg')).not.toBeInTheDocument()
    expect(screen.queryByText('+ set')).not.toBeInTheDocument()
  })
  it('editarea reps pe o rundă păstrează celelalte runde neatinse', () => {
    const onChange = vi.fn()
    render(
      <FormatLogger formatId="Tabata" config={{ rounds: 2 }} movements={[]}
        value={{}} onChange={onChange} weightUnit="kg" t={{}} />
    )
    const repsInputs = screen.getAllByPlaceholderText('reps')
    fireEvent.change(repsInputs[0], { target: { value: '15' } })
    const patch = onChange.mock.calls[0][0]
    expect(patch.sets['Rundă 1'][0].reps).toBe('15')
    expect(patch.sets['Rundă 2']).toEqual([{ weight: '', reps: '', completed: false }])
  })
})

describe('FormatLogger - family sets cu targetReps și scoringMode', () => {
  it('Strength Sets afișează ținta de reps ca hint lângă input', () => {
    render(
      <FormatLogger formatId="Strength Sets" config={{ setsScheme: [5, 3, 1] }} movements={['Back Squat']}
        value={{}} onChange={() => {}} weightUnit="kg" t={{}} />
    )
    expect(screen.getByText('/ 5')).toBeInTheDocument()
    expect(screen.getByText('/ 3')).toBeInTheDocument()
    expect(screen.getByText('/ 1')).toBeInTheDocument()
  })

  it('Tabata cu scoringMode afișează scorul calculat din rândurile logate', () => {
    const value = { sets: { 'Rundă 1': [{ reps: '10' }], 'Rundă 2': [{ reps: '8' }] } }
    render(
      <FormatLogger formatId="Tabata" config={{ rounds: 2, scoringMode: 'Lowest Reps' }} movements={[]}
        value={value} onChange={() => {}} weightUnit="kg" t={{}} />
    )
    expect(screen.getByText(/Cea mai slabă rundă: 8/)).toBeInTheDocument()
  })
})

describe('FormatLogger - family scored (AMRAP)', () => {
  it('afișează runde + reps parțiale pentru mișcările date', () => {
    render(<FormatLogger formatId="AMRAP" config={{}} movements={['Pull-ups']} value={{}} onChange={() => {}} t={{}} />)
    expect(screen.getByPlaceholderText('0')).toBeInTheDocument()
  })
})

describe('FormatLogger - family mixed (Buy-In/Cash-Out)', () => {
  it('editarea buy-in nu afectează cash-out', () => {
    const onChange = vi.fn()
    render(
      <FormatLogger formatId="Buy-In/Cash-Out" config={{ buyIn: ['Row'], cashOut: ['Burpees'] }} movements={[]}
        value={{}} onChange={onChange} weightUnit="kg" t={{}} />
    )
    const repsInputs = screen.getAllByPlaceholderText('reps')
    fireEvent.change(repsInputs[0], { target: { value: '20' } })
    const patch = onChange.mock.calls[0][0]
    expect(patch.sets.__buyIn[0].reps).toBe('20')
    expect(patch.sets.__cashOut).toBeUndefined()
  })
})

describe('FormatLogger - family mixed (AMRAP with Buy-In, fără Cash-Out)', () => {
  it('nu randeaza sectiunea Cash-Out cand config nu are cashOut', () => {
    render(
      <FormatLogger formatId="AMRAP with Buy-In" config={{ totalDurationSec: 1200, buyIn: ['Row 1000m'] }} movements={['Burpees']}
        value={{}} onChange={() => {}} weightUnit="kg" t={{}} />
    )
    expect(screen.queryByText('Cash-Out')).not.toBeInTheDocument()
    expect(screen.getByText('Buy-In')).toBeInTheDocument()
    expect(screen.getByText('Main Work')).toBeInTheDocument()
    // family 'mixed' cu scoreMode 'amrap' de la format -> ScoredFields randeaza runde complete
    expect(screen.getByText('Runde complete')).toBeInTheDocument()
  })
})

describe('FormatLogger - family nft', () => {
  it('randează un checkbox de completat', () => {
    const onChange = vi.fn()
    render(<FormatLogger formatId="Not For Time" config={{}} movements={[]} value={{}} onChange={onChange} t={{}} />)
    fireEvent.click(screen.getByRole('checkbox'))
    expect(onChange).toHaveBeenCalledWith(expect.objectContaining({ completed: true }))
  })
})

describe('PrCandidatesConfirm', () => {
  it('nu randeaza nimic fara candidati', () => {
    const { container } = render(<PrCandidatesConfirm candidates={null} onDismiss={() => {}} onConfirm={() => {}} onDone={() => {}} t={{}} />)
    expect(container).toBeEmptyDOMElement()
  })

  it('cheama onConfirm cu candidatul corect', () => {
    const onConfirm = vi.fn()
    render(<PrCandidatesConfirm candidates={[{ reps: 5, weight: 60, unit: 'kg' }]} onDismiss={() => {}} onConfirm={onConfirm} onDone={() => {}} t={{}} />)
    fireEvent.click(screen.getByText('salvează ca PR'))
    expect(onConfirm).toHaveBeenCalledWith({ reps: 5, weight: 60, unit: 'kg' })
  })
})
