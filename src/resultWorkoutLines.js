import { legacyHeaderTypeOf } from './workoutFormats'
import { composePerformedResultLines, snapshotDisplayLines, validatePerformedPrescription } from './prescriptionContract'
import { resolveAthleteGenderKey } from './rxEngine'

// P9.5.5 - the athlete's PERFORMED overlay as display lines, resolved against the
// FROZEN gender (prescription_snapshot.gender at log time, else the profile
// gender, else neutral) - NEVER current workout / variant / member state. null
// when there is no overlay or it is malformed.
export function resultPerformedLines(log) {
  if (log?.performed_prescription == null) return null
  const frozenGender = log?.prescription_snapshot?.gender
    || resolveAthleteGenderKey(log?.profile?.gender)
    || null
  const lines = composePerformedResultLines(log.performed_prescription, frozenGender)
  if (lines == null && import.meta.env?.DEV && !validatePerformedPrescription(log.performed_prescription).valid) {
    console.warn('[P9.5.5] malformed performed_prescription on wod_log', log?.id)
  }
  return lines
}

// P9.5.7 - the frozen movement lines held in a log's OWN `notes` text - the same
// slice parseWodLogDetails uses for the card: the first `\n---\n` segment, drop
// the format header line ("RFT · 15:00"), keep the movement lines. Pure over the
// stored string; no live workout involved.
export function notesMovementLines(notes) {
  const first = ((notes || '').split('\n---\n')[0] || '').trim()
  const linii = first ? first.split('\n').filter(Boolean) : []
  if (linii.length === 0) return []
  const headerId = legacyHeaderTypeOf(linii[0])
  return linii.slice(headerId ? 1 : 0)
}

// P9.5.7 - THE ONE shared "what workout did this athlete ACTUALLY DO?" rule for
// every athlete-result movement-detail surface (leaderboard expanded card,
// Journal card, share card). An expanded result is SELECTED VARIANT + ACTUAL
// PERFORMED WORKOUT + RESULT - the movement section must NEVER vanish just
// because the athlete did not modify the prescription. A NULL
// performed_prescription means PERFORMED AS PROGRAMMED, never "nothing to show".
//
// Source precedence - EVERY tier is frozen, log-owned provenance; the current
// mutable `wods` row is NEVER consulted (a later coach edit must not rewrite a
// saved athlete result - P10 §11/§20):
//   1. performed_prescription -> composePerformedResultLines (P9.5.5): the
//      athlete's actual performed overlay (movement substitutions + per-movement
//      load/distance/calorie edits), resolved against the FROZEN gender
//      (prescription_snapshot.gender, else the profile gender, else neutral).
//   2. prescription_snapshot.displayLine (P9.1): the frozen RESOLVED prescription
//      for the SELECTED variant - carries loads, is variant-correct, and keeps
//      movement order + repeated instances distinct.
//   3. notes movement lines: the frozen movement text captured at save -
//      variant-specific whenever the coach defined per-variant movements
//      (structured Builder OR legacy `wods.movements_<variant>` text).
//   4. movements_snapshot: the frozen movement NAMES (the DB trigger froze
//      `wods.movements_rx`). Reached ONLY when tiers 2 AND 3 are both empty -
//      which, in the real data, happens exclusively when NO per-variant movement
//      override was ever defined (a structured variant -> tier 2 fires; legacy
//      variant text -> tier 3 fires). In that state the movements are identical
//      across variants, so the RX names ARE this athlete's movements. NAMES ONLY;
//      no loads are ever synthesised.
//   5. [] : no frozen movement source at all (the oldest legacy rows -
//      movements_snapshot NULL). Keep VARIANT + RESULT, omit the movement
//      section. Never invent from the current workout.
export function resolveResultMovementLines(log) {
  if (!log) return []
  const performed = resultPerformedLines(log)
  if (Array.isArray(performed) && performed.length) return performed
  const fromSnapshot = snapshotDisplayLines(log.prescription_snapshot)
  if (fromSnapshot && fromSnapshot.length) return fromSnapshot
  const fromNotes = notesMovementLines(log.notes)
  if (fromNotes.length) return fromNotes
  if (Array.isArray(log.movements_snapshot) && log.movements_snapshot.length) {
    return log.movements_snapshot.filter((s) => s != null && String(s).trim())
  }
  return []
}
