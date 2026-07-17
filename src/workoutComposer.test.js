import { describe, it, expect } from 'vitest'
import { composeSection } from './workoutComposer'

// Helper minimal - construieste o sectiune PRIMARA in forma V2 (vezi
// wodSections.js/createSection), doar campurile de care are nevoie
// composeSection (format/formatConfig/name/variants[cheie].movements).
function section({ format, formatConfig = {}, name = '', movements = [] }) {
  return {
    isPrimary: true, format, formatConfig, name,
    variants: { rx: { movements, quickAdd: '', paste: '', weight: { male: '', female: '' }, note: '' } },
  }
}

describe('composeSection - format lipsa', () => {
  it('sectiune fara format (ex. warmup text liber) -> rezultat gol, fara sa presupuna For Time', () => {
    const out = composeSection({ isPrimary: false, format: null, formatConfig: {} }, 'rx')
    expect(out).toEqual({ identity: { name: null }, primary: { text: '' }, blocks: [], scoreNote: null })
  })
})

describe('composeSection - family scored', () => {
  it('AMRAP simplu: titlu "AMRAP N", un singur bloc, fara schema', () => {
    const s = section({ format: 'AMRAP', formatConfig: { durationSec: 900 }, movements: ['Pull-ups', 'Push-ups', 'Air Squats'] })
    const out = composeSection(s, 'rx')
    expect(out.primary.text).toBe('AMRAP 15')
    expect(out.blocks).toEqual([{ role: 'main', weight: 'primary', scheme: null, movements: ['Pull-ups', 'Push-ups', 'Air Squats'], transitionBefore: null, restSeconds: null }])
    expect(out.scoreNote).toBe(null)
  })

  it('AMRAP cu durata ne-rotunda la minut foloseste mm:ss', () => {
    const s = section({ format: 'AMRAP', formatConfig: { durationSec: 630 }, movements: ['Burpees'] })
    expect(composeSection(s, 'rx').primary.text).toBe('AMRAP 10:30')
  })

  it('Ascending AMRAP primeste scoreNote (conventia de scor nu reiese din titlu)', () => {
    const s = section({ format: 'Ascending AMRAP', formatConfig: { durationSec: 1200, startReps: 3, incrementReps: 3 }, movements: ['Burpees', 'Deadlifts'] })
    const out = composeSection(s, 'rx')
    expect(out.primary.text).toBe('AMRAP 20')
    expect(out.scoreNote).toBe('ascending-rounds')
  })

  it('RFT: "N ROUNDS FOR TIME", schema hoisted din config.sharedRepScheme cand exista', () => {
    const s = section({ format: 'RFT', formatConfig: { rounds: 5, sharedRepScheme: [21, 15, 9] }, movements: ['Thrusters', 'Pull-ups'] })
    const out = composeSection(s, 'rx')
    expect(out.primary.text).toBe('5 ROUNDS FOR TIME')
    expect(out.blocks[0].scheme).toBe('21-15-9')
    expect(out.blocks[0].movements).toEqual(['Thrusters', 'Pull-ups'])
  })

  it('For Time (Sequence, fara sharedRepScheme) -> "FOR TIME", nicio schema inventata', () => {
    const s = section({ format: 'For Time', formatConfig: { structure: 'Sequence' }, movements: ['Run 400m', 'Deadlifts'] })
    const out = composeSection(s, 'rx')
    expect(out.primary.text).toBe('FOR TIME')
    expect(out.blocks[0].scheme).toBe(null)
  })

  it('For Time (Repeated Rounds) se comporta ca RFT', () => {
    const s = section({ format: 'For Time', formatConfig: { structure: 'Repeated Rounds', rounds: 7 }, movements: ['Cal Row', 'Burpees'] })
    expect(composeSection(s, 'rx').primary.text).toBe('7 ROUNDS FOR TIME')
  })

  it('Ladder migrat: sharedRepScheme hoisted la fel ca For Time/RFT/Chipper', () => {
    const s = section({ format: 'Ladder', formatConfig: { ladderType: 'Descending', sharedRepScheme: [50, 40, 30, 20, 10] }, movements: ['Double Unders', 'Sit-ups'] })
    const out = composeSection(s, 'rx')
    expect(out.blocks[0].scheme).toBe('50-40-30-20-10')
    expect(out.blocks[0].movements).toEqual(['Double Unders', 'Sit-ups'])
  })

  it('hoisting cazul 2: prefix numeric identic pe toate miscarile (fara camp de config)', () => {
    const s = section({ format: 'For Time', formatConfig: {}, movements: ['10 Pull-ups', '10 Push-ups', '10 Air Squats'] })
    const out = composeSection(s, 'rx')
    expect(out.blocks[0].scheme).toBe('10')
    expect(out.blocks[0].movements).toEqual(['Pull-ups', 'Push-ups', 'Air Squats'])
  })

  it('hoisting cazul 2 NU se aplica daca prefixele difera', () => {
    const s = section({ format: 'For Time', formatConfig: {}, movements: ['10 Pull-ups', '15 Push-ups'] })
    const out = composeSection(s, 'rx')
    expect(out.blocks[0].scheme).toBe(null)
    expect(out.blocks[0].movements).toEqual(['10 Pull-ups', '15 Push-ups'])
  })

  it('o singura miscare cu prefix numeric NU se desparte (ca "50 Cal Row" la Buy-In)', () => {
    const s = section({ format: 'For Time', formatConfig: {}, movements: ['50 Cal Row'] })
    const out = composeSection(s, 'rx')
    expect(out.blocks[0].scheme).toBe(null)
    expect(out.blocks[0].movements).toEqual(['50 Cal Row'])
  })

  it('Max Effort -> "MAX EFFORT"', () => {
    const s = section({ format: 'Max Effort', formatConfig: {}, movements: ['Deadlift'] })
    expect(composeSection(s, 'rx').primary.text).toBe('MAX EFFORT')
  })

  it('identity.name poarta numele de benchmark/coach cand exista', () => {
    const s = section({ format: 'For Time', formatConfig: { sharedRepScheme: [21, 15, 9] }, name: 'Fran', movements: ['Thrusters', 'Pull-ups'] })
    expect(composeSection(s, 'rx').identity).toEqual({ name: 'Fran' })
  })
})

