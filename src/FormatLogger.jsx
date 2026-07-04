// Logarea (membru) unui antrenament, plecand de la formatul si config-ul
// definite de admin - genereaza UI-ul potrivit dupa "familia" formatului
// (scored / sets / mixed / nft), generalizand blocurile existente de logare
// AMRAP/For Time si de seturi Weightlifting din App.jsx.
import { getFormat, defaultRowsForFormat, addSetRow, updateSetRow, removeSetRow } from './workoutFormats'

const inputStyle = { width: '100%', padding: '10px 12px', borderRadius: '10px', border: '1px solid #e0e0e0', fontSize: '13px', background: '#fafafa', boxSizing: 'border-box' }
const smallLabelStyle = { fontSize: '11px', color: '#888', marginBottom: '4px', fontWeight: '600' }

function RoundsPartialFields({ movements, roundsCompleted, partialReps, onChange, t }) {
  return (
    <>
      <div style={{ marginBottom: '14px' }}>
        <div style={smallLabelStyle}>{t?.logWodRoundsCompletedLabel || 'Runde complete'}</div>
        <input type="number" min="0" value={roundsCompleted || ''} onChange={e => onChange({ roundsCompleted: e.target.value })}
          placeholder={t?.logWodRoundsPlaceholder} style={inputStyle} />
      </div>
      {movements.length > 0 && (
        <div style={{ marginBottom: '14px' }}>
          <div style={{ ...smallLabelStyle, marginBottom: '8px' }}>{t?.logWodPartialRoundLabel || 'Repetări în runda parțială'}</div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
            {movements.map((m, i) => (
              <div key={i} style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                <div style={{ flex: 1, fontSize: '13px', color: '#0E0E0E' }}>{m}</div>
                <input type="number" min="0" value={(partialReps || [])[i] || ''}
                  onChange={e => { const next = [...(partialReps || [])]; next[i] = e.target.value; onChange({ partialReps: next }) }}
                  placeholder="0" style={{ width: '70px', padding: '10px 12px', borderRadius: '10px', border: '1px solid #e0e0e0', fontSize: '13px', background: '#fafafa', boxSizing: 'border-box', textAlign: 'center' }} />
              </div>
            ))}
          </div>
        </div>
      )}
    </>
  )
}

function TimeResultFields({ result, time, onChange, t }) {
  const [tMin, tSec] = (time || '').split(':')
  return (
    <>
      <div style={{ marginBottom: '14px' }}>
        <div style={smallLabelStyle}>{t?.logWodResultLabel || 'Rezultat'}</div>
        <input value={result || ''} onChange={e => onChange({ result: e.target.value })} placeholder={t?.logWodResultPlaceholder} style={inputStyle} />
      </div>
      <div style={{ marginBottom: '14px' }}>
        <div style={smallLabelStyle}>{t?.logWodTimeLabel || 'Timp'}</div>
        <div style={{ display: 'flex', gap: '10px' }}>
          <div style={{ flex: 1 }}>
            <input type="number" min="0" value={tMin || ''} onChange={e => onChange({ time: `${e.target.value}:${tSec || '00'}` })} placeholder="4" style={inputStyle} />
            <div style={{ fontSize: '10px', color: '#aaa', marginTop: '3px', textAlign: 'center' }}>{t?.logWodMinutesLabel || 'min'}</div>
          </div>
          <div style={{ flex: 1 }}>
            <input type="number" min="0" max="59" value={tSec || ''} onChange={e => onChange({ time: `${tMin || '0'}:${e.target.value}` })} placeholder="22" style={inputStyle} />
            <div style={{ fontSize: '10px', color: '#aaa', marginTop: '3px', textAlign: 'center' }}>{t?.logWodSecondsLabel || 'sec'}</div>
          </div>
        </div>
      </div>
    </>
  )
}

