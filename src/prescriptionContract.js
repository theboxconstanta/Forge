// PER-MOVEMENT PRESCRIPTION ENGINE — canonical shared contract (v1).
//
// Single source of truth for the structured per-movement-INSTANCE prescription
// stored in `wods.movement_prescriptions`, resolved for a member, rendered to
// text, parsed from paste, and frozen into a log snapshot.
//
// This file is PURE (no React, no Supabase, no I/O) and is PORTED BYTE-FOR-BYTE
// to forge-admin-web as `src/features/programming/prescriptionContract.ts`
// (the established Forge pattern: scalingEngine.js<->.ts, workoutEngine.js<->
// workoutMapping.ts). The shared fixture set `src/prescriptionFixtures.json` is
// checked into BOTH repos; each repo's test suite asserts identical output over
// every fixture (`prescriptionContract.parity.test`). Neither builder may
// serialize a shape the other cannot parse.
//
// Contract shape — see PER_MOVEMENT_PRESCRIPTION_ENGINE_AUDIT_AND_ARCHITECTURE.md
// §C.5 / §C.6. Mirrors the DB trigger `validate_movement_prescriptions()`
// (migration 20260829090000) exactly for structure/enum/type; completeness
// (both M/F present) is the separate publish gate below.

export const PRESCRIPTION_CONTRACT_VERSION = 1
export const VARIANT_KEYS = ['rx', 'intermediate', 'beginner', 'onramp']
export const METRIC_KEYS = ['reps', 'load', 'distance', 'calories']
export const LOAD_UNITS = ['kg', 'lb']
export const DISTANCE_UNITS = ['m', 'km', 'ft', 'mi']

// ============================================================================
// Construction
// ============================================================================

/** The empty v1 document — identical to the `wods.movement_prescriptions`
 * column default. */
export function emptyPrescriptions() {
  return { version: PRESCRIPTION_CONTRACT_VERSION, variants: {} }
}

const ID_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_'

/** Stable per-instance id, generated once when a movement row is created in the
 * builder. Survives edit / reorder / duplicate (copy gets a NEW id) / repeat /
 * Generate Variants (target gets a NEW id) / V2 mirror / log snapshot. Same
 * discipline as wodSections.js's `newSectionId()`. */
export function newInstanceId() {
  let s = 'mi_'
  const bytes = new Uint8Array(21)
  const c = globalThis.crypto
  if (c && typeof c.getRandomValues === 'function') c.getRandomValues(bytes)
  else for (let i = 0; i < 21; i++) bytes[i] = Math.floor(Math.random() * 256)
  for (let i = 0; i < 21; i++) s += ID_ALPHABET[bytes[i] % ID_ALPHABET.length]
  return s
}

/** A fresh movement instance for the builder. `capability` is the resolved
 * capability (see resolveMovementCapability) — used only to pre-seed the
 * default metric's empty spec so the coach sees the right control immediately. */
export function newMovementInstance({ name = '', canonicalMovementId = null, capability = null } = {}) {
  const inst = { instanceId: newInstanceId(), name, canonicalMovementId }
  const def = capability && capability.default
  if (def === 'reps') inst.reps = { mode: 'universal', value: null }
  else if (def === 'load') inst.load = { mode: 'sex_specific', male: null, female: null, unit: 'kg' }
  else if (def === 'distance') inst.distance = { mode: 'universal', value: null, unit: 'm' }
  else if (def === 'calories') inst.calories = { mode: 'sex_specific', male: null, female: null }
  // reps is almost always relevant alongside load — seed an empty universal reps
  if (def === 'load' && capability.allowed.includes('reps')) inst.reps = { mode: 'universal', value: null }
  return inst
}

// ============================================================================
// Capability resolution (from a `movements` catalog row)
// ============================================================================

/** Given a catalog row (or null / a gym movement never seeded), return the
 * resolved capability. `unknown` = no seeded capability → the builder shows a
 * "None | Reps | Load | Distance | Calories" chooser (default None). This is an
 * explicit unknown, never a guess. */
export function resolveMovementCapability(catalogRow) {
  const allowed = Array.isArray(catalogRow?.allowed_prescription_metrics)
    ? catalogRow.allowed_prescription_metrics.filter((m) => METRIC_KEYS.includes(m))
    : []
  const def = catalogRow?.default_prescription_metric && allowed.includes(catalogRow.default_prescription_metric)
    ? catalogRow.default_prescription_metric
    : null
  return { allowed, default: def, unknown: allowed.length === 0 }
}

// ============================================================================
// P9.3 — deterministic canonical movement identity resolution.
//
// A movement instance must resolve to the SAME catalog row (and therefore the
// same capabilities) regardless of harmless spelling — "Wall Ball" / "Wallballs"
// / "wall-ball" / "WB" are one movement. Display-name equality is NOT identity;
// the catalog row id is. Once resolved, the id is persisted on the instance and
// every later lookup goes id-first, never re-derived from display text.
//
// The catalog has ~29 deliberate duplicate rows (DB/Dumbbell, KB/Kettlebell,
// &/And). This module NEVER merges or deletes them — when a name maps to
// several rows that agree on capability it resolves deterministically to one;
// only rows that DISAGREE on capability produce an ambiguous (Review) result.
// ============================================================================

/** Fold a coach-typed or catalog movement name to a comparison key: lowercase,
 * "&" → " and ", `- _ / .` → space, strip quotes/parens/commas, collapse. */