describe('composeSection - family sets', () => {
  it('EMOM: "EMOM N" din totalRounds x intervalSec', () => {
    const s = section({ format: 'EMOM', formatConfig: { totalRounds: 12, intervalSec: 60 }, movements: ['Clean'] })
    expect(composeSection(s, 'rx').primary.text).toBe('EMOM 12')
  })

  it('Complex: "N SETS" din config.rounds, niciodata cuvantul "Complex"', () => {
    const s = section({ format: 'Complex', formatConfig: { rounds: 6, complexMovements: ['Power Clean', 'Front Squat'] }, movements: [] })
    expect(composeSection(s, 'rx').primary.text).toBe('6 SETS')
  })

  it('Strength Sets: titlul e miscarea insasi, schema hoisted din setsScheme (alias generic de tip)', () => {
    const s = section({ format: 'Strength Sets', formatConfig: { setsScheme: [5, 5, 5, 3, 3, 3, 1, 1, 1] }, movements: ['Back Squat'] })
    const out = composeSection(s, 'rx')
    expect(out.primary.text).toBe('Back Squat')
    expect(out.blocks[0].scheme).toBe('5-5-5-3-3-3-1-1-1')
    // Miscarea unica omisa din bloc - deja spusa de titlu, gasit live la
    // validare ("Clean The Floor"/"GET UP" randau numele miscarii de 2 ori).
    expect(out.blocks[0].movements).toEqual([])
  })

  it('Build to Heavy/1RM: aceeasi omisiune - miscarea unica identica titlului nu se repeta in bloc', () => {
    const s = section({ format: 'Build to Heavy/1RM', formatConfig: {}, movements: ['Build to a 3-rep-max front squats'] })
    const out = composeSection(s, 'rx')
    expect(out.primary.text).toBe('Build to a 3-rep-max front squats')
    expect(out.blocks[0].movements).toEqual([])
  })

  it('Weightlifting cu mai multe miscari: NU se omite nimic (titlul nu mai e identic cu o singura miscare)', () => {
    const s = section({ format: 'Weightlifting', formatConfig: {}, movements: ['Snatch', 'Overhead Squat'] })
    const out = composeSection(s, 'rx')
    expect(out.primary.text).toBe('Snatch & Overhead Squat')
    expect(out.blocks[0].movements).toEqual(['Snatch', 'Overhead Squat'])
  })

  it('Death By primeste scoreNote (runde de marime crescatoare)', () => {
    const s = section({ format: 'Death By', formatConfig: { startReps: 2, incrementReps: 2, intervalSec: 60 }, movements: ['Burpees'] })
    expect(composeSection(s, 'rx').scoreNote).toBe('death-by-escalating')
  })
})

describe('composeSection - family nft', () => {
  it('Not For Time -> titlu fix, fara scoreNote', () => {
    const s = section({ format: 'Not For Time', formatConfig: {}, movements: ['Mobility flow'] })
    const out = composeSection(s, 'rx')
    expect(out.primary.text).toBe('NOT FOR TIME')
    expect(out.scoreNote).toBe(null)
  })
})

