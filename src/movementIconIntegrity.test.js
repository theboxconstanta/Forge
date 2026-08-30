import { describe, it, expect } from 'vitest'
import snapshot from './movementCapabilitySnapshot.json'
import iconMap from './movementIconMap.json'
import { resolveMovementIconKey, ICON_KEYS, ICON_KEY_SET } from './movementIcons.js'

// P9.5 — catalog-wide movement icon integrity. Every one of the current 465
// platform movements must deterministically resolve to a known ICON_KEY or the
// explicit OTHER fallback — never undefined / null / a broken key.

const byId = new Map(snapshot.map((m) => [m.id, m.name]))

describe('P9.5 — icon map integrity', () => {
  it('has one entry per catalog movement', () => {
    expect(Object.keys(iconMap).length).toBe(snapshot.length)
    for (const m of snapshot) expect(Object.prototype.hasOwnProperty.call(iconMap, m.id)).toBe(true)
  })

  it('every mapped value is a known ICON_KEY', () => {
    const bad = Object.entries(iconMap).filter(([, k]) => !ICON_KEY_SET.has(k))
    expect(bad).toEqual([])
  })

  it('every catalog movement resolves to a valid icon key (id-first), never undefined', () => {
    for (const m of snapshot) {
      const k = resolveMovementIconKey({ canonicalMovementId: m.id })
      expect(ICON_KEY_SET.has(k), `${m.name} -> ${k}`).toBe(true)
    }
  })

  it('a bare id string resolves identically to an instance', () => {
    const m = snapshot[0]
    expect(resolveMovementIconKey(m.id)).toBe(resolveMovementIconKey({ canonicalMovementId: m.id }))
  })

  it('unknown / custom / id-less movement -> OTHER', () => {
    expect(resolveMovementIconKey(null)).toBe('OTHER')
    expect(resolveMovementIconKey({})).toBe('OTHER')
    expect(resolveMovementIconKey({ canonicalMovementId: '00000000-0000-0000-0000-000000000000' })).toBe('OTHER')
    expect(resolveMovementIconKey('not-a-real-id')).toBe('OTHER')
  })

  it('OTHER contains ONLY named benchmark/hero WODs (not real movements) — coverage bar §5', () => {
    const other = Object.entries(iconMap).filter(([, k]) => k === 'OTHER').map(([id]) => byId.get(id) || id)
    // Every OTHER entry must be a recognised named workout, not an ordinary exercise.
    const NAMED = /^(adam|amanda|angie|annie|badger|barbara|chelsea|cindy|danny|desforges|diane|dt|elizabeth|eva|forrest|fran|glen|grace|griff|helen|isabel|j\.?t\.?|jackie|josh|kalsu|karen|kelly|linda|lynne|mary|michael|murph|nancy|nate|nicole|nutts|randy|ryan|scott|ship)$/i
    const notNamed = other.filter((name) => !NAMED.test(String(name).trim()))
    expect(notNamed).toEqual([])
    expect(other.length).toBeLessThanOrEqual(45)
  })

  it('distribution is spread across families, not dominated by OTHER', () => {
    const dist = {}
    for (const k of Object.values(iconMap)) dist[k] = (dist[k] || 0) + 1
    expect(dist.OTHER / snapshot.length).toBeLessThan(0.12)
    expect(dist.BARBELL).toBeGreaterThan(40)
    expect(Object.keys(dist).length).toBeGreaterThanOrEqual(18)
    // sanity: every family key that appears is declared
    for (const k of Object.keys(dist)) expect(ICON_KEYS).toContain(k)
  })
})

describe('P9.5 — representative icon families (identity-first)', () => {
  const want = {
    'Power Clean': 'BARBELL', 'Power Snatch': 'BARBELL', 'Snatch': 'BARBELL', 'Deadlift': 'BARBELL',
    'Thruster': 'BARBELL', 'Clean & Jerk': 'BARBELL', 'Overhead Squat': 'BARBELL',
    'DB Snatch': 'DUMBBELL', 'Dumbbell Snatch': 'DUMBBELL', 'Dumbbell Thruster': 'DUMBBELL',
    'KB Swing': 'KETTLEBELL', 'Kettlebell Swing': 'KETTLEBELL', 'Goblet Squat': 'KETTLEBELL',
    'Wall Ball': 'WALL_BALL', 'Wall Ball Shot': 'WALL_BALL',
    'Row': 'ROWER', 'Ski Erg': 'SKIERG', 'Echo Bike': 'BIKE', 'Assault Bike': 'BIKE', 'Bike Erg': 'BIKE',
    'Run': 'RUN', 'Shuttle Run': 'RUN',
    'Box Jump': 'BOX', 'Box Jump Over': 'BOX',
    'Pull-up': 'GYMNASTICS', 'Toes to Bar': 'GYMNASTICS', 'Chest to Bar Pull-up': 'GYMNASTICS',
    'Handstand Push-up': 'GYMNASTICS', 'Muscle-up': 'GYMNASTICS',
    'Double Under': 'JUMP_ROPE', 'Single Under': 'JUMP_ROPE',
    'Rope Climb': 'ROPE',
    'Farmers Carry': 'CARRY', 'Sandbag Carry': 'CARRY',
    'Push-up': 'BODYWEIGHT', 'Air Squat': 'BODYWEIGHT', 'Burpee': 'BODYWEIGHT',
    'Bench Press': 'BENCH', 'GHD Sit-up': 'GHD',
    'Fran': 'OTHER', 'Murph': 'OTHER',
  }
  for (const [name, key] of Object.entries(want)) {
    it(`${name} -> ${key}`, () => {
      const row = snapshot.find((m) => m.name === name)
      expect(row, `catalog row "${name}"`).toBeTruthy()
      expect(resolveMovementIconKey({ canonicalMovementId: row.id })).toBe(key)
    })
  }

  it('an alias resolves to the same icon as its canonical row (id-first)', () => {
    // WB / Wallballs / Wall Ball all resolve to the same canonicalMovementId
    // upstream (P9.3), so they share Wall Ball's icon by construction.
    const wb = snapshot.find((m) => m.name === 'Wall Ball')
    expect(resolveMovementIconKey({ canonicalMovementId: wb.id, name: 'Wallballs' })).toBe('WALL_BALL')
  })
})
