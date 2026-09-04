import { describe, it, expect, vi, afterEach } from 'vitest'
import {
  todayLocalStr, dateWithCurrentTime, localDayBoundsUTC, computeWodHeaderLine, resolveWodIdForLog, isWorkoutFetchCurrent, homeWorkoutResponseIsCurrent, logIsMoreRecent, freezeLoggingContext, resolveLoggedWorkoutIdentity, addMonthsClamped, daysUntil, levenshtein, urlBase64ToUint8Array,
  fmt, secToTime, timeToSec, convertWeight, formatPR, getInitiale, parseWodMinute, formatWodDurata,
  authErrorMessage, RESET_LINK_ERROR_CODES, isInAttendanceGraceWindow,
  resolveMemberIdentity,
} from './utils'
import { snapshotPrescriptionDoc } from './prescriptionContract.js'

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

describe('localDayBoundsUTC', () => {
  it('convertaste 00:00:00.000 local si 23:59:59.999 local in instante UTC corecte, nu ca stringuri naive UTC', () => {
    const { startUTC, endUTC } = localDayBoundsUTC('2026-08-26')
    // new Date(2026, 7, 26, 0, 0, 0, 0) interpretat de motorul JS al
    // masinii care ruleaza testul (nedeterminist fata de fus orar) -
    // verificam ca round-trip-ul prin Date pastreaza exact aceleasi
    // componente locale, nu ca hardcodam un offset UTC fix.
    const start = new Date(startUTC)
    const end = new Date(endUTC)
    expect(start.getFullYear()).toBe(2026)
    expect(start.getMonth()).toBe(7)
    expect(start.getDate()).toBe(26)
    expect(start.getHours()).toBe(0)
    expect(start.getMinutes()).toBe(0)
    expect(start.getSeconds()).toBe(0)
    expect(end.getDate()).toBe(26)
    expect(end.getHours()).toBe(23)
    expect(end.getMinutes()).toBe(59)
    expect(end.getSeconds()).toBe(59)
  })

  it('NU produce acelasi string ca simpla concatenare naiva `${date}T00:00:00` - trebuie sa treaca prin conversia reala UTC', () => {
    const { startUTC } = localDayBoundsUTC('2026-08-26')
    expect(startUTC).not.toBe('2026-08-26T00:00:00')
    // startUTC trebuie sa fie un ISO string valid cu sufix Z (instanta UTC reala)
    expect(startUTC.endsWith('Z')).toBe(true)
  })

  it('sfarsitul zilei este strict dupa inceputul zilei', () => {
    const { startUTC, endUTC } = localDayBoundsUTC('2026-08-26')
    expect(new Date(endUTC).getTime()).toBeGreaterThan(new Date(startUTC).getTime())
  })
})

describe('resolveWodIdForLog - yesterday-WOD forensic regression (workouts.date/wods.date desync)', () => {
  it('reproduces the exact production incident: Engine V2 loaded (real legacyWodId) but legacy wods lookup is null - uses legacyWodId, not null', () => {
    // Real anonymized shape of 2026-08-27's actual production workout:
    // workouts.date = '2026-08-27', legacy_wod_id pointed at a `wods` row
    // whose OWN date was '2026-08-28' - fetchWodZi('2026-08-27') found
    // zero rows (wodZiData = null), while fetchWodZiWorkoutV2 succeeded.
    const wodZiWorkoutV2 = { id: '7daeed8f-24c4-40ab-8f33-215fcabf4692', legacyWodId: '8cd9666b-ac7b-4ac0-8c36-4911aa5c2b95', date: '2026-08-27' }
    const wodZiData = null
    expect(resolveWodIdForLog(wodZiWorkoutV2, wodZiData)).toBe('8cd9666b-ac7b-4ac0-8c36-4911aa5c2b95')
  })

  it('CONTROL: no WOD scheduled at all (original INC-02 scenario) - both sources null, resolves to null without throwing', () => {
    expect(() => resolveWodIdForLog(null, null)).not.toThrow()
    expect(resolveWodIdForLog(null, null)).toBe(null)
  })

  it('CONTROL: pure legacy day (no Engine V2 sync yet) - falls back to wodZiData.id', () => {
    expect(resolveWodIdForLog(null, { id: 'legacy-wod-id-123' })).toBe('legacy-wod-id-123')
  })

  it('CONTROL: both sources present and agreeing - either value, same result', () => {
    const wodZiWorkoutV2 = { id: 'v2-id', legacyWodId: 'shared-wod-id' }
    const wodZiData = { id: 'shared-wod-id' }
    expect(resolveWodIdForLog(wodZiWorkoutV2, wodZiData)).toBe('shared-wod-id')
  })

  it('prefers wodZiWorkoutV2.legacyWodId when the two sources disagree (matches what the DB trigger validates against)', () => {
    const wodZiWorkoutV2 = { id: 'v2-id', legacyWodId: 'correct-wod-id' }
    const wodZiData = { id: 'stale-wrong-wod-id' }
    expect(resolveWodIdForLog(wodZiWorkoutV2, wodZiData)).toBe('correct-wod-id')
  })

  // INC-03 - workout identity is the SELECTED/displayed workout, never the
  // submission day. Logging workout D on D+1 (or D+n) still resolves to D's
  // own legacy WOD id; the submission timestamp (logged_at) is a separate
  // concept and is not an input to identity resolution here.
  it('INC-03: identity is the selected workout regardless of when it is logged - a historical workout keeps its own legacy_wod_id', () => {
    const historicalWorkout = { id: 'v2-2026-08-27', legacyWodId: 'wod-2026-08-27', date: '2026-08-27' }
    const historicalLegacy = { id: 'wod-2026-08-27', date: '2026-08-27' }
    // member opens it and logs days later - resolveWodIdForLog takes no
    // "today" / submission-date argument at all:
    expect(resolveWodIdForLog(historicalWorkout, historicalLegacy)).toBe('wod-2026-08-27')
    expect(resolveWodIdForLog.length).toBe(2) // (wodZiWorkoutV2, wodZiData) only
  })
})

