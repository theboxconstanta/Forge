// FORGE WORKOUT COMPOSER - Phase 1 (docs/design-audit-v2/WORKOUT-COMPOSER-
// ARCHITECTURE.md, WORKOUT-COMPOSER-COMPOSITE-SCORING.md, both owner-approved).
//
// Canonical Component domain contract: stable identity, explicit order,
// producesScore/scoreOwnerId semantics, score-envelope derivation, the pure
// envelope-result composer, the multi-movement once/bookend correction, and
// the legacy -> canonical read adapter. Pure functions only - no React, no
// Supabase, testable in isolation (same convention as workoutFormats.js/
// wodSections.js).
//
// COMPOSITION, NOT REIMPLEMENTATION - this file orchestrates the EXISTING
// format engines (getFormat, repsEfectiveSecvential, composePartialText from
// workoutFormats.js; hydrateInstancesFromLegacy from wodSections.js). It does
// not implement a second AMRAP/For-Time/RFT/EMOM engine, a second movement-
// identity system, or a second snapshot mechanism.
//
// NO composite leaderboard here (average placement points, double-points,
// Standard Competition Ranking, overall tie-break) - that is explicitly
// out of Phase 1 scope (WORKOUT-COMPOSER-COMPOSITE-SCORING.md), a later
// phase's concern once real Composer-authored data exists.

import { getFormat, repsEfectiveSecvential, composePartialText, WORKOUT_FORMATS } from './workoutFormats'
import { hydrateInstancesFromLegacy } from './wodSections'

// ============================================================================
// Component identity
// ============================================================================

// Same alphabet/length/crypto-random strategy as prescriptionContract.js's
// newInstanceId() (not imported - that generator is private to that module,
// and a Component's identity is a distinct concept from a MovementInstance's,
// even though both need the same "stable, unique, serialization-safe, never
// index-derived" properties). Prefixed 'cmp_' so a componentId can never be
// confused with a MovementInstance's 'mi_...'/a legacy section's 'sec-...'.
const ID_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_'
export function newComponentId() {
  let s = 'cmp_'
  const bytes = new Uint8Array(21)
  const c = globalThis.crypto
  if (c && typeof c.getRandomValues === 'function') c.getRandomValues(bytes)
  else for (let i = 0; i < 21; i++) bytes[i] = Math.floor(Math.random() * 256)
  for (let i = 0; i < 21; i++) s += ID_ALPHABET[bytes[i] % ID_ALPHABET.length]
  return s
}

// ============================================================================
// Capability defaults - format-driven, not scattered `if (format === ...)`
// ============================================================================

// producesScore answers ONLY "does this component emit an independent native
// result" - never "does it contain work" and never timer/envelope scope
// (WORKOUT-COMPOSER-ARCHITECTURE.md §15). 'Once' (Buy-In/Cash-Out-style
// bookends) and 'Rest' default to false; every other catalog format defaults
// to true. Coach-overridable EXCEPT 'Rest', which must never score (§23 of
// this ticket) - enforced in validateComponents, not silently clamped here,
// so an invalid attempt produces an actionable error rather than being
// quietly discarded.
export function defaultProducesScoreForFormat(format) {
  return format !== 'Once' && format !== 'Rest'
}

// Whether a component of this format is allowed to be a MEMBER of another
// component's score envelope (i.e. hold a non-null scoreOwnerId). Rest is
// explicitly excluded - "Rest must never become a member of another score
// envelope" (ticket §23) - via a capability flag, not a hardcoded name check
// scattered through validation.
export function canJoinScoreEnvelope(format) {
  return format !== 'Rest'
}

// ============================================================================
// Canonical Component shape (documentation - plain objects, not a class)
// ============================================================================
//
// {
//   id: string,                          // newComponentId(), stable, never array-index-derived
//   order: number,                       // explicit, canonical ordering authority - see normalizeComponentOrder
//   format: string,                      // an existing WORKOUT_FORMATS key (workoutFormats.js) - 'AMRAP','For Time','RFT','EMOM','Intervals','Once','Rest',...
//   role: 'buy-in'|'cash-out'|'main'|'stage'|null,  // PRESENTATION ONLY - reuses ComposedWorkoutView's existing role vocabulary, never read by validation/envelope/scoring logic
//   label: string|null,                  // OPTIONAL coach free-text heading override, purely cosmetic
//   producesScore: boolean,              // capability-derived default, coach-overridable (except 'Rest')
//   scoreOwnerId: string|null,           // meaningful only when producesScore===false: id of the producesScore:true component this component's execution belongs to. null = outside every envelope.
//   config: object,                      // EXACTLY WORKOUT_FORMATS[format].config shape, reused verbatim
//   instances: Array,                    // EXACTLY MovementInstance[] (prescriptionContract.js) - full prescription-engine reach, empty for 'Rest'
// }

