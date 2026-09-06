// Editor de configurare a formatului unui antrenament (admin) - select de
// format + campurile specifice acelui format (durata, runde, interval,
// liste de miscari...), plecand de la catalogul unic din workoutFormats.js.
// Componenta prezentationala, fara Supabase - parintele face JSON.stringify
// pe `config` la salvare (in wods.format_config / wods.skill_format_config /
// custom_hero_wods.format_config).
import { useState, useEffect } from 'react'
import { FORMAT_IDS, getFormat, resolveEmomScoringOptions } from './workoutFormats'
import { miscareSugestii, looksLikeMovementLine } from './movements'
import { MovementSuggestions } from './components'

const inputStyle = { width: '100%', padding: '10px 12px', borderRadius: '10px', border: '1px solid #e0e0e0', fontSize: '13px', background: '#fafafa', boxSizing: 'border-box' }
const labelStyle = { fontSize: '11px', color: '#888', marginBottom: '4px' }
const fieldWrapStyle = { marginBottom: '10px' }

function DurationField({ label, seconds, onChange }) {
  const min = seconds != null ? Math.floor(seconds / 60) : ''
  const sec = seconds != null ? seconds % 60 : ''
  const setFrom = (m, s) => {
    const mm = parseInt(m) || 0, ss = parseInt(s) || 0
    onChange(mm === 0 && ss === 0 ? null : mm * 60 + ss)
  }
  return (
    <div style={fieldWrapStyle}>
      <div style={labelStyle}>{label}</div>
      <div style={{ display: 'flex', gap: '10px' }}>
        <div style={{ flex: 1 }}>
          <input type="number" min="0" value={min} onChange={e => setFrom(e.target.value, sec)} placeholder="0" style={inputStyle} />
          <div style={{ fontSize: '10px', color: '#aaa', marginTop: '3px', textAlign: 'center' }}>min</div>
        </div>
        <div style={{ flex: 1 }}>
          <input type="number" min="0" max="59" value={sec} onChange={e => setFrom(min, e.target.value)} placeholder="0" style={inputStyle} />
          <div style={{ fontSize: '10px', color: '#aaa', marginTop: '3px', textAlign: 'center' }}>sec</div>
        </div>
      </div>
    </div>
  )
}

function NumberField({ label, value, onChange }) {
  return (
    <div style={fieldWrapStyle}>
      <div style={labelStyle}>{label}</div>
      <input type="number" min="0" value={value ?? ''} onChange={e => onChange(e.target.value === '' ? null : parseInt(e.target.value))} style={inputStyle} />
    </div>
  )
}

// Stepper +/- pentru "N RM" (Build to Heavy/1RM) - in loc sa scrii manual
// "3RM", alegi direct numarul (1-30) cu doua butoane, ca la o balanta.
function RepMaxStepperField({ label, value, onChange }) {
  const match = (value || '').match(/^(\d+)/)
  const n = match ? parseInt(match[1]) : 1
  const setN = (next) => onChange(`${Math.min(30, Math.max(1, next))}RM`)
  const btnStyle = (disabled) => ({ width: '40px', height: '40px', borderRadius: '10px', border: '1px solid #e0e0e0', background: '#fff', fontSize: '20px', fontWeight: '600', color: '#0E0E0E', cursor: disabled ? 'default' : 'pointer', opacity: disabled ? 0.35 : 1, lineHeight: 1 })
  return (
    <div style={fieldWrapStyle}>
      <div style={labelStyle}>{label}</div>
      <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
        <button type="button" onClick={() => setN(n - 1)} disabled={n <= 1} style={btnStyle(n <= 1)}>−</button>
        <div style={{ flex: 1, textAlign: 'center', fontSize: '16px', fontWeight: '600', color: '#0E0E0E', padding: '9px 12px', background: '#fafafa', borderRadius: '10px', border: '1px solid #e0e0e0' }}>{n}RM</div>
        <button type="button" onClick={() => setN(n + 1)} disabled={n >= 30} style={btnStyle(n >= 30)}>+</button>
      </div>
    </div>
  )
}