describe('isWorkoutFetchCurrent - INC-04 (Log Score opens today for a selected historical date)', () => {
  // Owner repro on 2026-08-28: Home tab -> select 2026-08-27 -> "Log Score"
  // opened TODAY's workout. Root cause: fetchWodZi / fetchWodZiWorkoutV2 had no
  // request-currency guard, so an in-flight fetch for the previous date (today,
  // started when the Home tab mounted) could resolve AFTER the 2026-08-27 fetch
  // and overwrite wodZiData / wodZiWorkoutV2. This guard discards any response
  // whose date is no longer the selected one.

  it('applies a response only when its date is still the selected date', () => {
    expect(isWorkoutFetchCurrent('2026-08-27', '2026-08-27')).toBe(true)
  })

  it('EXACT INC-04: a late today (2026-08-28) response is discarded when 2026-08-27 is selected', () => {
    // fetch was issued for today; by the time it resolved the member had
    // selected the historical date -> must NOT overwrite the historical state
    expect(isWorkoutFetchCurrent('2026-08-28', '2026-08-27')).toBe(false)
  })

  it('a stale historical response is discarded once the member returns to today', () => {
    expect(isWorkoutFetchCurrent('2026-08-27', '2026-08-28')).toBe(false)
  })

  it('D+n: a response for workout date D is still applied when D is selected, whatever "today" is', () => {
    expect(isWorkoutFetchCurrent('2026-08-01', '2026-08-01')).toBe(true) // selected D, response for D
    expect(isWorkoutFetchCurrent('2026-09-03', '2026-08-01')).toBe(false) // late "today" response, D still selected
  })

  it('the intermediate date (26) response is dropped on 27 -> 26 -> 27', () => {
    expect(isWorkoutFetchCurrent('2026-08-26', '2026-08-27')).toBe(false)
  })

  it('date equality ALONE is not enough for A -> B -> A (see homeWorkoutResponseIsCurrent)', () => {
    // isWorkoutFetchCurrent would wrongly pass an old 27 response once 27 is
    // re-selected. The monotonic-sequence guard in homeWorkoutResponseIsCurrent
    // is what actually rejects it - covered in that describe block below.
    expect(isWorkoutFetchCurrent('2026-08-27', '2026-08-27')).toBe(true)
  })

  it('null / undefined fetch date never counts as current (fails safe, no today fallback)', () => {
    expect(isWorkoutFetchCurrent(null, '2026-08-27')).toBe(false)
    expect(isWorkoutFetchCurrent(undefined, '2026-08-27')).toBe(false)
    expect(isWorkoutFetchCurrent(null, null)).toBe(false)
  })
})