/** Construct one component with sane defaults. `id` defaults to a fresh
 * random id (the right choice for a coach freshly authoring a new component
 * in a future Builder) but can be passed explicitly - used by the legacy
 * adapter below, which needs DETERMINISTIC ids (ticket §25: "repeatedly
 * reading the same legacy workout must not create semantic churn") rather
 * than a new random id on every read. Order is NOT assigned here - see
 * normalizeComponentOrder, the one place order is ever written, so there is
 * never a second, conflicting source of truth for ordering. */
export function createComponent({ id = null, format, role = null, label = null, producesScore, scoreOwnerId = null, config = {}, instances = [] } = {}) {
  return {
    id: id || newComponentId(),
    order: 0,
    format,
    role,
    label,
    producesScore: producesScore != null ? producesScore : defaultProducesScoreForFormat(format),
    scoreOwnerId,
    config,
    instances,
  }
}

/** The ONE place `order` is ever written - always recomputed from array
 * position. Reordering (moving an entry within the array) changes `order`
 * for the moved entries but never touches `id`/`instances`/`scoreOwnerId` on
 * any component (ticket §18.C/§25 round-trip requirement). Returns a NEW
 * array (does not mutate inputs) with NEW component objects only where the
 * order actually changed, so unrelated components keep referential identity
 * too. */
export function normalizeComponentOrder(components) {
  return (components || []).map((c, i) => (c.order === i ? c : { ...c, order: i }))
}

// ============================================================================
// Validation
// ============================================================================

// Actionable error codes (ticket §26) - one centralized validation layer
// rather than scattered `if (format === ...)` checks across screens. Every
// entry is { code, componentId, message }; `message` is a plain developer-
// facing string (no i18n key here - this is a domain contract, not UI copy;
// a future Builder surfaces its own localized copy per `code`).
export function validateComponents(components) {
  const list = components || []
  const errors = []
  const byId = new Map()

  list.forEach(c => {
    if (byId.has(c.id)) errors.push({ code: 'DUPLICATE_ID', componentId: c.id, message: `Duplicate component id: ${c.id}` })
    byId.set(c.id, c)
  })

  list.forEach(c => {
    if (!isKnownFormat(c.format)) {
      errors.push({ code: 'UNKNOWN_FORMAT', componentId: c.id, message: `Unknown format: ${c.format}` })
    }
  })

  list.forEach(c => {
    if (c.format === 'Rest' && c.producesScore) {
      errors.push({ code: 'REST_CANNOT_SCORE', componentId: c.id, message: 'Rest can never produce a score' })
    }
    if (c.producesScore && c.scoreOwnerId != null) {
      errors.push({ code: 'SCORER_CANNOT_HAVE_OWNER', componentId: c.id, message: 'A scoring component cannot itself belong to another envelope' })
    }
    if (c.scoreOwnerId == null) return
    if (c.scoreOwnerId === c.id) {
      errors.push({ code: 'SELF_OWNERSHIP', componentId: c.id, message: 'A component cannot own itself' })
      return
    }
    if (!canJoinScoreEnvelope(c.format)) {
      errors.push({ code: 'REST_CANNOT_BE_OWNED', componentId: c.id, message: `${c.format} cannot join a score envelope` })
      return
    }
    const owner = byId.get(c.scoreOwnerId)
    if (!owner) {
      errors.push({ code: 'DANGLING_OWNER', componentId: c.id, message: `scoreOwnerId references a component that does not exist: ${c.scoreOwnerId}` })
      return
    }
    if (!owner.producesScore) {
      errors.push({ code: 'OWNER_CANNOT_SCORE', componentId: c.id, message: `scoreOwnerId target does not produce a score: ${owner.id}` })
    }
  })

  // Ownership-cycle detection - defensively walks the chain even though
  // SCORER_CANNOT_HAVE_OWNER already makes a cycle structurally unreachable
  // in a model that otherwise validates clean (a scoring component can never
  // itself have a scoreOwnerId, so a chain can never loop back). Kept as an
  // explicit, independently-testable check per the ticket's own test list
  // (#10), not merely implied by the other rules.
  list.forEach(c => {
    const seen = new Set()
    let cur = c
    while (cur && cur.scoreOwnerId != null) {
      if (seen.has(cur.id)) { errors.push({ code: 'OWNERSHIP_CYCLE', componentId: c.id, message: `Ownership cycle detected starting at ${c.id}` }); break }
      seen.add(cur.id)
      cur = byId.get(cur.scoreOwnerId)
    }
  })

  // Contiguous-envelope rule (ticket §6.G / §7 ambiguity test) - every
  // envelope's members (owner + everyone whose scoreOwnerId points to it)
  // must occupy an unbroken run of `order` values. A component from a
  // DIFFERENT envelope, or with no envelope at all, sitting between two
  // members of the same envelope makes "start of envelope / end of envelope"
  // ambiguous - rejected at validation time so the envelope derivation/
  // composition functions never have to guess.
  const scorers = list.filter(c => c.producesScore)
  scorers.forEach(scorer => {
    const envelopeIds = new Set([scorer.id, ...list.filter(c => c.scoreOwnerId === scorer.id).map(c => c.id)])
    if (envelopeIds.size <= 1) return
    const sorted = [...list].sort((a, b) => a.order - b.order)
    const positions = sorted.map((c, i) => ({ id: c.id, i })).filter(p => envelopeIds.has(p.id)).map(p => p.i)
    const min = Math.min(...positions)
    const max = Math.max(...positions)
    if (max - min + 1 !== envelopeIds.size) {
      errors.push({ code: 'BROKEN_ENVELOPE_CONTIGUITY', componentId: scorer.id, message: `Envelope owned by ${scorer.id} is not contiguous in order` })
    }
  })

  return { valid: errors.length === 0, errors }
}

