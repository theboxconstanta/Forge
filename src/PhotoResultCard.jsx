// PHOTO RESULT / SHARE CARD — Phase 2 / Phase 2.2 (owner final visual
// contract): the shared photo-backed result presentation, reused by the
// post-save share popup (WorkoutSharePopup) and the Journal's expanded log
// card - Phase 2 forensic found these are two separate surfaces, so only
// this actual card visual is shared, never the chrome around it.
//
// Pure presentation only: every piece of result truth (movements, score,
// variant, Modified/Not RX'd label, workout structure) is computed by the
// CALLER from the same canonical sources the plain Journal/leaderboard
// cards and the logging screen's own WorkoutFormatHeader already use
// (resolveResultMovementLines, resultCompositionModified,
// resolveWorkoutStructureHeader, etc.) - this component never re-derives
// any of it, never reads wod_logs/wods, never imports scoring/prescription/
// workout-format code, never parses a result or movement string itself.
// `resultText`/movement lines are presented in UPPERCASE via CSS
// `textTransform` only - the actual strings passed in, and whatever they
// came from, are never mutated (owner §13).
//
// `photoUrl` null means "still loading" (renders a skeleton in the photo's
// place while a signed-URL request is in flight) - the caller decides
// whether to mount this component at all (only once a photo is known to
// exist); an <img> load failure calls `onPhotoError` so the caller can fall
// back to its own plain, no-photo layout (owner's safe-fallback contract -
// this component itself never gives up on the photo, it only reports the
// failure upward).
//
// `congratsText` / `onShare` are OPTIONAL - only the post-save popup has a
// "just saved" congratulations message and an existing Share action to
// relocate into the card; the Journal reuses the exact same component
// without either (owner §16 "preserve whatever current behavior exists" -
// Journal never had a share button before this phase, so none is invented
// for it here).
//
// Designed so a later Phase 3 could export this exact DOM node as a share
// image (owner §26) - but this phase installs no export dependency and
// adds no export/share-image button here.

import { localeFor, getReadableTextColor } from './utils'

