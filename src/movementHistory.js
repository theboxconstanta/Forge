// Member Performance, Phase 2 - Movement History. Pure, deterministic
// derivation over already-loaded wod_logs/skill_logs - NO new query, NO
// PR-engine dependency (pr_events is never read here), NO movement
// canonicalization (text-scoped identity, honestly disclosed).
//
// ELIGIBILITY (the mission's central invariant: workout movement presence
// != movement performance result). Proven by direct inspection of
// workoutFormats.js's own format registry AND live production data
// (MEMBER_PERFORMANCE_PHASE2_MOVEMENT_HISTORY_IMPLEMENTATION_REPORT.md,
// "Production Identity Audit"):
//
//   wod_logs: eligible only when the log's format has `family:'sets'` AND
//   `rowMode:'movement'` (today: Weightlifting, Strength Sets,
//   Build to Heavy/1RM, Superset) - the ONLY formats whose `sets` JSONB
//   object keys are real movement names. All other `family:'sets'` formats
//   (EMOM/Tabata/Intervals/Death By/Death By Weight, rowMode 'interval';
//   Complex, rowMode 'round') key `sets` by an interval/round LABEL
//   ("Min 1", "Rundă 3"), not a movement - confirmed live in production
//   (Intervals rows and legacy NULL-format rows both carry exactly these
//   label keys). Including them would silently turn "Rundă 3" into a fake
//   "movement". Every other format family (scored/mixed/chained/nft, i.e.
//   For Time/AMRAP/RFT/Chipper/Partner WOD/etc.) never populates `sets`
//   with movement-shaped data at all in this codebase - a Metcon's own
//   movements (e.g. Fran's Thrusters/Pull-ups) can NEVER leak into
//   Movement History, by construction, not by a filter that could miss a
//   case.
//
//   skill_logs: eligible whenever `sets` is non-empty. Movement identity
//   is `skill_name_snapshot` (a skill log always represents ONE
//   movement/skill; per-key rows within it, e.g. "Rundă 1".."Rundă 7" for
//   a "Snatch Complex" skill, are multiple attempts of that SAME movement,
//   not distinct movements) UNLESS `format_snapshot === 'Superset'`, in
//   which case `sets` keys ARE distinct alternating movement names. This
//   is not a new rule invented for this feature - it is a faithful port of
//   the exact same distinction already proven correct server-side by the
//   evaluate_movement_prs trigger (v_movement_keyed :=
//   NEW.format_snapshot = 'Superset' for skill_logs), applied read-side
//   instead of write-side.
//
// IDENTITY: text-scoped, case/whitespace-normalized for GROUPING only
// (matching resolve_benchmark_names' own normalization precedent - no
// fuzzy/semantic matching anywhere). The member-facing display name is
// always the most-recently-logged entry's own original-casing text, never
// a normalized/lowercased string. Distinct variations (Snatch vs Power
// Snatch vs Back Squat vs Front Squat) are NEVER merged - grouping is by
// exact normalized text only. Zero real case/whitespace collisions were
// found in production at the time of this audit (see implementation
// report) - normalization is a safety margin, not a fix for an observed
// problem.
//
// NO generic "Best"/PR claim (mission §32/§60): a raw movement Result set
// (e.g. 100kg x5 vs 120kg x1) has no single canonically "better" entry
// the way a Benchmark's finished-beats-capped comparator does - showing
// one would fabricate a comparison Forge cannot honestly make yet (that is
// exactly the still-open rep-scheme-keyed PR gap, deliberately owned by a
// future PR Engine phase, not this one). Movement History shows only
// Latest + full History, each entry displaying its own honest reps/weight
// context, no comparator applied.
//
// Member Performance, Phase 3 (Rep-Scheme Identity Hardening) - adds a
// COMPARISON IDENTITY to each entry, answering "what kind of performance
// on this movement is this?" (not just "what movement is this?"). Proven
// by direct code+data audit (MEMBER_PERFORMANCE_PHASE3_REP_SCHEME_IDENTITY_
// IMPLEMENTATION_REPORT.md), NOT inferred from rep count alone (a 5x5
// training set is never treated as a 5RM test just because 5 reps were
// logged - mission's own central warning):
//
//   RM_TEST - an EXPLICIT, structurally-declared rep-max test intent.
//   Today exactly two sources: (1) Build to Heavy/1RM's own `targetLabel`
//   config field - a UI stepper (RepMaxStepperField, FormatConfigEditor.jsx)
//   that can ONLY ever produce a clean "NRM" string (1-30), never free
//   text - confirmed live in production to already match the workout's own
//   name ("Build to a 3-rep-max front squats" -> targetLabel "3RM").
//   (2) Complex format (reached only via skill_logs' skill_name_snapshot
//   fallback, per Phase 2) with `scoringMode === 'Max Weight'` - the
//   coach's own explicit choice that the scored metric is a single best
//   effort, not summed volume. repTarget is the parsed integer for (1),
//   always null for (2) since the whole complex (not one rep count) is the
//   comparable subject.
//
//   SETS_ACROSS - a declared TRAINING structure with no test-intent
//   signal: Strength Sets with a non-empty `setsScheme` (even a descending
//   ladder like [3,3,2,2,1,1,1,1] found in real production data - the
//   mission is explicit that rep count/ladder shape alone must NOT be
//   read as "this was a max test"), Superset with a positive `targetSets`,
//   Complex with `scoringMode === 'Total Weight'` (summed across rounds,
//   mechanically larger with more rounds, not a max).
//
//   UNKNOWN - no declared structure at all: Weightlifting (format has zero
//   config fields, ever), or any of the above formats missing their own
//   declared field (confirmed live: 20/31 real Strength Sets rows have
//   `setsScheme: null`, all 4 real Complex skill_logs have
//   `scoringMode: null` with no schema-declared default - honestly
//   unknown, never guessed).
//
// Only RM_TEST is `comparable: true` (PR-comparison-eligible). SETS_ACROSS
// and UNKNOWN remain fully DISPLAYABLE in Movement History (mission §29's
// "comparable vs displayable" distinction) but are never treated as
// PR-comparable. `comparisonKey` groups movement+tier+mode+repTarget only -
// never date/section/workout title (mutable/occurrence-specific) - so a
// future PR Engine phase can safely compare only within the same key
// without reimplementing this resolver. This phase does NOT read/write
// `pr_events`, does NOT expand `evaluate_movement_prs`, and does NOT
// display a "Best" within any group (Movement Detail still shows only
// Latest + History, now with an honest per-entry mode label).

