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
// workoutFormats.js; hydrateInstancesFromLegacy from prescriptionContract.js).
// It does not implement a second AMRAP/For-Time/RFT/EMOM engine, a second
// movement-identity system, or a second snapshot mechanism.
//
// NO composite leaderboard here (average placement points, double-points,
// Standard Competition Ranking, overall tie-break) - that is explicitly
// out of Phase 1 scope (WORKOUT-COMPOSER-COMPOSITE-SCORING.md), a later
// phase's concern once real Composer-authored data exists.
//
// DEPENDENCY DIRECTION (Workout Composer Phase 3) - this file imports only
// from workoutFormats.js/prescriptionContract.js/utils.js (all dependency-
// free leaves). wodSections.js imports FROM this file (componentsFromSection/
// deriveLegacyFieldsFromComponents/createEmptyComposerVariants, for Composer
// authoring persistence) - never the other way around, so
// hydrateInstancesFromLegacy was moved out of wodSections.js into
// prescriptionContract.js (re-exported from wodSections.js unchanged) rather
// than importing wodSections.js here, which would have created a cycle.

import {
  getFormat, repsEfectiveSecvential, composePartialText, composeAmrapResult, composeFortimeOrAmrapFields,
  deriveDurationCompletionState, isSequentialFormat, WORKOUT_FORMATS, VARIANTE_WEIGHT_BASE, getWorkoutFormatDisplay,
  composeCappedRoundsResult, parsePartialText, parseCappedRoundsResult,
} from './workoutFormats'
import { hydrateInstancesFromLegacy, renderInstanceLine, resolveSpec, buildLegacyArtifactsForVariant } from './prescriptionContract'
import { secToTime } from './utils'

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
// Live save-path wiring for family:'mixed' (Workout Composer Phase 2, §23)
// ============================================================================
//
// Wires composeEnvelopeResult into the REAL composeWodLogFieldsInner
// (App.jsx) save path for today's ONE existing runtime envelope shape -
// family:'mixed' (legacy 'Buy-In/Cash-Out'/'AMRAP with Buy-In', and any
// future canonical 'Once'-bookend-owned scorer that reaches this same save
// branch). Reuses composeAmrapResult/repsEfectiveSecvential/
// composePartialText/deriveDurationCompletionState (workoutFormats.js)
// UNCHANGED for the main component's own native value - this function only
// composes what ALREADY exists into one envelope-correct result, exactly per
// WORKOUT-COMPOSER-ARCHITECTURE.md §18.1's rule (finishedValue present ->
// done outright, ignore partials; absent -> walk buyIn -> main -> cashOut to
// the furthest with progress).

/** `mainIsSequential`: boolean - whether the main component's own native
 * partial engine is the SEQUENTIAL one-pass engine (`repsEfectiveSecvential`
 * - For Time/Chipper/Ladder-style, or a `structure:'Sequence'` AMRAP) or the
 * REPEATED-ROUNDS one (`composeAmrapResult` - classic AMRAP, or RFT/Partner-
 * WOD-style repeated rounds). Callers should derive this from the main
 * component's own actual format/config via `isSequentialFormat`
 * (workoutFormats.js) - NOT a crude 'AMRAP' vs 'For Time' string check
 * (an earlier version of this function conflated the two; a REPEATED-ROUNDS
 * RFT main inside an envelope needs `composeAmrapResult`'s "N rounds +
 * partial" composition, exactly like a bare AMRAP does - it is NOT
 * sequential just because it isn't AMRAP). `finishedValue`: the one
 * envelope-level time the athlete entered (`wodTime`) - present means
 * "done", exactly mirroring composeFortimeOrAmrapFields's own
 * shouldLogRoundsInsteadOfTime rule, now scoped to the whole envelope.
 * `mainRoundsCompleted`/`mainPartialReps`/`mainMovements`: the main
 * component's own existing fields, UNTOUCHED. `buyInMovements`/
 * `buyInPartialReps`, `cashOutMovements`/`cashOutPartialReps`: the bookends'
 * own movements (text lines) and raw partial-reps arrays (one entry per
 * movement - see MultiMovementPartialRows, FormatLogger.jsx). Returns the
 * exact `{result, time_result, completion_state}` shape
 * composeWodLogFieldsInner already produces for every other scored format,
 * plus `buyInText`/`cashOutText` for optional Journal/log_meta display. */
export function composeMixedLogFields({
  mainIsSequential, finishedValue,
  mainRoundsCompleted, mainPartialReps, mainMovements, mainAdditionalReps,
  buyInMovements, buyInPartialReps,
  cashOutMovements, cashOutPartialReps,
}) {
  const buyInResult = (buyInMovements && buyInMovements.length > 0)
    ? resolveOnceComponentResult(buyInMovements, buyInPartialReps) : null
  const cashOutResult = (cashOutMovements && cashOutMovements.length > 0)
    ? resolveOnceComponentResult(cashOutMovements, cashOutPartialReps) : null

  let mainText
  let mainHasProgress
  if (mainIsSequential) {
    const effective = repsEfectiveSecvential(mainPartialReps || [], mainMovements || [])
    mainText = composePartialText(effective, mainMovements || [])
    mainHasProgress = effective.some(v => (v || '').toString().trim() !== '')
  } else if (mainAdditionalReps !== undefined) {
    // Workout Composer Phase 4 - the REAL live UniversalScoreInput logger's
    // "Time Capped" control for a non-sequential (repeated-rounds) format
    // collects ONE summed "additional reps" number (RoundsAndAdditionalReps,
    // UniversalScoreInput.jsx), never a per-movement breakdown - exactly the
    // same distinction composeFortimeOrAmrapFields (workoutFormats.js) already
    // makes for a bare (non-envelope) scorer. mainPartialReps stays supported
    // (undefined mainAdditionalReps, existing tests/callers) for the older
    // per-movement FormatLogger-flow convention.
    mainText = composeCappedRoundsResult(mainRoundsCompleted, mainAdditionalReps) || ''
    mainHasProgress = !!(mainRoundsCompleted || '').toString().trim()
  } else {
    mainText = composeAmrapResult(mainRoundsCompleted, mainPartialReps, mainMovements || []) || ''
    mainHasProgress = !!(mainRoundsCompleted || '').toString().trim() || (mainPartialReps || []).some(v => (v || '').toString().trim() !== '')
  }

  const envelope = []
  const resultByComponentId = {}
  if (buyInResult) { envelope.push({ id: 'buyIn' }); resultByComponentId.buyIn = buyInResult }
  envelope.push({ id: 'main' })
  resultByComponentId.main = { hasProgress: mainHasProgress, text: mainText }
  if (cashOutResult) { envelope.push({ id: 'cashOut' }); resultByComponentId.cashOut = cashOutResult }

  const composed = composeEnvelopeResult({ envelope, finishedValue, resultByComponentId })
  return {
    time_result: composed.isComplete ? composed.finishedValue : null,
    result: composed.isComplete ? null : (composed.cappedText || null),
    completion_state: deriveDurationCompletionState(!composed.isComplete),
    buyInText: buyInResult?.text || null,
    cashOutText: cashOutResult?.text || null,
  }
}

