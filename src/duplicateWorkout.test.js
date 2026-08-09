import { describe, it, expect } from 'vitest'
import { addDaysToDateStr, resolveTargetDateOptions, buildDuplicateRows, toggleRowSelected, removeRow } from './duplicateWorkout'

describe('addDaysToDateStr', () => {
  it('adds days within the same month', () => {
    expect(addDaysToDateStr('2026-08-10', 3)).toBe('2026-08-13')
  })

  it('rolls over into the next month', () => {
    expect(addDaysToDateStr('2026-08-30', 3)).toBe('2026-09-02')
  })

  it('rolls over into the next year', () => {
    expect(addDaysToDateStr('2026-12-30', 3)).toBe('2027-01-02')
  })

  it('supports negative deltas', () => {
    expect(addDaysToDateStr('2026-08-10', -3)).toBe('2026-08-07')
  })
})

describe('resolveTargetDateOptions', () => {
  it('marks each candidate date as occupied or free from the given set', () => {
    const options = resolveTargetDateOptions(['2026-08-11', '2026-08-12', '2026-08-13'], new Set(['2026-08-12']))
    expect(options).toEqual([
      { date: '2026-08-11', hasExistingWod: false },
      { date: '2026-08-12', hasExistingWod: true },
      { date: '2026-08-13', hasExistingWod: false },
    ])
  })

  it('returns an empty list for an empty candidate list', () => {
    expect(resolveTargetDateOptions([], new Set())).toEqual([])
  })
})

describe('buildDuplicateRows', () => {
  it('defaults a free target date to selected', () => {
    const rows = buildDuplicateRows({}, [{ date: '2026-08-17', hasExistingWod: false }])
    expect(rows[0]).toEqual({ targetDate: '2026-08-17', targetHasExistingWod: false, selected: true })
  })

  it('defaults an already-occupied target date to NOT selected - explicit opt-in required to overwrite', () => {
    const rows = buildDuplicateRows({}, [{ date: '2026-08-17', hasExistingWod: true }])
    expect(rows[0]).toEqual({ targetDate: '2026-08-17', targetHasExistingWod: true, selected: false })
  })

  it('builds one row per target date', () => {
    const rows = buildDuplicateRows({}, [
      { date: '2026-08-17', hasExistingWod: false },
      { date: '2026-08-24', hasExistingWod: false },
    ])
    expect(rows.map(r => r.targetDate)).toEqual(['2026-08-17', '2026-08-24'])
  })
})

describe('toggleRowSelected', () => {
  it('flips only the matching row, leaving others untouched', () => {
    const rows = buildDuplicateRows({}, [
      { date: '2026-08-17', hasExistingWod: false },
      { date: '2026-08-24', hasExistingWod: false },
    ])
    const next = toggleRowSelected(rows, '2026-08-17')
    expect(next.find(r => r.targetDate === '2026-08-17').selected).toBe(false)
    expect(next.find(r => r.targetDate === '2026-08-24').selected).toBe(true)
  })
})

describe('removeRow', () => {
  it('removes only the matching row', () => {
    const rows = buildDuplicateRows({}, [
      { date: '2026-08-17', hasExistingWod: false },
      { date: '2026-08-24', hasExistingWod: false },
    ])
    const next = removeRow(rows, '2026-08-17')
    expect(next).toHaveLength(1)
    expect(next[0].targetDate).toBe('2026-08-24')
  })
})
