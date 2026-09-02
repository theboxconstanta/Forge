// INC-11 - STRUCTURE-AWARE SEQUENTIAL AMRAP.
//
// A base AMRAP with `format_config.structure === 'Sequence'` is NOT "repeat the
// round list until the clock expires". It is a finite ordered pass through
// distinct tasks - a buy-in / chipper, optionally ending on an open "max reps"
// station for whatever time is left. The athlete may stop at any point.
//
// This module is the ONE structural resolver + score/persistence helper for that
// class. Pure functions, no React / Supabase (tested in sequentialAmrap.test.js).
// Everything downstream (logger, save path, edit re-parse, leaderboard) consumes
// its output; no surface re-derives station structure on its own.
//
// SCOPE (owner decision #2 = 2A): REP-ONLY sequential AMRAP. A Sequence body that
// mixes non-rep units (calories / distance) has NO canonical progress score in
// Forge - `sequentialAmrapMixedUnitConflict` flags it; the Builder blocks
// authoring it and the logger conservatively falls back to the classic
// Rounds+Additional Reps input rather than inventing metre+calorie+rep
// arithmetic. Tracked as a separate backlog item.
//
// FIXED vs OPEN station role (owner decision #4): derived from STRUCTURED
// evidence, never from display text -
//   1. a resolved structured `reps` value  (number > 0 -> fixed; null -> open)
//   2. legacy text with a leading rep count (`"50 Burpee Pull-ups"` -> fixed 50)
//      ONLY as the conservative fallback for rows with no structured prescription.
// "Max Reps" in the movement name is workout INSTRUCTION language and is never
// the source of truth.

import { composePartialText } from './workoutFormats'

// A resolved structured metric spec ({ mode:'universal'|'sex_specific'|'text',
// value, bothValues, unit }) or a bare number -> a non-negative integer target,
// or null when there is no concrete rep count (an open / max station).
function repTargetOf(spec) {
  if (spec == null) return null
  if (typeof spec === 'number') return Number.isFinite(spec) && spec > 0 ? Math.round(spec) : null
  if (typeof spec === 'string') {
    const m = spec.trim().match(/^(\d+)/)
    return m ? parseInt(m[1], 10) : null
  }
  if (typeof spec === 'object') {
    if (spec.mode === 'text') return null
    const v = typeof spec.value === 'number' ? spec.value
      : Array.isArray(spec.bothValues) ? spec.bothValues.find((x) => typeof x === 'number') ?? null
      : null
    return typeof v === 'number' && Number.isFinite(v) && v > 0 ? Math.round(v) : null
  }
  return null
}

// Does this structured instance carry a NON-REP metric (calories / distance) as
// its leading quantity, i.e. it cannot be scored as reps? Text lines can only be
// guessed at, so this is authoritative only for structured instances.
function instanceIsNonRep(inst) {
  if (!inst || typeof inst !== 'object') return false
  const has = (s) => s != null && (typeof s === 'number' || (typeof s === 'object' && (s.mode === 'text' || typeof s.value === 'number' || Array.isArray(s.bothValues))))
  const repish = has(inst.reps)
  return !repish && (has(inst.calories) || has(inst.distance))
}

// Conservative non-rep detection for a legacy TEXT line (no structured data).
// Only used to keep the Builder / logger from producing an invalid rep total for
// a hand-authored mixed body - never to reinterpret an existing result. Best
// effort: the authoritative path is structured instances (instanceIsNonRep).
// Matches a calorie word anywhere, or a number followed by a distance unit token
// then a word ("400 m Run"), or a bare distance/calorie line.
function nonRepText(line) {
  const s = String(line || '')
  return /\b(cal|cals|calorie|calories)\b/i.test(s)
    || /\d\s*(m|km|mi|meters?|metres?)\s+\S/i.test(s)
    || /^\s*(m|km|mi)\s+\S/i.test(s.replace(/^\d+\s*/, ''))
}

/**
 * resolveSequentialAmrapStations({ instances?, lines? }) -> {
 *   supported: boolean,          false = mixed-unit / no stations -> caller keeps classic logger
 *   reason?: 'mixed-unit' | 'empty',
 *   stations: [{ index, name, target: number|null, role: 'fixed'|'open',
 *                line: string  // "50 Burpee Pull-ups" | "Burpee Pull-ups" (fed to composePartialText) }]
 * }
 *
 * `instances` (preferred): resolved movement objects from
 * composeStructuredWorkoutDisplay(...).movements - each { name, reps, calories,
 * distance } where reps is a resolved spec. `lines`: plain movement text (legacy
 * / historical / skill). Order is canonical - the array order IS the sequence
 * (INC-11 §67); never re-sorted.
 */