// ============================================================================
// True multi-envelope persistence (Workout Composer Phase 2.1)
// ============================================================================
//
// Phase 2 proved ONE owned envelope (Buy-In/Main/Cash-Out -> one native
// result) reaches the real save path. This section proves a components[]
// list with 2+ INDEPENDENTLY scored envelopes (e.g. AMRAP + Rest + RFT, or
// an owned Buy-In/RFT/Cash-Out envelope alongside a second independent
// AMRAP) can be persisted and reloaded WITHOUT a DB migration and WITHOUT a
// "primary component" - the exact two constraints the owner set.
//
// Persistence decision (traced against actual code, not assumed): a
// components-bearing composed WOD log leaves the section-level scalar
// fields (`result`, `time_result`, `completion_state`, `sets`) NULL and
// stores every envelope's own native result in `log_meta.componentResults`,
// keyed by stable componentId. This is NOT a new convention invented for
// this ticket - it is the EXACT existing pattern `family:'chained'` and
// `family:'sets'` already use in production today (composeWodLogFieldsInner,
// App.jsx ~L9886-9912: both leave result/time_result/completion_state null
// and store their real truth in log_meta/sets respectively). Every existing
// consumer (sortSectionLogs, Journal's parseWodLogDetails, Photo Result)
// already treats null result/time_result as "this format's score lives
// elsewhere" - they do not crash or misrepresent a null-scalar log, they
// simply show nothing from those fields, exactly as they already do for
// every chained/sets-family log in production. A multi-envelope Composer
// log is safe by the SAME precedent, not a new one.
//
// Dispatch here is deliberately narrow - exactly the format families the
// ticket's own Fixtures A-E require (AMRAP, repeated-rounds RFT/Partner-WOD-
// style via the existing composeFortimeOrAmrapFields, EMOM/Interval via the
// existing `sets` passthrough convention, and an owned once-bookend envelope
// via Phase 2's composeMixedLogFields) - NOT an exhaustive reimplementation
// of every catalog format's dispatch (that already exists, unchanged, in
// composeWodLogFieldsInner/App.jsx, for today's single-score runtime path).

/** Compose ONE scoring envelope's own native result. `components`: the full
 * canonical list (needed to resolve the envelope's bookend members).
 * `scoringComponent`: one `producesScore:true` entry from it. `inputsById`:
 * `{ [componentId]: { finishedValue?, roundsCompleted?, partialReps?,
 * movementLines?, sets? } }` - the raw athlete input for every component in
 * play, keyed by componentId (never array index). Returns
 * `{ format, envelopeComponentIds, result, time_result, completion_state,
 * sets }` - the shape stored under this scorer's own key in
 * `log_meta.componentResults`. */
export function composeEnvelopeNativeResult(components, scoringComponent, inputsById) {
  const envelope = getScoreEnvelope(components, scoringComponent.id)
  const bookends = envelope.filter(c => c.id !== scoringComponent.id)
  const input = inputsById[scoringComponent.id] || {}

  if (bookends.length > 0) {
    // Owned envelope - reuse Phase 2's composeMixedLogFields UNCHANGED.
    const buyIn = bookends.find(c => c.role === 'buy-in')
    const cashOut = bookends.find(c => c.role === 'cash-out')
    const out = composeMixedLogFields({
      // Correct, general capability check (NOT a crude AMRAP/For-Time name
      // check) - a repeated-rounds RFT or Partner WOD main inside an owned
      // envelope needs composeAmrapResult's "N rounds + partial" text
      // exactly like AMRAP does, never the sequential engine.
      mainIsSequential: isSequentialFormat(scoringComponent.format, scoringComponent.config),
      finishedValue: input.finishedValue,
      mainRoundsCompleted: input.roundsCompleted,
      mainPartialReps: input.partialReps,
      mainAdditionalReps: input.additionalReps,
      mainMovements: input.movementLines,
      buyInMovements: buyIn ? (inputsById[buyIn.id]?.movementLines || []) : [],
      buyInPartialReps: buyIn ? (inputsById[buyIn.id]?.partialReps || []) : [],
      cashOutMovements: cashOut ? (inputsById[cashOut.id]?.movementLines || []) : [],
      cashOutPartialReps: cashOut ? (inputsById[cashOut.id]?.partialReps || []) : [],
    })
    return {
      format: scoringComponent.format, envelopeComponentIds: envelope.map(c => c.id),
      result: out.result, time_result: out.time_result, completion_state: out.completion_state, sets: null,
    }
  }

  const fmt = getFormat(scoringComponent.format)

  if (fmt.family === 'sets') {
    // Exactly today's family:'sets' convention (App.jsx ~L9886-9888): the
    // real score lives in `sets` (derived at READ time by setsDisplayScore/
    // computeSetsScore, unchanged) - result/time_result stay null.
    return {
      format: scoringComponent.format, envelopeComponentIds: [scoringComponent.id],
      result: null, time_result: null, completion_state: null, sets: input.sets || null,
    }
  }

  if (fmt.scoreMode === 'amrap') {
    // Workout Composer Phase 4 - the real UniversalScoreInput AMRAP control
    // (kind:'ROUNDS_REPS') collects roundsCompleted + ONE summed
    // additionalReps number, never a per-movement partialReps array -
    // composeCappedRoundsResult is the SAME generic "N rounds + M" composer
    // composeFortimeOrAmrapFields already uses for this exact distinction.
    // input.additionalReps undefined (existing tests/FormatLogger-flow
    // callers) falls back to the older per-movement composeAmrapResult,
    // unchanged.
    const text = input.additionalReps !== undefined
      ? (composeCappedRoundsResult(input.roundsCompleted, input.additionalReps) || null)
      : (composeAmrapResult(input.roundsCompleted, input.partialReps, input.movementLines || []) || null)
    return {
      format: scoringComponent.format, envelopeComponentIds: [scoringComponent.id],
      result: text, time_result: null, completion_state: null, sets: null,
    }
  }

  // Repeated-rounds RFT/Partner-WOD-style (scoreMode 'fortime_or_amrap',
  // NOT sequential) - reuse the existing pure composer unchanged. Phase 4 -
  // now also threads wodAdditionalReps through (composeFortimeOrAmrapFields's
  // own existing, pre-Composer parameter) so a real UniversalScoreInput RFT
  // input composes identically to the single-score "official WOD" screen.
  const { result, time_result, completionState } = composeFortimeOrAmrapFields({
    wodTime: input.finishedValue, wodRoundsCompleted: input.roundsCompleted, wodPartialReps: input.partialReps,
    wodAdditionalReps: input.additionalReps,
    movements: input.movementLines || [], rounds: scoringComponent.config?.rounds, wodResult: input.result,
  })
  return {
    format: scoringComponent.format, envelopeComponentIds: [scoringComponent.id],
    result, time_result, completion_state: completionState, sets: null,
  }
}

