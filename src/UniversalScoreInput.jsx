// P9.5 — UniversalScoreInput: one adaptive "YOUR SCORE" input, driven by the
// ScoreDefinition adapter (scoreDefinition.js) over Forge's EXISTING scoring
// contract. The value/onChange contract is byte-identical to FormatLogger's
// ({ result, time, roundsCompleted, partialReps, sets, completed, weightLogged,
// stages }) so composeWodLogFields reads it unchanged.
//
// Handled here (clean redesign): TIME · TIME_CAPPED · ROUNDS_REPS · REPS · LOAD
// · DISTANCE · CALORIES · NONE.
// Delegated to <FormatLogger> unchanged: SETS · STAGES · FREE / anything else
// (the battle-tested strength/interval/chained/max-effort logic stays intact).
//
// TOGGLE RULE (owner §3): Finished and Time Capped are mutually exclusive.
// Switching clears the incompatible draft fields via onChange so the SUBMITTED
// payload never carries a stale time (capped) or stale rounds (finished).

import { useState } from 'react'
import FormatLogger from './FormatLogger'
import SequentialAmrapFields from './SequentialAmrapFields'
import { resolveNumericInput } from './prescriptionContract'
import { secToTime } from './utils'

const card = { background: '#fff', border: '1px solid #ECECEC', borderRadius: '16px', padding: '16px' }
const label = { fontSize: '11px', fontWeight: '600', letterSpacing: '0.04em', color: '#9A9A9A', textTransform: 'uppercase', marginBottom: '8px' }
const numInput = { width: '100%', padding: '13px 14px', borderRadius: '12px', border: '1px solid #E4E4E4', fontSize: '17px', fontWeight: '600', color: '#0E0E0E', background: '#fff', boxSizing: 'border-box', outline: 'none' }
const unitTxt = { fontSize: '13px', fontWeight: '600', color: '#9A9A9A', marginLeft: '10px', alignSelf: 'center' }

function NumRow({ value, onCommit, integer, ariaLabel, placeholder, suffix, width }) {
  const [focused, setFocused] = useState(false)
  const [draft, setDraft] = useState('')
  const shown = focused ? draft : (value == null || value === '' ? '' : String(value))
  return (
    <div style={{ display: 'flex' }}>
      <input
        style={{ ...numInput, width: width || '100%', textAlign: 'center' }}
        inputMode={integer ? 'numeric' : 'decimal'}
        value={shown}
        aria-label={ariaLabel}
        placeholder={placeholder}
        onFocus={() => { setDraft(value == null ? '' : String(value)); setFocused(true) }}
        onChange={(e) => {
          setDraft(e.target.value)
          const r = resolveNumericInput(e.target.value, { integer, previous: value === '' ? null : Number(value), final: false })
          if (r.commit) onCommit(r.value == null ? '' : String(r.value))
        }}
        onBlur={(e) => {
          const r = resolveNumericInput(e.target.value, { integer, previous: value === '' ? null : Number(value), final: true })
          onCommit(r.value == null ? '' : String(r.value))
          setFocused(false)
        }}
      />
      {suffix && <span style={unitTxt}>{suffix}</span>}
    </div>
  )
}

function TimeRow({ time, onChange, ariaPrefix }) {
  const [mm, ss] = (time || '').split(':')
  return (
    <div style={{ display: 'flex', gap: '10px' }}>
      <div style={{ flex: 1 }}>
        <input type="number" min="0" inputMode="numeric" value={mm || ''} aria-label={`${ariaPrefix} minutes`}
          onChange={e => onChange(`${e.target.value}:${ss || '00'}`)} placeholder="17" style={{ ...numInput, textAlign: 'center' }} />
        <div style={{ fontSize: '10px', color: '#B5B5B5', marginTop: '4px', textAlign: 'center' }}>min</div>
      </div>
      <span style={{ alignSelf: 'flex-start', fontSize: '20px', fontWeight: '700', color: '#CFCFCF', marginTop: '11px' }}>:</span>
      <div style={{ flex: 1 }}>
        <input type="number" min="0" max="59" inputMode="numeric" value={ss || ''} aria-label={`${ariaPrefix} seconds`}
          onChange={e => onChange(`${mm || '0'}:${e.target.value}`)} placeholder="42" style={{ ...numInput, textAlign: 'center' }} />
        <div style={{ fontSize: '10px', color: '#B5B5B5', marginTop: '4px', textAlign: 'center' }}>sec</div>
      </div>
    </div>
  )
}

