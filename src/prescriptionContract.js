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

/** Convenience: resolve + render one variant's whole movement list for a member. */
export function resolveVariantForMember(doc, variantKey, gender) {
  const vObj = doc?.variants?.[variantKey]
  if (!vObj || !Array.isArray(vObj.movements)) return null
  return vObj.movements.map((mv) => resolveMovementInstance(mv, gender))
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
  if (s === null || s === undefined) return null
  const n = parseFloat(String(s).replace(',', '.'))
  return Number.isFinite(n) ? n : null
}

function titleWord(s) {
  // Preserve the coach's own casing (mission: "preserve user input safely") -
  // only normalise the DB/KB abbreviations. A catalog match replaces the name
  // with the canonical form instead; this branch is the no-match fallback.
  return String(s).trim().replace(/\bdb\b/gi, 'DB').replace(/\bkb\b/gi, 'KB')
}