import { getFormat, normalizeSetsRows } from './workoutFormats'

// Parses the Build to Heavy/1RM `targetLabel` field - guaranteed by its own
// UI (RepMaxStepperField) to be exactly `${1-30}RM`, never free text.
// Returns null for anything that doesn't match (defensive only - no real
// production row has ever failed this).
function parseRepMaxTarget(targetLabel) {
  const match = String(targetLabel || '').trim().match(/^(\d{1,2})RM$/i)
  if (!match) return null
  const n = parseInt(match[1], 10)
  return Number.isFinite(n) && n >= 1 && n <= 30 ? n : null
}

// The comparison-identity resolver - pure, deterministic, no DB access, no
// AI, no fuzzy inference. See module header for the full evidence trail
// behind each branch.
export function resolveComparisonIdentity({ formatSnapshot, formatConfigSnapshot }) {
  const config = formatConfigSnapshot || {}
  if (formatSnapshot === 'Build to Heavy/1RM') {
    const repTarget = parseRepMaxTarget(config.targetLabel)
    return repTarget != null
      ? { mode: 'RM_TEST', repTarget, comparable: true }
      : { mode: 'UNKNOWN', repTarget: null, comparable: false }
  }
  if (formatSnapshot === 'Complex') {
    if (config.scoringMode === 'Max Weight') return { mode: 'RM_TEST', repTarget: null, comparable: true }
    if (config.scoringMode === 'Total Weight') return { mode: 'SETS_ACROSS', repTarget: null, comparable: false }
    return { mode: 'UNKNOWN', repTarget: null, comparable: false }
  }
  if (formatSnapshot === 'Strength Sets') {
    const scheme = config.setsScheme
    if (Array.isArray(scheme) && scheme.length > 0) return { mode: 'SETS_ACROSS', repTarget: null, comparable: false }
    return { mode: 'UNKNOWN', repTarget: null, comparable: false }
  }
  if (formatSnapshot === 'Superset') {
    const targetSets = parseInt(config.targetSets, 10)
    if (Number.isFinite(targetSets) && targetSets > 0) return { mode: 'SETS_ACROSS', repTarget: null, comparable: false }
    return { mode: 'UNKNOWN', repTarget: null, comparable: false }
  }
  // Weightlifting (zero config fields, ever) and any other/unrecognized format.
  return { mode: 'UNKNOWN', repTarget: null, comparable: false }
}

