// Funcții pure, fără dependințe de React/Supabase - testabile izolat.
// Nu importa nimic din App.jsx aici (ar readuce dependința de Supabase).

// Locale pentru toLocaleDateString/Intl.DateTimeFormat, dupa limba aleasa de
// user (vezi src/translations.js). Nu exista alte limbi in afara de ro/en
// momentan, deci orice altceva cade pe ro-RO (fallback, nu presupunere).
export function localeFor(lang) {
  return lang === 'en' ? 'en-US' : 'ro-RO'
}

// Data de azi in fusul orar LOCAL, ca string YYYY-MM-DD. NU folosi
// new Date().toISOString().split('T')[0] pentru asta - e ora UTC, care in
// Romania (UTC+2/+3) e in urma cu ora locala intre miezul noptii si ~2-3
// dimineata, ducand la comparatii de data gresite exact in acel interval
// (abonamente/clase tratate ca "de maine" sau "expirate cu o zi in avans").
export function todayLocalStr() {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

// Combina o data (YYYY-MM-DD, in fusul local) cu ora CURENTA - pentru loguri
// de WOD care se refera la o zi trecuta (membru care a uitat sa loge ieri/
// alaltaieri, navigheaza pe Acasa la acea zi si logheaza azi). Bug real
// raportat: log_logs.logged_at cadea pe DEFAULT now() la insert (nesetat
// explicit), deci logarea unui WOD prescris ieri aparea in Jurnal/Clasament
// la ZIUA CURENTA, nu la ziua WOD-ului ales - desi wod_id chiar era cel
// corect. Pastram ora curenta (nu miezul noptii) ca sa ramana o ordonare
// sensibila intre mai multi membri care logheaza in aceeasi zi trecuta.
export function dateWithCurrentTime(dateStr) {
  const [y, m, d] = dateStr.split('-').map(Number)
  const now = new Date()
  return new Date(y, m - 1, d, now.getHours(), now.getMinutes(), now.getSeconds(), now.getMilliseconds()).toISOString()
}

// Adauga `months` luni calendaristice la `startDate`, pastrand aceeasi zi a
// lunii - si daca luna tinta nu are acea zi (ex: 31 ianuarie + 1 luna),
// clampeaza la ultima zi a lunii tinta (28/29 februarie), in loc sa lase
// Date.setMonth() sa "reverse" in luna urmatoare (31 ian + 1 luna ar deveni
// altfel 2/3 martie, nu 28 februarie). Nu muta `startDate` primit.
export function addMonthsClamped(startDate, months) {
  const pad = n => String(n).padStart(2, '0')
  const endDate = new Date(startDate)
  const targetMonth = endDate.getMonth() + months
  endDate.setMonth(targetMonth)
  if (endDate.getMonth() !== ((targetMonth % 12) + 12) % 12) endDate.setDate(0)
  return `${endDate.getFullYear()}-${pad(endDate.getMonth() + 1)}-${pad(endDate.getDate())}`
}

// Numarul de zile calendaristice de la azi (miezul noptii local) pana la
// `endDateStr` (YYYY-MM-DD), indiferent de ora curenta din zi. Poate fi
// negativ (data a trecut). Comparand ora curenta cu sfarsitul zilei de
// expirare (23:59:59) si rotunjind in sus se ajunge sa numere aproape o zi
// in plus fata de diferenta reala de zile calendaristice.
export function daysUntil(endDateStr) {
  const end = new Date(endDateStr + 'T00:00:00')
  const todayMidnight = new Date(new Date().toDateString())
  return Math.round((end - todayMidnight) / 86400000)
}

export function levenshtein(a, b) {
  const m = a.length, n = b.length
  const dp = Array.from({ length: m + 1 }, (_, i) => Array.from({ length: n + 1 }, (_, j) => i === 0 ? j : j === 0 ? i : 0))
  for (let i = 1; i <= m; i++) for (let j = 1; j <= n; j++)
    dp[i][j] = a[i-1] === b[j-1] ? dp[i-1][j-1] : 1 + Math.min(dp[i-1][j], dp[i][j-1], dp[i-1][j-1])
  return dp[m][n]
}

export function urlBase64ToUint8Array(base64String) {
  const padding = '='.repeat((4 - base64String.length % 4) % 4)
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/')
  const raw = atob(base64)
  return Uint8Array.from([...raw].map(c => c.charCodeAt(0)))
}

export function fmt(s) {
  const m = Math.floor(Math.abs(s) / 60)
  const sec = Math.abs(s) % 60
  return m + ':' + String(sec).padStart(2, '0')
}

export function secToTime(sec) {
  const s = Math.round(sec)
  const h = Math.floor(s / 3600)
  const m = Math.floor((s % 3600) / 60)
  const ss = s % 60
  if (h > 0) return `${h}:${String(m).padStart(2, '0')}:${String(ss).padStart(2, '0')}`
  return `${m}:${String(ss).padStart(2, '0')}`
}

export function timeToSec(str) {
  if (!str) return null
  const parts = String(str).trim().split(':').map(Number)
  if (parts.length === 3) return parts[0] * 3600 + parts[1] * 60 + parts[2]
  if (parts.length === 2) return parts[0] * 60 + parts[1]
  return parseFloat(str) || null
}

const KG_TO_LBS = 2.20462
export function convertWeight(value, fromUnit, toUnit) {
  if (value == null || fromUnit === toUnit) return value
  if (fromUnit === 'kg' && toUnit === 'lbs') return Math.round(value * KG_TO_LBS * 2) / 2
  if (fromUnit === 'lbs' && toUnit === 'kg') return Math.round(value / KG_TO_LBS * 2) / 2
  return value
}

export function formatPR(pr, preferredUnit) {
  if (pr.unit === 'timp') {
    if (!pr.value && pr.value !== 0) return '—'
    const v = String(pr.value)
    // valoare veche stocată ca "4:22" sau nouă ca secunde
    if (v.includes(':')) return v
    const sec = parseFloat(v)
    return isNaN(sec) ? v : secToTime(sec)
  }
  const isWeight = pr.unit === 'kg' || pr.unit === 'lbs'
  const unit = isWeight && preferredUnit ? preferredUnit : pr.unit
  const value = isWeight && preferredUnit ? convertWeight(pr.value, pr.unit, preferredUnit) : pr.value
  if (value && (pr.unit === 'm' || pr.unit === 'cal')) return `${value} ${pr.unit}` + (pr.time_result ? ` — ${pr.time_result}` : '')
  if (value && pr.reps) return `${value} ${unit} × ${pr.reps}rep`
  if (value) return `${value} ${unit}`
  if (pr.reps) return `${pr.reps} reps`
  return '—'
}

export function getInitiale(name) {
  if (!name) return '??'
  return name.split(' ').map(w => w[0]).join('').slice(0, 2).toUpperCase()
}

export function parseWodMinute(durataStr) {
  if (!durataStr) return null
  const match = durataStr.match(/(\d+)/)
  return match ? parseInt(match[1]) : null
}

export function formatWodDurata(durataStr) {
  if (!durataStr) return ''
  if (/^\d+:\d+$/.test(durataStr.trim())) return durataStr.trim()
  const mins = parseWodMinute(durataStr)
  return mins != null ? `${mins}:00` : durataStr
}

export const NIVEL_DOT_COLORS = { RX: '#E8591A', Intermediate: '#F0B429', Beginner: '#2FA84F', OnRamp: '#2F6FED' }

// Mapeaza codurile de eroare OFICIALE Supabase Auth (@supabase/auth-js
// error-codes.ts - error.code, nu potrivire fragila pe error.message) la
// mesaje traduse, pentru fluxul de resetare parola. Coduri necunoscute cad
// pe error.message brut (in engleza, netradus) - mai bine decat sa ascunda
// eroarea complet. Vezi si RESET_LINK_ERROR_CODES mai jos, pentru distinctia
// "linkul de recuperare e invalid/expirat" (ecran separat) fata de restul.
export function authErrorMessage(error, t) {
  if (!error) return ''
  const byCode = {
    over_email_send_rate_limit: t.authErrorRateLimit,
    over_request_rate_limit: t.authErrorRateLimit,
    email_address_invalid: t.authErrorInvalidEmail,
    weak_password: t.resetErrorWeakPassword,
    same_password: t.resetErrorSamePassword,
    session_expired: t.resetErrorSessionExpired,
    session_not_found: t.resetErrorSessionExpired,
    refresh_token_not_found: t.resetErrorSessionExpired,
  }
  return (error.code && byCode[error.code]) || error.message || ''
}

// Coduri intoarse de supabase.auth.initialize() cand URL-ul de la care a
// pornit sesiunea contine un link de recuperare parola invalid/deja
// folosit/expirat - Supabase redirectioneaza server-side cu
// #error=access_denied&error_code=otp_expired&... (verificat live, 07-18),
// nu cu un access_token fals - _getSessionFromURL() (auth-js) transforma
// asta intr-o eroare intoarsa de initialize(), mecanismul SDK oficial
// pentru acest caz (nicio detectie custom pe timeout). Aplicatia nu are
// alt flux care ar genera aceste coduri la incarcare (fara magic links,
// fara OAuth) - orice eroare de initializare cu unul din codurile astea
// inseamna sigur un link de recuperare esuat.
export const RESET_LINK_ERROR_CODES = new Set(['otp_expired', 'flow_state_not_found', 'flow_state_expired'])