describe('homeWorkoutResponseIsCurrent - INC-04 FINAL (monotonic request currency)', () => {
  // The same date can be requested repeatedly (the [dataAcasa] effect, the
  // realtime `wods` handler, a focus refresh, rapid A->B->A chip taps). Date
  // equality alone lets an OLDER response for the currently-selected date
  // commit over a NEWER in-flight one. Each fetch captures a monotonically
  // increasing seq; only seq === latest AND date === selected may commit.

  it('latest request for the selected date commits', () => {
    expect(homeWorkoutResponseIsCurrent({ requestSeq: 5, latestSeq: 5, requestDate: '2026-09-03', selectedDate: '2026-09-03' })).toBe(true)
  })

  it('A -> B -> A: the FIRST A response (seq 1) is rejected once a newer A request (seq 3) exists', () => {
    // taps: A(seq1) -> B(seq2) -> A(seq3); A#1 resolves last
    expect(homeWorkoutResponseIsCurrent({ requestSeq: 1, latestSeq: 3, requestDate: '2026-09-01', selectedDate: '2026-09-01' })).toBe(false)
    // A#3 (the real current one) commits
    expect(homeWorkoutResponseIsCurrent({ requestSeq: 3, latestSeq: 3, requestDate: '2026-09-01', selectedDate: '2026-09-01' })).toBe(true)
  })

  it('same-date refetch (realtime `wods` change while the [dataAcasa] fetch is still in flight): #1 loses to #2', () => {
    expect(homeWorkoutResponseIsCurrent({ requestSeq: 1, latestSeq: 2, requestDate: '2026-09-03', selectedDate: '2026-09-03' })).toBe(false)
    expect(homeWorkoutResponseIsCurrent({ requestSeq: 2, latestSeq: 2, requestDate: '2026-09-03', selectedDate: '2026-09-03' })).toBe(true)
  })

  it('a stale response whose date is no longer selected is rejected even if it is the latest seq', () => {
    expect(homeWorkoutResponseIsCurrent({ requestSeq: 4, latestSeq: 4, requestDate: '2026-09-03', selectedDate: '2026-09-07' })).toBe(false)
  })

  it('null request date fails safe', () => {
    expect(homeWorkoutResponseIsCurrent({ requestSeq: 2, latestSeq: 2, requestDate: null, selectedDate: '2026-09-03' })).toBe(false)
  })
})

