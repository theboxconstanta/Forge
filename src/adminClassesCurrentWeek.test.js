// FORGE — ADMIN CLASSES: CURRENT WEEK FIRST + REMOVE 1000-ROW TRUNCATION.
//
// Root cause: Admin -> Classes's fetchClase() fetched the ENTIRE `classes`
// table unbounded (no .limit()/range paging), ordered ascending from the
// earliest row ever created, and rendered it fully expanded - forcing the
// admin to scroll past every past class before reaching today, AND silently
// truncating at PostgREST's max_rows=1000 (1039 real rows, 39 furthest-
// future ones silently dropped every session).
//
// Fix (narrow, presentation + query-boundary only - bookings/attendance/
// capacity/series/coach/color/duration are all untouched):
//   1. `clase` is now CURRENT + FUTURE ONLY (date >= currentWeekStartStr()),
//      fetched via the new paginated fetchAllClasses (classesPaging.js) so
//      it can never silently truncate regardless of dataset size.
//   2. Historical classes (date < currentWeekStartStr()) live in a separate
//      `claseTrecute` state, fetched lazily the first time the admin opens
//      SĂPTĂMÂNILE TRECUTE (collapsed by default, same accordion pattern as
//      Admin -> WOD's Past WODs), then cached for the rest of the session.
//   3. `refreshClase()` replaces every mutation call site that used to call
//      fetchClase() - always refreshes the primary dataset, and also
//      refreshes past classes if that accordion has already been loaded
//      (covers Delete Past, which can delete rows in either dataset).
//   4. getClassNotifParams / adminAdaugaInClasa's reminder lookup now check
//      BOTH `clase` and `claseTrecute`, so managing bookings on a class
//      shown inside the historical accordion still resolves correctly.
//   5. Pure week/pagination/grouping logic lives in classesPaging.js
//      (classesPaging.test.js) - this file covers only the App.jsx wiring
//      around it (query boundaries, accordion state, refresh/invalidation,
//      firewalls), matching this codebase's established golden-source-guard
//      pattern for logic embedded in the single App() component.

import { readFileSync } from 'fs'
import { join, dirname } from 'path'
import { fileURLToPath } from 'url'
import { describe, it, expect } from 'vitest'

const here = dirname(fileURLToPath(import.meta.url))
const appSource = readFileSync(join(here, 'App.jsx'), 'utf8')

describe('classesPaging import - reuses the shared pagination/week module, no duplicate logic', () => {
  it('imports currentWeekStartStr, fetchAllClasses, groupClassesByDay, groupPastClassesByWeek from classesPaging', () => {
    expect(appSource).toMatch(/import \{ currentWeekStartStr, fetchAllClasses, groupClassesByDay, groupPastClassesByWeek \} from '\.\/classesPaging'/)
  })
})

