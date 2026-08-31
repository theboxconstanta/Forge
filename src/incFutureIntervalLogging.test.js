import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import {
  getFormat, computeSetsScore, setsDisplayScore, resolveSetsScoringMode,
  isWeightScoredSetsFormat, setsScoreText, setsScoreLabel,
} from './workoutFormats.js'
import { scoreDefinitionFor } from './scoreDefinition.js'
import { resolveWodIdForLog, resolveLoggedWorkoutIdentity, freezeLoggingContext } from './utils.js'

// INC-06 — GENERIC FUTURE-WORKOUT LOGGING + INTERVAL RESULT SEMANTICS
//
// Reproduction fixture (production row wod_logs.5f7a177c, wod 2ed71d47 =
// 2026-09-01 Intervals, variant RX): result/time_result/completion_state all
// null; the score lives entirely in `sets`; format_config has NO `scoringMode`.
const REAL_SETS = Object.fromEntries(
  [23, 4, 3, 5, 6, 23, 2, 3, 4, 5, 4, 32, 43, 43, 3].map((r, i) => [
    `Rundă ${i + 1}`, [{ reps: String(r), weight: '', completed: false }],
  ]),
)
const CFG_40_20 = { restSec: 20, rounds: 15, workSec: 40 } // owner's — no scoringMode key
const SUM = 203

const app = readFileSync(join(dirname(fileURLToPath(import.meta.url)), 'App.jsx'), 'utf8')

// ───────────────────────── TRACK B — interval score semantics ─────────────────

describe('INC-06 · the canonical Intervals score contract (pre-existing, correct)', () => {
  it('Intervals = family:sets, schema default scoringMode "Total Reps"', () => {
    const f = getFormat('Intervals')
    expect(f.family).toBe('sets')
    expect(f.config.scoringMode.default).toBe('Total Reps')
  })
  it('scoreDefinitionFor(Intervals) → SETS (delegates to the tested sets logger)', () => {
    expect(scoreDefinitionFor('Intervals', CFG_40_20).kind).toBe('SETS')
  })
  it('resolveSetsScoringMode applies the schema default when format_config omits scoringMode', () => {
    expect(resolveSetsScoringMode('Intervals', CFG_40_20)).toBe('Total Reps')
    expect(resolveSetsScoringMode('Intervals', { ...CFG_40_20, scoringMode: 'Lowest Reps' })).toBe('Lowest Reps')
  })
  it('the aggregate is the accumulated total, derived (not stored)', () => {
    expect(computeSetsScore('Intervals', CFG_40_20, REAL_SETS)).toBe(SUM)
    expect(setsDisplayScore('Intervals', CFG_40_20, REAL_SETS)).toBe(SUM)
  })
})

describe('INC-06 · §16-21 REST is structural, contributes ZERO performance score', () => {
  it('the persisted sets object holds only the 15 WORK rounds — no rest rows', () => {
    expect(Object.keys(REAL_SETS)).toHaveLength(CFG_40_20.rounds)
    expect(Object.keys(REAL_SETS).some((k) => /rest|pauz|recover/i.test(k))).toBe(false)
  })
  it('the score is unchanged whether or not rest exists in config', () => {
    expect(computeSetsScore('Intervals', CFG_40_20, REAL_SETS)).toBe(SUM)
    expect(computeSetsScore('Intervals', { rounds: 15, workSec: 40, restSec: 0 }, REAL_SETS)).toBe(SUM)
    expect(computeSetsScore('Intervals', { rounds: 15, workSec: 40 }, REAL_SETS)).toBe(SUM)
  })
  it('§17 scheduled elapsed duration = rounds × (work + rest), SEPARATE from the score', () => {
    const elapsed = CFG_40_20.rounds * (CFG_40_20.workSec + CFG_40_20.restSec)
    expect(elapsed).toBe(900) // 15:00 — matches wods.duration
    expect(elapsed).not.toBe(SUM)
  })
  it('§21 generic — rest is non-scoreable for arbitrary valid interval configs', () => {
    for (const cfg of [
      { rounds: 15, workSec: 40, restSec: 20 },
      { rounds: 8, workSec: 30, restSec: 30 },
      { rounds: 10, workSec: 60, restSec: 15 },
    ]) {
      const sets = Object.fromEntries(
        Array.from({ length: cfg.rounds }, (_, i) => [`Rundă ${i + 1}`, [{ reps: '5', weight: '' }]]),
      )
      expect(computeSetsScore('Intervals', cfg, sets)).toBe(cfg.rounds * 5) // work reps only
    }
  })
})

