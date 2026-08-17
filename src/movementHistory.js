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

import { getFormat, normalizeSetsRows } from './workoutFormats'

const MOVEMENT_KEYED_FORMATS = new Set(['Weightlifting', 'Strength Sets', 'Build to Heavy/1RM', 'Superset'])

function isMovementKeyedWodFormat(formatId) {
  if (!formatId) return false
  const format = getFormat(formatId)
  return format?.family === 'sets' && format?.rowMode === 'movement' && MOVEMENT_KEYED_FORMATS.has(formatId)
}

function normalizeKey(text) {
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
  return {
    id: `${source}:${sourceLog.id}:${rowIndex}`,
    logId: sourceLog.id,
    source,
    movementName,
    reps: toNumberOrNull(reps),
    weight: toNumberOrNull(weight),
    repsRaw: reps ?? null,
    weightRaw: weight ?? null,
    loggedAt: sourceLog.logged_at,
    sectionId: sourceLog.workout_section_id ?? null,
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
