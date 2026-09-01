// INC-08 - STRUCTURED INTERVAL RESULT PROJECTION
//
// A structured per-interval Interval (INC-07) stores R × S score entries in
// `wod_logs.sets`, keyed round-major by `intervalStationKey`:
//   "Rundă {r} · {s}. {stationName}"
// The result-detail surfaces (leaderboard expand, Journal card) previously
// mapped every `sets` entry 1:1 to a display row, so 15 SCORE ENTRIES read as
// 15 semantic rounds.
//
// This module rebuilds the semantic { R rounds × S stations } grouping - from
// the log's OWN FROZEN evidence ONLY (`format_config_snapshot`, `sets`,
// `movements_snapshot`). It NEVER touches the live workout (P10). It returns
// null - and the caller keeps the existing legacy flat rendering - unless the
// frozen snapshot itself proves `stationMode:'per-interval'` + `roundCount>0`
// AND the `sets` keys are the round-major form. No `15 ÷ 3 = 5` inference.

import { getFormat } from './workoutFormats'

// Mirror of intervalStationKey(round, station, name) in workoutFormats.js:
//   `Rundă ${roundIndex} · ${stationIndex}. ${stationName}`
const STATION_KEY_RE = /^Rundă (\d+) · (\d+)\. (.*)$/

export function parseIntervalStationKey(key) {
  const m = STATION_KEY_RE.exec(String(key ?? ''))
  if (!m) return null
  return { roundIndex: parseInt(m[1], 10), stationIndex: parseInt(m[2], 10), name: m[3] }
}

function repsOf(rows) {
  const row = Array.isArray(rows) ? rows[0] : null
  if (!row) return null
  const v = row.reps
  // 0 is a real logged value; '' / null / undefined = not logged (partial).
  if (v === '' || v == null) return null
  return String(v)
}

/**
 * @param {object} log  a wod_logs / skill_logs row (with format_snapshot,
 *   format_config_snapshot, sets, movements_snapshot). ALL frozen fields.
 * @returns null for a non-structured / legacy log; otherwise
 *   {
 *     structured: true,
 *     roundCount, stationCount,
 *     stationLabels: string[],
 *     rounds: [{ roundIndex, stations: [{ stationIndex, label, reps: string|null }] }],
 *     expectedScoreEntryCount, actualScoreEntryCount,
 *     extraEntries: [{ roundIndex, stationIndex, name }]   // outside R×S - never rendered as rounds
 *   }
 */
export function resolveStructuredIntervalResult(log) {
  if (!log) return null
  const fmt = getFormat(log.format_snapshot || log.format_type || undefined)
  if (!fmt || fmt.rowMode !== 'interval') return null

  // §11 - FROZEN evidence only. No roundCount / no stationMode = legacy.
  const cfg = log.format_config_snapshot || {}
  if (cfg.stationMode !== 'per-interval') return null
  const roundCount = parseInt(cfg.roundCount, 10)
  if (!(roundCount > 0)) return null

  const parsed = Object.entries(log.sets || {})
    .map(([key, rows]) => {
      const p = parseIntervalStationKey(key)
      return p ? { ...p, reps: repsOf(rows) } : null
    })
    .filter(Boolean)
  // The snapshot claims structured but the keys are not the round-major form
  // (e.g. a legacy log whose workout was later corrected): fall back to legacy.
  if (parsed.length === 0) return null

  const inRange = parsed.filter((p) => p.roundIndex >= 1 && p.roundIndex <= roundCount)
  const extraEntries = parsed
    .filter((p) => p.roundIndex < 1 || p.roundIndex > roundCount)
    .map(({ roundIndex, stationIndex, name }) => ({ roundIndex, stationIndex, name }))

  const stationCount = Math.max(1, ...inRange.map((p) => p.stationIndex))
  const stationLabels = []
  for (let s = 1; s <= stationCount; s++) {
    const hit = inRange.find((p) => p.stationIndex === s)
    stationLabels[s - 1] = hit ? hit.name : `Station ${s}`
  }

  const byKey = new Map(inRange.map((p) => [`${p.roundIndex}:${p.stationIndex}`, p]))
  const rounds = []
  for (let r = 1; r <= roundCount; r++) {
    const stations = []
    for (let s = 1; s <= stationCount; s++) {
      const hit = byKey.get(`${r}:${s}`)
      stations.push({ stationIndex: s, label: stationLabels[s - 1], reps: hit ? hit.reps : null })
    }
    rounds.push({ roundIndex: r, stations })
  }

  return {
    structured: true,
    roundCount,
    stationCount,
    stationLabels,
    rounds,
    expectedScoreEntryCount: roundCount * stationCount,
    actualScoreEntryCount: parsed.length,
    extraEntries,
  }
}
