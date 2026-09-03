import { describe, it, expect } from 'vitest'
import { dedupLatestPerMember, monotonicLoggedAt } from './leaderboardSelection.js'

const L = (id, member, at, result) => ({ id, member_id: member, logged_at: at, result })

describe('INC-09 / P9.5.2A — dedupLatestPerMember (LB1-LB3, LB9, LB10)', () => {
  it('LB1 older 200 reps, newer 161 → keeps the newer 161 (score never decides)', () => {
    const out = dedupLatestPerMember([
      L('a', 'm1', '2026-09-02T18:00:00Z', '200 reps'),
      L('b', 'm1', '2026-09-02T19:30:00Z', '161 reps'),
    ])
    expect(out).toHaveLength(1)
    expect(out[0].id).toBe('b')
  })

  it('LB2 older 161, newer 200 → keeps the newer 200', () => {
    const out = dedupLatestPerMember([
      L('a', 'm1', '2026-09-02T10:00:00Z', '161'),
      L('b', 'm1', '2026-09-02T12:00:00Z', '200'),
    ])
    expect(out[0].id).toBe('b')
  })

  it('LB3 same logged_at → deterministic id tie-break, stable across input order', () => {
    const rows = [
      L('id-aaa', 'm1', '2026-09-02T10:00:00Z', 'x'),
      L('id-zzz', 'm1', '2026-09-02T10:00:00Z', 'y'),
    ]
    const a = dedupLatestPerMember(rows)[0].id
    const b = dedupLatestPerMember([...rows].reverse())[0].id
    expect(a).toBe(b)
    expect(a).toBe('id-zzz') // String('id-zzz') > String('id-aaa')
  })

  it('LB10 no duplicate row per member; multiple members each keep their latest', () => {
    const out = dedupLatestPerMember([
      L('a', 'm1', '2026-09-02T10:00:00Z'), L('b', 'm1', '2026-09-02T11:00:00Z'),
      L('c', 'm2', '2026-09-02T09:00:00Z'), L('d', 'm2', '2026-09-02T08:00:00Z'),
    ])
    expect(out.map(l => l.id).sort()).toEqual(['b', 'c'])
  })
})

describe('P9.5.2A — monotonicLoggedAt (re-log / edit must sort after prior submissions)', () => {
  const DAY = '2026-09-02'
  const now = new Date('2026-09-03T05:00:00Z').getTime()

  it('first log (no siblings) → base unchanged', () => {
    expect(monotonicLoggedAt({ base: `${DAY}T05:00:00.000Z`, siblingLoggedAts: [], now }))
      .toBe(`${DAY}T05:00:00.000Z`)
  })

  it('re-log of a past workout EARLIER in the day than a prior submission → bumps just past it', () => {
    // original submitted yesterday 07:54; re-logged today at wall-clock 05:00 →
    // dateWithCurrentTime stamps 2026-09-02T05:00 (before 07:54). Must bump.
    const res = monotonicLoggedAt({
      base: `${DAY}T05:00:00.000Z`,
      siblingLoggedAts: [`${DAY}T07:54:15.509Z`, `${DAY}T04:58:00.000Z`],
      now,
    })
    expect(new Date(res).getTime()).toBe(new Date(`${DAY}T07:54:16.509Z`).getTime())
    expect(new Date(res).getTime()).toBeLessThanOrEqual(now)
  })

  it('genuine latest (base already after all siblings) → base unchanged', () => {
    const base = `${DAY}T20:00:00.000Z`
    expect(monotonicLoggedAt({ base, siblingLoggedAts: [`${DAY}T07:54:00.000Z`], now }))
      .toBe(base)
  })

  it('never bumps beyond now (future-dated sibling)', () => {
    const res = monotonicLoggedAt({
      base: `${DAY}T05:00:00.000Z`,
      siblingLoggedAts: ['2026-09-10T00:00:00.000Z'],
      now,
    })
    expect(new Date(res).getTime()).toBe(now)
  })

  it('edit: bump forward past a later sibling so the leaderboard projects the edited row', () => {
    // editing yesterday's 04:59 log; a sibling at 07:54 exists → the edit must
    // become the member representative → bump to 07:54:01.
    const res = monotonicLoggedAt({
      base: `${DAY}T04:59:58.867Z`,
      siblingLoggedAts: [`${DAY}T07:54:15.509Z`, `${DAY}T05:16:23.652Z`],
      now,
    })
    expect(new Date(res).getTime()).toBe(new Date(`${DAY}T07:54:16.509Z`).getTime())
  })
})
