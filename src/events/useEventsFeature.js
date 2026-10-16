import { useEffect, useRef, useState } from 'react'
import { supabase } from '../supabase'
import { coalescedRefresh } from '../coalescedRefresh'
import { fetchEventsEnabled } from './eventsApi'

const FLAG_POLL_MS = 120000

/**
 * FORGE EVENTS - feature flag + live-change signal for one gym.
 *
 * `enabled`: null = not known yet (no user, or the profile/gym hasn't loaded),
 * false = confirmed OFF (or the member has no gym), true = confirmed ON.
 * Every consumer treats anything but `true` as OFF (hidden tab, blocked
 * screen, no modal, no requests) - a slow or failed read can never expose
 * Events, and a transient read failure never flips a confirmed answer ON.
 *
 * `version` increments on any Events change this member may see (Realtime
 * postgres_changes on events / event_registrations / event_attempts / the
 * gym's app_settings, scoped by gym_id; RLS still filters each row) and on
 * reconnect / app resume. Screens use it only as an invalidation signal and
 * re-read through the normal RLS-protected queries - the payload is never
 * trusted (same discipline as the rest of the app). Fallback: the flag is
 * re-read every 2 minutes.
 */
export function useEventsFeature({ userId, gymId, fetchFlag = fetchEventsEnabled }) {
  const [flag, setFlag] = useState({ gymId: null, value: null })
  const [version, setVersion] = useState(0)
  const fetchFlagRef = useRef(fetchFlag)
  useEffect(() => { fetchFlagRef.current = fetchFlag })
  const refreshRef = useRef(null)

  useEffect(() => {
    if (!userId || !gymId) return
    let alive = true
    const refresh = coalescedRefresh(async () => {
      try {
        const on = await fetchFlagRef.current(gymId)
        if (alive) setFlag({ gymId, value: on === true })
      } catch (err) {
        console.error('[events] flag read failed', err)
        if (alive) setFlag((prev) => ({ gymId, value: prev.gymId === gymId && prev.value === true }))
      }
    })
    refreshRef.current = refresh
    const bump = () => setVersion((v) => v + 1)
    refresh()

    const filter = `gym_id=eq.${gymId}`
    const channel = supabase.channel(`events-member-${gymId}-${userId}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'app_settings', filter }, () => { refresh(); bump() })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'events', filter }, bump)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'event_registrations', filter }, bump)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'event_attempts', filter }, bump)
      .subscribe()
    const onResume = () => {
      if (document.visibilityState === 'hidden') return
      refresh()
      bump()
    }
    window.addEventListener('online', onResume)
    document.addEventListener('visibilitychange', onResume)
    const poll = setInterval(refresh, FLAG_POLL_MS)
    return () => {
      alive = false
      if (refreshRef.current === refresh) refreshRef.current = null
      supabase.removeChannel(channel)
      window.removeEventListener('online', onResume)
      document.removeEventListener('visibilitychange', onResume)
      clearInterval(poll)
    }
  }, [userId, gymId])

  const enabled = !userId || gymId === undefined ? null
    : !gymId ? false
    : flag.gymId === gymId ? flag.value
    : null
  return { enabled, version, refreshFlag: () => refreshRef.current?.() }
}
