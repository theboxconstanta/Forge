// Results Phase 3 (RESULTS_PHASE_3_ATHLETE_CONTEXT_RX_STANDARD_ENGINE.md) -
// the Athlete Context & RX Standard Resolution Engine. Pure functions
// only, no Supabase/React - testable in isolation, ported to
// forge-admin-web as rxEngine.ts for cross-client consistency (same
// convention already used for benchmarkResolution/workoutMapping etc.
// across this session - a disciplined port, not a shared import, since
// the two repos are never bundled together).
//
// Architectural choice: standards are resolved AT READ TIME by parsing a
// movement's own free text, not pre-computed and stored on a "canonical"
// field. This mirrors the exact pattern already established by
// isNotRxd/weightMatches in workoutFormats.js ("Derivat la citire, nu
// stocat" - derived at read time, not stored, so a later correction to
// the prescribed weight never desyncs from a stale copy) - the "canonical
// workout metadata" the mission describes is achieved by having one
// reliable, tested parser that always derives the same structure from
// the same text, not by writing a second, potentially-stale source of
// truth. This also means the engine works immediately against ALL
// existing programming (which already embeds weight directly in movement
// text in most real cases - confirmed live, e.g. "20 Alternating Hang Db
// Snatches @ 15/22.5kg") with zero data migration required.

import { convertWeight } from './utils'

// ---------------------------------------------------------------------
// Athlete Context
// ---------------------------------------------------------------------

// profiles.gender/members.gender store Romanian values live in
// production ('masculin'/'feminin'), confirmed via direct query, and can
// be null (~11% of live members). Unlike the pre-existing
// weightKeyForVariant (workoutFormats.js), which silently treats any
// non-'feminin' value - including null/undefined - as male, this
// resolver returns null for an unset/unrecognized gender. A member Forge
// doesn't actually know the category of should fall back to seeing both
// standards (handled by callers checking for a null genderKey), never be
// silently assigned one - the "male by default" behavior in the existing
// helper was a real, disclosed bias this engine deliberately does not
// carry forward for its own new call sites.
export function resolveAthleteGenderKey(rawGender) {
  if (rawGender === 'feminin') return 'female'
  if (rawGender === 'masculin') return 'male'
  return null
}

// ---------------------------------------------------------------------
// Parser - extracts a structured {maleKg, femaleKg} standard from a
// movement's free text.
// ---------------------------------------------------------------------

// Guards against the exact live-data collision found during research:
// the same "NUM/NUM unit" shape is also used for box-jump height ("51/61
// cm") and calorie targets ("25/30-cal"), never a weight. Checked before
// any weight pattern is attempted.
function looksLikeNonWeightSlashPair(text) {
  return /\d+\s*\/\s*\d+\s*(cm|m|cal)\b/i.test(text) || /\d+(?:\.\d+)?\s*-\s*cal\b/i.test(text)
}

function normalizeUnit(raw) {
  return /^lb/i.test(raw) ? 'lbs' : 'kg'
}

function buildStandard(maleValue, femaleValue, unit) {
  if (maleValue == null && femaleValue == null) return null
  const toKg = (v) => (v == null ? null : (unit === 'lbs' ? convertWeight(v, 'lbs', 'kg') : v))
  return { maleKg: toKg(maleValue), femaleKg: toKg(femaleValue) }
}

const NUM = '(\\d+(?:\\.\\d+)?)'
const UNIT = '(kg|lbs?)'