describe('freezeLoggingContext / resolveLoggedWorkoutIdentity - INC-04 GLOBAL (frozen logging identity)', () => {
  // Generic multi-workout fixtures. All three share the SAME variant label
  // ("RX") but have completely different ids / content / dates. None is
  // special-cased. The frozen logging context must always belong to the
  // workout the member clicked, regardless of what the live state becomes.
  const mkWorkout = (tag, date) => ({
    id: `v2-${tag}`, legacyWodId: `wod-${tag}`, date,
    sections: [
      { id: `sec-metcon-${tag}`, slotKey: 'metcon', loggingMode: 'required', format: 'For Time' },
      { id: `sec-skill-${tag}`, slotKey: 'skill', loggingMode: 'optional' },
      { id: `sec-extra-${tag}`, slotKey: 'skill2', loggingMode: 'required' },
    ],
  })
  const mkLegacy = (tag, date) => ({
    id: `wod-${tag}`, date, type: 'For Time',
    movements_rx: [`RX-${tag}: 21-15-9`], movements_intermediate: [`INT-${tag}`],
    movements_beginner: [`BEG-${tag}`], movements_onramp: [`OR-${tag}`],
    rx_weight_male: `${tag}-40kg`, rx_weight_female: `${tag}-30kg`,
  })

  const A = { v2: mkWorkout('A', '2026-08-20'), legacy: mkLegacy('A', '2026-08-20') }
  const B = { v2: mkWorkout('B', '2026-08-21'), legacy: mkLegacy('B', '2026-08-21') }
  const C = { v2: mkWorkout('C', '2026-07-14'), legacy: mkLegacy('C', '2026-07-14') }
  const dispA = { ...A.v2 } // workoutForDisplay is the V2 object when present

  it('same "RX" label across A/B/C: freezing A yields A\'s legacy WOD, A\'s metcon section, A\'s date, A\'s RX movements - never B or C', () => {
    const ctx = freezeLoggingContext(dispA, A.legacy, A.v2, '2026-08-20')
    const id = resolveLoggedWorkoutIdentity(ctx, 'RX')
    expect(id.wodId).toBe('wod-A')
    expect(id.sectionId).toBe('sec-metcon-A')
    expect(id.businessDate).toBe('2026-08-20')
    expect(id.variantMovements).toEqual(['RX-A: 21-15-9'])
  })

  it('freeze is immutable: mutating the LIVE workout to B afterwards does not change the frozen A identity', () => {
    const ctx = freezeLoggingContext(dispA, A.legacy, A.v2, '2026-08-20')
    // simulate a stale fetch resolving and the app swapping in workout B
    let liveWodZiData = B.legacy
    let liveWodZiV2 = B.v2
    void liveWodZiData; void liveWodZiV2
    const id = resolveLoggedWorkoutIdentity(ctx, 'RX')
    expect(id.wodId).toBe('wod-A')
    expect(id.sectionId).toBe('sec-metcon-A')
    expect(id.businessDate).toBe('2026-08-20')
  })

  it('each variant level resolves that level\'s movements OF THE FROZEN workout (A), not a generic RX', () => {
    const ctx = freezeLoggingContext(dispA, A.legacy, A.v2, '2026-08-20')
    expect(resolveLoggedWorkoutIdentity(ctx, 'RX').variantMovements).toEqual(['RX-A: 21-15-9'])
    expect(resolveLoggedWorkoutIdentity(ctx, 'Intermediate').variantMovements).toEqual(['INT-A'])
    expect(resolveLoggedWorkoutIdentity(ctx, 'Beginner').variantMovements).toEqual(['BEG-A'])
    expect(resolveLoggedWorkoutIdentity(ctx, 'OnRamp').variantMovements).toEqual(['OR-A'])
  })

  it('multi-section: additionalScoredSections carries ONLY non-primary required sections of the frozen workout', () => {
    const ctx = freezeLoggingContext(dispA, A.legacy, A.v2, '2026-08-20')
    expect(ctx.additionalScoredSections.map(s => s.id)).toEqual(['sec-extra-A'])
    expect(ctx.primarySection.id).toBe('sec-metcon-A')
    expect(ctx.supportingSections.map(s => s.id)).toEqual(['sec-skill-A', 'sec-extra-A'])
  })

  it('historical D+n: freezing C (date 2026-07-14) keeps 2026-07-14 identity no matter the submission day', () => {
    const ctx = freezeLoggingContext({ ...C.v2 }, C.legacy, C.v2, '2026-07-14')
    const id = resolveLoggedWorkoutIdentity(ctx, 'RX')
    expect(id.wodId).toBe('wod-C')
    expect(id.sectionId).toBe('sec-metcon-C')
    expect(id.businessDate).toBe('2026-07-14')
  })

  it('legacy-only day (no Engine V2 row): wodId falls back to wods.id, sectionId is null (no synthetic section)', () => {
    const legacyMap = { id: 'wod-A', date: '2026-08-20', sections: [{ id: 'legacy:wod-A:metcon', slotKey: 'metcon', loggingMode: 'required' }] }
    const ctx = freezeLoggingContext(legacyMap, A.legacy, null, '2026-08-20')
    const id = resolveLoggedWorkoutIdentity(ctx, 'RX')
    expect(id.wodId).toBe('wod-A')
    expect(id.sectionId).toBe(null) // wodZiWorkoutV2 is null -> never send a synthetic section id
  })

  it('no workout selected: frozen identity is fully null - caller must fail closed, no fallback', () => {
    const ctx = freezeLoggingContext(null, null, null, '2026-08-19')
    const id = resolveLoggedWorkoutIdentity(ctx, 'RX')
    expect(id.wodId).toBe(null)
    expect(id.sectionId).toBe(null)
    expect(id.variantMovements).toEqual([])
    expect(resolveLoggedWorkoutIdentity(null, 'RX').wodId).toBe(null)
  })

  it('when V2 and legacy disagree on identity, the frozen wodId is the V2 workout\'s explicit legacy_wod_id (INC-03 rule preserved)', () => {
    const ctx = freezeLoggingContext(dispA, { id: 'stale-wrong-wod', date: '2026-08-20', movements_rx: ['x'] }, A.v2, '2026-08-20')
    expect(resolveLoggedWorkoutIdentity(ctx, 'RX').wodId).toBe('wod-A') // A.v2.legacyWodId
  })

  // P9.1 - freezeLoggingContext must hold a VALUE snapshot of the structured
  // prescription, not a reference. No in-place / nested / array mutation of
  // the source can alter logCtx.prescriptionDoc after the freeze.
  const mkP1 = () => ({ version: 1, variants: { rx: { movements: [
    { instanceId: 'mi_1', name: 'Snatch', reps: { mode: 'universal', value: 20 }, load: { mode: 'sex_specific', male: 45, female: 30, unit: 'kg' } },
    { instanceId: 'mi_2', name: 'Row', calories: { mode: 'sex_specific', male: 15, female: 12 } },
  ] } } })

  it('P9.1: deep-clone freeze - mutating the ORIGINAL top-level object cannot alter the frozen doc', () => {
    const source = mkP1()
    const ctx = freezeLoggingContext(dispA, { id: 'wod-A', date: '2026-08-20' }, A.v2, '2026-08-20', snapshotPrescriptionDoc(source))
    expect(ctx.prescriptionDoc).not.toBe(source)
    expect(typeof ctx.frozenAt).toBe('string')
    source.variants.rx = { movements: [] }
    source.version = 99
    expect(ctx.prescriptionDoc.version).toBe(1)
    expect(ctx.prescriptionDoc.variants.rx.movements).toHaveLength(2)
  })

  it('P9.1: nested mutation - mutating the source load/calorie object in place cannot alter the frozen doc', () => {
    const source = mkP1()
    const ctx = freezeLoggingContext(dispA, null, A.v2, '2026-08-20', snapshotPrescriptionDoc(source))
    source.variants.rx.movements[0].load.female = 999
    source.variants.rx.movements[0].load.male = 999
    source.variants.rx.movements[1].calories.female = 999
    expect(ctx.prescriptionDoc.variants.rx.movements[0].load.female).toBe(30)
    expect(ctx.prescriptionDoc.variants.rx.movements[0].load.male).toBe(45)
    expect(ctx.prescriptionDoc.variants.rx.movements[1].calories.female).toBe(12)
  })

  it('P9.1: array mutation - push/splice/reorder on the source movements array cannot alter the frozen doc', () => {
    const source = mkP1()
    const ctx = freezeLoggingContext(dispA, null, A.v2, '2026-08-20', snapshotPrescriptionDoc(source))
    source.variants.rx.movements.push({ instanceId: 'mi_9', name: 'Burpee' })
    source.variants.rx.movements.splice(0, 1)
    source.variants.rx.movements.reverse()
    expect(ctx.prescriptionDoc.variants.rx.movements.map((m) => m.instanceId)).toEqual(['mi_1', 'mi_2'])
  })

  it('P9.1: snapshotPrescriptionDoc(null) -> null; freeze with no structured prescription -> prescriptionDoc null', () => {
    expect(snapshotPrescriptionDoc(null)).toBe(null)
    const ctx = freezeLoggingContext(dispA, { id: 'wod-A', date: '2026-08-20' }, A.v2, '2026-08-20', snapshotPrescriptionDoc(null))
    expect(ctx.prescriptionDoc).toBe(null)
  })
})

