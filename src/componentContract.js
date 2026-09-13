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

import { getFormat, repsEfectiveSecvential, composePartialText, composeAmrapResult, composeFortimeOrAmrapFields, deriveDurationCompletionState, isSequentialFormat, WORKOUT_FORMATS } from './workoutFormats'
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
  mainRoundsCompleted, mainPartialReps, mainMovements,
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
    const text = composeAmrapResult(input.roundsCompleted, input.partialReps, input.movementLines || []) || null
    return {
      format: scoringComponent.format, envelopeComponentIds: [scoringComponent.id],
      result: text, time_result: null, completion_state: null, sets: null,
    }
  }

  // Repeated-rounds RFT/Partner-WOD-style (scoreMode 'fortime_or_amrap',
  // NOT sequential) - reuse the existing pure composer unchanged.
  const { result, time_result, completionState } = composeFortimeOrAmrapFields({
    wodTime: input.finishedValue, wodRoundsCompleted: input.roundsCompleted, wodPartialReps: input.partialReps,
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
    log_meta: { composerVersion: 1, componentResults },
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