function ScoredFields({ scoreMode, movements, value, onChange, t }) {
  if (scoreMode === 'amrap') {
    return <RoundsPartialFields movements={movements} roundsCompleted={value.roundsCompleted} partialReps={value.partialReps} onChange={onChange} t={t} />
  }
  if (scoreMode === 'single_value') {
    return (
      <div style={{ marginBottom: '14px' }}>
        <div style={smallLabelStyle}>{t?.logWodResultLabel || 'Rezultat maxim'}</div>
        <input value={value.result || ''} onChange={e => onChange({ result: e.target.value })} placeholder={t?.logWodResultPlaceholder} style={inputStyle} />
      </div>
    )
  }
  if (scoreMode === 'fortime_or_amrap') {
    return (
      <>
        <TimeResultFields result={value.result} time={value.time} onChange={onChange} t={t} />
        <div style={{ fontSize: '11px', color: '#aaa', margin: '-6px 0 10px' }}>{t?.logWodFortimeOrAmrapHint || 'Dacă nu ai terminat în time cap, completează în loc runde + reps parțiale:'}</div>
        <RoundsPartialFields movements={movements} roundsCompleted={value.roundsCompleted} partialReps={value.partialReps} onChange={onChange} t={t} />
      </>
    )
  }
  return <TimeResultFields result={value.result} time={value.time} onChange={onChange} t={t} />
}

function SetsRows({ rowKey, rows, onChange, weightUnit, t }) {
  return (
    <div style={{ marginBottom: '16px' }}>
      <div style={{ fontSize: '13px', fontWeight: '600', color: '#0E0E0E', marginBottom: '8px' }}>{rowKey}</div>
      {(rows || []).map((row, si) => (
        <div key={si} style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '6px' }}>
          <span style={{ fontSize: '11px', color: '#888', minWidth: '42px' }}>{t?.skillLogSetLabel ? t.skillLogSetLabel(si + 1) : `Set ${si + 1}`}</span>
          <input type="number" value={row.reps || ''} onChange={e => onChange(updateSetRow({ [rowKey]: rows }, rowKey, si, 'reps', e.target.value)[rowKey])}
            placeholder={t?.skillLogRepsPlaceholder || 'reps'}
            style={{ width: '70px', padding: '8px 12px', borderRadius: '10px', border: '1px solid #e0e0e0', fontSize: '13px', background: '#fafafa', boxSizing: 'border-box' }} />
          <input type="number" value={row.weight || ''} onChange={e => onChange(updateSetRow({ [rowKey]: rows }, rowKey, si, 'weight', e.target.value)[rowKey])}
            placeholder={weightUnit === 'lbs' ? 'lbs' : 'kg'}
            style={{ flex: 1, padding: '8px 12px', borderRadius: '10px', border: '1px solid #e0e0e0', fontSize: '13px', background: '#fafafa', boxSizing: 'border-box' }} />
          <button type="button" onClick={() => onChange(removeSetRow({ [rowKey]: rows }, rowKey, si)[rowKey])}
            style={{ background: 'none', border: 'none', color: '#aaa', fontSize: '18px', cursor: 'pointer', lineHeight: 1, padding: '0 4px', flexShrink: 0 }}>×</button>
        </div>
      ))}
      <button type="button" onClick={() => onChange(addSetRow({ [rowKey]: rows }, rowKey)[rowKey])}
        style={{ padding: '6px 12px', background: '#f0f0f0', color: '#0E0E0E', border: 'none', borderRadius: '8px', fontSize: '12px', fontWeight: '600', cursor: 'pointer' }}>
        {t?.skillLogAddSet || '+ set'}
      </button>
    </div>
  )
}

function SetsFields({ formatId, config, movements, sets, onChange, weightUnit, t }) {
  const rowsByKey = Object.keys(sets || {}).length > 0 ? sets : defaultRowsForFormat(formatId, config, movements)
  return (
    <>
      {Object.entries(rowsByKey).map(([key, rows]) => (
        <SetsRows key={key} rowKey={key} rows={rows}
          onChange={patch => onChange({ ...rowsByKey, ...patch })}
          weightUnit={weightUnit} t={t} />
      ))}
    </>
  )
}

