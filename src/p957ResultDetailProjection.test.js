import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { resolveResultMovementLines, resultPerformedLines, notesMovementLines } from './resultWorkoutLines.js'
import { snapshotDisplayLines } from './prescriptionContract.js'

// P9.5.7 — GLOBAL ATHLETE RESULT DETAIL PROJECTION
//
// An expanded athlete result answers "WHAT DID THIS ATHLETE ACTUALLY DO?" —
// SELECTED VARIANT + ACTUAL PERFORMED WORKOUT + RESULT. The movement section must
// never vanish just because performed_prescription is NULL (= performed as
// programmed) or the athlete selected a non-RX variant.
//
// resolveResultMovementLines(log) source precedence, ALL frozen log-owned:
//   1. performed_prescription  2. prescription_snapshot.displayLine
//   3. notes movement lines    4. movements_snapshot (names)   5. []

const mi = (n) => `mi_${n}${'x'.repeat(Math.max(0, 21 - n.length))}`

// A frozen prescription_snapshot for the SELECTED variant (P9.1 flat shape).
const snap = (variant, gender, movs) => ({
  version: 1, variant, gender, source: 'structured', resolvedAt: '2026-08-31T00:00:00Z',
  movements: movs.map((m, i) => ({
    instanceId: mi(`s${i}`), name: m.name, canonicalMovementId: m.cm ?? null,
    displayLine: m.line,
    ...(m.load != null ? { load: { value: m.load, unit: 'kg', mode: 'sex_specific', bothValues: [m.load, m.load] } } : {}),
    reps: { value: m.reps ?? null },
  })),
})

const performed = (variantKey, movs) => ({
  version: 1, variantKey, source: 'performed', sectionId: null,
  movements: movs.map((m, i) => ({
    instanceId: m.iid ?? mi(`p${i}`), name: m.name, canonicalMovementId: m.cm ?? null,
    reps: { mode: 'universal', value: m.reps ?? 15 },
    ...(m.load != null ? { load: { mode: 'universal', value: m.load, unit: 'kg' } } : {}),
    ...(m.substitutedFrom ? { substitutedFrom: m.substitutedFrom } : {}),
  })),
})

const RFT_INT = [
  { name: 'Wallballs', line: '15 Wallballs @ 6 kg', load: 6, reps: 15, cm: 'cm-wb' },
  { name: 'Sumo deadlift high-pull', line: '15 Sumo deadlift high-pull @ 25 kg', load: 25, reps: 15 },
  { name: 'Box jumps', line: '15 Box jumps', reps: 15, cm: 'cm-bj' },
  { name: 'Push Press', line: '15 Push Press @ 25 kg', load: 25, reps: 15, cm: 'cm-pp' },
]

// ───────────────────────── §21 NULL performed = show programmed ──────────────

