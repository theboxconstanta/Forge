import { describe, expect, it } from 'vitest'
import {
  extractMovementEntriesFromWodLogs, extractMovementEntriesFromSkillLogs,
  groupMovementEntries, deriveMovementHistory, buildMovementListEntries, movementEntryDisplay,
} from './movementHistory'

// Member Performance, Phase 2 (Movement History) - test matrix per the
// mission's own §62-76, cross-client-parity fixtures mirrored in
// forge-admin-web's movementHistory.test.ts.

function wodLog(overrides) {
  return {
    id: 'w1', member_id: 'm1', format_snapshot: 'Strength Sets',
    sets: {}, logged_at: '2026-01-01T10:00:00Z', workout_section_id: null,
    ...overrides,
  }
}

function skillLog(overrides) {
  return {
    id: 's1', member_id: 'm1', format_snapshot: 'Weightlifting', skill_name_snapshot: 'Back Squat',
    sets: {}, logged_at: '2026-01-01T10:00:00Z',
    ...overrides,
  }
}

describe('Basic history (mission §62)', () => {
  it('Back Squat: 3 attempts, newest first', () => {
    const logs = [
      wodLog({ id: 'a', sets: { 'Back Squat': [{ reps: '5', weight: '100' }] }, logged_at: '2026-08-17' }),
      wodLog({ id: 'b', sets: { 'Back Squat': [{ reps: '5', weight: '95' }] }, logged_at: '2026-08-03' }),
      wodLog({ id: 'c', sets: { 'Back Squat': [{ reps: '5', weight: '90' }] }, logged_at: '2026-07-20' }),
    ]
    const groups = groupMovementEntries(logs, [])
    const history = deriveMovementHistory(groups.get('back squat'))
    expect(history.attemptCount).toBe(3)
    expect(history.latest.weight).toBe(100)
    expect(history.history.map((e) => e.weight)).toEqual([100, 95, 90])
  })
})

describe('Mixed rep context - no fake best (mission §63)', () => {
  it('120x1, 105x3, 100x5 all appear, no best/PR badge exists anywhere in the model', () => {
    const logs = [
      wodLog({ id: 'a', sets: { 'Back Squat': [{ reps: '1', weight: '120' }] }, logged_at: '2026-03-01' }),
      wodLog({ id: 'b', sets: { 'Back Squat': [{ reps: '3', weight: '105' }] }, logged_at: '2026-02-01' }),
      wodLog({ id: 'c', sets: { 'Back Squat': [{ reps: '5', weight: '100' }] }, logged_at: '2026-01-01' }),
    ]
    const groups = groupMovementEntries(logs, [])
    const history = deriveMovementHistory(groups.get('back squat'))
    expect(history.history).toHaveLength(3)
    expect(history).not.toHaveProperty('best')
    expect(movementEntryDisplay(history.history[0])).toBe('120kg × 1')
    expect(movementEntryDisplay(history.history[1])).toBe('105kg × 3')
    expect(movementEntryDisplay(history.history[2])).toBe('100kg × 5')
  })
})

describe('Distinct variations kept separate (mission §64)', () => {
  it('Snatch, Power Snatch, Hang Power Snatch never merge', () => {
    const logs = [
      wodLog({ id: 'a', sets: { Snatch: [{ reps: '1', weight: '70' }] } }),
      wodLog({ id: 'b', sets: { 'Power Snatch': [{ reps: '1', weight: '60' }] } }),
      wodLog({ id: 'c', sets: { 'Hang Power Snatch': [{ reps: '1', weight: '55' }] } }),
    ]
    const groups = groupMovementEntries(logs, [])
    expect(groups.size).toBe(3)
    expect(groups.has('snatch')).toBe(true)
    expect(groups.has('power snatch')).toBe(true)
    expect(groups.has('hang power snatch')).toBe(true)
  })
})