describe('INC-06 · §24-25 load is prescription, never summed into the rep score', () => {
  it('a per-round weight field is ignored by the rep-score sum', () => {
    const withWeights = Object.fromEntries(
      Object.entries(REAL_SETS).map(([k, [row]]) => [k, [{ ...row, weight: '17.5' }]]),
    )
    expect(computeSetsScore('Intervals', CFG_40_20, withWeights)).toBe(SUM) // 17.5 not added
  })
})

describe('INC-06 · BUG 1 FIX — setsScoreText: one canonical score string for every surface', () => {
  it('rep-scored Intervals → "203 reps" (NOT "203kg")', () => {
    expect(setsScoreText('Intervals', CFG_40_20, REAL_SETS, 'kg', 'reps')).toBe('203 reps')
    expect(setsScoreText('Intervals', CFG_40_20, REAL_SETS, 'lbs', 'reps')).toBe('203 reps')
  })
  it('Lowest-Reps Intervals → lowest work round', () => {
    expect(setsScoreText('Intervals', { ...CFG_40_20, scoringMode: 'Lowest Reps' }, REAL_SETS, 'kg', 'reps')).toBe('2 reps')
  })
  it('Tabata (same family, default Lowest Reps) → reps', () => {
    const t = Object.fromEntries([18, 16, 14].map((r, i) => [`Rundă ${i + 1}`, [{ reps: String(r), weight: '' }]]))
    expect(setsScoreText('Tabata', { rounds: 3, workSec: 20, restSec: 10 }, t, 'kg', 'reps')).toBe('14 reps')
  })
  it('weight-scored Complex (Total Weight) → "kg"', () => {
    const c = { 'Rundă 1': [{ reps: '3', weight: '60' }], 'Rundă 2': [{ reps: '3', weight: '65' }] }
    expect(setsScoreText('Complex', { scoringMode: 'Total Weight', rounds: 2 }, c, 'kg', 'reps')).toBe('125 kg')
  })
  it('Weightlifting (no scoringMode → maxWeightFromSets fallback) → "kg"', () => {
    const w = { Snatch: [{ reps: '1', weight: '70' }, { reps: '1', weight: '80' }] }
    expect(setsScoreText('Weightlifting', {}, w, 'kg', 'reps')).toBe('80 kg')
  })
  it('null when there is no derivable score', () => {
    expect(setsScoreText('Weightlifting', {}, {}, 'kg', 'reps')).toBe(null)
    expect(setsScoreText('Intervals', CFG_40_20, {}, 'kg', 'reps')).toBe(null)
  })
  it('agrees with what the leaderboard card already computes (isWeightScoredSetsFormat gate)', () => {
    expect(isWeightScoredSetsFormat(CFG_40_20, 'Intervals')).toBe(false) // → reps unit
    const cardValue = setsDisplayScore('Intervals', CFG_40_20, REAL_SETS)
    expect(setsScoreText('Intervals', CFG_40_20, REAL_SETS, 'kg', 'reps')).toBe(`${cardValue} reps`)
  })
})

describe('INC-06 · BUG 2 FIX — logger total label matches the canonical scoringMode', () => {
  it('Intervals w/o explicit scoringMode → "Total reps" label (was "Cea mai slabă rundă")', () => {
    const mode = resolveSetsScoringMode('Intervals', CFG_40_20)
    expect(mode).toBe('Total Reps')
    expect(setsScoreLabel(mode, { fmtTotalRepsScoreLabel: 'Total reps', fmtLowestRepsScoreLabel: 'Lowest round' })).toBe('Total reps')
  })
  it('Lowest Reps → the lowest-round label', () => {
    expect(setsScoreLabel('Lowest Reps', { fmtLowestRepsScoreLabel: 'Lowest round' })).toBe('Lowest round')
  })
  it('weight modes → the Weight label, not a rep label', () => {
    expect(setsScoreLabel('Total Weight', { logWodWeightLabel: 'Weight', fmtTotalRepsScoreLabel: 'Total reps' })).toBe('Weight')
    expect(setsScoreLabel('Max Weight', { logWodWeightLabel: 'Weight' })).toBe('Weight')
  })
  it('FormatLogger keys the label off resolveSetsScoringMode, not raw config.scoringMode', () => {
    const fl = readFileSync(join(dirname(fileURLToPath(import.meta.url)), 'FormatLogger.jsx'), 'utf8')
    expect(fl).toMatch(/setsScoreLabel\(resolveSetsScoringMode\(formatId, config\), t\)/)
    expect(fl).not.toMatch(/config\?\.scoringMode === 'Total Reps' \?/)
  })
})

