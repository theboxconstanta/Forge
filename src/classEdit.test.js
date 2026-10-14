import { describe, it, expect, vi } from 'vitest'
import {
  availableEditScopes, buildClassChanges, classEditErrorMessage, classEditInitialValues, classExpectedSnapshot,
  classHasEnded, editClassScope, newSeriesId, scopeToOwnSeries, singleScopeReason, validateClassEdit, ClassEditError,
} from './classEdit'
import { getT } from './translations'

const t = getT('en')
const NOW = new Date('2026-10-08T12:00:00')
const series = { id: 'c1', name: 'CrossFit', date: '2026-10-15', start_time: '09:00:00', end_time: '10:00:00', coach: 'Ana', max_spots: 12, color: null, series_id: 's1', series_exception: false }
const oneOff = { ...series, id: 'c2', series_id: null }

describe('classEditInitialValues / classExpectedSnapshot', () => {
  it('prefills from the card row, times as HH:MM', () => {
    expect(classEditInitialValues(series)).toEqual({ name: 'CrossFit', start_time: '09:00', end_time: '10:00', coach: 'Ana', max_spots: 12, color: null })
  })
  it('expected snapshot carries the raw DB values (optimistic concurrency)', () => {
    expect(classExpectedSnapshot(series)).toEqual({ name: 'CrossFit', start_time: '09:00:00', end_time: '10:00:00', coach: 'Ana', max_spots: 12, color: null })
  })
})

describe('buildClassChanges - only changed fields are ever sent', () => {
  it('no edits -> {}', () => {
    expect(buildClassChanges(series, classEditInitialValues(series))).toEqual({})
  })
  it('whitespace-only differences are not changes', () => {
    expect(buildClassChanges(series, { ...classEditInitialValues(series), name: '  CrossFit ', coach: 'Ana ' })).toEqual({})
  })
  it('rename only', () => {
    expect(buildClassChanges(series, { ...classEditInitialValues(series), name: 'Strength' })).toEqual({ name: 'Strength' })
  })
  it('time + coach + capacity + color', () => {
    const v = { ...classEditInitialValues(series), start_time: '09:30', end_time: '10:30', coach: 'Bob', max_spots: 14, color: '#ABE73C' }
    expect(buildClassChanges(series, v)).toEqual({ start_time: '09:30', end_time: '10:30', coach: 'Bob', max_spots: 14, color: '#ABE73C' })
  })
})

describe('validateClassEdit', () => {
  const ok = classEditInitialValues(series)
  it('valid form', () => expect(validateClassEdit(ok)).toBeNull())
  it('name required', () => expect(validateClassEdit({ ...ok, name: ' ' })).toBe('adminClassEditErrorName'))
  it('coach required', () => expect(validateClassEdit({ ...ok, coach: '' })).toBe('adminClassEditErrorCoach'))
  it('end must be after start', () => {
    expect(validateClassEdit({ ...ok, end_time: '09:00' })).toBe('adminClassEditErrorTime')
    expect(validateClassEdit({ ...ok, end_time: '08:00' })).toBe('adminClassEditErrorTime')
  })
  it('capacity >= 1', () => expect(validateClassEdit({ ...ok, max_spots: 0 })).toBe('adminClassEditErrorCapacity'))
  it('capacity below known bookings is blocked (12 booked -> 10 rejected)', () => {
    expect(validateClassEdit({ ...ok, max_spots: 10 }, { bookedCount: 12 })).toBe('adminClassEditErrorCapacityBooked')
    expect(validateClassEdit({ ...ok, max_spots: 12 }, { bookedCount: 12 })).toBeNull()
  })
  it('unknown booking count defers to the server', () => {
    expect(validateClassEdit({ ...ok, max_spots: 1 })).toBeNull()
  })
})

describe('scopes', () => {
  it('series occurrence not yet ended -> all three scopes', () => {
    expect(availableEditScopes(series, NOW)).toEqual(['this', 'future', 'series'])
    expect(singleScopeReason(series, NOW)).toBeNull()
  })
  it('one-off class -> this only', () => {
    expect(availableEditScopes(oneOff, NOW)).toEqual(['this'])
    expect(singleScopeReason(oneOff, NOW)).toBe('oneOff')
  })
  it('ended series occurrence -> this only (history never edited in bulk)', () => {
    const past = { ...series, date: '2026-10-08', end_time: '10:00:00' }
    expect(classHasEnded(past, NOW)).toBe(true)
    expect(availableEditScopes(past, NOW)).toEqual(['this'])
    expect(singleScopeReason(past, NOW)).toBe('ended')
  })
  it('today, not yet ended -> still a series scope', () => {
    const later = { ...series, date: '2026-10-08', start_time: '18:00:00', end_time: '19:00:00' }
    expect(availableEditScopes(later, NOW)).toEqual(['this', 'future', 'series'])
  })
})