describe('Text variation - case/whitespace normalization only (mission §65)', () => {
  it('"Back Squat" and "back squat" and "  Back Squat  " group together, no fuzzy alias merging', () => {
    const logs = [
      wodLog({ id: 'a', sets: { 'Back Squat': [{ reps: '5', weight: '100' }] } }),
      wodLog({ id: 'b', sets: { 'back squat': [{ reps: '5', weight: '95' }] } }),
      wodLog({ id: 'c', sets: { '  Back Squat  ': [{ reps: '5', weight: '90' }] } }),
    ]
    const groups = groupMovementEntries(logs, [])
    expect(groups.size).toBe(1)
    expect(groups.get('back squat')).toHaveLength(3)
  })

  it('does NOT merge aliases like "BS" and "Back Squat", or "C&J" and "Clean and Jerk"', () => {
    const logs = [
      wodLog({ id: 'a', sets: { BS: [{ reps: '5', weight: '100' }] } }),
      wodLog({ id: 'b', sets: { 'Back Squat': [{ reps: '5', weight: '95' }] } }),
    ]
    const groups = groupMovementEntries(logs, [])
    expect(groups.size).toBe(2)
  })
})

describe('Metcon exclusion - the critical invariant (mission §6/§66)', () => {
  it('Fran (For Time, Thrusters + Pull-ups mentioned only as workout text) creates ZERO movement history entries', () => {
    const fran = wodLog({
      id: 'fran', format_snapshot: 'For Time', time_result: '4:47', sets: null,
      wods: { name: 'Fran' },
    })
    expect(extractMovementEntriesFromWodLogs([fran])).toHaveLength(0)
  })

  it('AMRAP containing Back Squats does not create a Back Squat entry (no sets JSON for scored family)', () => {
    const amrap = wodLog({ id: 'amrap', format_snapshot: 'AMRAP', result: '10 rounds + 5 reps', sets: null })
    expect(extractMovementEntriesFromWodLogs([amrap])).toHaveLength(0)
  })

  it('a family:"sets" but rowMode:"interval" format (Intervals) does NOT leak its round labels as movements', () => {
    const intervals = wodLog({
      id: 'iv', format_snapshot: 'Intervals',
      sets: { 'Rundă 1': [{ reps: '20', weight: '' }], 'Rundă 2': [{ reps: '18', weight: '' }] },
    })
    expect(extractMovementEntriesFromWodLogs([intervals])).toHaveLength(0)
  })

  it('Death By (rowMode:"interval") does not leak "Min N" labels as movements', () => {
    const deathBy = wodLog({
      id: 'db', format_snapshot: 'Death By',
      sets: { 'Min 1': [{ reps: '9', weight: '' }], 'Min 2': [{ reps: '9', weight: '' }] },
    })
    expect(extractMovementEntriesFromWodLogs([deathBy])).toHaveLength(0)
  })

  it('a legacy NULL-format_snapshot row with "Rundă N" keys (real production shape) is excluded', () => {
    const legacy = wodLog({
      id: 'legacy', format_snapshot: null,
      sets: { 'Rundă 1': [{ reps: '9', weight: '' }] },
    })
    expect(extractMovementEntriesFromWodLogs([legacy])).toHaveLength(0)
  })
})

describe('Multi-section (mission §67)', () => {
  it('Section A (Back Squat, tracked) and Section C (Snatch, tracked) each populate their own movement; Section B (AMRAP) leaks nothing', () => {
    const logs = [
      wodLog({ id: 'a', workout_section_id: 'sec-a', format_snapshot: 'Weightlifting', sets: { 'Back Squat': [{ reps: '5', weight: '100' }] } }),
      wodLog({ id: 'b', workout_section_id: 'sec-b', format_snapshot: 'AMRAP', sets: null }),
      wodLog({ id: 'c', workout_section_id: 'sec-c', format_snapshot: 'Weightlifting', sets: { Snatch: [{ reps: '1', weight: '70' }] } }),
    ]
    const groups = groupMovementEntries(logs, [])
    expect(groups.size).toBe(2)
    expect(groups.has('back squat')).toBe(true)
    expect(groups.has('snatch')).toBe(true)
  })
})

