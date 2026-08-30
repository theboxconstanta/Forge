import { describe, it, expect } from 'vitest'
import snapshot from './movementCapabilitySnapshot.json'
import {
  buildMovementIndex,
  resolveCatalogMovementByName,
  resolveCatalogMovementForInstance,
  resolveInstanceCapability,
  backfillInstanceIdentity,
  assertCapabilityIntegrity,
  normalizeMovementName,
  movementNameKeys,
  resolveMovementCapability,
} from './prescriptionContract.js'

// P9.3 — CATALOG-WIDE movement capability integrity.
//
// `movementCapabilitySnapshot.json` is a checked-in snapshot of every platform
// `movements` row (id / name / aliases / allowed_prescription_metrics /
// default_prescription_metric) taken AFTER migration
// 20260830100000_p9_3_movement_capability_integrity.sql. A future seed or
// migration that silently breaks a movement's capability — or a resolver
// regression — fails here, catalog-wide, instead of being discovered one
// exercise at a time.

const rows = snapshot.map((m) => ({
  id: m.id,
  name: m.name,
  aliases: m.aliases,
  allowed_prescription_metrics: m.allowed,
  default_prescription_metric: m.default,
}))
const index = buildMovementIndex(rows)
const sig = (r) =>
  r ? ((r.allowed_prescription_metrics || []).slice().sort().join('+') || 'none') + '/' + (r.default_prescription_metric || 'null') : '—'

describe('P9.3 — catalog snapshot invariants', () => {
  it('has the expected shape and size', () => {
    expect(rows.length).toBeGreaterThanOrEqual(460)
    for (const r of rows) {
      expect(typeof r.id).toBe('string')
      expect(typeof r.name).toBe('string')
      expect(Array.isArray(r.allowed_prescription_metrics)).toBe(true)
    }
  })

  it('every row: default_prescription_metric is null OR a member of allowed (DB CHECK mirror)', () => {
    const bad = rows.filter(
      (r) => r.default_prescription_metric && !(r.allowed_prescription_metrics || []).includes(r.default_prescription_metric),
    )
    expect(bad.map((r) => r.name)).toEqual([])
  })

  it('every allowed metric is one of reps|load|distance|calories', () => {
    const ok = new Set(['reps', 'load', 'distance', 'calories'])
    const bad = rows.filter((r) => (r.allowed_prescription_metrics || []).some((m) => !ok.has(m)))
    expect(bad.map((r) => r.name)).toEqual([])
  })
})

describe('P9.3 — every catalog row resolves deterministically to itself', () => {
  it('no self-resolution failure and no capability drift across the whole catalog', () => {
    const failures = []
    for (const r of rows) {
      const hit = resolveCatalogMovementByName(index, r.name)
      if (!hit || hit.ambiguous) { failures.push(`${r.name}: ${hit && hit.ambiguous ? 'AMBIGUOUS ' + hit.candidates : 'MISS'}`); continue }
      if (sig(hit) !== sig(r)) failures.push(`${r.name}: ${sig(r)} -> ${hit.name} ${sig(hit)}`)
    }
    expect(failures).toEqual([])
  })

  it('every alias resolves to its own row (capability-equal)', () => {
    const failures = []
    for (const r of rows) {
      for (const a of r.aliases || []) {
        const hit = resolveCatalogMovementByName(index, a)
        if (!hit || hit.ambiguous || sig(hit) !== sig(r)) failures.push(`${r.name} alias "${a}"`)
      }
    }
    expect(failures).toEqual([])
  })
})