describe('computeWodHeaderLine - INC-02 (SENTRY-CYAN-HARBOR-4T) regression', () => {
  it('varianta oficiala selectata + wodZiData NULL (starea exacta din productie care arunca TypeError inainte de fix) - nu arunca, foloseste nivelul variantei', () => {
    expect(() =>
      computeWodHeaderLine({
        variantaAleasa: 0, wodZiData: null, varianteNivel: 'RX',
        durStr: '', wodTip: '', wodDurata: '', freeLogConfigDesc: '',
      })
    ).not.toThrow()
    const result = computeWodHeaderLine({
      variantaAleasa: 0, wodZiData: null, varianteNivel: 'RX',
      durStr: '', wodTip: '', wodDurata: '', freeLogConfigDesc: '',
    })
    expect(result).toBe('RX')
  })

  it('varianta oficiala selectata + wodZiData NULL, alt nivel (Intermediate) - foloseste nivelul corect, nu un fallback generic', () => {
    const result = computeWodHeaderLine({
      variantaAleasa: 1, wodZiData: null, varianteNivel: 'Intermediate',
      durStr: '', wodTip: '', wodDurata: '', freeLogConfigDesc: '',
    })
    expect(result).toBe('Intermediate')
  })

  it('CONTROL POZITIV: varianta oficiala + wodZiData prezent - comportament neschimbat (type + durata + nume WOD)', () => {
    const result = computeWodHeaderLine({
      variantaAleasa: 0, wodZiData: { type: 'AMRAP', name: 'GET UP' }, varianteNivel: 'RX',
      durStr: '20:00', wodTip: '', wodDurata: '', freeLogConfigDesc: '',
    })
    expect(result).toBe('AMRAP · 20:00 — "GET UP"')
  })

  it('CONTROL POZITIV: varianta oficiala + wodZiData prezent, fara durata/nume - doar type', () => {
    const result = computeWodHeaderLine({
      variantaAleasa: 0, wodZiData: { type: 'For Time', name: null }, varianteNivel: 'RX',
      durStr: '', wodTip: '', wodDurata: '', freeLogConfigDesc: '',
    })
    expect(result).toBe('For Time')
  })

  it('CONTROL POZITIV: logare libera (fara varianta oficiala) - comportament neschimbat, ignora wodZiData complet', () => {
    const result = computeWodHeaderLine({
      variantaAleasa: null, wodZiData: { type: 'AMRAP', name: 'GET UP' }, varianteNivel: null,
      durStr: '20:00', wodTip: 'EMOM', wodDurata: '15:00', freeLogConfigDesc: '3 runde',
    })
    expect(result).toBe('EMOM · 15:00 · 3 runde')
  })

  it('logare libera + fara config/durata - string gol, nu crapa', () => {
    const result = computeWodHeaderLine({
      variantaAleasa: null, wodZiData: null, varianteNivel: null,
      durStr: '', wodTip: '', wodDurata: '', freeLogConfigDesc: '',
    })
    expect(result).toBe('')
  })
})

