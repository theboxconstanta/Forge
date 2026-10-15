// FORGE EVENTS - pure member-side model over the Phase 1 database contract
// (supabase/migrations/20261014120000_forge_events_phase1.sql). Every rule
// here MIRRORS a server rule so the UI never offers an action the server will
// refuse - the server (RLS + RPCs) stays the only authority.

export const EVENT_DIVISIONS = ['rx', 'intermediate', 'beginner', 'onramp']
export const ATTEMPT_LIMIT = 20

/** coalesce(ends_at, starts_at) - the instant the database treats as "over". */
export function eventEndMs(event) {
  return new Date(event.ends_at || event.starts_at).getTime()
}

export function eventPhase(event, now = Date.now()) {
  if (eventEndMs(event) <= now) return 'ended'
  if (new Date(event.starts_at).getTime() <= now) return 'live'
  return 'upcoming'
}

/** The one status chip a member sees. Cancelled/archived outrank time. */
export function eventDisplayStatus(event, now = Date.now()) {
  if (event.status === 'cancelled') return 'cancelled'
  if (event.status === 'archived') return 'archived'
  return eventPhase(event, now)
}

/** event_join closes at coalesce(registration_deadline, ends_at, starts_at). */
export function registrationClosesMs(event) {
  return new Date(event.registration_deadline || event.ends_at || event.starts_at).getTime()
}

/**
 * Registration state for one event, mirroring event_join / event_leave.
 * `registration` = the member's own row (or null), `registeredCount` from
 * event_registration_counts.
 */
export function registrationState(event, registration, registeredCount, now = Date.now(), myAttemptCount = 0) {
  const isRegistered = registration?.status === 'registered'
  const capacity = event.capacity ?? null
  const placesLeft = capacity == null ? null : Math.max(0, capacity - (registeredCount || 0))
  const open = event.status === 'published'
    && event.registration_enabled
    && now < registrationClosesMs(event)
  const full = capacity != null && placesLeft === 0
  // event_leave: scoring events -> until ends_at and only while the member
  // has no attempt (leave_locked_attempts_exist, soft-deleted included);
  // other events -> until starts_at.
  const leaveOpen = isRegistered && event.status === 'published'
    && (event.scoring_enabled
      ? myAttemptCount === 0 && now < new Date(event.ends_at).getTime()
      : now < new Date(event.starts_at).getTime())
  return {
    isRegistered,
    division: isRegistered ? registration.division : null,
    capacity,
    placesLeft,
    full,
    canJoin: !isRegistered && open && !full,
    reason: isRegistered ? 'registered'
      : !event.registration_enabled ? 'off'
      : event.status !== 'published' ? 'not_open'
      : !open ? 'closed'
      : full ? 'full'
      : 'open',
    canLeave: leaveOpen,
    closesAt: new Date(registrationClosesMs(event)).toISOString(),
  }
}

/** The divisions offered, in canonical order (rx, intermediate, beginner, onramp). */
export function eventDivisions(event) {
  const set = new Set(event.divisions || [])
  return EVENT_DIVISIONS.filter((d) => set.has(d))
}

/** Scoring window (event_submit_attempt / forge_events_own_open_attempt). */
export function scoringState(event, now = Date.now()) {
  if (!event.has_workout || !event.scoring_enabled || !event.ends_at) return { enabled: false, open: false, phase: 'none' }
  if (event.status !== 'published') return { enabled: true, open: false, phase: 'closed' }
  const start = new Date(event.starts_at).getTime()
  const end = new Date(event.ends_at).getTime()
  if (now < start) return { enabled: true, open: false, phase: 'before' }
  if (now > end) return { enabled: true, open: false, phase: 'after' }
  return { enabled: true, open: true, phase: 'open' }
}

/**
 * Splits the member-visible events into the four Events tabs. Drafts are
 * dropped defensively (RLS already hides them from members; staff using the
 * PWA would otherwise see their own drafts here).
 *   upcoming : published or cancelled, not started yet
 *   active   : published, started, not ended (live challenges)
 *   mine     : registered (any status), not ended
 *   past     : ended, or archived
 */
export function categorizeEvents(events, myRegistrations, now = Date.now()) {
  const registeredIds = new Set((myRegistrations || []).filter((r) => r.status === 'registered').map((r) => r.event_id))
  const visible = (events || []).filter((e) => e.status !== 'draft')
  const byStart = (a, b) => new Date(a.starts_at) - new Date(b.starts_at) || String(a.id).localeCompare(String(b.id))
  const byEndDesc = (a, b) => eventEndMs(b) - eventEndMs(a) || String(a.id).localeCompare(String(b.id))
  const upcoming = []
  const active = []
  const mine = []
  const past = []
  for (const e of visible) {
    const phase = eventPhase(e, now)
    const ended = phase === 'ended' || e.status === 'archived'
    if (ended) past.push(e)
    else if (phase === 'live' && e.status === 'published') active.push(e)
    else if (phase === 'upcoming') upcoming.push(e)
    else past.push(e) // live but cancelled
    if (!ended && registeredIds.has(e.id)) mine.push(e)
  }
  return { upcoming: upcoming.sort(byStart), active: active.sort(byStart), mine: mine.sort(byStart), past: past.sort(byEndDesc) }
}

const KNOWN_CODES = [
  'event_not_found', 'event_not_open', 'registration_closed', 'event_full', 'invalid_division',
  'division_locked', 'leave_locked_attempts_exist', 'event_started', 'event_ended', 'scoring_disabled',
  'outside_scoring_window', 'not_registered', 'attempt_limit_reached', 'attempt_not_found',
  'attempt_deleted', 'empty_score', 'invalid_fields', 'invalid_revision', 'invalid_action',
  'not_authenticated', 'score_type_missing', 'invalid_score_for_format',
]

/**
 * Server error -> one known code. `network` marks an UNKNOWN outcome (the
 * request may or may not have reached the database) - callers must treat it
 * as retryable with the SAME idempotency key, never as a failure.
 */
export function eventErrorCode(err) {
  const message = String(err?.message || err || '')
  for (const code of KNOWN_CODES) if (message.includes(code)) return code
  if (err?.name === 'TypeError' || /Failed to fetch|NetworkError|Load failed|network|timeout|ECONN/i.test(message)) return 'network'
  return 'generic'
}

export function eventErrorMessage(err, s) {
  return s.err[eventErrorCode(err)] || s.err.generic
}
