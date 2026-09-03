import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { composePerformedResultLines } from './prescriptionContract.js'

// P9.5.5 — RESULT CARD PERFORMED-PRESCRIPTION PROJECTION
//
// A result card (leaderboard / Journal / share) must show WHAT THE ATHLETE
// PERFORMED when wod_logs.performed_prescription is present, else the programmed
// content. The performed doc is a full clone of the programmed variant's
// instances: athlete-edited metrics are stored `universal` (single value);
// untouched metrics keep their `sex_specific` spec and resolve against the
// FROZEN gender.

const mi = (n) => `mi_${n}${'x'.repeat(21 - n.length)}`

// The owner's exact case (wod addce155 / member 97a4e88a, gender male):
//   programmed RX: 15 Wallballs @ 9/6 · 15 Sumo DL High-Pull @ 35 · 15 Box Jumps · 15 Push Press @ 35
//   performed:     Sumo DL -> 25 kg, Push Press -> 24 kg (universal); others untouched
const ownerPerformed = () => ({
  version: 1, variantKey: 'rx', source: 'performed', sectionId: null,
  movements: [
    { instanceId: mi('a'), name: 'Wallballs', canonicalMovementId: 'cm-wb',
      reps: { mode: 'universal', value: 15 },
      load: { mode: 'sex_specific', male: 9, female: 6, unit: 'kg' } },
    { instanceId: mi('b'), name: 'Sumo deadlift high-pull', canonicalMovementId: null,
      reps: { mode: 'universal', value: 15 },
      load: { mode: 'universal', value: 25, unit: 'kg' } },
    { instanceId: mi('c'), name: 'Box jumps', canonicalMovementId: 'cm-bj',
      reps: { mode: 'universal', value: 15 } },
    { instanceId: mi('d'), name: 'Push Press', canonicalMovementId: 'cm-pp',
      reps: { mode: 'universal', value: 15 },
      load: { mode: 'universal', value: 24, unit: 'kg' } },
  ],
})

describe('P9.5.5 — composePerformedResultLines (owner case, gender=male)', () => {
  it('§14 shows the PERFORMED load, not programmed, not sex-split', () => {
    const lines = composePerformedResultLines(ownerPerformed(), 'male')
    expect(lines).toEqual([
      '15 Wallballs @ 9 kg',                          // untouched sex_specific -> resolved to male
      '15 Sumo deadlift high-pull @ 25 kg',           // edited -> 25, NOT 35, NOT 35/25
      '15 Box jumps',
      '15 Push Press @ 24 kg',                        // edited -> 24
    ])
  })

  it('§19 unchanged movement rows still render (full-clone doc, not a lossy overlay)', () => {
    const lines = composePerformedResultLines(ownerPerformed(), 'male')
    expect(lines).toHaveLength(4)
    expect(lines[2]).toBe('15 Box jumps')
  })

  it('§13/§49 female frozen gender resolves the untouched sex_specific spec to 6', () => {
    const lines = composePerformedResultLines(ownerPerformed(), 'female')
    expect(lines[0]).toBe('15 Wallballs @ 6 kg')
    expect(lines[1]).toBe('15 Sumo deadlift high-pull @ 25 kg') // universal edit unchanged by gender
  })

  it('§13 unknown/null frozen gender -> untouched sex_specific shows both, edited shows the single value', () => {
    const lines = composePerformedResultLines(ownerPerformed(), null)
    expect(lines[0]).toBe('15 Wallballs @ 9/6 kg')
    expect(lines[1]).toBe('15 Sumo deadlift high-pull @ 25 kg')
  })
})