/** Compose every independent envelope's native result into ONE additive
 * `wod_logs` payload, shaped identically to what `composeWodLogFieldsInner`
 * (App.jsx) already produces for every other format - `{result, time_result,
 * completion_state, sets, log_meta}` - so it is drop-in spreadable into the
 * SAME `supabase.from('wod_logs').insert/update({...composeWodLogFields()})`
 * call already used for every existing log (App.jsx ~L10070-10071), with
 * zero schema change. Section-level scalars are always null here (§ above);
 * `log_meta.componentResults` carries every scorer's own result, keyed by
 * componentId. Rest and any `producesScore:false` component never appears -
 * it produces no entry at all, not a null one. */
export function composeMultiEnvelopeLogFields(components, inputsById) {
  const scorers = (components || []).filter(c => c.producesScore)
  const componentResults = {}
  scorers.forEach(scorer => {
    componentResults[scorer.id] = composeEnvelopeNativeResult(components, scorer, inputsById || {})
  })
  return {
    result: null, time_result: null, completion_state: null, sets: null,
    // Workout Composer Phase 4.1 (ticket §3 - "snapshot-first historical
    // truth") - the FULL canonical components[] as they existed AT LOG
    // TIME, frozen here, immutable. Investigated first: the EXISTING
    // prescription_snapshot mechanism (buildPrescriptionSnapshot,
    // prescriptionContract.js) freezes only a FLAT, format-agnostic
    // movements array with no component/envelope grouping or identity at
    // all - structurally unable to represent "which movements belonged to
    // scorer A vs scorer B's Buy-In". Rather than reinterpret a multi-
    // score log from the CURRENT mutable wods.movement_prescriptions on
    // every future edit (explicitly forbidden - a later Builder edit must
    // never reinterpret an old log), this additive log_meta field is the
    // authoritative source an edit reads back (componentContract.js's
    // resolveHistoricalComponentsForEdit) - no DB migration, log_meta is
    // already free-form JSONB.
    // A CLONE, never a live reference - `components` is the caller's own
    // mutable array/objects (e.g. React state); Phase 2.1's own "historical
    // snapshot immutability" invariant (a later mutation of `components`
    // must never change an already-produced result) applies to this field
    // exactly as it already does to every other part of this return value.
    log_meta: { composerVersion: 1, componentResults, componentsSnapshot: (components || []).map(c => ({ ...c, instances: (c.instances || []).map(i => ({ ...i })) })) },
  }
}

/** Top-level decision point: exactly ONE scorer gets the "legacy single-
 * score equivalence" treatment (WORKOUT-COMPOSER-ARCHITECTURE.md §16/§24) -
 * normal scalar `result`/`time_result`/`completion_state`/`sets` fields,
 * byte-identical in shape to today's single-format save, `log_meta: null`.
 * TWO OR MORE independent scorers get `composeMultiEnvelopeLogFields`'s
 * `log_meta.componentResults` treatment - scalars stay null for ALL of
 * them, never populated from any one scorer (the owner's explicit "no
 * primary component" requirement, ticket §20). This is the ONE place that
 * decision is made - callers should use this, not choose between the two
 * lower-level functions themselves. */
export function composeComponentsLogFields(components, inputsById) {
  const scorers = (components || []).filter(c => c.producesScore)
  if (scorers.length === 1) {
    const r = composeEnvelopeNativeResult(components, scorers[0], inputsById || {})
    return { result: r.result, time_result: r.time_result, completion_state: r.completion_state, sets: r.sets, log_meta: null }
  }
  return composeMultiEnvelopeLogFields(components, inputsById)
}

/** Journal/leaderboard read contract (ticket §16/§17) - pure, format-
 * agnostic. A Composer log (`log_meta.componentResults` present) returns one
 * entry per scored component, in no particular order (callers needing
 * canonical order pass `components` to sort by). A LEGACY log (no
 * `componentResults`) returns exactly ONE entry synthesized from the
 * existing scalar fields - "a legacy log naturally returns one native
 * result" (ticket §16), matching every current consumer's existing
 * expectation with zero change. Never infers/selects a "primary" entry for
 * a multi-result log - every scorer's result is returned, undistinguished. */
export function getComponentResultsFromLog(log) {
  const cr = log?.log_meta?.componentResults
  if (cr && typeof cr === 'object' && Object.keys(cr).length > 0) {
    return Object.entries(cr).map(([componentId, r]) => ({
      componentId, format: r.format ?? null, result: r.result ?? null,
      time_result: r.time_result ?? null, completion_state: r.completion_state ?? null, sets: r.sets ?? null,
    }))
  }
  return [{
    componentId: null, format: null,
    result: log?.result ?? null, time_result: log?.time_result ?? null,
    completion_state: log?.completion_state ?? null, sets: log?.sets ?? null,
  }]
}

// ============================================================================
// WORKOUT COMPOSER - PHASE 4 (multi-scorer member logging orchestration)
// ============================================================================
//
// Pure functions only - React orchestration lives in composerLogging.jsx.
// This section wraps the EXISTING native format engines/composers (Phase 1/
// 2/2.1, all unchanged above) into a per-scorer logging session: ordering,
// UI-state defaults, edit-time hydration from a saved log, and mapping a
// native logger's own value shape into composeEnvelopeNativeResult's input
// shape. It does not reimplement AMRAP/RFT/EMOM/sequential scoring - every
// text composition still goes through composeEnvelopeNativeResult/
// composeComponentsLogFields, untouched.

/** Every native score envelope in components[], in CANONICAL EXECUTION
 * ORDER (ticket §11 - the scorer's own `order`, never object-key order,
 * format-name order, or producesScore order). One entry per
 * producesScore:true component; Rest and any non-scoring, non-owned
 * component never appears - "Rest produces no logger" falls out of this by
 * construction (ticket §9/§10). `buyIn`/`cashOut` are the envelope's owned
 * bookends (null when absent) - ticket §8: an owned envelope is always ONE
 * entry here, never split into separate steps. */
