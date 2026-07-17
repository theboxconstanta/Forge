import { describe, it, expect, afterEach } from 'vitest'
import { render, screen, cleanup } from '@testing-library/react'
import { ComposedWorkoutView } from './ComposedWorkoutView'
import { composeSection } from './workoutComposer'
import { getT } from './translations'

afterEach(() => {
  cleanup()
})

const tRo = getT('ro')
const tEn = getT('en')

function section({ format, formatConfig = {}, name = '', movements = [] }) {
  return {
    isPrimary: true, format, formatConfig, name,
    variants: { rx: { movements } },
  }
}

describe('ComposedWorkoutView', () => {
  it('nu randeaza nimic pentru un ComposedWorkout fara blocuri (ex. sectiune fara format)', () => {
    const composed = composeSection({ isPrimary: false, format: null, formatConfig: {} }, 'rx')
    const { container } = render(<ComposedWorkoutView composed={composed} t={tRo} />)
    expect(container.firstChild).toBe(null)
  })

  it('exemplul lucrat din spec (Buy-In -> 21-15-9 -> Cash-Out): titlu, BUY-IN/CASH-OUT, THEN, schema hoisted', () => {
    const s = section({
      format: 'Buy-In/Cash-Out',
      formatConfig: { buyIn: ['50 Cal Row'], cashOut: ['50 Cal Row'], mainFormat: 'For Time' },
      movements: ['21-15-9 Thrusters', '21-15-9 Pull-ups'],
    })
    const composed = composeSection(s, 'rx')
    render(<ComposedWorkoutView composed={composed} t={tRo} />)

    expect(screen.getByText('FOR TIME')).toBeInTheDocument()
    expect(screen.getAllByText('Buy-In')).toHaveLength(1)
    expect(screen.getByText('Cash-Out')).toBeInTheDocument()
    expect(screen.getAllByText('THEN')).toHaveLength(2)
    expect(screen.getByText('21-15-9')).toBeInTheDocument()
    expect(screen.getByText('Thrusters')).toBeInTheDocument()
    expect(screen.getByText('Pull-ups')).toBeInTheDocument()
    // "50 Cal Row" apare de 2 ori (buy-in si cash-out), fara sa fie despartit
    // (o singura miscare cu prefix numeric nu se desparte niciodata).
    expect(screen.getAllByText('50 Cal Row')).toHaveLength(2)
  })

  it('numele de benchmark/coach apare ca identitate, cand exista', () => {
    const s = section({ format: 'For Time', formatConfig: { sharedRepScheme: [21, 15, 9] }, name: 'Fran', movements: ['Thrusters', 'Pull-ups'] })
    render(<ComposedWorkoutView composed={composeSection(s, 'rx')} t={tRo} />)
    expect(screen.getByText('Fran')).toBeInTheDocument()
  })

  it('Chained AMRAP: etichete de etapa (Stage N) + STRAIGHT INTO intre ele + scoreNote tradus', () => {
    const s = section({
      format: 'Chained AMRAP',
      formatConfig: {
        stages: [
          { kind: 'amrap', durationSec: 120, movements: ['Deadlifts'] },
          { kind: 'amrap', durationSec: 1140, movements: ['10 Pull-ups', '10 KB Swings'] },
        ],
      },
    })
    render(<ComposedWorkoutView composed={composeSection(s, 'rx')} t={tEn} />)
    expect(screen.getByText('Stage 1')).toBeInTheDocument()
    expect(screen.getByText('Stage 2')).toBeInTheDocument()
    expect(screen.getByText('STRAIGHT INTO')).toBeInTheDocument()
    expect(screen.getByText('Score: total reps across all stages.')).toBeInTheDocument()
  })

  it('scoreNote se traduce corect si in romana', () => {
    const s = section({ format: 'Death By', formatConfig: { startReps: 2, incrementReps: 2, intervalSec: 60 }, movements: ['Burpees'] })
    render(<ComposedWorkoutView composed={composeSection(s, 'rx')} t={tRo} />)
    expect(screen.getByText('Continuă până nu mai reușești să termini intervalul.')).toBeInTheDocument()
  })

  it('un bloc fara schema nu randeaza nicio schema goala', () => {
    const s = section({ format: 'For Time', formatConfig: { structure: 'Sequence' }, movements: ['Run 400m', 'Deadlifts'] })
    render(<ComposedWorkoutView composed={composeSection(s, 'rx')} t={tRo} />)
    expect(screen.getByText('Run 400m')).toBeInTheDocument()
    expect(screen.getByText('Deadlifts')).toBeInTheDocument()
  })
})
