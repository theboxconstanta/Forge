import { legacyHeaderTypeOf } from './workoutFormats'
import { snapshotLoadStandard } from './prescriptionContract'
import { resolveAthleteGenderKey } from './rxEngine'

// P10 - HISTORICAL RESULT PROVENANCE RESOLVER. The one shared pure resolver for
// "what was the PRESCRIBED side of this result, as frozen at log time". Every
// historical-result reader (leaderboard classification + sort + score
// interpretation, Journal `isNotRxd`, `onEditWod` reopen, benchmark badge) must
// prefer per-log frozen provenance over the mutable current `wods` row, so a
// coach editing a workout after an athlete logs it cannot re-bucket / re-badge /
// re-rank / re-interpret that historical result.
//
// Hierarchy (owner-approved, Option A for legacy weight):
//   FORMAT / CONFIG  : format_snapshot / format_config_snapshot
//                      -> log.wods (current) / format_type / notes-header ONLY
//                         when NO format_snapshot exists (pre-Scoring-Phase-0 legacy)
//   MOVEMENTS        : movements_snapshot (the trigger freezes the RX text[])
//                      -> null for a NON-RX variant (the trigger only froze RX)
//                         or when absent  ==  no `movementsChanged` term
//                      (NEVER the current `wods.movements_<v>` for history)
//   PRESCRIBED LOAD  : snapshotLoadStandard(prescription_snapshot)  (number|'multi'|null)
//                      -> NULL for a legacy log with no structured snapshot:
//                         the weight-below-standard term is SKIPPED (Option A -
//                         do not invent a historical prescribed load from today's
//                         wods.<v>_weight_<sex>). 'multi' also -> null (no single
//                         standard). Returned as a STRING for isNotRxd /
//                         isMixedCategory, or null.
//   GENDER           : prescription_snapshot.gender (frozen)
//                      -> resolveAthleteGenderKey(log.profile.gender) only when
//                         no structured snapshot exists (legacy - unavoidable).
//
// Pure - reads only the log's own persisted columns (snapshots + notes header +
// profile gender fallback), never React state or the live workout.
export function resolveResultProvenance(log) {
  const empty = { formatId: null, formatConfig: null, prescribedMovements: null, prescribedWeight: null, gender: null, source: 'legacy-none' }
  if (!log) return empty

  const linii = ((log.notes || '').split('\n---\n')[0] || '').trim().split('\n').filter(Boolean)
  const headerFormatId = linii.length > 0 ? legacyHeaderTypeOf(linii[0]) : null

  const hasFrozenFormat = !!log.format_snapshot
  const formatId = log.format_snapshot || log.wods?.type || log.format_type || headerFormatId || null
  const formatConfig = hasFrozenFormat
    ? (log.format_config_snapshot ?? null)
    : (log.wods?.format_config ?? null)

  const isRx = String(log.variant_level || '').toLowerCase() === 'rx'
  const prescribedMovements = (isRx && Array.isArray(log.movements_snapshot) && log.movements_snapshot.length > 0)
    ? log.movements_snapshot
    : null

  const snap = log.prescription_snapshot
  let prescribedWeight = null
  if (snap) {
    const std = snapshotLoadStandard(snap)
    prescribedWeight = (typeof std === 'number' && Number.isFinite(std)) ? String(std) : null // 'multi'/null -> skip weight term
  }
  // Option A: NO fallback to log.wods.<v>_weight_<sex> for a legacy log.

  const gender = snap?.gender || resolveAthleteGenderKey(log.profile?.gender) || null

  return {
    formatId,
    formatConfig,
    prescribedMovements,
    prescribedWeight,
    gender,
    source: snap ? 'snapshot' : hasFrozenFormat ? 'legacy-format-only' : 'legacy-none',
  }
}
