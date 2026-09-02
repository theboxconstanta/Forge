// P11.1 — deterministic semantic diff: AI-normalized workout baseline vs the
// final canonical workout the coach saved.
//
// PURE. No React / Supabase / I/O. Ported byte-for-byte to
// forge-admin-web/src/features/programming/aiProvenanceDiff.ts (the established
// Forge pattern: workoutIntelligence.js<->.ts, prescriptionContract.js<->.ts).
// Both repos share sectionParityFixtures and a parity test.
//
// INPUT: two `EditableSection[]` (a.k.a. `wodSections`) arrays — the SAME shape
// the Builder holds. `baseline` = sectionsFromAiAnalysis(analysis) captured at
// the moment the draft entered the Builder. `final` = the sections at Save.
//
// OUTPUT: { deltas: [...], counts: {...}, severity, outcome }
//
// SEVERITY (owner-approved, deterministic — mission section 10):
//   NONE     - structurally identical
//   COSMETIC - name canonicalises to the same movement / whitespace / case /
//              note / title change only
//   SEMANTIC - a numeric field changed, or a movement was added/removed/reordered
//   CRITICAL - format / structure / score-family changed, or a movement was
//              substituted (different canonical identity), or a scored section
//              was added/removed
//
// OUTCOME: NONE -> accepted_unchanged; COSMETIC -> accepted_cosmetic;
//          SEMANTIC|CRITICAL -> accepted_semantic.
//
// Movement identity (mission section 31): canonicalMovementId when both sides
// have one, else a normalised-name comparison; repeated movements stay distinct
// by position. Display-text equality is NEVER the only comparator.

const SEV_ORDER = { none: 0, cosmetic: 1, minor: 2, semantic: 3, critical: 4 }
const maxSev = (a, b) => (SEV_ORDER[a] >= SEV_ORDER[b] ? a : b)

