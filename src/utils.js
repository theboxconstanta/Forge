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
  const at = new Date(y, m - 1, d, now.getHours(), now.getMinutes(), now.getSeconds(), now.getMilliseconds())
  // INC-09 - never return a timestamp in the FUTURE. The intent here is to
  // attribute a log to the workout's business date when that date is today or
  // PAST (member forgot to log yesterday, logs today - `at` is already <= now,
  // unchanged). But logging a FUTURE-dated workout early would otherwise stamp
  // `logged_at` ahead of real time, and the leaderboard's "latest submission"
  // dedup (logIsMoreRecent) would then let that future-dated log outrank every
  // genuinely later re-log. Cap at now: an early future-workout log gets its
  // real submission time; leaderboard membership uses wod_id, not logged_at.
  return (at.getTime() > now.getTime() ? now : at).toISOString()
}

// INC-09 - deterministic "is `candidate` a more recent submission than
// `current`?" for the leaderboard's per-member / representative-log selection.
// `logged_at` is the recency key (never in the future - see dateWithCurrentTime).
// A millisecond tie breaks on `id` so the selection is STABLE across refetches
// regardless of the order the DB returns rows in (the leaderboard query has no
// ORDER BY). Score is NOT a factor - the contract is latest submission, not
// best result.
export function logIsMoreRecent(candidate, current) {
  if (!current) return true
  const tc = new Date(candidate?.logged_at || 0).getTime()
  const tk = new Date(current?.logged_at || 0).getTime()
  if (tc !== tk) return tc > tk
  return String(candidate?.id || '') > String(current?.id || '')
}

// Limitele unei zile LOCALE (00:00:00.000 -> 23:59:59.999), convertite in
// ISO UTC - pentru filtre .gte()/.lte() pe coloane timestamptz (logged_at/
// created_at) cand se cauta "tot ce s-a intamplat in ziua X". NU trimite
// direct `${dateStr}T00:00:00` ca string catre Supabase - PostgREST/
// Postgres il interpreteaza in fusul orar al sesiunii (UTC), nu local
// (verificat live: sesiunea DB ruleaza in UTC) - acelasi bug de fond ca
// todayLocalStr() de mai sus, dar manifestat la interogare (un log/
// abonament creat intre miezul noptii local si ~2-3 dimineata aparea sub
// ziua GRESITA), nu la citirea "azi".
export function localDayBoundsUTC(dateStr) {
  const [y, m, d] = dateStr.split('-').map(Number)
  const start = new Date(y, m - 1, d, 0, 0, 0, 0)
  const end = new Date(y, m - 1, d, 23, 59, 59, 999)
  return { startUTC: start.toISOString(), endUTC: end.toISOString() }
}

// INC-02 (SENTRY-CYAN-HARBOR-4T) - textul de antet compus pt un log de WOD,
// extras din saveWodLog (App.jsx) exact ca sa fie testabil izolat. Bug real:
// wodZiData poate fi null chiar cand variantaAleasa !== null (fetchWodZi
// face setWodZiData(null) cand nu exista niciun WOD oficial pt data
// afisata, iar variantaAleasa - auto-selectata din usual_level cand WOD-ul
// EXISTA - nu se reseteaza cand acesta dispare ulterior, ex. navigare la
// alta zi sau sesiune PWA lasata deschisa peste miezul noptii). Accesarea
// neconditionata a wodZiData.type arunca TypeError si oprea salvarea
// INAINTE sa ajunga la Supabase. Cand nu exista wodZiData, singura
// informatie reala disponibila e nivelul variantei alese (varianteNivel).
// Yesterday-WOD forensic fix - `wod_logs`/`skill_logs.wod_id` trebuie
// mereu sa refere `wods.id` (legacy), niciodata `workouts.id` (Engine
// V2 - alt tabel). Cand exista deja un rand V2 real (wodZiWorkoutV2),
// sursa corecta e coloana lui `legacy_wod_id` - aceeasi valoare pe care
// snapshot_wod_log_context()/echivalentul pt skill_logs o verifica
// server-side impotriva workout_section_id-ului trimis. O interogare
// SEPARATA a `wods` dupa data afisata (wodZiData?.id) poate diverge de
// workouts.legacy_wod_id daca cele doua tabele au ajuns nesincronizate
// pt aceeasi zi (gasit live: exact un WOD, dintre 45, cu workouts.date
// si wods.date la o zi distanta pt acelasi legacy_wod_id) - trimiterea
// unui workout_section_id real cu un wod_id derivat separat (si gresit)
// era respinsa de trigger cu "workout_section_id X does not belong to
// wod_id Y", oprind salvarea DUPA ce cererea ajungea deja la Supabase.
export function resolveWodIdForLog(wodZiWorkoutV2, wodZiData) {
  return wodZiWorkoutV2?.legacyWodId ?? wodZiData?.id ?? null
}