function TextField({ label, value, onChange, placeholder, quickOptions }) {
  return (
    <div style={fieldWrapStyle}>
      <div style={labelStyle}>{label}</div>
      {quickOptions && quickOptions.length > 0 && (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px', marginBottom: '8px' }}>
          {quickOptions.map(opt => (
            <div key={opt} onClick={() => onChange(opt)}
              style={{ padding: '5px 10px', borderRadius: '20px', border: value === opt ? '2px solid #0E0E0E' : '1px solid #e0e0e0', background: value === opt ? '#f0f0f0' : '#fafafa', color: value === opt ? '#0E0E0E' : '#555', fontSize: '11px', fontWeight: value === opt ? '600' : '400', cursor: 'pointer' }}>
              {opt}
            </div>
          ))}
        </div>
      )}
      <input value={value || ''} onChange={e => onChange(e.target.value)} placeholder={placeholder} style={inputStyle} />
    </div>
  )
}

// Un singur nume de miscare (ex. "Back Squat" la Max Effort) - text liber cu
// sugestii din MISCARI, spre deosebire de TextField (folosit si pentru
// campuri care NU sunt nume de miscari - repsScheme, targetLabel).
function MovementTextField({ label, value, onChange, placeholder }) {
  const [justSelected, setJustSelected] = useState(false)
  const val = value || ''
  const sugestii = justSelected ? [] : miscareSugestii(val)
  return (
    <div style={{ ...fieldWrapStyle, position: 'relative' }}>
      <div style={labelStyle}>{label}</div>
      <input value={val} onChange={e => { onChange(e.target.value); setJustSelected(false) }}
        placeholder={placeholder || 'ex: Back Squat'} style={inputStyle} />
      <MovementSuggestions suggestions={sugestii} onSelect={s => { onChange(s); setJustSelected(true) }} />
    </div>
  )
}

// Schema de reps per set (ex: [5,3,1]) - un rand per set, fiecare cu propria
// tinta de reps; numarul de seturi = lungimea listei (nu un camp separat).
// quickOptions (opt.) - scheme clasice ("21-15-9" etc, vezi
// REP_SCHEME_QUICK_OPTIONS in workoutFormats.js) afisate ca chip-uri care
// INLOCUIESC lista curenta cu secventa aleasa dintr-un click - migrat aici
// din TextField cand Ladder.repsScheme (text liber) a devenit
// sharedRepScheme (array structurat, WI Composer 2026-07-17), ca sa nu
// piarda coach-ii comoditatea de dinainte.
function RepsSchemeListField({ label, value, onChange, quickOptions }) {
  const [draft, setDraft] = useState('')
  const items = value || []
  const add = () => {
    const n = parseInt(draft)
    if (!isNaN(n) && n > 0) { onChange([...items, n]); setDraft('') }
  }
  const pickQuickOption = (opt) => {
    const parsed = opt.split('-').map(s => parseInt(s)).filter(n => !isNaN(n) && n > 0)
    if (parsed.length > 0) onChange(parsed)
  }
  return (
    <div style={fieldWrapStyle}>
      <div style={labelStyle}>{label}</div>
      {quickOptions && quickOptions.length > 0 && (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px', marginBottom: '8px' }}>
          {quickOptions.map(opt => {
            const isActive = items.join('-') === opt
            return (
              <div key={opt} onClick={() => pickQuickOption(opt)}
                style={{ padding: '5px 10px', borderRadius: '20px', border: isActive ? '2px solid #0E0E0E' : '1px solid #e0e0e0', background: isActive ? '#f0f0f0' : '#fafafa', color: isActive ? '#0E0E0E' : '#555', fontSize: '11px', fontWeight: isActive ? '600' : '400', cursor: 'pointer' }}>
                {opt}
              </div>
            )
          })}
        </div>
      )}
      {items.map((reps, i) => (
        <div key={i} style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '6px' }}>
          <div style={{ flex: 1, fontSize: '13px', padding: '8px 12px', background: '#fff', borderRadius: '8px', border: '1px solid #e0e0e0' }}>Set {i + 1}: {reps} reps</div>
          <button type="button" onClick={() => onChange(items.filter((_, idx) => idx !== i))}
            style={{ padding: '6px 10px', borderRadius: '8px', border: '1px solid #F7C1C1', background: '#FCEBEB', color: '#791F1F', fontSize: '12px', cursor: 'pointer' }}>×</button>
        </div>
      ))}
      <div style={{ display: 'flex', gap: '8px' }}>
        <input type="number" min="1" value={draft} onChange={e => setDraft(e.target.value)} onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); add() } }}
          placeholder="ex: 5" style={{ ...inputStyle, flex: 1 }} />
        <button type="button" onClick={add} style={{ padding: '10px 14px', borderRadius: '10px', background: '#ABE73C', color: '#0E0E0E', border: 'none', fontSize: '18px', cursor: 'pointer', lineHeight: 1 }}>+</button>
      </div>
    </div>
  )
}

