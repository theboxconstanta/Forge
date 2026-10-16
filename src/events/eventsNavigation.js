// FORGE EVENTS - the only rules App.jsx needs, kept pure + tested here.

export const EVENTS_SCREEN = 'events'

/**
 * Paywall exemption (owner rule: gym affiliation alone grants Events). The
 * subscription paywall stays exactly as it is on EVERY other screen; it is
 * lifted only while the member is ON the Events screen AND Events is
 * enabled for their gym. Classes, bookings, logging, PRs, leaderboard and
 * payments keep their existing restriction untouched.
 */
export function isEventsPaywallExempt(screen, eventsEnabled) {
  return screen === EVENTS_SCREEN && eventsEnabled === true
}

/** Inserts the Events tab immediately after Feed - only when enabled. */
export function withEventsTab(tabs, eventsEnabled, eventsTab) {
  if (!eventsEnabled) return tabs
  const out = []
  let inserted = false
  for (const tab of tabs) {
    out.push(tab)
    if (tab.id === 'feed') { out.push(eventsTab); inserted = true }
  }
  if (!inserted) out.push(eventsTab)
  return out
}

// --- Direct navigation + refresh survival ----------------------------------
// The PWA has no router (a single `screen` state that resets to 'home' on
// reload). Events adds the narrowest possible persistence: a link with
// ?event=<uuid> (or ?events) opens Events, and the open Events screen is
// remembered in sessionStorage so a refresh / reconnect returns to it.
const ROUTE_KEY = 'forge.events.route'
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/** { eventId: string|null } when the app should open on Events, else null. */
export function readEventsRoute(search = typeof window !== 'undefined' ? window.location.search : '') {
  const params = new URLSearchParams(search || '')
  const id = params.get('event')
  if (id && UUID.test(id)) return { eventId: id, fromUrl: true }
  if (params.has('events')) return { eventId: null, fromUrl: true }
  try {
    const raw = sessionStorage.getItem(ROUTE_KEY)
    if (raw) {
      const parsed = JSON.parse(raw)
      if (parsed && (parsed.eventId == null || UUID.test(parsed.eventId))) return { eventId: parsed.eventId ?? null, fromUrl: false }
    }
  } catch { /* storage unavailable */ }
  return null
}

export function persistEventsRoute(eventId) {
  try { sessionStorage.setItem(ROUTE_KEY, JSON.stringify({ eventId: eventId ?? null })) } catch { /* ignore */ }
}

export function clearEventsRoute() {
  try { sessionStorage.removeItem(ROUTE_KEY) } catch { /* ignore */ }
}

/** Removes ?event / ?events from the address bar after it has been consumed (same pattern as ?checkout). */
export function stripEventsParamsFromUrl() {
  if (typeof window === 'undefined') return
  const params = new URLSearchParams(window.location.search)
  if (!params.has('event') && !params.has('events')) return
  params.delete('event')
  params.delete('events')
  const rest = params.toString()
  window.history.replaceState({}, '', window.location.pathname + (rest ? `?${rest}` : ''))
}