// INC-04 - request-currency guard for the two independent workout fetches
// (fetchWodZi / fetchWodZiWorkoutV2). Both resolve async and unconditionally
// call setWodZiData / setWodZiWorkoutV2. When the member navigates fast
// (Home tab -> historical date chip -> "Log Score"), an in-flight fetch for
// the PREVIOUS date (usually today, started when the Home tab mounted) can
// resolve AFTER the newly-selected date's fetch and overwrite wodZiData /
// wodZiWorkoutV2 with the wrong day's workout - so the Log Score screen (and
// resolveWodIdForLog, which prefers wodZiWorkoutV2.legacyWodId) end up bound
// to today instead of the explicitly-selected historical workout.
// A fetch's result is only applied when the date it was issued for is still
// the selected date. Stale responses are discarded (never fall back to
// today - see the null handling in the callers).
export function isWorkoutFetchCurrent(fetchedForDate, currentSelectedDate) {
  return fetchedForDate != null && fetchedForDate === currentSelectedDate
}

// INC-04 FINAL - request-currency for the Home workout fetches, strengthened
// beyond date equality. The same date can be requested several times over
// (the [dataAcasa] effect on selection, the realtime `wods` handler, a
// visibility/focus refresh, and rapid A -> B -> A chip taps), so an OLDER
// response whose date happens to match the current selection must still lose
// to the newest in-flight request. Each fetch captures a monotonically
// increasing sequence number at issue time; a response commits only if its
// sequence is still the latest AND its date is still the selected one.
export function homeWorkoutResponseIsCurrent({ requestSeq, latestSeq, requestDate, selectedDate }) {
  return requestSeq === latestSeq && isWorkoutFetchCurrent(requestDate, selectedDate)
}

// INC-04 GLOBAL - freeze the identity of the workout currently displayed, at
// the exact moment the member presses "Log Score" / Skill "Log". The whole
// logging session (display + save) then derives EVERY identity-bearing value
// from this snapshot, never from the live wodZiData/wodZiWorkoutV2/dataAcasa
// which can drift afterward (the [screen] effect resets dataAcasa to today on
// Home; date fetches resolve async; effects clear state). Generic - no date,
// workout, variant, or section is special-cased.
//
//   displayedWorkout  = workoutForDisplay (wodZiWorkoutV2 || legacy map)
//   wodZiData         = the legacy `wods` row currently loaded (or null)
//   wodZiWorkoutV2    = the Engine V2 `workouts` row currently loaded (or null)
//   businessDate      = dataAcasa (the date label the member sees)
//
// The snapshot deep-freezes nothing (React state is treated as immutable by
// convention) but it captures the object REFERENCES at click time, so a later
// setWodZiData/setWodZiWorkoutV2 cannot change what the logger sees.
export function freezeLoggingContext(displayedWorkout, wodZiData, wodZiWorkoutV2, businessDate, snapshotDoc) {
  const sections = displayedWorkout?.sections || []
  return {
    businessDate: businessDate ?? null,
    wodZiData: wodZiData ?? null,
    wodZiWorkoutV2: wodZiWorkoutV2 ?? null,
    workout: displayedWorkout ?? null,
    // P9.1 - a deep VALUE SNAPSHOT of the structured per-movement prescription
    // document (canonical typed contract v1), taken at "Log Score" click.
    // Structurally independent from mutable workout/editor/member state: after
    // this returns, no in-place / nested / array mutation of the source wods
    // row can alter logCtx.prescriptionDoc. The caller passes the deep clone
    // (prescriptionContract.snapshotPrescriptionDoc) - a plain reference is
    // deliberately NOT accepted here. The log snapshot is built from THIS,
    // never re-read from live wodZiData at submit. null when the workout has no
    // structured prescription (legacy fallback path).
    prescriptionDoc: snapshotDoc ?? null,
    // wall-clock instant the logging target was frozen (recorded on the
    // snapshot so a later reader knows when this member's prescription was
    // resolved).
    frozenAt: new Date().toISOString(),
    // the metcon (primary) section of the CLICKED workout
    primarySection: sections.find((s) => s.slotKey === 'metcon') || null,
    supportingSections: sections.filter((s) => s.slotKey !== 'metcon'),
    // independently-scored non-primary sections - only when a real Engine V2
    // row is loaded (synthetic legacy section ids must never be saved)
    additionalScoredSections: wodZiWorkoutV2
      ? sections.filter((s) => s.slotKey !== 'metcon' && s.loggingMode === 'required')
      : [],
  }
}

