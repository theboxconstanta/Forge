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

// Home Dashboard Visual Redesign (HOME_DASHBOARD_UI_REDESIGN_REPORT.md) - a
// bottom-anchored sibling of Modal, for the class-detail sheet. Same
// focus-trap/Escape/aria-modal behavior as Modal (duplicated rather than
// composed, since the two differ in backdrop opacity, positioning, and
// have no other shared JSX), reused verbatim rather than reinvented - this
// is a presentation-only addition, no new data flow.
export function BottomSheet({ onClose, children, maxHeight = '85%' }) {
  const sheetRef = useRef(null)

  useEffect(() => {
    const previouslyFocused = document.activeElement
    const first = sheetRef.current?.querySelector('button:not([disabled]), [href], input, textarea, select')
    first?.focus()

    const onKeyDown = (e) => {
      if (e.key === 'Escape') {
        onClose()
        return
      }
      if (e.key !== 'Tab' || !sheetRef.current) return
      const focusable = sheetRef.current.querySelectorAll('button:not([disabled]), [href], input, textarea, select')
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

  // Bottom Sheet safe-area / tab bar overlap fix
  // (HOME_DASHBOARD_UI_REDESIGN_REPORT.md, P0 follow-up) - the backdrop used
  // to be inset:0 (full viewport height), so both the dark backdrop and the
  // sheet's own white panel physically extended behind NavBar (a normal-flow
  // flex child of .app-frame, deliberately NOT position:fixed - see NavBar's
  // own comment in App.jsx). A position:fixed overlay always escapes that
  // flow and anchors to the real viewport, so inset:0 had no way to know
  // NavBar was there at all - the last participant row (and the tab bar
  // itself) ended up underneath the sheet, unclickable.
  //
  // Fix: stop the backdrop's own box exactly at NavBar's top edge, using the
  // real measured height NavBar publishes via ResizeObserver
  // (--navbar-height, App.jsx) rather than a hardcoded pixel guess - this is
  // what makes the fix correct on both iOS (home-indicator safe-area-inset-
  // bottom) and Android (gesture-nav/3-button inset) without any
  // platform-specific branching, since it reads NavBar's actual rendered
  // box, which already accounts for whichever inset applies. maxHeight is
  // now a % of this shorter box (not vh), so "85% of the space above the
  // tab bar" instead of "85% of the full screen, plus NavBar covering
  // whatever peeked out the bottom."
  return (
    <div onClick={onClose} style={{ position: 'fixed', top: 0, left: 0, right: 0, bottom: 'var(--navbar-height, 64px)', background: 'rgba(0,0,0,0.5)', zIndex: 700, display: 'flex', alignItems: 'flex-end' }}>
      <div ref={sheetRef} role="dialog" aria-modal="true" onClick={e => e.stopPropagation()}
        style={{ background: '#fff', borderRadius: '24px 24px 0 0', width: '100%', maxHeight, overflowY: 'auto', WebkitOverflowScrolling: 'touch', padding: '10px 20px 28px', boxSizing: 'border-box' }}>
        <div style={{ width: '36px', height: '4px', background: '#E5E5E5', borderRadius: '2px', margin: '0 auto 18px' }} />
        {children}
      </div>
    </div>
  )
}

/**
 * P0 UX copy refinement (MEMBERSHIP_COVERAGE_DIALOG_COPY_REFINEMENT_REPORT.md)
 * - shown in place of the generic "Booking failed" toast specifically when
 * the canonical trigger (enforce_subscription_sessions, see
 * 20260817000000_membership_coverage_error_code.sql) rejects a booking
 * because no membership covers the class's own date - never for any other
 * booking failure (network, duplicate, capacity, session exhaustion),
 * which keep their existing generic handling untouched.
 *
 * Purely informational, no renewal CTA: on the PWA, this dialog is only
 * ever reachable with a currently-active membership (the pre-existing
 * "no active subscription" paywall, elsewhere in App.jsx, blocks the
 * entire booking surface before this trigger is ever reached otherwise) -
 * so every rejection this dialog represents is "active today, doesn't
 * reach this class's date," never "already expired." A renewal button
 * would be misleading here; the member isn't missing a membership, the
 * membership just doesn't extend far enough yet.
 */
export function MembershipCoverageDialog({ t, onClose }) {
  return (
    <Modal title={t.membershipCoverageDialogTitle} onClose={onClose}>
      <div style={{ fontSize: '13px', color: '#888', lineHeight: '1.6', marginBottom: '20px' }}>
        <p style={{ margin: '0 0 10px' }}>{t.membershipCoverageDialogBody1}</p>
        <p style={{ margin: 0 }}>{t.membershipCoverageDialogBody2}</p>
      </div>
      <button onClick={onClose}
        style={{ width: '100%', padding: '13px', background: '#ABE73C', color: '#0E0E0E', border: 'none', borderRadius: '12px', fontSize: '14px', fontWeight: '600', cursor: 'pointer' }}>
        {t.membershipCoverageDialogButton}
      </button>
    </Modal>
  )
}