export default function FormatLogger({ formatId, config, movements, value, onChange, weightUnit, t }) {
  const format = getFormat(formatId)
  const v = value || {}
  const patch = (p) => onChange({ ...v, ...p })

  if (format.family === 'sets') {
    return <SetsFields formatId={formatId} config={config} movements={movements || []} sets={v.sets}
      onChange={sets => patch({ sets })} weightUnit={weightUnit} t={t} />
  }

  if (format.family === 'mixed') {
    const buyIn = (config?.buyIn && config.buyIn.length > 0) ? config.buyIn : ['Buy-In']
    const cashOut = (config?.cashOut && config.cashOut.length > 0) ? config.cashOut : ['Cash-Out']
    const buyInRows = (v.sets || {})['__buyIn'] ? { [buyIn.join(' + ')]: v.sets['__buyIn'] } : { [buyIn.join(' + ')]: [{ reps: '', weight: '', completed: false }] }
    const cashOutRows = (v.sets || {})['__cashOut'] ? { [cashOut.join(' + ')]: v.sets['__cashOut'] } : { [cashOut.join(' + ')]: [{ reps: '', weight: '', completed: false }] }
    return (
      <>
        <div style={{ fontSize: '12px', fontWeight: '700', color: '#791F1F', marginBottom: '6px' }}>Buy-In</div>
        {Object.entries(buyInRows).map(([key, rows]) => (
          <SetsRows key={key} rowKey={key} rows={rows}
            onChange={patchRows => patch({ sets: { ...v.sets, __buyIn: patchRows[key] } })}
            weightUnit={weightUnit} t={t} />
        ))}
        <div style={{ fontSize: '12px', fontWeight: '700', color: '#0E0E0E', margin: '10px 0 6px' }}>Main Work</div>
        <ScoredFields scoreMode={config?.mainFormat === 'AMRAP' ? 'amrap' : 'fortime'} movements={movements || []} value={v} onChange={patch} t={t} />
        <div style={{ fontSize: '12px', fontWeight: '700', color: '#791F1F', margin: '10px 0 6px' }}>Cash-Out</div>
        {Object.entries(cashOutRows).map(([key, rows]) => (
          <SetsRows key={key} rowKey={key} rows={rows}
            onChange={patchRows => patch({ sets: { ...v.sets, __cashOut: patchRows[key] } })}
            weightUnit={weightUnit} t={t} />
        ))}
      </>
    )
  }

  if (format.family === 'nft') {
    return (
      <div style={{ marginBottom: '14px', display: 'flex', alignItems: 'center', gap: '10px' }}>
        <input type="checkbox" checked={!!v.completed} onChange={e => patch({ completed: e.target.checked })} style={{ width: '18px', height: '18px' }} />
        <span style={{ fontSize: '13px', color: '#0E0E0E' }}>{t?.logWodCompletedLabel || 'Completat'}</span>
      </div>
    )
  }

  return <ScoredFields scoreMode={format.scoreMode} movements={movements || []} value={v} onChange={patch} t={t} />
}

export function PrCandidatesConfirm({ candidates, onDismiss, onConfirm, onDone, t }) {
  if (!candidates || candidates.length === 0) return null
  return (
    <div style={{ marginTop: '14px', background: '#F5FBEA', border: '1px solid #ABE73C', borderRadius: '12px', padding: '14px' }}>
      <div style={{ fontSize: '13px', fontWeight: '700', color: '#0E0E0E', marginBottom: '10px' }}>{t?.skillPrConfirmTitle || 'PR nou?'}</div>
      {candidates.map(c => (
        <div key={c.reps} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '8px 0', borderBottom: '1px solid #ddeec4' }}>
          <span style={{ fontSize: '13px', color: '#0E0E0E' }}>{t?.prRepCountLabel ? t.prRepCountLabel(c.reps) : `${c.reps} reps`} — {c.weight}{c.unit}</span>
          <div style={{ display: 'flex', gap: '6px' }}>
            <button onClick={() => onDismiss(c)}
              style={{ fontSize: '11px', padding: '5px 10px', background: '#fff', border: '1px solid #e0e0e0', borderRadius: '8px', cursor: 'pointer' }}>{t?.skillPrConfirmDismissButton || 'renunță'}</button>
            <button onClick={() => onConfirm(c)}
              style={{ fontSize: '11px', fontWeight: '700', padding: '5px 10px', background: '#ABE73C', border: 'none', borderRadius: '8px', cursor: 'pointer' }}>{t?.skillPrConfirmSaveButton || 'salvează ca PR'}</button>
          </div>
        </div>
      ))}
      <button onClick={onDone}
        style={{ marginTop: '10px', width: '100%', padding: '9px', background: '#0E0E0E', color: '#ABE73C', border: 'none', borderRadius: '8px', fontSize: '12px', fontWeight: '600', cursor: 'pointer' }}>
        {t?.skillPrConfirmDoneButton || 'gata'}
      </button>
    </div>
  )
}