// Normalised movement name — lowercase, strip punctuation, collapse spaces,
// naive singular. A name change that normalises to the same token is COSMETIC.
export function normMovementName(s) {
  return String(s || '')
    .toLowerCase()
    .replace(/[^a-z0-9&\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/s$/, '')
}

const numOr = (v) => {
  const n = typeof v === 'number' ? v : parseFloat(v)
  return Number.isFinite(n) ? n : null
}

// Resolve a metric spec ({mode,value,male,female,unit} | number | null) to a
// stable comparable tuple.
function specTuple(spec) {
  if (spec == null) return null
  if (typeof spec === 'number') return [spec, null, null]
  const u = spec.unit ?? null
  if (spec.mode === 'text') return ['text:' + (spec.text ?? ''), null, u]
  const v = numOr(spec.value)
  const m = numOr(spec.male)
  const f = numOr(spec.female)
  if (v != null) return [v, null, u]
  if (m != null || f != null) return [null, [m, f], u]
  return null
}
const tupleEq = (a, b) => JSON.stringify(a) === JSON.stringify(b)

// One scored section's structural signature (order-independent of variants;
// primary vs supporting handled by the caller).
function sectionFormatSig(sec) {
  const cfg = sec?.formatConfig || {}
  return {
    format: sec?.format ?? null,
    structure: cfg.structure ?? null,
    scoreType: sec?.scoreType ?? sec?.score_type ?? null,
    durationSec: numOr(cfg.durationSec) ?? numOr(cfg.timeCapSec) ?? numOr(cfg.totalDurationSec)
      ?? (sec?.durationMin != null ? (numOr(sec.durationMin) || 0) * 60 + (numOr(sec.durationSec) || 0) : null),
    restSec: numOr(cfg.restSec),
    rounds: numOr(cfg.roundCount) ?? numOr(cfg.rounds) ?? numOr(cfg.totalRounds),
  }
}

// The ordered movement instance list for a variant (rx by default — the tier
// AI actually produces; other tiers are compared only if the baseline had them,
// mission section on VARIANT ACCURACY / "never penalise empty tiers").
function variantInstances(sec, key) {
  const v = (sec?.variants || {})[key]
  const list = Array.isArray(v?.instances) && v.instances.length ? v.instances
    : Array.isArray(v?.movements) ? v.movements.map((m) => ({ name: m })) : []
  return list.map((inst) => ({
    name: inst?.name ?? '',
    canonicalMovementId: inst?.canonicalMovementId ?? inst?.canonical_movement_id ?? null,
    reps: specTuple(inst?.reps),
    load: specTuple(inst?.load),
    distance: specTuple(inst?.distance),
    calories: specTuple(inst?.calories),
  }))
}

function movementIdentityEqual(a, b) {
  if (a.canonicalMovementId && b.canonicalMovementId) return a.canonicalMovementId === b.canonicalMovementId
  return normMovementName(a.name) === normMovementName(b.name)
}

// Diff one variant's ordered movement list. Positional (mission section 31):
// index i vs index i. A same-position identity mismatch = substitution
// (CRITICAL). Length change at the tail = add/remove (SEMANTIC). A pure
// reorder (same multiset, different order) = SEMANTIC 'movement_reordered'.
function diffMovements(sectionIdx, variantKey, base, fin) {
  const deltas = []
  const push = (kind, severity, extra) => deltas.push({ section: sectionIdx, variant: variantKey, kind, severity, ...extra })

  const baseKeys = base.map((m) => (m.canonicalMovementId || normMovementName(m.name)))
  const finKeys = fin.map((m) => (m.canonicalMovementId || normMovementName(m.name)))
  const sameMultiset = baseKeys.length === finKeys.length
    && [...baseKeys].sort().join('|') === [...finKeys].sort().join('|')
  if (sameMultiset && baseKeys.join('|') !== finKeys.join('|')) {
    push('movement_reordered', 'semantic', { from: baseKeys, to: finKeys })
    return deltas
  }

  const n = Math.max(base.length, fin.length)
  for (let i = 0; i < n; i++) {
    const a = base[i], b = fin[i]
    if (a && !b) { push('movement_removed', 'semantic', { at: i, name: a.name }); continue }
    if (b && !a) { push('movement_added', 'semantic', { at: i, name: b.name }); continue }
    if (!movementIdentityEqual(a, b)) {
      push('movement_substituted', 'critical', { at: i, from: a.name, to: b.name })
      continue
    }
    // same identity — cosmetic name change?
    if (a.name !== b.name && normMovementName(a.name) === normMovementName(b.name)) {
      push('movement_renamed', 'cosmetic', { at: i, from: a.name, to: b.name })
    }
    for (const metric of ['reps', 'load', 'distance', 'calories']) {
      if (!tupleEq(a[metric], b[metric])) {
        push(metric === 'reps' ? 'reps_changed' : metric === 'load' ? 'load_changed'
          : metric === 'distance' ? 'distance_changed' : 'calories_changed',
          'semantic', { at: i, name: a.name, from: a[metric], to: b[metric] })
      }
    }
  }
  return deltas
}

function normTitle(s) { return String(s || '').trim().toLowerCase().replace(/\s+/g, ' ') }

/**
 * diffAiVsSaved(baseline, final) -> { deltas, counts, severity, outcome }
 * `baseline` / `final`: EditableSection[] (a.k.a. wodSections).
 */
export function diffAiVsSaved(baseline, final) {
  const base = Array.isArray(baseline) ? baseline : []
  const fin = Array.isArray(final) ? final : []
  const deltas = []
  const isScored = (s) => !!(s?.isPrimary || s?.scored)

  const n = Math.max(base.length, fin.length)
  for (let i = 0; i < n; i++) {
    const a = base[i], b = fin[i]
    if (a && !b) { deltas.push({ section: i, kind: 'section_removed', severity: isScored(a) ? 'critical' : 'semantic', type: a.typeKey }); continue }
    if (b && !a) { deltas.push({ section: i, kind: 'section_added', severity: isScored(b) ? 'critical' : 'semantic', type: b.typeKey }); continue }

    const sa = sectionFormatSig(a), sb = sectionFormatSig(b)
    if (sa.format !== sb.format) deltas.push({ section: i, kind: 'format_changed', severity: 'critical', from: sa.format, to: sb.format })
    // structure: treat null and 'Repeated Rounds' as equivalent for AMRAP (absent = repeated)
    const normStruct = (f, s) => (f === 'AMRAP' && (s == null || s === 'Repeated Rounds')) ? 'Repeated Rounds' : s
    if (normStruct(sa.format, sa.structure) !== normStruct(sb.format, sb.structure)) {
      deltas.push({ section: i, kind: 'structure_changed', severity: 'critical', from: sa.structure, to: sb.structure })
    }
    if ((sa.scoreType || null) !== (sb.scoreType || null)) deltas.push({ section: i, kind: 'score_family_changed', severity: 'critical', from: sa.scoreType, to: sb.scoreType })
    if (numOr(sa.durationSec) !== numOr(sb.durationSec)) deltas.push({ section: i, kind: 'duration_changed', severity: 'semantic', from: sa.durationSec, to: sb.durationSec })
    if (numOr(sa.restSec) !== numOr(sb.restSec)) deltas.push({ section: i, kind: 'rest_changed', severity: 'semantic', from: sa.restSec, to: sb.restSec })
    if (numOr(sa.rounds) !== numOr(sb.rounds)) deltas.push({ section: i, kind: 'rounds_changed', severity: 'semantic', from: sa.rounds, to: sb.rounds })
    if (normTitle(a.title) !== normTitle(b.title)) deltas.push({ section: i, kind: 'title_changed', severity: 'cosmetic', from: a.title, to: b.title })

    // Variants: rx always; other tiers only when the AI baseline populated them.
    const tiers = ['rx']
    for (const k of ['intermediate', 'beginner', 'onramp']) {
      if (variantInstances(a, k).length > 0) tiers.push(k)
    }
    for (const k of tiers) {
      deltas.push(...diffMovements(i, k, variantInstances(a, k), variantInstances(b, k)))
      const na = (a.variants?.[k]?.note ?? ''), nb = (b.variants?.[k]?.note ?? '')
      if (String(na).trim() !== String(nb).trim()) deltas.push({ section: i, variant: k, kind: 'note_changed', severity: 'cosmetic', from: na, to: nb })
    }
  }

  const counts = {}
  let severity = 'none'
  for (const d of deltas) {
    counts[d.kind] = (counts[d.kind] || 0) + 1
    severity = maxSev(severity, d.severity)
  }
  const outcome = severity === 'none' ? 'accepted_unchanged'
    : severity === 'cosmetic' ? 'accepted_cosmetic'
    : 'accepted_semantic'

  return { deltas, counts, severity, outcome }
}