describe('P9.5.7 §21 — NULL performed_prescription NEVER hides the workout', () => {
  it('§46 Ergun: unmodified Intermediate WITH prescription_snapshot -> full Intermediate lines', () => {
    const log = {
      variant_level: 'Intermediate', performed_prescription: null,
      prescription_snapshot: snap('intermediate', 'male', RFT_INT),
      notes: 'RFT · 15:00', movements_snapshot: ['15 Wallballs', '15 Sumo deadlift high-pull', '15 Box jumps', '15 Push Press'],
    }
    expect(resolveResultMovementLines(log)).toEqual([
      '15 Wallballs @ 6 kg', '15 Sumo deadlift high-pull @ 25 kg', '15 Box jumps', '15 Push Press @ 25 kg',
    ])
  })

  it("§46 Ergun's ACTUAL row: no snapshot, no notes lines -> falls to frozen movement NAMES (movements_snapshot)", () => {
    // production row 2c94a5e0 - RX-only workout, coach defined no variant movements
    const log = {
      variant_level: 'Intermediate', performed_prescription: null, prescription_snapshot: null,
      notes: 'RFT · 15:00',
      movements_snapshot: ['15 Wallballs', '15 Sumo deadlift high-pull', '15 Box jumps', '15 Push Press'],
    }
    expect(resolveResultMovementLines(log)).toEqual([
      '15 Wallballs', '15 Sumo deadlift high-pull', '15 Box jumps', '15 Push Press',
    ])
  })

  it('§45 unmodified RX with prescription_snapshot -> full RX lines WITH loads (not the load-less notes text)', () => {
    const RX = [
      { name: 'Wallballs', line: '15 Wallballs @ 9 kg', load: 9, reps: 15 },
      { name: 'Push Press', line: '15 Push Press @ 35 kg', load: 35, reps: 15 },
    ]
    const log = {
      variant_level: 'RX', performed_prescription: null,
      prescription_snapshot: snap('rx', 'male', RX),
      notes: 'RFT · 15:00\n15 Wallballs\n15 Push Press',
      movements_snapshot: ['15 Wallballs', '15 Push Press'],
    }
    expect(resolveResultMovementLines(log)).toEqual(['15 Wallballs @ 9 kg', '15 Push Press @ 35 kg'])
  })

  it('unmodified non-RX with variant-specific NOTES text (no snapshot) -> the frozen notes lines', () => {
    const log = {
      variant_level: 'Intermediate', performed_prescription: null, prescription_snapshot: null,
      notes: 'RFT · 20:00\n600m Row\n40 Sit-up\n20 Box jump over',
      movements_snapshot: ['600/750m row', '50 AbMat sit-ups', '25 box jump-overs'], // RX text - must NOT win over notes
    }
    expect(resolveResultMovementLines(log)).toEqual(['600m Row', '40 Sit-up', '20 Box jump over'])
  })
})

// ───────────────────────── §23 variant matrix ───────────────────────────────

describe('P9.5.7 §23/§77 — variant matrix (data-driven, no variant-name branch)', () => {
  for (const [variant, key] of [['RX', 'rx'], ['Intermediate', 'intermediate'], ['Beginner', 'beginner'], ['OnRamp', 'onramp'], ['CUSTOM_TEST', 'custom_test']]) {
    it(`${variant} · unmodified (snapshot) -> full ${variant} lines`, () => {
      const log = { variant_level: variant, performed_prescription: null, prescription_snapshot: snap(key, 'male', RFT_INT) }
      expect(resolveResultMovementLines(log)).toHaveLength(4)
      expect(resolveResultMovementLines(log)[0]).toBe('15 Wallballs @ 6 kg')
    })
    it(`${variant} · modified load -> all lines, performed value, others preserved`, () => {
      const log = {
        variant_level: variant,
        // performed_prescription.variantKey mirrors a real scaling key (the overlay
        // is a clone of the section's instances) - never the free-text variant_level.
        performed_prescription: performed('rx', [
          { name: 'Wallballs', load: 6, reps: 15 },
          { name: 'Sumo deadlift high-pull', load: 25, reps: 15 },
          { name: 'Box jumps', reps: 15 },
          { name: 'Push Press', load: 15, reps: 15 }, // reduced
        ]),
        prescription_snapshot: snap(key, 'male', RFT_INT),
      }
      expect(resolveResultMovementLines(log)).toEqual([
        '15 Wallballs @ 6 kg', '15 Sumo deadlift high-pull @ 25 kg', '15 Box jumps', '15 Push Press @ 15 kg',
      ])
    })
  }
  it('the resolver takes NO variant argument', () => {
    expect(resolveResultMovementLines.length).toBe(1)
  })
})

// ───────────────────────── §7/§53 substitution ──────────────────────────────

