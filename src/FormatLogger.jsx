// Logarea (membru) unui antrenament, plecand de la formatul si config-ul
// definite de admin - genereaza UI-ul potrivit dupa "familia" formatului
// (scored / sets / mixed / nft), generalizand blocurile existente de logare
// AMRAP/For Time si de seturi Weightlifting din App.jsx.
import { getFormat, defaultRowsForFormat, addSetRow, updateSetRow, removeSetRow, computeSetsScore, effectiveScoreMode, isSequentialFormat, ascendingMovementsForRound } from './workoutFormats'
import { CARDIO_MISCARI, CARDIO_CU_CALORII } from './movements'
import { secToTime } from './utils'

const inputStyle = { width: '100%', padding: '10px 12px', borderRadius: '10px', border: '1px solid #e0e0e0', fontSize: '13px', background: '#fafafa', boxSizing: 'border-box' }
const smallLabelStyle = { fontSize: '11px', color: '#888', marginBottom: '4px', fontWeight: '600' }

// Eticheta unui rand poate fi chiar numele miscarii (Superset/Weightlifting -
// "Row") sau un interval cu miscare atasata (EMOM - "Min 1 · Row") - in ambele
// cazuri, daca miscarea reala e de tip cardio, campurile de logare trebuie sa
// fie metri/cal, nu reps+greutate (ca la MiscareQuickAdd din Log liber -
// altfel aceeasi miscare se loga inconsecvent intre cele 2 fluxuri).
function cardioMiscareDinEticheta(rowKey) {
  const ultimaParte = rowKey.includes('·') ? rowKey.split('·').pop().trim() : rowKey.trim()
  return CARDIO_MISCARI.find(c => c.toLowerCase() === ultimaParte.toLowerCase()) || null
}

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

// Pentru formate secventiale (For Time/Ladder - vezi SequentialPartialFields
// mai jos), campul liber "Rezultat" e ambiguu langa o lista structurata de
// miscari - hideResult il ascunde, pastrand doar Timpul.
// Pentru "For Time"/"Ladder" (secvente de miscari distincte, nu runde
// repetate) - fiecare miscare din lista completa are propria casuta de
// repetari, pre-completata cu numarul prescris (parsat din text, ex. "15
// power snatches" -> 15). Membrul reduce doar la miscarile unde nu a ajuns
// pana la capat (sau pune 0 la cele netouched) - fara "Runde complete",
// care n-are sens intr-o secventa unica, nu repetata.
// Fallback-ul pe prescris trebuie sa se aplice DOAR cat timp campul n-a
// fost atins deloc (curent === undefined) - daca verificam si curent !==
// '', orice editare care trece prin starea goala (ex. stergi "12" cu
// backspace ca sa scrii "9": 12 -> 1 -> "" -> 9) sarea inapoi la prescris
// exact cand campul devenea gol, inainte sa apuci sa scrii cifra noua -
// facea imposibila introducerea oricarui numar partial, nu doar a lui 0.
function SequentialPartialFields({ movements, partialReps, onChange, t }) {
  return (
    <div style={{ marginBottom: '14px' }}>
      <div style={{ ...smallLabelStyle, marginBottom: '8px' }}>{t?.logWodPartialRoundLabel || 'Repetări'}</div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
        {movements.map((m, i) => {
          const prescrisMatch = m.match(/^(\d+)\s+/)
          const prescris = prescrisMatch ? prescrisMatch[1] : ''
          const curent = (partialReps || [])[i]
          const displayValue = curent != null ? curent : prescris
          return (
            <div key={i} style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
              <div style={{ flex: 1, fontSize: '13px', color: '#0E0E0E' }}>{m}</div>
              <input type="number" min="0" value={displayValue}
                onChange={e => { const next = [...(partialReps || [])]; next[i] = e.target.value; onChange({ partialReps: next }) }}
                style={{ width: '70px', padding: '10px 12px', borderRadius: '10px', border: '1px solid #e0e0e0', fontSize: '13px', background: '#fafafa', boxSizing: 'border-box', textAlign: 'center' }} />
              <button type="button" onClick={() => { const next = [...(partialReps || [])]; next[i] = '0'; onChange({ partialReps: next }) }}
                title={t?.logWodClearRepsLabel || 'Nu am făcut deloc'}
                style={{ width: '28px', height: '28px', flexShrink: 0, borderRadius: '50%', border: '1px solid #e0e0e0', background: '#fff', color: '#999', fontSize: '13px', lineHeight: 1, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 0 }}>×</button>
            </div>
          )
        })}
      </div>
    </div>
  )
}