describe('3/4/10. Primary query - current+future only, boundary is the WEEK start, not today', () => {
  it('fetchClase filters date >= currentWeekStartStr() (Monday of the current week, not today)', () => {
    expect(appSource).toMatch(/const fetchClase = async \(\) => \{\s*\n\s*setLoadingClase\(true\)\s*\n\s*const rows = await fetchAllClasses\(supabase, \(q\) => q\.gte\('date', currentWeekStartStr\(\)\)\)/)
  })

  it('does NOT filter by today\'s date - Monday..Thursday of the current week must stay in the primary dataset', () => {
    const fnBody = appSource.slice(appSource.indexOf('const fetchClase = async'), appSource.indexOf('const fetchClaseTrecute'))
    expect(fnBody).not.toMatch(/todayLocalStr|new Date\(\)\.getFullYear\(\)/)
  })

  it('fetchClase only commits state on success (rows non-null) - never overwrites good state with a failed fetch', () => {
    expect(appSource).toMatch(/const rows = await fetchAllClasses\(supabase, \(q\) => q\.gte\('date', currentWeekStartStr\(\)\)\)\s*\n\s*if \(rows\) setClase\(rows\)/)
  })
})

describe('13. Past query - date < currentWeekStartStr(), lazy', () => {
  it('fetchClaseTrecute filters date < currentWeekStartStr()', () => {
    expect(appSource).toMatch(/const fetchClaseTrecute = async \(\) => \{\s*\n\s*setLoadingClaseTrecute\(true\)\s*\n\s*const rows = await fetchAllClasses\(supabase, \(q\) => q\.lt\('date', currentWeekStartStr\(\)\)\)/)
  })

  it('fetchClaseTrecute only commits + marks loaded on success', () => {
    expect(appSource).toMatch(/if \(rows\) \{ setClaseTrecute\(rows\); setClaseTrecuteLoaded\(true\) \}/)
  })
})

describe('11. SĂPTĂMÂNILE TRECUTE - closed by default, own persisted state, does not collide with pastWodsOpen', () => {
  it('claseTrecuteOpen initializes from sessionStorage, default false (closed)', () => {
    expect(appSource).toMatch(/const \[claseTrecuteOpen, setClaseTrecuteOpen\] = useState\(\(\) => \{\s*\n\s*try \{ return sessionStorage\.getItem\('claseTrecuteOpen'\) === '1' \} catch \{ return false \}\s*\n\s*\}\)/)
  })

  it('uses its own sessionStorage key, distinct from the WOD screen\'s pastWodsOpen', () => {
    expect(appSource).toMatch(/sessionStorage\.getItem\('claseTrecuteOpen'\)/)
    expect(appSource).toMatch(/sessionStorage\.getItem\('pastWodsOpen'\)/)
    // Two distinct accordions, two distinct keys - never the same string.
    expect(appSource.match(/'claseTrecuteOpen'/g).length).toBeGreaterThanOrEqual(2)
  })
})

describe('12/17. Lazy fetch on first open only - opening/closing again never refetches once cached', () => {
  it('toggleClaseTrecuteOpen fetches ONLY when opening AND not yet loaded', () => {
    expect(appSource).toMatch(/const toggleClaseTrecuteOpen = \(\) => \{\s*\n\s*const next = !claseTrecuteOpen\s*\n\s*setClaseTrecuteOpen\(next\)\s*\n\s*try \{ sessionStorage\.setItem\('claseTrecuteOpen', next \? '1' : '0'\) \} catch \{\}\s*\n\s*if \(next && !claseTrecuteLoaded\) fetchClaseTrecute\(\)\s*\n\s*\}/)
  })
})

describe('18/19. Delete Past + general mutation refresh - refreshClase invalidates past only if already loaded', () => {
  it('refreshClase always refreshes primary, and refreshes past only when claseTrecuteLoaded', () => {
    expect(appSource).toMatch(/const refreshClase = async \(\) => \{\s*\n\s*await fetchClase\(\)\s*\n\s*if \(claseTrecuteLoaded\) await fetchClaseTrecute\(\)\s*\n\s*\}/)
  })

  it('every former fetchClase() mutation call site now calls refreshClase() instead (create, remove-member, add-member, delete-past, delete-series, delete-single)', () => {
    const refreshCalls = (appSource.match(/refreshClase\(\)/g) || []).length
    // 1 definition-site call inside refreshClase itself doesn't count (that's
    // fetchClase(), not refreshClase()) - all 6 mutation call sites plus the
    // JSDoc-style comment referencing it.
    expect(refreshCalls).toBeGreaterThanOrEqual(6)
  })

  it('the initial mount fetch stays on fetchClase() (primary-only - nothing to invalidate yet)', () => {
    expect(appSource).toMatch(/fetchClase\(\); fetchWods\(\); fetchSectionTypes\(\); if \(gymId\) fetchMovements\(\)/)
  })
})

describe('22/23. Booking/member management resolves a class from EITHER dataset - no regression when managing a past class shown in the accordion', () => {
  it('getClassNotifParams checks clase, falling back to claseTrecute', () => {
    expect(appSource).toMatch(/const getClassNotifParams = \(classId\) => \{\s*\n\s*const c = clase\.find\(cl => cl\.id === classId\) \|\| claseTrecute\.find\(cl => cl\.id === classId\)/)
  })

  it('adminAdaugaInClasa\'s reminder-scheduling lookup checks clase, falling back to claseTrecute', () => {
    expect(appSource).toMatch(/const cls = clase\.find\(c => c\.id === classId\) \|\| claseTrecute\.find\(c => c\.id === classId\)/)
  })
})

describe('BOOKING FIREWALL - subscription-cancellation future-booking cleanup untouched (already correct: clase is a strict subset of the old unbounded array at date >= today)', () => {
  it('stergeAbonament still filters clase (now current+future) by date >= today for future-booking cleanup, unchanged', () => {
    expect(appSource).toMatch(/const futureClassIds = new Set\(clase\.filter\(c => c\.date >= aziStr\)\.map\(c => c\.id\)\)/)
  })
})

describe('SERIES FIREWALL - stergeSeria/stergeClasa/stergeClaseleTrecute logic untouched (all query Supabase directly, never read from clase/claseTrecute state)', () => {
  it('stergeSeria still queries Supabase directly by name/time/coach/date, not from client state', () => {
    expect(appSource).toMatch(/const stergeSeria = async \(c\) => \{[\s\S]{0,300}?const \{ data: claseSeriei \} = await supabase\.from\('classes'\)\.select\('id'\)\s*\n\s*\.eq\('name', c\.name\)\.eq\('start_time', c\.start_time\)\.eq\('end_time', c\.end_time\)\.eq\('coach', c\.coach\)\s*\n\s*\.gte\('date', aziS\)/)
  })

  it('stergeClaseleTrecute (Delete Past) semantics are byte-identical - still date < today, still preserves classes with bookings', () => {
    expect(appSource).toMatch(/const stergeClaseleTrecute = async \(\) => \{[\s\S]{0,600}?\.lt\('date', aziS\)/)
    expect(appSource).toMatch(/const idsDeSters = idsTrecute\.filter\(id => !idsCuRezervari\.has\(id\)\)/)
  })

  it('the Delete Past button is no longer gated on a clase.some(...) heuristic that would misfire once clase excludes older weeks - always rendered, still no-ops gracefully with a toast when nothing is eligible', () => {
    // Design System V1.0 Phase 3A migrated this button's markup onto the
    // shared destructive Button component (same onClick, same handler,
    // visual-only change) - assert the new markup, not the pre-migration one.
    expect(appSource).toMatch(/<Button variant="destructive" fullWidth=\{false\} onClick=\{stergeClaseleTrecute\}>\{t\.adminClassDeletePast\}<\/Button>/)
    // The old gate is gone from the render block immediately preceding it.
    const idx = appSource.indexOf("t.adminClassListHeader(clase.length)")
    const nearby = appSource.slice(idx, idx + 400)
    expect(nearby).not.toMatch(/clase\.some\(c => c\.date <.*new Date\(\)\.getFullYear/)
  })
})

describe('26. CLASSES count semantics - documented as current+future (truthful, no expensive extra count query)', () => {
  it('adminClassListHeader still reads clase.length directly - clase is now the fully-paginated current+future dataset, so this count is truthful without an extra COUNT query', () => {
    expect(appSource).toMatch(/\{t\.adminClassListHeader\(clase\.length\)\}/)
  })
})

describe('Rendering - a single reusable day-group renderer feeds both the flat current+future list and every week inside the past accordion', () => {
  it('renderClassDayGroup is defined once and used by both the primary list and the past-weeks accordion', () => {
    expect(appSource).toMatch(/const renderClassDayGroup = \(date, claseZi\) => \{/)
    const usages = (appSource.match(/renderClassDayGroup\(date, claseZi\)/g) || []).length
    expect(usages).toBeGreaterThanOrEqual(2)
  })

  it('the primary list groups `clase` (current+future) via groupClassesByDay', () => {
    expect(appSource).toMatch(/\{Object\.entries\(groupClassesByDay\(clase\)\)\.map\(\(\[date, claseZi\]\) => renderClassDayGroup\(date, claseZi\)\)\}/)
  })

  it('the past accordion groups claseTrecute via groupPastClassesByWeek, most-recent-week-first (delegated to the tested pure function)', () => {
    expect(appSource).toMatch(/groupPastClassesByWeek\(claseTrecute\)\.map\(\(\{ weekStartStr, weekEndStr, days \}\) => \(/)
  })
})

describe('UI FIREWALL - the day/class card itself (name, time, coach, spots, Users/delete/series buttons, booking panel) is untouched, just relocated into a shared function', () => {
  it('the class card still renders name, time range, coach, spots exactly as before', () => {
    expect(appSource).toMatch(/<Clock size=\{11\} \/> \{c\.start_time\?\.slice\(0,5\)\}–\{c\.end_time\?\.slice\(0,5\)\} · <User size=\{11\} \/> \{c\.coach\} · \{t\.adminClassSpotsCount\(c\.max_spots\)\}/)
  })

  it('the Users/delete/delete-series buttons and their handlers are unchanged', () => {
    expect(appSource).toMatch(/onClick=\{\(\) => \{ if \(clasaDeschisa === c\.id\) setClasaDeschisa\(null\); else \{ setClasaDeschisa\(c\.id\); fetchRezervariClasa\(c\.id\) \} \}\}/)
    expect(appSource).toMatch(/onClick=\{\(\) => stergeClasa\(c\.id\)\}/)
    expect(appSource).toMatch(/if \(window\.confirm\(t\.adminClassDeleteSeriesConfirm\(c\.name, c\.start_time\?\.slice\(0,5\)\)\)\) stergeSeria\(c\)/)
  })
})