// Small, honest per-entry label (mission §61's explicitly-safe enrichment) -
// never a group/Best claim. "3RM" for an explicit rep-max test, "Max" for a
// Complex scored as a single best effort, "Training" for a declared
// training structure, no label at all for UNKNOWN (nothing to honestly say).
export function comparisonModeLabel(entry) {
  if (!entry) return null
  if (entry.comparisonMode === 'RM_TEST') return entry.repTarget != null ? `${entry.repTarget}RM` : 'Max'
  if (entry.comparisonMode === 'SETS_ACROSS') return 'Training'
  return null
}

const MOVEMENT_KEYED_FORMATS = new Set(['Weightlifting', 'Strength Sets', 'Build to Heavy/1RM', 'Superset'])

function isMovementKeyedWodFormat(formatId) {
  if (!formatId) return false
  const format = getFormat(formatId)
  return format?.family === 'sets' && format?.rowMode === 'movement' && MOVEMENT_KEYED_FORMATS.has(formatId)
}

// Exported (Phase 6) so callers outside this module (Current Bests/Recent
// PRs navigation, App.jsx) can resolve the same movementKey the Movement
// List/Detail screens already use, without a second normalization rule.
export function normalizeKey(text) {
  return String(text || '').trim().toLowerCase().replace(/\s+/g, ' ')
}

function isValidSetRow(row) {
  if (!row) return false
  const reps = row.reps
  const weight = row.weight
  const hasReps = reps !== null && reps !== undefined && String(reps).trim() !== ''
  const hasWeight = weight !== null && weight !== undefined && String(weight).trim() !== ''
  return hasReps || hasWeight
}

function toNumberOrNull(v) {
  if (v === null || v === undefined || String(v).trim() === '') return null
  const n = Number(v)
  return Number.isFinite(n) ? n : null
}

// One extracted movement-performance entry, source-agnostic (wod_logs or
// skill_logs) - the "read boundary normalization" the mission asks for
// (§29), so the UI never needs to know which physical table a Result came
// from.
function makeEntry({ sourceLog, source, movementName, reps, weight, rowIndex }) {
  const tier = sourceLog.variant_level || 'RX'
  const identity = resolveComparisonIdentity({
    formatSnapshot: sourceLog.format_snapshot,
    formatConfigSnapshot: sourceLog.format_config_snapshot,
  })
  return {
    id: `${source}:${sourceLog.id}:${rowIndex}`,
    logId: sourceLog.id,
    source,
    movementName,
    tier,
    reps: toNumberOrNull(reps),
    weight: toNumberOrNull(weight),
    repsRaw: reps ?? null,
    weightRaw: weight ?? null,
    loggedAt: sourceLog.logged_at,
    sectionId: sourceLog.workout_section_id ?? null,
    comparisonMode: identity.mode,
    repTarget: identity.repTarget,
    comparable: identity.comparable,
    comparisonKey: `${normalizeKey(movementName)}::${tier}::${identity.mode}::${identity.repTarget ?? ''}`,
  }
}

// Extracts every eligible movement-performance entry from one member's
// already-loaded wod_logs. Track-only/hidden-leaderboard Results are
// included by construction - this never reads
// workout_sections.leaderboard_visible at all, matching Phase 1's own
// precedent exactly.
export function extractMovementEntriesFromWodLogs(wodLogs) {
  const entries = []
  ;(wodLogs || []).forEach((log) => {
    if (!isMovementKeyedWodFormat(log.format_snapshot)) return
    if (!log.sets || typeof log.sets !== 'object') return
    const rows = normalizeSetsRows(log.sets)
    Object.entries(rows).forEach(([movementKey, setRows]) => {
      const movementName = String(movementKey || '').trim()
      if (!movementName) return
      ;(setRows || []).forEach((row, idx) => {
        if (!isValidSetRow(row)) return
        entries.push(makeEntry({ sourceLog: log, source: 'wod_logs', movementName, reps: row.reps, weight: row.weight, rowIndex: idx }))
      })
    })
  })
  return entries
}

// Same extraction for skill_logs - see module header for the
// Superset-vs-fallback distinction (ported from evaluate_movement_prs).
export function extractMovementEntriesFromSkillLogs(skillLogs) {
  const entries = []
  ;(skillLogs || []).forEach((log) => {
    if (!log.sets || typeof log.sets !== 'object' || Object.keys(log.sets).length === 0) return
    const movementKeyed = log.format_snapshot === 'Superset'
    const fallbackMovement = String(log.skill_name_snapshot || '').trim()
    const rows = normalizeSetsRows(log.sets)
    Object.entries(rows).forEach(([key, setRows]) => {
      const movementName = movementKeyed ? String(key || '').trim() : fallbackMovement
      if (!movementName) return
      ;(setRows || []).forEach((row, idx) => {
        if (!isValidSetRow(row)) return
        entries.push(makeEntry({ sourceLog: log, source: 'skill_logs', movementName, reps: row.reps, weight: row.weight, rowIndex: idx }))
      })
    })
  })
  return entries
}

