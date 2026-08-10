// Deterministic scaling engine for Coach Quick Create Phase 1 (Automatic
// Variant Generation) - given a coach-finalized RX section, instantly
// produces Intermediate/Beginner/OnRamp variants via a movement
// substitution table + load/volume/time-cap reduction rules. Pure, no
// I/O, no React - same discipline as workoutIntelligence.js, required so
// generation is synchronous (fits the 30-second create-to-publish rule)
// and fully unit-testable.
//
// Faithful port of forge-admin-web's scalingEngine.ts (same repo pair as
// movements.js/movements.ts, wodSections.js/sectionEditing.ts) - kept
// manually in sync, not shared, per this codebase's own established
// cross-repo module boundary (no build-time link between the two apps).
//
// SCALING_SUBSTITUTIONS is a curated starting set, not exhaustive - any
// movement without an entry (or without a tier-specific entry) falls
// through to TIER_RULES[tier].defaultLoadRatio (name kept, load scaled).
// This is a disclosed, visible-in-the-UI degrade, not a silent gap -
// extending the table over time never requires an algorithm change.

export const TIER_RULES = {
  intermediate: { volumeReductionPct: 0.1, timeCapIncreasePct: 0.15, defaultLoadRatio: 0.8 },
  beginner: { volumeReductionPct: 0.2, timeCapIncreasePct: 0.3, defaultLoadRatio: 0.6 },
  onramp: { volumeReductionPct: 0.35, timeCapIncreasePct: 0.5, defaultLoadRatio: 0.5 },
}