export default function PhotoResultCard({
  photoUrl, onPhotoError,
  gymName, gymColor,
  variantLevel, notRxdLabel,
  structureHeader, // { primary, secondary, prescriptionLines } | null - see resolveWorkoutStructureHeader (workoutFormats.js)
  movements, resultText, loggedAt, lang, t,
  congratsText, onShare, shareLabel,
  onClose,
}) {
  const dateObj = loggedAt ? new Date(loggedAt) : null
  const accent = gymColor || '#ABE73C'
  const shareTextColor = getReadableTextColor(accent)
  return (
    <div style={{ display: 'flex', flexDirection: 'column', width: '100%', borderRadius: '16px', overflow: 'hidden', background: '#0E0E0E' }}>
      {/* HEADER - solid black bar, never part of the photo (owner §2/§4: only
          the outer card has rounded corners, the header/photo seam is flush). */}
      <div style={{ flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '10px', padding: '10px 12px', background: '#0E0E0E' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '6px', flexShrink: 0 }}>
          <img src="/forge.png" alt="" style={{ height: '20px', width: '20px', borderRadius: '5px', objectFit: 'cover' }} />
          <span style={{ color: '#fff', fontWeight: '600', fontSize: '12px', letterSpacing: '1px' }}>FORGE</span>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: '10px', minWidth: 0, flex: '1 1 auto', justifyContent: 'flex-end' }}>
          {gymName && (
            <span style={{ fontSize: '12px', fontWeight: '600', color: accent, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', minWidth: 0 }}>
              {gymName}
            </span>
          )}
          {onClose && (
            <button onClick={onClose} aria-label={t.shareCardCloseLabel}
              style={{ flexShrink: 0, background: 'none', border: 'none', color: '#fff', width: '22px', height: '22px', display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer', fontSize: '15px', lineHeight: 1, padding: 0 }}>
              ✕
            </button>
          )}
        </div>
      </div>

      {/* PHOTO BODY - fills everything below the header, no white gap, no
          separate white result section (owner §1/§4). Portrait-leaning
          aspect ratio for a social-card feel, capped so it never forces
          overflow on a short/small viewport (owner §18/§19). */}
      <div style={{ position: 'relative', width: '100%', aspectRatio: '4 / 5', maxHeight: '75vh', overflow: 'hidden', background: '#1c1c1c' }}>
        {photoUrl ? (
          <img src={photoUrl} alt="" onError={onPhotoError}
            style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', objectFit: 'cover' }} />
        ) : (
          <div aria-hidden="true" style={{ position: 'absolute', inset: 0, background: '#1c1c1c' }} />
        )}
        {/* Dark scrim - presentation-only, never modifies the stored JPEG
            (owner §5): a subtle overall tint plus a stronger gradient toward
            the bottom, so white/tenant-color text stays legible over any
            photo without making the athlete/photo unrecognizable. */}
        <div aria-hidden="true" style={{ position: 'absolute', inset: 0, background: 'linear-gradient(180deg, rgba(0,0,0,0.35) 0%, rgba(0,0,0,0.25) 30%, rgba(0,0,0,0.5) 60%, rgba(0,0,0,0.82) 100%)' }} />
        <div style={{ position: 'absolute', inset: 0, display: 'flex', flexDirection: 'column', padding: '14px 16px 16px', textTransform: 'uppercase' }}>
          {/* UPPER - RX/variant status + the full structural workout, left
              aligned, compact (owner §6/§7/§10). */}
          <div>
            {(variantLevel || notRxdLabel) && (
              <div style={{ display: 'flex', alignItems: 'center', gap: '6px', marginBottom: '8px', flexWrap: 'wrap' }}>
                {variantLevel && (
                  <span style={{ padding: '3px 11px', borderRadius: '20px', background: 'rgba(255,255,255,0.18)', color: '#fff', fontSize: '11px', fontWeight: '700', lineHeight: 1.2 }}>
                    {variantLevel}
                  </span>
                )}
                {notRxdLabel && (
                  <span style={{ padding: '3px 10px', borderRadius: '20px', background: 'rgba(255,255,255,0.18)', color: '#fff', fontSize: '10px', fontWeight: '600', lineHeight: 1.2 }}>
                    {notRxdLabel}
                  </span>
                )}
              </div>
            )}
            {structureHeader && (
              <div style={{ marginBottom: movements?.length ? '4px' : '0' }}>
                <span style={{ fontSize: '15px', fontWeight: '700', color: '#fff', lineHeight: 1.25 }}>{structureHeader.primary}</span>
                {structureHeader.secondary && (
                  <span style={{ fontSize: '13px', fontWeight: '700', color: accent, marginLeft: '6px', lineHeight: 1.25 }}>{structureHeader.secondary}</span>
                )}
                {structureHeader.prescriptionLines.map((l, i) => (
                  <div key={i} style={{ fontSize: '12px', fontWeight: '600', color: '#fff', lineHeight: 1.35, marginTop: '2px' }}>{l}</div>
                ))}
              </div>
            )}
            {movements && movements.length > 0 && (
              <div style={{ fontSize: '12px', fontWeight: '600', lineHeight: 1.35, color: 'rgba(255,255,255,0.88)' }}>
                {movements.map((m, i) => <div key={i} style={{ overflowWrap: 'anywhere' }}>{m}</div>)}
              </div>
            )}
          </div>

          {/* LOWER - pushed to the bottom of the photo body regardless of how
              much (or little) workout content sits above it (owner §17). */}
          <div style={{ marginTop: 'auto', textAlign: 'center' }}>
            {resultText && (
              <div style={{ fontSize: 'clamp(20px, 6vw, 28px)', fontWeight: '800', color: accent, lineHeight: 1.15, letterSpacing: '-0.01em', marginBottom: '6px', overflowWrap: 'anywhere' }}>
                {resultText}
              </div>
            )}
            {dateObj && (
              <div style={{ fontSize: '11px', fontWeight: '600', color: '#fff', textTransform: 'none' }}>
                {dateObj.toLocaleDateString(localeFor(lang), { day: '2-digit', month: '2-digit', year: 'numeric' })} · {dateObj.toLocaleTimeString(localeFor(lang), { hour: '2-digit', minute: '2-digit' })}
              </div>
            )}
            {congratsText && (
              <div style={{ marginTop: '8px', fontSize: '12px', fontWeight: '600', color: '#fff', textTransform: 'none' }}>
                {congratsText}
              </div>
            )}
            {onShare && (
              <button onClick={onShare}
                style={{ marginTop: '12px', width: '100%', padding: '12px 20px', background: accent, color: shareTextColor, border: 'none', borderRadius: '10px', fontSize: '13px', fontWeight: '700', lineHeight: 1, cursor: 'pointer', textTransform: 'none' }}>
                {shareLabel}
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