export function getOrderedScoreEnvelopes(components) {
  const list = components || []
  const scorers = list.filter(c => c.producesScore).slice().sort((a, b) => a.order - b.order)
  return scorers.map(scorer => {
    const envelope = getScoreEnvelope(list, scorer.id)
    const bookends = envelope.filter(c => c.id !== scorer.id)
    return {
      scorer,
      buyIn: bookends.find(c => c.role === 'buy-in') || null,
      cashOut: bookends.find(c => c.role === 'cash-out') || null,
      envelope,
    }
  })
}

/** One scorer's fresh (never-logged) UI draft - the exact value shape
 * UniversalScoreInput/FormatLogger already read/write
 * ({result,time,roundsCompleted,additionalReps,partialReps,sets,completed,
 * weightLogged,stages}), byte-identical to the single-score screen's own
 * initial state - no new field, no Composer-specific shape. */
export function emptyScorerLoggerValue() {
  return { result: '', time: '', roundsCompleted: '', additionalReps: '', partialReps: [], sets: {}, completed: false, weightLogged: '', stages: [] }
}

/** Map ONE native format's `{result, time_result, sets}` (as returned by
 * getComponentResultsFromLog, or one entry of log_meta.componentResults)
 * back into the SAME UI draft shape emptyScorerLoggerValue() produces -
 * reusing the EXISTING inverse parsers (parseAmrapResult/parsePartialText/
 * parseCappedRoundsResult, workoutFormats.js) the single-score Journal edit
 * flow (App.jsx's onEditWod) already uses, never a second parsing
 * implementation. `movementLines` is the scorer's own resolved movement
 * text lines (same source the single-score edit flow already resolves via
 * resolveMovementInstance/renderInstanceLine). Ticket §25 - this is what
 * lets an existing multi-score log hydrate ALL of its native results back
 * into the stepper on edit. */
export function hydrateScorerLoggerValueFromNativeResult(scorer, nativeResult, movementLines) {
  const base = emptyScorerLoggerValue()
  if (!nativeResult) return base
  const { result, time_result, sets } = nativeResult
  if (sets != null) return { ...base, sets }
  if (time_result) return { ...base, time: time_result }
  if (!result) return base
  if (isSequentialFormat(scorer.format, scorer.config)) {
    return { ...base, partialReps: parsePartialText(result, movementLines || []) }
  }
  // Repeated-rounds (RFT/Partner WOD) or plain AMRAP capped text - both use
  // the SAME "N rounds + M" grammar (composeCappedRoundsResult), so the
  // SAME inverse parser reopens either one into roundsCompleted+additionalReps,
  // matching exactly what UniversalScoreInput's RoundsAndAdditionalReps
  // control (the real production UI) reads/writes.
  const { rounds, additional } = parseCappedRoundsResult(result)
  return { ...base, roundsCompleted: rounds, additionalReps: additional }
}

/** Map ONE scorer's native UI draft (UniversalScoreInput/FormatLogger's own
 * value shape) into composeEnvelopeNativeResult's expected `inputsById[id]`
 * input shape - the ONE place this translation happens, so the compose
 * step never has to know about UI-control conventions and the UI never has
 * to know about the compose contract. `movementLines` is injected by the
 * caller (the scorer's own resolved movement text). Bookend inputs
 * (buyIn/cashOut's own partialReps) are read directly from
 * `value.sets.__buyIn`/`.__cashOut` - the EXACT existing convention
 * MultiMovementPartialRows (FormatLogger.jsx) already writes, unchanged. */
export function scorerValueToEnvelopeInput(value, movementLines) {
  const v = value || {}
  return {
    finishedValue: v.time, roundsCompleted: v.roundsCompleted, additionalReps: v.additionalReps,
    partialReps: v.partialReps, result: v.result, sets: v.sets, movementLines: movementLines || [],
  }
}

/** Bookend (Buy-In/Cash-Out) partial-reps array, from the SAME
 * `sets.__buyIn`/`sets.__cashOut` row convention MultiMovementPartialRows
 * already writes (one row per movement, `{reps,weight,completed}`) - never
 * a second bookend-input shape. */
export function bookendPartialRepsFromValue(value, role) {
  const rows = value?.sets?.[role === 'buy-in' ? '__buyIn' : '__cashOut']
  return (rows || []).map(row => row?.reps || '')
}

/** Build composeComponentsLogFields's full `inputsById` map for one logging
 * session - one entry per SCORER (from its own UI draft,
 * scorerValueToEnvelopeInput) plus one entry per owned bookend (its
 * movement lines + the partial-reps rows recorded INSIDE the scorer's own
 * draft, `sets.__buyIn`/`__cashOut` - ticket §8: an owned envelope is one
 * logger, so its bookends' input lives in that SAME draft, never a
 * separate top-level componentId slot). `valuesByComponentId` is keyed by
 * scorer id only - matches ticket §20's identity requirement (state keyed
 * by stable componentId, never array position). */
export function buildComposeInputsById(envelopes, valuesByComponentId) {
  const inputsById = {}
  ;(envelopes || []).forEach(({ scorer, buyIn, cashOut }) => {
    const value = (valuesByComponentId || {})[scorer.id] || emptyScorerLoggerValue()
    inputsById[scorer.id] = scorerValueToEnvelopeInput(value, renderComponentMovementLines(scorer.instances))
    if (buyIn) {
      inputsById[buyIn.id] = { movementLines: renderComponentMovementLines(buyIn.instances), partialReps: bookendPartialRepsFromValue(value, 'buy-in') }
    }
    if (cashOut) {
      inputsById[cashOut.id] = { movementLines: renderComponentMovementLines(cashOut.instances), partialReps: bookendPartialRepsFromValue(value, 'cash-out') }
    }
  })
  return inputsById
}

/** Hydrate EVERY scorer's UI draft from an existing saved log (ticket §25 -
 * "edit existing multi-score log"), one entry per envelope, keyed by
 * scorer id. Reuses getComponentResultsFromLog (Phase 2.1) to read the
 * saved native results, then hydrateScorerLoggerValueFromNativeResult per
 * scorer - never re-derives a log from today's mutable components (the
 * log's OWN frozen componentId/format/result/time_result/sets are the only
 * things read here). A legacy single-score log (getComponentResultsFromLog's
 * `componentId: null` fallback) applies its one result to the sole scorer
 * ONLY when there is exactly one envelope (ticket §27 parity) - a legacy
 * log predates the Composer and never had a per-scorer breakdown, so for
 * 2+ envelopes there is nothing to hydrate beyond each scorer's own empty
 * draft. Bookend (Buy-In/Cash-Out) rows start blank on edit, matching
 * today's EXISTING single-mixed-format edit behavior exactly (log_meta's
 * buyInText/cashOutText are supplementary display text, never re-parsed
 * into rows by the current edit flow either - not a Phase 4 regression). */