// Ordered by specificity - symbol > labeled > plain slash (the plain
// slash pattern is the most ambiguous shape and must never shadow a more
// explicit one, e.g. "61kg (M) / 38kg (F)" must not fall through to the
// slash branch and lose the labels).
export function parseWeightStandardFromText(text) {
  if (!text || typeof text !== 'string') return null
  if (looksLikeNonWeightSlashPair(text)) return null

  // 1. Symbol notation: ♂NN / ♀NN, either order, unit optional (defaults
  //    to kg - CrossFit's international default and this gym's own
  //    100%-kg live usage - when no unit token is present at all).
  const maleSymbol = text.match(new RegExp(`♂\\s*${NUM}\\s*${UNIT}?`, 'i'))
  const femaleSymbol = text.match(new RegExp(`♀\\s*${NUM}\\s*${UNIT}?`, 'i'))
  if (maleSymbol || femaleSymbol) {
    const unit = normalizeUnit(maleSymbol?.[2] || femaleSymbol?.[2] || 'kg')
    return buildStandard(
      maleSymbol ? parseFloat(maleSymbol[1]) : null,
      femaleSymbol ? parseFloat(femaleSymbol[1]) : null,
      unit,
    )
  }

  // 2. Labeled notation - "NUM UNIT (LABEL)" or "LABEL NUM UNIT", any
  //    combination, searched independently per gender so either order
  //    ("61kg (M) / 38kg (F)" vs "38kg (F), 61kg (M)") resolves the same.
  const maleLabeled = text.match(new RegExp(`${NUM}\\s*${UNIT}\\s*\\(\\s*(?:m|male|men)\\s*\\)`, 'i'))
    || text.match(new RegExp(`\\b(?:men|male)\\b\\s*${NUM}\\s*${UNIT}`, 'i'))
  const femaleLabeled = text.match(new RegExp(`${NUM}\\s*${UNIT}\\s*\\(\\s*(?:f|female|women)\\s*\\)`, 'i'))
    || text.match(new RegExp(`\\b(?:women|female)\\b\\s*${NUM}\\s*${UNIT}`, 'i'))
  if (maleLabeled || femaleLabeled) {
    const unit = normalizeUnit(maleLabeled?.[2] || femaleLabeled?.[2] || 'kg')
    return buildStandard(
      maleLabeled ? parseFloat(maleLabeled[1]) : null,
      femaleLabeled ? parseFloat(femaleLabeled[1]) : null,
      unit,
    )
  }

  // 3. Plain slash notation, unlabeled: "38/61kg", "35/50lb", "20/30 kg",
  //    "61/38kg". Default affiliate convention per this mission's own
  //    explicit instruction: FEMALE / MALE, positionally, regardless of
  //    which number is larger - no magnitude-based guessing. This is a
  //    deliberate, literal reading: a "61/38kg" input (an unusual case
  //    where the first number is larger) still parses as femaleKg=61,
  //    maleKg=38 under this rule, exactly as instructed ("use heuristic
  //    fallback only when unlabeled" - the fallback itself never
  //    special-cases order by size).
  const slash = text.match(new RegExp(`${NUM}\\s*\\/\\s*${NUM}\\s*${UNIT}`, 'i'))
  if (slash) {
    const unit = normalizeUnit(slash[3])
    return buildStandard(parseFloat(slash[2]), parseFloat(slash[1]), unit)
  }

  return null
}

// ---------------------------------------------------------------------
// Resolver - the athlete's own single numeric standard, in kg, for one
// section's set of prescribed movements.
// ---------------------------------------------------------------------

function extractLeadingNumber(text) {
  const m = (text || '').replace(/\s+/g, '').match(/^(\d+(?:\.\d+)?)/)
  return m ? parseFloat(m[1]) : null
}

// One resolved, actionable standard, or an explicit signal that more
// than one distinct weighted movement was found (see
// resolveSectionStandardKg below for why that case can't be
// auto-classified against a single logged weight today).
const MULTI_MOVEMENT_STANDARD = 'multi'

// Scans every movement's own text for a parseable weight standard (the
// common case - most sections have zero or one weighted implement, with
// any others being bodyweight movements the parser correctly finds
// nothing in). Falls back to the legacy tier-level column
// (rx_weight_male/female or metadata.legacyWeights) only when no
// movement text yields a standard at all - covering workouts where a
// coach used the dedicated field instead of embedding the weight inline,
// which live data confirms both patterns exist.
//
// Returns: a number (kg) | null (no standard - never force Not Rx) |
// MULTI_MOVEMENT_STANDARD (more than one distinct weighted movement -
// wod_logs.weight_logged is a single field today, so there is no way to
// know which movement a member's one logged number refers to; callers
// must fall back to the existing string-match Not-RX'd mechanism for
// this case, disclosed as a real, deliberate scope boundary of this
// phase, not an oversight).
export function resolveSectionStandardKg({ movements, legacyWeightText, genderKey }) {
  if (!genderKey) return null

  const perMovementStandards = (movements || [])
    .map((m) => parseWeightStandardFromText(m))
    .filter(Boolean)

  if (perMovementStandards.length > 1) {
    const values = perMovementStandards.map((s) => (genderKey === 'female' ? s.femaleKg : s.maleKg))
    const distinct = new Set(values.filter((v) => v != null))
    if (distinct.size > 1) return MULTI_MOVEMENT_STANDARD
  }

  if (perMovementStandards.length > 0) {
    const kg = genderKey === 'female' ? perMovementStandards[0].femaleKg : perMovementStandards[0].maleKg
    if (kg != null) return kg
  }

  if (legacyWeightText) {
    return extractLeadingNumber(legacyWeightText)
  }

  return null
}

export function isMultiMovementStandard(standard) {
  return standard === MULTI_MOVEMENT_STANDARD
}

// ---------------------------------------------------------------------
// Classifier - the actual RX / Not RX decision.
// ---------------------------------------------------------------------

// enteredWeightText: whatever the athlete typed (any free text Forge
// already accepts, e.g. "65kg"). standardKg: resolveSectionStandardKg's
// own output for this athlete. athleteUnit: the athlete's own
// weight_unit ('kg'/'lbs') - the unit their entered number is assumed to
// be in, converted to kg before comparison so a kg-standard workout still
// classifies correctly for an lbs-preference athlete and vice versa.
//
// Rule, exactly as specified: enteredWeight >= athleteStandard => 'rx',
// else 'not_rx'. A standard of null/MULTI never forces 'not_rx' - it
// returns null (no classification), which callers render as "no live
// feedback" rather than as a false negative.
export function classifyRxStatus({ enteredWeightText, standardKg, athleteUnit }) {
  if (standardKg == null || isMultiMovementStandard(standardKg)) return null
  const entered = extractLeadingNumber(enteredWeightText)
  if (entered == null) return null
  const enteredKg = athleteUnit === 'lbs' ? convertWeight(entered, 'lbs', 'kg') : entered
  return enteredKg >= standardKg ? 'rx' : 'not_rx'
}

