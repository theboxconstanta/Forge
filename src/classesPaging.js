// FORGE - ADMIN CLASSES current-week-first + pagination. Pure, framework-
// independent helpers: Monday-based week math (mirrors the identical offset
// idiom already used by the class-repeat scheduler's genereazaDateRepetare,
// App.jsx), deterministic pagination past PostgREST's max_rows cap (1000,
// supabase/config.toml) instead of silently truncating at it, and the day/
// week grouping used to render the primary (current+future) list and the
// lazy SĂPTĂMÂNILE TRECUTE accordion. App.jsx wires Supabase calls around
// these. Pure + unit-tested (classesPaging.test.js).

/** Monday of the ISO week containing `d` (local calendar day, no UTC
 * conversion) - identical offset idiom already used by
 * genereazaDateRepetare. Sunday counts as the LAST day of its week
 * (offset -6), never the first of a new one. */
export function mondayOfWeek(d) {
  const dow = d.getDay()
  const daysToMon = dow === 0 ? -6 : 1 - dow
  const luni = new Date(d)
  luni.setDate(luni.getDate() + daysToMon)
  return luni
}

function dateToStr(d) {
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const z = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${z}`
}

/** 'YYYY-MM-DD' of the Monday starting the week containing `ref` (defaults
 * to now - overridable for deterministic tests). This is the boundary the
 * primary Admin -> Classes query uses (date >= this), NOT today's date, so
 * Monday..Thursday of the current week stay visible even once today is
 * Friday. */
export function currentWeekStartStr(ref = new Date()) {
  return dateToStr(mondayOfWeek(ref))
}

const CLASS_PAGE_SIZE = 1000

/** Retrieves every row a filtered `classes` query matches, paging past
 * PostgREST's `max_rows` (1000) instead of silently truncating at it - the
 * root cause of the pre-existing "CLASSES (1000)" undercount (1039 real
 * rows, only 1000 ever reached the client). `applyFilter` receives a fresh
 * query builder per page (Supabase builders aren't reusable across
 * .range() calls) and must return it after adding its .gte/.lt clause.
 * Ordering is fixed here (date, start_time, id) so pages are deterministic
 * even if two classes ever share both date and start_time - `id` is the
 * tie-breaker, never changing visible ordering semantics.
 *
 * Returns `null` (not a partial array) if any page errors, so a failed
 * fetch never silently overwrites already-loaded good state with an
 * incomplete one - callers should only commit state when this is non-null,
 * mirroring the pre-existing fetchClase()'s `if (data) setClase(data)`
 * fail-safe. */
export async function fetchAllClasses(supabaseClient, applyFilter, pageSize = CLASS_PAGE_SIZE) {
  const all = []
  let from = 0
  for (;;) {
    let query = supabaseClient.from('classes').select('*')
      .order('date', { ascending: true })
      .order('start_time', { ascending: true })
      .order('id', { ascending: true })
    query = applyFilter(query)
    const { data, error } = await query.range(from, from + pageSize - 1)
    if (error) { console.error('fetchAllClasses:', error.message || error); return null }
    const page = data || []
    all.push(...page)
    if (page.length < pageSize) break
    from += pageSize
  }
  return all
}

/** Groups an already date/time-sorted classes array into one bucket per
 * calendar day, preserving chronological order (plain-object string keys
 * aren't array-index-like, so insertion order = iteration order). Pure
 * extraction of the grouping App.jsx already did inline - unchanged
 * behavior for the current+future list. */
export function groupClassesByDay(classes) {
  const grouped = {}
  for (const c of classes || []) {
    if (!grouped[c.date]) grouped[c.date] = []
    grouped[c.date].push(c)
  }
  return grouped
}

/** Buckets PAST classes (date < currentWeekStartStr()) into Monday-start
 * weeks, MOST-RECENT week first, each week's days grouped via
 * groupClassesByDay (day order + each day's start_time order stay exactly
 * as the primary list's). Returns
 * [{ weekStartStr, weekEndStr, days: [[dateStr, classes[]], ...] }, ...]. */
export function groupPastClassesByWeek(classes) {
  const byWeek = new Map()
  for (const c of classes || []) {
    const weekStartStr = dateToStr(mondayOfWeek(new Date(c.date + 'T00:00:00')))
    if (!byWeek.has(weekStartStr)) byWeek.set(weekStartStr, [])
    byWeek.get(weekStartStr).push(c)
  }
  return [...byWeek.entries()]
    .sort((a, b) => (a[0] > b[0] ? -1 : a[0] < b[0] ? 1 : 0)) // most recent week first
    .map(([weekStartStr, weekClasses]) => {
      const weekEnd = new Date(weekStartStr + 'T00:00:00')
      weekEnd.setDate(weekEnd.getDate() + 6)
      const days = Object.entries(groupClassesByDay(weekClasses))
        .sort((a, b) => (a[0] > b[0] ? 1 : a[0] < b[0] ? -1 : 0)) // chronological within the week
      return { weekStartStr, weekEndStr: dateToStr(weekEnd), days }
    })
}