// Keys are canonical singular movement names, matching movements.js's own
// MISCARI list casing exactly - lookup normalizes plurals (see
// normalizeMovementKey) so "Pull-ups"/"Deadlifts" in a logged line still
// match "Pull-up"/"Deadlift" here.
export const SCALING_SUBSTITUTIONS = {
  Deadlift: {
    onramp: { loadStrategy: 'fixed', fixedLoad: { male: 16, female: 12, unit: 'kg', implement: 'Kettlebell' } },
  },
  'Pull-up': {
    intermediate: { loadStrategy: 'bodyweight', substituteName: 'Jumping Pull-ups' },
    beginner: { loadStrategy: 'bodyweight', substituteName: 'Ring Rows' },
    onramp: { loadStrategy: 'bodyweight', substituteName: 'Ring Rows' },
  },
  'Chest to Bar Pull-up': {
    intermediate: { loadStrategy: 'bodyweight', substituteName: 'Pull-ups' },
    beginner: { loadStrategy: 'bodyweight', substituteName: 'Jumping Pull-ups' },
    onramp: { loadStrategy: 'bodyweight', substituteName: 'Ring Rows' },
  },
  'Muscle-up': {
    intermediate: { loadStrategy: 'bodyweight', substituteName: 'Chest to Bar Pull-ups' },
    beginner: { loadStrategy: 'bodyweight', substituteName: 'Jumping Pull-ups' },
    onramp: { loadStrategy: 'bodyweight', substituteName: 'Ring Rows' },
  },
  'Handstand Push-up': {
    intermediate: { loadStrategy: 'bodyweight', substituteName: 'Pike Push-ups' },
    beginner: { loadStrategy: 'bodyweight', substituteName: 'Box Push-ups' },
    onramp: { loadStrategy: 'bodyweight', substituteName: 'Push-ups' },
  },
  'Toes to Bar': {
    intermediate: { loadStrategy: 'bodyweight', substituteName: 'Knees to Elbows' },
    beginner: { loadStrategy: 'bodyweight', substituteName: 'Hanging Knee Raises' },
    onramp: { loadStrategy: 'bodyweight', substituteName: 'Sit-ups' },
  },
  'Double Under': {
    beginner: { loadStrategy: 'bodyweight', substituteName: 'Single Unders' },
    onramp: { loadStrategy: 'bodyweight', substituteName: 'Single Unders' },
  },
  'Box Jump': {
    beginner: { loadStrategy: 'bodyweight', substituteName: 'Box Step-ups' },
    onramp: { loadStrategy: 'bodyweight', substituteName: 'Box Step-ups' },
  },
  'Rope Climb': {
    intermediate: { loadStrategy: 'bodyweight', substituteName: 'Rope Climbs (from seated)' },
    beginner: { loadStrategy: 'bodyweight', substituteName: 'Rope Pulls (standing)' },
    onramp: { loadStrategy: 'bodyweight', substituteName: 'Ring Rows' },
  },
  'Ring Dip': {
    intermediate: { loadStrategy: 'bodyweight', substituteName: 'Bar Dips' },
    beginner: { loadStrategy: 'bodyweight', substituteName: 'Box Dips' },
    onramp: { loadStrategy: 'bodyweight', substituteName: 'Push-ups' },
  },
  Burpee: {
    beginner: { loadStrategy: 'bodyweight', substituteName: 'Step-back Burpees' },
    onramp: { loadStrategy: 'bodyweight', substituteName: 'Squat Thrusts' },
  },
  'Wall Ball': {
    intermediate: { loadStrategy: 'ratio', ratio: 0.85 },
    beginner: { loadStrategy: 'ratio', ratio: 0.65 },
    onramp: { loadStrategy: 'fixed', fixedLoad: { male: 6, female: 4, unit: 'kg', implement: 'Med Ball' } },
  },
  'Pistol Squat': {
    intermediate: { loadStrategy: 'bodyweight', substituteName: 'Alternating Pistols' },
    beginner: { loadStrategy: 'bodyweight', substituteName: 'Air Squats' },
    onramp: { loadStrategy: 'bodyweight', substituteName: 'Air Squats' },
  },
  'GHD Sit-up': {
    intermediate: { loadStrategy: 'bodyweight', substituteName: 'AbMat Sit-ups' },
    beginner: { loadStrategy: 'bodyweight', substituteName: 'Sit-ups' },
    onramp: { loadStrategy: 'bodyweight', substituteName: 'Sit-ups' },
  },
  'Handstand Walk': {
    intermediate: { loadStrategy: 'bodyweight', substituteName: 'Handstand Holds' },
    beginner: { loadStrategy: 'bodyweight', substituteName: 'Wall Walks' },
    onramp: { loadStrategy: 'bodyweight', substituteName: 'Plank Holds' },
  },
  Snatch: {
    intermediate: { loadStrategy: 'ratio', ratio: 0.75 },
    beginner: { loadStrategy: 'ratio', ratio: 0.55 },
    onramp: { loadStrategy: 'bodyweight', substituteName: 'PVC Snatch Drills' },
  },
  'Clean & Jerk': {
    intermediate: { loadStrategy: 'ratio', ratio: 0.75 },
    beginner: { loadStrategy: 'ratio', ratio: 0.55 },
    onramp: { loadStrategy: 'fixed', fixedLoad: { male: 20, female: 15, unit: 'kg', implement: 'DB' } },
  },
  Thruster: {
    intermediate: { loadStrategy: 'ratio', ratio: 0.8 },
    beginner: { loadStrategy: 'ratio', ratio: 0.6 },
    onramp: { loadStrategy: 'fixed', fixedLoad: { male: 20, female: 15, unit: 'kg', implement: 'DB' } },
  },
  'Overhead Squat': {
    intermediate: { loadStrategy: 'ratio', ratio: 0.75 },
    beginner: { loadStrategy: 'ratio', ratio: 0.55 },
    onramp: { loadStrategy: 'bodyweight', substituteName: 'Air Squats' },
  },
}

function normalizeMovementKey(name) {
  const lower = name.trim().toLowerCase()
  return lower.endsWith('s') && !lower.endsWith('ss') ? lower.slice(0, -1) : lower
}

function mergeSubstitutions(overrides) {
  if (!overrides) return SCALING_SUBSTITUTIONS
  const merged = { ...SCALING_SUBSTITUTIONS }
  for (const [key, tiers] of Object.entries(overrides)) {
    merged[key] = { ...merged[key], ...tiers }
  }
  return merged
}

function findSubstitution(table, movementName, tier) {
  const target = normalizeMovementKey(movementName)
  for (const [key, tiers] of Object.entries(table)) {
    if (normalizeMovementKey(key) === target) return tiers[tier]
  }
  return undefined
}

function round(n) {
  return Math.round(n)
}