// getFormat() falls back to DEFAULT_FORMAT_ID for an unknown id rather than
// returning null/throwing (workoutFormats.js:338-340) - that fallback is the
// right behavior for rendering, but WRONG for validation (it would silently
// accept a typo'd format as valid). This helper makes "is `id` really a key
// in the catalog" an exact, honest check instead of relying on getFormat's
// own lenient fallback.
function isKnownFormat(id) {
  return Object.prototype.hasOwnProperty.call(WORKOUT_FORMATS, id)
}

// ============================================================================
// Score-envelope derivation (WORKOUT-COMPOSER-ARCHITECTURE.md §15.1)
// ============================================================================

/** Pure. Returns, in canonical execution order, the scoring component itself
 * plus every component whose scoreOwnerId points to it. Never mutates
 * `components`, never duplicates MovementInstances, never persists anything -
 * a read-time projection only. */
export function getScoreEnvelope(components, scoringComponentId) {
  const list = components || []
  const scorer = list.find(c => c.id === scoringComponentId)
  if (!scorer) return []
  const members = list.filter(c => c.id === scoringComponentId || c.scoreOwnerId === scoringComponentId)
  return [...members].sort((a, b) => a.order - b.order)
}

/** Every envelope in one canonical components[] list, keyed by the owning
 * (producesScore:true) component's id - including scorers with an empty/
 * self-only envelope (the common single-component case). */
export function getAllScoreEnvelopes(components) {
  const list = components || []
  const map = {}
  list.filter(c => c.producesScore).forEach(scorer => {
    map[scorer.id] = getScoreEnvelope(list, scorer.id)
  })
  return map
}

// ============================================================================
// Multi-movement once/bookend correction (Phase 0.3 Correction 1)
// ============================================================================
//
// A 'Once' component's movements are ordinary MovementInstance[] (§12/§13).
// For partial-progress capture, an instance's canonical display line is
// resolved by the SAME rule the rest of the app already uses to turn an
// instance into a legacy-shaped text line for the sequential engine
// (prescriptionContract.js's renderInstanceLine-equivalent). To keep this
// module dependency-light and because the exact rendering helper's name is
// an implementation detail of the prescription layer, Phase 1 accepts an
// already-resolved `movementLines: string[]` (what a future logger UI would
// already have on hand from the same resolution every other sequential
// format already performs) rather than re-deriving it here - avoiding a
// second, parallel "instance -> text" implementation.