// ---------------------------------------------------------------------
// Workout rendering - replaces a dual "X/Ykg" (or any supported notation)
// substring inside a movement's own text with just the athlete's own
// resolved value, so a member only ever sees their own standard. Returns
// the original text unchanged whenever nothing parseable is found, or the
// athlete's gender is unknown (graceful degrade to today's dual display -
// never hides information Forge can't actually resolve).
// ---------------------------------------------------------------------

const ANY_STANDARD_SUBSTRING_RE = new RegExp(
  `(♂\\s*${NUM}\\s*${UNIT}?\\s*\\/?\\s*♀\\s*${NUM}\\s*${UNIT}?)` +
  `|(♀\\s*${NUM}\\s*${UNIT}?\\s*\\/?\\s*♂\\s*${NUM}\\s*${UNIT}?)` +
  `|(${NUM}\\s*${UNIT}\\s*\\(\\s*(?:m|male|men)\\s*\\)\\s*\\/?,?\\s*${NUM}\\s*${UNIT}\\s*\\(\\s*(?:f|female|women)\\s*\\))` +
  `|(${NUM}\\s*${UNIT}\\s*\\(\\s*(?:f|female|women)\\s*\\)\\s*\\/?,?\\s*${NUM}\\s*${UNIT}\\s*\\(\\s*(?:m|male|men)\\s*\\))` +
  `|(${NUM}\\s*\\/\\s*${NUM}\\s*${UNIT})`,
  'i',
)

export function resolveMovementDisplayText(text, genderKey) {
  if (!text || !genderKey) return text
  const standard = parseWeightStandardFromText(text)
  if (!standard) return text
  const kg = genderKey === 'female' ? standard.femaleKg : standard.maleKg
  if (kg == null) return text
  const match = text.match(ANY_STANDARD_SUBSTRING_RE)
  if (!match) return text
  const rounded = Number.isInteger(kg) ? kg : Math.round(kg * 10) / 10
  return text.slice(0, match.index) + `${rounded}kg` + text.slice(match.index + match[0].length)
}

// ---------------------------------------------------------------------
// Member-facing text cleanup (Redesign the Member Workout View, WOD-SIMPLE
// only - forge-admin-web has no member-facing display, so this is
// deliberately NOT ported there). movements_rx/etc store whatever text the
// AI parser or a coach produced verbatim (there is no separate "clean
// name" + "clean reps" + "clean weight" field - see PARSER_EDGE_CASES.md
// and this same free-text model resolveMovementDisplayText already relies
// on above) - some of that text carries the AI's own reasoning as
// parenthetical asides (ex. "(height not specified)", "(text gives no
// height here)") or repeats the same distance/weight twice in different
// notations (ex. "(61 m) ... 61m @ 22.5/15kg"). This is a best-effort
// display-time cleanup, not a real parser - it targets the concrete
// artifact patterns actually observed, it cannot guarantee every possible
// free-form AI phrasing. Call AFTER resolveMovementDisplayText (that
// function already collapses a male/female pair to one value; this one
// then removes a second, now-redundant restatement of that same value).
// -----------------------------------------------------------------------
// Un grup de paranteze echilibrat, cu maxim un nivel de imbricare (tiparul
// real observat - ex. "(deficit (height not specified))") - captureaza
// intreg grupul exterior ca sa poata fi eliminat DEODATA daca oriunde in
// interior apare un cuvant de debug, in loc sa lase parantezele exterioare
// goale/orfane in urma unei eliminari partiale doar a celei interioare.
const BALANCED_PAREN_RE = /\s*\(([^()]|\([^()]*\))*\)/g
const DEBUG_KEYWORDS_RE = /not specified|as above|text gives|performed as part of|scheme/i
const NUMERIC_TOKEN_RE = /(\d+(?:\.\d+)?)\s?(kg|lbs|m|cm|in)\b/gi

export function cleanMovementDisplayText(text) {
  if (!text) return text
  let out = text.replace(BALANCED_PAREN_RE, (match) => (DEBUG_KEYWORDS_RE.test(match) ? '' : match))
  const seen = new Set()
  out = out.replace(NUMERIC_TOKEN_RE, (match, num, unit) => {
    const key = `${parseFloat(num)}${unit.toLowerCase()}`
    if (seen.has(key)) return ''
    seen.add(key)
    return match
  })
  return out.replace(/\(\s*\)/g, '').replace(/@\s*$/, '').replace(/\s{2,}/g, ' ').replace(/\s+([.,)])/g, '$1').trim()
}