// Lista de etape a unui "Chained AMRAP" (WOD "straight into") - fiecare etapa
// e un mini-card cu propriul tip (amrap/interval), durata, si (doar la
// 'interval') durata unui interval, plus lista ei proprie de miscari.
// Reutilizeaza DurationField/MovementListField existente pt sub-campuri, in
// loc sa reinventeze input-uri de durata/miscari - vezi workoutFormats.js
// pentru forma exacta a unei etape ({kind, durationSec, movements,
// intervalSec?}).
function StageListField({ label, value, onChange, t }) {
  const stages = value || []
  const setStage = (i, patch) => onChange(stages.map((s, idx) => idx === i ? { ...s, ...patch } : s))
  const addStage = () => onChange([...stages, { kind: 'amrap', durationSec: null, movements: [] }])
  const removeStage = (i) => onChange(stages.filter((_, idx) => idx !== i))
  return (
    <div style={fieldWrapStyle}>
      <div style={labelStyle}>{label}</div>
      {stages.map((stage, i) => (
        <div key={i} style={{ border: '1px solid #e0e0e0', borderRadius: '10px', padding: '10px', marginBottom: '10px', background: '#fff' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '8px' }}>
            <div style={{ fontSize: '12px', fontWeight: '600', color: '#0E0E0E' }}>{(t?.fmtStageLabel ? t.fmtStageLabel(i + 1) : `Etapa ${i + 1}`)}</div>
            <button type="button" onClick={() => removeStage(i)}
              style={{ padding: '4px 10px', borderRadius: '8px', border: '1px solid #F7C1C1', background: '#FCEBEB', color: '#791F1F', fontSize: '12px', cursor: 'pointer' }}>×</button>
          </div>
          <div style={fieldWrapStyle}>
            <div style={labelStyle}>{t?.fmtStageKind || 'Tip etapă'}</div>
            <select value={stage.kind || 'amrap'} onChange={e => setStage(i, { kind: e.target.value })} style={inputStyle}>
              <option value="amrap">{t?.fmtStageKindAmrap || 'AMRAP'}</option>
              <option value="interval">{t?.fmtStageKindInterval || 'Interval (EMOM)'}</option>
            </select>
          </div>
          <DurationField label={t?.fmtStageDuration || 'Durată etapă'} seconds={stage.durationSec ?? null} onChange={v => setStage(i, { durationSec: v })} />
          {stage.kind === 'interval' && (
            <DurationField label={t?.fmtIntervalDuration || 'Durată interval'} seconds={stage.intervalSec ?? null} onChange={v => setStage(i, { intervalSec: v })} />
          )}
          <MovementListField label={t?.fmtStageMovements || 'Mișcări'} value={stage.movements} onChange={v => setStage(i, { movements: v })} placeholder={t?.fmtMovementListPlaceholder} />
        </div>
      ))}
      <button type="button" onClick={addStage}
        style={{ padding: '8px 14px', borderRadius: '10px', background: '#f0f0f0', color: '#0E0E0E', border: 'none', fontSize: '13px', fontWeight: '600', cursor: 'pointer' }}>
        {t?.fmtStageAdd || '+ Adaugă etapă'}
      </button>
    </div>
  )
}

function SelectField({ label, value, options, onChange }) {
  // Fostul `value || options[0]` arata primul element din listă ca fallback
  // vizual, ignorand complet default-ul declarat in schema (ex. Intervals:
  // options=['Lowest Reps','Total Reps'], default='Total Reps' - dropdown-ul
  // arata gresit 'Lowest Reps'). Apelantul trece acum `field.default` direct
  // in `value`, deci fallback-ul de aici ramane doar pt cazul (deja imposibil
  // in practica) in care nici schema n-are default - options[0] ca ultima
  // plasa de siguranta, neschimbat.
  return (
    <div style={fieldWrapStyle}>
      <div style={labelStyle}>{label}</div>
      <select value={value || options[0]} onChange={e => onChange(e.target.value)} style={inputStyle}>
        {options.map(o => <option key={o} value={o}>{o}</option>)}
      </select>
    </div>
  )
}

