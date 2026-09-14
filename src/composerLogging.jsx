// FORGE WORKOUT COMPOSER - PHASE 4 (multi-scorer member logging UI).
//
// Renders one native score-envelope logger per producesScore:true
// component, in canonical execution order. Reuses UniversalScoreInput and
// FormatLogger's MultiMovementPartialRows UNCHANGED (both are dependency-
// free leaf modules - no circular import risk importing them directly here,
// unlike App.jsx's own MovementRowListPWA/EmomMinutePatternEditor). This
// file never reimplements a native format's scoring UI - it only decides
// WHICH scorer's UI is showing and WHERE its state lives.
//
// CORE INVARIANT (ticket §2) - the stepper follows canonical score
// envelopes (getOrderedScoreEnvelopes, componentContract.js), never legacy
// main format / first-or-last scorer / a scalar field. An owned envelope
// (Buy-In/RFT/Cash-Out) is always ONE step - Buy-In/Cash-Out render via
// MultiMovementPartialRows ABOVE/BELOW that one scorer's own
// UniversalScoreInput, never as separate steps. Rest never produces a step
// at all (it is simply absent from getOrderedScoreEnvelopes' output).

import { componentHeaderLabel, renderComponentMovementLines } from './componentContract'
import { scoreDefinitionFor } from './scoreDefinition'
import UniversalScoreInput from './UniversalScoreInput'
import { MultiMovementPartialRows } from './FormatLogger'

const stepLabel = { fontSize: '11px', fontWeight: '700', color: '#9A9A9A', letterSpacing: '0.05em', textTransform: 'uppercase' }
const navBtn = { flex: 1, padding: '12px', borderRadius: '12px', border: '1px solid #ECECEC', background: '#fff', color: '#0E0E0E', fontSize: '14px', fontWeight: '600', cursor: 'pointer' }
const navBtnPrimary = { ...navBtn, background: '#0E0E0E', color: '#fff', border: 'none' }

/** One scorer's full logging surface - its own bookends (if any) + its own
 * native UniversalScoreInput. `value`/`onChange` use UniversalScoreInput's
 * own existing value shape unchanged (componentContract.js's
 * emptyScorerLoggerValue/scorerValueToEnvelopeInput are the ONLY place that
 * shape is defined/read). */
export function ScorerEnvelopeFields({ scorer, buyIn, cashOut, value, onChange, weightUnit, t, gender, prescribedWeight, rxStatus }) {
  const v = value || {}
  const patchSets = (key, rows) => onChange({ ...v, sets: { ...(v.sets || {}), [key]: rows } })
  const scoreDef = scoreDefinitionFor(scorer.format, scorer.config, {})
  const movements = renderComponentMovementLines(scorer.instances, gender)

  return (
    <div>
      {buyIn && (
        <MultiMovementPartialRows label={componentHeaderLabel(buyIn)} movements={renderComponentMovementLines(buyIn.instances, gender)}
          rows={v.sets?.__buyIn} onChange={rows => patchSets('__buyIn', rows)} t={t} />
      )}
      <UniversalScoreInput def={scoreDef} formatId={scorer.format} config={scorer.config} movements={movements}
        value={v} onChange={onChange} weightUnit={weightUnit} t={t} prescribedWeight={prescribedWeight} rxStatus={rxStatus} />
      {cashOut && (
        <MultiMovementPartialRows label={componentHeaderLabel(cashOut)} movements={renderComponentMovementLines(cashOut.instances, gender)}
          rows={v.sets?.__cashOut} onChange={rows => patchSets('__cashOut', rows)} t={t} />
      )}
    </div>
  )
}

/** The multi-scorer logging session (ticket §5/§6). `envelopes` -
 * getOrderedScoreEnvelopes(components)'s own output, canonical order.
 * `valuesByComponentId` / `onChangeComponent(componentId, nextValue)` - the
 * caller (App.jsx) owns this state, keyed by stable componentId (ticket
 * §20), never array position. `step`/`onStepChange` - caller-owned index,
 * so navigating Back/Next never remounts this component and never resets
 * sibling state (ticket §21). A single-envelope WOD (ticket §7 - including
 * an owned Buy-In/RFT/Cash-Out envelope, ticket §8) renders with ZERO
 * stepper chrome - visually/behaviorally identical to one bare
 * ScorerEnvelopeFields, no "Score 1 of 1". */
export default function MultiScorerLogger({ envelopes, valuesByComponentId, onChangeComponent, step, onStepChange, weightUnit, t, gender, prescribedWeight, rxStatus }) {
  const list = envelopes || []
  if (list.length === 0) return null
  const single = list.length === 1
  const clampedStep = Math.max(0, Math.min(step || 0, list.length - 1))
  const current = list[clampedStep]
  const value = (valuesByComponentId || {})[current.scorer.id] || {}
  const onChange = (next) => onChangeComponent(current.scorer.id, next)

  return (
    <div>
      {!single && (
        <div style={{ marginBottom: '10px' }}>
          <div style={stepLabel}>
            {(t?.logWodScoreStepLabel && t.logWodScoreStepLabel(clampedStep + 1, list.length)) || `SCORE ${clampedStep + 1} OF ${list.length}`}
          </div>
        </div>
      )}
      <div style={{ fontSize: '15px', fontWeight: '600', color: '#0E0E0E', marginBottom: '12px' }}>{componentHeaderLabel(current.scorer)}</div>
      <ScorerEnvelopeFields scorer={current.scorer} buyIn={current.buyIn} cashOut={current.cashOut}
        value={value} onChange={onChange} weightUnit={weightUnit} t={t} gender={gender}
        prescribedWeight={prescribedWeight} rxStatus={rxStatus} />
      {!single && (
        <div style={{ display: 'flex', gap: '10px', marginTop: '18px' }}>
          {clampedStep > 0 && (
            <button type="button" onClick={() => onStepChange(clampedStep - 1)} style={navBtn}>{t?.logWodScoreBack || 'Back'}</button>
          )}
          {clampedStep < list.length - 1 && (
            <button type="button" onClick={() => onStepChange(clampedStep + 1)} style={navBtnPrimary}>{t?.logWodScoreNext || 'Next'}</button>
          )}
        </div>
      )}
    </div>
  )
}