describe('P9.3 — representative capability expectations (deterministic movements)', () => {
  const EXPECT = {
    // barbell / weighted — load
    'Power Clean': 'load+reps/load', Snatch: 'load+reps/load', Deadlift: 'load+reps/load', Thruster: 'load+reps/load',
    'Clean & Jerk': 'load+reps/load', 'Front Squat': 'load+reps/load', 'Back Squat': 'load+reps/load', 'Overhead Squat': 'load+reps/load',
    'Push Press': 'load+reps/load', 'Push Jerk': 'load+reps/load', 'Split Jerk': 'load+reps/load', 'Bench Press': 'load+reps/load',
    'Power Snatch': 'load+reps/load', 'Squat Clean': 'load+reps/load', 'Hang Power Clean': 'load+reps/load',
    // dumbbell / kettlebell — load
    'DB Snatch': 'load+reps/load', 'Dumbbell Thruster': 'load+reps/load', 'Goblet Squat': 'load+reps/load',
    'KB Swing': 'load+reps/load', 'Kettlebell Swing': 'load+reps/load',
    // wall ball — load, NO height
    'Wall Ball': 'load+reps/load', 'Wall Ball Shot': 'load+reps/load',
    // bodyweight / gymnastics — reps only
    Burpee: 'reps/reps', 'Pull-up': 'reps/reps', 'Chest to Bar Pull-up': 'reps/reps', 'Toes to Bar': 'reps/reps',
    'Push-up': 'reps/reps', 'Air Squat': 'reps/reps', 'Handstand Push-up': 'reps/reps', 'Muscle-up': 'reps/reps',
    'Double Under': 'reps/reps',
    // erg / cardio
    Row: 'calories+distance/calories', 'Ski Erg': 'calories+distance/calories', 'Bike Erg': 'calories+distance/calories',
    'Assault Bike': 'calories+distance/calories', 'Echo Bike': 'calories+distance/calories', 'Air Bike': 'calories+distance/calories',
    Run: 'distance/distance', 'Shuttle Run': 'distance/distance', Swim: 'distance/distance',
    // carries — load + distance
    'Farmers Carry': 'distance+load/load', 'Sandbag Carry': 'distance+load/load', 'Suitcase Carry': 'distance+load/load',
    'Overhead Walk': 'distance+load/load',
    // static holds — no prescription metric (time lives in the section/format)
    Plank: 'none/null', 'Wall Sit': 'none/null', 'Handstand Hold': 'none/null', 'Hollow Hold': 'none/null', 'L Sit': 'none/null',
    // the one capability-disagreeing duplicate pair, now aligned
    'Sledgehammer Strike': 'load+reps/load', 'Sledgehammer Strikes': 'load+reps/load',
  }
  for (const [name, expected] of Object.entries(EXPECT)) {
    it(`${name} → ${expected}`, () => {
      const row = rows.find((r) => r.name === name)
      expect(row, `catalog row "${name}" missing`).toBeTruthy()
      expect(sig(row)).toBe(expected)
    })
  }
})

describe('P9.3 — the Wall Ball acceptance-failure class is closed', () => {
  const spellings = ['Wall Ball', 'Wallball', 'Wallballs', 'Wall Balls', 'Wall-Ball', 'wall ball', 'WB']
  for (const s of spellings) {
    it(`"${s}" resolves to Wall Ball with a Load capability`, () => {
      const hit = resolveCatalogMovementByName(index, s)
      expect(hit && !hit.ambiguous).toBe(true)
      expect(hit.name).toBe('Wall Ball')
      expect(resolveMovementCapability(hit).allowed).toContain('load')
    })
  }

  it('a load-capable movement never silently degrades to reps-only (scheme must not mask a failure)', () => {
    // instance carries the canonical id — capability comes from the row, id-first
    const wb = rows.find((r) => r.name === 'Wall Ball')
    const inst = { instanceId: 'x', name: 'Wallballs', canonicalMovementId: wb.id, reps: { mode: 'universal', value: 20 } }
    const cap = resolveInstanceCapability(index, inst)
    expect(cap.allowed).toContain('load')
    expect(cap.unknown).toBe(false)
    // dev invariant does NOT throw for a healthy row
    expect(() => assertCapabilityIntegrity(index, inst)).not.toThrow()
  })
})