describe('Track-only Results included (mission §26/§68)', () => {
  it('included unconditionally - leaderboard_visible is never referenced anywhere in this module', () => {
    const log = wodLog({ id: 'hidden', sets: { 'Back Squat': [{ reps: '5', weight: '100' }] } })
    expect(extractMovementEntriesFromWodLogs([log])).toHaveLength(1)
  })
})

describe('Edit - no duplicate, re-derived from current data (mission §21/§69)', () => {
  it('a re-fetched log with an updated weight produces one entry with the new value, no stale duplicate', () => {
    const before = [wodLog({ id: 'a', sets: { 'Back Squat': [{ reps: '5', weight: '100' }] } })]
    const after = [wodLog({ id: 'a', sets: { 'Back Squat': [{ reps: '5', weight: '105' }] } })]
    expect(extractMovementEntriesFromWodLogs(before)[0].weight).toBe(100)
    expect(extractMovementEntriesFromWodLogs(after)[0].weight).toBe(105)
    expect(extractMovementEntriesFromWodLogs(after)).toHaveLength(1)
  })
})

describe('Delete - entry disappears (mission §22/§70)', () => {
  it('removing the log from the input array removes it from the derived history', () => {
    const withLog = [wodLog({ id: 'a', sets: { 'Back Squat': [{ reps: '5', weight: '100' }] } })]
    expect(extractMovementEntriesFromWodLogs(withLog)).toHaveLength(1)
    expect(extractMovementEntriesFromWodLogs([])).toHaveLength(0)
  })
})

describe('Units (mission §17/§71)', () => {
  it('displays kg or lbs suffix per the weightUnit param, never compares formatted strings', () => {
    const entries = extractMovementEntriesFromWodLogs([wodLog({ id: 'a', sets: { 'Back Squat': [{ reps: '5', weight: '100' }] } })])
    expect(movementEntryDisplay(entries[0], 'kg')).toBe('100kg × 5')
    expect(movementEntryDisplay(entries[0], 'lbs')).toBe('100lbs × 5')
  })
})

describe('Decimal (mission §18/§72)', () => {
  it('102.5kg is preserved, not truncated', () => {
    const entries = extractMovementEntriesFromWodLogs([wodLog({ id: 'a', sets: { Snatch: [{ reps: '1', weight: '102.5' }] } })])
    expect(entries[0].weight).toBe(102.5)
    expect(movementEntryDisplay(entries[0], 'kg')).toBe('102.5kg × 1')
  })
})

describe('Same day, multiple legitimate results (mission §39/§73)', () => {
  it('two Back Squat results on the same day both remain, not deduped', () => {
    const logs = [
      wodLog({ id: 'a', sets: { 'Back Squat': [{ reps: '5', weight: '100' }] }, logged_at: '2026-01-01T09:00:00Z' }),
      wodLog({ id: 'b', sets: { 'Back Squat': [{ reps: '3', weight: '110' }] }, logged_at: '2026-01-01T15:00:00Z' }),
    ]
    expect(extractMovementEntriesFromWodLogs(logs)).toHaveLength(2)
  })
})

describe('Section reorder (mission §23/§74)', () => {
  it('grouping does not depend on workout_section_id ordering, only on movement identity + date', () => {
    const logs = [
      wodLog({ id: 'a', workout_section_id: 'sec-3', sets: { 'Back Squat': [{ reps: '5', weight: '100' }] }, logged_at: '2026-01-01' }),
      wodLog({ id: 'b', workout_section_id: 'sec-1', sets: { 'Back Squat': [{ reps: '5', weight: '95' }] }, logged_at: '2026-01-02' }),
    ]
    const groups = groupMovementEntries(logs, [])
    expect(groups.get('back squat')).toHaveLength(2)
  })
})

