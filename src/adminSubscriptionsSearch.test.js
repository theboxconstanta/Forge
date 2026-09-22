// FORGE — ADMIN SUBSCRIPTIONS SEARCH (minimal UI change). Exercises the exact
// filter logic added to the Admin -> Abonamente/Subscriptions list (App.jsx):
// name-or-email match, partial, case-insensitive, diacritic-insensitive,
// read-only client-side filter over already-loaded data. Replicated verbatim
// from the real implementation to minimize drift risk (App.jsx's inline
// foldDiacritics + emails.filter(...) block is not an exported function).

import { describe, it, expect } from 'vitest'

const foldDiacritics = (s) => (s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()

function filterSubscriptionEmails(allEmails, grouped, clienti, searchAbonamente) {
  const searchQ = foldDiacritics(searchAbonamente.trim())
  if (!searchQ) return allEmails
  return allEmails.filter(email => {
    const membruNume = clienti.find(c => c.email?.toLowerCase() === email)?.full_name
    return foldDiacritics(membruNume).includes(searchQ) || foldDiacritics(email).includes(searchQ)
  })
}

const CLIENTI = [
  { email: 'stefan.ionescu@example.com', full_name: 'Ștefan Ionescu' },
  { email: 'maria.popescu@example.com', full_name: 'Maria Popescu' },
  { email: 'andrei@example.com', full_name: 'Andrei Ionuț' },
  { email: 'noname@example.com', full_name: null }, // subscription exists, no matching client profile
]

const GROUPED = {
  'stefan.ionescu@example.com': [{ id: 'a1' }],
  'maria.popescu@example.com': [{ id: 'b1' }, { id: 'b2' }],
  'andrei@example.com': [{ id: 'c1' }],
  'noname@example.com': [{ id: 'd1' }],
}
const ALL_EMAILS = Object.keys(GROUPED)

describe('Admin Subscriptions search — name match', () => {
  it('matches by partial display name, case-insensitive', () => {
    expect(filterSubscriptionEmails(ALL_EMAILS, GROUPED, CLIENTI, 'maria')).toEqual(['maria.popescu@example.com'])
    expect(filterSubscriptionEmails(ALL_EMAILS, GROUPED, CLIENTI, 'MARIA')).toEqual(['maria.popescu@example.com'])
    expect(filterSubscriptionEmails(ALL_EMAILS, GROUPED, CLIENTI, 'pop')).toEqual(['maria.popescu@example.com'])
  })

  it('diacritic-insensitive: "Stefan" (no diacritics) finds "Ștefan"', () => {
    expect(filterSubscriptionEmails(ALL_EMAILS, GROUPED, CLIENTI, 'Stefan')).toEqual(['stefan.ionescu@example.com'])
  })

  it('diacritic-insensitive: "ionut" finds "Ionuț"', () => {
    expect(filterSubscriptionEmails(ALL_EMAILS, GROUPED, CLIENTI, 'ionut')).toEqual(['andrei@example.com'])
  })
})

describe('Admin Subscriptions search — email match', () => {
  it('matches by partial email when no name match', () => {
    expect(filterSubscriptionEmails(ALL_EMAILS, GROUPED, CLIENTI, 'andrei@')).toEqual(['andrei@example.com'])
  })

  it('a subscription with no matching client profile is still findable by email', () => {
    expect(filterSubscriptionEmails(ALL_EMAILS, GROUPED, CLIENTI, 'noname')).toEqual(['noname@example.com'])
  })
})

describe('Admin Subscriptions search — no match / empty query', () => {
  it('an empty or whitespace-only query returns the complete, unfiltered list', () => {
    expect(filterSubscriptionEmails(ALL_EMAILS, GROUPED, CLIENTI, '')).toEqual(ALL_EMAILS)
    expect(filterSubscriptionEmails(ALL_EMAILS, GROUPED, CLIENTI, '   ')).toEqual(ALL_EMAILS)
  })

  it('a query matching nothing returns an empty array (drives the "no results" message)', () => {
    expect(filterSubscriptionEmails(ALL_EMAILS, GROUPED, CLIENTI, 'zzzznomatch')).toEqual([])
  })
})

describe('Admin Subscriptions search — preserves grouping and counts', () => {
  it('filtering preserves each member\'s full subscription group (not individual rows)', () => {
    const result = filterSubscriptionEmails(ALL_EMAILS, GROUPED, CLIENTI, 'maria')
    expect(result).toEqual(['maria.popescu@example.com'])
    expect(GROUPED[result[0]].length).toBe(2) // both of Maria's subscriptions stay grouped together
  })

  it('the visible subscription total (for the list header) sums only the filtered members\' rows', () => {
    const filtered = filterSubscriptionEmails(ALL_EMAILS, GROUPED, CLIENTI, 'maria')
    const total = filtered.reduce((sum, email) => sum + GROUPED[email].length, 0)
    expect(total).toBe(2)
  })
})