describe('P9.5.5 — modification types', () => {
  it('§15 movement substitution -> substituted name + performed load', () => {
    const doc = {
      version: 1, variantKey: 'rx', source: 'performed', movements: [
        { instanceId: mi('p'), name: 'Dumbbell Clean', canonicalMovementId: 'cm-dbc',
          reps: { mode: 'universal', value: 21 },
          load: { mode: 'universal', value: 22.5, unit: 'kg' },
          substitutedFrom: { canonicalMovementId: 'cm-pc', name: 'Power Clean' } },
      ],
    }
    expect(composePerformedResultLines(doc, 'male')).toEqual(['21 Dumbbell Clean @ 22.5 kg'])
  })

  it('§16 distance change', () => {
    const doc = { version: 1, movements: [
      { instanceId: mi('r'), name: 'Run', distance: { mode: 'universal', value: 150, unit: 'm' } },
    ] }
    expect(composePerformedResultLines(doc, 'male')).toEqual(['150 m Run'])
  })

  it('§17 calorie change', () => {
    const doc = { version: 1, movements: [
      { instanceId: mi('c2'), name: 'Row', calories: { mode: 'universal', value: 15 } },
    ] }
    expect(composePerformedResultLines(doc, 'male')).toEqual(['15 Cal Row'])
  })

  it('§18/§43 multiple edits all render', () => {
    const doc = { version: 1, movements: [
      { instanceId: mi('m1'), name: 'Wall Ball', reps: { mode: 'universal', value: 15 }, load: { mode: 'universal', value: 6, unit: 'kg' } },
      { instanceId: mi('m2'), name: 'Dumbbell Clean', reps: { mode: 'universal', value: 21 }, load: { mode: 'universal', value: 22.5, unit: 'kg' }, substitutedFrom: { canonicalMovementId: null, name: 'Power Clean' } },
      { instanceId: mi('m3'), name: 'Row', calories: { mode: 'universal', value: 25 } },
    ] }
    expect(composePerformedResultLines(doc, 'male')).toEqual([
      '15 Wall Ball @ 6 kg', '21 Dumbbell Clean @ 22.5 kg', '25 Cal Row',
    ])
  })

  it('§20/§44 repeated movement instances, only the second edited', () => {
    const doc = { version: 1, movements: [
      { instanceId: mi('i1'), name: 'Power Clean', reps: { mode: 'universal', value: 10 }, load: { mode: 'sex_specific', male: 61, female: 43, unit: 'kg' } },
      { instanceId: mi('i2'), name: 'Power Clean', reps: { mode: 'universal', value: 10 }, load: { mode: 'universal', value: 35, unit: 'kg' } },
    ] }
    expect(composePerformedResultLines(doc, 'male')).toEqual([
      '10 Power Clean @ 61 kg', '10 Power Clean @ 35 kg',
    ])
  })

  it('§21 preserves performed instance order (no re-sort)', () => {
    const doc = { version: 1, movements: [
      { instanceId: mi('z1'), name: 'Zebra', reps: { mode: 'universal', value: 5 } },
      { instanceId: mi('a1'), name: 'Aardvark', reps: { mode: 'universal', value: 5 } },
    ] }
    expect(composePerformedResultLines(doc, 'male')).toEqual(['5 Zebra', '5 Aardvark'])
  })
})

describe('P9.5.5 — fallback / defensive', () => {
  it('§7/§25 null performed doc -> null (caller keeps programmed rendering)', () => {
    expect(composePerformedResultLines(null, 'male')).toBeNull()
    expect(composePerformedResultLines(undefined, 'male')).toBeNull()
  })

  it('§33 malformed doc fails closed to null', () => {
    expect(composePerformedResultLines({ version: 2, movements: [] }, 'male')).toBeNull()
    expect(composePerformedResultLines({ version: 1, movements: 'nope' }, 'male')).toBeNull()
    expect(composePerformedResultLines({ version: 1, movements: [{ name: 'no id' }] }, 'male')).toBeNull()
    expect(composePerformedResultLines({ version: 1, movements: [] }, 'male')).toBeNull()
  })

  it('§48 a LOAD-scored workout: performed movement content is independent of the score', () => {
    // score (log.result "120") lives elsewhere; this only projects movement rows
    const doc = { version: 1, movements: [
      { instanceId: mi('bs'), name: 'Back Squat', reps: { mode: 'universal', value: 1 }, load: { mode: 'universal', value: 100, unit: 'kg' } },
    ] }
    expect(composePerformedResultLines(doc, 'male')).toEqual(['1 Back Squat @ 100 kg'])
  })
})