describe('P9.5.7 §7/§53 — movement substitution shows the PERFORMED movement', () => {
  it('programmed Wallballs, performed Dumbbell Power Snatch -> DB Power Snatch, no ghost Wallballs', () => {
    const log = {
      variant_level: 'Beginner',
      performed_prescription: performed('beginner', [
        { name: 'Dumbbell Power Snatch', load: 15, reps: 15, substitutedFrom: 'Wallballs' },
        { name: 'Ring Rows', reps: 15, substitutedFrom: 'Sumo deadlift high-pull' },
        { name: 'Box jumps', reps: 15 },
        { name: 'Push Press', load: 20, reps: 15 },
      ]),
      prescription_snapshot: snap('beginner', 'male', RFT_INT),
    }
    const lines = resolveResultMovementLines(log)
    expect(lines[0]).toBe('15 Dumbbell Power Snatch @ 15 kg')
    expect(lines[1]).toBe('15 Ring Rows')
    expect(lines.join('\n')).not.toMatch(/Wallballs/)
    expect(lines).toHaveLength(4)
  })
})

// ───────────────────────── §26/§27/§54 multiple changes ─────────────────────

describe('P9.5.7 §26/§27/§54 — multiple modifications, unchanged rows preserved', () => {
  it('4-movement workout, 2 changed -> 4 lines, exactly the 2 overrides applied', () => {
    const log = {
      variant_level: 'RX',
      performed_prescription: performed('rx', [
        { name: 'Wallballs', load: 9, reps: 15 },              // unchanged
        { name: 'Row', load: null, reps: 15 },                 // substituted (was Sumo DL)
        { name: 'Box jumps', reps: 15 },                       // unchanged
        { name: 'Push Press', load: 20, reps: 15 },            // load changed 35 -> 20
      ]),
      prescription_snapshot: snap('rx', 'male', RFT_INT),
    }
    expect(resolveResultMovementLines(log)).toEqual([
      '15 Wallballs @ 9 kg', '15 Row', '15 Box jumps', '15 Push Press @ 20 kg',
    ])
  })
})

// ───────────────────────── §25/§55 repeated movement ────────────────────────

describe('P9.5.7 §25/§55 — repeated movement instances stay distinct', () => {
  it('same movement twice, different loads, modify only the second', () => {
    const dbl = [
      { name: 'DB Snatch', line: '10 DB Snatch @ 15 kg', load: 15, reps: 10 },
      { name: 'DB Snatch', line: '10 DB Snatch @ 20 kg', load: 20, reps: 10 },
    ]
    // unmodified -> snapshot keeps both distinct
    const un = { variant_level: 'RX', performed_prescription: null, prescription_snapshot: snap('rx', 'male', dbl) }
    expect(resolveResultMovementLines(un)).toEqual(['10 DB Snatch @ 15 kg', '10 DB Snatch @ 20 kg'])
    // modify only the 2nd via performed overlay
    const mo = {
      variant_level: 'RX',
      performed_prescription: performed('rx', [
        { name: 'DB Snatch', load: 15, reps: 10 },
        { name: 'DB Snatch', load: 12, reps: 10 },
      ]),
      prescription_snapshot: snap('rx', 'male', dbl),
    }
    expect(resolveResultMovementLines(mo)).toEqual(['10 DB Snatch @ 15 kg', '10 DB Snatch @ 12 kg'])
  })
})

// ───────────────────────── §57-65 cross-format ──────────────────────────────

describe('P9.5.7 §57-65 — the movement source is INDEPENDENT of score family', () => {
  const base = (extra) => ({
    variant_level: 'Intermediate', performed_prescription: null,
    prescription_snapshot: snap('intermediate', 'male', RFT_INT),
    ...extra,
  })
  const cases = {
    'TIME finished': { time_result: '9:04' },
    'TIME_CAPPED / RFT capped': { time_result: null, result: '2 runde + 12', completion_state: 'capped' },
    'RFT incomplete': { time_result: null, result: '2 runde complete', completion_state: 'capped' },
    'AMRAP partial round': { result: '4 + 7' },
    'REPS low score': { result: '3' },
    'REPS high score': { result: '999' },
    'LOAD achieved 200': { weight_logged: '', result: '200' },
    'DISTANCE achieved': { result: '5200 m' },
    'CALORIES achieved': { result: '88' },
    'SETS/INTERVALS low reps': { sets: { 'Rundă 1': [{ reps: '1' }] } },
  }
  for (const [label, extra] of Object.entries(cases)) {
    it(`${label} -> identical full movement lines`, () => {
      expect(resolveResultMovementLines(base(extra))).toEqual([
        '15 Wallballs @ 6 kg', '15 Sumo deadlift high-pull @ 25 kg', '15 Box jumps', '15 Push Press @ 25 kg',
      ])
    })
  }
})