export function normalizeMovementName(s) {
  return String(s ?? '')
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/[._/\\-]+/g, ' ')
    .replace(/['"()[\],]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
}

/** The ordered set of lookup keys a name yields (most-specific first). Aliases
 * are treated as exact (no depluralisation) since they are deliberate. */
export function movementNameKeys(name, opts = {}) {
  const isAlias = opts.isAlias === true
  const base = normalizeMovementName(name)
  if (!base) return []
  const keys = []
  const seen = new Set()
  const add = (v) => {
    const t = String(v).replace(/\s+/g, ' ').trim()
    for (const k of [t, t.replace(/ /g, '')]) {
      if (k && !seen.has(k)) { seen.add(k); keys.push(k) }
    }
  }
  add(base)
  add(base.replace(/\bdb\b/g, 'dumbbell'))
  add(base.replace(/\bdumbbell\b/g, 'db'))
  add(base.replace(/\bkb\b/g, 'kettlebell'))
  add(base.replace(/\bkettlebell\b/g, 'kb'))
  if (!isAlias) {
    add(base.replace(/(\w)s\b/g, '$1'))
    add(base.replace(/\bpush ?ups?\b/g, 'push up').replace(/\bpull ?ups?\b/g, 'pull up').replace(/\bsit ?ups?\b/g, 'sit up'))
  }
  return keys
}

function capSignature(row) {
  return (row.allowed_prescription_metrics || []).slice().sort().join('+') + '|' + (row.default_prescription_metric || '')
}

/** Build the resolver index over a set of `movements` rows. Rows keep their own
 * identity — nothing is merged. */
export function buildMovementIndex(rows) {
  const byId = new Map()
  const byKey = new Map()
  const put = (k, row) => {
    let a = byKey.get(k)
    if (!a) { a = []; byKey.set(k, a) }
    if (!a.includes(row)) a.push(row)
  }
  for (const row of rows || []) {
    if (row && row.id) byId.set(row.id, row)
    if (!row || !row.name) continue
    for (const k of movementNameKeys(row.name)) put(k, row)
    for (const a of row.aliases || []) for (const k of movementNameKeys(a, { isAlias: true })) put(k, row)
  }
  return { byId, byKey, rows: rows || [] }
}

/** Resolve a coach-visible name to ONE catalog row.
 *  - a key with a single row → that row
 *  - a key with several rows that AGREE on capability → deterministic pick
 *    (shortest canonical name, then id) — the deliberate DB dupes land here
 *  - a key whose rows DISAGREE on capability → { ambiguous: true, candidates }
 *  - nothing → null */
export function resolveCatalogMovementByName(index, name) {
  if (!index || !index.byKey) return null
  for (const k of movementNameKeys(name)) {
    const rows = index.byKey.get(k)
    if (!rows || rows.length === 0) continue
    if (rows.length === 1) return rows[0]
    const sigs = new Set(rows.map(capSignature))
    if (sigs.size === 1) {
      return [...rows].sort((a, b) => a.name.length - b.name.length || String(a.id).localeCompare(String(b.id)))[0]
    }
    return { ambiguous: true, candidates: rows.map((r) => r.name) }
  }
  return null
}

// ROW MOVEMENT PICKER (2026-09-04) - a ranked, multi-result FUZZY search over
// catalog rows for the athlete-facing performed-movement search box (Change
// movement / + Add movement, PerformedMovementSearch in App.jsx). Distinct
// from resolveCatalogMovementByName above (an exact-key lookup used for
// canonical-identity resolution during parsing) - this returns several
// candidates for a dropdown, ranked by relevance instead of the fetch's
// incidental alphabetical order. Forensic finding: a plain alphabetically-
// ordered substring filter buried the canonical "Row" (exact match) behind 5
// unrelated "___ Row" strength movements + a false-positive "...Throw" hit,
// under history's fixed 6-result cap - never a missing-catalog-entry problem.
//
// Ranking tiers (lower = better; a row keeps its BEST tier across name and
// every alias - never appears twice):
//   0 exact canonical-name match       3 exact alias match
//   1 canonical name starts with query 4 alias starts with query
//   2 canonical name contains query    5 alias contains query
// A canonical exact match is tier 0 and therefore always outranks every
// alias-only or partial-name match, including compound names that merely
// CONTAIN the query (e.g. "Medicine Ball Throw" contains "row" inside
// "throw" - it can only ever land in tier 2/5, never above tier 0/1).
//
// Tie-break within a tier: canonical name (locale compare), then id - a
// DETERMINISTIC rule independent of the rows' fetch order, not an accidental
// reliance on Array.prototype.sort's stability or the DB's ORDER BY.
//
// Reuses normalizeMovementName (case-insensitive, whitespace/punctuation-
// safe, deterministic) for both the query and every candidate string - no
// new normalization, no fuzzy edit-distance, no dependency.
export function searchPerformedMovements(rows, query, limit = 6) {
  const q = normalizeMovementName(query)
  if (!q) return []
  const scored = []
  for (const row of rows || []) {
    if (!row || !row.name) continue
    const name = normalizeMovementName(row.name)
    let tier = name === q ? 0 : name.startsWith(q) ? 1 : name.includes(q) ? 2 : null
    for (const alias of row.aliases || []) {
      const a = normalizeMovementName(alias)
      if (!a) continue
      const aTier = a === q ? 3 : a.startsWith(q) ? 4 : a.includes(q) ? 5 : null
      if (aTier !== null && (tier === null || aTier < tier)) tier = aTier
    }
    if (tier !== null) scored.push({ row, tier })
  }
  scored.sort((x, y) => x.tier - y.tier || x.row.name.localeCompare(y.row.name) || String(x.row.id).localeCompare(String(y.row.id)))
  return scored.slice(0, limit).map((s) => s.row)
}

/** Identity-first resolution for a movement INSTANCE: a persisted
 * canonicalMovementId wins outright; the display name is only the fallback for
 * an instance that has never been resolved. Identity is never re-derived from
 * text once an id is known. Returns a catalog row or null. */
export function resolveCatalogMovementForInstance(index, instance) {
  if (!index || !instance) return null
  const id = instance.canonicalMovementId
  if (id && index.byId && index.byId.has(id)) return index.byId.get(id)
  const hit = resolveCatalogMovementByName(index, instance.name)
  return hit && !hit.ambiguous ? hit : null
}

/** Capability for an instance, id-first. */
export function resolveInstanceCapability(index, instance) {
  return resolveMovementCapability(resolveCatalogMovementForInstance(index, instance))
}

/** Return `instances` with `canonicalMovementId` filled in wherever a row is
 * missing one but its name resolves deterministically. Pure — used at save time
 * so a movement confirmed once is never again resolved by fuzzy text. */
export function backfillInstanceIdentity(instances, index) {
  if (!index) return instances || []
  return (instances || []).map((inst) => {
    if (inst.canonicalMovementId) return inst
    const row = resolveCatalogMovementByName(index, inst.name)
    return row && !row.ambiguous ? { ...inst, canonicalMovementId: row.id } : inst
  })
}

/** DEV/TEST invariant — a known canonical id whose catalog row DOES carry
 * capabilities must never resolve to `unknown`. Throws in dev/test; callers
 * gate this to non-production. */
export function assertCapabilityIntegrity(index, instance) {
  const id = instance && instance.canonicalMovementId
  if (!id || !index || !index.byId || !index.byId.has(id)) return
  const row = index.byId.get(id)
  const rowHasCaps = Array.isArray(row.allowed_prescription_metrics) && row.allowed_prescription_metrics.length > 0
  if (rowHasCaps && resolveMovementCapability(row).unknown) {
    throw new Error(`[capability-integrity] movement ${id} "${row.name}" carries ${JSON.stringify(row.allowed_prescription_metrics)} but resolved to unknown`)
  }
}

// ============================================================================
// Structural validation (mirrors the DB trigger)
// ============================================================================

function isNumOrNull(v) {
  return v === null || v === undefined || (typeof v === 'number' && Number.isFinite(v))
}

/** Structure / enum / type validation only — NOT completeness. Returns
 * { valid, errors }. Must stay in lockstep with the DB trigger
 * validate_movement_prescriptions(). */
export function validateMovementPrescriptions(doc) {
  const errors = []
  const push = (m) => errors.push(m)

  if (!doc || typeof doc !== 'object' || Array.isArray(doc)) return { valid: false, errors: ['must be an object'] }
  if (doc.version !== PRESCRIPTION_CONTRACT_VERSION) push(`version must be ${PRESCRIPTION_CONTRACT_VERSION}`)
  if (!doc.variants || typeof doc.variants !== 'object' || Array.isArray(doc.variants)) {
    return { valid: false, errors: [...errors, 'variants must be an object'] }
  }

  for (const [vk, vObj] of Object.entries(doc.variants)) {
    if (!VARIANT_KEYS.includes(vk)) push(`unknown variant key "${vk}"`)
    if (!vObj || typeof vObj !== 'object' || !Array.isArray(vObj.movements)) {
      push(`variants.${vk} must be { movements: [...] }`)
      continue
    }
    const seen = new Set()
    for (const mv of vObj.movements) {
      if (!mv || typeof mv !== 'object') { push(`variants.${vk}: movement must be an object`); continue }
      const id = mv.instanceId
      if (typeof id !== 'string' || id.length === 0) { push(`variants.${vk}: movement needs a non-empty instanceId`); continue }
      if (seen.has(id)) push(`variants.${vk}: duplicate instanceId "${id}"`)
      seen.add(id)
      if (typeof mv.name !== 'string' || mv.name.length === 0) push(`variants.${vk} (${id}): needs a non-empty name`)
      if ('canonicalMovementId' in mv && mv.canonicalMovementId !== null && typeof mv.canonicalMovementId !== 'string') {
        push(`variants.${vk} (${id}): canonicalMovementId must be a string or null`)
      }
      for (const mk of METRIC_KEYS) {
        if (!(mk in mv)) continue
        const spec = mv[mk]
        if (!spec || typeof spec !== 'object') { push(`variants.${vk} (${id}).${mk}: must be an object`); continue }
        if (mk === 'reps' && spec.mode === 'text') {
          if (typeof spec.text !== 'string') push(`variants.${vk} (${id}).reps(text): text must be a string`)
          continue
        }
        if (spec.mode !== 'universal' && spec.mode !== 'sex_specific') {
          push(`variants.${vk} (${id}).${mk}: mode must be universal or sex_specific`)
          continue
        }
        if (spec.mode === 'universal') {
          if (!isNumOrNull(spec.value)) push(`variants.${vk} (${id}).${mk}.value must be a number or null`)
        } else {
          if (!isNumOrNull(spec.male)) push(`variants.${vk} (${id}).${mk}.male must be a number or null`)
          if (!isNumOrNull(spec.female)) push(`variants.${vk} (${id}).${mk}.female must be a number or null`)
        }
        if (mk === 'load' && !LOAD_UNITS.includes(spec.unit)) push(`variants.${vk} (${id}).load.unit must be one of ${LOAD_UNITS.join('/')}`)
        if (mk === 'distance' && !DISTANCE_UNITS.includes(spec.unit)) push(`variants.${vk} (${id}).distance.unit must be one of ${DISTANCE_UNITS.join('/')}`)
      }
    }
  }
  return { valid: errors.length === 0, errors }
}

/** Completeness gate for publishing/saving-live.
 *
 * `load` / `distance` / `calories` are PRESCRIPTION CHARACTERISTICS (the target
 * / intensity the athlete is judged against) — a present spec must be fully
 * filled: universal.value non-null, or BOTH sex_specific values non-null.
 * `universal` vs "one side missing" stay distinct — this only flags the
 * incomplete-draft case.
 *
 * `reps` is WORKOUT STRUCTURE (the per-movement quantity/count), not a
 * prescription characteristic — a blank reps NEVER blocks publish (the workout
 * scheme in wods.type / format_config may carry the count, e.g. 21-15-9). The
 * ONLY reps case flagged is a genuine sex_specific half-entry (one side typed,
 * the other left blank) — an obvious mistake, not a deliberate "scheme handles
 * it".
 *
 * Returns { valid, errors } with human-readable, movement-named messages.
 * `variantsToCheck` defaults to every present variant. */
export function validatePrescriptionsForPublish(doc, variantsToCheck = null) {
  const errors = []
  const struct = validateMovementPrescriptions(doc)
  if (!struct.valid) return struct
  const variants = variantsToCheck || Object.keys(doc.variants)
  const label = { reps: 'reps', load: 'load', distance: 'distance', calories: 'calories' }
  for (const vk of variants) {
    const vObj = doc.variants[vk]
    if (!vObj) continue
    for (const mv of vObj.movements) {
      for (const mk of METRIC_KEYS) {
        const spec = mv[mk]
        if (!spec) continue
        if (mk === 'reps' && spec.mode === 'text') continue
        const missM = spec.male === null || spec.male === undefined
        const missF = spec.female === null || spec.female === undefined
        if (mk === 'reps') {
          // structure, not a characteristic: only flag a sex_specific half-entry
          if (spec.mode === 'sex_specific' && (missM !== missF)) {
            errors.push(`${mv.name || 'A movement'} (${vk}): ${missM ? "men's" : "women's"} rep count is missing.`)
          }
          continue
        }
        if (spec.mode === 'universal') {
          if (spec.value === null || spec.value === undefined) errors.push(`${mv.name || 'A movement'} (${vk}): ${label[mk]} is missing a value.`)
        } else {
          if (missM && missF) errors.push(`${mv.name || 'A movement'} (${vk}): ${label[mk]} is missing.`)
          else if (missM) errors.push(`${mv.name || 'A movement'} (${vk}): men's ${label[mk]} is missing.`)
          else if (missF) errors.push(`${mv.name || 'A movement'} (${vk}): women's ${label[mk]} is missing.`)
        }
      }
    }
  }
  return { valid: errors.length === 0, errors }
}

// ============================================================================
// Member resolution + rendering
// ============================================================================

/** gender: 'male' | 'female' | null (unknown). Never defaults to male. */
export function resolveSpec(spec, gender) {
  if (!spec || typeof spec !== 'object') return null
  if (spec.mode === 'text') return { mode: 'text', text: spec.text ?? '' }
  if (spec.mode === 'universal') {
    return { mode: 'universal', value: spec.value ?? null, unit: spec.unit ?? null, bothValues: null }
  }
  // sex_specific
  const male = spec.male ?? null
  const female = spec.female ?? null
  let value = null
  if (gender === 'male') value = male
  else if (gender === 'female') value = female
  // gender null -> value stays null; caller renders bothValues
  return { mode: 'sex_specific', value, unit: spec.unit ?? null, bothValues: [male, female] }
}

function fmtNum(n) {
  if (n === null || n === undefined) return ''
  return String(n)
}

/** The display token for one resolved metric value.
 * - resolved to a member -> "45"
 * - unknown gender, sex_specific -> "45/30" (both), or the present side if one
 *   is missing (draft) */
function measureToken(resolved) {
  if (!resolved) return ''
  if (resolved.mode === 'text') return resolved.text
  if (resolved.mode === 'universal') return fmtNum(resolved.value)
  if (resolved.value !== null && resolved.value !== undefined) return fmtNum(resolved.value)
  const [m, f] = resolved.bothValues || [null, null]
  if ((m === null || m === undefined) && (f === null || f === undefined)) return ''
  if (m === null || m === undefined) return `/${fmtNum(f)}`
  if (f === null || f === undefined) return fmtNum(m)
  if (m === f) return fmtNum(m)
  return `${fmtNum(m)}/${fmtNum(f)}`
}

const DIST_UNIT_LABEL = { m: 'm', km: 'km', ft: 'ft', mi: 'mi' }

/** Resolve one movement instance for a member. Returns a stable view object the
 * renderer, logger snapshot, Journal and isNotRxd all consume — nobody
 * re-parses text, nobody re-resolves gender. */
export function resolveMovementInstance(instance, gender) {
  const reps = resolveSpec(instance.reps, gender)
  const load = resolveSpec(instance.load, gender)
  const distance = resolveSpec(instance.distance, gender)
  const calories = resolveSpec(instance.calories, gender)
  return {
    instanceId: instance.instanceId,
    name: instance.name,
    canonicalMovementId: instance.canonicalMovementId ?? null,
    reps, load, distance, calories,
    line: renderInstanceLine({ name: instance.name, reps, load, distance, calories }),
  }
}

/** Build the human line from ALREADY-RESOLVED specs (so it is identical whether
 * resolved to a member or to the gender-neutral "both" form). */
export function renderInstanceLine({ name, reps, load, distance, calories }) {
  let lead = ''
  if (reps) lead = measureToken(reps)
  else if (distance) {
    const t = measureToken(distance)
    lead = t ? `${t} ${DIST_UNIT_LABEL[distance.unit] || distance.unit || 'm'}` : ''
  } else if (calories) {
    const t = measureToken(calories)
    lead = t ? `${t} Cal` : ''
  }
  let line = lead ? `${lead} ${name}` : name
  if (load) {
    const t = measureToken(load)
    if (t) line += ` @ ${t} ${load.unit || 'kg'}`
  }
  return line
}

/** Resolve a raw INSTANCE array (not a variant doc) to display objects — the
 * same engine as resolveVariantForMember, for surfaces that hold the instance
 * list directly (the builder's Coach Preview). */
export function resolveInstancesForDisplay(instances, gender) {
  if (!Array.isArray(instances)) return null
  return instances.map((mv) => resolveMovementInstance(mv, gender))
}

/** Convenience: resolve + render one variant's whole movement list for a member. */
export function resolveVariantForMember(doc, variantKey, gender) {
  const vObj = doc?.variants?.[variantKey]
  if (!vObj || !Array.isArray(vObj.movements)) return null
  return resolveInstancesForDisplay(vObj.movements, gender)
}

/** P9 - the member-resolved DISPLAY LINES for one variant, or null when this
 * variant has no structured prescription (caller falls back to legacy text).
 * `gender`: 'male' | 'female' | null (unknown -> "45/30" both). This is the
 * single source of the member's per-movement prescription text. */
export function resolveVariantDisplayLines(doc, variantKey, gender) {
  const resolved = resolveVariantForMember(doc, variantKey, gender)
  if (!resolved || resolved.length === 0) return null
  return resolved.map((r) => r.line)
}

// ============================================================================
// P9.4 — THE one shared structured-workout presentation projection.
//
// Coach Preview, Member workout display, logger and the prescription snapshot
// ALL resolve their movement lines through resolveMovementInstance /
// renderInstanceLine. This is the single entry point every surface calls; the
// ONLY difference between them is the resolution CONTEXT:
//
//   mode 'coach'             -> gender-neutral    "20 Power Snatch @ 45/30 kg"
//   mode 'member' + gender   -> that athlete      "@ 45 kg"  /  "@ 30 kg"
//   mode 'member', no gender -> gender-neutral    (identical to coach)
//
// It owns: movement order, per-movement reps, load / distance / calorie
// formatting, universal vs sex-specific display, repeated instances, decimals,
// units. TITLE / SCHEME is the caller's format layer (workoutComposer for the
// coach preview, formatMemberScheduleLines for the member screen) — it is fed
// THESE lines instead of legacy text.
//
// Accepts EITHER `{ doc, variantKey }` (member / logger — reads
// wods.movement_prescriptions) OR `{ instances }` (the builder — holds the
// instance array directly). Returns null when there is no structured
// prescription (caller keeps its legacy text rendering).
// ============================================================================
export function composeStructuredWorkoutDisplay({ doc, variantKey, instances, mode = 'member', gender = null } = {}) {
  const effectiveGender = mode === 'coach' ? null : (gender ?? null)
  const resolved = Array.isArray(instances)
    ? (instances.length ? resolveInstancesForDisplay(instances, effectiveGender) : null)
    : resolveVariantForMember(doc, variantKey, effectiveGender)
  if (!resolved || resolved.length === 0) return null
  return { lines: resolved.map((r) => r.line), movements: resolved }
}

/** P9 - normalise a display-side scaling level ('rx'|'intermediate'|'beginner'|
 * 'on_ramp' | 'onramp' | 'RX' | ...) to the canonical contract variant key. */
export function variantKeyFromLevel(level) {
  const l = String(level || '').toLowerCase().replace(/[_\s-]/g, '')
  if (l === 'rx') return 'rx'
  if (l === 'intermediate') return 'intermediate'
  if (l === 'beginner') return 'beginner'
  if (l === 'onramp') return 'onramp'
  return null
}

// P9.1 - sentinel: this variant has >1 movement with distinct member-resolved
// loads, so there is NO single valid "prescribed weight" for it. Same string
// value as rxEngine.js's MULTI_MOVEMENT_STANDARD so isMultiMovementStandard()
// there recognises it and classifyRxStatus() returns null (no RX badge).
export const MULTI_LOAD_STANDARD = 'multi'

/** P9.1 - the single member-resolved load standard (kg) for a variant, or:
 *  - null  : no movement carries a load (bodyweight variant) -> no RX standard
 *  - 'multi': >1 movement with DISTINCT resolved loads -> no single standard,
 *            classification must stay neutral until per-movement (P10+)
 *  - number: exactly one distinct resolved load across all loaded movements
 * Built ONLY from the (frozen) structured doc - never from the legacy single
 * global weight column, which cannot represent a multi-load workout. */
export function structuredVariantLoadStandard(doc, variantKey, gender) {
  const resolved = resolveVariantForMember(doc, variantKey, gender)
  if (!resolved) return null
  const values = []
  for (const r of resolved) {
    const l = r.load
    if (!l) continue
    let v = l.value
    if (v == null && Array.isArray(l.bothValues)) v = gender === 'female' ? l.bothValues[1] : gender === 'male' ? l.bothValues[0] : null
    if (v != null) values.push(v)
  }
  if (values.length === 0) return null
  const distinct = new Set(values)
  if (distinct.size > 1) return MULTI_LOAD_STANDARD
  return values[0]
}

/** P10 - the single frozen load standard (kg) from an already-persisted
 * `wod_logs.prescription_snapshot` (the P9.1 snapshot shape:
 * `{ variant, gender, movements: [{ load: { value, unit, mode, bothValues } }] }`).
 * The snapshot's `load.value` is already resolved to the snapshot's frozen
 * gender; `bothValues` is the fallback. Returns:
 *   - null   : no snapshot / no loaded movement / value not recoverable
 *   - 'multi': >1 distinct frozen load  -> no single standard
 *   - number : exactly one distinct frozen load
 * NEVER reads the current `wods` row - this is HISTORICAL truth only. */
export function snapshotLoadStandard(prescriptionSnapshot) {
  const movements = prescriptionSnapshot?.movements
  if (!Array.isArray(movements)) return null
  const g = prescriptionSnapshot.gender ?? null
  const values = []
  for (const m of movements) {
    const l = m?.load
    if (!l) continue
    let v = (typeof l.value === 'number' && Number.isFinite(l.value)) ? l.value : null
    if (v == null && Array.isArray(l.bothValues)) {
      const cand = g === 'female' ? l.bothValues[1] : g === 'male' ? l.bothValues[0] : null
      v = (typeof cand === 'number' && Number.isFinite(cand)) ? cand : null
    }
    if (v != null) values.push(v)
  }
  if (values.length === 0) return null
  return new Set(values).size > 1 ? MULTI_LOAD_STANDARD : values[0]
}

/** P9.5.7 - the frozen RESOLVED display lines from an already-persisted
 * `wod_logs.prescription_snapshot` (P9.1 flat shape). Each movement's
 * `displayLine` was resolved at log time for the SELECTED variant + the athlete's
 * frozen gender ("15 Wallballs @ 9 kg"). Order is preserved and repeated
 * instances stay distinct (each carries its own instanceId + displayLine).
 * Historical truth only - NEVER reads the current `wods` row. null when the
 * snapshot is absent / empty / carries no usable line. */
export function snapshotDisplayLines(prescriptionSnapshot) {
  const movements = prescriptionSnapshot?.movements
  if (!Array.isArray(movements) || movements.length === 0) return null
  const lines = movements
    .map((m) => (typeof m?.displayLine === 'string' && m.displayLine.trim()) ? m.displayLine
      : (typeof m?.name === 'string' && m.name.trim()) ? m.name
      : null)
    .filter(Boolean)
  return lines.length ? lines : null
}

/** P9.1 - does this variant carry ANY load prescription? (drives whether the
 * logger shows a weight-logging field for a structured workout, independent of
 * whether a single RX standard exists). */
export function structuredVariantHasLoad(doc, variantKey, gender) {
  const resolved = resolveVariantForMember(doc, variantKey, gender)
  if (!resolved) return false
  return resolved.some((r) => !!r.load)
}

// P9.1 - VALUE snapshot (deep, structurally independent) of the structured
// prescription document, taken at "Log Score" click. The contract holds only
// plain objects / arrays / finite numbers / strings / null (no Date, Map, Set,
// functions, undefined, NaN, Infinity - verified against §C.5), so a deep clone
// is lossless. structuredClone where available (browsers + Node >=17, and the
// test env), JSON round-trip as a universal fallback. After this returns,
// NO in-place / nested / array mutation of the source can alter the result.
export function snapshotPrescriptionDoc(doc) {
  if (doc == null) return null
  try {
    if (typeof structuredClone === 'function') return structuredClone(doc)
  } catch { /* fall through */ }
  return JSON.parse(JSON.stringify(doc))
}

// ============================================================================
// P9.2 — canonical numeric input parsing.
//
// Localized decimal syntax (comma vs dot) is an INPUT concern only. Canonical
// structured prescription values stay NUMERIC (§C.5 / DB trigger: number|null).
// A coach on a comma-locale mobile keyboard types "22,5"; that means the number
// 22.5, never the string "22,5" and never "22.5".
// ============================================================================

// STRICT grammar for a COMMITTED structured prescription value: 1+ digits, then
// optionally ONE decimal group introduced by a single '.' or ','. No sign
// (negative prescriptions are not a domain value), no thousands separators, no
// trailing text, no doubled separators, no bare ".5"/"5.". Comma and dot are
// equivalent notation for the SAME number. Partial editing states ("22,",
// "22.") are handled by the UI draft layer, never committed as-is.
const PRESCRIPTION_NUMBER_RE = /^\d+(?:[.,]\d+)?$/

/** The one canonical parser for structured prescription numeric entry — shared
 * by both builders and the paste parser so comma/dot handling is identical.
 *
 *   number in           -> { value: n, ok: true }   (finite) | { ok: false }
 *   '' | null | undef    -> { value: null, ok: true }  (semantically "no value")
 *   '45' '22,5' '22.5'   -> { value: 45|22.5, ok: true }
 *   '0,5' '22,25' '7.125'-> exact decimal, ok
 *   '22,' '22..5' '2.2.5'
 *   '22abc' '--5' 'NaN'
 *   'Infinity' ',,' '..'  -> { value: null, ok: false }   (rejected, not coerced)
 *
 * Field-specific domain rules (integer-only reps/calories, > 0, …) are layered
 * on top by the caller — this function is pure syntax. */
export function parsePrescriptionNumber(raw) {
  if (typeof raw === 'number') return Number.isFinite(raw) ? { value: raw, ok: true } : { value: null, ok: false }
  if (raw === null || raw === undefined) return { value: null, ok: true }
  const t = String(raw).trim()
  if (t === '') return { value: null, ok: true }
  if (!PRESCRIPTION_NUMBER_RE.test(t)) return { value: null, ok: false }
  const n = Number(t.replace(',', '.'))
  return Number.isFinite(n) ? { value: n, ok: true } : { value: null, ok: false }
}

/** Canonical string form of a committed value, for display in an input that is
 * NOT currently being edited. Dot notation (JS canonical). */
export function formatPrescriptionNumber(v) {
  return v === null || v === undefined ? '' : String(v)
}

/** P9.2 — the draft→commit decision for one structured numeric field, shared by
 * both builders so comma / dot / partial / invalid / empty handling is
 * byte-identical. The UI component owns only a focus flag + a draft string.
 *
 *   opts.integer   reject a non-integer result (reps & calories are counts)
 *   opts.previous  last committed canonical value; returned on a rejected commit
 *                  (never a silent 0)
 *   opts.final     true on blur / row-commit: always resolves to a value
 *                  (empty -> null, invalid -> previous). false while typing: a
 *                  partial like "22," is kept in the draft, canonical untouched.
 *
 * Returns { value, commit }. commit:false => keep the draft, do not call
 * onCommit (canonical state stays as it was). */
export function resolveNumericInput(raw, opts = {}) {
  const { integer = false, previous = null, final = false } = opts
  const t = String(raw ?? '').trim()
  if (t === '') return { value: null, commit: true }
  const { value, ok } = parsePrescriptionNumber(t)
  const good = ok && value !== null && (!integer || Number.isInteger(value))
  if (good) return { value, commit: true }
  return final ? { value: previous ?? null, commit: true } : { value: previous ?? null, commit: false }
}

// ============================================================================
// P9.5.2 — PERFORMED PRESCRIPTION overlay.
//
// A `wod_logs.performed_prescription` doc records WHAT THE ATHLETE ACTUALLY DID,
// as an overlay on the frozen PROGRAMMED prescription. NULL = performed exactly
// as programmed. A non-null doc is ONE variant's structured MovementInstance
// list (the SAME per-instance shape as a `wods.movement_prescriptions` variant),
// plus an optional per-instance `substitutedFrom`. V1 permits edits to
// load / distance / calorie specs and whole-movement substitution (by
// canonicalMovementId). Round / rep STRUCTURE is never editable in V1 — the
// capped-leaderboard rep-structure policy is deferred.
//
// Mirrors the DB trigger `validate_wod_log_performed_prescription()`
// (migration 20260831090000) for structure / enum / type.
// ============================================================================

// P9.5.2A - v2 adds per-movement `sourceInstanceId` (the PROGRAMMED instance an
// entry derives from) + a `notPerformed` sentinel, enabling GLOBAL 1->N / 1->0
// performed composition. v1 docs are read with v1 (positional) semantics and are
// never rewritten. Both versions pass the DB trigger.
export const PERFORMED_PRESCRIPTION_VERSION = 2
export const PERFORMED_PRESCRIPTION_VERSIONS = [1, 2]
// The metrics the athlete-side Edit flow may change. `reps` is workout
// STRUCTURE; it only ever carries over unchanged EXCEPT that an added movement
// (P9.5.2A) may inherit its source's reps where deterministically valid (D3).
export const PERFORMED_EDITABLE_METRICS = ['load', 'distance', 'calories']

/** The initial performed draft for a variant = a deep VALUE clone of the frozen
 * programmed instances, tagged v2, each entry anchored to its own programmed
 * `instanceId` (sourceInstanceId). Returns null when the variant has no
 * structured programmed prescription (caller then hides Edit — §42 legacy).
 * Pure — the caller is responsible for having frozen `doc`. */
export function buildPerformedPrescriptionDraft({ doc, variantKey, sectionId = null }) {
  const vObj = doc?.variants?.[variantKey]
  if (!vObj || !Array.isArray(vObj.movements) || vObj.movements.length === 0) return null
  return {
    version: PERFORMED_PRESCRIPTION_VERSION,
    variantKey: variantKey ?? null,
    sectionId: sectionId ?? null,
    source: 'performed',
    movements: snapshotPrescriptionDoc(vObj.movements).map((m) => ({
      ...m,
      sourceInstanceId: m.sourceInstanceId ?? m.instanceId,
    })),
  }
}

/** Structure / enum / type validation for a performed doc — mirrors the DB
 * trigger validate_wod_log_performed_prescription(). NULL is valid (= as
 * programmed). Returns { valid, errors }. */
export function validatePerformedPrescription(doc) {
  if (doc === null || doc === undefined) return { valid: true, errors: [] }
  const errors = []
  const push = (m) => errors.push(m)
  if (typeof doc !== 'object' || Array.isArray(doc)) return { valid: false, errors: ['must be an object'] }
  const v2 = doc.version === 2
  if (!PERFORMED_PRESCRIPTION_VERSIONS.includes(doc.version)) push(`version must be one of ${PERFORMED_PRESCRIPTION_VERSIONS.join('/')}`)
  if (doc.variantKey != null && !VARIANT_KEYS.includes(doc.variantKey)) push(`variantKey invalid: "${doc.variantKey}"`)
  if (!Array.isArray(doc.movements)) return { valid: false, errors: [...errors, 'movements must be an array'] }
  const seen = new Set()
  for (const mv of doc.movements) {
    if (!mv || typeof mv !== 'object') { push('movement must be an object'); continue }
    const id = mv.instanceId
    if (typeof id !== 'string' || id.length === 0) { push('movement needs a non-empty instanceId'); continue }
    if (seen.has(id)) push(`duplicate instanceId "${id}"`)
    seen.add(id)
    if (typeof mv.name !== 'string' || mv.name.length === 0) push(`(${id}): needs a non-empty name`)
    if ('canonicalMovementId' in mv && mv.canonicalMovementId !== null && typeof mv.canonicalMovementId !== 'string') {
      push(`(${id}): canonicalMovementId must be a string or null`)
    }
    // P9.5.2A v2 - sourceInstanceId anchors the entry to a programmed instance;
    // notPerformed marks a source the athlete did not perform (sentinel entry).
    if ('sourceInstanceId' in mv && mv.sourceInstanceId != null && typeof mv.sourceInstanceId !== 'string') {
      push(`(${id}): sourceInstanceId must be a string or null`)
    }
    if ('notPerformed' in mv && typeof mv.notPerformed !== 'boolean') {
      push(`(${id}): notPerformed must be a boolean`)
    }
    if (v2 && (typeof mv.sourceInstanceId !== 'string' || mv.sourceInstanceId.length === 0)) {
      push(`(${id}): v2 movement needs a non-empty sourceInstanceId`)
    }
    if (mv.notPerformed === true) continue // sentinel carries a name only, no metric specs
    for (const mk of METRIC_KEYS) {
      if (!(mk in mv)) continue
      const spec = mv[mk]
      if (!spec || typeof spec !== 'object') { push(`(${id}).${mk}: must be an object`); continue }
      if (mk === 'reps' && spec.mode === 'text') {
        if (typeof spec.text !== 'string') push(`(${id}).reps(text): text must be a string`)
        continue
      }
      if (spec.mode !== 'universal' && spec.mode !== 'sex_specific') {
        push(`(${id}).${mk}: mode must be universal or sex_specific`)
        continue
      }
      if (spec.mode === 'universal') {
        if (!isNumOrNull(spec.value)) push(`(${id}).${mk}.value must be a number or null`)
      } else {
        if (!isNumOrNull(spec.male)) push(`(${id}).${mk}.male must be a number or null`)
        if (!isNumOrNull(spec.female)) push(`(${id}).${mk}.female must be a number or null`)
      }
      if (mk === 'load' && !LOAD_UNITS.includes(spec.unit)) push(`(${id}).load.unit must be one of ${LOAD_UNITS.join('/')}`)
      if (mk === 'distance' && !DISTANCE_UNITS.includes(spec.unit)) push(`(${id}).distance.unit must be one of ${DISTANCE_UNITS.join('/')}`)
    }
  }
  return { valid: errors.length === 0, errors }
}

/** The athlete-resolved COMPARISON view of an instance list — each metric
 * reduced to { value, unit } (or { text }) for the given gender. Equality only,
 * never display. */
function performedComparableInstances(instances, gender) {
  return (instances || []).map((mv) => {
    const r = resolveMovementInstance(mv, gender)
    const red = (m) => {
      if (!m) return null
      if (m.mode === 'text') return { text: m.text ?? '' }
      return { value: m.value ?? null, unit: m.unit ?? null }
    }
    return {
      instanceId: mv.instanceId ?? null,
      canonicalMovementId: mv.canonicalMovementId ?? null,
      name: normalizeMovementName(mv.name),
      reps: red(r.reps), load: red(r.load), distance: red(r.distance), calories: red(r.calories),
    }
  })
}

/** P9.5.2A - the ordered performed-composition GROUPS of a v2 doc: one per
 * programmed source, in programmed order, each `{ sourceInstanceId, entries,
 * notPerformed }`. `entries` are the contiguous performed movements sharing that
 * `sourceInstanceId` (a `notPerformed` group has one sentinel entry and
 * `notPerformed:true`). A v1 doc (or a v2 entry missing its anchor) falls back
 * to one group per entry keyed by its own instanceId. Pure. */
export function performedCompositionGroups(performedDoc) {
  const movements = Array.isArray(performedDoc?.movements) ? performedDoc.movements : []
  const order = []
  const byId = new Map()
  for (const mv of movements) {
    const src = (typeof mv?.sourceInstanceId === 'string' && mv.sourceInstanceId) || mv?.instanceId || null
    if (src == null) continue
    if (!byId.has(src)) { byId.set(src, { sourceInstanceId: src, entries: [], notPerformed: false }); order.push(src) }
    const g = byId.get(src)
    if (mv.notPerformed === true) g.notPerformed = true
    g.entries.push(mv)
  }
  return order.map((id) => byId.get(id))
}

/** P9.5.2A - the performed entries for one programmed source (the composition
 * that replaced / extends it). Empty array when the source is untouched-absent;
 * a single `notPerformed` sentinel when the athlete marked it not performed. */
export function performedEntriesForSource(performedDoc, sourceInstanceId) {
  const g = performedCompositionGroups(performedDoc).find((x) => x.sourceInstanceId === sourceInstanceId)
  return g ? g.entries : []
}

/** P9.5.2A - EXPAND a v2 performed doc into the flat ordered instance list that
 * feeds structured-station resolution (Sequential AMRAP `resolveSequentialAmrap
 * Stations({instances})`, structured Intervals per-cell). One entry per
 * performed movement; a NOT-PERFORMED source becomes ONE entry carrying the
 * programmed name + reps (so the station keeps its identity + target) plus
 * `notPerformed:true` (the logger pre-fills an explicit 0, distinct from
 * not-reached). `programmedInstances` = the frozen programmed variant movements
 * (for the not-performed clone + a fallback anchor). Returns null for a v1 /
 * absent doc — caller keeps the programmed station list. Pure. */
export function performedStationInstances(performedDoc, programmedInstances) {
  if (performedDoc?.version !== 2 || !Array.isArray(performedDoc.movements)) return null
  const progById = new Map((programmedInstances || []).map((p) => [p.instanceId, p]))
  const out = []
  for (const g of performedCompositionGroups(performedDoc)) {
    if (g.notPerformed) {
      const prog = progById.get(g.sourceInstanceId)
      out.push({
        instanceId: g.entries[0]?.instanceId || g.sourceInstanceId,
        sourceInstanceId: g.sourceInstanceId,
        name: prog?.name || g.entries[0]?.name || 'Movement',
        // No rep target — an explicit 0, never auto-completed as a fixed
        // station and never "not reached" (§22: contributes 0 performed reps).
        reps: null,
        notPerformed: true,
      })
      continue
    }
    for (const e of g.entries) {
      if (e.notPerformed === true) continue
      out.push({ ...e, notPerformed: false })
    }
  }
  return out
}

/** True when the performed doc resolves — for THIS athlete — to exactly the
 * programmed variant. The caller stores NULL then (§22 / §24: identical ⇒
 * performed_prescription stays NULL). `notPerformed` NEVER matches (§25).
 * v2: source-anchored (each programmed source must resolve 1→1 to itself, no
 * extra sources, programmed order). v1: positional (legacy). `gender`:
 * 'male' | 'female' | null. */
export function performedMatchesProgrammed(performedDoc, programmedDoc, variantKey, gender) {
  if (performedDoc == null) return true
  const prog = programmedDoc?.variants?.[variantKey]?.movements
  if (!Array.isArray(prog)) return false
  if (performedDoc.version === 2) {
    if ((performedDoc.movements || []).some((m) => m?.notPerformed === true)) return false
    const groups = performedCompositionGroups(performedDoc)
    if (groups.length !== prog.length) return false
    for (let i = 0; i < prog.length; i++) {
      const g = groups[i]
      if (!g || g.sourceInstanceId !== prog[i].instanceId) return false
      if (g.entries.length !== 1) return false
      const a = performedComparableInstances([g.entries[0]], gender)
      const b = performedComparableInstances([prog[i]], gender)
      if (JSON.stringify(a) !== JSON.stringify(b)) return false
    }
    return true
  }
  const a = performedComparableInstances(performedDoc.movements, gender)
  const b = performedComparableInstances(prog, gender)
  return JSON.stringify(a) === JSON.stringify(b)
}

/** Did the athlete perform a materially different workout than programmed?
 * (drives the Modified / Not-RX classification — §27). Same as
 * !performedMatchesProgrammed but tolerates a missing programmed doc (a
 * non-null performed doc alone already means "modified"). */
export function performedIsModified(performedDoc, programmedDoc, variantKey, gender) {
  if (performedDoc == null) return false
  if (!programmedDoc?.variants?.[variantKey]) return true
  return !performedMatchesProgrammed(performedDoc, programmedDoc, variantKey, gender)
}

/** Apply a whole-movement substitution to ONE performed instance. Keeps the
 * stable instanceId; adopts the target's canonical identity; records
 * `substitutedFrom` (the ORIGINAL identity, only on the FIRST substitution);
 * retains a load / distance / calorie spec only when the target movement's
 * capability still allows it (§16 / §17); never invents a metric the athlete
 * did not already have. `reps` (structure) always carries over unchanged.
 * `capability` = resolveMovementCapability(targetRow). Pure. */
export function applyPerformedSubstitution(instance, targetRow, capability) {
  const allowed = Array.isArray(capability?.allowed) ? capability.allowed : []
  const next = {
    instanceId: instance.instanceId,
    name: targetRow?.name ?? instance.name,
    canonicalMovementId: targetRow?.id ?? null,
  }
  if (instance.sourceInstanceId != null) next.sourceInstanceId = instance.sourceInstanceId
  if (instance.reps) next.reps = instance.reps
  for (const mk of PERFORMED_EDITABLE_METRICS) {
    if (instance[mk] && (allowed.length === 0 || allowed.includes(mk))) next[mk] = instance[mk]
  }
  next.substitutedFrom = instance.substitutedFrom ?? {
    canonicalMovementId: instance.canonicalMovementId ?? null,
    name: instance.name,
  }
  return next
}

/** P9.5.2A - append a performed movement under `sourceInstanceId`, directly
 * after the last entry already sharing that source (§13/§14). Fresh instanceId;
 * inherits the source's `reps` when `inheritReps` (D3 - caller decides per score
 * family); seeds ONLY the metric specs the target movement's capability allows
 * (§37), empty. Pure — returns a new doc. No-op (returns doc) when the doc is not
 * v2 or the source is unknown. */
export function addPerformedMovement(performedDoc, sourceInstanceId, targetRow, capability, { inheritReps = false } = {}) {
  if (performedDoc?.version !== 2 || !Array.isArray(performedDoc.movements)) return performedDoc
  const movements = performedDoc.movements
  const srcEntry = movements.find((m) => (m.sourceInstanceId ?? m.instanceId) === sourceInstanceId && m.notPerformed !== true)
  const allowed = Array.isArray(capability?.allowed) ? capability.allowed : []
  const added = {
    instanceId: newInstanceId(),
    sourceInstanceId,
    name: targetRow?.name ?? '',
    canonicalMovementId: targetRow?.id ?? null,
  }
  // D3 - inherit the source's reps as the INITIAL DEFAULT (editable after),
  // only when the target movement's capability actually counts reps (§R13).
  if (inheritReps && srcEntry?.reps && (allowed.length === 0 || allowed.includes('reps'))) {
    added.reps = snapshotPrescriptionDoc(srcEntry.reps)
  }
  for (const mk of PERFORMED_EDITABLE_METRICS) {
    if (allowed.includes(mk)) {
      added[mk] = mk === 'load' ? { mode: 'universal', value: null, unit: 'kg' }
        : mk === 'distance' ? { mode: 'universal', value: null, unit: 'm' }
        : { mode: 'universal', value: null }
    }
  }
  let lastIdx = -1
  movements.forEach((m, i) => { if ((m.sourceInstanceId ?? m.instanceId) === sourceInstanceId) lastIdx = i })
  const next = movements.slice()
  next.splice(lastIdx >= 0 ? lastIdx + 1 : movements.length, 0, added)
  return { ...performedDoc, movements: next }
}

/** P9.5.2A - remove ONE performed entry by instanceId. Does NOT allow emptying a
 * source's composition: when the entry is the last non-sentinel one for its
 * source, the doc is returned UNCHANGED and `blockedLastMovement` is true — the
 * caller must offer "Mark not performed" instead (§20 / D2=B). Pure. */
export function deletePerformedMovement(performedDoc, instanceId) {
  if (performedDoc?.version !== 2 || !Array.isArray(performedDoc.movements)) {
    return { doc: performedDoc, blockedLastMovement: false }
  }
  const target = performedDoc.movements.find((m) => m.instanceId === instanceId)
  if (!target) return { doc: performedDoc, blockedLastMovement: false }
  const src = target.sourceInstanceId ?? target.instanceId
  const siblings = performedDoc.movements.filter((m) => (m.sourceInstanceId ?? m.instanceId) === src && m.notPerformed !== true)
  if (siblings.length <= 1) return { doc: performedDoc, blockedLastMovement: true }
  return {
    doc: { ...performedDoc, movements: performedDoc.movements.filter((m) => m.instanceId !== instanceId) },
    blockedLastMovement: false,
  }
}

/** P9.5.2A (D2=B) - mark a programmed source NOT PERFORMED: drop its entries,
 * insert ONE sentinel `{ notPerformed:true }` carrying the programmed name for
 * display. Never `0 reps`, never `[]` (§21/§22). Pure. */
export function markSourceNotPerformed(performedDoc, sourceInstanceId, programmedName) {
  if (performedDoc?.version !== 2 || !Array.isArray(performedDoc.movements)) return performedDoc
  const kept = []
  let inserted = false
  for (const m of performedDoc.movements) {
    const isSrc = (m.sourceInstanceId ?? m.instanceId) === sourceInstanceId
    if (!isSrc) { kept.push(m); continue }
    if (!inserted) {
      kept.push({
        instanceId: newInstanceId(),
        sourceInstanceId,
        name: programmedName || m.name || 'Movement',
        canonicalMovementId: null,
        notPerformed: true,
      })
      inserted = true
    }
  }
  return { ...performedDoc, movements: kept }
}

/** P9.5.2A (§23) - restore a NOT-PERFORMED source to a single performed entry
 * cloned from the frozen programmed instance. Pure. */
export function restoreSourcePerformed(performedDoc, sourceInstanceId, programmedInstance) {
  if (performedDoc?.version !== 2 || !Array.isArray(performedDoc.movements)) return performedDoc
  const clone = programmedInstance
    ? { ...snapshotPrescriptionDoc(programmedInstance), sourceInstanceId }
    : null
  const out = []
  let done = false
  for (const m of performedDoc.movements) {
    const isSrc = (m.sourceInstanceId ?? m.instanceId) === sourceInstanceId
    if (!isSrc) { out.push(m); continue }
    if (!done && clone) out.push(clone)
    done = true
  }
  return { ...performedDoc, movements: out }
}

/** Set one editable metric's universal value on a performed instance (the
 * athlete-side Edit control writes a single value — their own performed load,
 * not a sex-split). Keeps the spec's unit; drops the spec entirely when the
 * value is cleared to null AND the programmed instance had no such spec... but
 * we keep it as {value:null} so equality can still detect "cleared vs
 * programmed". `metric` ∈ PERFORMED_EDITABLE_METRICS. Pure. */
export function setPerformedMetricValue(instance, metric, value, unit) {
  const prev = instance[metric] || {}
  const nextSpec = { mode: 'universal', value: value ?? null }
  if (metric === 'load') nextSpec.unit = unit || prev.unit || 'kg'
  if (metric === 'distance') nextSpec.unit = unit || prev.unit || 'm'
  return { ...instance, [metric]: nextSpec }
}

/** P9.5.5 - the movement DISPLAY LINES for an ATHLETE RESULT card, projected
 * from a persisted `wod_logs.performed_prescription` overlay. Athlete-edited
 * metrics are stored `universal` (a single performed value); untouched metrics
 * keep their `sex_specific` spec and are resolved against `gender` - which MUST
 * be the FROZEN gender (`prescription_snapshot.gender` at log time), never the
 * athlete's current gender. Returns lines, or null when the doc is null /
 * structurally invalid / empty (caller then keeps its programmed rendering -
 * fail closed). Pure. Same rendering engine as the member workout screen / logger
 * / snapshot (P9.4 `composeStructuredWorkoutDisplay`). */
export function composePerformedResultLines(performedDoc, gender, opts = {}) {
  if (performedDoc == null) return null
  if (!validatePerformedPrescription(performedDoc).valid) return null
  if (!Array.isArray(performedDoc.movements) || performedDoc.movements.length === 0) return null
  const notPerformedSuffix = opts.notPerformedSuffix || '— not performed'
  // P9.5.2A - a v2 doc can carry `notPerformed` sentinels (no metric specs) and
  // an arbitrary 1->N composition. Render group by group, in array order: real
  // entries through the shared engine, a sentinel as "Name — not performed".
  const groups = performedDoc.version === 2
    ? performedCompositionGroups(performedDoc)
    : [{ entries: performedDoc.movements, notPerformed: false }]
  const lines = []
  for (const g of groups) {
    if (g.notPerformed) {
      const nm = g.entries[0]?.name || 'Movement'
      lines.push(`${nm} ${notPerformedSuffix}`.trim())
      continue
    }
    const real = g.entries.filter((e) => e.notPerformed !== true)
    if (real.length === 0) continue
    const display = composeStructuredWorkoutDisplay({ instances: real, mode: 'member', gender: gender ?? null })
    if (display && Array.isArray(display.lines)) lines.push(...display.lines)
  }
  return lines.length ? lines : null
}

// ============================================================================
// Legacy artifacts — regenerated from structure on every save (never read as
// truth). Keeps `wods.movements_{variant}` text[] and the 8 global weight
// columns populated for legacy readers.
// ============================================================================

/** For one variant's movement list, produce the legacy `movements_{variant}`
 * text lines (gender-neutral) + a lossy `{male,female}` global weight mirror
 * (first load-bearing movement).
 *
 * P9 PRE-GUARD (owner-required, 2026-08-29): `opts.inlineLoad` defaults FALSE,
 * so the regenerated legacy line is PLAIN ("20 Snatch", no `@ x/y`). A
 * structured workout's pre-P9 legacy render is then plain lines + one weight
 * badge = the exact status quo for any multi-weighted workout today, with no
 * confusing gender-neutral inline value competing with the badge. The full
 * per-movement prescription is preserved in `movement_prescriptions` and is
 * surfaced by the P9 structured member renderer. P9's member render never reads
 * these lines for a structured workout, so this stays FALSE. */
export function buildLegacyArtifactsForVariant(movements, opts = {}) {
  const inlineLoad = opts.inlineLoad === true
  const lines = (movements || []).map((mv) => {
    const resolved = {
      name: mv.name,
      reps: resolveSpec(mv.reps, null),
      load: inlineLoad ? resolveSpec(mv.load, null) : null,
      distance: resolveSpec(mv.distance, null),
      calories: resolveSpec(mv.calories, null),
    }
    return renderInstanceLine(resolved)
  })
  let weightMale = null
  let weightFemale = null
  for (const mv of movements || []) {
    if (mv.load && (mv.load.male != null || mv.load.female != null || mv.load.value != null)) {
      if (mv.load.mode === 'universal') { weightMale = fmtNum(mv.load.value); weightFemale = fmtNum(mv.load.value) }
      else { weightMale = fmtNum(mv.load.male); weightFemale = fmtNum(mv.load.female) }
      if (mv.load.unit && mv.load.unit !== 'kg') {
        if (weightMale) weightMale += mv.load.unit
        if (weightFemale) weightFemale += mv.load.unit
      }
      break
    }
  }
  return { lines, weightMale: weightMale || null, weightFemale: weightFemale || null }
}

// ============================================================================
// Log-time snapshot (P9 will call this from the frozen INC-04 logCtx)
// ============================================================================

/** Build the immutable prescription_snapshot from an ALREADY-FROZEN prescription
 * doc + variant + section + member gender. Pure — the caller is responsible for
 * having frozen `doc` at "Log Score" click; this never reads live state.
 * `source`: 'structured' | 'legacy_global' | 'legacy_text' — recorded so
 * downstream readers know the fidelity tier. */
export function buildPrescriptionSnapshot({ doc, variantKey, gender, resolvedAt, source = 'structured' }) {
  const movements = (resolveVariantForMember(doc, variantKey, gender) || []).map((r) => {
    const out = { instanceId: r.instanceId, name: r.name, canonicalMovementId: r.canonicalMovementId, displayLine: r.line }
    if (r.reps) out.reps = r.reps.mode === 'text' ? { text: r.reps.text } : { value: r.reps.value ?? null }
    if (r.load) out.load = { value: r.load.value ?? null, unit: r.load.unit || 'kg', mode: r.load.mode, bothValues: r.load.bothValues }
    if (r.distance) out.distance = { value: r.distance.value ?? null, unit: r.distance.unit || 'm', mode: r.distance.mode, bothValues: r.distance.bothValues }
    if (r.calories) out.calories = { value: r.calories.value ?? null, mode: r.calories.mode, bothValues: r.calories.bothValues }
    return out
  })
  return {
    version: PRESCRIPTION_CONTRACT_VERSION,
    variant: variantKey ?? null,
    gender: gender ?? null,
    resolvedAt: resolvedAt ?? null,
    source,
    movements,
  }
}

/** Does this variant have any structured prescription at all? (drives the
 * "use structured vs legacy fallback" decision in the member/logger paths) */
export function variantHasStructuredPrescription(doc, variantKey) {
  const vObj = doc?.variants?.[variantKey]
  return !!(vObj && Array.isArray(vObj.movements) && vObj.movements.length > 0)
}

/** P8 - one-way `wods` -> Workout Engine V2 mirror. Maps a variant's structured
 * instances into the `workout_sections.movements` jsonb shape the V2 tables
 * already declare (`{ name, reps, weight, distance, calories, equipment,
 * canonicalName }`), enriched with `instanceId` + the full structured
 * `prescription`. Gender-neutral (both values), since the V2 row is shared by
 * every member; member resolution still happens at read time via
 * resolveMovementInstance. Returns [] for an absent/empty variant. */
export function movementObjectsForV2(instances) {
  return (instances || []).map((mv) => {
    const reps = resolveSpec(mv.reps, null)
    const load = resolveSpec(mv.load, null)
    const distance = resolveSpec(mv.distance, null)
    const calories = resolveSpec(mv.calories, null)
    return {
      name: mv.name,
      instanceId: mv.instanceId ?? null,
      canonicalName: mv.canonicalMovementId ?? null,
      reps: reps ? (reps.mode === 'text' ? reps.text : measureToken(reps)) : null,
      weight: load ? `${measureToken(load)}${load.unit || 'kg'}` : null,
      distance: distance ? `${measureToken(distance)}${distance.unit || 'm'}` : null,
      calories: calories ? measureToken(calories) : null,
      equipment: [],
      prescription: {
        reps: mv.reps ?? null,
        load: mv.load ?? null,
        distance: mv.distance ?? null,
        calories: mv.calories ?? null,
      },
    }
  })
}

// ============================================================================
// Paste parser — text -> structured rows (P7 wires the UI; the parser lives
// here so both repos share it and it is unit-tested in isolation)
// ============================================================================

const CARDIO_DISTANCE_ONLY = /\b(run|running|sprint|shuttle|swim|jog)\b/i
const CARDIO_CAL_CAPABLE = /\b(row|rower|erg|ski\s?erg|bike\s?erg|assault\s?bike|echo\s?bike|air\s?bike|bike)\b/i

/** Parse one pasted line into a best-effort structured instance.
 * `lookupCanonical(name) -> { id, name, capability } | null` (optional) lets the
 * caller resolve catalog identity + capability; without it the parser still
 * produces structure, just with canonicalMovementId null.
 * `confident` is false when the movement name isn't recognised or the tokens are
 * ambiguous — the UI shows a "Review" chip and never invents values. */
export function parsePastedMovementLine(rawLine, { lookupCanonical } = {}) {
  const raw = (rawLine || '').trim()
  if (!raw) return null
  const lookup = typeof lookupCanonical === 'function' ? lookupCanonical : () => null

  // load suffix: "... @ 45/30 kg" | "... 45/30kg" | "... @ 45 kg"
  let body = raw
  let load = null
  const lm = body.match(/(?:@\s*)?(\d+(?:[.,]\d+)?)\s*\/\s*(\d+(?:[.,]\d+)?)\s*(kg|lb|lbs)\b\s*\)?\s*$/i)
    || body.match(/(?:@\s*)(\d+(?:[.,]\d+)?)\s*(kg|lb|lbs)\b\s*\)?\s*$/i)
  if (lm) {
    const unit = /lb/i.test(lm[lm.length - 1]) ? 'lb' : 'kg'
    if (lm.length === 4) {
      load = { mode: 'sex_specific', male: num(lm[1]), female: num(lm[2]), unit }
    } else {
      load = { mode: 'universal', value: num(lm[1]), unit }
    }
    body = body.slice(0, lm.index).trim().replace(/[@(]\s*$/, '').trim()
  }

  // leading calories: "15/12 Cal Row" | "20 Cal Row"
  let calories = null
  let distance = null
  let reps = null
  const calM = body.match(/^(\d+(?:[.,]\d+)?)\s*\/\s*(\d+(?:[.,]\d+)?)\s*cal(?:orie)?s?\b\s*(.*)$/i)
    || body.match(/^(\d+(?:[.,]\d+)?)\s*cal(?:orie)?s?\b\s*(.*)$/i)
  if (calM) {
    if (calM.length === 4) { calories = { mode: 'sex_specific', male: num(calM[1]), female: num(calM[2]) }; body = calM[3].trim() }
    else { calories = { mode: 'universal', value: num(calM[1]) }; body = calM[2].trim() }
  }

  // leading distance: "500 m Row" | "400m Run" | "1 km Run"
  if (!calories) {
    const dm = body.match(/^(\d+(?:[.,]\d+)?)\s*(m|km|ft|mi|meter|meters|metres)\b\s*(.*)$/i)
    if (dm) {
      const u = /^k/i.test(dm[2]) ? 'km' : /^f/i.test(dm[2]) ? 'ft' : /^mi$/i.test(dm[2]) ? 'mi' : 'm'
      distance = { mode: 'universal', value: num(dm[1]), unit: u }
      body = dm[3].trim()
    }
  }

  // leading reps: "20 Snatches" | "21-15-9 Thrusters" | "Max Snatches"
  if (!calories && !distance) {
    const rm = body.match(/^(\d+(?:[.,]\d+)?)\s+(.+)$/)
    const schemeM = body.match(/^(\d+(?:-\d+)+)\s+(.+)$/)
    const maxM = body.match(/^(max(?:\s+reps?)?)\s+(.+)$/i)
    if (schemeM) { reps = { mode: 'text', text: schemeM[1] }; body = schemeM[2].trim() }
    else if (rm) { reps = { mode: 'universal', value: num(rm[1]) }; body = rm[2].trim() }
    else if (maxM) { reps = { mode: 'text', text: 'Max' }; body = maxM[2].trim() }
  }

  const name = body.replace(/^[-–—•*]\s*/, '').trim()
  if (!name) return null

  const hit = lookup(name)
  const cap = hit?.capability || null
  // distance/calorie disambiguation for a bare cardio movement with no metric
  if (!reps && !distance && !calories) {
    if (CARDIO_DISTANCE_ONLY.test(name)) distance = { mode: 'universal', value: null, unit: 'm' }
    else if (CARDIO_CAL_CAPABLE.test(name) && cap && cap.default === 'calories') calories = { mode: 'universal', value: null }
  }

  // Confident when the catalog recognises the name OR a load/distance/calorie
  // metric was extracted. A bare "N <word>" (e.g. "3 RFT", "5 Rounds") is NOT
  // confident on its own — the UI flags it for review rather than inventing a
  // movement.
  const confident = !!hit || !!(load || distance || calories)
  const inst = {
    instanceId: newInstanceId(),
    name: hit?.name || titleWord(name),
    canonicalMovementId: hit?.id || null,
  }
  if (reps) inst.reps = reps
  if (load) inst.load = load
  if (distance) inst.distance = distance
  if (calories) inst.calories = calories
  return { instance: inst, confident, raw }
}

export function parseWorkoutPaste(text, opts = {}) {
  const lines = (text || '').split('\n').map((l) => l.trim()).filter(Boolean)
  const out = []
  for (const l of lines) {
    const parsed = parsePastedMovementLine(l, opts)
    if (parsed) out.push(parsed)
  }
  return { movements: out }
}

function num(s) {
  // The paste regexes only ever hand this a bare numeric token
  // (\d+(?:[.,]\d+)?), so the strict canonical parser accepts every real match
  // and both builders + paste share ONE decimal-normalization path (P9.2).
  return parsePrescriptionNumber(s).value
}

function titleWord(s) {
  // Preserve the coach's own casing (mission: "preserve user input safely") -
  // only normalise the DB/KB abbreviations. A catalog match replaces the name
  // with the canonical form instead; this branch is the no-match fallback.
  return String(s).trim().replace(/\bdb\b/gi, 'DB').replace(/\bkb\b/gi, 'KB')
}
