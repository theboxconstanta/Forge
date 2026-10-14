// FORGE - Class Editing: the "Edit Class" bottom sheet opened by the pencil
// button on an Admin -> Classes card. Same BottomSheet (focus trap,
// Escape, aria-modal, NavBar-safe) and field conventions as the existing
// "New class" form in App.jsx. All writes go through editClassScope
// (classEdit.js -> edit_class_scope RPC, one transaction); this component
// never writes to `classes` directly.
import { useCallback, useEffect, useRef, useState } from 'react'
import { BottomSheet, Button, Input } from './components'
import { COLORS } from './theme'
import {
  CLASS_COLOR_PALETTE, availableEditScopes, buildClassChanges, classEditErrorMessage, classEditInitialValues,
  editClassScope, singleScopeReason, toHHMM, validateClassEdit,
} from './classEdit'

const labelStyle = { fontSize: '11px', color: '#888', marginBottom: '4px' }
const stepBtn = { width: '44px', height: '44px', borderRadius: '8px', border: '1px solid #e0e0e0', background: '#FFFFFF', fontSize: '16px', cursor: 'pointer' }
const plainBtn = { flex: 1, padding: '13px 16px', borderRadius: '12px', border: '1px solid #e0e0e0', background: '#FFFFFF', fontSize: '14px', fontWeight: '500', cursor: 'pointer', color: '#0E0E0E' }

function fieldValueText(field, value, t) {
  if (field === 'max_spots') return value == null ? t.adminClassEditUnlimited : String(value)
  if (field === 'color') return value || t.adminClassEditNoColor
  if (field === 'start_time' || field === 'end_time') return toHHMM(value)
  return value ?? ''
}

