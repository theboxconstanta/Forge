import { describe, it, expect } from 'vitest'
import {
  eventPhase, eventDisplayStatus, registrationState, eventDivisions, scoringState,
  categorizeEvents, eventErrorCode, registrationClosesMs,
} from './eventModel'

const NOW = Date.parse('2026-10-15T12:00:00Z')
const h = (hours) => new Date(NOW + hours * 3600_000).toISOString()
const ev = (p = {}) => ({
  id: p.id || 'e1', status: 'published', starts_at: h(24), ends_at: h(30), registration_enabled: true,
  registration_deadline: null, capacity: null, divisions: ['rx', 'beginner'], has_workout: false, scoring_enabled: false, ...p,
})

describe('eventPhase / display status (mirrors coalesce(ends_at, starts_at))', () => {
  it('upcoming, live, ended', () => {
    expect(eventPhase(ev(), NOW)).toBe('upcoming')
    expect(eventPhase(ev({ starts_at: h(-1), ends_at: h(1) }), NOW)).toBe('live')
    expect(eventPhase(ev({ starts_at: h(-3), ends_at: h(-1) }), NOW)).toBe('ended')
    expect(eventPhase(ev({ starts_at: h(-1), ends_at: null }), NOW)).toBe('ended')
  })
  it('cancelled / archived outrank time', () => {
    expect(eventDisplayStatus(ev({ status: 'cancelled' }), NOW)).toBe('cancelled')
    expect(eventDisplayStatus(ev({ status: 'archived', starts_at: h(-9), ends_at: h(-8) }), NOW)).toBe('archived')
  })
})

describe('registrationState mirrors event_join / event_leave', () => {
  it('open with places left', () => {
    const r = registrationState(ev({ capacity: 10 }), null, 7, NOW)
    expect(r).toMatchObject({ canJoin: true, placesLeft: 3, full: false, reason: 'open', isRegistered: false })
  })
  it('full', () => {
    expect(registrationState(ev({ capacity: 10 }), null, 10, NOW)).toMatchObject({ canJoin: false, full: true, reason: 'full', placesLeft: 0 })
  })
  it('closes at coalesce(deadline, ends_at, starts_at)', () => {
    expect(registrationClosesMs(ev({ registration_deadline: h(5) }))).toBe(NOW + 5 * 3600_000)
    expect(registrationState(ev({ registration_deadline: h(-1) }), null, 0, NOW)).toMatchObject({ canJoin: false, reason: 'closed' })
    // a live scoring challenge stays joinable until it ends
    expect(registrationState(ev({ starts_at: h(-24), ends_at: h(24) }), null, 0, NOW).canJoin).toBe(true)
  })
  it('registration off / not published', () => {
    expect(registrationState(ev({ registration_enabled: false }), null, 0, NOW)).toMatchObject({ canJoin: false, reason: 'off' })
    expect(registrationState(ev({ status: 'cancelled' }), null, 0, NOW)).toMatchObject({ canJoin: false, reason: 'not_open' })
  })
  it('registered: leave until start (non-scoring) or until end (scoring)', () => {
    const reg = { status: 'registered', division: 'beginner' }
    expect(registrationState(ev(), reg, 1, NOW)).toMatchObject({ isRegistered: true, division: 'beginner', canLeave: true, canJoin: false })
    expect(registrationState(ev({ starts_at: h(-1), ends_at: h(5) }), reg, 1, NOW).canLeave).toBe(false)
    expect(registrationState(ev({ starts_at: h(-1), ends_at: h(5), scoring_enabled: true }), reg, 1, NOW).canLeave).toBe(true)
  })
  it('a withdrawn row is not registered', () => {
    expect(registrationState(ev(), { status: 'withdrawn', division: 'rx' }, 0, NOW).isRegistered).toBe(false)
  })
})

describe('eventDivisions keeps the canonical order', () => {
  it('rx, intermediate, beginner, onramp', () => {
    expect(eventDivisions({ divisions: ['onramp', 'rx', 'beginner'] })).toEqual(['rx', 'beginner', 'onramp'])
  })
})

describe('scoringState mirrors event_submit_attempt', () => {
  const scoring = (p) => ev({ has_workout: true, scoring_enabled: true, ...p })
  it('before / open / after / not published / no scoring', () => {
    expect(scoringState(scoring({}), NOW).phase).toBe('before')
    expect(scoringState(scoring({ starts_at: h(-1), ends_at: h(1) }), NOW)).toMatchObject({ open: true, phase: 'open' })
    expect(scoringState(scoring({ starts_at: h(-3), ends_at: h(-1) }), NOW).phase).toBe('after')
    expect(scoringState(scoring({ starts_at: h(-1), ends_at: h(1), status: 'cancelled' }), NOW).open).toBe(false)
    expect(scoringState(ev(), NOW).enabled).toBe(false)
  })
})

describe('categorizeEvents (Upcoming / Active / My events / Past)', () => {
  const events = [
    ev({ id: 'up', starts_at: h(48), ends_at: h(50) }),
    ev({ id: 'live', starts_at: h(-2), ends_at: h(200), has_workout: true, scoring_enabled: true }),
    ev({ id: 'past', starts_at: h(-50), ends_at: h(-48) }),
    ev({ id: 'arch', status: 'archived', starts_at: h(-90), ends_at: h(-80) }),
    ev({ id: 'cancelled-future', status: 'cancelled', starts_at: h(10), ends_at: h(12) }),
    ev({ id: 'draft', status: 'draft' }),
  ]
  const regs = [{ event_id: 'up', status: 'registered' }, { event_id: 'past', status: 'registered' }, { event_id: 'live', status: 'withdrawn' }]
  const g = categorizeEvents(events, regs, NOW)
  it('never shows drafts', () => {
    expect(Object.values(g).flat().some((e) => e.id === 'draft')).toBe(false)
  })
  it('splits by phase; cancelled future events stay visible in Upcoming', () => {
    expect(g.upcoming.map((e) => e.id)).toEqual(['cancelled-future', 'up'])
    expect(g.active.map((e) => e.id)).toEqual(['live'])
    expect(g.past.map((e) => e.id)).toEqual(['past', 'arch'])
  })
  it('My events = registered and not over', () => {
    expect(g.mine.map((e) => e.id)).toEqual(['up'])
  })
})

describe('eventErrorCode', () => {
  it('maps every server code and marks network failures as unknown-outcome', () => {
    expect(eventErrorCode(new Error('event_full'))).toBe('event_full')
    expect(eventErrorCode({ message: 'P0001: attempt_limit_reached' })).toBe('attempt_limit_reached')
    expect(eventErrorCode(new TypeError('Failed to fetch'))).toBe('network')
    expect(eventErrorCode(new Error('something else'))).toBe('generic')
  })
})

describe('leave is not offered once the member has attempts (leave_locked_attempts_exist)', () => {
  it('scoring event with an attempt (deleted ones included) -> cannot leave', () => {
    const e = ev({ starts_at: h(-1), ends_at: h(5), scoring_enabled: true, has_workout: true })
    const reg = { status: 'registered', division: 'rx' }
    expect(registrationState(e, reg, 1, NOW, 0).canLeave).toBe(true)
    expect(registrationState(e, reg, 1, NOW, 1).canLeave).toBe(false)
  })
})
