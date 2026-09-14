// FORGE WORKOUT COMPOSER - PHASE 3 (PWA authoring UI).
//
// The coach-facing "+ Add Component" authoring experience for the primary/
// Metcon section, reading and writing the Phase 1 canonical `components[]`
// contract (componentContract.js) directly - no UI-only parallel schema.
//
// UI ORCHESTRATION ONLY - every domain decision (identity, order, validation,
// ownership rules, legacy compatibility) lives in componentContract.js and is
// called into here, never reimplemented. Movement editing itself is NOT
// reimplemented either: `MovementEditor`/`EmomEditor` are injected as props
// (App.jsx passes its own existing MovementRowListPWA/EmomMinutePatternEditor
// unchanged) rather than imported directly - this file has zero dependency
// on App.jsx, avoiding a circular import (App.jsx imports this file), while
// still reusing those components exactly as VariantEditorBody always has.

import { useState } from 'react'
import FormatConfigEditor from './FormatConfigEditor'
import {
  COMPOSER_FORMAT_GROUPS, addComponentToList, removeComponentFromList, moveComponent,
  setScoreOwner, candidateScorersFor, componentHeaderLabel, previewBlocksFromComponents,
  describeValidationError, canJoinScoreEnvelope,
} from './componentContract'

const cardStyle = { background: '#fff', border: '1px solid #e8e8e8', borderRadius: '12px', padding: '10px', marginBottom: '8px' }
const headerRowStyle = { display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '8px', marginBottom: '6px' }
const iconBtn = { padding: '4px 8px', borderRadius: '6px', border: '1px solid #e0e0e0', background: '#fff', fontSize: '11px', cursor: 'pointer', color: '#555' }
const dangerIconBtn = { ...iconBtn, borderColor: '#F7C1C1', background: '#FCEBEB', color: '#791F1F' }
const noticeStyle = { background: '#FEF6E7', border: '1px solid #F5DFA8', borderRadius: '8px', padding: '8px 10px', marginBottom: '8px', fontSize: '11px', color: '#8A6116' }

/** + Add Component bottom-sheet-style picker (ticket §6/§7/§8) - grouped,
 * touch-friendly, driven entirely by COMPOSER_FORMAT_GROUPS (the real,
 * curated authorable/loggable/persistable catalog subset), never a second
 * disconnected list. */