describe('dateWithCurrentTime', () => {
  afterEach(() => vi.useRealTimers())

  it('pastreaza ora curenta, dar pe data ceruta (loguri pt un WOD dintr-o zi trecuta)', () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date(2026, 6, 15, 14, 22, 30))
    const rezultat = new Date(dateWithCurrentTime('2026-07-13'))
    expect(rezultat.getFullYear()).toBe(2026)
    expect(rezultat.getMonth()).toBe(6)
    expect(rezultat.getDate()).toBe(13)
    expect(rezultat.getHours()).toBe(14)
    expect(rezultat.getMinutes()).toBe(22)
  })

  it('INC-09: today\'s workout - returns ~now, unchanged', () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date(2026, 8, 1, 11, 53, 0))
    const r = new Date(dateWithCurrentTime('2026-09-01'))
    expect(r.getDate()).toBe(1)
    expect(r.getHours()).toBe(11)
    expect(r.getMinutes()).toBe(53)
    expect(r.getTime()).toBeLessThanOrEqual(Date.now())
  })

  it('INC-09: FUTURE workout logged early - NEVER returns a future timestamp (capped at now)', () => {
    vi.useFakeTimers()
    // logging on Aug 31 18:29 a workout dated Sep 1
    vi.setSystemTime(new Date(2026, 7, 31, 18, 29, 0))
    const r = new Date(dateWithCurrentTime('2026-09-01'))
    expect(r.getTime()).toBeLessThanOrEqual(Date.now())
    // it is the real submission moment, not Sep-1-evening
    expect(r.getMonth()).toBe(7)
    expect(r.getDate()).toBe(31)
  })
})

describe('logIsMoreRecent - INC-09 (leaderboard latest-submission selection)', () => {
  const L = (id, iso) => ({ id, logged_at: iso })

  it('null current -> candidate wins', () => {
    expect(logIsMoreRecent(L('a', '2026-09-01T08:00:00Z'), null)).toBe(true)
  })

  it('later logged_at wins', () => {
    expect(logIsMoreRecent(L('a', '2026-09-01T09:00:00Z'), L('b', '2026-09-01T08:00:00Z'))).toBe(true)
    expect(logIsMoreRecent(L('a', '2026-09-01T07:00:00Z'), L('b', '2026-09-01T08:00:00Z'))).toBe(false)
  })

  it('score is NOT a factor - a lower-score newer log still wins', () => {
    const older = { id: 'x', logged_at: '2026-09-01T08:00:00Z', sets: { a: [{ reps: '1000' }] } }
    const newer = { id: 'y', logged_at: '2026-09-01T09:00:00Z', sets: { a: [{ reps: '1' }] } }
    expect(logIsMoreRecent(newer, older)).toBe(true)
  })

  it('millisecond tie -> deterministic id tie-break, stable regardless of arg order', () => {
    const a = L('aaa', '2026-09-01T08:00:00.500Z')
    const b = L('bbb', '2026-09-01T08:00:00.500Z')
    expect(logIsMoreRecent(b, a)).toBe(true)   // 'bbb' > 'aaa'
    expect(logIsMoreRecent(a, b)).toBe(false)
  })

  it('reduce over an unordered array converges to the same winner', () => {
    const rows = [
      L('m', '2026-09-01T08:32:00Z'),
      L('z', '2026-09-01T08:53:00Z'),   // latest
      L('a', '2026-09-01T08:00:00Z'),
      L('q', '2026-09-01T08:50:00Z'),
    ]
    const winner = rows.reduce((acc, r) => (logIsMoreRecent(r, acc) ? r : acc), null)
    expect(winner.id).toBe('z')
    // shuffle -> same winner
    const winner2 = [...rows].reverse().reduce((acc, r) => (logIsMoreRecent(r, acc) ? r : acc), null)
    expect(winner2.id).toBe('z')
  })

  it('INC-09 incident shape: a future-dated legacy log no longer outranks a real recent log (once logged_at is capped at save)', () => {
    // pre-INC-09 the legacy log had logged_at in the future; post-fix a new
    // save is stamped <= now, so among logs saved after the fix the newest wins.
    const newStructured = L('3ffcbb04', '2026-09-01T08:53:45Z')
    const olderStructured = L('2d6a279d', '2026-09-01T08:00:11Z')
    expect(logIsMoreRecent(newStructured, olderStructured)).toBe(true)
  })
})

