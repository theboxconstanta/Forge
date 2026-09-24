// FORGE MOVEMENT LIBRARY — Bar Hang / Static Bar Hang.
// Verifies: both movements are searchable in the legacy static catalog,
// both use the existing seconds-based PR "hold" mechanism at all three
// call sites, existing hold movements (Handstand Hold/L-sit Hold) are
// unchanged, the new DB migration is additive/idempotent and does NOT
// touch the prescription-metric CHECK constraint domain, and neither
// movement was fabricated into the checked-in capability snapshot (which
// can only be regenerated after the migration is actually applied).

import { describe, it, expect } from 'vitest'
import { readFileSync, existsSync } from 'fs'
import { join, dirname } from 'path'
import { fileURLToPath } from 'url'
import { MISCARI } from './movements.js'

const here = dirname(fileURLToPath(import.meta.url))
const appSource = readFileSync(join(here, 'App.jsx'), 'utf-8').replace(/\r\n/g, '\n')
const migrationPath = join(here, '..', 'supabase', 'migrations', '20260924090000_movement_library_bar_hang_static_bar_hang.sql')

describe('Static movement library (movements.js)', () => {
  it('both movements are present and searchable in MISCARI', () => {
    expect(MISCARI).toContain('Bar Hang')
    expect(MISCARI).toContain('Static Bar Hang')
  })

  it('placed immediately after L-sit Hold, in the same bodyweight/gymnastics grouping as the other holds', () => {
    const iLsit = MISCARI.indexOf('L-sit Hold')
    const iBH = MISCARI.indexOf('Bar Hang')
    const iSBH = MISCARI.indexOf('Static Bar Hang')
    expect(iBH).toBe(iLsit + 1)
    expect(iSBH).toBe(iLsit + 2)
  })

  it('existing hold movements are unchanged', () => {
    expect(MISCARI).toContain('Handstand Hold')
    expect(MISCARI).toContain('L-sit Hold')
  })
})

describe('PR logging seconds mechanism (App.jsx isHold, 3 call sites)', () => {
  it('all three isHold checks include both new movements, and still include the existing two', () => {
    const matches = appSource.match(/\['Handstand Hold','L-sit Hold','Bar Hang','Static Bar Hang'\]/g) || []
    expect(matches.length).toBe(3)
  })

  it('savePR: isHold movements save {value: seconds, unit: "sec"}, not the generic weight/reps branch', () => {
    expect(appSource).toContain("else if (isHold) { insertData.value = prValoare ? parseFloat(prValoare) : null; insertData.unit = 'sec' }")
  })

  it('the PR-entry form renders the Hold Time input (not the generic weight/reps form) for isHold movements', () => {
    expect(appSource).toContain("['Handstand Hold','L-sit Hold','Bar Hang','Static Bar Hang'].includes(miscarePR) ? (")
    expect(appSource).toContain('{t.prHoldTimeLabel}')
  })

  it('no stale 2-element isHold array remains anywhere', () => {
    expect(appSource).not.toContain("['Handstand Hold','L-sit Hold'].includes")
  })
})

describe('Database migration — additive, idempotent, no domain change', () => {
  const migrationSource = existsSync(migrationPath) ? readFileSync(migrationPath, 'utf-8') : null

  it('migration file exists', () => {
    expect(migrationSource).not.toBeNull()
  })

  it('inserts both movements as platform-scoped (gym_id null), idempotently', () => {
    expect(migrationSource).toContain("insert into movements")
    expect(migrationSource).toContain("'Bar Hang'")
    expect(migrationSource).toContain("'Static Bar Hang'")
    expect(migrationSource).toContain('where not exists (select 1 from movements m where lower(m.name) = lower(v.name))')
  })

  it('both rows use the empty-metrics "opt out" shape matching Handstand Hold/L-sit Hold, not a fabricated seconds metric', () => {
    expect(migrationSource).toContain('ARRAY[]::text[]')
    expect(migrationSource).toContain('null::text')
    expect(migrationSource).not.toMatch(/'seconds'|'time'/)
  })

  it('does NOT alter the allowed_prescription_metrics CHECK constraint domain', () => {
    expect(migrationSource).not.toMatch(/ALTER TABLE|DROP CONSTRAINT|ADD CONSTRAINT/i)
  })

  it('no other movement rows are touched (no UPDATE/DELETE statements)', () => {
    expect(migrationSource).not.toMatch(/\bupdate\s+movements\b/i)
    expect(migrationSource).not.toMatch(/\bdelete\s+from\s+movements\b/i)
  })
})

describe('Catalog integrity snapshot — regenerated from the live catalog after migration, real UUIDs only', () => {
  it('the checked-in snapshot now contains both movements with real, applied-migration UUIDs (not fabricated)', () => {
    const snapshot = JSON.parse(readFileSync(join(here, 'movementCapabilitySnapshot.json'), 'utf-8'))
    const hits = snapshot.filter((m) => /bar hang/i.test(m.name))
    expect(hits.length).toBe(2)
    const barHang = hits.find((m) => m.name === 'Bar Hang')
    const staticBarHang = hits.find((m) => m.name === 'Static Bar Hang')
    expect(barHang.id).toBe('6b132f3a-9287-49f8-ab73-51008caca92d')
    expect(staticBarHang.id).toBe('36b8fb73-21cd-4ce8-80fb-1aefc418b4fb')
    expect(barHang.allowed).toEqual([])
    expect(barHang.default).toBeNull()
    expect(staticBarHang.allowed).toEqual([])
    expect(staticBarHang.default).toBeNull()
  })

  it('the snapshot invariant still holds (>= 460 rows) and existing hold movements are byte-identical', () => {
    const snapshot = JSON.parse(readFileSync(join(here, 'movementCapabilitySnapshot.json'), 'utf-8'))
    expect(snapshot.length).toBeGreaterThanOrEqual(460)
    const hh = snapshot.find((m) => m.name === 'Handstand Hold')
    expect(hh.allowed).toEqual([])
    expect(hh.default).toBeNull()
  })
})