export default function ClassEditSheet({ cls, t, lang, supabase, bookedCount, onClose, onSaved, now }) {
  const [values, setValues] = useState(() => classEditInitialValues(cls))
  const [scope, setScope] = useState('this')
  const [step, setStep] = useState('form')
  const [preview, setPreview] = useState(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)

  // BottomSheet re-runs its focus-trap effect whenever onClose changes
  // identity (refocusing the first field) - keep one stable callback.
  const closeRef = useRef(onClose)
  useEffect(() => { closeRef.current = busy ? () => {} : onClose }, [busy, onClose])
  const stableClose = useCallback(() => closeRef.current(), [])

  const scopes = availableEditScopes(cls, now)
  const reason = singleScopeReason(cls, now)
  const set = (field) => (value) => { setValues(v => ({ ...v, [field]: value })); setError(null) }
  const changes = buildClassChanges(cls, values)
  const maxCap = Math.max(50, cls.max_spots || 0)
  const dateLabel = new Date(cls.date + 'T00:00:00').toLocaleDateString(lang === 'en' ? 'en-US' : 'ro-RO', { weekday: 'long', day: 'numeric', month: 'long' })
  const fmtDate = (d) => d ? new Date(d + 'T00:00:00').toLocaleDateString(lang === 'en' ? 'en-US' : 'ro-RO', { day: 'numeric', month: 'short', year: 'numeric' }) : ''

  const commit = async () => {
    setBusy(true); setError(null)
    try {
      const result = await editClassScope(supabase, { cls, scope, changes })
      onSaved(result, scope)
    } catch (err) {
      setError(classEditErrorMessage(err, t))
      setBusy(false)
    }
  }

  const handleSave = async () => {
    const invalid = validateClassEdit(values, { bookedCount })
    if (invalid) { setError(typeof t[invalid] === 'function' ? t[invalid](bookedCount) : t[invalid]); return }
    if (Object.keys(changes).length === 0) { setError(t.adminClassEditNoChanges); return }
    if (scope === 'this') { await commit(); return }
    // Multi-occurrence: the server computes the real affected set (dry run,
    // same validation, writes nothing) - never a client-side guess.
    setBusy(true); setError(null)
    try {
      const result = await editClassScope(supabase, { cls, scope, changes, dryRun: true })
      setPreview(result); setStep('confirm')
    } catch (err) {
      setError(classEditErrorMessage(err, t))
    }
    setBusy(false)
  }

  const scopeOptions = [
    { value: 'this', label: t.adminClassEditScopeThis, hint: t.adminClassEditScopeThisHint },
    { value: 'future', label: t.adminClassEditScopeFuture, hint: t.adminClassEditScopeFutureHint },
    { value: 'series', label: t.adminClassEditScopeSeries, hint: t.adminClassEditScopeSeriesHint },
  ].filter(o => scopes.includes(o.value))

  return (
    <BottomSheet onClose={stableClose} maxHeight="92%">
      <div id="class-edit-title" style={{ fontSize: '17px', fontWeight: '600', color: '#0E0E0E', marginBottom: '2px' }}>{t.adminClassEditTitle}</div>
      <div style={{ fontSize: '12px', color: '#888', marginBottom: '14px', textTransform: 'capitalize' }}>{dateLabel} · {toHHMM(cls.start_time)}–{toHHMM(cls.end_time)}</div>

      {step === 'form' && (
        <>
          <label style={{ display: 'block' }}>
            <div style={labelStyle}>{t.adminClassEditNameLabel}</div>
            <Input list="nume-clase-list" value={values.name} onChange={e => set('name')(e.target.value)} style={{ marginBottom: '10px' }} />
          </label>
          <div style={{ display: 'flex', gap: '10px', marginBottom: '10px' }}>
            <label style={{ flex: 1 }}>
              <div style={labelStyle}>{t.adminClassStartTimeLabel}</div>
              <Input type="time" value={values.start_time} onChange={e => set('start_time')(e.target.value)} />
            </label>
            <label style={{ flex: 1 }}>
              <div style={labelStyle}>{t.adminClassEndTimeLabel}</div>
              <Input type="time" value={values.end_time} onChange={e => set('end_time')(e.target.value)} />
            </label>
          </div>
          <label style={{ display: 'block' }}>
            <div style={labelStyle}>{t.adminClassCoachLabel}</div>
            <Input value={values.coach} onChange={e => set('coach')(e.target.value)} placeholder={t.adminClassCoachPlaceholder} style={{ marginBottom: '10px' }} />
          </label>
          <div style={labelStyle}>{t.adminClassSpotsLabel}</div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: typeof bookedCount === 'number' ? '4px' : '14px' }}>
            <button type="button" aria-label={t.adminClassEditCapacityDecrease} onClick={() => set('max_spots')(Math.max(1, (values.max_spots ?? 12) - 1))} style={stepBtn}>−</button>
            <span aria-live="polite" style={{ fontSize: '18px', fontWeight: '600', minWidth: '40px', textAlign: 'center' }}>{values.max_spots ?? '∞'}</span>
            <button type="button" aria-label={t.adminClassEditCapacityIncrease} onClick={() => set('max_spots')(Math.min(maxCap, (values.max_spots ?? 11) + 1))} style={stepBtn}>+</button>
          </div>
          {typeof bookedCount === 'number' && <div style={{ fontSize: '11px', color: '#888', marginBottom: '14px' }}>{t.adminClassEditBookedNow(bookedCount)}</div>}
          <div style={{ ...labelStyle, marginBottom: '6px' }}>{t.adminClassColorLabel}</div>
          <div role="radiogroup" aria-label={t.adminClassColorLabel} style={{ display: 'flex', gap: '8px', marginBottom: '16px', flexWrap: 'wrap' }}>
            {CLASS_COLOR_PALETTE.map(col => (
              <button type="button" key={col || 'none'} role="radio" aria-checked={values.color === col} aria-label={col || t.adminClassEditNoColor}
                onClick={() => set('color')(col)}
                style={{ width: '32px', height: '32px', borderRadius: '50%', cursor: 'pointer', flexShrink: 0, boxSizing: 'border-box', padding: 0,
                  background: col || '#e0e0e0',
                  border: values.color === col ? '3px solid #0E0E0E' : col ? '2px solid transparent' : '2px dashed #bbb',
                  boxShadow: values.color === col ? '0 0 0 2px #fff inset' : 'none' }} />
            ))}
          </div>

          <fieldset style={{ border: 'none', padding: 0, margin: '0 0 14px' }}>
            <legend style={{ fontSize: '12px', fontWeight: '600', color: '#0E0E0E', marginBottom: '8px', padding: 0 }}>{t.adminClassEditApplyTo}</legend>
            {scopeOptions.map(opt => (
              <label key={opt.value} style={{ display: 'flex', alignItems: 'flex-start', gap: '10px', padding: '12px', marginBottom: '6px', borderRadius: '10px', cursor: 'pointer',
                border: scope === opt.value ? '1.5px solid #0E0E0E' : '1px solid #e0e0e0', background: scope === opt.value ? '#f6f6f6' : '#fff' }}>
                <input type="radio" name="class-edit-scope" value={opt.value} checked={scope === opt.value} onChange={() => { setScope(opt.value); setError(null) }} style={{ marginTop: '2px', accentColor: '#0E0E0E' }} />
                <span>
                  <span style={{ display: 'block', fontSize: '13px', fontWeight: '600', color: '#0E0E0E' }}>{opt.label}</span>
                  <span style={{ display: 'block', fontSize: '11px', color: '#888', marginTop: '2px' }}>{opt.hint}</span>
                </span>
              </label>
            ))}
            {reason === 'oneOff' && <div style={{ fontSize: '11px', color: '#888' }}>{t.adminClassEditOneOffNote}</div>}
            {reason === 'ended' && <div style={{ fontSize: '11px', color: '#888' }}>{t.adminClassEditEndedNote}</div>}
          </fieldset>
        </>
      )}

      {step === 'confirm' && preview && (
        <div style={{ marginBottom: '14px' }}>
          <div style={{ fontSize: '14px', fontWeight: '600', color: '#0E0E0E', marginBottom: '8px' }}>{t.adminClassEditConfirmTitle}</div>
          <div style={{ background: '#fafafa', borderRadius: '10px', padding: '12px', fontSize: '12px', color: '#0E0E0E', lineHeight: 1.6 }}>
            <div><strong>{t.adminClassEditConfirmScope}</strong> {scope === 'future' ? t.adminClassEditScopeFuture : t.adminClassEditScopeSeries}</div>
            <div><strong>{t.adminClassEditConfirmCount}</strong> {t.adminClassEditConfirmCountValue(preview.affected)}</div>
            {preview.first_date && <div><strong>{t.adminClassEditConfirmRange}</strong> {fmtDate(preview.first_date)} – {fmtDate(preview.last_date)}</div>}
            <div style={{ marginTop: '6px' }}><strong>{t.adminClassEditConfirmChanges}</strong></div>
            <ul style={{ margin: '2px 0 0', paddingLeft: '18px' }}>
              {Object.keys(changes).map(f => (
                <li key={f}>{t.adminClassEditFieldLabel(f)}: {fieldValueText(f, classEditInitialValues(cls)[f], t)} → {fieldValueText(f, changes[f], t)}</li>
              ))}
            </ul>
          </div>
          <div style={{ fontSize: '12px', color: '#0E0E0E', marginTop: '10px', lineHeight: 1.5 }}>
            {preview.booked_total > 0 ? t.adminClassEditConfirmBookingsKept(preview.booked_total) : t.adminClassEditConfirmNoBookings}
            {preview.booked_total > 0 && ('start_time' in changes || 'end_time' in changes) && <div style={{ marginTop: '4px', color: COLORS.feedback.warning }}>{t.adminClassEditConfirmTimeWarning}</div>}
          </div>
          {preview.skipped_exceptions > 0 && <div style={{ fontSize: '11px', color: '#888', marginTop: '6px' }}>{t.adminClassEditConfirmSkipped(preview.skipped_exceptions)}</div>}
          {preview.preserved_past > 0 && <div style={{ fontSize: '11px', color: '#888', marginTop: '4px' }}>{t.adminClassEditConfirmPast(preview.preserved_past)}</div>}
        </div>
      )}

      {error && <div role="alert" style={{ fontSize: '12px', color: COLORS.feedback.danger, background: COLORS.feedback.dangerSoft, borderRadius: '8px', padding: '10px 12px', marginBottom: '12px', whiteSpace: 'pre-line' }}>{error}</div>}

      <div style={{ display: 'flex', gap: '10px' }}>
        {step === 'form'
          ? <button type="button" onClick={onClose} disabled={busy} style={plainBtn}>{t.adminClassEditCancel}</button>
          : <button type="button" onClick={() => { setStep('form'); setError(null) }} disabled={busy} style={plainBtn}>{t.adminClassEditBack}</button>}
        <Button onClick={step === 'form' ? handleSave : commit} disabled={busy} style={{ flex: 1 }}>
          {busy ? t.adminClassSaving : step === 'form' ? t.adminClassEditSave : t.adminClassEditConfirmApply(preview?.affected ?? 0)}
        </Button>
      </div>
    </BottomSheet>
  )
}
