// Booking credit accounting - client side of migration 20261017090000_forge_booking_credit_integrity.
//
// Dual mode, so this client can ship BEFORE the database migration (expand/contract):
//   'server' - the database owns every credit: it charges on booking insert, refunds on cancellation
//              (before the gym's deadline, to the exact charged subscription), promotes the waitlist
//              and ledgers manual adjustments. The client must NOT do any arithmetic of its own.
//   'legacy' - pre-migration database: the client keeps the historical behavior.
// The mode is read from forge_booking_accounting_mode(), which only exists once the migration is
// applied (rollback drops it, so clients fall back to 'legacy' automatically).
//
// Fallback is ALWAYS 'legacy': every legacy action is safe against the migrated database (direct
// counter writes are refused with FRG05 - a visible error, never a silent change), whereas 'server'
// against an un-migrated database would skip charges. A FRG05 response forces a re-check.

// Re-checked at every credit-affecting action (the TTL only de-duplicates calls inside one action). A long-lived
// cache is unsafe across a database ROLLBACK: a client still believing 'server' would skip the charge/refund that
// the restored legacy trigger no longer does (found by the isolated transition test, 2026-10-16).
const MODE_TTL_MS = 2000
let cachedMode = null
let cachedAt = 0
let inFlight = null

export async function getBookingAccountingMode(supabase, { force = false } = {}) {
  if (!force && cachedMode && Date.now() - cachedAt < MODE_TTL_MS) return cachedMode
  if (inFlight) return inFlight
  inFlight = (async () => {
    try {
      const { data, error } = await supabase.rpc('forge_booking_accounting_mode')
      let mode
      if (!error) mode = data === 'server' ? 'server' : 'legacy'
      else if (error.code === 'PGRST202' || error.code === '42883') mode = 'legacy'   // function absent: pre-migration
      else mode = 'legacy'   // transient: the safe side, never a stale 'server'
      cachedMode = mode
      cachedAt = Date.now()
      return mode
    } catch {
      return 'legacy'
    } finally {
      inFlight = null
    }
  })()
  return inFlight
}

export const isServerAccounting = async (supabase) => (await getBookingAccountingMode(supabase)) === 'server'

// Stable server error codes (see the migration) -> UI meaning.
const KIND_BY_CODE = {
  FRG01: 'noCoverage',       // no subscription covers the class date
  FRG02: 'exhausted',        // limited plan with no credit left (coach/member; only an admin may override)
  FRG03: 'deadline',         // member cancellation after the gym's cancellation deadline
  FRG04: 'attended',         // checked-in or already-ended booking cannot be removed
  FRG05: 'serverManaged',    // credit balance / provenance written directly - must use the RPCs
  FRG06: 'useCancelClass',   // class with bookings deleted directly - must use cancel_class
  FRG07: 'notAuthorized',
  FRG09: 'emailLocked',
  23505: 'alreadyBooked',
  42501: 'notAuthorized',
}

export function bookingErrorKind(error) {
  if (!error) return null
  return KIND_BY_CODE[error.code] || (/exhausted their sessions/.test(error.message || '') ? 'exhausted' : 'unknown')
}

// FRG05 means the database is already server-managed while this client still believed 'legacy'.
export function noteBookingError(error) {
  if (error?.code === 'FRG05') { cachedMode = null; cachedAt = 0 }
}

export function bookingErrorToast(t, error, fallback) {
  switch (bookingErrorKind(error)) {
    case 'exhausted': return t.toastSessionsExhausted
    case 'deadline': return t.toastCancelDeadlinePassed
    case 'attended': return t.toastBookingAttendedLocked
    case 'notAuthorized': return t.toastNotAuthorizedAction
    case 'alreadyBooked': return t.toastAlreadyBooked
    case 'useCancelClass':
    case 'serverManaged': return t.toastAppOutdatedRetry
    default: return fallback
  }
}

// Reason recorded in credit_ledger for a manual +/- from the admin Clients screens.
export const MANUAL_ADJUST_REASON = 'manual adjustment (admin, PWA)'

// Whole-class / series cancellation. Server mode: one all-or-nothing call. Legacy mode: the
// pre-migration cancel_class (admins refund to the latest active limited plan - the same rule the
// old client loop applied), one class at a time; partial progress is reported, never hidden.
export async function cancelClassesForStaff(supabase, classIds) {
  const ids = [...new Set(classIds || [])]
  if (ids.length === 0) return { cancelled: 0, refunded: 0, error: null }
  if (await isServerAccounting(supabase)) {
    const { data, error } = ids.length === 1
      ? await supabase.rpc('cancel_class', { p_class_id: ids[0] })
      : await supabase.rpc('cancel_classes', { p_class_ids: ids })
    return error ? { cancelled: 0, refunded: 0, error } : { cancelled: ids.length, refunded: data || 0, error: null }
  }
  let cancelled = 0, refunded = 0
  for (const id of ids) {
    const { data, error } = await supabase.rpc('cancel_class', { p_class_id: id })
    if (error) return { cancelled, refunded, error }
    cancelled++; refunded += data || 0
  }
  return { cancelled, refunded, error: null }
}

export function __resetBookingAccountingModeForTests() { cachedMode = null; cachedAt = 0; inFlight = null }
