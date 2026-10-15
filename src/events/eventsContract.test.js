import { describe, it, expect, vi, beforeEach } from 'vitest'
import { readFileSync, readdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

// CONTRACT TEST - the member client against the Phase 1 migration itself
// (the same file the Admin app was built against). Any drift in an RPC name,
// a parameter name, the v1 format matrix, the division ids or the server
// error codes fails here.

const here = dirname(fileURLToPath(import.meta.url))
const migDir = join(here, '..', '..', 'supabase', 'migrations')
const migFile = readdirSync(migDir).find((f) => /_forge_events_phase1\.sql$/.test(f))
const sql = readFileSync(join(migDir, migFile), 'utf8')
// Every Events migration (Phase 1 + Phase 3.2 hardening, ...), for the error-code check.
const allEventsSql = readdirSync(migDir).filter((f) => /_forge_events_/.test(f)).sort().map((f) => readFileSync(join(migDir, f), 'utf8')).join('\n')

const rpcCalls = []
const tableCalls = []
vi.mock('../supabase', () => {
  const builder = (table) => {
    const entry = { table, ops: [] }
    tableCalls.push(entry)
    const chain = {}
    for (const op of ['select', 'eq', 'neq', 'in', 'order', 'limit', 'maybeSingle']) {
      chain[op] = (...args) => { entry.ops.push([op, args]); return chain }
    }
    chain.then = (res) => Promise.resolve({ data: [], error: null }).then(res)
    return chain
  }
  return {
    supabase: {
      from: builder,
      rpc: (name, params) => { rpcCalls.push([name, params]); return Promise.resolve({ data: [], error: null }) },
      storage: { from: () => ({ getPublicUrl: (p) => ({ data: { publicUrl: `u/${p}` } }) }) },
    },
  }
})

const api = await import('./eventsApi')
const { EVENT_SCORING_FORMATS } = await import('./eventScoring')
const { EVENT_DIVISIONS } = await import('./eventModel')
const { EVENTS_STRINGS } = await import('./eventsStrings')

function sqlFunctionParams(name) {
  const m = sql.match(new RegExp(`create or replace function public\\.${name}\\(([^)]*)\\)`))
  if (!m) return null
  return m[1].split(',').map((p) => p.trim().split(/\s+/)[0]).filter(Boolean)
}

beforeEach(() => { rpcCalls.length = 0; tableCalls.length = 0 })

describe('RPC names and parameter names match the migration', () => {
  it.each([
    ['joinEvent', ['e', 'rx'], 'event_join'],
    ['leaveEvent', ['e'], 'event_leave'],
    ['ackAnnouncement', ['e', 2, 'dismissed'], 'event_ack_announcement'],
    ['fetchPendingAnnouncements', [], 'my_pending_event_announcements'],
    ['submitAttempt', ['e', 'cid', {}], 'event_submit_attempt'],
    ['updateAttempt', ['a', {}], 'event_update_attempt'],
    ['deleteAttempt', ['a'], 'event_delete_attempt'],
    ['fetchRegistrationCounts', [['e']], 'event_registration_counts'],
  ])('%s -> %s', async (fn, args, rpcName) => {
    await api[fn](...args)
    const [name, params] = rpcCalls[0]
    expect(name).toBe(rpcName)
    const declared = sqlFunctionParams(rpcName)
    expect(declared).not.toBeNull()
    expect(Object.keys(params || {}).sort()).toEqual([...declared].sort())
  })

  it('members get EXECUTE on every RPC the PWA calls (and nothing internal)', () => {
    for (const name of ['event_join', 'event_leave', 'event_ack_announcement', 'my_pending_event_announcements', 'event_submit_attempt', 'event_update_attempt', 'event_delete_attempt', 'event_registration_counts']) {
      expect(sql).toMatch(new RegExp(`grant execute on function public\\.${name}\\([^)]*\\) to authenticated`))
    }
    expect(Object.keys(api)).not.toContain('forge_events_member_event')
  })
})

describe('reads are gym-scoped and never return drafts to members', () => {
  it('events', async () => {
    await api.fetchMemberEvents('g1')
    const ops = tableCalls[0].ops
    expect(tableCalls[0].table).toBe('events')
    expect(ops).toContainEqual(['eq', ['gym_id', 'g1']])
    expect(ops).toContainEqual(['neq', ['status', 'draft']])
  })
  it('feature flag = app_settings (gym_id, key events_enabled)', async () => {
    await api.fetchEventsEnabled('g1')
    expect(tableCalls[0].table).toBe('app_settings')
    expect(tableCalls[0].ops).toEqual(expect.arrayContaining([['eq', ['gym_id', 'g1']], ['eq', ['key', 'events_enabled']]]))
    expect(sql).toMatch(/key = 'events_enabled' and value = 'true'/)
  })
  it('no table writes at all from the member client (RPCs only)', () => {
    const src = readFileSync(join(here, 'eventsApi.js'), 'utf8')
    expect(src).not.toMatch(/\.(insert|update|upsert|delete)\(/)
    expect(src).not.toMatch(/from\('(classes|bookings|subscriptions|orders|payments|memberships|wod_logs)'\)/)
  })
})

describe('shared vocabulary matches the database', () => {
  it('v1 scoring formats = events_scoring_v1_formats', () => {
    const block = sql.match(/constraint events_scoring_v1_formats check \(([\s\S]*?)\)\s*\)/)[1]
    const formats = [...block.matchAll(/'([^']+)'/g)].map((m) => m[1])
    expect(EVENT_SCORING_FORMATS).toEqual(formats)
  })
  it('division ids = the CHECK list', () => {
    const m = sql.match(/division text not null check \(division in \(([^)]*)\)\)/)
    expect(EVENT_DIVISIONS).toEqual([...m[1].matchAll(/'([^']+)'/g)].map((x) => x[1]))
  })
  it('every error code a member RPC can raise has a message in both languages', () => {
    const codes = new Set([...allEventsSql.matchAll(/message = '([a-z_]+)'/g)].map((m) => m[1]))
    expect(codes.has('invalid_score_for_format') && codes.has('score_type_missing')).toBe(true)
    const staffOnly = new Set(['invalid_transition', 'event_already_ended', 'event_archived_read_only', 'scoring_locked', 'dates_would_invalidate_attempts', 'division_in_use', 'capacity_below_registrations', 'history_immutable', 'missing_client_attempt_id'])
    for (const code of codes) {
      if (staffOnly.has(code)) continue
      expect(EVENTS_STRINGS.en.err[code], `en ${code}`).toBeTruthy()
      expect(EVENTS_STRINGS.ro.err[code], `ro ${code}`).toBeTruthy()
    }
  })
  it('the score payload keys are exactly forge_events_clean_score\'s allowed keys', async () => {
    const { composeEventScoreFields } = await import('./eventScoring')
    const keys = Object.keys(composeEventScoreFields({ workout_format: 'AMRAP', workout_format_config: {} }, { roundsCompleted: '1' })).sort()
    const allowed = sql.match(/if k not in \(([^)]*)\)/)[1]
    expect(keys).toEqual([...allowed.matchAll(/'([^']+)'/g)].map((m) => m[1]).sort())
  })
})

describe('Admin <-> PWA parity pins (same literals pinned in forge-admin-web scoreTypeParity.test.ts)', () => {
  it('config fields of each v1 format', async () => {
    const { getFormat } = await import('../workoutFormats')
    const fields = Object.fromEntries(EVENT_SCORING_FORMATS.map((f) => [f, Object.keys(getFormat(f).config)]))
    expect(fields).toEqual({
      AMRAP: ['durationSec', 'structure'],
      'Ascending AMRAP': ['durationSec', 'startReps', 'incrementReps'],
      'For Time': ['structure', 'rounds', 'timeCapSec', 'sharedRepScheme'],
      RFT: ['rounds', 'timeCapSec', 'sharedRepScheme'],
      Chipper: ['timeCapSec', 'sharedRepScheme'],
      Ladder: ['sharedRepScheme', 'ladderType', 'timeCapSec'],
      'Partner WOD': ['splitType', 'baseFormat', 'durationSec', 'rounds'],
      Once: [],
      'Max Effort': ['movement', 'timeCapSec'],
    })
  })
  it('Max Effort score types + labels and division labels', async () => {
    const { MAX_EFFORT_UNITS } = await import('./eventScoring')
    expect(MAX_EFFORT_UNITS).toEqual(['load', 'reps', 'calories', 'distance_m', 'distance_km'])
    expect(EVENTS_STRINGS.en.scoreTypes).toEqual({ load: 'Load (kg/lb)', reps: 'Reps', calories: 'Calories', distance_m: 'Distance (m)', distance_km: 'Distance (km)' })
    expect(EVENTS_STRINGS.en.divisionLabels).toEqual({ rx: 'RX', intermediate: 'Intermediate', beginner: 'Scaled', onramp: 'OnRamp' })
  })
})

describe('Phase 3.2 hardening migration matches the clients', () => {
  const hardening = readdirSync(migDir).filter((f) => /_forge_events_max_effort_score_unit.sql$/.test(f)).map((f) => readFileSync(join(migDir, f), 'utf8'))[0]
  it('exists and runs after Phase 1', () => {
    expect(hardening).toBeTruthy()
    const files = readdirSync(migDir).filter((f) => /_forge_events_/.test(f)).sort()
    expect(files.indexOf(files.find((f) => f.includes('phase1')))).toBeLessThan(files.indexOf(files.find((f) => f.includes('max_effort_score_unit'))))
  })
  it('server score types = MAX_EFFORT_UNITS', async () => {
    const { MAX_EFFORT_UNITS } = await import('./eventScoring')
    const m = hardening.match(/select p_unit in (([^)]*))/)
    expect([...m[1].matchAll(/'([^']+)'/g)].map((x) => x[1])).toEqual(MAX_EFFORT_UNITS)
  })
  it('every member-side score the PWA composes for Max Effort satisfies the server rules', async () => {
    const { composeEventScoreFields } = await import('./eventScoring')
    const ok = (unit, value, wu) => {
      const f = composeEventScoreFields({ workout_format: 'Max Effort', workout_format_config: { scoreUnit: unit } }, { result: value }, wu)
      const n = Number(f.result)
      return /^[0-9]+(.[0-9]+)?$/.test(f.result) && n > 0 && f.time_result === null && f.completion_state === null && f.sets === null && f.log_meta === null && f.weight_logged === null
        && (unit === 'load' ? ['kg', 'lb'].includes(f.weight_unit) : f.weight_unit === null)
        && (['reps', 'calories'].includes(unit) ? Number.isInteger(n) : true)
    }
    expect(ok('load', '102.5', 'kg') && ok('load', '225', 'lbs') && ok('reps', '87') && ok('calories', '142') && ok('distance_m', '400') && ok('distance_km', '5.25')).toBe(true)
  })
})
