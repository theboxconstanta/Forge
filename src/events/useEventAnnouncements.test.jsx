import { describe, it, expect, vi } from 'vitest'
import { renderHook, act, waitFor } from '@testing-library/react'
import { useEventAnnouncements, buildAnnouncementQueue, announcementKey } from './useEventAnnouncements'

const ann = (id, rev = 1, p = {}) => ({ id, announcement_revision: rev, title: id, registration_enabled: true, is_registered: false, published_at: `2026-10-1${rev}T10:00:00Z`, ...p })

function fakeApi(pendingSeq) {
  let calls = 0
  return {
    fetchPendingAnnouncements: vi.fn(async () => {
      const list = Array.isArray(pendingSeq[0]) ? pendingSeq[Math.min(calls, pendingSeq.length - 1)] : pendingSeq
      calls += 1
      return list
    }),
    ackAnnouncement: vi.fn(async () => ({})),
    joinEvent: vi.fn(async () => ({ status: 'registered' })),
  }
}

const setup = (api, props = {}) => renderHook((p) => useEventAnnouncements({ enabled: true, userId: 'u1', version: 0, api, ...p }), { initialProps: props })

describe('buildAnnouncementQueue', () => {
  it('keeps server order, drops confirmed keys and duplicate event+revision', () => {
    const list = [ann('a'), ann('b'), ann('a'), ann('c', 2)]
    const q = buildAnnouncementQueue(list, new Set(['b:1']))
    expect(q.map(announcementKey)).toEqual(['a:1', 'c:2'])
  })
})

describe('useEventAnnouncements', () => {
  it('shows one announcement at a time, in the server order, with the queue size', async () => {
    const api = fakeApi([ann('a'), ann('b')])
    const { result } = setup(api)
    await waitFor(() => expect(result.current.current?.id).toBe('a'))
    expect(result.current.total).toBe(2)
  })

  it('disabled flag: no request, nothing shown', async () => {
    const api = fakeApi([ann('a')])
    const { result } = setup(api, { enabled: false })
    await new Promise((r) => setTimeout(r, 20))
    expect(api.fetchPendingAnnouncements).not.toHaveBeenCalled()
    expect(result.current.current).toBeNull()
  })

  it('MAYBE LATER acknowledges the exact revision as dismissed, then advances', async () => {
    const api = fakeApi([[ann('a', 3), ann('b')], [ann('b')]])
    const { result } = setup(api)
    await waitFor(() => expect(result.current.current?.id).toBe('a'))
    await act(() => result.current.later())
    expect(api.ackAnnouncement).toHaveBeenCalledWith('a', 3, 'dismissed')
    await waitFor(() => expect(result.current.current?.id).toBe('b'))
  })

  it('a failed acknowledgment keeps the announcement (retryable) with an error', async () => {
    const api = fakeApi([ann('a')])
    api.ackAnnouncement.mockRejectedValueOnce(new TypeError('Failed to fetch'))
    const { result } = setup(api)
    await waitFor(() => expect(result.current.current?.id).toBe('a'))
    await act(() => result.current.later())
    expect(result.current.current?.id).toBe('a')
    expect(result.current.error).toBe('network')
    await act(() => result.current.later())
    expect(api.ackAnnouncement).toHaveBeenCalledTimes(2)
    await waitFor(() => expect(result.current.current).toBeNull())
  })

  it('JOIN EVENT registers FIRST, then acknowledges as joined', async () => {
    const api = fakeApi([[ann('a')], []])
    const { result } = setup(api)
    await waitFor(() => expect(result.current.current?.id).toBe('a'))
    await act(() => result.current.join('beginner'))
    expect(api.joinEvent).toHaveBeenCalledWith('a', 'beginner')
    expect(api.ackAnnouncement).toHaveBeenCalledWith('a', 1, 'joined')
    expect(api.joinEvent.mock.invocationCallOrder[0]).toBeLessThan(api.ackAnnouncement.mock.invocationCallOrder[0])
  })

  it('a refused join (full) is NOT acknowledged - the member can still choose later', async () => {
    const api = fakeApi([ann('a')])
    api.joinEvent.mockRejectedValueOnce(new Error('event_full'))
    const { result } = setup(api)
    await waitFor(() => expect(result.current.current?.id).toBe('a'))
    await act(() => result.current.join(null))
    expect(api.ackAnnouncement).not.toHaveBeenCalled()
    expect(result.current.error).toBe('event_full')
    expect(result.current.current?.id).toBe('a')
  })

  it('joined but the ack failed: the retry only acknowledges (never registers twice)', async () => {
    const api = fakeApi([ann('a')])
    api.ackAnnouncement.mockRejectedValueOnce(new TypeError('Failed to fetch'))
    const { result } = setup(api)
    await waitFor(() => expect(result.current.current?.id).toBe('a'))
    await act(() => result.current.join('rx'))
    expect(result.current.joinedAwaitingAck).toBe(true)
    await act(() => result.current.join('rx'))
    expect(api.joinEvent).toHaveBeenCalledTimes(1)
    expect(api.ackAnnouncement).toHaveBeenCalledTimes(2)
  })

  it('already registered: JOIN only acknowledges', async () => {
    const api = fakeApi([ann('a', 1, { is_registered: true })])
    const { result } = setup(api)
    await waitFor(() => expect(result.current.current?.id).toBe('a'))
    await act(() => result.current.join('rx'))
    expect(api.joinEvent).not.toHaveBeenCalled()
    expect(api.ackAnnouncement).toHaveBeenCalledWith('a', 1, 'joined')
  })

  it('double tap cannot send two acknowledgments', async () => {
    const api = fakeApi([ann('a')])
    let release
    api.ackAnnouncement.mockImplementationOnce(() => new Promise((r) => { release = r }))
    const { result } = setup(api)
    await waitFor(() => expect(result.current.current?.id).toBe('a'))
    let p1
    act(() => { p1 = result.current.later() })
    await act(() => result.current.later())
    release({})
    await act(() => p1)
    expect(api.ackAnnouncement).toHaveBeenCalledTimes(1)
  })

  it('a republished event (higher revision) is announced again', async () => {
    const api = fakeApi([[ann('a', 1)], [], [ann('a', 2)]])
    const { result, rerender } = setup(api)
    await waitFor(() => expect(result.current.current?.announcement_revision).toBe(1))
    await act(() => result.current.later())
    await waitFor(() => expect(result.current.current).toBeNull())
    rerender({ version: 1 }) // a Realtime events change
    await waitFor(() => expect(result.current.current?.announcement_revision).toBe(2))
  })

  it('every live-change signal (Realtime / reconnect / resume -> version) refetches', async () => {
    const api = fakeApi([[], [ann('late')]])
    const { result, rerender } = setup(api)
    await waitFor(() => expect(api.fetchPendingAnnouncements).toHaveBeenCalledTimes(1))
    rerender({ version: 7 })
    await waitFor(() => expect(result.current.current?.id).toBe('late'))
  })
})
