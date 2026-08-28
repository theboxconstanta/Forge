import { describe, it, expect, vi, afterEach } from 'vitest'
import {
  todayLocalStr, dateWithCurrentTime, localDayBoundsUTC, computeWodHeaderLine, resolveWodIdForLog, addMonthsClamped, daysUntil, levenshtein, urlBase64ToUint8Array,
  fmt, secToTime, timeToSec, convertWeight, formatPR, getInitiale, parseWodMinute, formatWodDurata,
  authErrorMessage, RESET_LINK_ERROR_CODES, isInAttendanceGraceWindow,
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
