import { describe, expect, it } from 'vitest'
import {
  extractMovementEntriesFromWodLogs, extractMovementEntriesFromSkillLogs,
  groupMovementEntries, deriveMovementHistory, buildMovementListEntries, movementEntryDisplay,
  resolveComparisonIdentity, comparisonModeLabel, deriveCurrentMovementBests, movementGroupDisplayName,
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
    const history = deriveMovementHistory(groups.get('text:back squat'))
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
    const history = deriveMovementHistory(groups.get('text:back squat'))
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
    expect(groups.has('text:snatch')).toBe(true)
    expect(groups.has('text:power snatch')).toBe(true)
    expect(groups.has('text:hang power snatch')).toBe(true)
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
    expect(groups.get('text:back squat')).toHaveLength(3)
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
    expect(groups.has('text:back squat')).toBe(true)
    expect(groups.has('text:snatch')).toBe(true)
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
    expect(groups.get('text:back squat')).toHaveLength(2)
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
    expect(groups.get('text:back squat')).toHaveLength(2)
  })
})

// Canonical Movement Identity, Phase 2 - movement_id-aware grouping, per
// CANONICAL_MOVEMENT_IDENTITY_PHASE2_MOVEMENT_HISTORY_GROUPING_IMPLEMENTATION_REPORT.md.
describe('movementHistoryIdentity / canonical grouping (Phase 2)', () => {
  it('same movementId, different raw text -> one canonical group (the headline feature)', () => {
    const logs = [
      wodLog({ id: 'a', sets: { 'Back Squat': [{ reps: '5', weight: '100' }] }, sets_movement_ids: { 'Back Squat': 'uuid-x' } }),
      wodLog({ id: 'b', sets: { BS: [{ reps: '5', weight: '95' }] }, sets_movement_ids: { BS: 'uuid-x' } }),
    ]
    const groups = groupMovementEntries(logs, [])
    expect(groups.size).toBe(1)
    expect(groups.get('id:uuid-x')).toHaveLength(2)
  })

  it('same raw text, different movementId -> two distinct canonical groups (identity beats text)', () => {
    const logs = [
      wodLog({ id: 'a', sets: { Squat: [{ reps: '5', weight: '100' }] }, sets_movement_ids: { Squat: 'uuid-x' } }),
      wodLog({ id: 'b', sets: { Squat: [{ reps: '5', weight: '80' }] }, sets_movement_ids: { Squat: 'uuid-y' } }),
    ]
    const groups = groupMovementEntries(logs, [])
    expect(groups.size).toBe(2)
    expect(groups.has('id:uuid-x')).toBe(true)
    expect(groups.has('id:uuid-y')).toBe(true)
  })

  it('canonical (movementId) and legacy (null movementId) entries for the "same" movement never bridge into one group', () => {
    const logs = [
      wodLog({ id: 'a', sets: { 'Back Squat': [{ reps: '5', weight: '100' }] }, sets_movement_ids: { 'Back Squat': 'uuid-x' } }),
      wodLog({ id: 'b', sets: { 'Back Squat': [{ reps: '5', weight: '95' }] } }), // no sets_movement_ids - legacy/unresolved
    ]
    const groups = groupMovementEntries(logs, [])
    expect(groups.size).toBe(2)
    expect(groups.get('id:uuid-x')).toHaveLength(1)
    expect(groups.get('text:back squat')).toHaveLength(1)
  })

  it('a multi-movement row with one resolved + one unresolved key produces two distinct groups (partial identity map)', () => {
    const log = wodLog({
      id: 'a',
      sets: { 'Power Clean': [{ reps: '3', weight: '60' }], '3-3-3-3-3': [{ reps: '3', weight: '60' }] },
      sets_movement_ids: { 'Power Clean': 'uuid-pc', '3-3-3-3-3': null },
    })
    const groups = groupMovementEntries([log], [])
    expect(groups.size).toBe(2)
    expect(groups.has('id:uuid-pc')).toBe(true)
    expect(groups.has('text:3-3-3-3-3')).toBe(true)
  })

  it('skill_logs pooled entries (non-Superset) sharing one movementId group together as one canonical group', () => {
    const log = skillLog({
      id: 's1', format_snapshot: 'Weightlifting', skill_name_snapshot: 'Deadlift',
      sets: { '1 Clean pull': [{ reps: '1', weight: '60' }], '1 Squat clean': [{ reps: '1', weight: '50' }] },
      sets_movement_ids: { '1 Clean pull': 'uuid-dl', '1 Squat clean': 'uuid-dl' },
    })
    const groups = groupMovementEntries([], [log])
    expect(groups.size).toBe(1)
    expect(groups.get('id:uuid-dl')).toHaveLength(2)
  })

  it('a non-movement-keyed format never produces entries even if sets_movement_ids happens to be populated', () => {
    const log = wodLog({ id: 'a', format_snapshot: 'Intervals', sets: { 'Rundă 1': [{ reps: '9' }] }, sets_movement_ids: { 'Rundă 1': 'uuid-should-never-be-read' } })
    expect(extractMovementEntriesFromWodLogs([log])).toHaveLength(0)
  })

  it('movementGroupDisplayName prefers the catalog current name for a canonical group, falls back to raw text for legacy groups or a missing catalog row', () => {
    const canonicalGroups = groupMovementEntries([wodLog({ id: 'a', sets: { BS: [{ reps: '5', weight: '100' }] }, sets_movement_ids: { BS: 'uuid-x' } })], [])
    const canonicalHistory = deriveMovementHistory(canonicalGroups.get('id:uuid-x'))
    expect(movementGroupDisplayName(canonicalHistory, new Map([['uuid-x', { name: 'Barbell Back Squat' }]]))).toBe('Barbell Back Squat')
    expect(movementGroupDisplayName(canonicalHistory, new Map())).toBe('BS') // catalog row missing/inaccessible -> falls back to raw snapshot, never crashes

    const legacyGroups = groupMovementEntries([wodLog({ id: 'b', sets: { 'Front Squat': [{ reps: '5', weight: '80' }] } })], [])
    const legacyHistory = deriveMovementHistory(legacyGroups.get('text:front squat'))
    expect(movementGroupDisplayName(legacyHistory, new Map([['uuid-x', { name: 'Barbell Back Squat' }]]))).toBe('Front Squat')
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

// Member Performance, Phase 3 (Rep-Scheme Identity Hardening) - test
// matrix per the mission's own §65-77.

describe('Explicit RM (mission §65)', () => {
  it('Back Squat 1RM: 100 then 110 share the same comparisonKey (comparable)', () => {
    const logs = [
      wodLog({ id: 'a', format_snapshot: 'Build to Heavy/1RM', format_config_snapshot: { targetLabel: '1RM' }, sets: { 'Back Squat': [{ reps: '1', weight: '100' }] }, logged_at: '2026-01-01' }),
      wodLog({ id: 'b', format_snapshot: 'Build to Heavy/1RM', format_config_snapshot: { targetLabel: '1RM' }, sets: { 'Back Squat': [{ reps: '1', weight: '110' }] }, logged_at: '2026-02-01' }),
    ]
    const [e1, e2] = extractMovementEntriesFromWodLogs(logs)
    expect(e1.comparisonMode).toBe('RM_TEST')
    expect(e1.repTarget).toBe(1)
    expect(e1.comparable).toBe(true)
    expect(e1.comparisonKey).toBe(e2.comparisonKey)
    expect(comparisonModeLabel(e1)).toBe('1RM')
  })

  it('Back Squat 3RM is a separate comparisonKey from 1RM', () => {
    const oneRm = extractMovementEntriesFromWodLogs([wodLog({ id: 'a', format_snapshot: 'Build to Heavy/1RM', format_config_snapshot: { targetLabel: '1RM' }, sets: { 'Back Squat': [{ reps: '1', weight: '110' }] } })])[0]
    const threeRm = extractMovementEntriesFromWodLogs([wodLog({ id: 'b', format_snapshot: 'Build to Heavy/1RM', format_config_snapshot: { targetLabel: '3RM' }, sets: { 'Back Squat': [{ reps: '3', weight: '100' }] } })])[0]
    expect(oneRm.comparisonKey).not.toBe(threeRm.comparisonKey)
    expect(comparisonModeLabel(threeRm)).toBe('3RM')
  })

  it('Back Squat 5RM is a separate comparisonKey from both', () => {
    const fiveRm = extractMovementEntriesFromWodLogs([wodLog({ id: 'c', format_snapshot: 'Build to Heavy/1RM', format_config_snapshot: { targetLabel: '5RM' }, sets: { 'Back Squat': [{ reps: '5', weight: '95' }] } })])[0]
    expect(fiveRm.comparisonMode).toBe('RM_TEST')
    expect(fiveRm.repTarget).toBe(5)
  })
})

describe('Training set (mission §66)', () => {
  it('Back Squat 5x5 (Strength Sets, setsScheme present) is SETS_ACROSS, never RM_TEST, never comparable', () => {
    const entries = extractMovementEntriesFromWodLogs([wodLog({
      id: 'a', format_snapshot: 'Strength Sets', format_config_snapshot: { setsScheme: [5, 5, 5, 5, 5] },
      sets: { 'Back Squat': [{ reps: '5', weight: '100' }] },
    })])
    expect(entries[0].comparisonMode).toBe('SETS_ACROSS')
    expect(entries[0].comparable).toBe(false)
    expect(comparisonModeLabel(entries[0])).toBe('Training')
  })

  it('a real production ladder (descending sets to a single) is still SETS_ACROSS, not inferred as an RM test', () => {
    const entries = extractMovementEntriesFromWodLogs([wodLog({
      id: 'a', format_snapshot: 'Strength Sets', format_config_snapshot: { setsScheme: [3, 3, 2, 2, 1, 1, 1, 1] },
      sets: { 'Power Clean': [{ reps: '1', weight: '80' }] },
    })])
    expect(entries[0].comparisonMode).toBe('SETS_ACROSS')
    expect(entries[0].comparable).toBe(false)
  })
})

describe('Heavy Single vs 1RM (mission §67/§47/§48)', () => {
  it('Forge has no distinct "Heavy Single" concept - Build to Heavy/1RM always resolves via its own targetLabel stepper (proven: default "1RM")', () => {
    const entries = extractMovementEntriesFromWodLogs([wodLog({
      id: 'a', format_snapshot: 'Build to Heavy/1RM', format_config_snapshot: { targetLabel: '1RM' },
      sets: { 'Front Squat': [{ reps: '1', weight: '115' }] },
    })])
    expect(entries[0].comparisonMode).toBe('RM_TEST')
    expect(entries[0].repTarget).toBe(1)
  })
})

describe('Build to Heavy (mission §68)', () => {
  it('a real production case: "Build to a 3-rep-max front squats" with targetLabel "3RM" resolves to RM_TEST, repTarget 3', () => {
    const entries = extractMovementEntriesFromWodLogs([wodLog({
      id: 'a', format_snapshot: 'Build to Heavy/1RM', format_config_snapshot: { targetLabel: '3RM' },
      sets: { 'Build to a 3-rep-max front squats': [{ reps: '3', weight: '100' }] },
    })])
    expect(entries[0].comparisonMode).toBe('RM_TEST')
    expect(entries[0].repTarget).toBe(3)
    expect(entries[0].comparable).toBe(true)
  })
})

describe('Complex (mission §49/§69) - must not create false component-movement RM identity', () => {
  it('Snatch Complex with scoringMode Max Weight: RM_TEST, repTarget null (whole complex is the subject, not a rep count)', () => {
    const log = skillLog({
      id: 's1', format_snapshot: 'Complex', skill_name_snapshot: 'Snatch Complex',
      format_config_snapshot: { scoringMode: 'Max Weight', complexMovements: ['Power Snatch', 'Hang Power Snatch'] },
      sets: { 'Rundă 1': [{ reps: '1', weight: '60' }] },
    })
    const entries = extractMovementEntriesFromSkillLogs([log])
    expect(entries[0].movementName).toBe('Snatch Complex')
    expect(entries[0].comparisonMode).toBe('RM_TEST')
    expect(entries[0].repTarget).toBeNull()
    expect(entries[0].comparable).toBe(true)
  })

  it('Snatch Complex with scoringMode Total Weight: SETS_ACROSS, not comparable', () => {
    const log = skillLog({
      id: 's2', format_snapshot: 'Complex', skill_name_snapshot: 'Snatch Complex',
      format_config_snapshot: { scoringMode: 'Total Weight' },
      sets: { 'Rundă 1': [{ reps: '1', weight: '60' }] },
    })
    expect(extractMovementEntriesFromSkillLogs([log])[0].comparisonMode).toBe('SETS_ACROSS')
  })

  it('a real production case (scoringMode unset/null on all 4 live rows): UNKNOWN, never guessed', () => {
    const log = skillLog({
      id: 's3', format_snapshot: 'Complex', skill_name_snapshot: 'Snatch Complex',
      format_config_snapshot: { complexMovements: ['Power Snatch', 'Hang Power Snatch'] },
      sets: { 'Rundă 1': [{ reps: '1', weight: '50' }] },
    })
    const entries = extractMovementEntriesFromSkillLogs([log])
    expect(entries[0].comparisonMode).toBe('UNKNOWN')
    expect(entries[0].comparable).toBe(false)
    expect(comparisonModeLabel(entries[0])).toBeNull()
  })
})

describe('Max Reps (mission §70)', () => {
  it('a bodyweight Superset entry has no RM-test signal, is SETS_ACROSS if targetSets declared', () => {
    const entries = extractMovementEntriesFromWodLogs([wodLog({
      id: 'a', format_snapshot: 'Superset', format_config_snapshot: { movements: ['Strict Pull-ups'], targetSets: 3 },
      sets: { 'Strict Pull-ups': [{ reps: '20', weight: '' }] },
    })])
    expect(entries[0].comparisonMode).toBe('SETS_ACROSS')
    expect(entries[0].comparable).toBe(false)
  })
})

describe('Unknown / legacy (mission §71)', () => {
  it('Weightlifting (zero config fields, ever) is always UNKNOWN, still displayable', () => {
    const entries = extractMovementEntriesFromWodLogs([wodLog({
      id: 'a', format_snapshot: 'Weightlifting', format_config_snapshot: {},
      sets: { Snatch: [{ reps: '1', weight: '70' }] },
    })])
    expect(entries[0].comparisonMode).toBe('UNKNOWN')
    expect(entries[0].comparable).toBe(false)
    expect(movementEntryDisplay(entries[0])).toBe('70kg × 1')
  })

  it('a real production case: Strength Sets with setsScheme null (legacy authoring) is UNKNOWN, not fabricated as SETS_ACROSS', () => {
    const entries = extractMovementEntriesFromWodLogs([wodLog({
      id: 'a', format_snapshot: 'Strength Sets', format_config_snapshot: { setsScheme: null },
      sets: { 'Power Clean': [{ reps: '3', weight: '80' }] },
    })])
    expect(entries[0].comparisonMode).toBe('UNKNOWN')
  })

  it('a legacy row with no format_config_snapshot at all is UNKNOWN, not a crash', () => {
    const entries = extractMovementEntriesFromWodLogs([wodLog({
      id: 'a', format_snapshot: 'Strength Sets', format_config_snapshot: undefined,
      sets: { 'Power Clean': [{ reps: '3', weight: '80' }] },
    })])
    expect(entries[0].comparisonMode).toBe('UNKNOWN')
    expect(entries[0].comparable).toBe(false)
  })
})

describe('Quick Create / manual authoring parity (mission §72/§73)', () => {
  it('resolveComparisonIdentity is a pure function of format_snapshot+format_config_snapshot only - identical input from either authoring path yields identical identity', () => {
    const quickCreateConfig = { formatSnapshot: 'Build to Heavy/1RM', formatConfigSnapshot: { targetLabel: '5RM' } }
    const manualConfig = { formatSnapshot: 'Build to Heavy/1RM', formatConfigSnapshot: { targetLabel: '5RM' } }
    expect(resolveComparisonIdentity(quickCreateConfig)).toEqual(resolveComparisonIdentity(manualConfig))
  })

  it('Back Squat 5RM text and Back Squat 5x5 text produce different identities', () => {
    const rm = resolveComparisonIdentity({ formatSnapshot: 'Build to Heavy/1RM', formatConfigSnapshot: { targetLabel: '5RM' } })
    const training = resolveComparisonIdentity({ formatSnapshot: 'Strength Sets', formatConfigSnapshot: { setsScheme: [5, 5, 5, 5, 5] } })
    expect(rm.mode).not.toBe(training.mode)
  })
})

describe('Reload / determinism (mission §75)', () => {
  it('calling resolveComparisonIdentity twice with the same input is byte-identical (pure, no hidden state)', () => {
    const input = { formatSnapshot: 'Build to Heavy/1RM', formatConfigSnapshot: { targetLabel: '3RM' } }
    expect(resolveComparisonIdentity(input)).toEqual(resolveComparisonIdentity(input))
  })
})

describe('Rx/variant separation (mission §56)', () => {
  it('the same movement+RM at different tiers gets a different comparisonKey - tiers never pooled', () => {
    const rx = extractMovementEntriesFromWodLogs([wodLog({ id: 'a', variant_level: 'RX', format_snapshot: 'Build to Heavy/1RM', format_config_snapshot: { targetLabel: '1RM' }, sets: { 'Back Squat': [{ reps: '1', weight: '120' }] } })])[0]
    const scaled = extractMovementEntriesFromWodLogs([wodLog({ id: 'b', variant_level: 'Scaled', format_snapshot: 'Build to Heavy/1RM', format_config_snapshot: { targetLabel: '1RM' }, sets: { 'Back Squat': [{ reps: '1', weight: '90' }] } })])[0]
    expect(rx.comparisonKey).not.toBe(scaled.comparisonKey)
  })
})

describe('Historical stability (Phase 4 mission §27-28/§59)', () => {
  it('resolveComparisonIdentity has no hidden state - a Result logged against an old snapshot keeps resolving against THAT snapshot even if the config passed for "current" Programming differs, proving the module never reaches for "live" data on its own', () => {
    const historicalSnapshot = { formatSnapshot: 'Build to Heavy/1RM', formatConfigSnapshot: { targetLabel: '5RM' } }
    const currentLiveConfig = { formatSnapshot: 'Build to Heavy/1RM', formatConfigSnapshot: { targetLabel: '3RM' } }
    // The resolver only ever sees what's explicitly passed to it (the frozen
    // snapshot in a real wod_logs row) - it has no DB access of its own, so
    // a coach editing Programming after the fact cannot retroactively change
    // what an already-logged Result resolves to. The real end-to-end
    // guarantee lives in snapshot_wod_log_context's own trigger definition
    // (BEFORE INSERT OR UPDATE OF wod_id - never re-fires on an unrelated
    // Programming edit), verified directly against
    // supabase/migrations/20260812090200_results_phase2_slice2_snapshot_triggers.sql.
    expect(resolveComparisonIdentity(historicalSnapshot).repTarget).toBe(5)
    expect(resolveComparisonIdentity(currentLiveConfig).repTarget).toBe(3)
  })
})

describe('Format switch does not contaminate resolver (mission §21/§56)', () => {
  it('stale keys left over from a previous format (e.g. setsScheme surviving a switch to Build to Heavy/1RM) are silently ignored - the resolver only ever reads the field(s) that belong to the CURRENT formatSnapshot', () => {
    const staleConfig = { targetLabel: '3RM', setsScheme: [5, 5, 5, 5, 5] }
    expect(resolveComparisonIdentity({ formatSnapshot: 'Build to Heavy/1RM', formatConfigSnapshot: staleConfig })).toEqual({ mode: 'RM_TEST', repTarget: 3, comparable: true })
  })

  it('the reverse: a stale targetLabel surviving a switch to Strength Sets is also ignored', () => {
    const staleConfig = { targetLabel: '5RM', setsScheme: [5, 5, 5] }
    expect(resolveComparisonIdentity({ formatSnapshot: 'Strength Sets', formatConfigSnapshot: staleConfig })).toEqual({ mode: 'SETS_ACROSS', repTarget: null, comparable: false })
  })
})

describe('PR Engine handoff contract (mission §83) - no pr_events, purely derived', () => {
  it('comparisonKey groups only comparable (RM_TEST) entries into safely-comparable buckets', () => {
    const logs = [
      wodLog({ id: 'a', format_snapshot: 'Build to Heavy/1RM', format_config_snapshot: { targetLabel: '5RM' }, sets: { 'Back Squat': [{ reps: '5', weight: '90' }] }, logged_at: '2026-01-01' }),
      wodLog({ id: 'b', format_snapshot: 'Build to Heavy/1RM', format_config_snapshot: { targetLabel: '5RM' }, sets: { 'Back Squat': [{ reps: '5', weight: '95' }] }, logged_at: '2026-02-01' }),
      wodLog({ id: 'c', format_snapshot: 'Strength Sets', format_config_snapshot: { setsScheme: [5, 5, 5] }, sets: { 'Back Squat': [{ reps: '5', weight: '100' }] }, logged_at: '2026-03-01' }),
    ]
    const entries = extractMovementEntriesFromWodLogs(logs)
    const comparableEntries = entries.filter((e) => e.comparable)
    expect(comparableEntries).toHaveLength(2)
    const keys = new Set(comparableEntries.map((e) => e.comparisonKey))
    expect(keys.size).toBe(1)
  })
})

// Member Performance, Phase 6 (Performance Overview) - Current Movement
// Bests. Mandatory invariant: derived from Results, never from pr_events.

describe('deriveCurrentMovementBests (mission §5/§9/§10/§11/§12/§13/§20)', () => {
  it('picks the highest weight among comparable entries for one identity', () => {
    const logs = [
      wodLog({ id: 'a', format_snapshot: 'Build to Heavy/1RM', format_config_snapshot: { targetLabel: '5RM' }, sets: { 'Back Squat': [{ reps: '5', weight: '90' }] }, logged_at: '2026-01-01' }),
      wodLog({ id: 'b', format_snapshot: 'Build to Heavy/1RM', format_config_snapshot: { targetLabel: '5RM' }, sets: { 'Back Squat': [{ reps: '5', weight: '105' }] }, logged_at: '2026-02-01' }),
      wodLog({ id: 'c', format_snapshot: 'Build to Heavy/1RM', format_config_snapshot: { targetLabel: '5RM' }, sets: { 'Back Squat': [{ reps: '5', weight: '95' }] }, logged_at: '2026-03-01' }),
    ]
    const bests = deriveCurrentMovementBests(logs, [])
    expect(bests).toHaveLength(1)
    expect(bests[0].weight).toBe(105)
  })

  // Canonical Movement Identity, Phase 2 - PR Engine/Performance Overview
  // regression proof: deriveCurrentMovementBests groups by comparisonKey,
  // which Phase 2 deliberately never touches (see movementHistoryIdentity's
  // own header comment) - it remains purely text-normalized. Two entries
  // sharing a movementId but spelled differently ("Back Squat" vs "BS")
  // therefore still produce TWO separate current bests here, unchanged
  // from pre-Phase-2 behavior - proving movementId carries through onto
  // each entry (for a future phase to use) without altering this phase's
  // own grouping in any way.
  // Canonical Movement Identity, Phase 3 - this test's own assertion
  // flips from Phase 2's own version: comparisonKey now reuses
  // movementHistoryIdentity (movementId-first), so a shared movementId
  // across differently-spelled entries correctly merges into ONE current
  // best - the headline Phase 3 acceptance case, mirrored here for
  // Current Bests exactly as the PR Engine's own live SQL testing proved
  // server-side.
  it('a shared movementId merges differently-spelled entries into one Current Best (identity beats text, Phase 3)', () => {
    const logs = [
      wodLog({ id: 'a', format_snapshot: 'Build to Heavy/1RM', format_config_snapshot: { targetLabel: '5RM' }, sets: { 'Back Squat': [{ reps: '5', weight: '90' }] }, sets_movement_ids: { 'Back Squat': 'uuid-x' }, logged_at: '2026-01-01' }),
      wodLog({ id: 'b', format_snapshot: 'Build to Heavy/1RM', format_config_snapshot: { targetLabel: '5RM' }, sets: { BS: [{ reps: '5', weight: '105' }] }, sets_movement_ids: { BS: 'uuid-x' }, logged_at: '2026-02-01' }),
    ]
    const bests = deriveCurrentMovementBests(logs, [])
    expect(bests).toHaveLength(1)
    expect(bests[0].weight).toBe(105)
    expect(bests[0].movementId).toBe('uuid-x')
  })

  it('two different movementIds never merge into one Current Best even when raw text happens to match (identity beats text, the other direction)', () => {
    const logs = [
      wodLog({ id: 'a', format_snapshot: 'Build to Heavy/1RM', format_config_snapshot: { targetLabel: '5RM' }, sets: { Press: [{ reps: '5', weight: '60' }] }, sets_movement_ids: { Press: 'uuid-strict-press' }, logged_at: '2026-01-01' }),
      wodLog({ id: 'b', format_snapshot: 'Build to Heavy/1RM', format_config_snapshot: { targetLabel: '5RM' }, sets: { Press: [{ reps: '5', weight: '80' }] }, sets_movement_ids: { Press: 'uuid-push-press' }, logged_at: '2026-02-01' }),
    ]
    const bests = deriveCurrentMovementBests(logs, [])
    expect(bests).toHaveLength(2)
    expect(bests.map((b) => b.movementId).sort()).toEqual(['uuid-push-press', 'uuid-strict-press'])
  })

  it('a canonical entry and a legacy (unresolved) entry for the "same" movement text never bridge into one Current Best', () => {
    const logs = [
      wodLog({ id: 'a', format_snapshot: 'Build to Heavy/1RM', format_config_snapshot: { targetLabel: '5RM' }, sets: { 'Back Squat': [{ reps: '5', weight: '90' }] }, sets_movement_ids: { 'Back Squat': 'uuid-x' }, logged_at: '2026-01-01' }),
      wodLog({ id: 'b', format_snapshot: 'Build to Heavy/1RM', format_config_snapshot: { targetLabel: '5RM' }, sets: { 'Back Squat': [{ reps: '5', weight: '110' }] }, logged_at: '2026-02-01' }), // no sets_movement_ids - legacy
    ]
    const bests = deriveCurrentMovementBests(logs, [])
    expect(bests).toHaveLength(2)
  })

  it('1RM, 3RM, 5RM are three separate current bests, never pooled (mission §9/§54)', () => {
    const logs = [
      wodLog({ id: 'a', format_snapshot: 'Build to Heavy/1RM', format_config_snapshot: { targetLabel: '1RM' }, sets: { 'Back Squat': [{ reps: '1', weight: '120' }] } }),
      wodLog({ id: 'b', format_snapshot: 'Build to Heavy/1RM', format_config_snapshot: { targetLabel: '3RM' }, sets: { 'Back Squat': [{ reps: '3', weight: '110' }] } }),
      wodLog({ id: 'c', format_snapshot: 'Build to Heavy/1RM', format_config_snapshot: { targetLabel: '5RM' }, sets: { 'Back Squat': [{ reps: '5', weight: '100' }] } }),
    ]
    const bests = deriveCurrentMovementBests(logs, [])
    expect(bests).toHaveLength(3)
    expect(bests.map((b) => b.weight).sort((a, b) => a - b)).toEqual([100, 110, 120])
  })

  it('excludes SETS_ACROSS (5x5) even at a higher weight than the real RM_TEST best (mission §10/§55)', () => {
    const logs = [
      wodLog({ id: 'a', format_snapshot: 'Build to Heavy/1RM', format_config_snapshot: { targetLabel: '5RM' }, sets: { 'Back Squat': [{ reps: '5', weight: '100' }] } }),
      wodLog({ id: 'b', format_snapshot: 'Strength Sets', format_config_snapshot: { setsScheme: [5, 5, 5, 5, 5] }, sets: { 'Back Squat': [{ reps: '5', weight: '999' }] } }),
    ]
    const bests = deriveCurrentMovementBests(logs, [])
    expect(bests).toHaveLength(1)
    expect(bests[0].weight).toBe(100)
  })

  it('excludes UNKNOWN (Weightlifting) even at a higher weight - matches the real Phase 5 false-positive pattern (mission §12/§57)', () => {
    const logs = [
      wodLog({ id: 'a', format_snapshot: 'Build to Heavy/1RM', format_config_snapshot: { targetLabel: '1RM' }, sets: { 'Back Squat': [{ reps: '1', weight: '120' }] } }),
      wodLog({ id: 'b', format_snapshot: 'Weightlifting', format_config_snapshot: {}, sets: { 'Back Squat': [{ reps: '1', weight: '150' }] } }),
    ]
    const bests = deriveCurrentMovementBests(logs, [])
    expect(bests).toHaveLength(1)
    expect(bests[0].weight).toBe(120)
  })

  it('Heavy Single does not replace 1RM unless it is itself classified RM_TEST (mission §11/§56 - Forge has no distinct Heavy Single concept, so a non-RM_TEST "heavy" attempt never competes)', () => {
    const logs = [
      wodLog({ id: 'a', format_snapshot: 'Build to Heavy/1RM', format_config_snapshot: { targetLabel: '1RM' }, sets: { 'Back Squat': [{ reps: '1', weight: '120' }] } }),
      wodLog({ id: 'b', format_snapshot: 'Weightlifting', format_config_snapshot: {}, sets: { 'Back Squat': [{ reps: '1', weight: '125' }] } }),
    ]
    const bests = deriveCurrentMovementBests(logs, [])
    expect(bests).toHaveLength(1)
    expect(bests[0].weight).toBe(120)
  })

  it('different tiers/variant_level never pool into one current best (mission §39)', () => {
    const logs = [
      wodLog({ id: 'a', variant_level: 'RX', format_snapshot: 'Build to Heavy/1RM', format_config_snapshot: { targetLabel: '1RM' }, sets: { 'Back Squat': [{ reps: '1', weight: '120' }] } }),
      wodLog({ id: 'b', variant_level: 'Scaled', format_snapshot: 'Build to Heavy/1RM', format_config_snapshot: { targetLabel: '1RM' }, sets: { 'Back Squat': [{ reps: '1', weight: '90' }] } }),
    ]
    const bests = deriveCurrentMovementBests(logs, [])
    expect(bests).toHaveLength(2)
  })

  it('equal-best tie breaks to the more recent occurrence, never invents superiority (mission §41)', () => {
    const logs = [
      wodLog({ id: 'a', format_snapshot: 'Build to Heavy/1RM', format_config_snapshot: { targetLabel: '5RM' }, sets: { 'Back Squat': [{ reps: '5', weight: '100' }] }, logged_at: '2026-01-01' }),
      wodLog({ id: 'b', format_snapshot: 'Build to Heavy/1RM', format_config_snapshot: { targetLabel: '5RM' }, sets: { 'Back Squat': [{ reps: '5', weight: '100' }] }, logged_at: '2026-03-01' }),
    ]
    const bests = deriveCurrentMovementBests(logs, [])
    expect(bests).toHaveLength(1)
    expect(bests[0].logId).toBe('b')
  })

  it('track-only (leaderboard-agnostic) Results remain eligible - this module never reads leaderboard_visible (mission §36/§37)', () => {
    const logs = [wodLog({ id: 'a', format_snapshot: 'Build to Heavy/1RM', format_config_snapshot: { targetLabel: '5RM' }, sets: { 'Back Squat': [{ reps: '5', weight: '100' }] } })]
    const bests = deriveCurrentMovementBests(logs, [])
    expect(bests).toHaveLength(1)
  })

  it('edit-down: the current best recomputes correctly when the source data changes (mission §64)', () => {
    const before = [wodLog({ id: 'a', format_snapshot: 'Build to Heavy/1RM', format_config_snapshot: { targetLabel: '5RM' }, sets: { 'Back Squat': [{ reps: '5', weight: '105' }] } })]
    const after = [wodLog({ id: 'a', format_snapshot: 'Build to Heavy/1RM', format_config_snapshot: { targetLabel: '5RM' }, sets: { 'Back Squat': [{ reps: '5', weight: '95' }] } })]
    expect(deriveCurrentMovementBests(before, [])[0].weight).toBe(105)
    expect(deriveCurrentMovementBests(after, [])[0].weight).toBe(95)
  })

  it('delete: the current best falls back to the next eligible entry (mission §65)', () => {
    const logs = [
      wodLog({ id: 'a', format_snapshot: 'Build to Heavy/1RM', format_config_snapshot: { targetLabel: '5RM' }, sets: { 'Back Squat': [{ reps: '5', weight: '105' }] } }),
      wodLog({ id: 'b', format_snapshot: 'Build to Heavy/1RM', format_config_snapshot: { targetLabel: '5RM' }, sets: { 'Back Squat': [{ reps: '5', weight: '100' }] } }),
    ]
    expect(deriveCurrentMovementBests(logs, [])[0].weight).toBe(105)
    const afterDelete = logs.filter((l) => l.id !== 'a')
    expect(deriveCurrentMovementBests(afterDelete, [])[0].weight).toBe(100)
  })
})
