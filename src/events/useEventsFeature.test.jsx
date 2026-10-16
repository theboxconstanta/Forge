import { describe, it, expect, vi, beforeEach } from 'vitest'
import { renderHook, waitFor, act } from '@testing-library/react'

const handlers = []
const removeChannel = vi.fn()
vi.mock('../supabase', () => {
  const channel = () => {
    const ch = {
      on: (_type, filter, cb) => { handlers.push({ filter, cb }); return ch },
      subscribe: () => ch,
    }
    return ch
  }
  return { supabase: { channel, removeChannel } }
})

const { useEventsFeature } = await import('./useEventsFeature')

beforeEach(() => { handlers.length = 0; removeChannel.mockClear() })

describe('useEventsFeature', () => {
  it('unknown until answered; never true without a confirmed read', async () => {
    let resolve
    const fetchFlag = vi.fn(() => new Promise((r) => { resolve = r }))
    const { result } = renderHook(() => useEventsFeature({ userId: 'u', gymId: 'g', fetchFlag }))
    expect(result.current.enabled).toBeNull()
    await act(async () => resolve(true))
    expect(result.current.enabled).toBe(true)
  })

  it('profile not loaded yet = unknown; member without a gym = off', () => {
    expect(renderHook(() => useEventsFeature({ userId: 'u', gymId: undefined, fetchFlag: vi.fn() })).result.current.enabled).toBeNull()
    expect(renderHook(() => useEventsFeature({ userId: 'u', gymId: null, fetchFlag: vi.fn() })).result.current.enabled).toBe(false)
    expect(renderHook(() => useEventsFeature({ userId: null, gymId: 'g', fetchFlag: vi.fn() })).result.current.enabled).toBeNull()
  })

  it('a failed read keeps OFF (fails closed)', async () => {
    const fetchFlag = vi.fn().mockRejectedValue(new Error('boom'))
    vi.spyOn(console, 'error').mockImplementation(() => {})
    const { result } = renderHook(() => useEventsFeature({ userId: 'u', gymId: 'g', fetchFlag }))
    await waitFor(() => expect(result.current.enabled).toBe(false))
  })

  it('subscribes gym-scoped to the flag + every Events table and bumps version on change', async () => {
    const fetchFlag = vi.fn().mockResolvedValue(true)
    const { result } = renderHook(() => useEventsFeature({ userId: 'u', gymId: 'g1', fetchFlag }))
    await waitFor(() => expect(result.current.enabled).toBe(true))
    expect(handlers.map((h) => h.filter.table).sort()).toEqual(['app_settings', 'event_attempts', 'event_registrations', 'events'])
    expect(handlers.every((h) => h.filter.filter === 'gym_id=eq.g1')).toBe(true)
    const v0 = result.current.version
    act(() => handlers.find((h) => h.filter.table === 'event_attempts').cb({}))
    expect(result.current.version).toBe(v0 + 1)
  })

  it('the flag switched OFF live is picked up from app_settings changes', async () => {
    const fetchFlag = vi.fn().mockResolvedValueOnce(true).mockResolvedValueOnce(false)
    const { result } = renderHook(() => useEventsFeature({ userId: 'u', gymId: 'g', fetchFlag }))
    await waitFor(() => expect(result.current.enabled).toBe(true))
    act(() => handlers.find((h) => h.filter.table === 'app_settings').cb({}))
    await waitFor(() => expect(result.current.enabled).toBe(false))
  })

  it('reconnect (online) re-reads the flag and signals a refresh', async () => {
    const fetchFlag = vi.fn().mockResolvedValue(true)
    const { result } = renderHook(() => useEventsFeature({ userId: 'u', gymId: 'g', fetchFlag }))
    await waitFor(() => expect(result.current.enabled).toBe(true))
    const v0 = result.current.version
    act(() => { window.dispatchEvent(new Event('online')) })
    await waitFor(() => expect(fetchFlag).toHaveBeenCalledTimes(2))
    expect(result.current.version).toBe(v0 + 1)
  })

  it('cleans up its channel', async () => {
    const { unmount } = renderHook(() => useEventsFeature({ userId: 'u', gymId: 'g', fetchFlag: vi.fn().mockResolvedValue(true) }))
    unmount()
    expect(removeChannel).toHaveBeenCalled()
  })
})
