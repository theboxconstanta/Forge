// FORGE EVENTS - client_attempt_id lifecycle (Phase 1 safeguard 4).
//
//   - A genuinely NEW attempt gets a fresh UUID when its draft is created.
//   - Every send of that draft (first try, retry after a timeout / offline /
//     unknown outcome, retry after an app refresh) reuses THE SAME id, so
//     event_submit_attempt returns the already-stored attempt instead of
//     consuming another of the 20.
//   - The id is discarded only once the server CONFIRMS (or the member
//     explicitly discards the unconfirmed draft).
//
// The pending draft is kept in localStorage per member+event so an unknown
// outcome survives a reload. Storage failures (private mode, quota) degrade to
// in-memory only - correctness never depends on storage (the server dedupes).

const memory = new Map()
const keyFor = (memberId, eventId) => `forge.events.pendingAttempt.${memberId}.${eventId}`

export function newClientAttemptId() {
  if (typeof crypto !== 'undefined' && crypto.randomUUID) return crypto.randomUUID()
  // RFC 4122 v4 fallback (very old WebViews only).
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0
    return (c === 'x' ? r : (r & 0x3) | 0x8).toString(16)
  })
}

/** { clientAttemptId, fields, savedAt } | null */
export function readPendingAttempt(memberId, eventId) {
  const k = keyFor(memberId, eventId)
  try {
    const raw = localStorage.getItem(k)
    if (raw) return JSON.parse(raw)
  } catch { /* fall through to memory */ }
  return memory.get(k) || null
}

export function savePendingAttempt(memberId, eventId, pending) {
  const k = keyFor(memberId, eventId)
  memory.set(k, pending)
  try { localStorage.setItem(k, JSON.stringify(pending)) } catch { /* memory only */ }
}

export function clearPendingAttempt(memberId, eventId) {
  const k = keyFor(memberId, eventId)
  memory.delete(k)
  try { localStorage.removeItem(k) } catch { /* ignore */ }
}

/**
 * Sends one attempt with idempotent retry semantics.
 *   - Persists { clientAttemptId, fields } BEFORE the request.
 *   - Confirmed (server returned the row) -> cleared, returns { status: 'saved', attempt }.
 *   - Known server refusal (attempt_limit_reached, outside_scoring_window, ...)
 *     -> cleared (the draft can never succeed as-is), rethrown.
 *   - Unknown outcome (network) -> KEPT so the next try reuses the same id,
 *     returns { status: 'unknown', error }.
 */
export async function sendAttemptIdempotently({ memberId, eventId, clientAttemptId, fields, submit, classify }) {
  savePendingAttempt(memberId, eventId, { clientAttemptId, fields, savedAt: new Date().toISOString() })
  try {
    const attempt = await submit(eventId, clientAttemptId, fields)
    clearPendingAttempt(memberId, eventId)
    return { status: 'saved', attempt }
  } catch (error) {
    if (classify(error) === 'network') return { status: 'unknown', error }
    clearPendingAttempt(memberId, eventId)
    throw error
  }
}
