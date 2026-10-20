import { describe, it, expect, beforeEach, vi } from 'vitest'
import {
  getBookingAccountingMode, isServerAccounting, bookingErrorKind, bookingErrorToast, noteBookingError,
  cancelClassesForStaff, __resetBookingAccountingModeForTests,
} from './bookingAccounting'

const fakeSupabase = (handler) => {
  const calls = []
  return { calls, rpc: vi.fn(async (fn, args) => { calls.push([fn, args]); return handler(fn, args, calls.length) }) }
}
const t = {
  toastSessionsExhausted: 'exhausted', toastCancelDeadlinePassed: 'deadline', toastBookingAttendedLocked: 'attended',
  toastNotAuthorizedAction: 'forbidden', toastAlreadyBooked: 'already', toastAppOutdatedRetry: 'outdated',
}

beforeEach(() => __resetBookingAccountingModeForTests())

describe('getBookingAccountingMode', () => {
  it('is server only when the migrated database says so', async () => {
    expect(await getBookingAccountingMode(fakeSupabase(() => ({ data: 'server', error: null })))).toBe('server')
  })
  it('is legacy when the function does not exist (pre-migration or rolled back)', async () => {
    expect(await getBookingAccountingMode(fakeSupabase(() => ({ data: null, error: { code: 'PGRST202' } })))).toBe('legacy')
  })
  it('falls back to legacy (the safe side) on a transient error with nothing cached', async () => {
    expect(await getBookingAccountingMode(fakeSupabase(() => ({ data: null, error: { code: '503' } })))).toBe('legacy')
    __resetBookingAccountingModeForTests()
    expect(await getBookingAccountingMode({ rpc: async () => { throw new Error('offline') } })).toBe('legacy')
  })
  it('a transient error never keeps a stale server mode (rollback-safe)', async () => {
    const sb = fakeSupabase((fn, args, n) => (n === 1 ? { data: 'server', error: null } : { data: null, error: { code: '503' } }))
    expect(await getBookingAccountingMode(sb)).toBe('server')
    expect(await getBookingAccountingMode(sb, { force: true })).toBe('legacy')
  })
  it('re-detects at the next action - no long-lived cache across a database rollback', async () => {
    const now = vi.spyOn(Date, 'now')
    try {
      now.mockReturnValue(1_000_000)
      const sb = fakeSupabase((fn, args, n) => (n === 1 ? { data: 'server', error: null } : { data: null, error: { code: 'PGRST202' } }))
      expect(await isServerAccounting(sb)).toBe(true)
      now.mockReturnValue(1_000_000 + 2_500)   // next user action, a few seconds later, after a rollback
      expect(await isServerAccounting(sb)).toBe(false)
      expect(sb.rpc).toHaveBeenCalledTimes(2)
    } finally { now.mockRestore() }
  })
  it('caches and de-duplicates concurrent detection', async () => {
    const sb = fakeSupabase(() => ({ data: 'server', error: null }))
    await Promise.all([isServerAccounting(sb), isServerAccounting(sb), isServerAccounting(sb)])
    await isServerAccounting(sb)
    expect(sb.rpc).toHaveBeenCalledTimes(1)
  })
  it('a FRG05 refusal forces re-detection (database migrated while the app was open)', async () => {
    const sb = fakeSupabase((fn, args, n) => (n === 1 ? { data: null, error: { code: 'PGRST202' } } : { data: 'server', error: null }))
    expect(await getBookingAccountingMode(sb)).toBe('legacy')
    noteBookingError({ code: 'FRG05' })
    expect(await getBookingAccountingMode(sb)).toBe('server')
  })
})

describe('server error mapping', () => {
  it.each([
    ['FRG02', 'exhausted'], ['FRG03', 'deadline'], ['FRG04', 'attended'], ['FRG07', 'forbidden'],
    ['42501', 'forbidden'], ['23505', 'already'], ['FRG05', 'outdated'], ['FRG06', 'outdated'],
  ])('%s -> %s', (code, toast) => {
    expect(bookingErrorToast(t, { code }, 'fallback')).toBe(toast)
  })
  it('legacy "exhausted" message without a code is still recognised', () => {
    expect(bookingErrorKind({ code: 'P0001', message: 'member x has exhausted their sessions (1 / 1)' })).toBe('exhausted')
  })
  it('anything else keeps the caller fallback', () => {
    expect(bookingErrorToast(t, { code: 'P0001', message: 'boom' }, 'fallback')).toBe('fallback')
    expect(bookingErrorKind(null)).toBe(null)
  })
})

describe('cancelClassesForStaff', () => {
  it('server mode: a series is ONE all-or-nothing cancel_classes call', async () => {
    const sb = fakeSupabase((fn) => (fn === 'forge_booking_accounting_mode' ? { data: 'server', error: null } : { data: 3, error: null }))
    expect(await cancelClassesForStaff(sb, ['a', 'b', 'a'])).toEqual({ cancelled: 2, refunded: 3, error: null })
    expect(sb.calls.filter(([fn]) => fn !== 'forge_booking_accounting_mode')).toEqual([['cancel_classes', { p_class_ids: ['a', 'b'] }]])
  })
  it('server mode: a single class uses cancel_class', async () => {
    const sb = fakeSupabase((fn) => (fn === 'forge_booking_accounting_mode' ? { data: 'server', error: null } : { data: 1, error: null }))
    await cancelClassesForStaff(sb, ['a'])
    expect(sb.calls.at(-1)).toEqual(['cancel_class', { p_class_id: 'a' }])
  })
  it('server mode: an error cancels nothing', async () => {
    const sb = fakeSupabase((fn) => (fn === 'forge_booking_accounting_mode' ? { data: 'server', error: null } : { data: null, error: { code: 'P0001' } }))
    expect(await cancelClassesForStaff(sb, ['a', 'b'])).toEqual({ cancelled: 0, refunded: 0, error: { code: 'P0001' } })
  })
  it('legacy mode: legacy cancel_class per class, never a direct delete; partial progress is reported', async () => {
    const sb = fakeSupabase((fn, args) => {
      if (fn === 'forge_booking_accounting_mode') return { data: null, error: { code: 'PGRST202' } }
      return args.p_class_id === 'c' ? { data: null, error: { code: 'P0001', message: 'attendance' } } : { data: 2, error: null }
    })
    const r = await cancelClassesForStaff(sb, ['a', 'b', 'c', 'd'])
    expect(r).toEqual({ cancelled: 2, refunded: 4, error: { code: 'P0001', message: 'attendance' } })
    expect(sb.calls.filter(([fn]) => fn === 'cancel_class').map(([, a]) => a.p_class_id)).toEqual(['a', 'b', 'c'])
  })
  it('nothing to cancel: no calls', async () => {
    const sb = fakeSupabase(() => ({ data: 'server', error: null }))
    expect(await cancelClassesForStaff(sb, [])).toEqual({ cancelled: 0, refunded: 0, error: null })
    expect(sb.rpc).not.toHaveBeenCalled()
  })
})
