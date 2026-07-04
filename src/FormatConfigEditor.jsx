// Editor de configurare a formatului unui antrenament (admin) - select de
// format + campurile specifice acelui format (durata, runde, interval,
// liste de miscari...), plecand de la catalogul unic din workoutFormats.js.
// Componenta prezentationala, fara Supabase - parintele face JSON.stringify
// pe `config` la salvare (in wods.format_config / wods.skill_format_config /
// custom_hero_wods.format_config).
import { useState } from 'react'
import { FORMAT_IDS, getFormat } from './workoutFormats'

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

function TextField({ label, value, onChange, placeholder }) {
  return (
    <div style={fieldWrapStyle}>
      <div style={labelStyle}>{label}</div>
      <input value={value || ''} onChange={e => onChange(e.target.value)} placeholder={placeholder} style={inputStyle} />
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
// Complex) - text liber + adaugă/șterge, fără autocomplete fuzzy (acela e
// rezervat listei principale de mișcări ale WOD-ului, gestionată separat).
function MovementListField({ label, value, onChange }) {
  const [draft, setDraft] = useState('')
  const items = value || []
  const add = () => { if (draft.trim()) { onChange([...items, draft.trim()]); setDraft('') } }
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
      <div style={{ display: 'flex', gap: '8px' }}>
        <input value={draft} onChange={e => setDraft(e.target.value)} onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); add() } }}
          placeholder="ex: Thrusters" style={{ ...inputStyle, flex: 1 }} />
        <button type="button" onClick={add} style={{ padding: '10px 14px', borderRadius: '10px', background: '#ABE73C', color: '#0E0E0E', border: 'none', fontSize: '18px', cursor: 'pointer', lineHeight: 1 }}>+</button>
      </div>
    </div>
  )
}

// Un exercițiu per interval (ex. EMOM alternat: min 1 = Row, min 2 = Wall
// Ball...) - lista se reia ciclic peste numărul total de intervale definit
// separat (vezi defaultRowsForFormat în workoutFormats.js).
function IntervalListField({ label, value, onChange }) {
  return <MovementListField label={label} value={value} onChange={onChange} />
}

export default function FormatConfigEditor({ formatId, onFormatChange, config, onConfigChange, formatOptions, t }) {
  const options = formatOptions || FORMAT_IDS
  const format = getFormat(formatId)
  const cfg = config || {}
  const setField = (key, value) => onConfigChange({ ...cfg, [key]: value })

  return (
    <div>
      <div style={fieldWrapStyle}>
        <div style={labelStyle}>{t?.formatEditorTypeLabel || 'Format'}</div>
        <select value={formatId} onChange={e => onFormatChange(e.target.value)} style={inputStyle}>
          {options.map(id => <option key={id} value={id}>{id}</option>)}
        </select>
      </div>
      {Object.entries(format.config || {}).map(([key, field]) => {
        if (field.type === 'duration') return (
          <DurationField key={key} label={field.label} seconds={cfg[key] ?? field.default ?? null} onChange={v => setField(key, v)} />
        )
        if (field.type === 'number') return (
          <NumberField key={key} label={field.label} value={cfg[key] ?? field.default ?? null} onChange={v => setField(key, v)} />
        )
        if (field.type === 'select') return (
          <SelectField key={key} label={field.label} value={cfg[key]} options={field.options} onChange={v => setField(key, v)} />
        )
        if (field.type === 'text') return (
          <TextField key={key} label={field.label} value={cfg[key] ?? field.default} onChange={v => setField(key, v)} />
        )
        if (field.type === 'movementList') return (
          <MovementListField key={key} label={field.label} value={cfg[key]} onChange={v => setField(key, v)} />
        )
        if (field.type === 'intervalList') return (
          <IntervalListField key={key} label={field.label} value={cfg[key]} onChange={v => setField(key, v)} />
        )
        return null
      })}
    </div>
  )
}