function PartialRepsRows({ movements, partialReps, onChange, t }) {
  if (!movements || movements.length === 0) return null
  return (
    <div style={{ marginTop: '14px' }}>
      <div style={{ ...label, marginBottom: '10px' }}>{t?.logWodPartialRoundLabel || 'Reps in the partial round'}</div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
        {movements.map((m, i) => (
          <div key={i} style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
            <div style={{ flex: 1, fontSize: '14px', color: '#0E0E0E', minWidth: 0 }}>{m}</div>
            <input type="number" min="0" inputMode="numeric" value={(partialReps || [])[i] || ''} aria-label={`${m} reps`}
              onChange={e => { const next = [...(partialReps || [])]; next[i] = e.target.value; onChange(next) }}
              placeholder="0" style={{ ...numInput, width: '76px', textAlign: 'center', fontSize: '15px' }} />
          </div>
        ))}
      </div>
    </div>
  )
}

// P9.5.1 — Rounds completed + a SINGLE "additional reps" number (owner §11/§12).
// The athlete never computes a total; the leaderboard derives it from
// (rounds, additionalReps) — see composeCappedRoundsResult / sortSectionLogs.
// No formula, no "calculated automatically" text.
function RoundsAndAdditionalReps({ v, patch, t, roundsPlaceholder, repsPlaceholder }) {
  return (
    <div style={{ display: 'flex', gap: '12px' }}>
      <div style={{ flex: 1 }}>
        <div style={label}>{t?.logWodRoundsCompletedLabel || 'Rounds completed'}</div>
        <NumRow value={v.roundsCompleted} integer ariaLabel="Rounds completed"
          onCommit={(x) => patch({ roundsCompleted: x })} placeholder={roundsPlaceholder} />
      </div>
      <div style={{ flex: 1 }}>
        <div style={label}>{t?.logWodAdditionalRepsLabel || 'Additional reps'}</div>
        <NumRow value={v.additionalReps} integer ariaLabel="Additional reps"
          onCommit={(x) => patch({ additionalReps: x })} placeholder={repsPlaceholder} />
      </div>
    </div>
  )
}

// [Finished] [Did not finish] — selected state communicated by fill AND weight
// (not colour alone), owner §35. Copy is presentation only (owner P9.5.3 §5);
// the internal mode stays 'finished' / 'capped' and the persisted
// completion_state stays completed / capped.
function FinishedCappedToggle({ mode, onPick, t }) {
  const btn = (active) => ({
    flex: 1, padding: '12px 8px', borderRadius: '12px', border: `1px solid ${active ? '#0E0E0E' : '#E4E4E4'}`,
    background: active ? '#0E0E0E' : '#fff', color: active ? '#fff' : '#6B6B6B',
    fontSize: '13px', fontWeight: active ? '700' : '500', cursor: 'pointer',
  })
  return (
    <div role="radiogroup" aria-label="Finished or did not finish" style={{ display: 'flex', gap: '10px', marginBottom: '16px' }}>
      <button type="button" role="radio" aria-checked={mode === 'finished'} style={btn(mode === 'finished')} onClick={() => onPick('finished')}>
        {t?.logWodFinishedLabel || 'Finished'}
      </button>
      <button type="button" role="radio" aria-checked={mode === 'capped'} style={btn(mode === 'capped')} onClick={() => onPick('capped')}>
        {t?.logWodDidNotFinishLabel || 'Did not finish'}
      </button>
    </div>
  )
}

