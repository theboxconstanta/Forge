import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { coalescedRefresh } from '../coalescedRefresh'
import * as defaultApi from './eventsApi'
import { eventErrorCode } from './eventModel'

const POLL_MS = 120000
export const announcementKey = (a) => `${a.id}:${a.announcement_revision}`

/**
 * Pure: the queue to show = the server's pending list (already ordered by
 * published_at, id - my_pending_event_announcements) minus anything this
 * session has SUCCESSFULLY acknowledged. Duplicates (same event+revision from
 * overlapping responses) collapse to one entry, first occurrence wins.
 */
export function buildAnnouncementQueue(pending, handledKeys) {
  const seen = new Set()
  const out = []
  for (const a of pending || []) {
    const k = announcementKey(a)
    if (seen.has(k) || handledKeys.has(k)) continue
    seen.add(k)
    out.push(a)
  }
  return out
}

/**
 * FORGE EVENTS - in-app announcements (no push).
 *
 * Source of truth = the server (event_announcement_acks). The client only
 * keeps a session set of keys it has seen CONFIRMED, so a refresh racing an
 * acknowledgment can't flash the same modal again. Nothing is ever marked
 * handled before the server confirms; a failed acknowledgment keeps the
 * announcement (retryable) and exposes an error code.
 *
 * Fetch triggers: enable / login, every Events change (`version`: Realtime,
 * reconnect, app resume) and a 2-minute fallback poll - all through ONE
 * coalescedRefresh, so overlapping triggers never overlap requests or reorder
 * responses.
 */
export function useEventAnnouncements({ enabled, userId, version, api = defaultApi }) {
  const [pending, setPending] = useState({ userId: null, list: [] })
  const [handled, setHandled] = useState(() => new Set())
  const [working, setWorking] = useState(false)
  const [errorState, setErrorState] = useState({ key: null, code: null })
  // Registration succeeded but its acknowledgment didn't: retry only the ack.
  const [joinedAwaitingAck, setJoinedAwaitingAck] = useState(null)
  const busy = useRef(false)
  const apiRef = useRef(api)
  useEffect(() => { apiRef.current = api })
  const refreshRef = useRef(null)

  useEffect(() => {
    if (enabled !== true || !userId) return
    let alive = true
    const refresh = coalescedRefresh(async () => {
      const list = await apiRef.current.fetchPendingAnnouncements()
      if (alive) setPending({ userId, list })
    })
    refreshRef.current = refresh
    const poll = setInterval(refresh, POLL_MS)
    return () => {
      alive = false
      if (refreshRef.current === refresh) refreshRef.current = null
      clearInterval(poll)
    }
  }, [enabled, userId])

  // Initial fetch + every live-change signal (declared after the runner's effect, so it exists).
  useEffect(() => {
    if (enabled !== true || !userId) return
    refreshRef.current?.()
  }, [enabled, userId, version])

  const queue = useMemo(
    () => (enabled === true && pending.userId === userId ? buildAnnouncementQueue(pending.list, handled) : []),
    [enabled, userId, pending, handled],
  )
  const current = queue[0] || null
  const currentKey = current ? announcementKey(current) : null
  const error = errorState.key === currentKey ? errorState.code : null

  const run = useCallback(async (fn) => {
    if (busy.current || !current || enabled !== true) return
    const key = announcementKey(current)
    busy.current = true
    setWorking(true)
    setErrorState({ key: null, code: null })
    try {
      await fn(current, key)
    } catch (err) {
      setErrorState({ key, code: eventErrorCode(err) })
    } finally {
      busy.current = false
      setWorking(false)
    }
  }, [current, enabled])

  const ack = async (a, key, action) => {
    await apiRef.current.ackAnnouncement(a.id, a.announcement_revision, action)
    setHandled((prev) => new Set(prev).add(key))
    refreshRef.current?.()
  }

  /** MAYBE LATER: acknowledge this revision as dismissed. */
  const later = () => run((a, key) => ack(a, key, 'dismissed'))

  /**
   * JOIN EVENT: register through event_join FIRST; only a confirmed
   * registration is acknowledged as 'joined'. A refused join (full, closed,
   * not open) leaves the announcement pending - MAYBE LATER stays available.
   * Already registered -> acknowledge 'joined' only.
   */
  const join = (division) => run(async (a, key) => {
    if (!a.is_registered && joinedAwaitingAck !== key) {
      await apiRef.current.joinEvent(a.id, division ?? null)
      setJoinedAwaitingAck(key)
    }
    await ack(a, key, 'joined')
    setJoinedAwaitingAck(null)
  })

  /** Event without registration: acknowledge, then the caller opens it. */
  const view = (onOpen) => run(async (a, key) => {
    await ack(a, key, 'dismissed')
    onOpen?.(a.id)
  })

  return {
    current,
    total: queue.length,
    working,
    error,
    joinedAwaitingAck: currentKey != null && joinedAwaitingAck === currentKey,
    later,
    join,
    view,
    refresh: () => refreshRef.current?.(),
  }
}
