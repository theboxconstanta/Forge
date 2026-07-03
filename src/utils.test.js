import { describe, it, expect, vi, afterEach } from 'vitest'
import {
  todayLocalStr, addMonthsClamped, daysUntil, levenshtein, urlBase64ToUint8Array,
  fmt, secToTime, timeToSec, convertWeight, formatPR, getInitiale, parseWodMinute, formatWodDurata,
} from './utils'

afterEach(() => {
  vi.useRealTimers()
})

describe('addMonthsClamped', () => {
  it('31 ianuarie + 1 lună -> 28 februarie (2026, an nebisect)', () => {
    expect(addMonthsClamped(new Date('2026-01-31T00:00:00'), 1)).toBe('2026-02-28')
  })

  it('31 ianuarie + 1 lună -> 29 februarie (2024, an bisect)', () => {
    expect(addMonthsClamped(new Date('2024-01-31T00:00:00'), 1)).toBe('2024-02-29')
  })

  it('31 martie + 1 lună -> 30 aprilie', () => {
    expect(addMonthsClamped(new Date('2026-03-31T00:00:00'), 1)).toBe('2026-04-30')
  })

  it('31 august + 1 lună -> 30 septembrie', () => {
    expect(addMonthsClamped(new Date('2026-08-31T00:00:00'), 1)).toBe('2026-09-30')
  })

  it('30 noiembrie + 3 luni -> 28 februarie anul următor (rollover peste an)', () => {
    expect(addMonthsClamped(new Date('2026-11-30T00:00:00'), 3)).toBe('2027-02-28')
  })

  it('31 decembrie + 1 lună -> 31 ianuarie anul următor', () => {
    expect(addMonthsClamped(new Date('2026-12-31T00:00:00'), 1)).toBe('2027-01-31')
  })

  it('caz normal, fara clamp: 15 mai + 1 lună -> 15 iunie', () => {
    expect(addMonthsClamped(new Date('2026-05-15T00:00:00'), 1)).toBe('2026-06-15')
  })

  it('nu mută obiectul Date primit ca parametru', () => {
    const start = new Date('2026-07-03T00:00:00')
    const before = start.getTime()
    addMonthsClamped(start, 1)
    expect(start.getTime()).toBe(before)
  })

  it('lună de start cu 30 de zile: 4 septembrie + 1 lună -> 4 octombrie (30 zile)', () => {
    expect(addMonthsClamped(new Date('2026-09-04T00:00:00'), 1)).toBe('2026-10-04')
  })
})

describe('daysUntil', () => {
  it('dă același rezultat indiferent de ora din zi', () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-07-03T00:05:00'))
    const early = daysUntil('2026-08-03')
    vi.setSystemTime(new Date('2026-07-03T12:34:00'))
    const midday = daysUntil('2026-08-03')
    vi.setSystemTime(new Date('2026-07-03T23:50:00'))
    const late = daysUntil('2026-08-03')
    expect(early).toBe(31)
    expect(midday).toBe(31)
    expect(late).toBe(31)
  })

  it('0 exact în ziua expirării', () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-07-03T09:00:00'))
    expect(daysUntil('2026-07-03')).toBe(0)
  })

  it('negativ pentru o dată deja trecută', () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-07-03T09:00:00'))
    expect(daysUntil('2026-07-01')).toBe(-2)
  })

  it('28 zile pentru o luna cu 28 (februarie 2026, an nebisect)', () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-02-25T10:00:00'))
    expect(daysUntil('2026-03-25')).toBe(28)
  })
})

describe('levenshtein', () => {
  it('0 pentru șiruri identice', () => {
    expect(levenshtein('abc', 'abc')).toBe(0)
  })
  it('numără corect editările', () => {
    expect(levenshtein('kitten', 'sitting')).toBe(3)
  })
  it('email cu o literă diferită - similar', () => {
    expect(levenshtein('ion.popescu@gmail.com', 'ion.popescu@gmail.con')).toBe(1)
  })
})

describe('urlBase64ToUint8Array', () => {
  it('decodează un string base64url la Uint8Array', () => {
    // "test" in base64url e "dGVzdA"
    const result = urlBase64ToUint8Array('dGVzdA')
    expect(Array.from(result)).toEqual([116, 101, 115, 116])
  })
})