export default function UniversalScoreInput({
  def, formatId, config, movements, value, onChange, weightUnit, t, prescribedWeight, rxStatus,
}) {
  const v = value || {}
  const patch = (p) => onChange({ ...v, ...p })
  const kind = def?.kind || 'FREE'

  // SETS / STAGES / anything else -> the existing, tested logger, unchanged.
  if (kind === 'SETS' || kind === 'STAGES' || kind === 'FREE') {
    return (
      <FormatLogger
        formatId={formatId} config={config} movements={movements} value={v} onChange={onChange}
        weightUnit={weightUnit} t={t} prescribedWeight={prescribedWeight} rxStatus={rxStatus}
      />
    )
  }

  // Weight field (RX gate) — reused for the metric families that carry a load.
  const weightBlock = prescribedWeight ? (
    <div style={{ marginBottom: '16px' }}>
      <div style={{ ...label, display: 'flex', alignItems: 'center', gap: '8px' }}>
        <span>{t?.logWodWeightLabel || 'Weight'}</span>
        {rxStatus && (
          <span style={{ fontSize: '10px', fontWeight: '700', padding: '2px 8px', borderRadius: '999px',
            color: rxStatus === 'rx' ? '#3D8B3D' : '#9A6B00', background: rxStatus === 'rx' ? '#EAF6EA' : '#FDF3DC' }}>
            {rxStatus === 'rx' ? (t?.logWodRxBadge || 'RX') : (t?.logWodNotRxBadge || 'Not Rx')}
          </span>
        )}
      </div>
      <NumRow value={v.weightLogged} integer={false} ariaLabel={t?.logWodWeightLabel || 'Weight'}
        onCommit={(x) => patch({ weightLogged: x })} suffix={weightUnit === 'lbs' ? 'lb' : 'kg'} />
    </div>
  ) : null

  if (kind === 'NONE') {
    return (
      <div style={card}>
        <label style={{ display: 'flex', alignItems: 'center', gap: '12px', cursor: 'pointer' }}>
          <input type="checkbox" checked={!!v.completed} onChange={e => patch({ completed: e.target.checked })} style={{ width: '20px', height: '20px' }} />
          <span style={{ fontSize: '14px', color: '#0E0E0E' }}>{t?.logWodCompletedLabel || 'Completed'}</span>
        </label>
      </div>
    )
  }

  if (kind === 'ROUNDS_REPS') {
    return (
      <div style={card}>
        {weightBlock}
        <RoundsAndAdditionalReps v={v} patch={patch} t={t} roundsPlaceholder="7" repsPlaceholder="12" />
      </div>
    )
  }

  // INC-11 - Sequence AMRAP: ordered station progress + live Total Reps. Reuses
  // the existing `partialReps` value slot; composeWodLogFields writes the frozen
  // sequential result string.
  if (kind === 'SEQUENTIAL_AMRAP') {
    return (
      <div style={card}>
        {weightBlock}
        <SequentialAmrapFields stations={def.stations} performed={v.partialReps}
          onChange={(p) => patch(p)} t={t} />
      </div>
    )
  }

  if (kind === 'REPS' || kind === 'LOAD' || kind === 'DISTANCE' || kind === 'CALORIES') {
    const suffix = kind === 'REPS' ? (t?.logWodRepsUnit || 'reps')
      : kind === 'CALORIES' ? 'Cal'
      : def.unit || (kind === 'LOAD' ? (weightUnit === 'lbs' ? 'lb' : 'kg') : 'm')
    return (
      <div style={card}>
        {weightBlock}
        <div style={label}>{t?.logWodYourResultLabel || 'Result'}</div>
        <NumRow value={v.result} integer={!!def.integer} ariaLabel={t?.logWodYourResultLabel || 'Result'}
          onCommit={(x) => patch({ result: x })} suffix={suffix} placeholder={kind === 'REPS' ? '87' : kind === 'CALORIES' ? '142' : ''} />
      </div>
    )
  }

  // TIME / TIME_CAPPED — its own component so the toggle's useState is never
  // called conditionally (React hooks rule).
  return (
    <div style={card}>
      {weightBlock}
      <TimeScoreBlock def={def} movements={movements} v={v} patch={patch} t={t} />
    </div>
  )
}

function TimeScoreBlock({ def, movements, v, patch, t }) {
  const hasTime = !!(v.time || '').trim()
  const hasCappedWork = !!((v.roundsCompleted || '').toString().trim() || (v.additionalReps || '').toString().trim() || (v.partialReps || []).some(x => (x || '').toString().trim()))
  // NEW log -> Finished; an edit whose draft already carries capped work -> Time Capped.
  const [mode, setMode] = useState(hasCappedWork && !hasTime ? 'capped' : 'finished')
  const capable = def.kind === 'TIME_CAPPED'

  const pick = (next) => {
    if (next === mode) return
    setMode(next)
    // PAYLOAD CORRECTNESS (owner §14): never submit stale incompatible fields.
    if (next === 'finished') patch({ roundsCompleted: '', additionalReps: '', partialReps: [] })
    else patch({ time: '' })
  }

  if (!capable) {
    // No cap configured — a pure finishing time.
    return (
      <>
        <div style={label}>{t?.logWodTimeLabel || 'Time'}</div>
        <TimeRow time={v.time} onChange={(x) => patch({ time: x })} ariaPrefix="Time" />
      </>
    )
  }

  return (
    <>
      <FinishedCappedToggle mode={mode} onPick={pick} t={t} />
      {mode === 'finished' ? (
        <>
          <div style={label}>{t?.logWodTimeLabel || 'Time'}</div>
          <TimeRow time={v.time} onChange={(x) => patch({ time: x })} ariaPrefix="Finish time" />
        </>
      ) : (
        <>
          {def.sequential ? (
            <PartialRepsRows movements={movements} partialReps={v.partialReps} onChange={(x) => patch({ partialReps: x })} t={t} />
          ) : (
            <RoundsAndAdditionalReps v={v} patch={patch} t={t} roundsPlaceholder="2" repsPlaceholder="43" />
          )}
          {def.timeCapSec ? (
            <div style={{ fontSize: '12px', color: '#9A9A9A', marginTop: '12px' }}>
              {(t?.logWodTimeCapValueLabel && t.logWodTimeCapValueLabel(secToTime(def.timeCapSec))) || `Time cap: ${secToTime(def.timeCapSec)}`}
            </div>
          ) : null}
        </>
      )}
    </>
  )
}
