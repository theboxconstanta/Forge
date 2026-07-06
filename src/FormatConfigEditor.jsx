// Editor de configurare a formatului unui antrenament (admin) - select de
// format + campurile specifice acelui format (durata, runde, interval,
// liste de miscari...), plecand de la catalogul unic din workoutFormats.js.
// Componenta prezentationala, fara Supabase - parintele face JSON.stringify
// pe `config` la salvare (in wods.format_config / wods.skill_format_config /
// custom_hero_wods.format_config).
import { useState } from 'react'
import { FORMAT_IDS, getFormat } from './workoutFormats'
import { miscareSugestii } from './movements'
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

function TextField({ label, value, onChange, placeholder, quickOptions }) {
  return (
    <div style={fieldWrapStyle}>
      <div style={labelStyle}>{label}</div>
      {quickOptions && quickOptions.length > 0 && (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px', marginBottom: '8px' }}>
          {quickOptions.map(opt => (
            <div key={opt} onClick={() => onChange(opt)}
              style={{ padding: '5px 10px', borderRadius: '20px', border: value === opt ? '2px solid #0E0E0E' : '1px solid #e0e0e0', background: value === opt ? '#f0f0f0' : '#fafafa', color: value === opt ? '#0E0E0E' : '#555', fontSize: '11px', fontWeight: value === opt ? '700' : '400', cursor: 'pointer' }}>
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
function RepsSchemeListField({ label, value, onChange }) {
  const [draft, setDraft] = useState('')
  const items = value || []
  const add = () => {
    const n = parseInt(draft)
    if (!isNaN(n) && n > 0) { onChange([...items, n]); setDraft('') }
  }
  return (
    <div style={fieldWrapStyle}>
      <div style={labelStyle}>{label}</div>
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

function SelectField({ label, value, options, onChange }) {
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
  const add = (text) => {
    const val = (text ?? draft).trim()
    if (!val) return
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

export default function FormatConfigEditor({ formatId, onFormatChange, config, onConfigChange, formatOptions, excludeConfigKeys, t }) {
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
          <NumberField key={key} label={label} value={cfg[key] ?? field.default ?? null} onChange={v => setField(key, v)} />
        )
        if (field.type === 'select') return (
          <SelectField key={key} label={label} value={cfg[key]} options={field.options} onChange={v => setField(key, v)} />
        )
        if (field.type === 'text') return (
          <TextField key={key} label={label} value={cfg[key] ?? field.default} onChange={v => setField(key, v)} quickOptions={field.quickOptions} />
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
          <RepsSchemeListField key={key} label={label} value={cfg[key]} onChange={v => setField(key, v)} />
        )
        return null
      })}
    </div>
  )
}