describe('fmt', () => {
  it('formatează secunde ca M:SS', () => {
    expect(fmt(65)).toBe('1:05')
    expect(fmt(5)).toBe('0:05')
    expect(fmt(600)).toBe('10:00')
  })
})

describe('secToTime / timeToSec', () => {
  it('secToTime sub o oră -> M:SS', () => {
    expect(secToTime(125)).toBe('2:05')
  })
  it('secToTime peste o oră -> H:MM:SS', () => {
    expect(secToTime(3725)).toBe('1:02:05')
  })
  it('timeToSec pentru M:SS', () => {
    expect(timeToSec('2:05')).toBe(125)
  })
  it('timeToSec pentru H:MM:SS', () => {
    expect(timeToSec('1:02:05')).toBe(3725)
  })
  it('round-trip secToTime -> timeToSec', () => {
    expect(timeToSec(secToTime(3725))).toBe(3725)
  })
  it('timeToSec(null) -> null', () => {
    expect(timeToSec(null)).toBe(null)
  })
})

describe('convertWeight', () => {
  it('kg -> lbs', () => {
    expect(convertWeight(100, 'kg', 'lbs')).toBeCloseTo(220.5, 1)
  })
  it('lbs -> kg', () => {
    expect(convertWeight(220.5, 'lbs', 'kg')).toBeCloseTo(100, 1)
  })
  it('aceeași unitate -> neschimbat', () => {
    expect(convertWeight(100, 'kg', 'kg')).toBe(100)
  })
  it('null -> null', () => {
    expect(convertWeight(null, 'kg', 'lbs')).toBe(null)
  })
})

describe('formatPR', () => {
  it('PR de greutate, fara conversie', () => {
    expect(formatPR({ unit: 'kg', value: 100, reps: 1 })).toBe('100 kg × 1rep')
  })
  it('PR de greutate cu unitate preferata diferita', () => {
    expect(formatPR({ unit: 'kg', value: 100, reps: 1 }, 'lbs')).toBe('220.5 lbs × 1rep')
  })
  it('PR de timp stocat ca secunde', () => {
    expect(formatPR({ unit: 'timp', value: '125' })).toBe('2:05')
  })
  it('PR de timp stocat deja ca text M:SS', () => {
    expect(formatPR({ unit: 'timp', value: '4:22' })).toBe('4:22')
  })
  it('PR de distanta cu timp asociat', () => {
    expect(formatPR({ unit: 'm', value: 1000, time_result: '4:00' })).toBe('1000 m — 4:00')
  })
  it('fara valoare -> em dash', () => {
    expect(formatPR({ unit: 'kg', value: null })).toBe('—')
  })
})

describe('getInitiale', () => {
  it('nume complet -> initiale', () => {
    expect(getInitiale('Lucian Rosca')).toBe('LR')
  })
  it('fara nume -> ??', () => {
    expect(getInitiale(null)).toBe('??')
    expect(getInitiale('')).toBe('??')
  })
})

describe('parseWodMinute / formatWodDurata', () => {
  it('parseWodMinute extrage numarul de minute', () => {
    expect(parseWodMinute('20 minute')).toBe(20)
    expect(parseWodMinute(null)).toBe(null)
  })
  it('formatWodDurata pastreaza formatul M:SS existent', () => {
    expect(formatWodDurata('20:00')).toBe('20:00')
  })
  it('formatWodDurata converteste text liber in M:00', () => {
    expect(formatWodDurata('40 minute')).toBe('40:00')
  })
  it('formatWodDurata fara input -> string gol', () => {
    expect(formatWodDurata(null)).toBe('')
  })
})

describe('todayLocalStr', () => {
  it('foloseste ora locala, nu UTC (nu se decaleaza langa miezul noptii)', () => {
    vi.useFakeTimers()
    // 00:30 ora locala a testului - ar fi inca ziua anterioara in UTC daca
    // am folosi gresit toISOString() intr-un fus orar la est de UTC
    vi.setSystemTime(new Date(2026, 6, 3, 0, 30, 0))
    expect(todayLocalStr()).toBe('2026-07-03')
  })
})