/** Scales a single reps/weight/name line for one tier - never throws, unparseable text passes through with only substitution applied. */
export function scaleMovementLine(line, tier, overrides) {
  const trimmed = line.trim()
  if (!trimmed) return trimmed

  const table = mergeSubstitutions(overrides)
  const rules = TIER_RULES[tier]

  const weightMatch = trimmed.match(/^(.*?)\s*@\s*(\d+(?:\.\d+)?)(?:\s*\/\s*(\d+(?:\.\d+)?))?\s*(kg|lbs)\s*$/i)
  const rest = weightMatch ? weightMatch[1] : trimmed
  const rxMale = weightMatch ? parseFloat(weightMatch[2]) : null
  const rxFemale = weightMatch ? (weightMatch[3] ? parseFloat(weightMatch[3]) : rxMale) : null
  const unit = weightMatch ? weightMatch[4].toLowerCase() : null

  const repsMatch = rest.match(/^([\d]+(?:-[\d]+)*)\s+(.+)$/)
  const repsPart = repsMatch ? repsMatch[1] : null
  const namePart = (repsMatch ? repsMatch[2] : rest).trim()
  if (!namePart) return trimmed

  const scaledReps = repsPart
    ? repsPart
        .split('-')
        .map((n) => Math.max(1, round(parseInt(n, 10) * (1 - rules.volumeReductionPct))))
        .join('-')
    : null

  const sub = findSubstitution(table, namePart, tier)
  let scaledName = namePart
  let scaledMale = null
  let scaledFemale = null
  let scaledUnit = unit

  if (sub?.loadStrategy === 'bodyweight') {
    if (sub.substituteName) scaledName = sub.substituteName
  } else if (sub?.loadStrategy === 'fixed' && sub.fixedLoad) {
    if (sub.substituteName) scaledName = sub.substituteName
    else if (sub.fixedLoad.implement) scaledName = `${sub.fixedLoad.implement} ${namePart}`
    scaledMale = sub.fixedLoad.male
    scaledFemale = sub.fixedLoad.female
    scaledUnit = sub.fixedLoad.unit
  } else if (rxMale != null) {
    if (sub?.substituteName) scaledName = sub.substituteName
    const ratio = sub?.loadStrategy === 'ratio' && sub.ratio != null ? sub.ratio : rules.defaultLoadRatio
    scaledMale = round(rxMale * ratio)
    scaledFemale = round((rxFemale ?? rxMale) * ratio)
  } else if (sub?.substituteName) {
    scaledName = sub.substituteName
  }

  const namePrefix = scaledReps ? `${scaledReps} ${scaledName}` : scaledName
  if (scaledMale == null) return namePrefix
  return scaledMale === scaledFemale ? `${namePrefix} @ ${scaledMale}${scaledUnit}` : `${namePrefix} @ ${scaledMale}/${scaledFemale}${scaledUnit}`
}

function scaleWeightValue(value, ratio) {
  const trimmed = (value || '').trim()
  if (!trimmed) return ''
  const match = trimmed.match(/^(\d+(?:\.\d+)?)\s*(kg|lbs)?$/i)
  if (!match) return trimmed
  const scaled = round(parseFloat(match[1]) * ratio)
  return match[2] ? `${scaled}${match[2]}` : String(scaled)
}

// Any config key whose name suggests it holds a duration in seconds gets
// scaled by timeCapIncreasePct - covers durationSec/timeCapSec/
// totalDurationSec/mainDurationSec/intervalSec across every format in
// workoutFormats.js generically, without a per-format switch.
export function adjustFormatConfigForTier(format, config, tier) {
  const rules = TIER_RULES[tier]
  const next = { ...config }
  for (const [key, value] of Object.entries(config || {})) {
    if (/duration|timecap/i.test(key) && typeof value === 'number') {
      next[key] = round(value * (1 + rules.timeCapIncreasePct))
    }
  }
  return next
}

/** Pure. Never mutates `rx`; never touches Supabase. */
export function generateVariantsFromRx(rx, overrides) {
  const tiers = ['intermediate', 'beginner', 'onramp']
  const result = {}
  for (const tier of tiers) {
    const rules = TIER_RULES[tier]
    result[tier] = {
      movements: rx.movements.map((line) => scaleMovementLine(line, tier, overrides)),
      weight: {
        male: scaleWeightValue(rx.weight.male, rules.defaultLoadRatio),
        female: scaleWeightValue(rx.weight.female, rules.defaultLoadRatio),
      },
      note: '',
      formatConfig: adjustFormatConfigForTier(rx.format, rx.formatConfig, tier),
    }
  }
  return result
}
