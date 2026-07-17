import { describe, it, expect, afterEach, vi } from 'vitest'
import { render, screen, cleanup, fireEvent } from '@testing-library/react'
import FormatConfigEditor from './FormatConfigEditor'
import { getT } from './translations'

afterEach(() => {
  cleanup()
})

const tRo = getT('ro')
const tEn = getT('en')

describe('FormatConfigEditor', () => {
  it('schimbarea formatului cheamă onFormatChange cu noul id', () => {
    const onFormatChange = vi.fn()
    render(<FormatConfigEditor formatId="AMRAP" onFormatChange={onFormatChange} config={{}} onConfigChange={() => {}} t={tRo} />)
    fireEvent.change(screen.getByDisplayValue('AMRAP'), { target: { value: 'EMOM' } })
    expect(onFormatChange).toHaveBeenCalledWith('EMOM')
  })

  it('randează câmpurile specifice formatului (EMOM: nr. intervale + durată), traduse RO', () => {
    render(<FormatConfigEditor formatId="EMOM" onFormatChange={() => {}} config={{}} onConfigChange={() => {}} t={tRo} />)
    expect(screen.getByText('Număr intervale')).toBeInTheDocument()
    expect(screen.getByText('Durată interval')).toBeInTheDocument()
  })

  it('randează aceleași câmpuri traduse EN', () => {
    render(<FormatConfigEditor formatId="EMOM" onFormatChange={() => {}} config={{}} onConfigChange={() => {}} t={tEn} />)
    expect(screen.getByText('Number of intervals')).toBeInTheDocument()
    expect(screen.getByText('Interval duration')).toBeInTheDocument()
  })

  it('excludeConfigKeys ascunde câmpurile indicate (ex: durata la formatul principal WOD)', () => {
    render(<FormatConfigEditor formatId="AMRAP" onFormatChange={() => {}} config={{}} onConfigChange={() => {}} excludeConfigKeys={['durationSec']} t={tRo} />)
    expect(screen.queryByText('Durată')).not.toBeInTheDocument()
  })

  it('editarea unui câmp de tip number actualizează config-ul', () => {
    const onConfigChange = vi.fn()
    render(<FormatConfigEditor formatId="EMOM" onFormatChange={() => {}} config={{}} onConfigChange={onConfigChange} t={tRo} />)
    const numberInputs = screen.getAllByRole('spinbutton')
    fireEvent.change(numberInputs[0], { target: { value: '10' } })
    expect(onConfigChange).toHaveBeenCalledWith(expect.objectContaining({ totalRounds: 10 }))
  })

  it('Ladder afișează chip-uri quick-select pentru schema comună de reps și le poate alege (array structurat)', () => {
    const onConfigChange = vi.fn()
    render(<FormatConfigEditor formatId="Ladder" onFormatChange={() => {}} config={{}} onConfigChange={onConfigChange} t={tRo} />)
    fireEvent.click(screen.getByText('21-15-9'))
    expect(onConfigChange).toHaveBeenCalledWith(expect.objectContaining({ sharedRepScheme: [21, 15, 9] }))
  })

  it('For Time/RFT/Chipper primesc aceleași chip-uri quick-select pentru sharedRepScheme', () => {
    for (const formatId of ['For Time', 'RFT', 'Chipper']) {
      const onConfigChange = vi.fn()
      render(<FormatConfigEditor formatId={formatId} onFormatChange={() => {}} config={{}} onConfigChange={onConfigChange} t={tRo} />)
      fireEvent.click(screen.getAllByText('50-40-30-20-10')[0])
      expect(onConfigChange).toHaveBeenCalledWith(expect.objectContaining({ sharedRepScheme: [50, 40, 30, 20, 10] }))
      cleanup()
    }
  })

  it('Strength Sets: adăugarea unei ținte de reps construiește schema per set', () => {
    const onConfigChange = vi.fn()
    render(<FormatConfigEditor formatId="Strength Sets" onFormatChange={() => {}} config={{}} onConfigChange={onConfigChange} t={tRo} />)
    const input = screen.getByPlaceholderText('ex: 5')
    fireEvent.change(input, { target: { value: '5' } })
    fireEvent.click(screen.getByText('+'))
    expect(onConfigChange).toHaveBeenCalledWith(expect.objectContaining({ setsScheme: [5] }))
  })

  it('Tabata expune scoringMode ca select cu Lowest Reps implicit', () => {
    render(<FormatConfigEditor formatId="Tabata" onFormatChange={() => {}} config={{}} onConfigChange={() => {}} t={tRo} />)
    expect(screen.getByText('Scor pe interval')).toBeInTheDocument()
  })
})
