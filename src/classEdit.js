// FORGE - Class Editing (Admin -> Classes). Pure helpers + the one RPC
// wrapper the Edit sheet uses. No React here - unit-tested in
// classEdit.test.js. The database is the authority for every rule below
// (edit_class_scope, migration 20261008090000): these client checks only
// give the admin an immediate message before a round-trip.
//
// Recurrence model (see that migration's header): a series is the set of
// rows sharing `classes.series_id`; there is no rule/generator. NULL
// series_id = one-off class. `series_exception` = an occurrence edited on
// its own, which series-wide edits never overwrite.

export const CLASS_EDIT_FIELDS = ['name', 'start_time', 'end_time', 'coach', 'max_spots', 'color']
export const CLASS_EDIT_SCOPES = ['this', 'future', 'series']

/** Class color swatches - shared by the New class form and the Edit sheet (null = no color). */
export const CLASS_COLOR_PALETTE = [null, '#0E0E0E', '#2E2E2E', '#5C6B1E', '#8C9B4A', '#ABE73C', '#afe607', '#C9D9A8', '#E8871E', '#F2C94C', '#E24B4A', '#3B82C4']

/** 'HH:MM:SS' | 'HH:MM' -> 'HH:MM' (what <input type="time"> shows/returns). */
export function toHHMM(time) {
  return typeof time === 'string' ? time.slice(0, 5) : ''
}

/** Form state for the Edit sheet, prefilled from the class row already on the card (no fetch). */
export function classEditInitialValues(cls) {
  return {
    name: cls.name ?? '',
    start_time: toHHMM(cls.start_time),
    end_time: toHHMM(cls.end_time),
    coach: cls.coach ?? '',
    max_spots: cls.max_spots ?? null,
    color: cls.color ?? null,
  }
}

/** The anchor row exactly as loaded - sent as `p_expected` so the server rejects the save if another session changed this class in between. */
export function classExpectedSnapshot(cls) {
  return {
    name: cls.name,
    start_time: cls.start_time,
    end_time: cls.end_time,
    coach: cls.coach ?? null,
    max_spots: cls.max_spots ?? null,
    color: cls.color ?? null,
  }
}

function normalizeValues(values) {
  return {
    name: (values.name ?? '').trim(),
    start_time: toHHMM(values.start_time),
    end_time: toHHMM(values.end_time),
    coach: (values.coach ?? '').trim(),
    max_spots: values.max_spots == null || values.max_spots === '' ? null : Number(values.max_spots),
    color: values.color || null,
  }
}

/** Only the fields the admin actually changed - the server writes nothing else, to any row. `{}` = no changes. */
export function buildClassChanges(cls, values) {
  const before = normalizeValues(classEditInitialValues(cls))
  const after = normalizeValues(values)
  const changes = {}
  for (const f of CLASS_EDIT_FIELDS) {
    if (after[f] !== before[f]) changes[f] = after[f]
  }
  return changes
}

/**
 * Client-side validation of the form. Returns a translation key (string)
 * or null. `bookedCount` is the occurrence's own booking count when the
 * card already loaded it (participants panel), else undefined - the server
 * validates every affected occurrence regardless.
 */
export function validateClassEdit(values, { bookedCount } = {}) {
  const v = normalizeValues(values)
  if (!v.name) return 'adminClassEditErrorName'
  if (!v.coach) return 'adminClassEditErrorCoach'
  if (!v.start_time || !v.end_time || v.end_time <= v.start_time) return 'adminClassEditErrorTime'
  if (v.max_spots != null && (!Number.isInteger(v.max_spots) || v.max_spots < 1)) return 'adminClassEditErrorCapacity'
  if (v.max_spots != null && typeof bookedCount === 'number' && v.max_spots < bookedCount) return 'adminClassEditErrorCapacityBooked'
  return null
}

/** Local wall-clock end of the class has passed (same date+time convention as isInAttendanceGraceWindow in utils.js; the server re-checks in Europe/Bucharest). */
export function classHasEnded(cls, now = new Date()) {
  if (!cls?.date || !cls?.end_time) return false
  return new Date(`${cls.date}T${toHHMM(cls.end_time)}`).getTime() <= now.getTime()
}

/**
 * Which scopes the sheet offers. A one-off class (no series_id) and any
 * occurrence that has already ended only ever get 'this' - history is
 * never edited in bulk.
 */
export function availableEditScopes(cls, now = new Date()) {
  if (!cls?.series_id || classHasEnded(cls, now)) return ['this']
  return CLASS_EDIT_SCOPES
}