/** Resolve a single 'Once' component's partial-progress result by reusing
 * the EXISTING sequential engine (repsEfectiveSecvential/composePartialText,
 * workoutFormats.js) UNCHANGED - no new partial engine. `movementLines` is
 * the component's own movements as display text (one per MovementInstance,
 * same order); `partialReps` is the parallel raw input array. Works
 * identically for a single movement (today's common Buy-In/Cash-Out case)
 * and for many (Phase 0.3 Case D/E) - there is no special-case split. */
export function resolveOnceComponentResult(movementLines, partialReps) {
  const lines = movementLines || []
  const effective = repsEfectiveSecvential(partialReps || [], lines)
  const text = composePartialText(effective, lines)
  const hasProgress = effective.some(v => (v || '').toString().trim() !== '')
  const reachedLast = lines.length > 0 && (effective[lines.length - 1] || '').toString().trim() !== ''
  return { hasProgress, text, reachedLast, effective }
}

// ============================================================================
// Envelope-result composer (WORKOUT-COMPOSER-ARCHITECTURE.md §18.1)
// ============================================================================
//
// Generalizes the EXISTING, shipped Chained-AMRAP pattern
// (composeStageResult/totalRepsChained, workoutFormats.js:641-665 - "compose
// each part's own value, walk them to build one combined thing") from
// same-format stages to heterogeneous envelope members, and the EXISTING
// composeFortimeOrAmrapFields pattern (workoutFormats.js:501-517 -
// "finishedValue present -> done, ignore partials; absent -> derive capped
// position from partials") from one format's own movements to a whole
// envelope's members.
//
// Does NOT flatten movements across components into one shared engine
// (Phase 0.3's explicitly forbidden anti-pattern) - it composes each
// member's own ALREADY-COMPUTED result (produced by that member's own
// existing native engine, untouched), never movements themselves.

/** `envelope`: ordered array from getScoreEnvelope. `finishedValue`: the
 * single native value the athlete entered for the WHOLE envelope when
 * fully finished (e.g. an elapsed time string) - present/non-blank means
 * "done", exactly mirroring composeFortimeOrAmrapFields's own
 * shouldLogRoundsInsteadOfTime rule, now applied to the envelope as a whole
 * rather than to one format's own movements. `resultByComponentId`: a map
 * of each envelope member's own already-computed result - for a 'Once'
 * member this is resolveOnceComponentResult's return shape; for the
 * scoring member it is whatever shape that format's own existing partial
 * engine already produces, normalized here to the two fields this function
 * actually reads ({hasProgress, text}) - never reinterpreting the native
 * value itself. */
export function composeEnvelopeResult({ envelope, finishedValue, resultByComponentId }) {
  const ordered = envelope || []
  const results = resultByComponentId || {}
  const finished = (finishedValue || '').toString().trim()

  if (finished) {
    return { isComplete: true, finishedValue: finished, cappedText: null, furthestComponentId: null }
  }

  let furthestComponentId = null
  let furthestIndex = -1
  ordered.forEach((c, i) => {
    const r = results[c.id]
    if (r && r.hasProgress) { furthestComponentId = c.id; furthestIndex = i }
  })

  if (furthestIndex === -1) {
    return { isComplete: false, finishedValue: null, cappedText: '', furthestComponentId: null }
  }

  const cappedText = ordered
    .slice(0, furthestIndex + 1)
    .map(c => results[c.id]?.text)
    .filter(Boolean)
    .join(', ')

  return { isComplete: false, finishedValue: null, cappedText, furthestComponentId }
}

// ============================================================================
// Legacy -> canonical read adapter (WORKOUT-COMPOSER-ARCHITECTURE.md §28)
// ============================================================================
//
// Pure, read-only projection. Never persists anything, never mutates
// `section`. A section with no Composer-specific structure at all (the
// overwhelming majority of existing/near-future workouts) always adapts to
// exactly ONE implicit component wrapping its existing format/config/
// instances verbatim - "legacy single-score equivalence" (ticket §16).