// INC-04 GLOBAL - the exact wod_logs identity for an official-variant save,
// derived ONLY from a frozen logging context. Returns null-ish fields when the
// context is incomplete so the caller fails closed (never a today / first-RX
// fallback). `variantLevel` is e.g. 'RX' | 'Intermediate' | 'Beginner' | 'OnRamp'.
export function resolveLoggedWorkoutIdentity(logCtx, variantLevel) {
  if (!logCtx) return { wodId: null, sectionId: null, businessDate: null, variantMovements: [] }
  const wodId = resolveWodIdForLog(logCtx.wodZiWorkoutV2, logCtx.wodZiData)
  const sectionId = logCtx.wodZiWorkoutV2 ? (logCtx.primarySection?.id ?? null) : null
  const key = variantLevel ? `movements_${String(variantLevel).toLowerCase()}` : null
  const variantMovements = (key && logCtx.wodZiData?.[key]) || []
  return { wodId, sectionId, businessDate: logCtx.businessDate ?? null, variantMovements }
}

export function computeWodHeaderLine({ variantaAleasa, wodZiData, varianteNivel, durStr, wodTip, wodDurata, freeLogConfigDesc }) {
  if (variantaAleasa !== null) {
    if (wodZiData) {
      return `${wodZiData.type}${durStr ? ' · ' + durStr : ''}${wodZiData.name ? ' — "' + wodZiData.name + '"' : ''}`
    }
    return varianteNivel
  }
  return `${wodTip}${wodDurata ? ' · ' + wodDurata : ''}${freeLogConfigDesc ? ' · ' + freeLogConfigDesc : ''}`
}

