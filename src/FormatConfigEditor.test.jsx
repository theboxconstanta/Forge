import { describe, it, expect, afterEach, vi } from 'vitest'
import { render, screen, cleanup, fireEvent } from '@testing-library/react'
import FormatConfigEditor from './FormatConfigEditor'

afterEach(() => {
  cleanup()
})

describe('FormatConfigEditor', () => {
  it('schimbarea formatului cheamă onFormatChange cu noul id', () => {
    const onFormatChange = vi.fn()
    render(<FormatConfigEditor formatId="AMRAP" onFormatChange={onFormatChange} config={{}} onConfigChange={() => {}} t={{}} />)
    fireEvent.change(screen.getByDisplayValue('AMRAP'), { target: { value: 'EMOM' } })
    expect(onFormatChange).toHaveBeenCalledWith('EMOM')
  })

  it('randează câmpurile specifice formatului (EMOM: nr. intervale + durată)', () => {
    render(<FormatConfigEditor formatId="EMOM" onFormatChange={() => {}} config={{}} onConfigChange={() => {}} t={{}} />)
    expect(screen.getByText('Număr intervale')).toBeInTheDocument()
    expect(screen.getByText('Durată interval')).toBeInTheDocument()
  })

  it('excludeConfigKeys ascunde câmpurile indicate (ex: durata la formatul principal WOD)', () => {
    render(<FormatConfigEditor formatId="AMRAP" onFormatChange={() => {}} config={{}} onConfigChange={() => {}} excludeConfigKeys={['durationSec']} t={{}} />)
    expect(screen.queryByText('Durată')).not.toBeInTheDocument()
  })

  it('editarea unui câmp de tip number actualizează config-ul', () => {
    const onConfigChange = vi.fn()
    render(<FormatConfigEditor formatId="EMOM" onFormatChange={() => {}} config={{}} onConfigChange={onConfigChange} t={{}} />)
    const numberInputs = screen.getAllByRole('spinbutton')
    fireEvent.change(numberInputs[0], { target: { value: '10' } })
    expect(onConfigChange).toHaveBeenCalledWith(expect.objectContaining({ totalRounds: 10 }))
  })
})