describe('composeSection - family chained', () => {
  it('Chained AMRAP: fiecare etapa ramane un bloc separat, straight-into intre ele, scoreNote pt scor total', () => {
    const s = section({
      format: 'Chained AMRAP',
      formatConfig: {
        stages: [
          { kind: 'amrap', durationSec: 120, movements: ['Deadlifts'] },
          { kind: 'amrap', durationSec: 1140, movements: ['10 Pull-ups', '10 KB Swings', '10 Box Jumps'] },
          { kind: 'amrap', durationSec: 120, movements: ['Deadlifts'] },
        ],
      },
      movements: [],
    })
    const out = composeSection(s, 'rx')
    expect(out.primary.text).toBe('3 STAGES')
    expect(out.scoreNote).toBe('chained-total-reps')
    expect(out.blocks).toHaveLength(3)
    expect(out.blocks[0]).toMatchObject({ role: 'stage', transitionBefore: null, scheme: null, movements: ['Deadlifts'] })
    expect(out.blocks[1]).toMatchObject({ role: 'stage', transitionBefore: 'straight-into', scheme: '10', movements: ['Pull-ups', 'KB Swings', 'Box Jumps'] })
    expect(out.blocks[2]).toMatchObject({ role: 'stage', transitionBefore: 'straight-into' })
  })
})

describe('composeSection - family mixed (flagship worked example, spec §0)', () => {
  it('Buy-In/Cash-Out cu schema scrisa direct in text ("21-15-9 Thrusters") - 3 blocuri, THEN intre ele', () => {
    const s = section({
      format: 'Buy-In/Cash-Out',
      formatConfig: {
        buyIn: ['50 Cal Row'],
        cashOut: ['50 Cal Row'],
        mainFormat: 'For Time',
        mainDurationSec: null,
      },
      movements: ['21-15-9 Thrusters', '21-15-9 Pull-ups'],
    })
    const out = composeSection(s, 'rx')

    expect(out.primary.text).toBe('FOR TIME')
    expect(out.scoreNote).toBe(null)
    expect(out.blocks).toEqual([
      { role: 'buy-in', weight: 'secondary', scheme: null, movements: ['50 Cal Row'], transitionBefore: null, restSeconds: null },
      { role: 'main', weight: 'primary', scheme: '21-15-9', movements: ['Thrusters', 'Pull-ups'], transitionBefore: 'then', restSeconds: null },
      { role: 'cash-out', weight: 'secondary', scheme: null, movements: ['50 Cal Row'], transitionBefore: 'then', restSeconds: null },
    ])
  })

  it('Buy-In/Cash-Out cu mainFormat AMRAP', () => {
    const s = section({
      format: 'Buy-In/Cash-Out',
      formatConfig: { buyIn: ['20 Cal Bike'], cashOut: [], mainFormat: 'AMRAP', mainDurationSec: 600 },
      movements: ['Wall Balls', 'Box Jumps'],
    })
    const out = composeSection(s, 'rx')
    expect(out.primary.text).toBe('AMRAP')
    expect(out.blocks).toHaveLength(2)
    expect(out.blocks[0].role).toBe('buy-in')
    expect(out.blocks[1]).toMatchObject({ role: 'main', transitionBefore: 'then' })
  })

  it('AMRAP with Buy-In: un singur clock, titlu "AMRAP N" din totalDurationSec', () => {
    const s = section({
      format: 'AMRAP with Buy-In',
      formatConfig: { totalDurationSec: 1200, buyIn: ['30 Cal Row'] },
      movements: ['Pull-ups', 'Push-ups'],
    })
    const out = composeSection(s, 'rx')
    expect(out.primary.text).toBe('AMRAP 20')
    expect(out.blocks).toHaveLength(2)
    expect(out.blocks[0]).toMatchObject({ role: 'buy-in', movements: ['30 Cal Row'] })
    expect(out.blocks[1]).toMatchObject({ role: 'main', movements: ['Pull-ups', 'Push-ups'] })
  })

  it('fara buy-in/cash-out configurate, doar blocul main ramane', () => {
    const s = section({ format: 'Buy-In/Cash-Out', formatConfig: { buyIn: [], cashOut: [], mainFormat: 'For Time' }, movements: ['Run 1 mile'] })
    const out = composeSection(s, 'rx')
    expect(out.blocks).toHaveLength(1)
    expect(out.blocks[0]).toMatchObject({ role: 'main', transitionBefore: null })
  })
})

describe('composeSection - scaling variants', () => {
  it('acelasi scheletul (primary/scheme/roluri), doar miscarile difera intre variante', () => {
    const s = {
      isPrimary: true, format: 'RFT', formatConfig: { rounds: 5, sharedRepScheme: [21, 15, 9] }, name: '',
      variants: {
        rx: { movements: ['Thrusters @ 43kg', 'Pull-ups'] },
        beginner: { movements: ['Thrusters @ 20kg', 'Ring Rows'] },
      },
    }
    const rx = composeSection(s, 'rx')
    const beginner = composeSection(s, 'beginner')
    expect(rx.primary.text).toBe(beginner.primary.text)
    expect(rx.blocks[0].scheme).toBe(beginner.blocks[0].scheme)
    expect(rx.blocks[0].movements).not.toEqual(beginner.blocks[0].movements)
    expect(beginner.blocks[0].movements).toEqual(['Thrusters @ 20kg', 'Ring Rows'])
  })
})