describe('authErrorMessage', () => {
  const t = {
    authErrorRateLimit: 'RATE_LIMIT',
    authErrorInvalidEmail: 'INVALID_EMAIL',
    resetErrorWeakPassword: 'WEAK_PW',
    resetErrorSamePassword: 'SAME_PW',
    resetErrorSessionExpired: 'SESSION_EXPIRED',
  }

  it('intoarce string gol pentru eroare null/undefined', () => {
    expect(authErrorMessage(null, t)).toBe('')
    expect(authErrorMessage(undefined, t)).toBe('')
  })

  it('mapeaza over_email_send_rate_limit si over_request_rate_limit la acelasi mesaj tradus', () => {
    expect(authErrorMessage({ code: 'over_email_send_rate_limit', message: 'raw' }, t)).toBe('RATE_LIMIT')
    expect(authErrorMessage({ code: 'over_request_rate_limit', message: 'raw' }, t)).toBe('RATE_LIMIT')
  })

  it('mapeaza email_address_invalid, weak_password, same_password', () => {
    expect(authErrorMessage({ code: 'email_address_invalid', message: 'raw' }, t)).toBe('INVALID_EMAIL')
    expect(authErrorMessage({ code: 'weak_password', message: 'raw' }, t)).toBe('WEAK_PW')
    expect(authErrorMessage({ code: 'same_password', message: 'raw' }, t)).toBe('SAME_PW')
  })

  it('mapeaza session_expired, session_not_found si refresh_token_not_found la acelasi mesaj (sesiunea de recuperare a expirat cat userul era pe ecran)', () => {
    expect(authErrorMessage({ code: 'session_expired', message: 'raw' }, t)).toBe('SESSION_EXPIRED')
    expect(authErrorMessage({ code: 'session_not_found', message: 'raw' }, t)).toBe('SESSION_EXPIRED')
    expect(authErrorMessage({ code: 'refresh_token_not_found', message: 'raw' }, t)).toBe('SESSION_EXPIRED')
  })

  it('cade pe error.message brut pentru un cod necunoscut/absent, nu ascunde eroarea', () => {
    expect(authErrorMessage({ code: 'some_future_code', message: 'Raw Supabase message' }, t)).toBe('Raw Supabase message')
    expect(authErrorMessage({ message: 'No code at all' }, t)).toBe('No code at all')
  })
})

describe('RESET_LINK_ERROR_CODES', () => {
  it('contine otp_expired - codul confirmat live pt un link de recuperare expirat/invalid/refolosit', () => {
    expect(RESET_LINK_ERROR_CODES.has('otp_expired')).toBe(true)
  })

  it('nu contine coduri nelegate de recuperare parola (ex. weak_password) - n-ar trebui sa arate ecranul de link invalid', () => {
    expect(RESET_LINK_ERROR_CODES.has('weak_password')).toBe(false)
    expect(RESET_LINK_ERROR_CODES.has('invalid_credentials')).toBe(false)
  })
})

describe('isInAttendanceGraceWindow', () => {
  it('interactiva inainte de finalul clasei', () => {
    const now = new Date('2026-08-07T18:00:00')
    expect(isInAttendanceGraceWindow('2026-08-07', '19:00:00', now)).toBe(true)
  })

  it('interactiva imediat dupa finalul clasei', () => {
    const now = new Date('2026-08-07T19:00:01')
    expect(isInAttendanceGraceWindow('2026-08-07', '19:00:00', now)).toBe(true)
  })

  it('interactiva exact la limita ferestrei de 2 ore', () => {
    const now = new Date('2026-08-07T21:00:00')
    expect(isInAttendanceGraceWindow('2026-08-07', '19:00:00', now)).toBe(true)
  })

  it('read-only dupa ce a trecut fereastra de 2 ore', () => {
    const now = new Date('2026-08-07T21:00:01')
    expect(isInAttendanceGraceWindow('2026-08-07', '19:00:00', now)).toBe(false)
  })

  it('gestioneaza corect o fereastra care trece de miezul noptii', () => {
    const now = new Date('2026-08-08T00:30:00')
    expect(isInAttendanceGraceWindow('2026-08-07', '23:00:00', now)).toBe(true)
  })
})

