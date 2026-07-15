import { describe, it, expect } from 'vitest'
import { parseMiscareLinePasta, looksLikeMovementLine } from './movements'

describe('parseMiscareLinePasta', () => {
  it('linie goala -> goala', () => {
    expect(parseMiscareLinePasta('')).toBe('')
    expect(parseMiscareLinePasta('   ')).toBe('')
  })
  it('reps + miscare cunoscuta EXACT (singular) - normalizeaza case-ul', () => {
    expect(parseMiscareLinePasta('21 thruster')).toBe('21 Thruster')
  })
  it('plural (nu se potriveste exact cu singularul din MISCARI) - doar title-case, fara normalizare fortata', () => {
    expect(parseMiscareLinePasta('21 thrusters')).toBe('21 Thrusters')
  })
  it('reps + miscare + greutate cu "@" - format deja canonic, ramane la fel', () => {
    expect(parseMiscareLinePasta('21 Thruster @ 43kg')).toBe('21 Thruster @ 43kg')
  })
  it('greutate in paranteza, combinata male/female - extrasa si recompusa cu "@"', () => {
    expect(parseMiscareLinePasta('5 Hang Power Snatch (15/20 kg)')).toBe('5 Hang Power Snatch @ 15/20kg')
  })
  it('miscare fara potrivire exacta - title-case (doar prima litera a fiecarui cuvant, cratima ramane neatinsa)', () => {
    expect(parseMiscareLinePasta('3 pull-to-stands')).toBe('3 Pull-to-stands')
  })
  it('miscare complet noua, necunoscuta - acceptata ca atare, doar title-case', () => {
    expect(parseMiscareLinePasta('10 zzz custom movement')).toBe('10 Zzz Custom Movement')
  })
  it('cardio cu distanta - recunoscut si recompus cu metri', () => {
    expect(parseMiscareLinePasta('400m run')).toBe('400m Run')
  })
  it('cardio cu calorii - recunoscut si recompus cu Cal', () => {
    expect(parseMiscareLinePasta('50 cal row')).toBe('50 Cal Row')
  })
  it('greutate in lbs - unitatea e pastrata', () => {
    expect(parseMiscareLinePasta('10 Deadlift @ 225lbs')).toBe('10 Deadlift @ 225lbs')
  })
  it('fara reps la inceput - miscarea si greutatea tot se detecteaza', () => {
    expect(parseMiscareLinePasta('Deadlift (100kg)')).toBe('Deadlift @ 100kg')
  })
  it('miscare de forta care contine "row" ca substring nu e confundata cu cardio-ul Row', () => {
    expect(parseMiscareLinePasta('5 Ring Rows')).toBe('5 Ring Rows')
  })
})

describe('looksLikeMovementLine', () => {
  it('linii de structura care se termina in ":" - semnalate', () => {
    expect(looksLikeMovementLine('Then:')).toBe(false)
    expect(looksLikeMovementLine('Amrap 2:')).toBe(false)
    expect(looksLikeMovementLine('Amrap 19:')).toBe(false)
    expect(looksLikeMovementLine('EMOM 10:')).toBe(false)
  })
  it('note/instructiuni cu prefix "-"/"–" - semnalate (exemplul real gasit)', () => {
    expect(looksLikeMovementLine('– No Rest Between Amraps.')).toBe(false)
    expect(looksLikeMovementLine('- Scale as needed')).toBe(false)
  })
  it('propozitie lunga fara nicio potrivire in MISCARI - semnalata (exemplul userului)', () => {
    expect(looksLikeMovementLine('wear a vest if you can')).toBe(false)
  })
  it('miscari reale, cunoscute sau nu - nu sunt semnalate (fara falsuri pozitive)', () => {
    expect(looksLikeMovementLine('10 Thrusters')).toBe(true)
    expect(looksLikeMovementLine('Max-reps Deadlifts @ 70/102kg')).toBe(true)
    expect(looksLikeMovementLine('4 Strict Pull-ups')).toBe(true)
    expect(looksLikeMovementLine('23 Cal Bike')).toBe(true)
    // Miscare reala dar necunoscuta (nu in MISCARI) - scurta, nu trebuie
    // respinsa doar pt ca nu e in lista statica.
    expect(looksLikeMovementLine('Sandbag Bear Hug Carry')).toBe(true)
  })
  it('text gol -> considerat ok (nimic de semnalat)', () => {
    expect(looksLikeMovementLine('')).toBe(true)
    expect(looksLikeMovementLine('   ')).toBe(true)
  })
})
