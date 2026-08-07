// Componente prezentaționale mici, fără dependințe de Supabase - testabile izolat.
import { useEffect, useRef } from 'react'
import { getInitiale, NIVEL_DOT_COLORS } from './utils'

export function AvatarCircle({ name, avatarUrl, size = 38 }) {
  const culori = ['#f0f0f0', '#f0f0f0', '#FAEEDA', '#E6F1FB', '#FCE8E8']
  const textCulori = ['#0E0E0E', '#0E0E0E', '#633806', '#0C447C', '#791F1F']
  const idx = name ? name.charCodeAt(0) % culori.length : 0
  if (avatarUrl) return (
    <img src={avatarUrl} alt={name || ''} style={{ width: size, height: size, borderRadius: '50%', objectFit: 'cover', flexShrink: 0 }} />
  )
  return (
    <div style={{ width: size, height: size, borderRadius: '50%', background: culori[idx], color: textCulori[idx], display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: size * 0.3, fontWeight: '600', flexShrink: 0 }}>
      {getInitiale(name)}
    </div>
  )
}

export function LevelDot({ nivel, size = 10 }) {
  return <span style={{ display: 'inline-block', width: size, height: size, borderRadius: '50%', background: NIVEL_DOT_COLORS[nivel] || '#ccc', flexShrink: 0, verticalAlign: 'middle' }} />
}

// Dropdown de sugestii (nume de miscari) pozitionat sub inputul parinte -
// randat identic in App.jsx (MiscareQuickAdd) si FormatConfigEditor.jsx
// (MovementTextField/MovementListField), fiecare reimplementandu-l separat
// pana acum. onMouseDown+preventDefault pastreaza focusul pe input cand dai
// click pe o sugestie, ca onClick sa apuce sa ruleze inainte ca alta
// schimbare de stare sa ascunda dropdown-ul. `rightOffset` lasa loc pentru un
// buton alaturat inputului (ex. "+"), cand exista.
export function MovementSuggestions({ suggestions, onSelect, rightOffset = 0 }) {
  if (!suggestions || suggestions.length === 0) return null
  return (
    <div style={{ position: 'absolute', top: '100%', left: 0, right: rightOffset, zIndex: 200, background: '#fff', borderRadius: '10px', marginTop: '4px', boxShadow: '0 4px 16px rgba(0,0,0,0.12)', overflow: 'hidden', border: '1px solid #e0e0e0' }}>
      {suggestions.map((s, i) => (
        <div key={i} onMouseDown={e => e.preventDefault()} onClick={() => onSelect(s)}
          style={{ padding: '10px 14px', cursor: 'pointer', fontSize: '13px', borderBottom: i < suggestions.length - 1 ? '1px solid #f0f0f0' : 'none' }}>{s}</div>
      ))}
    </div>
  )
}

// Membership Coverage Dialog (P0 UX refinement) - the first genuinely
// reusable, accessible modal in this codebase. Every existing overlay in
// App.jsx/TrialExpiredPaywall.jsx rolls its own inline `position: fixed`
// div (13+ occurrences) with no keyboard handling at all - none trap
// focus or close on Escape. Rather than adding a 14th one-off overlay,
// this Modal is the extraction point, visually matching the closest
// existing precedent for a "membership access blocked" dialog
// (TrialExpiredPaywall.jsx's own white rounded-20px card on a dark
// backdrop), with real focus-trap/Escape/aria-modal behavior ported from
// forge-admin-web's own Dialog.tsx (the same technique, since both apps
// need the identical accessibility guarantees and neither can import the
// other's code).
export function Modal({ title, onClose, children, maxWidth = '360px' }) {
  const modalRef = useRef(null)

  useEffect(() => {
    const previouslyFocused = document.activeElement
    const first = modalRef.current?.querySelector('button:not([disabled]), [href], input, textarea, select')
    first?.focus()

    const onKeyDown = (e) => {
      if (e.key === 'Escape') {
        onClose()
        return
      }
      if (e.key !== 'Tab' || !modalRef.current) return
      const focusable = modalRef.current.querySelectorAll('button:not([disabled]), [href], input, textarea, select')
      if (focusable.length === 0) return
      const list = [...focusable]
      const activeIndex = list.indexOf(document.activeElement)
      if (e.shiftKey && activeIndex === 0) {
        e.preventDefault()
        list[list.length - 1].focus()
      } else if (!e.shiftKey && activeIndex === list.length - 1) {
        e.preventDefault()
        list[0].focus()
      }
    }
    document.addEventListener('keydown', onKeyDown)
    return () => {
      document.removeEventListener('keydown', onKeyDown)
      previouslyFocused?.focus()
    }
  }, [onClose])

  return (
    <div onClick={onClose} style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.85)', zIndex: 700, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '20px' }}>
      <div ref={modalRef} role="dialog" aria-modal="true" aria-labelledby="modal-title" onClick={e => e.stopPropagation()}
        style={{ background: '#fff', borderRadius: '20px', padding: '32px 24px', textAlign: 'center', maxWidth, width: '100%' }}>
        <div id="modal-title" style={{ fontSize: '18px', fontWeight: '700', color: '#0E0E0E', marginBottom: '8px' }}>{title}</div>
        {children}
      </div>
    </div>
  )
}

/**
 * P0 UX refinement - shown in place of the generic "Booking failed" toast
 * specifically when the canonical trigger (enforce_subscription_sessions,
 * see 20260817000000_membership_coverage_error_code.sql) rejects a
 * booking because no membership covers the class's own date - never for
 * any other booking failure (network, duplicate, capacity, session
 * exhaustion), which keep their existing generic handling untouched.
 */
export function MembershipCoverageDialog({ t, onRenew, onClose }) {
  return (
    <Modal title={t.membershipCoverageDialogTitle} onClose={onClose}>
      <div style={{ fontSize: '13px', color: '#888', lineHeight: '1.6', marginBottom: '20px' }}>
        <p style={{ margin: '0 0 10px' }}>{t.membershipCoverageDialogBody1}</p>
        <p style={{ margin: 0 }}>{t.membershipCoverageDialogBody2}</p>
      </div>
      <button onClick={onRenew}
        style={{ width: '100%', padding: '13px', background: '#ABE73C', color: '#0E0E0E', border: 'none', borderRadius: '12px', fontSize: '14px', fontWeight: '600', cursor: 'pointer', marginBottom: '10px' }}>
        {t.membershipCoverageDialogRenew}
      </button>
      <button onClick={onClose}
        style={{ width: '100%', padding: '10px', background: 'transparent', color: '#555', border: '1px solid #e0e0e0', borderRadius: '12px', fontSize: '13px', fontWeight: '500', cursor: 'pointer' }}>
        {t.membershipCoverageDialogClose}
      </button>
    </Modal>
  )
}
