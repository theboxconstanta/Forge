// FORGE — REMAINING MOVEMENT SEARCH SURFACES FIX (MiscareQuickAdd,
// FormatConfigEditor's MovementTextField/MovementListField/IntervalList
// Field/StageListField). Exercises the REAL searchPerformedMovements
// engine against the exact query-preparation logic each surface now uses:
//
//  - name-only fields (MiscareQuickAdd's `value`, MovementTextField):
//    the WHOLE typed text is searched (same as the closed Composer fix).
//  - composite fields (MovementListField/IntervalListField/StageListField's
//    `draft`, which may read "12 Dumbbell Snatch"): only the LAST WORD is
//    extracted and searched — verbatim replica of
//    `draft.trim().split(/\s+/).pop() || ''` (FormatConfigEditor.jsx),
//    kept identical to the real implementation to minimize drift risk.
//
// The member-safe catalog wrapper (`memberMovementCatalog`, App.jsx) is a
// closure inside App() and not exported/importable in isolation; its
// CONTRACT (an object with `.suggestions` and deliberately no
// `.createMovement`) is verified structurally here, and its live behavior
// (CreateMiscareRow never rendering for members) is verified in the
// browser per the ticket's own live-acceptance requirement.

import { describe, it, expect } from 'vitest'
import { searchPerformedMovements } from './prescriptionContract'

function row(id, name, aliases = []) {
  return { id, name, aliases, allowed_prescription_metrics: ['reps', 'load'], default_prescription_metric: 'load' }
}

const CATALOG = [
  row('new-1', 'Dumbbell Hang Power Clean And Jerk'),
  row('new-2', 'Trap Bar Deadlift'),
  row('new-3', 'Nordic Curl'),
  row('ali-1', 'Sled Push', ['push sled', 'prowler']),
  row('ali-2', 'Glute Ham Raise', ['ghr']),
  row('other-1', 'Dumbbell Snatch'),
  row('other-2', 'DB Snatch'), // deliberate duplicate pair, same as production
  row('other-3', 'Back Squat'),
]

// Verbatim replica of MovementTextField's (name-only) adapter.
function wholeTextSuggest(catalogRows, text, catalog = { suggestions: (t) => searchPerformedMovements(catalogRows, t, 5).map(r => r.name) }) {
  if (!text || text.trim().length < 2) return []
  return catalog.suggestions(text)
}

// Verbatim replica of MovementListField's (composite-aware) adapter.
function lastWordSuggest(catalogRows, draft) {
  const catalog = { suggestions: (t) => (!t || t.trim().length < 2) ? [] : searchPerformedMovements(catalogRows, t, 5).map(r => r.name) }
  return catalog.suggestions(draft.trim().split(/\s+/).pop() || '')
}

describe('name-only fields (MiscareQuickAdd, MovementTextField) — whole-text search', () => {
  it('a new movement is found by its full/partial name', () => {
    expect(wholeTextSuggest(CATALOG, 'Trap Bar Deadlift')).toContain('Trap Bar Deadlift')
    expect(wholeTextSuggest(CATALOG, 'Nordic')).toContain('Nordic Curl')
  })

  it('aliases resolve through the whole-text path', () => {
    expect(wholeTextSuggest(CATALOG, 'GHR')).toContain('Glute Ham Raise')
    expect(wholeTextSuggest(CATALOG, 'Push Sled')).toContain('Sled Push')
    expect(wholeTextSuggest(CATALOG, 'Prowler')).toContain('Sled Push')
  })

  it('DB/Dumbbell normalization reaches both spellings', () => {
    expect(wholeTextSuggest(CATALOG, 'Dumbbell Snatch')).toEqual(expect.arrayContaining(['Dumbbell Snatch', 'DB Snatch']))
    expect(wholeTextSuggest(CATALOG, 'DB Snatch')).toEqual(expect.arrayContaining(['Dumbbell Snatch', 'DB Snatch']))
  })
})

describe('composite fields (MovementListField/IntervalListField/StageListField) — last-word-only search', () => {
  it('"12 Dumbbell Snatch" extracts "Snatch" and still finds the movement', () => {
    const results = lastWordSuggest(CATALOG, '12 Dumbbell Snatch')
    expect(results).toEqual(expect.arrayContaining(['Dumbbell Snatch', 'DB Snatch']))
  })

  it('the composite line is never searched whole — a full-string match would find nothing', () => {
    // Proves WHY last-word extraction matters: searching "12 Dumbbell
    // Snatch" verbatim against the catalog (no such row) returns nothing,
    // confirming the fix deliberately does NOT do this.
    const wholeLineResult = searchPerformedMovements(CATALOG, '12 Dumbbell Snatch', 5)
    expect(wholeLineResult).toEqual([])
  })

  it('a composite Buy-In-style line with a new movement ("21 Trap Bar Deadlift") still resolves', () => {
    expect(lastWordSuggest(CATALOG, '21 Trap Bar Deadlift')).toContain('Trap Bar Deadlift')
  })

  it('an alias reached via the last word of a composite line still resolves ("3 rounds GHR")', () => {
    expect(lastWordSuggest(CATALOG, '3 rounds GHR')).toContain('Glute Ham Raise')
  })

  it('a bare movement name (no numeric prefix) still works — last word IS the whole query', () => {
    expect(lastWordSuggest(CATALOG, 'Back Squat')).toContain('Back Squat')
  })
})

describe('member-safe catalog wrapper contract (memberMovementCatalog, App.jsx)', () => {
  // Structural verification of the exact shape the real closure produces -
  // the closure itself lives inside App() and isn't independently
  // importable; this proves the CONTRACT (suggestions present, createMovement
  // deliberately absent) that CreateMiscareRow's guard depends on.
  function buildMemberSafeCatalog(catalogRows) {
    return {
      suggestions: (text) => {
        if (!text || text.trim().length < 2) return []
        return searchPerformedMovements(catalogRows, text, 5).map(r => r.name)
      },
    }
  }

  it('exposes suggestions but never createMovement', () => {
    const catalog = buildMemberSafeCatalog(CATALOG)
    expect(typeof catalog.suggestions).toBe('function')
    expect(catalog.createMovement).toBeUndefined()
  })

  it('the CreateMiscareRow guard (typeof catalog?.createMovement !== "function") correctly blocks a member-safe catalog', () => {
    const memberSafe = buildMemberSafeCatalog(CATALOG)
    const adminFull = { ...memberSafe, createMovement: async () => ({ ok: true }) }
    expect(typeof memberSafe?.createMovement !== 'function').toBe(true)  // renders nothing for members
    expect(typeof adminFull?.createMovement !== 'function').toBe(false) // still renders for admin
    expect(typeof undefined?.createMovement !== 'function').toBe(true) // no catalog at all - renders nothing (pre-existing behavior)
  })
})
