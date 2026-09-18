// FORGE - ADMIN CLASSES current-week-first + pagination. Pure-logic tests
// for classesPaging.js. App.jsx wiring (query boundaries, accordion state,
// refresh/invalidation, firewalls) is covered separately in
// adminClassesCurrentWeek.test.js via golden-source guards, matching this
// codebase's established pattern for logic embedded in the single App()
// component.

import { describe, it, expect, vi } from 'vitest'
import { mondayOfWeek, currentWeekStartStr, fetchAllClasses, groupClassesByDay, groupPastClassesByWeek } from './classesPaging'

describe('mondayOfWeek / currentWeekStartStr', () => {
  it('1. current week starts Monday - a Friday resolves to that week\'s Monday', () => {
    // Friday 2026-09-18
    expect(currentWeekStartStr(new Date('2026-09-18T12:00:00'))).toBe('2026-09-14')
  })

  it('2a. Sunday resolves to the PRECEDING Monday, not the next one', () => {
    // Sunday 2026-09-20 belongs to the week starting 2026-09-14
    expect(currentWeekStartStr(new Date('2026-09-20T12:00:00'))).toBe('2026-09-14')
  })

  it('2b. Monday resolves to itself', () => {
    expect(currentWeekStartStr(new Date('2026-09-14T00:00:01'))).toBe('2026-09-14')
  })

  it('2c. Sunday->Monday boundary - the day right after a Sunday starts a new week', () => {
    const sunday = currentWeekStartStr(new Date('2026-09-20T23:59:00'))
    const monday = currentWeekStartStr(new Date('2026-09-21T00:00:01'))
    expect(sunday).toBe('2026-09-14')
    expect(monday).toBe('2026-09-21')
  })

  it('mondayOfWeek returns a real Monday Date object', () => {
    const m = mondayOfWeek(new Date('2026-09-18T12:00:00'))
    expect(m.getDay()).toBe(1)
    expect(m.getDate()).toBe(14)
  })

  it('crosses a month boundary correctly (no UTC drift)', () => {
    // Tuesday 2026-09-01 -> Monday 2026-08-31
    expect(currentWeekStartStr(new Date('2026-09-01T12:00:00'))).toBe('2026-08-31')
  })
})

function makeFakeSupabase(pages) {
  // pages: array of { data, error } returned in sequence for successive
  // .range() calls. Records every .order()/.range() call and every filter
  // applied via applyFilter, for assertion.
  const calls = { orders: [], ranges: [], filters: [] }
  let pageIndex = 0
  const client = {
    from: (table) => {
      calls.table = table
      const builder = {
        select: () => builder,
        order: (col, opts) => { calls.orders.push([col, opts]); return builder },
        gte: (col, val) => { calls.filters.push(['gte', col, val]); return builder },
        lt: (col, val) => { calls.filters.push(['lt', col, val]); return builder },
        range: (from, to) => {
          calls.ranges.push([from, to])
          const page = pages[pageIndex] || { data: [], error: null }
          pageIndex += 1
          return Promise.resolve(page)
        },
      }
      return builder
    },
  }
  return { client, calls }
}