// Groups all eligible entries (both sources) by normalized movement text.
// Never pools distinct variations - grouping key is exact normalized text,
// no aliasing/fuzzy matching of any kind.
export function groupMovementEntries(wodLogs, skillLogs) {
  const all = [...extractMovementEntriesFromWodLogs(wodLogs), ...extractMovementEntriesFromSkillLogs(skillLogs)]
  const groups = new Map()
  all.forEach((entry) => {
    const key = normalizeKey(entry.movementName)
    if (!groups.has(key)) groups.set(key, [])
    groups.get(key).push(entry)
  })
  return groups
}

// Formats one entry's honest score context - never fabricates a missing
// dimension (mission §11/§56): "100kg x5" when both are known, "100kg"
// alone when reps aren't, "5 reps" alone when weight isn't.
export function movementEntryDisplay(entry, weightUnit) {
  if (!entry) return null
  const unit = weightUnit === 'lbs' ? 'lbs' : 'kg'
  const hasWeight = entry.weight != null
  const hasReps = entry.reps != null
  if (hasWeight && hasReps) return `${entry.weight}${unit} × ${entry.reps}`
  if (hasWeight) return `${entry.weight}${unit}`
  if (hasReps) return `${entry.reps} reps`
  return null
}

// One movement's full derived history - Latest + full chronological
// History, deliberately no "Best"/PR claim (see module header).
export function deriveMovementHistory(entries) {
  if (!entries || entries.length === 0) return null
  const byDate = [...entries].sort((a, b) => new Date(b.loggedAt) - new Date(a.loggedAt))
  return {
    displayName: byDate[0].movementName,
    attemptCount: byDate.length,
    latest: byDate[0],
    history: byDate,
  }
}

// Movement List (mission §34-35) - one row per movement identity the
// member has ever logged an eligible Result for, sorted by
// most-recently-performed. Deliberately no search/filter in V1 (mission
// §34's own "prefer A for V1 if canonical identity coverage is weak").
export function buildMovementListEntries(wodLogs, skillLogs) {
  const groups = groupMovementEntries(wodLogs, skillLogs)
  const entries = []
  for (const [normalizedKey, groupEntries] of groups) {
    const history = deriveMovementHistory(groupEntries)
    entries.push({
      movementKey: normalizedKey,
      displayName: history.displayName,
      attemptCount: history.attemptCount,
      lastPerformedAt: history.latest.loggedAt,
      latestEntry: history.latest,
    })
  }
  entries.sort((a, b) => new Date(b.lastPerformedAt) - new Date(a.lastPerformedAt))
  return entries
}

// Member Performance, Phase 6 (Performance Overview) - Current Movement
// Bests. Mandatory invariant (mission §5/§20): derived directly from
// authoritative Results (this module's own entries), NEVER from
// `pr_events`/`movement_pr_events_current` - those exist for the
// DIFFERENT concept of "recent PR event history" (see recentPrEvents.js),
// not "what is true right now". Grouping by `comparisonKey` (movement +
// tier + mode + repTarget, Phase 3) automatically keeps 1RM/3RM/5RM and
// Rx/Scaled tiers separate, and automatically excludes SETS_ACROSS/
// UNKNOWN entries (only `comparable:true` entries participate) - no
// second eligibility check invented here. Ties broken by most recent
// occurrence, never by inventing superiority (mission §41).
export function deriveCurrentMovementBests(wodLogs, skillLogs) {
  const all = [...extractMovementEntriesFromWodLogs(wodLogs), ...extractMovementEntriesFromSkillLogs(skillLogs)]
  const bestByKey = new Map()
  all.forEach((entry) => {
    if (!entry.comparable || entry.weight == null) return
    const current = bestByKey.get(entry.comparisonKey)
    if (!current) { bestByKey.set(entry.comparisonKey, entry); return }
    if (entry.weight > current.weight) { bestByKey.set(entry.comparisonKey, entry); return }
    if (entry.weight === current.weight && new Date(entry.loggedAt) > new Date(current.loggedAt)) {
      bestByKey.set(entry.comparisonKey, entry)
    }
  })
  const bests = [...bestByKey.values()]
  bests.sort((a, b) => new Date(b.loggedAt) - new Date(a.loggedAt))
  return bests
}