// ───────────────────────── §56/§71/§72 historical / leakage ─────────────────

describe('P9.5.7 §56/§71 — a later coach edit cannot rewrite a saved result detail', () => {
  it('resolveResultMovementLines reads ONLY the log; there is no wods / current-workout argument', () => {
    const log = {
      variant_level: 'RX', performed_prescription: null,
      prescription_snapshot: snap('rx', 'male', [{ name: 'Wallballs', line: '15 Wallballs @ 9 kg', load: 9, reps: 15 }]),
      // a "current workout" mutated by a coach - must be ignored entirely
      wods: { movements_rx: ['999 Burpees'], rx_weight_male: '999' },
    }
    expect(resolveResultMovementLines(log)).toEqual(['15 Wallballs @ 9 kg'])
    // the CODE (comments stripped) never reaches for live workout data
    const proj = readFileSync(join(dirname(fileURLToPath(import.meta.url)), 'resultWorkoutLines.js'), 'utf8')
      .replace(/\/\/.*$/gm, '')
    expect(proj).not.toMatch(/\.wods\b|movements_rx|movements_intermediate|wodZiData|resolveResultProvenance/)
    // it reads only these frozen, log-owned fields:
    for (const f of ['log.performed_prescription', 'log.prescription_snapshot', 'log.notes', 'log.movements_snapshot']) {
      expect(proj).toContain(f)
    }
  })
})

describe('P9.5.7 §72 — no RX fallback leakage for a non-RX result', () => {
  it('a non-RX result with a variant-specific SNAPSHOT never shows RX values', () => {
    const log = {
      variant_level: 'Beginner', performed_prescription: null,
      prescription_snapshot: snap('beginner', 'male', [
        { name: 'Ring Rows', line: '15 Ring Rows', reps: 15 },       // Beginner substitution
        { name: 'Push Press', line: '15 Push Press @ 15 kg', load: 15, reps: 15 }, // Beginner load
      ]),
      movements_snapshot: ['15 Pull-ups', '15 Push Press'],           // RX text (frozen movements_rx) - must NOT win
      notes: 'RFT · 15:00',
    }
    expect(resolveResultMovementLines(log)).toEqual(['15 Ring Rows', '15 Push Press @ 15 kg'])
  })
  it('movements_snapshot (RX names) is the LAST resort, reached only with no snapshot AND no notes lines', () => {
    // this state, in the real data, means the coach defined NO per-variant movements
    // -> the movements are shared -> the RX names ARE the athlete's movements
    const log = {
      variant_level: 'Beginner', performed_prescription: null, prescription_snapshot: null,
      notes: 'RFT · 15:00', movements_snapshot: ['15 Wallballs', '15 Push Press'],
    }
    expect(resolveResultMovementLines(log)).toEqual(['15 Wallballs', '15 Push Press'])
  })
})

// ───────────────────────── §66 legacy / §67 malformed ──────────────────────

describe('P9.5.7 §66 — legacy rows', () => {
  it('legacy with truthful frozen NOTES movements -> shows them', () => {
    const log = { variant_level: 'RX', performed_prescription: null, prescription_snapshot: null,
      notes: 'For Time · 20:00\n21 Thrusters @ 43kg\n21 Pull-ups', movements_snapshot: null }
    expect(resolveResultMovementLines(log)).toEqual(['21 Thrusters @ 43kg', '21 Pull-ups'])
  })
  it('legacy with NO frozen movement source at all -> [] (keep variant + score, omit; never invent)', () => {
    const log = { variant_level: 'Intermediate', performed_prescription: null, prescription_snapshot: null,
      notes: 'RFT · 20:00', movements_snapshot: null }
    expect(resolveResultMovementLines(log)).toEqual([])
  })
})