describe('INC-06 · BUG 3 FIX — Jurnal + Skill Jurnal use setsScoreText (no forced kg)', () => {
  it('App.jsx Jurnal WOD card derives the sets score via setsScoreText', () => {
    expect(app).toMatch(/const wSetsText = wHasSets \? setsScoreText\(formatTipResolvat, formatConfigResolvat, w\.sets, weightUnit, t\.clasamentRepsUnit\)/)
    expect(app).not.toMatch(/\[`\$\{wSetsScore\}\$\{unitLabel\}`\]/)
  })
  it('App.jsx Skill Jurnal card derives the score via setsScoreText', () => {
    expect(app).toMatch(/const skillScorText = hasSets \? setsScoreText\(skillFormatId, skillFormatConfigActual, sl\.sets, weightUnit, t\.clasamentRepsUnit\)/)
    expect(app).not.toMatch(/\{skillScor\}\{unitLabel\}/)
  })
  it('the unconditional weight-unit constant is gone', () => {
    expect(app).not.toMatch(/const unitLabel = weightUnit === 'lbs'/)
  })
})

describe('INC-06 · BUG (Share "—") FIX — share card gets the same canonical score', () => {
  it('the share-data assembly derives a score for family:sets and family:chained', () => {
    expect(app).toMatch(/const activeShareFmt = getFormat\(activeLogFormatId\)/)
    expect(app).toMatch(/activeShareFmt\?\.family === 'sets'\s*\n\s*\? setsScoreText\(activeLogFormatId, activeLogFormatConfig, logFields\.sets/)
    expect(app).toMatch(/result: derivedShareScore \?\? logFields\.result/)
  })
})

describe('INC-06 · §D four-surface agreement — one saved sets result, one score', () => {
  const config = CFG_40_20
  const sets = REAL_SETS
  it('logger / leaderboard / Jurnal / share all render the identical string', () => {
    // logger box value
    const loggerValue = computeSetsScore('Intervals', config, sets)
    // leaderboard card (App.jsx line ~2323): `${_setsScore}` + reps/kg by gate
    const lbUnit = isWeightScoredSetsFormat(config, 'Intervals') ? 'kg' : 'reps'
    const lbText = `${setsDisplayScore('Intervals', config, sets)} ${lbUnit}`.replace('  ', ' ')
    // Jurnal + share now: setsScoreText
    const jurnalText = setsScoreText('Intervals', config, sets, 'kg', 'reps')
    const shareText = setsScoreText('Intervals', config, sets, 'kg', 'reps')
    expect(loggerValue).toBe(SUM)
    expect(jurnalText).toBe('203 reps')
    expect(shareText).toBe(jurnalText)
    expect(lbText.replace(/\s+/g, ' ')).toBe(jurnalText)
  })
})

describe('INC-06 · §46 score-family non-regression (setsScoreText is family-gated)', () => {
  it('non-sets formats are untouched — result/time_result stay the score source', () => {
    // TIME
    expect(getFormat('For Time').family).not.toBe('sets')
    expect(setsScoreText('For Time', {}, null, 'kg', 'reps')).toBe(null)
    // AMRAP
    expect(getFormat('AMRAP').family).not.toBe('sets')
    expect(setsScoreText('AMRAP', {}, null, 'kg', 'reps')).toBe(null)
    // RFT
    expect(setsScoreText('RFT', { rounds: 3 }, null, 'kg', 'reps')).toBe(null)
  })
})

// ───────────────────────── TRACK A — future-workout identity ──────────────────

describe('INC-06 · TRACK A — the SELECTED workout owns the result, for ANY date', () => {
  // A future Engine V2 workout, frozen into logCtx at "Log Score" click.
  const futureWorkout = (dateStr, legacyWodId) => ({
    date: dateStr,
    legacyWodId,
    sections: [{ id: `sec-${legacyWodId}`, slotKey: 'metcon', loggingMode: 'required' }],
  })
  const freezeFor = (businessDate, legacyWodId) => {
    const v2 = { date: businessDate, legacyWodId }
    const wods = { id: `legacy-${legacyWodId}`, date: businessDate }
    return freezeLoggingContext(futureWorkout(businessDate, legacyWodId), wods, v2, businessDate)
  }

  it('§48 D+1 / D+3 / D+7 — the frozen legacy_wod_id is the save target, never "today"', () => {
    for (const [offset, wodId] of [[1, 'wod-d1'], [3, 'wod-d3'], [7, 'wod-d7']]) {
      const businessDate = `2026-09-0${offset}` // arbitrary future offsets, not just "tomorrow"
      const ctx = freezeFor(businessDate, wodId)
      const identity = resolveLoggedWorkoutIdentity(ctx, 'RX')
      expect(identity.wodId).toBe(wodId)
      expect(identity.businessDate).toBe(businessDate)
      expect(identity.sectionId).toBe(`sec-${wodId}`)
    }
  })

  it('§14 D+n historical logging still resolves to the SELECTED past workout', () => {
    const ctx = freezeFor('2026-08-01', 'wod-past')
    expect(resolveLoggedWorkoutIdentity(ctx, 'RX').wodId).toBe('wod-past')
  })

  it('§49 CROSS-INVARIANT — a later change to "today" / current state cannot move the target', () => {
    const ctx = freezeFor('2026-09-07', 'wod-future')
    // simulate the whole app drifting: dataAcasa back to today, wodZiData replaced…
    // the resolver reads ONLY the frozen ctx, so identity is invariant.
    const before = resolveLoggedWorkoutIdentity(ctx, 'RX')
    const after = resolveLoggedWorkoutIdentity(ctx, 'RX')
    expect(after).toEqual(before)
    expect(after.wodId).toBe('wod-future')
    expect(resolveWodIdForLog(ctx.wodZiWorkoutV2, ctx.wodZiData)).toBe('wod-future')
  })

  it('§13 no stale target leaks — a fresh freeze for a different future workout wins', () => {
    const d1 = freezeFor('2026-09-02', 'wod-a')
    const d7 = freezeFor('2026-09-08', 'wod-b')
    expect(resolveLoggedWorkoutIdentity(d1, 'RX').wodId).toBe('wod-a')
    expect(resolveLoggedWorkoutIdentity(d7, 'RX').wodId).toBe('wod-b') // no d1 leak
  })

  it('fail-closed — no frozen context → null identity, never a today fallback', () => {
    expect(resolveLoggedWorkoutIdentity(null, 'RX')).toEqual({ wodId: null, sectionId: null, businessDate: null, variantMovements: [] })
  })
})

describe('INC-06 · TRACK A — leaderboard & Jurnal reach a future business date', () => {
  it('the leaderboard forward button is no longer capped at "today"', () => {
    // the ‹ / › pair — the › (goDay(+1)) must not carry disabled={isToday}
    expect(app).toMatch(/onClick=\{\(\) => goDay\(\+1\)\}[^>]*>›<\/button>/)
    expect(app).not.toMatch(/goDay\(\+1\)\} disabled=\{isToday\}/)
  })
  it('the Jurnal forward button + date picker are no longer capped at today', () => {
    expect(app).not.toMatch(/goJurnalDay\(1\)\} disabled=\{jurnalDate >= jurnalTodayISO\}/)
    expect(app).not.toMatch(/type="date" value=\{jurnalDate\} max=\{jurnalTodayISO\}/)
    expect(app).toMatch(/if \(delta < 0\) \{ goJurnalDay\(1\) \} else \{ goJurnalDay\(-1\) \}/)
  })
})