describe('P9.5.5 / P9.5.7 §52 — result-card surfaces route through the shared projection', () => {
  const app = readFileSync(join(dirname(fileURLToPath(import.meta.url)), 'App.jsx'), 'utf8')
  const proj = readFileSync(join(dirname(fileURLToPath(import.meta.url)), 'resultWorkoutLines.js'), 'utf8')

  it('one shared helper `resultPerformedLines`, delegating to composePerformedResultLines', () => {
    expect((proj.match(/export function resultPerformedLines\(/g) || []).length).toBe(1)
    expect(proj).toMatch(/composePerformedResultLines\(log\.performed_prescription, frozenGender\)/)
    // App.jsx no longer defines its own copy
    expect(app).not.toMatch(/function resultPerformedLines\(/)
  })

  it('P9.5.7 - leaderboard card + Journal card both route through resolveResultMovementLines', () => {
    const decls = app.match(/const cardMovementLines = resolveResultMovementLines\(\w+\)/g) || []
    expect(decls.length).toBe(2) // leaderboard render + Journal render
    // and both render cardMovementLines, not the raw miscariAfisate
    expect(app).toMatch(/\{cardMovementLines\.map\(\(m, j\) =>/)
    // imported from its own pure module (never reaches the live workout)
    expect(app).toMatch(/import \{ resolveResultMovementLines \} from '\.\/resultWorkoutLines'/)
  })

  it('P9.5.7 - the share card routes through the same source precedence', () => {
    expect(app).toMatch(/performedShareLines = performedToSave\s*\n\s*\?\s*composePerformedResultLines\(performedToSave, memberGenderKey\)/)
    expect(app).toMatch(/movements: shareMovementLines/)
    expect(app).toMatch(/\?\? snapshotDisplayLines\(prescriptionSnapshot\)/)
  })

  it('§9 classification still reads the programmed `miscariAfisate` (NOT cardMovementLines)', () => {
    // the P9.5.4 bucket call and its _loggedMovements must be untouched
    expect(app).toMatch(/_loggedMovements: miscariAfisate/)
    // INC-12 adds a 6th opts arg (frozen result string + frozen format); the
    // first 5 args — including _loggedMovements: miscariAfisate — are unchanged.
    expect(app).toMatch(/isMixedCategory\(log\.weight_logged, prescribedWeight, miscariAfisate, prescribedMovements, log\.performed_prescription[,)]/)
    expect(app).not.toMatch(/isMixedCategory\([^)]*cardMovementLines/)
    expect(app).not.toMatch(/_loggedMovements: cardMovementLines/)
  })

  it('§35 the projection resolves against the FROZEN gender, not current state', () => {
    expect(proj).toMatch(/log\?\.prescription_snapshot\?\.gender/)
  })

  it('NON-NEGOTIABLE: score-only result surfaces mark a modified attempt (benchmark history)', () => {
    // benchmark detail renders NO movement rows - a modified attempt must still
    // be visibly flagged so no modification is hidden.
    expect(app).toMatch(/function resultIsCompositionModified\(log, gender, t\)/)
    expect(app).toMatch(/resultIsCompositionModified\(log, userProfile\?\.gender, t\) && <NotRxdBadge/)
    // it uses the canonical composition rule, not an ad-hoc check
    // (INC-12 also threads the frozen formatId/formatConfig for the sequential term)
    expect(app).toMatch(/return resultCompositionModified\(log, prescribedWeight, loggedMovements, prescribedMovements[,)]/)
  })

  it('the movement-content result surfaces AND the modified-badge cover the full set', () => {
    // 3 surfaces render movement content via the ONE shared P9.5.7 resolver:
    expect((app.match(/const cardMovementLines = resolveResultMovementLines\(\w+\)/g) || []).length).toBe(2) // leaderboard + Journal
    expect(app).toMatch(/composePerformedResultLines\(performedToSave, memberGenderKey\)/)         // share
    // "Not RX'd" badge is present on every result-card header + the score-only history:
    expect((app.match(/<NotRxdBadge t=\{t\}/g) || []).length).toBeGreaterThanOrEqual(4) // lb card, journal card, share, benchmark history
  })
})