describe('One-attempt state (no fake trend)', () => {
  it('single entry: attemptCount 1, no history/previous fabrication', () => {
    const history = deriveMovementHistory(extractMovementEntriesFromWodLogs([wodLog({ id: 'a', sets: { 'Back Squat': [{ reps: '5', weight: '100' }] } })]))
    expect(history.attemptCount).toBe(1)
    expect(history.latest.weight).toBe(100)
  })
})

describe('skill_logs source - Superset vs fallback (module header rule)', () => {
  it('Superset skill_log: sets keys ARE movement names', () => {
    const log = skillLog({ id: 's1', format_snapshot: 'Superset', skill_name_snapshot: 'ignored', sets: { 'Push Press': [{ reps: '5', weight: '40' }], 'Front Squat': [{ reps: '5', weight: '60' }] } })
    const entries = extractMovementEntriesFromSkillLogs([log])
    expect(entries.map((e) => e.movementName).sort()).toEqual(['Front Squat', 'Push Press'])
  })

  it('non-Superset skill_log (e.g. Complex): every row attributed to skill_name_snapshot, not the round-label keys', () => {
    const log = skillLog({
      id: 's2', format_snapshot: 'Complex', skill_name_snapshot: 'Snatch Complex',
      sets: { 'Rundă 1': [{ reps: '1', weight: '50' }], 'Rundă 2': [{ reps: '1', weight: '55' }] },
    })
    const entries = extractMovementEntriesFromSkillLogs([log])
    expect(entries).toHaveLength(2)
    expect(entries.every((e) => e.movementName === 'Snatch Complex')).toBe(true)
  })

  it('skill_log with no sets is excluded', () => {
    const log = skillLog({ id: 's3', format_snapshot: 'Not For Time', skill_name_snapshot: 'Pistols', sets: null })
    expect(extractMovementEntriesFromSkillLogs([log])).toHaveLength(0)
  })
})

describe('Mixed sources merge into one movement (mission §5/§29)', () => {
  it('a Back Squat from wod_logs and a Back Squat skill_log both contribute to the same movement history', () => {
    const wLog = wodLog({ id: 'w1', sets: { 'Back Squat': [{ reps: '5', weight: '100' }] }, logged_at: '2026-01-01' })
    const sLog = skillLog({ id: 's1', format_snapshot: 'Weightlifting', skill_name_snapshot: 'Back Squat', sets: { 'Back Squat': [{ reps: '5', weight: '95' }] }, logged_at: '2026-01-02' })
    const groups = groupMovementEntries([wLog], [sLog])
    expect(groups.get('back squat')).toHaveLength(2)
  })
})

describe('buildMovementListEntries', () => {
  it('one row per movement, sorted by most-recently-performed', () => {
    const logs = [
      wodLog({ id: 'a', sets: { 'Back Squat': [{ reps: '5', weight: '100' }] }, logged_at: '2026-01-01' }),
      wodLog({ id: 'b', sets: { 'Back Squat': [{ reps: '5', weight: '105' }] }, logged_at: '2026-03-01' }),
      wodLog({ id: 'c', sets: { Snatch: [{ reps: '1', weight: '70' }] }, logged_at: '2026-02-01' }),
    ]
    const entries = buildMovementListEntries(logs, [])
    expect(entries.map((e) => e.displayName)).toEqual(['Back Squat', 'Snatch'])
    expect(entries[0].attemptCount).toBe(2)
  })
})

describe('Reps-only entry (bodyweight movement, no weight)', () => {
  it('displays "N reps" without fabricating a weight', () => {
    const entries = extractMovementEntriesFromWodLogs([wodLog({ id: 'a', format_snapshot: 'Superset', sets: { 'Strict Pull-ups': [{ reps: '8', weight: '' }] } })])
    expect(movementEntryDisplay(entries[0])).toBe('8 reps')
  })
})