export function hydrateAllScorerValuesFromLog(envelopes, log) {
  const list = envelopes || []
  const nativeResults = getComponentResultsFromLog(log)
  const byComponentId = Object.fromEntries(nativeResults.filter(r => r.componentId != null).map(r => [r.componentId, r]))
  const legacySingle = list.length === 1 && nativeResults.length === 1 && nativeResults[0].componentId == null ? nativeResults[0] : null
  const valuesByComponentId = {}
  list.forEach(({ scorer }) => {
    const native = byComponentId[scorer.id] || legacySingle
    valuesByComponentId[scorer.id] = hydrateScorerLoggerValueFromNativeResult(scorer, native, renderComponentMovementLines(scorer.instances))
  })
  return valuesByComponentId
}

/** Resolve the canonical components[] to edit an EXISTING log against -
 * SNAPSHOT-FIRST (ticket §3/§4/§7): `log.log_meta.componentsSnapshot`
 * (frozen at save time by composeMultiEnvelopeLogFields, immutable) is the
 * authoritative source whenever present - a later Builder edit to the
 * live workout (reordering, adding/removing a Component, changing config)
 * NEVER reinterprets this historical log, exactly the existing FORGE
 * invariant "historical logs are never re-derived from mutable current
 * data" already applied everywhere else (resolveResultProvenance,
 * P10). `currentComponentsFallback` is used ONLY when no snapshot exists
 * on the log at all (a log saved before this snapshot field existed - in
 * practice this should not occur, since Workout Composer Phase 4 (the
 * only prior code that could have produced a multi-score log) was never
 * deployed before this fix) - `source` on the return value tells the
 * caller which case fired, so this is never silent. Returns `null` when
 * NEITHER source has real multi-scorer evidence (not a multi-score log). */