export function ComponentPicker({ onPick, onClose, t }) {
  return (
    <div role="dialog" aria-label={t?.composerPickerTitle || 'Add Component'}
      style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.35)', zIndex: 1000, display: 'flex', alignItems: 'flex-end' }}
      onClick={onClose}>
      <div onClick={e => e.stopPropagation()}
        style={{ background: '#fff', borderRadius: '16px 16px 0 0', padding: '16px', width: '100%', maxHeight: '80vh', overflowY: 'auto', boxSizing: 'border-box' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '12px' }}>
          <span style={{ fontSize: '14px', fontWeight: '700', color: '#0E0E0E' }}>{t?.composerPickerTitle || 'Add Component'}</span>
          <button onClick={onClose} aria-label="Close" style={{ ...iconBtn, fontSize: '14px' }}>✕</button>
        </div>
        {COMPOSER_FORMAT_GROUPS.map(group => (
          <div key={group.key} style={{ marginBottom: '14px' }}>
            <div style={{ fontSize: '10px', fontWeight: '700', color: '#aaa', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: '6px' }}>{group.label}</div>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px' }}>
              {group.options.map(opt => (
                <button key={`${opt.format}:${opt.role || ''}`} onClick={() => onPick(opt.format, opt.role)}
                  style={{ padding: '12px 16px', borderRadius: '12px', border: '1px solid #e0e0e0', background: '#fafafa', color: '#0E0E0E', fontSize: '13px', fontWeight: '600', cursor: 'pointer', minWidth: '96px', textAlign: 'center' }}>
                  {opt.label}
                </button>
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}

/** One Component's card - header (human label + reorder/remove) + its own
 * format config + (for movement-bearing formats) its own scoped movement
 * editor + Buy-In/Cash-Out's explicit, always-visible "Counts toward"
 * ownership control (ticket §10/§19/§21/§25/§26). */
export function ComponentCard({ component, index, total, allComponents, onPatch, onRemove, onMoveUp, onMoveDown, onSetOwner, movementCatalog, MovementEditor, EmomEditor, t }) {
  const isOwnable = component.producesScore === false && canJoinScoreEnvelope(component.format)
  const candidates = isOwnable ? candidateScorersFor(allComponents, component.id) : []
  const showMovements = component.format !== 'Rest'

  return (
    <div style={cardStyle}>
      <div style={headerRowStyle}>
        <span style={{ fontSize: '12px', fontWeight: '700', color: '#0E0E0E' }}>{componentHeaderLabel(component)}</span>
        <div style={{ display: 'flex', gap: '6px', flexShrink: 0 }}>
          <button style={iconBtn} disabled={index === 0} onClick={onMoveUp} aria-label={`Move ${componentHeaderLabel(component)} up`}>↑</button>
          <button style={iconBtn} disabled={index === total - 1} onClick={onMoveDown} aria-label={`Move ${componentHeaderLabel(component)} down`}>↓</button>
          <button style={dangerIconBtn} onClick={onRemove} aria-label={`Remove ${componentHeaderLabel(component)}`}>✕</button>
        </div>
      </div>

      <FormatConfigEditor formatId={component.format} config={component.config} onConfigChange={c => onPatch({ config: c })}
        onFormatChange={() => {}} hideFormatSelector movementInstances={component.instances} t={t} />

      {isOwnable && (
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px', margin: '6px 0' }}>
          <span style={{ fontSize: '11px', color: '#888' }}>{t?.composerCountsTowardLabel || 'Counts toward:'}</span>
          <select value={component.scoreOwnerId || ''} onChange={e => onSetOwner(e.target.value || null)}
            style={{ flex: 1, padding: '6px 8px', borderRadius: '8px', border: '1px solid #e0e0e0', fontSize: '12px', background: '#fff' }}>
            <option value="">{t?.composerCountsTowardNone || 'Nothing (unscored)'}</option>
            {candidates.map(s => <option key={s.id} value={s.id}>{componentHeaderLabel(s)}</option>)}
          </select>
        </div>
      )}

      {showMovements && (
        component.format === 'EMOM'
          ? <EmomEditor instances={component.instances || []} onChange={instances => onPatch({ instances })} catalog={movementCatalog} intervalSec={component.config?.intervalSec} />
          : <MovementEditor instances={component.instances || []} onChange={instances => onPatch({ instances })} catalog={movementCatalog} />
      )}
    </div>
  )
}

/** The Metcon's Composer editor (ticket §3/§4/§19/§40-42) - replaces the old
 * flat single-format editor for the primary section. `components`/`onChange`
 * carry the FULL next array on every edit (the caller persists it verbatim -
 * wodSections.js's Composer wiring, App.jsx PrimarySectionBody). */
export default function ComposerEditor({ components, onChange, movementCatalog, MovementEditor, EmomEditor, t }) {
  const [pickerOpen, setPickerOpen] = useState(false)
  const [notice, setNotice] = useState(null)
  const list = components || []

  const patchComponent = (id, patch) => onChange(list.map(c => (c.id === id ? { ...c, ...patch } : c)))

  const handlePick = (format, role) => {
    const next = addComponentToList(list, format, role)
    // Preferred UX (ticket §10) - a freshly-added Buy-In/Cash-Out auto-
    // attaches to the workout's ONE existing scorer, when unambiguous.
    // Never adjacency/position-based, never re-evaluated later (reorder
    // never silently rewrites scoreOwnerId - ticket §11) - decided ONCE,
    // right here, at add time; always correctable via the explicit "Counts
    // toward" selector on the card itself.
    const added = next[next.length - 1]
    if ((role === 'buy-in' || role === 'cash-out') && canJoinScoreEnvelope(added.format)) {
      const scorers = list.filter(c => c.producesScore)
      if (scorers.length === 1) {
        const attached = setScoreOwner(next, added.id, scorers[0].id)
        if (attached.ok) { onChange(attached.components); setPickerOpen(false); return }
      }
    }
    onChange(next)
    setPickerOpen(false)
  }

  const handleRemove = (id) => {
    const target = list.find(c => c.id === id)
    const ownsOthers = list.some(c => c.scoreOwnerId === id)
    if (ownsOthers) {
      const dependents = list.filter(c => c.scoreOwnerId === id).map(c => componentHeaderLabel(c)).join(', ')
      const msg = t?.composerConfirmRemoveOwner
        ? t.composerConfirmRemoveOwner(componentHeaderLabel(target), dependents)
        : `Removing "${componentHeaderLabel(target)}" will stop counting ${dependents} toward it. Continue?`
      if (!window.confirm(msg)) return
    }
    onChange(removeComponentFromList(list, id).components)
  }

  const handleMove = (id, direction) => {
    const result = moveComponent(list, id, direction)
    if (!result.ok) {
      setNotice(describeValidationError(result.error, t))
      setTimeout(() => setNotice(null), 4000)
      return
    }
    onChange(result.components)
  }

  const handleSetOwner = (id, scorerId) => {
    const result = setScoreOwner(list, id, scorerId)
    if (!result.ok) {
      setNotice(describeValidationError(result.error, t))
      setTimeout(() => setNotice(null), 4000)
      return
    }
    onChange(result.components)
  }

  return (
    <div>
      {notice && <div style={noticeStyle}>{notice}</div>}
      {list.length === 0 && (
        <div style={{ textAlign: 'center', padding: '18px 10px', color: '#aaa', fontSize: '12px', marginBottom: '8px' }}>
          {t?.composerEmptyState || 'No Components yet.'}
        </div>
      )}
      {list.slice().sort((a, b) => a.order - b.order).map((c, i) => (
        <ComponentCard key={c.id} component={c} index={i} total={list.length} allComponents={list}
          onPatch={patch => patchComponent(c.id, patch)}
          onRemove={() => handleRemove(c.id)}
          onMoveUp={() => handleMove(c.id, -1)}
          onMoveDown={() => handleMove(c.id, 1)}
          onSetOwner={scorerId => handleSetOwner(c.id, scorerId)}
          movementCatalog={movementCatalog} MovementEditor={MovementEditor} EmomEditor={EmomEditor} t={t} />
      ))}
      <button onClick={() => setPickerOpen(true)}
        style={{ width: '100%', padding: '10px', borderRadius: '10px', border: '1px dashed #ABE73C', background: '#F7FEE9', color: '#3F6212', fontSize: '13px', fontWeight: '600', cursor: 'pointer', marginTop: '4px' }}>
        {t?.composerAddComponentButton || '+ Add Component'}
      </button>
      {pickerOpen && <ComponentPicker onPick={handlePick} onClose={() => setPickerOpen(false)} t={t} />}
    </div>
  )
}

/** "How the athlete will read this" (ticket §28/§29) - reads canonical
 * components[] directly, in canonical order, one block per component
 * (bookend/scorer/Rest alike) with no envelope/scorer jargon. */
export function ComposerPreview({ components, t }) {
  const blocks = previewBlocksFromComponents(components)
  if (blocks.length === 0) return null
  return (
    <div style={{ background: '#F7F7F5', border: '1px solid #eee', borderRadius: '12px', padding: '14px', marginBottom: '14px' }}>
      <div style={{ fontSize: '10px', fontWeight: '600', color: '#aaa', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: '8px' }}>{t?.adminWodComposedPreviewLabel || 'Preview'}</div>
      {blocks.map(b => (
        <div key={b.id} style={{ marginBottom: '10px' }}>
          <div style={{ fontSize: '13px', fontWeight: '700', color: '#0E0E0E', marginBottom: '2px' }}>{b.header}</div>
          {b.movementLines.map((line, i) => <div key={i} style={{ fontSize: '13px', color: '#333', lineHeight: 1.5 }}>{line}</div>)}
        </div>
      ))}
    </div>
  )
}
