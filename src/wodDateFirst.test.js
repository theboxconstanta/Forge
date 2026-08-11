import { describe, it, expect } from 'vitest'
import { findExistingWodOnDate, shouldEnterNewWodSession } from './wodDateFirst'

describe('findExistingWodOnDate', () => {
  const wods = [
    { id: 'a', date: '2026-08-11' },
    { id: 'b', date: '2026-08-12' },
    { id: 'c', date: '2026-08-13' },
  ]

  // TEST 6: schimbarea datei catre o zi care are deja un WOD trebuie
  // detectata (fara sa incarce/inlocuiasca nimic automat - doar semnalul).
  it('gaseste WOD-ul existent pe data aleasa', () => {
    expect(findExistingWodOnDate(wods, '2026-08-12', null)).toEqual({ id: 'b', date: '2026-08-12' })
  })

  it('intoarce null cand nu exista niciun WOD pe data aleasa', () => {
    expect(findExistingWodOnDate(wods, '2026-08-20', null)).toBe(null)
  })

  // Editarea unui WOD existent, fara sa-i schimbam data, nu trebuie sa se
  // semnaleze singura ca "deja exista un conflict" - excludem explicit id-ul
  // pe care il editam chiar acum.
  it('exclude WOD-ul care e chiar editat acum (nu se raporteaza singur ca si conflict)', () => {
    expect(findExistingWodOnDate(wods, '2026-08-12', 'b')).toBe(null)
  })

  it('gaseste totusi conflictul real cand editam un WOD si schimbam data catre alt WOD existent', () => {
    expect(findExistingWodOnDate(wods, '2026-08-13', 'b')).toEqual({ id: 'c', date: '2026-08-13' })
  })

  it('trateaza o lista goala sau nedefinita fara sa crape', () => {
    expect(findExistingWodOnDate([], '2026-08-12', null)).toBe(null)
    expect(findExistingWodOnDate(undefined, '2026-08-12', null)).toBe(null)
  })
})

describe('shouldEnterNewWodSession', () => {
  // TESTE 1-5, 7-9, 11: schimbarea datei (sau intrarea in Quick Create prin
  // Analiza/Sablon/Start Gol) intra in sesiunea "antrenament nou" DOAR cand
  // nu editam deja un WOD real incarcat - editarea unui WOD existent isi
  // pastreaza propriul editWodId, protejat deja de garda separata.
  it('true cand nu editam niciun WOD real (creare noua sau Quick Create implicit)', () => {
    expect(shouldEnterNewWodSession(null)).toBe(true)
    expect(shouldEnterNewWodSession(undefined)).toBe(true)
  })

  it('false cand editam deja un WOD real incarcat (reprogramare, nu creare noua)', () => {
    expect(shouldEnterNewWodSession('existing-wod-id')).toBe(false)
  })
})