describe('fetchAllClasses - deterministic pagination past the 1000-row cap', () => {
  it('3/10/13. applyFilter is honored - .gte/.lt reach the query builder', async () => {
    const { client, calls } = makeFakeSupabase([{ data: [], error: null }])
    await fetchAllClasses(client, (q) => q.gte('date', '2026-09-14'))
    expect(calls.filters).toEqual([['gte', 'date', '2026-09-14']])
    const { client: client2, calls: calls2 } = makeFakeSupabase([{ data: [], error: null }])
    await fetchAllClasses(client2, (q) => q.lt('date', '2026-09-14'))
    expect(calls2.filters).toEqual([['lt', 'date', '2026-09-14']])
  })

  it('6/7. orders by date ASC then start_time ASC (then id ASC as the deterministic tie-breaker)', async () => {
    const { client, calls } = makeFakeSupabase([{ data: [], error: null }])
    await fetchAllClasses(client, (q) => q)
    expect(calls.orders).toEqual([
      ['date', { ascending: true }],
      ['start_time', { ascending: true }],
      ['id', { ascending: true }],
    ])
  })

  it('8/9/25. >1000 rows: pages until a short page, concatenates everything, no truncation at 1000', async () => {
    const page1 = Array.from({ length: 1000 }, (_, i) => ({ id: `a${i}`, date: '2026-08-10' }))
    const page2 = Array.from({ length: 39 }, (_, i) => ({ id: `b${i}`, date: '2027-09-01' }))
    const { client, calls } = makeFakeSupabase([{ data: page1, error: null }, { data: page2, error: null }])
    const rows = await fetchAllClasses(client, (q) => q)
    expect(rows.length).toBe(1039)
    expect(calls.ranges).toEqual([[0, 999], [1000, 1999]])
  })

  it('exactly 1000 rows still issues a second (empty) page to confirm no more remain', async () => {
    const page1 = Array.from({ length: 1000 }, (_, i) => ({ id: `a${i}` }))
    const { client, calls } = makeFakeSupabase([{ data: page1, error: null }, { data: [], error: null }])
    const rows = await fetchAllClasses(client, (q) => q)
    expect(rows.length).toBe(1000)
    expect(calls.ranges.length).toBe(2)
  })

  it('24. no duplicate rows across page boundaries', async () => {
    const page1 = Array.from({ length: 1000 }, (_, i) => ({ id: `id-${i}` }))
    const page2 = Array.from({ length: 5 }, (_, i) => ({ id: `id-${1000 + i}` }))
    const { client } = makeFakeSupabase([{ data: page1, error: null }, { data: page2, error: null }])
    const rows = await fetchAllClasses(client, (q) => q)
    const ids = new Set(rows.map((r) => r.id))
    expect(ids.size).toBe(rows.length)
    expect(rows.length).toBe(1005)
  })

  it('a single short page (<1000) does not page again', async () => {
    const { client, calls } = makeFakeSupabase([{ data: [{ id: '1' }, { id: '2' }], error: null }])
    const rows = await fetchAllClasses(client, (q) => q)
    expect(rows.length).toBe(2)
    expect(calls.ranges.length).toBe(1)
  })

  it('fail-safe: a page error returns null (never a partial array) so callers never overwrite good state', async () => {
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    const page1 = Array.from({ length: 1000 }, (_, i) => ({ id: `a${i}` }))
    const { client } = makeFakeSupabase([{ data: page1, error: null }, { data: null, error: { message: 'boom' } }])
    const rows = await fetchAllClasses(client, (q) => q)
    expect(rows).toBeNull()
    errSpy.mockRestore()
  })
})

describe('groupClassesByDay', () => {
  it('buckets by date, preserving chronological insertion order', () => {
    const classes = [
      { id: '1', date: '2026-09-14', start_time: '09:00' },
      { id: '2', date: '2026-09-14', start_time: '17:00' },
      { id: '3', date: '2026-09-16', start_time: '09:00' },
    ]
    const grouped = groupClassesByDay(classes)
    expect(Object.keys(grouped)).toEqual(['2026-09-14', '2026-09-16'])
    expect(grouped['2026-09-14'].map((c) => c.id)).toEqual(['1', '2'])
  })

  it('empty/undefined input returns an empty object, never throws', () => {
    expect(groupClassesByDay(undefined)).toEqual({})
    expect(groupClassesByDay([])).toEqual({})
  })
})

describe('groupPastClassesByWeek', () => {
  const fixture = [
    // week of 2026-08-31 (oldest)
    { id: 'a', date: '2026-08-31', start_time: '09:00' },
    { id: 'b', date: '2026-09-02', start_time: '17:00' },
    // week of 2026-09-07 (middle)
    { id: 'c', date: '2026-09-08', start_time: '18:00' },
    { id: 'd', date: '2026-09-08', start_time: '09:00' },
    // week of 2026-09-14 (most recent, still "past" relative to a later currentWeekStart)
    { id: 'e', date: '2026-09-15', start_time: '10:00' },
  ]

  it('15. orders weeks MOST RECENT first', () => {
    const weeks = groupPastClassesByWeek(fixture)
    expect(weeks.map((w) => w.weekStartStr)).toEqual(['2026-09-14', '2026-09-07', '2026-08-31'])
  })

  it('produces a compact Monday-Sunday label pair per week', () => {
    const weeks = groupPastClassesByWeek(fixture)
    expect(weeks[1]).toMatchObject({ weekStartStr: '2026-09-07', weekEndStr: '2026-09-13' })
  })

  it('16. days within a week are chronological; classes within a day are ASC by input order (already start_time-sorted upstream)', () => {
    const weeks = groupPastClassesByWeek(fixture)
    const middleWeek = weeks.find((w) => w.weekStartStr === '2026-09-07')
    expect(middleWeek.days.map(([date]) => date)).toEqual(['2026-09-08'])
    // fixture already lists 'c' (18:00) before 'd' (09:00) - groupPastClassesByWeek
    // must NOT silently re-sort within a day; that's fetchAllClasses's job upstream.
    expect(middleWeek.days[0][1].map((c) => c.id)).toEqual(['c', 'd'])
  })

  it('weeks spanning a month boundary label correctly', () => {
    const weeks = groupPastClassesByWeek(fixture)
    const oldest = weeks.find((w) => w.weekStartStr === '2026-08-31')
    expect(oldest.weekEndStr).toBe('2026-09-06')
  })

  it('empty input returns an empty array', () => {
    expect(groupPastClassesByWeek([])).toEqual([])
    expect(groupPastClassesByWeek(undefined)).toEqual([])
  })
})
