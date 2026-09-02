// P9.5 — ScoreDefinition: a thin UI-facing adapter over Forge's EXISTING scoring
// contract (workoutFormats.js `family` / `scoreMode`, `effectiveScoreMode`,
// `isSequentialFormat`, `timeCapSec`). It is PRESENTATION / INPUT metadata only —
// it does NOT replace persistence. `saveWodLog` / `composeWodLogFields` /
// `completion_state` / `result` / `time_result` / `sets` are all unchanged.
//
// Owner-approved kinds (P9.5 §1): TIME · TIME_CAPPED · ROUNDS_REPS · REPS ·
// LOAD · DISTANCE · CALORIES · SETS · STAGES · NONE · FREE.
// No new scoring engine. No MULTI_SCORE abstraction — SETS / STAGES / multiple
// scored sections already cover Forge's real multi-score cases.

import { getFormat, effectiveScoreMode, isSequentialFormat, isSequentialAmrap, TIME_CAP_LABEL_FORMAT_IDS } from './workoutFormats'

export const SCORE_KINDS = [
  'TIME', 'TIME_CAPPED', 'ROUNDS_REPS', 'SEQUENTIAL_AMRAP', 'REPS', 'LOAD', 'DISTANCE', 'CALORIES',
  'SETS', 'STAGES', 'NONE', 'FREE',
]

// The dedicated optional time-cap field on Duration-primary formats (see the
// FORMATS catalog: `timeCapSec: { type: 'duration', required: false }`).
function timeCapOf(config) {
  const c = config || {}
  const v = parseInt(c.timeCapSec, 10)
  return Number.isFinite(v) && v > 0 ? v : null
}

/**
 * scoreDefinitionFor(formatId, formatConfig[, opts]) -> ScoreDefinition
 *
 * ScoreDefinition = {
 *   kind,                    one of SCORE_KINDS
 *   timeCapSec?: number,     TIME_CAPPED only
 *   roundsKnown?: number,    config.rounds — capped rounds default + "N rounds complete"
 *   sequential?: boolean,    For Time / Ladder — per-movement partials, no "rounds"
 *   unit?: string,           LOAD 'kg'|'lb' · DISTANCE 'm'|'km' · CALORIES 'cal'
 *   integer?: boolean,       reps / rounds / calories → integer-only input
 * }
 *
 * `opts.singleValueUnit` — for a `single_value` (Max Effort) section, the caller
 * MAY pass a deterministic unit derived from the section's structured metrics
 * ('reps' | 'load' | 'calories' | 'distance'). Absent → FREE (one labelled
 * field). Historical `single_value` rows are never reinterpreted — this only
 * shapes the INPUT affordance for a NEW log.
 *
 * `opts.legacyDurationSec` — P9.5.3: the WOD's canonical stated time in seconds
 * (`timeToSec(wods.duration)`). For the cap-family For-Time formats
 * (TIME_CAP_LABEL_FORMAT_IDS) this IS the time cap when `format_config` carries
 * no `timeCapSec` / `durationSec` — which is how every RFT and almost every
 * For Time in production actually stores its cap. Without it the adaptive input
 * never offers the Finished / Did-not-finish choice for those workouts. Same
 * canonical fallback chain as `estimateTotalDurationSec`
 * (`timeCapSec || durationSec || <stated duration>`); NEVER parsed from
 * rendered text.
 */
export function scoreDefinitionFor(formatId, formatConfig, opts = {}) {
  const format = formatId ? getFormat(formatId) : null
  const config = formatConfig || {}

  if (!format) return { kind: 'FREE' }

  if (format.family === 'sets') return { kind: 'SETS' }
  if (format.family === 'chained') return { kind: 'STAGES' }
  if (format.family === 'nft') return { kind: 'NONE' }

  const mode = effectiveScoreMode(formatId, config) || format.scoreMode

  if (mode === 'amrap') {
    // INC-11 - a Sequence AMRAP (owner-flagged `structure:'Sequence'`, never
    // inferred) is ordered station progress, not Rounds + Additional Reps. The
    // caller passes the resolved rep-only station list (structured-first);
    // absent / mixed-unit -> fall back to the classic ROUNDS_REPS input.
    if (isSequentialAmrap(formatId, config) && Array.isArray(opts.sequentialAmrapStations) && opts.sequentialAmrapStations.length > 0) {
      return { kind: 'SEQUENTIAL_AMRAP', stations: opts.sequentialAmrapStations, integer: true }
    }
    return { kind: 'ROUNDS_REPS', roundsKnown: null, integer: true }
  }

  if (mode === 'fortime_or_amrap') {
    const legacyCap = Number(opts.legacyDurationSec)
    const cap = timeCapOf(config)
      || (TIME_CAP_LABEL_FORMAT_IDS.includes(formatId) && Number.isFinite(legacyCap) && legacyCap > 0 ? legacyCap : null)
    const sequential = isSequentialFormat(formatId, config)
    const roundsKnown = parseInt(config.rounds, 10) || null
    if (cap) return { kind: 'TIME_CAPPED', timeCapSec: cap, sequential, roundsKnown, integer: true }
    return { kind: 'TIME', sequential, roundsKnown }
  }

  if (mode === 'single_value') {
    switch (opts.singleValueUnit) {
      case 'reps': return { kind: 'REPS', integer: true }
      case 'load': return { kind: 'LOAD', unit: opts.unit || 'kg' }
      case 'calories': return { kind: 'CALORIES', unit: 'cal', integer: true }
      case 'distance': return { kind: 'DISTANCE', unit: opts.unit || 'm' }
      default: return { kind: 'FREE' }
    }
  }

  // Any other / mixed format whose main work resolves elsewhere — a plain time
  // field is the safe universal default (matches FormatLogger's own fallthrough).
  return { kind: 'TIME' }
}

/** Map an already-persisted log back to the ScoreDefinition kind that produced
 * it — used only for the EDIT flow so an old result opens with the right input.
 * Never changes the stored meaning. */
export function scoreKindForExistingLog(log, formatId, formatConfig) {
  const def = scoreDefinitionFor(formatId, formatConfig, {})
  // A capped duration log (completion_state 'capped' or legacy: no time, has a
  // rounds-style result) always edits as the capped branch even if the format
  // now shows no cap.
  if ((def.kind === 'TIME' || def.kind === 'TIME_CAPPED')) {
    const capped = log?.completion_state === 'capped'
      || (log?.completion_state == null && !log?.time_result && !!(log?.result || '').trim())
    if (capped) return { ...def, kind: 'TIME_CAPPED', timeCapSec: def.timeCapSec || null }
  }
  return def
}