describe('P9.3 — identity-first resolution', () => {
  it('a persisted canonicalMovementId wins over a drifted display name', () => {
    const pc = rows.find((r) => r.name === 'Power Clean')
    const inst = { instanceId: 'a', name: 'totally different text', canonicalMovementId: pc.id }
    expect(resolveCatalogMovementForInstance(index, inst).name).toBe('Power Clean')
    expect(resolveInstanceCapability(index, inst).default).toBe('load')
  })

  it('an id-less instance falls back to deterministic name resolution', () => {
    const inst = { instanceId: 'b', name: 'wall-balls' }
    expect(resolveCatalogMovementForInstance(index, inst).name).toBe('Wall Ball')
  })

  it('backfillInstanceIdentity fills a deterministic id, leaves ambiguous / unknown alone', () => {
    const out = backfillInstanceIdentity(
      [
        { instanceId: '1', name: 'Wallballs' },
        { instanceId: '2', name: 'zzz not a movement zzz' },
        { instanceId: '3', name: 'Power Clean', canonicalMovementId: 'already-set' },
      ],
      index,
    )
    expect(out[0].canonicalMovementId).toBe(rows.find((r) => r.name === 'Wall Ball').id)
    expect(out[1].canonicalMovementId).toBeUndefined()
    expect(out[2].canonicalMovementId).toBe('already-set')
  })
})

describe('P9.3 — normalizer + ambiguity (synthetic)', () => {
  it('normalizeMovementName folds separators, case, "&", punctuation', () => {
    expect(normalizeMovementName('Clean & Jerk')).toBe('clean and jerk')
    expect(normalizeMovementName('Chest-to-Bar Pull-up')).toBe('chest to bar pull up')
    expect(normalizeMovementName("Farmer's  Carry")).toBe('farmers carry')
    expect(normalizeMovementName('  DB   Snatch ')).toBe('db snatch')
  })

  it('movementNameKeys depluralises names but treats aliases as exact', () => {
    expect(movementNameKeys('Wallballs')).toContain('wallball')
    expect(movementNameKeys('wbs', { isAlias: true })).not.toContain('wb')
  })

  it('capability-DISAGREEING rows under one key → ambiguous (never a silent wrong pick)', () => {
    const synth = buildMovementIndex([
      { id: 'x1', name: 'Thing', allowed_prescription_metrics: ['load', 'reps'], default_prescription_metric: 'load' },
      { id: 'x2', name: 'Things', allowed_prescription_metrics: ['reps'], default_prescription_metric: 'reps' },
    ])
    const hit = resolveCatalogMovementByName(synth, 'thing')
    expect(hit && hit.ambiguous).toBe(true)
    expect(hit.candidates.sort()).toEqual(['Thing', 'Things'])
  })

  it('capability-AGREEING duplicate rows → deterministic pick (shortest name, then id)', () => {
    const synth = buildMovementIndex([
      { id: 'b', name: 'Dumbbell Snatch', allowed_prescription_metrics: ['load', 'reps'], default_prescription_metric: 'load' },
      { id: 'a', name: 'DB Snatch', allowed_prescription_metrics: ['load', 'reps'], default_prescription_metric: 'load' },
    ])
    expect(resolveCatalogMovementByName(synth, 'dumbbell snatch').name).toBe('DB Snatch')
  })

  it('assertCapabilityIntegrity throws when a known id with capabilities resolves unknown', () => {
    const broken = buildMovementIndex([
      { id: 'k', name: 'Broken', allowed_prescription_metrics: ['load'], default_prescription_metric: 'load' },
    ])
    // simulate resolveMovementCapability returning unknown by poisoning the row
    broken.byId.get('k').allowed_prescription_metrics = ['not-a-metric']
    expect(() => assertCapabilityIntegrity(broken, { instanceId: 'i', name: 'Broken', canonicalMovementId: 'k' })).toThrow(/capability-integrity/)
  })
})