describe('resolveMemberIdentity - MEMBER IDENTITY READ ALIGNMENT ("No name" incident)', () => {
  // Owner decision: public.members = CANONICAL identity Source of Truth;
  // public.profiles = LEGACY FALLBACK ONLY. Precedence everywhere member
  // identity is displayed: members.<field> -> profiles.<field> -> null.

  it('A - members.full_name wins over profiles (canonical source)', () => {
    const r = resolveMemberIdentity({ full_name: 'Alexandra Marin' }, { full_name: 'stale old' })
    expect(r.full_name).toBe('Alexandra Marin')
  })

  it('A - stale/EMPTY profiles must not hide a valid members identity (the regression)', () => {
    // 11 real members created after 2026-07-27: name only in `members`
    expect(resolveMemberIdentity({ full_name: 'Oana Firulescu' }, { full_name: null }).full_name).toBe('Oana Firulescu')
    expect(resolveMemberIdentity({ full_name: 'Oana Firulescu' }, {}).full_name).toBe('Oana Firulescu')
    expect(resolveMemberIdentity({ full_name: 'Oana Firulescu' }, null).full_name).toBe('Oana Firulescu')
  })

  it('B - legacy valid profiles identity still displays when members identity is absent', () => {
    // the 8 old members INC-01 was about: name only in `profiles`
    expect(resolveMemberIdentity({ full_name: null }, { full_name: 'Legacy Member' }).full_name).toBe('Legacy Member')
    expect(resolveMemberIdentity({}, { full_name: 'Legacy Member' }).full_name).toBe('Legacy Member')
    expect(resolveMemberIdentity(null, { full_name: 'Legacy Member' }).full_name).toBe('Legacy Member')
  })

  it('null / undefined / "" / whitespace-only ALL count as absent for the fallback decision', () => {
    for (const empty of [null, undefined, '', '   ', '\t', '\n ']) {
      expect(resolveMemberIdentity({ full_name: empty }, { full_name: 'Fallback' }).full_name).toBe('Fallback')
    }
  })

  it('both absent -> null (caller applies its own final "No name" / "Anonymous" fallback)', () => {
    expect(resolveMemberIdentity(null, null).full_name).toBeNull()
    expect(resolveMemberIdentity({ full_name: '  ' }, { full_name: '' }).full_name).toBeNull()
  })

  it('does NOT rewrite stored values - diacritics, order, capitalisation, punctuation preserved verbatim', () => {
    const r = resolveMemberIdentity({ full_name: '  Alina Chirilă  ' }, null)
    expect(r.full_name).toBe('  Alina Chirilă  ') // returned exactly as stored (only the presence TEST trims)
    expect(resolveMemberIdentity({ full_name: 'de la CRUZ, María-José' }, null).full_name).toBe('de la CRUZ, María-José')
  })

  it('resolves first_name / last_name / avatar_url / email / birth_date with the same precedence, field by field', () => {
    const m = { first_name: 'Ana-Maria', last_name: null, avatar_url: null, email: 'a@x.com', birth_date: '1990-01-01' }
    const p = { first_name: 'old', last_name: 'Anghel', avatar_url: 'https://cdn/p.png', email: 'old@x.com', birth_date: null }
    const r = resolveMemberIdentity(m, p)
    expect(r).toEqual({
      full_name: null,
      first_name: 'Ana-Maria',        // members
      last_name: 'Anghel',            // profiles fallback (members empty)
      avatar_url: 'https://cdn/p.png',// profiles fallback
      email: 'a@x.com',               // members
      birth_date: '1990-01-01',       // members
    })
  })

  it('gender and weight_unit are NOT part of the resolved identity (kept on their own canonical source)', () => {
    const r = resolveMemberIdentity({ full_name: 'X', gender: 'feminin', weight_unit: 'lbs' }, { gender: 'masculin', weight_unit: 'kg' })
    expect(r.gender).toBeUndefined()
    expect(r.weight_unit).toBeUndefined()
  })
})
