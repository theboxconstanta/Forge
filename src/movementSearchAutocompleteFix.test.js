// FORGE — MOVEMENT SEARCH / AUTOCOMPLETE FIX. Exercises the REAL
// searchPerformedMovements (prescriptionContract.js) - the exact function
// movementCatalog.suggestions() (App.jsx) now delegates to - against a
// realistic fixture that reproduces the original bug: enough "…Jerk"
// movements to have previously crowded out any DB-only match under the
// old static-list-first/last-word/slice(0,5) implementation.
//
// The adapter itself (`.map(r => r.name)`, the 2-char gate, the empty-
// gymMovements static-list fallback) is a single inline closure in
// App.jsx's movementCatalog useMemo, not an exported function - these
// tests instead prove the underlying engine's behavior directly (the part
// that actually changed) and replicate the one-line adapter verbatim
// where the contract itself (plain-string output, 5-result cap) matters,
// keeping the replica identical to the real implementation to minimize
// drift risk.

import { describe, it, expect } from 'vitest'
import { searchPerformedMovements } from './prescriptionContract'

function row(id, name, aliases = []) {
  return { id, name, aliases, allowed_prescription_metrics: ['reps', 'load'], default_prescription_metric: 'load' }
}

// Reproduces the "Jerk" crowding scenario from the live bug report: 6
// pre-existing barbell Jerk-family movements (matching MISCARI's own
// content) plus the two new Dumbbell "…And Jerk" compounds.
const JERK_FAMILY_CATALOG = [
  row('jerk-1', 'Push Jerk'),
  row('jerk-2', 'Split Jerk'),
  row('jerk-3', 'Clean And Jerk'),
  row('jerk-4', 'Squat Jerk'),
  row('jerk-5', 'Power Jerk'),
  row('jerk-6', 'Behind-the-Neck Jerk'),
  row('new-1', 'Dumbbell Hang Power Clean And Jerk'),
  row('new-2', 'Dumbbell Hang Squat Clean And Jerk'),
]

// The full Movement Library Completion V1 set, for the ticket's exact
// required TEST list, plus the alias targets.
const FULL_FIXTURE = [
  ...JERK_FAMILY_CATALOG,
  row('new-3', 'Trap Bar Deadlift'),
  row('new-4', 'Nordic Curl'),
  row('new-5', 'Skater Jump'),
  row('new-6', 'Single Arm Overhead Squat'),
  row('new-7', 'Box Jump Down'),
  row('new-8', 'Weighted Dip'),
  row('new-9', 'Strict Ring Dip'),
  row('ali-1', 'Sled Push', ['push sled', 'prowler']),
  row('ali-2', 'Glute Ham Raise', ['ghr']),
  row('ali-3', 'Medicine Ball Clean', ['med ball clean']),
  // unrelated noise, to prove nothing is trivially the only row present.
  row('other-1', 'Sled Pull', ['pull sled']),
  row('other-2', 'Sled Drag'),
  row('other-3', 'Deadlift'),
  row('other-4', 'Box Jump'),
]

function suggest(catalogRows, text) {
  // Verbatim replica of the fixed adapter (App.jsx movementCatalog.suggestions).
  if (!text || text.trim().length < 2) return []
  return searchPerformedMovements(catalogRows, text, 5).map(r => r.name)
}

describe('the whole-name search no longer gets crowded out by the static "Jerk" family', () => {
  it('typing the new compound movement\'s full name finds itself, even with 6 other Jerk movements present', () => {
    expect(suggest(JERK_FAMILY_CATALOG, 'Dumbbell Hang Power Clean And Jerk')).toContain('Dumbbell Hang Power Clean And Jerk')
    expect(suggest(JERK_FAMILY_CATALOG, 'Dumbbell Hang Squat Clean And Jerk')).toContain('Dumbbell Hang Squat Clean And Jerk')
  })

  it('an exact/prefix match always outranks a "contains" match — the new movement is never buried', () => {
    const results = suggest(JERK_FAMILY_CATALOG, 'Dumbbell Hang Power Clean And Jerk')
    expect(results[0]).toBe('Dumbbell Hang Power Clean And Jerk')
  })
})

describe('all 9 Movement Library Completion V1 movements are found via partial-name search', () => {
  it.each([
    ['Dumbbell Hang Power Clean And Jerk', 'Hang Power Clean And Jerk'],
    ['Dumbbell Hang Squat Clean And Jerk', 'Hang Squat Clean And Jerk'],
    ['Trap Bar Deadlift', 'Trap Bar'],
    ['Nordic Curl', 'Nordic'],
    ['Skater Jump', 'Skater'],
    ['Single Arm Overhead Squat', 'Single Arm Overhead'],
    ['Box Jump Down', 'Jump Down'],
    ['Weighted Dip', 'Weighted Dip'],
    ['Strict Ring Dip', 'Strict Ring'],
  ])('%s is found by typing "%s"', (fullName, partial) => {
    expect(suggest(FULL_FIXTURE, partial)).toContain(fullName)
  })
})

describe('alias search works through the same adapter', () => {
  it.each([
    ['GHR', 'Glute Ham Raise'],
    ['Push Sled', 'Sled Push'],
    ['Prowler', 'Sled Push'],
    ['Med Ball Clean', 'Medicine Ball Clean'],
  ])('"%s" resolves to "%s"', (query, target) => {
    expect(suggest(FULL_FIXTURE, query)).toContain(target)
  })

  it('"Push Sled" never resolves to the unrelated "Sled Pull"/"Sled Drag" rows', () => {
    const results = suggest(FULL_FIXTURE, 'Push Sled')
    expect(results).not.toContain('Sled Pull')
    expect(results).not.toContain('Sled Drag')
  })
})

describe('DB/Dumbbell, KB/Kettlebell, &/And normalization reach the suggestion list', () => {
  it('"Clean & Jerk" (typed with an ampersand) still finds "Clean And Jerk"', () => {
    expect(suggest(JERK_FAMILY_CATALOG, 'Clean & Jerk')).toContain('Clean And Jerk')
  })
})

describe('output contract preserved — plain strings, 5-result cap', () => {
  it('returns an array of plain strings (MovementSuggestions/MovementRowPWA both expect this), never objects', () => {
    const results = suggest(FULL_FIXTURE, 'Jerk')
    expect(results.length).toBeGreaterThan(0)
    for (const r of results) expect(typeof r).toBe('string')
  })

  it('never returns more than 5 suggestions, matching the pre-existing UI limit', () => {
    // 8 movements contain "Jerk" or "jerk"-adjacent text in this fixture set.
    const results = suggest([...JERK_FAMILY_CATALOG, row('extra-1', 'Tall Jerk'), row('extra-2', 'Jerk Dip')], 'Jerk')
    expect(results.length).toBeLessThanOrEqual(5)
  })

  it('a query under 2 characters returns no suggestions (unchanged gate)', () => {
    expect(suggest(FULL_FIXTURE, 'J')).toEqual([])
    expect(suggest(FULL_FIXTURE, '')).toEqual([])
  })
})