function TimeResultFields({ result, time, onChange, t, hideResult }) {
  const [tMin, tSec] = (time || '').split(':')
  return (
    <>
      {!hideResult && (
        <div style={{ marginBottom: '14px' }}>
          <div style={smallLabelStyle}>{t?.logWodResultLabel || 'Rezultat'}</div>
          <input value={result || ''} onChange={e => onChange({ result: e.target.value })} placeholder={t?.logWodResultPlaceholder} style={inputStyle} />
        </div>
      )}
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

// Un singur camp de greutate (nu per miscare) - aparut doar cand adminul a
// prescris o greutate pentru varianta aleasa (wods.<varianta>_weight).
// Folosit sa detectam "Not RXd" (vezi isNotRxd in workoutFormats.js) daca
// greutatea logata difera de cea prescrisa. Pre-completat cu prescrisul de
// catre App.jsx la alegerea variantei (seed in state-ul real, nu fallback la
// render) - acelasi motiv ca la bug-ul de reps: fallback-ul la render
// impiedica editarea libera a campului.
function WeightField({ weightLogged, onChange, t }) {
  return (
    <div style={{ marginBottom: '14px' }}>
      <div style={smallLabelStyle}>{t?.logWodWeightLabel || 'Greutate'}</div>
      <input value={weightLogged || ''} onChange={e => onChange({ weightLogged: e.target.value })}
        placeholder={t?.logWodWeightPlaceholder || 'ex. 61kg'} style={inputStyle} />
    </div>
  )
}

function ScoredFields({ scoreMode, movements, value, onChange, t, sequentialPartial, prescribedWeight, finishedRounds }) {
  const greutateField = prescribedWeight ? <WeightField weightLogged={value.weightLogged} onChange={onChange} t={t} /> : null
  if (scoreMode === 'amrap') {
    return <>{greutateField}<RoundsPartialFields movements={movements} roundsCompleted={value.roundsCompleted} partialReps={value.partialReps} onChange={onChange} t={t} /></>
  }
  if (scoreMode === 'single_value') {
    return (
      <>
        {greutateField}
        <div style={{ marginBottom: '14px' }}>
          <div style={smallLabelStyle}>{t?.logWodResultLabel || 'Rezultat maxim'}</div>
          <input value={value.result || ''} onChange={e => onChange({ result: e.target.value })} placeholder={t?.logWodResultPlaceholder} style={inputStyle} />
        </div>
      </>
    )
  }
  if (scoreMode === 'fortime_or_amrap') {
    if (sequentialPartial) {
      return (
        <>
          {greutateField}
          <TimeResultFields result={value.result} time={value.time} onChange={onChange} t={t} hideResult />
          <div style={{ fontSize: '11px', color: '#aaa', margin: '-6px 0 10px' }}>{t?.logWodSequentialHint || 'Dacă nu ai terminat în time cap, ajustează repetările de mai jos la miscările unde nu ai ajuns:'}</div>
          <SequentialPartialFields movements={movements} partialReps={value.partialReps} onChange={onChange} t={t} />
        </>
      )
    }
    // Numarul de runde prescris (RFT, sau For Time/Partner WOD cu runde
    // repetate configurate) e deja cunoscut - a termina (Timp completat)
    // inseamna prin definitie ca ai facut toate rundele. Campul de "Rezultat"
    // liber cerea cu placeholder "ex: 18 runde complete", dar era text
    // netipizat - cineva scria doar "5", afisat ambiguu langa timp (fara
    // unitate). Cand rundele sunt cunoscute, ascundem campul liber si
    // compunem automat textul la salvare (vezi composeFinishedRoundsText in
    // App.jsx) - membrul nu mai trebuie sa scrie de mana ceva deja stiut.
    const roundsCunoscute = parseInt(finishedRounds) > 0
    return (
      <>
        {greutateField}
        <TimeResultFields result={value.result} time={value.time} onChange={onChange} t={t} hideResult={roundsCunoscute} />
        {roundsCunoscute && (
          <div style={{ fontSize: '11px', color: '#aaa', margin: '-6px 0 10px' }}>
            {t?.logWodFinishedRoundsHint ? t.logWodFinishedRoundsHint(finishedRounds) : `Dacă termini, se înregistrează automat ${finishedRounds} runde complete.`}
          </div>
        )}
        <div style={{ fontSize: '11px', color: '#aaa', margin: '-6px 0 10px' }}>{t?.logWodFortimeOrAmrapHint || 'Dacă nu ai terminat în time cap, completează în loc runde + reps parțiale:'}</div>
        <RoundsPartialFields movements={movements} roundsCompleted={value.roundsCompleted} partialReps={value.partialReps} onChange={onChange} t={t} />
      </>
    )
  }
  return <>{greutateField}<TimeResultFields result={value.result} time={value.time} onChange={onChange} t={t} /></>
}

function SetsRows({ rowKey, rows, onChange, weightUnit, t }) {
  const miscareCardio = cardioMiscareDinEticheta(rowKey)
  const cardioLabel = miscareCardio && (CARDIO_CU_CALORII.includes(miscareCardio) ? 'cal' : 'm')
  return (
    <div style={{ marginBottom: '16px' }}>
      <div style={{ fontSize: '13px', fontWeight: '600', color: '#0E0E0E', marginBottom: '8px' }}>{rowKey}</div>
      {(rows || []).map((row, si) => (
        <div key={si} style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '6px' }}>
          <span style={{ fontSize: '11px', color: '#888', minWidth: '42px' }}>{t?.skillLogSetLabel ? t.skillLogSetLabel(si + 1) : `Set ${si + 1}`}</span>
          <input type="number" value={row.reps || ''} onChange={e => onChange(updateSetRow({ [rowKey]: rows }, rowKey, si, 'reps', e.target.value)[rowKey])}
            placeholder={cardioLabel || t?.skillLogRepsPlaceholder || 'reps'}
            style={{ width: '70px', padding: '8px 12px', borderRadius: '10px', border: '1px solid #e0e0e0', fontSize: '13px', background: '#fafafa', boxSizing: 'border-box' }} />
          {row.targetReps != null && <span style={{ fontSize: '11px', color: '#aaa', whiteSpace: 'nowrap' }}>/ {row.targetReps}</span>}
          {!miscareCardio && (
            <input type="number" value={row.weight || ''} onChange={e => onChange(updateSetRow({ [rowKey]: rows }, rowKey, si, 'weight', e.target.value)[rowKey])}
              placeholder={weightUnit === 'lbs' ? 'lbs' : 'kg'}
              style={{ flex: 1, padding: '8px 12px', borderRadius: '10px', border: '1px solid #e0e0e0', fontSize: '13px', background: '#fafafa', boxSizing: 'border-box' }} />
          )}
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

// O singura valoare de reps per cheie (ex. o runda Tabata) - fara greutate,
// fara posibilitatea de a adauga alt "set" in aceeasi runda, spre deosebire
// de SetsRows (Strength Sets etc, unde chiar poti repeta un set).
function SimpleRepsRow({ rowKey, rows, onChange, t }) {
  const row = (rows && rows[0]) || { reps: '', weight: '', completed: false }
  return (
    <div style={{ marginBottom: '10px', display: 'flex', alignItems: 'center', gap: '10px' }}>
      <div style={{ fontSize: '13px', fontWeight: '600', color: '#0E0E0E', flex: 1 }}>{rowKey}</div>
      <input type="number" value={row.reps || ''} onChange={e => onChange([{ ...row, reps: e.target.value }])}
        placeholder={t?.skillLogRepsPlaceholder || 'reps'}
        style={{ width: '90px', padding: '8px 12px', borderRadius: '10px', border: '1px solid #e0e0e0', fontSize: '13px', background: '#fafafa', boxSizing: 'border-box' }} />
    </div>
  )
}

function SetsFields({ formatId, config, movements, sets, onChange, weightUnit, t }) {
  const rowsByKey = Object.keys(sets || {}).length > 0 ? sets : defaultRowsForFormat(formatId, config, movements)
  const score = computeSetsScore(formatId, config, rowsByKey)
  const Row = getFormat(formatId).simpleReps ? SimpleRepsRow : SetsRows
  return (
    <>
      {Object.entries(rowsByKey).map(([key, rows]) => (
        <Row key={key} rowKey={key} rows={rows}
          onChange={nextRows => onChange({ ...rowsByKey, [key]: nextRows })}
          weightUnit={weightUnit} t={t} />
      ))}
      {score != null && (
        <div style={{ fontSize: '13px', fontWeight: '700', color: '#0E0E0E', background: '#F5FBEA', borderRadius: '10px', padding: '10px 12px', marginBottom: '14px' }}>
          {config?.scoringMode === 'Total Reps' ? (t?.fmtTotalRepsScoreLabel || 'Total reps') : (t?.fmtLowestRepsScoreLabel || 'Cea mai slabă rundă')}: {score}
        </div>
      )}
    </>
  )
}

export default function FormatLogger({ formatId, config, movements, value, onChange, weightUnit, t, prescribedWeight }) {
  const format = getFormat(formatId)
  const v = value || {}
  const patch = (p) => onChange({ ...v, ...p })

  if (format.family === 'sets') {
    return <SetsFields formatId={formatId} config={config} movements={movements || []} sets={v.sets}
      onChange={sets => patch({ sets })} weightUnit={weightUnit} t={t} />
  }

  if (format.family === 'mixed') {
    const buyIn = (config?.buyIn && config.buyIn.length > 0) ? config.buyIn : ['Buy-In']
    const hasCashOut = Array.isArray(config?.cashOut)
    const cashOut = (config?.cashOut && config.cashOut.length > 0) ? config.cashOut : ['Cash-Out']
    const buyInRows = (v.sets || {})['__buyIn'] ? { [buyIn.join(' + ')]: v.sets['__buyIn'] } : { [buyIn.join(' + ')]: [{ reps: '', weight: '', completed: false }] }
    const cashOutRows = (v.sets || {})['__cashOut'] ? { [cashOut.join(' + ')]: v.sets['__cashOut'] } : { [cashOut.join(' + ')]: [{ reps: '', weight: '', completed: false }] }
    // effectiveScoreMode/isSequentialFormat - aceeasi sursa unica de adevar
    // folosita peste tot (Partner WOD, Chipper etc), nu un calcul local
    // duplicat. Bug real gasit (07-15): calculul local vechi nu marca
    // niciodata mainFormat "For Time" ca secvential, deci un Buy-In/Cash-Out
    // neterminat pe lucrul principal n-avea nicio urmarire structurata a
    // repetarilor (doar Timp + text liber, la fel ca bug-ul Chipper).
    const mainScoreMode = effectiveScoreMode(formatId, config) || format.scoreMode
    // Buy-In/Cash-Out sunt sarcini facute o singura data (ex. "50 Cal Row"),
    // nu seturi repetabile cu greutati diferite - acelasi motiv ca la Tabata:
    // un singur input de reps, fara greutate, fara "+ Adauga set".
    return (
      <>
        <div style={{ fontSize: '12px', fontWeight: '700', color: '#791F1F', marginBottom: '6px' }}>{t?.fmtBuyInSection || 'Buy-In'}</div>
        {Object.entries(buyInRows).map(([key, rows]) => (
          <SimpleRepsRow key={key} rowKey={key} rows={rows}
            onChange={nextRows => patch({ sets: { ...v.sets, __buyIn: nextRows } })}
            weightUnit={weightUnit} t={t} />
        ))}
        <div style={{ fontSize: '12px', fontWeight: '700', color: '#0E0E0E', margin: '10px 0 6px' }}>{t?.fmtMainWorkSection || 'Main Work'}</div>
        <ScoredFields scoreMode={mainScoreMode} movements={movements || []} value={v} onChange={patch} t={t} prescribedWeight={prescribedWeight} sequentialPartial={isSequentialFormat(formatId, config)} />
        {hasCashOut && (
          <>
            <div style={{ fontSize: '12px', fontWeight: '700', color: '#791F1F', margin: '10px 0 6px' }}>{t?.fmtCashOutSection || 'Cash-Out'}</div>
            {Object.entries(cashOutRows).map(([key, rows]) => (
              <SimpleRepsRow key={key} rowKey={key} rows={rows}
                onChange={nextRows => patch({ sets: { ...v.sets, __cashOut: nextRows } })}
                weightUnit={weightUnit} t={t} />
            ))}
          </>
        )}
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

  // WOD-uri inlantuite ("straight into") - buclam etapele din config.stages,
  // fiecare randata cu UI-ul deja existent al tipului ei: RoundsPartialFields
  // (identic ca la AMRAP simplu) pt 'amrap', SetsRows (identic ca la EMOM,
  // un singur numar de reps per interval) pt 'interval' - zero componente noi
  // de input, doar bucla peste etape cu propriul slice din v.stages[i]. Vezi
  // composeStageResult/totalRepsChained in workoutFormats.js pt scorul final.
  if (format.family === 'chained') {
    const stages = config?.stages || []
    const stageValues = v.stages || []
    const setStageValue = (i, p) => {
      const next = [...stageValues]
      next[i] = { ...(next[i] || {}), ...p }
      onChange({ ...v, stages: next })
    }
    return (
      <>
        {stages.map((stage, i) => {
          const sv = stageValues[i] || {}
          const stageTitle = `${t?.fmtStageLabel ? t.fmtStageLabel(i + 1) : `Etapa ${i + 1}`}${stage.durationSec ? ' · ' + secToTime(stage.durationSec) : ''}`
          const totalRounds = Math.max(1, Math.round((stage.durationSec || 0) / (stage.intervalSec || 60)) || 1)
          const rowsByKey = stage.kind === 'interval'
            ? (Object.keys(sv.sets || {}).length > 0 ? sv.sets : defaultRowsForFormat('EMOM', { totalRounds }, []))
            : null
          return (
            <div key={i} style={{ marginBottom: '18px', paddingBottom: '14px', borderBottom: i < stages.length - 1 ? '1px solid #f0f0f0' : 'none' }}>
              <div style={{ fontSize: '12px', fontWeight: '700', color: '#791F1F', marginBottom: '8px' }}>{stageTitle}</div>
              {stage.kind === 'interval'
                ? Object.entries(rowsByKey).map(([key, rows]) => (
                  <SetsRows key={key} rowKey={key} rows={rows}
                    onChange={nextRows => setStageValue(i, { sets: { ...rowsByKey, [key]: nextRows } })}
                    weightUnit={weightUnit} t={t} />
                ))
                : <RoundsPartialFields movements={stage.movements || []} roundsCompleted={sv.roundsCompleted} partialReps={sv.partialReps}
                    onChange={p => setStageValue(i, p)} t={t} />}
            </div>
          )
        })}
      </>
    )
  }

  // Partner WOD: scoreMode-ul din catalog e doar un fallback generic
  // ('fortime_or_amrap') - alegerea reala de baseFormat (AMRAP/For Time) a
  // antrenorului trebuie sa schimbe UI-ul de logare, altfel un Partner WOD
  // configurat ca AMRAP tot arata campurile de Timp si hint-ul "daca nu ai
  // terminat", care n-au sens pentru AMRAP (nu exista time cap/finish acolo).
  // effectiveScoreMode e aceeasi functie folosita de isNotRxd - un singur loc
  // care decide scoreMode-ul real, nu 2 implementari care pot desincroniza.
  const scoreMode = effectiveScoreMode(formatId, config) || format.scoreMode
  // Ascending AMRAP: "movements" primite sunt nume de baza (fara numere,
  // vezi catalogul) - reconstruim lista cu reps-ul corect prescris pt runda
  // CURENTA (roundsCompleted + 1, prima runda neterminata), recalculat live
  // la fiecare schimbare a "Runde complete". Fara asta, campurile de reps
  // partiale ar arata mereu tinta rundei 1 (bug real gasit in date, vezi
  // catalogul) - RoundsPartialFields/composePartialText raman neschimbate,
  // doar primesc miscari cu numarul deja corect.
  const efectiveMovements = format.ascending
    ? ascendingMovementsForRound(movements || [], (parseInt(v.roundsCompleted) || 0) + 1, config?.startReps, config?.incrementReps)
    : (movements || [])
  return <ScoredFields scoreMode={scoreMode} movements={efectiveMovements} value={v} onChange={patch} t={t} sequentialPartial={isSequentialFormat(formatId, config)} prescribedWeight={prescribedWeight} finishedRounds={config?.rounds} />
}

export function PrCandidatesConfirm({ candidates, onDismiss, onConfirm, onDone, t }) {
  if (!candidates || candidates.length === 0) return null
  return (
    <div style={{ marginTop: '14px', background: '#F5FBEA', border: '1px solid #ABE73C', borderRadius: '12px', padding: '14px' }}>
      <div style={{ fontSize: '13px', fontWeight: '700', color: '#0E0E0E', marginBottom: '10px' }}>{t?.skillPrConfirmTitle || 'PR nou?'}</div>
      {candidates.map(c => (
        <div key={`${c.movement}-${c.reps}`} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '8px 0', borderBottom: '1px solid #ddeec4' }}>
          <span style={{ fontSize: '13px', color: '#0E0E0E' }}>{c.movement} · {t?.prRepCountLabel ? t.prRepCountLabel(c.reps) : `${c.reps} reps`} — {c.weight}{c.unit}</span>
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
