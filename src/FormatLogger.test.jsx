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
  it('Buy-In/Cash-Out nu au câmp de greutate și nu au buton de adăugat set (sarcini o singură dată)', () => {
    render(
      <FormatLogger formatId="Buy-In/Cash-Out" config={{ buyIn: ['Row'], cashOut: ['Burpees'] }} movements={[]}
        value={{}} onChange={() => {}} weightUnit="kg" t={{}} />
    )
    expect(screen.queryByPlaceholderText('kg')).not.toBeInTheDocument()
    expect(screen.queryByText('+ set')).not.toBeInTheDocument()
  })
})

describe('FormatLogger - Partner WOD respectă baseFormat', () => {
  it('baseFormat AMRAP randeaza doar runde + reps partiale, fara campuri de timp', () => {
    render(
      <FormatLogger formatId="Partner WOD" config={{ baseFormat: 'AMRAP' }} movements={['Wall Balls']}
        value={{}} onChange={() => {}} t={{}} />
    )
    expect(screen.getByText('Runde complete')).toBeInTheDocument()
    expect(screen.queryByText('Timp')).not.toBeInTheDocument()
  })
  it('baseFormat For Time randeaza timp + optiunea de runde partiale (nu a terminat)', () => {
    render(
      <FormatLogger formatId="Partner WOD" config={{ baseFormat: 'For Time' }} movements={['Wall Balls']}
        value={{}} onChange={() => {}} t={{}} />
    )
    expect(screen.getByText('Timp')).toBeInTheDocument()
    expect(screen.getByText('Runde complete')).toBeInTheDocument()
  })
  it('fara baseFormat setat, cade pe fortime_or_amrap (comportament vechi)', () => {
    render(
      <FormatLogger formatId="Partner WOD" config={{}} movements={['Wall Balls']}
        value={{}} onChange={() => {}} t={{}} />
    )
    expect(screen.getByText('Timp')).toBeInTheDocument()
    expect(screen.getByText('Runde complete')).toBeInTheDocument()
  })
})

// LEADERBOARD_FINISH_TIME_INVESTIGATION.md - Timp si Runde complete erau
// afisate simultan la RFT/For Time (Repeated Rounds)/Partner WOD, un membru
// care termina putea completa firesc ambele si pierdea silentios Timpul la
// salvare (vezi App.jsx composeWodLogFields / shouldLogRoundsInsteadOfTime).
// Mutual exclusivitate reala in UI: campul de Runde complete dispare de
// indata ce Timpul are o valoare, ca cele doua cai sa nu mai poata fi
// completate contradictoriu.
describe('FormatLogger - RFT: Timp si Runde complete se exclud reciproc', () => {
  it('nimic completat -> ambele campuri vizibile (starea initiala)', () => {
    render(
      <FormatLogger formatId="RFT" config={{ rounds: 5 }} movements={['Pull-ups']}
        value={{}} onChange={() => {}} t={{}} />
    )
    expect(screen.getByText('Timp')).toBeInTheDocument()
    expect(screen.getByText('Runde complete')).toBeInTheDocument()
  })
  it('doar Runde completate (capped/neterminat) -> Timp ramane vizibil, Runde ramane vizibil', () => {
    render(
      <FormatLogger formatId="RFT" config={{ rounds: 5 }} movements={['Pull-ups']}
        value={{ roundsCompleted: '4' }} onChange={() => {}} t={{}} />
    )
    expect(screen.getByText('Timp')).toBeInTheDocument()
    expect(screen.getByText('Runde complete')).toBeInTheDocument()
  })
  it('Timp completat -> Runde complete dispare complet din UI (nu doar hint text)', () => {
    render(
      <FormatLogger formatId="RFT" config={{ rounds: 5 }} movements={['Pull-ups']}
        value={{ time: '18:42' }} onChange={() => {}} t={{}} />
    )
    expect(screen.getByText('Timp')).toBeInTheDocument()
    expect(screen.queryByText('Runde complete')).not.toBeInTheDocument()
  })
  it('trece de la "Runde completate" la "Timp SI Runde completate" -> Runde dispare la re-render (fara sa piarda valoarea, doar ascunsa)', () => {
    const { rerender } = render(
      <FormatLogger formatId="RFT" config={{ rounds: 5 }} movements={['Pull-ups']}
        value={{ roundsCompleted: '5' }} onChange={() => {}} t={{}} />
    )
    expect(screen.getByText('Runde complete')).toBeInTheDocument()
    rerender(
      <FormatLogger formatId="RFT" config={{ rounds: 5 }} movements={['Pull-ups']}
        value={{ roundsCompleted: '5', time: '18:42' }} onChange={() => {}} t={{}} />
    )
    expect(screen.queryByText('Runde complete')).not.toBeInTheDocument()
    expect(screen.getByText('Timp')).toBeInTheDocument()
  })
})

describe('FormatLogger - Intervals (simpleReps ca Tabata)', () => {
  it('nu are câmp de greutate și nu are buton de adăugat set', () => {
    render(
      <FormatLogger formatId="Intervals" config={{ rounds: 3 }} movements={[]}
        value={{}} onChange={() => {}} weightUnit="kg" t={{}} />
    )
    expect(screen.getAllByPlaceholderText('reps')).toHaveLength(3)
    expect(screen.queryByPlaceholderText('kg')).not.toBeInTheDocument()
    expect(screen.queryByText('+ set')).not.toBeInTheDocument()
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