// Listă simplă, ordonată, de nume de mișcări (Buy-In, Cash-Out, lanțul unui
// Complex, mișcare pe interval la EMOM) - cu sugestii din MISCARI, la fel ca
// MiscareQuickAdd din App.jsx.
function MovementListField({ label, value, onChange, placeholder }) {
  const [draft, setDraft] = useState('')
  const [justSelected, setJustSelected] = useState(false)
  const items = value || []
  // Blocheaza adaugarea cand textul nu pare o miscare (text de structura ca
  // "Then:"/"Amrap 19:" sau o nota libera) - vezi looksLikeMovementLine
  // (acelasi bug real gasit si fix aplicat ca la MiscareQuickAdd, App.jsx).
  // Draft-ul NU se goleste la refuz - userul isi vede textul, poate corecta.
  const add = (text) => {
    const val = (text ?? draft).trim()
    if (!val || !looksLikeMovementLine(val)) return
    onChange([...items, val]); setDraft(''); setJustSelected(false)
  }
  // La fel ca la MiscareQuickAdd - dupa ce alegi o sugestie, n-o mai arata
  // din nou pana nu mai scrii ceva (altfel ramane vizibila peste lista).
  const sugestii = justSelected ? [] : miscareSugestii(draft)
  return (
    <div style={fieldWrapStyle}>
      <div style={labelStyle}>{label}</div>
      {items.map((m, i) => (
        <div key={i} style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '6px' }}>
          <div style={{ flex: 1, fontSize: '13px', padding: '8px 12px', background: '#fff', borderRadius: '8px', border: '1px solid #e0e0e0' }}>{i + 1}. {m}</div>
          <button type="button" onClick={() => onChange(items.filter((_, idx) => idx !== i))}
            style={{ padding: '6px 10px', borderRadius: '8px', border: '1px solid #F7C1C1', background: '#FCEBEB', color: '#791F1F', fontSize: '12px', cursor: 'pointer' }}>×</button>
        </div>
      ))}
      <div style={{ position: 'relative' }}>
        <div style={{ display: 'flex', gap: '8px' }}>
          <input value={draft} onChange={e => { setDraft(e.target.value); setJustSelected(false) }}
            onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); add() } }}
            placeholder={placeholder || 'ex: Thrusters'} style={{ ...inputStyle, flex: 1 }} />
          <button type="button" onClick={() => add()} style={{ padding: '10px 14px', borderRadius: '10px', background: '#ABE73C', color: '#0E0E0E', border: 'none', fontSize: '18px', cursor: 'pointer', lineHeight: 1 }}>+</button>
        </div>
        <MovementSuggestions suggestions={sugestii} onSelect={add} rightOffset="46px" />
      </div>
    </div>
  )
}

// Un exercițiu per interval (ex. EMOM alternat: min 1 = Row, min 2 = Wall
// Ball...) - lista se reia ciclic peste numărul total de intervale definit
// separat (vezi defaultRowsForFormat în workoutFormats.js).
function IntervalListField({ label, value, onChange, placeholder }) {
  return <MovementListField label={label} value={value} onChange={onChange} placeholder={placeholder} />
}

