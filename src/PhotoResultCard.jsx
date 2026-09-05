// PHOTO RESULT / SHARE CARD — Phase 2: the shared photo-backed result
// presentation, reused by the post-save share popup (WorkoutSharePopup, full
// modal chrome around it) and the Journal's expanded log card (inline, no
// modal chrome) - Phase 2 forensic found these are two separate surfaces
// (App.jsx §"post-save modal" vs JurnalList's own inline expand), so only
// the actual photo+overlay visual is shared here, never the chrome around
// it.
//
// Pure presentation only: every piece of result truth (movements, score,
// variant, Modified/Not RX'd label) is computed by the CALLER from the same
// canonical sources the plain Journal/leaderboard cards already use
// (resolveResultMovementLines, resultCompositionModified, etc.) - this
// component never re-derives any of it, never reads wod_logs/wods, never
// imports scoring/prescription code.
//
// `photoUrl` null means "still loading" (renders a skeleton in the photo's
// place while a signed-URL request is in flight) - the caller decides
// whether to mount this component at all (only once a photo is known to
// exist); an <img> load failure calls `onPhotoError` so the caller can fall
// back to its own plain, no-photo layout (owner's safe-fallback contract -
// this component itself never gives up on the photo, it only reports the
// failure upward).
//
// Designed so a later Phase 3 could export this exact DOM node as a share
// image (owner §26) - but Phase 2 installs no export dependency and adds no
// export/share-image button here.

import { localeFor } from './utils'

export default function PhotoResultCard({
  photoUrl, onPhotoError,
  gymName, gymColor,
  wodName, variantLevel, variantColor, variantBg, notRxdLabel,
  movements, resultText, loggedAt, lang, t,
  onClose,
}) {
  const dateObj = loggedAt ? new Date(loggedAt) : null
  return (
    <div style={{ position: 'relative', width: '100%', aspectRatio: '1 / 1', maxHeight: '70vh', borderRadius: '16px', overflow: 'hidden', background: '#0E0E0E' }}>
      {photoUrl ? (
        <img src={photoUrl} alt="" onError={onPhotoError}
          style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', objectFit: 'cover' }} />
      ) : (
        <div aria-hidden="true" style={{ position: 'absolute', inset: 0, background: '#1c1c1c' }} />
      )}
      {onClose && (
        <button onClick={onClose} aria-label={t.shareCardCloseLabel}
          style={{ position: 'absolute', top: '10px', right: '10px', zIndex: 2, background: 'rgba(0,0,0,0.5)', border: 'none', borderRadius: '50%', width: '28px', height: '28px', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#fff', cursor: 'pointer', fontSize: '14px', lineHeight: 1 }}>
          ✕
        </button>
      )}
      <div style={{ position: 'absolute', top: 0, left: 0, right: 0, padding: '14px 44px 24px 16px', background: 'linear-gradient(180deg, rgba(0,0,0,0.65) 0%, rgba(0,0,0,0) 100%)', display: 'flex', alignItems: 'center', gap: '6px', flexWrap: 'wrap' }}>
        <span style={{ color: '#fff', fontWeight: '600', fontSize: '13px', letterSpacing: '1px' }}>FORGE</span>
        {gymName && (
          <span style={{ fontSize: '12px', fontWeight: '600', lineHeight: 1.3 }}>
            <span style={{ color: 'rgba(255,255,255,0.55)' }}> · </span><span style={{ color: gymColor || '#ABE73C' }}>{gymName}</span>
          </span>
        )}
      </div>
      <div style={{ position: 'absolute', bottom: 0, left: 0, right: 0, padding: '28px 16px 16px', background: 'linear-gradient(0deg, rgba(0,0,0,0.85) 0%, rgba(0,0,0,0.55) 55%, rgba(0,0,0,0) 100%)' }}>
        {wodName && <div style={{ fontSize: '14px', fontWeight: '600', lineHeight: 1.3, color: '#fff', marginBottom: '8px', overflowWrap: 'anywhere' }}>"{wodName}"</div>}
        {(variantLevel || notRxdLabel) && (
          <div style={{ display: 'flex', alignItems: 'center', gap: '6px', marginBottom: '10px', flexWrap: 'wrap' }}>
            {variantLevel && (
              <span style={{ padding: '3px 12px', borderRadius: '20px', background: variantBg || 'rgba(255,255,255,0.16)', color: variantColor || '#fff', fontSize: '11px', fontWeight: '600', lineHeight: 1.2 }}>
                {variantLevel}
              </span>
            )}
            {notRxdLabel && (
              <span style={{ padding: '3px 10px', borderRadius: '20px', background: 'rgba(255,255,255,0.16)', color: '#fff', fontSize: '10px', fontWeight: '600', lineHeight: 1.2 }}>
                {notRxdLabel}
              </span>
            )}
          </div>
        )}
        {movements && movements.length > 0 && (
          <div style={{ fontSize: '11px', lineHeight: 1.5, color: 'rgba(255,255,255,0.78)', marginBottom: '8px', overflowWrap: 'anywhere' }}>
            {movements.map((m, i) => <div key={i}>{m}</div>)}
          </div>
        )}
        {resultText && (
          <div style={{ fontSize: '22px', fontWeight: '700', color: '#fff', lineHeight: 1.25, marginBottom: '4px', overflowWrap: 'anywhere' }}>
            {resultText}
          </div>
        )}
        {dateObj && (
          <div style={{ fontSize: '11px', fontWeight: '500', color: 'rgba(255,255,255,0.6)' }}>
            {dateObj.toLocaleDateString(localeFor(lang), { day: '2-digit', month: '2-digit', year: 'numeric' })} · {dateObj.toLocaleTimeString(localeFor(lang), { hour: '2-digit', minute: '2-digit' })}
          </div>
        )}
      </div>
    </div>
  )
}