/** Why only 'this' is offered, for the sheet's explanatory note (null when every scope is available). */
export function singleScopeReason(cls, now = new Date()) {
  if (!cls?.series_id) return 'oneOff'
  if (classHasEnded(cls, now)) return 'ended'
  return null
}

/** Fresh series identity for a recurring create (saveClasa). crypto.randomUUID needs a secure context; the fallback builds an RFC 4122 v4 uuid from getRandomValues. */
export function newSeriesId(cryptoImpl = globalThis.crypto) {
  if (cryptoImpl?.randomUUID) return cryptoImpl.randomUUID()
  const b = new Uint8Array(16)
  cryptoImpl.getRandomValues(b)
  b[6] = (b[6] & 0x0f) | 0x40
  b[8] = (b[8] & 0x3f) | 0x80
  const h = [...b].map(x => x.toString(16).padStart(2, '0')).join('')
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`
}

/**
 * "Delete series" (stergeSeria) keeps its name/start/end/coach match, but
 * only inside the class's own series: same series_id, or - for a class
 * without one - other series-less rows only. Never broader than the old
 * field-only match, so an unrelated schedule that shares (or was edited
 * to share) the same name/time/coach can't be deleted with it.
 * forge-admin-web's fetchSeriesScopeInfo applies the same rule.
 */
export function scopeToOwnSeries(query, cls) {
  return cls?.series_id ? query.eq('series_id', cls.series_id) : query.is('series_id', null)
}

export class ClassEditError extends Error {
  constructor(code, detail, raw) {
    super(code)
    this.code = code
    this.detail = detail
    this.raw = raw
  }
}

const KNOWN_CODES = new Set([
  'invalid_scope', 'invalid_changes', 'no_changes', 'invalid_name', 'invalid_coach', 'invalid_time_range',
  'invalid_capacity', 'invalid_color', 'class_not_found', 'not_authorized', 'missing_expected',
  'class_changed_concurrently', 'not_a_series', 'series_scope_on_ended_class', 'capacity_below_bookings',
  'duplicate_class',
])

function parseDetail(details) {
  if (!details) return null
  try { return JSON.parse(details) } catch { return null }
}

/**
 * Calls edit_class_scope. Resolves with the server summary
 * ({ affected, first_date, last_date, booked_total, booked_max,
 * skipped_exceptions, preserved_past, ids }) or throws ClassEditError -
 * never resolves on a failed write, so the caller can never show a false
 * success.
 */
export async function editClassScope(supabaseClient, { cls, scope, changes, dryRun = false }) {
  const { data, error } = await supabaseClient.rpc('edit_class_scope', {
    p_class_id: cls.id,
    p_scope: scope,
    p_expected: classExpectedSnapshot(cls),
    p_changes: changes,
    p_dry_run: dryRun,
  })
  if (error) {
    const code = KNOWN_CODES.has(error.message) ? error.message : 'unknown'
    throw new ClassEditError(code, parseDetail(error.details), error)
  }
  if (!data || typeof data.affected !== 'number') throw new ClassEditError('unknown', null, data)
  return data
}

/** Human message for a ClassEditError (or any thrown value). */
export function classEditErrorMessage(err, t) {
  const code = err?.code
  const detail = err?.detail
  switch (code) {
    case 'capacity_below_bookings': {
      const rows = Array.isArray(detail) ? detail : []
      const worst = rows.reduce((m, r) => Math.max(m, r.booked || 0), 0)
      return t.adminClassEditErrCapacityBelowBookings(rows.length, worst, rows.map(r => r.date))
    }
    case 'duplicate_class':
      return t.adminClassEditErrDuplicate(Array.isArray(detail) ? detail : [])
    case 'invalid_time_range': return t.adminClassEditErrorTime
    case 'invalid_capacity': return t.adminClassEditErrorCapacity
    case 'invalid_name': return t.adminClassEditErrorName
    case 'invalid_coach': return t.adminClassEditErrorCoach
    case 'no_changes': return t.adminClassEditNoChanges
    case 'class_changed_concurrently': return t.adminClassEditErrConcurrent
    case 'class_not_found': return t.adminClassEditErrNotFound
    case 'not_authorized': return t.adminClassEditErrNotAuthorized
    case 'series_scope_on_ended_class': return t.adminClassEditErrEnded
    case 'not_a_series': return t.adminClassEditErrNotSeries
    default:
      return t.toastGenericErrorWithFallback(err?.raw?.message || err?.message || t.errorWordExclaim)
  }
}