// EMOM AUTHORING + CANONICAL SCORING INTEGRITY - EMOM's own "Scoring"
// control. Unlike Tabata/Intervals (always homogeneous simpleReps, the
// generic SelectField above is safe as-is and stays untouched for them),
// EMOM's movements can measure genuinely different canonical quantities
// (reps/calories/distance) - offering every scoringMode unconditionally
// would let a coach pick "Total Reps" for "12 Cal Row + 10 Burpees" and
// silently get 22. `movementInstances` is the RX variant's canonical
// structured instances (same shape prescription_snapshot freezes) -
// resolveEmomScoringOptions classifies them via the SAME canonical
// resolver the shipped result-integrity gate uses, never movement-name
// parsing.
//
// Smart default (owner §4): a coach should not have to discover a hidden
// technical field - the moment the movements resolve to a single safe
// option (a homogeneous reps-only or calories-only EMOM with no scoring
// chosen yet), it is pre-selected AND ACTUALLY PERSISTED (setField fires
// once), not just shown cosmetically like the generic SelectField's
// options[0] fallback (the exact historical bug class this incident's
// root cause traced back to). The choice stays a real, visible, editable
// selection - never hidden.
//
// Movement-change invalidation (owner §8): if the coach later edits the
// movements so the previously-chosen mode is no longer offered (e.g. a
// reps station becomes a calorie station under a Total Reps selection),
// the stale selection is cleared to null (renders as "Choose scoring...",
// i.e. effectively No Score) rather than silently kept - the coach must
// explicitly re-choose, never save an internally inconsistent workout.
function EmomScoringField({ label, value, onChange, movementInstances, t }) {
  const options = resolveEmomScoringOptions(movementInstances)
  const optionsKey = options.join('|')

  useEffect(() => {
    if (value != null && !options.includes(value)) { onChange(null); return }
    // resolveEmomScoringOptions always orders a safe aggregate mode (Total
    // Reps / Total Calories) FIRST when one exists - suggesting it covers
    // both the single- and multi-movement reps case, and calories.
    if (value == null && (options[0] === 'Total Reps' || options[0] === 'Total Calories')) onChange(options[0])
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [optionsKey])

  return (
    <div style={fieldWrapStyle}>
      <div style={labelStyle}>{label}</div>
      <select value={value || ''} onChange={e => onChange(e.target.value || null)} style={inputStyle}>
        <option value="" disabled>{t?.fmtScoringChoosePlaceholder || 'Choose scoring...'}</option>
        {options.map(o => <option key={o} value={o}>{t?.[`fmtScoringOption${o.replace(/\s+/g, '')}`] || o}</option>)}
      </select>
    </div>
  )
}

export default function FormatConfigEditor({ formatId, onFormatChange, config, onConfigChange, formatOptions, excludeConfigKeys, movementInstances, t }) {
  const options = formatOptions || FORMAT_IDS
  const format = getFormat(formatId)
  const cfg = config || {}
  const setField = (key, value) => onConfigChange({ ...cfg, [key]: value })
  const excluded = excludeConfigKeys || []

  return (
    <div>
      <div style={fieldWrapStyle}>
        <div style={labelStyle}>{t?.formatEditorTypeLabel || 'Format'}</div>
        <select value={formatId} onChange={e => onFormatChange(e.target.value)} style={inputStyle}>
          {options.map(id => <option key={id} value={id}>{id}</option>)}
        </select>
      </div>
      {Object.entries(format.config || {}).filter(([key]) => !excluded.includes(key)).map(([key, field]) => {
        const label = t?.[field.labelKey] || field.labelKey
        if (field.type === 'duration') return (
          <DurationField key={key} label={label} seconds={cfg[key] ?? field.default ?? null} onChange={v => setField(key, v)} />
        )
        if (field.type === 'number') return (
          // INC-07 - a legacy Intervals row stores `rounds` (flat count), not
          // `roundCount`. Show that value in the Rounds field so editing a
          // legacy workout is not broken; it only becomes the stored
          // `roundCount` (upgrading the row to structured) once the coach
          // actually edits the field.
          <NumberField key={key} label={label}
            value={cfg[key] ?? (key === 'roundCount' ? cfg.rounds : undefined) ?? field.default ?? null}
            onChange={v => setField(key, v)} />
        )
        // EMOM AUTHORING + CANONICAL SCORING INTEGRITY - EMOM's own
        // scoringMode field needs unit-aware option filtering; every other
        // format's `type:'select'` field (Tabata/Intervals'/Complex's own
        // scoringMode included) keeps the generic SelectField unchanged.
        if (field.type === 'select' && key === 'scoringMode' && formatId === 'EMOM') return (
          <EmomScoringField key={key} label={label} value={cfg[key] ?? null} movementInstances={movementInstances} onChange={v => setField(key, v)} t={t} />
        )
        if (field.type === 'select') return (
          <SelectField key={key} label={label} value={cfg[key] ?? field.default ?? null} options={field.options} onChange={v => setField(key, v)} />
        )
        if (field.type === 'text') return (
          <TextField key={key} label={label} value={cfg[key] ?? field.default} onChange={v => setField(key, v)} quickOptions={field.quickOptions} />
        )
        if (field.type === 'repMaxStepper') return (
          <RepMaxStepperField key={key} label={label} value={cfg[key] ?? field.default} onChange={v => setField(key, v)} />
        )
        if (field.type === 'movementText') return (
          <MovementTextField key={key} label={label} value={cfg[key] ?? field.default} onChange={v => setField(key, v)} />
        )
        if (field.type === 'movementList') return (
          <MovementListField key={key} label={label} value={cfg[key]} onChange={v => setField(key, v)} placeholder={t?.fmtMovementListPlaceholder} />
        )
        if (field.type === 'intervalList') return (
          <IntervalListField key={key} label={label} value={cfg[key]} onChange={v => setField(key, v)} placeholder={t?.fmtMovementListPlaceholder} />
        )
        if (field.type === 'repsSchemeList') return (
          <RepsSchemeListField key={key} label={label} value={cfg[key]} onChange={v => setField(key, v)} quickOptions={field.quickOptions} />
        )
        if (field.type === 'stageList') return (
          <StageListField key={key} label={label} value={cfg[key]} onChange={v => setField(key, v)} t={t} />
        )
        return null
      })}
    </div>
  )
}