// Deterministic id for an adapter-produced component: derived from the
// section's own already-stable `id` (newSectionId(), wodSections.js) plus a
// fixed role/index suffix - NEVER from mutable display text (ticket §25).
// Two independent calls to componentsFromSection with the same `section`
// object always produce the same component ids, so re-rendering/re-reading
// an unmodified legacy workout never looks like its components were
// replaced. This is strictly more stable than legacy `section.id` itself
// (which is re-generated on every independent sectionsFromLegacyWod call) -
// an improvement, not a new source of instability.
function legacyComponentId(section, slot) {
  return `${section?.id || 'sec'}::${slot}`
}

/** `section`: a canonical section object (wodSections.js shape - the SAME
 * object `sectionsFromLegacyWod`/`createSection` already produce; this
 * function does not read raw `wods` columns directly, keeping one hydration
 * boundary). `variantKey`: 'rx'|'intermediate'|'beginner'|'onramp'. Returns
 * `components[]` with `order` already normalized. Deterministic: calling
 * this twice with the same `section` produces identical component ids
 * (ticket §25/#29) - only the movement instances underneath are freshly
 * hydrated per call (matching hydrateInstancesFromLegacy's own existing,
 * unrelated non-determinism for legacy text-line parsing, unchanged here). */
export function componentsFromSection(section, variantKey, opts = {}) {
  const format = section?.format
  const fmt = getFormat(format)
  const cfg = section?.formatConfig || {}
  const variant = section?.variants?.[variantKey] || { instances: [] }
  const instances = variant.instances || []
  const movementIndex = opts.movementIndex || null

  if (fmt.family === 'mixed') {
    const buyInLines = Array.isArray(cfg.buyIn) ? cfg.buyIn : []
    const cashOutLines = Array.isArray(cfg.cashOut) ? cfg.cashOut : []
    const isAmrapWithBuyIn = format === 'AMRAP with Buy-In'
    const mainIsAmrap = isAmrapWithBuyIn || cfg.mainFormat === 'AMRAP'
    const mainComponent = createComponent({
      id: legacyComponentId(section, 'main'),
      format: mainIsAmrap ? 'AMRAP' : 'For Time',
      role: 'main',
      producesScore: true,
      config: mainIsAmrap
        ? { durationSec: (isAmrapWithBuyIn ? cfg.totalDurationSec : cfg.mainDurationSec) || null }
        : { structure: 'Sequence', timeCapSec: cfg.mainDurationSec || null },
      instances,
    })
    const out = []
    if (buyInLines.length > 0) {
      out.push(createComponent({
        id: legacyComponentId(section, 'buyin'),
        format: 'Once', role: 'buy-in', producesScore: false, scoreOwnerId: mainComponent.id,
        instances: hydrateInstancesFromLegacy(buyInLines, { male: null, female: null }, movementIndex),
      }))
    }
    out.push(mainComponent)
    if (cashOutLines.length > 0) {
      out.push(createComponent({
        id: legacyComponentId(section, 'cashout'),
        format: 'Once', role: 'cash-out', producesScore: false, scoreOwnerId: mainComponent.id,
        instances: hydrateInstancesFromLegacy(cashOutLines, { male: null, female: null }, movementIndex),
      }))
    }
    return normalizeComponentOrder(out)
  }

  if (fmt.family === 'chained') {
    const stages = Array.isArray(cfg.stages) ? cfg.stages : []
    const out = stages.map((stage, i) => createComponent({
      id: legacyComponentId(section, `stage${i}`),
      format: stage.kind === 'interval' ? 'Intervals' : 'AMRAP',
      role: 'stage',
      producesScore: true,
      config: stage.kind === 'interval' ? {} : { durationSec: stage.durationSec || null },
      instances: hydrateInstancesFromLegacy(stage.movements || [], { male: null, female: null }, movementIndex),
    }))
    return normalizeComponentOrder(out)
  }

  // Default: every other family ('scored','sets','nft') already carries one
  // self-contained format/config/instances triple at the section level -
  // exactly one implicit component, wrapping it verbatim. This is the
  // "legacy single-score equivalence" path (ticket §16): a plain standalone
  // AMRAP/RFT/EMOM/Chipper/etc. section adapts to a components[] array of
  // length 1 whose format/config/instances are byte-identical to the
  // section's own - no semantic change, no data loss.
  return normalizeComponentOrder([
    createComponent({ id: legacyComponentId(section, 'primary'), format, producesScore: true, config: cfg, instances }),
  ])
}