// Class Operations - Instant Coach Check-in: atendanta ramane editabila pana
// la ora de final a clasei + 2 ore (aceeasi fereastra de gratie ca
// forge-admin-web's isInAttendanceGraceWindow, portata disciplinat aici -
// cele doua repo-uri nu au niciun mecanism de cod comun). `${date}T${endTime}`
// se interpreteaza ca ora LOCALA (acelasi mod in care restul codebase-ului
// combina date+timp, ex. adminAdaugaInClasa mai jos in App.jsx), nu UTC.
export const ATTENDANCE_GRACE_WINDOW_MS = 2 * 60 * 60 * 1000
export function isInAttendanceGraceWindow(date, endTime, now = new Date()) {
  return now.getTime() <= new Date(`${date}T${endTime}`).getTime() + ATTENDANCE_GRACE_WINDOW_MS
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

// MEMBER IDENTITY READ ALIGNMENT ("No name" incident) - the ONE precedence
// rule for every surface that DISPLAYS a member's identity.
//
// Member Domain (migration 20260727100000_member_domain_identity_bridge_
// retirement) makes `public.members` the CANONICAL identity Source of Truth;
// `public.profiles` identity fields are LEGACY FALLBACK ONLY. INC-01 had
// switched 6 display read sites members->profiles because members.full_name was
// then stale for 8 old members - but that broke every member created after
// 2026-07-27 whose name self-signup / onboarding writes ONLY to `members`
// (11 real production members showed "No name" in Admin). The correct rule is
// not "read profiles" but "members first, profiles as fallback":
//
//   members.<field>  ->  profiles.<field>  ->  null  (caller's final fallback)
//
// null / undefined / '' / whitespace-only ALL count as absent for the fallback
// decision. Stored values are returned VERBATIM - this never trims, reorders,
// re-capitalises or otherwise rewrites a name; only the presence TEST trims.
//
// Scope: DISPLAY IDENTITY only - full_name, first_name, last_name, avatar_url,
// email, birth_date. Two fields are deliberately NOT resolved here and stay on
// their own established canonical source, passed through by callers unchanged:
//   - gender      -> canonically `members.gender` (P0-02), no profiles fallback
//   - weight_unit -> a member PREFERENCE, historically canonical on `profiles`
//                    (see fetchUserProfile) - not touched by this alignment
export function resolveMemberIdentity(member, profile) {
  const present = (v) => (typeof v === 'string' ? v.trim() !== '' : v != null)
  const pick = (field) => {
    if (present(member?.[field])) return member[field]
    if (present(profile?.[field])) return profile[field]
    return null
  }
  return {
    full_name: pick('full_name'),
    first_name: pick('first_name'),
    last_name: pick('last_name'),
    avatar_url: pick('avatar_url'),
    email: pick('email'),
    birth_date: pick('birth_date'),
  }
}

export function getInitiale(name) {
  if (!name) return '??'
  return name.split(' ').map(w => w[0]).join('').slice(0, 2).toUpperCase()
}

// Home Dashboard Visual Redesign (HOME_DASHBOARD_UI_REDESIGN_REPORT.md) -
// display-only name formatting for the class-detail roster ("Stelian P."
// instead of the full name) - never touches the underlying member.full_name
// data, purely how one component renders it.
export function formatFirstNameLastInitial(fullName) {
  if (!fullName) return ''
  const parts = fullName.trim().split(/\s+/)
  if (parts.length < 2) return parts[0] || ''
  return `${parts[0]} ${parts[parts.length - 1][0]}.`
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

// CLASS COLOR - Home "Today schedule" class-card time block.
//
// classes.color is an Admin-chosen value (the New Class picker emits a hex
// string from a fixed palette, or null). These pure helpers turn it into a
// CSS-safe background + a readable foreground WITHOUT ever mutating or
// normalising the stored value.

export const CLASS_COLOR_DEFAULT_BG = '#111111'   // the historical hard-coded time-block background
export const CLASS_COLOR_FG_LIGHT = '#FFFFFF'     // COLORS.text.inverse - light foreground
export const CLASS_COLOR_FG_DARK = '#0E0E0E'      // COLORS.text.primary - dark foreground

// Parse a #RGB / #RRGGBB hex string (case-insensitive, surrounding space
// tolerated) to {r,g,b} 0-255. Anything else -> null (not a usable colour).
export function parseHexColor(input) {
  if (typeof input !== 'string') return null
  const m = /^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/.exec(input.trim())
  if (!m) return null
  let h = m[1]
  if (h.length === 3) h = h[0] + h[0] + h[1] + h[1] + h[2] + h[2]
  return { r: parseInt(h.slice(0, 2), 16), g: parseInt(h.slice(2, 4), 16), b: parseInt(h.slice(4, 6), 16) }
}

// Effective time-block background: a valid stored hex verbatim, else the
// historical default. null / undefined / '' / malformed / legacy -> '#111111'
// (so the overwhelming majority of cards render exactly as before).
export function resolveClassColor(color) {
  return parseHexColor(color) ? color.trim() : CLASS_COLOR_DEFAULT_BG
}

// WCAG 2.x relative luminance of an {r,g,b}.
function relLuminance({ r, g, b }) {
  const lin = (c) => {
    const s = c / 255
    return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4)
  }
  return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b)
}

// WCAG contrast ratio between two {r,g,b} (order-independent), 1..21.
export function contrastRatio(a, b) {
  const l1 = relLuminance(a)
  const l2 = relLuminance(b)
  return (Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05)
}

// Pick the more readable of the two approved FORGE foreground tokens for a
// given background. General luminance/contrast rule - NO per-colour special
// cases. A malformed background resolves to the default first, so it always
// yields the same foreground the default time block uses today ('#FFFFFF').
export function getReadableTextColor(background) {
  const bg = parseHexColor(background) || parseHexColor(CLASS_COLOR_DEFAULT_BG)
  const cLight = contrastRatio(bg, parseHexColor(CLASS_COLOR_FG_LIGHT))
  const cDark = contrastRatio(bg, parseHexColor(CLASS_COLOR_FG_DARK))
  return cDark > cLight ? CLASS_COLOR_FG_DARK : CLASS_COLOR_FG_LIGHT
}

// P0 UI refinement (WORKOUT_VARIANT_UI_REFINEMENT_REPORT.md) - canonical
// color per scaling level, single source of truth for the dot AND the
// Home accordion's own text/border color (VARIANTE_CONFIG.culoare in
// App.jsx), which previously used a third, different set of hex values -
// having the dot and the label next to it disagree on RX's exact shade of
// orange read as sloppy, not premium. Chosen to read clearly as their
// named hue (true orange/yellow/green/blue) while staying legible as text
// on a white card, not just as a small dot.
export const NIVEL_DOT_COLORS = { RX: '#EA580C', Intermediate: '#D97706', Beginner: '#16A34A', OnRamp: '#2563EB' }

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
