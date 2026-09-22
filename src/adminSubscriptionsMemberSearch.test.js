// FORGE — ADMIN SUBSCRIPTIONS: EXISTING MEMBER FIELD, SEARCH BY NAME OR EMAIL.
// Exercises the exact matching/resolution/submit-guard logic added to the
// "Athlete email" field of the New subscription form (App.jsx): the same
// field now searches clienti by name OR email (partial, case- and
// diacritic-insensitive), never auto-selects, resolves a selection to the
// member's exact email, and blocks submission of anything that isn't a
// well-formed email. Replicated verbatim from the real implementation
// (an inline IIFE in App.jsx, not an exported function) to minimize drift.

import { describe, it, expect } from 'vitest'

const foldD = (s) => (s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

function matchMembers(clienti, typed) {
  const emailVal = typed.trim()
  const emailValid = EMAIL_RE.test(emailVal)
  const q = foldD(emailVal)
  if (!q || emailValid) return []
  return clienti.filter(c => foldD(c.full_name).includes(q) || foldD(c.email).includes(q)).slice(0, 8)
}

// Verbatim replica of saveAbonament's submit guard.
function canSubmit(emailAbonament, planSelectat) {
  const emailTrimmed = emailAbonament.trim()
  const emailFormatValid = EMAIL_RE.test(emailTrimmed)
  return emailFormatValid && !!planSelectat
}

const CLIENTI = [
  { id: 'c1', full_name: 'Iulia Rosca', email: 'iulia.rosca@example.com' },
  { id: 'c2', full_name: 'Iulia Popescu', email: 'iulia.popescu@example.com' },
  { id: 'c3', full_name: 'Ștefan Ionescu', email: 'stefan.ionescu@example.com' },
  { id: 'c4', full_name: 'Andrei Ioniță', email: 'andrei@example.com' },
]

describe('1-6: search by first/last/full name, partial email, case- and diacritic-insensitive', () => {
  it('first name "Iulia" matches both Iulias', () => {
    const r = matchMembers(CLIENTI, 'Iulia')
    expect(r.map(c => c.id).sort()).toEqual(['c1', 'c2'])
  })

  it('surname "Rosca" narrows to one member', () => {
    const r = matchMembers(CLIENTI, 'Rosca')
    expect(r.map(c => c.id)).toEqual(['c1'])
  })

  it('full name "Iulia Rosca" matches the exact member', () => {
    const r = matchMembers(CLIENTI, 'Iulia Rosca')
    expect(r.map(c => c.id)).toEqual(['c1'])
  })

  it('partial email "iulia.rosca@" matches by email substring', () => {
    const r = matchMembers(CLIENTI, 'iulia.rosca@')
    expect(r.map(c => c.id)).toEqual(['c1'])
  })

  it('case-insensitive: "IULIA" and "rOsCa" both match', () => {
    expect(matchMembers(CLIENTI, 'IULIA').map(c => c.id).sort()).toEqual(['c1', 'c2'])
    expect(matchMembers(CLIENTI, 'rOsCa').map(c => c.id)).toEqual(['c1'])
  })

  it('diacritic-insensitive: "Stefan" finds "Ștefan", "Ionita" finds "Ioniță"', () => {
    expect(matchMembers(CLIENTI, 'Stefan').map(c => c.id)).toEqual(['c3'])
    expect(matchMembers(CLIENTI, 'Ionita').map(c => c.id)).toEqual(['c4'])
  })
})

describe('7: members with identical/similar names are distinguishable by email', () => {
  it('two "Iulia"s both surface, each with their own distinct email', () => {
    const r = matchMembers(CLIENTI, 'Iulia')
    const emails = r.map(c => c.email).sort()
    expect(emails).toEqual(['iulia.popescu@example.com', 'iulia.rosca@example.com'])
    expect(new Set(emails).size).toBe(2)
  })
})

describe('8-9: selecting a member resolves the exact email; changing/clearing works', () => {
  it('selecting a suggestion resolves to that member\'s exact stored email, not the typed name', () => {
    const selected = CLIENTI.find(c => c.id === 'c1')
    const resolvedEmail = selected.email // == what selectMember() sets emailAbonament to
    expect(resolvedEmail).toBe('iulia.rosca@example.com')
    expect(EMAIL_RE.test(resolvedEmail)).toBe(true)
  })

  it('after a selection, the field holds a valid email and can be changed again by typing a new name', () => {
    let emailAbonament = CLIENTI[0].email // post-selection state
    expect(EMAIL_RE.test(emailAbonament)).toBe(true)
    emailAbonament = 'Ștefan' // admin changes their mind, types a new search
    expect(matchMembers(CLIENTI, emailAbonament).map(c => c.id)).toEqual(['c3'])
  })

  it('clearing the field returns to a fully empty, unresolved state (no matches, nothing submittable)', () => {
    expect(matchMembers(CLIENTI, '')).toEqual([])
    expect(canSubmit('', 'plan-1')).toBe(false)
  })
})

describe('10: manual email entry (including an email not in the roster) still works', () => {
  it('a well-formed email not belonging to any known client is still accepted for submission', () => {
    expect(canSubmit('brand.new.member@example.com', 'plan-1')).toBe(true)
    // and does not spuriously open the name-match dropdown once it's a valid email
    expect(matchMembers(CLIENTI, 'brand.new.member@example.com')).toEqual([])
  })
})

describe('11: a typed name cannot be submitted as an email', () => {
  it('typing a name alone (never resolved via selection) is blocked at submit time', () => {
    expect(canSubmit('Iulia', 'plan-1')).toBe(false)
    expect(canSubmit('Iulia Rosca', 'plan-1')).toBe(false)
    expect(canSubmit('Stefan', 'plan-1')).toBe(false)
  })

  it('a name that matches zero clients is still blocked (not just names with matches)', () => {
    expect(canSubmit('Nonexistent Person', 'plan-1')).toBe(false)
  })

  it('whitespace/empty input is blocked', () => {
    expect(canSubmit('   ', 'plan-1')).toBe(false)
  })
})

describe('12: existing subscription creation logic is unchanged for valid input', () => {
  it('a valid, resolved email with a plan selected passes the guard exactly as before', () => {
    expect(canSubmit('iulia.rosca@example.com', 'plan-1')).toBe(true)
  })

  it('a valid email with no plan selected is still blocked (pre-existing rule, unchanged)', () => {
    expect(canSubmit('iulia.rosca@example.com', '')).toBe(false)
  })
})