describe('P9.5.7 §67 — malformed performed_prescription fails safely (prefer frozen snapshot)', () => {
  it('malformed overlay -> the frozen programmed snapshot lines, no crash', () => {
    const log = {
      variant_level: 'RX', performed_prescription: { version: 99, movements: 'not-an-array' },
      prescription_snapshot: snap('rx', 'male', [{ name: 'Wallballs', line: '15 Wallballs @ 9 kg', load: 9, reps: 15 }]),
    }
    expect(resolveResultMovementLines(log)).toEqual(['15 Wallballs @ 9 kg'])
  })
  it('empty performed doc -> snapshot; empty everything -> []', () => {
    expect(resolveResultMovementLines({ performed_prescription: {}, prescription_snapshot: snap('rx', 'male', [{ name: 'X', line: '10 X', reps: 10 }]) }))
      .toEqual(['10 X'])
    expect(resolveResultMovementLines({ performed_prescription: {} })).toEqual([])
    expect(resolveResultMovementLines(null)).toEqual([])
    expect(resolveResultMovementLines(undefined)).toEqual([])
  })
})

// ───────────────────────── primitives ──────────────────────────────────────

describe('P9.5.7 — primitives', () => {
  it('snapshotDisplayLines: order preserved, name fallback, null on empty', () => {
    expect(snapshotDisplayLines(snap('rx', 'male', [{ name: 'A', line: '10 A' }, { name: 'B', line: '' }]))).toEqual(['10 A', 'B'])
    expect(snapshotDisplayLines(null)).toBe(null)
    expect(snapshotDisplayLines({ movements: [] })).toBe(null)
    expect(snapshotDisplayLines({ movements: [{ name: '' }] })).toBe(null)
  })
  it('notesMovementLines: drops the format header, keeps movement lines', () => {
    expect(notesMovementLines('RFT · 15:00\n15 Wallballs\n15 Push Press')).toEqual(['15 Wallballs', '15 Push Press'])
    expect(notesMovementLines('RFT · 15:00')).toEqual([])
    expect(notesMovementLines(null)).toEqual([])
    expect(notesMovementLines('15 Burpees\n15 Air Squats')).toEqual(['15 Burpees', '15 Air Squats']) // no recognised header
  })
  it('resultPerformedLines: null when no overlay', () => {
    expect(resultPerformedLines({ performed_prescription: null })).toBe(null)
    expect(resultPerformedLines({})).toBe(null)
  })
})

// ───────────────────────── §68 one source of truth (wiring) ────────────────

describe('P9.5.7 §68 — ONE shared projection across surfaces', () => {
  const app = readFileSync(join(dirname(fileURLToPath(import.meta.url)), 'App.jsx'), 'utf8')
  it('leaderboard + Journal cards use resolveResultMovementLines; no per-surface if-performed-else', () => {
    expect((app.match(/const cardMovementLines = resolveResultMovementLines\(\w+\)/g) || []).length).toBe(2)
    expect(app).not.toMatch(/resultPerformedLines\(\w+\) \?\? miscariAfisate/)
  })
  it('share card routes through the same precedence (performed -> snapshot -> text)', () => {
    expect(app).toMatch(/const shareMovementLines = /)
    expect(app).toMatch(/\?\? snapshotDisplayLines\(prescriptionSnapshot\)/)
    expect(app).toMatch(/movements: shareMovementLines/)
  })
  it('classification inputs (miscariAfisate) are untouched - P9.5.4/P9.5.6 unchanged', () => {
    expect(app).toMatch(/_loggedMovements: miscariAfisate/)
    expect(app).not.toMatch(/resultCompositionModified\([^)]*cardMovementLines/)
  })
})