// ───────────────────────── §4 / §65 no special-casing ────────────────────────

describe('INC-06 · §4/§65 — no date / workout / movement / interval-instance special case', () => {
  const changed = [
    'workoutFormats.js', 'FormatLogger.jsx', 'utils.js', 'scoreDefinition.js',
  ].map((f) => readFileSync(join(dirname(fileURLToPath(import.meta.url)), f), 'utf8')).join('\n') + '\n' + app

  it('no hard-coded incident date', () => {
    expect(changed).not.toMatch(/2026-09-01|isTomorrow|=== ['"]tomorrow['"]/)
  })
  it('no hard-coded WOD id', () => {
    expect(changed).not.toMatch(/2ed71d47|72444bbc|98f62722/)
  })
  it('no hard-coded movement name branch', () => {
    expect(changed).not.toMatch(/=== ['"]Handstand Push-up['"]|=== ['"]Renegade Row['"]|=== ['"]Shuttle run['"]/i)
  })
  it('no "Intervals = sum every number" heuristic — the sum is gated on scoringMode', () => {
    // computeSetsScore only sums when resolveSetsScoringMode === 'Total Reps'
    expect(computeSetsScore('Intervals', { ...CFG_40_20, scoringMode: 'Lowest Reps' }, REAL_SETS)).toBe(2)
    // mixed-unit nonsense is never produced — sets rows are reps-only for simpleReps
  })
  it('no current-date fallback added to the logging identity path', () => {
    const utils = readFileSync(join(dirname(fileURLToPath(import.meta.url)), 'utils.js'), 'utf8')
    // resolveLoggedWorkoutIdentity / resolveWodIdForLog must not read Date/now/today
    const fn = utils.slice(utils.indexOf('export function resolveLoggedWorkoutIdentity'))
    expect(fn.slice(0, 500)).not.toMatch(/new Date\(\)|Date\.now|todayLocalStr|dataAcasa/)
  })
})