describe('newSeriesId', () => {
  it('uses crypto.randomUUID when available', () => {
    expect(newSeriesId({ randomUUID: () => 'abc' })).toBe('abc')
  })
  it('falls back to an RFC 4122 v4 uuid', () => {
    const id = newSeriesId({ getRandomValues: (b) => { b.fill(255); return b } })
    expect(id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/)
  })
  it('distinct ids per call', () => {
    expect(newSeriesId()).not.toBe(newSeriesId())
  })
})

describe('editClassScope (RPC wrapper)', () => {
  it('sends anchor id, scope, expected snapshot, changes, dry-run flag', async () => {
    const rpc = vi.fn().mockResolvedValue({ data: { affected: 3 }, error: null })
    const out = await editClassScope({ rpc }, { cls: series, scope: 'future', changes: { name: 'X' }, dryRun: true })
    expect(out).toEqual({ affected: 3 })
    expect(rpc).toHaveBeenCalledWith('edit_class_scope', {
      p_class_id: 'c1', p_scope: 'future', p_expected: classExpectedSnapshot(series), p_changes: { name: 'X' }, p_dry_run: true,
    })
  })
  it('throws (never resolves) when the database rejects the write', async () => {
    const rpc = vi.fn().mockResolvedValue({ data: null, error: { message: 'capacity_below_bookings', details: '[{"date":"2026-10-15","booked":12}]' } })
    await expect(editClassScope({ rpc }, { cls: series, scope: 'this', changes: { max_spots: 10 } })).rejects.toMatchObject({
      code: 'capacity_below_bookings', detail: [{ date: '2026-10-15', booked: 12 }],
    })
  })
  it('unknown database errors map to "unknown" and keep the raw message', async () => {
    const rpc = vi.fn().mockResolvedValue({ data: null, error: { message: 'connection reset' } })
    const err = await editClassScope({ rpc }, { cls: series, scope: 'this', changes: { name: 'X' } }).catch(e => e)
    expect(err).toBeInstanceOf(ClassEditError)
    expect(err.code).toBe('unknown')
    expect(classEditErrorMessage(err, t)).toContain('connection reset')
  })
  it('a malformed success payload is treated as a failure', async () => {
    const rpc = vi.fn().mockResolvedValue({ data: null, error: null })
    await expect(editClassScope({ rpc }, { cls: series, scope: 'this', changes: { name: 'X' } })).rejects.toBeInstanceOf(ClassEditError)
  })
})

describe('classEditErrorMessage', () => {
  it('capacity violation lists dates and says nothing changed', () => {
    const msg = classEditErrorMessage(new ClassEditError('capacity_below_bookings', [{ date: '2026-10-15', booked: 12 }, { date: '2026-10-22', booked: 11 }]), t)
    expect(msg).toContain('2 classes have more bookings (up to 12)')
    expect(msg).toContain('2026-10-15, 2026-10-22')
    expect(msg).toContain('No class was changed')
  })
  it('concurrent edit', () => {
    expect(classEditErrorMessage(new ClassEditError('class_changed_concurrently'), t)).toBe(t.adminClassEditErrConcurrent)
  })
  it('duplicate', () => {
    expect(classEditErrorMessage(new ClassEditError('duplicate_class', ['2026-10-15']), t)).toContain('2026-10-15')
  })
  it('every mapped message exists in both languages', () => {
    for (const lang of ['ro', 'en']) {
      const tt = getT(lang)
      for (const code of ['invalid_time_range', 'invalid_capacity', 'invalid_name', 'invalid_coach', 'no_changes', 'class_changed_concurrently', 'class_not_found', 'not_authorized', 'series_scope_on_ended_class', 'not_a_series']) {
        expect(typeof classEditErrorMessage(new ClassEditError(code), tt)).toBe('string')
        expect(classEditErrorMessage(new ClassEditError(code), tt)).not.toBe('')
      }
    }
  })
})

describe('scopeToOwnSeries (Delete series target set)', () => {
  const q = () => { const ops = []; const b = { ops, eq: (...a) => { ops.push(['eq', ...a]); return b }, is: (...a) => { ops.push(['is', ...a]); return b } }; return b }
  it('series class: confined to its own series_id', () => {
    const b = scopeToOwnSeries(q(), { series_id: 's-1' })
    expect(b.ops).toEqual([['eq', 'series_id', 's-1']])
  })
  it('one-off class: only other series-less rows, never a real series', () => {
    expect(scopeToOwnSeries(q(), { series_id: null }).ops).toEqual([['is', 'series_id', null]])
    expect(scopeToOwnSeries(q(), {}).ops).toEqual([['is', 'series_id', null]])
  })
})