export function resolveSequentialAmrapStations({ instances, lines } = {}) {
  let raw
  if (Array.isArray(instances) && instances.length) {
    raw = instances.map((inst) => {
      const name = (inst && typeof inst.name === 'string' ? inst.name : String(inst?.name ?? '')).trim()
      const target = repTargetOf(inst?.reps)
      const nonRep = instanceIsNonRep(inst)
      return { name, target, nonRep }
    })
  } else if (Array.isArray(lines) && lines.length) {
    raw = lines
      .map((l) => String(l ?? '').trim())
      .filter(Boolean)
      .map((line) => {
        const isNonRep = nonRepText(line)
        const m = isNonRep ? null : line.match(/^(\d+)\s+(.+)$/)
        return {
          name: m ? m[2].trim() : line,
          target: m ? parseInt(m[1], 10) : null,
          nonRep: isNonRep,
        }
      })
  } else {
    return { supported: false, reason: 'empty', stations: [] }
  }

  if (raw.length === 0) return { supported: false, reason: 'empty', stations: [] }
  if (raw.some((r) => r.nonRep)) return { supported: false, reason: 'mixed-unit', stations: [] }

  const stations = raw.map((r, i) => {
    const role = r.target != null ? 'fixed' : 'open'
    const line = role === 'fixed' ? `${r.target} ${r.name}` : r.name
    return { index: i + 1, name: r.name, target: r.target, role, line }
  })
  return { supported: true, stations }
}

// True when a proposed Sequence body cannot be scored as reps (owner decision
// #2). `movementTextLines` is the authoring-time movement list; `instances` the
// structured form when available. The Builder calls this to block the
// Sequence + incompatible-units combination with a coach-facing message.
export function sequentialAmrapMixedUnitConflict({ instances, lines } = {}) {
  const res = resolveSequentialAmrapStations({ instances, lines })
  return !res.supported && res.reason === 'mixed-unit'
}

// INC-11 §15 - STRICT sequential order: recording progress on a later station
// means every FIXED station before it was necessarily completed to target. Fill
// only empty fixed stations that are strictly before the furthest station the
// athlete actually touched; stations at/after that point keep their raw value
// (empty = NOT REACHED, an explicit "0" = reached and performed zero - owner
// decision #3, preserved distinctly).
export function autoCompleteSequentialProgress(stations, performedRaw) {
  const perf = (stations || []).map((_, i) => {
    const v = (performedRaw || [])[i]
    return v == null ? '' : String(v).trim()
  })
  let furthest = -1
  perf.forEach((v, i) => { if (v !== '') furthest = i })
  if (furthest < 0) return perf
  return perf.map((v, i) => {
    if (i < furthest && v === '' && stations[i]?.role === 'fixed' && stations[i]?.target != null) {
      return String(stations[i].target)
    }
    return v
  })
}

// Canonical Total Reps for a rep-only sequential AMRAP (owner decision #5 -
// sequential uses Total Reps; classic repeated-round AMRAP is untouched). Sum of
// actually completed work, counted exactly once (INC-11 §41): auto-completed
// prior fixed targets + performed reps on the stopping station + performed reps
// on the open station. Targets never reached contribute nothing.
export function sequentialAmrapTotalReps(stations, performedRaw) {
  const perf = autoCompleteSequentialProgress(stations, performedRaw)
  return perf.reduce((sum, v) => {
    if (v === '') return sum
    const n = parseFloat(v)
    return Number.isFinite(n) ? sum + n : sum
  }, 0)
}

// The frozen result string for a sequential AMRAP log. Reuses the EXACT existing
// sequential grammar (composePartialText -> "50/50 Burpee Pull-ups, 63/75
// Russian KB Swings, 12 Burpee Pull-ups"): fixed stations render "done/target",
// the open station renders bare "done Name", a NOT-REACHED station is omitted
// entirely. partialRepsOfLog(log, true) reads the same total back, and
// sortSectionLogs already ranks sequential logs by that sum - no leaderboard
// change (INC-11 §20/§55, INC-09 selection untouched).
export function composeSequentialAmrapResult(stations, performedRaw) {
  const perf = autoCompleteSequentialProgress(stations, performedRaw)
  const lines = (stations || []).map((s) => s.line)
  return composePartialText(perf, lines) || ''
}

// Re-open a saved sequential AMRAP result into the per-station editor state,
// aligned to `stations`. Mirrors parsePartialText but keyed on station index so
// a repeated movement name stays two distinct stations (INC-11 §36/§68). An
// omitted station -> '' (still "not reached"); "0/target" -> "0".
export function parseSequentialAmrapResult(resultStr, stations) {
  const out = (stations || []).map(() => '')
  const segs = String(resultStr || '').split(',').map((s) => s.trim()).filter(Boolean)
  const used = new Set()
  segs.forEach((seg) => {
    const fixed = seg.match(/^(\d+(?:\.\d+)?)\/(\d+)\s+(.+)$/)
    const open = seg.match(/^(\d+(?:\.\d+)?)\s+(.+)$/)
    const done = fixed ? fixed[1] : open ? open[1] : null
    const name = fixed ? fixed[3].trim() : open ? open[2].trim() : null
    if (done == null || name == null) return
    let idx = (stations || []).findIndex((s, i) => !used.has(i)
      && s.name.trim().toLowerCase() === name.toLowerCase()
      && (fixed ? s.role === 'fixed' : s.role === 'open' || true))
    if (idx === -1) idx = (stations || []).findIndex((s, i) => !used.has(i) && s.name.trim().toLowerCase() === name.toLowerCase())
    if (idx === -1) return
    used.add(idx)
    out[idx] = done
  })
  return out
}
