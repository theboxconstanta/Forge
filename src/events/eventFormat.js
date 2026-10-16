// FORGE EVENTS - display-only formatting. Never changes stored values.
import { localeFor, secToTime } from '../utils'
import { parseCappedRoundsResult, isSequentialFormat, isSequentialAmrap, partialRepsOfLog } from '../workoutFormats'
import { maxEffortUnit, maxEffortDistanceUnit } from './eventScoring'

export function formatDateTime(iso, lang) {
  if (!iso) return ''
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return ''
  return d.toLocaleString(localeFor(lang), { weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })
}

export function formatDay(iso, lang) {
  if (!iso) return ''
  return new Date(iso).toLocaleDateString(localeFor(lang), { day: 'numeric', month: 'short' })
}

/** "Sat 7 Nov, 10:00 - 16:00" / "Sat 7 Nov, 10:00 → Sat 30 Nov, 23:59". */
export function formatEventWhen(event, lang) {
  const start = formatDateTime(event.starts_at, lang)
  if (!event.ends_at) return start
  const s = new Date(event.starts_at)
  const e = new Date(event.ends_at)
  const sameDay = s.getFullYear() === e.getFullYear() && s.getMonth() === e.getMonth() && s.getDate() === e.getDate()
  if (sameDay) return `${start} – ${e.toLocaleTimeString(localeFor(lang), { hour: '2-digit', minute: '2-digit' })}`
  return `${start} → ${formatDateTime(event.ends_at, lang)}`
}

/** Time cap of the event workout, if configured (display only). */
export function eventTimeCapText(event) {
  const cfg = event.workout_format_config || {}
  const cap = parseInt(cfg.timeCapSec, 10) || parseInt(cfg.durationSec, 10) || null
  return cap ? secToTime(cap) : null
}

const leadingNumber = (str) => (str || '').match(/^(\d+(\.\d+)?)/)?.[1] || null

/**
 * One attempt's score as the member should read it, localized. The stored
 * text keeps FORGE's canonical grammar ("7 runde + 12", "143 reps"); only the
 * display is translated. Format/config = the attempt's frozen snapshot.
 */
export function attemptScoreText(attempt, s) {
  const formatId = attempt.format_snapshot
  const config = attempt.format_config_snapshot || {}
  const capped = attempt.completion_state === 'capped'
  if (attempt.time_result) return attempt.time_result
  if (!attempt.result) return '—'
  if (formatId === 'Max Effort') {
    const unit = maxEffortUnit(config)
    const suffix = unit === 'load' ? (attempt.weight_unit || 'kg')
      : unit === 'reps' ? s.repsWord
      : unit === 'calories' ? 'cal'
      : maxEffortDistanceUnit(unit) || ''
    return suffix ? `${attempt.result} ${suffix}` : attempt.result
  }
  if (isSequentialAmrap(formatId, config) || isSequentialFormat(formatId, config)) {
    const total = isSequentialAmrap(formatId, config) ? partialRepsOfLog({ result: attempt.result }, true) : leadingNumber(attempt.result)
    return `${total} ${s.repsWord}${capped ? ` · ${s.capped}` : ''}`
  }
  const { rounds, additional } = parseCappedRoundsResult(attempt.result)
  if (rounds === '') return attempt.result
  const text = additional ? `${rounds} ${s.roundsWord} + ${additional}` : `${rounds} ${s.roundsWord}`
  return capped ? `${text} · ${s.capped}` : text
}

/** "Score: Load (kg/lb)" for a Max Effort event; null for every other format. */
export function maxEffortScoreTypeText(event, s) {
  if (event.workout_format !== 'Max Effort') return null
  const unit = maxEffortUnit(event.workout_format_config)
  return unit ? `${s.scoreTypeLabel}: ${s.scoreTypes[unit]}` : null
}