export function resolveHistoricalComponentsForEdit(log, currentComponentsFallback) {
  const snapshot = log?.log_meta?.componentsSnapshot
  if (Array.isArray(snapshot) && snapshot.length > 0) {
    return { components: snapshot, source: 'snapshot' }
  }
  const cr = log?.log_meta?.componentResults
  if (cr && typeof cr === 'object' && Object.keys(cr).length > 0) {
    return { components: currentComponentsFallback || [], source: 'current-fallback' }
  }
  return null
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

// ============================================================================
// WORKOUT COMPOSER - PHASE 3 (PWA authoring UI domain support)
// ============================================================================
//
// Everything below is pure, React-free authoring/persistence-shim logic the
// new src/composerAuthoring.jsx UI and wodSections.js's Composer wiring both
// call into. No new movement-identity system, no second format engine - a
// coach-authored component still gets its config from the SAME WORKOUT_FORMATS
// catalog every other editor already reads, and its movements are ordinary
// prescriptionContract.js MovementInstance[] created via the SAME
// newMovementInstance the rest of the app already uses.

// The Composer's own curated, "genuinely authorable + loggable + persistable"
// format catalog (ticket §7/§8) - deliberately narrower than the full
// WORKOUT_FORMATS catalog. 'Intervals' is intentionally excluded: its
// authoring model (roundCount/stationMode/restPlacement, INC-07) derives
// station count from being the WHOLE primary section's one and only work,
// which does not have a safe, proven meaning as one arbitrary-position
// component among several yet (see Phase 3 final report for the full
// reasoning) - not exposed simply because the format name exists in code.
export const COMPOSER_FORMAT_GROUPS = [
  {
    key: 'one-time', label: 'One-time work',
    options: [
      { format: 'Once', role: 'buy-in', label: 'Buy-In' },
      { format: 'Once', role: 'cash-out', label: 'Cash-Out' },
    ],
  },
  {
    key: 'completion', label: 'For completion',
    options: [
      { format: 'For Time', role: null, label: 'For Time' },
      { format: 'RFT', role: null, label: 'Rounds For Time' },
    ],
  },
  {
    key: 'reps', label: 'For reps',
    options: [{ format: 'AMRAP', role: null, label: 'AMRAP' }],
  },
  {
    key: 'intervals', label: 'Intervals',
    options: [{ format: 'EMOM', role: null, label: 'EMOM' }],
  },
  {
    key: 'structure', label: 'Structure',
    options: [{ format: 'Rest', role: null, label: 'Rest' }],
  },
]

/** Sensible starting config for a freshly-added component, so the coach lands
 * on something immediately valid/sensible rather than a blank/zeroed catalog
 * field - reuses the same field defaults FormatConfigEditor already falls
 * back to (`field.default`) where one is declared, plus the Composer's own
 * defaults for the couple of fields that have no catalog default today. */
export function defaultConfigForFormat(format) {
  switch (format) {
    case 'AMRAP': return { durationSec: 600 }
    case 'RFT': return { rounds: 5 }
    case 'EMOM': return { totalRounds: 8, intervalSec: 60 }
    case 'Rest': return { durationSec: 120 }
    default: return {}
  }
}

/** Create one new, freshly-identified component ready to append (ticket §9 -
 * stable id/order/format/role/producesScore/scoreOwnerId/config/instances,
 * never a temporary UI-only id later swapped on save). */
export function newComponentFromFormat(format, role = null) {
  return createComponent({ format, role, config: defaultConfigForFormat(format) })
}

/** + Add Component (ticket §6/§9). Appends and renumbers order; never
 * mutates the input array. */
export function addComponentToList(components, format, role = null) {
  return normalizeComponentOrder([...(components || []), newComponentFromFormat(format, role)])
}

/** Remove Component (ticket §22). Any OTHER component whose scoreOwnerId
 * pointed at the removed one is cleared (never left dangling, never silently
 * re-attached to a different owner, never deleted along with it) - the
 * caller (UI) uses `clearedOwnershipFor` to warn the coach before/after the
 * removal. `removed` is handed back so the UI can name it in that warning. */
export function removeComponentFromList(components, id) {
  const list = components || []
  const removed = list.find(c => c.id === id) || null
  const clearedOwnershipFor = []
  const next = list
    .filter(c => c.id !== id)
    .map(c => {
      if (c.scoreOwnerId === id) { clearedOwnershipFor.push(c.id); return { ...c, scoreOwnerId: null } }
      return c
    })
  return { components: normalizeComponentOrder(next), removed, clearedOwnershipFor }
}

/** Reorder Components (ticket §11/§23/§49). Swaps the component at `id` with
 * its neighbor in `direction` (-1 up, +1 down), then re-validates the WHOLE
 * list - if the resulting order would break an envelope's contiguity (or any
 * other domain rule), the reorder is rejected and the ORIGINAL array is
 * returned unchanged (`ok:false`) rather than ever persisting an invalid
 * Composer graph. A no-op at either end of the list succeeds trivially
 * (`ok:true`, array unchanged) - there is nothing to reorder into. */
export function moveComponent(components, id, direction) {
  const list = components || []
  const idx = list.findIndex(c => c.id === id)
  if (idx === -1) return { components: list, ok: true }
  const target = idx + direction
  if (target < 0 || target >= list.length) return { components: list, ok: true }
  const swapped = [...list]
  const tmp = swapped[idx]
  swapped[idx] = swapped[target]
  swapped[target] = tmp
  const reordered = normalizeComponentOrder(swapped)
  const { valid, errors } = validateComponents(reordered)
  if (!valid) return { components: list, ok: false, error: errors[0]?.code || 'INVALID' }
  return { components: reordered, ok: true }
}

/** Establish or clear a Buy-In/Cash-Out's score ownership (ticket §10/§20).
 * `scorerId === null` detaches it (becomes an independent, unscored
 * component - the safe outcome after removing its former owner, ticket §22).
 * Validates before applying; on failure the ORIGINAL array is returned
 * unchanged with the domain error code, never a partially-applied edit. */
export function setScoreOwner(components, bookendId, scorerId) {
  const list = components || []
  if (!list.some(c => c.id === bookendId)) return { components: list, ok: false, error: 'NOT_FOUND' }
  const next = list.map(c => (c.id === bookendId ? { ...c, scoreOwnerId: scorerId } : c))
  const { valid, errors } = validateComponents(next)
  if (!valid) return { components: list, ok: false, error: errors[0]?.code || 'INVALID' }
  return { components: next, ok: true }
}

/** Human-facing "Counts toward: [...]" candidate list (ticket §10) - every
 * OTHER producesScore:true component `bookendId` could validly attach to.
 * Never exposes raw ids to the coach; callers render each candidate's own
 * `componentHeaderLabel`. */
export function candidateScorersFor(components, bookendId) {
  return (components || []).filter(c => c.id !== bookendId && c.producesScore)
}

/** Translate one validateComponents() error code into coach-facing copy
 * (ticket §35) - never an internal code or a raw component id. `t` is the
 * app's translation table (optional overrides); falls back to plain English
 * so this remains usable from a pure test with no `t` at all. */
export function describeValidationError(error, t) {
  const code = typeof error === 'string' ? error : error?.code
  const messages = {
    DUPLICATE_ID: t?.composerErrDuplicateId || 'Something went wrong adding that component - try removing and re-adding it.',
    UNKNOWN_FORMAT: t?.composerErrUnknownFormat || 'This component type is not supported.',
    REST_CANNOT_SCORE: t?.composerErrRestCannotScore || 'Rest can never produce a score.',
    SCORER_CANNOT_HAVE_OWNER: t?.composerErrScorerCannotHaveOwner || 'A scored component cannot itself count toward another component.',
    SELF_OWNERSHIP: t?.composerErrSelfOwnership || 'A component cannot count toward itself.',
    REST_CANNOT_BE_OWNED: t?.composerErrRestCannotBeOwned || 'Rest cannot belong to a scored workout.',
    DANGLING_OWNER: t?.composerErrDanglingOwner || 'This component was counting toward a component that no longer exists.',
    OWNER_CANNOT_SCORE: t?.composerErrOwnerCannotScore || 'This component must count toward a scored component.',
    OWNERSHIP_CYCLE: t?.composerErrOwnershipCycle || 'These components are counting toward each other.',
    BROKEN_ENVELOPE_CONTIGUITY: t?.composerErrBrokenEnvelope || 'Buy-In and Cash-Out must stay together with the workout they belong to.',
  }
  return messages[code] || t?.composerErrGeneric || 'This workout structure is not valid yet.'
}

/** Save gate (ticket §35/§36) - domain validation errors translated to coach
 * copy, PLUS "an obviously invalid scored/one-time component with zero
 * movements" (Rest is exempt - it never has movements). Returns
 * `{valid, issues}` - `issues` is `{code, componentId, message}[]`, NEVER a
 * bare string list (Phase 3.1.1 - a bare message string is not a stable
 * identity: two DIFFERENT components can legitimately produce
 * byte-identical text, e.g. two separate empty AMRAP components both
 * reading "AMRAP: add at least one movement." - collapsing on the STRING
 * would silently hide one of two real, distinct problems. `componentId`
 * (always present, unique per component) + `code` is the caller's stable
 * dedup/attribution key; `message` is coach-safe display text only, never
 * itself used as identity). Does not decide "empty composer, nothing to
 * save yet" - callers check `components.length === 0` themselves for that
 * distinct, non-error state (ticket §5's true empty state is not a
 * validation failure). */
export function validateComposerForSave(components) {
  const list = components || []
  const domain = validateComponents(list)
  const issues = domain.errors.map(e => ({ code: e.code, componentId: e.componentId, message: describeValidationError(e) }))
  list.forEach(c => {
    if (c.format !== 'Rest' && (c.instances || []).length === 0) {
      issues.push({ code: 'EMPTY_MOVEMENTS', componentId: c.id, message: `${componentHeaderLabel(c)}: add at least one movement.` })
    }
  })
  return { valid: domain.valid && issues.length === domain.errors.length, issues }
}

// ----------------------------------------------------------------------------
// Human-readable header + preview projection (ticket §21/§28/§29)
// ----------------------------------------------------------------------------

function componentDurationLabel(seconds) {
  if (seconds == null) return ''
  return secToTime(seconds)
}

/** One component's human header - "AMRAP · 6:00", "5 ROUNDS FOR TIME",
 * "REST · 2:00", "BUY-IN", "CASH-OUT", "EMOM 8", "FOR TIME" - never an
 * internal term ("SCORE ENVELOPE", "SCORER", a component id). Buy-In/
 * Cash-Out are identified by `role`, never by format alone (both are
 * format:'Once'). Duration-bearing headers use the full M:SS form with a
 * middle-dot separator, exactly the ticket's own §21 examples ("AMRAP ·
 * 6:00", "REST · 2:00") - not a bare minute count. */
export function componentHeaderLabel(component) {
  if (component?.label) return component.label
  if (component?.role === 'buy-in') return 'BUY-IN'
  if (component?.role === 'cash-out') return 'CASH-OUT'
  const c = component?.config || {}
  switch (component?.format) {
    case 'Rest': {
      const d = componentDurationLabel(c.durationSec)
      return d ? `REST · ${d}` : 'REST'
    }
    case 'AMRAP': {
      const d = componentDurationLabel(c.durationSec)
      return d ? `AMRAP · ${d}` : 'AMRAP'
    }
    case 'RFT':
      return c.rounds ? `${c.rounds} ROUNDS FOR TIME` : 'ROUNDS FOR TIME'
    case 'EMOM':
      return c.totalRounds ? `EMOM ${c.totalRounds}` : 'EMOM'
    case 'For Time':
      return 'FOR TIME'
    default:
      return String(component?.format || '').toUpperCase()
  }
}

/** One component's movements as display lines - `gender` defaults to null
 * (gender-neutral "45/30 kg", the coach-facing Builder Preview convention,
 * resolveSpec(_, null) + renderInstanceLine, prescriptionContract.js).
 * Phase 3.2 - the SAME athlete's own gender ('male'|'female') the member
 * Home card already resolves every other movement line with
 * (memberGenderKey/resolveAthleteGenderKey, App.jsx) can be passed here too,
 * so a Composer member prescription line resolves identically to a legacy
 * one for the same underlying instance - one shared projection, not two
 * independent interpretations (ticket §20). */
export function renderComponentMovementLines(instances, gender = null) {
  return (instances || []).map(i => renderInstanceLine({
    name: i.name,
    reps: resolveSpec(i.reps, gender),
    load: resolveSpec(i.load, gender),
    distance: resolveSpec(i.distance, gender),
    calories: resolveSpec(i.calories, gender),
  }))
}

/** Secondary timing metadata for one component's header (Phase 3.2, ticket
 * §10 - "5 ROUNDS FOR TIME    Time cap 20:00") - reuses the EXISTING
 * canonical getWorkoutFormatDisplay (workoutFormats.js, already powers the
 * legacy per-section WorkoutFormatHeader widget) for JUST its secondary
 * value, discarding its `primary` (that helper's "5 RFT" abbreviated
 * convention is NOT the Composer's own header language -
 * componentHeaderLabel already owns "5 ROUNDS FOR TIME" for that). Returns
 * null for Buy-In/Cash-Out/Rest (never a time-cap concept) or a scorer with
 * no time-relevant config set - never invents a value.
 *
 * ONLY returns a value when getWorkoutFormatDisplay attaches a real LABEL
 * (i.e. `secondaryLabel` truthy - TIME_CAP_LABEL_FORMAT_IDS in
 * workoutFormats.js: 'For Time'/'RFT'/'Chipper'/'Ladder'/'Partner WOD',
 * same existing `!!secondaryLabel` convention workoutFormats.js's own
 * setsScoreLabel already uses to distinguish "this is a time CAP" from "this
 * is just a bare duration"). An AMRAP/EMOM's own duration/round count is
 * already embedded in componentHeaderLabel's header text ("AMRAP · 6:00",
 * "EMOM 8") - surfacing getWorkoutFormatDisplay's unlabeled duration for
 * those here too would render the same number twice, once as the header and
 * once as a confusing, unlabeled secondary value (found live via the QA
 * harness - "AMRAP · 8:00" next to a bare, unlabeled "8:00"). */
export function componentSecondaryTiming(component, t) {
  if (!component || component.role === 'buy-in' || component.role === 'cash-out' || component.format === 'Rest') return null
  const { secondaryLabel, secondaryValue } = getWorkoutFormatDisplay(component.format, component.config || {}, null, t)
  if (!secondaryLabel || !secondaryValue) return null
  return { label: secondaryLabel, value: secondaryValue }
}

/** Preview/prescription projection reading canonical components[] directly,
 * in canonical order (ticket §28) - no separate preview data, no envelope/
 * scorer jargon (ticket §29): every component (bookend, scorer, or Rest)
 * becomes one `{id, header, movementLines, secondary}` block, exactly the
 * order the athlete will read it in. A single-component workout naturally
 * previews as just that one block - nothing here numbers or labels it as
 * "the only" component. `opts.gender` and `opts.t` thread through to
 * renderComponentMovementLines/componentSecondaryTiming - the ONE shared
 * projection both the Builder Preview (composerAuthoring.jsx, gender-
 * neutral) and the member prescription card (composerMemberPrescription.jsx,
 * the athlete's own gender) call, so their component order/content can
 * never diverge (ticket §20). */
export function previewBlocksFromComponents(components, opts = {}) {
  const { gender = null, t = null } = opts
  return (components || [])
    .slice()
    .sort((a, b) => a.order - b.order)
    .map(c => ({
      id: c.id,
      header: componentHeaderLabel(c),
      movementLines: renderComponentMovementLines(c.instances, gender),
      secondary: componentSecondaryTiming(c, t),
    }))
}

/** Decide whether ONE variant's member prescription should render from
 * canonical components[] (Phase 3.2, ticket §1/§3 - a genuine multi-
 * Component graph: an owned envelope, a Rest, or 2+ independent scorers,
 * none of which the legacy scalar columns can fully represent) or fall
 * back to the existing single-format path (ticket §19 - a trivial 0-1-
 * component graph stays visually byte-identical to before this phase).
 * Reads ONLY `variantKey`'s own components - ticket §15/§26, never another
 * variant's (no cross-variant leakage - each variant is independently
 * resolved). Returns the components[] array when the Composer path
 * applies, else `null` (the caller's existing legacy renderer stays
 * exactly as it was). An unprogrammed variant (components: [], the Phase
 * 3.1 hydration fix's own guarantee) correctly returns `null` here too -
 * no phantom member prescription block (ticket §16). */
export function resolveMemberComposerPrescription(prescriptionDoc, variantKey) {
  const components = prescriptionDoc?.variants?.[variantKey]?.components
  return Array.isArray(components) && components.length > 1 ? components : null
}

// ----------------------------------------------------------------------------
// Composer <-> legacy `wods` scalar-column write shim (ticket §32/§33/§34)
// ----------------------------------------------------------------------------
//
// wodSections.js's legacyPayloadFromSections still writes `type`/
// `format_config`/`movements_{k}` (the pre-Composer `wods` columns) on every
// save - Home, the live single-score Logger and Photo Result all still read
// ONLY those columns and are explicitly out of scope for this ticket. This
// is the write-direction counterpart to componentsFromSection: given a
// variant's authored components[], produce the best legacy-compatible
// {type, formatConfig, instances} triple for those columns, while the FULL
// components[] is ALWAYS additionally persisted verbatim (wodSections.js,
// movement_prescriptions.variants[key].components) as the authoritative
// truth for any Composer-aware reader (this same editor, on reopen).
//
// Three cases, in order of fidelity:
//  1. exactly one scorer, no envelope -> byte-identical to Phase 1's
//     existing "legacy single-score equivalence" (zero gap, zero limitation).
//  2. exactly one scorer WITH an owned envelope, AND the scorer's format is
//     'AMRAP' or 'For Time' (sequential) -> byte-identical to the EXISTING
//     'AMRAP with Buy-In'/'Buy-In/Cash-Out' legacy shape - componentsFromSection
//     already reads this exact shape back, and today's PRODUCTION Logger
//     already fully supports it end to end (Phase 2). Zero gap.
//  3. everything else (a repeated-rounds RFT/EMOM-scored envelope - the
//     Composer's own primary illustrative "Buy-In -> 5 RFT -> Cash-Out"
//     pattern, which has NO legacy 'mixed' equivalent per the Phase 0.2
//     forensic finding; or 2+ independent scorers) -> falls back to the
//     FIRST scorer's own format/config/instances alone (Phase 1's existing
//     single-score-equivalence rule, applied to just that one component).
//     This is a KNOWN, DOCUMENTED, REPORTED limitation (Phase 3 final
//     report) - the pre-Composer scalar columns cannot represent this shape
//     at all without a schema change (explicitly out of scope), so a reader
//     that only understands those columns sees just that one component. It
//     is NEVER lost: the persisted components[] (movement_prescriptions)
//     remains complete and this same editor round-trips it perfectly on
//     reopen. This is NOT the same decision as Phase 2.1's "no primary
//     component" rule (wod_logs persistence, still enforced unchanged,
//     untouched by this file) - it is an unrelated, pre-existing structural
//     limit of the legacy `wods` scalar schema.
export function deriveLegacyFieldsFromComponents(components) {
  const list = components || []
  const scorers = list.filter(c => c.producesScore)
  if (scorers.length === 0) return null

  const primaryScorer = scorers[0]
  const envelope = getScoreEnvelope(list, primaryScorer.id)
  const bookends = envelope.filter(c => c.id !== primaryScorer.id)

  if (scorers.length === 1 && bookends.length > 0 && (primaryScorer.format === 'AMRAP' || primaryScorer.format === 'For Time')) {
    const buyIn = bookends.find(c => c.role === 'buy-in')
    const cashOut = bookends.find(c => c.role === 'cash-out')
    const isAmrap = primaryScorer.format === 'AMRAP'
    return {
      type: isAmrap ? 'AMRAP with Buy-In' : 'Buy-In/Cash-Out',
      formatConfig: {
        ...(isAmrap
          ? { totalDurationSec: primaryScorer.config?.durationSec ?? null }
          : { mainFormat: 'For Time', mainDurationSec: primaryScorer.config?.timeCapSec ?? null }),
        buyIn: buyIn ? buildLegacyArtifactsForVariant(buyIn.instances || []).lines : [],
        cashOut: cashOut ? buildLegacyArtifactsForVariant(cashOut.instances || []).lines : [],
      },
      instances: primaryScorer.instances || [],
    }
  }

  return {
    type: primaryScorer.format,
    formatConfig: primaryScorer.config || {},
    instances: primaryScorer.instances || [],
  }
}

/** Whether a components[] array represents genuine Composer authoring worth
 * treating as authoritative, as opposed to componentsFromSection's own
 * trivial single-component fallback wrapping an EMPTY, never-programmed
 * variant (ticket §32 - every variant, even a bare/untouched one, gets a
 * components[] projection purely so the Composer editor always has
 * something to render; that projection must NOT be mistaken for "this
 * variant was authored via the Composer" at save time - see
 * wodSections.js's legacyPayloadFromSections, which must keep leaving
 * movement_prescriptions.variants[key] entirely absent for a variant with
 * nothing real in it, exactly as before this ticket). */
export function hasComposerContent(components) {
  const list = components || []
  if (list.length > 1) return true
  if (list.length === 1) {
    const c = list[0]
    return (c.instances || []).length > 0 || c.scoreOwnerId != null || c.role != null || c.format === 'Rest'
  }
  return false
}

/** Every MovementInstance across every component, flattened in canonical
 * order - used ONLY for save-time prescription-completeness validation
 * (wodSections.js's validatePrescriptionCompleteness), which does not care
 * which component a movement belongs to, only whether every load/distance/
 * calories spec the coach started is fully filled. Never used for scoring/
 * envelope/persistence - those always resolve per-component. */
export function allInstancesFromComponents(components) {
  return (components || []).flatMap(c => c.instances || [])
}

/** Generate Variants / Regenerate with AI compatibility shim (ticket §31) -
 * these two existing coach actions only ever operate on ONE variant's flat
 * movement list at a time (scalingEngine.js/the AI regenerate endpoint - both
 * unmodified, out of scope). For the overwhelming common "simple" Composer
 * graph (RX has 0 or 1 component, no envelope), they still work unchanged:
 * this produces the target variant's ONE component, mirroring the RX
 * component's own format/role/config with freshly-generated instances - the
 * exact same "regenerate this variant's movements" effect as before
 * Composer existed, just re-homed into components[]. For a genuinely complex
 * RX graph (2+ components) neither action has a safe, unambiguous target
 * component to regenerate into - the caller (PrimarySectionBody) disables
 * both and explains why, rather than guessing (ticket §31's own escape
 * hatch: "preserve current legacy behavior and explicitly report the
 * limitation"). */
export function isSimpleComposerGraph(components) {
  return (components || []).length <= 1
}

export function applyGeneratedInstancesToComponent(referenceComponent, instances) {
  if (!referenceComponent) return []
  return [createComponent({
    format: referenceComponent.format, role: referenceComponent.role,
    producesScore: referenceComponent.producesScore, config: referenceComponent.config, instances,
  })]
}

/** A brand-new primary section's starting variants (ticket §5 - "Start
 * Empty means exactly that": `components: []`, no default Buy-In/AMRAP/For
 * Time/Rest ever auto-inserted). One independent, empty components[] array
 * per variant (ticket §30 - variant independence from the very first
 * moment), never a single array shared/aliased across variants. Carries the
 * same `instances`/`movements`/`quickAdd`/`paste`/`weight`/`note` fields as
 * wodSections.js's own emptySectionVariants() (`instances` stays an unused,
 * harmless legacy mirror once Composer authoring is active - ticket §27's
 * per-variant Notes field is the only one of those still read/written by
 * the Composer editor). */
export function createEmptyComposerVariants() {
  return Object.fromEntries(VARIANTE_WEIGHT_BASE.map(v => [v.key, { instances: [], movements: [], quickAdd: '', paste: '', weight: { male: '', female: '' }, note: '', components: [] }]))
}
